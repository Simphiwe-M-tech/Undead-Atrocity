import * as THREE from 'three';
import { RooftopCity } from './RooftopCity.js';
import { createPaverMaterial } from '../utils/PaverMaterial.js';

const GARDEN_DECKS = [
  [1, 6, 10, 9], [14, 2, 19, 4], [30, 8, 33, 14],
  [40, 2, 48, 4], [25, 24, 33, 28], [2, 24, 11, 28],
];

// Visual dressing is kept separate from the narrative and the maze layout.
// Every solid added here joins the same collision, shooting and pursuit lists.
export class RooftopArt {
  constructor(level, kit) {
    this.level = level;
    this.kit = kit;
    this.group = new THREE.Group();
    this.group.name = 'cube-world-rooftop';
    this.resources = new Set();
  }

  build() {
    const { level, kit } = this;
    level.scene.traverse(mesh => {
      if (mesh.isMesh && mesh.userData.kitBlock) {
        kit.replace(mesh, mesh.userData.kitBlock);
      }
    });
    this._deck();
    this._wallDetails();
    this._terrace();
    this._gardens();
    this._serviceDetails();
    this._lighting();
    this._signage();
    const city = new RooftopCity(kit);
    this.city = city;
    city.build();
    this.group.add(city.group);
    this.resources.add(city);
    this._batchDetails();
    // Visual detail batches (foliage, caps, trim) become camera-only blockers:
    // they stop the camera without entering wallMeshes, so bullets, movement
    // and navigation keep treating them as decoration.
    level.cameraBlockers = this.group.children.filter(
      (child) => child.isInstancedMesh && child.name.endsWith('-details'));
    level.scene.add(this.group);
  }

  _block(kind, col, row, y, size, solid = false) {
    const mesh = this.kit.mesh(kind, size);
    mesh.position.copy(this.level._cellToWorld(col, row));
    mesh.position.y = y;
    this.group.add(mesh);
    if (solid) {
      const [x, height, z] = size;
      this.level.obstacles.push({
        x: mesh.position.x, z: mesh.position.z,
        halfX: x / 2, halfZ: z / 2, radius: Math.max(x, z) / 2,
        height: y + height / 2, climbable: false,
      });
      this.level.wallMeshes.push(mesh);
    }
    return mesh;
  }

  _deck() {
    const { level, kit } = this;
    const tiles = { stone: [], wood: [], metal: [], grass: [] };
    for (let row = 1; row < level.mazeHeight - 1; row++) {
      for (let col = 1; col < level.mazeWidth - 1; col++) {
        const terrace = GARDEN_DECKS.some(([left, top, right, bottom]) =>
          col >= left && col <= right && row >= top && row <= bottom);
        const lawn = (col >= 15 && col <= 18 && row >= 2 && row <= 3)
          || (col >= 26 && col <= 32 && row >= 24 && row <= 26);
        const service = (col >= 4 && col <= 9 && row >= 11 && row <= 15)
          || (col >= 24 && col <= 29 && row >= 10 && row <= 14)
          || (col >= 14 && col <= 19 && row >= 22 && row <= 26);
        const zone = lawn ? 'grass' : terrace ? 'wood' : service ? 'metal' : 'stone';
        tiles[zone].push(level._cellToWorld(col, row));
      }
    }
    const transform = new THREE.Object3D();
    for (const [zone, positions] of Object.entries(tiles)) {
      if (zone === 'stone') continue;
      const kind = zone;
      const template = kit.templates.get(kind);
      const batch = new THREE.InstancedMesh(template.geometry, template.material, positions.length);
      batch.name = `cube-world-${zone}-deck`;
      batch.receiveShadow = true;
      positions.forEach((position, index) => {
        // All tiles finish at y=0, preserving evidence decals and player feet.
        transform.position.set(position.x, -0.12, position.z);
        transform.scale.set(level.cellSize - 0.018, 0.24, level.cellSize - 0.018);
        transform.updateMatrix();
        batch.setMatrixAt(index, transform.matrix);
      });
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      this.group.add(batch);
      this.resources.add(batch);
    }
    this._paving(tiles.stone);
    // A continuous substrate closes the joints and gives the roof real depth.
    if (level.ground) level.ground.position.y = -0.245;
    const width = level.mazeWidth * level.cellSize;
    const depth = level.mazeHeight * level.cellSize;
    this._block('masonry', 25, 15, -0.55, [width, 0.6, depth]);
    this._block('stone', 25, 15, -0.25, [width + 0.16, 0.12, depth + 0.16]);
  }

