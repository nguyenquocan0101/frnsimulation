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

export function computeDisplayRect(stageRect, mediaAspect) {
  const width = Number(stageRect?.width) || 0;
  const height = Number(stageRect?.height) || 0;
  const aspect = Number(mediaAspect) || 0;
  if (!width || !height || !aspect) return { left: stageRect?.left || 0, top: stageRect?.top || 0, width, height };
  if (width / height > aspect) {
    const mediaWidth = height * aspect;
    return { left: (stageRect.left || 0) + (width - mediaWidth) / 2, top: stageRect.top || 0, width: mediaWidth, height };
  }
  const mediaHeight = width / aspect;
  return { left: stageRect.left || 0, top: (stageRect.top || 0) + (height - mediaHeight) / 2, width, height: mediaHeight };
}

export async function predictBoxesSequentially(boxes, inferBox, shouldContinue = () => true) {
  const results = [];
  for (const box of boxes) {
    if (!shouldContinue()) return null;
    results.push(await inferBox(box));
    if (!shouldContinue()) return null;
  }
  return results;
}

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

export function createOnnxCameraController({ root, deps = {} }) {
  if (!root) throw new Error('AI camera panel is missing.');
  const documentRef = deps.document ?? document;
  const navigatorRef = deps.navigator ?? navigator;
  const windowRef = deps.window ?? window;
  const performanceRef = deps.performance ?? performance;
  const runtimeLoader = deps.loadRuntime ?? loadRuntime;
  const nextFrameRef = deps.nextFrame ?? nextFrame;

  const nodes = {
    connect: byId(root, 'onnxConnectCameraBtn'),
    disconnect: byId(root, 'onnxDisconnectBtn'),
    modelInput: byId(root, 'onnxModelInput'),
    modelName: byId(root, 'onnxModelName'),
    provider: byId(root, 'onnxProviderStatus'),
    cameraSelect: byId(root, 'onnxCameraSelect'),
    stage: byId(root, 'onnxCameraStage'),
    captureMode: byId(root, 'onnxCaptureModeBtn'),
    liveMode: byId(root, 'onnxLiveModeBtn'),
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
    overlayResults: byId(root, 'onnxOverlayResults'),
  };
  const state = {
    busy: '',
    destroyed: false,
    stream: null,
    mode: 'capture',
    frameReady: false,
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
    sourceToken: 0,
    predictionToken: 0,
  };
  const workCanvas = documentRef.createElement('canvas');
  const handledPointerEvents = new WeakSet();

  function claimPointerEvent(event) {
    if (handledPointerEvents.has(event)) return false;
    handledPointerEvents.add(event);
    return true;
  }

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

  function clearResultViews() {
    nodes.results.replaceChildren();
    nodes.overlayResults?.replaceChildren();
  }

  function updateControls() {
    const busy = Boolean(state.busy);
    const hasStream = Boolean(state.stream);
    nodes.modelInput.disabled = busy || state.destroyed;
    nodes.connect.disabled = busy || hasStream || state.destroyed;
    nodes.disconnect.disabled = busy || !hasStream;
    nodes.cameraSelect.disabled = busy || !hasStream;
    nodes.capture.disabled = busy || !hasStream;
    nodes.capture.textContent = state.mode === 'capture' && state.frameReady ? 'Retake frame' : 'Capture frame';
    nodes.captureMode.disabled = busy || state.destroyed;
    nodes.liveMode.disabled = busy || state.destroyed;
    nodes.captureMode.setAttribute('aria-pressed', String(state.mode === 'capture'));
    nodes.liveMode.setAttribute('aria-pressed', String(state.mode === 'live'));
    nodes.overlay.setAttribute('aria-disabled', String(busy || state.mode === 'live' && (!hasStream || nodes.video.readyState < 2)));
    nodes.overlay.setAttribute('aria-label', state.mode === 'live'
      ? 'Draw classification boxes on the running camera. Each completed box is snapshotted and predicted.'
      : 'Draw classification boxes on the captured frame. Press Enter to add a preset box.');
    nodes.undo.disabled = busy || !state.frameReady || state.boxes.length === 0;
    nodes.clear.disabled = busy || !state.frameReady || state.boxes.length === 0;
    nodes.predict.disabled = busy || !state.session || !state.frameReady || state.boxes.length === 0;
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

  async function createSession(provider, { modelBytes = state.modelBytes, ort = state.ort } = {}) {
    let session = null;
    try {
      session = await ort.InferenceSession.create(modelBytes, {
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
    state.sourceToken += 1;
    state.predictionToken += 1;
    state.results = [];
    clearResultViews();
    drawOverlay();
    if (!validateOnnxFilename(file.name)) {
      setBusy('model');
      nodes.modelName.textContent = file.name;
      if (token !== state.loadToken || state.destroyed) return;
      await releaseSession();
      if (token !== state.loadToken || state.destroyed) return;
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
    await nextFrameRef();
    if (token !== state.loadToken || state.destroyed) return;
    try {
      const buffer = await file.arrayBuffer();
      const metadata = extractOnnxMetadata(buffer);
      const ort = await runtimeLoader();
      if (token !== state.loadToken || state.destroyed) return;
      const modelBytes = new Uint8Array(buffer);
      const classNames = parseClassNames(metadata.names);
      await releaseSession();
      if (token !== state.loadToken || state.destroyed) return;
      state.ort = ort;
      state.modelBytes = modelBytes;
      state.classNames = classNames;

      let provider = navigatorRef.gpu ? 'webgpu' : 'wasm';
      let usedFallback = false;
      let created;
      try {
        created = await createSession(provider, { modelBytes, ort });
      } catch (webgpuError) {
        if (provider !== 'webgpu') throw webgpuError;
        provider = 'wasm';
        created = await createSession(provider, { modelBytes, ort });
        usedFallback = true;
      }
      if (token !== state.loadToken || state.destroyed) {
        await created.session.release?.();
        return;
      }
      state.session = created.session;
      state.contract = created.contract;
      state.provider = provider;
      state.fallbackUsed = usedFallback;
      setProvider(provider.toUpperCase(), 'ready');
      const labels = state.classNames.length ? `${state.classNames.length} labels` : 'class index labels';
      setStatus(`${file.name} ready · ${created.contract.width}×${created.contract.height} · ${labels}`, 'success');
    } catch (error) {
      if (token !== state.loadToken || state.destroyed) return;
      state.modelBytes = null;
      state.contract = null;
      state.provider = '';
      await releaseSession();
      if (token !== state.loadToken || state.destroyed) return;
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

  function clearRegions({ clearFrame = false, invalidate = false } = {}) {
    if (invalidate) {
      state.sourceToken += 1;
      state.predictionToken += 1;
    }
    state.boxes = [];
    state.results = [];
    state.draft = null;
    state.pointerId = null;
    state.pointerStart = null;
    if (clearFrame) {
      state.frameReady = false;
      state.captured = false;
    }
    clearResultViews();
    drawOverlay();
    updateControls();
  }

  function updateStage() {
    nodes.frame.hidden = true;
    nodes.video.hidden = !(state.stream && (state.mode === 'live' || !state.frameReady));
    nodes.frame.hidden = !(state.mode === 'capture' && state.frameReady);
    nodes.overlay.hidden = !(state.stream && (state.mode === 'live' || state.frameReady));
    nodes.empty.hidden = Boolean(state.stream);
    nodes.stage.dataset.mode = state.stream ? (state.mode === 'live' ? 'live' : (state.frameReady ? 'captured' : 'capture')) : 'empty';
    updateControls();
  }

  function showLiveFrame({ clearFrame = true } = {}) {
    clearRegions({ clearFrame, invalidate: true });
    updateStage();
  }

  function setMode(mode, { announce = true } = {}) {
    if (state.busy || !['capture', 'live'].includes(mode)) return false;
    state.mode = mode;
    clearRegions({ clearFrame: true, invalidate: true });
    updateStage();
    if (announce) {
      setStatus(mode === 'live'
        ? (state.stream ? 'Draw live enabled. Each box snapshots the current frame and predicts all boxes.' : 'Draw live selected. Connect a camera to begin.')
        : 'Capture frame selected. Capture a frame, draw boxes, then choose Predict all.');
    }
    return true;
  }

  async function populateCameras() {
    const devices = await navigatorRef.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const currentId = state.stream?.getVideoTracks()[0]?.getSettings?.().deviceId || '';
    nodes.cameraSelect.replaceChildren();
    cameras.forEach((camera, index) => {
      const option = documentRef.createElement('option');
      option.value = camera.deviceId;
      option.textContent = camera.label || `Camera ${index + 1}`;
      option.selected = camera.deviceId === currentId;
      nodes.cameraSelect.append(option);
    });
  }

  async function connectCamera(deviceId = '') {
    if (!navigatorRef.mediaDevices?.getUserMedia) {
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
      acquiredStream = await navigatorRef.mediaDevices.getUserMedia({ video, audio: false });
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
      clearRegions({ clearFrame: true, invalidate: true });
      updateStage();
      await populateCameras();
      setStatus(state.mode === 'live'
        ? 'Camera connected. Draw a box on the live video.'
        : 'Camera connected. Capture a frame before drawing boxes.', 'success');
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
    const option = documentRef.createElement('option');
    option.value = '';
    option.textContent = 'Connect to list cameras';
    nodes.cameraSelect.replaceChildren(option);
    setStatus('Camera disconnected. Connect a camera to continue.');
  }

  function snapshotVideoFrame({ clearSelection = true } = {}) {
    const width = nodes.video.videoWidth;
    const height = nodes.video.videoHeight;
    if (nodes.video.readyState < 2 || !width || !height) {
      setStatus('The camera frame is not ready yet. Wait for a live frame, then try again.', 'error');
      return false;
    }
    const nextFrameCanvas = documentRef.createElement('canvas');
    nextFrameCanvas.id = 'onnxFrameCanvas';
    nextFrameCanvas.hidden = true;
    nextFrameCanvas.width = width;
    nextFrameCanvas.height = height;
    try {
      nextFrameCanvas.getContext('2d').drawImage(nodes.video, 0, 0, width, height);
    } catch (error) {
      setStatus(`Could not snapshot the camera frame. ${error.message}`, 'error');
      return false;
    }
    nodes.frame.replaceWith(nextFrameCanvas);
    nodes.frame = nextFrameCanvas;
    nodes.overlay.width = width;
    nodes.overlay.height = height;
    state.frameReady = true;
    state.captured = true;
    if (clearSelection) clearRegions({ invalidate: true });
    updateStage();
    return true;
  }

  function captureFrame() {
    if (state.mode === 'capture' && state.frameReady) {
      clearRegions({ clearFrame: true, invalidate: true });
      updateStage();
      setStatus('Live camera restored. Capture a new frame when ready.');
      return;
    }
    if (!snapshotVideoFrame()) return;
    state.mode = 'capture';
    updateStage();
    setStatus('Frame captured. Draw 1–7 boxes, then choose Predict all.');
    updateControls();
  }

  function pointerPosition(event) {
    const stageRect = nodes.stage.getBoundingClientRect();
    const contentRect = {
      left: stageRect.left + (Number(nodes.stage.clientLeft) || 0),
      top: stageRect.top + (Number(nodes.stage.clientTop) || 0),
      width: Number(nodes.stage.clientWidth) || stageRect.width,
      height: Number(nodes.stage.clientHeight) || stageRect.height,
    };
    const mediaWidth = state.mode === 'live' ? nodes.video.videoWidth : nodes.frame.width;
    const mediaHeight = state.mode === 'live' ? nodes.video.videoHeight : nodes.frame.height;
    const rect = computeDisplayRect(contentRect, mediaWidth && mediaHeight ? mediaWidth / mediaHeight : 0);
    const inside = event.clientX >= rect.left && event.clientX <= rect.left + rect.width
      && event.clientY >= rect.top && event.clientY <= rect.top + rect.height;
    const stageRight = Number(stageRect.right) || stageRect.left + stageRect.width;
    const stageBottom = Number(stageRect.bottom) || stageRect.top + stageRect.height;
    const stageInside = event.clientX >= stageRect.left && event.clientX <= stageRight
      && event.clientY >= stageRect.top && event.clientY <= stageBottom;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      rect,
      inside,
      stageInside,
    };
  }

  function drawOverlay() {
    const context = nodes.overlay.getContext('2d');
    context.clearRect(0, 0, nodes.overlay.width, nodes.overlay.height);
    if (!state.frameReady && state.mode !== 'live') return;
    const boxes = state.draft ? [...state.boxes, state.draft] : state.boxes;
    const mediaWidth = state.mode === 'live' ? nodes.video.videoWidth : nodes.frame.width;
    const mediaHeight = state.mode === 'live' ? nodes.video.videoHeight : nodes.frame.height;
    const stageRect = nodes.stage.getBoundingClientRect();
    const contentRect = {
      left: stageRect.left + (Number(nodes.stage.clientLeft) || 0),
      top: stageRect.top + (Number(nodes.stage.clientTop) || 0),
      width: Number(nodes.stage.clientWidth) || stageRect.width,
      height: Number(nodes.stage.clientHeight) || stageRect.height,
    };
    const displayRect = computeDisplayRect(contentRect, mediaWidth && mediaHeight ? mediaWidth / mediaHeight : 0);
    const scale = nodes.overlay.width / (displayRect.width || nodes.overlay.width);
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

  function cancelDraft(event) {
    if (state.pointerId !== event.pointerId) return;
    state.pointerId = null;
    state.draft = null;
    state.pointerStart = null;
    drawOverlay();
  }

  function finishBox(event) {
    if (state.pointerId !== event.pointerId || !state.draft || !state.pointerStart) return;
    if (state.busy) return cancelDraft(event);
    const position = pointerPosition(event);
    const box = clampNormalizedBox({ x1: state.pointerStart.x, y1: state.pointerStart.y, x2: position.x, y2: position.y });
    state.pointerId = null;
    state.draft = null;
    state.pointerStart = null;
    if (canAddNormalizedBox(box, position.rect.width, position.rect.height, state.boxes.length, { maxBoxes: MAX_BOXES, minSize: MIN_BOX_SIZE })) {
      if (state.mode === 'live' && !snapshotVideoFrame({ clearSelection: false })) {
        drawOverlay();
        updateControls();
        return;
      }
      if (state.mode === 'live') {
        state.sourceToken += 1;
        state.predictionToken += 1;
      }
      state.boxes.push(box);
      state.results = [];
      clearResultViews();
      drawOverlay();
      updateControls();
      if (state.mode === 'live') {
        if (state.session) {
          void predictAll({ trigger: 'live', sourceToken: state.sourceToken });
        } else {
          setStatus(`${state.boxes.length}/${MAX_BOXES} box${state.boxes.length === 1 ? '' : 'es'} kept. Load a compatible .onnx model, then choose Predict all.`, 'error');
        }
        return;
      }
      setStatus(`${state.boxes.length}/${MAX_BOXES} boxes ready. ${state.boxes.length < MAX_BOXES ? 'Draw another or predict all.' : 'Maximum reached; predict all or undo.'}`);
    } else {
      setStatus(`Box was too small. Draw a region at least ${MIN_BOX_SIZE}×${MIN_BOX_SIZE} pixels.`, 'error');
    }
    drawOverlay();
    updateControls();
  }

  function renderResults() {
    clearResultViews();
    state.results.forEach((result, index) => {
      const title = `Box ${index + 1} · ${result[0].label}`;
      const details = result.map((entry) => `${entry.label} ${(entry.confidence * 100).toFixed(1)}%`).join(' · ');
      const makeItem = (className) => {
        const item = documentRef.createElement('li');
        item.className = className;
        const titleNode = documentRef.createElement('strong');
        titleNode.textContent = title;
        const detailsNode = documentRef.createElement('span');
        detailsNode.textContent = details;
        item.append(titleNode, detailsNode);
        return item;
      };
      nodes.results.append(makeItem('onnx-result'));
      nodes.overlayResults?.append(makeItem('onnx-result onnx-overlay-result'));
    });
    drawOverlay();
  }

  function tensorForBox(box, contract = state.contract, ort = state.ort) {
    const frameWidth = nodes.frame.width;
    const frameHeight = nodes.frame.height;
    const boxWidth = (box.x2 - box.x1) * frameWidth;
    const boxHeight = (box.y2 - box.y1) * frameHeight;
    const crop = computeCoverCrop(boxWidth, boxHeight, contract.width, contract.height);
    workCanvas.width = contract.width;
    workCanvas.height = contract.height;
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
      contract.width,
      contract.height,
    );
    const image = context.getImageData(0, 0, contract.width, contract.height);
    return new ort.Tensor(
      'float32',
      imageDataToNchw(image),
      [1, 3, contract.height, contract.width],
    );
  }

  async function fallBackToWasm(context, runToken) {
    if (context.provider !== 'webgpu' || state.fallbackUsed || state.destroyed) return false;
    const prior = context.session;
    const created = await createSession('wasm', { modelBytes: context.modelBytes, ort: context.ort });
    if (state.destroyed || state.predictionToken !== runToken || state.loadToken !== context.loadToken || state.session !== prior) {
      await created.session.release?.().catch(() => {});
      return false;
    }
    await prior?.release?.().catch(() => {});
    if (state.destroyed || state.predictionToken !== runToken || state.loadToken !== context.loadToken || state.session !== prior) {
      if (state.session === prior) {
        state.session = null;
        state.contract = null;
        state.provider = '';
      }
      await created.session.release?.().catch(() => {});
      return false;
    }
    state.session = created.session;
    state.contract = created.contract;
    state.provider = 'wasm';
    state.fallbackUsed = true;
    context.session = created.session;
    context.contract = created.contract;
    context.provider = 'wasm';
    setProvider('WASM', 'ready');
    return true;
  }

  async function inferBox(box, context, runToken) {
    const run = async () => {
      const tensor = tensorForBox(box, context.contract, context.ort);
      const outputs = await context.session.run({ [context.contract.inputName]: tensor });
      const output = outputs[context.contract.outputName];
      return topClassifications(output?.data, context.classNames, 3);
    };
    try {
      return await run();
    } catch (error) {
      if (!(await fallBackToWasm(context, runToken))) throw error;
      return run();
    }
  }

  async function predictAll({ trigger = 'manual', sourceToken = state.sourceToken } = {}) {
    if (trigger === 'live' && state.mode !== 'live') return;
    if (!state.session || !state.frameReady || !state.boxes.length || state.busy) {
      if (trigger === 'live' && !state.session && state.boxes.length) {
        setStatus('Load a compatible .onnx model, then choose Predict all to retry these boxes.', 'error');
      }
      return;
    }
    const runToken = ++state.predictionToken;
    const context = {
      session: state.session,
      contract: state.contract,
      provider: state.provider,
      modelBytes: state.modelBytes,
      ort: state.ort,
      classNames: state.classNames.slice(),
      loadToken: state.loadToken,
    };
    const boxes = state.boxes.slice();
    setBusy('predict');
    setStatus(`Classifying ${boxes.length} ${boxes.length === 1 ? 'box' : 'boxes'}…`);
    const started = performanceRef.now();
    try {
      const nextResults = await predictBoxesSequentially(
        boxes,
        (box) => inferBox(box, context, runToken),
        () => !state.destroyed && state.predictionToken === runToken && state.sourceToken === sourceToken,
      );
      if (!nextResults) return;
      state.results = nextResults;
      renderResults();
      const elapsed = Math.round(performanceRef.now() - started);
      setStatus(`Predicted ${boxes.length} ${boxes.length === 1 ? 'box' : 'boxes'} in ${elapsed} ms. Boxes are ready to run again.`, 'success');
    } catch (error) {
      if (!state.destroyed && state.predictionToken === runToken && state.sourceToken === sourceToken) {
        setStatus(`Prediction failed. Your frame and boxes were kept. ${error.message}`, 'error');
      }
    } finally {
      if (!state.destroyed && state.predictionToken === runToken) setBusy();
    }
  }

  async function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    state.loadToken += 1;
    state.cameraToken += 1;
    state.sourceToken += 1;
    state.predictionToken += 1;
    stopStream();
    await releaseSession();
    windowRef.removeEventListener('pagehide', destroy);
  }

  nodes.modelInput.addEventListener('change', () => loadModel(nodes.modelInput.files?.[0]));
  nodes.connect.addEventListener('click', () => connectCamera());
  nodes.disconnect.addEventListener('click', disconnectCamera);
  nodes.cameraSelect.addEventListener('change', () => connectCamera(nodes.cameraSelect.value));
  nodes.capture.addEventListener('click', captureFrame);
  nodes.captureMode.addEventListener('click', () => setMode('capture'));
  nodes.liveMode.addEventListener('click', () => setMode('live'));
  nodes.undo.addEventListener('click', () => {
    if (state.busy) return;
    state.boxes.pop();
    state.results = [];
    state.predictionToken += 1;
    clearResultViews();
    drawOverlay();
    updateControls();
    setStatus(state.boxes.length ? `${state.boxes.length}/${MAX_BOXES} boxes ready.` : 'Draw at least one box before predicting.');
  });
  nodes.clear.addEventListener('click', () => {
    if (state.busy) return;
    clearRegions({ invalidate: true });
    setStatus('Boxes cleared. Draw 1–7 new boxes on this frame.');
  });
  nodes.predict.addEventListener('click', predictAll);
  const handlePointerDown = (event) => {
    if (!claimPointerEvent(event)) return;
    const liveReady = state.mode === 'live' && state.stream && nodes.video.readyState >= 2 && nodes.video.videoWidth;
    const captureReady = state.mode === 'capture' && state.frameReady;
    if ((!liveReady && !captureReady) || state.busy || state.boxes.length >= MAX_BOXES) return;
    const point = pointerPosition(event);
    if (!point.stageInside) return;
    state.pointerId = event.pointerId;
    state.pointerStart = point;
    state.draft = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    (event.currentTarget?.setPointerCapture ? event.currentTarget : nodes.overlay).setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event) => {
    if (!claimPointerEvent(event)) return;
    if (state.pointerId !== event.pointerId || !state.pointerStart) return;
    const point = pointerPosition(event);
    state.draft = clampNormalizedBox({ x1: state.pointerStart.x, y1: state.pointerStart.y, x2: point.x, y2: point.y });
    drawOverlay();
  };
  const handlePointerUp = (event) => {
    if (!claimPointerEvent(event)) return;
    finishBox(event);
  };
  const handlePointerCancel = (event) => {
    if (!claimPointerEvent(event)) return;
    cancelDraft(event);
  };
  for (const surface of [nodes.overlay, nodes.stage]) {
    surface.addEventListener('pointerdown', handlePointerDown);
    surface.addEventListener('pointermove', handlePointerMove);
    surface.addEventListener('pointerup', handlePointerUp);
    surface.addEventListener('pointercancel', handlePointerCancel);
    surface.addEventListener('lostpointercapture', handlePointerCancel);
  }
  nodes.overlay.addEventListener('keydown', (event) => {
    if (state.busy) return;
    if ((event.key === 'Backspace' || event.key === 'Delete') && state.boxes.length) nodes.undo.click();
    if ((event.key === 'Enter' || event.key === ' ') && state.mode === 'capture' && state.frameReady && state.boxes.length < MAX_BOXES) {
      event.preventDefault();
      const index = state.boxes.length;
      const column = index % 3;
      const row = Math.floor(index / 3);
      state.boxes.push({ x1: 0.05 + column * 0.31, y1: 0.05 + row * 0.31, x2: 0.31 + column * 0.31, y2: 0.31 + row * 0.31 });
      state.results = [];
      clearResultViews();
      drawOverlay();
      updateControls();
      setStatus(`${state.boxes.length}/${MAX_BOXES} boxes ready. Press Enter to add another preset box or predict all.`);
    }
  });
  windowRef.addEventListener('pagehide', destroy, { once: true });

  setProvider('MODEL OFF');
  setStatus('');
  updateStage();
  return { destroy, stopStream };
}
