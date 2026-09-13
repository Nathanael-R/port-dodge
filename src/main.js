import { createFrameScheduler, canvasSize } from './runtime.js';
import { drawUSBStick, drawUSBPort } from './usb-art.js';
import { createInput } from './input.js';
import { sfx, toggleMute, unlockAudio, suspendAudio } from './audio.js';
import { detectOS, osCopy } from './os.js';
import { LEVELS, buildEndlessRound, endlessClearBonus, SCORE } from './levels.js';
import { W, H, EDGE_Y, resolveStrike, hopSlot, levelWon, stepFree, createEnemy, stepEnemy, separateEnemies, botAxisFreeMulti, botSlotDirMulti, strikeLockout, absorbHit, applyDeadWalls, createBlocker, stepBlocker, pushOutOfZone, safestSlot } from './logic.js';
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
  result: null,
};
let transitionTimer;
let hudProgressKey;
const touchControls = document.getElementById("touch-controls");
const slotButtons = [...document.querySelectorAll("[data-slot]")];
const touchHint = document.getElementById("touch-hint");
let controlMode;
let controlSlot = -1;
const levelMarkers = [...document.querySelectorAll(".level-track > span")];

function cfg() { return S.customCfg || LEVELS[S.levelIdx]; }

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
  // one FSM per hand; extra hands stagger in and may tune the base params
  S.enemies = (c.hands || [{}]).map((h, i) => {
    const E = createEnemy(480 + (i === 0 ? 0 : (i % 2 ? 150 : -150)), h.startDelay ?? e.startDelay);
    E.ep = { ...e, ...h };
    E.sleeve = i === 0 ? '#31405f' : '#5f313d'; // second human wears a rust-red sleeve
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
function showMenu() {
  resetLevel(0);
  S.paused = false; S.mode = 'levels'; S.screen = 'menu'; hud.classList.add('hidden');
  const best = loadBest();
  show(`<div class="card menu-card flash">
    <div class="tag"><span class="status-dot"></span> SMALL PORT. BIG ATTITUDE.</div>
    <h1>Stay<br><em>unplugged.</em></h1>
    <p class="big">You're the USB port.<br>The human needs a connection. You need space.</p>
    <div class="btnrow"><button class="cta" data-act="start">Let's dodge <span>→</span></button><button class="ghost" data-act="endless">∞ Endless</button></div>
    <div class="menu-meta">5 levels of connection issues <span>•</span> ${best ? `Best endless: ${best.toLocaleString()}` : 'Zero cables attached'}</div>
    <div class="quick-guide"><span><b>01</b> Bait the hand</span><span><b>02</b> Wait for red</span><span><b>03</b> Get out of there</span></div>
  </div>`);
}
function showIntro() {
  S.screen = 'intro'; hud.classList.remove('hidden'); updateHud();
  const c = cfg();
  show(`<div class="card flash">
    <div class="tag">LEVEL ${c.id} OF ${LEVELS.length}</div>
    <h2>${c.name}</h2><p class="big">${c.sub}</p>
    <p>${c.movement === 'free' ? 'Free slide. Long telegraphs. One slow human.' : c.movement === 'slots' ? 'No more free sliding — you live in the glowing slots now. The hand is faster and sometimes double-jabs. Hop <b>before</b> the strike: mid-strike hops fizzle with a <b>TOO LATE!</b>' : c.id === 4 ? 'Two ports, one command — against TWO humans. A dead port becomes a wall, and both hands will hunt whoever is left.' : 'Two ports, one command. Lose one and its corpse blocks the survivor — keep dodging with the other.'}
    Survive <b>${c.time}s</b> or force <b>${c.missesToWin} misses</b>.</p>
    ${((c.hands || []).some(h => ((h.blackout ?? c.enemy.blackout) || 0) > 0)) ? `<p>⚡ Their crosshairs <b>cut out at random</b> — read the hand's drift, not the marker.</p>` : ''}
    ${c.blocker ? `<p>🚧 The humans barricade the edge${c.blocker.kind === 'slot' ? ' — one slot gets seized at a time' : ` in ${Math.round(c.blocker.frac * 100)}% chunks`} — clear the flashing outline before it goes solid.</p>` : ''}
    ${S.flipLife ? `<p>🎁 <b>FLIP-FLOP ACTIVE:</b> your ports hang upside-down — the first plug is on the house.</p>` : ''}
    <div class="btnrow"><button class="cta" data-act="play">DODGE!</button></div>
  </div>`);
}
function showEnd(win) {
  S.screen = win ? 'win' : 'lose';
  const c = cfg();
  if (S.mode === 'endless' && !win) return showEndlessGameOver();
  if (S.mode === 'endless' && win) { startNextRound(); return; } // safety: endless advances without cards
  const last = S.levelIdx === LEVELS.length - 1;
  const title = win ? (last ? 'YOU REMAIN UNPLUGGED' : 'DODGED!') : 'PLUGGED IN';
  const sub = win
    ? (last ? 'Five levels. Zero commitment. The humans are filing a bug report.' : `Connection avoided. Ready for the next human?${c.id === 3 ? ' FLIP-FLOP earned: your next plug is on the house.' : ''}`)
    : 'The human finally made a connection. Make it work harder next time.';
  show(`<div class="card result-card flash">
    <div class="result-icon ${win ? 'won' : 'lost'}" aria-hidden="true">${win ? '✓' : '×'}</div>
    <div class="tag">${win ? 'LEVEL CLEAR' : 'PORT LOST'} · LEVEL ${c.id}</div>
    <h2>${title}</h2><p class="big">${sub}</p>
    <div class="result-stats"><div><strong>${S.score.toLocaleString()}</strong><span>RUN SCORE</span></div><div><strong>${S.misses}</strong><span>DODGES</span></div><div><strong>${S.elapsed.toFixed(1)}<small>s</small></strong><span>SURVIVED</span></div></div>
    ${win ? `<p class="bonus">+${endlessClearBonus(S.levelIdx + 1)} level clear bonus</p>` : ''}
    <div class="btnrow">
      ${win && !last ? `<button class="cta" data-act="next">NEXT LEVEL →</button>` : ''}
      ${win && last ? `<button class="cta" data-act="menu">BACK TO MENU</button>` : ''}
      <button class="ghost" data-act="retry">↻ RETRY (R)</button>
      ${!win && S.levelIdx > 0 ? `<button class="ghost" data-act="menu">MENU</button>` : ''}
    </div></div>`);
}
function wireButtons() {
  overlay.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      sfx.ui();
      const a = b.dataset.act;
      if (a === 'start') { S.mode = 'levels'; S.flipLife = false; S.score = 0; resetLevel(0); snapshotScore(); showIntro(); }
      else if (a === 'play') { hide(); S.screen = 'playing'; S.banner = { str: 'DODGE!', sub: '', t: 0.9 }; }
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
    <div class="tag">♾️ ENDLESS MODE</div>
    <h2>HOW LONG CAN YOU STAY UNPLUGGED?</h2>
    <p class="big">All five challenges on repeat — free slide, slots, duo, two hands, blackout — meaner every round: faster hands, shorter telegraphs, extra hands, spreading barricades.</p>
    <ul class="howto">
      <li>Miss forced: <b>+${SCORE.MISS}</b> · near-miss: <b>+${SCORE.NEAR}</b> · round clear: <b>500+</b></li>
      <li>Every 3rd round clears a <b>⟲ FLIP-FLOP</b> extra life (if you don't hold one)</li>
      <li>Run ends when every port is plugged. Best score lives on this machine.</li>
    </ul>
    ${best > 0 ? `<p>BEST: <b>${best}</b> pts — beat it.</p>` : ''}
    <div class="btnrow"><button class="cta" data-act="endless-go">START RUN</button><button class="ghost" data-act="menu">MENU</button></div>
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
  const bo = c.enemy.blackout || 0;
  if (bo > 0) tags.push(`blackout ${Math.round(bo * 100)}%`);
  if (c.blocker) tags.push(c.blocker.kind === 'slot' ? 'seized slots' : 'barricades');
  if (c.enemy.doubles >= 0.4) tags.push('double-jabs');
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
  S.banner = { str: `ROUND ${S.round}`, sub: `${c.name}${tags ? ' — ' + tags : ''}`, t: 2.2 };
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
  else { S.score = S.scoreAtStart; resetLevel(S.levelIdx); S.screen = 'playing'; S.banner = { str: 'AGAIN!', sub: '', t: 0.8 }; }
}

function showEndlessGameOver() {
  S.screen = 'lose';
  const best = loadBest();
  const newBest = S.score > best;
  if (newBest) saveBest(S.score);
  show(`<div class="card flash">
    <div class="tag">RUN OVER — ROUND ${S.round}: ${cfg().name}</div>
    <h2>Finally connected.</h2>
    <p class="big">The humans finally got you.${newBest ? ' <b>NEW BEST!</b>' : ''}</p>
    <p>SCORE <b>${S.score}</b> · BEST <b>${Math.max(best, S.score)}</b> · reached round <b>${S.round}</b></p>
    <div class="btnrow">
      <button class="cta" data-act="retry">↻ NEW RUN (R)</button>
      <button class="ghost" data-act="menu">MENU</button>
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
  setText(elLevel, S.mode === 'endless' ? `R${S.round} · ${c.name}` : `${c.id} · ${c.name}`);
  setText(elScore, S.score.toLocaleString());
  const remain = Math.max(0, c.time - S.elapsed);
  setText(elTime, `${remain.toFixed(1)}s`);
  setText(elMiss, `${S.misses} / ${c.missesToWin}`);
  elMiss.title = `${S.misses}/${c.missesToWin} forced misses`;
  setText(elPorts, S.ports.map(p => p.alive ? '●' : '✕').join(' '));
  elPorts.style.color = S.ports.some(p => p.alive) ? '' : 'var(--warn)';
  if (elFlip) {
    elFlip.style.display = S.flipLife ? '' : 'none';
    elFlip.textContent = S.invuln > 0 ? '⟲ phased…' : '⟲ +1 FLIP';
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
      if (e === 'locked') { sfx.lock(); S.tickAcc = 0; }
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
      fx.text(victim.x, 300, 'FLIP SAVED YOU!', '#7bff9e', 30, 1.2);
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
      fx.text(480, 300, walled ? 'PORT LOST — IT BLOCKS YOU NOW!' : 'PORT LOST!', '#ff5470', walled ? 28 : 34, 1.2);
    }
  } else {
    S.misses++;
    S.score += outcome === 'near' ? SCORE.NEAR : SCORE.MISS;
    S.dents.push({ x: E.lockedX, t: 0 });
    if (outcome === 'near') {
      fx.text(E.lockedX, 300, `CLOSE!! +${SCORE.NEAR}`, '#7bff9e', 26, 1.0);
      sfx.nearMiss();
      if (!levelWon(S.elapsed, S.misses, c)) nearMissSlowMo.trigger();
      fx.addShake(7);
    } else {
      fx.text(E.lockedX, 310, `MISS! +${SCORE.MISS}`, '#4dd8ff', 22, 0.8);
      fx.addShake(6);
    }
    fx.sparks(E.lockedX, EDGE_Y + 8);
    S.flash = 0.18;
    sfx.clang();
    E.doubleQueued = Math.random() < e.doubles;
    if (levelWon(S.elapsed, S.misses, c)) {
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
    (i) => S.ports.some(p => p.alive && p.slot === i));
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
      fx.text(c.slots[B.slot], EDGE_Y - 64, 'EJECTED!', '#ffd166', 20, 0.8);
      sfx.deny();
    }
  }
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
    const denyHop = (reason) => {
      if (S.denyCd > 0) return;
      S.denyCd = 0.5;
      fx.text(p.x, EDGE_Y - 64, reason, '#ff5470', 19, 0.6);
      fx.burst(p.x, EDGE_Y - 10, 6, { colors: ['#ff5470', '#ffffff'], speed: 140, ttl: 0.3, size: 3 });
      sfx.deny();
    };
    let dir = 0;
    if (framePressed.has('arrowleft') || framePressed.has('a') || framePressed.has('q')) dir -= 1;
    if (framePressed.has('arrowright') || framePressed.has('d') || framePressed.has('e')) dir += 1;
    // number keys 1..5 direct
    for (let i = 0; i < c.slots.length; i++) {
      if (!framePressed.has(String(i + 1))) continue;
      if (locked) { denyHop('TOO LATE!'); continue; }
      if (i === seized) { denyHop('BLOCKED!'); continue; }
      if (i === p.slot) continue;
      p.slot = i; p.x = c.slots[i]; p.hopCd = c.player.hopCooldown;
      p.squash = 1; fx.poof(p.x, EDGE_Y); sfx.hop();
    }
    if (dir !== 0) {
      if (locked) denyHop('TOO LATE!');
      else if (p.hopCd <= 0) {
        const r = hopSlot(p.slot, dir, c.slots.length);
        if (r.moved) {
          if (r.index === seized) denyHop('BLOCKED!');
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
        if (locked) denyHop('TOO LATE!');
        else if (best === seized) denyHop('BLOCKED!');
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
    stepFree(S.center, axis, dt, c);
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
        fx.burst(wall ? wall.stuckX : S.center.x, EDGE_Y - 6, 6, { colors: ['#ffd166', '#ffffff'], speed: 150, ttl: 0.35, size: 3 });
        sfx.bump();
        S.bumpCd = 0.35;
      }
    } else {
      const p = S.ports[0];
      p.x = S.center.x; p.vx = S.center.vx;
      p.squash = Math.min(1, Math.abs(p.vx) / 560);
      if (S.blocker && S.blocker.phase === 'active' && c.blocker && c.blocker.kind === 'rail') {
        const r = pushOutOfZone(p.x, { x: S.blocker.x, w: S.blocker.w });
        if (r.moved) { p.x = r.x; S.center.x = r.x; }
      }
    }
  }
  // squash decay
  for (const p of S.ports) { p.squash = Math.max(0, (p.squash || 0) - dt * 4); if (p.vx) p.face = p.vx; }
}

// ---------- pause ----------
function togglePause() {
  if (S.screen !== 'playing' && !S.paused) return;
  S.paused = !S.paused;
  if (S.paused) { S.screen = 'paused';
    show(`<div class="card"><div class="tag">PAUSED</div><h2>Take a breath.</h2><p>The human can wait.</p><p>Move with A / D or ← / →, or drag the port.<br>In slot levels, tap a slot or press 1–5.<br>Wait for the red lock, then dodge before the strike.</p><div class="btnrow"><button class="cta" data-act="resume">RESUME</button></div></div>`);
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
  ctx.fillStyle = '#19221c'; ctx.fillRect(0, 0, W, H);
  ctx.translate(fx.shakeX, fx.shakeY);

  if (!stageBackdrop) {
    stageBackdrop = document.createElement('canvas'); stageBackdrop.width = W; stageBackdrop.height = H;
    const liveContext = ctx; ctx = stageBackdrop.getContext('2d');
  // desk background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#19221c'); bg.addColorStop(0.32, '#19221c'); bg.addColorStop(0.33, '#232f26'); bg.addColorStop(1, '#29362b');
  ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);
  // faint desk texture dots
  ctx.fillStyle = 'rgba(255,255,255,.03)';
  for (let x = 20; x < W; x += 48) for (let y = 220; y < H; y += 34) ctx.fillRect(x, y, 2, 2);

  drawLaptop();
    ctx = liveContext;
  }
  ctx.drawImage(stageBackdrop, 0, 0);
  if (S.screen === 'menu') {
    ctx.save(); ctx.translate(755, 200); ctx.scale(2.2, 2.2); ctx.translate(-480, -(EDGE_Y - 8)); drawPorts(); ctx.restore();
    ctx.save(); ctx.translate(755, 320); ctx.scale(1.65, 1.65); ctx.translate(-480, -330); drawEnemy(S.enemies[0]); ctx.restore();
    ctx.fillStyle = '#d6fa72'; ctx.font = '700 11px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('CONNECTION REFUSED.', 755, 90);
    ctx.restore(); return;
  }
  drawDents();
  if (cfg().movement === 'slots') drawSlots();
  drawBlocker();
  drawPorts();
  for (const E of S.enemies) drawEnemy(E);
  fx.draw(ctx);

  // telegraph reticle + aim line (on top)
  for (const E of S.enemies) drawTelegraph(E);

  // banner
  if (S.banner) {
    const a = Math.min(1, S.banner.t * 2);
    ctx.globalAlpha = a;
    ctx.font = '900 54px "Segoe UI",system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.strokeText(S.banner.str, W / 2, 300);
    ctx.fillStyle = '#fff'; ctx.fillText(S.banner.str, W / 2, 300);
    if (S.banner.sub) {
      ctx.font = '700 17px "Segoe UI",system-ui,sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeText(S.banner.sub, W / 2, 332);
      ctx.fillStyle = '#9beaff'; ctx.fillText(S.banner.sub, W / 2, 332);
    }
    ctx.globalAlpha = 1;
  }
  // red hit flash
  if (S.flash > 0) { ctx.fillStyle = `rgba(255,60,90,${S.flash * 0.35})`; ctx.fillRect(-20, -20, W + 40, H + 40); }

  // vignette
  if (!vignette) {
    vignette = ctx.createRadialGradient(W/2, H/2, 240, W/2, H/2, 560);
    vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.45)');
  }
  ctx.fillStyle = vignette; ctx.fillRect(-20, -20, W + 40, H + 40);
  ctx.restore();
}

