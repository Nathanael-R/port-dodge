// Pure gameplay helpers — no DOM/window access so they can be unit-tested in Node.
export const W = 960, H = 540, EDGE_Y = 168;

export function overlap1D(ax, aw, bx, bw, forgiveness = 0.7) {
  // Forgiving: require real overlap, not pixel grazing.
  return Math.abs(ax - bx) < ((aw + bw) / 2) * forgiveness;
}

// Resolve a strike: returns 'hit' | 'miss' | 'near' (near = dramatic close dodge)
export function resolveStrike(plugX, plugW, ports, nearWindow = 62) {
  let best = Infinity;
  for (const p of ports) {
    if (p.alive) best = Math.min(best, Math.abs(plugX - p.x));
  }
  const ref = ports.find(p => p.alive && Math.abs(plugX - p.x) === best);
  const w = ref ? ref.w : 66;
  if (overlap1D(plugX, plugW, ref ? ref.x : 1e9, w)) return 'hit';
  if (best <= nearWindow) return 'near';
  return 'miss';
}

// Teleport hop: move index by dir, clamped. Returns {index, moved}.
export function hopSlot(index, dir, count) {
  const next = Math.max(0, Math.min(count - 1, index + dir));
  return { index: next, moved: next !== index };
}

export function levelWon(elapsed, misses, cfg) {
  return misses >= cfg.missesToWin || elapsed >= cfg.time;
}

// Free-movement physics step (semi-implicit Euler, framerate independent).
export function stepFree(p, axis, dt, cfg) {
  const c = cfg.player;
  p.vx += axis * c.accel * dt;
  if (axis === 0) {
    // exponential damping
    p.vx -= p.vx * Math.min(1, c.friction * dt);
    if (Math.abs(p.vx) < 4) p.vx = 0;
  }
  p.vx = Math.max(-c.maxSpeed, Math.min(c.maxSpeed, p.vx));
  p.x += p.vx * dt;
  p.x = Math.max(cfg.rail.min, Math.min(cfg.rail.max, p.x));
  return p;
}

// Enemy lock target: current player x + velocity lead, clamped to rail.
export function lockTarget(playerX, playerV, lead, rail) {
  return Math.max(rail.min, Math.min(rail.max, playerX + playerV * lead));
}

// --- enemy attack state machine (pure; rendering/sound live in main.js) ---
// States: idle -> track -> lock -> strike -> recover -> track ...
// Commitment guarantee: from 'lock' on, E.x converges to E.lockedX and the
// strike always lands on lockedX, so a timely dodge always works.
export function createEnemy(x, startDelay) {
  return { state: 'idle', t: startDelay, x, lockedX: x, doubleQueued: false, blackout: false };
}

// focus: {x, v} of the nearest living port. Returns events: 'locked'|'struck'|'impact'.
// roll: random source (injectable for deterministic tests).
export function stepEnemy(E, dt, focus, cfg, roll = Math.random) {
  const e = E.ep || cfg.enemy;
  const ev = [];
  E.t -= dt;
  const rail = cfg.rail;
  switch (E.state) {
    case 'idle':
      E.x += (focus.x - E.x) * Math.min(1, 3 * dt);
      if (E.t <= 0) { E.state = 'track'; E.t = e.trackTime; }
      break;
    case 'track': {
      const dx = focus.x - E.x;
      const capped = Math.max(-e.trackSpeed * dt, Math.min(e.trackSpeed * dt, dx * 4 * dt + Math.sign(dx) * e.trackSpeed * 0.35 * dt));
      E.x += capped;
      E.x = Math.max(rail.min, Math.min(rail.max, E.x));
      if (E.t <= 0) {
        E.lockedX = lockTarget(focus.x, focus.v || 0, e.lead, rail);
        E.state = 'lock'; E.t = e.lockTime;
        E.blackout = roll() < (e.blackout || 0); // crosshair cuts out at random
        ev.push('locked');
      }
      break;
    }
    case 'lock':
      E.x += (E.lockedX - E.x) * Math.min(1, 10 * dt);
      if (E.t <= 0) { E.state = 'strike'; E.t = e.strikeTime; E.x = E.lockedX; ev.push('struck'); }
      break;
    case 'strike':
      if (E.t <= 0) { E.state = 'recover'; E.t = e.recoverTime; ev.push('impact'); }
      break;
    case 'recover':
      E.x += (focus.x - E.x) * Math.min(1, 1.2 * dt);
      if (E.t <= 0) {
        if (E.doubleQueued) {
          E.doubleQueued = false;
          E.lockedX = lockTarget(focus.x, focus.v || 0, e.lead * 0.6, rail);
          E.state = 'lock'; E.t = Math.max(0.32, e.lockTime * 0.6);
          E.blackout = roll() < (e.blackout || 0);
          ev.push('locked');
        } else {
          E.state = 'track'; E.t = e.trackTime * (0.85 + roll() * 0.4);
        }
      }
      break;
  }
  return ev;
}

