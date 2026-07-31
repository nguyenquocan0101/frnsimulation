import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

const MODEL_BASE = "./assets/fr3_v6/";
const JOINT_NAMES = ["J1", "J2", "J3", "J4", "J5", "J6"];
const JOINT_LIMITS_DEG = [
  [-175, 175],
  [-265, 85],
  [-162, 162],
  [-265, 85],
  [-175, 175],
  [-175, 175],
];
const JOINT_LIMITS_RAD = JOINT_LIMITS_DEG.map(([lo, hi]) => [
  THREE.MathUtils.degToRad(lo),
  THREE.MathUtils.degToRad(hi),
]);
const JOINT_VELOCITY_RAD = [3.15, 3.15, 3.15, 3.2, 3.2, 3.2];
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const LINK_FILES = [
  "base_link",
  "shoulder_link",
  "upperarm_link",
  "forearm_link",
  "wrist1_link",
  "wrist2_link",
  "wrist3_link",
];
const JOINT_ORIGINS = [
  [0, 0, 0],
  [0, 0, 0.14],
  [-0.28, 0, 0],
  [-0.24001, 0, 0],
  [0, 0, 0.102],
  [0, 0, 0.102],
];
const JOINT_RPY = [
  [0, 0, 0],
  [Math.PI / 2, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [Math.PI / 2, 0, 0],
  [-Math.PI / 2, 0, 0],
];
const BLOCK_POSITIONS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const SORTABLE_BLOCK_NAMES = BLOCK_POSITIONS.slice(0, -1);
const BUFFER_POSITION = BLOCK_POSITIONS.at(-1);
const SAMPLE_BLOCK_POSITIONS = {
  P1: "P3",
  P2: "P2",
  P3: "P4",
  P4: "P1",
  P5: "P5",
  P6: "P6",
};
const BLOCK_COLORS = [
  0xf06b62, 0xf3a64a, 0xe7c85f, 0x6fc88f, 0x56a9d9, 0x7187d8, 0xa879d6,
];
const TECHCAMP_MAX_SPEED = 40;
const TECHCAMP_MAX_ACC = 20;
const DEFAULT_HOME_JOINTS = [-90, -135, 126, 8.8, 85.2, 0];
const HOME_CAMERA_TARGET = [0, 0.55, 0];
const HOME_CAMERA_VIEWS = [
  { name: "Trước", position: [1.55, 0.85, 0] },
  { name: "Phải", position: [0, 0.85, 1.55] },
  { name: "Sau", position: [-1.55, 0.85, 0] },
  { name: "Trái", position: [0, 0.85, -1.55] },
];

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const deg = (v) => THREE.MathUtils.degToRad(v);
const rad = (v) => THREE.MathUtils.radToDeg(v);
const fmt = (v) => Number(v).toFixed(1);
const sleepFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const state = {
  jointsDeg: [...DEFAULT_HOME_JOINTS],
  targetDeg: [...DEFAULT_HOME_JOINTS],
  enabled: true,
  automatic: false,
  running: false,
  speed: 25,
  modelReady: false,
  calibratedPoints: {},
  blocks: [],
  activeMotion: null,
  programRun: null,
  toolPose: [0, 0, 0, 0, 0, 0],
  lastTargetPose: [0, 0, 0, 0, 0, 0],
  live: false,
  liveSocket: null,
  lastLiveAt: 0,
  liveFromDeg: null,
  liveTargetDeg: null,
  liveAnimationStart: 0,
  liveAnimationDuration: 100,
  livePacketReceivedAt: 0,
  controllerSafety: null,
  safeZone: {
    enabled: true,
    example: true,
    margin: 50,
    alert: null,
    bounds: { x: [-500, 500], y: [-600, 600], z: [0, 850] },
  },
};

let scene,
  camera,
  renderer,
  controls,
  robotRoot,
  tcpMarker,
  targetMarker,
  safeZoneGroup,
  safeZoneMesh,
  safeZoneEdges,
  boardGroup,
  sceneGrid;
let cameraViewIndex = -1;
let jointRotators = [];
let modelMaterials = [];
const blockMeshes = new Map();
let logElement;

function applyTheme(theme) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  localStorage.setItem("fr3-theme", selected);
  updateSceneTheme();
  const toggle = $("themeToggleBtn");
  if (toggle) {
    const dark = selected === "dark";
    toggle.setAttribute("aria-pressed", String(dark));
    toggle.querySelector(".theme-label").textContent = dark
      ? "Light mode"
      : "Dark mode";
    toggle.querySelector(".theme-icon").textContent = dark ? "☀" : "☾";
  }
}

function updateSceneTheme() {
  if (!scene) return;
  const dark = document.documentElement.dataset.theme === "dark";
  scene.background.setHex(dark ? 0x06101b : 0xf4f6f8);
  if (!sceneGrid) return;
  const materials = Array.isArray(sceneGrid.material)
    ? sceneGrid.material
    : [sceneGrid.material];
  if (materials[0]) materials[0].color.setHex(dark ? 0x28405d : 0xc8d0d8);
  if (materials[1]) materials[1].color.setHex(dark ? 0x15283e : 0xe2e7ec);
}

function initTheme() {
  const saved = localStorage.getItem("fr3-theme");
  applyTheme(saved || "dark");
  $("themeToggleBtn")?.addEventListener("click", () =>
    applyTheme(
      document.documentElement.dataset.theme === "dark" ? "light" : "dark",
    ),
  );
}

const PYTHON_TOKEN_PATTERN = /(#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(from|import|class|def|with|as|if|for|in|return|True|False|None)\b|\b(TechCamp|TechCampError)\b|\b(move_to|move_down|move_up|grip|release|get_image|get_positions|close)\b/g;

function escapeCodeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function highlightPython(source) {
  let html = "";
  let cursor = 0;
  for (const token of source.matchAll(PYTHON_TOKEN_PATTERN)) {
    const [value, comment, string, keyword, apiClass, apiMethod] = token;
    html += escapeCodeHtml(source.slice(cursor, token.index));
    const type = comment
      ? "comment"
      : string
        ? "string"
        : keyword
          ? "keyword"
          : apiClass
            ? "class"
            : apiMethod
              ? "method"
              : "plain";
    html += `<span class="syntax-${type}">${escapeCodeHtml(value)}</span>`;
    cursor = token.index + value.length;
  }
  return `${html}${escapeCodeHtml(source.slice(cursor))}\n`;
}

function initCodeEditor() {
  const editor = $("program");
  const highlight = $("codeHighlight");
  const highlightCode = highlight?.querySelector("code");
  const lineNumbers = $("codeLineNumbers");
  if (!editor || !highlight || !highlightCode || !lineNumbers) return;
  const decrease = $("codeFontDecrease");
  const increase = $("codeFontIncrease");
  const storedSize = Number(localStorage.getItem("fr3-code-font-size"));
  let fontSize = clamp(Number.isFinite(storedSize) ? storedSize : 12, 11, 20);
  const applyFontSize = () => {
    document.documentElement.style.setProperty("--code-font-size", `${fontSize}px`);
    if (decrease) decrease.disabled = fontSize <= 11;
    if (increase) increase.disabled = fontSize >= 20;
    localStorage.setItem("fr3-code-font-size", String(fontSize));
  };
  const render = () => {
    highlightCode.innerHTML = highlightPython(editor.value);
    lineNumbers.textContent = Array.from(
      { length: editor.value.split("\n").length },
      (_, index) => String(index + 1),
    ).join("\n");
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
    lineNumbers.scrollTop = editor.scrollTop;
    clearCodeValidation();
  };
  editor.addEventListener("input", render);
  editor.addEventListener("scroll", () => {
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
    lineNumbers.scrollTop = editor.scrollTop;
  });
  editor.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText("  ", start, end, "end");
    render();
  });
  decrease?.addEventListener("click", () => {
    fontSize = clamp(fontSize - 1, 11, 20);
    applyFontSize();
  });
  increase?.addEventListener("click", () => {
    fontSize = clamp(fontSize + 1, 11, 20);
    applyFontSize();
  });
  applyFontSize();
  render();
}

function initWorkspaceTabs() {
  const tabs = [$("codeTab"), $("controlTab")].filter(Boolean);
  if (tabs.length !== 2) return;
  const activate = (tab) => {
    tabs.forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      const panel = $(item.getAttribute("aria-controls"));
      if (panel) panel.hidden = !selected;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      activate(tabs[nextIndex]);
    });
  });
}

function initResizableWorkspace() {
  const layout = $("ideLayout");
  const splitter = $("layoutSplitter");
  if (!layout || !splitter) return;
  let dragging = false;
  const minimum = 420;
  const applyWidth = (requestedWidth, persist = true) => {
    if (window.innerWidth <= 1020) return;
    const maximum = Math.max(minimum, layout.getBoundingClientRect().width - 542);
    const width = clamp(requestedWidth, minimum, maximum);
    layout.style.setProperty("--code-column-width", `${width}px`);
    splitter.setAttribute("aria-valuemin", String(minimum));
    splitter.setAttribute("aria-valuemax", String(Math.round(maximum)));
    splitter.setAttribute("aria-valuenow", String(Math.round(width)));
    if (persist) localStorage.setItem("fr3-code-column-width", String(width));
    resizeRenderer();
  };
  const storedWidthValue = localStorage.getItem("fr3-code-column-width");
  const storedWidth = storedWidthValue ? Number(storedWidthValue) : NaN;
  if (Number.isFinite(storedWidth)) applyWidth(storedWidth, false);
  splitter.addEventListener("pointerdown", (event) => {
    if (window.innerWidth <= 1020) return;
    dragging = true;
    splitter.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-layout");
    applyWidth(event.clientX - layout.getBoundingClientRect().left);
  });
  splitter.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    applyWidth(event.clientX - layout.getBoundingClientRect().left);
  });
  const stopDragging = () => {
    dragging = false;
    document.body.classList.remove("resizing-layout");
  };
  splitter.addEventListener("pointerup", stopDragging);
  splitter.addEventListener("pointercancel", stopDragging);
  splitter.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = parseFloat(
      getComputedStyle(layout).getPropertyValue("--code-column-width"),
    ) || layout.querySelector(".code-column").getBoundingClientRect().width;
    const maximum = Math.max(minimum, layout.getBoundingClientRect().width - 542);
    const next = event.key === 'Home' ? minimum : event.key === 'End' ? maximum : current + (event.key === 'ArrowRight' ? 24 : -24);
    applyWidth(next);
  });
  window.addEventListener("resize", () => {
    const current = parseFloat(
      getComputedStyle(layout).getPropertyValue("--code-column-width"),
    );
    if (Number.isFinite(current)) applyWidth(current, false);
  });
  const viewport = $("viewport");
  if (viewport && "ResizeObserver" in window) {
    new ResizeObserver(() => resizeRenderer()).observe(viewport);
  }
}

