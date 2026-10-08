import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player/Player.js';

// ---------------------------------------------------------------------------
// Fixtures. The camera math is exercised through the real Player implementation
// with real geometry; assertions are relational (in front of / behind surfaces)
// rather than tied to exact level coordinates.
// ---------------------------------------------------------------------------

const EYE_HEIGHT = 1.5;
const OUTDOOR_OFFSET = new THREE.Vector3(0.8, 1.0, 5); // thirdPersonOffset minus eye height

function makePlayer() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  const input = { pointerLocked: false };
  const player = new Player(scene, input, camera);
  player.setCameraProfile('outdoor'); // match the in-game loadout path
  player.group.position.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0;
  return player;
}

function makeWall(zCentre) {
  // Thin slab whose front face (towards the player at the origin) is at zCentre - 0.1.
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(8, 6, 0.2),
    new THREE.MeshBasicMaterial()
  );
  wall.position.set(0, 2, zCentre);
  return wall;
}

function updateWorld(player, ...meshes) {
  for (const mesh of meshes) player.scene.add(mesh);
  if (meshes.length) player.setCollidableMeshes(meshes);
  player.scene.updateMatrixWorld(true);
  player._updateCameraPosition();
}

test('third-person ideal distances stay intact for both profiles', () => {
  const player = makePlayer();
  assert.ok(Math.abs(player._idealCameraDistance - Math.hypot(0.8, 2.5, 5)) < 1e-9);
  player.setCameraProfile('indoor');
  assert.ok(Math.abs(player._idealCameraDistance - Math.hypot(0.6, 1.85, 3.15)) < 1e-9);
  // The lens floor stays above the near plane regardless of profile.
  assert.equal(player._hardMinCameraDistance, 0.5);
  assert.ok(player._hardMinCameraDistance > player.camera.near);
  assert.equal(player._camCollisionMargin, 0.22);
  player.setCameraProfile('outdoor');
  assert.equal(player._camCollisionMargin, 0.3);
});

test('open area keeps the camera at the ideal distance with no drift', () => {
  const player = makePlayer();
  updateWorld(player);
  assert.ok(Math.abs(player._currentCameraDistance - OUTDOOR_OFFSET.length()) < 1e-9);
  const expected = new THREE.Vector3(0, EYE_HEIGHT, 0).add(OUTDOOR_OFFSET);
  assert.ok(player.camera.position.distanceTo(expected) < 1e-9);
});

test('obstruction snaps the camera immediately in front of the hit (no multi-frame lag)', () => {
  const player = makePlayer();
  // Aim the ray so it crosses z-depth 2.0 (ray distance 2.0 with dir.z factored in).
  const dir = OUTDOOR_OFFSET.clone().normalize();
  const wall = makeWall(2.0 * dir.z + 0.1);
  updateWorld(player, wall);
  const safe = 2.0 - player._camCollisionMargin;
  // _lastDt is deliberately unset: pull-in must not depend on frame time.
  assert.equal(player._lastDt, undefined);
  assert.ok(Math.abs(player._currentCameraDistance - safe) < 1e-6,
    `expected instant snap to ${safe}, got ${player._currentCameraDistance}`);
  assert.ok(player.camera.position.z < 2.0, 'camera must stay in front of the wall face');
});

test('camera never renders from behind a wall closer than the lens floor', () => {
  const player = makePlayer();
  // Wedge: wall face at z = 0.55, i.e. hit distance ~0.57, safe ~0.27 < 0.5 floor.
  const dir = OUTDOOR_OFFSET.clone().normalize();
  const faceZ = 0.55;
  const wall = makeWall(faceZ * dir.z + 0.1);
  updateWorld(player, wall);
  const hit = faceZ / dir.z;
  assert.ok(hit - player._camCollisionMargin < player._hardMinCameraDistance, 'fixture must be a genuine wedge');
  // Floor applies, but the camera must still be on the player's side of the face.
  assert.ok(Math.abs(player._currentCameraDistance - player._hardMinCameraDistance) < 1e-6);
  assert.ok(player.camera.position.z < faceZ, `camera z ${player.camera.position.z} must stay in front of the face at ${faceZ}`);
  // Lens stays a useful distance from the eye: never inside the head volume.
  assert.ok(player.camera.position.distanceTo(new THREE.Vector3(0, EYE_HEIGHT, 0)) >= player._hardMinCameraDistance - 1e-6);
});

