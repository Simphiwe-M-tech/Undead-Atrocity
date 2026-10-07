import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicManager } from '../src/audio/MusicManager.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Minimal stand-in for HTMLAudioElement: counts play/pause calls and tracks
// the properties MusicManager mutates, so fades can be observed without media.
function fakeTrack() {
  return {
    loop: false, volume: 0, currentTime: 0, plays: 0, pauses: 0,
    play() { this.plays++; return Promise.resolve(); },
    pause() { this.pauses++; },
  };
}

// A started manager with injectable fake tracks and short fade times.
function makeManager() {
  const manager = new MusicManager();
  manager.started = true;
  manager.tracks = { ambient: fakeTrack(), combat: fakeTrack(), janitor: fakeTrack() };
  return manager;
}

// Every test finishes its fades or clears them, so no interval outlives a
// test. Polling instead of a fixed sleep keeps this robust when the runner
// executes files in parallel and starves the fade timers for a while.
async function settle(manager, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (manager.fadeInterval !== null && Date.now() < deadline) {
    await sleep(10);
  }
  assert.equal(manager.fadeInterval, null, 'fade must fully settle');
}

test('music preference defaults to enabled and round-trips through localStorage', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  try {
    assert.equal(new MusicManager().enabled, true, 'no saved value must default to ON');
    store.set('undeadAtrocity.musicEnabled', 'false');
    assert.equal(new MusicManager().enabled, false, 'saved OFF must be honoured');
    store.set('undeadAtrocity.musicEnabled', 'true');
    assert.equal(new MusicManager().enabled, true);

    const manager = makeManager();
    manager.setEnabled(false);
    assert.equal(manager.enabled, false);
    assert.equal(store.get('undeadAtrocity.musicEnabled'), 'false', 'setEnabled must persist');
    manager.setEnabled(true);
    assert.equal(store.get('undeadAtrocity.musicEnabled'), 'true');
  } finally {
    delete globalThis.localStorage;
  }
});

test('init starts ambient immediately and stays silent when the preference is off', () => {
  class FakeAudio {
    constructor() { this.loop = false; this.volume = 1; this.currentTime = 0; this.plays = 0; this.pauses = 0; }
    play() { this.plays++; return Promise.resolve(); }
    pause() { this.pauses++; }
  }
  const originalAudio = globalThis.Audio;
  globalThis.Audio = FakeAudio;
  try {
    const on = new MusicManager();
    on.init();
    assert.equal(on.started, true);
    assert.equal(on.tracks.ambient.plays, 1, 'ambient must start on init, not at Clue 2');
    assert.equal(on.currentTrack, 'ambient');
    on.setEnabled(false); // also clears the real 2s fade interval started above

    const off = new MusicManager();
    off.enabled = false;
    off.init();
    assert.equal(off.started, true);
    assert.equal(off.tracks.ambient.plays, 0, 'disabled preference must not start music');
    assert.equal(off.currentTrack, null);
  } finally {
    globalThis.Audio = originalAudio;
  }
});

test('repeated playTrack requests for the playing track never restart the fade', async () => {
  const manager = makeManager();
  manager.playTrack('ambient', 40);
  const ambient = manager.tracks.ambient;
  const firstInterval = manager.fadeInterval;
  const playsAfterFirst = ambient.plays;

  manager.playTrack('ambient');
  manager.playTrack('ambient');
  manager.playTrack('ambient');

  assert.equal(manager.fadeInterval, firstInterval, 'duplicate requests must not restart the timer');
  assert.equal(manager.currentTrack, 'ambient');
  assert.equal(ambient.plays, playsAfterFirst, 'duplicate requests must not re-play or rewind');

  const midFadeVolume = ambient.volume;
  await settle(manager);
  assert.equal(manager.currentTrack, 'ambient');
  assert.equal(ambient.volume, manager.masterVolume, 'fade must reach full volume');
  assert.ok(midFadeVolume >= 0 && midFadeVolume <= manager.masterVolume);
});

