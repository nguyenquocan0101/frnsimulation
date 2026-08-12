import { createOnnxCameraController } from './onnx-camera.mjs?v=20260812-image-upload';

const VALID_THEMES = new Set(['light', 'dark']);

function readTheme(storage) {
  try {
    const value = storage?.getItem('fr3-theme');
    return VALID_THEMES.has(value) ? value : 'light';
  } catch {
    return 'light';
  }
}

export function createOnnxCameraWindowBootstrap({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  controllerFactory = createOnnxCameraController,
} = {}) {
  if (!documentRef || !windowRef) throw new Error('Camera window requires a browser document.');

  const root = documentRef.querySelector('#onnxCameraCard');
  const status = documentRef.querySelector('#onnxCameraStatus');
  let controller = null;
  let bootPromise = null;

  function showError(error) {
    if (!status) return;
    status.dataset.state = 'error';
    status.textContent = `AI camera could not start. ${error?.message || error}`;
  }

  async function boot({ force = false } = {}) {
    if (!force && controller) return bootPromise ?? controller;
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      try {
        if (!root) throw new Error('The AI camera surface is missing.');
        let storage = null;
        try {
          storage = windowRef.localStorage;
        } catch {
          storage = null;
        }
        documentRef.documentElement.dataset.theme = readTheme(storage);
        controller = controllerFactory({ root });
        return controller;
      } catch (error) {
        showError(error);
        return null;
      } finally {
        bootPromise = null;
      }
    })();
    return bootPromise;
  }

  async function restore(event) {
    if (!event?.persisted) return;
    if (bootPromise) await bootPromise;
    bootPromise = null;
    const previous = controller;
    controller = null;
    if (previous) {
      await previous.destroy?.();
    }
    await boot({ force: true });
  }

  const onPageShow = (event) => restore(event);
  windowRef.addEventListener('pageshow', onPageShow);

  function destroy() {
    windowRef.removeEventListener('pageshow', onPageShow);
    const current = controller;
    controller = null;
    return current?.destroy?.();
  }

  void boot();
  return { boot, restore, destroy };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  createOnnxCameraWindowBootstrap();
}
