import { createInput } from './input.js';
import { sfx, toggleMute, isMuted } from './audio.js';
import { detectOS, osCopy } from './os.js';
import { LEVELS } from './levels.js';
import { W, H, EDGE_Y, resolveStrike, hopSlot, levelWon, stepFree, createEnemy, stepEnemy, separateEnemies, botAxisFreeMulti, botSlotDirMulti, strikeLockout, absorbHit, applyDeadWalls, createBlocker, stepBlocker, pushOutOfZone, safestSlot } from './logic.js';
import { createFX } from './fx.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const elLevel = document.getElementById('hud-level');
const elTime = document.getElementById('hud-time');
const elMiss = document.getElementById('hud-miss');
const elPorts = document.getElementById('hud-ports');

const input = createInput(canvas);
const fx = createFX();

// OS flavor: real detection with a preview override (?os=mac|windows|linux).
// Drives the laptop art, footer joke, and CSS theme via body[data-os].
let OS = 'other';
let flavor = osCopy(OS);

// ---------- game state ----------
const S = {
  screen: 'menu', // menu | intro | playing | win | lose | done | paused(from)
  paused: false,
  levelIdx: 0,
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
  invuln: 0,       // phase-out timer granted when the flip-life is consumed
  blocker: null,   // territory denial: {phase, t, x, w, slot} or null when level has none
  result: null,
};
let prePause = 'playing';

function cfg() { return LEVELS[S.levelIdx]; }

// ---------- setup ----------
function resetLevel(idx) {
  S.levelIdx = idx;
  const c = cfg();
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
function show(html) { overlay.innerHTML = html; overlay.style.pointerEvents = 'auto'; overlay.classList.add('dim'); wireButtons(); }
function hide() { overlay.innerHTML = ''; overlay.style.pointerEvents = 'none'; overlay.classList.remove('dim'); }

function showMenu() {
  S.screen = 'menu'; hud.classList.add('hidden');
  show(`<div class="card flash">
    <div class="tag">PLAYABLE PROTOTYPE</div>
    <h1>USB <em>DODGE</em></h1>
    <p class="big">You are a USB port. A human hand is trying to plug into you. Be somewhere else.</p>
    <ul class="howto">
      <li><span class="kbd">A</span><span class="kbd">D</span> or <span class="kbd">←</span><span class="kbd">→</span> — slide along the laptop edge (drag works too)</li>
      <li>Level 2: hop between glowing slots with <span class="kbd">←</span><span class="kbd">→</span> / tap</li>
      <li>Red marker + rising tick = attack incoming. It <b>locks</b> — then it can't steer. Trick it.</li>
      <li>Later humans fight dirty: crosshairs cut out, and chunks of the edge get barricaded.</li>
      <li>Survive the timer or force enough misses. One clean insertion = game over.</li>
    </ul>
    <div class="btnrow"><button class="cta" data-act="start">START LEVEL 1</button></div>
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
  const last = S.levelIdx === LEVELS.length - 1;
  const c = cfg();
  const title = win ? (last ? 'YOU REMAIN UNPLUGGED' : 'DODGED!') : 'PLUGGED IN';
  const sub = win
    ? (last ? `You survived all ${LEVELS.length} prototype levels with ${S.misses} forced misses on the final. The humans are filing a bug report.` : `Level ${c.id} cleared — ${S.misses} misses forced in ${S.elapsed.toFixed(1)}s.${c.id === 3 ? ' 🎁 <b>FLIP-FLOP EARNED:</b> an upside-down extra life for what comes next!' : ''}`)
    : `The human got you after ${S.elapsed.toFixed(1)}s. It is updating its firmware out of spite.`;
  show(`<div class="card flash">
    <div class="tag">${win ? 'LEVEL CLEAR' : 'PORT LOST'} — LEVEL ${c.id}: ${c.name}</div>
    <h2>${title}</h2><p class="big">${sub}</p>
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
      if (a === 'start') { S.flipLife = false; resetLevel(0); showIntro(); }
      else if (a === 'play') { hide(); S.screen = 'playing'; S.banner = { str: 'DODGE!', sub: '', t: 0.9 }; }
      else if (a === 'retry') { hide(); resetLevel(S.levelIdx); S.screen = 'playing'; S.banner = { str: 'AGAIN!', sub: '', t: 0.8 }; }
      else if (a === 'next') {
        if (S.levelIdx === 2) S.flipLife = true; // cleared all three: FLIP-FLOP earned!
        resetLevel(S.levelIdx + 1); showIntro();
      }
      else if (a === 'menu') showMenu();
    };
  });
}

