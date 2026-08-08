import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { stabilizeJointTarget, validateLivePacket } from "./live_state.mjs";
import {
  CHECKPOINT_TOKEN_ID,
  createCheckpointToken,
  resetCheckpointToken,
  transitionCheckpointToken,
} from "./checkpoint_token.mjs";
import { getApiPositions } from "./slot_layout.mjs";
import {
  ensureAnonymousUser,
  firebaseAvailable,
  uploadSubmission,
} from "./firebase-client.mjs";
import { initStudentSubmissionUi } from "./student-submissions.mjs";

const ROBOT_PROFILE_STORAGE_KEY = "techcamp-robot-profile";
const PROGRAM_STORAGE_KEY = "techcamp-program-source";
const LEGACY_CHECKPOINT_PROGRAM_MARKER =
  "# Demo checkpoint: move the orange token P1 -> P7 -> P1.";
const GRIPPER_FILE = "Assieme_pinza_dita_parallele.stp";
const GRIPPER_BASE = "./assets/fr3_v6/";
// The STEP assembly is authored in millimetres; its mounting face is at the J6 tool flange.
// The FR5 wrist3_link ends 102 mm beyond the J6 joint origin. The gripper is
// mounted at that tool-flange end, not at the J6 rotation center. Keep the
// existing FR3 calibration isolated so switching models cannot move its tool.
const GRIPPER_MOUNT_OFFSET_BY_PROFILE = Object.freeze({
  fr3: [-0.03, 0.014, 0.16],
  // The CAD origin is behind the mounting face; use the same calibrated
  // flange-to-CAD offset as FR3.  Using only the 102 mm J6 link length puts
  // the gripper body inside wrist3 instead of at the flange.
  fr5: [-0.03, 0.014, 0.16],
});
const GRIPPER_MOUNT_ROTATION_BY_PROFILE = Object.freeze({
  fr3: [Math.PI, 0, 0],
  // The CAD mounting face is on the opposite side of the STEP origin from
  // the FR5 flange, so the tool points outward from J6 instead of through it.
  fr5: [Math.PI, 0, 0],
});
const GRIPPER_SCALE = 0.0008;
const ROBOT_SHELL_COLOR = 0xbfc9d4;
const GRIPPER_FINGER_SOURCE_COLOR = 0x694d3b;
const GRIPPER_FINGER_TRAVEL = 16;
const GRIPPER_ANIMATION_MS = 220;
const GRIPPER_JAW_CENTER_CAD = [40.35, 17.5, -37.75];

function gripperMountOffset(profileId = state.robotProfileId) {
  return (
    GRIPPER_MOUNT_OFFSET_BY_PROFILE[profileId] ||
    GRIPPER_MOUNT_OFFSET_BY_PROFILE.fr3
  );
}
const BLOCK_SIZE = 0.04;
const JOINT_NAMES = ["J1", "J2", "J3", "J4", "J5", "J6"];
const JOINT_COLORS = [
  { hex: 0xef6b62, css: "#ef6b62" },
  { hex: 0xf3a64a, css: "#f3a64a" },
  { hex: 0xe4c354, css: "#e4c354" },
  { hex: 0x69c58a, css: "#69c58a" },
  { hex: 0x55abd9, css: "#55abd9" },
  { hex: 0x7d8fe0, css: "#7d8fe0" },
];
const JOINT_LIMITS_DEG = [
  [-175, 175],
  [-265, 85],
  [-162, 162],
  [-265, 85],
  [-175, 175],
  [-175, 175],
];
// Controller telemetry may report calibrated/unwrapped values outside the
// teaching slider ranges; keep a finite ±360° envelope for read-only packets.
const LIVE_JOINT_LIMITS_DEG = JOINT_LIMITS_DEG.map(() => [-360, 360]);
const LIVE_JOINT_DEADBAND_DEG = 0.02;
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
const FR3_KINEMATIC_ORIGINS = [
  [0, 0, 0],
  [0, 0, 0.14],
  [-0.28, 0, 0],
  [-0.24001, 0, 0],
  [0, 0, 0.102],
  [0, 0, 0.102],
];
const FR3_KINEMATIC_RPY = [
  [0, 0, 0],
  [Math.PI / 2, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [Math.PI / 2, 0, 0],
  [-Math.PI / 2, 0, 0],
];
const BLOCK_POSITIONS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const SORTABLE_BLOCK_NAMES = ["P1", "P3", "P5", "P6", "P7"];
const BUFFER_POSITION = BLOCK_POSITIONS.at(-1);
const SAMPLE_BLOCK_POSITIONS = {
  // Demo input order from P2 to P6: car, chicken, dog, chair, house.
  P1: "P3", // chicken
  P3: "P4", // dog
  P5: "P5", // chair
  P6: "P6", // house
  P7: "P2", // car
};
const BLOCK_META = Object.freeze({
  P1: { color: 0xf06b62, objectClass: "chicken" },
  P3: { color: 0xe7c85f, objectClass: "dog" },
  P5: { color: 0x56a9d9, objectClass: "chair" },
  P6: { color: 0x7187d8, objectClass: "umbrella" },
  P7: { color: 0xa879d6, objectClass: "elephant" },
});
const BLOCK_COLORS = [
  0xf06b62, 0xf3a64a, 0xe7c85f, 0x6fc88f, 0x56a9d9, 0x7187d8, 0xa879d6,
];
const ROBOT_PROFILES = Object.freeze({
  fr3: Object.freeze({
    id: "fr3",
    label: "FAIRINO FR3",
    meshBase: "./assets/fr3_v6/",
    visualJointOrigins: FR3_KINEMATIC_ORIGINS,
    visualJointRpy: FR3_KINEMATIC_RPY,
    provisional: false,
  }),
  fr5: Object.freeze({
    id: "fr5",
    label: "FAIRINO FR5",
    meshBase: "./assets/fr5_v6/",
    visualJointOrigins: [
      [0, 0, 0],
      [0, 0, 0.152],
      [-0.425, 0, 0],
      [-0.39501, 0, 0],
      [0, 0, 0.1021],
      [0, 0, 0.102],
    ],
    visualJointRpy: FR3_KINEMATIC_RPY,
    provisional: true,
  }),
});
const getRobotProfile = (id) => ROBOT_PROFILES[id] || ROBOT_PROFILES.fr3;
const SAFE_ZONE_BOUNDS = Object.freeze({
  fr3: Object.freeze({ x: [-500, 500], y: [-600, 600], z: [0, 850] }),
  // FR5 has a longer reach. Its visual FK chain extends farther in X, so the
  // teaching guard must cover the same footprint instead of blocking P1/P7.
  fr5: Object.freeze({ x: [-850, 350], y: [-500, 600], z: [0, 950] }),
});

function safeZoneBoundsForProfile(profileId) {
  const bounds = SAFE_ZONE_BOUNDS[profileId] || SAFE_ZONE_BOUNDS.fr3;
  return {
    x: [...bounds.x],
    y: [...bounds.y],
    z: [...bounds.z],
  };
}
const OBJECT_CLASSES = [
  { value: 1, id: "chicken", label: "Chicken" },
  { value: 2, id: "tree", label: "Tree" },
  { value: 3, id: "dog", label: "Dog" },
  { value: 4, id: "car", label: "Car" },
  { value: 5, id: "chair", label: "Chair" },
  { value: 6, id: "umbrella", label: "Umbrella" },
  { value: 7, id: "elephant", label: "Elephant" },
  { value: 8, id: "airplane", label: "Airplane" },
  { value: 9, id: "house", label: "House" },
];
// Workshop sticker set.  The files are copied into the static app so they
// remain available after deployment; the source folder on the developer
// machine is not a browser-accessible URL.
const OBJECT_CLASS_TEXTURE_FILES = Object.freeze({
  chicken: "./assets/sticker-objects/chicken.png",
  dog: "./assets/sticker-objects/dog.png",
  chair: "./assets/sticker-objects/chair.png",
  umbrella: "./assets/sticker-objects/house.png",
  elephant: "./assets/sticker-objects/car.png",
});
const TECHCAMP_MAX_SPEED = 40;
const TECHCAMP_MAX_ACC = 20;
const DEFAULT_HOME_JOINTS = [-90, -135, 126, 8.8, 85.2, 0];
// Keep the robot and the worktable together in the primary teaching view.
const HOME_CAMERA_TARGET = [0, 0.24, -0.3];
const HOME_CAMERA_ZOOM_DEFAULT = 118;
const HOME_CAMERA_ZOOM_RANGE = [100, 135];
const HOME_CAMERA_VIEWS = [
  { name: "Front", position: [0, 0.34, -1.55] },
  { name: "Right", position: [1.55, 0.85, 0] },
  { name: "Back", position: [-1.55, 0.85, 0] },
  { name: "Left", position: [0, 0.85, 1.55] },
];

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const deg = (v) => THREE.MathUtils.degToRad(v);
const rad = (v) => THREE.MathUtils.radToDeg(v);
const fmt = (v) => Number(v).toFixed(1);
const sleepFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

const state = {
  jointsDeg: [...DEFAULT_HOME_JOINTS],
  targetDeg: [...DEFAULT_HOME_JOINTS],
  enabled: true,
  automatic: false,
  running: false,
  speed: 25,
  modelReady: false,
  // FR5 is the workshop's default visual model.  Users can still switch
  // profiles explicitly from the selector, but a fresh page always starts
  // with the FR5 asset and its calibrated HOME pose.
  robotProfileId: "fr5",
  robotLoading: false,
  calibratedPoints: {},
  blocks: [],
  checkpointToken: createCheckpointToken(),
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
  liveStaleTimer: null,
  liveTcpPose: null,
  sceneObjectsVisible: true,
  safeZone: {
    enabled: true,
    example: true,
    margin: 50,
    alert: null,
    bounds: safeZoneBoundsForProfile("fr5"),
  },
  cameraZoom: HOME_CAMERA_ZOOM_DEFAULT,
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
let checkpointTokenMesh = null;
let cameraViewIndex = -1;
let jointRotators = [];
let modelMaterials = [];
let jointMaterials = [];
let activeRobotGroup = null;
let robotLoadGeneration = 0;
const robotGeometryCache = new Map();
const blockMeshes = new Map();
const objectClassTextures = new Map();
const gripperVisual = {
  group: null,
  loadPromise: null,
  fingers: [],
  closed: false,
  animation: null,
};
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

const PYTHON_TOKEN_PATTERN =
  /(#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(from|import|class|def|with|as|if|for|in|return|True|False|None)\b|\b(TechCamp|TechCampError)\b|\b(move_to|move_down|move_up|grip|release|get_image|get_positions|close)\b/g;

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
  const storedSource = localStorage.getItem(PROGRAM_STORAGE_KEY);
  if (storedSource !== null) {
    // Migrate only the old built-in checkpoint demo; preserve any student code.
    if (storedSource.includes(LEGACY_CHECKPOINT_PROGRAM_MARKER)) {
      localStorage.removeItem(PROGRAM_STORAGE_KEY);
    } else {
      editor.value = storedSource;
    }
  }
  const decrease = $("codeFontDecrease");
  const increase = $("codeFontIncrease");
  const storedSize = Number(localStorage.getItem("fr3-code-font-size"));
  let fontSize = clamp(Number.isFinite(storedSize) ? storedSize : 12, 11, 20);
  const applyFontSize = () => {
    document.documentElement.style.setProperty(
      "--code-font-size",
      `${fontSize}px`,
    );
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
  const persistSource = () =>
    localStorage.setItem(PROGRAM_STORAGE_KEY, editor.value);
  editor.addEventListener("input", () => {
    persistSource();
    render();
  });
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
    persistSource();
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
    setJointVisualization(tab.id === "controlTab");
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
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
    const maximum = Math.max(
      minimum,
      layout.getBoundingClientRect().width - 542,
    );
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
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current =
      parseFloat(
        getComputedStyle(layout).getPropertyValue("--code-column-width"),
      ) || layout.querySelector(".code-column").getBoundingClientRect().width;
    const maximum = Math.max(
      minimum,
      layout.getBoundingClientRect().width - 542,
    );
    const next =
      event.key === "Home"
        ? minimum
        : event.key === "End"
          ? maximum
          : current + (event.key === "ArrowRight" ? 24 : -24);
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

const FR3_FIXED_MATRICES = FR3_KINEMATIC_ORIGINS.map((origin, i) =>
  fixedMatrix(origin, FR3_KINEMATIC_RPY[i]),
);

// The FR5 mesh has longer links than FR3. Keep FK, TCP and the workpiece
// placement on the same profile-specific chain; using the old FR3 chain here
// makes the FR5 board appear offset from the gripper.
function fixedMatricesForProfile(profileId = "fr3") {
  if (profileId !== "fr5") return FR3_FIXED_MATRICES;
  const profile = ROBOT_PROFILES.fr5;
  return profile.visualJointOrigins.map((origin, i) =>
    fixedMatrix(origin, profile.visualJointRpy[i]),
  );
}

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
  const fixedMatrices = fixedMatricesForProfile(state.robotProfileId);
  jointsRad.forEach((joint, i) => {
    transform = transform.clone().multiply(fixedMatrices[i]);
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

function gripperJawOffset() {
  const mountOffset = gripperMountOffset();
  const mountRotation =
    GRIPPER_MOUNT_ROTATION_BY_PROFILE[state.robotProfileId] ||
    GRIPPER_MOUNT_ROTATION_BY_PROFILE.fr3;
  return new THREE.Vector3(...GRIPPER_JAW_CENTER_CAD)
    .multiplyScalar(GRIPPER_SCALE)
    .applyEuler(new THREE.Euler(...mountRotation))
    .add(new THREE.Vector3(...mountOffset));
}

function gripperJawMatrix(jointsDeg) {
  return fk(jointsDeg.map(deg)).end.multiply(
    new THREE.Matrix4().makeTranslation(...gripperJawOffset()),
  );
}

function gripperJawPose(jointsDeg) {
  return matrixToPose(gripperJawMatrix(jointsDeg));
}

function workpiecePose(point) {
  // Keep scene blocks in the same FK frame as the rendered gripper. The
  // calibrated cart field is controller/world-frame data and is only used
  // for readouts; mixing it here offsets blocks from the visual tool center.
  return gripperJawPose(point.joints);
}

function initTeacherPortalShortcut() {
  const logo = $("teacherPortalShortcut");
  const dialog = $("teacherAccessDialog");
  const form = $("teacherAccessForm");
  const password = $("teacherAccessPassword");
  const submit = $("teacherAccessSubmit");
  const error = $("teacherAccessError");
  if (!logo || !dialog || !form || !password || !submit) return;

  let clicks = 0;
  let lastClickAt = 0;
  const openDialog = () => {
    clicks = 0;
    password.value = "";
    if (error) error.textContent = "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.open = true;
    password.focus();
  };
  const countClick = () => {
    const now = Date.now();
    clicks = now - lastClickAt <= 900 ? clicks + 1 : 1;
    lastClickAt = now;
    if (clicks === 3) openDialog();
  };
  const verify = () => {
    if (password.value === "090909" || password.value === "stemtechx") {
      window.location.href = "./teacher.html";
      return;
    }
    if (error) error.textContent = "Mật khẩu chưa đúng.";
    password.select();
  };

  logo.addEventListener("click", countClick);
  logo.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      countClick();
    }
  });
  submit.addEventListener("click", verify);
  password.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      verify();
    }
  });
  form.addEventListener("submit", (event) => {
    if (event.submitter === submit) event.preventDefault();
  });
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
  const point = pointRecord("HOME");
  return { name: "HOME", point, fallback: false };
}