function fixedMatrix(origin, rpy) {
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rpy[0], rpy[1], rpy[2], "XYZ"),
  );
  matrix.compose(new THREE.Vector3(...origin), q, new THREE.Vector3(1, 1, 1));
  return matrix;
}

const FIXED_MATRICES = JOINT_ORIGINS.map((origin, i) =>
  fixedMatrix(origin, JOINT_RPY[i]),
);

function makePoseMatrix(pose) {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(
    pose[0] / 1000,
    pose[1] / 1000,
    pose[2] / 1000,
  );
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(deg(pose[3]), deg(pose[4]), deg(pose[5]), "XYZ"),
  );
  matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));
  return matrix;
}

function matrixToPose(matrix) {
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  const euler = new THREE.Euler().setFromRotationMatrix(matrix, "XYZ");
  return [
    position.x * 1000,
    position.y * 1000,
    position.z * 1000,
    rad(euler.x),
    rad(euler.y),
    rad(euler.z),
  ];
}

function fk(jointsRad) {
  let transform = new THREE.Matrix4().identity();
  const frames = [];
  jointsRad.forEach((joint, i) => {
    transform = transform.clone().multiply(FIXED_MATRICES[i]);
    transform.multiply(new THREE.Matrix4().makeRotationAxis(Z_AXIS, joint));
    frames.push(transform.clone());
  });
  return { frames, end: transform };
}

function tcpMatrix(jointsRad) {
  return fk(jointsRad).end.clone().multiply(makePoseMatrix(state.toolPose));
}

function poseError(targetMatrix, currentMatrix) {
  const targetPosition = new THREE.Vector3().setFromMatrixPosition(
    targetMatrix,
  );
  const currentPosition = new THREE.Vector3().setFromMatrixPosition(
    currentMatrix,
  );
  const positionError = targetPosition.sub(currentPosition);
  const targetRotation = new THREE.Matrix3().setFromMatrix4(targetMatrix);
  const currentRotation = new THREE.Matrix3()
    .setFromMatrix4(currentMatrix)
    .transpose();
  const rotationError = new THREE.Matrix3().multiplyMatrices(
    targetRotation,
    currentRotation,
  );
  const m = rotationError.elements;
  const cosAngle = clamp((m[0] + m[4] + m[8] - 1) / 2, -1, 1);
  const angle = Math.acos(cosAngle);
  let axisVector;
  if (angle < 1e-6) {
    axisVector = new THREE.Vector3(
      (m[5] - m[7]) / 2,
      (m[6] - m[2]) / 2,
      (m[1] - m[3]) / 2,
    );
  } else {
    const sinAngle = Math.sin(angle);
    axisVector = new THREE.Vector3(
      (m[5] - m[7]) / (2 * sinAngle),
      (m[6] - m[2]) / (2 * sinAngle),
      (m[1] - m[3]) / (2 * sinAngle),
    ).multiplyScalar(angle);
  }
  return [
    positionError.x,
    positionError.y,
    positionError.z,
    axisVector.x,
    axisVector.y,
    axisVector.z,
  ];
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const augmented = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column]))
        pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
    [augmented[column], augmented[pivot]] = [
      augmented[pivot],
      augmented[column],
    ];
    const divisor = augmented[column][column];
    for (let j = column; j <= n; j++) augmented[column][j] /= divisor;
    for (let row = 0; row < n; row++)
      if (row !== column) {
        const factor = augmented[row][column];
        for (let j = column; j <= n; j++)
          augmented[row][j] -= factor * augmented[column][j];
      }
  }
  return augmented.map((row) => row[n]);
}

function solveIK(targetPose, seedDeg) {
  const targetMatrix = makePoseMatrix(targetPose);
  let q = seedDeg.map(deg);
  let best = {
    q: q.slice(),
    score: Infinity,
    position: Infinity,
    orientation: Infinity,
  };
  for (let iteration = 0; iteration < 90; iteration++) {
    const currentMatrix = tcpMatrix(q);
    const rawError = poseError(targetMatrix, currentMatrix);
    const positionNorm = Math.hypot(rawError[0], rawError[1], rawError[2]);
    const orientationNorm = Math.hypot(rawError[3], rawError[4], rawError[5]);
    const score = positionNorm + orientationNorm * 0.12;
    if (score < best.score)
      best = {
        q: q.slice(),
        score,
        position: positionNorm,
        orientation: orientationNorm,
      };
    if (positionNorm < 0.0008 && orientationNorm < 0.01)
      return {
        ok: true,
        q: q.map(rad),
        position: positionNorm,
        orientation: orientationNorm,
        iterations: iteration + 1,
      };
    const error = rawError.map((v, i) => (i < 3 ? v : v * 0.35));
    const jacobian = Array.from({ length: 6 }, () => Array(6).fill(0));
    const epsilon = 1e-4;
    for (let column = 0; column < 6; column++) {
      const perturbed = q.slice();
      perturbed[column] += epsilon;
      const delta = poseError(tcpMatrix(perturbed), currentMatrix);
      for (let row = 0; row < 6; row++)
        jacobian[row][column] =
          (row < 3 ? delta[row] : delta[row] * 0.35) / epsilon;
    }
    const lambda = 0.025;
    const normal = Array.from({ length: 6 }, () => Array(6).fill(0));
    const rhs = Array(6).fill(0);
    for (let row = 0; row < 6; row++)
      for (let col = 0; col < 6; col++) {
        normal[row][col] =
          jacobian[row].reduce(
            (sum, value, k) => sum + value * jacobian[col][k],
            0,
          ) + (row === col ? lambda * lambda : 0);
      }
    for (let row = 0; row < 6; row++)
      rhs[row] = jacobian.reduce(
        (sum, jacRow, k) => sum + jacRow[row] * error[k],
        0,
      );
    const correction = solveLinearSystem(normal, rhs);
    if (!correction) break;
    for (let i = 0; i < 6; i++)
      q[i] = clamp(
        q[i] + clamp(correction[i], -0.18, 0.18),
        JOINT_LIMITS_RAD[i][0],
        JOINT_LIMITS_RAD[i][1],
      );
  }
  return {
    ok: best.position < 0.004 && best.orientation < 0.08,
    q: best.q.map(rad),
    position: best.position,
    orientation: best.orientation,
    iterations: 90,
  };
}

function lerpPose(from, to, t) {
  return from.map((v, i) => v + (to[i] - v) * t);
}

function currentPose() {
  return matrixToPose(tcpMatrix(state.jointsDeg.map(deg)));
}

function pointRecord(name) {
  return state.calibratedPoints[name] || null;
}

function normalizePointData(data) {
  return Object.fromEntries(
    (data.points || []).map((point) => [
      point.name,
      {
        name: point.name,
        joints: [1, 2, 3, 4, 5, 6].map((index) => Number(point[`j${index}`])),
        cart: [point.x, point.y, point.z, point.rx, point.ry, point.rz].map(
          Number,
        ),
      },
    ]),
  );
}

function homePointRecord() {
  const preferred = pointRecord("HOMELESS");
  if (preferred) return { name: "HOMELESS", point: preferred, fallback: false };
  const fallback = pointRecord("HOME");
  return fallback
    ? { name: "HOME", point: fallback, fallback: true }
    : { name: "HOMELESS", point: null, fallback: true };
}

function renderHomePoint() {
  const selection = homePointRecord();
  const badge = $("homePointBadge");
  if (badge) badge.textContent = selection.fallback ? "HOME" : "HOMELESS";
  const home = $("homeBtn");
  if (home)
    home.title = selection.fallback
      ? "HOMELESS chưa có trong points.json · đang dùng HOME"
      : "Dùng tọa độ HOMELESS trong points.json";
}

function makeTextSprite(text, color = "#cfe0f2") {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = "700 28px Consolas, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 80, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    }),
  );
  sprite.scale.set(0.085, 0.034, 1);
  return sprite;
}

function buildBlockBoard() {
  if (!robotRoot || !BLOCK_POSITIONS.every((name) => pointRecord(name))) return;
  if (boardGroup) robotRoot.remove(boardGroup);
  blockMeshes.clear();
  boardGroup = new THREE.Group();
  boardGroup.name = "TechCampBlockBoard";
  robotRoot.add(boardGroup);
  const boardMaterial = new THREE.MeshStandardMaterial({
    color: 0x24364b,
    roughness: 0.76,
    metalness: 0.08,
  });
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.18, 0.018),
    boardMaterial,
  );
  board.position.set(-0.012, 0.5, 0.145);
  board.receiveShadow = true;
  boardGroup.add(board);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x6c87a3,
    transparent: true,
    opacity: 0.72,
  });
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.56, 0.18, 0.02)),
    edgeMaterial,
  );
  edge.position.copy(board.position);
  boardGroup.add(edge);
  BLOCK_POSITIONS.forEach((name, index) => {
    const point = pointRecord(name);
    const cart = point.cart;
    const cell = new THREE.Mesh(
      new THREE.BoxGeometry(0.062, 0.165, 0.004),
      new THREE.MeshBasicMaterial({
        color: 0x34506b,
        transparent: true,
        opacity: 0.38,
      }),
    );
    cell.position.set(cart[0] / 1000, cart[1] / 1000, 0.158);
    boardGroup.add(cell);
    const label = makeTextSprite(name, index === 0 ? "#f7b0a8" : "#b9cbe0");
    label.position.set(cart[0] / 1000, cart[1] / 1000, 0.17);
    boardGroup.add(label);
    if (name === BUFFER_POSITION) return;
    const blockGroup = new THREE.Group();
    blockGroup.name = `block-${name}`;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.052, 0.052),
      new THREE.MeshStandardMaterial({
        color: BLOCK_COLORS[index],
        roughness: 0.55,
        metalness: 0.04,
      }),
    );
    body.castShadow = true;
    body.receiveShadow = true;
    blockGroup.add(body);
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(0.043, 0.043, 0.006),
      new THREE.MeshStandardMaterial({
        color: 0xf2f7ff,
        roughness: 0.35,
        metalness: 0.05,
      }),
    );
    top.position.z = 0.029;
    top.castShadow = true;
    blockGroup.add(top);
    const blockLabel = makeTextSprite(name, "#102033");
    blockLabel.scale.set(0.045, 0.018, 1);
    blockLabel.position.z = 0.033;
    blockGroup.add(blockLabel);
    boardGroup.add(blockGroup);
    blockMeshes.set(name, blockGroup);
  });
  renderBlockBoard();
  updateBlockVisuals();
}

