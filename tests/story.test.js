import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InputManager } from '../src/core/InputManager.js';
import { Game } from '../src/core/Game.js';
import { Level1 } from '../src/levels/Level1.js';
import { ZombiePool } from '../src/enemies/ZombiePool.js';
import { StoryUI } from '../src/ui/StoryUI.js';
import { Player } from '../src/player/Player.js';
import { Zombie } from '../src/enemies/Zombie.js';
import { clearSegment } from '../src/enemies/PursuitMap.js';
import { LevelManager } from '../src/levels/LevelManager.js';

class Element {
  constructor() { this.children = new Map(); this.classList = { add() {}, remove() {} }; }
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Element());
    return this.children.get(selector);
  }
  appendChild() {}
  getContext() { return new Proxy({}, { get: () => () => {} }); }
}

function setup() {
  const listeners = new Map();
  globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn) };
  globalThis.document = { addEventListener() {}, createElement: () => new Element(), body: new Element() };
  globalThis.requestAnimationFrame = () => {};
  const input = new InputManager();
  const key = (code, repeat = false) => listeners.get('keydown')({ code, repeat });
  const up = code => listeners.get('keyup')({ code });
  return { input, key, up, listeners };
}

function levelFixture() {
  const level = new Level1(new THREE.Scene());
  level.maze = level._getMazeData(); level.mazeHeight = 31; level.mazeWidth = 51;
  level._setupZombies();
  level.explosionPool.update = () => {};
  level._createStoryEnvironment();
  return level;
}

function gameFixture() {
  const controls = setup();
  const level = levelFixture();
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    input: controls.input, currentLevel: level, storyUI: new StoryUI(new Element()),
    STATE: { PLAYING: 'playing', PAUSED: 'paused' }, state: 'playing',
    player: { group: new THREE.Group(), alive: true, health: 100, update() { this.updates++; }, updates: 0, takeDamage() {} },
    clock: { getDelta: () => 0.016 }, elapsedTime: 0, pendingLevelCompleteTimer: 0,
    renderer: { render() {} }, bulletPool: { update() {} },
    _updateHUD() {}, _handleShooting() { this.shots++; }, shots: 0,
    restartLevel() { this.restarts++; }, restarts: 0,
  });
  game.player.group.position.copy(level.clues[0].group.position);
  return { ...controls, game, level };
}

test('physical key edges ignore OS repeat, re-arm after release, and clear on blur', () => {
  const { input, key, up, listeners } = setup();
  key('KeyE'); assert.equal(input.consumePress('KeyE'), true);
  key('KeyE', true); assert.equal(input.consumePress('KeyE'), false);
  assert.equal(input.isDown('KeyE'), true);
  up('KeyE'); key('KeyE'); assert.equal(input.consumePress('KeyE'), true);
  key('KeyR'); input.endFrame(); assert.equal(input.consumePress('KeyR'), false);
  listeners.get('blur')(); assert.equal(input.isDown('KeyE'), false);
});

test('phone contact alone does nothing; E opens once and pauses the opening frame', () => {
  const { game, key, up, level } = gameFixture();
  game._animate(); assert.equal(level.requiredCluesFound, 0);
  key('KeyE'); game._animate();
  assert.equal(game.storyUI.isEvidenceOpen, true);
  assert.equal(level.requiredCluesFound, 1);
  assert.equal(game.player.updates, 1); assert.equal(game.shots, 1);
  key('KeyE', true); game._animate();
  assert.equal(game.storyUI.isEvidenceOpen, true);
  key('KeyR'); game._animate(); assert.equal(game.restarts, 0);
  up('KeyE'); key('KeyE'); game._animate();
  assert.equal(game.storyUI.isEvidenceOpen, false);
  game._animate(); assert.equal(game.restarts, 0);
  up('KeyE'); key('KeyE'); game._animate();
  assert.equal(game.storyUI.isEvidenceOpen, false);
  assert.equal(level.requiredCluesFound, 1);
  up('KeyR'); key('KeyR'); game._animate(); assert.equal(game.restarts, 1);
  level.dispose();
});

test('Escape closes evidence without pausing or restarting and camera deltas are discarded', () => {
  const { game, key, input, level } = gameFixture();
  key('KeyE'); game._animate(); input.mouseDeltaX = 900;
  key('Escape'); game._animate();
  assert.equal(game.storyUI.isEvidenceOpen, false);
  assert.equal(game.state, 'playing'); assert.equal(input.mouseDeltaX, 0);
  assert.equal(game.restarts, 0); level.dispose();
});