function renderHomePoint() {
  const selection = homePointRecord();
  const badge = $("homePointBadge");
  if (badge) badge.textContent = selection.point ? "HOME" : "MISSING";
  const home = $("homeBtn");
  if (home)
    home.title = selection.point
      ? "Move robot to HOME"
      : "HOME point is missing";
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

function makeFrontBoardLabel(text, color = "#dcecff") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 112;
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.font = "800 58px Consolas, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  const mirroredTeachingView = cameraViewIndex === 0;
  texture.repeat.x = mirroredTeachingView ? 1 : -1;
  texture.offset.x = mirroredTeachingView ? 0 : 1;
  texture.needsUpdate = true;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 0.032),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // The teaching camera can be viewed from either side of the board.
      side: THREE.DoubleSide,
    }),
  );
  label.userData.boardLabelTexture = texture;
  label.renderOrder = 3;
  // Plane faces the table's front (local +Y), which is the Home-camera side.
  label.rotation.x = -Math.PI / 2;
  return label;
}

function objectClassForBlock(blockName) {
  const objectClassId = BLOCK_META[blockName]?.objectClass;
  return OBJECT_CLASSES.find((item) => item.id === objectClassId) || null;
}

function checkpointTokenCarried() {
  return Boolean(state.checkpointToken?.carried);
}

function updateCheckpointTokenVisual() {
  if (!checkpointTokenMesh) return;
  if (!state.sceneObjectsVisible) {
    checkpointTokenMesh.visible = false;
    return;
  }
  const point = checkpointTokenCarried()
    ? gripperJawPose(state.jointsDeg)
    : pointRecord(state.checkpointToken?.position || "P1");
  const cart = Array.isArray(point)
    ? point
    : point
      ? workpiecePose(point)
      : null;
  if (!cart) return;
  checkpointTokenMesh.position.set(
    cart[0] / 1000,
    cart[1] / 1000,
    cart[2] / 1000,
  );
  checkpointTokenMesh.visible = true;
}

function applyCheckpointTokenPlacement(from, to, carried = true) {
  const result = transitionCheckpointToken(
    { ...state.checkpointToken, carried },
    { type: "release", tokenId: CHECKPOINT_TOKEN_ID, from, to },
    { sortableBlocks: state.blocks },
  );
  if (!result.accepted) return false;
  state.checkpointToken = result.token;
  updateCheckpointTokenVisual();
  log(`Orange marker placed at ${to}`);
  return true;
}

function syncBoardLabelMirroring() {
  const mirroredTeachingView = cameraViewIndex === 0;
  boardGroup?.traverse((object) => {
    const texture = object.userData?.boardLabelTexture;
    if (!texture) return;
    texture.repeat.x = mirroredTeachingView ? 1 : -1;
    texture.offset.x = mirroredTeachingView ? 0 : 1;
    texture.needsUpdate = true;
  });
}

