import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('IDE keeps Simulator default and physical endpoint isolated', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /Simulator|simulator/i);
  assert.doesNotMatch(html, /192\.168\.58\.2/);
});
