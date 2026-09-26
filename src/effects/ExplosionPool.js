import * as THREE from 'three';
import { ObjectPool } from '../core/ObjectPool.js';
import { sfx } from '../audio/ProceduralAudio.js';

const PARTICLES_PER_EXPLOSION = 16;
const EXPLOSION_DURATION = 0.9;

/**
 * ExplosionEffect - One reusable "explosion" unit: a fixed cluster of debris
 * cube meshes plus a point light flash. Every field is mutated in place on
 * `trigger()` instead of allocating new geometry/materials, so an explosion
 * pool of N effects can service an unlimited number of zombie deaths with
 * zero per-explosion GC pressure.
 */
class ExplosionEffect {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.particles = [];
    for (let i = 0; i < PARTICLES_PER_EXPLOSION; i++) {
      const size = 0.08 + Math.random() * 0.15;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.velocity = new THREE.Vector3();
      this.group.add(mesh);
      this.particles.push(mesh);
    }

    this.light = new THREE.PointLight(0xff6600, 0, 10);
    this.group.add(this.light);

    this.timer = 0;
    this.active = false;
  }

  /** Re-arms this effect at `position` using one of the provided palette colours. */
  trigger(position, colors) {
    this.group.position.copy(position);
    this.group.visible = true;
    this.timer = 0;
    this.active = true;
    sfx.playExplosion();
    this.light.intensity = 8;

    for (const particle of this.particles) {
      particle.position.set(0, 0.5 + Math.random() * 1.2, 0);
      particle.material.color.setHex(colors[Math.floor(Math.random() * colors.length)]);
      particle.material.opacity = 1;
      particle.rotation.set(0, 0, 0);

      const angle = Math.random() * Math.PI * 2;
      const upAngle = Math.random() * Math.PI * 0.6;
      const speed = 3 + Math.random() * 6;
      particle.userData.velocity.set(
        Math.cos(angle) * Math.sin(upAngle) * speed,
        Math.cos(upAngle) * speed + 2,
        Math.sin(angle) * Math.sin(upAngle) * speed
      );
      particle.userData.rotSpeed = particle.userData.rotSpeed || new THREE.Vector3();
      particle.userData.rotSpeed.set(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      );
    }
  }

  /** Returns true while still animating. */
  update(dt) {
    if (!this.active) return false;
    this.timer += dt;

    this.light.intensity = Math.max(0, 8 * (1 - this.timer / 0.25));

    for (const particle of this.particles) {
      particle.position.addScaledVector(particle.userData.velocity, dt);
      particle.userData.velocity.y -= 15 * dt;
      particle.rotation.x += particle.userData.rotSpeed.x * dt;
      particle.rotation.y += particle.userData.rotSpeed.y * dt;
      particle.rotation.z += particle.userData.rotSpeed.z * dt;

      if (this.timer > EXPLOSION_DURATION * 0.5) {
        const fadeT = (this.timer - EXPLOSION_DURATION * 0.5) / (EXPLOSION_DURATION * 0.5);
        particle.material.opacity = Math.max(0, 1 - fadeT);
      }
    }

    if (this.timer >= EXPLOSION_DURATION) {
      this.active = false;
      this.group.visible = false;
      return false;
    }
    return true;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const particle of this.particles) {
      particle.geometry.dispose();
      particle.material.dispose();
    }
  }
}

const REGULAR_PALETTE = [0x4a7a3a, 0x2a5a2a, 0x6a9a5a, 0xff4444];
const JANITOR_PALETTE = [0x2255aa, 0x1a3a6a, 0x6a9a5a, 0xffffff];

/**
 * ExplosionPool - Manages a small fixed set of ExplosionEffect instances so
 * simultaneous / chained zombie deaths never allocate new debris geometry.
 */
export class ExplosionPool {
  constructor(scene, maxConcurrent = 8) {
    this.scene = scene;
    this.pool = new ObjectPool(
      () => new ExplosionEffect(scene),
      (effect, position, isJanitor) => effect.trigger(position, isJanitor ? JANITOR_PALETTE : REGULAR_PALETTE),
      maxConcurrent
    );
  }

  /** Triggers a pooled explosion at `position`. */
  trigger(position, isJanitor = false) {
    this.pool.acquire(position, isJanitor);
  }

  update(dt) {
    this.pool.forEachActive((effect) => {
      if (!effect.update(dt)) this.pool.release(effect);
    });
  }

  dispose() {
    this.pool.forEachAll((effect) => effect.dispose());
    this.pool.clear();
  }
}
