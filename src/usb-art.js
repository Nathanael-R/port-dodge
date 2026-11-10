// Plug and port artwork, drawn like the line illustrations in a hardware manual:
// flat fills, one shadow tone, a single ink outline. Sprites are cached at 2x.
// Logical tip and metal width match the collision geometry exactly.
const INK = '#1a1916';
const STEEL = '#c9ccc5', STEEL_SHADE = '#a2a69f', STEEL_LIGHT = '#eceee8';
const BODY = '#35342f', BODY_SHADE = '#272622', ETCH = '#8f8b80';
const LINE = 1.5;

const sprites = new Map();

function sprite(key, w, h, paint) {
  let s = sprites.get(key);
  if (!s) {
    s = document.createElement('canvas');
    s.width = w * 2; s.height = h * 2;
    const g = s.getContext('2d');
    g.scale(2, 2);
    g.lineJoin = 'round'; g.lineCap = 'round';
    paint(g);
    sprites.set(key, s);
  }
  return s;
}

// Fill a rounded rect, optionally shade its right-hand side, then ink it.
function part(g, x, y, w, h, r, fill, shade, shadeFrac = 0.3) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
  g.fillStyle = fill; g.fill();
  if (shade) {
    g.save(); g.clip();
    g.fillStyle = shade; g.fillRect(x + w * (1 - shadeFrac), y, w * shadeFrac + 1, h);
    g.restore();
  }
  g.strokeStyle = INK; g.lineWidth = LINE; g.stroke();
}

function strainRelief(g, cx, y, w, h) {
  part(g, cx - w / 2, y, w, h, 4, '#23221f');
  g.strokeStyle = '#4a4842'; g.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    g.beginPath(); g.moveTo(cx - w / 2 + 3, y + i * 5 + 2); g.lineTo(cx + w / 2 - 3, y + i * 5 + 2); g.stroke();
  }
}

export function drawUSBStick(ctx, x, y, width, accent = '#dd4a1f') {
  const s = sprite(`a:${width}:${accent}`, width + 28, 132, (g) => {
    const left = 14, center = left + width / 2;
    strainRelief(g, center, 106, 24, 24);
    // Overmolded body, with the coloured shoulder.
    part(g, left - 5, 58, width + 10, 56, 7, BODY, BODY_SHADE, 0.25);
    g.fillStyle = accent; g.fillRect(left - 4.25, 59.5, width + 8.5, 5);
    g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.moveTo(left - 4, 64.5); g.lineTo(left + width + 4, 64.5); g.stroke();
    // USB trident, etched.
    g.strokeStyle = ETCH; g.fillStyle = ETCH; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(center, 100); g.lineTo(center, 80);
    g.moveTo(center, 94); g.lineTo(center - 7, 88); g.lineTo(center - 7, 85);
    g.moveTo(center, 91); g.lineTo(center + 7, 86); g.lineTo(center + 7, 83); g.stroke();
    g.beginPath(); g.moveTo(center, 76); g.lineTo(center - 3.5, 81); g.lineTo(center + 3.5, 81); g.fill();
    g.beginPath(); g.arc(center - 7, 84, 2, 0, Math.PI * 2); g.fill();
    g.fillRect(center + 5, 80, 4, 4);
    // Steel shell: one shade band, a highlight line, and the two retention windows.
    part(g, left, 1, width, 61, [3, 3, 1, 1], STEEL, STEEL_SHADE, 0.28);
    g.strokeStyle = STEEL_LIGHT; g.lineWidth = 2;
    g.beginPath(); g.moveTo(left + 4, 6); g.lineTo(left + 4, 56); g.stroke();
    for (const holeX of [left + width * .2, left + width * .62]) {
      g.beginPath(); g.rect(holeX, 14, width * .18, 11);
      g.fillStyle = INK; g.fill();
    }
    g.strokeStyle = INK; g.lineWidth = 1;
    g.beginPath(); g.moveTo(left, 36); g.lineTo(left + width, 36); g.stroke();
  });
  ctx.drawImage(s, x - width / 2 - 14, y, width + 28, 132);
}

// USB-C: a short, fully rounded tip on a slim overmold. Same 132px footprint
// and tip origin as USB-A, so the hand choreography is shared; the narrow
// silhouette is the tell that its hit window is narrow too.
export function drawUSBCStick(ctx, x, y, width, accent = '#e2a72e') {
  const s = sprite(`c:${width}:${accent}`, width + 28, 132, (g) => {
    const left = 14, center = left + width / 2;
    strainRelief(g, center, 104, 16, 26);
    part(g, left - 4, 46, width + 8, 64, 10, BODY, BODY_SHADE, 0.25);
    g.fillStyle = accent; g.fillRect(left - 3.25, 48, width + 6.5, 5);
    g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.moveTo(left - 3, 53); g.lineTo(left + width + 3, 53); g.stroke();
    // Etched receptacle mark instead of the trident.
    g.strokeStyle = ETCH; g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(center - 7, 75, 14, 6, 3); g.stroke();
    const r = Math.min(10, width / 3);
    part(g, left, 6, width, 44, [r, r, 1, 1], STEEL, STEEL_SHADE, 0.28);
    g.strokeStyle = STEEL_LIGHT; g.lineWidth = 2;
    g.beginPath(); g.moveTo(left + 4, 12); g.lineTo(left + 4, 44); g.stroke();
    // The contact slot seen through the face of the shell.
    part(g, center - width * .3, 14, width * .6, 9, 4.5, INK);
    g.fillStyle = '#6f8a7e'; g.fillRect(center - width * .18, 17.5, width * .36, 2);
    g.strokeStyle = INK; g.lineWidth = 1;
    g.beginPath(); g.moveTo(left, 32); g.lineTo(left + width, 32); g.stroke();
  });
  ctx.drawImage(s, x - width / 2 - 14, y, width + 28, 132);
}

// The socket's machining is cached; the face is drawn live on top by main.js.
// The cavity is deliberately roomy so the eyes read at play size.
export function drawUSBPort(ctx, x, y, width, height, alive = true) {
  const s = sprite(`p:${width}:${height}:${alive}`, width + 8, height + 8, (g) => {
    part(g, 4, 4, width, height, 4, alive ? STEEL : '#9a9d97', alive ? STEEL_SHADE : '#7e817b', 0.22);
    g.strokeStyle = alive ? STEEL_LIGHT : '#b4b7b0'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(8, 6.5); g.lineTo(width - 2, 6.5); g.stroke();
    part(g, 7.5, 8.5, width - 7, height - 7, 2.5, '#141412');
    // USB 3 tongue with four contact pads, along the bottom of the cavity.
    const tongueY = height - 3.5;
    g.fillStyle = alive ? '#3b7d74' : '#46504b'; g.fillRect(10, tongueY, width - 12, 3.5);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = alive ? '#d6b65a' : '#77735e';
      g.fillRect(4 + width / 2 - 13 + i * 7, tongueY + 0.75, 4, 2);
    }
    // status LED
    g.fillStyle = alive ? '#7bd389' : '#dd4a1f';
    g.beginPath(); g.arc(width, 6.5, 1.4, 0, Math.PI * 2); g.fill();
  });
  ctx.drawImage(s, x - width / 2 - 4, y - 4, width + 8, height + 8);
}
