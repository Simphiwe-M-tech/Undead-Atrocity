import * as THREE from 'three';

/**
 * Player - Minecraft-style cubic character with gun.
 * BoxGeometry body parts with procedural walking animation.
 */
export class Player {
  constructor(scene, input, camera) {
    this.scene = scene;
    this.input = input;
    this.camera = camera;

    // --- Config ---
    // Deliberately much faster than a rooftop zombie (~1.1-1.7 u/s) so the
    // player can always disengage and reposition around cover.
    this.moveSpeed = 8;
    this.sprintMultiplier = 1.7;
    this.dodgeSpeed = 18;
    this.dodgeDuration = 0.3;
    this.dodgeCooldown = 0.8;
    this.mouseSensitivity = 0.002;
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.score = 0;
    // Physical capsule footprint used for world collision. A small clearance
    // keeps the visible body from visually clipping into walls.
    this.radius = 0.48;
    this.collisionClearance = 0.12;

    // --- Third-person camera collision ---
    this._cameraRaycaster = new THREE.Raycaster();
    this._cameraEyeHeight = 1.5;
    this._camCollisionMargin = 0.3;
    this._minCameraDistance = 0.6;
    this.wallMeshes = [];

    // --- State ---
    this.yaw = 0;
    this.pitch = 0;
    this.velocity = new THREE.Vector3();
    this.isDodging = false;
    this.dodgeTimer = 0;
    this.dodgeCooldownTimer = 0;
    this.dodgeDirection = new THREE.Vector3();
    this.isFirstPerson = false;
    this.alive = true;
    this.walkCycle = 0;
    this.hasKey = false;

    // --- Build the player group ---
    this.group = new THREE.Group();
    this.group.name = 'Player';

    this._buildModel();
    this._buildGun();

    // Camera holder
    this.cameraHolder = new THREE.Group();
    this.cameraHolder.name = 'CameraHolder';
    this.group.add(this.cameraHolder);

    this.thirdPersonOffset = new THREE.Vector3(0, 2.5, 5);
    this.firstPersonOffset = new THREE.Vector3(0, 1.6, 0);
    this._idealCameraDistance = this.thirdPersonOffset.length();
    this._currentCameraDistance = this._idealCameraDistance;

    this.group.position.set(0, 0, 0);
    scene.add(this.group);

    // Gravity
    this.verticalVelocity = 0;
    this.gravity = -20;
    this.grounded = true;
  }

