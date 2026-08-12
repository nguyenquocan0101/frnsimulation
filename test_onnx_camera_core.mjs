import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPredictionArray,
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

test('builds a fixed P1-P7 array with one-based class values and zero for missing boxes', () => {
  const results = [
    [{ index: 0, label: 'car', confidence: 0.9 }],
    [{ index: 6, label: 'orange', confidence: 0.8 }],
  ];
  assert.deepEqual(buildPredictionArray(results), [1, 7, 0, 0, 0, 0, 0]);
  assert.deepEqual(buildPredictionArray(results, 1), [1]);
});

const encodeVarint = (value) => {
  const bytes = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return bytes;
};
const field = (number, text) => {
  const bytes = new TextEncoder().encode(text);
  return [...encodeVarint(number * 8 + 2), ...encodeVarint(bytes.length), ...bytes];
};

test('validates any case-insensitive ONNX filename', () => {
  assert.equal(validateOnnxFilename('workshop-model.onnx'), true);
  assert.equal(validateOnnxFilename('RENAMED.ONNX'), true);
  assert.equal(validateOnnxFilename('model.pt'), false);
});

test('extracts Ultralytics names metadata without evaluating source', () => {
  const entry = [...field(1, 'names'), ...field(2, "{0: 'chair', 1: 'umbrella'}")];
  const model = new Uint8Array([...encodeVarint(14 * 8 + 2), ...encodeVarint(entry.length), ...entry]);
  const metadata = extractOnnxMetadata(model);
  assert.equal(metadata.names, "{0: 'chair', 1: 'umbrella'}");
  assert.deepEqual(parseClassNames(metadata.names), ['chair', 'umbrella']);
  assert.deepEqual(parseClassNames('{"0":"dog","1":"cat"}'), ['dog', 'cat']);
  assert.deepEqual(parseClassNames('not metadata'), []);
});

test('resolves fixed and dynamic batch-one image contracts', () => {
  const fixed = resolveModelContract({
    inputNames: ['images'], outputNames: ['output0'],
    inputMetadata: [{ dimensions: [1, 3, 192, 256] }],
    outputMetadata: [{ dimensions: [1, 8] }],
  });
  assert.deepEqual(fixed, { inputName: 'images', outputName: 'output0', width: 256, height: 192, knownClasses: 8 });
  const dynamic = resolveModelContract({
    inputNames: ['images'], outputNames: ['output0'],
    inputMetadata: [{ shape: ['batch', 3, 'height', 'width'], type: 'float32' }],
    outputMetadata: [{ shape: ['batch', 'classes'], type: 'float32' }],
  });
  assert.equal(dynamic.width, 224);
  assert.equal(dynamic.height, 224);
  assert.throws(() => resolveModelContract({ inputNames: ['a', 'b'], outputNames: ['o'] }), /exactly one/);
  assert.throws(() => resolveModelContract({
    inputNames: ['images'], outputNames: ['output0'],
    inputMetadata: [{ shape: [2, 3, 224, 224], type: 'float32' }],
    outputMetadata: [{ shape: [2, 8], type: 'float32' }],
  }), /batch must be 1/);
  assert.throws(() => resolveModelContract({
    inputNames: ['images'], outputNames: ['output0'],
    inputMetadata: [{ shape: [1, 3, 640, 640], type: 'float32' }],
    outputMetadata: [{ shape: [1, 84, 8400], type: 'float32' }],
  }), /rank-2 classification/);
});

test('preprocessing helpers center-crop and produce RGB NCHW floats', () => {
  assert.deepEqual(computeCoverCrop(400, 200, 100, 100), { x: 100, y: 0, width: 200, height: 200 });
  const tensor = imageDataToNchw({ width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 64, 255]) });
  assert.deepEqual(Array.from(tensor.slice(0, 4)), [1, 0, 0, 1]);
  assert.ok(Math.abs(tensor[4] - 128 / 255) < 1e-6);
  assert.ok(Math.abs(tensor[5] - 64 / 255) < 1e-6);
});

test('returns stable Top 3 for probabilities or logits', () => {
  assert.deepEqual(topClassifications([0.1, 0.7, 0.2], ['a', 'b', 'c']).map((item) => item.label), ['b', 'c', 'a']);
  const logits = topClassifications([-2, 4, 1, 0], [], 3);
  assert.deepEqual(logits.map((item) => item.label), ['class_1', 'class_2', 'class_3']);
  assert.ok(Math.abs(logits.reduce((sum, item) => sum + item.confidence, 0) - 1) < 0.1);
  assert.throws(() => topClassifications([NaN, 1]), /valid classification/);
});

test('normalizes dragged boxes at image boundaries', () => {
  assert.deepEqual(clampNormalizedBox({ x1: 1.2, y1: 0.7, x2: -0.2, y2: 0.1 }), { x1: 0, y1: 0.1, x2: 1, y2: 0.7 });
  assert.equal(canAddNormalizedBox({ x1: 0, y1: 0, x2: 0.2, y2: 0.2 }, 100, 100, 6), true);
  assert.equal(canAddNormalizedBox({ x1: 0, y1: 0, x2: 0.2, y2: 0.2 }, 100, 100, 7), false, 'eighth box is rejected');
  assert.equal(canAddNormalizedBox({ x1: 0, y1: 0, x2: 0.1, y2: 0.1 }, 100, 100, 0), false, 'tiny box is rejected');
});
