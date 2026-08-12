import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  computeDisplayRect,
  predictBoxesSequentially,
  validateDecodedImageDimensions,
  validateImageFile,
} from './onnx-camera.mjs';

const html = fs.readFileSync(new URL('./onnx-camera-window.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('./onnx-camera.mjs', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./onnx-camera-window.css', import.meta.url), 'utf8');

test('window exposes Capture frame and Draw live mode controls', () => {
  assert.match(html, /id="onnxCaptureModeBtn"/);
  assert.match(html, /id="onnxLiveModeBtn"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Draw live/);
});

test('image upload validation accepts supported local images within 20 MB', () => {
  assert.equal(validateImageFile({ type: 'image/png', size: 1 }), '');
  assert.equal(validateImageFile({ type: 'image/jpeg', size: 20 * 1024 * 1024 }), '');
  assert.match(validateImageFile({ type: 'image/gif', size: 100 }), /PNG, JPEG, or WebP/);
  assert.match(validateImageFile({ type: 'image/webp', size: 20 * 1024 * 1024 + 1 }), /20 MB/);
});

test('decoded image validation prevents oversized canvas allocations', () => {
  assert.equal(validateDecodedImageDimensions(800, 600), '');
  assert.equal(validateDecodedImageDimensions(8192, 4096), '');
  assert.match(validateDecodedImageDimensions(8193, 100), /too large/);
  assert.match(validateDecodedImageDimensions(8000, 8000), /32 megapixels/);
  assert.match(validateDecodedImageDimensions(Number.POSITIVE_INFINITY, 100), /invalid dimensions/);
});

test('controller has explicit live mode and frame readiness state', () => {
  assert.match(source, /mode:\s*'capture'/);
  assert.match(source, /frameReady:\s*false/);
  assert.match(source, /sourceToken/);
  assert.match(source, /predictionToken/);
});

test('displayRect maps a contained 4:3 video inside a 16:9 stage', () => {
  assert.deepEqual(computeDisplayRect({ left: 0, top: 0, width: 1600, height: 900 }, 4 / 3), {
    left: 200,
    top: 0,
    width: 1200,
    height: 900,
  });
});

test('displayRect maps a wide video with vertical letterbox bars', () => {
  assert.deepEqual(computeDisplayRect({ left: 20, top: 30, width: 800, height: 600 }, 16 / 9), {
    left: 20,
    top: 105,
    width: 800,
    height: 450,
  });
});

