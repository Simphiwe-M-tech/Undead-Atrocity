import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ZombieKit } from '../src/enemies/ZombieKit.js';
import { Zombie } from '../src/enemies/Zombie.js';
import { ZombiePool } from '../src/enemies/ZombiePool.js';
import { Level1 } from '../src/levels/Level1.js';
import { kitLoader } from './helpers/kit-loader.js';

function skin(zombie) {
  let result;
  zombie.group.traverse(mesh => { if (mesh.isSkinnedMesh) result = mesh; });
  return result;
}

test('encounter roster mixes three original kit designs and each accepts animated hits', async () => {
  const kit = await ZombieKit.load(kitLoader);
  const scene = new THREE.Scene();
  const pool = new ZombiePool(scene, 32, kit);
  const assets = ['Zombie', 'Goblin', 'Demon'];
  try {
    const pack = Array.from({ length: 9 }, (_, index) => pool.spawn(new THREE.Vector3(index * 4, 0, 0)));
    for (const asset of assets) {
      const matching = pack.filter(zombie => zombie.kitModel.model.userData.kitAsset === asset);
      assert.equal(matching.length, 3, `${asset} is missing from the encounter mix`);
      assert.equal(skin(matching[0]).geometry, skin(matching[1]).geometry);
      assert.notEqual(skin(matching[0]).skeleton, skin(matching[1]).skeleton);
      const zombie = matching[0];
      const rig = zombie.kitModel;
      scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(zombie.group, true);
      assert.ok(Math.abs(bounds.max.y - 2.2) < 0.08, `${asset} height does not match the enemies`);
      assert.ok(Math.abs(bounds.min.y) < 0.05, `${asset} feet are off the roof`);
      zombie.update(0.1, zombie.group.position.clone().add(new THREE.Vector3(0, 0, 8)));
      assert.equal(rig.state, 'Walk');
      const leg = rig.model.getObjectByName('LegL');
      const pose = leg.quaternion.clone();
      zombie.update(0.2, zombie.group.position.clone().add(new THREE.Vector3(0, 0, 8)));
      assert.ok(pose.angleTo(leg.quaternion) > 0.01, `${asset} gait is frozen`);
      zombie.update(0.016, zombie.group.position.clone().add(new THREE.Vector3(0, 0, 1)));
      zombie.update(0.25, zombie.group.position.clone().add(new THREE.Vector3(0, 0, 1)));
      assert.equal(rig.state, 'Attack');
      scene.updateMatrixWorld(true);
      const centre = kit.variants.get(asset).headBounds.getCenter(new THREE.Vector3());
      rig.model.getObjectByName('Head').localToWorld(centre);
      const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(0, 0, 4)), new THREE.Vector3(0, 0, -1));
      assert.ok(ray.intersectObject(zombie.group, true).length > 0, `${asset} cannot be shot while animated`);
      assert.equal(zombie.takeDamage({ trigger() {} }).killed, true);
      pool.release(zombie);
      const reused = pool.spawn(new THREE.Vector3(-4, 0, 0));
      assert.equal(reused.kitModel, rig);
      assert.equal(rig.model.userData.kitAsset, asset);
      assert.equal(rig.state, 'Idle');
    }
    const rosterCounts = new Map(assets.map(asset => [asset, 0]));
    pool.pool.forEachAll(zombie => {
      const asset = zombie.kitModel.model.userData.kitAsset;
      rosterCounts.set(asset, rosterCounts.get(asset) + 1);
    });
    assert.deepEqual([...rosterCounts.values()], [11, 11, 10]);
  } finally { pool.dispose(); kit.dispose(); }
  assert.equal(kit.resources.size, 0);
  assert.equal(kit.variants.size, 0);
});

test('kit zombies share geometry and atlas but have independent skeletons and hit materials', async () => {
  const kit = await ZombieKit.load(kitLoader);
  const scene = new THREE.Scene();
  const regular = new Zombie(scene, new THREE.Vector3(), { modelLibrary: kit });
  const other = new Zombie(scene, new THREE.Vector3(6, 0, 0), { modelLibrary: kit });
  const janitor = new Zombie(scene, new THREE.Vector3(3, 0, 0), { modelLibrary: kit, isJanitor: true });
  try {
    assert.equal(regular.kitModel.model.userData.kitAsset, 'Zombie');
    assert.equal(regular.group.children.length, 1, 'the old body is still shootable');
    assert.equal(janitor.kitModel.model.userData.kitAsset, 'Giant');
    const a = skin(regular), b = skin(other);
    assert.equal(a.geometry, b.geometry);
    assert.equal(a.material.map, b.material.map);
    assert.notEqual(a.material, b.material);
    assert.notEqual(a.skeleton, b.skeleton);
    assert.notEqual(a.skeleton.bones[0], b.skeleton.bones[0]);
    assert.ok(a.geometry.getAttribute('uv'));
    assert.equal(a.material.color.getHex(), 0xffffff);
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(regular.group, true);
    assert.ok(Math.abs(bounds.max.y - 2.2) < 0.06);
    assert.ok(Math.abs(bounds.min.y) < 0.05);
    const giantBounds = new THREE.Box3().setFromObject(janitor.group, true);
    assert.ok(giantBounds.max.y > 2.6 && giantBounds.max.y < 3);
    assert.ok(Math.abs(giantBounds.min.y) < 0.05);
    assert.ok(janitor.group.getObjectByName('JanitorBlueCap'));
    assert.ok(janitor.group.getObjectByName('JanitorBadge'));
    regular._flashHit();
    assert.equal(a.material.emissive.getHex(), 0xffffff);
    assert.equal(b.material.emissive.getHex(), 0);
    regular.kitModel.update(0.13, false, 1.4);
    assert.equal(a.material.emissive.getHex(), 0);
  } finally { regular.dispose(); other.dispose(); janitor.dispose(); kit.dispose(); }
});

