// Opt-in diagnostics (?perf=1). This module is not downloaded during normal play.
export function createProfiler() {
  const panel = document.createElement('output');
  panel.id = 'perf';
  panel.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:20;background:#000e;color:#d6fa72;padding:8px;font:11px monospace;white-space:pre;pointer-events:none';
  document.body.append(panel);
  const samples = new Float64Array(240);
  let count = 0, cursor = 0, frames = 0, since = performance.now();
  return {
    begin: () => performance.now(),
    end(start, canvas, screen) {
      const now = performance.now();
      samples[cursor] = now - start; cursor = (cursor + 1) % samples.length;
      count = Math.min(samples.length, count + 1); frames++;
      panel.dataset.frameCount = String(Number(panel.dataset.frameCount || 0) + 1);
      if (screen !== "playing" && !screen.endsWith("-pending")) {
        panel.textContent = `State: ${screen} (idle; no recurring frames)\nCanvas: ${canvas.width} x ${canvas.height}`;
        return;
      }
      if (now - since < 1000) return;
      const sorted = Array.from(samples.subarray(0, count)).sort((a, b) => a - b);
      panel.textContent = `State: ${screen}\nFrames/s: ${(frames * 1000 / (now - since)).toFixed(1)}\nCPU/frame mean: ${(sorted.reduce((a,b) => a+b,0) / count).toFixed(2)} ms\nCPU/frame p95: ${sorted[Math.floor((count - 1) * .95)].toFixed(2)} ms\nCanvas: ${canvas.width} x ${canvas.height}`;
      since = now; frames = 0;
    },
  };
}
