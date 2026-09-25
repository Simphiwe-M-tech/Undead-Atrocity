import * as THREE from 'three';
import { Zombie } from '../enemies/Zombie.js';
import { PursuitMap, segmentEntry } from '../enemies/PursuitMap.js';
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
 * not climbable. Story-driven infected encounters lead to a scripted Janitor key-carrier
 * sequence, then the player escapes through the rooftop stairwell.
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

    // ---- Narrative Level 1 state ----
    // Level 1 is an investigation mission, not an endless wave arena.
    this.storyStarted = false;
    this.storyClock = 0;
    this.storyStage = 'wake';
    this.objective = 'Find your phone.';
    this.clues = [];
    this.requiredCluesFound = 0;
    this.totalRequiredClues = 2;
    this.lastPlayerPosition = new THREE.Vector3();
    this.janitorEncounterRadius = 18.0;
    this.exitDiscovered = false;
    this.janitorSpawnPoint = null;
    this.janitorSpawned = false;
    this.janitorReleased = false;
    this.janitorEncounterStarted = false;
    this.janitorKilled = false;
    this.encounterName = 'INVESTIGATE THE ROOFTOP';
    this.encounterPhase = 'story';
    this.encounterSpawnPoints = [];
    this.pendingEvents = [];
    this.triggeredEncounters = new Set();
    this.encounterQueue = [];
    this.encounterStats = new Map();
    this.spawnRetryTimer = 0;
    this._spawnPosition = new THREE.Vector3();
    this._spawnEye = new THREE.Vector3();
    this._spawnBounds = new THREE.Sphere(this._spawnEye, 1.4);
    this._spawnFrustum = new THREE.Frustum();
    this._spawnMatrix = new THREE.Matrix4();
    this.navigation = null;
    this.interactionRange = 2.2;
    this.phoneBeaconRing = null;
    this.phoneBeaconLight = null;
    this.janitorReinforcementsSpawned = false;
    this.janitorAlarmLight = null;
    this.janitorEncounterCueShown = false;
  }

  async load(onProgress) {
    await this._createLighting();
    onProgress && onProgress(0.15);

    await this._buildMaze();
    onProgress && onProgress(0.4);

    await this._createGround();
    onProgress && onProgress(0.6);

    this._createStoryEnvironment();
    this._setupZombies();
    this._createJanitorAlarmBeacon();
    onProgress && onProgress(0.85);

    this._createExitDoor();
    this._createRooftopLandmarks();
    this._createPursuitMap();
    onProgress && onProgress(1.0);
  }

  get spawnPoint() {
    // Player spawn at 'P' position in maze (row 1, col 1)
    return this._cellToWorld(1, 1);
  }

  get title() {
    return 'LEVEL 1 — THE ROOFTOP';
  }

  // =================== ROOFTOP LAYOUT ===================
  // Phase 5 uses a substantially larger 51 x 31 rooftop. The partitions
  // create readable routes and combat lanes rather than a tight dungeon maze.
  _getMazeData() {
    const width = 51;
    const height = 31;
    const grid = Array.from({ length: height }, () => Array(width).fill('.'));

    // Perimeter parapet.
    for (let x = 0; x < width; x++) { grid[0][x] = '#'; grid[height - 1][x] = '#'; }
    for (let z = 0; z < height; z++) { grid[z][0] = '#'; grid[z][width - 1] = '#'; }

    const hLine = (z, x1, x2, ch = 'F') => { for (let x = x1; x <= x2; x++) grid[z][x] = ch; };
    const vLine = (x, z1, z2, ch = 'F') => { for (let z = z1; z <= z2; z++) grid[z][x] = ch; };
    const block = (x1, z1, x2, z2, ch) => {
      for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) grid[z][x] = ch;
    };

    // Opening route: enough structure to navigate, but with clear sight-lines
    // toward the backpack/phone landmark.
    hLine(5, 3, 12, 'W');
    vLine(12, 5, 10, 'W');
    hLine(10, 7, 12, 'W');

    // West maintenance lanes.
    block(5, 12, 8, 14, 'A');
    hLine(16, 3, 9, 'W');
    hLine(16, 10, 13, 'F');
    vLine(13, 16, 21, 'W');
    hLine(21, 8, 13, 'W');
    block(16, 8, 18, 10, 'V');

    // Central navigation partitions with several deliberate openings.
    hLine(7, 21, 33, 'W');
    grid[7][26] = '.'; grid[7][27] = '.';
    vLine(21, 7, 16); grid[12][21] = '.';
    hLine(16, 21, 35, 'W'); grid[16][29] = '.'; grid[16][30] = '.';
    vLine(35, 11, 20); grid[15][35] = '.';
    block(25, 11, 28, 13, 'A');
    block(31, 19, 33, 21, 'V');

    // East-side maze lanes create a longer route to the Janitor and exit.
    hLine(6, 38, 42, 'W');
    hLine(6, 43, 46, 'F');
    vLine(38, 6, 13); grid[10][38] = '.';
    hLine(13, 38, 47); grid[13][43] = '.';
    vLine(47, 13, 22); grid[18][47] = '.';
    hLine(22, 39, 47); grid[22][44] = '.';

    // Janitor enclosure. A visible fenced compound with a controlled opening.
    hLine(23, 37, 44);
    hLine(28, 37, 44);
    vLine(37, 23, 28);
    vLine(44, 23, 28);
    grid[28][40] = '.'; grid[28][41] = '.';

    // Rooftop landmarks.
    block(15, 23, 18, 25, 'A');
    block(22, 24, 23, 26, 'V');
    grid[19][18] = 'C';

    // Story / gameplay locations.
    grid[1][1] = 'P';
    grid[24][40] = 'J';
    grid[27][47] = 'E';

    // Multiple believable infected entry points distributed around the roof.
    const spawns = [[4,8],[17,5],[24,18],[10,25],[32,6],[42,9],[46,19],[29,27]];
    for (const [x,z] of spawns) grid[z][x] = 'Z';

    return grid.map(row => row.join(''));
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

    // Interior service walls are visually distinct from chain-link fencing,
    // creating believable rooftop corridors and landmarks rather than one
    // repeated obstacle type.
    const serviceWallHeight = 1.65;
    const serviceWallGeo = new THREE.BoxGeometry(cs, serviceWallHeight, cs);
    const serviceWallMat = new THREE.MeshStandardMaterial({ color: 0x555d63, roughness: 0.94, metalness: 0.02 });

    // Templates are never added to the scene themselves - only their clones
    // are - so their geometries/materials are the single shared instances
    // reused by every AC-unit / vent-shaft placed in the maze.
    const acTemplate = this._createACUnitTemplate(cs, acHeight);
    const ventTemplate = this._createVentShaftTemplate(cs, ventHeight);
    acTemplate.traverse((child) => { if (child.isMesh) this.disposables.push(child.geometry, child.material); });
    ventTemplate.traverse((child) => { if (child.isMesh) this.disposables.push(child.geometry, child.material); });

    this.disposables.push(parapetGeo, parapetMat, parapetCapGeo, parapetCapMat, fenceGeo, fenceMat, serviceWallGeo, serviceWallMat);

    for (let row = 0; row < this.mazeHeight; row++) {
      for (let col = 0; col < this.mazeWidth; col++) {
        const cell = this.maze[row][col];
        const worldPos = this._cellToWorld(col, row);

        if (cell === '#') {
          // Border parapet: low enough to read as a rooftop edge, but solid.
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

          this.obstacles.push({ x: worldPos.x, z: worldPos.z, halfX: cs / 2, halfZ: cs / 2, radius: cs * 0.72, climbable: false, height: parapetHeight });
        } else if (cell === 'W') {
          const serviceWall = new THREE.Mesh(serviceWallGeo, serviceWallMat);
          serviceWall.position.set(worldPos.x, serviceWallHeight / 2, worldPos.z);
          serviceWall.castShadow = true;
          serviceWall.receiveShadow = true;
          this.scene.add(serviceWall);
          this.wallMeshes.push(serviceWall);
          this.obstacles.push({ x: worldPos.x, z: worldPos.z, halfX: cs / 2, halfZ: cs / 2, radius: cs * 0.72, climbable: false, height: serviceWallHeight });
        } else if (cell === 'F') {
          // Purposefully placed fence: blocks the player but zombies can climb it.
          const fence = new THREE.Mesh(fenceGeo, fenceMat);
          fence.position.set(worldPos.x, fenceHeight / 2, worldPos.z);
          fence.castShadow = false;
          fence.receiveShadow = true;
          this.scene.add(fence);
          this.wallMeshes.push(fence);
          this.obstacles.push({ x: worldPos.x, z: worldPos.z, halfX: cs / 2, halfZ: cs / 2, radius: cs * 0.72, climbable: true, height: fenceHeight });
        } else if (cell === 'A') {
          const ac = acTemplate.clone(true);
          ac.position.set(worldPos.x, 0, worldPos.z);
          ac.rotation.y = ((row + col) % 4) * (Math.PI / 2);
          this.scene.add(ac);
          this.sceneExtras.push(ac);
          ac.traverse((child) => { if (child.isMesh) this.wallMeshes.push(child); });
          this.obstacles.push({ x: worldPos.x, z: worldPos.z, halfX: cs * 0.43, halfZ: cs * 0.43, radius: cs * 0.61, climbable: false, height: acHeight });
        } else if (cell === 'V') {
          const vent = ventTemplate.clone(true);
          vent.position.set(worldPos.x, 0, worldPos.z);
          this.scene.add(vent);
          this.sceneExtras.push(vent);
          vent.traverse((child) => { if (child.isMesh) this.wallMeshes.push(child); });
          this.obstacles.push({ x: worldPos.x, z: worldPos.z, halfX: cs * 0.34, halfZ: cs * 0.34, radius: cs * 0.48, climbable: false, height: ventHeight });
        } else if (cell === 'C') {
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


  // =================== STORY / INVESTIGATION ===================
  _createStoryEnvironment() {
    this.clues = [];
    this._createOpeningSetDressing();

    // MAIN STORY CLUE 1: the protagonist's cracked phone. This is placed
    // close to the wake-up point so the player gets a clear first action.
    this._createClue({
      id: 'phone',
      type: 'phone',
      title: 'YOUR DAMAGED PHONE',
      eyebrow: 'STORY CLUE 01 / 02',
      position: this._cellToWorld(6, 4),
      required: true,
      body: [
        '02:08 — 3 MISSED CALLS: THANDO',
        '02:11 — UNKNOWN: “You shouldn’t have come upstairs.”',
        '02:12 — THANDO: “Don’t open the stairwell. Something is wrong below.”'
      ],
      insight: 'The unknown sender contacted you before you woke up. They knew you were on the rooftop.'
    });

    // MAIN STORY CLUE 2: a security radio beside a fallen guard. The audio
    // transcript establishes that service doors were opened deliberately.
    this._createClue({
      id: 'security-radio',
      type: 'radio',
      title: 'SECURITY RADIO — LAST TRANSMISSION',
      eyebrow: 'STORY CLUE 02 / 02',
      position: this._cellToWorld(27, 15),
      required: true,
      body: [
        '02:06 — “Control, somebody opened the west service doors.”',
        '02:07 — [STATIC] “Students are attacking each other—”',
        '02:07 — “Lock the residence. LOCK—” [TRANSMISSION LOST]'
      ],
      insight: 'Someone opened a secured route before the infection spread. This was not simply a random breach.'
    });

    // Fallen security guard: simple environmental storytelling silhouette
    // around the radio clue. It gives the evidence a believable source.
    const guard = new THREE.Group();
    guard.position.copy(this._cellToWorld(27, 15));
    guard.position.x -= 0.85;
    guard.rotation.y = -0.35;
    const uniformMat = new THREE.MeshStandardMaterial({ color: 0x202935, roughness: 0.9 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x7a513e, roughness: 1 });
    const torsoGeo = new THREE.BoxGeometry(0.65, 0.22, 1.25);
    const headGeo = new THREE.BoxGeometry(0.42, 0.35, 0.42);
    const torso = new THREE.Mesh(torsoGeo, uniformMat);
    torso.position.y = 0.14;
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0.15, 0.18, -0.78);
    guard.add(torso, head);
    this.scene.add(guard);
    this.sceneExtras.push(guard);
    this.disposables.push(uniformMat, skinMat, torsoGeo, headGeo);


    // A dead infected lies beside the guard. This reads as the aftermath of
    // a struggle instead of a live zombie inexplicably waiting by the clue.
    const deadInfected = new THREE.Group();
    deadInfected.position.copy(this._cellToWorld(27, 15));
    deadInfected.position.x += 1.05;
    deadInfected.position.z += 0.35;
    deadInfected.rotation.y = 0.65;
    const infectedMat = new THREE.MeshStandardMaterial({ color: 0x496044, roughness: 1 });
    const infectedSkin = new THREE.MeshStandardMaterial({ color: 0x65745b, roughness: 1 });
    const infectedTorsoGeo = new THREE.BoxGeometry(0.62, 0.20, 1.15);
    const infectedHeadGeo = new THREE.BoxGeometry(0.40, 0.34, 0.40);
    const infectedTorso = new THREE.Mesh(infectedTorsoGeo, infectedMat);
    infectedTorso.position.y = 0.12;
    const infectedHead = new THREE.Mesh(infectedHeadGeo, infectedSkin);
    infectedHead.position.set(-0.18, 0.16, 0.72);
    deadInfected.add(infectedTorso, infectedHead);
    this.scene.add(deadInfected);
    this.sceneExtras.push(deadInfected);
    this.disposables.push(infectedMat, infectedSkin, infectedTorsoGeo, infectedHeadGeo);

    // Blood trail deliberately leads from the first-contact side toward the
    // fallen guard/radio instead of asking the player to wander aimlessly.
    const bloodMat = new THREE.MeshStandardMaterial({
      color: 0x3b0508, roughness: 0.95, metalness: 0,
      transparent: true, opacity: 0.9
    });
    this.disposables.push(bloodMat);
    const trailCells = [[8,6],[10,7],[12,8],[14,9],[16,10],[18,11],[20,12],[22,13],[24,14],[26,15]];
    for (let i = 0; i < trailCells.length; i++) {
      const [col,row] = trailCells[i];
      const geo = new THREE.CircleGeometry(0.2 + (i % 3) * 0.06, 8);
      const stain = new THREE.Mesh(geo, bloodMat);
      const pos = this._cellToWorld(col,row);
      stain.position.set(pos.x + ((i % 2) ? 0.22 : -0.16), 0.012, pos.z);
      stain.rotation.x = -Math.PI / 2;
      stain.rotation.z = i * 0.71;
      this.scene.add(stain);
      this.sceneExtras.push(stain);
      this.disposables.push(geo);
    }
  }

  _createRooftopLandmarks() {
    // Deliberate service clusters; shared low-poly assets and no extra shadows.
    const metal = new THREE.MeshStandardMaterial({ color: 0x455363, roughness: 0.7, metalness: 0.5 });
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x28464b, roughness: 0.8 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
    this.disposables.push(metal, tankMat, box, cylinder);
    const prop = (geo, mat, col, row, y, sx, sy, sz, solid = true) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(this._cellToWorld(col, row));
      mesh.position.y = y;
      mesh.scale.set(sx, sy, sz);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.sceneExtras.push(mesh);
      if (solid) {
        const halfX = geo === cylinder ? sx : sx / 2;
        const halfZ = geo === cylinder ? sz : sz / 2;
        this.obstacles.push({ x: mesh.position.x, z: mesh.position.z, halfX, halfZ, radius: Math.max(halfX, halfZ), height: y + sy / 2, climbable: false });
        this.wallMeshes.push(mesh);
      }
      return mesh;
    };
    for (const col of [3, 7]) {
      prop(cylinder, tankMat, col, 19, 1.6, 1.2, 3.2, 1.2);
      prop(cylinder, metal, col, 19, 3.25, 1.27, 0.15, 1.27, false);
      prop(cylinder, metal, col + 0.85, 19, 1.25, 0.08, 2.5, 0.08);
    }
    prop(box, metal, 10, 14, 0.9, 1.2, 1.8, 0.5);
    prop(box, metal, 42, 26, 0.45, 1.4, 0.9, 0.7);
    prop(cylinder, metal, 45, 3, 2.4, 0.09, 4.8, 0.09);
    prop(box, metal, 45, 3, 4.2, 2.2, 0.06, 0.06, false);
    const warning = new THREE.MeshBasicMaterial({ color: 0xbe9149 });
    const lamp = new THREE.MeshBasicMaterial({ color: 0xaacbd4 });
    this.disposables.push(warning, lamp);
    // Floor service hatches make existing encounter points recognizable.
    for (const point of this.encounterSpawnPoints) {
      const hatch = new THREE.Mesh(box, metal);
      hatch.position.copy(point); hatch.position.y = 0.025;
      hatch.scale.set(1.4, 0.04, 1.8);
      this.scene.add(hatch); this.sceneExtras.push(hatch);
      for (const side of [-1, 1]) {
        const stripe = new THREE.Mesh(box, warning);
        stripe.position.set(point.x + side * 0.8, 0.03, point.z);
        stripe.scale.set(0.1, 0.04, 2);
        this.scene.add(stripe); this.sceneExtras.push(stripe);
      }
    }
    for (const col of [3, 15, 29, 45]) {
      prop(box, lamp, col, 0, 1.05, 0.5, 0.12, 0.2, false);
    }
    const sign = (col, row, text, color) => {
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#101923'; ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = color; ctx.fillRect(0, 0, 10, 128);
      ctx.font = 'bold 25px sans-serif'; ctx.fillText('RESIDENCE / ROOF 01', 25, 43);
      ctx.font = 'bold 29px sans-serif'; ctx.fillText(text, 25, 91);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: texture });
      this.disposables.push(mat);
      prop(box, metal, col, row, 0.8, 0.08, 1.6, 0.08);
      prop(box, mat, col, row, 1.85, 3.2, 0.8, 0.08);
    };
    sign(8, 2, 'A / RESIDENT ACCESS', '#90c9e8');
    sign(4, 17, 'B / WATER & SERVICES', '#e0b869');
    sign(24, 8, 'C / PLANT DECK', '#a1bfbc');
    sign(29, 14, 'D / SECURITY', '#f07979');
    sign(39, 27, 'E / MAINTENANCE', '#edb656');
    sign(48, 24, 'STAIRWELL / EXIT', '#8be8ac');
    const emergency = new THREE.PointLight(0xff4545, 3, 10);
    emergency.position.copy(this._cellToWorld(27, 15)); emergency.position.y = 2.4;
    this.scene.add(emergency); this.sceneExtras.push(emergency);
    // A physical gate closes the existing enclosure opening until breakout.
    this.janitorGate = prop(box, metal, 40.5, 28, 1, 3.8, 2, 0.15);
    this.janitorGateObstacle = this.obstacles[this.obstacles.length - 1];
  }

  _createOpeningSetDressing() {
    // Opening vignette: the backpack makes the phone feel owned and gives
    // the player a strong visual landmark immediately after waking up.
    const bag = new THREE.Group();
    const bagPos = this._cellToWorld(5, 4);
    bag.position.set(bagPos.x - 0.45, 0.16, bagPos.z + 0.2);
    bag.rotation.y = -0.55;
    const bagMat = new THREE.MeshStandardMaterial({ color: 0x26364a, roughness: 0.92 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.85 });
    const bagGeo = new THREE.BoxGeometry(0.75, 0.30, 0.95);
    const pocketGeo = new THREE.BoxGeometry(0.58, 0.18, 0.28);
    const strapGeo = new THREE.BoxGeometry(0.09, 0.06, 1.05);
    const body = new THREE.Mesh(bagGeo, bagMat);
    const pocket = new THREE.Mesh(pocketGeo, trimMat);
    pocket.position.set(0, 0.02, -0.52);
    const strap1 = new THREE.Mesh(strapGeo, trimMat);
    strap1.position.set(-0.23, 0.18, 0);
    const strap2 = strap1.clone();
    strap2.position.x = 0.23;
    bag.add(body, pocket, strap1, strap2);
    this.scene.add(bag);
    this.sceneExtras.push(bag);
    this.disposables.push(bagMat, trimMat, bagGeo, pocketGeo, strapGeo);

    // Pulsing locator beacon: a soft cyan ring and light blink beside the bag
    // until the phone is collected. It guides the player without a giant arrow.
    const beaconGeo = new THREE.RingGeometry(0.46, 0.60, 28);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x69b9ff, transparent: true, opacity: 0.78, side: THREE.DoubleSide });
    const beaconRing = new THREE.Mesh(beaconGeo, beaconMat);
    beaconRing.position.set(bagPos.x + 0.45, 0.055, bagPos.z - 0.15);
    beaconRing.rotation.x = -Math.PI / 2;
    const beaconLight = new THREE.PointLight(0x69b9ff, 2.4, 6.5);
    beaconLight.position.set(bagPos.x + 0.45, 0.9, bagPos.z - 0.15);
    this.scene.add(beaconRing, beaconLight);
    this.sceneExtras.push(beaconRing, beaconLight);
    this.disposables.push(beaconGeo, beaconMat);
    this.phoneBeaconRing = beaconRing;
    this.phoneBeaconLight = beaconLight;

    // Small concrete service walls create a believable wake-up corner and
    // funnel the eye toward the backpack/phone without becoming a maze.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x5b6066, roughness: 0.95 });
    const wallGeoLong = new THREE.BoxGeometry(5.6, 1.35, 0.32);
    const wallGeoShort = new THREE.BoxGeometry(0.32, 1.35, 4.2);
    const start = this._cellToWorld(3, 2);
    const wallA = new THREE.Mesh(wallGeoLong, wallMat);
    wallA.position.set(start.x + 1.2, 0.675, start.z - 1.15);
    const wallB = new THREE.Mesh(wallGeoShort, wallMat);
    wallB.position.set(start.x - 1.65, 0.675, start.z + 0.75);
    wallA.castShadow = wallB.castShadow = true;
    wallA.receiveShadow = wallB.receiveShadow = true;
    this.scene.add(wallA, wallB);
    this.sceneExtras.push(wallA, wallB);
    this.wallMeshes.push(wallA, wallB);
    this.disposables.push(wallMat, wallGeoLong, wallGeoShort);
    // Exact collision footprints matching the visible concrete walls.
    this.obstacles.push({ x: wallA.position.x, z: wallA.position.z, halfX: 2.8, halfZ: 0.16, radius: 2.8, climbable: false, height: 1.35 });
    this.obstacles.push({ x: wallB.position.x, z: wallB.position.z, halfX: 0.16, halfZ: 2.1, radius: 2.1, climbable: false, height: 1.35 });

    // Extra blood close to the wake-up point tells the player immediately
    // that something violent happened before they regained consciousness.
    const bloodMat = new THREE.MeshStandardMaterial({ color: 0x420408, roughness: 1, transparent: true, opacity: 0.92 });
    const bloodGeo = new THREE.CircleGeometry(0.48, 14);
    const blood = new THREE.Mesh(bloodGeo, bloodMat);
    const wake = this._cellToWorld(2, 2);
    blood.position.set(wake.x + 0.3, 0.013, wake.z + 0.25);
    blood.rotation.x = -Math.PI / 2;
    blood.scale.set(1.5, 0.75, 1);
    this.scene.add(blood);
    this.sceneExtras.push(blood);
    this.disposables.push(bloodMat, bloodGeo);
  }

  _createClue(data) {
    const group = new THREE.Group();
    group.name = `Clue_${data.id}`;
    group.position.copy(data.position);

    let mesh;
    if (data.type === 'phone') {
      const geo = new THREE.BoxGeometry(0.42, 0.035, 0.72);
      const mat = new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.35, metalness: 0.45 });
      mesh = new THREE.Mesh(geo, mat);
      const screenGeo = new THREE.PlaneGeometry(0.33, 0.56);
      const screenMat = new THREE.MeshStandardMaterial({ color: 0x5aa7ff, emissive: 0x245bff, emissiveIntensity: 1.6 });
      const screen = new THREE.Mesh(screenGeo, screenMat);
      screen.rotation.x = -Math.PI / 2;
      screen.position.y = 0.021;
      mesh.add(screen);
      this.disposables.push(geo, mat, screenGeo, screenMat);
    } else if (data.type === 'radio') {
      const geo = new THREE.BoxGeometry(0.46, 0.20, 0.62);
      const mat = new THREE.MeshStandardMaterial({ color: 0x232a2e, roughness: 0.6, metalness: 0.35 });
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.12;
      const speakerGeo = new THREE.CircleGeometry(0.12, 12);
      const speakerMat = new THREE.MeshStandardMaterial({ color: 0x090b0d, roughness: 0.9 });
      const speaker = new THREE.Mesh(speakerGeo, speakerMat);
      speaker.rotation.x = -Math.PI / 2;
      speaker.position.set(0, 0.105, 0.08);
      mesh.add(speaker);
      const antennaGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.55, 6);
      const antennaMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.4, roughness: 0.5 });
      const antenna = new THREE.Mesh(antennaGeo, antennaMat);
      antenna.position.set(0.17, 0.35, -0.18);
      antenna.rotation.z = -0.18;
      mesh.add(antenna);
      this.disposables.push(geo, mat, speakerGeo, speakerMat, antennaGeo, antennaMat);
    } else if (data.type === 'clipboard') {
      const geo = new THREE.BoxGeometry(0.55, 0.04, 0.78);
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a623f, roughness: 0.9 });
      mesh = new THREE.Mesh(geo, mat);
      const paperGeo = new THREE.PlaneGeometry(0.44, 0.62);
      const paperMat = new THREE.MeshStandardMaterial({ color: 0xd7d1be, roughness: 1 });
      const paper = new THREE.Mesh(paperGeo, paperMat);
      paper.rotation.x = -Math.PI / 2;
      paper.position.y = 0.025;
      mesh.add(paper);
      this.disposables.push(geo, mat, paperGeo, paperMat);
    } else if (data.type === 'canister') {
      const geo = new THREE.CylinderGeometry(0.16, 0.18, 0.62, 10);
      const mat = new THREE.MeshStandardMaterial({ color: 0x5a7d65, roughness: 0.65, metalness: 0.45 });
      mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.z = Math.PI / 2;
      mesh.position.y = 0.18;
      this.disposables.push(geo, mat);
    } else {
      const geo = new THREE.BoxGeometry(0.5, 0.025, 0.32);
      const mat = new THREE.MeshStandardMaterial({ color: 0xb9c4cc, roughness: 0.55, metalness: 0.15 });
      mesh = new THREE.Mesh(geo, mat);
      this.disposables.push(geo, mat);
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const glow = new THREE.PointLight(data.required ? 0x77b7ff : 0xffcc66, 0.75, 3.5);
    glow.position.y = 0.7;
    group.add(glow);

    this.scene.add(group);
    this.sceneExtras.push(group);
    data.group = group;
    data.found = false;
    data._baseY = group.position.y;
    this.clues.push(data);
  }

  _queueEvent(event) {
    this.pendingEvents.push(event);
  }

  _drainEvents() {
    if (this.pendingEvents.length === 0) return [];
    return this.pendingEvents.splice(0, this.pendingEvents.length);
  }


  _createJanitorAlarmBeacon() {
    if (!this.janitorSpawnPoint || this.janitorAlarmLight) return;
    const beaconGroup = new THREE.Group();
    beaconGroup.position.copy(this.janitorSpawnPoint);
    beaconGroup.position.y = 2.8;

    const baseGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.12, 10);
    const lampGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.22, 10);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x25292d, roughness: 0.85, metalness: 0.35 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x4a0b0b, emissive: 0xff1f1f, emissiveIntensity: 0.05, roughness: 0.4 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.y = 0.16;
    beaconGroup.add(base, lamp);

    const light = new THREE.PointLight(0xff1f1f, 0, 12, 2);
    light.position.y = 0.25;
    beaconGroup.add(light);

    this.scene.add(beaconGroup);
    this.sceneExtras.push(beaconGroup);
    this.disposables.push(baseGeo, lampGeo, baseMat, lampMat);
    this.janitorAlarmLight = { group: beaconGroup, light, lampMat };
  }

  getStoryStatus() {
    return {
      objective: this.objective,
      evidence: this.clues.filter(c => c.found).length,
      totalEvidence: this.clues.length,
      required: this.requiredCluesFound,
      totalRequired: this.totalRequiredClues,
      encounter: this.encounterName,
      phase: this.encounterPhase
    };
  }

  getNearbyInteraction(playerPosition) {
    let best = null;
    let bestDist = Infinity;
    for (const clue of this.clues) {
      if (clue.found || !clue.group.visible) continue;
      // Main story clues are intentionally sequential so the mystery reads
      // like a mission rather than four unrelated pickups.
      if (clue.id === 'security-radio' && !this.clues.find(c => c.id === 'phone')?.found) continue;
      const dist = playerPosition.distanceTo(clue.group.position);
      if (dist < this.interactionRange && dist < bestDist) {
        bestDist = dist;
        best = { type: 'clue', id: clue.id, label: clue.id === 'phone' ? 'E — Inspect Phone' : 'E — Inspect Security Radio' };
      }
    }
    return best;
  }

  interact(playerPosition) {
    this.lastPlayerPosition.copy(playerPosition);
    const interaction = this.getNearbyInteraction(playerPosition);
    if (!interaction) return null;
    const clue = this.clues.find(c => c.id === interaction.id);
    if (!clue || clue.found) return null;

    clue.found = true;
    clue.group.visible = false;
    if (clue.required) this.requiredCluesFound++;

    const result = {
      type: 'evidence',
      evidence: {
        id: clue.id,
        title: clue.title,
        eyebrow: clue.eyebrow,
        body: clue.body,
        insight: clue.insight,
        required: clue.required
      }
    };

    if (clue.id === 'phone') {
      this.objective = 'Follow the blood trail. Find out what happened to security.';
      this.storyStage = 'first-contact';
      this._queueEvent({ type: 'dialogue', speaker: 'YOU', text: 'Who sent that message...?' });
      this._queueEvent({ type: 'banner', title: 'MOVEMENT AHEAD', subtitle: 'Something is on the rooftop with you.' });
      this._startEncounter('first-contact', 9, [2, 0, 1], 3, 1.8, 1.45);
      this._queueEvent({ type: 'objective', text: this.objective });
    } else if (clue.id === 'security-radio') {
      this.objective = this.exitDiscovered
        ? 'Find the residence Janitor. He carries the master key.'
        : 'Check the rooftop stairwell. Find a way out.';
      this.storyStage = 'exit-search';
      this._queueEvent({ type: 'dialogue', speaker: 'YOU', text: 'Someone opened the service doors before this started.' });
      this._queueEvent({ type: 'message', sender: 'UNKNOWN', text: 'Awake already?' });
      this._startEncounter('security-contact', 12, [4, 1, 3, 0], 4, 1.6, 1.65);
      this._queueEvent({ type: 'objective', text: this.objective });
    }

    return result;
  }

  _createPursuitMap() {
    this.navigation = new PursuitMap(this.obstacles,
      -this.mazeWidth * this.cellSize / 2, -this.mazeHeight * this.cellSize / 2,
      this.mazeWidth * this.cellSize, this.mazeHeight * this.cellSize);
  }

  _startEncounter(id, count, spawnIndices = [], groupSize = 4, interval = 1.5, speed = 1.6) {
    if (this.triggeredEncounters.has(id)) return;
    this.triggeredEncounters.add(id);
    const stats = { requested: count, spawned: 0, cancelled: 0 };
    this.encounterStats.set(id, stats);
    // Finite story budget. Unsafe positions and a full pool postpone delivery;
    // neither consumes an enemy nor creates an endless replacement wave.
    this.encounterQueue.push({ id, remaining: count, groupRemaining: Math.min(count, groupSize),
      groupSize, interval, speed, nextAt: this.storyClock, route: 0, spawnIndices, stats });
  }

  _spawnIsVisible(position, camera) {
    if (!camera) return false;
    this._spawnEye.copy(position); this._spawnEye.y = 1.1;
    if (!this._spawnFrustum.intersectsSphere(this._spawnBounds)) return false;
    for (const obs of this.obstacles) {
      if (obs.climbable) continue; // chain-link does not hide an arriving enemy
      const entry = segmentEntry(camera.position.x, camera.position.z, position.x, position.z, obs, 0);
      if (entry === Infinity) continue;
      const height = camera.position.y + (1.1 - camera.position.y) * entry;
      if ((obs.height ?? 2) >= height) return false;
    }
    return true;
  }

  _trySpawn(encounter, camera) {
    const points = this.encounterSpawnPoints;
    if (!points.length || this.zombiePool.availableCount <= 0) return false;
    // Rotate among preferred access routes; fall back to other roof hatches.
    const routes = [...encounter.spawnIndices, ...points.map((_, i) => i)];
    for (let attempt = 0; attempt < routes.length; attempt++) {
      const base = points[routes[(encounter.route + attempt) % routes.length] % points.length];
      for (let offset = 0; offset < 17; offset++) {
        const angle = offset * Math.PI / 4;
        const radius = offset === 0 ? 0 : offset <= 8 ? 1.1 : 2.2;
        const pos = this._spawnPosition.set(base.x + Math.cos(angle) * radius, 0, base.z + Math.sin(angle) * radius);
        if (pos.distanceToSquared(this.lastPlayerPosition) < 64) continue;
        if (this.obstacles.some(o => Math.abs(pos.x - o.x) < (o.halfX ?? o.radius) + 0.5 && Math.abs(pos.z - o.z) < (o.halfZ ?? o.radius) + 0.5)) continue;
        if (this._spawnIsVisible(pos, camera)) continue;
        let occupied = false;
        this.zombiePool.forEachActive(z => { if (z.group.position.distanceToSquared(pos) < 0.64) occupied = true; });
        if (occupied) continue;
        const zombie = this.zombiePool.spawn(pos, { speed: encounter.speed + Math.random() * 0.35 });
        if (!zombie) return false;
        encounter.route = (encounter.route + attempt + 1) % routes.length;
        encounter.remaining--; encounter.groupRemaining--; encounter.stats.spawned++;
        return true;
      }
    }
    return false;
  }

  _updateEncounters(dt, camera = null) {
    if (this.levelComplete) { this._cancelPendingEncounters(); return; }
    this.spawnRetryTimer -= dt;
    if (this.spawnRetryTimer > 0) return;
    this.spawnRetryTimer = 0.25;
    if (camera) {
      camera.updateMatrixWorld();
      this._spawnMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._spawnFrustum.setFromProjectionMatrix(this._spawnMatrix);
    }
    // Latest story beat gets first claim on freed slots if older packs survived.
    let budget = 5;
    for (let i = this.encounterQueue.length - 1; i >= 0 && budget > 0; i--) {
      const encounter = this.encounterQueue[i];
      if (this.storyClock < encounter.nextAt) continue;
      while (encounter.groupRemaining > 0 && budget > 0) {
        if (!this._trySpawn(encounter, camera)) break;
        budget--;
      }
      if (encounter.remaining === 0) this.encounterQueue.splice(i, 1);
      else if (encounter.groupRemaining === 0) {
        encounter.groupRemaining = Math.min(encounter.remaining, encounter.groupSize);
        encounter.nextAt = this.storyClock + encounter.interval;
      }
    }
  }

  _cancelPendingEncounters() {
    for (const encounter of this.encounterQueue) encounter.stats.cancelled += encounter.remaining;
    this.encounterQueue.length = 0;
  }

  _startJanitorEncounter() {
    if (this.janitorEncounterStarted) return;
    this.janitorEncounterStarted = true;
    this._queueEvent({ type: 'alarm' });
    this.janitorBreakoutAt = this.storyClock + 1.5;
    this.janitorReleased = false;
    this.janitorReinforcementsSpawned = false;
    this.janitorEncounterCueShown = true;
    this.storyStage = 'janitor';
    this.encounterName = 'JANITOR ENCLOSURE — LOCKDOWN';
    this.encounterPhase = 'boss';
    this.objective = 'Survive the ambush. The Janitor is breaking out.';

    this._queueEvent({ type: 'banner', title: 'KEY CARRIER LOCATED', subtitle: 'The Janitor is trapped inside the maintenance enclosure.' });
    this._queueEvent({ type: 'dialogue', speaker: 'YOU', text: 'There — the Janitor. Those keys can open the stairwell.' });
    this._queueEvent({ type: 'message', sender: 'UNKNOWN', text: 'Found him. Now let us see if you can get close enough.' });
    this._queueEvent({ type: 'banner', title: 'AMBUSH', subtitle: 'Infected are converging on your position.' });
    this._queueEvent({ type: 'objective', text: this.objective });

    // The encounter starts from a broad discovery zone, so the player can
    // approach from any direction. The ambush is therefore intentional, not
    // dependent on stepping through one doorway or tiny trigger point.
    this._startEncounter('janitor-ambush', 20, [5, 7, 3, 4], 5, 1.25, 1.9);
  }

  isZombieShootable(zombie) {
    // The trapped Janitor is a visible story target, but cannot be shot
    // through the sequence before the player discovers why they need him.
    if (zombie && zombie.isJanitor) return this.janitorReleased;
    return true;
  }

  // =================== ZOMBIES / WAVES ===================
  _setupZombies() {
    this.zombiePool = new ZombiePool(this.scene, 32);
    this.explosionPool = new ExplosionPool(this.scene, 14);

    this.regularSpawnPoints = [];
    this.encounterSpawnPoints = [];
    this.janitorSpawnPoint = null;

    for (let row = 0; row < this.mazeHeight; row++) {
      for (let col = 0; col < this.mazeWidth; col++) {
        const cell = this.maze[row][col];
        if (cell === 'Z') {
          const pos = this._cellToWorld(col, row);
          this.regularSpawnPoints.push(pos);
          this.encounterSpawnPoints.push(pos);
        }
        if (cell === 'J') this.janitorSpawnPoint = this._cellToWorld(col, row);
      }
    }

    if (!this.janitorSpawnPoint) this.janitorSpawnPoint = this._cellToWorld(40, 24);

    // The Janitor exists visibly from the beginning inside the fenced
    // enclosure. He is frozen there until the scripted ambush starts.
    this.janitorZombie = new Zombie(this.scene, this.janitorSpawnPoint, { isJanitor: true });
    this.janitorSpawned = true;
    this.janitorReleased = false;
    this.janitorZombie.speed = 0;
  }

  getWaveStatus() {
    const regularAlive = this.zombiePool ? this.zombiePool.activeCount : 0;
    const janitorAlive = !!(this.janitorZombie && this.janitorZombie.alive);

    if (this.janitorEncounterStarted && janitorAlive) {
      return {
        label: 'JANITOR ENCLOSURE — KEY CARRIER',
        remaining: regularAlive + 1,
        phase: 'boss'
      };
    }
    if (this.janitorKilled && !this.keyCollected) {
      return { label: 'MASTER KEY DROPPED', remaining: regularAlive, phase: 'cleared' };
    }
    if (this.keyCollected) {
      return { label: 'REACH THE STAIRWELL', remaining: regularAlive, phase: 'cleared' };
    }
    return {
      label: this.encounterName,
      remaining: regularAlive,
      phase: this.encounterPhase
    };
  }

  _createExitDoor() {
    for (let row = 0; row < this.mazeHeight; row++) {
      for (let col = 0; col < this.mazeWidth; col++) {
        if (this.maze[row][col] !== 'E') continue;

        const pos = this._cellToWorld(col, row);
        // The interaction point is at the front face of a real stairwell
        // bulkhead rather than at a freestanding magical door.
        this.exitDoorPosition = pos.clone();
        this.exitDoorPosition.z -= 3.55;
        const stairwell = new THREE.Group();
        stairwell.position.copy(pos);

        const concreteMat = new THREE.MeshStandardMaterial({ color: 0x666a6d, roughness: 0.96, metalness: 0.02 });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x25292c, roughness: 0.72, metalness: 0.35 });
        const doorMat = new THREE.MeshStandardMaterial({ color: 0x4b5258, roughness: 0.58, metalness: 0.48 });
        const greenMat = new THREE.MeshStandardMaterial({ color: 0x0b5f2b, emissive: 0x00bb55, emissiveIntensity: 1.1 });

        // Bulkhead: two side walls, rear wall and roof. The open front makes
        // it visually obvious that this structure contains stairs downward.
        const sideGeo = new THREE.BoxGeometry(0.35, 3.4, 5.0);
        const rearGeo = new THREE.BoxGeometry(5.2, 3.4, 0.35);
        const roofGeo = new THREE.BoxGeometry(5.2, 0.28, 5.0);
        const left = new THREE.Mesh(sideGeo, concreteMat);
        left.position.set(-2.45, 1.7, -1.9);
        const right = new THREE.Mesh(sideGeo, concreteMat);
        right.position.set(2.45, 1.7, -1.9);
        const rear = new THREE.Mesh(rearGeo, concreteMat);
        rear.position.set(0, 1.7, -4.25);
        const roof = new THREE.Mesh(roofGeo, concreteMat);
        roof.position.set(0, 3.48, -1.9);
        stairwell.add(left, right, rear, roof);

        // Recessed door in the rear wall, representing the top of the stairs.
        const doorGeo = new THREE.BoxGeometry(1.65, 2.65, 0.16);
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(0, 1.35, -4.02);
        stairwell.add(door);

        const frameTopGeo = new THREE.BoxGeometry(2.0, 0.14, 0.28);
        const frameSideGeo = new THREE.BoxGeometry(0.14, 2.75, 0.28);
        const frameTop = new THREE.Mesh(frameTopGeo, darkMat);
        frameTop.position.set(0, 2.78, -3.90);
        const frameLeft = new THREE.Mesh(frameSideGeo, darkMat);
        frameLeft.position.set(-0.9, 1.4, -3.90);
        const frameRight = frameLeft.clone();
        frameRight.position.x = 0.9;
        stairwell.add(frameTop, frameLeft, frameRight);

        // Short descending stair flight visible through the open front.
        const stepGeo = new THREE.BoxGeometry(3.2, 0.22, 0.72);
        for (let i = 0; i < 4; i++) {
          const step = new THREE.Mesh(stepGeo, darkMat);
          step.position.set(0, 0.11 + i * 0.18, -0.1 - i * 0.68);
          stairwell.add(step);
        }

        const signGeo = new THREE.BoxGeometry(1.15, 0.32, 0.08);
        const sign = new THREE.Mesh(signGeo, greenMat);
        sign.position.set(0, 3.0, -3.82);
        stairwell.add(sign);
        const light = new THREE.PointLight(0x00ff66, 2.2, 8);
        light.position.set(0, 2.8, -2.8);
        stairwell.add(light);

        // Wall-mounted utility boxes/pipes make the structure read as part
        // of a real residence service core rather than a game portal.
        const boxGeo = new THREE.BoxGeometry(0.55, 0.75, 0.22);
        const utility = new THREE.Mesh(boxGeo, darkMat);
        utility.position.set(1.7, 1.25, 0.12);
        stairwell.add(utility);
        const pipeGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8);
        const pipe = new THREE.Mesh(pipeGeo, darkMat);
        pipe.position.set(-1.75, 1.35, 0.12);
        stairwell.add(pipe);

        stairwell.traverse((child) => {
          if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
        });
        this.scene.add(stairwell);
        this.wallMeshes.push(left, right, rear, roof, door);
        this.exitDoor = stairwell;
        this.sceneExtras.push(stairwell);
        this.disposables.push(concreteMat, darkMat, doorMat, greenMat, sideGeo, rearGeo, roofGeo, doorGeo, frameTopGeo, frameSideGeo, stepGeo, signGeo, boxGeo, pipeGeo);

        // Exact bulkhead collision boxes. These match the visible geometry
        // instead of using a row of circles that left diagonal gaps.
        this.obstacles.push({ x: pos.x - 2.45, z: pos.z - 1.9, halfX: 0.175, halfZ: 2.5, radius: 2.5, climbable: false, height: 3.4 });
        this.obstacles.push({ x: pos.x + 2.45, z: pos.z - 1.9, halfX: 0.175, halfZ: 2.5, radius: 2.5, climbable: false, height: 3.4 });
        this.obstacles.push({ x: pos.x, z: pos.z - 4.25, halfX: 2.6, halfZ: 0.175, radius: 2.6, climbable: false, height: 3.4 });
        return;
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
    const ringGeo = new THREE.RingGeometry(0.55, 0.65, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd76a, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.45;
    keyGroup.add(ring);

    const keyLight = new THREE.PointLight(0xffd700, 2, 5);
    keyGroup.add(keyLight);

    this.scene.add(keyGroup);
    this.keyMesh = keyGroup;
  }

  /**
   * Per-frame update. Returns events for Game.js to react to.
   */
  update(dt, player, time, camera = null) {
    this.lastPlayerPosition.copy(player.group.position);
    const events = {
      keyCollected: false,
      levelComplete: false,
      storyEvents: []
    };

    this.storyClock += dt;
    if (!this.storyStarted && this.storyClock > 0.35) {
      this.storyStarted = true;
      this._queueEvent({ type: 'intro', title: 'UNDEAD ATROCITY', subtitle: 'Your ears ring. The rooftop is silent... for now.' });
      this._queueEvent({ type: 'dialogue', speaker: 'YOU', text: 'What happened...? Where is my phone?' });
      this._queueEvent({ type: 'objective', text: this.objective });
    }

    // Blink the opening backpack/phone beacon until the phone is collected.
    const phoneClue = this.clues.find(c => c.id === 'phone');
    if (this.phoneBeaconRing && this.phoneBeaconLight) {
      const active = !!phoneClue && !phoneClue.found;
      this.phoneBeaconRing.visible = active;
      this.phoneBeaconLight.visible = active;
      if (active) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 5.5);
        const scale = 0.90 + pulse * 0.45;
        this.phoneBeaconRing.scale.setScalar(scale);
        this.phoneBeaconRing.material.opacity = 0.28 + pulse * 0.62;
        this.phoneBeaconLight.intensity = 1.2 + pulse * 3.0;
      }
    }

    // Animate evidence markers gently so they are discoverable without giant arrows.
    for (let i = 0; i < this.clues.length; i++) {
      const clue = this.clues[i];
      if (!clue.found && clue.group.visible) {
        clue.group.rotation.y = Math.sin(time * 0.75 + i) * 0.12;
        clue.group.position.y = clue._baseY + Math.sin(time * 1.8 + i) * 0.035;
      }
    }

    this._updateEncounters(dt, camera);
    this.navigation?.update(dt, player.group.position);

    // Rebuild active-zombie snapshot used by shooting and minimap.
    this.zombies.length = 0;
    this.zombiePool.forEachActive((z) => this.zombies.push(z));
    if (this.janitorZombie && this.janitorZombie.alive) this.zombies.push(this.janitorZombie);

    // Regular infected always pursue the player once their encounter begins.
    this.zombiePool.forEachActive((zombie) => {
      const result = zombie.update(dt, player.group.position, this.obstacles, this.navigation, this.zombies);
      if (result.hit) player.takeDamage(result.damage);
    });

    // Janitor is visibly trapped/frozen until the enclosure ambush is triggered.
    if (this.janitorZombie && this.janitorZombie.alive && this.janitorReleased) {
      const result = this.janitorZombie.update(dt, player.group.position, this.obstacles, this.navigation, this.zombies);
      if (result.hit) player.takeDamage(result.damage);
    }

    // Discover locked exit naturally by approaching it before having the key.
    if (this.exitDoorPosition && !player.hasKey && !this.exitDiscovered && this.requiredCluesFound >= this.totalRequiredClues) {
      const exitDist = player.group.position.distanceTo(this.exitDoorPosition);
      if (exitDist < 3.0) {
        this.exitDiscovered = true;
        this.storyStage = 'find-janitor';
        this.objective = this.requiredCluesFound >= this.totalRequiredClues
          ? 'Find the residence Janitor. He carries the master key.'
          : 'The stairwell is locked. Follow the blood trail and investigate security.';
        this._queueEvent({ type: 'lockedExit', title: 'ROOFTOP ACCESS LOCKED', subtitle: 'MASTER KEY REQUIRED' });
        this._queueEvent({ type: 'dialogue', speaker: 'YOU', text: 'The Janitor carries the residence master key.' });
        this._queueEvent({ type: 'objective', text: this.objective });
        // Reaching the locked stairwell makes noise and draws another pack,
        // keeping the investigation active instead of becoming a quiet walk.
        this._startEncounter('stairwell-contact', 16, [5, 7, 3, 4], 4, 1.5, 1.75);
      }
    }

    // Professional Janitor trigger: after the story establishes that the
    // stairwell needs his key, entering a broad 18m discovery radius starts
    // the encounter from ANY approach direction. There is no single doorway
    // or narrow pass-by trigger that the player can accidentally avoid.
    if (!this.janitorEncounterStarted && this.exitDiscovered && this.requiredCluesFound >= this.totalRequiredClues) {
      const distToJanitor = player.group.position.distanceTo(this.janitorSpawnPoint);
      if (distToJanitor < this.janitorEncounterRadius) this._startJanitorEncounter();
    }

    if (this.janitorEncounterStarted && !this.janitorReleased && this.janitorZombie?.alive && this.storyClock >= this.janitorBreakoutAt) {
      this.janitorReleased = true;
      this.janitorZombie.speed = 2.05;
      if (this.janitorGate) {
        this.janitorGate.rotation.x = -Math.PI / 2;
        this.janitorGate.position.y = 0.08;
        this.obstacles.splice(this.obstacles.indexOf(this.janitorGateObstacle), 1);
        this.wallMeshes.splice(this.wallMeshes.indexOf(this.janitorGate), 1);
        this.navigation?.rebuild();
      }
      this.objective = 'The Janitor is loose. Create space and land one clean shot.';
      this.encounterName = 'JANITOR LOOSE — KEY CARRIER';
      this._queueEvent({ type: 'banner', title: 'JANITOR BREAKOUT', subtitle: 'HE IS HUNTING YOU — ONE CLEAN SHOT.' });
      this._queueEvent({ type: 'dialogue', speaker: 'YOU', text: 'He broke out. I need one clear shot at the key carrier.' });
      this._queueEvent({ type: 'objective', text: this.objective });
      if (!this.janitorReinforcementsSpawned) {
        this.janitorReinforcementsSpawned = true;
        this._startEncounter('janitor-reinforcements', 8, [7, 5, 3], 4, 1.5, 1.95);
      }
    }

    // Red maintenance beacon gives the encounter a visible state change.
    if (this.janitorAlarmLight) {
      const active = this.janitorEncounterStarted && this.janitorZombie?.alive;
      const pulse = active ? (0.5 + 0.5 * Math.sin(time * 9.0)) : 0;
      this.janitorAlarmLight.light.intensity = active ? 1.5 + pulse * 4.5 : 0;
      this.janitorAlarmLight.lampMat.emissiveIntensity = active ? 0.35 + pulse * 2.3 : 0.05;
    }

    this.explosionPool.update(dt);

    // Key pickup
    if (this.keyMesh && !this.keyCollected) {
      this.keyMesh.position.y = 0.8 + Math.sin(time * 3) * 0.2;
      this.keyMesh.rotation.y += dt * 2;
      const dist = player.group.position.distanceTo(this.keyMesh.position);
      if (dist < 1.5) {
        this.keyCollected = true;
        player.hasKey = true;
        this.scene.remove(this.keyMesh);
        this.objective = 'Reach the rooftop stairwell and escape.';
        this.encounterName = 'MASTER KEY ACQUIRED';
        this.encounterPhase = 'cleared';
        this._queueEvent({ type: 'banner', title: 'MASTER KEY ACQUIRED', subtitle: 'The stairwell can now be opened.' });
        this._queueEvent({ type: 'objective', text: this.objective });
        events.keyCollected = true;
      }
    }

    // Exit check
    if (this.exitDoorPosition && player.hasKey && !this.levelComplete) {
      const dist = player.group.position.distanceTo(this.exitDoorPosition);
      if (dist < 2.1) {
        this.levelComplete = true;
        this._cancelPendingEncounters();
        this._queueEvent({ type: 'message', sender: 'UNKNOWN', text: "You really don't remember me, do you?" });
        this._queueEvent({ type: 'levelOutro', title: 'ROOFTOP ESCAPED', subtitle: 'Someone is watching.' });
        events.levelComplete = true;
      }
    }

    if (this.exitDoor) {
      this.exitDoor.traverse((child) => {
        if (child.isMesh && child.material.emissive && child.material.emissiveIntensity > 0) {
          child.material.emissiveIntensity = 0.55 + Math.sin(time * 3) * 0.25;
        }
      });
    }

    events.storyEvents = this._drainEvents();
    return events;
  }

  /**
   * Handle a zombie's single-shot kill: pooled explosion VFX, AoE chain
   * reaction against nearby zombies, janitor key drop, and pool release.
   */
  handleZombieKilled(zombie, killedPosition) {
    let chainKills = 0;

    const releaseKilled = (target, position) => {
      if (target.isJanitor) {
        this.janitorKilled = true;
        this._cancelPendingEncounters();
        this.encounterName = 'JANITOR DOWN — COLLECT THE MASTER KEY';
        this.encounterPhase = 'cleared';
        this.objective = "Collect the Janitor's master key.";
        this._queueEvent({ type: 'banner', title: 'JANITOR DOWN', subtitle: 'MASTER KEY DROPPED' });
        this._queueEvent({ type: 'message', sender: 'UNKNOWN', text: 'Nice shot.' });
        this._queueEvent({ type: 'dialogue', speaker: 'YOU', text: 'How could they know I just fired...?' });
        this._queueEvent({ type: 'objective', text: this.objective });
        if (!this.keyCollected) this.spawnKey(position.clone());
      } else {
        this.zombiePool.release(target);
      }
    };

    // The directly-shot zombie has already exploded in Zombie.takeDamage().
    releaseKilled(zombie, killedPosition);

    // True cascading chain reaction: each zombie killed by an explosion can
    // trigger another explosion around its own position.
    const queue = [{ position: killedPosition.clone(), radius: zombie.explosionRadius }];
    const processed = new Set([zombie]);

    while (queue.length > 0) {
      const blast = queue.shift();
      const candidates = [];
      this.zombiePool.forEachActive((z) => candidates.push(z));
      // The Janitor must be killed by the player's deliberate shot, not by
      // collateral chain damage. This preserves the story's key moment.

      for (const other of candidates) {
        if (!other.alive || processed.has(other)) continue;
        if (other.group.position.distanceTo(blast.position) >= blast.radius) continue;

        const chainedPosition = other.group.position.clone();
        other.explode(this.explosionPool);
        processed.add(other);
        chainKills++;

        queue.push({ position: chainedPosition, radius: other.explosionRadius });
        releaseKilled(other, chainedPosition);
      }
    }

    return chainKills;
  }

  getObstacles() {
    return this.obstacles;
  }

  dispose() {
    this._cancelPendingEncounters();
    this.navigation = null;
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
