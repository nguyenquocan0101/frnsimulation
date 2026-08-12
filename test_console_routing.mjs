import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { consoleChannelForMessage } from './console-routing.mjs';

const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('robot movement messages use the motion console', () => {
  assert.equal(consoleChannelForMessage('MoveJ([-6, -60, 87]) -> 0'), 'motion');
  assert.equal(consoleChannelForMessage('MoveL([100, 200, 300]) -> 0'), 'motion');
  assert.equal(consoleChannelForMessage('ServoJ -> 0'), 'motion');
});

test('program and simulator messages stay in the IDE console', () => {
  assert.equal(consoleChannelForMessage('print: Moving P2 -> P1'), 'ide');
  assert.equal(consoleChannelForMessage('Run start: orange marker stays at P7.'), 'ide');
  assert.equal(consoleChannelForMessage('StopMotion() -> 0'), 'ide');
});

test('IDE exposes two independently clearable responsive consoles', () => {
  assert.match(index, /id="console"[\s\S]{0,80}aria-live="polite"/);
  assert.match(index, /id="motionConsole"[\s\S]{0,80}aria-live="off"/);
  assert.match(index, /id="clearLogBtn"/);
  assert.match(index, /id="clearMotionLogBtn"/);
  assert.match(app, /clearLogBtn[\s\S]{0,180}\$\("console"\)\.textContent\s*=\s*""/);
  assert.match(app, /clearMotionLogBtn[\s\S]{0,180}\$\("motionConsole"\)\.textContent\s*=\s*""/);
  assert.match(styles, /\.console-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.simulation-grid,\.console-grid\{grid-template-columns:1fr\}/);
});
