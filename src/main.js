import { createFrameScheduler, canvasSize } from './runtime.js';
import { drawUSBStick, drawUSBCStick, drawUSBPort } from './usb-art.js';
import { createInput } from './input.js';
import { sfx, toggleMute, unlockAudio, suspendAudio } from './audio.js';
import { detectOS, osCopy } from './os.js';
import { LEVELS, buildEndlessRound, endlessClearBonus, SCORE } from './levels.js';
import { W, H, EDGE_Y, handParams, resolveStrike, hopSlot, levelWon, stepFree, createEnemy, stepEnemy, separateEnemies, botAxisFreeMulti, botSlotDirMulti, strikeLockout, absorbHit, applyDeadWalls, createBlocker, stepBlocker, pushOutOfZone, safestSlot, pickStartSeals, applyRamp, genQuiz, pickTideTrim, sealRail, unsealTick } from './logic.js';
import { createFX, createNearMissSlowMo } from './fx.js';

const canvas = document.getElementById('game');
let ctx = canvas.getContext('2d', { alpha: false });
let scheduler;
function wake() { if (!document.hidden) scheduler?.wake(); }
let stageBackdrop;
let vignette;
function resizeCanvas() {
  const size = canvasSize(canvas.getBoundingClientRect().width, devicePixelRatio || 1);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width; canvas.height = size.height;
    ctx.setTransform(size.width / W, 0, 0, size.height / H, 0, 0);
    frame.screen = null; vignette = null;
  }
  wake();
}
window.addEventListener('resize', resizeCanvas);
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const elLevel = document.getElementById('hud-level');
const elTime = document.getElementById('hud-time');
const elMiss = document.getElementById('hud-miss');
const elPorts = document.getElementById('hud-ports');

const input = createInput(canvas, wake);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const fx = createFX(() => motionPreference.matches);
const nearMissSlowMo = createNearMissSlowMo(() => motionPreference.matches);
const elScore = document.getElementById('hud-score');
const elFlip = document.getElementById('hud-flip');
const fill = document.getElementById('timefill');
const pauseButton = document.getElementById('btn-pause');
function setText(el, value) { if (el.textContent !== value) el.textContent = value; }

// Canvas palette; style.css mirrors the same paper / ink / signal tokens.
const C = {
  desk: '#e3ded2', grid: 'rgba(26,25,22,.06)', gridMajor: 'rgba(26,25,22,.13)',
  ink: '#1a1916', ink2: '#55524b', ink3: '#8a867c', slab: '#2b2a27',
  signal: '#dd4a1f', good: '#2e6b45', caution: '#e2a72e',
};
const font = (weight, size) => `${weight} ${size}px Archivo, "Arial Narrow", Arial, sans-serif`;
const condensed = (weight, size) => `${weight} condensed ${size}px Archivo, "Arial Narrow", Arial, sans-serif`;
const mono = (size, weight = 500) => `${weight} ${size}px "IBM Plex Mono", ui-monospace, monospace`;
// Webfonts arrive after the first paint; redraw the cached backdrop once they land.
Promise.all([font(600, 14), condensed(800, 20), mono(11)].map(f => document.fonts?.load(f))).catch(() => {}).then(() => { stageBackdrop = null; frame.screen = null; wake(); });

// OS flavor: real detection with a preview override (?os=mac|windows|linux).
// Drives the laptop art, footer joke, and CSS theme via body[data-os].
let OS = 'other';
let flavor = osCopy(OS);

// ---------- game state ----------
const S = {
  screen: 'menu', // menu | intro | playing | win | lose | done | paused(from)
  paused: false,
  mode: 'levels', // 'levels' | 'endless'
  levelIdx: 0,
  customCfg: null, // endless rounds build configs on the fly; cfg() prefers it
  round: 0,       // endless round number (1-based while running)
  score: 0,       // run score (both modes: +100/miss, +150/near, clear bonus)
  scoreAtStart: 0, // score when the current level/round began (retry rolls back here)
  elapsed: 0,
  misses: 0,
  ports: [],       // {x,vx,w,h,alive,slot,stuckX,squash,face}
  center: { x: 480, vx: 0 }, // free/duo shared driver
  enemies: [],     // one entry per attacking hand; each targets nearest living port
  dents: [],
  banner: null,    // {str,sub,t}
  flash: 0,
  tickAcc: 0,
  bumpCd: 0,       // cooldown for dead-wall bump feedback
  denyCd: 0,       // cooldown for teleport-deny feedback
    flipLife: false, // FLIP-FLOP extra life: earned by clearing level 3, absorbs one plug
  flipEarned: false, // set when endless awards a flip; announced on the next round banner
  invuln: 0,       // phase-out timer granted when the flip-life is consumed
  blocker: null,   // territory denial: {phase, t, x, w, slot} or null when level has none
  sealed: [],      // permanently stuck plugs claiming slots (Crowded Edge)
  quiz: null,      // active pop quiz {a,op,b,options,correct,t,timeout,start[]} or null
  quizT: Infinity, // countdown to the next freeze (Pop Quiz levels only)
  unsealPips: 0,   // CLOSE!! progress toward unsealing (Seal Team: every 3rd releases one)
  sealT: Infinity, // countdown to the next auto-seal (Seal Team only)
  result: null,
};
let transitionTimer;
let hudProgressKey;
const touchControls = document.getElementById("touch-controls");
const slotButtons = [...document.querySelectorAll("[data-slot]")];
const touchHint = document.getElementById("touch-hint");
let controlMode;
let controlSlot = -1;
// Level progress markers render from LEVELS so new levels show up for free.
const levelTrack = document.querySelector('.level-track');
if (levelTrack) {
  levelTrack.textContent = '';
  LEVELS.forEach((l, i) => {
    const li = document.createElement('li');
    const em = document.createElement('em');
    em.textContent = String(i + 1).padStart(2, '0');
    const b = document.createElement('b');
    b.textContent = l.name;
    li.append(em, b);
    levelTrack.append(li);
  });
}
const levelMarkers = [...document.querySelectorAll(".level-track > li")];

function cfg() { return S.customCfg || LEVELS[S.levelIdx]; }

// Win rule: early levels can be cleared by surviving OR forcing enough misses;
// from level 4 on (and every endless round) the timer is the only exit, so
// dodges score but only survival moves you on.
function roundWon() {
  return levelWon(S.elapsed, S.misses, cfg());
}

// ---------- setup ----------
function resetLevel(idx) {
  S.levelIdx = idx;
  S.customCfg = null;
  setupRound(LEVELS[idx]);
}

function setupRound(c) {
  clearTimeout(transitionTimer);
  input.reset();
  S.paused = false; fx.reset(); nearMissSlowMo.resetAttempt();
  S.elapsed = 0; S.misses = 0; S.dents = []; S.banner = null; S.flash = 0;
  S.center = { x: 480, vx: 0 };
  S.ports = [];
  if (c.movement === 'slots') {
    const mid = Math.floor(c.slots.length / 2);
    S.ports.push({ x: c.slots[mid], vx: 0, w: c.player.w, h: c.player.h, alive: true, slot: mid, squash: 0, hopCd: 0 });
  } else if (c.movement === 'duo') {
    S.center.x = 480;
    S.ports.push(
      { x: 480 - 90, vx: 0, w: c.player.w, h: c.player.h, alive: true, off: -90, squash: 0 },
      { x: 480 + 90, vx: 0, w: c.player.w, h: c.player.h, alive: true, off: 90, squash: 0 },
    );
  } else {
    S.ports.push({ x: 480, vx: 0, w: c.player.w, h: c.player.h, alive: true, squash: 0 });
  }
  const e = c.enemy;
  S.bumpCd = 0; S.denyCd = 0; S.invuln = 0; // fresh-level timers (flipLife persists: it's earned, not given)
  S.blocker = createBlocker(c.blocker);
  S.quiz = null; // any half-answered question dies with the attempt
  S.quizT = c.quiz ? c.quiz.first : Infinity;
  S.unsealPips = 0;
  S.sealT = c.sealTide ? c.sealTide.first : Infinity;
  // pre-sealed slots (Crowded Edge): stuck plugs claim ground before the first attack
  S.sealed = [];
  if (c.movement === 'slots' && c.startSeals) {
    const occ = S.ports[0]?.slot ?? -1;
    S.sealed = pickStartSeals(c.slots, occ, c.startSeals, Math.random);
  }
  // one FSM per hand; extra hands stagger in and may tune the base params
  S.enemies = (c.hands || [{}]).map((h, i) => {
    const E = createEnemy(480 + (i === 0 ? 0 : (i % 2 ? 150 : -150)), h.startDelay ?? e.startDelay);
    E.ep = handParams(e, h);
    // industrial yellow for the lead arm, steel blue for extras, clean-room grey for jabbers
    E.paint = E.ep.plug === 'c' ? '#d6d3ca' : i === 0 ? '#e2a72e' : '#8796ab';
    E.accent = E.ep.plug === 'c' ? C.caution : C.signal; // jabbers carry an amber plug
    E.tipY = restTipY();
    return E;
  });
  updateHud();
}

const restTipY = () => 330;
const contactTipY = () => EDGE_Y + 14;

