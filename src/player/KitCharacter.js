import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Original Cube World male model, atlas and skeletal movement animations. */
export class KitCharacter {
  static async load(loader = new GLTFLoader()) {
    const gltf = await loader.loadAsync(`${import.meta.env?.BASE_URL ?? './'}assets/cube-world/Character_Male_1.gltf`);
    return new KitCharacter(gltf);
  }

  constructor(gltf) {
    this.model = new THREE.Group();
    this.model.name = 'CubeWorldMalePlayer';
    this.model.userData.kitAsset = 'Character_Male_1';
    // The kit faces +Z; player movement and the pistol face -Z.
    this.model.rotation.y = Math.PI;
    this.model.add(gltf.scene);
    this.resources = new Set();
    this.model.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      // Animated limbs can extend outside the exported rest-pose bounds.
      node.frustumCulled = false;
      this.resources.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        material.roughness = 0.82;
        this.resources.add(material);
        if (material.map) this.resources.add(material.map);
      }
      if (node.isSkinnedMesh) this.resources.add(node.skeleton);
    });

    this.mixer = new THREE.AnimationMixer(gltf.scene);
    this.actions = new Map();
    for (const [state, name] of [['idle', 'Idle_Hold'], ['walk', 'Walk_Hold'], ['run', 'Run_Hold']]) {
      const clip = gltf.animations.find(animation => animation.name === name);
      if (!clip) throw new Error(`Cube World player is missing ${name}`);
      this.actions.set(state, this.mixer.clipAction(clip));
    }
    this.state = null;
    this._setAnimation('idle', false);
    this.mixer.update(0);
    this.model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.model, true);
    const scale = 2.2 / (bounds.max.y - bounds.min.y);
    const centre = bounds.getCenter(new THREE.Vector3());
    this.model.scale.setScalar(scale);
    this.model.position.set(-centre.x * scale, -bounds.min.y * scale, -centre.z * scale);
    this.model.updateMatrixWorld(true);

    this.upperArm = gltf.scene.getObjectByName('UpperArmR');
    this.lowerArm = gltf.scene.getObjectByName('LowerArmR');
    this.hand = gltf.scene.getObjectByName('FistR');
    if (!this.upperArm || !this.lowerArm || !this.hand) throw new Error('Cube World player is missing the right arm rig');
    this._shoulder = new THREE.Vector3();
    this._elbow = new THREE.Vector3();
    this._wrist = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._bend = new THREE.Vector3();
    this._desiredElbow = new THREE.Vector3();
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._rotation = new THREE.Quaternion();
    this._worldRotation = new THREE.Quaternion();
    this._parentRotation = new THREE.Quaternion();
  }

  _setAnimation(state, blend = true) {
    if (this.state === state) return;
    const previous = this.actions.get(this.state);
    const next = this.actions.get(state);
    previous?.fadeOut(0.15);
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (blend && previous) next.fadeIn(0.15);
    this.state = state;
  }

  update(dt, moving, fast = false, dodging = false) {
    this._setAnimation(moving ? fast || dodging ? 'run' : 'walk' : 'idle');
    this.actions.get(this.state).setEffectiveTimeScale(dodging ? 1.6 : 1);
    this.mixer.update(dt);
  }

  getShoulderPosition(target) {
    return this.upperArm.getWorldPosition(target);
  }

  poseRightArm(grip) {
    this.model.updateWorldMatrix(true, false);
    this.model.updateMatrixWorld(true);
    this.upperArm.getWorldPosition(this._shoulder);
    this.lowerArm.getWorldPosition(this._elbow);
    this.hand.getWorldPosition(this._wrist);
    grip.getWorldPosition(this._target);
    // The wrist is just behind the palm; the grip sits inside the kit fist.
    this._direction.subVectors(this._target, this._shoulder).normalize();
    this._target.addScaledVector(this._direction, -0.1);
    const upperLength = this._shoulder.distanceTo(this._elbow);
    const lowerLength = this._elbow.distanceTo(this._wrist);
    const distance = THREE.MathUtils.clamp(this._shoulder.distanceTo(this._target),
      Math.abs(upperLength - lowerLength) + 0.001, upperLength + lowerLength - 0.001);
    this._target.copy(this._shoulder).addScaledVector(this._direction, distance);
    const along = (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    this._bend.set(0, -1, 0).addScaledVector(this._direction, this._direction.y);
    if (this._bend.lengthSq() < 0.001) {
      this._bend.set(1, 0, 0).applyQuaternion(this.model.getWorldQuaternion(this._worldRotation));
      this._bend.addScaledVector(this._direction, -this._bend.dot(this._direction));
    }
    this._bend.normalize();
    this._desiredElbow.copy(this._shoulder).addScaledVector(this._direction, along).addScaledVector(this._bend, bend);
    this._rotateToward(this.upperArm, this._shoulder, this._elbow, this._desiredElbow);
    this.lowerArm.getWorldPosition(this._elbow);
    this.hand.getWorldPosition(this._wrist);
    this._rotateToward(this.lowerArm, this._elbow, this._wrist, this._target);
  }

  _rotateToward(bone, origin, currentEnd, desiredEnd) {
    this._from.subVectors(currentEnd, origin).normalize();
    this._to.subVectors(desiredEnd, origin).normalize();
    this._rotation.setFromUnitVectors(this._from, this._to);
    bone.getWorldQuaternion(this._worldRotation);
    this._worldRotation.premultiply(this._rotation);
    bone.parent.getWorldQuaternion(this._parentRotation).invert();
    bone.quaternion.copy(this._parentRotation.multiply(this._worldRotation));
    bone.updateWorldMatrix(false, true);
  }

  reset() {
    this.mixer.stopAllAction();
    this.state = null;
    this._setAnimation('idle', false);
    this.mixer.update(0);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    this.model.removeFromParent();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }
}