  _buildModel() {
    const skin = 0xc8a882;
    const shirt = 0x3a7ca5;
    const pants = 0x2a4a6b;

    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 });

    // Head (0.5 x 0.5 x 0.5)
    const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    this.head = new THREE.Mesh(headGeo, skinMat);
    this.head.position.y = 1.95;
    this.head.castShadow = true;
    this.head.receiveShadow = true;
    this.group.add(this.head);

    // Eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const eyeGeo = new THREE.BoxGeometry(0.08, 0.08, 0.05);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.12, 0.05, 0.26);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.12, 0.05, 0.26);
    this.head.add(leftEye, rightEye);

    // Hair
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 });
    const hairGeo = new THREE.BoxGeometry(0.52, 0.15, 0.52);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = 0.28;
    this.head.add(hair);

    // Torso (0.5 x 0.75 x 0.3)
    const torsoGeo = new THREE.BoxGeometry(0.5, 0.75, 0.3);
    this.torso = new THREE.Mesh(torsoGeo, shirtMat);
    this.torso.position.y = 1.3;
    this.torso.castShadow = true;
    this.torso.receiveShadow = true;
    this.group.add(this.torso);

    // Arms (pivot from shoulder)
    const armGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);

    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(-0.35, 1.65, 0);
    const leftArm = new THREE.Mesh(armGeo, skinMat);
    leftArm.position.y = -0.35;
    leftArm.castShadow = true;
    leftArm.receiveShadow = true;
    this.leftArmPivot.add(leftArm);
    this.group.add(this.leftArmPivot);

    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(0.35, 1.65, 0);
    const rightArm = new THREE.Mesh(armGeo, skinMat);
    rightArm.position.y = -0.35;
    rightArm.castShadow = true;
    rightArm.receiveShadow = true;
    this.rightArmPivot.add(rightArm);
    this.group.add(this.rightArmPivot);

    // Legs (pivot from hip)
    const legGeo = new THREE.BoxGeometry(0.22, 0.7, 0.22);

    this.leftLegPivot = new THREE.Group();
    this.leftLegPivot.position.set(-0.14, 0.9, 0);
    const leftLeg = new THREE.Mesh(legGeo, pantsMat);
    leftLeg.position.y = -0.35;
    leftLeg.castShadow = true;
    leftLeg.receiveShadow = true;
    this.leftLegPivot.add(leftLeg);
    this.group.add(this.leftLegPivot);

    this.rightLegPivot = new THREE.Group();
    this.rightLegPivot.position.set(0.14, 0.9, 0);
    const rightLeg = new THREE.Mesh(legGeo, pantsMat);
    rightLeg.position.y = -0.35;
    rightLeg.castShadow = true;
    rightLeg.receiveShadow = true;
    this.rightLegPivot.add(rightLeg);
    this.group.add(this.rightLegPivot);

    this.bodyMesh = this.torso; // reference for visibility toggle
  }

  _buildGun() {
    this.gunGroup = new THREE.Group();

    const gunBarrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, metalness: 0.8 })
    );
    gunBarrel.position.z = -0.25;

    const gunBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.18, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.7 })
    );

    // Gun handle
    const gunHandle = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.14, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 })
    );
    gunHandle.position.set(0, -0.12, 0.04);

    this.gunGroup.add(gunBarrel, gunBody, gunHandle);
    this.gunGroup.position.set(0.4, 1.3, -0.3);
    this.group.add(this.gunGroup);

    // Muzzle flash point
    this.muzzlePoint = new THREE.Object3D();
    this.muzzlePoint.position.set(0, 0, -0.5);
    this.gunGroup.add(this.muzzlePoint);
  }

  /** Supplies the wall meshes used by the third-person camera collision raycast. */
  setCollidableMeshes(wallMeshes) {
    this.wallMeshes = wallMeshes || [];
  }

  getMuzzleWorldPosition() {
    const pos = new THREE.Vector3();
    this.muzzlePoint.getWorldPosition(pos);
    return pos;
  }

  getForwardDirection() {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.group.quaternion);
    return dir.normalize();
  }

  toggleCamera() {
    this.isFirstPerson = !this.isFirstPerson;
    this.head.visible = !this.isFirstPerson;
    this.torso.visible = !this.isFirstPerson;
    this.leftArmPivot.visible = !this.isFirstPerson;
    this.leftLegPivot.visible = !this.isFirstPerson;
    this.rightLegPivot.visible = !this.isFirstPerson;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.alive = false;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  addScore(amount) {
    this.score += amount;
  }

  reset(spawnPoint) {
    this.health = this.maxHealth;
    this.score = 0;
    this.alive = true;
    this.isDodging = false;
    this.dodgeTimer = 0;
    this.dodgeCooldownTimer = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.grounded = true;
    this.hasKey = false;
    this.walkCycle = 0;
    this._currentCameraDistance = this._idealCameraDistance;
    if (spawnPoint) this.group.position.copy(spawnPoint);
  }

  update(dt, obstacles = []) {
    if (!this.alive) return;
    this._lastDt = dt;

    const inp = this.input;

    // ---- Mouse Look ----
    if (inp.pointerLocked) {
      this.yaw -= inp.mouseDeltaX * this.mouseSensitivity;
      this.pitch -= inp.mouseDeltaY * this.mouseSensitivity;
      this.pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, this.pitch));
    }
    inp.flushMouseDelta();

    this.group.rotation.y = this.yaw;
    this.cameraHolder.rotation.x = this.pitch;

    // ---- Movement ----
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    let moveDir = new THREE.Vector3();
    if (inp.isDown('KeyW')) moveDir.add(forward);
    if (inp.isDown('KeyS')) moveDir.sub(forward);
    if (inp.isDown('KeyA')) moveDir.sub(right);
    if (inp.isDown('KeyD')) moveDir.add(right);

    let speed = this.moveSpeed;
    if (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight')) speed *= this.sprintMultiplier;

    // ---- Dodge Roll ----
    if (this.dodgeCooldownTimer > 0) this.dodgeCooldownTimer -= dt;

    if (inp.isDown('Space') && !this.isDodging && this.dodgeCooldownTimer <= 0 && moveDir.length() > 0) {
      this.isDodging = true;
      this.dodgeTimer = this.dodgeDuration;
      this.dodgeDirection.copy(moveDir).normalize();
    }

    if (this.isDodging) {
      this.dodgeTimer -= dt;
      moveDir.copy(this.dodgeDirection);
      speed = this.dodgeSpeed;
      if (this.dodgeTimer <= 0) {
        this.isDodging = false;
        this.dodgeCooldownTimer = this.dodgeCooldown;
      }
    }

    if (moveDir.length() > 0) moveDir.normalize();

    this.velocity.x = moveDir.x * speed;
    this.velocity.z = moveDir.z * speed;

    // Gravity
    this.verticalVelocity += this.gravity * dt;
    this.velocity.y = this.verticalVelocity;

    // Move in small horizontal substeps so sprinting/dodge rolls cannot
    // tunnel through thin walls between frames. This keeps collision feeling
    // physical even when frame time spikes or the player moves quickly.
    const horizontalDistance = Math.hypot(this.velocity.x * dt, this.velocity.z * dt);
    const maxStep = 0.28;
    const moveSteps = Math.max(1, Math.ceil(horizontalDistance / maxStep));
    const stepDt = dt / moveSteps;

    for (let step = 0; step < moveSteps; step++) {
      // Resolve X and Z independently. This prevents corner tunnelling and
      // gives natural wall sliding instead of pushing the player through a
      // neighbouring wall cell.
      this._moveHorizontalAxis('x', this.velocity.x * stepDt, obstacles);
      this._moveHorizontalAxis('z', this.velocity.z * stepDt, obstacles);
    }

    this.group.position.y += this.velocity.y * dt;

    // Ground clamp
    if (this.group.position.y <= 0) {
      this.group.position.y = 0;
      this.verticalVelocity = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // ---- Walking Animation ----
    const isMoving = moveDir.length() > 0.01;
    if (isMoving) {
      this.walkCycle += dt * (speed > this.moveSpeed ? 12 : 8);
    } else {
      this.walkCycle = 0;
    }

    const swing = isMoving ? Math.sin(this.walkCycle) * 0.6 : 0;
    this.leftArmPivot.rotation.x = swing;
    this.rightArmPivot.rotation.x = -swing;
    this.leftLegPivot.rotation.x = -swing;
    this.rightLegPivot.rotation.x = swing;

    // ---- Camera Position (with wall-collision avoidance) ----
    this._updateCameraPosition();
  }

  /**
   * Positions the camera at its ideal third-person offset unless a wall
   * stands between the player and that position. Fires a Raycaster from the
   * player toward the ideal camera spot; if it hits a wall mesh, the camera
   * is pulled in to just in front of the hit point so it can never clip
   * behind geometry (which otherwise reads as the screen going black). The
   * distance smoothly interpolates back out once the obstruction clears.
   */
  _updateCameraPosition() {
    const eyeOrigin = this.group.position.clone().add(new THREE.Vector3(0, this._cameraEyeHeight, 0));

    if (this.isFirstPerson) {
      this.camera.position.copy(this.group.position).add(this.firstPersonOffset);
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      return;
    }

    // Ideal (unobstructed) camera position, orbiting with the player's yaw.
    const idealOffset = this.thirdPersonOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const idealCameraPos = this.group.position.clone().add(idealOffset);

    const toCamera = idealCameraPos.clone().sub(eyeOrigin);
    const idealDistance = Math.max(0.001, toCamera.length());
    const direction = toCamera.clone().normalize();

    let targetDistance = idealDistance;
    if (this.wallMeshes && this.wallMeshes.length > 0) {
      this._cameraRaycaster.set(eyeOrigin, direction);
      this._cameraRaycaster.far = idealDistance;
      this._cameraRaycaster.near = 0.01;
      const hits = this._cameraRaycaster.intersectObjects(this.wallMeshes, false);
      if (hits.length > 0) {
        targetDistance = Math.max(this._minCameraDistance, hits[0].distance - this._camCollisionMargin);
      }
    }

    // Snap in quickly when a wall appears (avoid clipping even for one frame),
    // but ease back out smoothly once the obstruction clears.
    const pullingIn = targetDistance < this._currentCameraDistance;
    const smoothing = pullingIn ? 25 : 6;
    const dt = Math.min(0.05, this._lastDt || 0.016);
    const lerpT = 1 - Math.exp(-smoothing * dt);
    this._currentCameraDistance += (targetDistance - this._currentCameraDistance) * lerpT;

    this.camera.position.copy(eyeOrigin).addScaledVector(direction, this._currentCameraDistance);
    const lookTarget = this.group.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    this.camera.lookAt(lookTarget);
  }

  _moveHorizontalAxis(axis, delta, obstacles) {
    if (Math.abs(delta) < 1e-8) return;

    const otherAxis = axis === 'x' ? 'z' : 'x';
    const proposed = this.group.position[axis] + delta;
    const fixedOther = this.group.position[otherAxis];
    const bodyRadius = this.radius + this.collisionClearance;
    let allowed = proposed;

    for (const obs of obstacles || []) {
      // New Level 1 obstacles expose their real rectangular footprint.
      // Keep support for legacy circular obstacles used by enemy steering.
      if (Number.isFinite(obs.halfX) && Number.isFinite(obs.halfZ)) {
        const halfAxis = axis === 'x' ? obs.halfX : obs.halfZ;
        const halfOther = axis === 'x' ? obs.halfZ : obs.halfX;
        const obsAxis = obs[axis];
        const obsOther = obs[otherAxis];

        if (Math.abs(fixedOther - obsOther) >= halfOther + bodyRadius) continue;

        const min = obsAxis - halfAxis - bodyRadius;
        const max = obsAxis + halfAxis + bodyRadius;
        const current = this.group.position[axis];

        if (delta > 0 && current <= min && allowed > min) allowed = Math.min(allowed, min);
        else if (delta < 0 && current >= max && allowed < max) allowed = Math.max(allowed, max);
        else if (current > min && current < max) {
          // Recovery for a spawn/reload that somehow begins overlapped.
          allowed = Math.abs(current - min) < Math.abs(max - current) ? min : max;
        }
      } else {
        const obsRadius = (obs.radius || 0) + bodyRadius;
        const dx = (axis === 'x' ? allowed : fixedOther) - obs.x;
        const dz = (axis === 'z' ? allowed : fixedOther) - obs.z;
        if (dx * dx + dz * dz < obsRadius * obsRadius) {
          // Reject this axis step. The other axis can still move, producing
          // wall sliding rather than penetration.
          allowed = this.group.position[axis];
        }
      }
    }

    if (allowed !== proposed) this.velocity[axis] = 0;
    this.group.position[axis] = allowed;
  }

  dispose() {
    this.group.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (child.material) child.material.dispose();
      }
    });
    this.scene.remove(this.group);
  }
}
