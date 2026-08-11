import {
  canAddNormalizedBox,
  clampNormalizedBox,
  computeCoverCrop,
  extractOnnxMetadata,
  imageDataToNchw,
  parseClassNames,
  resolveModelContract,
  topClassifications,
  validateOnnxFilename,
} from './onnx-camera-core.mjs';

const ORT_VERSION = '1.22.0';
const ORT_DIST = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const ORT_MODULE_URL = `${ORT_DIST}ort.webgpu.min.mjs`;
const MAX_BOXES = 7;
const MIN_BOX_SIZE = 12;
let runtimePromise = null;

const byId = (root, id) => root.querySelector(`#${id}`);
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = import(ORT_MODULE_URL).then((module) => {
      const ort = module.default ?? module;
      ort.env.wasm.wasmPaths = ORT_DIST;
      ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);
      return ort;
    });
  }
  return runtimePromise;
}

function waitForVideo(video) {
  if (video.readyState >= 1 && video.videoWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error('The selected camera did not provide a video frame.'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', ready);
      video.removeEventListener('error', failed);
    };
    const timeout = setTimeout(failed, 5000);
    video.addEventListener('loadedmetadata', ready, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}

export function createOnnxCameraController({ root }) {
  if (!root) throw new Error('AI camera panel is missing.');

  const nodes = {
    connect: byId(root, 'onnxConnectCameraBtn'),
    disconnect: byId(root, 'onnxDisconnectBtn'),
    modelInput: byId(root, 'onnxModelInput'),
    modelName: byId(root, 'onnxModelName'),
    provider: byId(root, 'onnxProviderStatus'),
    cameraSelect: byId(root, 'onnxCameraSelect'),
    stage: byId(root, 'onnxCameraStage'),
    video: byId(root, 'onnxCameraVideo'),
    frame: byId(root, 'onnxFrameCanvas'),
    overlay: byId(root, 'onnxOverlayCanvas'),
    empty: byId(root, 'onnxStageEmpty'),
    capture: byId(root, 'onnxCaptureBtn'),
    undo: byId(root, 'onnxUndoBtn'),
    clear: byId(root, 'onnxClearBtn'),
    predict: byId(root, 'onnxPredictBtn'),
    status: byId(root, 'onnxCameraStatus'),
    results: byId(root, 'onnxResults'),
  };
  const state = {
    busy: '',
    destroyed: false,
    stream: null,
    captured: false,
    boxes: [],
    results: [],
    draft: null,
    pointerId: null,
    pointerStart: null,
    ort: null,
    session: null,
    provider: '',
    fallbackUsed: false,
    modelBytes: null,
    contract: null,
    classNames: [],
    loadToken: 0,
    cameraToken: 0,
  };
  const workCanvas = document.createElement('canvas');

  function setStatus(message, type = '') {
    nodes.status.textContent = message;
    if (type) nodes.status.dataset.state = type;
    else delete nodes.status.dataset.state;
  }

  function setProvider(label, type = '') {
    nodes.provider.textContent = label;
    if (type) nodes.provider.dataset.state = type;
    else delete nodes.provider.dataset.state;
  }

  function updateControls() {
    const busy = Boolean(state.busy);
    nodes.modelInput.disabled = busy || state.destroyed;
    nodes.connect.disabled = busy || Boolean(state.stream) || state.destroyed;
    nodes.disconnect.disabled = busy || !state.stream;
    nodes.cameraSelect.disabled = busy || !state.stream;
    nodes.capture.disabled = busy || !state.stream;
    nodes.capture.textContent = state.captured ? 'Retake frame' : 'Capture frame';
    nodes.undo.disabled = busy || !state.captured || state.boxes.length === 0;
    nodes.clear.disabled = busy || !state.captured || state.boxes.length === 0;
    nodes.predict.disabled = busy || !state.session || !state.captured || state.boxes.length === 0;
    root.setAttribute('aria-busy', String(busy));
  }

  function setBusy(kind = '') {
    state.busy = kind;
    updateControls();
  }

  async function releaseSession() {
    const session = state.session;
    state.session = null;
    if (session?.release) await session.release().catch(() => {});
  }

  async function createSession(provider) {
    let session = null;
    try {
      session = await state.ort.InferenceSession.create(state.modelBytes, {
        executionProviders: [provider],
        graphOptimizationLevel: 'all',
      });
      const contract = resolveModelContract(session);
      return { session, contract };
    } catch (error) {
      await session?.release?.().catch(() => {});
      throw error;
    }
  }

  async function loadModel(file) {
    const token = ++state.loadToken;
    if (!file) return;
    if (!validateOnnxFilename(file.name)) {
      setBusy('model');
      nodes.modelName.textContent = file.name;
      await releaseSession();
      state.modelBytes = null;
      state.contract = null;
      state.classNames = [];
      state.provider = '';
      setProvider('MODEL ERROR', 'error');
      setStatus('Model filename needs to end in .onnx. Choose a YOLO26-cls export.', 'error');
      setBusy();
      return;
    }
    setBusy('model');
    setProvider('LOADING MODEL', 'loading');
    nodes.modelName.textContent = file.name;
    setStatus(`Loading ${file.name} locally…`);
    await nextFrame();
    try {
      const buffer = await file.arrayBuffer();
      const metadata = extractOnnxMetadata(buffer);
      const ort = await loadRuntime();
      if (token !== state.loadToken || state.destroyed) return;
      await releaseSession();
      state.ort = ort;
      state.modelBytes = new Uint8Array(buffer);
      state.classNames = parseClassNames(metadata.names);
      state.fallbackUsed = false;

      let provider = navigator.gpu ? 'webgpu' : 'wasm';
      let created;
      try {
        created = await createSession(provider);
      } catch (webgpuError) {
        if (provider !== 'webgpu') throw webgpuError;
        provider = 'wasm';
        created = await createSession(provider);
        state.fallbackUsed = true;
      }
      if (token !== state.loadToken || state.destroyed) {
        await created.session.release?.();
        return;
      }
      state.session = created.session;
      state.contract = created.contract;
      state.provider = provider;
      setProvider(provider.toUpperCase(), 'ready');
      const labels = state.classNames.length ? `${state.classNames.length} labels` : 'class index labels';
      setStatus(`${file.name} ready · ${created.contract.width}×${created.contract.height} · ${labels}`, 'success');
    } catch (error) {
      state.modelBytes = null;
      state.contract = null;
      state.provider = '';
      await releaseSession();
      setProvider('MODEL ERROR', 'error');
      setStatus(`Could not load this YOLO26-cls model. ${error.message}`, 'error');
    } finally {
      if (token === state.loadToken) setBusy();
    }
  }

  function stopStream() {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    nodes.video.srcObject = null;
  }

  function clearRegions() {
    state.boxes = [];
    state.results = [];
    state.draft = null;
    state.pointerStart = null;
    nodes.results.replaceChildren();
    drawOverlay();
    updateControls();
  }

  function showLiveFrame() {
    state.captured = false;
    clearRegions();
    nodes.frame.hidden = true;
    nodes.overlay.hidden = true;
    nodes.video.hidden = !state.stream;
    nodes.empty.hidden = Boolean(state.stream);
    nodes.stage.dataset.mode = state.stream ? 'live' : 'empty';
    updateControls();
  }

  async function populateCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const currentId = state.stream?.getVideoTracks()[0]?.getSettings?.().deviceId || '';
    nodes.cameraSelect.replaceChildren();
    cameras.forEach((camera, index) => {
      const option = document.createElement('option');
      option.value = camera.deviceId;
      option.textContent = camera.label || `Camera ${index + 1}`;
      option.selected = camera.deviceId === currentId;
      nodes.cameraSelect.append(option);
    });
  }

  async function connectCamera(deviceId = '') {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Camera access is unavailable. Open the IDE on HTTPS or localhost.', 'error');
      return;
    }
    const token = ++state.cameraToken;
    setBusy('camera');
    setStatus(deviceId ? 'Switching camera…' : 'Requesting camera access…');
    stopStream();
    let acquiredStream = null;
    try {
      const video = deviceId
        ? { deviceId: { exact: deviceId } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } };
      acquiredStream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      if (state.destroyed || token !== state.cameraToken) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        return;
      }
      state.stream = acquiredStream;
      nodes.video.srcObject = acquiredStream;
      await waitForVideo(nodes.video);
      if (state.destroyed || token !== state.cameraToken) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        return;
      }
      await nodes.video.play();
      nodes.stage.style.aspectRatio = `${nodes.video.videoWidth} / ${nodes.video.videoHeight}`;
      showLiveFrame();
      await populateCameras();
      setStatus('Camera connected. Capture a frame before drawing boxes.', 'success');
    } catch (error) {
      acquiredStream?.getTracks().forEach((track) => track.stop());
      if (state.destroyed || token !== state.cameraToken) return;
      stopStream();
      showLiveFrame();
      const denied = error?.name === 'NotAllowedError';
      setStatus(
        denied
          ? 'Camera permission was denied. Allow camera access in the browser, then connect again.'
          : `Could not connect this camera. ${error.message}`,
        'error',
      );
    } finally {
      if (!state.destroyed && token === state.cameraToken) setBusy();
    }
  }

  function disconnectCamera() {
    state.cameraToken += 1;
    stopStream();
    showLiveFrame();
    nodes.cameraSelect.replaceChildren(new Option('Connect to list cameras', ''));
    setStatus('Camera disconnected. Connect a camera to continue.');
  }

  function captureFrame() {
    if (state.captured) {
      showLiveFrame();
      setStatus('Live camera restored. Capture a new frame when ready.');
      return;
    }
    const width = nodes.video.videoWidth;
    const height = nodes.video.videoHeight;
    if (!width || !height) {
      setStatus('The camera frame is not ready yet. Try Capture frame again.', 'error');
      return;
    }
    nodes.frame.width = width;
    nodes.frame.height = height;
    nodes.overlay.width = width;
    nodes.overlay.height = height;
    nodes.frame.getContext('2d').drawImage(nodes.video, 0, 0, width, height);
    nodes.video.hidden = true;
    nodes.frame.hidden = false;
    nodes.overlay.hidden = false;
    nodes.empty.hidden = true;
    nodes.stage.dataset.mode = 'captured';
    state.captured = true;
    clearRegions();
    setStatus('Frame captured. Draw 1–7 boxes, then choose Predict all.');
    updateControls();
  }

  function pointerPosition(event) {
    const rect = nodes.overlay.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      rect,
    };
  }

  function drawOverlay() {
    const context = nodes.overlay.getContext('2d');
    context.clearRect(0, 0, nodes.overlay.width, nodes.overlay.height);
    if (!state.captured) return;
    const boxes = state.draft ? [...state.boxes, state.draft] : state.boxes;
    const displayWidth = nodes.overlay.getBoundingClientRect().width || nodes.overlay.width;
    const scale = nodes.overlay.width / displayWidth;
    context.font = `700 ${Math.max(11, 11 * scale)}px Consolas, monospace`;
    context.textBaseline = 'top';
    boxes.forEach((box, index) => {
      const x = box.x1 * nodes.overlay.width;
      const y = box.y1 * nodes.overlay.height;
      const width = (box.x2 - box.x1) * nodes.overlay.width;
      const height = (box.y2 - box.y1) * nodes.overlay.height;
      const top = state.results[index]?.[0];
      const label = top ? `${index + 1} · ${top.label} ${(top.confidence * 100).toFixed(1)}%` : `BOX ${index + 1}`;
      context.strokeStyle = '#f47b20';
      context.lineWidth = Math.max(2, 2 * scale);
      context.strokeRect(x, y, width, height);
      const padding = 4 * scale;
      const labelHeight = 18 * scale;
      const labelWidth = Math.min(width, context.measureText(label).width + padding * 2);
      context.fillStyle = '#f47b20';
      context.fillRect(x, Math.max(0, y - labelHeight), labelWidth, labelHeight);
      context.fillStyle = '#ffffff';
      context.fillText(label, x + padding, Math.max(0, y - labelHeight) + 3 * scale, Math.max(0, labelWidth - padding * 2));
    });
  }

  function finishBox(event) {
    if (state.pointerId !== event.pointerId || !state.draft || !state.pointerStart) return;
    const position = pointerPosition(event);
    const box = clampNormalizedBox({ x1: state.pointerStart.x, y1: state.pointerStart.y, x2: position.x, y2: position.y });
    state.pointerId = null;
    state.draft = null;
    state.pointerStart = null;
    if (canAddNormalizedBox(box, position.rect.width, position.rect.height, state.boxes.length, { maxBoxes: MAX_BOXES, minSize: MIN_BOX_SIZE })) {
      state.boxes.push(box);
      state.results = [];
      nodes.results.replaceChildren();
      setStatus(`${state.boxes.length}/${MAX_BOXES} boxes ready. ${state.boxes.length < MAX_BOXES ? 'Draw another or predict all.' : 'Maximum reached; predict all or undo.'}`);
    } else {
      setStatus(`Box was too small. Draw a region at least ${MIN_BOX_SIZE}×${MIN_BOX_SIZE} pixels.`, 'error');
    }
    drawOverlay();
    updateControls();
  }

  function renderResults() {
    nodes.results.replaceChildren();
    state.results.forEach((result, index) => {
      const item = document.createElement('li');
      item.className = 'onnx-result';
      const title = document.createElement('strong');
      title.textContent = `Box ${index + 1} · ${result[0].label}`;
      const details = document.createElement('span');
      details.textContent = result.map((entry) => `${entry.label} ${(entry.confidence * 100).toFixed(1)}%`).join(' · ');
      item.append(title, details);
      nodes.results.append(item);
    });
    drawOverlay();
  }

  function tensorForBox(box) {
    const frameWidth = nodes.frame.width;
    const frameHeight = nodes.frame.height;
    const boxWidth = (box.x2 - box.x1) * frameWidth;
    const boxHeight = (box.y2 - box.y1) * frameHeight;
    const crop = computeCoverCrop(boxWidth, boxHeight, state.contract.width, state.contract.height);
    workCanvas.width = state.contract.width;
    workCanvas.height = state.contract.height;
    const context = workCanvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      nodes.frame,
      box.x1 * frameWidth + crop.x,
      box.y1 * frameHeight + crop.y,
      crop.width,
      crop.height,
      0,
      0,
      state.contract.width,
      state.contract.height,
    );
    const image = context.getImageData(0, 0, state.contract.width, state.contract.height);
    return new state.ort.Tensor(
      'float32',
      imageDataToNchw(image),
      [1, 3, state.contract.height, state.contract.width],
    );
  }

  async function fallBackToWasm() {
    if (state.provider !== 'webgpu' || state.fallbackUsed) return false;
    const prior = state.session;
    state.session = null;
    const created = await createSession('wasm');
    state.session = created.session;
    state.contract = created.contract;
    state.provider = 'wasm';
    state.fallbackUsed = true;
    await prior?.release?.().catch(() => {});
    setProvider('WASM', 'ready');
    return true;
  }

  async function inferBox(box) {
    const run = async () => {
      const tensor = tensorForBox(box);
      const outputs = await state.session.run({ [state.contract.inputName]: tensor });
      const output = outputs[state.contract.outputName];
      return topClassifications(output?.data, state.classNames, 3);
    };
    try {
      return await run();
    } catch (error) {
      if (!(await fallBackToWasm())) throw error;
      return run();
    }
  }

  async function predictAll() {
    if (!state.session || !state.captured || !state.boxes.length) return;
    setBusy('predict');
    setStatus(`Classifying ${state.boxes.length} ${state.boxes.length === 1 ? 'box' : 'boxes'}…`);
    const started = performance.now();
    try {
      const nextResults = [];
      for (const box of state.boxes) nextResults.push(await inferBox(box));
      state.results = nextResults;
      renderResults();
      const elapsed = Math.round(performance.now() - started);
      setStatus(`Predicted ${state.boxes.length} ${state.boxes.length === 1 ? 'box' : 'boxes'} in ${elapsed} ms. Boxes are ready to run again.`, 'success');
    } catch (error) {
      setStatus(`Prediction failed. Your frame and boxes were kept. ${error.message}`, 'error');
    } finally {
      setBusy();
    }
  }

  async function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    state.loadToken += 1;
    state.cameraToken += 1;
    stopStream();
    await releaseSession();
    window.removeEventListener('pagehide', destroy);
  }

  nodes.modelInput.addEventListener('change', () => loadModel(nodes.modelInput.files?.[0]));
  nodes.connect.addEventListener('click', () => connectCamera());
  nodes.disconnect.addEventListener('click', disconnectCamera);
  nodes.cameraSelect.addEventListener('change', () => connectCamera(nodes.cameraSelect.value));
  nodes.capture.addEventListener('click', captureFrame);
  nodes.undo.addEventListener('click', () => {
    state.boxes.pop();
    state.results = [];
    nodes.results.replaceChildren();
    drawOverlay();
    updateControls();
    setStatus(state.boxes.length ? `${state.boxes.length}/${MAX_BOXES} boxes ready.` : 'Draw at least one box before predicting.');
  });
  nodes.clear.addEventListener('click', () => {
    clearRegions();
    setStatus('Boxes cleared. Draw 1–7 new boxes on this frame.');
  });
  nodes.predict.addEventListener('click', predictAll);
  nodes.overlay.addEventListener('pointerdown', (event) => {
    if (!state.captured || state.busy || state.boxes.length >= MAX_BOXES) return;
    const point = pointerPosition(event);
    state.pointerId = event.pointerId;
    state.pointerStart = point;
    state.draft = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    nodes.overlay.setPointerCapture(event.pointerId);
  });
  nodes.overlay.addEventListener('pointermove', (event) => {
    if (state.pointerId !== event.pointerId || !state.pointerStart) return;
    const point = pointerPosition(event);
    state.draft = clampNormalizedBox({ x1: state.pointerStart.x, y1: state.pointerStart.y, x2: point.x, y2: point.y });
    drawOverlay();
  });
  nodes.overlay.addEventListener('pointerup', finishBox);
  nodes.overlay.addEventListener('pointercancel', finishBox);
  nodes.overlay.addEventListener('keydown', (event) => {
    if ((event.key === 'Backspace' || event.key === 'Delete') && state.boxes.length) nodes.undo.click();
    if ((event.key === 'Enter' || event.key === ' ') && state.captured && state.boxes.length < MAX_BOXES) {
      event.preventDefault();
      const index = state.boxes.length;
      const column = index % 3;
      const row = Math.floor(index / 3);
      state.boxes.push({ x1: 0.05 + column * 0.31, y1: 0.05 + row * 0.31, x2: 0.31 + column * 0.31, y2: 0.31 + row * 0.31 });
      state.results = [];
      nodes.results.replaceChildren();
      drawOverlay();
      updateControls();
      setStatus(`${state.boxes.length}/${MAX_BOXES} boxes ready. Press Enter to add another preset box or predict all.`);
    }
  });
  window.addEventListener('pagehide', destroy, { once: true });

  setProvider('MODEL OFF');
  setStatus('Load a model and connect a camera to begin.');
  updateControls();
  return { destroy, stopStream };
}