function blockAt(position) {
  return (
    state.blocks.find(
      (block) => block.position === position && !block.carried,
    ) || null
  );
}

function updateBlockVisuals() {
  if (!blockMeshes.size) return;
  const tcp = matrixToPose(tcpMatrix(state.jointsDeg.map(deg)));
  blockMeshes.forEach((mesh) => {
    mesh.visible = false;
  });
  state.blocks.forEach((block) => {
    const mesh = blockMeshes.get(block.name);
    if (!mesh) return;
    const point = block.carried
      ? tcp
      : pointRecord(block.position === "HOMECHESS" ? "HOME" : block.position)
          ?.cart;
    if (!point) return;
    mesh.position.set(
      point[0] / 1000,
      point[1] / 1000,
      point[2] / 1000 - 0.035,
    );
    mesh.visible = true;
  });
}

function renderBlockBoardLegacy() {
  const occupied = new Set(
    state.blocks
      .filter((block) => !block.carried)
      .map((block) => block.position),
  );
  const carrying = state.blocks.find((block) => block.carried);
  const remaining = state.blocks.filter((block) => !block.carried).length;
  if ($("boardChip")) $("boardChip").textContent = `${remaining} BLOCKS`;
  if ($("boardState"))
    $("boardState").textContent =
      `${remaining} blocks${carrying ? ` · carrying ${carrying.name}` : " · P1 → P7"}`;
  if ($("blockLegend"))
    $("blockLegend").innerHTML = BLOCK_POSITIONS.map(
      (name, index) =>
        `<div class="block-token ${occupied.has(name) ? "" : "empty"}"><span class="block-swatch" style="background:#${BLOCK_COLORS[index].toString(16).padStart(6, "0")};color:#${BLOCK_COLORS[index].toString(16).padStart(6, "0")}"></span><span>${name}</span><span>${occupied.has(name) ? "READY" : "EMPTY"}</span></div>`,
    ).join("");
}

let draggedBlockName = null;
let pointerDraggedBlockName = null;
let selectedBlockName = null;
let pointerDragBound = false;

function clearPointerBlockDrag() {
  pointerDraggedBlockName = null;
  document
    .querySelectorAll("[data-block-name]")
    .forEach((card) => card.classList.remove("dragging"));
  document
    .querySelectorAll("[data-drop-position]")
    .forEach((slot) => slot.classList.remove("drag-over"));
}

function setSelectedBlock(blockName) {
  selectedBlockName = selectedBlockName === blockName ? null : blockName;
  document.querySelectorAll("[data-block-name]").forEach((card) => {
    const selected = card.dataset.blockName === selectedBlockName;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
}

function moveBlockToPosition(blockName, position) {
  const block = state.blocks.find((item) => item.name === blockName);
  if (!block || block.carried) return;
  const previous = block.position;
  const targetBlock = blockAt(position);
  if (targetBlock && targetBlock !== block) targetBlock.position = previous;
  block.position = position;
  selectedBlockName = null;
  renderBlockBoard();
  updateBlockVisuals();
  log(
    "Block " +
      blockName +
      (targetBlock && targetBlock !== block ? " swap " : " -> ") +
      position +
      (previous === position ? " · unchanged" : ""),
  );
}

function bindBlockBoardDrag() {
  if (!pointerDragBound) {
    document.addEventListener("mouseup", clearPointerBlockDrag);
    pointerDragBound = true;
  }
  document.querySelectorAll("[data-block-name]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      draggedBlockName = card.dataset.blockName;
      card.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", draggedBlockName);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
      draggedBlockName = null;
      card.classList.remove("dragging");
      document
        .querySelectorAll("[data-drop-position]")
        .forEach((slot) => slot.classList.remove("drag-over"));
    });
    card.addEventListener("mousedown", (event) => {
      pointerDraggedBlockName = card.dataset.blockName;
      card.classList.add("dragging");
      event.preventDefault();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setSelectedBlock(card.dataset.blockName);
    });
  });
  document.querySelectorAll("[data-drop-position]").forEach((slot) => {
    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      slot.classList.add("drag-over");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    slot.addEventListener("dragleave", () =>
      slot.classList.remove("drag-over"),
    );
    slot.addEventListener("drop", (event) => {
      event.preventDefault();
      slot.classList.remove("drag-over");
      const name =
        draggedBlockName || event.dataTransfer?.getData("text/plain");
      if (name) moveBlockToPosition(name, slot.dataset.dropPosition);
      draggedBlockName = null;
    });
    slot.addEventListener("mouseenter", () => {
      if (pointerDraggedBlockName) slot.classList.add("drag-over");
    });
    slot.addEventListener("mouseleave", () =>
      slot.classList.remove("drag-over"),
    );
    slot.addEventListener("mouseup", (event) => {
      if (!pointerDraggedBlockName) return;
      event.preventDefault();
      moveBlockToPosition(pointerDraggedBlockName, slot.dataset.dropPosition);
      clearPointerBlockDrag();
    });
    slot.addEventListener("keydown", (event) => {
      if (!selectedBlockName || (event.key !== "Enter" && event.key !== " "))
        return;
      event.preventDefault();
      moveBlockToPosition(selectedBlockName, slot.dataset.dropPosition);
    });
  });
}

function renderBlockBoard() {
  const carrying = state.blocks.find((block) => block.carried);
  const remaining = state.blocks.filter((block) => !block.carried).length;
  const stateStrip = $("blockStateStrip");
  if (stateStrip) {
    stateStrip.innerHTML = BLOCK_POSITIONS.map((position) => {
      const block = blockAt(position);
      const color = block
        ? "#" + block.color.toString(16).padStart(6, "0")
        : "transparent";
      const slotState = block ? "block" : carrying ? "đang nhấc block" : "trống";
      return (
        '<button class="block-state-slot' +
        (block ? " is-occupied" : " is-empty") +
        (block?.name === selectedBlockName ? " is-selected" : "") +
        '" style="--block-color:' +
        color +
        '" type="button" draggable="' +
        String(Boolean(block)) +
        '" data-drop-position="' +
        position +
        '"' +
        (block ? ' data-block-name="' + block.name + '"' : "") +
        ' aria-pressed="' +
        String(block?.name === selectedBlockName) +
        '" aria-label="' +
        position +
        ": " +
        slotState +
        '"><span>' +
        position +
        "</span></button>"
      );
    }).join("");
    bindBlockBoardDrag();
  }
  if ($("boardChip")) $("boardChip").textContent = remaining + " BLOCKS";
  if ($("boardState"))
    $("boardState").textContent =
      remaining +
      " blocks" +
      (carrying ? " · carrying " + carrying.name : " · P1 → P7");
  if ($("blockLegend")) {
    $("blockLegend").innerHTML = BLOCK_POSITIONS.map((position, index) => {
      const blocks = state.blocks.filter(
        (block) => !block.carried && block.position === position,
      );
      const color = "#" + BLOCK_COLORS[index].toString(16).padStart(6, "0");
      const cards = blocks.length
        ? blocks
            .map(
              (block) =>
                '<button class="block-card" type="button" draggable="true" data-block-name="' +
                block.name +
                '" aria-label="Kéo khối ' +
                block.name +
                " từ " +
                position +
                '"><span class="block-swatch" style="background:' +
                color +
                ";color:" +
                color +
                '"></span><strong>' +
                block.name +
                '</strong><span class="block-card-state">READY</span></button>',
            )
            .join("")
        : '<span class="slot-empty">DROP HERE</span>';
      return (
        '<div class="block-slot" data-drop-position="' +
        position +
        '" aria-label="Ô ' +
        position +
        '"><div class="block-slot-head"><strong>' +
        position +
        "</strong><span>" +
        (blocks.length ? blocks.length + " khối" : "trống") +
        '</span></div><div class="block-slot-body">' +
        cards +
        "</div></div>"
      );
    }).join("");
    bindBlockBoardDrag();
  }
}

function resetBlocks(silent = false) {
  state.blocks = SORTABLE_BLOCK_NAMES.map((name, index) => ({
    name,
    position: SAMPLE_BLOCK_POSITIONS[name],
    color: BLOCK_COLORS[index],
    carried: false,
  }));
  techcampSim.position = null;
  techcampSim.low = false;
  techcampSim.gripping = false;
  techcampSim.carriedBlock = null;
  renderBlockBoard();
  updateBlockVisuals();
  if (!silent) log("Scene reset -> P1…P6 · P7 buffer");
}

