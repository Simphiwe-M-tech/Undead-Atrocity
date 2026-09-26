// Production audio is created during module import. Supply the browser API
// before Node loads the game modules; individual sound tests use their own spies.
const parameter = () => ({
  value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
});
const node = () => ({
  gain: parameter(), frequency: parameter(),
  connect() {}, disconnect() {}, start() {}, stop() {},
});
class AudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = {}; }
  createGain() { return node(); }
  createOscillator() { return node(); }
  createBufferSource() { return node(); }
  createBiquadFilter() { return node(); }
  createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  resume() {}
}
globalThis.window = { AudioContext };
