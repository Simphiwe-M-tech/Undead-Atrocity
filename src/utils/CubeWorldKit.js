import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ASSETS = {
  brick: 'Block_Brick',
  masonry: 'Block_GreyBricks',
  stone: 'Block_Stone',
  metal: 'Block_Metal',
  wood: 'Block_WoodPlanks',
  grass: 'Block_Grass',
  crate: 'Block_Crate',
  bush: 'Bush',
  flowers: 'Flowers_2',
  tree: 'Tree_2',
  plant: 'Plant_2',
};

// The original kit models have different scales and rotations. Bake those
// transforms into centred, unit-size geometry so placement uses world metres.
export class CubeWorldKit {
  constructor() {
    this.templates = new Map();
    this.resources = new Set();
  }

  static async load(loader = new GLTFLoader()) {
    const kit = new CubeWorldKit();
    const results = await Promise.allSettled(Object.entries(ASSETS).map(async ([name, file]) => {
      const gltf = await loader.loadAsync(`${import.meta.env?.BASE_URL ?? './'}assets/cube-world/${file}.gltf`);
      gltf.scene.updateMatrixWorld(true);
      let source;
      gltf.scene.traverse(node => { if (node.isMesh && !source) source = node; });
      if (!source) throw new Error(`Cube World asset ${file} contains no mesh`);

      const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
      geometry.computeBoundingBox();
      const centre = geometry.boundingBox.getCenter(new THREE.Vector3());
      const size = geometry.boundingBox.getSize(new THREE.Vector3());
      geometry.translate(-centre.x, -centre.y, -centre.z);
      geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = source.material;
      material.roughness = name === 'metal' ? 0.58 : 0.88;
      material.metalness = name === 'metal' ? 0.3 : 0;
      if (material.map) {
        material.map.magFilter = THREE.NearestFilter;
        kit.resources.add(material.map);
      }
      kit.templates.set(name, { geometry, material });
      kit.resources.add(geometry);
      kit.resources.add(material);
      source.geometry.dispose();
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) {
      kit.dispose();
      throw failure.reason;
    }
    return kit;
  }

  mesh(name, size = [1, 1, 1]) {
    const { geometry, material } = this.templates.get(name);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `cube-world-${name}`;
    mesh.scale.set(...size);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  replace(mesh, name) {
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
    const template = this.templates.get(name);
    mesh.geometry = template.geometry;
    mesh.material = template.material;
    mesh.scale.multiply(size);
  }

  dispose() {
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.templates.clear();
  }
}
