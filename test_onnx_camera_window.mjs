import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createOnnxCameraWindowBootstrap } from './onnx-camera-window.mjs';

const windowHtml = fs.readFileSync(new URL('./onnx-camera-window.html', import.meta.url), 'utf8');
const windowModule = fs.readFileSync(new URL('./onnx-camera-window.mjs', import.meta.url), 'utf8');

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

test('camera window bootstrap and controller imports share one new cache token', () => {
  const htmlToken = windowHtml.match(/<script\s+type=["']module["']\s+src=["']\.\/onnx-camera-window\.mjs\?v=([^&"'#\s]+)(?:[^"']*)["'][^>]*>/)?.[1];
  const controllerToken = windowModule.match(/^\s*import\b[^;]*\bfrom\s+["']\.\/onnx-camera\.mjs\?v=([^&"'#\s]+)(?:[^"']*)["'];?/m)?.[1];
  assert.ok(htmlToken, 'HTML bootstrap import has an explicit cache token');
  assert.ok(controllerToken, 'window-to-controller import has an explicit cache token');
  assert.equal(htmlToken, controllerToken, 'both import edges use the exact same token');
  assert.notEqual(htmlToken, '20260812-timed-log', 'Phase 3 changes the previous deployment token');
});

test('camera window exposes a local image upload for box drawing', () => {
  assert.match(windowHtml, /id="onnxImageInput"/);
  assert.match(windowHtml, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(windowHtml, /Connect a camera or upload an image to begin/);
});
