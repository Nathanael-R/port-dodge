import test from 'node:test';
import assert from 'node:assert/strict';

test('audio reuses noise buffers, disconnects finished nodes, and resumes after backgrounding', async () => {
  const original = globalThis.window;
  let buffers = 0, disconnected = 0, context;
  const parameter = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ gain: parameter(), frequency: parameter(), Q: parameter(), connect() {}, disconnect() { disconnected++; }, start() { this.onended?.(); }, stop() { this.onended?.(); } });
  class AudioContext {
    constructor() { context = this; this.state = 'suspended'; this.sampleRate = 48000; this.currentTime = 0; }
    createGain() { return node(); }
    createOscillator() { return node(); }
    createBiquadFilter() { return node(); }
    createBufferSource() { return node(); }
    createBuffer(channels, length) { buffers++; return { getChannelData: () => new Float32Array(length) }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext };
  try {
    const audio = await import('../src/audio.js');
    audio.unlockAudio(); assert.equal(context.state, 'running');
    for (let i = 0; i < 20; i++) audio.sfx.clang();
    assert.equal(buffers, 1); assert.ok(disconnected >= 140);
    audio.suspendAudio(); assert.equal(context.state, 'suspended');
    const before = disconnected; audio.sfx.clang(); assert.equal(disconnected, before);
    audio.unlockAudio(); assert.equal(context.state, 'running');
    audio.toggleMute(); audio.sfx.clang(); assert.equal(disconnected, before);
    audio.toggleMute();
  } finally { globalThis.window = original; }
});
