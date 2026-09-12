import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOS, detectOS, osCopy, OS_COPY } from '../src/os.js';

test('parseOS recognizes the big three', () => {
  assert.equal(parseOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel'), 'mac');
  assert.equal(parseOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32'), 'windows');
  assert.equal(parseOS('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64'), 'linux');
  assert.equal(parseOS('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'iPhone'), 'mac');
});

test('parseOS prefers userAgentData-style platform when UA is vague', () => {
  const vague = 'Mozilla/5.0 (X11; CrOS x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  assert.equal(parseOS(vague, 'macOS'), 'mac');
  assert.equal(parseOS('', ''), 'other');
});

test('detectOS reads navigator with graceful fallback', () => {
  assert.equal(detectOS({ userAgent: 'windows nt', platform: 'Win32' }), 'windows');
  assert.equal(detectOS({}), 'other'); // empty navigator object, no UA strings
  assert.equal(detectOS(null), 'other');
  assert.equal(detectOS({ get userAgent() { throw new Error('nope'); } }), 'other');
});

test('every OS has complete flavor copy', () => {
  for (const os of ['mac', 'windows', 'linux', 'other']) {
    const c = osCopy(os);
    assert.ok(c.brand && c.sub, os);
    assert.equal(typeof c.foot, 'string', os);
    assert.ok(Array.isArray(c.edge) && c.edge.length === 2, os);
  }
  assert.equal(osCopy('plan9'), OS_COPY.other);
});
