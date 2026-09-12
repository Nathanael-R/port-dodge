// Tiny procedural audio: no assets, WebAudio oscillators + noise buffer.
let ctx = null, master = null, muted = false;

function ensure() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    return true;
  } catch { return false; }
}
export function isMuted() { return muted; }
export function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.35; return muted; }

function env(g, t0, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}
function tone(freq, dur = 0.1, type = 'square', vol = 0.5, slideTo = null, delay = 0) {
  if (muted || !ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  env(g, t0, 0.005, vol, dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(dur = 0.2, vol = 0.4, filterFreq = 1200, delay = 0) {
  if (muted || !ensure()) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filterFreq; f.Q.value = 0.8;
  const g = ctx.createGain(); env(g, t0, 0.004, vol, dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0);
}

export const sfx = {
  ui() { tone(660, 0.07, 'square', 0.3); },
  tick(n = 0) { tone(880 + (n % 4) * 120, 0.05, 'square', 0.25); },
  lock() { tone(220, 0.25, 'sawtooth', 0.35, 440); },
  whoosh() { noise(0.22, 0.5, 900); tone(300, 0.2, 'sawtooth', 0.2, 900); },
  clang() { noise(0.18, 0.6, 2400); tone(180, 0.2, 'square', 0.4, 90); tone(1250, 0.08, 'square', 0.2); },
  nearMiss() { tone(1200, 0.09, 'sine', 0.4, 1800); tone(1600, 0.12, 'sine', 0.35, 2200, 0.08); },
  hop() { tone(500, 0.08, 'square', 0.3, 900); },
  bump() { tone(140, 0.09, 'square', 0.32, 85); noise(0.07, 0.28, 650); },
  deny() { tone(170, 0.13, 'sawtooth', 0.32, 110); tone(120, 0.13, 'sawtooth', 0.28, 80, 0.09); },
  saved() { [660, 880, 1320].forEach((f, i) => tone(f, 0.1, 'square', 0.32, null, i * 0.07)); noise(0.15, 0.4, 3000); },
  plugged() { tone(400, 0.3, 'sawtooth', 0.5, 60); noise(0.4, 0.5, 500, 0.05); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, 'square', 0.32, null, i * 0.11)); },
  lose() { [330, 262, 196, 131].forEach((f, i) => tone(f, 0.2, 'sawtooth', 0.32, null, i * 0.14)); },
};
