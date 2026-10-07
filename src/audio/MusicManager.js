const STORAGE_KEY = 'undeadAtrocity.musicEnabled';

export class MusicManager {
  constructor() {
    this.masterVolume = 0.5;
    this.tracks = {};
    // currentTrack is the destination of the latest request: it is assigned
    // the moment a transition begins and stays assigned while the track fades
    // in or plays. previousTrack is the outgoing track of the active fade.
    this.currentTrack = null;
    this.previousTrack = null;
    this.fadeInterval = null;
    this.ducking = false;
    this.started = false;
    this.enabled = this._readMusicPreference();
  }

  // Called on first user interaction
  init() {
    if (this.started) return;
    this.started = true;
    
    // Create audio elements
    this._loadTrack('ambient', '/assets/audio/music/ambient.mp3', true);
    this._loadTrack('combat', '/assets/audio/music/combat.mp3', true);
    this._loadTrack('janitor', '/assets/audio/music/janitor_stinger.mp3', false);
    
    // Ambient starts with the first user gesture and gameplay, not later
    // story beats; while the music preference is off, playTrack is a no-op.
    this.playTrack('ambient');
  }

  _loadTrack(name, url, loop) {
    const audio = new Audio(url);
    audio.loop = loop;
    audio.volume = 0;
    // We don't preload strictly since we just assume they exist
    this.tracks[name] = audio;
  }

  playTrack(name, fadeTimeMs = 2000) {
    if (!this.started || !this.enabled || !this.tracks[name]) return;
    // Idempotent: a request for the track that is already playing or already
    // fading in must never restart the fade, reset volume, or rewind audio.
    // The game loop calls this every frame, so duplicates are the common case.
    if (name === this.currentTrack) return;

    const newAudio = this.tracks[name];
    let oldAudio = null;

    if (this.fadeInterval) {
      // A different transition is still in flight. The track that was fading
      // out is retired on the spot; the half-faded-in track (currentTrack)
      // becomes the new outgoing source and fades away from where it stands.
      if (this.previousTrack) {
        this.previousTrack.pause();
        this.previousTrack.currentTime = 0;
        this.previousTrack.volume = 0;
      }
      if (this.currentTrack !== name) oldAudio = this.tracks[this.currentTrack];
    } else if (this.currentTrack) {
      oldAudio = this.tracks[this.currentTrack];
    }

    this.previousTrack = oldAudio;
    this.currentTrack = name;
    if (this.fadeInterval) clearInterval(this.fadeInterval);

    // Play immediately and fade in from the track's current volume, so an
    // interrupted fade reverses smoothly instead of snapping back to zero.
    newAudio.play().catch(e => console.warn("Music play blocked:", e));

    const steps = 20;
    const stepTime = fadeTimeMs / steps;
    let currentStep = 0;
    const targetVol = this.ducking ? this.masterVolume * 0.3 : this.masterVolume;
    const startVol = targetVol > 0 ? Math.min(newAudio.volume / targetVol, 1) : 0;

    this.fadeInterval = setInterval(() => {
      currentStep++;
      const t = currentStep / steps;

      newAudio.volume = (startVol + (1 - startVol) * t) * targetVol;
      if (oldAudio && oldAudio !== newAudio) {
        oldAudio.volume = Math.max(0, 1 - t) * targetVol;
      }

      if (currentStep >= steps) {
        clearInterval(this.fadeInterval);
        this.fadeInterval = null;
        this.previousTrack = null;
        // Outgoing and incoming are always distinct elements, but the guard
        // stays so one track can never pause or rewind the other.
        if (oldAudio && oldAudio !== newAudio) {
          oldAudio.pause();
          oldAudio.currentTime = 0;
          oldAudio.volume = 0;
        }
      }
    }, stepTime);
  }

  // Single source of truth for the music preference. The main-menu Options
  // screen toggles this today; a future pause-menu Options can call the same
  // setter, and the per-frame game loop reacts through playTrack().
  setEnabled(on) {
    const next = !!on;
    if (this.enabled === next) return;
    this.enabled = next;
    this._saveMusicPreference();

    if (!this.started) return;

    if (!next) {
      // Silence everything immediately: stop the active fade and pause every
      // track so nothing keeps playing behind the scenes. currentTrack is
      // cleared so re-enabling starts one fresh transition to whatever the
      // game loop next requests for the current game state.
      if (this.fadeInterval) {
        clearInterval(this.fadeInterval);
        this.fadeInterval = null;
      }
      this.previousTrack = null;
      for (const audio of Object.values(this.tracks)) {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 0;
      }
      this.currentTrack = null;
    }
    // Re-enabling needs no work here: the next playTrack() call from the
    // game loop starts the correct track exactly once.
  }

  _readMusicPreference() {
    try {
      if (typeof localStorage === 'undefined') return true;
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true; // storage unavailable or unreadable: default to enabled
    }
  }

  _saveMusicPreference() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, String(this.enabled));
    } catch {
      // storage unavailable (private mode, quota): keep in-memory only
    }
  }

  setDucking(isDucking) {
    if (this.ducking === isDucking || !this.started) return;
    this.ducking = isDucking;
    
    if (this.currentTrack && this.tracks[this.currentTrack]) {
      const audio = this.tracks[this.currentTrack];
      // Quick jump for ducking, could also be smoothed
      audio.volume = this.ducking ? this.masterVolume * 0.3 : this.masterVolume;
    }
  }

  setMasterVolume(vol) {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.currentTrack && this.tracks[this.currentTrack]) {
      this.tracks[this.currentTrack].volume = this.ducking ? this.masterVolume * 0.3 : this.masterVolume;
    }
  }
}

export const music = new MusicManager();