// ---------- overlay screens ----------
function show(html) {
  wake(); input.reset();
  overlay.innerHTML = html; overlay.style.pointerEvents = 'auto'; overlay.classList.add('dim');
  document.getElementById('stage').classList.add('has-overlay');
  document.body.classList.remove('in-game');
  resizeCanvas();
  wireButtons();
  const card = overlay.querySelector('.card');
  if (card) { card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', card.querySelector('h1,h2')?.innerText || 'Game menu'); }
  overlay.querySelector('.cta')?.focus({ preventScroll: true });
}
function hide() {
  wake(); input.reset();
  overlay.innerHTML = ''; overlay.style.pointerEvents = 'none'; overlay.classList.remove('dim');
  document.getElementById('stage').classList.remove('has-overlay');
  document.body.classList.add('in-game');
  resizeCanvas();
  canvas.focus({ preventScroll: true });
}

const pad2 = (n) => String(n).padStart(2, '0');
const sentence = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const KEY = { space: '<kbd>Space</kbd>', r: '<kbd>R</kbd>', p: '<kbd>P</kbd>' };
const head = (left, right = '') => `<div class="card-head"><span>${left}</span><span>${right}</span></div>`;
const spec = (rows) => `<dl class="spec">${rows.map(([k, v, tone]) => `<div${tone ? ` class="${tone}"` : ''}><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const figures = (items, cls = '') => `<div class="figures ${cls}">${items.map(([v, k]) => `<div><strong>${v}</strong><span>${k}</span></div>`).join('')}</div>`;
const MOVEMENT = { free: 'Free slide', slots: 'Five slots', duo: 'Two ports' };

function showMenu() {
  resetLevel(0);
  S.paused = false; S.mode = 'levels'; S.screen = 'menu'; hud.classList.add('hidden');
  const best = loadBest();
  show(`<div class="card menu-card flash">
    <h1>Stay<br> unplugged.</h1>
    <p class="lede">You are a USB port. A machine wants to plug something into you. Be somewhere else.</p>
    <ol class="steps">
      <li><span>1</span><div><b>Watch the arm.</b> It drifts toward you.</div></li>
      <li><span>2</span><div><b>Red means locked.</b> The strike lands exactly there.</div></li>
      <li><span>3</span><div><b>Move.</b> A and D, arrow keys, or drag.</div></li>
    </ol>
    <div class="actions"><button class="cta" data-act="start">Start campaign ${KEY.space}</button><button class="ghost" data-act="endless">Endless mode</button></div>
    <p class="meta">${LEVELS.length} levels &middot; best endless score ${best ? best.toLocaleString() : 'none yet'}</p>
  </div>`);
}

// The briefing is a spec table: one row per rule that applies to this level.
function briefRows(c) {
  const rows = [];
  rows.push(['Movement', {
    free: 'Slide along the edge with A and D, the arrow keys, or by dragging.',
    slots: 'Hop between slots with 1 to 5, the arrow keys, or a tap. Hops fail once the strike is moving, so commit while the target is red.',
    duo: 'Both ports move together. A plugged port leaves its cable behind, and the other cannot cross it.',
  }[c.movement]]);
  rows.push(['To clear', c.timeOnly ? `Survive ${c.time} seconds.` : `Survive ${c.time} seconds, or make the arm miss ${c.missesToWin} times.`]);
  const hands = (c.hands || [{}]);
  if (hands.length > 1) rows.push(['Opponents', `${hands.length} arms, each chasing whichever port is closest.`]);
  const plugs = new Set(hands.map(h => h.plug).filter(Boolean));
  if (plugs.has('a')) rows.push(['USB-A', 'The bruiser. Heavy yellow clamp, full-width plug, a long wind-up and one strike at a time.']);
  if (plugs.has('c')) rows.push(['USB-C', 'The jabber. Slim grey arm, narrow plug: a short warning, a tight ring, and it often strikes twice.', 'warn']);
  if (hands.some(h => ((h.blackout ?? c.enemy.blackout) || 0) > 0)) rows.push(['Blackout', 'The crosshair sometimes cuts out. Read where the arm is drifting.', 'warn']);
  if (c.blocker) rows.push(c.blocker.kind === 'slot'
    ? ['Seized slot', 'One slot at a time gets taken. Leave when it flashes or you will be ejected.', 'warn']
    : ['Barricades', `Sections of ${Math.round(c.blocker.frac * 100)}% get taped off. Leave when the outline flashes.`, 'warn']);
  if (c.startSeals) rows.push(['Sealed', `${c.startSeals} slots start blocked, leaving ${c.slots.length - c.startSeals}.`, 'warn']);
  if (c.enemy.ramp) rows.push(['Speed', 'The arm gets a little faster after every strike.', 'warn']);
  if (c.quiz) rows.push(['Pop quiz', 'Time freezes and the plug creeps closer. Answer to unfreeze it. A wrong answer means an instant strike.', 'warn']);
  if (c.sealTide) rows.push(['Seal tide', 'The ends of the edge get sealed over time. Every third close call wins a section back.', 'warn']);
  if (S.flipLife) rows.push(['Spare life', 'Flip-flop. Your ports hang upside down and the first plug to land is absorbed.', 'good']);
  return rows;
}

function showIntro() {
  S.screen = 'intro'; hud.classList.remove('hidden'); updateHud();
  const c = cfg();
  show(`<div class="card flash">
    ${head(`Level ${pad2(c.id)} of ${pad2(LEVELS.length)}`, MOVEMENT[c.movement])}
    <h2>${sentence(c.name)}</h2>
    <p class="lede">${c.sub}</p>
    ${spec(briefRows(c))}
    <div class="actions"><button class="cta" data-act="play">Start level ${KEY.space}</button></div>
  </div>`);
}

function showEnd(win) {
  S.screen = win ? 'win' : 'lose';
  const c = cfg();
  if (S.mode === 'endless' && !win) return showEndlessGameOver();
  if (S.mode === 'endless' && win) { startNextRound(); return; } // safety: endless advances without cards
  const last = S.levelIdx === LEVELS.length - 1;
  const title = win ? (last ? 'Still unplugged.' : 'Dodged.') : 'Plugged in.';
  const sub = win
    ? (last ? `${LEVELS.length} levels and not one connection. Someone is filing a bug report.` : `Connection refused.${c.id === 3 ? ' You earned a <b>flip-flop</b>: the next plug that lands is absorbed.' : ''}`)
    : 'The machine got its connection. Make it work harder next time.';
  show(`<div class="card flash">
    ${head(`Level ${pad2(c.id)} of ${pad2(LEVELS.length)}`, win ? '<span class="ok">Cleared</span>' : '<span class="bad">Port lost</span>')}
    <h2>${title}</h2>
    <p class="lede">${sub}</p>
    ${win ? figures([
      [S.score.toLocaleString(), 'Run score'],
      [S.misses, 'Dodges'],
      [`${S.elapsed.toFixed(1)}<small>s</small>`, 'Survived'],
      [`<span class="plus">+${endlessClearBonus(S.levelIdx + 1)}</span>`, 'Clear bonus'],
    ]) : figures([
      [S.score.toLocaleString(), 'Run score'],
      [S.misses, 'Dodges'],
      [`${S.elapsed.toFixed(1)}<small>/${c.time}s</small>`, 'Survived'],
    ], 'three')}
    <div class="actions">
      ${win && !last ? `<button class="cta" data-act="next">Next level ${KEY.space}</button>` : ''}
      ${win && last ? `<button class="cta" data-act="menu">Back to menu</button>` : ''}
      <button class="${win ? 'ghost' : 'cta'}" data-act="retry">Retry ${KEY.r}</button>
      ${!win ? `<button class="ghost" data-act="menu">Menu</button>` : ''}
    </div></div>`);
}
function wireButtons() {
  overlay.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      sfx.ui();
      const a = b.dataset.act;
      if (a === 'start') { S.mode = 'levels'; S.flipLife = false; S.score = 0; resetLevel(0); snapshotScore(); showIntro(); }
      else if (a === 'play') { hide(); S.screen = 'playing'; S.banner = { str: 'DODGE', sub: '', t: 0.9 }; }
      else if (a === 'retry') doRetry();
      else if (a === 'endless') showEndlessIntro();
      else if (a === 'endless-go') { hide(); startEndless(); }
      else if (a === 'next') {
        S.mode = 'levels';
        if (S.levelIdx === 2) S.flipLife = true; // cleared all three: FLIP-FLOP earned!
        resetLevel(S.levelIdx + 1); snapshotScore(); showIntro();
      }
      else if (a === 'menu') showMenu();
    };
  });
}

// ---------- endless mode ----------
function loadBest() {
  try { return parseInt(localStorage.getItem('usbDodgeBest') || '0', 10) || 0; }
  catch { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem('usbDodgeBest', String(v)); } catch { /* private mode etc. */ }
}

function showEndlessIntro() {
  S.screen = 'intro'; hud.classList.add('hidden');
  const best = loadBest();
  show(`<div class="card flash">
    ${head('Endless mode', best > 0 ? `Best ${best.toLocaleString()}` : 'No best yet')}
    <h2>How long can you last?</h2>
    <p class="lede">All eight levels on repeat. Each round the arms get faster, the warnings get shorter, and more of them show up.</p>
    ${spec([
      ['Scoring', `Miss +${SCORE.MISS}. Close call +${SCORE.NEAR}. Round clear 500 and up.`],
      ['To advance', 'Survive the 25 second timer. Dodges only add to your score.'],
      ['Spare life', 'Every third round gives you a flip-flop, or 250 points if you already hold one.', 'good'],
      ['Game over', 'When every port is plugged. Your best score stays on this device.'],
    ])}
    <div class="actions"><button class="cta" data-act="endless-go">Start run ${KEY.space}</button><button class="ghost" data-act="menu">Menu</button></div>
  </div>`);
}

function startEndless() {
  S.mode = 'endless';
  S.round = 0; S.score = 0; S.flipLife = false;
  snapshotScore();
  hud.classList.remove('hidden');
  startNextRound();
}

function roundTags(c) {
  const tags = [];
  const hands = (c.hands || [{}]).length;
  if (hands > 1) tags.push(`${hands} HANDS`);
  if ((c.hands || []).some(h => h.plug === 'c')) tags.push('USB-C');
  const bo = c.enemy.blackout || 0;
  if (bo > 0) tags.push(`blackout ${Math.round(bo * 100)}%`);
  if (c.blocker) tags.push(c.blocker.kind === 'slot' ? 'seized slots' : 'barricades');
  if (c.enemy.doubles >= 0.4) tags.push('double-jabs');
  if (c.startSeals) tags.push(`${c.startSeals} sealed`);
  if (c.sealTide) tags.push('seal tide');
  if (c.quiz) tags.push('pop quiz');
  if (c.enemy.ramp) tags.push('accelerating');
  return tags.join(' · ');
}

function startNextRound() {
  S.round++;
  S.customCfg = buildEndlessRound(S.round);
  S.levelIdx = (S.round - 1) % LEVELS.length;
  setupRound(S.customCfg);
  snapshotScore();
  S.screen = 'playing';
  const c = cfg();
  const tags = roundTags(c) + (S.flipEarned ? (roundTags(c) ? ' · ' : '') + '+FLIP' : '');
  S.flipEarned = false;
  S.banner = { str: `ROUND ${S.round}`, sub: `${c.name}${tags ? ' / ' + tags : ''}`, t: 2.2 };
  updateHud();
}

