import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlap1D, resolveStrike, hopSlot, levelWon, stepFree, lockTarget } from '../src/logic.js';

test('overlap1D: clean hit vs graze', () => {
  assert.equal(overlap1D(100, 46, 100, 66), true);
  assert.equal(overlap1D(100, 46, 500, 66), false);
  // grazing edge is forgiven
  assert.equal(overlap1D(0, 46, 45, 66), false);
});

test('resolveStrike: hit / near / miss', () => {
  const ports = [{ x: 480, w: 66, alive: true }];
  assert.equal(resolveStrike(480, 46, ports), 'hit');
  assert.equal(resolveStrike(480 + 50, 46, ports), 'near');
  assert.equal(resolveStrike(480 + 300, 46, ports), 'miss');
});

test('resolveStrike ignores dead ports', () => {
  const ports = [{ x: 480, w: 66, alive: false }, { x: 700, w: 66, alive: true }];
  assert.equal(resolveStrike(480, 46, ports), 'miss');
  assert.equal(resolveStrike(700, 46, ports), 'hit');
});

test('hopSlot clamps at rail ends', () => {
  assert.deepEqual(hopSlot(0, -1, 5), { index: 0, moved: false });
  assert.deepEqual(hopSlot(0, 1, 5), { index: 1, moved: true });
  assert.deepEqual(hopSlot(4, 1, 5), { index: 4, moved: false });
});

test('levelWon on timer or misses', () => {
  const cfg = { time: 30, missesToWin: 5 };
  assert.equal(levelWon(30.1, 0, cfg), true);
  assert.equal(levelWon(5, 5, cfg), true);
  assert.equal(levelWon(5, 2, cfg), false);
});

test('stepFree clamps to rail and respects max speed', () => {
  const cfg = { player: { accel: 4600, maxSpeed: 560, friction: 9 }, rail: { min: 90, max: 870 } };
  const p = { x: 480, vx: 0 };
  for (let i = 0; i < 600; i++) stepFree(p, 1, 1 / 60, cfg);
  assert.ok(p.x <= 870 && p.vx <= 560);
  assert.ok(p.x > 480);
});

test('lockTarget applies velocity lead and clamps', () => {
  const rail = { min: 90, max: 870 };
  assert.equal(lockTarget(400, 500, 0.2, rail), 500);
  assert.equal(lockTarget(860, 500, 0.5, rail), 870);
  assert.equal(lockTarget(100, -500, 0.5, rail), 90);
});