function drawLaptop() {
  // slab
  const g = ctx.createLinearGradient(0, 0, 0, EDGE_Y);
  g.addColorStop(0, '#465247'); g.addColorStop(0.55, '#354136'); g.addColorStop(1, '#242e25');
  ctx.fillStyle = g;
  rr(0, -20, W, EDGE_Y + 20, 0); ctx.fill();
  // lid highlight
  ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(0, 8, W, 3);
  // brand dot + text
  ctx.fillStyle = '#4dd8ff'; ctx.font = '800 15px "Segoe UI",sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(flavor.brand, 24, 30);
  ctx.fillStyle = '#8b93b0'; ctx.font = '700 12px "Segoe UI",sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(flavor.sub, W - 24, 30);
  if (flavor.dot) { // mac traffic lights, because of course the laptop has them
    for (const [i, col] of ['#ff5f57', '#febc2e', '#28c840'].entries()) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(150 + i * 22, 26, 6, 0, Math.PI * 2); ctx.fill();
    }
  }
  // vent slits
  ctx.fillStyle = 'rgba(0,0,0,.4)';
  for (let x = 40; x < W - 40; x += 26) ctx.fillRect(x, EDGE_Y - 34, 12, 5);
  // edge line (the rail the port lives on) — tinted per OS
  ctx.fillStyle = '#05070d'; ctx.fillRect(0, EDGE_Y - 4, W, 12);
  const eg = ctx.createLinearGradient(0, 0, W, 0);
  eg.addColorStop(0, flavor.edge[0]); eg.addColorStop(0.5, '#ffffff'); eg.addColorStop(1, flavor.edge[1]);
  ctx.fillStyle = eg; ctx.fillRect(0, EDGE_Y + 7, W, 2);
}

