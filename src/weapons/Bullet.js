import * as THREE from 'three';
import { ObjectPool } from '../core/ObjectPool.js';

/**
 * Bullet - Pooled visual tracer for the hitscan rifle.
 *
 * Combat damage is resolved instantly via raycast (see Game._handleShooting),
 * but every shot spawns one of these pooled tracer meshes so the player gets
 * clear visual feedback of the shot path. Bullets never allocate geometry on
 * fire; they are recycled through BulletPool for the lifetime of the level.
 */
export class Bullet {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    const geo = new THREE.CylinderGeometry(0.015, 0.015, 1, 5);
    geo.rotateX(Math.PI / 2); // cylinder length now runs along local -Z
    geo.translate(0, 0, -0.5); // tail at origin, never behind the muzzle
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe082,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);

    this.origin = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.travelDistance = 0;
    this.distanceTraveled = 0;
    this.speed = 140; // fast tracer, units/sec
    this.active = false;
  }

  /** (Re)initializes the tracer for a new shot; called by the pool on acquire(). */
  reset(origin, target) {
    this.origin.copy(origin);
    this.target.copy(target);
    this.direction.subVectors(this.target, this.origin);
    this.travelDistance = Math.max(0.01, this.direction.length());
    this.direction.normalize();
    this.distanceTraveled = 0;
    this.active = true;
    this.group.visible = true;
    this.mesh.material.opacity = 0.9;

    // Short visible streak, oriented along the direction of travel.
    const streakLength = Math.min(2.2, this.travelDistance);
    this.mesh.scale.set(1, 1, streakLength);
    this.group.position.copy(this.origin);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.direction);
  }

  /** Advances the tracer; returns true while still alive. */
  update(dt) {
    if (!this.active) return false;
    const step = this.speed * dt;
    this.distanceTraveled += step;
    const t = Math.min(1, this.distanceTraveled / this.travelDistance);
    const headDistance = Math.min(this.distanceTraveled, this.travelDistance);
    const streakLength = Math.min(2.2, headDistance);
    this.group.position.copy(this.origin).addScaledVector(this.direction, headDistance - streakLength);
    this.mesh.scale.z = streakLength;
    this.mesh.material.opacity = 0.9 * (1 - t);

    if (t >= 1) {
      this.active = false;
      this.group.visible = false;
      return false;
    }
    return true;
  }

  deactivate() {
    this.active = false;
    this.group.visible = false;
  }
}

/**
 * BulletPool - Owns a fixed set of Bullet tracers, wires them into the scene
 * once, and recycles them via ObjectPool. Call `update(dt)` once per frame.
 */
export class BulletPool {
  constructor(scene, maxBullets = 24) {
    this.scene = scene;
    this.pool = new ObjectPool(
      () => {
        const bullet = new Bullet();
        scene.add(bullet.group);
        return bullet;
      },
      (bullet, origin, target) => bullet.reset(origin, target),
      maxBullets
    );
  }

  fire(origin, target) {
    return this.pool.acquire(origin, target);
  }

  update(dt) {
    this.pool.forEachActive((bullet) => {
      if (!bullet.update(dt)) this.pool.release(bullet);
    });
  }

  dispose() {
    this.pool.forEachAll((bullet) => {
      this.scene.remove(bullet.group);
      bullet.mesh.geometry.dispose();
      bullet.mesh.material.dispose();
    });
    this.pool.clear();
  }
}
