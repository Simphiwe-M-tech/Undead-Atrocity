import * as THREE from 'three';
import { clearSegment, segmentEntry } from './PursuitMap.js';
import { sfx } from '../audio/ProceduralAudio.js';

const REGULAR_SPEED_MIN = 1.1;
const REGULAR_SPEED_MAX = 1.7;
const CLIMB_DURATION = 1.1;
const CLIMB_LOOK_AHEAD = 1.6;

/**
 * Zombie - Rooftop horde enemy.
 *
 * Dies from a single successful shot (see `takeDamage`), which detonates it
 * via a pooled ExplosionPool effect (area-of-effect damage / chain
 * reactions are resolved by the level, see Level1.handleZombieKilled).
 *
 * Zombies are slow walkers, but rather than being permanently blocked by the
 * rooftop's chain-link fences they will climb straight over them (see the
 * `climbable` obstacle flag and `_startClimb` / `_updateClimb`).
 *
 * Instances are pool-friendly: `spawn()` / `deactivate()` let a ZombiePool
 * recycle a single built model across many waves instead of constructing and
 * disposing geometry every time, which is the main source of GC stutter in
 * enemy-heavy scenes.
 */
export class Zombie {
  constructor(scene, position, options = {}) {
    this.scene = scene;
    this.isJanitor = options.isJanitor || false;

    this.alive = true;
    this.exploding = false;
    this.speed = 0;
    this.damage = 10;
    this.damageCooldown = 0;
    this.damageRate = 1.0;
    this.hitsRemaining = 1; // single successful shot = kill
    this.walkCycle = Math.random() * Math.PI * 2;
    this.explosionRadius = 2.4; // AoE chain-reaction radius

    // Wall-climbing state
    this.climbing = false;
    this.climbTimer = 0;
    this._pursuitDirection = new THREE.Vector3();
    this._waypoint = new THREE.Vector3();
    this._progressPosition = new THREE.Vector3();
    this.climbStart = new THREE.Vector3();
    this.climbEnd = new THREE.Vector3();
    this.climbPeakHeight = 2.4;
    this._blockedObstacle = null;

    this.group = new THREE.Group();
    this.group.name = this.isJanitor ? 'JanitorZombie' : 'Zombie';
    this.group.position.copy(position);
    scene.add(this.group);

    if (options.modelLibrary) {
      this.kitModel = options.modelLibrary.create(this.isJanitor, options.modelVariant);
      this.group.add(this.kitModel.model);
    } else this._buildModel();
    this.spawn(position, options);
  }

  /** (Re)activates this zombie instance for pooled reuse across waves. */
  spawn(position, options = {}) {
    this.alive = true;
    this.exploding = false;
    this.hitsRemaining = 1;
    this.damageCooldown = 0;
    this.climbing = false;
    this.climbTimer = 0;
    this._blockedObstacle = null;
    this.gaitRate = 4.8 + Math.random() * 2.4;
    this.steerSide = Math.random() < 0.5 ? -1 : 1;
    this.speed = options.speed ?? (REGULAR_SPEED_MIN + Math.random() * (REGULAR_SPEED_MAX - REGULAR_SPEED_MIN));
    this.walkCycle = Math.random() * Math.PI * 2;

    this.group.position.copy(position);
    this.group.position.y = 0;
    this._progressPosition.copy(position);
    this.progressTimer = 0;
    this.stuckRecoveries = 0;
    this.routeTimer = 0;
    this.recoveryTimer = 0;
    this.recoveryX = 0; this.recoveryZ = 0;
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.kitModel?.reset();
    this._resetHitFlash();
  }

  /** Called by ZombiePool.release() - hides the zombie and frees it for reuse. */
  deactivate() {
    this.alive = false;
    this.exploding = false;
    this.group.visible = false;
    this.kitModel?.deactivate();
  }

  _buildModel() {
    const zombieGreen = 0x4a7a3a;
    const darkGreen = 0x2a5a2a;
    const eyeRed = 0xff0000;

    if (this.isJanitor) {
      this._buildJanitorModel(zombieGreen, darkGreen, eyeRed);
    } else {
      this._buildRegularModel(zombieGreen, darkGreen, eyeRed);
    }
  }

