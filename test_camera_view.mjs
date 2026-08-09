import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCameraPose,
  buildCameraViews,
  deriveCameraBasis,
  deriveTableAnchor,
  migrateZoomValue,
  nextCameraViewIndex,
} from "./camera-view.mjs";

const EPSILON = 1e-6;

function assertVectorClose(actual, expected, epsilon = EPSILON) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= epsilon,
      `component ${index}: expected ${expected[index]}, got ${actual[index]}`,
    );
  }
}

function assertUnit(vector) {
  const length = Math.hypot(...vector);
  assert.ok(Math.abs(length - 1) <= EPSILON, `expected unit vector, got length ${length}`);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function multiply4(left, right) {
  const result = Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[row * 4 + column] += left[row * 4 + index] * right[index * 4 + column];
      }
    }
  }
  return result;
}

function rx(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    1, 0, 0, 0,
    0, cosine, -sine, 0,
    0, sine, cosine, 0,
    0, 0, 0, 1,
  ];
}

function ry(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    cosine, 0, sine, 0,
    0, 1, 0, 0,
    -sine, 0, cosine, 0,
    0, 0, 0, 1,
  ];
}

test("deriveTableAnchor averages finite P1-P7 slot centers without mutating input", () => {
  const slots = Object.freeze([
    Object.freeze([1, 2, 3]),
    Object.freeze([3, 4, 5]),
    Object.freeze([Number.NaN, 6, 7]),
    Object.freeze([Number.POSITIVE_INFINITY, 8, 9]),
    Object.freeze([-1, 0, 1]),
  ]);
  const before = JSON.stringify(slots);

  assert.deepEqual(deriveTableAnchor(slots), [1, 2, 3]);
  assert.equal(JSON.stringify(slots), before);
});

test("deriveTableAnchor uses a documented fallback when no finite slot exists", () => {
  const fallback = [12, 1.5, -8];
  assert.deepEqual(
    deriveTableAnchor([[Number.NaN, 0, 0], [0, Number.POSITIVE_INFINITY, 0]], fallback),
    fallback,
  );
  assert.notStrictEqual(deriveTableAnchor([], fallback), fallback);
});

test("deriveCameraBasis applies the FR3 Rx(-90deg) fixture and returns an orthonormal basis", () => {
  const basis = deriveCameraBasis({ matrix: rx(-Math.PI / 2) });

  assertVectorClose(basis.front, [0, 0, -1]);
  assertVectorClose(basis.right, [1, 0, 0]);
  assertVectorClose(basis.up, [0, 1, 0]);
  for (const vector of [basis.front, basis.right, basis.up]) assertUnit(vector);
  assert.ok(Math.abs(dot(basis.front, basis.right)) <= EPSILON);
  assert.ok(Math.abs(dot(basis.front, basis.up)) <= EPSILON);
  assert.ok(Math.abs(dot(basis.right, basis.up)) <= EPSILON);
  assertVectorClose(cross(basis.front, basis.up), basis.right);
});

test("deriveCameraBasis preserves the rotated FR5 table-facing sign", () => {
  const matrix = multiply4(ry((165.2 * Math.PI) / 180), rx(-Math.PI / 2));
  const basis = deriveCameraBasis({ matrix });

  assertVectorClose(basis.front, [-0.255, 0, 0.967], 2e-3);
  assertUnit(basis.front);
  assertVectorClose(cross(basis.front, basis.up), basis.right, 2e-6);
});

test("buildCameraViews exposes exactly the four physical cardinal directions", () => {
  const basis = deriveCameraBasis({ matrix: rx(-Math.PI / 2) });
  const views = buildCameraViews(basis);

  assert.deepEqual(views.map((view) => view.name), ["Front", "Right", "Back", "Left"]);
  assertVectorClose(views[0].direction, basis.front);
  assertVectorClose(views[1].direction, basis.right);
  assertVectorClose(views[2].direction, basis.front.map((value) => -value));
  assertVectorClose(views[3].direction, basis.right.map((value) => -value));

  let index = 0;
  for (let count = 0; count < 4; count += 1) index = nextCameraViewIndex(index, 1);
  assert.equal(index, 0);
  assert.equal(nextCameraViewIndex(0, -1), 3);
  assert.equal(nextCameraViewIndex(99, 1), 0);
});

test("buildCameraPose targets the immutable table anchor and changes only direction", () => {
  const anchor = [10, 2, -4];
  const up = [0, 1, 0];
  const frontPose = buildCameraPose({
    anchor,
    direction: [0, 0, -1],
    up,
    fitRadius: 20,
    fitElevation: 5,
  });
  const rightPose = buildCameraPose({
    anchor,
    direction: [1, 0, 0],
    up,
    fitRadius: 20,
    fitElevation: 5,
  });

  assert.deepEqual(frontPose.target, anchor);
  assert.deepEqual(rightPose.target, anchor);
  assert.deepEqual(frontPose.position, [10, 7, -24]);
  assert.deepEqual(rightPose.position, [30, 7, -4]);
  assert.deepEqual(anchor, [10, 2, -4]);
});

test("migrateZoomValue gives fresh and shipped legacy sessions a 100% default", () => {
  assert.deepEqual(migrateZoomValue(undefined), { value: 100, userSet: false, version: 1 });
  assert.deepEqual(migrateZoomValue(null), { value: 100, userSet: false, version: 1 });
  assert.deepEqual(migrateZoomValue(118), { value: 100, userSet: false, version: 1 });
  assert.deepEqual(migrateZoomValue("118"), { value: 100, userSet: false, version: 1 });
});

test("migrateZoomValue preserves explicit values, clamps invalid input, and is idempotent", () => {
  assert.deepEqual(migrateZoomValue(110), { value: 110, userSet: true, version: 1 });
  assert.deepEqual(migrateZoomValue(90), { value: 100, userSet: true, version: 1 });
  assert.deepEqual(migrateZoomValue(200), { value: 200, userSet: true, version: 1 });
  assert.deepEqual(migrateZoomValue(220), { value: 200, userSet: true, version: 1 });
  assert.deepEqual(migrateZoomValue("not-a-number"), { value: 100, userSet: false, version: 1 });

  const migrated = migrateZoomValue({ value: 118, userSet: true, version: 1 });
  assert.deepEqual(migrated, { value: 118, userSet: true, version: 1 });
  assert.deepEqual(migrateZoomValue(migrated), migrated);
});
