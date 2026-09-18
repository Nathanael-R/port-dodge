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
  if (cfg.timeOnly) return elapsed >= cfg.time;
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
// a human must. `blocker`: {x,w} rail zone to avoid (pass it from the first
// warning flash — marked ground is about to become solid), or null.
// `walls`: dead-port stuckX positions — candidates across a wall are
// unreachable (the survivor is clamped to its side), so the bot only ever
// flees along its own side.
export function botAxisFreeMulti(portX, threats, rail, blocker = null, walls = []) {
  const pos = (t) => (t.blackout && t.state === 'lock' ? (t.hx ?? t.x) : t.x);
  const active = threats.filter(t => t.state === 'lock' || t.state === 'strike');
  // Standing on barricade ground? Leave before the shove-out pins us to an
  // edge — a shove toward a committed threat is a free hit.
  if (blocker && portX > blocker.x - blocker.w / 2 && portX < blocker.x + blocker.w / 2) {
    const l = blocker.x - blocker.w / 2, r = blocker.x + blocker.w / 2;
    const leftSpot = Math.max(rail.min, l - 40), rightSpot = Math.min(rail.max, r + 40);
    const canL = l - 40 >= rail.min, canR = r + 40 <= rail.max;
    let dir = (portX - l) < (r - portX) ? -1 : 1; // nearer exit
    if (!canL) dir = 1; else if (!canR) dir = -1;
    if (active.length) {
      const gap = (d) => Math.min(...active.map(t => Math.abs((d < 0 ? leftSpot : rightSpot) - pos(t))));
      if ((dir < 0 ? canR : canL) && gap(-dir) > gap(dir) + 20) dir = -dir; // safer exit wins
    }
    return dir;
  }
  if (!active.length) {
    // drift mid-rail while merely tracked, but hold ground through recover:
    // wandering back to center is exactly what a queued double-jab wants
    if (threats.some(t => t.state === 'recover')) return 0;
    let target = (rail.min + rail.max) / 2;
    if (blocker) {
      // never drift INTO a solid zone — rest on the open side nearest us,
      // otherwise the shove-out pins the port against the barricade to be hit
      const l = blocker.x - blocker.w / 2, r = blocker.x + blocker.w / 2;
      if (target > l && target < r) {
        target = Math.max(rail.min, Math.min(rail.max, portX < blocker.x ? l - 40 : r + 40));
      }
    }
    const d = target - portX;
    if (Math.abs(d) < 40) return 0;
    return Math.sign(d) * 0.5;
  }
  let cands = [rail.min + 60, (rail.min + rail.max) / 2, rail.max - 60];
  if (blocker) {
    // a solid zone is a wall: add its edges as resting spots, drop candidates
    // inside it, then any candidate on its far side (no crossing while solid)
    const l = blocker.x - blocker.w / 2, r = blocker.x + blocker.w / 2;
    cands.push(Math.min(rail.max - 5, Math.max(rail.min + 5, l - 40)),
               Math.min(rail.max - 5, Math.max(rail.min + 5, r + 40)));
    const outside = cands.filter(c => c < l || c > r);
    if (outside.length) cands = outside;
    const side = (c) => (portX < l ? c < l : portX > r ? c > r : true);
    const sameSide = cands.filter(side);
    if (sameSide.length) cands = sameSide;
  }
  // a corpse-wall between us and a candidate makes it a fantasy, and its 72px
  // no-cross gap is off-limits too — only same-side spots clear of the gap
  const reach = (c) => walls.every(w => (portX >= w ? c >= w + WALL_GAP : c <= w - WALL_GAP));
  const reachable = cands.filter(reach);
  if (reachable.length) cands = reachable;
  else {
    // nothing in the candidate set is reachable: hug the accessible bound
    let lo = rail.min, hi = rail.max;
    for (const w of walls) { if (w <= portX) lo = Math.max(lo, w + WALL_GAP); else hi = Math.min(hi, w - WALL_GAP); }
    cands = [lo, hi];
  }
  // never flee THROUGH a strike already in flight: the candidate on its far
  // side means running through the strike point while it is still resolving
  const inFlight = active.filter(t => t.state === 'strike');
  if (inFlight.length) {
    const crossesStrike = (c) => inFlight.some(t => { const tx = pos(t); return (tx - portX) * (tx - c) < 0; });
    const uncrossed = cands.filter(c => !crossesStrike(c));
    if (uncrossed.length) cands = uncrossed;
  }
  // Hold still only when genuinely safe. A fixed deadzone once froze the bot
  // 36px from a 40px reticle — inside a hit window, ALWAYS move. (55 clears
  // the widest possible window, (70+66)/2*0.7 = 47.6, with margin.)
  const dangerHere = Math.min(...active.map(t => Math.abs(portX - pos(t))));
  if (dangerHere > 55) return 0;
  let best = cands[0], bd = -1;
  for (const c of cands) {
    const m = Math.min(...active.map(t => Math.abs(c - pos(t))));
    if (m > bd) { bd = m; best = c; }
  }
  const d = best - portX;
  if (d !== 0) return Math.sign(d);
  // parked exactly on the best spot but still endangered: slide off the nearest threat
  const near = active.reduce((a, b) => Math.abs(portX - pos(a)) < Math.abs(portX - pos(b)) ? a : b);
  return Math.sign(portX - pos(near)) || 1;
}

