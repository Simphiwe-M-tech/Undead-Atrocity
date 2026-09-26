import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Player } from '../src/player/Player.js';

globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, properties) { Object.assign(this, properties); }
};

async function fixture() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const keys = new Set();
  const input = { pointerLocked: false, flushMouseDelta() {}, isDown: code => keys.has(code) };
  const player = new Player(scene, input, camera);
  await player.loadModel({ async loadAsync(url) {
    const data = JSON.parse(await readFile(new URL(`../public/assets/cube-world/${url.split('/').at(-1)}`, import.meta.url), 'utf8'));
    // Browser verification covers atlas decoding; retain actual mesh/rig/clips.
    delete data.images;
    delete data.textures;
    for (const material of data.materials) delete material.pbrMetallicRoughness.baseColorTexture;
    return new GLTFLoader().parseAsync(JSON.stringify(data), '');
  } });
  return { scene, camera, keys, player };
}

test('male kit character replaces the procedural body at player scale and faces movement', async () => {
  const { player } = await fixture();
  try {
    const model = player.character.model;
    assert.equal(model.userData.kitAsset, 'Character_Male_1');
    assert.equal(model.parent, player.group);
    assert.equal(player.head.visible, false);
    assert.equal(player.torso.visible, false);
    assert.equal(player._fallbackRightArm.visible, false);
    const meshes = [];
    model.traverse(mesh => { if (mesh.isSkinnedMesh) meshes.push(mesh); });
    assert.equal(meshes.length, 1);
    assert.ok(meshes[0].geometry.getAttribute('uv'));
    assert.equal(meshes[0].material.color.getHex(), 0xffffff, 'original atlas is recolored');
    assert.ok(meshes[0].castShadow && meshes[0].receiveShadow);
    model.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(model, true);
    assert.ok(Math.abs(bounds.max.y - 2.2) < 0.01);
    assert.ok(Math.abs(bounds.min.y) < 0.02, 'feet do not meet the deck');
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(model.quaternion);
    assert.ok(front.dot(player.getForwardDirection()) > 0.999);
  } finally { player.dispose(); }
});

test('kit walking, sprint, dodge and camera switches keep the gun inside the animated hand', async () => {
  const { player, camera, keys } = await fixture();
  try {
    player.update(0.016);
    assert.equal(player.character.state, 'idle');
    keys.add('KeyW');
    player.update(0.2);
    assert.equal(player.character.state, 'walk');
    const leg = player.character.model.getObjectByName('UpperLegL');
    const pose = leg.quaternion.clone();
    player.update(0.1);
    assert.ok(pose.angleTo(leg.quaternion) > 0.01, 'walking rig is frozen');
    keys.add('ShiftLeft');
    player.update(0.2);
    assert.equal(player.character.state, 'run');
    keys.add('Space');
    player.update(0.016);
    assert.equal(player.isDodging, true);
    keys.delete('Space');
    for (const yaw of [0, 1.7, -2.4]) for (const pitch of [-1, 0, 1]) {
      player.yaw = yaw;
      player.pitch = pitch;
      player.update(0.016);
      const target = new THREE.Vector3(0, 0, -80).applyQuaternion(camera.quaternion).add(camera.position);
      player.aimWeaponAt(target);
      const grip = player.handSocket.getWorldPosition(new THREE.Vector3());
      const wrist = player.character.hand.getWorldPosition(new THREE.Vector3());
      assert.ok(wrist.distanceTo(grip) < 0.13, `grip detached at ${yaw}, ${pitch}`);
      const muzzle = player.getMuzzleWorldPosition();
      const barrel = new THREE.Vector3(0, 0, -1).applyQuaternion(player.gunGroup.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(barrel.dot(target.sub(muzzle).normalize()) > 0.995, 'barrel turned away from aim');
      assert.equal(player.handSocket.parent, player.rightArmPivot);
    }
    player.toggleCamera();
    player.update(0.016);
    assert.equal(player.character.model.visible, false);
    assert.equal(player._fallbackRightArm.visible, true);
    assert.equal(player.gunGroup.visible, true);
    player.toggleCamera();
    assert.equal(player.character.model.visible, true);
    assert.equal(player._fallbackRightArm.visible, false);
  } finally { player.dispose(); }
});

test('restart reuses the character and disposal releases its geometry, skin and materials', async () => {
  const { player, keys, scene } = await fixture();
  const character = player.character;
  keys.add('KeyW');
  keys.add('ShiftLeft');
  player.update(0.1);
  player.reset(new THREE.Vector3(4, 0, -6));
  assert.equal(player.character, character);
  assert.equal(character.state, 'idle');
  assert.deepEqual(player.group.position.toArray(), [4, 0, -6]);
  let disposed = 0;
  for (const resource of character.resources) {
    if (resource.addEventListener) resource.addEventListener('dispose', () => disposed++);
  }
  player.dispose();
  assert.equal(character.resources.size, 0);
  assert.equal(character.model.parent, null);
  assert.ok(!scene.children.includes(player.group));
  assert.ok(disposed >= 2);
});