test('ambient to combat to ambient transitions complete and retire the old track', async () => {
  const manager = makeManager();
  manager.playTrack('ambient', 40);
  await settle(manager);

  manager.playTrack('combat', 40);
  assert.equal(manager.currentTrack, 'combat');
  await settle(manager);
  assert.equal(manager.tracks.combat.volume, manager.masterVolume);
  assert.equal(manager.tracks.ambient.pauses, 1, 'old track must be paused exactly once');
  assert.equal(manager.tracks.ambient.volume, 0);
  assert.equal(manager.tracks.ambient.currentTime, 0, 'old track must be rewound');

  manager.playTrack('ambient', 40);
  await settle(manager);
  assert.equal(manager.currentTrack, 'ambient');
  assert.equal(manager.tracks.combat.pauses, 1);
  assert.equal(manager.tracks.combat.currentTime, 0);
  assert.equal(manager.tracks.ambient.plays, 2, 'each transition must play the incoming track once');
});

test('switching tracks mid-fade reverses cleanly without a lingering old fade', async () => {
  const manager = makeManager();
  manager.playTrack('ambient', 200); // long fade so it is still in flight
  await sleep(30);
  assert.notEqual(manager.fadeInterval, null);

  manager.playTrack('combat', 40); // reverse direction before ambient finished
  await settle(manager);

  assert.equal(manager.currentTrack, 'combat');
  assert.equal(manager.tracks.combat.volume, manager.masterVolume);
  assert.equal(manager.tracks.ambient.pauses, 1, 'superseded incoming track must be silenced');
  assert.equal(manager.tracks.ambient.volume, 0);
  assert.equal(manager.tracks.ambient.currentTime, 0);
});

test('disabling music stops the fade and silences every track immediately', async () => {
  const manager = makeManager();
  manager.playTrack('ambient', 200);
  await sleep(30);

  manager.setEnabled(false);
  assert.equal(manager.fadeInterval, null, 'active fade must stop immediately');
  for (const [name, track] of Object.entries(manager.tracks)) {
    assert.equal(track.pauses, 1, `${name} must be paused immediately`);
    assert.equal(track.volume, 0, `${name} must be silent`);
    assert.equal(track.currentTime, 0, `${name} must be rewound`);
  }
  assert.equal(manager.currentTrack, null);

  const intervalWhileOff = manager.fadeInterval;
  manager.playTrack('combat', 40); // must be a complete no-op while disabled
  manager.playTrack('ambient', 40);
  assert.equal(manager.fadeInterval, intervalWhileOff);
  assert.equal(manager.tracks.combat.plays, 0);
  await sleep(60);
  assert.equal(manager.tracks.combat.plays, 0, 'no hidden playback while off');
});

test('re-enabling music lets the next game-loop request start one correct track', async () => {
  const manager = makeManager();
  manager.playTrack('ambient', 40);
  await settle(manager);
  manager.setEnabled(false);
  manager.setEnabled(true);

  // Simulate the per-frame game-loop request while combat is happening.
  manager.playTrack('combat', 40);
  assert.equal(manager.tracks.combat.plays, 1);
  await settle(manager);
  assert.equal(manager.currentTrack, 'combat');
  assert.equal(manager.tracks.combat.volume, manager.masterVolume);

  manager.playTrack('combat'); // subsequent frames stay no-ops
  manager.playTrack('ambient', 40); // cooldown elapsed: switch back once
  assert.equal(manager.tracks.ambient.plays, 2);
  await settle(manager);
  assert.equal(manager.currentTrack, 'ambient');
});

test('ducking and per-frame calls while disabled never restart playback', () => {
  const manager = makeManager();
  manager.setEnabled(false);
  manager.setDucking(true); // per-frame call while off must be harmless
  manager.setEnabled(true);
  assert.equal(manager.enabled, true);
  assert.equal(manager.fadeInterval, null, 'no timer may leak while toggling');
  for (const [name, track] of Object.entries(manager.tracks)) {
    assert.equal(track.plays, 0, `${name} must never start while off`);
  }
});
