// Data-driven level config. Tuned for ~30s levels.
// movement: 'free' | 'slots' | 'duo' (duo = 2 ports, shared command)
export const LEVELS = [
  {
    id: 1, name: 'FIRST BOOT', sub: 'free movement — outrun the hand',
    movement: 'free',
    time: 30, missesToWin: 5,
    rail: { min: 90, max: 870 },
    player: { w: 66, h: 26, accel: 4600, maxSpeed: 560, friction: 9 },
    enemy: { trackTime: 1.25, lockTime: 0.85, strikeTime: 0.22, recoverTime: 0.95,
             trackSpeed: 330, lead: 0.18, plugW: 46, startDelay: 0.8, doubles: 0 },
    hands: [{ startDelay: 0.8 }], // per-hand overrides of `enemy` (stagger, strength)
    slots: [160, 320, 480, 640, 800],
  },
  {
    id: 2, name: 'CORNERED', sub: 'teleport between port slots — Q/E or ←/→ or tap',
    movement: 'slots',
    time: 32, missesToWin: 7,
    rail: { min: 90, max: 870 },
    player: { w: 66, h: 26, hopCooldown: 0.16 },
    enemy: { trackTime: 0.9, lockTime: 0.55, strikeTime: 0.18, recoverTime: 0.62,
             trackSpeed: 430, lead: 0.32, plugW: 46, startDelay: 0.6, doubles: 0.35 },
    hands: [{ startDelay: 0.6 }],
    slots: [150, 305, 480, 655, 810],
  },
  {
    id: 3, name: 'DOUBLE TROUBLE', sub: 'experiment: two ports, one command — keep at least one alive',
    movement: 'duo',
    time: 40, missesToWin: 8,
    rail: { min: 90, max: 870 },
    player: { w: 60, h: 24, accel: 4600, maxSpeed: 560, friction: 9 },
    enemy: { trackTime: 0.95, lockTime: 0.6, strikeTime: 0.18, recoverTime: 0.6,
             trackSpeed: 460, lead: 0.3, plugW: 48, startDelay: 0.6, doubles: 0.45 },
    hands: [{ startDelay: 0.6 }],
    slots: [160, 320, 480, 640, 800],
  },
  {
    id: 4, name: 'TWO HANDS', sub: 'two ports, two humans — lose one and BOTH hands hunt the survivor',
    movement: 'duo',
    time: 42, missesToWin: 10,
    rail: { min: 90, max: 870 },
    player: { w: 60, h: 24, accel: 4600, maxSpeed: 560, friction: 9 },
    enemy: { trackTime: 0.95, lockTime: 0.62, strikeTime: 0.18, recoverTime: 0.62,
             trackSpeed: 450, lead: 0.3, plugW: 56, startDelay: 0.8, doubles: 0.25 },
    hands: [
      { startDelay: 0.8 },
      { startDelay: 2.4, trackSpeed: 420, lockTime: 0.7 }, // second human: later, lazier, harder to bait both at once
    ],
    blocker: { kind: 'rail', frac: 0.2, warn: 1.0, dur: 4.5, gap: 5 },
    slots: [160, 320, 480, 640, 800],
  },
  {
    id: 5, name: 'BLACKOUT', sub: 'the crosshairs cut out — read the hand, not the marker',
    movement: 'slots',
    time: 40, missesToWin: 8,
    rail: { min: 90, max: 870 },
    player: { w: 66, h: 26, hopCooldown: 0.16 },
    enemy: { trackTime: 0.9, lockTime: 0.65, strikeTime: 0.18, recoverTime: 0.62,
             trackSpeed: 420, lead: 0.32, plugW: 62, startDelay: 0.6, doubles: 0.3,
             blackout: 0.3 },
    hands: [{ startDelay: 0.6 }],
    blocker: { kind: 'slot', warn: 1.2, dur: 5, gap: 5.5 },
    slots: [150, 305, 480, 655, 810],
  },
];

// --- endless mode: the 5 archetypes on repeat, meaner every round ---
export const ENDLESS_ORDER = [0, 1, 2, 3, 4]; // base LEVELS indices, cycled
export const SCORE = { MISS: 100, NEAR: 150 };
export function endlessClearBonus(round) { return 500 + 100 * (round - 1); }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Round configs are plain level configs, so the game loop, bot, and sims
// consume them untouched. `round` is 1-based.
export function buildEndlessRound(round) {
  const base = LEVELS[ENDLESS_ORDER[(round - 1) % ENDLESS_ORDER.length]];
  const loop = Math.floor((round - 1) / ENDLESS_ORDER.length); // full cycles completed
  const k = round - 1; // continuous ramp
  const e = { ...base.enemy };
  e.trackSpeed = Math.min(e.trackSpeed * 1.6, e.trackSpeed * (1 + 0.05 * k));
  e.lockTime = Math.max(0.42, e.lockTime * (1 - 0.03 * k));
  e.strikeTime = Math.max(0.14, e.strikeTime - 0.005 * k);
  e.recoverTime = Math.max(0.4, e.recoverTime * (1 - 0.04 * k));
  e.lead = Math.min(0.45, e.lead + 0.01 * k);
  e.doubles = Math.min(0.6, e.doubles + 0.04 * k);
  e.blackout = base.enemy.blackout
    ? Math.min(0.5, base.enemy.blackout + 0.03 * k)
    : (loop >= 1 ? Math.min(0.3, 0.05 + 0.05 * (loop - 1)) : 0);
  e.plugW = Math.min(70, e.plugW + 2 * loop);
  // extra hands join at higher loops (hard cap keeps it readable)
  const baseHands = base.hands || [{}];
  const wantHands = Math.min(base.movement === 'slots' ? 2 : 3,
    baseHands.length + (loop >= 1 ? 1 : 0) + (loop >= 3 ? 1 : 0));
  const hands = baseHands.map(h => ({ ...h }));
  while (hands.length < wantHands) {
    hands.push({ startDelay: 1.2 + hands.length, trackSpeed: Math.round(e.trackSpeed * 0.95) });
  }
  // blockers spread to every archetype from loop 1, and intensify
  let blocker = base.blocker ? { ...base.blocker } : null;
  if (blocker) {
    if (blocker.gap != null) blocker.gap = Math.max(2.5, blocker.gap - 0.3 * loop);
    if (blocker.dur != null) blocker.dur = Math.min(blocker.dur + 3, blocker.dur + 0.5 * loop);
    if (blocker.frac != null) blocker.frac = Math.min(0.3, blocker.frac + 0.02 * loop);
  } else if (loop >= 2) {
    blocker = base.movement === 'slots'
      ? { kind: 'slot', warn: 1.2, dur: 4, gap: 6 }
      : { kind: 'rail', frac: 0.15, warn: 1.0, dur: 4, gap: 6 };
  }
  return {
    ...base,
    id: round,
    name: base.name + (loop > 0 ? ` +${loop}` : ''),
    enemy: e,
    hands,
    blocker,
    missesToWin: base.missesToWin + Math.min(loop, 3),
  };
}
