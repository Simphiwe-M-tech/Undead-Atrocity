/**
 * ObjectPool - Generic reusable object pool.
 *
 * Used throughout Undead Atrocity (bullets, zombies, explosion particles) to
 * avoid `new`/`dispose()` churn during gameplay, which otherwise triggers
 * frequent garbage-collection pauses and frame stutter - especially painful
 * on a modest LAMP-hosted deployment target.
 *
 * Usage:
 *   const pool = new ObjectPool(() => factoryFn(), (obj, ...args) => resetFn(obj, ...args), 32);
 *   const obj = pool.acquire(x, y, z);
 *   pool.release(obj);
 */
export class ObjectPool {
  /**
   * @param {() => any} factory - Creates a brand-new instance. Called only while growing the pool.
   * @param {(obj: any, ...args: any[]) => void} [resetFn] - Re-initializes a recycled instance before use.
   * @param {number} [initialSize=0] - Number of instances to pre-warm immediately.
   */
  constructor(factory, resetFn = null, initialSize = 0) {
    this._factory = factory;
    this._reset = resetFn;
    this._free = [];
    this._active = new Set();

    for (let i = 0; i < initialSize; i++) {
      this._free.push(this._factory());
    }
  }

  /** Pull a free instance from the pool (creating one if empty) and mark it active. */
  acquire(...args) {
    let obj = this._free.pop();
    if (!obj) obj = this._factory();
    if (this._reset) this._reset(obj, ...args);
    this._active.add(obj);
    return obj;
  }

  /** Return an instance to the pool so it can be reused later. */
  release(obj) {
    if (!this._active.has(obj)) return;
    this._active.delete(obj);
    this._free.push(obj);
  }

  /** Release every currently active instance at once (e.g. level restart). */
  releaseAll() {
    for (const obj of this._active) this._free.push(obj);
    this._active.clear();
  }

  /** Iterate all currently active instances. */
  forEachActive(fn) {
    this._active.forEach(fn);
  }

  /** Iterate every instance the pool has ever created, active or free (e.g. for full disposal). */
  forEachAll(fn) {
    this._active.forEach(fn);
    this._free.forEach(fn);
  }

  /** Drops all references (active and free) without disposing them - caller is responsible for cleanup. */
  clear() {
    this._active.clear();
    this._free.length = 0;
  }

  get activeCount() {
    return this._active.size;
  }

  get pooledCount() {
    return this._free.length + this._active.size;
  }
}
