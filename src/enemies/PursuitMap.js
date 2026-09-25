// Shared terrain queries for enemy steering. Player collision is independent.
export function segmentEntry(x, z, tx, tz, obstacle, padding = 0.45) {
  const hx = (obstacle.halfX ?? obstacle.radius) + padding;
  const hz = (obstacle.halfZ ?? obstacle.radius) + padding;
  let near = 0, far = 1;
  for (let axis = 0; axis < 2; axis++) {
    const start = axis ? z : x;
    const delta = axis ? tz - z : tx - x;
    const centre = axis ? obstacle.z : obstacle.x;
    const half = axis ? hz : hx;
    if (Math.abs(delta) < 1e-8) {
      if (start <= centre - half || start >= centre + half) return Infinity;
    } else {
      const a = (centre - half - start) / delta;
      const b = (centre + half - start) / delta;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near >= far) return Infinity;
    }
  }
  return near;
}

export function clearSegment(x, z, tx, tz, obstacles, padding = 0.45) {
  for (const obstacle of obstacles) {
    if (!obstacle.climbable && segmentEntry(x, z, tx, tz, obstacle, padding) !== Infinity) return false;
  }
  return true;
}

/** One small breadth-first distance field for the whole horde, not per-enemy A*.
 * Terrain edges are cached until a gate changes. Target refresh is at most 4Hz.
 * Fences are traversable here; Zombie retains the actual climbing animation.
 */
export class PursuitMap {
  constructor(obstacles, minX, minZ, width, depth) {
    this.obstacles = obstacles;
    this.minX = minX; this.minZ = minZ;
    this.width = Math.ceil(width) + 1; this.depth = Math.ceil(depth) + 1;
    const count = this.width * this.depth;
    this.edges = new Uint8Array(count);
    this.open = new Uint8Array(count);
    this.landing = new Uint8Array(count);
    this.distance = new Int32Array(count);
    this.queue = new Int32Array(count);
    this.offsets = [1, -1, this.width, -this.width];
    this.target = -1; this.cooldown = 0; this.rebuild();
  }

  rebuild() {
    const { width, depth } = this;
    for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
      this.open[z * width + x] = clearSegment(this.minX + x, this.minZ + z,
        this.minX + x, this.minZ + z, this.obstacles) ? 1 : 0;
      this.landing[z * width + x] = this.obstacles.some(o => o.climbable &&
        segmentEntry(this.minX + x, this.minZ + z, this.minX + x, this.minZ + z, o) !== Infinity) ? 0 : 1;
    }
    this.edges.fill(0);
    for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
      const i = z * width + x;
      if (!this.open[i]) continue;
      for (const d of [0, 2]) {
        const nx = x + (d === 0 ? 1 : 0), nz = z + (d === 2 ? 1 : 0);
        const j = nz * width + nx;
        if (nx >= width || nz >= depth || !this.open[j]) continue;
        if (clearSegment(this.minX + x, this.minZ + z, this.minX + nx, this.minZ + nz, this.obstacles)) {
          this.edges[i] |= 1 << d;
          this.edges[j] |= 1 << (d + 1);
        }
      }
    }
    this.target = -1; this.cooldown = 0; this.distance.fill(-1);
  }

  update(dt, target) {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown = 0.25;
    const cx = Math.round(target.x - this.minX), cz = Math.round(target.z - this.minZ);
    let seed = -1, closest = Infinity;
    // The player may stand closer to a prop than the centre of a grid cell.
    for (let z = cz - 2; z <= cz + 2; z++) for (let x = cx - 2; x <= cx + 2; x++) {
      if (x < 0 || z < 0 || x >= this.width || z >= this.depth) continue;
      const i = z * this.width + x;
      const distance = (this.minX + x - target.x) ** 2 + (this.minZ + z - target.z) ** 2;
      if (this.open[i] && distance < closest && clearSegment(target.x, target.z, this.minX + x, this.minZ + z, this.obstacles)) {
        seed = i; closest = distance;
      }
    }
    if (seed === this.target) return;
    this.target = seed; this.distance.fill(-1);
    if (seed < 0) return;
    let read = 0, write = 1;
    this.queue[0] = seed; this.distance[seed] = 0;
    while (read < write) {
      const i = this.queue[read++];
      for (let d = 0; d < 4; d++) {
        if (!(this.edges[i] & (1 << d))) continue;
        const j = i + this.offsets[d];
        if (this.distance[j] >= 0) continue;
        this.distance[j] = this.distance[i] + 1;
        this.queue[write++] = j;
      }
    }
  }

  waypoint(position, target, output, side = 1) {
    if (clearSegment(position.x, position.z, target.x, target.z, this.obstacles)) {
      output.copy(target); return true;
    }
    const cx = Math.round(position.x - this.minX), cz = Math.round(position.z - this.minZ);
    let best = Infinity, found = false;
    // A few nearby candidates smooth grid turns and offer alternative lanes.
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx * side, z = cz + dz;
      if (x < 0 || z < 0 || x >= this.width || z >= this.depth) continue;
      const i = z * this.width + x;
      if (this.distance[i] < 0 || !this.landing[i]) continue;
      const wx = this.minX + x, wz = this.minZ + z;
      const travel = Math.hypot(wx - position.x, wz - position.z);
      if (travel < 0.15) continue;
      const score = this.distance[i] + travel;
      if (score >= best || !clearSegment(position.x, position.z, wx, wz, this.obstacles)) continue;
      best = score; output.set(wx, 0, wz); found = true;
    }
    return found;
  }
}
