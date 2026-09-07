import { Zombie } from './Zombie.js';
import { ObjectPool } from '../core/ObjectPool.js';

/**
 * ZombiePool - Pre-builds a fixed roster of regular Zombie instances and
 * recycles them across all waves of Level 1, instead of constructing (and
 * later disposing) enemy geometry every wave. The Janitor Zombie is unique
 * per level and is owned separately since it never needs recycling.
 */
export class ZombiePool {
  constructor(scene, maxConcurrent = 16) {
    this.scene = scene;
    this.maxConcurrent = maxConcurrent;
    this.pool = new ObjectPool(
      () => new Zombie(scene, { x: 0, y: 0, z: 0 }, { isJanitor: false }),
      (zombie, position, options) => zombie.spawn(position, options),
      maxConcurrent
    );
  }

  /** Activates (or reuses) one zombie at `position`. */
  spawn(position, options = {}) {
    return this.pool.acquire(position, options);
  }

  /** Returns a zombie to the pool once its explosion has been resolved. */
  release(zombie) {
    zombie.deactivate();
    this.pool.release(zombie);
  }

  forEachActive(fn) {
    this.pool.forEachActive(fn);
  }

  get activeCount() {
    return this.pool.activeCount;
  }

  get availableCount() {
    return this.pool.pooledCount - this.pool.activeCount;
  }

  dispose() {
    this.pool.forEachAll((zombie) => zombie.dispose());
    this.pool.clear();
  }
}
