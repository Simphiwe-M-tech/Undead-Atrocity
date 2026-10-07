import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/Game.js';
import { InputManager } from '../src/core/InputManager.js';

class Element {
  constructor() { this.children = new Map(); this.classList = { add() {}, remove() {}, toggle() {} }; }
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Element());
    return this.children.get(selector);
  }
  appendChild() {}
  getContext() { return new Proxy({}, { get: () => () => {} }); }
}

function setup() {
  const windowListeners = new Map();
  globalThis.window = { addEventListener: (name, fn) => windowListeners.set(name, fn) };
  globalThis.document = {
    addEventListener() {},
    createElement: () => new Element(),
    body: new Element(),
    pointerLockElement: null,
  };
  globalThis.requestAnimationFrame = () => {};
  const input = new InputManager();
  const key = code => windowListeners.get('keydown')({ code, repeat: false });
  return { input, key };
}

function gameFixture({ state = 'playing', storyUI = null } = {}) {
  const controls = setup();
  const game = Object.create(Game.prototype);
  const overlays = [];
  Object.assign(game, {
    input: controls.input,
    STATE: {
      MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover',
      LEVELCOMPLETE: 'levelcomplete', WIN: 'win', LOADING: 'loading',
    },
    state,
    storyUI: storyUI || {
      bannerTimer: 0, messageTimer: 0, introTimer: 0, dialogueTimer: 0,
      isEvidenceOpen: false, update() {}, reset() {},
    },
    player: null,
    currentLevel: null,
    hudEl: new Element(),
    renderer: { domElement: {}, render() {} },
    clock: { getDelta: () => 0.016 },
    elapsedTime: 0,
    _lastFrameDt: 0,
    _resumePending: false,
    _sensitivityStep: 2,
    bulletPool: { updated: 0, update() { this.updated++; }, reset() {} },
    _updateHUD() {},
    _showOverlay(id) { overlays.push(id); },
    overlays,
  });
  return { ...controls, game };
}

function setLocked(locked, element = {}) {
  globalThis.document.pointerLockElement = locked ? element : null;
}

test('losing pointer lock while playing pauses once and swallows the trailing Escape', () => {
  const { game, key } = gameFixture({ state: 'playing' });
  key('Escape'); // browsers that deliver the keydown alongside the lock exit
  game._handlePointerLockChange(); // document.pointerLockElement is null here
  assert.equal(game.state, 'paused');
  assert.deepEqual(game.overlays, ['pause-overlay']);
  assert.equal(game.input.consumePress('Escape'), false, 'trailing Escape must be swallowed');
  game._animate();
  assert.equal(game.bulletPool.updated, 0, 'tracers must not advance while paused');
});

test('unexpected lock loss with evidence open keeps the evidence flow alive', () => {
  const storyUI = {
    bannerTimer: 0, messageTimer: 0, introTimer: 0, dialogueTimer: 0,
    isEvidenceOpen: true, update() {}, reset() {},
  };
  const { game } = gameFixture({ state: 'playing', storyUI });
  game._handlePointerLockChange();
  assert.equal(game.state, 'playing', 'evidence owns Escape until it is closed');
});

test('resume requests the lock and only completes once it is acquired', () => {
  const { game } = gameFixture({ state: 'paused' });
  let requested = false;
  game.input.requestPointerLock = () => { requested = true; };

  game.resume();
  assert.equal(requested, true, 'resume must ask for pointer lock');
  assert.equal(game._resumePending, true);
  assert.equal(game.state, 'paused', 'must not resume before the lock is confirmed');

  setLocked(true, game.renderer.domElement);
  game._handlePointerLockChange();
  assert.equal(game._resumePending, false);
  assert.equal(game.state, 'playing');
  assert.deepEqual(game.overlays, [null]);
  setLocked(false);
});

