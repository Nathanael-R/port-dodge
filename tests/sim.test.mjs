// Headless balance tests: play full levels with the REAL logic (stepEnemy,
// stepFree, resolveStrike, hopSlot) and the same autopilot policy as ?bot=1.
// These prove the core design claims: attacks can land, and perfect play can win.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import {
  createEnemy, stepEnemy, separateEnemies, stepFree, hopSlot, resolveStrike,
  levelWon, botAxisFreeMulti, botSlotDirMulti, strikeLockout, absorbHit,
  applyDeadWalls, WALL_GAP, createBlocker, stepBlocker, pushOutOfZone, safestSlot,
} from '../src/logic.js';

const DT = 1 / 60;
const NO_DOUBLES = () => 0.5; // roll above every level's `doubles` chance

function setup(idx) {
  const cfg = LEVELS[idx];
  const rail = cfg.rail;
  let ports, center = { x: 480, vx: 0 }, slot = 2, hopCd = 0;
  if (cfg.movement === 'slots') {
    slot = Math.floor(cfg.slots.length / 2);
    ports = [{ x: cfg.slots[slot], vx: 0, w: cfg.player.w, alive: true, slot }];
  } else if (cfg.movement === 'duo') {
    ports = [
      { x: 390, vx: 0, w: cfg.player.w, alive: true, off: -90 },
      { x: 570, vx: 0, w: cfg.player.w, alive: true, off: 90 },
    ];
    center = { x: 480, vx: 0 };
  } else {
    ports = [{ x: 480, vx: 0, w: cfg.player.w, alive: true }];
  }
  const enemies = (cfg.hands || [{}]).map((h, i) => {
    const E = createEnemy(480 + (i === 0 ? 0 : (i % 2 ? 150 : -150)), h.startDelay ?? cfg.enemy.startDelay);
    E.ep = { ...cfg.enemy, ...h };
    return E;
  });
  return { cfg, rail, ports, center, slot, hopCd, enemies, blocker: createBlocker(cfg.blocker) };
}

function nearestAlive(ports, x) {
  const alive = ports.filter(p => p.alive);
  return alive.reduce((a, b) => Math.abs(a.x - x) < Math.abs(b.x - x) ? a : b);
}

