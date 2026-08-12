import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const windowPage = fs.readFileSync(new URL('./onnx-camera-window.html', import.meta.url), 'utf8');
const windowBootstrap = fs.readFileSync(new URL('./onnx-camera-window.mjs', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const windowStyles = fs.readFileSync(new URL('./onnx-camera-window.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('./onnx-camera.mjs', import.meta.url), 'utf8');

test('Simulation has an accessible launcher and no inline ONNX card', () => {
  const simulation = page.slice(page.indexOf('<section class="simulation-column"'), page.indexOf('</section>', page.indexOf('<section class="simulation-column"')));
  assert.match(simulation, /id="onnxCameraLauncherBtn"/);
  assert.match(simulation, /aria-label="Open AI camera in a separate window"/);
  assert.match(simulation, /id="onnxCameraLauncherStatus"[^>]*role="status"/);
  assert.match(simulation, /id="viewportWrap"/);
  assert.doesNotMatch(simulation, /onnxCameraCard|simulation-workspace/);
  assert.doesNotMatch(page, /id="onnxCameraCard"/);
});

test('dedicated page owns the full labelled camera workflow', () => {
  for (const id of ['onnxCameraCard', 'onnxModelInput', 'onnxConnectCameraBtn', 'onnxCameraSelect', 'onnxDisconnectBtn', 'onnxCaptureBtn', 'onnxUndoBtn', 'onnxClearBtn', 'onnxPredictBtn', 'onnxCameraStatus', 'onnxResults', 'onnxOverlayResults']) {
    assert.match(windowPage, new RegExp(`id="${id}"`));
  }
  assert.match(windowPage, /src="\.\/onnx-camera-window\.mjs\?v=20260812-image-auto-predict"/);
  assert.match(windowPage, /href="\.\/onnx-camera-window\.css\?v=20260812-image-upload"/);
  assert.match(windowPage, /FPTU TECH<span>X<\/span> CAMP/);
  assert.match(windowPage, /fonts\.googleapis\.com\/css2\?family=Paytone\+One/);
  assert.doesNotMatch(windowPage, /Load a model and connect a camera to begin/);
  assert.doesNotMatch(windowPage, /Model and frames stay on this device/);
  assert.match(windowPage, /role="status"[^>]*aria-live="polite"/);
  assert.match(windowStyles, /onnx-camera-results-overlay/);
  assert.match(windowPage, /tabindex="0"/);
  assert.doesNotMatch(windowPage, /app\.js|three(?:\.module)?|firebase/i);
});

test('normal app lazily opens the launcher and remains embed guarded', () => {
  assert.match(app, /if\s*\(isEmbedMode\s*\|\|\s*onnxCameraLauncher/);
  assert.match(app, /import\(['"]\.\/onnx-camera-launcher\.mjs['"]\)/);
  assert.match(app, /initOnnxCameraLauncher\(\)\.catch/);
  assert.match(app, /pagehide[\s\S]{0,180}event\.persisted/);
  assert.match(app, /onnxCameraLauncher\?\.destroy/);
  assert.match(windowBootstrap, /createOnnxCameraController/);
  assert.match(windowBootstrap, /pageshow/);
  assert.doesNotMatch(windowBootstrap, /app\.js|onnxruntime/i);
});

test('standalone and launcher styling keeps the IDE language and responsive window readable', () => {
  assert.match(styles, /\.onnx-camera-launcher\{/);
  assert.match(styles, /html\[data-embed-mode="guide"\] \.onnx-camera-launcher/);
  assert.match(windowStyles, /\.onnx-camera-window-shell\{/);
  assert.match(windowStyles, /\.onnx-camera-window-shell\{[^}]*width:100%/);
  assert.match(windowStyles, /\.onnx-camera-window-card\{[^}]*grid-template-columns:/);
  assert.match(windowStyles, /onnx-camera-stage video[^}]*object-fit:contain/);
  assert.match(windowStyles, /\.onnx-camera-log\{[^}]*min-height:104px/);
  assert.match(windowStyles, /\.onnx-camera-log\{[^}]*width:min\(100%,calc\(\(100vh - 300px\)\*var\(--camera-aspect\)\)\)/);
  assert.match(windowStyles, /\.onnx-camera-results-overlay\{display:none!important\}/);
  assert.match(windowStyles, /\.onnx-camera-log>\.onnx-results\{[^}]*position:static/);
  assert.match(windowStyles, /@media\(max-width:900px\)/);
  assert.match(windowStyles, /var\(--bg\)/);
});

test('camera lifecycle stays child-owned with a guarded live prediction timer', () => {
  assert.match(controller, /getUserMedia/);
  assert.match(controller, /enumerateDevices/);
  assert.match(controller, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(controller, /cameraToken/);
  assert.match(controller, /state\.destroyed \|\| token !== state\.cameraToken/);
  assert.match(controller, /addEventListener\('pagehide', destroy/);
  assert.match(controller, /nodes\.predict\.addEventListener\('click', predictAll\)/);
  assert.match(controller, /setIntervalRef\([\s\S]*2000\)/);
  assert.match(controller, /stopLivePredictLoop\(\)/);
  assert.doesNotMatch(controller, /requestAnimationFrame\([^)]*predict|video.*requestVideoFrameCallback/i);
});

test('manual regions remain capped at seven and sequentially preserve results', () => {
  assert.match(controller, /const MAX_BOXES = 7/);
  assert.match(controller, /predictBoxesSequentially\(\s*boxes/);
  assert.match(controller, /state\.results = nextResults/);
  assert.match(controller, /Prediction failed\. Your frame and boxes were kept/);
  assert.match(controller, /event\.key === 'Enter'/);
});