function awardRoundClear() {
  const bonus = endlessClearBonus(S.round);
  S.score += bonus;
  if (S.round % 3 === 0) {
    if (!S.flipLife) { S.flipLife = true; S.flipEarned = true; }
    else S.score += 250;
  }
}

// Levels-mode clear bonus: same formula, level number as the round.
function awardLevelClear() {
  S.score += endlessClearBonus(S.levelIdx + 1);
}

// Roll score back to the start of the current level/round (fair retry).
function snapshotScore() { S.scoreAtStart = S.score; }

function doRetry() {
  hide();
  if (S.mode === 'endless') startEndless();
  else { S.score = S.scoreAtStart; resetLevel(S.levelIdx); S.screen = 'playing'; S.banner = { str: 'AGAIN', sub: '', t: 0.8 }; }
}

function showEndlessGameOver() {
  S.screen = 'lose';
  const best = loadBest();
  const newBest = S.score > best;
  if (newBest) saveBest(S.score);
  show(`<div class="card flash">
    ${head('Endless mode', newBest ? '<span class="ok">New best</span>' : '<span class="bad">Run over</span>')}
    <h2>Connected.</h2>
    <p class="lede">They got you in round ${S.round}, ${sentence(cfg().name).replace(/ \+\d+$/, '')}.${newBest ? ' That is your best run yet.' : ''}</p>
    ${figures([
      [S.score.toLocaleString(), 'Score'],
      [Math.max(best, S.score).toLocaleString(), 'Best'],
      [S.round, 'Round'],
    ], 'three')}
    <div class="actions">
      <button class="cta" data-act="retry">New run ${KEY.r}</button>
      <button class="ghost" data-act="menu">Menu</button>
    </div></div>`);
}

// ---------- HUD ----------
function updateHud() {
  const c = cfg();
  if (controlMode !== c.movement) {
    controlMode = c.movement;
    touchControls.dataset.mode = c.movement === 'slots' ? 'slots' : 'slide';
    touchHint.textContent = c.movement === 'slots' ? 'Tap a slot before the strike.' : 'Drag to slide, or hold an arrow.';
  }
  const currentSlot = c.movement === 'slots' ? S.ports[0]?.slot : -1;
  if (controlSlot !== currentSlot) {
    controlSlot = currentSlot;
    slotButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === currentSlot)));
  }
  const progressKey = `${S.mode}:${S.levelIdx}`;
  if (hudProgressKey !== progressKey) {
    hudProgressKey = progressKey;
    levelMarkers.forEach((el, i) => {
      el.classList.toggle('active', i === S.levelIdx && S.mode === 'levels');
      el.classList.toggle('complete', S.mode === 'levels' && i < S.levelIdx);
      if (i === S.levelIdx && S.mode === 'levels') el.setAttribute('aria-current', 'step');
      else el.removeAttribute('aria-current');
    });
  }
  const levelHtml = S.mode === 'endless'
    ? `<b>R${pad2(S.round)}</b><span>${c.name}</span>`
    : `<b>${pad2(c.id)}/${pad2(LEVELS.length)}</b><span>${c.name}</span>`;
  if (elLevel.dataset.key !== levelHtml) { elLevel.dataset.key = levelHtml; elLevel.innerHTML = levelHtml; }
  setText(elScore, S.score.toLocaleString());
  const remain = Math.max(0, c.time - S.elapsed);
  setText(elTime, remain.toFixed(1));
  const timeOnly = !!c.timeOnly || S.mode === 'endless';
  setText(elMiss, timeOnly ? `${S.misses}` : `${S.misses}/${c.missesToWin}`);
  elMiss.title = timeOnly
    ? 'Forced misses. Survive the timer to advance.'
    : `${S.misses} of ${c.missesToWin} forced misses needed`;
  const portsHtml = S.ports.map(p => p.alive ? '<i></i>' : '<i class="dead"></i>').join('');
  if (elPorts.dataset.key !== portsHtml) { elPorts.dataset.key = portsHtml; elPorts.innerHTML = portsHtml; }
  elPorts.title = `${S.ports.filter(p => p.alive).length} of ${S.ports.length} ports free`;
  if (elFlip) {
    elFlip.style.display = S.flipLife ? '' : 'none';
    setText(elFlip.lastElementChild, S.invuln > 0 ? 'Phasing' : 'Flip-flop');
  }
  const elSeal = document.getElementById('hud-seal');
  if (elSeal) {
    const on = !!c.sealTide;
    elSeal.style.display = on ? '' : 'none';
    if (on) {
      const usable = S.sealed.length ? sealRail(c.rail, S.sealed) : c.rail;
      const lost = Math.round((1 - (usable.max - usable.min) / (c.rail.max - c.rail.min)) * 100);
      setText(elSeal.lastElementChild, `${S.unsealPips}/3${lost > 0 ? ` · −${lost}%` : ''}`);
      elSeal.title = 'The edge gets sealed over time. Every third close call reclaims a section.';
    }
  }
  if (fill) {
    const frac = Math.max(0, Math.min(1, remain / c.time));
    fill.style.transform = `scaleX(${frac.toFixed(4)})`;
    fill.classList.toggle('low', remain < 6 && S.screen === 'playing');
  }
}

// ---------- enemy FSM (logic in logic.js; here: visuals + sound + consequences) ----------
// Every hand runs its own FSM and independently hunts the nearest living port —
// so when a port dies, ALL remaining hands converge on the survivor.
function enemyUpdate(dt) {
  const c = cfg();
  for (const E of S.enemies) {
    let focus = null;
    for (const port of S.ports) {
      if (port.alive && (!focus || Math.abs(port.x - E.x) < Math.abs(focus.x - E.x))) focus = port;
    }

    const ev = stepEnemy(E, dt, { x: focus?.x ?? E.x, v: focus?.vx || 0 }, c);
    for (const e of ev) {
      if (e === 'locked') { sfx.lock(E.ep?.plug === 'c'); S.tickAcc = 0; }
      if (e === 'struck') sfx.whoosh();
      if (e === 'impact') impact(E);
    }

    // plug-tip choreography per state (purely visual)
    const e = E.ep || c.enemy;
    if (E.state === 'idle' || E.state === 'recover') {
      E.tipY += (restTipY() - E.tipY) * Math.min(1, (E.state === 'idle' ? 6 : 8) * dt);
      if (E.state === 'idle') E.tipY = restTipY() + Math.sin(performance.now() / 300) * 3;
    } else if (E.state === 'track') {
      E.tipY = restTipY() + Math.sin(performance.now() / 180) * 4;
    } else if (E.state === 'lock') {
      E.tipY = restTipY() - 26 * (1 - E.t / e.lockTime); // slight raise = anticipation
      S.tickAcc += dt;
      if (S.tickAcc > 0.13) { S.tickAcc = 0; sfx.tick((E.t * 10) | 0); }
    } else if (E.state === 'strike') {
      const p = 1 - E.t / e.strikeTime;
      E.tipY = restTipY() - 26 + (contactTipY() - (restTipY() - 26)) * (p * p);
    }
  }
  separateEnemies(S.enemies, c.rail, dt);
}

function impact(E) {
  const c = cfg(), e = E.ep || c.enemy;
  const outcome = resolveStrike(E.lockedX, e.plugW, S.ports);
  E.tipY = contactTipY();
  if (S.screen !== 'playing') return; // end-of-level races between two hands: first one counts
  // accelerating hunter: every strike sharpens the next (per-hand copy only — never the level config)
  E.ep = applyRamp(E.ep ? { ...E.ep } : { ...c.enemy }, (E.ep || c.enemy).ramp);
  if (outcome === 'hit') {
    // kill whichever port got caught — unless flip-life / phase-out says otherwise
    let victim = null, bd = Infinity;
    for (const p of S.ports) {
      if (!p.alive) continue;
      const d = Math.abs(E.lockedX - p.x);
      if (d < bd) { bd = d; victim = p; }
    }
    if (!victim) return;
    const res = absorbHit({ shield: S.flipLife, invuln: S.invuln });
    if (res === 'ignored') {
      // phased: the plug meets only upside-down air
      fx.sparks(E.lockedX, EDGE_Y + 8);
      return;
    }
    if (res === 'shielded') {
      // FLIP-FLOP absorbs the plug: port flips right-side up, phases out briefly
      S.flipLife = false; S.invuln = 1.0;
      setMood(victim, 'wince', 1.0);
      fx.text(victim.x, 300, 'SAVED BY THE FLIP', C.good, 30, 1.2);
      fx.sparks(E.lockedX, EDGE_Y + 8);
      fx.addShake(8); fx.stop(0.15);
      sfx.saved();
      updateHud();
      return;
    }
    victim.alive = false; victim.stuckX = victim.x;
    S.dents.push({ x: E.lockedX, t: 0 });
    fx.debris(E.lockedX, EDGE_Y + 10);
    fx.addShake(12); fx.stop(0.28); S.flash = 0.5;
    sfx.plugged();
    const remaining = S.ports.some(p => p.alive);
    // (enemy already back in 'recover' — stepEnemy transitioned before emitting 'impact')
    if (!remaining) {
      sfx.lose();
      transitionTimer = setTimeout(() => { if (S.screen === 'lose-pending') showEnd(false); }, 650);
      S.screen = 'lose-pending';
    } else {
      const walled = cfg().movement === 'duo';
      fx.text(480, 300, walled ? 'PORT LOST. ITS CABLE BLOCKS YOU' : 'PORT LOST', C.signal, walled ? 28 : 34, 1.2);
    }
  } else {
    S.misses++;
    S.score += outcome === 'near' ? SCORE.NEAR : SCORE.MISS;
    // the port that nearly got it winces; everyone else is just relieved
    const closest = S.ports.filter(p => p.alive).reduce((a, b) => !a || Math.abs(b.x - E.lockedX) < Math.abs(a.x - E.lockedX) ? b : a, null);
    for (const p of S.ports) setMood(p, outcome === 'near' && p === closest ? 'wince' : 'relief', 0.7);
    S.dents.push({ x: E.lockedX, t: 0 });
    if (outcome === 'near') {
      fx.text(E.lockedX, 300, `CLOSE CALL +${SCORE.NEAR}`, C.good, 26, 1.0);
      sfx.nearMiss();
      if (!roundWon()) nearMissSlowMo.trigger();
      fx.addShake(7);
      // Seal Team earn-back: every 3rd CLOSE!! reclaims the newest sealed chunk
      if (cfg().sealTide) {
        const c = cfg();
        const u = unsealTick(S.unsealPips, S.sealed.length);
        S.unsealPips = u.pips;
        if (u.release) {
          const before = sealRail(c.rail, S.sealed);
          const popped = S.sealed.shift();
          const edgeX = popped.side < 0 ? before.min : before.max;
          fx.poof(edgeX, EDGE_Y);
          fx.text(edgeX, EDGE_Y - 64, 'EDGE RECLAIMED', C.good, 20, 1.0);
          sfx.saved();
        }
        updateHud();
      }
    } else {
      fx.text(E.lockedX, 310, `MISS +${SCORE.MISS}`, C.ink, 22, 0.8);
      fx.addShake(6);
    }
    fx.sparks(E.lockedX, EDGE_Y + 8);
    S.flash = 0.18;
    sfx.clang();
    E.doubleQueued = Math.random() < e.doubles;
    if (roundWon()) {
      if (S.mode === 'endless') {
        awardRoundClear();
        sfx.win();
        S.screen = 'win-pending';
        transitionTimer = setTimeout(() => { if (S.screen === 'win-pending') startNextRound(); }, 900);
      } else {
        awardLevelClear(); sfx.win();
        S.screen = 'win-pending';
        transitionTimer = setTimeout(() => { if (S.screen === 'win-pending') showEnd(true); }, 600);
      }
    }
  }
  updateHud();
}