test('camera-only blockers stop the camera and stay out of wallMeshes', () => {
  const player = makePlayer();
  const dir = OUTDOOR_OFFSET.clone().normalize();
  const bush = makeWall(0.5 * dir.z + 0.1); // blocker face crossed at ray distance 0.5
  const wall = makeWall(0.8 * dir.z + 0.1); // wall face crossed at ray distance 0.8, further away
  player.setCameraBlockers([bush]);
  updateWorld(player, wall);
  assert.ok(player.cameraBlockers.length === 1);
  assert.ok(!player.wallMeshes.includes(bush), 'blocker must not join the gameplay wall list');
  assert.ok(player.camera.position.z < 0.5, 'camera must stop in front of the decorative blocker');
  assert.ok(player._currentCameraDistance <= player._hardMinCameraDistance + 1e-6);
});

test('nearest of walls and blockers wins', () => {
  const player = makePlayer();
  const dir = OUTDOOR_OFFSET.clone().normalize();
  const bush = makeWall(3.0 * dir.z + 0.1); // far blocker
  const wall = makeWall(0.8 * dir.z + 0.1); // near wall
  player.setCameraBlockers([bush]);
  updateWorld(player, wall);
  const safe = 0.8 - player._camCollisionMargin;
  assert.ok(Math.abs(player._currentCameraDistance - safe) < 1e-6, 'wall is nearer than the blocker and must govern');
});

test('setCameraBlockers(undefined) clears stale blockers', () => {
  const player = makePlayer();
  player.setCameraBlockers([makeWall(1)]);
  player.setCameraBlockers(undefined);
  assert.equal(player.cameraBlockers.length, 0);
});

test('outward recovery eases smoothly instead of popping', () => {
  const player = makePlayer();
  player._lastDt = 0.016;
  // Start wedged.
  const dir = OUTDOOR_OFFSET.clone().normalize();
  const wall = makeWall(0.55 * dir.z + 0.1);
  updateWorld(player, wall);
  const wedged = player._currentCameraDistance;
  assert.ok(Math.abs(wedged - player._hardMinCameraDistance) < 1e-6);
  // Obstruction clears: the camera moves outward but must not jump to ideal.
  player.scene.remove(wall);
  player.setCollidableMeshes([]);
  player.scene.updateMatrixWorld(true);
  player._updateCameraPosition();
  assert.ok(player._currentCameraDistance > wedged, 'camera must begin recovering');
  assert.ok(player._currentCameraDistance < player._idealCameraDistance, 'recovery must stay interpolated');
});

test('steep look-up keeps the camera above the roof deck', () => {
  const player = makePlayer();
  player.pitch = 0.5; // ~29 degrees up: ideal position is below the deck
  updateWorld(player);
  assert.ok(player.camera.position.y >= player._floorClearanceY - 1e-6,
    `camera y ${player.camera.position.y} must stay above the deck clearance`);
});

test('indoor look-down keeps the camera below the ceiling slab', () => {
  const player = makePlayer();
  player.setCameraProfile('indoor');
  player.pitch = -0.9; // steep down: ideal position rises into the ceiling
  updateWorld(player);
  assert.ok(player.camera.position.y <= player._indoorCeilingY + 1e-6,
    `camera y ${player.camera.position.y} must stay under the indoor ceiling`);
});

test('first-person ignores collision, keeps distance untouched, and third-person re-entry re-snaps', () => {
  const player = makePlayer();
  const dir = OUTDOOR_OFFSET.clone().normalize();
  const wall = makeWall(0.8 * dir.z + 0.1);
  player._currentCameraDistance = 2.5;
  player.toggleCamera();
  updateWorld(player, wall);
  assert.ok(player.camera.position.distanceTo(new THREE.Vector3(0, 1.6, 0)) < 1e-9);
  assert.ok(Math.abs(player._currentCameraDistance - 2.5) < 1e-9, 'FP must not consume the collision distance');
  player.toggleCamera();
  player._updateCameraPosition();
  const safe = 0.8 - player._camCollisionMargin;
  assert.ok(Math.abs(player._currentCameraDistance - safe) < 1e-6, 'returning to third person must re-snap to the wall');
  assert.ok(player.camera.position.z < 0.8);
});

test('reset() restores the ideal distance after a wedge', () => {
  const player = makePlayer();
  const dir = OUTDOOR_OFFSET.clone().normalize();
  const wall = makeWall(0.55 * dir.z + 0.1);
  updateWorld(player, wall);
  assert.ok(player._currentCameraDistance < 1);
  player.reset(new THREE.Vector3());
  assert.ok(Math.abs(player._currentCameraDistance - player._idealCameraDistance) < 1e-9);
});
