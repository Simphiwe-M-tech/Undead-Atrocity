export class MusicManager {
  constructor() {
    this.masterVolume = 0.5;
    this.tracks = {};
    this.currentTrack = null;
    this.nextTrack = null;
    this.fadeInterval = null;
    this.ducking = false;
    this.started = false;
  }

  // Called on first user interaction
  init() {
    if (this.started) return;
    this.started = true;
    
    // Create audio elements
    this._loadTrack('ambient', '/assets/audio/music/ambient.mp3', true);
    this._loadTrack('combat', '/assets/audio/music/combat.mp3', true);
    this._loadTrack('janitor', '/assets/audio/music/janitor_stinger.mp3', false);
    
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
    if (!this.started || !this.tracks[name]) return;
    if (this.currentTrack === name) return;

    const newAudio = this.tracks[name];
    const oldAudio = this.currentTrack ? this.tracks[this.currentTrack] : null;
    
    this.nextTrack = name;
    
    // Play immediately but at 0 volume to start the fade
    newAudio.volume = 0;
    newAudio.play().catch(e => console.warn("Music play blocked:", e));
    
    if (this.fadeInterval) clearInterval(this.fadeInterval);

    const steps = 20;
    const stepTime = fadeTimeMs / steps;
    let currentStep = 0;
    const targetVol = this.ducking ? this.masterVolume * 0.3 : this.masterVolume;

    this.fadeInterval = setInterval(() => {
      currentStep++;
      const t = currentStep / steps;
      
      newAudio.volume = t * targetVol;
      if (oldAudio) {
        oldAudio.volume = (1 - t) * targetVol;
      }
      
      if (currentStep >= steps) {
        clearInterval(this.fadeInterval);
        if (oldAudio) {
          oldAudio.pause();
          oldAudio.currentTime = 0;
        }
        this.currentTrack = this.nextTrack;
      }
    }, stepTime);
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
