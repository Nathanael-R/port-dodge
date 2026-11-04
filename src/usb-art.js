// Cached, high-density USB-A artwork. Logical tip and metal width match collision geometry.
const sprites = new Map();

export function drawUSBStick(ctx, x, y, width, accent = '#dd4a1f') {
  const key = `${width}:${accent}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = (width + 28) * 2; sprite.height = 132 * 2;
    const g = sprite.getContext('2d');
    g.scale(2, 2);
    const left = 14, center = left + width / 2;
    const round = (x, y, w, h, r, color) => {
      g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    };

    // Rubber strain relief, tucked behind the housing.
    round(center - 12, 108, 24, 22, 5, '#111814');
    for (let i = 0; i < 3; i++) round(center - 11, 115 + i * 5, 22, 2, 1, '#38423c');

    // Folded steel shell: a bright chamfer and asymmetric reflections.
    const metal = g.createLinearGradient(left, 0, left + width, 0);
    metal.addColorStop(0, '#74847f'); metal.addColorStop(.07, '#d8e1db');
    metal.addColorStop(.24, '#aab8b1'); metal.addColorStop(.57, '#ecf1e9');
    metal.addColorStop(.84, '#bac7bf'); metal.addColorStop(1, '#6d7d76');
    g.fillStyle = metal; g.beginPath();
    g.moveTo(left + 3, 0); g.lineTo(left + width - 3, 0);
    g.lineTo(left + width, 3); g.lineTo(left + width, 63);
    g.lineTo(left, 63); g.lineTo(left, 3); g.closePath(); g.fill();
    round(left + 3, 1, width - 6, 2, 1, '#f8fff1');
    g.fillStyle = '#ffffff55'; g.fillRect(left + 2, 5, 1, 52);
    g.fillStyle = '#263a3455'; g.fillRect(left + width - 3, 5, 1, 52);
    // The two retention holes are the instantly recognizable USB-A silhouette detail.
    for (const holeX of [left + width * .2, left + width * .62]) {
      round(holeX, 15, width * .18, 12, 1.5, '#66796f');
      round(holeX, 15, width * .18, 10, 1, '#1a2821');
      g.fillStyle = '#ffffff70'; g.fillRect(holeX, 27, width * .18, 1);
    }
    // Subtle stamped seam and brushed grain; rasterized once, not every frame.
    g.fillStyle = '#334c4024';
    for (let row = 34; row < 55; row += 4) g.fillRect(left + 5, row, width - 10, .5);
    g.fillStyle = '#4a615750'; g.fillRect(center, 37, 1, 18);
    g.fillStyle = '#ffffff50'; g.fillRect(center + 1, 37, 1, 18);

    // Graphite molded housing, with a recessed face and a colored shoulder.
    round(left - 7, 58, width + 14, 59, 9, '#0a100d');
    const body = g.createLinearGradient(left, 60, left + width, 115);
    body.addColorStop(0, '#46564c'); body.addColorStop(.4, '#28382e'); body.addColorStop(1, '#142019');
    round(left - 5, 59, width + 10, 56, 8, body);
    round(left - 3, 60, width + 6, 6, 3, accent);
    round(left + 1, 72, width - 2, 35, 5, '#17261e');
    g.fillStyle = '#ffffff10'; g.fillRect(left + 4, 73, width - 8, 1);
    for (let row = 78; row < 105; row += 6) {
      round(left - 3, row, 2, 3, 1, '#6d7d6b66');
      round(left + width + 1, row, 2, 3, 1, '#6d7d6b66');
    }
    // Engraved USB trident; canvas geometry avoids platform-dependent glyphs.
    g.strokeStyle = '#a6b9a0'; g.lineWidth = 1.6; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(center, 100); g.lineTo(center, 80);
    g.moveTo(center, 94); g.lineTo(center - 7, 88); g.lineTo(center - 7, 84);
    g.moveTo(center, 91); g.lineTo(center + 7, 86); g.lineTo(center + 7, 82); g.stroke();
    g.fillStyle = '#a6b9a0'; g.beginPath();
    g.moveTo(center, 77); g.lineTo(center - 3, 82); g.lineTo(center + 3, 82); g.fill();
    g.beginPath(); g.arc(center - 7, 83, 2, 0, Math.PI * 2); g.fill();
    g.fillRect(center + 5, 79, 4, 4);
    g.beginPath(); g.arc(center, 101, 2.5, 0, Math.PI * 2); g.fill();
    sprites.set(key, sprite);
  }
  ctx.drawImage(sprite, x - width / 2 - 14, y, width + 28, 132);
}

// USB-C: a short, fully rounded steel tip on a slim overmold. Same 132px
// footprint and tip origin as USB-A, so the hand choreography is shared;
// the narrow silhouette is the tell that its hit window is narrow too.
export function drawUSBCStick(ctx, x, y, width, accent = '#e2a72e') {
  const key = `c:${width}:${accent}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = (width + 28) * 2; sprite.height = 132 * 2;
    const g = sprite.getContext('2d');
    g.scale(2, 2);
    const left = 14, center = left + width / 2;
    const round = (x, y, w, h, r, color) => {
      g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    };

    // Slim strain relief.
    round(center - 8, 106, 16, 24, 4, '#111814');
    for (let i = 0; i < 3; i++) round(center - 7, 113 + i * 5, 14, 2, 1, '#38423c');

    // Steel tip: short, rounded on top, one seam and a bright edge.
    const metal = g.createLinearGradient(left, 0, left + width, 0);
    metal.addColorStop(0, '#7d8b86'); metal.addColorStop(.12, '#dde5df');
    metal.addColorStop(.45, '#b2bfb8'); metal.addColorStop(.7, '#eef3ec');
    metal.addColorStop(1, '#727f79');
    g.fillStyle = metal; g.beginPath();
    g.roundRect(left, 6, width, 44, [Math.min(10, width / 3), Math.min(10, width / 3), 2, 2]); g.fill();
    round(left + 4, 7, width - 8, 1.5, 1, '#f8fff1');
    g.fillStyle = '#2a3a3340'; g.fillRect(left + 3, 30, width - 6, 1);
    // Recessed contact slot seen through the shell face.
    round(center - width * .28, 14, width * .56, 9, 4.5, '#1a2821');
    round(center - width * .18, 17.5, width * .36, 2, 1, '#6f8a7e');

    // Overmold: slimmer and taller than USB-A, with the colored shoulder.
    round(left - 4, 46, width + 8, 64, 10, '#0a100d');
    const body = g.createLinearGradient(left, 48, left + width, 108);
    body.addColorStop(0, '#46564c'); body.addColorStop(.45, '#28382e'); body.addColorStop(1, '#142019');
    round(left - 3, 47, width + 6, 61, 9, body);
    round(left - 1, 48, width + 2, 5, 2.5, accent);
    g.fillStyle = '#ffffff12'; g.fillRect(left + 2, 58, 1, 44);
    // Engraved receptacle outline instead of the USB-A trident.
    g.strokeStyle = '#a6b9a0'; g.lineWidth = 1.4;
    g.beginPath(); g.roundRect(center - 7, 75, 14, 6, 3); g.stroke();
    sprites.set(key, sprite);
  }
  ctx.drawImage(sprite, x - width / 2 - 14, y, width + 28, 132);
}

