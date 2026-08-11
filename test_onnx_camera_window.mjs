import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnnxCameraWindowBootstrap } from './onnx-camera-window.mjs';

function fixture(controllerFactory, { storageBlocked = false } = {}) {
  const listeners = new Map();
  const root = {};
  const status = { textContent: '', dataset: {} };
  const documentRef = {
    documentElement: { dataset: {} },
    querySelector(selector) { return selector === '#onnxCameraCard' ? root : status; },
  };
  const windowRef = {
    localStorage: { getItem() { return 'dark'; } },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
  };
  if (storageBlocked) Object.defineProperty(windowRef, 'localStorage', { get() { throw new Error('blocked'); } });
  const bootstrap = createOnnxCameraWindowBootstrap({ documentRef, windowRef, controllerFactory });
  return { bootstrap, listeners, documentRef, status };
}

test('boots exactly once, applies the saved theme, and restores once after bfcache', async () => {
  let created = 0;
  let destroyed = 0;
  const view = fixture(() => {
    created += 1;
    return { async destroy() { destroyed += 1; } };
  });
  await view.bootstrap.boot();
  await view.bootstrap.boot();
  assert.equal(created, 1);
  assert.equal(view.documentRef.documentElement.dataset.theme, 'dark');
  await view.bootstrap.restore({ persisted: true });
  assert.equal(created, 2);
  assert.equal(destroyed, 1);
  view.bootstrap.destroy();
  assert.equal(destroyed, 2);
  assert.equal(view.listeners.has('pageshow'), false);
});

test('renders an actionable bootstrap error without throwing into the page', async () => {
  const view = fixture(() => { throw new Error('controller unavailable'); });
  await view.bootstrap.boot();
  assert.match(view.status.textContent, /AI camera could not start.*controller unavailable/);
  assert.equal(view.status.dataset.state, 'error');
  view.bootstrap.destroy();
});

test('falls back to the light theme when localStorage access is blocked', async () => {
  const view = fixture(() => ({ destroy() {} }), { storageBlocked: true });
  await view.bootstrap.boot();
  assert.equal(view.documentRef.documentElement.dataset.theme, 'light');
  assert.doesNotMatch(view.status.textContent, /could not start/);
  view.bootstrap.destroy();
});
