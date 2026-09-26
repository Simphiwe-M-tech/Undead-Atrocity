import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const REGULAR_ASSETS = ['Zombie', 'Goblin', 'Demon'];
const ENEMY_ASSETS = [...REGULAR_ASSETS, 'Giant'];

/** Shared geometry and atlases per variant; every infected has its own rig. */
export class ZombieKit {
  static async load(loader = new GLTFLoader()) {
    const models = await Promise.all(ENEMY_ASSETS.map(async asset => [asset,
      await loader.loadAsync(`${import.meta.env?.BASE_URL ?? './'}assets/cube-world/${asset}.gltf`)
    ]));
    return new ZombieKit(models);
  }

  constructor(models) {
    this.resources = new Set();
    this.variants = new Map();
    this.regularVariants = REGULAR_ASSETS;
    for (const [asset, gltf] of models) this._addVariant(asset, gltf);
  }

  _addVariant(asset, gltf) {
    const template = gltf.scene;
    const clips = new Map(gltf.animations.map(clip => [clip.name, clip]));
    for (const name of ['Idle', 'Walk', 'Run', 'Attack', 'Jump']) {
      if (!clips.has(name)) throw new Error(`Cube World ${asset} is missing ${name}`);
    }
    template.traverse(node => {
      if (!node.isMesh) return;
      this.resources.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        material.roughness = 0.9;
        this.resources.add(material);
        if (material.map) this.resources.add(material.map);
      }
      if (node.isSkinnedMesh) this.resources.add(node.skeleton);
    });
    const mixer = new THREE.AnimationMixer(template);
    mixer.clipAction(clips.get('Idle')).play();
    mixer.update(0);
    template.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(template, true);
    const height = asset === 'Giant' ? 2.65 : 2.2;
    const scale = height / (bounds.max.y - bounds.min.y);
    const centre = bounds.getCenter(new THREE.Vector3());
    const offset = new THREE.Vector3(-centre.x, -bounds.min.y, -centre.z).multiplyScalar(scale);
    this.variants.set(asset, { asset, template, clips, scale, offset, headBounds: this._headBounds(template) });
    mixer.stopAllAction();
    mixer.uncacheRoot(template);
  }

  _headBounds(template) {
    const head = template.getObjectByName('Head');
    const bounds = new THREE.Box3();
    const vertex = new THREE.Vector3();
    template.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const joint = mesh.skeleton.bones.indexOf(head);
      const indices = mesh.geometry.getAttribute('skinIndex');
      const weights = mesh.geometry.getAttribute('skinWeight');
      for (let index = 0; index < weights.count; index++) {
        if (![0, 1, 2, 3].some(component => indices.getComponent(index, component) === joint
          && weights.getComponent(index, component) > 0.5)) continue;
        mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld);
        head.worldToLocal(vertex);
        bounds.expandByPoint(vertex);
      }
    });
    return bounds;
  }

  create(isJanitor = false, asset = 'Zombie') {
    const variant = this.variants.get(isJanitor ? 'Giant' : asset);
    if (!variant) throw new Error(`Unknown Cube World enemy: ${asset}`);
    return new KitZombie(variant, isJanitor);
  }

  dispose() {
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    for (const variant of this.variants.values()) variant.clips.clear();
    this.variants.clear();
  }
}