  _paving(cells) {
    const { level } = this;
    const slabWidth = 0.6;
    const slabDepth = 0.4;
    const joint = 0.008;
    const originX = -(level.mazeWidth * level.cellSize) / 2;
    const originZ = -(level.mazeHeight * level.cellSize) / 2;
    const grid = new Set(cells.map(position => {
      const col = Math.round((position.x - originX - level.cellSize / 2) / level.cellSize);
      const row = Math.round((position.z - originZ - level.cellSize / 2) / level.cellSize);
      return `${col},${row}`;
    }));
    const slabs = [];
    // Cut each running-bond row at garden/deck boundaries, rather than letting
    // full-size pavers overlap lawns or wooden terraces.
    for (let row = 1; row < level.mazeHeight - 1; row++) {
      for (let strip = 0; strip < level.cellSize / slabDepth; strip++) {
        const stripIndex = (row - 1) * (level.cellSize / slabDepth) + strip;
        const z = originZ + row * level.cellSize + (strip + 0.5) * slabDepth;
        const shift = (stripIndex % 2) * slabWidth / 2;
        let col = 1;
        while (col < level.mazeWidth - 1) {
          if (!grid.has(`${col},${row}`)) { col++; continue; }
          const first = col;
          while (col < level.mazeWidth - 1 && grid.has(`${col},${row}`)) col++;
          const left = originX + first * level.cellSize;
          const right = originX + col * level.cellSize;
          const anchor = originX + level.cellSize + shift;
          const start = anchor + Math.floor((left - anchor) / slabWidth) * slabWidth;
          for (let x = start; x < right - 0.001; x += slabWidth) {
            const min = Math.max(x, left) + joint / 2;
            const max = Math.min(x + slabWidth, right) - joint / 2;
            if (max - min < 0.01) continue;
            slabs.push({ x: (min + max) / 2, z, width: max - min, strip: stripIndex });
          }
        }
      }
    }
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.computeBoundingBox();
    const { material, map, bumpMap } = createPaverMaterial();
    this.resources.add(geometry); this.resources.add(material);
    this.resources.add(map); this.resources.add(bumpMap);
    const paving = new THREE.InstancedMesh(geometry, material, slabs.length);
    paving.name = 'concrete-paver-deck';
    paving.receiveShadow = true;
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    slabs.forEach((slab, index) => {
      transform.position.set(slab.x, -0.03, slab.z);
      transform.scale.set(slab.width, 0.06, slabDepth - joint);
      transform.rotation.y = index % 2 ? Math.PI : 0;
      transform.updateMatrix();
      paving.setMatrixAt(index, transform.matrix);
      // Subtle variations within the same concrete colour, never a checkerboard.
      const shade = 0.97 + ((Math.imul(index + 1, 97) >>> 0) % 61) / 1000;
      paving.setColorAt(index, color.setRGB(shade, shade, shade));
    });
    paving.instanceMatrix.needsUpdate = true;
    paving.instanceColor.needsUpdate = true;
    paving.computeBoundingBox(); paving.computeBoundingSphere();
    this.group.add(paving); this.resources.add(paving);

    // Mortar lies just below the pavers, making joints shallow and low contrast.
    const bedGeometry = new THREE.BoxGeometry((level.mazeWidth - 2) * level.cellSize, 0.04,
      (level.mazeHeight - 2) * level.cellSize);
    const bedMaterial = new THREE.MeshStandardMaterial({ color: 0x817967, roughness: 1 });
    const bed = new THREE.Mesh(bedGeometry, bedMaterial);
    bed.name = 'paver-joint-bed';
    bed.position.y = -0.03;
    bed.receiveShadow = true;
    this.group.add(bed);
    this.resources.add(bedGeometry); this.resources.add(bedMaterial);
  }

  _wallDetails() {
    const { level } = this;
    for (let row = 0; row < level.mazeHeight; row++) {
      for (let col = 0; col < level.mazeWidth; col++) {
        const cell = level.maze[row][col];
        if (cell === 'W') {
          const room = col >= 37 && col <= 44 && row >= 23 && row <= 28;
          const height = room ? 2.7 : 1.65;
          this._block('stone', col, row, height + 0.05, [2.04, 0.1, 2.04]);
          this._block('stone', col, row, 0.12, [2.03, 0.24, 2.03]);
        }
        if (cell === '#' && (col % 6 === 0 || row % 6 === 0)) {
          const onHorizontalEdge = row === 0 || row === level.mazeHeight - 1;
          const alongEdge = onHorizontalEdge ? col % 6 === 0 : row % 6 === 0;
          if (alongEdge) {
            this._block('brick', col, row, 0.54, [2.1, 1.08, 2.1]);
            this._block('stone', col, row, 1.11, [2.2, 0.12, 2.2]);
          }
        }
        if (cell === 'A') {
          // Concrete plinth and a metal service rim make plant units feel fitted.
          this._block('stone', col, row, 0.08, [1.8, 0.16, 1.8]);
          this._block('metal', col, row, 0.69, [1.64, 0.1, 1.64]);
        }
        if (cell === 'V') this._block('metal', col, row, 0.05, [1.48, 0.1, 1.48]);
      }
    }
  }