function objectClassTexture(objectClass) {
  if (!objectClass) return null;
  const existing = objectClassTextures.get(objectClass.id);
  if (existing) return existing;
  const texture = new THREE.TextureLoader().load(
    OBJECT_CLASS_TEXTURE_FILES[objectClass.id] ||
      `./assets/object-classes/${objectClass.id}.jpg`,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  objectClassTextures.set(objectClass.id, texture);
  return texture;
}

function objectClassMaterials(objectClass) {
  const texture = objectClassTexture(objectClass);
  return Array.from({ length: 6 }, (_, faceIndex) => {
    // BoxGeometry material 2 is the local +Y face visible in Home camera.
    const map = faceIndex === 2 && texture ? texture.clone() : texture;
    if (faceIndex === 2 && map) {
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.y = -1;
      map.offset.y = 1;
      map.needsUpdate = true;
    }
    return new THREE.MeshStandardMaterial({
      color: texture ? 0xffffff : 0x52677d,
      map,
      roughness: 0.52,
      metalness: 0.02,
    });
  });
}

function setSceneObjectsVisible(visible) {
  state.sceneObjectsVisible = Boolean(visible);
  if (boardGroup) boardGroup.visible = state.sceneObjectsVisible;
  const stateStrip = $("blockStateStrip");
  if (stateStrip) {
    stateStrip.hidden = !state.sceneObjectsVisible;
    stateStrip.setAttribute("aria-hidden", String(!state.sceneObjectsVisible));
  }
  if (!state.sceneObjectsVisible) {
    blockMeshes.forEach((mesh) => {
      mesh.visible = false;
    });
    if (checkpointTokenMesh) checkpointTokenMesh.visible = false;
  } else {
    updateBlockVisuals();
    updateCheckpointTokenVisual();
  }
  const button = $("toggleSceneObjectsBtn");
  if (!button) return;
  const hidden = !state.sceneObjectsVisible;
  button.setAttribute("aria-pressed", String(hidden));
  button.textContent = hidden ? "Show table & blocks" : "Hide table & blocks";
  button.title = hidden
    ? "Show the table and blocks"
    : "Hide the table and blocks";
}

function buildBlockBoard() {
  if (!robotRoot || !BLOCK_POSITIONS.every((name) => pointRecord(name))) return;
  if (boardGroup) robotRoot.remove(boardGroup);
  blockMeshes.clear();
  checkpointTokenMesh = null;
  boardGroup = new THREE.Group();
  boardGroup.name = "TechCampBlockBoard";
  boardGroup.visible = state.sceneObjectsVisible;
  robotRoot.add(boardGroup);
  const workpiecePoses = BLOCK_POSITIONS.map((name) =>
    workpiecePose(pointRecord(name)),
  );
  const boardCenter = workpiecePoses
    .reduce(
      (center, pose) => center.add(new THREE.Vector3(...pose.slice(0, 3))),
      new THREE.Vector3(),
    )
    .multiplyScalar(1 / workpiecePoses.length);
  // Keep a block's centre at the gripper jaw centre while its base rests on the table.
  const boardSurfaceZ = boardCenter.z / 1000 - BLOCK_SIZE / 2;
  // Keep the original tabletop depth; only make the table thicker vertically.
  const boardSize = { length: 0.56, depth: 0.18, thickness: 0.028 };
  const boardMaterial = new THREE.MeshStandardMaterial({
    color: 0x24364b,
    roughness: 0.76,
    metalness: 0.08,
  });
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(
      boardSize.length,
      boardSize.depth,
      boardSize.thickness,
    ),
    boardMaterial,
  );
  board.position.set(
    boardCenter.x / 1000,
    boardCenter.y / 1000,
    boardSurfaceZ - boardSize.thickness / 2,
  );
  board.receiveShadow = true;
  boardGroup.add(board);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x6c87a3,
    transparent: true,
    opacity: 0.72,
  });
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(
      new THREE.BoxGeometry(
        boardSize.length,
        boardSize.depth,
        boardSize.thickness,
      ),
    ),
    edgeMaterial,
  );
  edge.position.copy(board.position);
  boardGroup.add(edge);
  BLOCK_POSITIONS.forEach((name, index) => {
    const point = pointRecord(name);
    const cart = workpiecePose(point);
    const cell = new THREE.Mesh(
      new THREE.BoxGeometry(0.066, boardSize.depth - 0.012, 0.004),
      new THREE.MeshBasicMaterial({
        color: 0x34506b,
        transparent: true,
        opacity: 0.38,
      }),
    );
    cell.position.set(cart[0] / 1000, cart[1] / 1000, boardSurfaceZ + 0.002);
    boardGroup.add(cell);
    const cellEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(0.066, boardSize.depth - 0.012, 0.006),
      ),
      edgeMaterial,
    );
    cellEdge.position.copy(cell.position);
    boardGroup.add(cellEdge);
    // Keep the visible board label tied to the same calibrated point ID.
    // Reversing this list makes a physical P1 look like P7 in the camera.
    const frontLabelName = name;
    const frontLabel = makeFrontBoardLabel(
      frontLabelName,
      frontLabelName === "P1" ? "#f7b0a8" : "#dcecff",
    );
    frontLabel.position.set(
      cart[0] / 1000,
      board.position.y + boardSize.depth / 2 + 0.002,
      board.position.z,
    );
    boardGroup.add(frontLabel);
  });
  SORTABLE_BLOCK_NAMES.forEach((name) => {
    const objectClass = objectClassForBlock(name);
    if (!objectClass) return;
    const blockGroup = new THREE.Group();
    blockGroup.name = `block-${name}`;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE),
      objectClassMaterials(objectClass),
    );
    body.castShadow = true;
    body.receiveShadow = true;
    blockGroup.add(body);
    boardGroup.add(blockGroup);
    blockMeshes.set(name, blockGroup);
  });
  const tokenMaterial = new THREE.MeshStandardMaterial({
    color: 0xf47b20,
    roughness: 0.38,
    metalness: 0.04,
    emissive: 0x3b1400,
    emissiveIntensity: 0.12,
  });
  checkpointTokenMesh = new THREE.Mesh(
    new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE),
    tokenMaterial,
  );
  checkpointTokenMesh.name = CHECKPOINT_TOKEN_ID;
  checkpointTokenMesh.userData.tokenId = CHECKPOINT_TOKEN_ID;
  checkpointTokenMesh.castShadow = true;
  checkpointTokenMesh.receiveShadow = true;
  boardGroup.add(checkpointTokenMesh);
  renderBlockBoard();
  updateBlockVisuals();
  updateCheckpointTokenVisual();
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
  if (!state.sceneObjectsVisible) {
    blockMeshes.forEach((mesh) => {
      mesh.visible = false;
    });
    return;
  }
  const gripCenter = gripperJawPose(state.jointsDeg);
  blockMeshes.forEach((mesh) => {
    mesh.visible = false;
  });
  state.blocks.forEach((block) => {
    const mesh = blockMeshes.get(block.name);
    if (!mesh) return;
    const point = block.carried
      ? gripCenter
      : pointRecord(block.position === "HOMECHESS" ? "HOME" : block.position);
    const cart = Array.isArray(point)
      ? point
      : point
        ? workpiecePose(point)
        : null;
    if (!cart) return;
    mesh.position.set(cart[0] / 1000, cart[1] / 1000, cart[2] / 1000);
    mesh.visible = true;
  });
  updateCheckpointTokenVisual();
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
      `${remaining} blocks${carrying ? ` · carrying ${carrying.name}` : " · orange marker available"}`;
  if ($("blockLegend"))
    $("blockLegend").innerHTML = BLOCK_POSITIONS.map(
      (name, index) =>
        `<div class="block-token ${occupied.has(name) ? "" : "empty"}"><span class="block-swatch" style="background:#${BLOCK_COLORS[index].toString(16).padStart(6, "0")};color:#${BLOCK_COLORS[index].toString(16).padStart(6, "0")}"></span><span>${name}</span><span>${occupied.has(name) ? "READY" : "EMPTY"}</span></div>`,
    ).join("");
}

let draggedBlockName = null;
let draggedToken = false;
let pointerDraggedBlockName = null;
let selectedBlockName = null;
let pointerDragBound = false;

