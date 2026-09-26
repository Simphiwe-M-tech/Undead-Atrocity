import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CubeWorldKit } from '../src/utils/CubeWorldKit.js';
import { Level1 } from '../src/levels/Level1.js';
import { Zombie } from '../src/enemies/Zombie.js';
import { clearSegment } from '../src/enemies/PursuitMap.js';

globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, properties) { this.type = type; Object.assign(this, properties); }
};

// Parse the shipped kit geometry, UVs and author transforms. Only image decoding
// is bypassed here; Chromium verifies the actual embedded textures separately.
async function loadKit() {
  return CubeWorldKit.load({ async loadAsync(url) {
    const file = url.split('/').at(-1);
    const data = JSON.parse(await readFile(new URL(`../public/assets/cube-world/${file}`, import.meta.url), 'utf8'));
    delete data.images;
    delete data.textures;
    for (const material of data.materials) delete material.pbrMetallicRoughness.baseColorTexture;
    return new GLTFLoader().parseAsync(JSON.stringify(data), '');
  } });
}

async function fixture() {
  globalThis.document = {
    createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }),
  };
  const level = new Level1(new THREE.Scene());
  const load = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = (_url, onLoad) => onLoad(new THREE.Texture());
  try {
    await level._buildMaze();
    await level._createGround();
  } finally {
    THREE.TextureLoader.prototype.load = load;
  }
  level._createStoryEnvironment();
  level._setupZombies();
  level._createExitDoor();
  level._createRooftopLandmarks();
  await level._createRooftopArt(await loadKit());
  level._createPursuitMap();
  return level;
}

test('shipped kit blocks normalize to unit bounds with their original detail and UVs', async () => {
  const kit = await loadKit();
  try {
    assert.equal(kit.templates.size, 11);
    for (const [name, template] of kit.templates) {
      assert.ok(template.geometry.getAttribute('uv'), `${name} lost its atlas coordinates`);
      const { min, max } = template.geometry.boundingBox;
      for (const axis of ['x', 'y', 'z']) {
        assert.ok(Math.abs(min[axis] + 0.5) < 1e-5, `${name} ${axis} minimum`);
        assert.ok(Math.abs(max[axis] - 0.5) < 1e-5, `${name} ${axis} maximum`);
      }
    }
    assert.ok(kit.templates.get('masonry').geometry.getAttribute('position').count > 1000);
  } finally { kit.dispose(); }
});

test('finished roof keeps deck at ground height, clues visible, and every hatch connected to both objectives', async () => {
  const level = await fixture();
  try {
    const deck = level.rooftopArt.group.children.filter(mesh => mesh.name.endsWith('-deck'));
    assert.equal(deck.length, 4);
    const matrix = new THREE.Matrix4();
    let surfaceArea = 0;
    for (const mesh of deck) {
      for (let index = 0; index < mesh.count; index++) {
        mesh.getMatrixAt(index, matrix);
        const elements = matrix.elements;
        assert.ok(Math.abs(elements[13] + elements[5] / 2) < 1e-6, 'deck surface lifted player feet or covered decals');
        surfaceArea += Math.abs(elements[0] * elements[10] - elements[2] * elements[8]);
      }
    }
    const roofArea = 49 * 29 * 4;
    assert.ok(surfaceArea > roofArea * 0.94 && surfaceArea <= roofArea, 'paving left holes or overlapped garden decks');
    level.scene.updateMatrixWorld(true);
    assert.ok(level.maze.every(row => !row.includes('F')), 'a fence cell remains');
    assert.ok(level.obstacles.every(obstacle => !obstacle.climbable), 'an invisible fence collider remains');
    const room = level._cellToWorld(37, 25);
    const roomWall = level.obstacles.find(obstacle => obstacle.x === room.x && obstacle.z === room.z);
    assert.equal(roomWall.height, 2.7);
    for (const clue of level.clues.filter(clue => clue.required)) {
      assert.ok(clearSegment(clue.group.position.x, clue.group.position.z,
        clue.group.position.x, clue.group.position.z, level.obstacles, 0.39));
    }
    for (const target of [level.clues[1].group.position, level.exitDoorPosition]) {
      for (const spawn of level.encounterSpawnPoints) {
        assert.ok(clearSegment(spawn.x, spawn.z, spawn.x, spawn.z, level.obstacles, 0.45),
          `new dressing blocks hatch ${spawn.x},${spawn.z}`);
        const zombie = new Zombie(level.scene, spawn, { speed: 2 });
        try {
          let hit = false;
          for (let frame = 0; frame < 3600 && !hit; frame++) {
            level.navigation.update(1 / 30, target);
            hit = zombie.update(1 / 30, target, level.obstacles, level.navigation).hit;
            assert.ok(clearSegment(zombie.group.position.x, zombie.group.position.z,
              zombie.group.position.x, zombie.group.position.z, level.obstacles, 0.39));
          }
          assert.ok(hit, `decorated roof cuts off hatch ${spawn.x},${spawn.z} from objective ${target.x},${target.z}`);
        } finally { zombie.dispose(); }
      }
    }
  } finally { level.dispose(); }
});

test('new solid props participate in raycasts and rooftop resources are released on disposal', async () => {
  const level = await fixture();
  const art = level.rooftopArt;
  const crate = art.group.children.find(mesh => mesh.name === 'cube-world-crate');
  assert.ok(level.wallMeshes.includes(crate));
  level.scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(crate.position.clone().add(new THREE.Vector3(0, 0, 3)), new THREE.Vector3(0, 0, -1));
  assert.ok(ray.intersectObject(crate).length > 0);
  let disposed = 0;
  for (const { geometry } of art.kit.templates.values()) geometry.addEventListener('dispose', () => disposed++);
  level.dispose();
  assert.equal(art.group.parent, null);
  assert.equal(art.kit.templates.size, 0);
  assert.equal(level.rooftopArt, null);
  assert.equal(level.wallMeshes.length, 0);
  assert.equal(disposed, 11);
});

test('city buildings surround all roof edges and stay outside gameplay collision', async () => {
  const level = await fixture();
  try {
    const city = level.rooftopArt.city;
    assert.equal(city.group.parent, level.rooftopArt.group);
    assert.ok(city.buildings.length >= 32);
    for (const [axis, side, edge] of [['x', -1, 51], ['x', 1, 51], ['z', -1, 31], ['z', 1, 31]]) {
      assert.ok(city.buildings.some(building => building[axis] * side > edge), `no buildings on ${side} ${axis} edge`);
    }
    city.group.traverse(mesh => {
      assert.ok(!level.wallMeshes.includes(mesh), 'background architecture blocks rooftop shots');
    });
    assert.ok(city.group.children.filter(mesh => mesh.isInstancedMesh).reduce((count, mesh) => count + mesh.count, 0) > 1000);
  } finally { level.dispose(); }
});