test('a failed re-lock attempt cancels the pending resume', () => {
  const { game } = gameFixture({ state: 'paused' });
  game.input.requestPointerLock = () => {}; // browser rejects re-lock during its cooldown
  game.resume();
  game._handlePointerLockError();
  assert.equal(game._resumePending, false);

  setLocked(true); // stale gain after a cancelled request must not resume
  game._handlePointerLockChange();
  assert.equal(game.state, 'paused');
  setLocked(false);
});

test('Escape while paused starts the resume handshake', () => {
  const { game, key } = gameFixture({ state: 'paused' });
  let requested = false;
  game.input.requestPointerLock = () => { requested = true; };

  key('Escape');
  game._animate();
  assert.equal(requested, true);
  assert.equal(game._resumePending, true);
  assert.equal(game.state, 'paused');

  setLocked(true, game.renderer.domElement);
  game._handlePointerLockChange();
  assert.equal(game.state, 'playing');
  setLocked(false);
});

test('playing frames advance tracers, clock and shot feedback; paused frames freeze all', () => {
  const { game } = gameFixture({ state: 'playing' });
  const feedback = [];
  game.player = { updateShotFeedback: dt => feedback.push(dt), alive: true, health: 100 };

  game._animate();
  assert.equal(game.bulletPool.updated, 1, 'tracers advance while playing');
  assert.equal(game.elapsedTime, 0.016, 'game clock advances while playing');
  assert.equal(feedback.length, 1, 'shot feedback decays while playing');

  game._handlePointerLockChange(); // lock loss pauses
  assert.equal(game.state, 'paused');
  game._animate();
  game._animate();
  assert.equal(game.bulletPool.updated, 1, 'tracers frozen while paused');
  assert.equal(feedback.length, 1, 'muzzle/recoil decay frozen while paused');
  assert.equal(game.elapsedTime, 0.016, 'game clock frozen while paused');
});

test('Escape while playing without pointer lock still pauses via the keydown fallback', () => {
  const { game, key } = gameFixture({ state: 'playing' });
  key('Escape');
  game._animate();
  assert.equal(game.state, 'paused');
  assert.deepEqual(game.overlays, ['pause-overlay']);
});

test('pause only acts from PLAYING', () => {
  const { game } = gameFixture({ state: 'paused' });
  game.pause();
  assert.equal(game.state, 'paused');
  assert.deepEqual(game.overlays, [], 'must not re-show the overlay');

  game.state = 'loading';
  game.pause();
  assert.equal(game.state, 'loading');
});

test('sensitivity steps clamp, apply to the player, persist, and sync both sliders', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  try {
    const { game } = gameFixture({ state: 'paused' });
    const mainSlider = { value: '2' };
    const pauseSlider = { value: '2' };
    game.sensitivitySliders = [mainSlider, pauseSlider];
    game.player = { mouseSensitivity: 0.002 };

    game._setSensitivityStep('7');
    assert.ok(Math.abs(game.player.mouseSensitivity - 0.007) < 1e-12, 'player value applied live');
    assert.equal(mainSlider.value, '7', 'main slider mirrors the change');
    assert.equal(pauseSlider.value, '7', 'pause slider mirrors the change');
    assert.equal(store.get('undeadAtrocity.sensitivity'), '7');

    game._setSensitivityStep('99');
    assert.ok(Math.abs(game.player.mouseSensitivity - 0.01) < 1e-12, 'out-of-range input clamps to 10');
    assert.equal(game._loadSensitivity(), 10);

    store.delete('undeadAtrocity.sensitivity');
    assert.equal(game._loadSensitivity(), 2, 'missing value falls back to the 0.002 default');
    store.set('undeadAtrocity.sensitivity', '4');
    assert.equal(game._loadSensitivity(), 4, 'saved value is honoured');

    // A player created later picks up the persisted step at start.
    game.player = null;
    game._setSensitivityStep('9');
    game.player = { mouseSensitivity: 0 };
    game.player.mouseSensitivity = game._sensitivityStep * 0.001;
    assert.ok(Math.abs(game.player.mouseSensitivity - 0.009) < 1e-12);
  } finally {
    delete globalThis.localStorage;
  }
});