function drawSlots() {
  const c = cfg();
  c.slots.forEach((sx, i) => {
    const occ = S.ports[0].slot === i;
    ctx.save();
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = occ ? '#4dd8ff' : 'rgba(139,147,176,.55)';
    ctx.globalAlpha = occ ? 1 : 0.7;
    rr(sx - 38, EDGE_Y - 22, 76, 34, 6); ctx.stroke();
    ctx.setLineDash([]);
    if (!occ) {
      ctx.fillStyle = 'rgba(139,147,176,.8)'; ctx.font = '800 12px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), sx, EDGE_Y + 34);
    }
    ctx.restore();
  });
}

function drawDents() {
  for (const d of S.dents) {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.ellipse(d.x, EDGE_Y + 8, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff9f1c';
    ctx.fillRect(d.x - 10, EDGE_Y + 5, 20, 2);
  }
}

// Territory denial visuals: flashing warning outline, then a solid barricade.
function drawBlocker() {
  const B = S.blocker, c = cfg();
  if (!B || B.phase === 'idle') return;
  const blink = B.phase === 'warn' ? (Math.floor(performance.now() / 150) % 2 === 0) : false;
  ctx.save();
  if (c.blocker.kind === 'rail') {
    const l = B.x - B.w / 2;
    if (B.phase === 'warn') {
      if (blink) {
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
        rr(l, EDGE_Y - 28, B.w, 40, 6); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffd166'; ctx.font = '900 20px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('!', B.x, EDGE_Y - 34);
      }
    } else {
      // striped construction barricade squatting on the edge
      ctx.fillStyle = '#5a1626'; rr(l, EDGE_Y - 28, B.w, 40, 6); ctx.fill();
      ctx.save();
      ctx.beginPath(); rr(l, EDGE_Y - 28, B.w, 40, 6); ctx.clip();
      ctx.fillStyle = '#ffd166';
      for (let sx = l - 40; sx < l + B.w + 40; sx += 24) {
        ctx.beginPath();
        ctx.moveTo(sx, EDGE_Y + 12); ctx.lineTo(sx + 14, EDGE_Y + 12);
        ctx.lineTo(sx + 2, EDGE_Y - 28); ctx.lineTo(sx - 12, EDGE_Y - 28);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = '#fff'; ctx.font = '900 13px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('NOPE', B.x, EDGE_Y - 32);
    }
  } else {
    // seized slot: warn flashes, solid paints a red X over the outline
    const sx = c.slots[B.slot];
    if (sx == null) { ctx.restore(); return; }
    if (B.phase === 'warn') {
      if (blink) {
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
        rr(sx - 38, EDGE_Y - 22, 76, 34, 6); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffd166'; ctx.font = '900 18px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('!', sx, EDGE_Y - 30);
      }
    } else {
      ctx.fillStyle = 'rgba(90,22,38,.85)'; rr(sx - 38, EDGE_Y - 22, 76, 34, 6); ctx.fill();
      ctx.strokeStyle = '#ff5470'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(sx - 22, EDGE_Y - 14); ctx.lineTo(sx + 22, EDGE_Y + 4);
      ctx.moveTo(sx + 22, EDGE_Y - 14); ctx.lineTo(sx - 22, EDGE_Y + 4); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPorts() {
  for (const p of S.ports) {
    const px = p.alive ? p.x : (p.stuckX ?? p.x);
    const py = EDGE_Y - 22;
    const sq = p.squash || 0;
    const wob = 1 + sq * 0.12, hob = 1 - sq * 0.08;
    // phase-out blink while invulnerable
    ctx.save();
    if (p.alive && S.invuln > 0 && Math.floor(S.invuln * 12) % 2 === 0) ctx.globalAlpha = 0.35;
    // FLIP-FLOP extra life: the whole port hangs upside-down (tongue on top,
    // face derpy) until it absorbs a plug
    const flipped = p.alive && S.flipLife;
    ctx.translate(px, py + p.h / 2);
    ctx.scale(wob, hob);
    if (flipped) ctx.rotate(Math.PI);
    ctx.translate(-px, -(py + p.h / 2));
    if (!p.alive) {
      // plugged: dead socket + stuck plug stub + cable.
      // The hanging cable is a WALL — survivors can't cross it (see applyDeadWalls),
      // so mark it with hazard chevrons on the laptop edge.
      drawUSBPort(ctx, px, py, p.w, p.h, false);
      ctx.fillStyle = '#c7cede'; ctx.fillRect(px - 20, py - 2, 40, 10); // stuck shell
      ctx.fillStyle = '#ff5470'; ctx.fillRect(px - 20, py + 8, 40, 12);
      ctx.strokeStyle = '#ff5470'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(px - 28, py - 12); ctx.lineTo(px + 28, py + p.h + 8);
      ctx.moveTo(px + 28, py - 12); ctx.lineTo(px - 28, py + p.h + 8); ctx.stroke();
      ctx.fillStyle = '#05070d'; ctx.fillRect(px - 6, py + p.h, 12, 44); // cable down = the wall
      ctx.fillStyle = '#ffd166'; // hazard chevrons on the edge
      for (const cx of [px - 30, px - 10, px + 10]) {
        ctx.beginPath();
        ctx.moveTo(cx, EDGE_Y + 4); ctx.lineTo(cx + 10, EDGE_Y + 4);
        ctx.lineTo(cx + 6, EDGE_Y + 9); ctx.lineTo(cx - 4, EDGE_Y + 9);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      continue;
    }
    drawUSBPort(ctx, px, py, p.w, p.h);
    const locking = S.enemies.some(E => E.state === 'lock');
    // Fixed eye sockets, directional pupils: curious at rest, wide-eyed at lock.
    const look = Math.max(-1.8, Math.min(1.8, (p.face || p.vx || 0) / 240));
    const eyeY = py + 10, radius = locking ? 5.2 : 4.8;
    for (const eyeX of [px - 9, px + 9]) {
      ctx.fillStyle = '#030c07';
      ctx.beginPath(); ctx.arc(eyeX, eyeY + .7, radius + .8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f3f5df';
      ctx.beginPath(); ctx.arc(eyeX, eyeY, radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#123322';
      ctx.beginPath(); ctx.arc(eyeX + look, eyeY + .4, locking ? 1.7 : 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(eyeX + look - .6, eyeY - .5, .8, 0, Math.PI * 2); ctx.fill();
    }
    // A small expression sits above the contacts without obscuring the hardware.
    ctx.strokeStyle = '#a7d3b2'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    ctx.beginPath();
    if (locking) {
      ctx.moveTo(px - 2, py + 15); ctx.quadraticCurveTo(px, py + 13, px + 2, py + 15);
    } else {
      ctx.moveTo(px - 2, py + 14); ctx.quadraticCurveTo(px, py + 16, px + 2, py + 14);
    }
    ctx.stroke();
    // "YOU" tag + flip-life badge stay upright even when the port hangs upside-down
    ctx.restore();
    if (p.alive) {
      ctx.fillStyle = '#d6fa72'; ctx.font = '900 11px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(flipped ? '⟲ YOU ⟲' : '◀ YOU ▶', px, py - 8);
    }
  }
}

function drawEnemy(E) {
  const c = cfg();
  const ep = E.ep || c.enemy;
  const plugW = ep.plugW, plugH = 64;
  const tipX = E.x, tipY = E.tipY;
  const urgency = E.state === 'lock' ? (1 - E.t / ep.lockTime) : 0;

  ctx.save();
  // cable (thick, from bottom of screen up into the fist)
  const handY = tipY + 44;
  ctx.strokeStyle = '#05070d'; ctx.lineWidth = 22; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(tipX + 46, H + 20); ctx.quadraticCurveTo(tipX + 40, handY + 190, tipX + 6, handY + 110); ctx.stroke();
  ctx.strokeStyle = '#232a44'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(tipX + 46, H + 20); ctx.quadraticCurveTo(tipX + 40, handY + 190, tipX + 6, handY + 110); ctx.stroke();

  const trem = E.state === 'lock' && !motionPreference.matches ? Math.sin(performance.now() / 30) * (2 + urgency * 4) : 0;
  const hx = tipX + trem;

  // --- hand (big threatening mitt gripping the plug; sleeve exits frame bottom) ---
  ctx.fillStyle = '#caa07a'; // wrist
  ctx.fillRect(hx - 62, handY + 78, 124, 60);
  ctx.fillStyle = E.sleeve || '#31405f'; ctx.fillRect(hx - 62, handY + 118, 124, 60);
  const skin = E.state === 'strike' || E.state === 'impact' ? '#e8b88a' : '#dfa878';
  const fist = (fw, fh) => { rr(hx - fw/2, handY, fw, fh, 26); ctx.fill(); };
  ctx.fillStyle = skin;
  fist(124, 96); // palm
  // fingers wrapped around plug
  rr(hx - 66, handY + 6, 26, 70, 12); ctx.fill();
  rr(hx + 40, handY + 6, 26, 70, 12); ctx.fill();
  // thumb
  ctx.save(); ctx.translate(hx - 52, handY + 30); ctx.rotate(-0.5);
  rr(-14, -34, 30, 66, 14); ctx.fill(); ctx.restore();
  // knuckle shading + finger grooves
  ctx.fillStyle = 'rgba(120,70,40,.35)';
  for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(hx + i * 30, handY + 18, 5, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = 'rgba(120,70,40,.5)'; ctx.lineWidth = 3;
  for (const gx of [hx - 15, hx + 15]) {
    ctx.beginPath(); ctx.moveTo(gx, handY + 34); ctx.lineTo(gx, handY + 88); ctx.stroke();
  }

  // --- USB-A plug pointing UP at the laptop ---
  const pw = plugW, ph = plugH;
  const py = tipY;
  // speed lines on strike (at the sides so the fist stays readable)
  if (E.state === 'strike') {
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 3;
    for (const sx of [hx - pw / 2 - 22, hx + pw / 2 + 22]) {
      ctx.beginPath(); ctx.moveTo(sx, py + ph + 120); ctx.lineTo(sx, py + ph + 40); ctx.stroke();
    }
  }
  drawUSBStick(ctx, hx, py, pw, E.sleeve === '#5f313d' ? '#ed9b83' : '#d6fa72');

  // angry brows on the fist? no — keep readable. Danger ring instead:
  if (E.state === 'track') {
    ctx.strokeStyle = 'rgba(255,209,102,.7)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(hx, tipY + 30, 56, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawTelegraph(E) {
  if (!E || (E.state !== 'lock' && E.state !== 'strike')) return;
  if (E.state === 'lock' && E.blackout) return; // crosshair cut out — read the hand, not the marker
  const tx = E.lockedX;
  const pulse = motionPreference.matches ? 0.5 : 0.5 + 0.5 * Math.sin(performance.now() / 90);
  if (E.state === 'lock') {
    // dotted aim line plug -> target
    ctx.save();
    ctx.strokeStyle = `rgba(255,84,112,${0.45 + pulse * 0.4})`;
    ctx.lineWidth = 3; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(E.x, E.tipY - 6); ctx.lineTo(tx, EDGE_Y - 26); ctx.stroke();
    ctx.setLineDash([]);
    // reticle on the edge
    ctx.strokeStyle = '#ff5470'; ctx.lineWidth = 3;
    const r = 26 + pulse * 8;
    ctx.beginPath(); ctx.arc(tx, EDGE_Y - 8, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx - r - 8, EDGE_Y - 8); ctx.lineTo(tx - r + 4, EDGE_Y - 8);
    ctx.moveTo(tx + r - 4, EDGE_Y - 8); ctx.lineTo(tx + r + 8, EDGE_Y - 8); ctx.stroke();
    ctx.fillStyle = '#ff5470'; ctx.font = '900 20px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('▼', tx, EDGE_Y - 44 - pulse * 6);
    ctx.restore();
  } else {
    // strike: solid fast line
    ctx.save();
    ctx.strokeStyle = 'rgba(255,84,112,.9)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(E.x, E.tipY - 6); ctx.lineTo(tx, EDGE_Y - 10); ctx.stroke();
    ctx.restore();
  }
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
      const seized = (S.blocker && S.blocker.phase !== 'idle' && c.blocker.kind === 'slot') ? S.blocker.slot : -1;
      const dir = botSlotDirMulti(p.slot, c.slots, threats, seized);
      if (dir < 0) framePressed.add('arrowleft');
      else if (dir > 0) framePressed.add('arrowright');
    }
    return;
  }
  const zone = (S.blocker && S.blocker.phase === 'active' && c.blocker.kind === 'rail')
    ? { x: S.blocker.x, w: S.blocker.w } : null;
  input.state.axis = botAxisFreeMulti(p.x, threats, c.rail, zone);
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
  if (dt > 0) {
    S.elapsed += dt;
    S.invuln = Math.max(0, S.invuln - dt);
    if (BOT) botDrive();
    if (S.banner) { S.banner.t -= dt; if (S.banner.t <= 0) S.banner = null; }
    S.flash = Math.max(0, S.flash - dt * 2.2);
    playerUpdate(dt);
    blockerUpdate(dt);
    enemyUpdate(dt);
    if (levelWon(S.elapsed, S.misses, cfg()) && S.screen === 'playing') {
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
  S.banner = { str: 'DODGE!', sub: '', t: 0.9 };
  hud.classList.remove('hidden');
  const deadParam = parseInt(QS.get('dead') || '-1', 10);
  if (deadParam >= 0 && S.ports[deadParam]) {
    S.ports[deadParam].alive = false;
    S.ports[deadParam].stuckX = S.ports[deadParam].x;
    updateHud();
  }
  if (QS.get('flip') === '1') { S.flipLife = true; updateHud(); } // preview the earned extra life
  // Dev/testing only: ?end=lose|win jumps straight to the end card.
  // ?dead=N pre-kills port N so you can practice the walled-survivor endgame.
  if (QS.get('end') === 'lose') {
    for (const p of S.ports) { p.alive = false; p.stuckX = p.x; }
    S.elapsed = 12.3; S.enemies[0].tipY = contactTipY(); showEnd(false);
  } else if (QS.get('end') === 'win') {
    S.misses = cfg().missesToWin; S.elapsed = 24.5; S.score = S.misses * SCORE.MISS; awardLevelClear(); showEnd(true);
  }
} else {
  showMenu();
}
updateHud();
scheduler = createFrameScheduler(frame);
scheduler.wake();
