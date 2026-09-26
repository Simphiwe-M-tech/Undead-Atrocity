import * as THREE from 'three';
import { sfx } from '../audio/ProceduralAudio.js';
import { music } from '../audio/MusicManager.js';
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
    this._minimapPosition = new THREE.Vector3();
    this.shootCooldown = 0;
    this.emptyAmmoMessageCooldown = 0;
    this.shootRate = 0.25;
    this.shootRange = 80;

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
    this.pendingAdvanceLevel = false;
    this.transitioning = false;
    this.fadeEl = document.getElementById('transition-fade');
    this.retryCheckpointBtn = document.getElementById('btn-retry-checkpoint');

    // ---- Resize ----
    window.addEventListener('resize', () => this._onResize());

    // ---- Bind UI ----
    this._bindUI();
    this.renderer.domElement.addEventListener('mousedown', () => {
      if (this.state === this.STATE.PLAYING) this._prepareGunshotAudio();
    });
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === this.STATE.PLAYING && !this.storyUI.isEvidenceOpen && !this.input.pointerLocked) {
        this.input.clearTransient();
        this.input.requestPointerLock(this.renderer.domElement);
      }
    });

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
    this.ammoDisplay = document.getElementById('ammo-display') || ensure('ammo-display', 'hidden');
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
    document.getElementById('btn-start').addEventListener('click', () => {
      sfx.resume();
      music.init();
      sfx.playUIClick();
      this._prepareGunshotAudio();
      this.startGame();
    });
    document.getElementById('btn-credits').addEventListener('click', () => this._showOverlay('credits-overlay'));
    document.getElementById('btn-options').addEventListener('click', () => this._showOverlay('options-overlay'));
    document.getElementById('btn-credits-back').addEventListener('click', () => this._showOverlay('menu-overlay'));
    document.getElementById('btn-options-back').addEventListener('click', () => this._showOverlay('menu-overlay'));

    document.getElementById('sensitivity-slider').addEventListener('input', (e) => {
      if (this.player) this.player.mouseSensitivity = e.target.value * 0.001;
    });

    document.getElementById('pause-overlay').addEventListener('click', () => { sfx.playUIClick(); this.resume(); });
    document.getElementById('btn-retry').addEventListener('click', () => { sfx.playUIClick(); this.restartLevel(); });
    document.getElementById('btn-retry-checkpoint')?.addEventListener('click', () => { sfx.playUIClick(); this.retryCheckpoint(); });
    document.getElementById('btn-menu').addEventListener('click', () => { sfx.playUIClick(); this.returnToMenu(); });
    document.getElementById('btn-nextlevel').addEventListener('click', () => { sfx.playUIClick(); this.returnToMenu(); });
    document.getElementById('btn-win-menu').addEventListener('click', () => { sfx.playUIClick(); this.returnToMenu(); });
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
    if (this.state === this.STATE.LOADING) return;
    this._resetSession();
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
    this.player.setCollidableMeshes(level.wallMeshes);
    this._applyLevelLoadout(level, { preserveProgress: false });

    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.keyIndicator.classList.add('hidden');
    this._resetCombatHUD();
    this.storyUI.reset(level.objective, level.totalRequiredClues);

    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);

    this.input.requestPointerLock(this.renderer.domElement);
  }

  async restartLevel() {
    if (this.state === this.STATE.LOADING || this.storyUI.isEvidenceOpen) return;
    this._resetSession();
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
      this._applyLevelLoadout(level, { preserveProgress: false });
    }

    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.keyIndicator.classList.add('hidden');
    this._resetCombatHUD();
    this.storyUI.reset(level.objective, level.totalRequiredClues);

    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);
    this.input.requestPointerLock(this.renderer.domElement);
  }

  _resetSession() {
    this.pendingLevelCompleteTimer = 0;
    this.pendingAdvanceLevel = false;
    this.transitioning = false;
    this.shootCooldown = 0;
    this.emptyAmmoMessageCooldown = 0;
    this.bulletPool?.reset?.();
    this.input.clearTransient();
    this.storyUI.reset();
    this._setFade(false);
  }

  _applyLevelLoadout(level, { preserveProgress = false } = {}) {
    if (!this.player || !level) return;
    if (!preserveProgress) {
      this.player.group.position.copy(level.spawnPoint);
      this.player.hasKey = false;
    }
    if (level.ammoConfig) this.player.configureAmmo(level.ammoConfig);
    else this.player.configureAmmo({ limited: false });
    this.player.setCameraProfile(level.cameraProfile || 'outdoor');
    this.player.setFlashlight(false);
  }

  _setFade(on) {
    if (!this.fadeEl) return;
    if (on) {
      this.fadeEl.classList.remove('hidden');
      void this.fadeEl.offsetWidth;
      this.fadeEl.classList.add('visible');
    } else {
      this.fadeEl.classList.remove('visible');
    }
  }

  async _advanceToNextLevel() {
    if (this.transitioning || this.state === this.STATE.LOADING) return;
    this.transitioning = true;
    this.state = this.STATE.LOADING;
    this._setFade(true);
    await new Promise((resolve) => setTimeout(resolve, 450));

    const progressBar = document.getElementById('progress-bar');
    if (progressBar) progressBar.style.width = '0%';

    const score = this.player?.score || 0;
    const health = this.player?.health ?? 100;
    const level = await this.levelManager.nextLevel((p) => {
      if (progressBar) progressBar.style.width = `${p * 100}%`;
    });
    if (!level) {
      this.transitioning = false;
      this._setFade(false);
      this.showWin();
      return;
    }
    this.currentLevel = level;
    if (this.player) {
      this.player.reset(level.spawnPoint);
      this.player.score = score;
      this.player.health = health;
      this.player.alive = true;
      this.player.setCollidableMeshes(level.wallMeshes);
      this._applyLevelLoadout(level, { preserveProgress: false });
    }

    this.state = this.STATE.PLAYING;
    this.pendingLevelCompleteTimer = 0;
    this.pendingAdvanceLevel = false;
    this.transitioning = false;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.keyIndicator.classList.add('hidden');
    this._resetCombatHUD();
    this.storyUI.reset(level.objective, level.totalRequiredClues);
    this.bulletPool.reset();
    this.shootCooldown = 0;
    this.input.clearTransient();
    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);
    this._setFade(false);
    this.input.requestPointerLock(this.renderer.domElement);
  }

  retryCheckpoint() {
    if (this.state !== this.STATE.GAMEOVER) return;
    if (!this.currentLevel?.checkpointReady || !this.player) {
      this.restartLevel();
      return;
    }
    this._resetSession();
    this.currentLevel.restoreCheckpoint(this.player);
    this._resetCombatHUD();
    this.storyUI.reset(this.currentLevel.objective, this.currentLevel.totalRequiredClues);
    this.player.setCollidableMeshes(this.currentLevel.wallMeshes);
    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.input.requestPointerLock(this.renderer.domElement);
  }

  showLevelComplete() {
    this.state = this.STATE.LEVELCOMPLETE;
    document.getElementById('levelcomplete-title').textContent = 'LEVEL 2 COMPLETE';
    document.getElementById('levelcomplete-text').textContent = 'You escaped the residence. The story continues below. Level 3 is not available yet.';
    document.getElementById('btn-nextlevel').textContent = 'Return to Menu';
    this._showOverlay('levelcomplete-overlay');
    this.hudEl.classList.add('hidden');
    this._setFade(false);
    document.exitPointerLock();
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
    this._resetSession();
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
    if (this.retryCheckpointBtn) {
      const canRetry = !!this.currentLevel?.checkpointReady;
      this.retryCheckpointBtn.classList.toggle('hidden', !canRetry);
    }
    document.exitPointerLock();
  }

  // =====================================================================
  // Shooting - hitscan rifle, single successful shot kills a zombie
  // =====================================================================
  _handleShooting(dt) {
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    this.emptyAmmoMessageCooldown = Math.max(0, (this.emptyAmmoMessageCooldown || 0) - dt);

    if (this.input.isMouseButtonDown(0) && this.shootCooldown <= 0 && this.input.pointerLocked) {
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

      const hasAmmo = !this.player.consumeAmmo || this.player.consumeAmmo();
      if (!hasAmmo && !this.currentLevel.consumeCarrierReserve?.(hits[0]?.object)) {
        if (this.emptyAmmoMessageCooldown <= 0) {
          this.storyUI?.showBanner('OUT OF AMMO', this.currentLevel.getEmptyAmmoHint?.() || 'Find ammunition.', 1.8);
          this.emptyAmmoMessageCooldown = 2;
        }
        return;
      }
      this.shootCooldown = this.shootRate;

      // Pooled tracer bullet - visual feedback only, travels to the hit point
      // (or to max range if nothing was hit), then recycles automatically.
      const tracerEnd = hits.length > 0
        ? hits[0].point
        : this.camera.position.clone().addScaledVector(direction, this.shootRange);
      this.player.aimWeaponAt(tracerEnd);
      this.bulletPool.fire(this.player.getMuzzleWorldPosition(), tracerEnd);
      this.player.showShotFeedback();
      sfx.playGunshot();

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

    }
  }

  // =====================================================================
  // Story / Investigation
  // =====================================================================
  _handleStoryEvent(event) {
    if (!event || !this.storyUI) return;
    if (event.type === 'alarm') {
      this._playAlarm();
    } else if (event.type === 'sound') {
      this._playInteriorSound(event.id);
    } else if (event.type === 'flashlight') {
      this.player?.setFlashlight?.(!!event.on);
    } else if (event.type === 'intro') {
      this.storyUI.showIntro(event.title, event.subtitle);
    } else if (event.type === 'objective') {
      this.storyUI.setObjective(event.text);
    } else if (event.type === 'message') {
      if (event.urgent) {
        this.storyUI.messageQueue.length = 0;
        this.storyUI.messageTimer = 0;
      }
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

  _ensureAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    this.audioContext ??= new AudioContext();
    if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(() => {});
    return this.audioContext;
  }

  _prepareGunshotAudio() {
    const context = this._ensureAudioContext();
    if (!context || this.gunshotBuffer) return;
    // Original procedural sound, generated locally: no external asset/license.
    // A short noise crack with a decaying low body, bounded below full scale.
    this.gunshotBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.16), context.sampleRate);
    const samples = this.gunshotBuffer.getChannelData(0);
    let filteredNoise = 0;
    for (let i = 0; i < samples.length; i++) {
      const t = i / context.sampleRate;
      filteredNoise = filteredNoise * 0.25 + (Math.random() * 2 - 1) * 0.75;
      const attack = Math.min(1, t / 0.001);
      const tail = Math.min(1, (0.16 - t) / 0.012);
      samples[i] = attack * tail * (0.65 * filteredNoise * Math.exp(-t * 55)
        + 0.22 * Math.sin(2 * Math.PI * 105 * t) * Math.exp(-t * 38));
    }
    this.gunshotGain = context.createGain();
    this.gunshotGain.gain.value = 0.35;
    this.gunshotGain.connect(context.destination);
  }

  _playGunshot() {
    this._prepareGunshotAudio();
    const context = this.audioContext;
    if (!this.gunshotBuffer || context.state !== 'running') return;
    // Buffer and gain are reused. Web Audio requires a fresh lightweight source
    // node per playback; independent sources allow tails to overlap naturally.
    const source = context.createBufferSource();
    source.buffer = this.gunshotBuffer;
    source.connect(this.gunshotGain);
    source.onended = () => source.disconnect();
    source.start();
  }

  _playAlarm() {
    // Reuse the same context as the gunshot; preserve the existing alarm cue.
    if (!this._ensureAudioContext()) return;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const now = this.audioContext.currentTime;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(320, now);
    oscillator.frequency.linearRampToValueAtTime(640, now + 0.4);
    oscillator.frequency.linearRampToValueAtTime(320, now + 0.8);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.03);
    gain.gain.linearRampToValueAtTime(0, now + 1.2);
    oscillator.connect(gain); gain.connect(this.audioContext.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now); oscillator.stop(now + 1.2);
  }

  _playInteriorSound(id = 'hum') {
    const ctx = this._ensureAudioContext();
    if (!ctx) return;
    const profiles = {
      bang: { type: 'square', f0: 90, f1: 40, peak: 0.05, dur: 0.28 },
      growl: { type: 'sawtooth', f0: 110, f1: 70, peak: 0.035, dur: 0.7 },
      glass: { type: 'triangle', f0: 920, f1: 420, peak: 0.03, dur: 0.35 },
      slam: { type: 'square', f0: 70, f1: 28, peak: 0.055, dur: 0.22 },
      scream: { type: 'sawtooth', f0: 520, f1: 180, peak: 0.04, dur: 0.8 },
      hum: { type: 'sine', f0: 118, f1: 118, peak: 0.012, dur: 1.4 },
      breaker: { type: 'square', f0: 180, f1: 50, peak: 0.045, dur: 0.18 },
      alarm: { type: 'triangle', f0: 420, f1: 680, peak: 0.04, dur: 0.9 }
    };
    const p = profiles[id] || profiles.hum;
    this.interiorBuffers ??= new Map();
    if (!this.interiorGain) {
      this.interiorGain = ctx.createGain();
      this.interiorGain.gain.value = 0.7;
      this.interiorGain.connect(ctx.destination);
    }
    if (!this.interiorBuffers.has(id)) {
      // Original local synthesis. Cache the PCM; only playback nodes are transient.
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * p.dur), ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      let phase = 0;
      for (let i = 0; i < samples.length; i++) {
        const t = i / ctx.sampleRate, progress = t / p.dur;
        phase += 2 * Math.PI * (p.f0 + (p.f1 - p.f0) * progress) / ctx.sampleRate;
        const tone = Math.sin(phase) + (p.type === 'sine' ? 0 : 0.25 * Math.sin(phase * 3));
        const noise = ['bang', 'glass', 'slam', 'breaker'].includes(id) ? (Math.random() * 2 - 1) * 0.6 : 0;
        samples[i] = (tone + noise) * p.peak * Math.min(1, t / 0.008) * (1 - progress) ** 2;
      }
      this.interiorBuffers.set(id, buffer);
    }
    const source = ctx.createBufferSource();
    source.buffer = this.interiorBuffers.get(id);
    source.connect(this.interiorGain);
    source.onended = () => source.disconnect();
    source.start();
  }

  _updateAmbience() {
    const ctx = this.audioContext;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.ambience) {
      this.ambience = {};
      for (const mode of ['roof', 'interior']) {
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let noise = 0;
        for (let i = 0; i < data.length; i++) {
          noise = noise * 0.97 + (Math.random() * 2 - 1) * 0.03;
          data[i] = mode === 'roof' ? noise : Math.sin(2 * Math.PI * 60 * i / ctx.sampleRate) * 0.15;
        }
        const source = ctx.createBufferSource(), gain = ctx.createGain();
        source.buffer = buffer; source.loop = true; gain.gain.value = 0;
        source.connect(gain); gain.connect(ctx.destination); source.start();
        this.ambience[mode] = gain;
      }
    }
    const mode = this.state !== this.STATE.PLAYING ? 'silent'
      : this.currentLevel?.cameraProfile === 'indoor' ? 'interior' : 'roof';
    if (mode === this.ambienceMode) return;
    this.ambienceMode = mode;
    for (const [name, gain] of Object.entries(this.ambience)) {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setTargetAtTime(name === mode ? 0.12 : 0, ctx.currentTime, 0.15);
    }
  }

  _onLevelComplete() {
    if (this.pendingLevelCompleteTimer > 0) return;
    const last = this.levelManager.currentLevelIndex >= this.levelManager.totalLevels - 1;
    this.pendingAdvanceLevel = !last;
    this.pendingLevelCompleteTimer = last ? 3.4 : 2.2;
  }

  _handleInteraction() {
    if (!this.currentLevel || !this.player || !this.storyUI) return;

    const nearby = this.currentLevel.getNearbyInteraction?.(this.player.group.position, this.player);
    if (nearby) this.storyUI.showInteraction(nearby.label);
    else this.storyUI.hideInteraction();

    if (this.storyUI.isEvidenceOpen) return;
    if (this.input.consumePress('KeyE')) {
      const result = this.currentLevel.interact?.(this.player.group.position, this.player);
      if (result?.type === 'evidence') {
        this.storyUI.showEvidence(result.evidence);
        this.input.clearTransient();
      }
      if (result?.type === 'ammo') {
        this.player.addAmmo(result.amount || 8);
        this.emptyAmmoMessageCooldown = 0;
        this.storyUI.showBanner(`AMMO +${result.amount || 8}`,
          result.carrierRound ? 'One extra round secured for a clear shot on the key carrier.' : 'Ammunition collected.', 1.8);
      }
      if (result?.levelComplete) this._onLevelComplete();
    }
  }

  _closeEvidenceIfRequested() {
    if (!this.storyUI?.isEvidenceOpen) return false;
    if (this.input.consumePress('KeyE') || this.input.consumePress('Escape')) {
      this.storyUI.closeEvidence();
      this.input.clearTransient();
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

    if (this.ammoDisplay) {
      if (this.player.limitedAmmo) {
        this.ammoDisplay.classList.remove('hidden');
        this.ammoDisplay.textContent = `AMMO ${this.player.ammoMag} | ${this.player.ammoReserve}`;
        if (this.currentLevel?.carrierAmmoReserve) this.ammoDisplay.textContent += ' + 1 CARRIER RESERVE';
        this.ammoDisplay.classList.toggle('empty', this.player.ammoMag <= 0 && this.player.ammoReserve <= 0);
      } else {
        this.ammoDisplay.classList.add('hidden');
      }
    }

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
        wall.getWorldPosition(this._minimapPosition);
        const wx = (this._minimapPosition.x - px) * scale + w / 2;
        const wy = (this._minimapPosition.z - pz) * scale + h / 2;
        if (this.currentLevel.cameraProfile === 'indoor' && wall.userData.obstacle) {
          const bounds = wall.userData.obstacle;
          ctx.fillRect(wx - bounds.halfX * scale, wy - bounds.halfZ * scale,
            bounds.halfX * scale * 2, bounds.halfZ * scale * 2);
          continue;
        }
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
    const objective = this.currentLevel.getObjectivePosition?.();
    if (objective) {
      ctx.fillStyle = '#80e4ff';
      const ox = Math.max(5, Math.min(w - 5, (objective.x - px) * scale + w / 2));
      const oz = Math.max(5, Math.min(h - 5, (objective.z - pz) * scale + h / 2));
      ctx.fillRect(ox - 3, oz - 3, 6, 6);
    }
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

    this.player?.updateShotFeedback?.(dt);
    this._updateAmbience();

    // ---- Audio Updates ----
    if (this.storyUI) {
      const isDucking = this.storyUI.bannerTimer > 0 || this.storyUI.messageTimer > 0 || this.storyUI.introTimer > 0 || this.storyUI.dialogueTimer > 0 || this.storyUI.isEvidenceOpen;
      music.setDucking(isDucking);
    }

    if (this.currentLevel && this.state === this.STATE.PLAYING) {
      const activeZombies = this.currentLevel.zombiePool ? this.currentLevel.zombiePool.activeCount : 0;
      const isJanitorActive = this.currentLevel.janitorZombie && this.currentLevel.janitorZombie.alive && this.currentLevel.janitorReleased;
      
      if (activeZombies > 0 || isJanitorActive) {
        this._ambientCooldown = 3.5;
        music.playTrack('combat');
      } else {
        if (this._ambientCooldown > 0) {
          this._ambientCooldown -= dt;
        } else {
          music.playTrack('ambient');
        }
      }
    }

    // ---- Handle one-shot keys ----
    if (this.input.consumePress('KeyC') && this.state === this.STATE.PLAYING && !this.storyUI.isEvidenceOpen) {
      this.player.toggleCamera();
    }

    if (this.input.consumePress('KeyR') && this.state === this.STATE.PLAYING && !this.storyUI.isEvidenceOpen) {
      this.restartLevel();
    }

    // ---- Pointer lock lost = pause ----
    if (this.state === this.STATE.PLAYING && !this.input.pointerLocked && !this.storyUI?.isEvidenceOpen) {
      if (this.input.consumePress('Escape')) {
        this.state = this.STATE.PAUSED;
        this._showOverlay('pause-overlay');
        this.hudEl.classList.add('hidden');
      }
    }

    // ---- Update logic ----
    if (this.state === this.STATE.PLAYING) this.storyUI?.update(dt);

    if (this.state === this.STATE.PLAYING && this.player && this.currentLevel) {
      // Evidence cards pause the world while the player reads. This keeps
      // investigation moments deliberate rather than letting zombies attack
      // through a document overlay.
      if (this._closeEvidenceIfRequested()) {
        this._updateHUD();
      } else if (this.pendingLevelCompleteTimer > 0) {
        this.pendingLevelCompleteTimer -= dt;
        if (!this.pendingAdvanceLevel && this.pendingLevelCompleteTimer < 0.45) this._setFade(true);
        this._updateHUD();
        if (this.pendingLevelCompleteTimer <= 0) {
          if (this.pendingAdvanceLevel) {
            this._advanceToNextLevel();
          } else {
            this.showLevelComplete();
          }
        }
      } else {
        this._handleInteraction();
        if (!this.storyUI.isEvidenceOpen) {
          this.player.update(dt, this.currentLevel.getObstacles?.() || []);
          this._handleShooting(dt);

          const events = this.currentLevel.update(dt, this.player, this.elapsedTime, this.camera);
          this._handleStoryEvents(events.storyEvents || []);

          if (events.keyCollected) {
            this.keyIndicator.classList.remove('hidden');
          }

          if (events.levelComplete) this._onLevelComplete();

          if (!this.player.alive) this.gameOver();
        }
        this._updateHUD();
      }
    }

    // Pooled tracer bullets keep animating/fading regardless of pause state.
    this.bulletPool.update(dt);

    this.input.endFrame();
    this.input.flushMouseDelta();

    // ---- Render ----
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
