// Particles, floating texts, screen shake, hitstop.

// Dark ink on light chips, paper on dark ones.
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) > 150 ? '#1a1916' : '#f4f1ea';
}

export function createFX(reduceMotion = () => false) {
  const parts = [];
  const texts = [];
  let shake = 0, shakeX = 0, shakeY = 0, hitstop = 0;

  function burst(x, y, n, opts = {}) {
    n = Math.min(reduceMotion() ? 4 : n, 160 - parts.length);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed || 260) * (0.3 + Math.random() * 0.9);
      parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.up || 0),
        life: 0, ttl: (opts.ttl || 0.6) * (0.6 + Math.random() * 0.8),
        size: (opts.size || 4) * (0.6 + Math.random() * 0.8),
        color: opts.colors ? opts.colors[(Math.random() * opts.colors.length) | 0] : '#e2a72e',
        grav: opts.grav ?? 900,
      });
    }
  }
  const sparks = (x, y) => burst(x, y, 26, { colors: ['#e2a72e', '#dd4a1f', '#1a1916', '#f4f1ea'], speed: 340, up: 120 });
  const poof = (x, y) => burst(x, y, 14, { colors: ['#8a867c', '#c9c3b6', '#1a1916'], speed: 200, grav: 200, ttl: 0.45, size: 5 });
  const debris = (x, y) => burst(x, y, 20, { colors: ['#2b2a27', '#55524b', '#dd4a1f'], speed: 300, up: 60 });

  function text(x, y, str, color = '#1a1916', size = 22, ttl = 0.9) {
    texts.push({ x, y, str, color, size, life: 0, ttl });
  }

  function addShake(m) { if (reduceMotion()) return; shake = Math.min(18, shake + m); }
  function stop(t) { hitstop = Math.max(hitstop, t); }

  function update(dt) {
    if (hitstop > 0) { hitstop -= dt; return 0; } // frozen — caller skips world update
    shake *= Math.pow(0.001, dt); // fast decay
    if (shake < 0.15) shake = 0;
    shakeX = shake ? (Math.random() * 2 - 1) * shake : 0;
    shakeY = shake ? (Math.random() * 2 - 1) * shake : 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.ttl) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life += dt; if (!reduceMotion()) t.y -= 46 * dt;
      if (t.life >= t.ttl) texts.splice(i, 1);
    }
    return dt;
  }

  function draw(ctx) {
    for (const p of parts) {
      const a = 1 - p.life / p.ttl;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    // Floating callouts are printed labels: a solid chip, so they read on the
    // dark laptop and the pale desk alike.
    for (const t of texts) {
      ctx.globalAlpha = Math.max(0, 1 - t.life / t.ttl);
      const size = Math.round(t.size * 0.8);
      ctx.font = `800 condensed ${size}px Archivo, "Arial Narrow", Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const w = ctx.measureText(t.str).width + 16, cap = size * 0.72;
      ctx.fillStyle = t.color;
      ctx.fillRect(t.x - w / 2, t.y - cap - 6, w, cap + 12);
      ctx.fillStyle = inkOn(t.color);
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  function reset() { parts.length = 0; texts.length = 0; shake = shakeX = shakeY = hitstop = 0; }

  return { reset, sparks, poof, debris, text, burst, addShake, stop, update, draw,
    get shakeX() { return shakeX; }, get shakeY() { return shakeY; },
    get frozen() { return hitstop > 0; } };
}

// A rare near-miss beat. Cooldown uses active real time, independent of world speed.
export function createNearMissSlowMo(reduceMotion = () => false) {
  const duration = 0.28;
  let remaining = 0, cooldown = 0, usedThisAttempt = false;
  return {
    trigger() {
      if (reduceMotion() || usedThisAttempt || cooldown > 0) return false;
      remaining = duration; cooldown = 18; usedThisAttempt = true;
      return true;
    },
    update(realDt) {
      cooldown = Math.max(0, cooldown - realDt);
      if (reduceMotion()) remaining = 0;
      if (remaining <= 0) return 1;
      // Enter immediately at 40% speed, then smoothly return to normal.
      const progress = 1 - remaining / duration;
      const scale = 0.4 + 0.6 * progress * progress * (3 - 2 * progress);
      remaining = Math.max(0, remaining - realDt);
      return scale;
    },
    resetAttempt() {
      remaining = 0; usedThisAttempt = false;
      // Retrying or changing rounds cannot bypass the cooldown.
    },
  };
}
