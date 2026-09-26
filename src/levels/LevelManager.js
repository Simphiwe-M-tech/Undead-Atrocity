import { Level1 } from './Level1.js';
import { Level2 } from './Level2.js';

/**
 * LevelManager - Orchestrates level transitions with proper asset disposal.
 */
export class LevelManager {
  constructor(scene) {
    this.scene = scene;
    this.currentLevel = null;
    this.currentLevelIndex = 0;
    this.totalLevels = 2;
  }

  _getLevelClass(index) {
    switch (index) {
      case 0: return Level1;
      case 1: return Level2;
      default: return null;
    }
  }

  async loadLevel(index, onProgress) {
    if (this.currentLevel) {
      console.log(`[DEFENSIVE LOG] LevelManager.loadLevel disposing previous level.`);
      this.currentLevel.dispose();
      this.currentLevel = null;
    }
    const LevelClass = this._getLevelClass(index);
    if (!LevelClass) throw new Error(`No level class for index ${index}`);
    const level = new LevelClass(this.scene);
    await level.load(onProgress);
    this.currentLevel = level;
    this.currentLevelIndex = index;
    return level;
  }

  async restartLevel(onProgress) {
    return this.loadLevel(this.currentLevelIndex, onProgress);
  }

  async nextLevel(onProgress) {
    const next = this.currentLevelIndex + 1;
    if (next >= this.totalLevels) return null;
    return this.loadLevel(next, onProgress);
  }

  isGameComplete() {
    return this.currentLevel && this.currentLevel.levelComplete;
  }
}