function clearPointerBlockDrag() {
  pointerDraggedBlockName = null;
  draggedToken = false;
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
  if (
    position === state.checkpointToken?.position &&
    !checkpointTokenCarried()
  ) {
    log(`Orange marker occupies ${position}; block move rejected`);
    return;
  }
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
  document.querySelectorAll("[data-token-id]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      draggedToken = true;
      card.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", CHECKPOINT_TOKEN_ID);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
      draggedToken = false;
      card.classList.remove("dragging");
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
      if (draggedToken || name === CHECKPOINT_TOKEN_ID) {
        const from = state.checkpointToken.position;
        const target = slot.dataset.dropPosition;
        const accepted = applyCheckpointTokenPlacement(from, target, true);
        if (!accepted)
          state.checkpointToken = { ...state.checkpointToken, carried: false };
      } else if (name) moveBlockToPosition(name, slot.dataset.dropPosition);
      draggedBlockName = null;
      draggedToken = false;
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
      const tokenHere =
        state.checkpointToken?.position === position &&
        !checkpointTokenCarried();
      const color = block
        ? "#" + block.color.toString(16).padStart(6, "0")
        : tokenHere
          ? "#f47b20"
          : "transparent";
      const slotState = tokenHere
        ? "orange marker"
        : block
          ? "occupied"
          : carrying
            ? "carrying"
            : "empty";
      return (
        '<button class="block-state-slot' +
        (block || tokenHere ? " is-occupied" : " is-empty") +
        (tokenHere ? " checkpoint-token-slot" : "") +
        (block?.name === selectedBlockName ? " is-selected" : "") +
        '" style="--block-color:' +
        color +
        '" type="button" draggable="' +
        String(Boolean(block || tokenHere)) +
        '" data-drop-position="' +
        position +
        '"' +
        (block ? ' data-block-name="' + block.name + '"' : "") +
        (tokenHere ? ' data-token-id="' + CHECKPOINT_TOKEN_ID + '"' : "") +
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
      (carrying
        ? " · carrying " + carrying.name
        : " · orange marker available");
  if ($("blockLegend")) {
    $("blockLegend").innerHTML = BLOCK_POSITIONS.map((position, index) => {
      const blocks = state.blocks.filter(
        (block) => !block.carried && block.position === position,
      );
      const tokenHere =
        state.checkpointToken?.position === position &&
        !checkpointTokenCarried();
      const color = blocks.length
        ? "#" + blocks[0].color.toString(16).padStart(6, "0")
        : "#" + BLOCK_COLORS[index].toString(16).padStart(6, "0");
      const cards = blocks.length
        ? blocks
            .map(
              (block) =>
                '<button class="block-card" type="button" draggable="true" data-block-name="' +
                block.name +
                '" aria-label="Drag block ' +
                block.name +
                " from " +
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
        : tokenHere
          ? '<span class="slot-empty">ORANGE MARKER</span>'
          : '<span class="slot-empty">DROP HERE</span>';
      return (
        '<div class="block-slot" data-drop-position="' +
        position +
        '" aria-label="Slot ' +
        position +
        '"><div class="block-slot-head"><strong>' +
        position +
        "</strong><span>" +
        (blocks.length ? blocks.length + " blocks" : "empty") +
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
    color: BLOCK_META[name]?.color ?? BLOCK_COLORS[index],
    objectClass: objectClassForBlock(name),
    carried: false,
  }));
  state.checkpointToken = resetCheckpointToken();
  techcampSim.position = null;
  techcampSim.low = false;
  techcampSim.gripping = false;
  techcampSim.carriedBlock = null;
  techcampSim.carriedToken = false;
  renderBlockBoard();
  updateBlockVisuals();
  if (!silent)
    log("Scene reset -> P1 cam · P2 xe · P3 gà · P4 chó · P5 ghế · P6 nhà · P7 trống");
}

async function loadCalibratedPoints(profileId = state.robotProfileId) {
  try {
    const pointFile =
      profileId === "fr5" ? "./points-fr5.json" : "./points.json";
    const response = await fetch(pointFile, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.calibratedPoints = normalizePointData(await response.json());
    renderHomePoint();
    resetBlocks(true);
    buildBlockBoard();
  } catch (error) {
    log(`${profileId} points error: ${error.message}`);
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
        ? `NEAR EDGE · ${Math.max(0, clearance).toFixed(0)} mm remaining`
        : `IN ZONE · clearance ${clearance.toFixed(0)} mm`,
    clearance,
    outside,
  };
}

function evaluateSafeZone() {
  if (!state.safeZone.enabled)
    return {
      status: "disabled",
      label: "OFF · checks disabled",
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
        reason: `IK did not converge at waypoint ${i}/${steps}`,
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
  const runButton = $("runBtn");
  const programRunning = state.running || Boolean(state.programRun);
  const profileSelector = $("robotProfileSelect");
  const profileLocked =
    programRunning ||
    state.live ||
    state.robotLoading ||
    Boolean(gripperVisual.animation);
  if (profileSelector) {
    profileSelector.disabled = profileLocked;
    profileSelector.setAttribute("aria-busy", String(state.robotLoading));
  }
  const profileStatus = $("robotProfileStatus");
  if (profileStatus)
    profileStatus.textContent = state.robotLoading
      ? `Loading ${getRobotProfile(state.robotProfileId).label} model`
      : profileLocked && (programRunning || state.live)
        ? "Robot model selection is locked while the simulator is running"
        : `${getRobotProfile(state.robotProfileId).label} selected`;
  if (runButton) {
    runButton.classList.toggle("primary", !programRunning);
    runButton.classList.toggle("danger", programRunning);
    // Do not allow a program to start while points/model are still loading.
    // The initial points fetch resets the demo fixture to P1, so starting in
    // that window can make a token appear to jump back during P1 -> P7.
    runButton.disabled = Boolean(
      state.live ||
      state.robotLoading ||
      (!programRunning && !state.modelReady),
    );
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
      `<div class="joint-row" style="--joint-color:${JOINT_COLORS[i].css}"><label for="joint-range-${i}"><span class="joint-color-dot" aria-hidden="true"></span>${name}</label><input id="joint-range-${i}" class="range" data-joint-range="${i}" type="range" min="${JOINT_LIMITS_DEG[i][0]}" max="${JOINT_LIMITS_DEG[i][1]}" step="0.1" value="${state.targetDeg[i]}" aria-label="${name} target"><input class="number" data-joint-number="${i}" type="number" min="${JOINT_LIMITS_DEG[i][0]}" max="${JOINT_LIMITS_DEG[i][1]}" step="0.1" value="${fmt(state.targetDeg[i])}" aria-label="${name} target in degrees"><span class="joint-limit">${JOINT_LIMITS_DEG[i][0]}° … ${JOINT_LIMITS_DEG[i][1]}°</span></div>`,
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
  const pose =
    state.live && state.liveTcpPose ? state.liveTcpPose : currentPose();
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

function setJointVisualization(active) {
  jointMaterials.forEach((material, index) => {
    material.color.setHex(
      active ? JOINT_COLORS[Math.min(index, 5)].hex : ROBOT_SHELL_COLOR,
    );
  });
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
    "robotProfileSelect",
  ].forEach((id) => {
    if ($(id)) $(id).disabled = locked;
  });
  document
    .querySelectorAll(
      "[data-joint-range], [data-joint-number], [data-target-pose]",
    )
    .forEach((input) => {
      input.disabled = locked;
    });
  if ($("liveBtn")) {
    $("liveBtn").textContent = locked ? "Disconnect" : "Connect";
    $("liveBtn").title = locked
      ? "Disconnect read-only FR5 telemetry"
      : "Connect to read-only FR5 telemetry";
  }
}

function applyLiveState(payload) {
  const validation = validateLivePacket(payload, LIVE_JOINT_LIMITS_DEG, "FR5");
  if (!validation.ok) {
    log(`Live packet rejected: ${validation.reason}`);
    return false;
  }
  const { joints: rawTarget, tcp } = validation;
  const nextTarget = stabilizeJointTarget(
    rawTarget,
    state.liveTargetDeg,
    LIVE_JOINT_DEADBAND_DEG,
  );
  if (state.running) {
    if (state.activeMotion) state.activeMotion.cancelled = true;
    state.running = false;
  }
  state.live = true;
  state.lastLiveAt = Number.isFinite(Number(payload.timestamp))
    ? Number(payload.timestamp)
    : Date.now() / 1000;
  state.liveTcpPose = tcp;
  const now = performance.now();
  const targetChanged =
    !state.liveTargetDeg ||
    nextTarget.some(
      (value, index) =>
        Math.abs(value - state.liveTargetDeg[index]) >= LIVE_JOINT_DEADBAND_DEG,
    );
  if (targetChanged) {
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
  }
  state.livePacketReceivedAt = now;
  state.targetDeg = [...nextTarget];
  syncDisplayedJointValues();
  if ($("liveState")) {
    $("liveState").textContent = "LIVE";
    $("liveState").title =
      `Last update ${new Date(state.lastLiveAt * 1000).toLocaleTimeString()}`;
  }
  renderTcp();
  renderSafeZone();
  return true;
}

function disconnectLive() {
  const socket = state.liveSocket;
  state.liveSocket = null;
  state.live = false;
  state.liveFromDeg = null;
  state.liveTargetDeg = null;
  state.liveAnimationStart = 0;
  state.livePacketReceivedAt = 0;
  state.liveTcpPose = null;
  if (state.liveStaleTimer) {
    clearInterval(state.liveStaleTimer);
    state.liveStaleTimer = null;
  }
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  setLiveControlLock(false);
  if ($("liveState")) {
    $("liveState").textContent = "OFFLINE";
    $("liveState").title = "Live telemetry is offline";
  }
  setStatus(readyStatus(), state.modelReady ? "ready" : "");
  renderState();
  renderTcp();
  log("Live monitor disconnected");
}

function connectLive() {
  if (state.liveSocket && state.liveSocket.readyState <= 1) {
    disconnectLive();
    return;
  }
  if (state.robotProfileId !== "fr5") {
    if ($("liveState")) {
      $("liveState").textContent = "SELECT FR5 FIRST";
      $("liveState").title = "Select FAIRINO FR5 before connecting";
    }
    setStatus("SELECT FAIRINO FR5 BEFORE LIVE", "error");
    log("Live monitor requires the FAIRINO FR5 model");
    return;
  }
  const configured =
    new URLSearchParams(location.search).get("ws") || "ws://127.0.0.1:8765";
  let socket;
  try {
    socket = new WebSocket(configured);
  } catch (error) {
    if ($("liveState")) {
      $("liveState").textContent = "URL ERROR";
      $("liveState").title = "The telemetry WebSocket URL is invalid";
    }
    setStatus("LIVE URL ERROR", "error");
    log(`Live connect error: ${error.message}`);
    return;
  }
  state.liveSocket = socket;
  // Lock every motion/program control while the socket is CONNECTING as well
  // as when it becomes LIVE.  Unlocking is handled only from onclose.
  setLiveControlLock(true);
  if ($("liveState")) {
    $("liveState").textContent = "CONNECTING";
    $("liveState").title = "Connecting to read-only FR5 telemetry";
  }
  setStatus("CONNECTING FAIRINO TELEMETRY…");
  log(`Live monitor -> ${configured}`);
  socket.onopen = () => {
    state.live = true;
    // Start the stale watchdog at connection time so a socket that never
    // delivers a valid frame cannot leave the UI locked forever.
    state.livePacketReceivedAt = performance.now();
    setLiveControlLock(true);
    setStatus("LIVE TELEMETRY · READ ONLY", "ready");
    if ($("liveState")) {
      $("liveState").textContent = "LIVE";
      $("liveState").title = "Waiting for FR5 telemetry";
    }
    if (state.liveStaleTimer) clearInterval(state.liveStaleTimer);
    state.liveStaleTimer = setInterval(() => {
      if (
        state.live &&
        state.livePacketReceivedAt &&
        performance.now() - state.livePacketReceivedAt > 2000
      ) {
        if ($("liveState")) {
          $("liveState").textContent = "STALE";
          $("liveState").title = "No valid telemetry received for 2 seconds";
        }
        setStatus("LIVE TELEMETRY STALE", "error");
        log("Live telemetry stale for 2 seconds; closing connection");
        socket.close();
      }
    }, 250);
    renderState();
    log("Live WebSocket connected; motion controls locked");
  };
  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "robot_state") applyLiveState(payload);
      else if (payload.type === "error") {
        if ($("liveState")) {
          $("liveState").textContent = "ERROR";
          $("liveState").title = payload.message || "Live telemetry error";
        }
        setStatus("LIVE TELEMETRY ERROR", "error");
        log(`Live telemetry error: ${payload.message}`);
        socket.close();
      }
    } catch (error) {
      log(`Live message error: ${error.message}`);
    }
  };
  socket.onerror = () => {
    setStatus("LIVE TELEMETRY ERROR", "error");
    if ($("liveState")) {
      $("liveState").textContent = "ERROR";
      $("liveState").title = "Live telemetry connection error";
    }
    log("Live WebSocket error");
    socket.close();
  };
  socket.onclose = () => {
    if (state.liveSocket !== socket) return;
    state.liveSocket = null;
    state.live = false;
    state.liveFromDeg = null;
    state.liveTargetDeg = null;
    state.liveAnimationStart = 0;
    state.livePacketReceivedAt = 0;
    state.liveTcpPose = null;
    if (state.liveStaleTimer) {
      clearInterval(state.liveStaleTimer);
      state.liveStaleTimer = null;
    }
    setLiveControlLock(false);
    if ($("liveState")) {
      $("liveState").textContent = "OFFLINE";
      $("liveState").title = "Live telemetry is offline";
    }
    setStatus("LIVE OFFLINE", "error");
    renderState();
    renderSafeZone();
    renderTcp();
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
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $("viewport").appendChild(renderer.domElement);
  renderer.domElement.style.transformOrigin = "center center";
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.5, 0);
  controls.minDistance = 0.35;
  controls.maxDistance = 4;
  setHomeCameraView(0);
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
    renderScene();
  };
  loop(performance.now());
}

function renderScene() {
  if (!renderer || !scene || !camera) return;
  const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, buffer.x, buffer.y);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
}

function loadSTL(loader, profile, file) {
  return new Promise((resolve, reject) =>
    loader.load(`${profile.meshBase}${file}.STL`, resolve, undefined, reject),
  );
}

function buildStepMesh(stepMesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(stepMesh.attributes.position.array, 3),
  );
  if (stepMesh.attributes.normal) {
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(stepMesh.attributes.normal.array, 3),
    );
  } else {
    geometry.computeVertexNormals();
  }
  geometry.setIndex(
    new THREE.BufferAttribute(Uint32Array.from(stepMesh.index.array), 1),
  );
  geometry.computeBoundingSphere();
  const [red = 0.44, green = 0.31, blue = 0.22] = stepMesh.color || [];
  const material = new THREE.MeshStandardMaterial({
    color: ROBOT_SHELL_COLOR,
    roughness: 0.62,
    metalness: 0.12,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.isGripperFinger =
    new THREE.Color(red, green, blue).getHex() === GRIPPER_FINGER_SOURCE_COLOR;
  return mesh;
}

function setGripperClosed(closed) {
  if (!gripperVisual.fingers.length || gripperVisual.closed === closed) {
    return Promise.resolve();
  }
  if (gripperVisual.animation) return gripperVisual.animation;
  const fingers = gripperVisual.fingers.map(
    ({ mesh, openPosition, direction }) => ({
      mesh,
      from: mesh.position.clone(),
      to: openPosition
        .clone()
        .addScaledVector(
          new THREE.Vector3(1, 0, 0),
          closed ? direction * GRIPPER_FINGER_TRAVEL : 0,
        ),
    }),
  );
  gripperVisual.animation = new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = clamp((now - startedAt) / GRIPPER_ANIMATION_MS, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      fingers.forEach(({ mesh, from, to }) =>
        mesh.position.lerpVectors(from, to, eased),
      );
      if (progress < 1) {
        requestAnimationFrame(tick);
        return;
      }
      gripperVisual.closed = closed;
      gripperVisual.animation = null;
      resolve();
    };
    requestAnimationFrame(tick);
  });
  return gripperVisual.animation;
}