test('radio is sequential and every clue is collected once', () => {
  setup(); const level = levelFixture();
  const [phone, radio] = level.clues;
  assert.equal(level.interact(radio.group.position), null);
  assert.equal(level.interact(phone.group.position).type, 'evidence');
  assert.equal(level.interact(phone.group.position), null);
  assert.equal(level.interact(radio.group.position).type, 'evidence');
  assert.equal(level.interact(radio.group.position), null);
  assert.equal(level.requiredCluesFound, 2);
  level.dispose();
});

test('story text queues and reading timers freeze while evidence is open', () => {
  setup(); const ui = new StoryUI(new Element());
  ui.showMessage('UNKNOWN', 'First'); ui.showMessage('UNKNOWN', 'Second');
  ui.showEvidence({ body: [] }); const duration = ui.messageTimer;
  ui.update(20); assert.equal(ui.messageTimer, duration);
  ui.closeEvidence(); ui.update(20); ui.update(0);
  assert.equal(ui.message.querySelector('.story-message-text').textContent, 'Second');
  ui.reset(); assert.equal(ui.messageQueue.length, 0);
});

test('spawns stay away from player and never repeat an encounter', () => {
  setup(); const level = levelFixture();
  level.lastPlayerPosition.copy(level.encounterSpawnPoints[0]);
  level._startEncounter('test', 12, [0]);
  level._updateEncounters(0);
  assert.ok(level.zombiePool.activeCount > 0);
  level.zombiePool.forEachActive(z => assert.ok(z.group.position.distanceTo(level.lastPlayerPosition) >= 8));
  const count = level.zombiePool.activeCount;
  level._startEncounter('test', 12); assert.equal(level.zombiePool.activeCount, count);
  level.dispose();
});

test('unused pooled zombies are invisible', () => {
  const pool = new ZombiePool(new THREE.Scene(), 3);
  pool.pool.forEachAll(z => assert.equal(z.group.visible, false));
  pool.dispose();
});

test('Janitor breaks out during the ambush without kills; key and exit trigger once', () => {
  setup(); const level = levelFixture(); level._createRooftopLandmarks();
  level.requiredCluesFound = 2; level.exitDiscovered = true;
  const player = { group: new THREE.Group(), takeDamage() {}, hasKey: false };
  player.group.position.copy(level.janitorSpawnPoint);
  const events = level.update(0, player, 0);
  assert.equal(level.janitorReleased, false);
  for (let i = 0; i < 30; i++) level.update(0.05, player, i * 0.05);
  assert.equal(level.janitorReleased, true);
  assert.equal(events.storyEvents.filter(e => e.type === 'alarm').length, 1);
  assert.equal(level.obstacles.includes(level.janitorGateObstacle), false);
  assert.equal(level.update(0, player, 0).storyEvents.some(e => e.type === 'alarm'), false);
  level.janitorZombie.takeDamage(level.explosionPool);
  level.handleZombieKilled(level.janitorZombie, level.janitorSpawnPoint);
  assert.match(level.objective, /Collect/);
  player.group.position.copy(level.keyMesh.position);
  assert.equal(level.update(0, player, 0).keyCollected, true);
  assert.equal(level.update(0, player, 0).keyCollected, false);
  level.exitDoorPosition = player.group.position.clone();
  assert.equal(level.update(0, player, 0).levelComplete, true);
  assert.equal(level.update(0, player, 0).levelComplete, false);
  level.dispose();
});

test('chain kills spare the Janitor; direct shot kills him', () => {
  setup(); const level = levelFixture();
  const pos = level.janitorSpawnPoint;
  const a = level.zombiePool.spawn(pos); const b = level.zombiePool.spawn(pos);
  a.takeDamage(level.explosionPool);
  assert.equal(level.handleZombieKilled(a, pos), 1);
  assert.equal(b.alive, false); assert.equal(level.janitorZombie.alive, true);
  assert.equal(level.keyMesh, null);
  assert.equal(level.janitorZombie.takeDamage(level.explosionPool).killed, true);
  level.handleZombieKilled(level.janitorZombie, pos); assert.ok(level.keyMesh);
  level.dispose();
});