// policy: 'bot' (same as ?bot=1) or 'still' (never moves — must lose)
// opts.deadStart: index of a port that begins the sim already plugged (wall test)
// opts.shield: start with the FLIP-FLOP extra life held
function simLevel(idx, { policy = 'bot', roll = NO_DOUBLES, deadStart = -1, shield = false } = {}) {
  const s = setup(idx);
  const { cfg, rail, ports, enemies, blocker } = s;
  let { center, slot, hopCd } = s;
  if (deadStart >= 0 && ports[deadStart]) {
    ports[deadStart].alive = false;
    ports[deadStart].stuckX = ports[deadStart].x;
  }
  let elapsed = 0, misses = 0, impacts = 0, minWallGap = Infinity;
  let flip = shield, invuln = 0;

  while (true) {
    elapsed += DT;
    invuln = Math.max(0, invuln - DT);
    const threats = enemies.map(E => ({ x: E.lockedX, hx: E.x, state: E.state, blackout: !!E.blackout }));
    const seizedWarn = (blocker && blocker.phase !== 'idle' && cfg.blocker.kind === 'slot') ? blocker.slot : -1;
    const seizedSolid = (blocker && blocker.phase === 'active' && cfg.blocker.kind === 'slot') ? blocker.slot : -1;
    const zone = (blocker && blocker.phase === 'active' && cfg.blocker.kind === 'rail')
      ? { x: blocker.x, w: blocker.w } : null;
    if (cfg.movement === 'slots') {
      const p = ports[0];
      hopCd = Math.max(0, hopCd - DT);
      const dir = policy === 'bot' ? botSlotDirMulti(p.slot, cfg.slots, threats, seizedWarn) : 0;
      if (dir !== 0 && hopCd <= 0) {
        const r = hopSlot(p.slot, dir, cfg.slots.length);
        // solid barricades deny landing (mirrors the in-game BLOCKED! fizzle)
        if (r.moved && r.index !== seizedSolid) {
          p.slot = r.index; p.x = cfg.slots[p.slot]; hopCd = cfg.player.hopCooldown;
        }
      }
    } else {
      const aliveRefs = ports.filter(p => p.alive);
      const ref = cfg.movement === 'duo' && aliveRefs.length
        ? aliveRefs.reduce((a, b) => Math.min(...enemies.map(E => Math.abs(a.x - E.x))) < Math.min(...enemies.map(E => Math.abs(b.x - E.x))) ? a : b)
        : ports.find(p => p.alive) || ports[0];
      const axis = policy === 'bot' ? botAxisFreeMulti(ref.x, threats, rail, zone) : 0;
      const tmp = { x: center.x, vx: center.vx };
      stepFree(tmp, axis, DT, { player: cfg.player, rail });
      center = tmp;
      if (cfg.movement === 'duo') {
        for (const p of ports) {
          if (!p.alive) continue;
          p.vx = center.vx;
          p.x = Math.max(rail.min, Math.min(rail.max, center.x + p.off));
        }
        if (zone) {
          for (const p of ports) {
            if (!p.alive) continue;
            p.x = pushOutOfZone(p.x, zone).x;
          }
        }
        applyDeadWalls(ports);
        const alive = ports.filter(p => p.alive);
        if (alive.length >= 1) center.x = alive[0].x - alive[0].off;
        for (const p of alive) {
          for (const w of ports.filter(q => !q.alive && q.stuckX != null)) {
            minWallGap = Math.min(minWallGap, Math.abs(p.x - w.stuckX));
          }
        }
      } else {
        ports[0].x = center.x; ports[0].vx = center.vx;
        if (zone) { const r = pushOutOfZone(ports[0].x, zone); ports[0].x = r.x; center.x = r.x; }
      }
    }

    // territory denial ticks between movement and attacks (mirrors blockerUpdate)
    if (blocker) {
      for (const ev of stepBlocker(blocker, DT, cfg.blocker, rail, cfg.slots || [],
        (i) => ports.some(p => p.alive && p.slot === i), roll)) {
        if (ev === 'eject') {
          const ethreats = enemies.map(E => ({ x: E.lockedX, hx: E.x, state: E.state, blackout: !!E.blackout }));
          for (const p of ports) {
            if (!p.alive || p.slot !== blocker.slot) continue;
            const bi = safestSlot(cfg.slots || [], blocker.slot, ethreats);
            if (bi >= 0) { p.slot = bi; p.x = cfg.slots[bi]; }
          }
        }
      }
    }

    if (!ports.some(p => p.alive)) return { won: false, elapsed, misses, impacts, minWallGap, reason: 'all-dead' };
    for (const E of enemies) {
      const focus = nearestAlive(ports, E.x);
      for (const ev of stepEnemy(E, DT, { x: focus.x, v: focus.vx || 0 }, cfg, roll)) {
        if (ev !== 'impact') continue;
        impacts++;
        const out = resolveStrike(E.lockedX, (E.ep || cfg.enemy).plugW, ports);
        if (out === 'hit') {
          const res = absorbHit({ shield: flip, invuln });
          if (res === 'shielded') { flip = false; invuln = 1.0; }
          else if (res === 'dead') {
            const v = nearestAlive(ports, E.lockedX);
            v.alive = false; v.stuckX = v.x; // corpse becomes a wall for duo survivors
            if (!ports.some(p => p.alive)) return { won: false, elapsed, misses, impacts, minWallGap, shieldLeft: flip, reason: 'all-dead' };
          }
        } else {
          misses++;
          E.doubleQueued = roll() < (E.ep || cfg.enemy).doubles;
        }
      }
    }
    if (levelWon(elapsed, misses, cfg)) return { won: true, elapsed, misses, impacts, minWallGap, shieldLeft: flip };
    separateEnemies(enemies, rail, DT);
    if (elapsed > 180) return { won: false, elapsed, misses, impacts, minWallGap, shieldLeft: flip, reason: 'timeout' };
  }
}