async function loadSharedGripper() {
  if (gripperVisual.group) return gripperVisual.group;
  if (gripperVisual.loadPromise) return gripperVisual.loadPromise;
  gripperVisual.loadPromise = (async () => {
    if (typeof window.occtimportjs !== "function") {
      throw new Error("STEP importer is not available");
    }
    const response = await fetch(`${GRIPPER_BASE}${GRIPPER_FILE}`);
    if (!response.ok)
      throw new Error(`Unable to load gripper (HTTP ${response.status})`);
    const occt = await window.occtimportjs();
    const result = occt.ReadStepFile(
      new Uint8Array(await response.arrayBuffer()),
      {
        linearUnit: "millimeter",
        linearDeflectionType: "bounding_box_ratio",
        linearDeflection: 0.001,
        angularDeflection: 0.5,
      },
    );
    if (!result.success || !result.meshes?.length) {
      throw new Error("The gripper STEP file has no valid geometry");
    }
    const gripper = new THREE.Group();
    gripper.name = "parallel_gripper";
    gripper.userData.robotVisualRole = "shared-gripper";
    gripperVisual.fingers = [];
    result.meshes.forEach((stepMesh) => {
      const mesh = buildStepMesh(stepMesh);
      if (mesh.userData.isGripperFinger) {
        const bounds = new THREE.Box3().setFromBufferAttribute(
          mesh.geometry.getAttribute("position"),
        );
        gripperVisual.fingers.push({
          mesh,
          openPosition: mesh.position.clone(),
          direction: bounds.getCenter(new THREE.Vector3()).x < 40 ? 1 : -1,
        });
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      gripper.add(mesh);
    });
    gripperVisual.group = gripper;
    return gripper;
  })().catch((error) => {
    gripperVisual.loadPromise = null;
    throw error;
  });
  return gripperVisual.loadPromise;
}

function disposeRobotArm(candidate) {
  if (!candidate?.group) return;
  candidate.group.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => material?.dispose?.());
  });
}

async function buildRobotArm(profile) {
  const loader = new STLLoader();
  const candidate = {
    group: new THREE.Group(),
    jointRotators: [],
    modelMaterials: [],
    jointMaterials: [],
  };
  candidate.group.name = `robot-arm-${profile.id}`;
  candidate.group.userData.robotVisualRole = "arm";
  const makeRobotMaterial = () => {
    const material = new THREE.MeshStandardMaterial({
      color: ROBOT_SHELL_COLOR,
      roughness: 0.62,
      metalness: 0.12,
    });
    candidate.modelMaterials.push(material);
    candidate.jointMaterials.push(material);
    return material;
  };
  try {
    const baseGeometry = await loadSTL(loader, profile, "base_link");
    const baseMesh = new THREE.Mesh(baseGeometry, makeRobotMaterial());
    baseMesh.name = `${profile.id}-base_link`;
    baseMesh.userData.robotVisualRole = "arm-link";
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    candidate.group.add(baseMesh);
    let parent = candidate.group;
    for (let i = 0; i < 6; i++) {
      const frame = new THREE.Group();
      frame.name = `${profile.id}-joint-frame-${i + 1}`;
      frame.position.fromArray(profile.visualJointOrigins[i]);
      frame.rotation.set(...profile.visualJointRpy[i]);
      parent.add(frame);
      const rotator = new THREE.Group();
      rotator.name = `${profile.id}-joint-rotator-${i + 1}`;
      rotator.userData.robotVisualRole = "joint-rotator";
      frame.add(rotator);
      candidate.jointRotators.push(rotator);
      const geometry = await loadSTL(loader, profile, LINK_FILES[i + 1]);
      const mesh = new THREE.Mesh(geometry, makeRobotMaterial());
      mesh.name = `${profile.id}-${LINK_FILES[i + 1]}`;
      mesh.userData.robotVisualRole = "arm-link";
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      rotator.add(mesh);
      parent = rotator;
    }
    return candidate;
  } catch (error) {
    disposeRobotArm(candidate);
    throw error;
  }
}