// --- autopilot used by ?bot=1 and by headless balance tests ---
// threats: [{x: lockedX, hx: handX, state, blackout}] across ALL live enemies.
// Strategy: drift to mid-rail while tracked, then sprint to the spot farthest
// from every committed strike once locked. During a blackout the locked target
// is unknown, so the hand's own body position is read instead — exactly like
// a human must. `blocker`: {x,w} rail zone to avoid, or null.
export function botAxisFreeMulti(portX, threats, rail, blocker = null) {
  const pos = (t) => (t.blackout && t.state === 'lock' ? (t.hx ?? t.x) : t.x);
  const active = threats.filter(t => t.state === 'lock' || t.state === 'strike');
  if (!active.length) {
    const d = (rail.min + rail.max) / 2 - portX;
    if (Math.abs(d) < 40) return 0;
    return Math.sign(d) * 0.5;
  }
  let cands = [rail.min + 60, (rail.min + rail.max) / 2, rail.max - 60];
  if (blocker) {
    const clear = cands.filter(c => c < blocker.x - blocker.w / 2 || c > blocker.x + blocker.w / 2);
    if (clear.length) cands = clear;
  }
  let best = cands[0], bd = -1;
  for (const c of cands) {
    const m = Math.min(...active.map(t => Math.abs(c - pos(t))));
    if (m > bd) { bd = m; best = c; }
  }
  const d = best - portX;
  if (Math.abs(d) < 30) return 0;
  return Math.sign(d);
}

// Slots mode: single step toward the slot farthest from every committed threat.
// No hopping while a strike is in flight (anti panic-dodge — see strikeLockout):
// dodges must be committed during the telegraph, not after it.
// `blocked`: seized slot index to never land on, or -1.
export function botSlotDirMulti(slot, slots, threats, blocked = -1) {
  if (threats.some(t => t.state === 'strike')) return 0;
  const pos = (t) => (t.blackout && t.state === 'lock' ? (t.hx ?? t.x) : t.x);
  const active = threats.filter(t => t.state === 'lock');
  if (!active.length) return 0;
  const opts = [slot - 1, slot + 1].filter(i => i >= 0 && i < slots.length && i !== blocked);
  if (!opts.length) return 0;
  let best = opts[0], bd = -1;
  for (const i of opts) {
    const m = Math.min(...active.map(t => Math.abs(slots[i] - pos(t))));
    if (m > bd) { bd = m; best = i; }
  }
  return Math.sign(best - slot);
}

// Safest free slot for panicked ejects: maximizes distance to committed threats.
// `pos(t)` reads through blackouts (hand position) exactly like the bot does.
export function safestSlot(slots, exclude, threats) {
  const pos = (t) => (t.blackout && t.state === 'lock' ? (t.hx ?? t.x) : t.x);
  const active = threats.filter(t => t.state === 'lock' || t.state === 'strike');
  const free = slots.map((_, i) => i).filter(i => i !== exclude);
  if (!free.length) return -1;
  if (!active.length || exclude < 0 || !slots[exclude]) return free[Math.floor(free.length / 2)];
  let best = free[0], bd = -1;
  for (const i of free) {
    const m = Math.min(...active.map(t => Math.abs(slots[i] - pos(t))));
    if (m > bd) { bd = m; best = i; }
  }
  return best;
}

// --- territory denial: humans barricade the edge ---
// Rail zones (free movement): {kind:'rail', frac, warn, dur, gap} — a ~frac-wide
// slice of the rail flashes a warning, goes solid (ports inside get shoved out,
// never damaged), then releases. Slot seizures (fixed movement): {kind:'slot',
// warn, dur, gap} — one free slot at a time is seized; hops onto it are denied,
// and a camper still on it when it goes solid is ejected to the nearest free slot.
export function createBlocker(bc) {
  if (!bc) return null;
  return { phase: 'idle', t: 2.0, x: 0, w: 0, slot: -1 };
}

