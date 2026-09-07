import * as THREE from 'three';
import { Zombie } from '../enemies/Zombie.js';
import { ZombiePool } from '../enemies/ZombiePool.js';
import { ExplosionPool } from '../effects/ExplosionPool.js';
import {
  loadTarConcreteMaterial,
  loadBrickMaterial,
  loadNightSkybox,
  createChainLinkMaterial
} from '../utils/ProceduralTextures.js';

/**
 * Level1 - "The Rooftop"
 *
 * A university residence rooftop at night (Knockando-Halls-style), enclosed
 * by a low parapet. The interior maze is no longer solid dungeon stone - it
 * is a mix of climbable chain-link fence partitions and rooftop clutter
 * (air-conditioning units, ventilation shafts) that block movement but are
 * not climbable. Zombies spawn in escalating waves; find and kill the
 * Janitor Zombie for the key, then reach the rooftop exit.
 *
 * Maze legend:
 *  '#' = interior partition (fence) or rooftop plant (AC unit / vent shaft)
 *        on the border it becomes the low perimeter parapet
 *  '.' = open roof deck
 *  'P' = player spawn
 *  'E' = exit (stairwell door)
 *  'Z' = zombie wave spawn point
 *  'J' = Janitor Zombie spawn
 *  'C' = rooftop skylight / vent grate marker
 */
export class Level1 {
  constructor(scene) {
    this.scene = scene;
    this.disposables = [];
    this.obstacles = [];
    this.wallMeshes = [];
    this.sceneExtras = []; // top-level Object3Ds (parapet caps, AC/vent groups) added directly to the scene
    this.keyMesh = null;
    this.keyCollected = false;
    this.exitDoor = null;
    this.exitDoorPosition = null;
    this.levelComplete = false;
    this.janitorZombie = null;
    this.cellSize = 2; // each maze cell is 2x2 world units
    this.maze = null;
    this.mazeWidth = 0;
    this.mazeHeight = 0;

    this.zombiePool = null;
    this.explosionPool = null;
    this.zombies = []; // rebuilt every update() - active pooled zombies + the janitor

    this.regularSpawnPoints = [];

    // ---- Wave state ----
    this.waveIndex = 0;
    this.waveState = 'spawning'; // 'spawning' | 'gap'
    this.waveSpawnRemaining = 0;
    this.waveSpawnTimer = 0;
    this.currentWaveInterval = 1.2;
    this.gapTimer = 0;
  }

  async load(onProgress) {
    await this._createLighting();
    onProgress && onProgress(0.15);

    await this._buildMaze();
    onProgress && onProgress(0.4);

    await this._createGround();
    onProgress && onProgress(0.6);

    this._setupZombies();
    onProgress && onProgress(0.85);

    this._createExitDoor();
    onProgress && onProgress(1.0);
  }

  get spawnPoint() {
    // Player spawn at 'P' position in maze (row 1, col 1)
    return this._cellToWorld(1, 1);
  }

  get title() {
    return 'The Rooftop - Survive, Find the Janitor\'s Key, Escape';
  }

  // =================== MAZE LAYOUT ===================
  // 29 wide x 19 tall rooftop, bordered by a parapet
  _getMazeData() {
    return [
      '#############################',
      '#P..........#...............#',
      '#.#####.###.#.###.#####.###.#',
      '#.#.....#.#...#.#...#...#...#',
      '#.#.###.#.#####.###.#.#.#.#.#',
      '#.#...#.#.......C...#.#.#.#.#',
      '#.###.#.#########.###.#.#.#.#',
      '#.....#...........#.......#.#',
      '#.###########.###.#########.#',
      '#.#.........#.#Z#.........#.#',
      '#.#.#######.#.#.#.#######.#.#',
      '#.#.#.....#.#...#.#.....#.#.#',
      '#.#.#.###.#.#####.#.###.#...#',
      '#...#...#.#.......#...#.#.#.#',
      '###.###.#.#########.#.#.#.#.#',
      '#J......#.....C.....#.......E',
      '#.#####.#####.#####.#######.#',
      '#.Z.....#..................Z#',
      '#############################',
    ];
  }

  _cellToWorld(col, row) {
    const offsetX = -(this.mazeWidth * this.cellSize) / 2;
    const offsetZ = -(this.mazeHeight * this.cellSize) / 2;
    return new THREE.Vector3(
      offsetX + col * this.cellSize + this.cellSize / 2,
      0,
      offsetZ + row * this.cellSize + this.cellSize / 2
    );
  }