function readyStatus(profile = getRobotProfile(state.robotProfileId)) {
  return `${profile.label} simulator ready`;
}

function syncRobotProfileUi(profile = getRobotProfile(state.robotProfileId)) {
  const selector = $("robotProfileSelect");
  if (selector) selector.value = profile.id;
  const modelStatus = $("modelStatus");
  if (modelStatus)
    modelStatus.textContent = `${profile.label} visual model loaded · ${profile.id.toUpperCase()} points loaded`;
  if (modelStatus)
    modelStatus.title = `${profile.label} visual model loaded · ${profile.id.toUpperCase()} points loaded`;
  const viewport = $("viewport");
  if (viewport)
    viewport.setAttribute(
      "aria-label",
      `${profile.label} 3D model interactive with mouse or touch`,
    );
}

function getRobotVisualDiagnostics() {
  const armGroups = [];
  let linkCount = 0;
  let gripperCount = 0;
  let gripperParent = null;
  let gripperJoint = null;
  robotRoot?.traverse((object) => {
    if (object.userData?.robotVisualRole === "arm") armGroups.push(object.name);
    if (object.userData?.robotVisualRole === "arm-link") linkCount += 1;
    if (object.userData?.robotVisualRole === "shared-gripper") {
      gripperCount += 1;
      gripperParent = object.parent?.name || null;
      let parent = object.parent;
      while (parent) {
        if (parent.name?.endsWith("joint-rotator-6")) {
          gripperJoint = 6;
          break;
        }
        parent = parent.parent;
      }
    }
  });
  return Object.freeze({
    profile: state.robotProfileId,
    loading: state.robotLoading,
    generation: robotLoadGeneration,
    armGroups: armGroups.length,
    linkCount,
    gripperCount,
    gripperParent,
    gripperJoint,
  });
}
window.getRobotVisualDiagnostics = getRobotVisualDiagnostics;

async function switchRobotProfile(profileId, { initial = false } = {}) {
  const profile = getRobotProfile(profileId);
  if (
    !initial &&
    (state.running || state.programRun || state.live || gripperVisual.animation)
  ) {
    syncRobotProfileUi();
    log("Robot model changes are unavailable while the simulator is running");
    return false;
  }
  const generation = ++robotLoadGeneration;
  const previous = activeRobotGroup;
  state.robotLoading = true;
  state.modelReady = false;
  renderState();
  if ($("loadingCard")) {
    $("loadingCard").classList.remove("hidden");
    $("loadingCard").innerHTML =
      `<span class="loader"></span><span>Loading ${profile.label} model…</span>`;
  }
  setStatus(`Loading ${profile.label} model…`);
  let candidate = null;
  try {
    candidate = await buildRobotArm(profile);
    if (generation !== robotLoadGeneration) {
      disposeRobotArm(candidate);
      candidate = null;
      return false;
    }
    const gripper = await loadSharedGripper();
    if (generation !== robotLoadGeneration) {
      disposeRobotArm(candidate);
      candidate = null;
      return false;
    }
    if (gripper.parent) gripper.parent.remove(gripper);
    if (previous) robotRoot.remove(previous);
    robotRoot.add(candidate.group);
    // Mount the complete tool below J6. The mount owns the CAD correction;
    // the gripper geometry itself stays identity-local, so every J6 rotation
    // is inherited without a second competing transform.
    const j6ToolMount = new THREE.Group();
    j6ToolMount.name = `${profile.id}-j6-tool-mount`;
    j6ToolMount.userData.robotVisualRole = "j6-tool-mount";
    j6ToolMount.position.fromArray(gripperMountOffset(profile.id));
    const mountRotation =
      GRIPPER_MOUNT_ROTATION_BY_PROFILE[profile.id] ||
      GRIPPER_MOUNT_ROTATION_BY_PROFILE.fr3;
    j6ToolMount.rotation.set(...mountRotation);
    j6ToolMount.scale.setScalar(GRIPPER_SCALE);
    j6ToolMount.add(gripper);
    candidate.jointRotators.at(-1).add(j6ToolMount);
    if (previous) disposeRobotArm({ group: previous });
    activeRobotGroup = candidate.group;
    jointRotators = candidate.jointRotators;
    modelMaterials = candidate.modelMaterials;
    jointMaterials = candidate.jointMaterials;
    state.robotProfileId = profile.id;
    state.safeZone.bounds = safeZoneBoundsForProfile(profile.id);
    state.safeZone.alert = null;
    state.modelReady = true;
    state.robotLoading = false;
    localStorage.setItem(ROBOT_PROFILE_STORAGE_KEY, profile.id);
    await loadCalibratedPoints(profile.id);
    syncRobotProfileUi(profile);
    setJointVisualization($("controlTab")?.classList.contains("active"));
    $("loadingCard")?.classList.add("hidden");
    setStatus(readyStatus(profile), "ready");
    updateVisuals();
    renderState();
    return true;
  } catch (error) {
    if (candidate) disposeRobotArm(candidate);
    if (generation !== robotLoadGeneration) return false;
    state.robotLoading = false;
    state.modelReady = Boolean(previous);
    syncRobotProfileUi();
    if ($("loadingCard"))
      $("loadingCard").innerHTML =
        "<span>Unable to load the selected model. Check the local web server.</span>";
    setStatus("MODEL LOAD ERROR", "error");
    log(`Model load error: ${error.message}`);
    renderState();
    return false;
  }
}

function resetPoseToCalibratedHome() {
  const home = homePointRecord().point;
  const joints = home?.joints;
  const validHome =
    Array.isArray(joints) &&
    joints.length === 6 &&
    joints.every((value) => Number.isFinite(Number(value)));
  const homeJoints = validHome
    ? joints.map(Number)
    : [...DEFAULT_HOME_JOINTS];
  state.jointsDeg = [...homeJoints];
  state.targetDeg = [...homeJoints];
  state.activeMotion = null;
  state.liveFromDeg = null;
  state.liveTargetDeg = null;
  state.liveAnimationStart = 0;
  state.lastTargetPose = currentPose();
  updateVisuals();
  renderJointControls();
  renderTcp();
  renderTargetInputs();
  renderState();
}

async function loadModel() {
  initScene();
  state.robotLoading = true;
  renderState();
  // Always use FR5 for a new page load.  A previous profile selection must
  // not leave the workshop opening in a different model on the next visit.
  let loaded = await switchRobotProfile("fr5", { initial: true });
  if (!loaded) {
    loaded = await switchRobotProfile("fr3", { initial: true });
    if (loaded) {
      localStorage.setItem(ROBOT_PROFILE_STORAGE_KEY, "fr3");
      setStatus("FR5 model unavailable · FR3 remains active", "error");
    }
  }
  if (!loaded) return;
  resetPoseToCalibratedHome();
  // Match the FR3 HOME view: front/teaching camera, default target and the
  // same mirrored canvas treatment used by the existing FR3 presentation.
  homeView();
  syncRobotProfileUi();
}

function setHomeCameraView(index) {
  if (!camera || !controls) return;
  cameraViewIndex =
    ((index % HOME_CAMERA_VIEWS.length) + HOME_CAMERA_VIEWS.length) %
    HOME_CAMERA_VIEWS.length;
  const view = HOME_CAMERA_VIEWS[cameraViewIndex];
  const frameScale = 100 / state.cameraZoom;
  camera.position
    .set(...HOME_CAMERA_TARGET)
    .lerp(new THREE.Vector3(...view.position), frameScale);
  controls.target.set(...HOME_CAMERA_TARGET);
  controls.update();
  const mirroredTeachingView = cameraViewIndex === 0;
  if (renderer?.domElement) {
    renderer.domElement.style.transform = mirroredTeachingView
      ? "scaleX(-1)"
      : "";
  }
  controls.rotateSpeed = mirroredTeachingView ? -1 : 1;
  syncBoardLabelMirroring();
  const button = $("changeViewBtn");
  if (button) {
    button.title = `View ${view.name} (${cameraViewIndex + 1}/4)`;
    button.setAttribute(
      "aria-label",
      `Change view. Current view: ${view.name}, ${cameraViewIndex + 1} of 4`,
    );
  }
}