// isOccupied(slotIdx)->bool (slots mode only). Events: 'warn' | 'solid' | 'eject' | 'clear'.
export function stepBlocker(B, dt, bc, rail, slots, isOccupied, roll = Math.random) {
  if (!B) return [];
  const ev = [];
  B.t -= dt;
  if (B.phase === 'idle' && B.t <= 0) {
    if (bc.kind === 'rail') {
      B.w = (rail.max - rail.min) * bc.frac;
      B.x = rail.min + B.w / 2 + roll() * (rail.max - rail.min - B.w);
    } else {
      const free = slots.map((_, i) => i).filter(i => !isOccupied(i));
      const pool = free.length ? free : slots.map((_, i) => i);
      B.slot = pool[Math.floor(roll() * pool.length)];
    }
    B.phase = 'warn'; B.t = bc.warn; ev.push('warn');
  } else if (B.phase === 'warn' && B.t <= 0) {
    B.phase = 'active'; B.t = bc.dur; ev.push('solid');
    if (bc.kind === 'slot' && isOccupied(B.slot)) ev.push('eject');
  } else if (B.phase === 'active' && B.t <= 0) {
    B.phase = 'idle'; B.t = bc.gap * (0.8 + roll() * 0.4); B.slot = -1; ev.push('clear');
  }
  return ev;
}

// Push a position out of a solid rail zone. Never damages — just denies space.
export function pushOutOfZone(x, z) { // z: {x, w} or null
  if (!z) return { x, moved: false };
  const l = z.x - z.w / 2, r = z.x + z.w / 2;
  if (x < l || x > r) return { x, moved: false };
  return { x: (x - l) < (r - x) ? l : r, moved: true };
}

// --- hand separation: tracking/recovering hands give each other lane space ---
// Committed hands (lock/strike) are NEVER moved — the telegraph guarantee holds.
export function separateEnemies(enemies, rail, dt) {
  const MIN = 110;
  const committed = (E) => E.state === 'lock' || E.state === 'strike';
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i], b = enemies[j];
      if (committed(a) && committed(b)) continue;
      const dx = b.x - a.x;
      if (Math.abs(dx) >= MIN) continue;
      const push = (MIN - Math.abs(dx)) * 0.5 * Math.min(1, 6 * dt);
      const s = Math.sign(dx) || 1;
      if (!committed(a)) a.x = Math.max(rail.min, Math.min(rail.max, a.x - push * s));
      if (!committed(b)) b.x = Math.max(rail.min, Math.min(rail.max, b.x + push * s));
    }
  }
}
// Teleport lockout: slots-mode hops are denied while any strike is in flight.
export function strikeLockout(threats) {
  return threats.some(t => t.state === 'strike');
}

// Lethal-hit resolution with the FLIP-FLOP extra life + phase-out window.
// s: {shield:boolean, invuln:number} — returns 'ignored' | 'shielded' | 'dead'.
// 'shielded' means the caller must consume the shield and grant fresh invuln.
export function absorbHit(s) {
  if (s.invuln > 0) return 'ignored';
  if (s.shield) return 'shielded';
  return 'dead';
}
// --- dead-port walls: a plugged port's stuck cable blocks the survivors ---
// A dead port at stuckX is impassable: ports that lived on its left stay left,
// ports on its right stay right. Returns true if any alive port was clamped.
export const WALL_GAP = 72; // port half-width (~30) + plug clearance
export function applyDeadWalls(ports) {
  const walls = ports.filter(p => !p.alive && p.stuckX != null);
  if (!walls.length) return false;
  let bumped = false;
  for (const p of ports) {
    if (!p.alive) continue;
    for (const w of walls) {
      const side = (p.off !== undefined && w.off !== undefined)
        ? Math.sign(p.off - w.off)
        : (Math.sign(p.x - w.stuckX) || 1);
      if (side === 0) continue;
      if (side < 0 && p.x > w.stuckX - WALL_GAP) { p.x = w.stuckX - WALL_GAP; bumped = true; }
      else if (side > 0 && p.x < w.stuckX + WALL_GAP) { p.x = w.stuckX + WALL_GAP; bumped = true; }
    }
  }
  return bumped;
}
