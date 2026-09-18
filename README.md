# USB DODGE 🔌💨

**You are a USB port. A human hand is trying to plug into you. Be somewhere else.**

A tiny arcade prototype answering one question: *is it fun to be a USB port
desperately dodging a human trying to plug something into you?*

## Run it

No build step, no dependencies — just serve the folder statically:

```bash
npm run serve        # or: python -m http.server 8099
# open http://localhost:8099
```

Run the logic + balance tests:

```bash
npm test             # node --test tests/
```

## Controls

| Input | Action |
|---|---|
| `A`/`D` or `←`/`→` | slide along the laptop edge (levels 1 & 3), hop between slots (level 2) |
| `1`–`5` | jump directly to a slot (level 2) |
| mouse / touch drag | slide (free levels) · tap a slot (level 2) |
| `Space`/`Enter` | confirm · retry (`R` also retries) |
| `P` / `Esc` | pause · `M` mute |

## The game

Side view of a laptop edge. A giant hand grips a USB plug and lunges at you
with a readable cycle: **track → lock (red telegraph) → strike → recover**.
The strike always lands exactly where it was telegraphed — so every hit is
your fault and every dodge feels like you tricked the human.

Levels 1–3 can also be won early by forcing enough misses; **from level 4 on
the timer is the only exit**, so dodges score points but survival is what
advances you. Lose a level when all your ports get plugged.

| Level | Twist |
|---|---|
| 1 · First Boot | free sliding, one slow human, long telegraphs |
| 2 · Cornered | no more sliding — teleport between 5 slots; faster hand, occasional double-jabs, and **no panic-hops**: teleports fizzle while a strike is in flight (`TOO LATE!`), so dodges must be committed during the telegraph |
| 3 · Double Trouble | two ports, one shared command — a dead port's cable becomes a **wall** the survivor can't cross. **Clearing it earns the FLIP-FLOP extra life.** |
| 4 · Two Hands | two ports vs **two humans** — survive **25s**. Lose one port and *both* hands hunt the survivor, now cornered by its partner's corpse. Your ports hang **upside-down**: the first plug is absorbed (`FLIP SAVED YOU!`) plus 1s of phase-out. Humans also **barricade 20% of the edge** in striped `NOPE` zones |
| 5 · Blackout | back to one port in the slots — survive **40s**, but the hand's **crosshair cuts out at random** (read the fist's drift, not the marker), and **one slot at a time gets seized** (flashing `!` warning, then red `✕`; campers get `EJECTED!` to the safest free slot) |
| 6 · Crowded Edge | two slots come **pre-sealed** by stuck plugs (always leaving a connected triple), and the lone hunter **accelerates every strike** (track ×1.05, lock ×0.96, capped) — end it quickly |
| 7 · Pop Quiz | time **freezes** and every plug creeps toward the port you're on — answer the procedurally generated math (**+−×**, infinite variety) to unfreeze for **+50**. Wrong or timeout earns every hand a point-blank 0.35s lock |
| 8 · Seal Team | **free slide** — the edge gets sealed in chunks over time, so your lane **shrinks**. Every 3rd **CLOSE!!** dodge reclaims the newest chunk. Tight dodges are the economy |

## ♾️ Endless mode

Eight levels not enough? **ENDLESS** (menu button) cycles all eight archetypes
on repeat, interleaved so the movement modes stay balanced (free → cornered
→ crowded edge → double trouble → pop quiz → two hands → blackout → seal team),
with continuous scaling every round. Every round is a flat **25s survival
sprint: only the timer moves you on**, dodges just score. The headless sims
clear three full cycles (rounds 1–24); note they hold double-jabs off for the
balance pass, so with the random double-jabs live the late rounds get genuinely
dicey — endless is meant to end your run eventually.

- faster hands (capped +60%, and never faster than the port), shorter
  telegraphs (floor 0.42s), more double-jabs (cap 0.45) and blackouts (cap 0.5),
  fatter plugs (cap 70px)
- extra hands join later in a run (a second at round 17, a third at round 33;
  max 3 free / 2 slots), barricades spread to every archetype from round 17