// ---------- HUD ----------
function updateHud() {
  const c = cfg();
  elLevel.textContent = `${c.id} · ${c.name}`;
  const remain = Math.max(0, c.time - S.elapsed);
  elTime.textContent = `${remain.toFixed(1)}s`;
  elMiss.textContent = `${'●'.repeat(S.misses)}${'○'.repeat(Math.max(0, c.missesToWin - S.misses))}`;
  elMiss.title = `${S.misses}/${c.missesToWin} forced misses`;
  elPorts.textContent = S.ports.map(p => p.alive ? '●' : '✕').join(' ');
  elPorts.style.color = S.ports.some(p => p.alive) ? '' : 'var(--warn)';
  const elFlip = document.getElementById('hud-flip');
  if (elFlip) {
    elFlip.style.display = S.flipLife ? '' : 'none';
    elFlip.textContent = S.invuln > 0 ? '⟲ phased…' : '⟲ +1 FLIP';
  }
  const fill = document.getElementById('timefill');
  if (fill) {
    const frac = Math.max(0, Math.min(1, remain / c.time));
    fill.style.width = `${frac * 100}%`;
    fill.classList.toggle('low', remain < 6 && S.screen === 'playing');
  }
}

// ---------- enemy FSM (logic in logic.js; here: visuals + sound + consequences) ----------
// Every hand runs its own FSM and independently hunts the nearest living port —
// so when a port dies, ALL remaining hands converge on the survivor.
function enemyUpdate(dt) {
  const c = cfg();
  for (const E of S.enemies) {
    const alivePorts = S.ports.filter(p => p.alive);
    // a hand with nothing left to hunt just loiters where it is
    const focus = alivePorts.length
      ? alivePorts.reduce((a, b) => Math.abs(a.x - E.x) < Math.abs(b.x - E.x) ? a : b)
      : { x: E.x, vx: 0 };

    const ev = stepEnemy(E, dt, { x: focus.x, v: focus.vx || 0 }, c);
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
      setTimeout(() => showEnd(false), 650);
      S.screen = 'lose-pending';
    } else {
      const walled = cfg().movement === 'duo';
      fx.text(480, 300, walled ? 'PORT LOST — IT BLOCKS YOU NOW!' : 'PORT LOST!', '#ff5470', walled ? 28 : 34, 1.2);
    }
  } else {
    S.misses++;
    S.dents.push({ x: E.lockedX, t: 0 });
    if (outcome === 'near') {
      fx.text(E.lockedX, 300, 'CLOSE!! +miss', '#7bff9e', 26, 1.0);
      sfx.nearMiss();
      fx.stop(0.06); fx.addShake(7);
    } else {
      fx.text(E.lockedX, 310, 'MISS!', '#4dd8ff', 22, 0.8);
      fx.addShake(6);
    }
    fx.sparks(E.lockedX, EDGE_Y + 8);
    S.flash = 0.18;
    sfx.clang();
    E.doubleQueued = Math.random() < e.doubles;
    if (levelWon(S.elapsed, S.misses, c)) {
      sfx.win();
      S.screen = 'win-pending';
      setTimeout(() => showEnd(true), 600);
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
  input.consume(framePressed);
  S.bumpCd = Math.max(0, S.bumpCd - dt);

  // global keys
  if (framePressed.has('m')) { const m = toggleMute(); document.getElementById('btn-mute').classList.toggle('muted', m); }
  if (framePressed.has('p') || framePressed.has('escape')) togglePause();
  if (framePressed.has('r') && (S.screen === 'playing')) { resetLevel(S.levelIdx); S.banner = { str: 'RESET', sub: '', t: 0.6 }; }

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
    if (input.state.pointerActive && input.state.pointerX != null && p.hopCd <= 0) {
      let best = 0, bd = Infinity;
      c.slots.forEach((sx, i) => { const d = Math.abs(sx - input.state.pointerX); if (d < bd) { bd = d; best = i; } });
      if (bd < 90) {
        if (locked) denyHop('TOO LATE!');
        else if (best === seized) denyHop('BLOCKED!');
        else if (best !== p.slot) { p.slot = best; p.x = c.slots[best]; p.hopCd = c.player.hopCooldown; p.squash = 1; fx.poof(p.x, EDGE_Y); sfx.hop(); }
        input.state.pointerX = null; input.state.pointerActive = false;
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
    const tmp = { x: S.center.x, vx: S.center.vx };
    stepFree(tmp, axis, dt, { player: c.player, rail: c.rail });
    S.center.x = tmp.x; S.center.vx = tmp.vx;
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
  if (S.paused) { prePause = S.screen; S.screen = 'paused';
    show(`<div class="card"><div class="tag">PAUSED</div><h2>Take a breath.</h2><p>The human waits. It is patient. It is wrong.</p><div class="btnrow"><button class="cta" data-act="resume">RESUME</button></div></div>`);
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
  ctx.clearRect(0, 0, W, H);
  ctx.translate(fx.shakeX, fx.shakeY);

  // desk background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a0d16'); bg.addColorStop(0.32, '#0a0d16'); bg.addColorStop(0.33, '#131828'); bg.addColorStop(1, '#1a2033');
  ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);
  // faint desk texture dots
  ctx.fillStyle = 'rgba(255,255,255,.03)';
  for (let x = 20; x < W; x += 48) for (let y = 220; y < H; y += 34) ctx.fillRect(x, y, 2, 2);

  drawLaptop();
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
    ctx.globalAlpha = 1;
  }
  // red hit flash
  if (S.flash > 0) { ctx.fillStyle = `rgba(255,60,90,${S.flash * 0.35})`; ctx.fillRect(-20, -20, W + 40, H + 40); }

  // vignette
  const v = ctx.createRadialGradient(W/2, H/2, 240, W/2, H/2, 560);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = v; ctx.fillRect(-20, -20, W + 40, H + 40);
  ctx.restore();
}

function drawLaptop() {
  // slab
  const g = ctx.createLinearGradient(0, 0, 0, EDGE_Y);
  g.addColorStop(0, '#2b3350'); g.addColorStop(0.55, '#1c2338'); g.addColorStop(1, '#141a2c');
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
      ctx.fillStyle = '#10141f'; rr(px - 34, py, 68, p.h, 4); ctx.fill();
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
    const danger = S.enemies.some(E => E.state === 'lock' || E.state === 'strike');
    const glow = danger ? 1 : 0.55;
    ctx.shadowColor = '#4dd8ff'; ctx.shadowBlur = 14 * glow;
    ctx.fillStyle = '#0d1322'; rr(px - 35, py - 2, 70, p.h + 4, 5); ctx.fill();
    ctx.shadowBlur = 0;
    // metal shell
    const mg = ctx.createLinearGradient(0, py, 0, py + p.h);
    mg.addColorStop(0, '#dfe6fa'); mg.addColorStop(0.5, '#9aa5c4'); mg.addColorStop(1, '#5d6784');
    ctx.fillStyle = mg; rr(px - 33, py, 66, p.h, 4); ctx.fill();
    ctx.fillStyle = '#20263c'; rr(px - 29, py + 4, 58, p.h - 8, 3); ctx.fill();
    // blue tongue = "this is you"
    ctx.fillStyle = '#1f6feb'; rr(px - 26, py + p.h - 12, 52, 7, 2); ctx.fill();
    ctx.fillStyle = '#4dd8ff'; rr(px - 26, py + p.h - 12, 52, 2.5, 1); ctx.fill();
    // eyes 👀 — the joke lands visually, restrained
    const look = Math.max(-6, Math.min(6, (p.face || p.vx || 0) / 80));
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px - 10 + look, py + 9, 6, 0, Math.PI * 2); ctx.arc(px + 10 + look, py + 9, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0e18';
    const locking = S.enemies.some(E => E.state === 'lock');
    const fear = locking ? 1.6 : 2.4;
    ctx.beginPath(); ctx.arc(px - 10 + look * 1.6, py + 9.5, fear, 0, Math.PI * 2); ctx.arc(px + 10 + look * 1.6, py + 9.5, fear, 0, Math.PI * 2); ctx.fill();
    if (locking) { // worried mouth
      ctx.strokeStyle = '#0b0e18'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py + 18, 5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    }
    // "YOU" tag + flip-life badge stay upright even when the port hangs upside-down
    ctx.restore();
    if (p.alive) {
      ctx.fillStyle = '#4dd8ff'; ctx.font = '900 11px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
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

  const trem = E.state === 'lock' ? Math.sin(performance.now() / 30) * (2 + urgency * 4) : 0;
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
  const px = hx - pw / 2, py = tipY;
  // speed lines on strike (at the sides so the fist stays readable)
  if (E.state === 'strike') {
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 3;
    for (const sx of [hx - pw / 2 - 22, hx + pw / 2 + 22]) {
      ctx.beginPath(); ctx.moveTo(sx, py + ph + 120); ctx.lineTo(sx, py + ph + 40); ctx.stroke();
    }
  }
  const sg = ctx.createLinearGradient(px, 0, px + pw, 0);
  sg.addColorStop(0, '#8d97b5'); sg.addColorStop(0.5, '#e8edff'); sg.addColorStop(1, '#8d97b5');
  ctx.fillStyle = sg; rr(px, py, pw, ph, 4); ctx.fill();
  ctx.fillStyle = '#11141f'; ctx.fillRect(px + 5, py + 4, pw - 10, 20); // dark mouth
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(px + 5, py + 24, pw - 10, 3); ctx.fillRect(px + 5, py + 40, pw - 10, 3);
  // USB trident logo-ish mark
  ctx.fillStyle = '#2b3350'; ctx.font = '900 13px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('⛛', hx, py + 56);
  // grip
  ctx.fillStyle = E.sleeve || '#31405f'; rr(hx - pw/2 - 8, py + ph - 6, pw + 16, 26, 6); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(hx - pw/2 - 8, py + ph - 6, pw + 16, 4);

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
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
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
let last = performance.now();
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

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.033, (now - last) / 1000) * SPEED;
  last = now;
  if (S.screen !== 'playing' || S.paused) { draw(); return; }

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
      sfx.win(); S.screen = 'win-pending';
      setTimeout(() => { if (S.screen === 'win-pending') showEnd(true); }, 500);
    }
    if (S.elapsed >= cfg().time - 3 && !S.warned) { /* last-seconds tension could tick here */ }
    updateHud();
    // lose-pending / win-pending: keep rendering, freeze logic transitions only via screen flag
    if (S.screen === 'playing') draw();
    else draw();
  } else {
    draw(); // frozen hitstop frame still renders shake
  }
  framePressed.clear();
}

// ---------- chrome ----------
document.getElementById('btn-mute').onclick = (e) => {
  const m = toggleMute(); e.currentTarget.classList.toggle('muted', m); sfx.ui();
};
document.getElementById('btn-help').onclick = () => showMenu();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.screen === 'playing' && !S.paused) togglePause();
});
window.addEventListener('pointerdown', () => { if (S.screen === 'playing' && S.paused) togglePause(); }, { once: true });

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
resetLevel(0);
const startLevel = Math.max(1, Math.min(LEVELS.length, parseInt(QS.get('level') || '1', 10))) - 1;
if (QS.get('play') === '1' || BOT) {
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
    S.misses = cfg().missesToWin; S.elapsed = 24.5; showEnd(true);
  }
} else {
  showMenu();
}
updateHud();
requestAnimationFrame(frame);