async function loadCalibratedPoints() {
  try {
    const response = await fetch("./points.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.calibratedPoints = normalizePointData(await response.json());
    renderHomePoint();
    resetBlocks(true);
    buildBlockBoard();
  } catch (error) {
    log(`points.json error: ${error.message}`);
    renderHomePoint();
  }
}

function matrixPositionMillimetres(matrix) {
  const point = new THREE.Vector3().setFromMatrixPosition(matrix);
  return [point.x * 1000, point.y * 1000, point.z * 1000];
}

function evaluateSafeZoneAt(jointsDeg) {
  const { bounds, margin } = state.safeZone;
  const jointsRad = jointsDeg.map(deg);
  const points = [
    { name: "TCP", position: matrixToPose(tcpMatrix(jointsRad)).slice(0, 3) },
  ];
  // J1 is the fixed base frame at z=0; exclude it so a floor-aligned zone does not warn continuously.
  fk(jointsRad).frames.forEach((frame, index) => {
    if (index > 0)
      points.push({
        name: `J${index + 1}`,
        position: matrixPositionMillimetres(frame),
      });
  });
  const outside = [];
  let clearance = Infinity;
  for (const point of points) {
    const [x, y, z] = point.position;
    const distances = [
      x - bounds.x[0],
      bounds.x[1] - x,
      y - bounds.y[0],
      bounds.y[1] - y,
      z - bounds.z[0],
      bounds.z[1] - z,
    ];
    const pointClearance = Math.min(...distances);
    clearance = Math.min(clearance, pointClearance);
    if (pointClearance < 0) outside.push(point.name);
  }
  return {
    status: outside.length
      ? "outside"
      : clearance <= margin
        ? "warning"
        : "inside",
    label: outside.length
      ? `OUTSIDE · ${outside.join(", ")}`
      : clearance <= margin
        ? `NEAR EDGE · còn ${Math.max(0, clearance).toFixed(0)} mm`
        : `IN ZONE · clearance ${clearance.toFixed(0)} mm`,
    clearance,
    outside,
  };
}

function evaluateSafeZone() {
  if (!state.safeZone.enabled)
    return {
      status: "disabled",
      label: "OFF · kiểm tra đang tắt",
      clearance: null,
      outside: [],
    };
  return evaluateSafeZoneAt(state.jointsDeg);
}

function checkMotionSafety(waypoints) {
  if (state.live || !state.safeZone.enabled) return { ok: true };
  const sampleCount = 10;
  for (let segment = 0; segment < waypoints.length - 1; segment++) {
    const from = waypoints[segment],
      to = waypoints[segment + 1];
    for (let step = 0; step <= sampleCount; step++) {
      if (segment > 0 && step === 0) continue;
      const t = step / sampleCount;
      const sample = from.map(
        (value, index) => value + (to[index] - value) * t,
      );
      const evaluation = evaluateSafeZoneAt(sample);
      if (evaluation.status === "outside")
        return {
          ok: false,
          evaluation,
          segment: segment + 1,
          totalSegments: waypoints.length - 1,
          step,
        };
    }
  }
  return { ok: true };
}

function blockUnsafeMotion(safety) {
  const reason = `${safety.evaluation.label} · segment ${safety.segment}/${safety.totalSegments} · sample ${safety.step}`;
  state.safeZone.alert = reason;
  renderSafeZone();
  log(`COLLISION BLOCKED · ${reason}`);
}

function controllerSafetyText() {
  const safety = state.controllerSafety;
  if (
    !safety ||
    Object.values(safety).every(
      (value) => value === null || value === undefined,
    )
  )
    return "Chưa có qua transport hiện tại";
  const alarms = [];
  if (safety.safety_plane_alarm === 1) alarms.push("Safety Wall");
  if (safety.interference_alarm === 1) alarms.push("Interference Zone");
  if (safety.collision_state === 1) alarms.push("Collision");
  if (safety.emergency_stop === 1) alarms.push("E-Stop");
  if (safety.safety_stop0 === 1 || safety.safety_stop1 === 1)
    alarms.push("Safety Stop");
  return alarms.length ? `ALARM · ${alarms.join(" · ")}` : "SDK flags normal";
}

function updateSafeZoneVisual() {
  if (!safeZoneGroup) return;
  const { bounds } = state.safeZone;
  const size = [
    bounds.x[1] - bounds.x[0],
    bounds.y[1] - bounds.y[0],
    bounds.z[1] - bounds.z[0],
  ];
  const center = [
    (bounds.x[0] + bounds.x[1]) / 2,
    (bounds.y[0] + bounds.y[1]) / 2,
    (bounds.z[0] + bounds.z[1]) / 2,
  ];
  safeZoneGroup.visible = state.safeZone.enabled;
  safeZoneGroup.position.set(
    center[0] / 1000,
    center[1] / 1000,
    center[2] / 1000,
  );
  safeZoneMesh.scale.set(size[0] / 1000, size[1] / 1000, size[2] / 1000);
  const evaluation = state.safeZone.alert
    ? { status: "outside" }
    : evaluateSafeZone();
  const color =
    evaluation.status === "outside"
      ? 0xff6274
      : evaluation.status === "warning"
        ? 0xf4c766
        : 0x62d0b0;
  safeZoneMesh.material.color.setHex(color);
  safeZoneEdges.material.color.setHex(color);
}

function renderSafeZone() {
  const evaluation = evaluateSafeZone();
  const display = state.safeZone.alert
    ? {
        status: "collision",
        label: `COLLISION · MOTION BLOCKED · ${state.safeZone.alert}`,
      }
    : evaluation;
  const chip = $("safeZoneChip");
  const status = $("safeZoneStatus");
  if (chip) {
    chip.textContent = state.safeZone.alert
      ? "BLOCKED"
      : state.safeZone.enabled
        ? state.safeZone.example
          ? "EXAMPLE"
          : "ACTIVE"
        : "OFF";
    chip.className = `state-chip ${display.status === "collision" || display.status === "outside" ? "danger-chip" : display.status === "warning" ? "warning-chip" : display.status === "inside" ? "enabled" : ""}`;
  }
  if (status) {
    status.textContent = display.label;
    status.className = `safe-zone-status ${display.status}`;
  }
  const toggle = $("safeZoneToggleBtn");
  if (toggle) {
    toggle.textContent = state.safeZone.enabled ? "Safe ON" : "Safe OFF";
    toggle.setAttribute("aria-pressed", String(state.safeZone.enabled));
    toggle.classList.toggle("primary", state.safeZone.enabled);
    toggle.classList.toggle("quiet", !state.safeZone.enabled);
  }
  if ($("controllerSafety")) {
    $("controllerSafety").textContent = controllerSafetyText();
    $("controllerSafety").className = controllerSafetyText().startsWith("ALARM")
      ? "alarm"
      : "";
  }
  updateSafeZoneVisual();
}

function updateSafeZone() {
  renderSafeZone();
}

function buildCartesianTrajectory(targetPose) {
  const from = currentPose();
  const distance = Math.hypot(
    targetPose[0] - from[0],
    targetPose[1] - from[1],
    targetPose[2] - from[2],
  );
  const steps = clamp(Math.ceil(distance / 12), 12, 90);
  let seed = [...state.jointsDeg];
  const waypoints = [seed];
  let worst = { position: 0, orientation: 0 };
  for (let i = 1; i <= steps; i++) {
    const pose = lerpPose(from, targetPose, i / steps);
    const result = solveIK(pose, seed);
    worst.position = Math.max(worst.position, result.position);
    worst.orientation = Math.max(worst.orientation, result.orientation);
    if (!result.ok)
      return {
        ok: false,
        reason: `IK không hội tụ tại waypoint ${i}/${steps}`,
        worst,
      };
    seed = result.q;
    waypoints.push(seed);
  }
  return { ok: true, waypoints, distance, worst };
}

function animateTrajectory(waypoints, duration) {
  return new Promise((resolve) => {
    state.running = true;
    state.activeMotion = { cancelled: false };
    renderState();
    const motion = state.activeMotion;
    const start = performance.now();
    const tick = (now) => {
      if (motion.cancelled || !state.running) {
        state.running = false;
        if (state.activeMotion === motion) state.activeMotion = null;
        renderState();
        resolve(false);
        return;
      }
      const t = clamp((now - start) / duration, 0, 1);
      const scaled = t * (waypoints.length - 1);
      const index = Math.min(waypoints.length - 2, Math.floor(scaled));
      const local = scaled - index;
      state.jointsDeg =
        waypoints.length === 1
          ? [...waypoints[0]]
          : waypoints[index].map(
              (v, i) =>
                v +
                (waypoints[index + 1][i] - v) *
                  (local * local * (3 - 2 * local)),
            );
      updateVisuals();
      if (t < 1) requestAnimationFrame(tick);
      else {
        state.jointsDeg = [...waypoints.at(-1)];
        state.running = false;
        state.activeMotion = null;
        updateVisuals();
        resolve(true);
      }
    };
    requestAnimationFrame(tick);
  });
}

function log(message) {
  if (!logElement) logElement = $("console");
  logElement.textContent += `${new Date().toLocaleTimeString()}  ${message}\n`;
  logElement.scrollTop = logElement.scrollHeight;
}

function setStatus(text, kind = "") {
  if ($("statusText")) $("statusText").textContent = text;
  if ($("connectionBadge"))
    $("connectionBadge").className = `connection-badge ${kind}`;
}

function renderState() {
  if ($("stateChip")) {
    $("stateChip").textContent = state.live
      ? "LIVE"
      : state.enabled
        ? "ENABLED"
        : "DISABLED";
    $("stateChip").classList.toggle("enabled", state.enabled || state.live);
  }
  if ($("motionState"))
    $("motionState").textContent = state.live
      ? "LIVE MONITOR"
      : state.running || state.programRun
        ? "RUNNING"
        : "STOPPED";
  $("enableBtn").textContent = state.enabled ? "Disable" : "Enable";
  $("modeBtn").textContent = state.automatic ? "Manual mode" : "Automatic mode";
  const speed = Math.round(state.speed);
  if ($("speedBtn")) $("speedBtn").textContent = `Speed ${speed}%`;
  if ($("speedRange")) $("speedRange").value = String(speed);
  if ($("speedOutput")) $("speedOutput").textContent = `${speed}%`;
  const runButton = $("runBtn");
  const programRunning = state.running || Boolean(state.programRun);
  if (runButton) {
    runButton.classList.toggle("primary", !programRunning);
    runButton.classList.toggle("danger", programRunning);
    runButton.innerHTML = programRunning
      ? '<span class="button-symbol">■</span> Stop program'
      : '<span class="button-symbol">▶</span> Run program';
    runButton.setAttribute(
      "aria-label",
      programRunning ? "Stop program" : "Run program",
    );
  }
  $("modeTextFallback")?.remove();
}

function renderJointControls() {
  $("jointControls").innerHTML = JOINT_NAMES.map(
    (name, i) =>
      `<div class="joint-row"><label for="joint-range-${i}">${name}</label><input id="joint-range-${i}" class="range" data-joint-range="${i}" type="range" min="${JOINT_LIMITS_DEG[i][0]}" max="${JOINT_LIMITS_DEG[i][1]}" step="0.1" value="${state.targetDeg[i]}" aria-label="${name} target"><input class="number" data-joint-number="${i}" type="number" min="${JOINT_LIMITS_DEG[i][0]}" max="${JOINT_LIMITS_DEG[i][1]}" step="0.1" value="${fmt(state.targetDeg[i])}" aria-label="${name} target in degrees"><span class="joint-limit">${JOINT_LIMITS_DEG[i][0]}° … ${JOINT_LIMITS_DEG[i][1]}°</span></div>`,
  ).join("");
  document
    .querySelectorAll("[data-joint-range]")
    .forEach((input) =>
      input.addEventListener("input", () =>
        syncJointTarget(Number(input.dataset.jointRange), Number(input.value)),
      ),
    );
  document
    .querySelectorAll("[data-joint-number]")
    .forEach((input) =>
      input.addEventListener("change", () =>
        syncJointTarget(Number(input.dataset.jointNumber), Number(input.value)),
      ),
    );
}

function syncJointTarget(index, value) {
  state.targetDeg[index] = clamp(
    Number(value) || 0,
    ...JOINT_LIMITS_DEG[index],
  );
  const range = document.querySelector(`[data-joint-range="${index}"]`);
  const number = document.querySelector(`[data-joint-number="${index}"]`);
  if (range) range.value = state.targetDeg[index];
  if (number) number.value = fmt(state.targetDeg[index]);
}

function syncDisplayedJointValues() {
  state.targetDeg.forEach((value, index) => {
    const range = document.querySelector(`[data-joint-range="${index}"]`);
    const number = document.querySelector(`[data-joint-number="${index}"]`);
    if (range) range.value = value;
    if (number) number.value = fmt(value);
  });
}

function renderPoseGrid(containerId, values, editable = false) {
  const labels = ["X", "Y", "Z", "RX", "RY", "RZ"];
  $(containerId).innerHTML = labels
    .map((label, i) =>
      editable
        ? `<div class="pose-cell"><label for="target-${i}">${label}</label><input id="target-${i}" data-target-pose="${i}" type="number" step="0.1" value="${fmt(values[i])}" aria-label="Target ${label}"></div>`
        : `<div class="pose-cell"><label>${label}</label><output>${fmt(values[i])}</output></div>`,
    )
    .join("");
}

function renderTcp() {
  const pose = currentPose();
  if ($("tcpReadout").querySelectorAll("output").length !== 6)
    renderPoseGrid("tcpReadout", pose, false);
  $("tcpReadout")
    .querySelectorAll("output")
    .forEach((output, index) => {
      output.value = fmt(pose[index]);
      output.textContent = fmt(pose[index]);
    });
}

function renderTargetInputs() {
  renderPoseGrid("targetPose", state.lastTargetPose, true);
  document.querySelectorAll("[data-target-pose]").forEach((input) =>
    input.addEventListener("change", () => {
      state.lastTargetPose[Number(input.dataset.targetPose)] =
        Number(input.value) || 0;
      updateTargetMarker();
    }),
  );
}

function updateTargetMarker() {
  if (!targetMarker) return;
  targetMarker.matrix.copy(makePoseMatrix(state.lastTargetPose));
  targetMarker.matrixWorldNeedsUpdate = true;
  targetMarker.visible = true;
}

function updateVisuals() {
  const jointsRad = state.jointsDeg.map(deg);
  jointRotators.forEach((rotator, i) => {
    rotator.rotation.z = jointsRad[i];
  });
  const poseMatrix = tcpMatrix(jointsRad);
  if (tcpMarker) {
    tcpMarker.matrix.copy(poseMatrix);
    tcpMarker.matrixWorldNeedsUpdate = true;
  }
  updateBlockVisuals();
  renderTcp();
  renderState();
  renderSafeZone();
}

function advanceLiveInterpolation(now) {
  if (
    !state.live ||
    !state.liveFromDeg ||
    !state.liveTargetDeg ||
    !state.liveAnimationStart
  )
    return;
  const progress = clamp(
    (now - state.liveAnimationStart) / state.liveAnimationDuration,
    0,
    1,
  );
  const eased = progress * progress * (3 - 2 * progress);
  const next = state.liveFromDeg.map(
    (value, index) => value + (state.liveTargetDeg[index] - value) * eased,
  );
  const changed = next.some(
    (value, index) => Math.abs(value - state.jointsDeg[index]) > 0.001,
  );
  if (changed) {
    state.jointsDeg = next;
    updateVisuals();
  }
  if (progress >= 1) state.liveFromDeg = [...state.liveTargetDeg];
}

function setLiveControlLock(locked) {
  [
    "enableBtn",
    "homeBtn",
    "stopBtn",
    "modeBtn",
    "applyBtn",
    "moveLBtn",
    "runBtn",
  ].forEach((id) => {
    if ($(id)) $(id).disabled = locked;
  });
  if ($("liveBtn")) {
    $("liveBtn").textContent = locked ? "Disconnect live" : "Connect live";
  }
}

function applyLiveState(payload) {
  if (!Array.isArray(payload.joints) || payload.joints.length < 6) return;
  if (state.running) {
    if (state.activeMotion) state.activeMotion.cancelled = true;
    state.running = false;
  }
  state.live = true;
  state.lastLiveAt = payload.timestamp || Date.now() / 1000;
  state.controllerSafety = payload.controller_safety || null;
  const nextTarget = payload.joints
    .slice(0, 6)
    .map((value, index) =>
      clamp(Number(value) || 0, ...JOINT_LIMITS_DEG[index]),
    );
  const now = performance.now();
  if (!state.liveTargetDeg) {
    state.jointsDeg = [...nextTarget];
    state.liveFromDeg = [...nextTarget];
    updateVisuals();
  } else {
    state.liveFromDeg = [...state.jointsDeg];
    state.liveAnimationStart = now;
    state.liveAnimationDuration = clamp(
      (state.livePacketReceivedAt ? now - state.livePacketReceivedAt : 100) *
        0.95,
      60,
      160,
    );
  }
  state.liveTargetDeg = nextTarget;
  state.livePacketReceivedAt = now;
  state.targetDeg = [...nextTarget];
  syncDisplayedJointValues();
  if ($("liveState"))
    $("liveState").textContent =
      `LIVE · ${new Date(state.lastLiveAt * 1000).toLocaleTimeString()}`;
  renderSafeZone();
}

function disconnectLive() {
  const socket = state.liveSocket;
  state.liveSocket = null;
  state.live = false;
  state.liveFromDeg = null;
  state.liveTargetDeg = null;
  state.liveAnimationStart = 0;
  state.livePacketReceivedAt = 0;
  state.controllerSafety = null;
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  setLiveControlLock(false);
  if ($("liveState")) $("liveState").textContent = "OFFLINE";
  setStatus("SIMULATOR READY · FR3 V6", state.modelReady ? "ready" : "");
  renderState();
  log("Live monitor disconnected");
}

function connectLive() {
  if (state.liveSocket && state.liveSocket.readyState <= 1) {
    disconnectLive();
    return;
  }
  const configured =
    new URLSearchParams(location.search).get("ws") || "ws://127.0.0.1:8765";
  let socket;
  try {
    socket = new WebSocket(configured);
  } catch (error) {
    if ($("liveState")) $("liveState").textContent = "URL ERROR";
    setStatus("LIVE URL ERROR", "error");
    log(`Live connect error: ${error.message}`);
    return;
  }
  state.liveSocket = socket;
  if ($("liveState")) $("liveState").textContent = "CONNECTING…";
  setStatus("CONNECTING FAIRINO TELEMETRY…");
  log(`Live monitor -> ${configured}`);
  socket.onopen = () => {
    state.live = true;
    setLiveControlLock(true);
    setStatus("LIVE TELEMETRY · READ ONLY", "ready");
    if ($("liveState")) $("liveState").textContent = "LIVE · waiting state";
    renderState();
    log("Live WebSocket connected; motion controls locked");
  };
  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "robot_state") applyLiveState(payload);
      else if (payload.type === "error") {
        state.live = false;
        if ($("liveState"))
          $("liveState").textContent = `ERROR · ${payload.message}`;
        setStatus("LIVE TELEMETRY ERROR", "error");
        log(`Live telemetry error: ${payload.message}`);
      }
    } catch (error) {
      log(`Live message error: ${error.message}`);
    }
  };
  socket.onerror = () => {
    setStatus("LIVE TELEMETRY ERROR", "error");
    if ($("liveState")) $("liveState").textContent = "ERROR";
    log("Live WebSocket error");
  };
  socket.onclose = () => {
    if (state.liveSocket !== socket) return;
    state.liveSocket = null;
    state.live = false;
    state.liveFromDeg = null;
    state.liveTargetDeg = null;
    state.liveAnimationStart = 0;
    state.livePacketReceivedAt = 0;
    state.controllerSafety = null;
    setLiveControlLock(false);
    if ($("liveState")) $("liveState").textContent = "OFFLINE";
    setStatus("LIVE OFFLINE", "error");
    renderState();
    renderSafeZone();
    log("Live WebSocket disconnected");
  };
}

