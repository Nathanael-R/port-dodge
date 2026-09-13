import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameScheduler, canvasSize } from '../src/runtime.js';
import { createInput } from '../src/input.js';

test('scheduler sleeps on static screens, deduplicates wakeups, and resets elapsed after idle', () => {
  const queued = new Map(); let id = 0, time = 0, active = false;
  const elapsed = [];
  const scheduler = createFrameScheduler((now, dt) => { elapsed.push(dt); return active; }, {
    request(fn) { queued.set(++id, fn); return id; },
    cancel(id) { queued.delete(id); }, now: () => time,
  });
  const tick = () => { const [id, callback] = queued.entries().next().value; queued.delete(id); time += 16; callback(time); };
  scheduler.wake(); scheduler.wake(); assert.equal(queued.size, 1);
  tick(); assert.equal(queued.size, 0);
  time += 10000; active = true; scheduler.wake(); tick();
  assert.equal(elapsed.at(-1), .016); assert.equal(queued.size, 1);
  tick(); assert.equal(queued.size, 1);
  scheduler.stop(); assert.equal(queued.size, 0);
});

test('phone canvas follows visible pixels with bounded density and desktop allocation', () => {
  assert.deepEqual(canvasSize(362, 3), { width: 724, height: 407 });
  assert.deepEqual(canvasSize(1180, 1), { width: 1180, height: 664 });
  assert.deepEqual(canvasSize(4000, 3), { width: 1920, height: 1080 });
});

test('fast tap survives pointerup; secondary fingers cannot steal or cancel a drag', () => {
  const windowHandlers = new Map(), handlers = new Map(); let reads = 0;
  const original = globalThis.window;
  globalThis.window = { addEventListener(event, fn) { windowHandlers.set(event, fn); } };
  try {
    const input = createInput({ addEventListener(event, fn) { handlers.set(event, fn); }, getBoundingClientRect() { reads++; return { left: 10, width: 480 }; } });
    handlers.get('pointerdown')({ pointerId: 1, clientX: 130 });
    handlers.get('pointerdown')({ pointerId: 2, isPrimary: false, clientX: 450 });
    handlers.get('pointermove')({ pointerId: 2, clientX: 450 });
    handlers.get('pointerup')({ pointerId: 2 });
    assert.equal(input.state.pointerActive, true); assert.equal(input.state.pointerX, 240);
    handlers.get('pointermove')({ pointerId: 1, clientX: 170 });
    assert.equal(reads, 1, 'drag movement must not reread layout');
    handlers.get('pointerup')({ pointerId: 1 });
    handlers.get('lostpointercapture')({ pointerId: 1 });
    assert.equal(input.consumeTap(), 240); assert.equal(input.consumeTap(), null);
    handlers.get('pointerdown')({ pointerId: 3, clientX: 300 });
    handlers.get('pointercancel')({ pointerId: 3 });
    assert.equal(input.consumeTap(), null);
    input.holdDirection(-1); assert.equal(input.state.axis, -1);
    input.reset(); assert.equal(input.state.axis, 0);
    input.tap(480); assert.equal(input.consumeTap(), 480);
  } finally { globalThis.window = original; }
});
