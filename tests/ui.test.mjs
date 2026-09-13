import test from 'node:test';
import assert from 'node:assert/strict';
import { createFX, createNearMissSlowMo } from '../src/fx.js';
import { createInput } from '../src/input.js';

test('effects stay bounded during repeated bursts and reset between attempts', () => {
  const fx = createFX();
  for (let i = 0; i < 100; i++) fx.sparks(100, 100);
  let painted = 0;
  const context = { fillRect() { painted++; } };
  fx.draw(context);
  assert.equal(painted, 160);
  fx.addShake(12); fx.stop(0.5); fx.reset();
  assert.equal(fx.frozen, false);
  assert.equal(fx.shakeX, 0);
  painted = 0; fx.draw(context); assert.equal(painted, 0);
  assert.equal(fx.update(0.016), 0.016);
});

test('reduced motion suppresses shake and limits decorative particles', () => {
  const fx = createFX(() => true);
  fx.sparks(0, 0); fx.addShake(18); fx.update(0.016);
  assert.equal(fx.shakeX, 0); assert.equal(fx.shakeY, 0);
  let painted = 0; fx.draw({ fillRect() { painted++; } });
  assert.equal(painted, 4);
});

test('blur clears held movement, pending keys, and captured drag intent', () => {
  const listeners = new Map(), canvasListeners = new Map();
  const original = globalThis.window;
  globalThis.window = { addEventListener(name, callback) { listeners.set(name, callback); } };
  try {
    const canvas = { addEventListener(name, callback) { canvasListeners.set(name, callback); }, getBoundingClientRect() { return { left: 0, width: 480 }; } };
    const input = createInput(canvas);
    listeners.get('keydown')({ key: 'd', repeat: false, target: {}, preventDefault() {} });
    canvasListeners.get('pointerdown')({ clientX: 120 });
    assert.equal(input.state.axis, 1); assert.equal(input.state.pointerX, 240);
    listeners.get('blur')();
    const pressed = new Set(); input.consume(pressed);
    assert.equal(pressed.size, 0); assert.equal(input.state.axis, 0);
    assert.equal(input.state.pointerActive, false); assert.equal(input.state.pointerX, null);
    let prevented = false;
    listeners.get('keydown')({ key: ' ', repeat: false, target: { tagName: 'BUTTON' }, preventDefault() { prevented = true; } });
    assert.equal(prevented, false, 'native space activation remains available on buttons');
  } finally { globalThis.window = original; }
});


test('near-miss slow motion is brief, once per attempt, and cooldown survives retries', () => {
  const slow = createNearMissSlowMo();
  assert.equal(slow.update(1), 1);
  assert.equal(slow.trigger(), true);
  assert.equal(slow.update(0.14), 0.4);
  assert.ok(Math.abs(slow.update(0.14) - 0.7) < 1e-9);
  assert.equal(slow.update(0.01), 1);
  assert.equal(slow.trigger(), false);
  slow.resetAttempt();
  assert.equal(slow.trigger(), false, 'retry must not bypass cooldown');
  slow.update(18);
  assert.equal(slow.trigger(), true);
  slow.update(20);
  assert.equal(slow.trigger(), false, 'only one slow motion per attempt');
  slow.resetAttempt();
  assert.equal(slow.trigger(), true);
  slow.resetAttempt();
  assert.equal(slow.update(0.01), 1, 'reset clears the active effect');
});

test('reduced motion disables near-miss slow motion, including an active beat', () => {
  let reduce = true;
  const slow = createNearMissSlowMo(() => reduce);
  assert.equal(slow.trigger(), false);
  reduce = false;
  assert.equal(slow.trigger(), true);
  reduce = true;
  assert.equal(slow.update(0.01), 1);
});
