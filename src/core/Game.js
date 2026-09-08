import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { Player } from '../player/Player.js';
import { LevelManager } from '../levels/LevelManager.js';
import { BulletPool } from '../weapons/Bullet.js';
import { StoryUI } from '../ui/StoryUI.js';

/**
 * Game - Top-level orchestrator for Maze Zombies.
 * Manages render loop, shooting, explosions, key/exit, HUD, and state machine.
 */
export class Game {
  constructor(container) {
    this.container = container;

    // ---- State machine ----
    this.STATE = {
      MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused',
      GAMEOVER: 'gameover', LEVELCOMPLETE: 'levelcomplete',
      WIN: 'win', LOADING: 'loading'
    };
    this.state = this.STATE.MENU;

    // ---- Three.js basics ----
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.1, 500
    );

    // ---- Input ----
    this.input = new InputManager();

    // ---- Player ----
    this.player = null;

    // ---- Level Manager ----
    this.levelManager = new LevelManager(this.scene);
    this.currentLevel = null;

    // ---- Shooting ----
    this.raycaster = new THREE.Raycaster();
    this.shootCooldown = 0;
    this.shootRate = 0.25;
    this.shootRange = 80;
    this.muzzleFlashLight = null;

    // Pooled tracer bullets - avoids per-shot geometry allocation/GC.
    this.bulletPool = new BulletPool(this.scene, 24);

    // ---- Timing ----
    this.clock = new THREE.Clock();
    this.elapsedTime = 0;

    // ---- HUD references ----
    this.hudEl = document.getElementById('hud');
    this.healthBarFill = document.getElementById('health-bar-fill');
    this.scoreDisplay = document.getElementById('score-display');
    this.levelTitleDisplay = document.getElementById('level-title-display');
    this.keyIndicator = document.getElementById('key-indicator');
    this.minimapCanvas = document.getElementById('minimap');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    // Extra Level 1 combat HUD is created from JavaScript so no index.html
    // change is required for this phase.
    this._ensureCombatHUD();
    this.chainMessageTimer = 0;

    // Narrative / evidence UI for the revised Level 1 story mission.
    this.storyUI = new StoryUI(this.hudEl);
    this.pendingLevelCompleteTimer = 0;

    // ---- Resize ----
    window.addEventListener('resize', () => this._onResize());

    // ---- Bind UI ----
    this._bindUI();

