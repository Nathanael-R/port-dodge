# Performance and mobile audit

Audit date: 2026-09-13. No runtime dependencies, external fonts, images, or audio downloads.

## Findings and fixes

| Priority | Finding | Implemented change |
| --- | --- | --- |
| High | Menus and pauses still requested frames at display refresh rate. | Event-driven scheduler stops when static/hidden; input, transitions and resize wake it. Resume resets elapsed time. |
| High | Canvas allocation used world width rather than displayed width. | Match CSS width at up to 2x density, capped at 1920×1080. Keep the logical 960×540 world. |
| High | Fast taps could end before simulation read them; another finger could steal a drag. | Buffer taps, track one pointer ID, ignore secondary fingers, clear cancellation. Cache bounds at drag start. |
| High | Touch controls obscured the playfield; short landscape layouts were incomplete. | Separate arrows and slot buttons, portrait/landscape layouts, safe-area padding, 44px toolbar targets and 44–52px movement buttons. Browser zoom remains enabled. |
| Medium | Noise buffers were randomized and allocated on every effect. | Reuse buffers by duration; disconnect finished audio nodes; unlock audio on user gestures and suspend it while hidden. |
| Medium | The vignette gradient was recreated every frame. | Cache until resize; use an opaque canvas context. Keep cached scenery and USB artwork. |
| Low | Particle removal shifted arrays; targeting/movement created temporary objects. | Swap-remove particles, scan live targets directly, update the shared movement object in place. |

The existing particle cap, 10 Hz HUD updates, and rare near-miss slow motion remain.

## Download size

Measured from index.html, style.css and normally loaded modules. Gzip is an estimate
from compressing each file separately, not observed network transfer. Tests,
documentation and the opt-in perf.js module are excluded.

| | Before | After |
| --- | ---: | ---: |
| Files | 10 | 11 |
| Uncompressed | 97,293 bytes / 95.0 KiB | 105,835 bytes / 103.4 KiB |
| Gzip estimate | 32,723 bytes / 32.0 KiB | 35,143 bytes / 34.3 KiB |
| Runtime dependencies / external assets | 0 | 0 |

Mobile controls and lifecycle handling add about 2.4 KiB compressed. The Python
development server serves uncompressed files; enable gzip or Brotli on the eventual
production host. The baseline counts are also saved in audit-baseline.json.

## Canvas allocation and idle work

At 362 CSS pixels on a 3x-density phone:

- Before: 1920×1080 = 2,073,600 pixels.
- After: 724×407 = 294,668 pixels: **85.8% fewer backing pixels**.
- One RGBA buffer: roughly 7.91 MiB → 1.12 MiB. This excludes compositor surfaces,
  cached sprites, the static background, and other browser/GPU allocations.

At 1180 CSS pixels on a 1x desktop, backing size increases from 960×540 to 1180×664
for sharper presentation. The main savings apply to small high-density displays.

The menu diagnostic counter stayed at 1 across separate observations. Regression
tests verify zero queued frames while idle, one while playing, cancellation,
deduplicated wakeups, and no elapsed-time jump after an idle period.

## Observed timings

Use `?endless=1&bot=1&perf=1`. The opt-in panel measures JavaScript and synchronous
canvas command submission around the callback using a rolling 240-sample window.
It does not measure GPU completion, battery consumption or touch-to-photon latency.

| Desktop sample | Frames/s | Mean CPU/frame | p95 CPU/frame | Canvas |
| --- | ---: | ---: | ---: | --- |
| Baseline | 59.9 | 0.64 ms | 1.20 ms | 960×540 |
| After, intermediate round transition | 60.0 | 0.57 ms | 0.90 ms | 1180×664 |
| After, round 5 Blackout | 60.2 | 0.87 ms | 1.60 ms | 1180×664 |

These are short observational samples with different round states and resolutions,
not a controlled percentage speedup benchmark. This desktop has plenty of room
within a 16.7ms frame budget. These numbers do not establish physical-phone FPS.

## Verification and remaining checks

- 52 tests pass: gameplay/endless simulations plus scheduler, canvas sizing, fast
  taps, secondary fingers, cancellation, audio reuse, cleanup and suspend/resume.
- Browser checks cover start, pause/resume, idle wakeup, a numbered slot jump,
  portrait play/result screens, 320px width and 844×390 landscape controls.
- At 320px viewport width, no horizontal overflow; toolbar buttons are 44×44px.
- Browser checks use desktop Chromium with resized viewports. Synthetic pointer
  tests do not replace testing real multi-touch input or mobile Safari.

Before a public mobile release, test iPhone Safari and Android Chrome: first-tap
audio, screen lock/interruption, held arrows and extra fingers, rotation during
play, collapsing browser chrome, and a 10-minute endless run on a lower-end phone.
Current mobile browsers are the intended target; older engines are unverified.

## References

Rendering choices follow [MDN canvas optimization guidance](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas).
Gesture-based audio activation follows [MDN Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).
