// Particles, floating texts, screen shake, hitstop.
export function createFX() {
  const parts = [];
  const texts = [];
  let shake = 0, shakeX = 0, shakeY = 0, hitstop = 0;

  function burst(x, y, n, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed || 260) * (0.3 + Math.random() * 0.9);
      parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.up || 0),
        life: 0, ttl: (opts.ttl || 0.6) * (0.6 + Math.random() * 0.8),
        size: (opts.size || 4) * (0.6 + Math.random() * 0.8),
        color: opts.colors ? opts.colors[(Math.random() * opts.colors.length) | 0] : '#ffd166',
        grav: opts.grav ?? 900,
      });
    }
  }
  const sparks = (x, y) => burst(x, y, 26, { colors: ['#ffd166', '#ff9f1c', '#ffffff', '#4dd8ff'], speed: 340, up: 120 });
  const poof = (x, y) => burst(x, y, 14, { colors: ['#4dd8ff', '#b8f1ff', '#ffffff'], speed: 200, grav: 200, ttl: 0.45, size: 5 });
  const debris = (x, y) => burst(x, y, 20, { colors: ['#3a4358', '#59617c', '#ff5470'], speed: 300, up: 60 });

  function text(x, y, str, color = '#fff', size = 22, ttl = 0.9) {
    texts.push({ x, y, str, color, size, life: 0, ttl });
  }

  function addShake(m) { shake = Math.min(18, shake + m); }
  function stop(t) { hitstop = Math.max(hitstop, t); }

  function update(dt) {
    if (hitstop > 0) { hitstop -= dt; return 0; } // frozen — caller skips world update
    shake *= Math.pow(0.001, dt); // fast decay
    if (shake < 0.15) shake = 0;
    shakeX = (Math.random() * 2 - 1) * shake;
    shakeY = (Math.random() * 2 - 1) * shake;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.ttl) { parts.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life += dt; t.y -= 46 * dt;
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
    for (const t of texts) {
      const a = 1 - t.life / t.ttl;
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = `900 ${t.size}px "Segoe UI",system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  return { sparks, poof, debris, text, burst, addShake, stop, update, draw,
    get shakeX() { return shakeX; }, get shakeY() { return shakeY; },
    get frozen() { return hitstop > 0; } };
}