test('player collision blocks thin walls and preserves sliding', () => {
  const player = Object.create(Player.prototype);
  Object.assign(player, { group: new THREE.Group(), velocity: new THREE.Vector3(2, 0, 2), radius: 0.48, collisionClearance: 0.12 });
  player.group.position.set(-2, 0, 0);
  const obstacles = [{ x: 0, z: 0, halfX: 0.1, halfZ: 4 }];
  player._moveHorizontalAxis('x', 4, obstacles);
  assert.ok(player.group.position.x <= -0.7);
  player._moveHorizontalAxis('z', 1, obstacles);
  assert.equal(player.group.position.z, 1);
});

function advanceSpawns(level, duration, step = 0.05) {
  for (let time = 0; time < duration; time += step) {
    level.storyClock += step; level._updateEncounters(step);
  }
}

function clearHorde(level) {
  const active = [];
  level.zombiePool.forEachActive(z => active.push(z));
  active.forEach(z => level.zombiePool.release(z));
}

test('story triggers deliver escalating finite groups: 9, 12, 16, then 20 + 8', () => {
  setup(); const level = levelFixture();
  level.interact(level.clues[0].group.position);
  level._updateEncounters(0);
  assert.equal(level.zombiePool.activeCount, 3);
  advanceSpawns(level, 1); assert.equal(level.zombiePool.activeCount, 3);
  advanceSpawns(level, 4); assert.equal(level.zombiePool.activeCount, 9);
  clearHorde(level);
  level.interact(level.clues[1].group.position); advanceSpawns(level, 5);
  assert.equal(level.zombiePool.activeCount, 12); clearHorde(level);
  const player = { group: new THREE.Group(), hasKey: false, takeDamage() {} };
  level.exitDoorPosition = new THREE.Vector3(-30, 0, 10);
  player.group.position.copy(level.exitDoorPosition);
  level.update(0.05, player, 0); advanceSpawns(level, 6);
  assert.equal(level.zombiePool.activeCount, 16); clearHorde(level);
  level.update(0, player, 0);
  assert.equal(level.encounterStats.get('stairwell-contact').requested, 16);
  player.group.position.copy(level.janitorSpawnPoint);
  for (let i = 0; i < 140; i++) level.update(0.05, player, i * 0.05);
  assert.equal(level.janitorReleased, true);
  assert.equal(level.encounterStats.get('janitor-ambush').spawned, 20);
  assert.equal(level.encounterStats.get('janitor-reinforcements').spawned, 8);
  assert.equal(level.zombiePool.activeCount, 28);
  assert.equal(level.encounterQueue.length, 0);
  clearHorde(level); advanceSpawns(level, 20);
  assert.equal(level.zombiePool.activeCount, 0); level.dispose();
});

test('pool capacity defers enemies, preserves their budget, and never grows past 32', () => {
  setup(); const level = levelFixture();
  for (let i = 0; i < 32; i++) level.zombiePool.spawn(new THREE.Vector3(0, 0, i));
  assert.equal(level.zombiePool.spawn(new THREE.Vector3()), null);
  level._startEncounter('capacity', 9, [0, 1, 2], 3, 1);
  advanceSpawns(level, 5);
  assert.equal(level.encounterStats.get('capacity').spawned, 0);
  assert.equal(level.encounterQueue[0].remaining, 9);
  clearHorde(level); advanceSpawns(level, 5);
  assert.equal(level.encounterStats.get('capacity').spawned, 9);
  assert.equal(level.zombiePool.pool.pooledCount, 32); level.dispose();
});

test('blocked access points retry safely instead of discarding enemies', () => {
  setup(); const level = levelFixture();
  level.obstacles.push({ x: 0, z: 0, halfX: 100, halfZ: 100 });
  level._startEncounter('blocked', 9, [0, 1, 2], 3, 1);
  advanceSpawns(level, 3);
  assert.equal(level.encounterStats.get('blocked').spawned, 0);
  level.obstacles.pop(); advanceSpawns(level, 4);
  assert.equal(level.encounterStats.get('blocked').spawned, 9);
  level.zombiePool.forEachActive(z => {
    assert.ok(z.group.position.distanceTo(level.lastPlayerPosition) >= 8);
    for (const o of level.obstacles) assert.ok(Math.abs(z.group.position.x - o.x) >= (o.halfX ?? o.radius) + 0.5 || Math.abs(z.group.position.z - o.z) >= (o.halfZ ?? o.radius) + 0.5);
  });
  level.dispose();
});

