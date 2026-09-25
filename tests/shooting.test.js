import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player/Player.js';
import { Bullet, BulletPool } from '../src/weapons/Bullet.js';
import { Game } from '../src/core/Game.js';
import { Level1 } from '../src/levels/Level1.js';

function fixture() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const keys = new Set();
  const input = { pointerLocked: true, mouseDeltaX: 0, mouseDeltaY: 0,
    flushMouseDelta() {}, isDown: key => keys.has(key), isMouseButtonDown: () => true };
  const player = new Player(scene, input, camera);
  return { scene, camera, input, player, keys };
}

test('pistol stays attached and aims forward in both views, moving, sprinting and after dodge', () => {
  const { player, camera, keys } = fixture();
  for (const firstPerson of [false, true]) {
    if (player.isFirstPerson !== firstPerson) player.toggleCamera();
    for (const yaw of [0, 1.7, -2.4]) for (const pitch of [-1.1, 0, 1.1]) {
      player.yaw = yaw; player.pitch = pitch;
      keys.add('KeyW'); keys.add('ShiftLeft');
      player.update(0.016);
      keys.add('Space'); player.update(0.016); keys.delete('Space');
      for (let i = 0; i < 25; i++) player.update(0.016);
      assert.equal(player.isDodging, false);
      assert.equal(player.gunGroup.parent, player.handSocket);
      assert.equal(player.handSocket.parent, player.rightArmPivot);
      const target = new THREE.Vector3(0, 0, -50).applyQuaternion(camera.quaternion).add(camera.position);
      player.aimWeaponAt(target);
      const muzzle = player.getMuzzleWorldPosition();
      const barrelDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(player.gunGroup.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(barrelDirection.dot(target.clone().sub(muzzle).normalize()) > 0.999);
      assert.ok(muzzle.distanceTo(player.group.position) < 2.5);
      if (firstPerson) {
        camera.updateMatrixWorld(); const screen = muzzle.clone().project(camera);
        assert.ok(Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1 && screen.z < 1);
        assert.equal(player.rightArmPivot.visible, true);
      }
    }
  }
  player.dispose();
});

test('flash and recoil reuse objects, expire without timers, and never kick the camera', () => {
  const { player, camera } = fixture();
  player.update(0.016); const rotation = camera.quaternion.clone();
  const flash = player.muzzleFlash, light = player.muzzleFlashLight;
  player.showShotFeedback();
  assert.equal(flash.visible, true); assert.equal(light.parent, player.muzzlePoint);
  player.updateShotFeedback(0.02);
  assert.ok(player.gunSlide.position.z > -0.065);
  player.updateShotFeedback(0.03); assert.equal(flash.visible, false);
  player.updateShotFeedback(0.1); assert.equal(player.gunSlide.position.z, -0.065);
  assert.ok(camera.quaternion.equals(rotation));
  player.showShotFeedback(); player.reset(new THREE.Vector3());
  assert.equal(flash.visible, false); assert.equal(light.intensity, 0);
  assert.equal(player.muzzleFlash, flash); player.dispose();
});

test('tracer geometry stays ahead of muzzle and between muzzle and target at unchanged speed', () => {
  const bullet = new Bullet(); const origin = new THREE.Vector3(2, 1, 3);
  bullet.reset(origin, origin.clone().add(new THREE.Vector3(0, 0, -10)));
  assert.equal(bullet.speed, 140);
  const bounds = new THREE.Box3();
  for (const dt of [0, 0.008, 0.016, 0.016]) {
    if (dt) bullet.update(dt);
    bullet.group.updateMatrixWorld(true); bounds.setFromObject(bullet.group);
    assert.ok(bounds.max.z <= origin.z + 1e-6);
    assert.ok(bounds.min.z >= -7 - 1e-6);
  }
  bullet.mesh.geometry.dispose(); bullet.mesh.material.dispose();
});

class AudioContextStub {
  constructor() { this.state = 'running'; this.sampleRate = 48000; this.buffers = 0; this.sources = []; }
  createBuffer(_channels, length) {
    this.buffers++; const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createGain() { return { gain: { value: 0 }, connect() {} }; }
  createBufferSource() {
    const source = { connect() {}, disconnect() { this.disconnected = true; }, start() { this.starts = (this.starts || 0) + 1; } };
    this.sources.push(source); return source;
  }
}

test('gunshot audio reuses the existing context, buffer and gain with one source per shot', () => {
  globalThis.window = { AudioContext: AudioContextStub };
  const game = Object.create(Game.prototype);
  const context = game.audioContext = new AudioContextStub(); // already used by alarm
  game._prepareGunshotAudio(); const gain = game.gunshotGain;
  for (let i = 0; i < 5; i++) game._playGunshot();
  assert.equal(context.buffers, 1); assert.equal(game.audioContext, context);
  assert.equal(game.gunshotGain, gain); assert.equal(context.sources.length, 5);
  for (const source of context.sources) {
    assert.equal(source.starts, 1); assert.equal(source.buffer, game.gunshotBuffer);
    source.onended(); assert.equal(source.disconnected, true);
  }
  const samples = game.gunshotBuffer.getChannelData(0);
  assert.ok(samples.some(x => x !== 0));
  assert.ok(samples.every(x => Math.abs(x) * gain.gain.value < 0.31));
  context.state = 'closed'; game._playGunshot();
  assert.equal(context.sources.length, 5);
});

test('hitscan still kills in one shot, chains nearby enemies and obeys fire cooldown', () => {
  globalThis.window = {}; // Audio unsupported must not prevent shooting.
  const { scene, player, input, camera } = fixture();
  player.toggleCamera(); player.update(0.016);
  const level = new Level1(scene);
  level.maze = level._getMazeData(); level.mazeWidth = 51; level.mazeHeight = 31; level._setupZombies();
  const first = level.zombiePool.spawn(new THREE.Vector3(0, 0, -8));
  const second = level.zombiePool.spawn(new THREE.Vector3(1, 0, -8));
  level.zombies = [first, second]; scene.updateMatrixWorld(true);
  const game = Object.create(Game.prototype);
  let sounds = 0, feedback = 0;
  const showFeedback = player.showShotFeedback.bind(player);
  player.showShotFeedback = () => { feedback++; showFeedback(); };
  Object.assign(game, { scene, player, input, camera, currentLevel: level, raycaster: new THREE.Raycaster(),
    shootCooldown: 0, shootRate: 0.25, shootRange: 80, bulletPool: new BulletPool(scene),
    _showChainMessage() {}, _playGunshot() { sounds++; } });
  game._handleShooting(0);
  assert.equal(first.alive, false); assert.equal(second.alive, false);
  assert.equal(player.score, 800);
  game.bulletPool.pool.forEachActive(bullet => assert.ok(bullet.origin.distanceTo(player.getMuzzleWorldPosition()) < 1e-8));
  game._handleShooting(0.1); assert.equal(sounds, 1);
  game._handleShooting(0.15); assert.equal(sounds, 2); assert.equal(feedback, 2);
  assert.equal(game.shootRate, 0.25); assert.equal(game.shootRange, 80);
  game.bulletPool.dispose(); player.dispose(); level.dispose();
});