  _terrace() {
    // A former residents' seating area in the quiet southwest corner.
    for (const col of [2.6, 10.8]) {
      this._block('masonry', col, 26, 0.34, [1.5, 0.68, 4.0], true);
      this._block('stone', col, 26, 0.68, [1.64, 0.12, 4.14]);
      this._block('grass', col, 26, 0.75, [1.28, 0.1, 3.75]);
      for (const row of [25.4, 26.6]) {
        this._block('bush', col, row, 1.18, [1.2, 0.8, 1.35]);
        this._block('flowers', col + 0.28, row + 0.24, 1.19, [0.42, 0.65, 0.5]);
      }
    }
    for (const col of [4.8, 8.0]) {
      this._block('wood', col, 28, 0.44, [3.6, 0.18, 0.72], true);
      this._block('wood', col, 28.18, 0.86, [3.6, 0.7, 0.14], true);
      for (const offset of [-0.65, 0.65]) {
        this._block('metal', col + offset, 28, 0.21, [0.16, 0.42, 0.65]);
      }
    }
    this._block('crate', 12, 26.5, 0.46, [0.92, 0.92, 0.92], true);
    this._block('crate', 12, 26.5, 1.24, [0.64, 0.64, 0.64], true);
    this._block('crate', 12.55, 27.2, 0.35, [0.7, 0.7, 0.7], true);
  }

  _planter(col, row, width, depth, tree = false) {
    const height = 0.62;
    const base = this._block('masonry', col, row, height / 2, [width, height, depth], true);
    base.userData.gardenPlanter = true;
    this._block('stone', col, row, height, [width + 0.12, 0.1, depth + 0.12]);
    this._block('grass', col, row, height + 0.06, [width - 0.18, 0.08, depth - 0.18]);
    const alongX = width >= depth;
    const length = alongX ? width : depth;
    const plants = Math.max(2, Math.floor(length / 1.55));
    for (let index = 0; index < plants; index++) {
      const offset = (index - (plants - 1) / 2) * (length - 1.1) / Math.max(1, plants - 1);
      const x = col + (alongX ? offset / this.level.cellSize : 0);
      const z = row + (alongX ? 0 : offset / this.level.cellSize);
      this._block(index % 2 ? 'plant' : 'bush', x, z, 1.08, [1.12, 0.76, 1.12]);
      this._block('flowers', x + 0.22, z + 0.15, 1.05, [0.42, 0.66, 0.42]);
    }
    if (tree) {
      const canopy = this._block('tree', col, row, 2.31, [2.5, 3.25, 2.5]);
      // The trunk lies inside the planter's solid footprint; the canopy can
      // overhang the walkway and still participate in camera/weapon raycasts.
      this.level.wallMeshes.push(canopy);
    }
  }

  _bench(col, row) {
    this._block('wood', col, row, 0.44, [3.6, 0.18, 0.72], true);
    this._block('wood', col, row + 0.18, 0.86, [3.6, 0.7, 0.14], true);
    for (const offset of [-0.65, 0.65]) {
      this._block('metal', col + offset, row, 0.21, [0.16, 0.42, 0.65]);
    }
  }

  _gardens() {
    // Garden pockets line the existing routes, leaving hatches and evidence clear.
    for (const [col, row, width, depth, tree] of [
      [2, 7, 1.5, 4, false], [9, 7, 4, 1.5, true],
      [4, 23, 6, 1.5, true],
      [14.5, 3, 1.5, 5, false], [18.5, 2, 5, 1.5, true],
      [32, 9, 6, 1.5, false], [32, 14, 1.5, 3, true],
      [40.5, 3, 1.5, 4, true], [47.5, 3, 1.5, 4, false],
      [26, 24, 5, 1.5, true], [31.5, 28, 6, 1.5, false],
    ]) this._planter(col, row, width, depth, tree);
    for (const [col, row] of [[6, 8.8], [17, 3.8], [31, 11.8], [43, 3.5], [26.5, 27.5]]) {
      this._bench(col, row);
    }

    // Planting on the broad brick partitions turns them into raised garden
    // walls without adding a new collision footprint or altering any doorway.
    for (let row = 1; row < this.level.mazeHeight - 1; row++) {
      for (let col = 1; col < this.level.mazeWidth - 1; col++) {
        if (this.level.maze[row][col] !== 'W' || (col >= 37 && row >= 23)) continue;
        const horizontal = this.level.maze[row][col - 1] === 'W' || this.level.maze[row][col + 1] === 'W';
        if (horizontal ? col % 3 !== 0 : row % 3 !== 0) continue;
        this._block('wood', col, row, 1.78, [1.6, 0.12, 1.6]);
        this._block('grass', col, row, 1.87, [1.43, 0.08, 1.43]);
        this._block('bush', col, row, 2.2, [1.2, 0.62, 1.2]);
        this._block('flowers', col + 0.34, row + 0.26, 2.19, [0.4, 0.57, 0.4]);
      }
    }
  }

