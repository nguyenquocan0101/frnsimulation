import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('./onnx-camera.mjs', import.meta.url), 'utf8');

test('AI camera is inside Simulation but outside the Three.js viewport', () => {
  const simulation = page.slice(page.indexOf('<section class="simulation-column"'), page.indexOf('</section>', page.indexOf('<section class="simulation-column"')));
  assert.match(simulation, /class="simulation-workspace"/);
  assert.match(simulation, /id="viewportWrap"[\s\S]*id="onnxCameraCard"/);
  const viewport = page.slice(page.indexOf('id="viewportWrap"'), page.indexOf('</div>', page.indexOf('id="blockStateStrip"')));
  assert.doesNotMatch(viewport, /id="onnxCameraCard"/);
});

test('panel exposes labelled model, camera, region, prediction, and status controls', () => {
  for (const id of ['onnxModelInput', 'onnxConnectCameraBtn', 'onnxCameraSelect', 'onnxDisconnectBtn', 'onnxCaptureBtn', 'onnxUndoBtn', 'onnxClearBtn', 'onnxPredictBtn', 'onnxCameraStatus']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.match(page, /role="status"[^>]*aria-live="polite"/);
  assert.match(page, /data-embed-hidden="onnx-camera"/);
});

test('runtime initialization is lazy, normal-mode-only, and failure isolated', () => {
  assert.match(app, /if\s*\(isEmbedMode[^)]*\)\s*return/);
  assert.match(app, /import\(['"]\.\/onnx-camera\.mjs['"]\)/);
  assert.match(app, /initOnnxCamera\(\)\.catch/);
  assert.doesNotMatch(page, /onnxruntime[^\n]*<script/i);
});

test('panel reuses the product UI and stacks without entering the viewport', () => {
  assert.match(styles, /\.simulation-workspace\{[^}]*grid-template-columns/);
  assert.match(styles, /@container\s*\(max-width:820px\)[\s\S]*\.simulation-workspace\{grid-template-columns:1fr\}/);
  assert.match(styles, /html\[data-embed-mode="guide"\] \.onnx-camera-card\{display:none!important\}/);
  assert.match(styles, /\.onnx-camera-card\{[^}]*height:clamp\(480px,64vh,720px\)/);
});

test('camera lifecycle stops replaced tracks and inference remains button-triggered', () => {
  assert.match(controller, /getUserMedia/);
  assert.match(controller, /enumerateDevices/);
  assert.match(controller, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(controller, /cameraToken/);
  assert.match(controller, /state\.destroyed \|\| token !== state\.cameraToken/);
  assert.match(controller, /addEventListener\('pagehide', destroy/);
  assert.match(controller, /nodes\.predict\.addEventListener\('click', predictAll\)/);
  assert.doesNotMatch(controller, /setInterval|requestAnimationFrame\([^)]*predict|video.*requestVideoFrameCallback/i);
});

test('manual regions are capped at seven and processed sequentially', () => {
  assert.match(controller, /const MAX_BOXES = 7/);
  assert.match(controller, /for \(const box of state\.boxes\) nextResults\.push\(await inferBox\(box\)\)/);
  assert.match(controller, /state\.results = nextResults/);
  assert.match(controller, /Prediction failed\. Your frame and boxes were kept/);
  assert.match(controller, /event\.key === 'Enter'/);
});