// ---------- territory denial ----------
function blockerUpdate(dt) {
  const c = cfg(), B = S.blocker;
  if (!B) return;
  const ev = stepBlocker(B, dt, c.blocker, c.rail, c.slots || [],
    // sealed slots are already claimed — seizures pick from genuinely free ones
    (i) => S.sealed.includes(i) || S.ports.some(p => p.alive && p.slot === i));
  for (const e of ev) {
    if (e === 'warn') sfx.tick(0);
    if (e === 'solid') sfx.bump();
    if (e === 'eject') {
      // camper still on the seized slot gets bounced to the safest free one
      const threats = S.enemies.map(E => ({ x: E.lockedX, hx: E.x, state: E.state, blackout: !!E.blackout }));
      for (const p of S.ports) {
        if (!p.alive || p.slot !== B.slot) continue;
        const bi = safestSlot(c.slots || [], B.slot, threats);
        if (bi >= 0) { p.slot = bi; p.x = c.slots[bi]; p.squash = 1; fx.poof(p.x, EDGE_Y); }
      }
      fx.text(c.slots[B.slot], EDGE_Y - 64, 'EJECTED', C.caution, 20, 0.8);
      sfx.deny();
    }
  }
}

// ---------- pop quiz ----------
// Time freezes, every plug creeps toward the edge, and only mental math
// unfreezes it. Correct: clean reset to track + a small reward. Wrong or
// timeout: every hand snaps into a fast point-blank lock. Readable either way.
function freezeQuiz() {
  const q = genQuiz(Math.random);
  const timeout = cfg().quiz.timeout;
  const rail = cfg().rail;
  S.quiz = { ...q, t: timeout, timeout, start: S.enemies.map(E => ({ x: E.x, y: E.tipY })) };
  // Freeze each hand mid-lunge pointed at YOU (its nearest living port). The
  // reticle must read as "it has me", never as a stale slot you've already left.
  for (const E of S.enemies) {
    let f = null;
    for (const p of S.ports) if (p.alive && (!f || Math.abs(p.x - E.x) < Math.abs(f.x - E.x))) f = p;
    E.state = 'lock'; E.blackout = false;
    E.lockedX = Math.max(rail.min, Math.min(rail.max, f ? f.x : E.x));
  }
  show(`<div class="card quiz flash">
    ${head('Time frozen', `<span id="quiz-t">${Math.ceil(timeout)}</span>s left`)}
    <h2>${q.a} ${q.op} ${q.b}</h2>
    <p class="lede">The plug is creeping closer. Answer to unfreeze time.</p>
    <div class="answers">${q.options.map((o, i) => `<button class="ghost" data-ans="${i}"><span>${o}</span><kbd>${i + 1}</kbd></button>`).join('')}</div>
    <div class="bar"><i id="quiz-bar"></i></div>
  </div>`);
  overlay.querySelectorAll('[data-ans]').forEach(btn => {
    btn.onclick = () => {
      if (!S.quiz) return;
      sfx.ui();
      const q = S.quiz;
      resolveQuiz(parseInt(btn.dataset.ans, 10) === q.correct);
    };
  });
  sfx.lock();
}

function quizUpdate(dt) {
  const q = S.quiz;
  if (!q) return;
  q.t -= dt;
  // every frozen plug inches toward both its target port and the edge (creep
  // capped at 70% — the strike still has to travel the last stretch)
  const k = Math.min(0.7, 1 - Math.max(0, q.t) / q.timeout);
  S.enemies.forEach((E, i) => {
    E.x += (E.lockedX - E.x) * Math.min(1, 1.8 * dt);
    E.tipY = q.start[i].y + (contactTipY() - q.start[i].y) * k;
  });
  const tEl = document.getElementById('quiz-t');
  if (tEl) tEl.textContent = String(Math.max(0, Math.ceil(q.t)));
  const bar = document.getElementById('quiz-bar');
  if (bar) bar.style.transform = `scaleX(${Math.max(0, q.t / q.timeout).toFixed(3)})`;
  if (q.t <= 0) resolveQuiz(false);
}

function resolveQuiz(correct) {
  const wasQuiz = S.quiz;
  S.quiz = null;
  hide();
  if (!wasQuiz) return;
  if (correct) {
    S.score += SCORE.QUIZ;
    fx.text(480, 300, `CORRECT +${SCORE.QUIZ}`, C.good, 30, 1.0);
    sfx.saved();
    for (const E of S.enemies) {
      E.state = 'track'; E.t = (E.ep || cfg().enemy).trackTime; E.doubleQueued = false;
    }
  } else {
    fx.text(480, 300, 'WRONG', C.signal, 30, 1.0);
    sfx.deny();
    const alive = S.ports.filter(p => p.alive);
    for (const E of S.enemies) {
      const f = alive.length
        ? alive.reduce((a, b) => Math.abs(a.x - E.x) < Math.abs(b.x - E.x) ? a : b)
        : { x: E.x };
      E.lockedX = Math.max(cfg().rail.min, Math.min(cfg().rail.max, f.x));
      E.state = 'lock'; E.t = 0.35; E.blackout = false;
    }
  }
  S.quizT = cfg().quiz.every;
  updateHud();
}