test('in-view access routes defer spawns until the camera turns away', () => {
  setup(); const level = levelFixture();
  level.encounterSpawnPoints = [new THREE.Vector3(0, 0, -12)];
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  camera.position.set(0, 2, 0); camera.lookAt(0, 1, -12);
  level._startEncounter('visible', 3, [0], 3);
  level._updateEncounters(0, camera);
  assert.equal(level.zombiePool.activeCount, 0);
  camera.lookAt(0, 1, 12); level._updateEncounters(0.25, camera);
  assert.equal(level.zombiePool.activeCount, 3); level.dispose();
});

test('Janitor breakout is not gated by kills or free pool slots', () => {
  setup(); const level = levelFixture();
  for (let i = 0; i < 32; i++) level.zombiePool.spawn(new THREE.Vector3(-40, 0, i / 2));
  level._startJanitorEncounter();
  const player = { group: new THREE.Group(), takeDamage() {} };
  for (let i = 0; i < 31; i++) level.update(0.05, player, 0);
  assert.equal(level.janitorReleased, true);
  assert.equal(level.encounterStats.get('janitor-ambush').spawned, 0);
  level.janitorZombie.takeDamage(level.explosionPool);
  level.handleZombieKilled(level.janitorZombie, level.janitorSpawnPoint);
  assert.equal(level.encounterQueue.length, 0);
  assert.equal(level.encounterStats.get('janitor-ambush').cancelled, 20);
  level.dispose();
});

test('real rooftop geometry allows pursuit from every hatch to the radio and stairwell', async () => {
  setup(); const level = new Level1(new THREE.Scene());
  const originalLoad = THREE.TextureLoader.prototype.load;
  // Only texture I/O is stubbed; use the actual level geometry and colliders.
  THREE.TextureLoader.prototype.load = (_url, onLoad) => onLoad(new THREE.Texture());
  try { await level._buildMaze(); } finally { THREE.TextureLoader.prototype.load = originalLoad; }
  level._setupZombies(); level._createStoryEnvironment(); level._createExitDoor();
  level._createRooftopLandmarks(); level._createPursuitMap();
  for (const target of [level.clues[1].group.position, level.exitDoorPosition]) {
    for (const spawn of level.encounterSpawnPoints) for (const side of [-1, 1]) {
      const zombie = new Zombie(level.scene, spawn, { speed: 2 });
      zombie.steerSide = side;
      let hits = 0;
      for (let frame = 0; frame < 3600 && !hits; frame++) {
        level.navigation.update(1 / 30, target);
        if (zombie.update(1 / 30, target, level.obstacles, level.navigation).hit) hits++;
        assert.equal(clearSegment(zombie.group.position.x, zombie.group.position.z,
          zombie.group.position.x, zombie.group.position.z, level.obstacles, 0.39), true);
      }
      assert.ok(hits > 0, `hatch ${spawn.x},${spawn.z} could not reach ${target.x},${target.z}: ended ${zombie.group.position.toArray()}, waypoint ${zombie._waypoint.toArray()}, recoveries ${zombie.stuckRecoveries}`);
      zombie.dispose();
    }
  }
  level.dispose();
});

test('actual restart replaces the level and clears encounter budgets and player state', async () => {
  const { game, level, input } = gameFixture();
  game.STATE.LOADING = 'loading';
  game.levelManager = new LevelManager(level.scene);
  game.levelManager.currentLevel = level;
  // Exercise the real manager and Game transition, bypass only asset loading.
  game.levelManager._getLevelClass = () => class extends Level1 {
    async load() {
      this.maze = this._getMazeData(); this.mazeHeight = 31; this.mazeWidth = 51;
      this._setupZombies(); this._createStoryEnvironment();
    }
  };
  game.player = new Player(level.scene, input, new THREE.PerspectiveCamera());
  game.player.health = 10; game.player.hasKey = true;
  game.hudEl = new Element(); game.keyIndicator = new Element();
  game.levelTitleDisplay = new Element(); game._showOverlay = () => {};
  game._resetCombatHUD = () => {};
  document.getElementById = () => ({ style: {} });
  input.requestPointerLock = () => {};
  level._startEncounter('first-contact', 9);
  await Game.prototype.restartLevel.call(game);
  assert.notEqual(game.currentLevel, level);
  assert.equal(level.encounterQueue.length, 0);
  assert.equal(game.currentLevel.encounterQueue.length, 0);
  assert.equal(game.currentLevel.triggeredEncounters.size, 0);
  assert.equal(game.currentLevel.requiredCluesFound, 0);
  assert.equal(game.player.health, 100); assert.equal(game.player.hasKey, false);
  assert.equal(game.state, 'playing');
  game.player.dispose(); game.currentLevel.dispose();
});