function resizeRenderer() {
  const element = $("viewport");
  if (!renderer || !element.clientWidth) return;
  renderer.setSize(element.clientWidth, element.clientHeight, false);
  camera.aspect = element.clientWidth / element.clientHeight;
  camera.updateProjectionMatrix();
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f6f8);
  camera = new THREE.PerspectiveCamera(38, 1, 0.01, 20);
  camera.position.set(1.35, 1.08, 1.45);
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $("viewport").appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.5, 0);
  controls.minDistance = 0.35;
  controls.maxDistance = 4;
  const hemi = new THREE.HemisphereLight(0xdcecff, 0x1d2e3d, 2.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(1.5, 2.4, 1.2);
  key.castShadow = true;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x6ba7d6, 1.3);
  fill.position.set(-1, 0.8, -1.5);
  scene.add(fill);
  sceneGrid = new THREE.GridHelper(2.4, 24, 0xc8d0d8, 0xe2e7ec);
  sceneGrid.position.y = 0;
  scene.add(sceneGrid);
  updateSceneTheme();
  robotRoot = new THREE.Group();
  robotRoot.rotation.x = -Math.PI / 2;
  scene.add(robotRoot);
  safeZoneGroup = new THREE.Group();
  safeZoneMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x62d0b0,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  safeZoneEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({
      color: 0x62d0b0,
      transparent: true,
      opacity: 0.9,
    }),
  );
  safeZoneGroup.add(safeZoneMesh, safeZoneEdges);
  robotRoot.add(safeZoneGroup);
  tcpMarker = new THREE.AxesHelper(0.14);
  tcpMarker.matrixAutoUpdate = false;
  robotRoot.add(tcpMarker);
  targetMarker = new THREE.AxesHelper(0.11);
  targetMarker.matrixAutoUpdate = false;
  targetMarker.visible = false;
  robotRoot.add(targetMarker);
  window.addEventListener("resize", resizeRenderer);
  resizeRenderer();
  const loop = (now) => {
    requestAnimationFrame(loop);
    advanceLiveInterpolation(now);
    controls.update();
    renderer.render(scene, camera);
  };
  loop(performance.now());
}

