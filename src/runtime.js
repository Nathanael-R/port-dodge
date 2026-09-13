// Small, injectable scheduler: static screens have no recurring animation callbacks.
export function createFrameScheduler(render, { request = requestAnimationFrame, cancel = cancelAnimationFrame, now = () => performance.now() } = {}) {
  let pending = null, last = 0;
  function tick(time) {
    pending = null;
    const elapsed = Math.max(0, (time - last) / 1000); last = time;
    if (render(time, elapsed) && pending === null) pending = request(tick);
  }
  return {
    wake() { if (pending === null) { last = now(); pending = request(tick); } },
    stop() { if (pending !== null) cancel(pending); pending = null; },
  };
}

export function canvasSize(cssWidth, dpr = 1) {
  // Match the displayed width at up to 2x density; never allocate above 1920x1080.
  const width = Math.max(1, Math.min(1920, Math.round(cssWidth * Math.min(2, Math.max(1, dpr)))));
  return { width, height: Math.max(1, Math.round(width * 9 / 16)) };
}