function setCameraZoom(value) {
  state.cameraZoom = clamp(
    Number(value) || HOME_CAMERA_ZOOM_DEFAULT,
    ...HOME_CAMERA_ZOOM_RANGE,
  );
  localStorage.setItem("fr3-home-camera-zoom", String(state.cameraZoom));
  if ($("cameraZoomRange"))
    $("cameraZoomRange").value = String(state.cameraZoom);
  if ($("cameraZoomOutput"))
    $("cameraZoomOutput").textContent = `${state.cameraZoom}%`;
  if ($("cameraZoomBtn"))
    $("cameraZoomBtn").textContent = `View ${state.cameraZoom}%`;
  setHomeCameraView(cameraViewIndex < 0 ? 0 : cameraViewIndex);
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
  return pointRecord(name === "HOMECHESS" ? "HOME" : name);
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
  carriedToken: false,
  async move_to(position) {
    if (state.robotLoading || !state.modelReady)
      throw new TechCampError(
        "Simulator is still loading its calibrated points.",
      );
    startTechCamp();
    const raw = String(position).toUpperCase();
    const pos = raw === "HOMECHESS" ? "HOME" : raw;
    if (!["P1", "P2", "P3", "P4", "P5", "P6", "P7", "HOME"].includes(pos))
      throw new TechCampError(
        `Invalid position '${position}'. Valid: P1…P7, HOME`,
      );
    if (this.low) await this.move_up();
    if (this.position === pos) return true;
    const point = calibratedPointFor(pos === "HOME" ? "HOME" : `${pos}UP`);
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
    if (!this.position || this.position === "HOME")
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
    if (!this.position || this.position === "HOME") {
      await this.move_to("HOME");
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
    await setGripperClosed(true);
    const block = this.low && this.position ? blockAt(this.position) : null;
    if (block) {
      block.carried = true;
      this.carriedBlock = block.name;
      log(`grip() -> ${block.name} attached`);
    } else if (
      this.low &&
      state.checkpointToken.position === this.position &&
      !checkpointTokenCarried()
    ) {
      state.checkpointToken = { ...state.checkpointToken, carried: true };
      this.carriedToken = true;
      log(`grip() -> ${CHECKPOINT_TOKEN_ID} attached`);
    } else log("grip() -> gripper closed");
    renderBlockBoard();
    return true;
  },
  async release() {
    startTechCamp();
    if (!this.gripping) return true;
    await setGripperClosed(false);
    if (this.carriedToken) {
      const from = state.checkpointToken.position;
      const accepted = applyCheckpointTokenPlacement(from, this.position, true);
      if (accepted) this.carriedToken = false;
      else state.checkpointToken = { ...state.checkpointToken, carried: false };
      this.gripping = false;
      this.carriedToken = false;
      log(
        accepted
          ? `release() -> orange marker placed at ${this.position}`
          : `release() -> orange marker kept at ${from}`,
      );
      renderBlockBoard();
      updateBlockVisuals();
      return true;
    }
    const block = this.carriedBlock
      ? state.blocks.find((item) => item.name === this.carriedBlock)
      : null;
    if (block) {
      const target = this.position;
      const occupied = state.blocks.some(
        (item) => item !== block && !item.carried && item.position === target,
      );
      const tokenCollision =
        target === state.checkpointToken?.position && !checkpointTokenCarried();
      block.carried = false;
      if (occupied || tokenCollision || !target) {
        log(
          `release() -> ${block.name} kept at ${block.position}; target ${target || "current position"} is occupied`,
        );
      } else {
        block.position = target;
        log(`release() -> ${block.name} placed at ${target}`);
      }
    } else log("release() -> gripper released");
    this.gripping = false;
    this.carriedBlock = null;
    renderBlockBoard();
    updateBlockVisuals();
    return true;
  },
  async get_image() {
    startTechCamp();
    log("get_image() -> simulated top-down board");
    return { type: "simulated_board", positions: this.get_positions() };
  },
  async get_positions() {
    return getApiPositions(state.blocks);
  },
  async close() {
    this.gripping = false;
    this.carriedBlock = null;
    this.carriedToken = false;
    log("TechCamp.close() -> 0");
    return true;
  },
  reset() {
    this.position = null;
    this.low = false;
    this.gripping = false;
    this.carriedBlock = null;
    this.carriedToken = false;
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
  "HOME",
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
        return `Character '${char}' has no matching opening quote.`;
      stack.pop();
    }
  }
  if (quote) return "Unterminated string literal.";
  if (stack.length) return `Missing closing delimiter for '${stack.at(-1)}'.`;
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
    ? `${errors.length} error(s) to fix`
    : "Code is valid";
  list.replaceChildren();
  list.hidden = errors.length === 0;
  for (const error of errors) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "code-error-item";
    item.textContent = `Line ${error.line}: ${error.message}`;
    item.addEventListener("click", () => focusProgramLine(error.line));
    list.append(item);
  }
}

