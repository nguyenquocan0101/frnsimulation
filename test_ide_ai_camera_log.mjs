import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('normal IDE wires the throttled Camera receiver to the existing console only outside embed mode', () => {
  assert.match(app, /ai-camera-log\.mjs/);
  assert.match(app, /if\s*\(\s*!isEmbedMode\s*\)[\s\S]{0,1600}(?:createAiCameraLogReceiver|initAiCameraLog)/);
  assert.match(app, /onRender\s*:\s*\([^)]*\)\s*=>\s*renderAiCameraLog\(\$\(["']console["']\)/);
  assert.doesNotMatch(index, /class=["'][^"']*ai-camera-log-block/);
  assert.match(index, /id=["']console["'][\s\S]{0,160}aria-live=["']polite["']/);
});

test('IDE normal log path inserts text before the AI block and Clear keeps lazy recreation contract', () => {
  const logFunction = app.match(/function log\(message\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(logFunction, /appendConsoleLogText/);
  assert.match(logFunction, /new Date\(\)\.toLocaleTimeString\(\)/);
  assert.doesNotMatch(logFunction, /textContent\s*\+=/);
  assert.match(app, /clearLogBtn[\s\S]{0,220}console["']?\)\.textContent\s*=\s*["']["']/);
});

test('AI block is explicitly white in both themes without replacing normal console colors', () => {
  assert.match(styles, /\.ai-camera-log-block\s*\{[^}]*color\s*:\s*#(?:fff|ffffff)\b/i);
  assert.match(styles, /\.ai-camera-log-block\s*\{[^}]*display\s*:\s*block\b/i);
  assert.match(styles, /\.ai-camera-log-block\s*\{[^}]*background\s*:[^;}]+/i);
  assert.match(styles, /\.ai-camera-log-block\s*\{[^}]*(?:overflow-wrap\s*:\s*anywhere|white-space\s*:\s*pre-wrap)/i);
  assert.match(styles, /\.ai-camera-log-block\s*\{[^}]*padding\s*:[^;}]+/i);
  assert.match(styles, /\.console\s*\{[^}]*color\s*:\s*#3d2e26\b/i);
  assert.match(styles, /html\[data-theme=["']dark["']\]\s+\.console\s*\{[^}]*color\s*:\s*#f4d9c5\b/i);
  for (const rule of styles.matchAll(/(?:html\[data-theme=["'](?:light|dark)["']\][^{]*)?\.ai-camera-log-block\s*\{([^}]*)\}/gi)) {
    const color = rule[1].match(/color\s*:\s*([^;]+)/i)?.[1]?.trim();
    if (color) assert.match(color, /^#(?:fff|ffffff)\b/i, 'theme-specific AI color cannot override white');
  }
});

class FakeLifecycleWindow {
  constructor() { this.listeners = new Map(); }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount(type) { return this.listeners.get(type)?.size ?? 0; }
}

test('IDE receiver lifecycle survives three bfcache cycles and fully tears down on final pagehide', async () => {
  const { createAiCameraLogLifecycle } = await import('./ai-camera-log.mjs');
  const windowRef = new FakeLifecycleWindow();
  const receivers = [];
  const createReceiver = () => {
    const receiver = { destroyCalls: 0, destroy() { this.destroyCalls += 1; } };
    receivers.push(receiver);
    return receiver;
  };

  const lifecycle = createAiCameraLogLifecycle({ windowRef, isEmbedMode: false, createReceiver });
  assert.equal(receivers.length, 1, 'normal mode creates one initial receiver');
  assert.equal(windowRef.listenerCount('pagehide'), 1);
  assert.equal(windowRef.listenerCount('pageshow'), 1);
  windowRef.dispatch('pageshow', { persisted: false });
  assert.equal(receivers.length, 1, 'ordinary pageshow does not duplicate the active receiver');

  for (let cycle = 0; cycle < 3; cycle += 1) {
    windowRef.dispatch('pagehide', { persisted: true });
    assert.equal(receivers[cycle].destroyCalls, 1, `cycle ${cycle + 1} destroys the prior receiver`);
    assert.equal(windowRef.listenerCount('pagehide'), 1, 'persisted hide retains coordinator listeners');
    assert.equal(windowRef.listenerCount('pageshow'), 1);
    if (cycle === 0) {
      windowRef.dispatch('pageshow', { persisted: false });
      assert.equal(receivers.length, 1, 'non-persisted pageshow cannot recreate after persisted hide');
      assert.equal(receivers.filter((receiver) => receiver.destroyCalls === 0).length, 0);
    }
    windowRef.dispatch('pageshow', { persisted: true });
    assert.equal(receivers.length, cycle + 2, `cycle ${cycle + 1} creates one replacement`);
    assert.equal(receivers.filter((receiver) => receiver.destroyCalls === 0).length, 1, 'exactly one receiver remains active');
  }

  assert.equal(receivers.length, 4);
  windowRef.dispatch('pagehide', { persisted: false });
  assert.equal(receivers[3].destroyCalls, 1, 'final pagehide destroys the fourth receiver');
  assert.equal(windowRef.listenerCount('pagehide'), 0, 'final teardown removes pagehide listener');
  assert.equal(windowRef.listenerCount('pageshow'), 0, 'final teardown removes pageshow listener');
  windowRef.dispatch('pageshow', { persisted: true });
  assert.equal(receivers.length, 4, 'restoration cannot recreate after final teardown');
  assert.doesNotThrow(() => lifecycle.destroy());
  assert.equal(receivers.every((receiver) => receiver.destroyCalls === 1), true, 'coordinator destroy is idempotent');
});

test('IDE receiver lifecycle constructs no receiver and registers no listeners in embed mode', async () => {
  const { createAiCameraLogLifecycle } = await import('./ai-camera-log.mjs');
  const windowRef = new FakeLifecycleWindow();
  let receiverConstructions = 0;
  let channelConstructions = 0;
  windowRef.BroadcastChannel = class { constructor() { channelConstructions += 1; } };
  const lifecycle = createAiCameraLogLifecycle({
    windowRef,
    isEmbedMode: true,
    createReceiver() {
      receiverConstructions += 1;
      return { destroy() {} };
    },
  });

  assert.equal(receiverConstructions, 0);
  assert.equal(channelConstructions, 0);
  assert.equal(windowRef.listenerCount('pagehide'), 0);
  assert.equal(windowRef.listenerCount('pageshow'), 0);
  windowRef.dispatch('pagehide', { persisted: true });
  windowRef.dispatch('pageshow', { persisted: true });
  assert.equal(receiverConstructions, 0);
  assert.doesNotThrow(() => lifecycle.destroy());
});

test('direct lifecycle destroy is idempotent while a normal receiver is active', async () => {
  const { createAiCameraLogLifecycle } = await import('./ai-camera-log.mjs');
  const windowRef = new FakeLifecycleWindow();
  const receivers = [];
  const lifecycle = createAiCameraLogLifecycle({
    windowRef,
    isEmbedMode: false,
    createReceiver() {
      const receiver = { destroyCalls: 0, destroy() { this.destroyCalls += 1; } };
      receivers.push(receiver);
      return receiver;
    },
  });
  assert.equal(receivers.length, 1);

  lifecycle.destroy();
  lifecycle.destroy();
  assert.equal(receivers[0].destroyCalls, 1);
  assert.equal(windowRef.listenerCount('pagehide'), 0);
  assert.equal(windowRef.listenerCount('pageshow'), 0);
  windowRef.dispatch('pagehide', { persisted: true });
  windowRef.dispatch('pageshow', { persisted: true });
  assert.equal(receivers.length, 1, 'events after direct teardown cannot recreate a receiver');
});

test('app delegates AI receiver ownership to the lifecycle coordinator with embed state', () => {
  assert.match(app, /createAiCameraLogLifecycle/);
  assert.match(app, /createAiCameraLogLifecycle\s*\(\s*\{[\s\S]{0,900}windowRef\s*:\s*window/);
  assert.match(app, /createAiCameraLogLifecycle\s*\(\s*\{[\s\S]{0,900}\bisEmbedMode\b/);
});
