export class ProceduralAudio {
  constructor(maxVoices = 32) {
    // Create context; will likely start in 'suspended' state
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;
    this.masterGain.connect(this.ctx.destination);

    this.voices = [];
    this.maxVoices = maxVoices;
    
    // Pre-allocate Gain nodes for the pool
    for (let i = 0; i < this.maxVoices; i++) {
      const gainNode = this.ctx.createGain();
      gainNode.connect(this.masterGain);
      this.voices.push({
        gainNode: gainNode,
        activeUntil: 0
      });
    }
  }

  resume() {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Acquire a free voice channel from the pool
  _getVoice() {
    const now = this.ctx.currentTime;
    let oldest = this.voices[0];
    for (let i = 0; i < this.voices.length; i++) {
      if (this.voices[i].activeUntil <= now) {
        return this.voices[i];
      }
      if (this.voices[i].activeUntil < oldest.activeUntil) {
        oldest = this.voices[i];
      }
    }
    // If pool is exhausted, steal the oldest voice (prevent stutter, keep max voices)
    return oldest;
  }

  playGunshot() {
    const v = this._getVoice();
    const t = this.ctx.currentTime;
    v.activeUntil = t + 0.3;

    // Transient click
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);

    // Noise burst
    const bufferSize = this.ctx.sampleRate * 0.3; // 300ms
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    // Filter noise for "thump"
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, t);
    filter.frequency.exponentialRampToValueAtTime(100, t + 0.2);
    noise.connect(filter);
    filter.connect(v.gainNode);

    osc.connect(v.gainNode);

    // Envelope
    v.gainNode.gain.setValueAtTime(1.0, t);
    v.gainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.25);

    osc.start(t);
    noise.start(t);
    osc.stop(t + 0.3);
    noise.stop(t + 0.3);
  }

  playZombieHit() {
    const v = this._getVoice();
    const t = this.ctx.currentTime;
    v.activeUntil = t + 0.15;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.linearRampToValueAtTime(50, t + 0.1);
    
    osc.connect(v.gainNode);
    v.gainNode.gain.setValueAtTime(0.8, t);
    v.gainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
    
    osc.start(t);
    osc.stop(t + 0.15);
  }

  playZombieDeath() {
    const v = this._getVoice();
    const t = this.ctx.currentTime;
    v.activeUntil = t + 0.5;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(20, t + 0.4);
    
    osc.connect(v.gainNode);
    v.gainNode.gain.setValueAtTime(0.8, t);
    v.gainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
    
    osc.start(t);
    osc.stop(t + 0.5);
  }

  playExplosion() {
    const v = this._getVoice();
    const t = this.ctx.currentTime;
    v.activeUntil = t + 0.8;

    const bufferSize = this.ctx.sampleRate * 0.8;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.2));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, t);
    filter.frequency.linearRampToValueAtTime(100, t + 0.6);
    
    noise.connect(filter);
    filter.connect(v.gainNode);

    v.gainNode.gain.setValueAtTime(1.0, t);
    v.gainNode.gain.linearRampToValueAtTime(0.01, t + 0.7);

    noise.start(t);
  }

  playPlayerHurt() {
    const v = this._getVoice();
    const t = this.ctx.currentTime;
    v.activeUntil = t + 0.3;

    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.linearRampToValueAtTime(40, t + 0.2);
    
    osc.connect(v.gainNode);
    v.gainNode.gain.setValueAtTime(0.9, t);
    v.gainNode.gain.linearRampToValueAtTime(0.01, t + 0.2);
    
    osc.start(t);
    osc.stop(t + 0.3);
  }

  playUIClick() {
    const v = this._getVoice();
    const t = this.ctx.currentTime;
    v.activeUntil = t + 0.1;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.05);
    
    osc.connect(v.gainNode);
    v.gainNode.gain.setValueAtTime(0.5, t);
    v.gainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
    
    osc.start(t);
    osc.stop(t + 0.1);
  }

  playJanitorStinger() {
    const v = this._getVoice();
    const t = this.ctx.currentTime;
    v.activeUntil = t + 2.0;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.linearRampToValueAtTime(120, t + 1.5);
    
    osc.connect(v.gainNode);
    v.gainNode.gain.setValueAtTime(0.01, t);
    v.gainNode.gain.linearRampToValueAtTime(1.0, t + 0.2);
    v.gainNode.gain.exponentialRampToValueAtTime(0.01, t + 1.9);
    
    osc.start(t);
    osc.stop(t + 2.0);
  }
}

export const sfx = new ProceduralAudio();