function loadSTL(loader, file) {
  return new Promise((resolve, reject) =>
    loader.load(`${MODEL_BASE}${file}.STL`, resolve, undefined, reject),
  );
}

async function loadModel() {
  initScene();
  const loader = new STLLoader();
  const material = new THREE.MeshStandardMaterial({
    color: 0xbfc9d4,
    roughness: 0.62,
    metalness: 0.12,
  });
  modelMaterials.push(material);
  try {
    const baseGeometry = await loadSTL(loader, "base_link");
    const baseMesh = new THREE.Mesh(baseGeometry, material);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    robotRoot.add(baseMesh);
    let parent = robotRoot;
    for (let i = 0; i < 6; i++) {
      const frame = new THREE.Group();
      frame.position.fromArray(JOINT_ORIGINS[i]);
      frame.rotation.set(...JOINT_RPY[i]);
      parent.add(frame);
      const rotator = new THREE.Group();
      frame.add(rotator);
      jointRotators.push(rotator);
      const geometry = await loadSTL(loader, LINK_FILES[i + 1]);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      rotator.add(mesh);
      parent = rotator;
    }
    state.modelReady = true;
    await loadCalibratedPoints();
    $("loadingCard")?.classList.add("hidden");
    if ($("modelStatus"))
      $("modelStatus").textContent =
        "Loaded fairino3_v6 mesh · TechCamp points.json active";
    setStatus("SIMULATOR READY · TECHCAMP", "ready");
    updateVisuals();
  } catch (error) {
    console.error(error);
    if ($("loadingCard"))
      $("loadingCard").innerHTML =
        "<span>Không tải được mesh. Hãy chạy bằng web server local.</span>";
    setStatus("MODEL LOAD ERROR", "error");
    if ($("modelStatus"))
      $("modelStatus").textContent = "Không tải được asset 3D";
    log(`Model load error: ${error.message}`);
  }
}

function setHomeCameraView(index) {
  if (!camera || !controls) return;
  cameraViewIndex =
    ((index % HOME_CAMERA_VIEWS.length) + HOME_CAMERA_VIEWS.length) %
    HOME_CAMERA_VIEWS.length;
  const view = HOME_CAMERA_VIEWS[cameraViewIndex];
  camera.position.set(...view.position);
  controls.target.set(...HOME_CAMERA_TARGET);
  controls.update();
  const button = $("changeViewBtn");
  if (button) {
    button.title = `Góc nhìn ${view.name} (${cameraViewIndex + 1}/4)`;
    button.setAttribute(
      "aria-label",
      `Change view. Góc hiện tại: ${view.name}, ${cameraViewIndex + 1} trên 4`,
    );
  }
}

function changeView() {
  setHomeCameraView(cameraViewIndex + 1);
}

function homeView() {
  setHomeCameraView(0);
}

class TechCampError extends Error {}

function startTechCamp() {
  if (!state.enabled) {
    state.enabled = true;
    renderState();
    setStatus("TECHCAMP SIM READY", "ready");
    log(
      `TechCamp() -> simulator ready · speed ≤${TECHCAMP_MAX_SPEED}% · acc ≤${TECHCAMP_MAX_ACC}%`,
    );
  }
}

function calibratedPointFor(position) {
  const name = String(position).toUpperCase();
  const pointName = name === "HOMECHESS" ? "HOME" : name;
  return pointRecord(pointName);
}

async function techCampMove(point, speed) {
  const previousSpeed = state.speed;
  state.speed = Math.min(
    Number(speed) || TECHCAMP_MAX_SPEED,
    TECHCAMP_MAX_SPEED,
  );
  renderState();
  try {
    return await api.MoveJ(point.joints);
  } finally {
    state.speed = previousSpeed;
    renderState();
  }
}

const techcampSim = {
  position: null,
  low: false,
  gripping: false,
  carriedBlock: null,
  async move_to(position) {
    startTechCamp();
    const pos = String(position).toUpperCase();
    if (!["P1", "P2", "P3", "P4", "P5", "P6", "P7", "HOMECHESS"].includes(pos))
      throw new TechCampError(
        `Invalid position '${position}'. Valid: P1…P7, HOMECHESS`,
      );
    if (this.low) await this.move_up();
    if (this.position === pos) return true;
    const point = calibratedPointFor(
      pos === "HOMECHESS" ? "HOMECHESS" : `${pos}UP`,
    );
    if (!point)
      throw new TechCampError(`Missing calibrated point for ${pos}UP`);
    const result = await techCampMove(point, TECHCAMP_MAX_SPEED);
    if (result !== 0)
      throw new TechCampError(
        `move_to('${pos}') failed (simulator error ${result})`,
      );
    this.position = pos;
    this.low = false;
    renderBlockBoard();
    return true;
  },
  async move_down() {
    startTechCamp();
    if (!this.position || this.position === "HOMECHESS")
      throw new TechCampError(
        "move_down() requires move_to('P1'..'P7') first.",
      );
    if (this.low) return true;
    const point = calibratedPointFor(this.position);
    if (!point)
      throw new TechCampError(`Missing calibrated point for ${this.position}`);
    const result = await techCampMove(point, 10);
    if (result !== 0)
      throw new TechCampError(
        `move_down() at ${this.position} failed (simulator error ${result})`,
      );
    this.low = true;
    return true;
  },
  async move_up() {
    startTechCamp();
    if (!this.position || this.position === "HOMECHESS") {
      await this.move_to("HOMECHESS");
      return true;
    }
    if (!this.low) return true;
    const point = calibratedPointFor(`${this.position}UP`);
    if (!point)
      throw new TechCampError(
        `Missing calibrated point for ${this.position}UP`,
      );
    const result = await techCampMove(point, TECHCAMP_MAX_SPEED);
    if (result !== 0)
      throw new TechCampError(
        `move_up() at ${this.position} failed (simulator error ${result})`,
      );
    this.low = false;
    return true;
  },
  async grip() {
    startTechCamp();
    if (this.gripping) return true;
    this.gripping = true;
    const block = this.low && this.position ? blockAt(this.position) : null;
    if (block) {
      block.carried = true;
      this.carriedBlock = block.name;
      log(`grip() -> ${block.name} attached`);
    } else log("grip() -> gripper closed");
    renderBlockBoard();
    await sleep(220);
    return true;
  },
  async release() {
    startTechCamp();
    if (!this.gripping) return true;
    const block = this.carriedBlock
      ? state.blocks.find((item) => item.name === this.carriedBlock)
      : null;
    if (block) {
      block.carried = false;
      block.position = this.position;
      log(
        `release() -> ${block.name} placed at ${this.position || "current position"}`,
      );
    } else log("release() -> gripper released");
    this.gripping = false;
    this.carriedBlock = null;
    renderBlockBoard();
    updateBlockVisuals();
    await sleep(220);
    return true;
  },
  async get_image() {
    startTechCamp();
    log("get_image() -> simulated top-down board");
    return { type: "simulated_board", positions: this.get_positions() };
  },
  async get_positions() {
    return Object.fromEntries(
      BLOCK_POSITIONS.map((name) => [name, Boolean(blockAt(name))]),
    );
  },
  async close() {
    this.gripping = false;
    this.carriedBlock = null;
    log("TechCamp.close() -> 0");
    return true;
  },
  reset() {
    this.position = null;
    this.low = false;
    this.gripping = false;
    this.carriedBlock = null;
  },
};
window.techcampSim = techcampSim;
window.TechCamp = () => {
  startTechCamp();
  return techcampSim;
};
window.TechCampError = TechCampError;