test('live path snapshots video and uses a guarded two-second prediction loop', () => {
  assert.match(source, /drawImage\(nodes\.video/);
  assert.match(source, /mode\s*===\s*'live'/);
  assert.match(source, /setIntervalRef\([\s\S]*2000\)/);
  assert.match(source, /clearIntervalRef/);
  assert.doesNotMatch(source, /requestVideoFrameCallback/);
});

test('pointer cancellation discards drafts and model replacement preserves boxes', () => {
  assert.match(source, /pointercancel/);
  assert.match(source, /lostpointercapture/);
  assert.match(source, /state\.results\s*=\s*\[\]/);
  assert.match(source, /state\.frameReady/);
});

test('live snapshot requires a ready video and handles drawImage errors', () => {
  assert.match(source, /readyState\s*<\s*2/);
  assert.match(source, /try\s*\{\s*\n?\s*nextFrameCanvas\.getContext\('2d'\)\.drawImage/);
  assert.match(source, /nodes\.frame\.replaceWith\(nextFrameCanvas\)/);
  assert.match(source, /Could not snapshot the camera frame/);
});

test('live overlay remains responsive at narrow widths', () => {
  assert.match(styles, /onnx-mode-group/);
  assert.match(styles, /@media\(max-width:600px\)[\s\S]*onnx-mode-group/);
  assert.match(styles, /aspect-ratio:var\(--camera-aspect\)/);
  assert.match(source, /setProperty\('--camera-aspect'/);
});

test('dependency-injected sequential predictor processes every current box once', async () => {
  for (const count of [1, 3, 7]) {
    const boxes = Array.from({ length: count }, (_, index) => ({ index }));
    const calls = [];
    const results = await predictBoxesSequentially(boxes, async (box) => {
      calls.push(box.index);
      return `result-${box.index}`;
    });
    assert.deepEqual(calls, boxes.map((box) => box.index));
    assert.deepEqual(results, boxes.map((box) => `result-${box.index}`));
  }
});

test('repeated live releases rerun the full current selection cumulatively', async () => {
  const calls = [];
  const boxes = [];
  for (let release = 0; release < 7; release += 1) {
    boxes.push({ index: release });
    await predictBoxesSequentially(boxes, async (box) => {
      calls.push(box.index);
      return box.index;
    });
  }
  assert.equal(calls.length, 28);
  assert.deepEqual(calls.slice(-7), [0, 1, 2, 3, 4, 5, 6]);
});

test('auto-predict source guards and busy ownership are explicit', () => {
  assert.match(source, /trigger\s*===\s*'live'/);
  assert.match(source, /state\.busy\)/);
  assert.match(source, /state\.predictionToken\s*!==\s*runToken/);
  assert.match(source, /finally\s*\{[\s\S]*state\.predictionToken\s*===\s*runToken/);
  assert.match(source, /state\.session === prior[\s\S]*state\.session = null/);
  assert.match(source, /if \(state\.busy\) return;/);
  assert.match(source, /state\.mode === 'capture' && state\.frameReady/);
});

class FakeContext {
  constructor(owner) { this.owner = owner; this.drawImageCalls = 0; this.failDraw = false; }
  clearRect() {}
  drawImage(...args) {
    if (this.failDraw) throw new Error('synthetic draw failure');
    this.drawImageCalls += 1;
    if (args[0]?.tagName === 'VIDEO') this.owner.videoSnapshotCalls += 1;
  }
  measureText(text) { return { width: String(text).length * 6 }; }
  getImageData(_x, _y, width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) }; }
  strokeRect() {}
  fillRect() {}
  fillText() {}
}

class FakeElement {
  constructor(owner, id = '', tagName = 'DIV') {
    this.owner = owner; this.id = id; this.tagName = tagName; this.listeners = {};
    this.dataset = {}; this.style = {}; this.attributes = {}; this.children = [];
    this.hidden = false; this.disabled = false; this.textContent = ''; this.value = '';
  }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  async emit(type, event = {}) {
    const payload = { type, target: this, preventDefault() {}, ...event };
    for (const handler of this.listeners[type] || []) await handler(payload);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  replaceWith(next) { this.owner.replaced.set(this.id, next); }
  getBoundingClientRect() { return this.owner.stageRect; }
  setPointerCapture() {}
}

class FakeCanvas extends FakeElement {
  constructor(owner, id = '') { super(owner, id, 'CANVAS'); this.width = 0; this.height = 0; this.context = new FakeContext(owner); }
  getContext() { return this.context; }
}

class FakeVideo extends FakeElement {
  constructor(owner) { super(owner, 'onnxCameraVideo', 'VIDEO'); this.readyState = 4; this.videoWidth = 640; this.videoHeight = 480; }
  async play() {}
}

class FakeDocument {
  constructor(owner) { this.owner = owner; }
  createElement(tag) {
    if (tag === 'canvas') return new FakeCanvas(this.owner);
    return new FakeElement(this.owner, '', tag.toUpperCase());
  }
}

function makeFixture({ delayedRun = false, deferredRelease = false, runError = null, predictionPublisher = null, imageDecodeError = null } = {}) {
  const fixture = {
    stageRect: { left: 0, top: 0, width: 640, height: 480 },
    videoSnapshotCalls: 0,
    intervalActive: false,
    intervalCallback: null,
    intervalMs: 0,
    intervalId: 0,
    replaced: new Map(),
    handlers: {},
  };
  const ids = [
    'onnxConnectCameraBtn', 'onnxDisconnectBtn', 'onnxModelInput', 'onnxModelName', 'onnxImageInput', 'onnxImageName', 'onnxProviderStatus',
    'onnxCameraSelect', 'onnxCameraStage', 'onnxCaptureModeBtn', 'onnxLiveModeBtn',
    'onnxCameraVideo', 'onnxFrameCanvas', 'onnxOverlayCanvas', 'onnxStageEmpty', 'onnxCaptureBtn',
    'onnxUndoBtn', 'onnxClearBtn', 'onnxPredictBtn', 'onnxCameraStatus', 'onnxResults', 'onnxOverlayResults',
  ];
  const elements = new Map();
  const root = new FakeElement(fixture, 'root');
  root.setAttribute = FakeElement.prototype.setAttribute;
  root.querySelector = (selector) => elements.get(selector.slice(1));
  for (const id of ids) elements.set(id, id === 'onnxCameraVideo' ? new FakeVideo(fixture) : id.includes('Canvas') ? new FakeCanvas(fixture, id) : new FakeElement(fixture, id));
  fixture.elements = elements;
  const tracks = [{ stop() { this.stopped = true; }, getSettings() { return { deviceId: 'camera-1' }; } }];
  const navigatorRef = {
    gpu: null,
    mediaDevices: {
      async getUserMedia() { return { getTracks: () => tracks, getVideoTracks: () => tracks }; },
      async enumerateDevices() { return [{ kind: 'videoinput', deviceId: 'camera-1', label: 'Workshop cam' }]; },
    },
  };
  const windowRef = { addEventListener(type, handler) { fixture.handlers[type] = handler; }, removeEventListener() {} };
  let releaseRun;
  const runGate = delayedRun ? new Promise((resolve) => { releaseRun = resolve; }) : null;
  let releaseSession;
  const releaseGate = deferredRelease ? new Promise((resolve) => { releaseSession = resolve; }) : null;
  const session = {
    inputNames: ['images'], outputNames: ['output0'],
    inputMetadata: [{ dimensions: [1, 3, 4, 4] }], outputMetadata: [{ dimensions: [1, 2] }],
    runCalls: 0,
    async run() {
      this.runCalls += 1;
      if (runGate) await runGate;
      if (runError) throw runError;
      return { output0: { data: [0.9, 0.1] } };
    },
    async release() { if (releaseGate) await releaseGate; this.released = true; },
  };
  class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
  const ort = { Tensor, InferenceSession: { async create() { return session; } } };
  const deps = {
    document: new FakeDocument(fixture), navigator: navigatorRef, window: windowRef,
    performance: { now: () => 10 }, loadRuntime: async () => ort,
    setInterval(callback, ms) {
      fixture.intervalActive = true;
      fixture.intervalCallback = callback;
      fixture.intervalMs = ms;
      fixture.intervalId += 1;
      return fixture.intervalId;
    },
    clearInterval() { fixture.intervalActive = false; },
    async decodeImageFile() {
      if (imageDecodeError) throw imageDecodeError;
      return { source: { tagName: 'IMG' }, width: 800, height: 600, dispose() {} };
    },
    ...(predictionPublisher ? { predictionPublisher } : {}),
  };
  return { fixture, root, elements, session, deps, releaseRun, releaseSession, file: { name: 'demo.onnx', async arrayBuffer() { return new ArrayBuffer(0); } } };
}

async function bootFixture(options) {
  const fixture = makeFixture(options);
  const { createOnnxCameraController } = await import('./onnx-camera.mjs');
  globalThis.requestAnimationFrame ||= (callback) => callback();
  const controller = createOnnxCameraController({ root: fixture.root, deps: fixture.deps });
  fixture.elements.get('onnxModelInput').files = [fixture.file];
  await fixture.elements.get('onnxModelInput').emit('change');
  await fixture.elements.get('onnxConnectCameraBtn').emit('click');
  return { ...fixture, controller };
}

async function runLiveTick(run) {
  assert.equal(run.fixture.intervalActive, true, 'live prediction timer is active');
  assert.equal(run.fixture.intervalMs, 2000, 'live prediction timer runs every two seconds');
  run.fixture.intervalCallback();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makePublisherSpy() {
  return {
    payloads: [],
    destroyCalls: 0,
    publish(payload) { this.payloads.push(payload); },
    destroy() { this.destroyCalls += 1; },
  };
}

async function drawCapturedBox(run, pointerId = 301) {
  await run.elements.get('onnxCaptureBtn').emit('click');
  const overlay = run.elements.get('onnxOverlayCanvas');
  await overlay.emit('pointerdown', { pointerId, clientX: 24, clientY: 24 });
  await overlay.emit('pointerup', { pointerId, clientX: 220, clientY: 220 });
}

test('fake controller snapshots a live release and auto-predicts all current boxes', async () => {
  const run = await bootFixture();
  const overlay = run.elements.get('onnxOverlayCanvas');
  assert.equal(overlay.width, 640, 'overlay width matches the connected camera before drawing');
  assert.equal(overlay.height, 480, 'overlay height matches the connected camera before drawing');
  await run.elements.get('onnxCaptureBtn').emit('click');
  await overlay.emit('pointerdown', { pointerId: 90, clientX: 24, clientY: 24 });
  await overlay.emit('pointerup', { pointerId: 90, clientX: 220, clientY: 220 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(run.session.runCalls, 0, 'capture mode remains manual');
  await run.elements.get('onnxClearBtn').emit('click');
  await run.elements.get('onnxLiveModeBtn').emit('click');
  await overlay.emit('pointerdown', { pointerId: 1, clientX: 24, clientY: 24 });
  await overlay.emit('pointerup', { pointerId: 1, clientX: 220, clientY: 220 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(run.fixture.videoSnapshotCalls, 2, 'manual capture plus first live snapshot');
  assert.equal(run.session.runCalls, 0, 'live prediction waits for the two-second timer');
  await runLiveTick(run);
  assert.equal(run.session.runCalls, 1);
  assert.equal(run.elements.get('onnxResults').children.length, 1);
  assert.equal(run.elements.get('onnxOverlayResults').children.length, 0, 'camera overlay has no result log');
  for (let index = 2; index <= 7; index += 1) {
    const startX = 20 + index * 18;
    const startY = 20 + index * 8;
    const timerBeforeDrag = run.fixture.intervalId;
    await overlay.emit('pointerdown', { pointerId: index, clientX: startX, clientY: startY });
    assert.equal(run.fixture.intervalActive, false, 'timer pauses while a box is being drawn');
    await overlay.emit('pointerup', { pointerId: index, clientX: startX + 150, clientY: startY + 120 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(run.fixture.intervalActive, true, 'timer restarts after the box is released');
    assert.ok(run.fixture.intervalId > timerBeforeDrag, 'released box receives a fresh two-second cadence');
    await runLiveTick(run);
  }
  assert.equal(run.fixture.videoSnapshotCalls, 15, 'manual capture, seven box snapshots, and seven timer snapshots');
  assert.equal(run.session.runCalls, 28, 'each timer tick reruns the full current selection');
  assert.equal(run.elements.get('onnxResults').children.length, 7);
  assert.equal(run.elements.get('onnxOverlayResults').children.length, 0);
  await run.controller.destroy();
});

test('uploaded image becomes a drawable frame and supports prediction without a camera', async () => {
  const run = makeFixture();
  const { createOnnxCameraController } = await import('./onnx-camera.mjs');
  globalThis.requestAnimationFrame ||= (callback) => callback();
  const controller = createOnnxCameraController({ root: run.root, deps: run.deps });
  run.elements.get('onnxModelInput').files = [run.file];
  await run.elements.get('onnxModelInput').emit('change');
  run.elements.get('onnxImageInput').files = [{ name: 'blocks.png', type: 'image/png', size: 1024 }];
  await run.elements.get('onnxImageInput').emit('change');

  const overlay = run.elements.get('onnxOverlayCanvas');
  assert.equal(run.elements.get('onnxCameraStage').dataset.mode, 'image');
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.width, 800);
  assert.equal(overlay.height, 600);
  assert.match(run.elements.get('onnxCameraStatus').textContent, /Image ready/);

  await overlay.emit('pointerdown', { pointerId: 501, clientX: 24, clientY: 24 });
  await overlay.emit('pointerup', { pointerId: 501, clientX: 220, clientY: 220 });
  await run.elements.get('onnxPredictBtn').emit('click');
  assert.equal(run.session.runCalls, 1);
  assert.equal(run.elements.get('onnxResults').children.length, 1);
  assert.equal(run.fixture.videoSnapshotCalls, 0);
  await controller.destroy();
});

test('failed image decode preserves the connected camera source', async () => {
  const run = makeFixture({ imageDecodeError: new Error('synthetic decode failure') });
  const { createOnnxCameraController } = await import('./onnx-camera.mjs');
  globalThis.requestAnimationFrame ||= (callback) => callback();
  const controller = createOnnxCameraController({ root: run.root, deps: run.deps });
  await run.elements.get('onnxConnectCameraBtn').emit('click');
  const track = run.elements.get('onnxCameraVideo').srcObject.getTracks()[0];
  run.elements.get('onnxImageInput').files = [{ name: 'broken.png', type: 'image/png', size: 1024 }];
  await run.elements.get('onnxImageInput').emit('change');

  assert.equal(track.stopped, undefined, 'camera stays active when replacement image fails');
  assert.equal(run.elements.get('onnxCameraStage').dataset.mode, 'capture');
  assert.match(run.elements.get('onnxCameraStatus').textContent, /Could not load this image/);
  await controller.destroy();
});

test('failed camera connection preserves an uploaded image', async () => {
  const run = makeFixture();
  const { createOnnxCameraController } = await import('./onnx-camera.mjs');
  globalThis.requestAnimationFrame ||= (callback) => callback();
  const controller = createOnnxCameraController({ root: run.root, deps: run.deps });
  run.elements.get('onnxImageInput').files = [{ name: 'blocks.png', type: 'image/png', size: 1024 }];
  await run.elements.get('onnxImageInput').emit('change');
  run.deps.navigator.mediaDevices.getUserMedia = async () => {
    const error = new Error('synthetic camera denial');
    error.name = 'NotAllowedError';
    throw error;
  };
  await run.elements.get('onnxConnectCameraBtn').emit('click');

  assert.equal(run.elements.get('onnxCameraStage').dataset.mode, 'image');
  assert.equal(run.elements.get('onnxOverlayCanvas').hidden, false);
  assert.match(run.elements.get('onnxCameraStatus').textContent, /permission was denied/);
  await controller.destroy();
});

test('fake controller preserves a no-model live box for manual retry and keeps capture manual', async () => {
  const run = makeFixture();
  const { createOnnxCameraController } = await import('./onnx-camera.mjs');
  globalThis.requestAnimationFrame ||= (callback) => callback();
  const controller = createOnnxCameraController({ root: run.root, deps: run.deps });
  await run.elements.get('onnxConnectCameraBtn').emit('click');
  await run.elements.get('onnxLiveModeBtn').emit('click');
  const overlay = run.elements.get('onnxOverlayCanvas');
  await overlay.emit('pointerdown', { pointerId: 3, clientX: 24, clientY: 24 });
  await overlay.emit('pointerup', { pointerId: 3, clientX: 220, clientY: 220 });
  assert.match(run.elements.get('onnxCameraStatus').textContent, /Load a compatible/);
  assert.equal(run.fixture.videoSnapshotCalls, 1);
  run.elements.get('onnxModelInput').files = [run.file];
  await run.elements.get('onnxModelInput').emit('change');
  await run.elements.get('onnxPredictBtn').emit('click');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(run.session.runCalls, 1);
  assert.equal(run.elements.get('onnxResults').children.length, 1);
  await run.elements.get('onnxCaptureModeBtn').emit('click');
  assert.equal(run.elements.get('onnxOverlayCanvas').hidden, true);
  assert.equal(run.elements.get('onnxResults').children.length, 0, 'mode reset clears stale results');
  await run.elements.get('onnxDisconnectBtn').emit('click');
  assert.equal(run.elements.get('onnxResults').children.length, 0);
  await controller.destroy();
});

test('fake controller ignores a second live gesture while inference is busy', async () => {
  const run = makeFixture({ delayedRun: true });
  const { createOnnxCameraController } = await import('./onnx-camera.mjs');
  globalThis.requestAnimationFrame ||= (callback) => callback();
  const controller = createOnnxCameraController({ root: run.root, deps: run.deps });
  run.elements.get('onnxModelInput').files = [run.file];
  await run.elements.get('onnxModelInput').emit('change');
  await run.elements.get('onnxConnectCameraBtn').emit('click');
  await run.elements.get('onnxLiveModeBtn').emit('click');
  const overlay = run.elements.get('onnxOverlayCanvas');
  await overlay.emit('pointerdown', { pointerId: 4, clientX: 24, clientY: 24 });
  await overlay.emit('pointerup', { pointerId: 4, clientX: 220, clientY: 220 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await runLiveTick(run);
  await overlay.emit('pointerdown', { pointerId: 5, clientX: 30, clientY: 30 });
  await overlay.emit('pointerup', { pointerId: 5, clientX: 240, clientY: 240 });
  assert.equal(run.fixture.videoSnapshotCalls, 2);
  assert.equal(run.session.runCalls, 1);
  run.releaseRun?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await controller.destroy();
});

test('stage surface accepts a box gesture beneath the result overlay', async () => {
  const run = await bootFixture();
  await run.elements.get('onnxCaptureBtn').emit('click');
  run.fixture.stageRect = { left: 0, top: 0, width: 800, height: 450 };
  const stage = run.elements.get('onnxCameraStage');
  await stage.emit('pointerdown', { pointerId: 91, clientX: 0, clientY: 0 });
  await stage.emit('pointerup', { pointerId: 91, clientX: 800, clientY: 450 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(run.session.runCalls, 0, 'capture mode remains manual');
  await run.elements.get('onnxPredictBtn').emit('click');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(run.session.runCalls, 1);
  assert.equal(run.elements.get('onnxResults').children.length, 1);
  await run.controller.destroy();
});

test('controller publishes exactly once after each successful manual and live prediction', async () => {
  const manualPublisher = makePublisherSpy();
  const manual = await bootFixture({ predictionPublisher: manualPublisher });
  await drawCapturedBox(manual);
  await manual.elements.get('onnxPredictBtn').emit('click');
  assert.equal(manualPublisher.payloads.length, 1, 'manual success publishes once');
  assert.match(manualPublisher.payloads[0].summary, /^Predicted 1 box in \d+ ms\./);
  assert.equal(manualPublisher.payloads[0].lines.length, 1);
  assert.match(manualPublisher.payloads[0].lines[0], /^Box 1 · /);
  await manual.controller.destroy();

  const livePublisher = makePublisherSpy();
  const live = await bootFixture({ predictionPublisher: livePublisher });
  await live.elements.get('onnxLiveModeBtn').emit('click');
  const overlay = live.elements.get('onnxOverlayCanvas');
  await overlay.emit('pointerdown', { pointerId: 302, clientX: 24, clientY: 24 });
  await overlay.emit('pointerup', { pointerId: 302, clientX: 220, clientY: 220 });
  assert.equal(livePublisher.payloads.length, 0, 'drawing alone does not publish');
  await runLiveTick(live);
  assert.equal(livePublisher.payloads.length, 1, 'live success publishes once per completed tick');
  assert.equal(livePublisher.payloads[0].lines.length, 1);
  await live.controller.destroy();
});

test('controller does not publish failed or stale prediction results', async () => {
  const failedPublisher = makePublisherSpy();
  const failed = await bootFixture({
    predictionPublisher: failedPublisher,
    runError: new Error('synthetic inference failure'),
  });
  await drawCapturedBox(failed, 303);
  await failed.elements.get('onnxPredictBtn').emit('click');
  assert.equal(failedPublisher.payloads.length, 0, 'failed inference publishes nothing');
  assert.match(failed.elements.get('onnxCameraStatus').textContent, /Prediction failed/);
  await failed.controller.destroy();

  const stalePublisher = makePublisherSpy();
  const stale = await bootFixture({ predictionPublisher: stalePublisher, delayedRun: true });
  await drawCapturedBox(stale, 304);
  const pendingPrediction = stale.elements.get('onnxPredictBtn').emit('click');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stale.session.runCalls, 1, 'prediction reached the deferred inference');
  await stale.elements.get('onnxDisconnectBtn').emit('click');
  stale.releaseRun();
  await pendingPrediction;
  assert.equal(stalePublisher.payloads.length, 0, 'source-invalidated result publishes nothing');
  await stale.controller.destroy();
});

test('controller closes publisher synchronously before deferred session release', async () => {
  const publisher = makePublisherSpy();
  const run = await bootFixture({ predictionPublisher: publisher, deferredRelease: true });

  const pendingDestroy = run.controller.destroy();
  assert.equal(publisher.destroyCalls, 1, 'publisher closes before the first teardown await settles');
  assert.equal(run.session.released, undefined, 'session release is still deferred');

  run.releaseSession();
  await pendingDestroy;
  await run.controller.destroy();
  assert.equal(publisher.destroyCalls, 1, 'destroy remains idempotent');
  assert.equal(run.session.released, true);
});
