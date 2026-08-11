import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOnnxCameraLauncher,
  getOnnxCameraWindowFeatures,
  ONNX_CAMERA_WINDOW_NAME,
} from './onnx-camera-launcher.mjs';

function fixture({ open = () => ({ closed: false, focus() {} }), baseURI = 'https://example.test/workshop/' } = {}) {
  const listeners = new Map();
  const button = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
  };
  const status = { textContent: '', dataset: {} };
  const windowRef = {
    screen: { availWidth: 1440, availHeight: 900, availLeft: 0, availTop: 0 },
    open,
    addEventListener() {},
    removeEventListener() {},
  };
  const launcher = createOnnxCameraLauncher({ button, status, windowRef, documentRef: { baseURI } });
  return { button, status, windowRef, listeners, launcher };
}

test('opens one named, subpath-safe popup with clamped features', () => {
  const calls = [];
  const child = { closed: false, focus() { calls.push('focus'); } };
  const view = fixture({ open: (...args) => { calls.push(args); return child; }, baseURI: 'https://example.test/workshop/' });
  view.listeners.get('click')();
  assert.equal(calls[0][0], 'https://example.test/workshop/onnx-camera-window.html');
  assert.equal(calls[0][1], ONNX_CAMERA_WINDOW_NAME);
  assert.match(calls[0][2], /width=1100/);
  assert.match(calls[0][2], /height=800/);
  assert.match(calls[0][2], /resizable=yes/);
  assert.equal(view.status.textContent, 'AI camera window opened.');
});

test('focuses an open child and reopens after it closes', () => {
  const calls = [];
  let child = { closed: false, focus() { calls.push('focus'); } };
  const view = fixture({ open: (...args) => { calls.push(args); return child; } });
  view.listeners.get('click')();
  view.listeners.get('click')();
  assert.equal(calls.filter((entry) => entry === 'focus').length, 2);
  child.closed = true;
  view.listeners.get('click')();
  assert.equal(calls.filter(Array.isArray).length, 2);
});

test('announces a blocked popup without throwing', () => {
  const view = fixture({ open: () => null });
  view.listeners.get('click')();
  assert.match(view.status.textContent, /blocked.*Allow pop-ups/i);
  assert.equal(view.status.dataset.state, 'error');
});

test('handles inaccessible references and destroy idempotently', () => {
  const calls = [];
  const view = fixture({ open: () => { calls.push('open'); return { get closed() { throw new Error('stale'); }, focus() {} }; } });
  view.listeners.get('click')();
  view.listeners.get('click')();
  assert.equal(calls.length, 2);
  view.launcher.destroy();
  view.launcher.destroy();
  assert.equal(view.listeners.has('click'), false);
});

test('clamps dimensions and position to a small available screen', () => {
  const features = getOnnxCameraWindowFeatures({ availWidth: 640, availHeight: 480, availLeft: 10, availTop: 20 });
  assert.match(features, /width=616/);
  assert.match(features, /height=432/);
  assert.match(features, /left=22/);
  assert.match(features, /top=44/);
});

test('keeps negative secondary-monitor coordinates when centering', () => {
  const features = getOnnxCameraWindowFeatures({ availWidth: 1440, availHeight: 900, availLeft: -1440, availTop: -120 });
  assert.match(features, /left=-1270/);
  assert.match(features, /top=-70/);
});