class KitZombie {
  constructor(kit, isJanitor) {
    this.model = new THREE.Group();
    this.model.name = 'CubeWorldZombie';
    this.model.userData.kitAsset = kit.asset;
    this.model.scale.setScalar(kit.scale);
    this.model.position.copy(kit.offset);
    const rig = clone(kit.template);
    this.model.add(rig);
    this.resources = new Set();
    this.materials = new Set();
    this.model.traverse(mesh => {
      if (!mesh.isMesh) return;
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(source => {
        const material = source.clone();
        this.resources.add(material);
        this.materials.add(material);
        return material;
      });
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      if (mesh.isSkinnedMesh) {
        this.resources.add(mesh.skeleton);
        // Broad bounds include animated arms; precise skinned triangles still
        // decide hits. An idle-pose box must not reject a later attack pose.
        mesh.geometry.computeBoundingSphere();
        mesh.boundingSphere = mesh.geometry.boundingSphere.clone();
        mesh.boundingSphere.radius *= 2;
        mesh.boundingBox = null;
      }
    });
    this.mixer = new THREE.AnimationMixer(rig);
    this.actions = new Map([...kit.clips].map(([name, clip]) => [name, this.mixer.clipAction(clip)]));
    this.actions.get('Attack').setLoop(THREE.LoopOnce, 1).clampWhenFinished = true;
    this.state = null;
    this.attackRemaining = 0;
    this.flashRemaining = 0;
    this.phase = Math.random();
    this.reset();
    if (isJanitor) this._janitorDetails(rig.getObjectByName('Head'), kit.headBounds);
  }

  _janitorDetails(head, bounds) {
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const blue = new THREE.MeshStandardMaterial({ color: 0x2255aa, roughness: 0.85 });
    const badge = new THREE.MeshStandardMaterial({ color: 0xe2dfcf, roughness: 0.85 });
    this.resources.add(blue);
    this.resources.add(badge);
    this.materials.add(blue);
    this.materials.add(badge);
    const accessory = (name, width, height, depth, x, y, z, material) => {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      this.resources.add(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      head.add(mesh);
    };
    accessory('JanitorBlueCap', size.x + 0.04, 0.13, size.z + 0.04,
      centre.x, bounds.max.y + 0.065, centre.z, blue);
    accessory('JanitorCapBrim', size.x + 0.08, 0.035, size.z * 0.35,
      centre.x, bounds.max.y + 0.017, bounds.max.z + size.z * 0.12, blue);
    accessory('JanitorBadge', 0.24, 0.08, 0.015,
      centre.x, bounds.max.y + 0.075, bounds.max.z + 0.03, badge);
  }

  _play(name, blend = true, restart = false) {
    if (this.state === name && !restart) return;
    const previous = this.actions.get(this.state);
    const next = this.actions.get(name);
    previous?.fadeOut(0.12);
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (name !== 'Attack') next.time = this.phase * next.getClip().duration;
    if (blend && previous) next.fadeIn(0.12);
    this.state = name;
  }

  reset() {
    this.mixer.stopAllAction();
    this.state = null;
    this.phase = Math.random();
    this.attackRemaining = 0;
    this.resetFlash();
    this._play('Idle', false);
    this.mixer.update(0);
    this.model.updateMatrixWorld(true);
  }

  update(dt, moving, speed, climbing = false) {
    this.attackRemaining = Math.max(0, this.attackRemaining - dt);
    const state = this.attackRemaining > 0 ? 'Attack' : climbing ? 'Jump'
      : moving ? speed >= 1.9 ? 'Run' : 'Walk' : 'Idle';
    this._play(state);
    if (state === 'Walk') this.actions.get(state).setEffectiveTimeScale(speed / 1.4);
    if (state === 'Run') this.actions.get(state).setEffectiveTimeScale(speed / 2);
    this.mixer.update(dt);
    this.flashRemaining = Math.max(0, this.flashRemaining - dt);
    if (this.flashRemaining === 0) this.resetFlash();
  }

  attack() {
    this._play('Attack', false, true);
    this.attackRemaining = 0.65;
    this.actions.get('Attack').setEffectiveTimeScale(this.actions.get('Attack').getClip().duration / 0.65);
  }

  flash() {
    this.flashRemaining = 0.12;
    for (const material of this.materials) {
      material.emissive.setHex(0xffffff);
      material.emissiveIntensity = 0.8;
    }
  }

  resetFlash() {
    this.flashRemaining = 0;
    for (const material of this.materials) {
      material.emissive.setHex(0);
      material.emissiveIntensity = 0;
    }
  }

  deactivate() {
    this.mixer.stopAllAction();
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    this.model.removeFromParent();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.materials.clear();
  }
}