// ---------- player update ----------
const framePressed = new Set();
function playerUpdate(dt) {
  const c = cfg();
  const tapX = input.consumeTap();

  S.bumpCd = Math.max(0, S.bumpCd - dt);

  if (c.movement === 'slots') {
    const p = S.ports[0];
    p.hopCd = Math.max(0, p.hopCd - dt);
    S.denyCd = Math.max(0, S.denyCd - dt);
    // Anti panic-dodge: no teleporting while a strike is in flight.
    // Dodges must be committed during the telegraph — last-instant hops fizzle.
    const locked = strikeLockout(S.enemies.map(E => ({ state: E.state })));
    // Seized slots are denied landing while the barricade is solid.
    const seized = (S.blocker && S.blocker.phase === 'active' && c.blocker.kind === 'slot') ? S.blocker.slot : -1;
    // Permanent seals deny landing for the whole run (Crowded Edge).
    const sealedHere = (i) => S.sealed.includes(i);
    const denyHop = (reason) => {
      if (S.denyCd > 0) return;
      S.denyCd = 0.5;
      setMood(p, 'strain', 0.4);
      fx.text(p.x, EDGE_Y - 64, reason, C.signal, 19, 0.6);
      fx.burst(p.x, EDGE_Y - 10, 6, { colors: [C.signal, C.ink], speed: 140, ttl: 0.3, size: 3 });
      sfx.deny();
    };
    let dir = 0;
    if (framePressed.has('arrowleft') || framePressed.has('a') || framePressed.has('q')) dir -= 1;
    if (framePressed.has('arrowright') || framePressed.has('d') || framePressed.has('e')) dir += 1;
    // number keys 1..5 direct
    for (let i = 0; i < c.slots.length; i++) {
      if (!framePressed.has(String(i + 1))) continue;
      if (locked) { denyHop('TOO LATE'); continue; }
      if (i === seized) { denyHop('BLOCKED'); continue; }
      if (sealedHere(i)) { denyHop('SEALED'); continue; }
      if (i === p.slot) continue;
      p.slot = i; p.x = c.slots[i]; p.hopCd = c.player.hopCooldown;
      p.squash = 1; fx.poof(p.x, EDGE_Y); sfx.hop();
    }
    if (dir !== 0) {
      if (locked) denyHop('TOO LATE');
      else if (p.hopCd <= 0) {
        const r = hopSlot(p.slot, dir, c.slots.length);
        if (r.moved) {
          if (r.index === seized) denyHop('BLOCKED');
          else if (sealedHere(r.index)) denyHop('SEALED');
          else {
            p.slot = r.index; p.x = c.slots[p.slot]; p.hopCd = c.player.hopCooldown;
            p.squash = 1; fx.poof(p.x, EDGE_Y); sfx.hop();
          }
        }
      }
    }
    // pointer tap: jump to nearest slot
    if (tapX != null && p.hopCd <= 0) {
      let best = 0, bd = Infinity;
      c.slots.forEach((sx, i) => { const d = Math.abs(sx - tapX); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) {
        if (locked) denyHop('TOO LATE');
        else if (best === seized) denyHop('BLOCKED');
        else if (sealedHere(best)) denyHop('SEALED');
        else if (best !== p.slot) { p.slot = best; p.x = c.slots[best]; p.hopCd = c.player.hopCooldown; p.squash = 1; fx.poof(p.x, EDGE_Y); sfx.hop(); }
      }
    }
    p.vx = 0;
  } else {
    // free + duo share a center driver
    let axis = input.state.axis;
    if (input.state.pointerActive && input.state.pointerX != null) {
      const ref = c.movement === 'duo'
        ? (S.ports.filter(p => p.alive)[0]?.x ?? S.center.x)
        : S.ports[0].x;
      const dx = input.state.pointerX - ref;
      if (Math.abs(dx) > 8) axis = Math.max(-1, Math.min(1, dx / 60));
      else axis = 0;
    }
    S.center.vx = S.center.vx || 0;
    // sealed ends of the edge shave the usable rail (Seal Team)
    const rail = (c.movement === 'free' && c.sealTide && S.sealed.length) ? sealRail(c.rail, S.sealed) : c.rail;
    stepFree(S.center, axis, dt, { player: c.player, rail });
    if (c.movement === 'duo') {
      for (const p of S.ports) {
        if (!p.alive) continue;
        const target = S.center.x + p.off;
        p.vx = S.center.vx;
        p.x = Math.max(c.rail.min, Math.min(c.rail.max, target));
      }
      // barricaded rail zones shove survivors out (never damage)
      let zoneBump = false;
      if (S.blocker && S.blocker.phase === 'active' && c.blocker.kind === 'rail') {
        const z = { x: S.blocker.x, w: S.blocker.w };
        for (const p of S.ports) {
          if (!p.alive) continue;
          const r = pushOutOfZone(p.x, z);
          if (r.moved) { p.x = r.x; zoneBump = true; }
        }
      }
      // dead ports are walls: survivors can't cross the stuck cable
      const bumped = applyDeadWalls(S.ports);
      // keep the shared driver consistent with clamped survivors
      const alive = S.ports.filter(p => p.alive);
      if (alive.length >= 1) S.center.x = alive[0].x - alive[0].off;
      // bump feedback when grinding against a corpse-wall or barricade
      if ((bumped || zoneBump) && axis !== 0 && S.bumpCd <= 0) {
        const wall = S.ports.find(p => !p.alive && p.stuckX != null);
        fx.burst(wall ? wall.stuckX : S.center.x, EDGE_Y - 6, 6, { colors: [C.caution, C.ink], speed: 150, ttl: 0.35, size: 3 });
        sfx.bump();
        S.bumpCd = 0.35;
        for (const p of S.ports) setMood(p, 'strain', 0.4);
      }
    } else {
      const p = S.ports[0];
      p.x = S.center.x; p.vx = S.center.vx;
      p.squash = Math.min(1, Math.abs(p.vx) / 560);
      if (S.blocker && S.blocker.phase === 'active' && c.blocker && c.blocker.kind === 'rail') {
        const r = pushOutOfZone(p.x, { x: S.blocker.x, w: S.blocker.w });
        if (r.moved) { p.x = r.x; S.center.x = r.x; setMood(p, 'strain', 0.3); }
      }
    }
  }
  // squash + mood decay
  for (const p of S.ports) {
    p.squash = Math.max(0, (p.squash || 0) - dt * 4); if (p.vx) p.face = p.vx;
    if (p.mood && (p.mood.t -= dt) <= 0) p.mood = null;
  }
}

// Short-lived facial reactions: relief after a dodge, a wince at a close call,
// strain when shoved by a wall or a refused hop. Stronger moods are not
// overwritten by weaker ones while they last.
const MOOD_RANK = { relief: 0, strain: 1, wince: 2 };
function setMood(p, kind, t) {
  if (!p?.alive) return;
  if (p.mood && MOOD_RANK[p.mood.kind] > MOOD_RANK[kind]) return;
  p.mood = { kind, t };
}

// ---------- pause ----------
function togglePause() {
  if (S.screen !== 'playing' && !S.paused) return;
  if (S.quiz) return; // pop quiz is its own 6-second pause — don't stack cards on it
  S.paused = !S.paused;
  if (S.paused) { S.screen = 'paused';
    const c = cfg();
    show(`<div class="card">
      ${head('Paused', S.mode === 'endless' ? `Round ${S.round}` : `Level ${pad2(c.id)} of ${pad2(LEVELS.length)}`)}
      <h2>Take a breath.</h2>
      <p class="lede">The machine can wait.</p>
      ${spec([
        ['Slide', 'A and D, the arrow keys, or drag.'],
        ['Slots', 'Press 1 to 5, or tap a slot.'],
        ['Timing', 'Wait for the red lock, then move before the strike.'],
      ])}
      <div class="actions"><button class="cta" data-act="resume">Resume ${KEY.p}</button><button class="ghost" data-act="menu">Quit to menu</button></div>
    </div>`);
    overlay.querySelector('[data-act="resume"]').onclick = () => { sfx.ui(); hide(); S.paused = false; S.screen = 'playing'; };
  } else { hide(); S.screen = 'playing'; }
}

// ============================================================ RENDER
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

function draw() {
  ctx.save();
  ctx.fillStyle = C.desk; ctx.fillRect(0, 0, W, H);
  ctx.translate(fx.shakeX, fx.shakeY);

  if (!stageBackdrop) {
    stageBackdrop = document.createElement('canvas'); stageBackdrop.width = W; stageBackdrop.height = H;
    const liveContext = ctx; ctx = stageBackdrop.getContext('2d');
    drawDesk();
    drawLaptop();
    ctx = liveContext;
  }
  ctx.drawImage(stageBackdrop, 0, 0);
  if (S.screen === 'menu') { drawMenuFigure(); ctx.restore(); return; }
  drawDents();
  if (cfg().movement === 'slots') drawSlots();
  drawBlocker();
  drawPorts();
  for (const E of S.enemies) drawEnemy(E);
  fx.draw(ctx);

  // telegraph reticle + aim line (on top)
  for (const E of S.enemies) drawTelegraph(E);

  if (S.banner) {
    ctx.globalAlpha = Math.min(1, S.banner.t * 2);
    ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    ctx.font = condensed(800, 68);
    ctx.lineWidth = 10; ctx.strokeStyle = C.desk;
    ctx.strokeText(S.banner.str, W / 2, 300);
    ctx.fillStyle = C.ink; ctx.fillText(S.banner.str, W / 2, 300);
    if (S.banner.sub) {
      ctx.font = mono(13, 500); ctx.lineWidth = 6;
      ctx.strokeText(S.banner.sub.toUpperCase(), W / 2, 328);
      ctx.fillStyle = C.ink2; ctx.fillText(S.banner.sub.toUpperCase(), W / 2, 328);
    }
    ctx.globalAlpha = 1;
  }
  if (S.flash > 0) { ctx.fillStyle = `rgba(221,74,31,${S.flash * 0.28})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
  ctx.restore();
}

// Graph paper under the laptop: the desk reads as a drafting table.
function drawDesk() {
  ctx.fillStyle = C.desk; ctx.fillRect(-20, -20, W + 40, H + 40);
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 24) {
    ctx.strokeStyle = x % 120 === 0 ? C.gridMajor : C.grid;
    ctx.beginPath(); ctx.moveTo(x + 0.5, EDGE_Y); ctx.lineTo(x + 0.5, H); ctx.stroke();
  }
  for (let y = EDGE_Y + 24, i = 1; y <= H; y += 24, i++) {
    ctx.strokeStyle = i % 5 === 0 ? C.gridMajor : C.grid;
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
  }
  // contact shadow cast by the laptop onto the desk
  const sh = ctx.createLinearGradient(0, EDGE_Y + 6, 0, EDGE_Y + 46);
  sh.addColorStop(0, 'rgba(26,25,22,.22)'); sh.addColorStop(1, 'rgba(26,25,22,0)');
  ctx.fillStyle = sh; ctx.fillRect(0, EDGE_Y + 6, W, 40);
}

function drawLaptop() {
  const g = ctx.createLinearGradient(0, 0, 0, EDGE_Y);
  g.addColorStop(0, '#3a3935'); g.addColorStop(0.55, C.slab); g.addColorStop(1, '#21201d');
  ctx.fillStyle = g; ctx.fillRect(0, -20, W, EDGE_Y + 20);
  ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(0, 8, W, 2);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#b9b3a6'; ctx.font = font(600, 14); ctx.textAlign = 'left';
  ctx.fillText(flavor.brand, 24, 34);
  if (flavor.dot) { // mac traffic lights, because of course the laptop has them
    const x0 = 24 + ctx.measureText(flavor.brand).width + 16;
    for (const [i, col] of ['#c9604c', '#c99a3e', '#5d9358'].entries()) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x0 + i * 16, 29, 4.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = '#77736a'; ctx.font = mono(11); ctx.textAlign = 'right';
  ctx.fillText(flavor.sub, W - 24, 34);
  // vent slits
  ctx.fillStyle = 'rgba(0,0,0,.32)';
  for (let x = 40; x < W - 40; x += 20) ctx.fillRect(x, EDGE_Y - 34, 10, 4);
  // edge lip (the rail the port lives on), with a hairline tinted per OS
  ctx.fillStyle = '#121110'; ctx.fillRect(0, EDGE_Y - 4, W, 12);
  ctx.globalAlpha = 0.5; ctx.fillStyle = flavor.edge[0]; ctx.fillRect(0, EDGE_Y + 7, W, 1); ctx.globalAlpha = 1;
}

// Menu: the right half of the stage is an annotated figure, like a manual plate.
function drawMenuFigure() {
  ctx.save(); ctx.translate(755, 200); ctx.scale(2.2, 2.2); ctx.translate(-480, -(EDGE_Y - 8)); drawPorts(); ctx.restore();
  ctx.save(); ctx.translate(755, 320); ctx.scale(1.65, 1.65); ctx.translate(-480, -330); drawEnemy(S.enemies[0]); ctx.restore();
  const callout = (x0, x1, y, letter, word) => {
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(x0, y + 0.5, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = C.ink3; ctx.font = mono(11); ctx.fillText(letter, x1 + 8, y - 6);
    ctx.fillStyle = C.ink; ctx.font = condensed(700, 19); ctx.fillText(word, x1 + 8, y + 14);
  };
  callout(834, 862, 200, 'A', 'You');
  callout(797, 872, 356, 'B', 'Machine');
  ctx.fillStyle = C.ink3; ctx.font = mono(11); ctx.textAlign = 'right';
  ctx.fillText('FIG. 1', W - 20, H - 18);
}

function drawSlots() {
  const c = cfg();
  c.slots.forEach((sx, i) => {
    const occ = S.ports[0].slot === i;
    ctx.save();
    ctx.setLineDash(occ ? [] : [5, 5]);
    ctx.lineWidth = occ ? 2 : 1.5;
    ctx.strokeStyle = occ ? '#ece8df' : 'rgba(236,232,223,.32)';
    rr(sx - 38, EDGE_Y - 22, 76, 34, 3); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = occ ? C.ink : C.ink3; ctx.font = mono(12, occ ? 600 : 500); ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), sx, EDGE_Y + 36);
    ctx.restore();
  });
}

function drawDents() {
  for (const d of S.dents) {
    ctx.fillStyle = 'rgba(26,25,22,.4)';
    ctx.beginPath(); ctx.ellipse(d.x, EDGE_Y + 8, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.signal;
    ctx.fillRect(d.x - 10, EDGE_Y + 6, 20, 2);
  }
}

// Diagonal hazard tape clipped to a box (barricades and seals share it).
function hazardBox(x, y, w, h, stripe) {
  ctx.fillStyle = C.ink; rr(x, y, w, h, 3); ctx.fill();
  ctx.save(); rr(x, y, w, h, 3); ctx.clip();
  ctx.fillStyle = stripe;
  for (let sx = x - 40; sx < x + w + 40; sx += 22) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h); ctx.lineTo(sx + 11, y + h); ctx.lineTo(sx + 11 + h * 0.5, y); ctx.lineTo(sx + h * 0.5, y);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function warnOutline(x, y, w, h) {
  ctx.strokeStyle = C.caution; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
  rr(x, y, w, h, 3); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = C.caution; ctx.font = condensed(800, 20); ctx.textAlign = 'center';
  ctx.fillText('!', x + w / 2, y - 8);
}

// Territory denial visuals: flashing warning outline, then a solid barricade.
// Also draws permanent Crowded-Edge seals (which exist without any blocker).
function drawBlocker() {
  const B = S.blocker, c = cfg();
  if ((!B || B.phase === 'idle') && !S.sealed.length) return;
  const blink = B && B.phase === 'warn' ? (Math.floor(performance.now() / 150) % 2 === 0) : false;
  ctx.save();
  if (B && B.phase !== 'idle' && c.blocker.kind === 'rail') {
    const l = B.x - B.w / 2;
    if (B.phase === 'warn') {
      if (blink) warnOutline(l, EDGE_Y - 28, B.w, 40);
    } else {
      hazardBox(l, EDGE_Y - 28, B.w, 40, C.caution);
      ctx.fillStyle = C.caution; ctx.font = mono(11, 600); ctx.textAlign = 'center';
      ctx.fillText('NO ENTRY', B.x, EDGE_Y - 36);
    }
  } else if (B && B.phase !== 'idle') {
    // seized slot: warn flashes, solid lays hazard tape over the slot
    const sx = c.slots[B.slot];
    if (sx == null) { ctx.restore(); return; }
    if (B.phase === 'warn') {
      if (blink) warnOutline(sx - 38, EDGE_Y - 22, 76, 34);
    } else {
      hazardBox(sx - 38, EDGE_Y - 22, 76, 34, C.signal);
    }
  }
  // permanent seals: stuck plugs squatting on slots for the whole run
  if (c.movement === 'slots') {
    for (const i of S.sealed) {
      const sx = c.slots[i];
      if (sx == null) continue;
      hazardBox(sx - 38, EDGE_Y - 22, 76, 34, '#4a4842');
      ctx.fillStyle = '#c7c3b8'; ctx.fillRect(sx - 14, EDGE_Y - 30, 28, 8); // stub of the plug that claimed it
    }
  }
  // Seal Team (free slide): sealed stretches claim each end of the edge, so the
  // shrinking lane is unmistakable — teeth of the plug run along the whole chunk
  if (c.movement === 'free' && c.sealTide && S.sealed.length) {
    for (const s of S.sealed) {
      const x = s.side < 0 ? c.rail.min : c.rail.max - s.w;
      hazardBox(x, EDGE_Y - 22, s.w, 34, '#4a4842');
      ctx.strokeStyle = C.caution; ctx.lineWidth = 2; rr(x, EDGE_Y - 22, s.w, 34, 3); ctx.stroke();
      ctx.fillStyle = '#c7c3b8';
      for (let px = x + 5; px + 12 <= x + s.w; px += 22) ctx.fillRect(px, EDGE_Y - 30, 12, 8);
    }
    ctx.fillStyle = C.caution; ctx.font = mono(11, 600); ctx.textAlign = 'center';
    const r = sealRail(c.rail, S.sealed);
    if (r.min > c.rail.min) ctx.fillText('SEALED', c.rail.min + (r.min - c.rail.min) / 2, EDGE_Y - 40);
    if (r.max < c.rail.max) ctx.fillText('SEALED', r.max + (c.rail.max - r.max) / 2, EDGE_Y - 40);
  }
  ctx.restore();
}

// Line-art helper: fill, optional right-side shade band, ink outline.
function inked(x, y, w, h, r, fill, shade, shadeFrac = 0.28) {
  rr(x, y, w, h, r);
  ctx.fillStyle = fill; ctx.fill();
  if (shade) {
    ctx.save(); ctx.clip();
    ctx.fillStyle = shade; ctx.fillRect(x + w * (1 - shadeFrac), y, w * shadeFrac + 1, h);
    ctx.restore();
  }
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();
}

// Printed caution sign (amber triangle, ink "!"), used for corpse-walls.
function cautionSign(x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.55); ctx.lineTo(x + size * 0.6, y + size * 0.45); ctx.lineTo(x - size * 0.6, y + size * 0.45);
  ctx.closePath();
  ctx.fillStyle = C.caution; ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.fillRect(x - 1, y - size * 0.22, 2, size * 0.36);
  ctx.fillRect(x - 1, y + size * 0.22, 2, 2);
}

// The port's face lives in the socket cavity. Eyes are big on purpose:
// at 66x26 they are the only way the port can emote.
function drawPortFace(px, py, p, locking) {
  const mood = p.mood?.kind || (locking ? 'scared' : 'calm');
  const look = Math.max(-2, Math.min(2, (p.face || p.vx || 0) / 220));
  const eyeY = py + 11, r = mood === 'scared' ? 6.4 : 6;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const side of [-1, 1]) {
    const ex = px + side * 11;
    if (mood === 'relief') {
      // ^ ^ closed, pleased
      ctx.strokeStyle = '#f3f1e6'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ex, eyeY + 2.5, 4.2, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      continue;
    }
    if (mood === 'wince') {
      // > <  squeezed shut
      ctx.strokeStyle = '#f3f1e6'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ex - side * 4, eyeY - 4); ctx.lineTo(ex + side * 3, eyeY); ctx.lineTo(ex - side * 4, eyeY + 4);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = '#f3f1e6';
    ctx.beginPath(); ctx.arc(ex, eyeY, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(ex + look, eyeY + 0.5, mood === 'scared' ? 1.6 : 2.7, 0, Math.PI * 2); ctx.fill();
    if (mood === 'strain') {
      // heavy lids pressed halfway down, angled toward the middle
      ctx.fillStyle = '#141412';
      ctx.beginPath();
      ctx.moveTo(ex - r - 1, eyeY - r - 1); ctx.lineTo(ex + r + 1, eyeY - r - 1);
      ctx.lineTo(ex + r + 1, eyeY + (side > 0 ? -1 : 1)); ctx.lineTo(ex - r - 1, eyeY + (side > 0 ? 1 : -1));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#f3f1e6'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(ex - r, eyeY + (side > 0 ? 1 : -1)); ctx.lineTo(ex + r, eyeY + (side > 0 ? -1 : 1)); ctx.stroke();
    }
  }
  // mouth, tucked between the eyes above the contact tongue
  ctx.strokeStyle = '#d9d5c9'; ctx.lineWidth = 1.3;
  ctx.beginPath();
  if (mood === 'relief') { ctx.moveTo(px - 3.5, py + 13); ctx.quadraticCurveTo(px, py + 17.5, px + 3.5, py + 13); }
  else if (mood === 'wince') { ctx.moveTo(px - 3.5, py + 15); ctx.lineTo(px - 1.2, py + 13.5); ctx.lineTo(px + 1.2, py + 15); ctx.lineTo(px + 3.5, py + 13.5); }
  else if (mood === 'strain') { ctx.moveTo(px - 3.5, py + 14.5); ctx.lineTo(px + 3.5, py + 14.5); }
  else if (mood === 'scared') { ctx.arc(px, py + 14.5, 1.6, 0, Math.PI * 2); }
  else { ctx.moveTo(px - 2.2, py + 14); ctx.quadraticCurveTo(px, py + 15.8, px + 2.2, py + 14); }
  ctx.stroke();
}

// A plugged port: the plug is seated, its cable drops to the desk and becomes
// a wall the surviving port cannot cross (see applyDeadWalls).
function drawDeadPort(px, py, p) {
  // cable first, so the plug body sits on top of it
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.ink; ctx.lineWidth = 11;
  ctx.beginPath(); ctx.moveTo(px, py + p.h + 30);
  ctx.bezierCurveTo(px + 8, py + p.h + 120, px - 10, H - 120, px - 2, H + 20); ctx.stroke();
  ctx.strokeStyle = '#3a3833'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(px - 2, py + p.h + 32);
  ctx.bezierCurveTo(px + 6, py + p.h + 120, px - 12, H - 120, px - 4, H + 20); ctx.stroke();
  drawUSBPort(ctx, px, py, p.w, p.h, false);
  // the plug's steel fills the cavity: nobody home
  inked(px - p.w / 2 + 4, py + 4.5, p.w - 8, p.h - 8, 2, '#c9ccc5', '#a2a69f', 0.28);
  ctx.fillStyle = C.ink;
  ctx.fillRect(px - p.w * 0.25, py + 9, p.w * 0.14, 6); ctx.fillRect(px + p.w * 0.11, py + 9, p.w * 0.14, 6);
  // plug body hanging under the socket, signal shoulder on top
  inked(px - 23, py + p.h + 1, 46, 30, [2, 2, 7, 7], '#35342f', '#272622', 0.25);
  ctx.fillStyle = C.signal; ctx.fillRect(px - 22.25, py + p.h + 1.75, 44.5, 4.5);
  cautionSign(px, py - 15, 15);
}

function drawPorts() {
  for (const p of S.ports) {
    const px = p.alive ? p.x : (p.stuckX ?? p.x);
    const py = EDGE_Y - 22;
    if (!p.alive) { ctx.save(); drawDeadPort(px, py, p); ctx.restore(); continue; }
    const sq = p.squash || 0;
    const wob = 1 + sq * 0.12, hob = 1 - sq * 0.08;
    ctx.save();
    // phase-out blink while invulnerable
    if (S.invuln > 0 && Math.floor(S.invuln * 12) % 2 === 0) ctx.globalAlpha = 0.35;
    // FLIP-FLOP extra life: the whole port hangs upside-down (tongue on top,
    // face derpy) until it absorbs a plug
    const flipped = S.flipLife;
    ctx.translate(px, py + p.h / 2);
    ctx.scale(wob, hob);
    if (flipped) ctx.rotate(Math.PI);
    ctx.translate(-px, -(py + p.h / 2));
    drawUSBPort(ctx, px, py, p.w, p.h);
    drawPortFace(px, py, p, S.enemies.some(E => E.state === 'lock'));
    ctx.restore();
    // "YOU" tag stays upright even when the port hangs upside-down
    ctx.fillStyle = '#e4dfd2'; ctx.font = mono(10, 600); ctx.textAlign = 'center';
    ctx.fillText(flipped ? 'YOU (FLIPPED)' : 'YOU', px, py - 9);
  }
}

// The attacker is an industrial arm: two jaws clamp the plug body, a carriage
// and wrist sit under it, and the arm runs off-frame from a pivot joint.
// Bruisers are heavy yellow clamps; jabbers are slim grey pick-and-place units.
const ARM = {
  a: { jaw: 15, arm: 38, bolts: true },
  c: { jaw: 7, arm: 24, bolts: false },
  base: { jaw: 11, arm: 30, bolts: true },
};

function bolt(x, y, r = 2.6) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#8f8b80'; ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - r * 0.6, y); ctx.lineTo(x + r * 0.6, y); ctx.stroke();
}

function drawEnemy(E) {
  const c = cfg();
  const ep = E.ep || c.enemy;
  const plugW = ep.plugW;
  const tipX = E.x, tipY = E.tipY;
  const urgency = E.state === 'lock' ? (1 - E.t / ep.lockTime) : 0;
  // servo jitter while locked: the arm strains against its own brakes
  const trem = E.state === 'lock' && !motionPreference.matches ? Math.sin(performance.now() / 30) * (1.5 + urgency * 3.5) : 0;
  const hx = tipX + trem;
  const kit = ARM[ep.plug] || ARM.base;
  const paint = E.paint, shade = 'rgba(0,0,0,.18)';
  const isC = ep.plug === 'c';
  // plug body extents (from usb-art), so the jaws close exactly on it
  const bodyTop = tipY + (isC ? 46 : 58), bodyBot = tipY + (isC ? 110 : 114);
  const bodyHalf = plugW / 2 + (isC ? 4 : 5);
  const carriageY = bodyBot - 6, wristY = carriageY + 16, pivotY = wristY + 36;

  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // the plug's own cable, fed out the side of the carriage and off-frame
  ctx.strokeStyle = C.ink; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(hx + 6, carriageY + 10); ctx.bezierCurveTo(hx + 50, carriageY + 24, hx + 62, pivotY + 40, hx + 74, H + 30); ctx.stroke();
  ctx.strokeStyle = '#3a3833'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(hx + 6, carriageY + 10); ctx.bezierCurveTo(hx + 50, carriageY + 24, hx + 62, pivotY + 40, hx + 74, H + 30); ctx.stroke();

  // arm segment, with a hydraulic ram alongside and the plug type stencilled on
  const aw = kit.arm;
  inked(hx - aw / 2, pivotY, aw, H + 30 - pivotY, 6, paint, shade, 0.3);
  if (!isC) {
    inked(hx - aw / 2 - 12, pivotY + 18, 8, H + 30 - pivotY, 3, '#bcbab2', '#9a978e', 0.4);
    inked(hx - aw / 2 - 13, pivotY + 60, 10, H + 30 - pivotY, 2, '#55524b');
  }
  if (ep.plug) {
    ctx.fillStyle = 'rgba(26,25,22,.75)'; ctx.font = mono(10, 600); ctx.textAlign = 'center';
    ctx.save(); ctx.translate(hx + 1, pivotY + 58); ctx.rotate(-Math.PI / 2);
    ctx.fillText(isC ? 'USB-C' : 'USB-A', 0, 3.5);
    ctx.restore();
  }
  // pivot joint
  ctx.beginPath(); ctx.arc(hx, pivotY, aw / 2 + 4, 0, Math.PI * 2);
  ctx.fillStyle = paint; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(hx, pivotY, aw / 4, 0, Math.PI * 2);
  ctx.fillStyle = '#35342f'; ctx.fill(); ctx.stroke();
  bolt(hx, pivotY, 2.4);

  // wrist block, narrower than the carriage
  inked(hx - 20, wristY - 2, 40, pivotY - wristY + 2, 4, '#35342f', '#272622', 0.3);
  if (isC) { // jabbers carry a status light
    ctx.beginPath(); ctx.arc(hx + 11, wristY + 9, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = C.caution; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.stroke();
  }

  // speed lines on strike (at the sides so the gripper stays readable)
  if (E.state === 'strike') {
    ctx.strokeStyle = 'rgba(26,25,22,.4)'; ctx.lineWidth = 2;
    for (const sx of [hx - bodyHalf - kit.jaw - 18, hx + bodyHalf + kit.jaw + 18]) {
      ctx.beginPath(); ctx.moveTo(sx, tipY + 70); ctx.lineTo(sx, tipY - 6); ctx.stroke();
    }
  }
  (isC ? drawUSBCStick : drawUSBStick)(ctx, hx, tipY, plugW, E.accent);

  // carriage: the rail both jaws ride on
  const reach = bodyHalf + kit.jaw + 4;
  inked(hx - reach, carriageY, reach * 2, 16, 3, paint, shade, 0.3);
  ctx.strokeStyle = 'rgba(26,25,22,.45)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(hx - reach + 5, carriageY + 8); ctx.lineTo(hx + reach - 5, carriageY + 8); ctx.stroke();
  // jaws, closed on the plug body, with grip pads on their inner faces
  const jawTop = bodyTop + 6;
  for (const side of [-1, 1]) {
    const inner = hx + side * bodyHalf;
    const x = side < 0 ? inner - kit.jaw : inner;
    inked(x, jawTop, kit.jaw, carriageY - jawTop + 4, [3, 3, 1, 1], paint, shade, 0.3);
    ctx.fillStyle = C.ink;
    for (let y = jawTop + 6; y < carriageY - 4; y += 6) ctx.fillRect(side < 0 ? inner - 3 : inner, y, 3, 2);
    if (kit.bolts) { bolt(x + kit.jaw / 2 + side, jawTop + 9); bolt(x + kit.jaw / 2 + side, carriageY - 6); }
  }

  // tracking: a dashed ring says "it's looking for you", without claiming a target yet
  if (E.state === 'track') {
    ctx.strokeStyle = 'rgba(26,25,22,.4)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 6]);
    ctx.beginPath(); ctx.arc(hx, tipY + 30, 56, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawTelegraph(E) {
  if (!E || (E.state !== 'lock' && E.state !== 'strike')) return;
  if (E.state === 'lock' && E.blackout) return; // crosshair cut out — read the hand, not the marker
  const tx = E.lockedX;
  const pulse = motionPreference.matches ? 0.5 : 0.5 + 0.5 * Math.sin(performance.now() / 90);
  ctx.save();
  if (E.state === 'lock') {
    // dashed aim line plug -> target
    ctx.strokeStyle = `rgba(221,74,31,${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 2.5; ctx.setLineDash([7, 7]);
    ctx.beginPath(); ctx.moveTo(E.x, E.tipY - 6); ctx.lineTo(tx, EDGE_Y - 26); ctx.stroke();
    ctx.setLineDash([]);
    // reticle on the edge
    ctx.strokeStyle = C.signal; ctx.lineWidth = 3;
    // the ring matches this plug's real width, so a USB-C lock looks as tight as it is
    const r = ((E.ep || cfg().enemy).plugW * 0.5 + 2) + pulse * 6;
    ctx.beginPath(); ctx.arc(tx, EDGE_Y - 8, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx - r - 8, EDGE_Y - 8); ctx.lineTo(tx - r + 4, EDGE_Y - 8);
    ctx.moveTo(tx + r - 4, EDGE_Y - 8); ctx.lineTo(tx + r + 8, EDGE_Y - 8); ctx.stroke();
    // arrowhead over the target
    const ay = EDGE_Y - 46 - pulse * 6;
    ctx.fillStyle = C.signal;
    ctx.beginPath(); ctx.moveTo(tx - 8, ay - 10); ctx.lineTo(tx + 8, ay - 10); ctx.lineTo(tx, ay); ctx.closePath(); ctx.fill();
  } else {
    // strike: solid fast line
    ctx.strokeStyle = C.signal; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(E.x, E.tipY - 6); ctx.lineTo(tx, EDGE_Y - 10); ctx.stroke();
  }
  ctx.restore();
}

// ---------- main loop ----------
let hudElapsed = 0;
let chromeScreen;
const QS = new URLSearchParams(location.search);
const BOT = QS.get('bot') === '1';
// Dev/testing only: ?speed=N fast-forwards the simulation (e.g. bot full-level runs).
const SPEED = Math.max(1, Math.min(20, parseFloat(QS.get('speed') || '1') || 1));

function botDrive() {
  // Dev/testing autopilot (?bot=1): shared policy with the headless balance tests.
  const c = cfg();
  const alive = S.ports.filter(p => p.alive);
  if (!alive.length) return;
  // steer by the port in most danger (nearest any hand)
  const p = alive.reduce((a, b) => Math.min(...S.enemies.map(E => Math.abs(a.x - E.x))) < Math.min(...S.enemies.map(E => Math.abs(b.x - E.x))) ? a : b);
  const threats = S.enemies.map(E => ({ x: E.lockedX, hx: E.x, state: E.state, blackout: !!E.blackout }));
  if (c.movement === 'slots') {
    if (p.hopCd <= 0) {
      // permanent seals plus any warned/seized slot are off the bot's map
      const banned = [...S.sealed];
      if (S.blocker && S.blocker.phase !== 'idle' && c.blocker.kind === 'slot') banned.push(S.blocker.slot);
      const delta = botSlotDirMulti(p.slot, c.slots, threats, banned);
      // jump straight to the target slot via its number key (same as a tap)
      if (delta !== 0) framePressed.add(String(p.slot + delta + 1));
    }
    return;
  }
  // avoid the barricade from its first warning flash, not just once it is solid
  const warnZone = (S.blocker && S.blocker.phase !== 'idle' && c.blocker.kind === 'rail')
    ? { x: S.blocker.x, w: S.blocker.w } : null;
  const walls = S.ports.filter(p => !p.alive && p.stuckX != null).map(p => p.stuckX);
  const rail = (c.movement === 'free' && c.sealTide && S.sealed.length) ? sealRail(c.rail, S.sealed) : c.rail;
  input.state.axis = botAxisFreeMulti(p.x, threats, rail, warnZone, walls);
}

const profiler = QS.get("perf") === "1" ? (await import("./perf.js")).createProfiler() : null;

function frame(now, elapsed) {
  const started = profiler?.begin();
  try { runFrame(now, elapsed); } finally { profiler?.end(started, canvas, S.screen); }
  return !document.hidden && (S.screen === 'playing' || S.screen.endsWith('-pending'));
}

function runFrame(now, elapsed) {
  const realDt = Math.min(0.033, elapsed);
  let dt = realDt * SPEED;
  input.consume(framePressed);
  if (framePressed.has('m')) syncMute();
  if (framePressed.has('p') || framePressed.has('escape')) togglePause();
  if (framePressed.has('r') && ['playing', 'lose', 'win'].includes(S.screen)) doRetry();
  if ((framePressed.has('space') || framePressed.has('enter')) && overlay.children.length && document.activeElement?.tagName !== 'BUTTON') overlay.querySelector('.cta')?.click();
  if (chromeScreen !== S.screen) {
    chromeScreen = S.screen;
    pauseButton.disabled = !['playing', 'paused'].includes(S.screen);
    pauseButton.setAttribute('aria-label', S.paused ? 'Resume game (P)' : 'Pause game (P)');
  }
  if (document.hidden) { framePressed.clear(); return; }
  if (S.screen !== 'playing' || S.paused) {
    // Menus and paused scenes only need a single paint after state changes.
    if (S.screen.endsWith('-pending')) { fx.update(dt); S.flash = Math.max(0, S.flash - dt * 2.2); draw(); }
    else if (frame.screen !== S.screen) { draw(); frame.screen = S.screen; }
    framePressed.clear(); return;
  }
  frame.screen = S.screen;

  dt *= nearMissSlowMo.update(realDt);
  dt = fx.update(dt) || 0; // hitstop consumes the frame
  if (S.quiz) { // pop quiz: world frozen, plug creeping, answer to unfreeze
    input.consume(framePressed);
    for (const k of ['1', '2', '3']) {
      if (framePressed.has(k)) {
        sfx.ui();
        const q = S.quiz;
        if (q) resolveQuiz(+k - 1 === q.correct);
        break;
      }
    }
    framePressed.clear();
    if (dt > 0 && S.quiz) quizUpdate(dt);
    draw();
    return;
  }
  if (dt > 0) {
    S.elapsed += dt;
    S.invuln = Math.max(0, S.invuln - dt);
    if (BOT) botDrive();
    if (S.banner) { S.banner.t -= dt; if (S.banner.t <= 0) S.banner = null; }
    S.flash = Math.max(0, S.flash - dt * 2.2);
    playerUpdate(dt);
    blockerUpdate(dt);
    enemyUpdate(dt);
    const qc = cfg();
    if (qc.quiz && !S.quiz && S.screen === 'playing') {
      S.quizT -= dt;
      if (S.quizT <= 0) freezeQuiz();
    }
    if (qc.sealTide && S.screen === 'playing') {
      S.sealT -= dt;
      if (S.sealT <= 0) {
        S.sealT = qc.sealTide.every;
        const trim = pickTideTrim(qc.rail, S.sealed, qc.sealTide.chunk, qc.sealTide.minWidth, qc.sealTide.maxSide, Math.random);
        if (trim) {
          S.sealed.push(trim);
          const edgeX = trim.side < 0 ? sealRail(qc.rail, S.sealed).min : sealRail(qc.rail, S.sealed).max;
          fx.text(edgeX, EDGE_Y - 64, 'EDGE SEALED', C.caution, 22, 1.0);
          fx.burst(edgeX, EDGE_Y - 10, 14, { colors: [C.caution, C.signal], speed: 190, ttl: 0.5, size: 3 });
          fx.addShake(8); S.flash = Math.max(S.flash, 0.22);
          sfx.bump();
          updateHud();
        }
      }
    }
    if (roundWon() && S.screen === 'playing') {
      // time-based win (miss-based win handled in impact())
      if (S.mode === 'endless') {
        awardRoundClear();
        sfx.win();
        S.screen = 'win-pending';
        transitionTimer = setTimeout(() => { if (S.screen === 'win-pending') startNextRound(); }, 900);
      } else {
        awardLevelClear(); sfx.win(); S.screen = 'win-pending';
        transitionTimer = setTimeout(() => { if (S.screen === 'win-pending') showEnd(true); }, 500);
      }
    }
    if (S.elapsed >= cfg().time - 3 && !S.warned) { /* last-seconds tension could tick here */ }
    hudElapsed += dt;
    if (hudElapsed >= 0.1) { updateHud(); hudElapsed = 0; }
    // lose-pending / win-pending: keep rendering, freeze logic transitions only via screen flag
    draw();
  } else {
    draw(); // frozen hitstop frame still renders shake
  }
  framePressed.clear();
}

// ---------- chrome ----------
let directionPointer = null;
for (const button of document.querySelectorAll('[data-direction]')) {
  button.addEventListener('pointerdown', e => {
    if (S.screen !== 'playing' || e.isPrimary === false || directionPointer !== null) return;
    directionPointer = e.pointerId; button.setPointerCapture(e.pointerId);
    input.holdDirection(Number(button.dataset.direction));
  });
  const release = e => {
    if (directionPointer !== e.pointerId) return;
    directionPointer = null; input.releaseDirection();
  };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, release);
}
window.addEventListener('blur', () => { directionPointer = null; });
window.addEventListener('resize', () => { directionPointer = null; });
for (const button of slotButtons) button.onclick = () => {
  if (S.screen === 'playing' && cfg().movement === 'slots') input.tap(cfg().slots[Number(button.dataset.slot)]);
};

function syncMute() {
  const muted = toggleMute();
  const button = document.getElementById('btn-mute');
  button.classList.toggle('muted', muted); button.setAttribute('aria-pressed', String(muted));
  button.setAttribute('aria-label', muted ? 'Unmute (M)' : 'Mute (M)');
}
document.getElementById('btn-mute').onclick = () => { syncMute(); sfx.ui(); };
window.addEventListener('pointerdown', unlockAudio, { passive: true });
window.addEventListener('pointerup', unlockAudio, { passive: true });
window.addEventListener('keydown', unlockAudio);
window.addEventListener('pagehide', () => { input.reset(); suspendAudio(); scheduler.stop(); });
window.addEventListener('pageshow', () => { frame.screen = null; wake(); });
motionPreference.addEventListener('change', () => { frame.screen = null; wake(); });
pauseButton.onclick = () => togglePause();
document.getElementById('btn-help').onclick = () => {
  if (S.screen === 'playing') togglePause();
  else if (S.screen === 'paused') togglePause();
  else showMenu();
};
overlay.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const buttons = [...overlay.querySelectorAll('button')];
  if (!buttons.length) return;
  const first = buttons[0], last = buttons.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    input.reset(); suspendAudio();
    if (S.screen === 'playing' && !S.paused) togglePause();
    scheduler.stop();
  } else { frame.screen = null; wake(); }
});


