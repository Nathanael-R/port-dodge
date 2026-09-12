// OS detection + per-OS flavor. Pure parse() is unit-tested; detect() reads navigator.
export function parseOS(ua = '', platform = '') {
  const s = `${platform} ${ua}`.toLowerCase();
  if (/mac|iphone|ipad|ipod|darwin/.test(s)) return 'mac';
  if (/win/.test(s)) return 'windows';
  if (/linux|android|cros|x11|ubuntu|fedora/.test(s)) return 'linux';
  return 'other';
}

export function detectOS(nav = (typeof navigator !== 'undefined' ? navigator : undefined)) {
  try {
    if (!nav) return 'other';
    const plat = nav.userAgentData?.platform || nav.platform || '';
    return parseOS(nav.userAgent || '', plat);
  } catch {
    return 'other';
  }
}

// Parody hardware + one-liners per OS. 'other' falls back to windows styling.
export const OS_COPY = {
  mac: {
    brand: '◉ MacLap Pro',
    sub: 'USB-C only · dongles sold separately',
    foot: '🍎 Mac detected — the hand bills by the hour, plus dongle fees.',
    edge: ['#e8edff', '#9aa5c4'],
    dot: true, // traffic lights on the lid
  },
  windows: {
    brand: '▦ WinLap 11',
    sub: 'have you tried turning it off and on again',
    foot: '▦ Windows detected — the hand will restart after updates. Twice.',
    edge: ['#4cc2ff', '#9beaff'],
    dot: false,
  },
  linux: {
    brand: '$ penglap — btw',
    sub: 'i use arch btw · sudo dodge',
    foot: '🐧 Linux detected — the hand compiled itself from source.',
    edge: ['#7bff9e', '#4cc2ff'],
    dot: false,
  },
  other: {
    brand: '◉ LAPTOP-9000',
    sub: 'do NOT lick the ports',
    foot: '',
    edge: ['#4dd8ff', '#9beaff'],
    dot: false,
  },
};

export function osCopy(os) {
  return OS_COPY[os] || OS_COPY.other;
}
