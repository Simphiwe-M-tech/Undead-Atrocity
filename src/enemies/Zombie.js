import * as THREE from 'three';

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
    this.climbStart = new THREE.Vector3();
    this.climbEnd = new THREE.Vector3();
    this.climbPeakHeight = 2.4;
    this._blockedObstacle = null;

    this.group = new THREE.Group();
    this.group.name = this.isJanitor ? 'JanitorZombie' : 'Zombie';
    this.group.position.copy(position);
    scene.add(this.group);

    this._buildModel();
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
    this.speed = options.speed || (REGULAR_SPEED_MIN + Math.random() * (REGULAR_SPEED_MAX - REGULAR_SPEED_MIN));
    this.walkCycle = Math.random() * Math.PI * 2;

    this.group.position.copy(position);
    this.group.position.y = 0;
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this._resetHitFlash();
  }

  /** Called by ZombiePool.release() - hides the zombie and frees it for reuse. */
  deactivate() {
    this.alive = false;
    this.exploding = false;
    this.group.visible = false;
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
    this._flashHit();
    return { killed: false, exploded: false };
  }

  /** Kills this zombie and requests a pooled explosion effect at its position. */
  explode(explosionPool) {
    if (!this.alive) return;
    this.alive = false;
    this.exploding = false;
    this.group.visible = false;
    if (explosionPool) {
      explosionPool.trigger(this.group.position, this.isJanitor);
    }
  }

  _flashHit() {
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
    this.group.traverse((child) => {
      if (child.isMesh && child.material && child.material.emissive) {
        child.material.emissive.setHex(0x000000);
        child.material.emissiveIntensity = 0;
      }
    });
  }

  _updateWalkAnimation(dt) {
    this.walkCycle += dt * 6;
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
  update(dt, playerPosition, obstacles = []) {
    if (!this.alive || this.exploding) return { hit: false };

    this.damageCooldown = Math.max(0, this.damageCooldown - dt);

    if (this.climbing) {
      this._updateClimb(dt, obstacles);
      this.group.lookAt(playerPosition.x, this.group.position.y, playerPosition.z);
      return { hit: false };
    }

    const playerPos = new THREE.Vector3(playerPosition.x, 0, playerPosition.z);
    const zombiePos = new THREE.Vector3(this.group.position.x, 0, this.group.position.z);
    const dir = new THREE.Vector3().subVectors(playerPos, zombiePos);
    const dist = dir.length();

    if (dist > 1.5) {
      dir.normalize();

      const blocking = this._findBlockingObstacle(dir, obstacles);
      if (blocking && blocking.climbable) {
        this._startClimb(dir, blocking);
        this._updateWalkAnimation(dt);
        this.group.lookAt(playerPosition.x, this.group.position.y, playerPosition.z);
        return { hit: false };
      }

      // Wall-aware steering: check for solid (non-climbable) obstacles ahead
      let moveX = dir.x;
      let moveZ = dir.z;
      if (blocking) {
        const perpX = -moveZ;
        const perpZ = moveX;
        const dot = perpX * dir.x + perpZ * dir.z;
        if (dot >= 0) {
          moveX = perpX * 0.8 + dir.x * 0.2;
          moveZ = perpZ * 0.8 + dir.z * 0.2;
        } else {
          moveX = -perpX * 0.8 + dir.x * 0.2;
          moveZ = -perpZ * 0.8 + dir.z * 0.2;
        }
        const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (len > 0) { moveX /= len; moveZ /= len; }
      }

      this.group.position.x += moveX * this.speed * dt;
      this.group.position.z += moveZ * this.speed * dt;

      if (obstacles.length > 0) this._resolveObstacles(obstacles);

      this.group.lookAt(playerPosition.x, this.group.position.y, playerPosition.z);
      this._updateWalkAnimation(dt);
    } else {
      this.group.lookAt(playerPosition.x, this.group.position.y, playerPosition.z);
    }

    if (dist < 1.5 && this.damageCooldown <= 0) {
      this.damageCooldown = this.damageRate;
      return { hit: true, damage: this.damage };
    }

    return { hit: false };
  }

  /** Finds the first obstacle in the movement direction that would block the zombie. */
  _findBlockingObstacle(dir, obstacles) {
    const aheadX = this.group.position.x + dir.x * CLIMB_LOOK_AHEAD;
    const aheadZ = this.group.position.z + dir.z * CLIMB_LOOK_AHEAD;
    for (const obs of obstacles) {
      const dx = aheadX - obs.x;
      const dz = aheadZ - obs.z;
      const dSq = dx * dx + dz * dz;
      const minR = obs.radius + 0.5;
      if (dSq < minR * minR) return obs;
    }
    return null;
  }

  _startClimb(dir, obstacle) {
    this.climbing = true;
    this.climbTimer = 0;
    this._blockedObstacle = obstacle;
    this.climbStart.copy(this.group.position);
    const crossDistance = obstacle.radius * 2 + 0.8;
    this.climbEnd.set(
      this.group.position.x + dir.x * crossDistance,
      0,
      this.group.position.z + dir.z * crossDistance
    );
    this.climbPeakHeight = (obstacle.height || 2.0) + 0.5;
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

  _resolveObstacles(obstacles) {
    const radius = 0.4;
    for (let pass = 0; pass < 2; pass++) {
      for (const obs of obstacles) {
        if (obs.climbable) continue; // fences are only avoided when not actively climbed
        const dx = this.group.position.x - obs.x;
        const dz = this.group.position.z - obs.z;
        const minDist = obs.radius + radius;
        const distSq = dx * dx + dz * dz;

        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const nx = dist > 1e-5 ? dx / dist : 1;
          const nz = dist > 1e-5 ? dz / dist : 0;
          const overlap = minDist - dist;
          this.group.position.x += nx * overlap;
          this.group.position.z += nz * overlap;
        }
      }
    }
  }

  dispose() {
    this.group.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      }
    });
    this.scene.remove(this.group);
  }
}
