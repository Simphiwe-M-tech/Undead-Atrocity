/**
 * Undead Atrocity - Entry Point
 *
 * A third-person survival zombie shooter set on a university residence
 * rooftop (Level 1: The Rooftop). Find the Janitor Zombie, kill it for the
 * key, and escape through the stairwell door!
 *
 * Controls:
 *   WASD   - Move
 *   Mouse  - Look / Aim
 *   Click  - Shoot
 *   Shift  - Sprint
 *   Space  - Dodge Roll
 *   C      - Toggle Camera (1st / 3rd person)
 *   R      - Restart Level
 *   Esc    - Pause
 */

import { Game } from './core/Game.js';

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('game-container');
  const game = new Game(container);
  window.__game = game;
});