const api = {
  async RPC(target) {
    log(`RPC(${JSON.stringify(target)}) -> 0`);
    return 0;
  },
  async CloseRPC() {
    state.running = false;
    log("CloseRPC() -> 0");
    return 0;
  },
  async GetActualJointPosDegree() {
    return [...state.jointsDeg];
  },
  async GetActualTCPPose() {
    return currentPose();
  },
  async SetSpeed(value) {
    state.speed = clamp(Number(value) || 0, 1, 100);
    renderState();
    log(`SetSpeed(${state.speed}) -> 0`);
    return 0;
  },
  async Mode(value) {
    state.automatic = Number(value) === 1;
    renderState();
    log(`Mode(${state.automatic ? 1 : 0}) -> 0`);
    return 0;
  },
  async SetToolCoord(_id, pose) {
    if (Array.isArray(pose) && pose.length >= 6)
      state.toolPose = pose.slice(0, 6).map(Number);
    updateVisuals();
    log("SetToolCoord() -> 0");
    return 0;
  },
  async GetRobotInstallAngle() {
    return [0, 0];
  },
  async MoveJ(joints) {
    if (!state.enabled) {
      log("MoveJ -> -1 (robot disabled)");
      return -1;
    }
    const target = joints
      .slice(0, 6)
      .map((value, i) => clamp(Number(value) || 0, ...JOINT_LIMITS_DEG[i]));
    const safety = checkMotionSafety([state.jointsDeg, target]);
    if (!safety.ok) {
      blockUnsafeMotion(safety);
      return -3;
    }
    state.safeZone.alert = null;
    state.targetDeg = [...target];
    renderJointControls();
    const maxDelta = Math.max(
      ...target.map((value, i) => Math.abs(value - state.jointsDeg[i])),
    );
    const duration = Math.max(450, (maxDelta * 18) / state.speed);
    log(`MoveJ([${target.map(fmt).join(", ")}]) -> 0`);
    return (await animateTrajectory([state.jointsDeg, target], duration))
      ? 0
      : -1;
  },
  async MoveL(pose) {
    if (!state.enabled) {
      log("MoveL -> -1 (robot disabled)");
      return -1;
    }
    const target = pose.slice(0, 6).map(Number);
    if (target.length < 6 || target.some(Number.isNaN)) {
      log("MoveL -> -2 (invalid pose)");
      return -2;
    }
    const plan = buildCartesianTrajectory(target);
    if (!plan.ok) {
      log(`MoveL -> -2 (${plan.reason})`);
      return -2;
    }
    const safety = checkMotionSafety(plan.waypoints);
    if (!safety.ok) {
      blockUnsafeMotion(safety);
      return -3;
    }
    state.safeZone.alert = null;
    state.lastTargetPose = [...target];
    updateTargetMarker();
    const duration = Math.max(
      600,
      (plan.distance / (Math.max(1, state.speed) * 0.18)) * 1000,
    );
    log(
      `MoveL([${target.map(fmt).join(", ")}]) -> 0 · ${plan.waypoints.length - 1} Cartesian waypoints`,
    );
    return (await animateTrajectory(plan.waypoints, duration)) ? 0 : -1;
  },
  async ServoJ(joints) {
    const result = await this.MoveJ(joints);
    log(`ServoJ -> ${result}`);
    return result;
  },
  async StopMotion() {
    if (state.activeMotion) state.activeMotion.cancelled = true;
    if (state.programRun) {
      state.programRun.cancelled = true;
      state.programRun.controller?.abort();
    }
    state.running = false;
    state.activeMotion = null;
    state.programRun = null;
    log("StopMotion() -> 0");
    renderState();
    return 0;
  },
};
window.fairinoSim = api;

function quotedArgument(raw) {
  const match = String(raw)
    .trim()
    .match(/^["']([^"']+)["']$/);
  return match ? match[1] : null;
}

const TECHCAMP_STUDENT_POINTS = new Set([
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "HOMECHESS",
]);
const TECHCAMP_EMPTY_METHODS = new Set([
  "move_down",
  "move_up",
  "grip",
  "release",
  "close",
]);
const TECHCAMP_READ_METHODS = new Set(["get_image", "get_positions"]);

function stripPythonComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "#") return line.slice(0, index);
  }
  return line;
}

function findPythonSyntaxIssue(line) {
  const stack = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") stack.push(char);
    else if (pairs[char]) {
      if (stack.at(-1) !== pairs[char])
        return `Dấu '${char}' không có dấu mở tương ứng.`;
      stack.pop();
    }
  }
  if (quote) return "Chuỗi ký tự chưa đóng dấu nháy.";
  if (stack.length) return `Thiếu dấu đóng cho '${stack.at(-1)}'.`;
  return null;
}

function withoutPythonStrings(line) {
  let output = "";
  let quote = null;
  let escaped = false;
  for (const char of line) {
    if (quote) {
      output += " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
      output += " ";
    } else output += char;
  }
  return output;
}

function renderCodeValidation(validation) {
  const badge = $("codeValidation");
  const summary = $("codeValidationSummary");
  const list = $("codeErrorList");
  if (!badge || !summary || !list) return;
  const { errors } = validation;
  badge.hidden = errors.length === 0;
  badge.classList.toggle("is-valid", errors.length === 0);
  badge.classList.toggle("has-errors", errors.length > 0);
  summary.textContent = errors.length
    ? `${errors.length} lỗi cần sửa`
    : "Code hợp lệ";
  list.replaceChildren();
  list.hidden = errors.length === 0;
  for (const error of errors) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "code-error-item";
    item.textContent = `Dòng ${error.line}: ${error.message}`;
    item.addEventListener("click", () => focusProgramLine(error.line));
    list.append(item);
  }
}

function focusProgramLine(lineNumber) {
  const editor = $("program");
  if (!editor) return;
  const lines = editor.value.split("\n");
  const start = lines.slice(0, Math.max(0, lineNumber - 1)).join("\n").length +
    (lineNumber > 1 ? 1 : 0);
  const end = start + (lines[lineNumber - 1] || "").length;
  editor.focus();
  editor.setSelectionRange(start, end);
  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 20;
  editor.scrollTop = Math.max(0, (lineNumber - 3) * lineHeight);
}