const portSprites = new Map();

// The socket's static machining is cached; eyes and reaction poses stay live.
export function drawUSBPort(ctx, x, y, width, height, alive = true) {
  const key = `${width}:${height}:${alive}`;
  let sprite = portSprites.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = (width + 8) * 2; sprite.height = (height + 8) * 2;
    const g = sprite.getContext('2d'); g.scale(2, 2);
    const round = (x, y, w, h, r, color) => {
      g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    };
    // Recessed mounting gasket and an asymmetric, chamfered steel rim.
    round(1, 2, width + 6, height + 5, 6, '#09140f');
    const steel = g.createLinearGradient(0, 4, 0, height + 4);
    steel.addColorStop(0, alive ? '#e6efe4' : '#88938b');
    steel.addColorStop(.16, '#b3c5b7'); steel.addColorStop(.48, '#6e8276');
    steel.addColorStop(.8, '#40564a'); steel.addColorStop(1, '#a1b4a5');
    round(4, 4, width, height, 4, steel);
    round(6, 5, width - 4, 1, .5, '#ffffff9a');
    round(7, 7, width - 6, height - 6, 3, '#091810');
    // A second inner lip makes the opening read as a cavity, not a flat screen.
    round(8, 8, width - 8, height - 8, 2, '#12271b');
    round(9, 8, width - 10, 3, 1, '#050d08');
    g.fillStyle = '#a8c2ad30'; g.fillRect(9, height, width - 10, 1);
    // USB 3 tongue, with four individual gold contact pads.
    const tongueY = height - 3;
    round(10, tongueY, width - 12, 4, 1, alive ? '#246e73' : '#394741');
    g.fillStyle = alive ? '#83d9c5' : '#6b7d71'; g.fillRect(11, tongueY, width - 14, 1);
    for (let i = 0; i < 4; i++) {
      const contactX = 4 + width / 2 - 13 + i * 7;
      round(contactX, tongueY + 1, 4, 2, .5, alive ? '#ddc481' : '#807b60');
      g.fillStyle = '#fff2bd90'; g.fillRect(contactX, tongueY + 1, 4, .5);
    }
    // Tiny side retaining clips and a power/status LED.
    round(6, height / 2 + 2, 2, 5, 1, '#d0ded070');
    round(width, height / 2 + 2, 2, 5, 1, '#d0ded050');
    round(width - 2, 5, 3, 1.5, .75, alive ? '#7bd389' : '#ff6e72');
    portSprites.set(key, sprite);
  }
  ctx.drawImage(sprite, x - width / 2 - 4, y - 4, width + 8, height + 8);
}