  // =================== ROOFTOP GEOMETRY ===================
  async _buildMaze() {
    this.maze = this._getMazeData();
    this.mazeHeight = this.maze.length;
    this.mazeWidth = this.maze[0].length;
    const cs = this.cellSize;

    const parapetHeight = 1.0;
    const fenceHeight = 2.0;
    const acHeight = 0.75;
    const ventHeight = 1.3;

    // ---- Shared geometries / materials (built once, instanced per cell) ----
    const parapetGeo = new THREE.BoxGeometry(cs, parapetHeight, cs);
    // Brick parapet walls - tries a real relative, case-sensitive asset path
    // first (./assets/textures/brick/...) and falls back to a procedural
    // brick + normal map so the rooftop never renders with flat plain colour.
    const parapetMat = await loadBrickMaterial(1);
    const parapetCapGeo = new THREE.BoxGeometry(cs * 1.02, 0.12, cs * 1.02);
    const parapetCapMat = new THREE.MeshStandardMaterial({ color: 0x8a8a80, roughness: 0.7, metalness: 0.05 });

    const fenceGeo = new THREE.BoxGeometry(cs, fenceHeight, cs);
    const fenceMat = createChainLinkMaterial(2);

    // Templates are never added to the scene themselves - only their clones
    // are - so their geometries/materials are the single shared instances
    // reused by every AC-unit / vent-shaft placed in the maze.
    const acTemplate = this._createACUnitTemplate(cs, acHeight);
    const ventTemplate = this._createVentShaftTemplate(cs, ventHeight);
    acTemplate.traverse((child) => { if (child.isMesh) this.disposables.push(child.geometry, child.material); });
    ventTemplate.traverse((child) => { if (child.isMesh) this.disposables.push(child.geometry, child.material); });

    this.disposables.push(parapetGeo, parapetMat, parapetCapGeo, parapetCapMat, fenceGeo, fenceMat);

    for (let row = 0; row < this.mazeHeight; row++) {
      for (let col = 0; col < this.mazeWidth; col++) {
        const cell = this.maze[row][col];
        const worldPos = this._cellToWorld(col, row);
        const isBorder = row === 0 || row === this.mazeHeight - 1 || col === 0 || col === this.mazeWidth - 1;

        if (cell === '#') {
          if (isBorder) {
            // Low rooftop parapet - solid, not climbable (it's the roof edge).
            const wall = new THREE.Mesh(parapetGeo, parapetMat);
            wall.position.set(worldPos.x, parapetHeight / 2, worldPos.z);
            wall.castShadow = true;
            wall.receiveShadow = true;
            this.scene.add(wall);
            this.wallMeshes.push(wall);

            const cap = new THREE.Mesh(parapetCapGeo, parapetCapMat);
            cap.position.set(worldPos.x, parapetHeight + 0.06, worldPos.z);
            cap.receiveShadow = true;
            this.scene.add(cap);
            this.sceneExtras.push(cap);

            this.obstacles.push({ x: worldPos.x, z: worldPos.z, radius: cs / 2 + 0.1, climbable: false, height: parapetHeight });
            continue;
          }

          // Interior partitions: deterministic mix of fence / AC unit / vent shaft.
          const hashVal = (row * 7 + col * 13) % 5;

          if (hashVal <= 2) {
            // Chain-link fence - zombies climb over it, player is still blocked.
            const fence = new THREE.Mesh(fenceGeo, fenceMat);
            fence.position.set(worldPos.x, fenceHeight / 2, worldPos.z);
            fence.castShadow = false;
            fence.receiveShadow = true;
            this.scene.add(fence);
            this.wallMeshes.push(fence);
            this.obstacles.push({ x: worldPos.x, z: worldPos.z, radius: cs / 2 + 0.05, climbable: true, height: fenceHeight });
          } else if (hashVal === 3) {
            // Air-conditioning unit - solid clutter, not climbable.
            const ac = acTemplate.clone(true);
            ac.position.set(worldPos.x, 0, worldPos.z);
            ac.rotation.y = ((row + col) % 4) * (Math.PI / 2);
            this.scene.add(ac);
            this.sceneExtras.push(ac);
            ac.traverse((child) => { if (child.isMesh) this.wallMeshes.push(child); });
            this.obstacles.push({ x: worldPos.x, z: worldPos.z, radius: cs * 0.42, climbable: false, height: acHeight });
          } else {
            // Ventilation shaft - solid clutter, not climbable.
            const vent = ventTemplate.clone(true);
            vent.position.set(worldPos.x, 0, worldPos.z);
            this.scene.add(vent);
            this.sceneExtras.push(vent);
            vent.traverse((child) => { if (child.isMesh) this.wallMeshes.push(child); });
            this.obstacles.push({ x: worldPos.x, z: worldPos.z, radius: cs * 0.32, climbable: false, height: ventHeight });
          }
        } else if (cell === 'C') {
          // Rooftop skylight / grate marker
          const discGeo = new THREE.CylinderGeometry(cs * 0.7, cs * 0.7, 0.05, 16);
          const discMat = new THREE.MeshStandardMaterial({
            color: 0x3a4658, roughness: 0.5, metalness: 0.3, emissive: 0x0a1a2a, emissiveIntensity: 0.3
          });
          const disc = new THREE.Mesh(discGeo, discMat);
          disc.position.set(worldPos.x, 0.03, worldPos.z);
          disc.receiveShadow = true;
          this.scene.add(disc);
          this.sceneExtras.push(disc);
          this.disposables.push(discGeo, discMat);
        }
      }
    }
  }