test('L1: skilled play wins by forcing misses', () => {
  const r = simLevel(0, { policy: 'bot' });
  assert.equal(r.won, true, JSON.stringify(r));
  assert.ok(r.misses > 0, 'attacks must actually happen');
  assert.ok(r.impacts > 0);
});

test('L1: standing still gets plugged (no free wins)', () => {
  const r = simLevel(0, { policy: 'still' });
  assert.equal(r.won, false);
  assert.equal(r.reason, 'all-dead');
});

test('L2 (teleport slots): skilled play wins', () => {
  const r = simLevel(1, { policy: 'bot' });
  assert.equal(r.won, true, JSON.stringify(r));
});

test('L2: standing still gets plugged', () => {
  const r = simLevel(1, { policy: 'still' });
  assert.equal(r.won, false);
});

test('L3 (duo ports): skilled play wins', () => {
  const r = simLevel(2, { policy: 'bot' });
  assert.equal(r.won, true, JSON.stringify(r));
});

test('L4 (duo vs TWO hands): skilled play wins', () => {
  const r = simLevel(3, { policy: 'bot' });
  assert.equal(r.won, true, JSON.stringify(r));
  assert.ok(r.impacts >= 2, 'both hands must actually attack');
});

test('L4: standing still gets plugged twice over', () => {
  const r = simLevel(3, { policy: 'still' });
  assert.equal(r.won, false);
  assert.equal(r.reason, 'all-dead');
});

test('dead port is a wall: survivor can never cross the corpse', () => {
  const { applyDeadWalls: walls, WALL_GAP: GAP } = { applyDeadWalls, WALL_GAP };
  // left port died at 300; survivor (right, off +90) tries to push through it
  const ports = [
    { x: 300, w: 60, alive: false, off: -90, stuckX: 300 },
    { x: 390, w: 60, alive: true, off: 90 },
  ];
  ports[1].x = 200; // desire: cross to the left side
  assert.equal(walls(ports), true);
  assert.equal(ports[1].x, 300 + GAP);
  ports[1].x = 500; // free movement on the correct side is untouched
  assert.equal(walls(ports), false);
  assert.equal(ports[1].x, 500);
});

test('L3 with a pre-killed port: survivor respects the wall for the whole level', () => {
  const r = simLevel(2, { policy: 'bot', deadStart: 0 });
  assert.ok(r.minWallGap >= WALL_GAP - 1e-6, `wall breached: ${r.minWallGap}`);
  assert.ok(r.minWallGap <= WALL_GAP + 1e-6, `wall never engaged, test is vacuous: ${r.minWallGap}`);
  assert.equal(r.won, true, JSON.stringify(r));
});

test('hands keep lane space but never disturb a committed strike', () => {
  const cfg = LEVELS[0];
  const rail = cfg.rail;
  const a = createEnemy(480, 0.01); a.ep = { ...cfg.enemy };
  const b = createEnemy(500, 0.01); b.ep = { ...cfg.enemy };
  separateEnemies([a, b], rail, DT);
  assert.ok(Math.abs(b.x - a.x) > 20, 'tracking hands push apart');
  // a committed hand is immovable…
  a.state = 'lock'; a.lockedX = 480; a.x = 480;
  const bx = b.x;
  b.x = 490;
  separateEnemies([a, b], rail, DT);
  assert.equal(a.x, 480, 'locked hand must stay exactly on its telegraph');
  assert.ok(b.x !== 490, 'the other hand yields instead');
  void bx;
});
test('attack commitment: strike cannot steer onto a dodging player', () => {  const cfg = LEVELS[0];
  const E = createEnemy(480, 0.01);
  // run to lock against a stationary player at 480
  let guard = 0;
  while (E.state !== 'lock' && guard++ < 1000) stepEnemy(E, DT, { x: 480, v: 0 }, cfg, NO_DOUBLES);
  assert.equal(E.state, 'lock');
  const locked = E.lockedX;
  // player sprints away the moment it is locked
  const p = { x: 480, vx: 0 };
  guard = 0;
  while (E.state !== 'recover' && guard++ < 1000) {
    stepFree(p, -1, DT, { player: cfg.player, rail: cfg.rail });
    stepEnemy(E, DT, { x: p.x, v: p.vx }, cfg, NO_DOUBLES);
  }
  assert.equal(E.x, locked, 'strike must land exactly where it was telegraphed');
  const out = resolveStrike(locked, cfg.enemy.plugW, [{ x: p.x, w: cfg.player.w, alive: true }]);
  assert.notEqual(out, 'hit', 'a timely dodge must always beat a committed strike');
});