  _serviceDetails() {
    // Narrow coping around each hatch; no new obstruction at spawn points.
    for (const point of this.level.encounterSpawnPoints) {
      const col = (point.x + this.level.mazeWidth - 1) / this.level.cellSize;
      const row = (point.z + this.level.mazeHeight - 1) / this.level.cellSize;
      for (const side of [-1, 1]) {
        this._block('metal', col, row + side * 0.5, 0.026, [1.7, 0.045, 0.12]);
      }
    }
    // Concrete coping finishes the escape building and maintenance entrance.
    const exit = this.level.exitDoor;
    if (exit) {
      const col = (exit.position.x + this.level.mazeWidth - 1) / this.level.cellSize;
      const row = (exit.position.z + this.level.mazeHeight - 1) / this.level.cellSize;
      this._block('stone', col, row - 0.95, 3.65, [5.46, 0.16, 5.26]);
      this._block('stone', col, row - 2.12, 0.22, [5.24, 0.44, 0.38]);
    }
    // An opaque door and lintel complete the solid-walled Janitor room.
    this._block('brick', 40.5, 28, 2.5, [4.0, 0.4, 2.0]);
    this._block('stone', 40.5, 28, 2.75, [4.1, 0.1, 2.1]);
  }

  _lighting() {
    const material = new THREE.MeshBasicMaterial({ color: 0xffe4ba });
    this.resources.add(material);
    for (const col of [3, 9, 15, 21, 27, 33, 39, 45]) {
      for (const row of [0, this.level.mazeHeight - 1]) {
        this._block('metal', col, row, 1.14, [0.55, 0.18, 0.55]);
        const lamp = this._block('stone', col, row, 1.25, [0.38, 0.08, 0.38]);
        lamp.material = material;
        lamp.castShadow = false;
      }
    }
    // Small warm lamps supplement the cool moonlight without tinting materials.
    for (const [col, row, intensity] of [[5, 2, 12], [6, 26, 18]]) {
      const light = new THREE.PointLight(0xffdfb4, intensity, 18, 2);
      light.position.copy(this.level._cellToWorld(col, row));
      light.position.y = 3.4;
      this.group.add(light);
    }
  }

  _signage() {
    for (const [col, row, text, color] of [
      [40.5, 28.55, 'MAINTENANCE', '#deddd4'],
    ]) {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#252724'; ctx.fillRect(0, 0, 1024, 128);
      ctx.fillStyle = color; ctx.fillRect(0, 0, 14, 128);
      ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(text, 512, 87);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: texture });
      this.resources.add(texture); this.resources.add(material);
      const wallSign = col > 37;
      const geometry = new THREE.PlaneGeometry(wallSign ? 3.6 : 8, wallSign ? 0.45 : 1);
      this.resources.add(geometry);
      const sign = new THREE.Mesh(geometry, material);
      sign.name = 'rooftop-zone-sign';
      sign.position.copy(this.level._cellToWorld(col, row));
      sign.position.y = wallSign ? 2.12 : 0.009;
      if (!wallSign) sign.rotation.x = -Math.PI / 2;
      this.group.add(sign);
    }
  }

  _batchDetails() {
    // Caps, planting and trim share draw calls. Solid furniture stays as
    // individual meshes for the camera, minimap and weapon raycasts.
    const solids = new Set(this.level.wallMeshes);
    const batches = new Map();
    for (const mesh of [...this.group.children]) {
      if (!mesh.isMesh || mesh.isInstancedMesh || solids.has(mesh)) continue;
      const key = `${mesh.geometry.uuid}/${mesh.material.uuid}/${mesh.castShadow}`;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(mesh);
    }
    for (const meshes of batches.values()) {
      if (meshes.length < 2) continue;
      const source = meshes[0];
      const batch = new THREE.InstancedMesh(source.geometry, source.material, meshes.length);
      batch.name = `${source.name}-details`;
      batch.castShadow = source.castShadow;
      batch.receiveShadow = true;
      meshes.forEach((mesh, index) => {
        mesh.updateMatrix();
        batch.setMatrixAt(index, mesh.matrix);
        mesh.removeFromParent();
      });
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      this.group.add(batch);
      this.resources.add(batch);
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.kit.dispose();
  }
}
