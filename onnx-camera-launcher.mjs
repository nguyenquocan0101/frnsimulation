export const ONNX_CAMERA_WINDOW_NAME = 'techcamp-onnx-camera';
export const ONNX_CAMERA_WINDOW_URL = './onnx-camera-window.html';
export const ONNX_CAMERA_WINDOW_SIZE = Object.freeze({ width: 1100, height: 800 });

function safeClosed(reference) {
  try {
    return !reference || reference.closed;
  } catch {
    return true;
  }
}

function safeFocus(reference) {
  try {
    if (typeof reference?.focus !== 'function') return false;
    reference.focus();
    return true;
  } catch {
    return false;
  }
}

function dimension(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function screenCoordinate(value) {
  return Number.isFinite(value) ? value : 0;
}

export function getOnnxCameraWindowFeatures(screenRef = globalThis.screen) {
  const availWidth = dimension(screenRef?.availWidth, ONNX_CAMERA_WINDOW_SIZE.width);
  const availHeight = dimension(screenRef?.availHeight, ONNX_CAMERA_WINDOW_SIZE.height);
  const width = Math.min(ONNX_CAMERA_WINDOW_SIZE.width, Math.max(320, availWidth - 24));
  const height = Math.min(ONNX_CAMERA_WINDOW_SIZE.height, Math.max(320, availHeight - 48));
  const leftBase = screenCoordinate(screenRef?.availLeft);
  const topBase = screenCoordinate(screenRef?.availTop);
  const left = Math.round(leftBase + Math.max(0, (availWidth - width) / 2));
  const top = Math.round(topBase + Math.max(0, (availHeight - height) / 2));
  return `popup=yes,width=${Math.round(width)},height=${Math.round(height)},left=${left},top=${top},resizable=yes,scrollbars=yes`;
}

export function createOnnxCameraLauncher({
  button,
  status,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  screenRef = windowRef?.screen,
} = {}) {
  if (!button || !status || !windowRef || !documentRef) {
    throw new Error('AI camera launcher is missing its browser controls.');
  }

  let childWindow = null;
  let destroyed = false;
  const targetUrl = new URL(ONNX_CAMERA_WINDOW_URL, documentRef.baseURI).href;

  function announce(message, type = '') {
    status.textContent = message;
    if (type) status.dataset.state = type;
    else delete status.dataset.state;
  }

  function openOrFocus() {
    if (destroyed) return null;
    if (!safeClosed(childWindow)) {
      safeFocus(childWindow);
      announce('');
      return childWindow;
    }

    try {
      childWindow = windowRef.open(
        targetUrl,
        ONNX_CAMERA_WINDOW_NAME,
        getOnnxCameraWindowFeatures(screenRef),
      );
    } catch {
      childWindow = null;
    }
    if (!childWindow) {
      announce('The camera window was blocked. Allow pop-ups for this site, then try again.', 'error');
      return null;
    }
    safeFocus(childWindow);
    announce('');
    return childWindow;
  }

  const onClick = () => openOrFocus();
  button.addEventListener('click', onClick);
  announce('');

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    childWindow = null;
    button.removeEventListener('click', onClick);
  }

  return { openOrFocus, destroy, get targetUrl() { return targetUrl; } };
}