test('FSM: full attack cycle visits every state in order', () => {
  const cfg = LEVELS[0];
  const E = createEnemy(480, 0.01);
  const seen = [];
  let guard = 0, last = E.state;
  while ((seen[seen.length - 1] !== 'recover' || E.t > cfg.enemy.recoverTime - 0.01) && guard++ < 2000) {
    stepEnemy(E, DT, { x: 480, v: 0 }, cfg, NO_DOUBLES);
    if (E.state !== last) { seen.push(E.state); last = E.state; }
  }
  assert.deepEqual(seen, ['track', 'lock', 'strike', 'recover']);
});

test('strikeLockout: any strike in flight blocks teleporting', () => {
  assert.equal(strikeLockout([{ x: 1, state: 'track' }]), false);
  assert.equal(strikeLockout([{ x: 1, state: 'lock' }]), false);
  assert.equal(strikeLockout([{ x: 1, state: 'strike' }]), true);
  assert.equal(strikeLockout([{ x: 1, state: 'lock' }, { x: 2, state: 'strike' }]), true);
});

test('teleport bot refuses panic-hops during strikes, dodges during locks', () => {
  const slots = LEVELS[1].slots;
  // mid slot, threat locked on it, other hand mid-strike -> must hold still
  assert.equal(botSlotDirMulti(2, slots, [{ x: 480, state: 'lock' }, { x: 100, state: 'strike' }]), 0);
  // single lock on our slot -> step away
  const dir = botSlotDirMulti(2, slots, [{ x: 480, state: 'lock' }]);
  assert.notEqual(dir, 0);
});

test('absorbHit: phase-out beats shield beats death', () => {
  assert.equal(absorbHit({ shield: false, invuln: 0 }), 'dead');
  assert.equal(absorbHit({ shield: true, invuln: 0 }), 'shielded');
  assert.equal(absorbHit({ shield: true, invuln: 0.5 }), 'ignored');
  assert.equal(absorbHit({ shield: false, invuln: 0.5 }), 'ignored');
});

test('L2 still winnable with the strike lockout enforced', () => {
  const r = simLevel(1, { policy: 'bot' });
  assert.equal(r.won, true, JSON.stringify(r));
  assert.ok(r.misses > 0, 'dodges must happen during telegraphs now');
});

test('FLIP-FLOP: a held extra life outlasts going without', () => {
  const plain = simLevel(3, { policy: 'still' });
  const saved = simLevel(3, { policy: 'still', shield: true });
  assert.equal(plain.won, false);
  assert.equal(saved.won, false); // standing still with two hands: still doomed, just later
  assert.ok(saved.elapsed > plain.elapsed + 0.9, `shield should buy ~1s+ of phase-out: ${saved.elapsed} vs ${plain.elapsed}`);
  assert.equal(saved.shieldLeft, false, 'the one-shot must be consumed');
});

test('blackout: each lock rolls the crosshair cut-out', () => {
  const cfg = LEVELS[4];
  const on = createEnemy(480, 0.01);
  let guard = 0;
  while (on.state !== 'lock' && guard++ < 1000) stepEnemy(on, DT, { x: 480, v: 0 }, cfg, () => 0);
  assert.equal(on.blackout, true, 'roll 0 beats a 0.35 blackout chance');
  const off = createEnemy(480, 0.01);
  guard = 0;
  while (off.state !== 'lock' && guard++ < 1000) stepEnemy(off, DT, { x: 480, v: 0 }, cfg, () => 0.99);
  assert.equal(off.blackout, false);
});