// Slots mode: hop toward the safest free slot. No hopping while a strike is in
// flight (anti panic-dodge — see strikeLockout): dodges must be committed during
// the telegraph, not after it. Returns the signed slot delta to jump (any free
// slot is one tap/number-key away), or 0 to hold.
// `blocked`: slot index, array of indices, or -1 — never land on these.
export function botSlotDirMulti(slot, slots, threats, blocked = -1) {
  if (threats.some(t => t.state === 'strike')) return 0;
  const banned = new Set(Array.isArray(blocked) ? blocked : (blocked >= 0 ? [blocked] : []));
  const pos = (t) => (t.blackout && t.state === 'lock' ? (t.hx ?? t.x) : t.x);
  const active = threats.filter(t => t.state === 'lock');
  if (!active.length) return 0;
  // Sit tight when already safe: from an edge slot the only move is inward,
  // and blindly hopping on a timer walks straight into strikes. SAFE clears
  // the widest possible hit window (~48px) with 2x margin.
  const SAFE = 100;
  const here = Math.min(...active.map(t => Math.abs(slots[slot] - pos(t))));
  if (here > SAFE) return 0;
  // Every free slot is one jump away, so consider them all — a single-step bot
  // gets checkmated when two hands lock the only neighbours.
  const opts = slots.map((_, i) => i).filter(i => i !== slot && !banned.has(i));
  if (!opts.length) return 0;
  // Score against every live hand, not just committed locks: hopping onto the
  // slot the OTHER hand is stalking just hands it a free point-blank lock.
  const stalkers = threats.filter(t => t.state === 'lock' || t.state === 'track');
  let best = opts[0], bd = -1, bj = Infinity;
  for (const i of opts) {
    const m = Math.min(...stalkers.map(t => Math.abs(slots[i] - pos(t))));
    const jump = Math.abs(i - slot);
    // equally safe? take the shortest jump — less committal, harder to read
    if (m > bd + 1e-9 || (Math.abs(m - bd) <= 1e-9 && jump < bj)) { bd = m; best = i; bj = jump; }
  }
  return best - slot;
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
      // trap-proofing: never seize an edge slot's SOLE exit while it's camped
      // (occupant on slot 0 needs slot 1, occupant on last needs second-to-last).
      // Mid-rail campers always have an exit, so only edges are protected.
      const occ = slots.findIndex((_, i) => isOccupied(i));
      let pool = free;
      if (occ === 0) pool = free.filter(i => i !== 1);
      else if (occ === slots.length - 1) pool = free.filter(i => i !== slots.length - 2);
      if (!pool.length) pool = free.length ? free : slots.map((_, i) => i);
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

// --- pop quiz: procedural math questions, endless variety ---
// genQuiz(roll) -> {a, op, b, answer, options[3], correct}.
// Ranges keep mental math snappy (sums <= ~36, tables 2-9 x 3-7);
// distractors are unique, non-negative, shuffled.
export function genQuiz(roll = Math.random) {
  const op = ['+', '−', '×'][Math.floor(roll() * 3)];
  let a, b, ans;
  if (op === '+') {
    a = 3 + Math.floor(roll() * 17);
    b = 4 + Math.floor(roll() * 14);
    ans = a + b;
  } else if (op === '−') {
    a = 6 + Math.floor(roll() * 15);
    b = 2 + Math.floor(roll() * (a - 2));
    ans = a - b;
  } else {
    a = 2 + Math.floor(roll() * 8);
    b = 3 + Math.floor(roll() * 5);
    ans = a * b;
  }
  const set = new Set([ans]);
  let guard = 0;
  while (set.size < 3 && guard++ < 50) {
    const d = ans + (Math.floor(roll() * 9) - 4);
    if (d < 0 || d === ans) continue;
    set.add(d);
  }
  while (set.size < 3) set.add(ans + set.size + 1); // paranoia fallback (never hit in practice)
  const options = [...set];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(roll() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { a, op, b, answer: ans, options, correct: options.indexOf(ans) };
}
// --- seal tide (Seal Team): the edge gets claimed over time, tight dodges reclaim it ---
// Free-slide flavour: a seal trims a chunk off one end of the playable rail, so
// the field literally shrinks. `seals` are {side, w} (-1 left, +1 right).
// pickTideTrim returns the next trim, or null once the field hits its floor or
// one end is maxed out. Caller keeps LIFO order so reclaiming grows it back.
export function pickTideTrim(rail, seals, chunkFrac = 0.1, minWidthFrac = 0.42, maxSideFrac = 0.3, roll = Math.random) {
  const span = rail.max - rail.min;
  const chunk = chunkFrac * span;
  const trim = seals.reduce((a, s) => a + s.w, 0);
  if (trim + chunk > (1 - minWidthFrac) * span + 1e-9) return null;
  const left = seals.filter(s => s.side < 0).reduce((a, s) => a + s.w, 0);
  const right = trim - left;
  const cap = maxSideFrac * span;
  const sides = [];
  if (left + chunk <= cap + 1e-9) sides.push(-1);
  if (right + chunk <= cap + 1e-9) sides.push(1);
  const pool = sides.length ? sides : [-1, 1];
  return { side: pool[Math.floor(roll() * pool.length)], w: chunk };
}

// Where the port can still go once the claimed ends are subtracted.
export function sealRail(rail, seals) {
  const left = seals.filter(s => s.side < 0).reduce((a, s) => a + s.w, 0);
  const right = seals.filter(s => s.side > 0).reduce((a, s) => a + s.w, 0);
  return { min: rail.min + left, max: rail.max - right };
}

// Near-miss earn-back: every 3rd CLOSE!! releases the oldest seal.
// Returns {pips, release} — caller shifts its seal array when release is true.
export function unsealTick(pips, sealedCount) {
  const next = pips + 1;
  if (next < 3) return { pips: next, release: false };
  return { pips: 0, release: sealedCount > 0 };
}

// --- permanent seals (Crowded Edge): stuck plugs claim slots for the run ---
// Sealed slots are impassable landing spots (same red-X language as seizures).
// On the 5-slot rail the seal patterns always leave a connected triple so no
// one can spawn trapped: both ends, or one end sealed shut.
export function pickStartSeals(slots, occupied, count, roll = Math.random) {
  if (slots.length === 5 && count === 2) {
    const patterns = [[0, 1], [3, 4], [0, 4]].filter(p => !p.includes(occupied));
    const pool = patterns.length ? patterns : [[0, 1]];
    return [...pool[Math.floor(roll() * pool.length)]].sort((a, b) => a - b);
  }
  // generic fallback: farthest-from-occupant first, never the occupant
  const order = slots.map((_, i) => i).filter(i => i !== occupied)
    .sort((a, b) => Math.abs(slots[b] - slots[occupied]) - Math.abs(slots[a] - slots[occupied]));
  return order.slice(0, Math.min(count, order.length)).sort((a, b) => a - b);
}

// --- accelerating hunter: every strike makes the next one meaner ---
// ramp: {track, lock, trackMax, lockMin}. Mutates ep in place, clamped.
export function applyRamp(ep, ramp) {
  if (!ramp) return ep;
  if (ramp.track) ep.trackSpeed = Math.min(ramp.trackMax ?? 700, ep.trackSpeed * ramp.track);
  if (ramp.lock) ep.lockTime = Math.max(ramp.lockMin ?? 0.35, ep.lockTime * ramp.lock);
  return ep;
}