    // ---- Start render loop ----
    this._animate();
  }

  _ensureCombatHUD() {
    const ensure = (id, className = '') => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        if (className) el.className = className;
        this.hudEl.appendChild(el);
      }
      return el;
    };

    this.waveDisplay = ensure('wave-display');
    this.enemyCountDisplay = ensure('enemy-count-display');
    this.chainDisplay = ensure('chain-display', 'hidden');
  }

  _showChainMessage(totalKills, bonusScore) {
    if (!this.chainDisplay || totalKills < 2) return;

    let title = 'CHAIN REACTION';
    if (totalKills >= 8) title = 'TOTAL CONTAMINATION';
    else if (totalKills >= 5) title = 'OUTBREAK DOMINO';
    else if (totalKills >= 3) title = 'CHAIN REACTION';
    else title = 'DOUBLE INFECTION';

    this.chainDisplay.innerHTML = `${title}<span>CHAIN x${totalKills} &nbsp; +${bonusScore.toLocaleString()}</span>`;
    this.chainDisplay.classList.remove('hidden');
    this.chainDisplay.classList.remove('pop');
    void this.chainDisplay.offsetWidth;
    this.chainDisplay.classList.add('pop');
    this.chainMessageTimer = 1.6;
  }

  _resetCombatHUD() {
    if (this.waveDisplay) this.waveDisplay.textContent = '';
    if (this.enemyCountDisplay) this.enemyCountDisplay.textContent = '';
    if (this.chainDisplay) this.chainDisplay.classList.add('hidden');
    this.chainMessageTimer = 0;
  }

  // =====================================================================
  // UI Binding
  // =====================================================================
  _bindUI() {
    document.getElementById('btn-start').addEventListener('click', () => this.startGame());
    document.getElementById('btn-credits').addEventListener('click', () => this._showOverlay('credits-overlay'));
    document.getElementById('btn-options').addEventListener('click', () => this._showOverlay('options-overlay'));
    document.getElementById('btn-credits-back').addEventListener('click', () => this._showOverlay('menu-overlay'));
    document.getElementById('btn-options-back').addEventListener('click', () => this._showOverlay('menu-overlay'));

    document.getElementById('sensitivity-slider').addEventListener('input', (e) => {
      if (this.player) this.player.mouseSensitivity = e.target.value * 0.001;
    });

    document.getElementById('pause-overlay').addEventListener('click', () => this.resume());
    document.getElementById('btn-retry').addEventListener('click', () => this.restartLevel());
    document.getElementById('btn-menu').addEventListener('click', () => this.returnToMenu());
    document.getElementById('btn-nextlevel').addEventListener('click', () => this.showWin());
    document.getElementById('btn-win-menu').addEventListener('click', () => this.returnToMenu());
  }

  _showOverlay(id) {
    const overlays = [
      'menu-overlay', 'credits-overlay', 'options-overlay', 'loading-overlay',
      'pause-overlay', 'gameover-overlay', 'levelcomplete-overlay', 'win-overlay'
    ];
    overlays.forEach(o => document.getElementById(o).classList.add('hidden'));
    if (id) document.getElementById(id).classList.remove('hidden');
  }

  // =====================================================================
  // State Transitions
  // =====================================================================
  async startGame() {
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';

    const level = await this.levelManager.loadLevel(0, (p) => {
      progressBar.style.width = `${p * 100}%`;
    });
    this.currentLevel = level;

    if (this.player) this.player.dispose();
    this.player = new Player(this.scene, this.input, this.camera);
    this.player.group.position.copy(level.spawnPoint);
    this.player.setCollidableMeshes(level.wallMeshes);

    // Muzzle flash light
    this.muzzleFlashLight = new THREE.PointLight(0xffaa00, 0, 5);
    this.player.gunGroup.add(this.muzzleFlashLight);

    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.keyIndicator.classList.add('hidden');
    this._resetCombatHUD();
    this.storyUI.reset();

    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);

    this.input.requestPointerLock(this.renderer.domElement);
  }

  async restartLevel() {
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';

    const level = await this.levelManager.restartLevel((p) => {
      progressBar.style.width = `${p * 100}%`;
    });
    this.currentLevel = level;

    if (this.player) {
      this.player.reset(level.spawnPoint);
      this.player.setCollidableMeshes(level.wallMeshes);
    }

    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.keyIndicator.classList.add('hidden');
    this._resetCombatHUD();
    this.storyUI.reset();

    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);
    this.input.requestPointerLock(this.renderer.domElement);
  }

  showWin() {
    this.state = this.STATE.WIN;
    this._showOverlay('win-overlay');
    this.hudEl.classList.add('hidden');
  }

  resume() {
    if (this.state !== this.STATE.PAUSED) return;
    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.input.requestPointerLock(this.renderer.domElement);
  }

  returnToMenu() {
    this.state = this.STATE.MENU;
    if (this.player) {
      this.player.dispose();
      this.player = null;
    }
    if (this.currentLevel) {
      this.currentLevel.dispose();
      this.currentLevel = null;
    }
    this.hudEl.classList.add('hidden');
    this._showOverlay('menu-overlay');
  }

  gameOver() {
    this.state = this.STATE.GAMEOVER;
    this._showOverlay('gameover-overlay');
    this.hudEl.classList.add('hidden');
    document.exitPointerLock();
  }

  // =====================================================================
  // Shooting - hitscan rifle, single successful shot kills a zombie
  // =====================================================================
  _handleShooting(dt) {
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);

    if (this.input.isMouseButtonDown(0) && this.shootCooldown <= 0 && this.input.pointerLocked) {
      this.shootCooldown = this.shootRate;

      // Raycast from camera center
      const direction = new THREE.Vector3(0, 0, -1);
      direction.applyQuaternion(this.camera.quaternion);
      this.raycaster.set(this.camera.position, direction);
      this.raycaster.far = this.shootRange;

      // Collect all zombie meshes
      const zombieMeshes = [];
      for (const zombie of this.currentLevel.zombies) {
        if (zombie.alive && (!this.currentLevel.isZombieShootable || this.currentLevel.isZombieShootable(zombie))) {
          zombie.group.traverse((child) => {
            if (child.isMesh) zombieMeshes.push(child);
          });
        }
      }

      // Include wall meshes so walls block bullets
      const wallMeshes = this.currentLevel.wallMeshes || [];
      const shootableObjects = [...zombieMeshes, ...wallMeshes];

      const hits = this.raycaster.intersectObjects(shootableObjects, false);

      // Pooled tracer bullet - visual feedback only, travels to the hit point
      // (or to max range if nothing was hit), then recycles automatically.
      const tracerEnd = hits.length > 0
        ? hits[0].point
        : this.camera.position.clone().addScaledVector(direction, this.shootRange);
      this.bulletPool.fire(this.player.getMuzzleWorldPosition(), tracerEnd);

      if (hits.length > 0) {
        const hitObject = hits[0].object;

        // Find which zombie was hit
        for (const zombie of this.currentLevel.zombies) {
          if (!zombie.alive) continue;
          if (this.currentLevel.isZombieShootable && !this.currentLevel.isZombieShootable(zombie)) continue;
          let isThisZombie = false;
          zombie.group.traverse((child) => {
            if (child === hitObject) isThisZombie = true;
          });

          if (isThisZombie) {
            const result = zombie.takeDamage(this.currentLevel.explosionPool);
            if (result.exploded) {
              // Single shot kill - zombie explodes, dealing AoE chain damage.
              this.player.addScore(300);

              const chainKills = this.currentLevel.handleZombieKilled(
                zombie, zombie.group.position.clone()
              );

              // Award points for chain kills and celebrate meaningful cascades.
              const chainBonus = chainKills * 500;
              this.player.addScore(chainBonus);
              this._showChainMessage(1 + chainKills, 300 + chainBonus);
            }
            break;
          }
        }
      }

      // Muzzle flash
      if (this.muzzleFlashLight) {
        this.muzzleFlashLight.intensity = 5;
        setTimeout(() => {
          if (this.muzzleFlashLight) this.muzzleFlashLight.intensity = 0;
        }, 50);
      }
    }
  }

  // =====================================================================
  // Story / Investigation
  // =====================================================================
  _handleStoryEvent(event) {
    if (!event || !this.storyUI) return;
    if (event.type === 'intro') {
      this.storyUI.showIntro(event.title, event.subtitle);
    } else if (event.type === 'objective') {
      this.storyUI.setObjective(event.text);
    } else if (event.type === 'message') {
      this.storyUI.showMessage(event.sender, event.text);
    } else if (event.type === 'dialogue') {
      this.storyUI.showDialogue(event.speaker, event.text);
    } else if (event.type === 'banner' || event.type === 'lockedExit' || event.type === 'levelOutro') {
      this.storyUI.showBanner(event.title, event.subtitle, event.type === 'levelOutro' ? 3.2 : 2.6);
    }
  }

  _handleStoryEvents(events = []) {
    for (const event of events) this._handleStoryEvent(event);
  }

  _handleInteraction() {
    if (!this.currentLevel || !this.player || !this.storyUI) return;

    const nearby = this.currentLevel.getNearbyInteraction?.(this.player.group.position);
    if (nearby) this.storyUI.showInteraction(nearby.label);
    else this.storyUI.hideInteraction();

    if (this.input.isDown('KeyE')) {
      this.input.keys['KeyE'] = false;
      const result = this.currentLevel.interact?.(this.player.group.position);
      if (result?.type === 'evidence') {
        document.exitPointerLock();
        this.storyUI.showEvidence(result.evidence);
      }
    }
  }

  _closeEvidenceIfRequested() {
    if (!this.storyUI?.isEvidenceOpen) return false;
    if (this.input.isDown('KeyE') || this.input.isDown('Escape')) {
      this.input.keys['KeyE'] = false;
      this.input.keys['Escape'] = false;
      this.storyUI.closeEvidence();
      this.input.requestPointerLock(this.renderer.domElement);
    }
    return true;
  }

  // =====================================================================
  // HUD Updates
  // =====================================================================
  _updateHUD() {
    if (!this.player) return;

    // Health bar
    const healthPct = (this.player.health / this.player.maxHealth) * 100;
    this.healthBarFill.style.width = `${healthPct}%`;
    this.healthBarFill.classList.remove('low', 'medium');
    if (healthPct < 30) this.healthBarFill.classList.add('low');
    else if (healthPct < 60) this.healthBarFill.classList.add('medium');

    // Score
    this.scoreDisplay.textContent = `Score: ${this.player.score}`;

    // Designed wave / encounter status
    if (this.currentLevel && this.currentLevel.getWaveStatus) {
      const status = this.currentLevel.getWaveStatus();
      this.waveDisplay.textContent = status.label;
      this.waveDisplay.dataset.phase = status.phase || '';
      this.enemyCountDisplay.textContent = status.remaining > 0
        ? `INFECTED NEARBY: ${status.remaining}`
        : '';
    }

    if (this.currentLevel?.getStoryStatus && this.storyUI) {
      const story = this.currentLevel.getStoryStatus();
      this.storyUI.setEvidence(story.required, story.totalRequired);
    }

    if (this.chainMessageTimer > 0) {
      this.chainMessageTimer -= this._lastFrameDt || 0;
      if (this.chainMessageTimer <= 0) this.chainDisplay.classList.add('hidden');
    }

    // Key indicator
    if (this.player.hasKey) {
      this.keyIndicator.classList.remove('hidden');
    } else {
      this.keyIndicator.classList.add('hidden');
    }

    // Minimap
    this._drawMinimap();
  }

  _drawMinimap() {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, w, h);

    if (!this.player || !this.currentLevel) return;

    const scale = 2.0;
    const px = this.player.group.position.x;
    const pz = this.player.group.position.z;

    // Draw maze walls as grey squares
    if (this.currentLevel.wallMeshes) {
      ctx.fillStyle = '#555555';
      for (const wall of this.currentLevel.wallMeshes) {
        const wx = (wall.position.x - px) * scale + w / 2;
        const wy = (wall.position.z - pz) * scale + h / 2;
        if (wx > -5 && wx < w + 5 && wy > -5 && wy < h + 5) {
          ctx.fillRect(wx - 2, wy - 2, 4, 4);
        }
      }
    }

    // Draw zombies as red dots. Keep the trapped Janitor off the minimap
    // until the player has learned they need a master key; spotting him in
    // the world is part of the investigation.
    ctx.fillStyle = '#c62828';
    for (const zombie of this.currentLevel.zombies) {
      if (!zombie.alive) continue;
      if (zombie.isJanitor && !this.currentLevel.exitDiscovered && !this.currentLevel.janitorEncounterStarted) continue;
      const zx = (zombie.group.position.x - px) * scale + w / 2;
      const zy = (zombie.group.position.z - pz) * scale + h / 2;
      if (zx > 0 && zx < w && zy > 0 && zy < h) {
        ctx.beginPath();
        ctx.arc(zx, zy, zombie.isJanitor ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw key as gold dot
    if (this.currentLevel.keyMesh && !this.currentLevel.keyCollected) {
      ctx.fillStyle = '#ffd700';
      const kx = (this.currentLevel.keyMesh.position.x - px) * scale + w / 2;
      const ky = (this.currentLevel.keyMesh.position.z - pz) * scale + h / 2;
      if (kx > 0 && kx < w && ky > 0 && ky < h) {
        ctx.beginPath();
        ctx.arc(kx, ky, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Reveal the exit on the minimap only after the player discovers it.
    if (this.currentLevel.exitDoorPosition && (this.currentLevel.exitDiscovered || this.player.hasKey)) {
      ctx.fillStyle = this.player.hasKey ? '#00ff44' : '#006622';
      const ex = (this.currentLevel.exitDoorPosition.x - px) * scale + w / 2;
      const ey = (this.currentLevel.exitDoorPosition.z - pz) * scale + h / 2;
      if (ex > 0 && ex < w && ey > 0 && ey < h) {
        ctx.beginPath();
        ctx.arc(ex, ey, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw player (center, green)
    ctx.fillStyle = '#4caf50';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // =====================================================================
  // Main Loop
  // =====================================================================
  _animate() {
    requestAnimationFrame(() => this._animate());

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._lastFrameDt = dt;
    this.elapsedTime += dt;

    // ---- Handle one-shot keys ----
    if (this.input.isDown('KeyC') && this.state === this.STATE.PLAYING) {
      this.input.keys['KeyC'] = false;
      this.player.toggleCamera();
    }

    if (this.input.isDown('KeyR') && this.state === this.STATE.PLAYING) {
      this.input.keys['KeyR'] = false;
      this.restartLevel();
    }

    // ---- Pointer lock lost = pause ----
    if (this.state === this.STATE.PLAYING && !this.input.pointerLocked && !this.storyUI?.isEvidenceOpen) {
      if (this.input.isDown('Escape')) {
        this.state = this.STATE.PAUSED;
        this._showOverlay('pause-overlay');
        this.hudEl.classList.add('hidden');
      }
    }

    // ---- Update logic ----
    this.storyUI?.update(dt);

    if (this.state === this.STATE.PLAYING && this.player && this.currentLevel) {
      // Evidence cards pause the world while the player reads. This keeps
      // investigation moments deliberate rather than letting zombies attack
      // through a document overlay.
      if (this._closeEvidenceIfRequested()) {
        this._updateHUD();
      } else if (this.pendingLevelCompleteTimer > 0) {
        this.pendingLevelCompleteTimer -= dt;
        this._updateHUD();
        if (this.pendingLevelCompleteTimer <= 0) {
          this.state = this.STATE.WIN;
          this._showOverlay('win-overlay');
          this.hudEl.classList.add('hidden');
          document.exitPointerLock();
        }
      } else {
        this.player.update(dt, this.currentLevel.getObstacles?.() || []);
        this._handleInteraction();
        this._handleShooting(dt);

        const events = this.currentLevel.update(dt, this.player, this.elapsedTime);
        this._handleStoryEvents(events.storyEvents || []);

        if (events.keyCollected) {
          this.keyIndicator.classList.remove('hidden');
        }

        if (events.levelComplete) {
          // Give the final UNKNOWN message / outro beat time to land before
          // switching to the win overlay.
          this.pendingLevelCompleteTimer = 3.4;
        }

        if (!this.player.alive) this.gameOver();
        this._updateHUD();
      }
    }

    // Pooled tracer bullets keep animating/fading regardless of pause state.
    this.bulletPool.update(dt);

    // ---- Render ----
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