  _buildRegularModel(zombieGreen, darkGreen, eyeRed) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: zombieGreen, roughness: 0.9 });
    const darkMat = new THREE.MeshStandardMaterial({ color: darkGreen, roughness: 0.9 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x6a9a5a, roughness: 0.8 });

    // Head
    const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    this.head = new THREE.Mesh(headGeo, skinMat);
    this.head.position.y = 1.95;
    this.head.castShadow = true;
    this.head.receiveShadow = true;
    this.group.add(this.head);

    // Eyes (red glowing)
    const eyeMat = new THREE.MeshStandardMaterial({
      color: eyeRed, emissive: eyeRed, emissiveIntensity: 2.0
    });
    const eyeGeo = new THREE.BoxGeometry(0.1, 0.08, 0.05);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.12, 0.05, 0.26);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.12, 0.05, 0.26);
    this.head.add(leftEye, rightEye);

    // Mouth
    const mouthGeo = new THREE.BoxGeometry(0.2, 0.06, 0.05);
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x2a0a0a });
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.position.set(0, -0.12, 0.26);
    this.head.add(mouth);

    // Torso
    const torsoGeo = new THREE.BoxGeometry(0.5, 0.75, 0.3);
    this.torso = new THREE.Mesh(torsoGeo, bodyMat);
    this.torso.position.y = 1.3;
    this.torso.castShadow = true;
    this.torso.receiveShadow = true;
    this.group.add(this.torso);

    // Arms (outstretched zombie style)
    const armGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);

    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(-0.35, 1.65, 0);
    this.leftArmPivot.rotation.x = -Math.PI / 3; // outstretched
    const leftArm = new THREE.Mesh(armGeo, skinMat);
    leftArm.position.y = -0.35;
    leftArm.castShadow = true;
    leftArm.receiveShadow = true;
    this.leftArmPivot.add(leftArm);
    this.group.add(this.leftArmPivot);

    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(0.35, 1.65, 0);
    this.rightArmPivot.rotation.x = -Math.PI / 3;
    const rightArm = new THREE.Mesh(armGeo, skinMat);
    rightArm.position.y = -0.35;
    rightArm.castShadow = true;
    rightArm.receiveShadow = true;
    this.rightArmPivot.add(rightArm);
    this.group.add(this.rightArmPivot);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.22, 0.7, 0.22);

    this.leftLegPivot = new THREE.Group();
    this.leftLegPivot.position.set(-0.14, 0.9, 0);
    const leftLeg = new THREE.Mesh(legGeo, darkMat);
    leftLeg.position.y = -0.35;
    leftLeg.castShadow = true;
    leftLeg.receiveShadow = true;
    this.leftLegPivot.add(leftLeg);
    this.group.add(this.leftLegPivot);

    this.rightLegPivot = new THREE.Group();
    this.rightLegPivot.position.set(0.14, 0.9, 0);
    const rightLeg = new THREE.Mesh(legGeo, darkMat);
    rightLeg.position.y = -0.35;
    rightLeg.castShadow = true;
    rightLeg.receiveShadow = true;
    this.rightLegPivot.add(rightLeg);
    this.group.add(this.rightLegPivot);
  }

  _buildJanitorModel(zombieGreen, darkGreen, eyeRed) {
    // Janitor wears blue overalls
    const overallMat = new THREE.MeshStandardMaterial({ color: 0x2255aa, roughness: 0.8 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x6a9a5a, roughness: 0.8 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a3a6a, roughness: 0.9 });

    // Head
    const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    this.head = new THREE.Mesh(headGeo, skinMat);
    this.head.position.y = 1.95;
    this.head.castShadow = true;
    this.group.add(this.head);

    // Eyes
    const eyeMat = new THREE.MeshStandardMaterial({
      color: eyeRed, emissive: eyeRed, emissiveIntensity: 2.0
    });
    const eyeGeo = new THREE.BoxGeometry(0.1, 0.08, 0.05);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.12, 0.05, 0.26);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.12, 0.05, 0.26);
    this.head.add(leftEye, rightEye);

    // Janitor cap
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2255aa, roughness: 0.7 });
    const capGeo = new THREE.BoxGeometry(0.52, 0.12, 0.52);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 0.28;
    this.head.add(cap);
    const capBrimGeo = new THREE.BoxGeometry(0.56, 0.04, 0.2);
    const capBrim = new THREE.Mesh(capBrimGeo, capMat);
    capBrim.position.set(0, 0.22, 0.2);
    this.head.add(capBrim);

    // Torso (overalls)
    const torsoGeo = new THREE.BoxGeometry(0.5, 0.75, 0.3);
    this.torso = new THREE.Mesh(torsoGeo, overallMat);
    this.torso.position.y = 1.3;
    this.torso.castShadow = true;
    this.torso.receiveShadow = true;
    this.group.add(this.torso);

    // Name badge
    const badgeGeo = new THREE.BoxGeometry(0.15, 0.08, 0.02);
    const badgeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const badge = new THREE.Mesh(badgeGeo, badgeMat);
    badge.position.set(0.12, 0.2, 0.16);
    this.torso.add(badge);

    // Arms
    const armGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);

    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(-0.35, 1.65, 0);
    this.leftArmPivot.rotation.x = -Math.PI / 3;
    const leftArm = new THREE.Mesh(armGeo, overallMat);
    leftArm.position.y = -0.35;
    leftArm.castShadow = true;
    leftArm.receiveShadow = true;
    this.leftArmPivot.add(leftArm);
    this.group.add(this.leftArmPivot);

    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(0.35, 1.65, 0);
    this.rightArmPivot.rotation.x = -Math.PI / 3;
    const rightArm = new THREE.Mesh(armGeo, overallMat);
    rightArm.position.y = -0.35;
    rightArm.castShadow = true;
    rightArm.receiveShadow = true;
    this.rightArmPivot.add(rightArm);
    this.group.add(this.rightArmPivot);

    // Legs (overalls)
    const legGeo = new THREE.BoxGeometry(0.22, 0.7, 0.22);

    this.leftLegPivot = new THREE.Group();
    this.leftLegPivot.position.set(-0.14, 0.9, 0);
    const leftLeg = new THREE.Mesh(legGeo, darkMat);
    leftLeg.position.y = -0.35;
    leftLeg.castShadow = true;
    leftLeg.receiveShadow = true;
    this.leftLegPivot.add(leftLeg);
    this.group.add(this.leftLegPivot);

    this.rightLegPivot = new THREE.Group();
    this.rightLegPivot.position.set(0.14, 0.9, 0);
    const rightLeg = new THREE.Mesh(legGeo, darkMat);
    rightLeg.position.y = -0.35;
    rightLeg.castShadow = true;
    rightLeg.receiveShadow = true;
    this.rightLegPivot.add(rightLeg);
    this.group.add(this.rightLegPivot);
  }

  /** @param {import('../effects/ExplosionPool.js').ExplosionPool} explosionPool */
  takeDamage(explosionPool) {
    if (!this.alive || this.exploding) return { killed: false, exploded: false };

    this.hitsRemaining--;
    if (this.hitsRemaining <= 0) {
      this.explode(explosionPool);
      return { killed: true, exploded: true };
    }
    
    sfx.playZombieHit();
    this._flashHit();
    return { killed: false, exploded: false };
  }

  /** Kills this zombie and requests a pooled explosion effect at its position. */
  explode(explosionPool) {
    if (!this.alive) return;
    this.alive = false;
    this.exploding = false;
    
    sfx.playZombieDeath();
    this.group.visible = false;
    if (explosionPool) {
      explosionPool.trigger(this.group.position, this.isJanitor);
    }
  }

  _flashHit() {
    if (this.kitModel) return this.kitModel.flash();
    this.group.traverse((child) => {
      if (child.isMesh && child.material && child.material.emissive) {
        child.material.emissive.setHex(0xffffff);
        child.material.emissiveIntensity = 0.8;
        setTimeout(() => {
          if (child.material && child.material.emissive) {
            child.material.emissive.setHex(0x000000);
            child.material.emissiveIntensity = 0;
          }
        }, 120);
      }
    });
  }

  _resetHitFlash() {
    if (this.kitModel) return this.kitModel.resetFlash();
    this.group.traverse((child) => {
      if (child.isMesh && child.material && child.material.emissive) {
        child.material.emissive.setHex(0x000000);
        child.material.emissiveIntensity = 0;
      }
    });
  }

  _updateWalkAnimation(dt) {
    if (this.kitModel) return;
    this.walkCycle += dt * this.gaitRate;
    const swing = Math.sin(this.walkCycle) * 0.5;
    if (this.leftArmPivot) {
      this.leftArmPivot.rotation.x = -Math.PI / 3 + swing * 0.2;
      this.leftArmPivot.rotation.z = swing * 0.1;
    }
    if (this.rightArmPivot) {
      this.rightArmPivot.rotation.x = -Math.PI / 3 - swing * 0.2;
      this.rightArmPivot.rotation.z = -swing * 0.1;
    }
    if (this.leftLegPivot) this.leftLegPivot.rotation.x = swing;
    if (this.rightLegPivot) this.rightLegPivot.rotation.x = -swing;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} playerPosition
   * @param {Array<{x:number,z:number,radius:number,climbable?:boolean,height?:number}>} obstacles
   */
  update(dt, playerPosition, obstacles = [], navigation = null, neighbours = []) {
    if (!this.alive || this.exploding) return { hit: false };

    this.damageCooldown = Math.max(0, this.damageCooldown - dt);
    const startX = this.group.position.x, startZ = this.group.position.z;

    if (this.climbing) {
      this._updateClimb(dt, obstacles);
      this._progressPosition.copy(this.group.position);
      this.progressTimer = 0;
      this.group.lookAt(playerPosition.x, this.group.position.y, playerPosition.z);
      this.kitModel?.update(dt, true, this.speed, true);
      return { hit: false };
    }

    const dir = this._pursuitDirection.set(playerPosition.x - this.group.position.x, 0, playerPosition.z - this.group.position.z);
    const dist = dir.length();

    const contactClear = clearSegment(this.group.position.x, this.group.position.z, playerPosition.x, playerPosition.z, obstacles, 0.1);
    if (dist > 1.35 || !contactClear) {
      this.routeTimer -= dt;
      if (this.routeTimer <= 0) {
        this._waypoint.copy(playerPosition);
        navigation?.waypoint(this.group.position, playerPosition, this._waypoint, this.steerSide);
        this.routeTimer = 0.2;
      }
      dir.set(this._waypoint.x - this.group.position.x, 0, this._waypoint.z - this.group.position.z).normalize();
      if (dir.lengthSq() === 0) this.routeTimer = 0;

      // Soft separation spreads the horde, but keeps explosion-sized clusters.
      let pushX = 0, pushZ = 0;
      for (const other of neighbours) {
        if (other === this || !other.alive || other.climbing) continue;
        const dx = this.group.position.x - other.group.position.x;
        const dz = this.group.position.z - other.group.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.001 && d2 < 0.81) {
          pushX += dx * (0.81 - d2); pushZ += dz * (0.81 - d2);
        }
      }
      dir.x += Math.max(-0.35, Math.min(0.35, pushX));
      dir.z += Math.max(-0.35, Math.min(0.35, pushZ));
      dir.normalize();

      const blocking = this._findBlockingObstacle(dir, obstacles);
      if (blocking?.climbable && this._startClimb(dir, blocking, obstacles)) {
        this._updateWalkAnimation(dt);
        this.kitModel?.update(dt, true, this.speed, true);
        return { hit: false };
      }
      if (this.recoveryTimer > 0) {
        this.recoveryTimer -= dt;
        dir.set(this.recoveryX, 0, this.recoveryZ);
      } else if (blocking && !blocking.climbable) {
        this._chooseAvoidance(dir, obstacles);
      }

      // Substeps and rectangular footprints prevent tunnelling and circular
      // push-outs that used to jam enemies between adjacent wall cells.
      const steps = Math.max(1, Math.ceil(this.speed * dt / 0.2));
      for (let step = 0; step < steps; step++) {
        this._moveAxis('x', dir.x * this.speed * dt / steps, obstacles);
        this._moveAxis('z', dir.z * this.speed * dt / steps, obstacles);
      }
      this.progressTimer += dt;
      if (this.progressTimer >= 1.2) {
        if (this.group.position.distanceToSquared(this._progressPosition) < 0.0625) {
          this.steerSide *= -1;
          this.routeTimer = 0;
          this.stuckRecoveries++;
          this._chooseAvoidance(dir, obstacles, true);
          this.recoveryX = dir.x; this.recoveryZ = dir.z;
          this.recoveryTimer = 0.6;
        }
        this._progressPosition.copy(this.group.position);
        this.progressTimer = 0;
      }
      this._updateWalkAnimation(dt);
    } else {
      this.progressTimer = 0;
      this._progressPosition.copy(this.group.position);
    }
    this.group.lookAt(playerPosition.x, this.group.position.y, playerPosition.z);
    this.kitModel?.update(dt, Math.hypot(this.group.position.x - startX, this.group.position.z - startZ) > 0.0001, this.speed);

    if (dist < 1.5 && contactClear && this.damageCooldown <= 0) {
      this.damageCooldown = this.damageRate;
      if (this.kitModel) this.kitModel.attack();
      else {
        this.leftArmPivot.rotation.x = -Math.PI / 1.8;
        this.rightArmPivot.rotation.x = -Math.PI / 1.8;
      }
      return { hit: true, damage: this.damage };
    }

    return { hit: false };
  }

  _chooseAvoidance(dir, obstacles, recovering = false) {
    const originalX = dir.x, originalZ = dir.z;
    // Keep a side until progress detection asks for a new one.
    for (let i = recovering ? 2 : 1; i <= 6; i++) {
      const angle = this.steerSide * i * Math.PI / 4;
      const x = originalX * Math.cos(angle) - originalZ * Math.sin(angle);
      const z = originalX * Math.sin(angle) + originalZ * Math.cos(angle);
      if (clearSegment(this.group.position.x, this.group.position.z,
        this.group.position.x + x, this.group.position.z + z, obstacles)) {
        dir.set(x, 0, z); return;
      }
    }
    dir.set(0, 0, 0);
  }

  _findBlockingObstacle(dir, obstacles) {
    let nearest = Infinity, result = null;
    const ahead = Math.min(CLIMB_LOOK_AHEAD, this.group.position.distanceTo(this._waypoint));
    for (const obs of obstacles) {
      const entry = segmentEntry(this.group.position.x, this.group.position.z,
        this.group.position.x + dir.x * ahead,
        this.group.position.z + dir.z * ahead, obs);
      if (entry < nearest) { nearest = entry; result = obs; }
    }
    return result;
  }

  _startClimb(dir, obstacle, obstacles) {
    const hx = (obstacle.halfX ?? obstacle.radius) + 0.5;
    const hz = (obstacle.halfZ ?? obstacle.radius) + 0.5;
    const exitX = Math.abs(dir.x) > 0.001 ? (obstacle.x + Math.sign(dir.x) * hx - this.group.position.x) / dir.x : Infinity;
    const exitZ = Math.abs(dir.z) > 0.001 ? (obstacle.z + Math.sign(dir.z) * hz - this.group.position.z) / dir.z : Infinity;
    const distance = Math.min(exitX, exitZ) + 0.15;
    const x = this.group.position.x + dir.x * distance;
    const z = this.group.position.z + dir.z * distance;
    // Never climb through a solid wall behind/alongside a fence.
    if (distance <= 0 || !Number.isFinite(distance) || !clearSegment(this.group.position.x, this.group.position.z, x, z, obstacles)) return false;
    this.climbing = true; this.climbTimer = 0;
    this._blockedObstacle = obstacle;
    this.climbStart.copy(this.group.position);
    this.climbEnd.set(x, 0, z);
    this.climbPeakHeight = (obstacle.height || 2.0) + 0.5;
    this.routeTimer = 0;
    return true;
  }

  _updateClimb(dt) {
    this.climbTimer += dt;
    const t = Math.min(1, this.climbTimer / CLIMB_DURATION);

    this.group.position.x = this.climbStart.x + (this.climbEnd.x - this.climbStart.x) * t;
    this.group.position.z = this.climbStart.z + (this.climbEnd.z - this.climbStart.z) * t;
    this.group.position.y = Math.sin(t * Math.PI) * this.climbPeakHeight;

    // Exaggerated clambering animation - arms hauling the body up and over.
    const climbSwing = Math.sin(t * Math.PI * 2) * 0.6;
    if (this.leftArmPivot) this.leftArmPivot.rotation.x = -Math.PI / 1.6 + climbSwing * 0.3;
    if (this.rightArmPivot) this.rightArmPivot.rotation.x = -Math.PI / 1.6 - climbSwing * 0.3;
    if (this.leftLegPivot) this.leftLegPivot.rotation.x = climbSwing;
    if (this.rightLegPivot) this.rightLegPivot.rotation.x = -climbSwing;

    if (t >= 1) {
      this.climbing = false;
      this.climbTimer = 0;
      this._blockedObstacle = null;
      this.group.position.y = 0;
    }
  }

  _moveAxis(axis, delta, obstacles) {
    if (!delta) return;
    const other = axis === 'x' ? 'z' : 'x';
    const current = this.group.position[axis];
    let next = current + delta;
    for (const obs of obstacles) {
      if (obs.climbable) continue;
      const half = (axis === 'x' ? obs.halfX : obs.halfZ) ?? obs.radius;
      const otherHalf = (axis === 'x' ? obs.halfZ : obs.halfX) ?? obs.radius;
      if (Math.abs(this.group.position[other] - obs[other]) >= otherHalf + 0.4) continue;
      const min = obs[axis] - half - 0.4, max = obs[axis] + half + 0.4;
      if (delta > 0 && current <= min && next > min) next = Math.min(next, min);
      else if (delta < 0 && current >= max && next < max) next = Math.max(next, max);
      else if (current > min && current < max) next = current;
    }
    this.group.position[axis] = next;
  }

  dispose() {
    this.kitModel?.dispose();
    this.group.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      }
    });
    this.scene.remove(this.group);
  }
}
