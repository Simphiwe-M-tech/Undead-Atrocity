import * as THREE from 'three';

// Surrounding architecture is scenery beyond the parapet, so it never enters
// the rooftop's navigation or weapon collision lists. Repetition is instanced.
export class RooftopCity {
  constructor(kit) {
    this.kit = kit;
    this.group = new THREE.Group();
    this.group.name = 'surrounding-city';
    this.resources = new Set();
    this.batches = new Map();
    this.buildings = [];
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.resources.add(this.box);
  }

  _material(color, unlit = false) {
    const material = unlit ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.92 });
    this.resources.add(material);
    return material;
  }

  _piece(material, x, y, z, width, height, depth, geometry = this.box) {
    const key = `${material.uuid}/${geometry.uuid}`;
    if (!this.batches.has(key)) this.batches.set(key, { material, geometry, transforms: [] });
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion(), new THREE.Vector3(width, height, depth));
    this.batches.get(key).transforms.push(transform);
  }

  build() {
    const facades = [0x96958d, 0x887669, 0x8b8b88, 0xaca99d, 0x797f82, 0x9a9384].map(c => this._material(c));
    const trim = this._material(0x3f4447);
    const warm = this._material(0xffd99a, true);
    const cool = this._material(0xe4e6df, true);
    const dark = this._material(0x182c43);
    const base = -26;
    let index = 0;
    const building = (x, z, width, depth, top) => {
      const number = index++;
      const height = top - base;
      this.buildings.push({ x, z, width, depth, top });
      this._piece(facades[number % facades.length], x, base + height / 2, z,
        width, height, depth, this.kit.templates.get('stone').geometry);
      this._piece(trim, x, top + 0.18, z, width + 0.7, 0.36, depth + 0.7);
      this._piece(trim, x - width * 0.2, top + 0.9, z + depth * 0.1, 3.2, 1.45, 2.5);
      const floors = Math.floor(height / 3.6);
      for (let floor = 0; floor < floors; floor++) {
        const y = base + 2 + floor * 3.6;
        if (floor % 3 === 0) this._piece(trim, x, y - 1.4, z, width + 0.1, 0.18, depth + 0.1);
        for (let column = 0; column < Math.floor(width / 3.4); column++) {
          const wx = x - width / 2 + 2 + column * 3.4;
          const material = (floor + column + number) % 5 === 0 ? dark : number % 3 === 0 ? cool : warm;
          for (const side of [-1, 1]) this._piece(material, wx, y, z + side * (depth / 2 + 0.035), 1.35, 1.5, 0.055);
        }
        for (let column = 0; column < Math.floor(depth / 3.4); column++) {
          const wz = z - depth / 2 + 2 + column * 3.4;
          const material = (floor + column + number) % 4 === 0 ? dark : number % 2 === 0 ? warm : cool;
          for (const side of [-1, 1]) this._piece(material, x + side * (width / 2 + 0.035), y, wz, 0.055, 1.5, 1.35);
        }
      }
    };

    // Near buildings stand across visible streets on all four sides.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 8; i++) building(-115 + i * 33, side * (65 + (i % 3) * 8),
        20 + (i % 3) * 4, 18 + (i % 2) * 6, 5 + ((i * 7 + (side + 1) * 3) % 26));
      for (let i = 0; i < 4; i++) building(side * (83 + (i % 2) * 9), -49 + i * 34,
        20, 23, 9 + ((i * 11 + (side + 1) * 5) % 29));
      for (let i = 0; i < 6; i++) building(-153 + i * 59, side * (135 + (i % 2) * 14),
        29 + (i % 2) * 8, 27, 20 + ((i * 13 + (side + 1) * 4) % 42));
      for (let i = 0; i < 3; i++) building(side * 166, -78 + i * 77, 30, 33, 28 + i * 15);
    }

    // The residence continues down below the playable roof, with seven floors.
    this._piece(facades[0], 0, -13.25, 0, 102, 25.8, 62, this.kit.templates.get('stone').geometry);
    for (let floor = 0; floor < 7; floor++) {
      const y = -24 + floor * 3.4;
      this._piece(trim, 0, y - 1.25, 0, 102.3, 0.18, 62.3);
      for (let x = -47; x < 49; x += 4) for (const side of [-1, 1]) {
        this._piece((floor + x) % 3 === 0 ? dark : warm, x, y, side * 31.04, 1.8, 1.6, 0.06);
      }
      for (let z = -27; z < 29; z += 4) for (const side of [-1, 1]) {
        this._piece(cool, side * 51.04, y, z, 0.06, 1.6, 1.8);
      }
    }
    const ground = this._material(0x1a2c40);
    this._piece(ground, 0, -26.5, 0, 510, 0.5, 510);
    const pavement = this._material(0x697e8d);
    this._piece(pavement, 0, -26.15, 0, 111, 0.3, 71);
    for (let i = -230; i <= 230; i += 12) {
      for (const side of [-1, 1]) {
        this._piece(warm, i, -26.2, side * 45, 4, 0.035, 0.18);
        this._piece(warm, side * 65, -26.2, i, 0.18, 0.035, 4);
      }
    }

    for (const { material, geometry, transforms } of this.batches.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
      mesh.name = 'city-architecture';
      transforms.forEach((transform, i) => mesh.setMatrixAt(i, transform));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.resources.add(mesh);
    }
    this.batches.clear();
  }

  dispose() {
    this.group.removeFromParent();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }
}
