import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Zombie } from '../src/enemies/Zombie.js';
import { PursuitMap, clearSegment } from '../src/enemies/PursuitMap.js';

function simulate(obstacles, start, target, seconds = 30) {
  const navigation = new PursuitMap(obstacles, -16, -16, 32, 32);
  const zombie = new Zombie(new THREE.Scene(), new THREE.Vector3(...start), { speed: 2 });
  const player = new THREE.Vector3(...target);
  let hits = 0, climbed = false;
  for (let frame = 0; frame < seconds * 30; frame++) {
    navigation.update(1 / 30, player);
    if (zombie.update(1 / 30, player, obstacles, navigation).hit) hits++;
    climbed ||= zombie.climbing;
    assert.equal(clearSegment(zombie.group.position.x, zombie.group.position.z,
      zombie.group.position.x, zombie.group.position.z, obstacles, 0.39), true, 'enemy entered solid geometry');
  }
  const result = { hits, climbed, distance: zombie.group.position.distanceTo(player) };
  zombie.dispose(); return result;
}

test('persistent pursuit goes around a long wall, a plant block and a U-shaped enclosure', () => {
  for (const obstacles of [
    [{ x: 0, z: 0, halfX: 0.2, halfZ: 5, height: 2 }],
    [{ x: 0, z: 0, halfX: 2, halfZ: 2, height: 2 }],
    [{ x: 0, z: 0, halfX: 0.2, halfZ: 4, height: 2 },
      { x: -2, z: -4, halfX: 2, halfZ: 0.2, height: 2 },
      { x: -2, z: 4, halfX: 2, halfZ: 0.2, height: 2 }],
  ]) {
    const result = simulate(obstacles, [-2.8, 0, 0], [4, 0, 0]);
    assert.ok(result.hits > 0); assert.ok(result.distance < 1.5);
  }
});

test('segmented walls use rectangular footprints and allow routes around the ends', () => {
  const obstacles = [];
  for (let z = -6; z <= 6; z += 2) obstacles.push({ x: 0, z, halfX: 1, halfZ: 1, radius: 1.44 });
  assert.ok(simulate(obstacles, [-4, 0, 0], [4, 0, 0]).hits > 0);
});

test('fences are climbed but a solid wall behind them is never crossed', () => {
  const fence = { x: 0, z: 0, halfX: 0.2, halfZ: 5, height: 2, climbable: true };
  const result = simulate([fence], [-4, 0, 0], [4, 0, 0]);
  assert.equal(result.climbed, true); assert.ok(result.hits > 0);
  const backed = simulate([fence, { x: 1, z: 0, halfX: 0.2, halfZ: 5, height: 2 }], [-4, 0, 0], [4, 0, 0]);
  assert.ok(backed.hits > 0);
});

test('attacks cannot pass through a thin solid wall', () => {
  const result = simulate([{ x: 0, z: 0, halfX: 0.1, halfZ: 15 }], [-0.6, 0, 0], [0.6, 0, 0], 1);
  assert.equal(result.hits, 0);
});

test('stuck detection recalculates direction after 1.2 seconds and resets on pool reuse', () => {
  const zombie = new Zombie(new THREE.Scene(), new THREE.Vector3(-4, 0, 0), { speed: 2 });
  const target = new THREE.Vector3(4, 0, 0);
  const move = zombie._moveAxis;
  zombie._moveAxis = () => {}; // Temporary external obstruction, not a scripted teleport.
  const originalSide = zombie.steerSide;
  for (let i = 0; i < 37; i++) zombie.update(1 / 30, target);
  assert.equal(zombie.stuckRecoveries, 1); assert.equal(zombie.steerSide, -originalSide);
  zombie._moveAxis = move;
  for (let i = 0; i < 240; i++) zombie.update(1 / 30, target);
  assert.ok(zombie.group.position.distanceTo(target) < 1.5);
  zombie.spawn(new THREE.Vector3(), {});
  assert.equal(zombie.stuckRecoveries, 0); assert.equal(zombie.recoveryTimer, 0);
  zombie.dispose();
});

test('route target follows a moving player rather than a stale location', () => {
  const obstacles = [{ x: 0, z: 0, halfX: 0.2, halfZ: 4 }];
  const navigation = new PursuitMap(obstacles, -16, -16, 32, 32);
  const zombie = new Zombie(new THREE.Scene(), new THREE.Vector3(-4, 0, 0), { speed: 2 });
  const target = new THREE.Vector3(4, 0, 0);
  for (let i = 0; i < 600; i++) {
    if (i === 60) target.set(-8, 0, 8);
    navigation.update(1 / 30, target); zombie.update(1 / 30, target, obstacles, navigation);
  }
  assert.ok(zombie.group.position.distanceTo(target) < 1.5); zombie.dispose();
});
