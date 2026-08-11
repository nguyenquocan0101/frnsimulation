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
  for (const id of ['onnxCameraCard', 'onnxModelInput', 'onnxConnectCameraBtn', 'onnxCameraSelect', 'onnxDisconnectBtn', 'onnxCaptureBtn', 'onnxUndoBtn', 'onnxClearBtn', 'onnxPredictBtn', 'onnxCameraStatus', 'onnxResults']) {
    assert.match(windowPage, new RegExp(`id="${id}"`));
  }
  assert.match(windowPage, /src="\.\/onnx-camera-window\.mjs"/);
  assert.match(windowPage, /FPTU TECH<span>X<\/span> CAMP/);
  assert.doesNotMatch(windowPage, /Load a model and connect a camera to begin/);
  assert.doesNotMatch(windowPage, /Model and frames stay on this device/);
  assert.match(windowPage, /role="status"[^>]*aria-live="polite"/);
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
  assert.match(windowStyles, /@media\(max-width:680px\)/);
  assert.match(windowStyles, /var\(--bg\)/);
});

test('camera lifecycle remains button-triggered and owned by the child page', () => {
  assert.match(controller, /getUserMedia/);
  assert.match(controller, /enumerateDevices/);
  assert.match(controller, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(controller, /cameraToken/);
  assert.match(controller, /state\.destroyed \|\| token !== state\.cameraToken/);
  assert.match(controller, /addEventListener\('pagehide', destroy/);
  assert.match(controller, /nodes\.predict\.addEventListener\('click', predictAll\)/);
  assert.doesNotMatch(controller, /setInterval|requestAnimationFrame\([^)]*predict|video.*requestVideoFrameCallback/i);
});

test('manual regions remain capped at seven and sequentially preserve results', () => {
  assert.match(controller, /const MAX_BOXES = 7/);
  assert.match(controller, /predictBoxesSequentially\(\s*boxes/);
  assert.match(controller, /state\.results = nextResults/);
  assert.match(controller, /Prediction failed\. Your frame and boxes were kept/);
  assert.match(controller, /event\.key === 'Enter'/);
});