// ---------- boot ----------
{
  const override = QS.get('os');
  OS = (override === 'mac' || override === 'windows' || override === 'linux') ? override : detectOS();
  if (OS !== 'mac' && OS !== 'windows' && OS !== 'linux') OS = 'windows'; // 'other' gets the classic look
  document.body.dataset.os = OS;
  flavor = osCopy(OS);
  const footOs = document.getElementById('foot-os');
  if (footOs && flavor.foot) footOs.textContent = flavor.foot;
}
resizeCanvas();
resetLevel(0);
const startLevel = Math.max(1, Math.min(LEVELS.length, parseInt(QS.get('level') || '1', 10))) - 1;
// Dev/testing: ?endless=1&round=N jumps straight into an endless run.
if (QS.get('endless') === '1') {
  hide(); hud.classList.remove('hidden');
  S.mode = 'endless'; S.score = 0;
  S.flipLife = QS.get('flip') === '1';
  S.round = Math.max(1, parseInt(QS.get('round') || '1', 10)) - 1;
  startNextRound();
  if (QS.get('end') === 'lose') { // preview the endless game-over card
    for (const p of S.ports) { p.alive = false; p.stuckX = p.x; }
    S.elapsed = 12.3; S.score = 1250; S.enemies[0].tipY = contactTipY(); showEnd(false);
  }
} else if (QS.get('play') === '1' || BOT) {
  resetLevel(startLevel); hide(); S.screen = 'playing';
  S.banner = { str: 'DODGE', sub: '', t: 0.9 };
  hud.classList.remove('hidden');
  const deadParam = parseInt(QS.get('dead') || '-1', 10);
  if (deadParam >= 0 && S.ports[deadParam]) {
    S.ports[deadParam].alive = false;
    S.ports[deadParam].stuckX = S.ports[deadParam].x;
    updateHud();
  }
  if (QS.get('flip') === '1') { S.flipLife = true; updateHud(); } // preview the earned extra life
  if (QS.get('quiz') === '1') S.quizT = 0.1; // preview the pop-quiz freeze immediately
  // Dev/testing only: ?end=lose|win jumps straight to the end card.
  // ?dead=N pre-kills port N so you can practice the walled-survivor endgame.
  if (QS.get('end') === 'lose') {
    for (const p of S.ports) { p.alive = false; p.stuckX = p.x; }
    S.elapsed = 12.3; S.enemies[0].tipY = contactTipY(); showEnd(false);
  } else if (QS.get('end') === 'win') {
    S.misses = cfg().missesToWin ?? 8; S.elapsed = 24.5; S.score = S.misses * SCORE.MISS; awardLevelClear(); showEnd(true);
  }
} else {
  showMenu();
}
updateHud();
scheduler = createFrameScheduler(frame);
scheduler.wake();
