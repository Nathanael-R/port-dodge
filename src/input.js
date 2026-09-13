// One primary pointer, held movement, and buffered taps between simulation frames.
export function createInput(canvas, onInput = () => {}) {
  const keys = new Set(), pressed = new Set();
  const state = { axis: 0, pointerX: null, pointerActive: false };
  let pointerId = null, pointerRect = null, tapX = null, touchAxis = 0;
  function updateAxis() {
    state.axis = touchAxis || (Number(keys.has('arrowright') || keys.has('d')) - Number(keys.has('arrowleft') || keys.has('a')));
  }
  function reset() {
    keys.clear(); pressed.clear(); touchAxis = 0; state.axis = 0;
    if (pointerId !== null && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null; pointerRect = null; tapX = null;
    state.pointerX = null; state.pointerActive = false;
  }
  window.addEventListener('keydown', e => {
    const key = e.key.toLowerCase(), normalized = key === ' ' ? 'space' : key;
    if (['arrowleft','arrowright','arrowup','arrowdown',' '].includes(key) && e.target?.tagName !== 'BUTTON') e.preventDefault();
    if (!e.repeat) pressed.add(normalized);
    keys.add(normalized); updateAxis(); onInput();
  });
  window.addEventListener('keyup', e => {
    const key = e.key.toLowerCase(); keys.delete(key === ' ' ? 'space' : key);
    updateAxis(); onInput();
  });
  window.addEventListener('blur', reset);
  window.addEventListener('resize', reset);
  canvas.addEventListener('pointerdown', e => {
    if (e.isPrimary === false || (e.button != null && e.button !== 0) || pointerId !== null) return;
    pointerId = e.pointerId ?? 0; pointerRect = canvas.getBoundingClientRect();
    state.pointerActive = true;
    state.pointerX = (e.clientX - pointerRect.left) / pointerRect.width * 960;
    tapX = state.pointerX;
    canvas.setPointerCapture?.(pointerId); onInput();
  });
  canvas.addEventListener('pointermove', e => {
    if (!state.pointerActive || (e.pointerId ?? 0) !== pointerId) return;
    state.pointerX = (e.clientX - pointerRect.left) / pointerRect.width * 960;
  });
  function release(e, cancelled) {
    if ((e.pointerId ?? 0) !== pointerId) return;
    pointerId = null; pointerRect = null;
    state.pointerActive = false; state.pointerX = null;
    if (cancelled) tapX = null;
  }
  canvas.addEventListener('pointerup', e => release(e, false));
  canvas.addEventListener('pointercancel', e => release(e, true));
  canvas.addEventListener('lostpointercapture', e => release(e, true));
  return {
    state, keys, reset,
    consume(framePressed) { for (const key of pressed) framePressed.add(key); pressed.clear(); },
    consumeTap() { const x = tapX; tapX = null; return x; },
    tap(x) { tapX = x; onInput(); },
    holdDirection(direction) {
      touchAxis = direction;
      pressed.add(direction < 0 ? 'arrowleft' : 'arrowright');
      updateAxis(); onInput();
    },
    releaseDirection() { touchAxis = 0; updateAxis(); },
  };
}