Scoring (both modes): **+100** per forced miss, **+150** per near-miss,
floating `+100` text on every dodge, clear bonus **500 + 100 per
level/round** shown on victory cards. Retrying a level rolls score back to
where the attempt started (no farming your own corpse). In endless, every 3rd
round tops up a ⟲ FLIP-FLOP (or +250 if held). Death ends
the run — best score persists in `localStorage`. No accounts, no backend,
survives private mode (best just won't stick).

Game feel: anticipation raise before strikes, screen shake, hit-stop,
sparks, near-miss callouts, squash on the port, procedural WebAudio
bleeps/clangs (no audio assets). HUD shows a live time bar (pulsing red
under 6s) and miss pips; cards dim the stage behind them.

## OS flavor

The game sniffs your OS (`src/os.js`: `userAgentData.platform` with UA
fallback) and reskins around it — parody hardware on the laptop lid, edge
glow tint, page accent + corner radius, footer one-liner:

| OS | Laptop | Accent |
|---|---|---|
| mac | ◉ MacLap Pro + traffic lights, "USB-C only · dongles sold separately" | ice blue, extra round, cards get traffic lights |
| windows | ▦ WinLap 11, "have you tried turning it off and on again" | fluent blue, squarer |
| linux | `$ penglap — btw`, "i use arch btw · sudo dodge" | terminal green, mono keycaps |

Preview any flavor with `?os=mac|windows|linux`.

## Architecture (KISS)

```
index.html   canvas + HUD/menu overlay shell
style.css    all styling (DOM UI only; game art is canvas-drawn)
src/
  main.js    game loop, state machine, enemy visuals, all canvas rendering
  logic.js   PURE gameplay: physics, enemy FSM, hand separation, dead-port
           walls, collision, bot policy (unit-tested)
  levels.js  data-driven level configs (tuning lives here, incl. per-hand overrides)
  input.js   keyboard + pointer
  audio.js   tiny WebAudio synth, no assets
  fx.js      particles, floating text, shake, hit-stop
tests/
  logic.test.mjs   collisions, slots, win/lose, physics, FSM order
  sim.test.mjs     headless full-level playthroughs: bot wins all 8 levels and
                   three full endless cycles, standing still loses, strikes
                   can't re-steer, corpse-walls hold for entire levels, hands
                   keep lanes without breaking locks, blackouts are beatable on
                   body language alone, blockers cycle warn -> solid -> release
                   with ejection, seals/quiz/ramp resolve cleanly
```

Key decisions:

- **Vanilla JS + Canvas 2D, zero dependencies.** No engine, no build, no assets.
  The whole game is one mechanic + one enemy; Phaser/Godot would add weight
  and iteration friction for nothing. Pure `logic.js` (no DOM) makes the
  interesting parts (`stepEnemy`, `resolveStrike`, win/lose) testable in Node.
- **Ports are an array from level 1**, even though level 1 uses one — so
  multi-port modes (level 3's shared-command duo) drop in without rewrites.
  Other control modes (port-switching, split controls) are natural next
  experiments on the same seam.
- **Commitment over tracking.** The hand pursues with capped speed, then
  *locks* a predicted target and cannot re-steer — dodging = tricking,
  proven by the `attack commitment` test.
- **Corpses are walls.** A plugged port keeps its `stuckX`; `applyDeadWalls`
  clamps survivors to their side of it (72px gap), with hazard chevrons on
  the edge plus spark + thunk bump feedback. Dying literally shrinks the arena.
- **Hands are an array, not a singleton.** Each runs its own FSM from
  `levels.js` `hands[]` overrides (stagger, speed, telegraph), hunts the
  nearest living port independently (so deaths cascade targeting for free),
  and `separateEnemies` keeps uncommitted hands in separate lanes without
  ever touching a locked strike.
- **Teleport lockout beats last-second gaming.** In slots mode, `strikeLockout`
  denies hops while any strike is in flight — the exploit (wait for commitment,
  then teleport for free) fizzles with `TOO LATE!` + buzz. Scoped to teleport
  only: free movement is continuous velocity, so no such exploit exists there.
- **FLIP-FLOP extra life.** Clearing level 3 sets a one-shot shield for level 4;
  `absorbHit` resolves lethal plugs as ignored (phase-out) / shielded (consume
  + 1s invuln) / dead. Held shield renders every alive port upside-down —
  tongue on top, derpy flipped face, `⟲ YOU ⟲` tags, HUD `⟲ +1 FLIP` pill.
- **Blackouts: the UI lies, the body doesn't.** Each lock rolls `enemy.blackout`;
  on a hit the reticle/aim-line/▼ are simply not drawn. The hand still drifts
  to its target, the ticks still tick, the ports still make their worried face —
  so the attack stays dodgeable. The autopilot (and sim) dodge blackouts using
  fist position only, which is exactly the proof a human can too.
- **Territory denial, both movement modes.** Pure `createBlocker`/`stepBlocker`
  cycle (idle → flashing `!` warn → solid → release): rail zones shove free-roam
  ports out via `pushOutOfZone` (never damage), slot seizures deny hops with
  `BLOCKED!` and `EJECTED!`-bounce campers to the `safestSlot`. All data-driven
  from `levels.js` (`L4: rail 20%`, `L5: 1 slot`).
- **Hidden testing seams** (not part of the game UI): `?play=1&level=N`
  jump-straight-in, `?bot=1` autopilot, `?speed=N` fast-forward,
  `?end=lose|win` end-card preview, `?dead=N` pre-killed port (practice the
  walled-survivor endgame), `?flip=1` preview the earned extra life,
  `?os=mac|windows|linux` preview an OS flavor,
  `?endless=1&round=N` jump into an endless run (`&bot=1&speed=M` works too).

## Deliberately left out

Multiplayer, leaderboards, accounts, cosmetics, achievements, settings
screens, progression trees, mobile layout polish, asset pipeline, backend —
and extra enemy types (second hand, USB-C speedster). The seams exist
(`levels.js` enemy block, `S.ports` array, `stepEnemy` FSM) when the fun is
proven and any of those earn their place.

## Next mechanics worth exploring

1. Port-switching / split controls for multi-port play (vs. the shared command).
2. Distinct plug personalities on the two-hand chassis (e.g. a fast USB-C
   jabber vs. a slow USB-A bruiser — `hands[]` overrides already support this;
   blackout would suit the jabber).
3. Narrow-escape slow-mo (near-miss already detected — `resolveStrike` returns `'near'`).
4. Real player tuning pass: L4's barricades, L5's blackout rate and L8's trim
   pace are sim-fair for perfect play; humans need playtesting. Current
   escalation knobs (all in `levels.js`): `plugW` ramps 48 → 56 → 62 across
   L3–L5 (hit window ~38 → ~41 → ~45px, and the plug visibly fattens), the
   timer-only levels run 25/40/35/35/38s for L4–L8, `blackout: 0.3`, blocker
   `dur`/`gap`, L5 `lockTime`, L8 `sealTide` chunk/minWidth.


## UI polish and rendering pass

The arcade shell now uses charcoal/lime, compact level progress, distinct score and
dodge counters, short onboarding, result statistics, and mobile-safe overlays.
Pause is available on screen and via P/Esc; Help pauses without discarding the run.
Menus manage keyboard focus; button feedback and short entrances respect reduced
motion, which also suppresses camera shake and reduces decorative particles.

Rendering caches the static desk/laptop, skips repeated static menu paints, caps
canvas density at 2x, updates HUD values at 10 Hz, and animates the timer using a
transform. Particle bursts are capped at 160 and reset with each attempt. Pending
result timers are cancelled on restart; campaign clears award their advertised bonus.
`tests/ui.test.mjs` covers effect bounds/reset, reduced motion, and input blur cleanup.

Next design experiments (proposals, not added levels):
- **Wrong Way Round:** a human flips the USB-A plug, with a visibly different second
  wind-up. Teach this alone before pairing it with double-jabs.
- **Dongle Chain:** a heavy adapter swings across the edge on a clearly marked arc;
  reward moving through the gap after it passes.
- **Hot Swap:** alternate control between two ports while the other holds position.
  Start with one slow hand to teach switching before combining threats.

Keep the committed strike rule: once the target locks, it must remain honest.
Before expanding the campaign, playtest levels 4–5 with humans and tune telegraph
lengths. The next code cleanup should separate canvas drawing and overlay screens
from main.js while keeping the pure gameplay logic and headless simulations intact.


Near misses can now trigger a 280ms slow-motion beat, starting at 40% speed and
smoothly recovering. It happens at most once per level/round attempt, with an
18-second active-play cooldown that survives retries and round transitions.
The beat replaces the old near-miss hit-stop, skips level-ending dodges, and is
disabled by reduced-motion preferences. Pausing does not consume the cooldown.


## Mobile browsers and performance

Use a current browser on iOS or Android. Drag the playfield or hold the on-screen
arrows in slide levels; tap the numbered controls in slot levels. Both portrait
and landscape layouts are supported, with safe-area padding and 44px-or-larger
primary touch controls. Audio unlocks on a user gesture; leaving the page pauses
the game and suspends audio.

For testing on a phone, run `npm run serve` on the computer, connect both devices
to the same network, and open `http://<computer-LAN-IP>:8099` on the phone.
`localhost` on the phone refers to the phone itself. The server needs to be
reachable through the computer's firewall; no firewall settings are changed here.

See [the performance audit](PERFORMANCE.md) for measurements, implemented fixes,
and physical-device verification still needed. Add `?perf=1` for optional frame
CPU diagnostics; normal play does not download the diagnostic module.