  /** Boxy AC condenser unit with a fan grille and a short vent pipe. */
  _createACUnitTemplate(cs, height) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x9a9a94, roughness: 0.7, metalness: 0.4 });
    const grilleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.5 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.8, height, cs * 0.8), bodyMat);
    body.position.y = height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const fan = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.32, cs * 0.32, 0.06, 16), grilleMat);
    fan.position.y = height + 0.03;
    fan.castShadow = true;
    group.add(fan);

    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, height * 0.7, 8), grilleMat);
    pipe.position.set(cs * 0.35, height * 0.5, cs * 0.35);
    group.add(pipe);

    return group;
  }

  /** Cylindrical rooftop ventilation shaft with a capped hood. */
  _createVentShaftTemplate(cs, height) {
    const group = new THREE.Group();
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x6f7580, roughness: 0.6, metalness: 0.5 });
    const hoodMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.5, metalness: 0.6 });

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(cs * 0.3, cs * 0.34, height, 12), shaftMat);
    shaft.position.y = height / 2;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    group.add(shaft);

    const hood = new THREE.Mesh(new THREE.ConeGeometry(cs * 0.4, 0.35, 12), hoodMat);
    hood.position.y = height + 0.15;
    hood.castShadow = true;
    group.add(hood);

    return group;
  }

  async _createGround() {
    const totalWidth = this.mazeWidth * this.cellSize;
    const totalHeight = this.mazeHeight * this.cellSize;

    const groundGeo = new THREE.PlaneGeometry(totalWidth + 4, totalHeight + 4);
    const groundMat = await loadTarConcreteMaterial(Math.max(totalWidth, totalHeight) / 4);
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.disposables.push(groundGeo, groundMat);
  }

  async _createLighting() {
    // Moonlight - cool directional light casting shadows. Intensity raised
    // so the maze interior (fences, AC units, vent shafts) reads clearly.
    this.moonLight = new THREE.DirectionalLight(0xb9c8ff, 2.4);
    this.moonLight.position.set(25, 40, 18);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(2048, 2048);
    this.moonLight.shadow.camera.left = -40;
    this.moonLight.shadow.camera.right = 40;
    this.moonLight.shadow.camera.top = 40;
    this.moonLight.shadow.camera.bottom = -40;
    this.moonLight.shadow.camera.near = 0.5;
    this.moonLight.shadow.camera.far = 100;
    this.moonLight.shadow.bias = -0.0015;
    this.scene.add(this.moonLight);
    this.disposables.push(this.moonLight);

    // Soft ambient fill so shadows never go fully black.
    this.ambientLight = new THREE.AmbientLight(0x40506a, 0.7);
    this.scene.add(this.ambientLight);
    this.disposables.push(this.ambientLight);

    // Faint sky/ground bounce for extra depth.
    this.hemiLight = new THREE.HemisphereLight(0x1c2748, 0x0a0a10, 0.25);
    this.scene.add(this.hemiLight);
    this.disposables.push(this.hemiLight);

    // Thin night haze - atmosphere without hiding the skybox.
    this.fog = new THREE.FogExp2(0x05070f, 0.014);
    this.scene.fog = this.fog;

    // Nighttime skybox (tries real cubemap assets first, then falls back to
    // a procedurally generated starfield so the game never renders black).
    this._skybox = await loadNightSkybox();
    this.scene.background = this._skybox;
    this.scene.environment = this._skybox;
  }

  // =================== ZOMBIES / WAVES ===================
  _setupZombies() {
    this.zombiePool = new ZombiePool(this.scene, 16);
    this.explosionPool = new ExplosionPool(this.scene, 8);

    this.regularSpawnPoints = [];

    for (let row = 0; row < this.mazeHeight; row++) {
      for (let col = 0; col < this.mazeWidth; col++) {
        const cell = this.maze[row][col];
        if (cell === 'Z' || cell === 'J') {
          this.regularSpawnPoints.push(this._cellToWorld(col, row));
        }
      }
    }

    // A handful of extra spawn points in open roof-deck areas keep waves
    // from bottlenecking around a single corridor.
    this.regularSpawnPoints.push(
      this._cellToWorld(15, 5),
      this._cellToWorld(23, 9),
      this._cellToWorld(21, 13)
    );

    // The Janitor Zombie is unique - kept outside the regular pool so its
    // distinct model and key-drop behaviour survive across explosions.
    // Rather than always waiting at a fixed maze position, it stays hidden
    // until a randomly chosen wave-spawn slot replaces a regular zombie with
    // it, so the player can't predict in advance which spawn carries the key.
    this.janitorZombie = new Zombie(this.scene, this.regularSpawnPoints[0], { isJanitor: true });
    this.janitorZombie.deactivate();
    this.janitorSpawned = false;
    this.totalSpawnedCount = 0;
    this.janitorSpawnSlot = 2 + Math.floor(Math.random() * 5); // random within the first ~5 wave spawns

    this._beginWave(0);
  }

  /** Wave difficulty curve: escalating counts, faster spawn cadence, then loops. */
  _waveConfig(index) {
    const base = [
      { count: 4, interval: 1.4 },
      { count: 6, interval: 1.1 },
      { count: 8, interval: 0.9 },
      { count: 10, interval: 0.8 }
    ];
    if (index < base.length) return base[index];
    const cycles = index - base.length + 1;
    const last = base[base.length - 1];
    return {
      count: Math.min(this.zombiePool.maxConcurrent, last.count + cycles * 2),
      interval: Math.max(0.5, last.interval - cycles * 0.05)
    };
  }

  _beginWave(index) {
    this.waveIndex = index;
    const cfg = this._waveConfig(index);
    this.waveSpawnRemaining = cfg.count;
    this.currentWaveInterval = cfg.interval;
    this.waveSpawnTimer = 0;
    this.waveState = 'spawning';
  }

  _updateWaves(dt) {
    if (this.waveState === 'spawning') {
      if (this.waveSpawnRemaining > 0) {
        this.waveSpawnTimer -= dt;
        if (this.waveSpawnTimer <= 0 && this.regularSpawnPoints.length > 0) {
          const spawnJanitorNow = !this.janitorSpawned && this.totalSpawnedCount + 1 >= this.janitorSpawnSlot;

          if (spawnJanitorNow) {
            const pos = this.regularSpawnPoints[Math.floor(Math.random() * this.regularSpawnPoints.length)];
            this.janitorZombie.spawn(pos, { isJanitor: true });
            this.janitorSpawned = true;
            this.totalSpawnedCount++;
            this.waveSpawnRemaining--;
            this.waveSpawnTimer = this.currentWaveInterval;
          } else if (this.zombiePool.availableCount > 0) {
            const pos = this.regularSpawnPoints[Math.floor(Math.random() * this.regularSpawnPoints.length)];
            this.zombiePool.spawn(pos, {});
            this.totalSpawnedCount++;
            this.waveSpawnRemaining--;
            this.waveSpawnTimer = this.currentWaveInterval;
          }
        }
      } else if (this.zombiePool.activeCount === 0) {
        this.waveState = 'gap';
        this.gapTimer = 3.0;
      }
    } else if (this.waveState === 'gap') {
      this.gapTimer -= dt;
      if (this.gapTimer <= 0) {
        this._beginWave(this.waveIndex + 1);
      }
    }
  }

  _createExitDoor() {
    for (let row = 0; row < this.mazeHeight; row++) {
      for (let col = 0; col < this.mazeWidth; col++) {
        if (this.maze[row][col] === 'E') {
          const pos = this._cellToWorld(col, row);
          this.exitDoorPosition = pos.clone();

          const doorGroup = new THREE.Group();
          doorGroup.position.copy(pos);

          // Rooftop stairwell bulkhead door
          const doorGeo = new THREE.BoxGeometry(1.5, 2.8, 0.2);
          const doorMat = new THREE.MeshStandardMaterial({ color: 0x555a5f, roughness: 0.6, metalness: 0.4 });
          const door = new THREE.Mesh(doorGeo, doorMat);
          door.position.y = 1.4;
          door.castShadow = true;
          doorGroup.add(door);

          const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.3 });
          const frameTopGeo = new THREE.BoxGeometry(1.8, 0.15, 0.3);
          const frameTop = new THREE.Mesh(frameTopGeo, frameMat);
          frameTop.position.y = 2.85;
          doorGroup.add(frameTop);

          const frameSideGeo = new THREE.BoxGeometry(0.15, 2.8, 0.3);
          const frameLeft = new THREE.Mesh(frameSideGeo, frameMat);
          frameLeft.position.set(-0.83, 1.4, 0);
          doorGroup.add(frameLeft);
          const frameRight = new THREE.Mesh(frameSideGeo, frameMat);
          frameRight.position.set(0.83, 1.4, 0);
          doorGroup.add(frameRight);

          const keyholeGeo = new THREE.BoxGeometry(0.15, 0.15, 0.05);
          const keyholeMat = new THREE.MeshStandardMaterial({
            color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.5
          });
          const keyhole = new THREE.Mesh(keyholeGeo, keyholeMat);
          keyhole.position.set(0.4, 1.2, 0.13);
          doorGroup.add(keyhole);

          const signGeo = new THREE.BoxGeometry(1.0, 0.3, 0.05);
          const signMat = new THREE.MeshStandardMaterial({
            color: 0x00aa00, emissive: 0x00aa00, emissiveIntensity: 1.0
          });
          const sign = new THREE.Mesh(signGeo, signMat);
          sign.position.y = 3.2;
          doorGroup.add(sign);

          const doorLight = new THREE.PointLight(0x00ff44, 2, 8);
          doorLight.position.y = 3.5;
          doorGroup.add(doorLight);

          this.exitDoor = doorGroup;
          this.scene.add(doorGroup);
          return;
        }
      }
    }
  }

  /** Spawn a key at the given world position (when janitor dies). */
  spawnKey(position) {
    if (this.keyMesh) return;

    const keyGroup = new THREE.Group();
    keyGroup.name = 'Key';

    const keyBodyGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6);
    const keyMat = new THREE.MeshStandardMaterial({
      color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.2
    });
    const keyBody = new THREE.Mesh(keyBodyGeo, keyMat);
    keyBody.rotation.z = Math.PI / 2;
    keyGroup.add(keyBody);

    const keyHeadGeo = new THREE.TorusGeometry(0.12, 0.04, 6, 8);
    const keyHead = new THREE.Mesh(keyHeadGeo, keyMat);
    keyHead.position.x = -0.2;
    keyGroup.add(keyHead);

    const toothGeo = new THREE.BoxGeometry(0.06, 0.08, 0.04);
    for (let i = 0; i < 3; i++) {
      const tooth = new THREE.Mesh(toothGeo, keyMat);
      tooth.position.set(0.1 + i * 0.08, -0.06, 0);
      keyGroup.add(tooth);
    }

    keyGroup.position.copy(position);
    keyGroup.position.y = 0.8;

    const keyLight = new THREE.PointLight(0xffd700, 2, 5);
    keyGroup.add(keyLight);

    this.scene.add(keyGroup);
    this.keyMesh = keyGroup;
  }

  /**
   * Per-frame update. Returns events for Game.js to react to.
   */
  update(dt, player, time) {
    const events = {
      keyCollected: false,
      levelComplete: false
    };

    // ---- Rebuild the active-zombie snapshot used by Game.js (shooting / minimap) ----
    this.zombies.length = 0;
    this.zombiePool.forEachActive((z) => this.zombies.push(z));
    if (this.janitorZombie && this.janitorZombie.alive) this.zombies.push(this.janitorZombie);

    // ---- Waves ----
    this._updateWaves(dt);

    // ---- Zombie AI ----
    this.zombiePool.forEachActive((zombie) => {
      const result = zombie.update(dt, player.group.position, this.obstacles);
      if (result.hit) player.takeDamage(result.damage);
    });
    if (this.janitorZombie && this.janitorZombie.alive) {
      const result = this.janitorZombie.update(dt, player.group.position, this.obstacles);
      if (result.hit) player.takeDamage(result.damage);
    }

    // ---- Explosion VFX ----
    this.explosionPool.update(dt);

    // ---- Key pickup ----
    if (this.keyMesh && !this.keyCollected) {
      this.keyMesh.position.y = 0.8 + Math.sin(time * 3) * 0.2;
      this.keyMesh.rotation.y += dt * 2;

      const dist = player.group.position.distanceTo(this.keyMesh.position);
      if (dist < 1.5) {
        this.keyCollected = true;
        player.hasKey = true;
        this.scene.remove(this.keyMesh);
        events.keyCollected = true;
      }
    }

    // ---- Exit check ----
    if (this.exitDoorPosition && player.hasKey && !this.levelComplete) {
      const dist = player.group.position.distanceTo(this.exitDoorPosition);
      if (dist < 2.0) {
        this.levelComplete = true;
        events.levelComplete = true;
      }
    }

    if (this.exitDoor) {
      this.exitDoor.traverse((child) => {
        if (child.isMesh && child.material.emissive && child.material.emissiveIntensity > 0) {
          child.material.emissiveIntensity = 0.5 + Math.sin(time * 3) * 0.3;
        }
      });
    }

    return events;
  }

  /**
   * Handle a zombie's single-shot kill: pooled explosion VFX, AoE chain
   * reaction against nearby zombies, janitor key drop, and pool release.
   */
  handleZombieKilled(zombie, killedPosition) {
    let chainKills = 0;

    if (zombie.isJanitor && !this.keyCollected) {
      this.spawnKey(killedPosition.clone());
    }
    if (!zombie.isJanitor) {
      this.zombiePool.release(zombie);
    }

    // Chain explosion: kill all zombies within AoE radius (including the janitor).
    const candidates = [];
    this.zombiePool.forEachActive((z) => candidates.push(z));
    if (this.janitorZombie && this.janitorZombie.alive) candidates.push(this.janitorZombie);

    for (const other of candidates) {
      if (other === zombie || !other.alive) continue;
      const dist = other.group.position.distanceTo(killedPosition);
      if (dist < zombie.explosionRadius) {
        other.explode(this.explosionPool);
        chainKills++;

        if (other.isJanitor && !this.keyCollected) {
          this.spawnKey(other.group.position.clone());
        } else {
          this.zombiePool.release(other);
        }
      }
    }

    return chainKills;
  }

  getObstacles() {
    return this.obstacles;
  }

  dispose() {
    if (this.zombiePool) this.zombiePool.dispose();
    if (this.explosionPool) this.explosionPool.dispose();
    if (this.janitorZombie) {
      this.janitorZombie.dispose();
      this.janitorZombie = null;
    }
    this.zombies = [];

    if (this.keyMesh) {
      this.scene.remove(this.keyMesh);
      this.keyMesh.traverse((child) => {
        if (child.isMesh) { child.geometry.dispose(); child.material.dispose(); }
      });
      this.keyMesh = null;
    }

    if (this.exitDoor) {
      this.scene.remove(this.exitDoor);
      this.exitDoor.traverse((child) => {
        if (child.isMesh) { child.geometry.dispose(); child.material.dispose(); }
      });
      this.exitDoor = null;
    }

    for (const wall of this.wallMeshes) {
      if (wall.parent === this.scene) this.scene.remove(wall);
    }
    this.wallMeshes = [];

    // Remove parapet caps / AC-unit / vent-shaft groups (their shared
    // geometries & materials are disposed via `this.disposables` below).
    for (const extra of this.sceneExtras) {
      this.scene.remove(extra);
    }
    this.sceneExtras = [];
    this.obstacles = [];

    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      // Texture maps are disposed via the `disposables` material-aware pass below.
      this.ground = null;
    }

    for (const d of this.disposables) {
      if (d.isLight || d.isFog) {
        this.scene.remove(d);
      } else if (d.isMaterial) {
        // Dispose any textures the material owns before disposing itself.
        ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'bumpMap', 'metalnessMap'].forEach((key) => {
          if (d[key] && d[key].dispose) d[key].dispose();
        });
        d.dispose();
      } else if (d.dispose) {
        d.dispose();
      }
    }
    this.disposables = [];
    this.scene.fog = null;
    this.scene.background = null;
    this.scene.environment = null;
    if (this._skybox && this._skybox.dispose) this._skybox.dispose();
  }
}