function focusProgramLine(lineNumber) {
  const editor = $("program");
  if (!editor) return;
  const lines = editor.value.split("\n");
  const start =
    lines.slice(0, Math.max(0, lineNumber - 1)).join("\n").length +
    (lineNumber > 1 ? 1 : 0);
  const end = start + (lines[lineNumber - 1] || "").length;
  editor.focus();
  editor.setSelectionRange(start, end);
  const lineHeight =
    Number.parseFloat(getComputedStyle(editor).lineHeight) || 20;
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
  const entrypointErrors = validateMainEntrypointSource(source).errors;

  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (/\t/.test(raw))
      addError(lineNumber, "Use spaces for indentation; tabs are not allowed.");
    const uncommented = stripPythonComment(raw);
    const trimmed = uncommented.trim();
    if (!trimmed) continue;
    const codeOnly = withoutPythonStrings(trimmed);
    const syntaxIssue = findPythonSyntaxIssue(uncommented);
    if (syntaxIssue) addError(lineNumber, syntaxIssue);
    if (codeOnly.includes(";"))
      addError(
        lineNumber,
        "Use one statement per line; semicolons are not allowed.",
      );
    if (/\/\//.test(codeOnly))
      addError(lineNumber, "Python comments use #, not //.");

    if (/^def\s+[A-Za-z_]\w*\s*\(\s*\)\s*:$/.test(trimmed)) {
      previousOpenedBlock = true;
      continue;
    }
    if (/^if\s+__name__\s*==\s*["']__main__["']\s*:$/.test(trimmed)) {
      previousOpenedBlock = true;
      continue;
    }
    if (/^[A-Za-z_]\w*\s*\(\s*\)$/.test(trimmed)) {
      previousOpenedBlock = false;
      continue;
    }
    if (/^[A-Z_][A-Z0-9_]*\s*=\s*\[.*\]$/.test(trimmed)) {
      previousOpenedBlock = false;
      continue;
    }
    if (/^for\s+\w+\s+in\s+[A-Z_][A-Z0-9_]*\s*:$/.test(trimmed)) {
      previousOpenedBlock = true;
      continue;
    }

    const indent = uncommented.match(/^ */)[0].length;
    while (indent < indentation.at(-1)) indentation.pop();
    if (indent !== indentation.at(-1)) {
      if (indent > indentation.at(-1) && previousOpenedBlock)
        indentation.push(indent);
      else
        addError(
          lineNumber,
          "Invalid indentation: indent only after a line ending with :.",
        );
    }

    const unsupportedKeyword = codeOnly.match(
      /\b(await|async|class|lambda|eval|exec|open|__import__|while|try|except|raise|input)\b/,
    );
    if (unsupportedKeyword) {
      addError(
        lineNumber,
        `'${unsupportedKeyword[1]}' is not available in this lesson. Use the TechCamp API only.`,
      );
      previousOpenedBlock = trimmed.endsWith(":");
      continue;
    }

    if (/^from\b/.test(trimmed) || /^import\b/.test(trimmed)) {
      if (
        /^from\s+techcamp_api\s+import\s+TechCamp(?:\s*,\s*TechCampError)?$/.test(
          trimmed,
        )
      ) {
        importedTechCamp = true;
      } else {
        addError(
          lineNumber,
          "Only import TechCamp: from techcamp_api import TechCamp",
        );
      }
      previousOpenedBlock = false;
      continue;
    }

    if (/^with\b/.test(trimmed)) {
      if (/^with\s+TechCamp\(\)\s+as\s+bot:$/.test(trimmed)) {
        if (!importedTechCamp)
          addError(
            lineNumber,
            "Add the TechCamp import at the top of the program.",
          );
        botCreated = true;
        knownPosition = false;
      } else {
        addError(lineNumber, "Use this exact form: with TechCamp() as bot:");
      }
      previousOpenedBlock = true;
      continue;
    }

    if (/^if\b/.test(trimmed)) {
      const condition = trimmed.match(
        /^if\s+(\w+)\.get\(\s*["'](P[1-7])["']\s*\):$/,
      );
      if (!condition)
        addError(lineNumber, 'Supported condition: if blocks.get("P3"):');
      else if (!variables.has(condition[1]))
        addError(
          lineNumber,
          `'${condition[1]}' has no data. Call blocks = bot.get_positions() first.`,
        );
      previousOpenedBlock = true;
      continue;
    }

    if (/^bot\s*=/.test(trimmed)) {
      if (!/^bot\s*=\s*TechCamp\(\)$/.test(trimmed))
        addError(lineNumber, "Use this exact initialization: bot = TechCamp()");
      else {
        if (!importedTechCamp)
          addError(
            lineNumber,
            "Add the TechCamp import at the top of the program.",
          );
        botCreated = true;
        knownPosition = false;
      }
      previousOpenedBlock = false;
      continue;
    }

    const readAssignment = trimmed.match(
      /^(\w+)\s*=\s*bot\.(get_positions|get_image)\(\s*\)$/,
    );
    if (readAssignment) {
      if (!botCreated)
        addError(lineNumber, "Create bot = TechCamp() before calling methods.");
      variables.add(readAssignment[1]);
      previousOpenedBlock = false;
      continue;
    }
    if (/^\w+\s*=\s*bot\./.test(trimmed)) {
      addError(
        lineNumber,
        "Only assign results from bot.get_positions() or bot.get_image().",
      );
      previousOpenedBlock = false;
      continue;
    }

    const botCall = trimmed.match(/^bot\.(\w+)\((.*)\)$/);
    if (botCall) {
      const [, method, argument] = botCall;
      if (!botCreated)
        addError(lineNumber, "Create bot = TechCamp() before calling methods.");
      if (method === "move_to") {
        const point = quotedArgument(argument);
        if (!point)
          addError(
            lineNumber,
            'move_to() needs a quoted point, for example move_to("P3").',
          );
        else if (!TECHCAMP_STUDENT_POINTS.has(point.toUpperCase()))
          addError(
            lineNumber,
            `Point '${point}' is invalid. Use P1 to P7 or HOME.`,
          );
        else {
          knownPosition = !["HOME", "HOMECHESS"].includes(point.toUpperCase());
          hasRobotCommand = true;
        }
      } else if (TECHCAMP_EMPTY_METHODS.has(method)) {
        if (argument.trim())
          addError(lineNumber, `${method}() does not accept arguments.`);
        if (method === "move_down" && !knownPosition)
          addError(
            lineNumber,
            'move_down() requires move_to("P1" through "P7") first.',
          );
        hasRobotCommand = true;
      } else if (TECHCAMP_READ_METHODS.has(method)) {
        addError(lineNumber, `Store the result: data = bot.${method}().`);
      } else {
        addError(
          lineNumber,
          `bot.${method}() is not part of the TechCamp lesson API.`,
        );
      }
      previousOpenedBlock = false;
      continue;
    }

    if (/^bot\./.test(trimmed)) {
      addError(
        lineNumber,
        "Invalid method call syntax; include parentheses ().",
      );
      previousOpenedBlock = false;
      continue;
    }

    if (/^print\(.*\)$/.test(trimmed)) {
      previousOpenedBlock = false;
      continue;
    }

    if (/^TechCamp\(/.test(trimmed))
      addError(lineNumber, "Assign the robot object: bot = TechCamp().");
    else
      addError(
        lineNumber,
        "Command not recognized. Use the TechCamp lesson methods only.",
      );
    previousOpenedBlock = trimmed.endsWith(":");
  }

  if (!importedTechCamp && source.trim())
    addError(1, "Missing: from techcamp_api import TechCamp");
  if (!botCreated && source.trim()) addError(1, "Missing: bot = TechCamp()");
  if (!hasRobotCommand && botCreated)
    addError(
      1,
      "Add a robot command (move_to, move_down, move_up, grip, or release).",
    );
  entrypointErrors.forEach((error) => addError(error.line, error.message));
  return { errors: errors.sort((a, b) => a.line - b.line) };
}

async function runTechCampLine(trimmed, indent, context) {
  if (
    /^from\s+techcamp_api\s+import\s+TechCamp(?:\s*,\s*TechCampError)?$/.test(
      trimmed,
    )
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
  const positionMatch = trimmed.match(/^bot\.move_to\(\s*(.+?)\s*\)$/);
  if (positionMatch) {
    const position = quotedArgument(positionMatch[1]);
    if (!position)
      throw new TechCampError('move_to() needs a point such as "P3"');
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

function validateMainEntrypointSource(source) {
  const lines = String(source || "").split(/\r?\n/);
  const errors = [];
  const functionLines = lines
    .map((line, index) => ({
      index,
      name: line.match(/^\s*def\s+([A-Za-z_]\w*)\s*\(\s*\)\s*:\s*$/)?.[1],
    }))
    .filter((entry) => entry.name);
  if (!functionLines.length) {
    errors.push({
      line: 1,
      message: 'Define a main function before running the program.',
    });
  }
  const guardLine = lines.findIndex((line) =>
    /^\s*if\s+__name__\s*==\s*["']__main__["']\s*:\s*$/.test(line),
  );
  if (guardLine < 0) {
    errors.push({
      line: functionLines[0]?.index + 1 || 1,
      message: 'Call the main function from if __name__ == "__main__":.',
    });
  } else {
    const call = lines
      .slice(guardLine + 1)
      .map((line, offset) => ({
        line: guardLine + offset + 2,
        name: line.match(/^\s+([A-Za-z_]\w*)\s*\(\s*\)\s*$/)?.[1],
      }))
      .find((entry) => entry.name);
    if (!call || !functionLines.some((entry) => entry.name === call.name)) {
      errors.push({
        line: guardLine + 1,
        message: 'The __main__ block must call the function defined above.',
      });
    }
  }
  return { errors };
}

function showPythonError(error) {
  const line = Number(error?.line) || 1;
  const column = Number(error?.column);
  const location = column
    ? "Line " + line + ", column " + column
    : "Line " + line;
  const message = error?.message || "Python error.";
  renderCodeValidation({
    errors: [
      { line, message: (column ? "Column " + column + ": " : "") + message },
    ],
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
    showPythonError(
      payload?.error || {
        message: "No result from the Python runner. Restart serve.mjs.",
      },
    );
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
  if (state.robotLoading || !state.modelReady) {
    log("Run program -> simulator is still loading; please wait");
    return;
  }
  clearCodeValidation();
  const entrypointValidation = validateMainEntrypointSource(
    $("program")?.value || "",
  );
  if (entrypointValidation.errors.length) {
    renderCodeValidation(entrypointValidation);
    const first = entrypointValidation.errors[0];
    focusProgramLine(first.line);
    log(`Program blocked · ${first.message}`);
    return;
  }
  const token = { cancelled: false, controller: new AbortController() };
  state.programRun = token;
  renderState();
  try {
    await runPythonProgram(token);
  } catch (error) {
    if (!token.cancelled)
      showPythonError({
        message:
          error?.message ||
          "Could not connect to the Python runner. Restart serve.mjs.",
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
  initTeacherPortalShortcut();
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
  initStudentSubmissionUi({
    openButton: $("uploadProgramBtn"),
    dialog: $("uploadDialog"),
    form: $("uploadForm"),
    groupInput: $("groupNameInput"),
    filenamePreview: $("uploadFilenamePreview"),
    statusNode: $("uploadStatus"),
    submitButton: $("uploadSubmitBtn"),
    getSource: () => $("program")?.value ?? "",
    ensureUser: ensureAnonymousUser,
    upload: uploadSubmission,
    available: firebaseAvailable(),
    log,
  });
  setSceneObjectsVisible(state.sceneObjectsVisible);
  $("toggleSceneObjectsBtn")?.addEventListener("click", () => {
    setSceneObjectsVisible(!state.sceneObjectsVisible);
  });
  $("robotProfileSelect")?.addEventListener("change", async (event) => {
    const requested = getRobotProfile(event.target.value).id;
    if (
      state.running ||
      state.programRun ||
      state.live ||
      gripperVisual.animation
    ) {
      syncRobotProfileUi();
      return;
    }
    await switchRobotProfile(requested);
  });
  $("enableBtn").addEventListener("click", () => {
    state.enabled = !state.enabled;
    renderState();
    setStatus(
      state.enabled ? "SIMULATOR ENABLED · API RPC" : readyStatus(),
      state.enabled ? "ready" : "",
    );
    log(state.enabled ? "Enable() -> 0" : "Disable() -> 0");
  });
  $("homeBtn").addEventListener("click", async () => {
    const selection = homePointRecord();
    if (!selection.point) {
      log("Home -> -2 (HOME point is missing from points.json)");
      return;
    }
    const result = await api.MoveJ(selection.point.joints);
    if (result === 0) resetBlocks(true);
    log(`Home -> ${result} · ${selection.name}`);
  });
  $("stopBtn").addEventListener("click", () => api.StopMotion());
  $("modeBtn").addEventListener("click", () =>
    api.Mode(state.automatic ? 0 : 1),
  );
  $("changeViewBtn").addEventListener("click", changeView);
  $("homeViewBtn").addEventListener("click", homeView);
  const cameraZoomButton = $("cameraZoomBtn");
  const cameraZoomPopover = $("cameraZoomPopover");
  const cameraZoomRange = $("cameraZoomRange");
  const setCameraZoomPopover = (open) => {
    if (!cameraZoomButton || !cameraZoomPopover) return;
    cameraZoomPopover.hidden = !open;
    cameraZoomButton.setAttribute("aria-expanded", String(open));
  };
  const savedCameraZoom = Number(localStorage.getItem("fr3-home-camera-zoom"));
  setCameraZoom(
    Number.isFinite(savedCameraZoom)
      ? savedCameraZoom
      : HOME_CAMERA_ZOOM_DEFAULT,
  );
  cameraZoomButton?.addEventListener("click", () =>
    setCameraZoomPopover(cameraZoomPopover?.hidden),
  );
  cameraZoomRange?.addEventListener("input", () =>
    setCameraZoom(cameraZoomRange.value),
  );
  document.addEventListener("pointerdown", (event) => {
    if (
      cameraZoomPopover &&
      !cameraZoomPopover.hidden &&
      !event.target.closest(".camera-control")
    )
      setCameraZoomPopover(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setCameraZoomPopover(false);
    }
  });
  $("applyBtn").addEventListener("click", () => api.MoveJ(state.targetDeg));
  $("moveLBtn").addEventListener("click", () =>
    api.MoveL(state.lastTargetPose),
  );
  $("runBtn").addEventListener("click", runProgram);
  $("liveBtn")?.addEventListener("click", connectLive);
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