function validateStudentProgram(source) {
  const errors = [];
  const addError = (line, message) => errors.push({ line, message });
  const variables = new Set();
  const indentation = [0];
  let previousOpenedBlock = false;
  let importedTechCamp = false;
  let botCreated = false;
  let hasRobotCommand = false;
  let knownPosition = false;

  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (/\t/.test(raw)) addError(lineNumber, "Dùng dấu cách để thụt lề, không dùng Tab.");
    const uncommented = stripPythonComment(raw);
    const trimmed = uncommented.trim();
    if (!trimmed) continue;
    const codeOnly = withoutPythonStrings(trimmed);
    const syntaxIssue = findPythonSyntaxIssue(uncommented);
    if (syntaxIssue) addError(lineNumber, syntaxIssue);
    if (codeOnly.includes(";"))
      addError(lineNumber, "Mỗi dòng chỉ được có một lệnh; không dùng dấu chấm phẩy (;).");
    if (/\/\//.test(codeOnly))
      addError(lineNumber, "Python dùng # để ghi chú, không dùng //.");

    const indent = uncommented.match(/^ */)[0].length;
    while (indent < indentation.at(-1)) indentation.pop();
    if (indent !== indentation.at(-1)) {
      if (indent > indentation.at(-1) && previousOpenedBlock) indentation.push(indent);
      else addError(lineNumber, "Thụt lề không đúng: chỉ thụt lề ngay sau dòng kết thúc bằng dấu :.");
    }

    const unsupportedKeyword = codeOnly.match(
      /\b(await|async|def|class|lambda|eval|exec|open|__import__|while|for|try|except|return|raise|input)\b/,
    );
    if (unsupportedKeyword) {
      addError(
        lineNumber,
        `'${unsupportedKeyword[1]}' chưa được dùng trong bài học này. Chỉ gọi các hàm TechCamp có sẵn.`,
      );
      previousOpenedBlock = trimmed.endsWith(":");
      continue;
    }

    if (/^from\b/.test(trimmed) || /^import\b/.test(trimmed)) {
      if (
        /^from\s+techcamp_api\s+import\s+TechCamp(?:\s*,\s*TechCampError)?$/.test(trimmed)
      ) {
        importedTechCamp = true;
      } else {
        addError(
          lineNumber,
          "Chỉ được import TechCamp: from techcamp_api import TechCamp",
        );
      }
      previousOpenedBlock = false;
      continue;
    }

    if (/^with\b/.test(trimmed)) {
      if (/^with\s+TechCamp\(\)\s+as\s+bot:$/.test(trimmed)) {
        if (!importedTechCamp)
          addError(lineNumber, "Thiếu dòng import TechCamp ở đầu chương trình.");
        botCreated = true;
        knownPosition = false;
      } else {
        addError(lineNumber, "Dùng đúng mẫu: with TechCamp() as bot:");
      }
      previousOpenedBlock = true;
      continue;
    }

    if (/^if\b/.test(trimmed)) {
      const condition = trimmed.match(/^if\s+(\w+)\.get\(\s*["'](P[1-7])["']\s*\):$/);
      if (!condition)
        addError(lineNumber, 'Chỉ hỗ trợ điều kiện: if blocks.get("P3"):');
      else if (!variables.has(condition[1]))
        addError(lineNumber, `'${condition[1]}' chưa có dữ liệu. Hãy gọi blocks = bot.get_positions() trước.`);
      previousOpenedBlock = true;
      continue;
    }

    if (/^bot\s*=/.test(trimmed)) {
      if (!/^bot\s*=\s*TechCamp\(\)$/.test(trimmed))
        addError(lineNumber, "Dùng đúng mẫu khởi tạo: bot = TechCamp()");
      else {
        if (!importedTechCamp)
          addError(lineNumber, "Thiếu dòng import TechCamp ở đầu chương trình.");
        botCreated = true;
        knownPosition = false;
      }
      previousOpenedBlock = false;
      continue;
    }

    const readAssignment = trimmed.match(/^(\w+)\s*=\s*bot\.(get_positions|get_image)\(\s*\)$/);
    if (readAssignment) {
      if (!botCreated) addError(lineNumber, "Hãy tạo bot = TechCamp() trước khi gọi hàm.");
      variables.add(readAssignment[1]);
      previousOpenedBlock = false;
      continue;
    }
    if (/^\w+\s*=\s*bot\./.test(trimmed)) {
      addError(lineNumber, "Chỉ có thể gán kết quả từ bot.get_positions() hoặc bot.get_image().");
      previousOpenedBlock = false;
      continue;
    }

    const botCall = trimmed.match(/^bot\.(\w+)\((.*)\)$/);
    if (botCall) {
      const [, method, argument] = botCall;
      if (!botCreated) addError(lineNumber, "Hãy tạo bot = TechCamp() trước khi gọi hàm.");
      if (method === "move_to") {
        const point = quotedArgument(argument);
        if (!point) addError(lineNumber, 'move_to() cần một tên điểm có nháy, ví dụ move_to("P3").');
        else if (!TECHCAMP_STUDENT_POINTS.has(point.toUpperCase()))
          addError(lineNumber, `Điểm '${point}' không có. Chỉ dùng P1 đến P7 hoặc HOMECHESS.`);
        else {
          knownPosition = point.toUpperCase() !== "HOMECHESS";
          hasRobotCommand = true;
        }
      } else if (TECHCAMP_EMPTY_METHODS.has(method)) {
        if (argument.trim()) addError(lineNumber, `${method}() không nhận tham số.`);
        if (method === "move_down" && !knownPosition)
          addError(lineNumber, "move_down() cần có move_to(\"P1\" đến \"P7\") trước đó.");
        hasRobotCommand = true;
      } else if (TECHCAMP_READ_METHODS.has(method)) {
        addError(lineNumber, `Hãy lưu kết quả: data = bot.${method}().`);
      } else {
        addError(lineNumber, `bot.${method}() không nằm trong TechCamp API của bài học.`);
      }
      previousOpenedBlock = false;
      continue;
    }

    if (/^bot\./.test(trimmed)) {
      addError(lineNumber, "Cú pháp gọi hàm chưa đúng; cần đủ dấu ngoặc ().");
      previousOpenedBlock = false;
      continue;
    }

    if (/^print\(.*\)$/.test(trimmed)) {
      previousOpenedBlock = false;
      continue;
    }

    if (/^TechCamp\(/.test(trimmed))
      addError(lineNumber, "Gán đối tượng robot vào biến bot: bot = TechCamp().");
    else
      addError(lineNumber, "Không nhận diện được câu lệnh. Chỉ dùng các hàm TechCamp trong bài học.");
    previousOpenedBlock = trimmed.endsWith(":");
  }

  if (!importedTechCamp && source.trim())
    addError(1, "Thiếu: from techcamp_api import TechCamp");
  if (!botCreated && source.trim()) addError(1, "Thiếu: bot = TechCamp()");
  if (!hasRobotCommand && botCreated)
    addError(1, "Chưa có lệnh điều khiển robot (move_to, move_down, move_up, grip hoặc release).");
  return { errors: errors.sort((a, b) => a.line - b.line) };
}

async function runTechCampLine(trimmed, indent, context) {
  if (
    /^from\s+techcamp_api\s+import\s+TechCamp(?:\s*,\s*TechCampError)?$/.test(trimmed)
  )
    return true;
  if (
    /^with\s+TechCamp\(\)\s+as\s+bot:$/.test(trimmed) ||
    /^bot\s*=\s*TechCamp\(\)$/.test(trimmed)
  ) {
    startTechCamp();
    context.started = true;
    return true;
  }
  const ifMatch = trimmed.match(/^if\s+(\w+)\.get\(\s*["'](P[1-7])["']\s*\):$/);
  if (ifMatch) {
    context.skipIndent = indent;
    context.skip = !Boolean(context.vars[ifMatch[1]]?.[ifMatch[2]]);
    return true;
  }
  const positionMatch = trimmed.match(
    /^bot\.move_to\(\s*(.+?)\s*\)$/,
  );
  if (positionMatch) {
    const position = quotedArgument(positionMatch[1]);
    if (!position) throw new TechCampError('move_to() cần tên điểm dạng "P3"');
    await techcampSim.move_to(position);
    return true;
  }
  const methodMatch = trimmed.match(
    /^bot\.(move_down|move_up|grip|release|close)\(\s*\)$/,
  );
  if (methodMatch) {
    await techcampSim[methodMatch[1]]();
    return true;
  }
  const readMatch = trimmed.match(
    /^(\w+)\s*=\s*bot\.(get_positions|get_image)\(\s*\)$/,
  );
  if (readMatch) {
    context.vars[readMatch[1]] = await techcampSim[readMatch[2]]();
    log(`${readMatch[1]} = ${readMatch[2]}()`);
    return true;
  }
  const printMatch = trimmed.match(/^print\((.*)\)$/);
  if (printMatch) {
    log(`print: ${printMatch[1]}`);
    return true;
  }
  return false;
}

function clearCodeValidation() {
  const badge = $("codeValidation");
  const list = $("codeErrorList");
  if (badge) {
    badge.hidden = true;
    badge.classList.remove("is-valid", "has-errors");
  }
  if (list) {
    list.hidden = true;
    list.replaceChildren();
  }
}

function showPythonError(error) {
  const line = Number(error?.line) || 1;
  const column = Number(error?.column);
  const location = column ? "Dòng " + line + ", cột " + column : "Dòng " + line;
  const message = error?.message || "Lỗi Python.";
  renderCodeValidation({
    errors: [{ line, message: (column ? "Cột " + column + ": " : "") + message }],
  });
  focusProgramLine(line);
  log(location + " · PythonError: " + message);
}

function simulatorBlockPositions() {
  return Object.fromEntries(
    BLOCK_POSITIONS.map((name) => [name, Boolean(blockAt(name))]),
  );
}

async function runPythonProgram(token) {
  const response = await fetch("./api/python/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: $("program").value,
      positions: simulatorBlockPositions(),
    }),
    signal: token.controller.signal,
  });
  const payload = await response.json().catch(() => null);
  if (token.cancelled) return;
  if (!response.ok || !payload?.ok) {
    showPythonError(payload?.error || {
      message: "Không nhận được kết quả từ Python runner. Hãy khởi động lại serve.mjs.",
    });
    return;
  }
  for (const text of payload.output || []) {
    if (token.cancelled) return;
    log("print: " + String(text).replace(/\n$/, ""));
  }
  for (const action of payload.actions || []) {
    if (token.cancelled) return;
    try {
      if (action.type === "move_to") await techcampSim.move_to(action.position);
      else if (action.type === "move_down") await techcampSim.move_down();
      else if (action.type === "move_up") await techcampSim.move_up();
      else if (action.type === "grip") await techcampSim.grip();
      else if (action.type === "release") await techcampSim.release();
    } catch (error) {
      showPythonError({ line: action.line, message: error.message });
      return;
    }
  }
}

async function runProgram() {
  if (state.running || state.programRun) {
    await api.StopMotion();
    return;
  }
  clearCodeValidation();
  const token = { cancelled: false, controller: new AbortController() };
  state.programRun = token;
  renderState();
  try {
    await runPythonProgram(token);
  } catch (error) {
    if (!token.cancelled)
      showPythonError({
        message: error?.message || "Không kết nối được Python runner. Hãy khởi động lại serve.mjs.",
      });
  } finally {
    if (state.programRun === token) {
      state.programRun = null;
      renderState();
    }
  }
}

function bindUI() {
  initTheme();
  initCodeEditor();
  initWorkspaceTabs();
  initResizableWorkspace();
  renderHomePoint();
  renderJointControls();
  state.lastTargetPose = currentPose();
  renderTcp();
  renderTargetInputs();
  renderState();
  renderSafeZone();
  $("enableBtn").addEventListener("click", () => {
    state.enabled = !state.enabled;
    renderState();
    setStatus(
      state.enabled ? "SIM ENABLED · API RPC" : "SIMULATOR READY · FR3 V6",
      state.enabled ? "ready" : "",
    );
    log(state.enabled ? "Enable() -> 0" : "Disable() -> 0");
  });
  $("homeBtn").addEventListener("click", async () => {
    const selection = homePointRecord();
    if (!selection.point) {
      log("Home -> -2 (HOMELESS/HOME chưa có trong points.json)");
      return;
    }
    const result = await api.MoveJ(selection.point.joints);
    log(
      `Home -> ${result} · ${selection.name}${selection.fallback ? " (fallback from HOMELESS)" : ""}`,
    );
  });
  $("stopBtn").addEventListener("click", () => api.StopMotion());
  $("modeBtn").addEventListener("click", () =>
    api.Mode(state.automatic ? 0 : 1),
  );
  $("changeViewBtn").addEventListener("click", changeView);
  $("homeViewBtn").addEventListener("click", homeView);
  const speedButton = $("speedBtn");
  const speedPopover = $("speedPopover");
  const speedRange = $("speedRange");
  const setSpeedPopover = (open) => {
    if (!speedButton || !speedPopover) return;
    speedPopover.hidden = !open;
    speedButton.setAttribute("aria-expanded", String(open));
  };
  speedButton?.addEventListener("click", () =>
    setSpeedPopover(speedPopover?.hidden),
  );
  speedRange?.addEventListener("input", () => {
    state.speed = clamp(Number(speedRange.value) || 25, 5, 100);
    renderState();
  });
  speedRange?.addEventListener("change", () => {
    api.SetSpeed(speedRange.value);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!speedPopover || speedPopover.hidden) return;
    if (!event.target.closest(".speed-control")) setSpeedPopover(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setSpeedPopover(false);
  });
  $("applyBtn").addEventListener("click", () => api.MoveJ(state.targetDeg));
  $("moveLBtn").addEventListener("click", () =>
    api.MoveL(state.lastTargetPose),
  );
  $("runBtn").addEventListener("click", runProgram);
  $("clearLogBtn").addEventListener("click", () => {
    $("console").textContent = "";
  });
  $("safeZoneToggleBtn").addEventListener("click", () => {
    state.safeZone.enabled = !state.safeZone.enabled;
    state.safeZone.alert = null;
    updateSafeZone();
    log(`Safe Zone -> ${state.safeZone.enabled ? "ON" : "OFF"}`);
  });
}

bindUI();
loadModel();