test('native zombie gait and attack animate while contact damage keeps its cooldown', async () => {
  const kit = await ZombieKit.load(kitLoader);
  const zombie = new Zombie(new THREE.Scene(), new THREE.Vector3(), { modelLibrary: kit, speed: 1.4 });
  try {
    const target = new THREE.Vector3(0, 0, 12);
    zombie.update(0.1, target);
    assert.equal(zombie.kitModel.state, 'Walk');
    const leg = zombie.kitModel.model.getObjectByName('LegL');
    const pose = leg.quaternion.clone();
    zombie.update(0.16, target);
    assert.ok(pose.angleTo(leg.quaternion) > 0.01);
    assert.ok(zombie.group.position.z > 0.2);
    zombie.speed = 2;
    zombie.update(0.16, target);
    assert.equal(zombie.kitModel.state, 'Run');
    target.copy(zombie.group.position).add(new THREE.Vector3(0, 0, 1));
    assert.equal(zombie.update(0.016, target).hit, true);
    assert.equal(zombie.kitModel.state, 'Attack');
    const arm = zombie.kitModel.model.getObjectByName('ArmR');
    const armPose = arm.quaternion.clone();
    assert.equal(zombie.update(0.2, target).hit, false);
    assert.ok(armPose.angleTo(arm.quaternion) > 0.01);
    assert.equal(zombie.update(0.9, target).hit, true);
    assert.equal(zombie.kitModel.state, 'Attack');
  } finally { zombie.dispose(); kit.dispose(); }
});

test('animated skinned mesh accepts hits and pooled reuse resets the same rig without extra geometry', async () => {
  const kit = await ZombieKit.load(kitLoader);
  const scene = new THREE.Scene();
  const pool = new ZombiePool(scene, 1, kit);
  const position = new THREE.Vector3(4, 0, -2);
  const zombie = pool.spawn(position);
  const model = zombie.kitModel;
  const mesh = skin(zombie);
  try {
    zombie.update(0.016, position.clone().add(new THREE.Vector3(0, 0, 1)));
    zombie.update(0.25, position.clone().add(new THREE.Vector3(0, 0, 1)));
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(zombie.group, true);
    const centre = bounds.getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(0, 0, 4)), new THREE.Vector3(0, 0, -1));
    assert.ok(ray.intersectObject(mesh).length > 0, 'animated body cannot be shot');
    let explosions = 0;
    assert.equal(zombie.takeDamage({ trigger() { explosions++; } }).killed, true);
    assert.equal(explosions, 1);
    assert.equal(zombie.group.visible, false);
    pool.release(zombie);
    const reused = pool.spawn(new THREE.Vector3(-3, 0, 6));
    assert.equal(reused, zombie);
    assert.equal(reused.kitModel, model);
    assert.equal(skin(reused).geometry, mesh.geometry);
    assert.equal(model.state, 'Idle');
    assert.equal(model.attackRemaining, 0);
    assert.equal(reused.hitsRemaining, 1);
    assert.equal(pool.pool.pooledCount, 1);
    assert.equal(reused.group.visible, true);
  } finally { pool.dispose(); kit.dispose(); }
  assert.equal(model.resources.size, 0);
  assert.equal(kit.resources.size, 0);
});

test('rooftop kit infected retain chain explosions, Janitor protection and the dropped key', async () => {
  const level = new Level1(new THREE.Scene());
  level.maze = level._getMazeData();
  level.mazeWidth = 51; level.mazeHeight = 31;
  await level._loadZombieModels(kitLoader);
  level._setupZombies();
  const kit = level.zombieModels;
  try {
    const first = level.zombiePool.spawn(new THREE.Vector3());
    const second = level.zombiePool.spawn(new THREE.Vector3(1, 0, 0));
    level.janitorZombie.group.position.set(0.5, 0, 0);
    level.janitorReleased = true;
    level.zombies = [first, second, level.janitorZombie];
    assert.ok(first.kitModel && second.kitModel && level.janitorZombie.kitModel);
    assert.equal(level.janitorZombie.kitModel.model.userData.kitAsset, 'Giant');
    first.takeDamage(level.explosionPool);
    assert.equal(level.handleZombieKilled(first, first.group.position.clone()), 1);
    assert.equal(level.zombiePool.activeCount, 0);
    assert.equal(level.janitorZombie.alive, true);
    assert.equal(level.keyMesh, null);
    level.janitorZombie.takeDamage(level.explosionPool);
    level.handleZombieKilled(level.janitorZombie, level.janitorZombie.group.position.clone());
    assert.ok(level.keyMesh);
  } finally { level.dispose(); }
  assert.equal(kit.resources.size, 0);
  assert.equal(level.zombieModels, null);
});
