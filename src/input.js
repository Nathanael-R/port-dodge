// Central input: keyboard state + edge-triggered presses + pointer for drag/tap.
export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set(); // edge-triggered, consumed each frame
  const state = {
    axis: 0,          // -1..1 horizontal intent
    pointerX: null,   // logical x when dragging
    pointerActive: false,
    tappedSlot: -1,
  };

  function axisFromKeys() {
    let a = 0;
    if (keys.has('arrowleft') || keys.has('a')) a -= 1;
    if (keys.has('arrowright') || keys.has('d')) a += 1;
    // also allow up/down keys? no — horizontal rail game
    return a;
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowleft','arrowright','arrowup','arrowdown',' '].includes(k)) e.preventDefault();
    if (!e.repeat) pressed.add(k === ' ' ? 'space' : k);
    keys.add(k === ' ' ? 'space' : k);
    state.axis = axisFromKeys();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k === ' ' ? 'space' : k);
    state.axis = axisFromKeys();
  });
  window.addEventListener('blur', () => { keys.clear(); state.axis = 0; });

  // Pointer: drag to move (free mode), tap slots (teleport mode).
  // Convert client coords -> logical 960x540.
  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX);
    return { x: (cx - r.left) / r.width * 960, y: 0 };
  }
  canvas.addEventListener('pointerdown', (e) => {
    state.pointerActive = true;
    state.pointerX = toLogical(e).x;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state.pointerActive) state.pointerX = toLogical(e).x;
  });
  const up = () => { state.pointerActive = false; state.pointerX = null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return {
    state, keys,
    consume(framePressed) {
      for (const k of pressed) framePressed.add(k);
      pressed.clear();
    },
    endFrame() {},
  };
}
