const CAMERA_VIEW_NAMES = ["Front", "Right", "Back", "Left"];
const ZOOM_MIN = 100;
const ZOOM_MAX = 200;
const ZOOM_VERSION = 1;

const finiteVector = (value) =>
  Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite);

const normalize = (vector, fallback) => {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length < 1e-9) return [...fallback];
  return vector.map((component) => component / length);
};

const cross = (left, right) => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];

const transformDirection = (matrix, vector) => [
  matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
  matrix[4] * vector[0] + matrix[5] * vector[1] + matrix[6] * vector[2],
  matrix[8] * vector[0] + matrix[9] * vector[1] + matrix[10] * vector[2],
];

export function deriveTableAnchor(slotCenters, fallback = [0, 0, 0]) {
  const valid = Array.isArray(slotCenters) ? slotCenters.filter(finiteVector) : [];
  if (!valid.length) return [...fallback.slice(0, 3)];
  const sum = valid.reduce(
    (accumulator, slot) => accumulator.map((value, index) => value + slot[index]),
    [0, 0, 0],
  );
  return sum.map((value) => value / valid.length);
}

export function deriveCameraBasis({
  matrix,
  rail = [1, 0, 0],
  front = [0, 1, 0],
} = {}) {
  const transform = Array.isArray(matrix) && matrix.length >= 16 ? matrix : [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const worldUp = [0, 1, 0];
  const transformedFront = transformDirection(transform, front);
  const horizontalFront = normalize(
    [transformedFront[0], 0, transformedFront[2]],
    [0, 0, -1],
  );
  const transformedRail = transformDirection(transform, rail);
  const horizontalRail = normalize(
    [transformedRail[0], 0, transformedRail[2]],
    [1, 0, 0],
  );
  // Keep the table-facing sign, then derive the side vector from it. Rail is
  // intentionally consumed so callers can validate the source frame without
  // letting a degenerate rail change the canonical Front sign.
  const right = normalize(cross(horizontalFront, worldUp), horizontalRail);
  return {
    front: horizontalFront,
    right,
    up: [...worldUp],
  };
}

export function buildCameraViews(basis) {
  const front = normalize(basis?.front || [0, 0, -1], [0, 0, -1]);
  const right = normalize(basis?.right || cross(front, [0, 1, 0]), [1, 0, 0]);
  return [
    { name: CAMERA_VIEW_NAMES[0], direction: [...front] },
    { name: CAMERA_VIEW_NAMES[1], direction: [...right] },
    { name: CAMERA_VIEW_NAMES[2], direction: front.map((value) => -value) },
    { name: CAMERA_VIEW_NAMES[3], direction: right.map((value) => -value) },
  ];
}

export function nextCameraViewIndex(index, delta = 1) {
  const count = CAMERA_VIEW_NAMES.length;
  return ((Number(index) || 0) + (Number(delta) || 0)) % count < 0
    ? (((Number(index) || 0) + (Number(delta) || 0)) % count) + count
    : ((Number(index) || 0) + (Number(delta) || 0)) % count;
}

export function buildCameraPose({
  anchor = [0, 0, 0],
  direction = [0, 0, -1],
  up = [0, 1, 0],
  fitRadius = 1,
  fitElevation = 0,
} = {}) {
  const target = [...anchor.slice(0, 3)];
  const viewDirection = normalize(direction, [0, 0, -1]);
  const position = target.map(
    (value, index) =>
      value + viewDirection[index] * Number(fitRadius) + up[index] * Number(fitElevation),
  );
  return { position, target };
}

export function migrateZoomValue(raw, defaultValue = 100) {
  const fallback = Number.isFinite(Number(defaultValue)) ? Number(defaultValue) : 100;
  if (raw && typeof raw === "object" && raw.version === ZOOM_VERSION) {
    const rawValue = Number(raw.value);
    const value = Number.isFinite(rawValue)
      ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, rawValue))
      : fallback;
    return { value, userSet: Boolean(raw.userSet), version: ZOOM_VERSION };
  }
  if (raw === undefined || raw === null || raw === "") {
    return { value: fallback, userSet: false, version: ZOOM_VERSION };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return { value: fallback, userSet: false, version: ZOOM_VERSION };
  if (value === 118) return { value: fallback, userSet: false, version: ZOOM_VERSION };
  return {
    value: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value)),
    userSet: true,
    version: ZOOM_VERSION,
  };
}

export const CAMERA_VIEW_NAMES_EXPORT = CAMERA_VIEW_NAMES;