test('blackout bot reads the hand, not the hidden marker', () => {
  const slots = LEVELS[4].slots; // [150, 305, 480, 655, 810], bot on slot 2 (480)
  // lock is secretly on slot 3 (655) but the crosshair is out and the fist
  // still sits far left (150): judge by the fist -> the safe side is right
  const dir = botSlotDirMulti(2, slots, [{ x: 655, hx: 150, state: 'lock', blackout: true }]);
  assert.equal(dir, 1);
  // same geometry with the crosshair live: the real target (655) rules -> run left
  const dir2 = botSlotDirMulti(2, slots, [{ x: 655, hx: 150, state: 'lock', blackout: false }]);
  assert.equal(dir2, -1);
});

test('pushOutOfZone: inside gets shoved to the nearest edge, outside untouched', () => {
  const z = { x: 500, w: 160 }; // 420..580
  assert.deepEqual(pushOutOfZone(500, z), { x: 580, moved: true }); // center ties go right
  assert.deepEqual(pushOutOfZone(430, z), { x: 420, moved: true });
  assert.deepEqual(pushOutOfZone(570, z), { x: 580, moved: true });
  assert.deepEqual(pushOutOfZone(100, z), { x: 100, moved: false });
  assert.deepEqual(pushOutOfZone(100, null), { x: 100, moved: false });
});

test('stepBlocker: idle -> warn -> solid -> idle, seizing only free slots', () => {
  const bc = { kind: 'slot', warn: 1.0, dur: 5, gap: 4 };
  const B = createBlocker(bc);
  assert.equal(B.phase, 'idle');
  const slots = [150, 305, 480, 655, 810];
  const occ = (i) => i === 2; // camper on the middle slot
  const seen = [];
  for (let t = 0; t < 2.05; t += DT) seen.push(...stepBlocker(B, DT, bc, null, slots, occ, () => 0.99));
  assert.equal(B.phase, 'warn');
  assert.notEqual(B.slot, 2, 'never seizes the occupied slot');
  assert.deepEqual(seen, ['warn']);
  seen.length = 0;
  for (let t = 0; t < 1.05; t += DT) seen.push(...stepBlocker(B, DT, bc, null, slots, occ, () => 0.99));
  assert.equal(B.phase, 'active');
  assert.deepEqual(seen, ['solid']); // no eject: nobody was on it
  seen.length = 0;
  for (let t = 0; t < 5.05; t += DT) seen.push(...stepBlocker(B, DT, bc, null, slots, occ, () => 0.5));
  assert.deepEqual(seen, ['clear']);
  assert.equal(B.phase, 'idle');
});

test('stepBlocker ejects a camper seized mid-stay', () => {
  const bc = { kind: 'slot', warn: 0.2, dur: 5, gap: 99 };
  const B = createBlocker(bc);
  const slots = [150, 305, 480, 655, 810];
  // idle expires (roll picks slot), warn expires while occupied -> solid + eject
  const seen = [];
  for (let t = 0; t < 2.05; t += DT) seen.push(...stepBlocker(B, DT, bc, null, slots, () => false, () => 0));
  assert.deepEqual(seen, ['warn']);
  seen.length = 0;
  for (let t = 0; t < 0.25; t += DT) seen.push(...stepBlocker(B, DT, bc, null, slots, () => true, () => 0));
  assert.deepEqual(seen, ['solid', 'eject']);
});

test('L5 BLACKOUT: body-language dodging wins with cut-out crosshairs', () => {
  const r = simLevel(4, { policy: 'bot' });
  assert.equal(r.won, true, JSON.stringify(r));
  assert.ok(r.misses > 0);
});

test('L5: standing still gets plugged', () => {
  const r = simLevel(4, { policy: 'still' });
  assert.equal(r.won, false);
  assert.equal(r.reason, 'all-dead');
});
