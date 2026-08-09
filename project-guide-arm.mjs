import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

const mount = document.querySelector("#armHeroViewport");
if (!mount) throw new Error("FR5 hero viewport is missing");

const LINK_FILES = ["base_link", "shoulder_link", "upperarm_link", "forearm_link", "wrist1_link", "wrist2_link", "wrist3_link"];
const ORIGINS = [[0, 0, 0], [0, 0, 0.152], [-0.425, 0, 0], [-0.39501, 0, 0], [0, 0, 0.1021], [0, 0, 0.102]];
const RPY = [[0, 0, 0], [Math.PI / 2, 0, 0], [0, 0, 0], [0, 0, 0], [Math.PI / 2, 0, 0], [-Math.PI / 2, 0, 0]];
const HOME = [-10.172, -90.007, 135.003, -45.075, 89.997, 134.998];
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d2431);
const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 20);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x0d2431, 1);
mount.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.enableZoom = false;
controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
controls.autoRotateSpeed = 0.72;

scene.add(new THREE.HemisphereLight(0xdcecff, 0x07131e, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 3.2);
key.position.set(1.5, 2.5, 1.4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x68c7bb, 1.2);
rim.position.set(-1.5, 1.1, -1.8);
scene.add(rim);

const robotRoot = new THREE.Group();
robotRoot.rotation.x = -Math.PI / 2;
scene.add(robotRoot);

function resize() {
  const width = Math.max(1, mount.clientWidth);
  const height = Math.max(1, mount.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function mountQuaternion() {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
  q.multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, (3 * Math.PI) / 4));
  return q;
}

function mountOffset() {
  const target = new THREE.Vector3(0, 0, 0.1);
  const flange = new THREE.Vector3(37.555, 17.5, 75).multiplyScalar(0.0008).applyQuaternion(mountQuaternion());
  return target.sub(flange);
}

async function loadArm() {
  const loader = new STLLoader();
  const arm = new THREE.Group();
  arm.name = "fr5-hero-arm";
  const material = new THREE.MeshStandardMaterial({ color: 0xbfc9d4, roughness: 0.62, metalness: 0.12 });
  const rotators = [];
  const load = (file) => new Promise((resolve, reject) => loader.load(`./assets/fr5_v6/${file}.STL`, resolve, undefined, reject));
  const base = new THREE.Mesh(await load(LINK_FILES[0]), material);
  arm.add(base);
  let parent = arm;
  for (let i = 0; i < 6; i += 1) {
    const frame = new THREE.Group();
    frame.position.fromArray(ORIGINS[i]);
    frame.rotation.set(...RPY[i]);
    parent.add(frame);
    const rotator = new THREE.Group();
    frame.add(rotator);
    rotator.rotation.z = THREE.MathUtils.degToRad(HOME[i]);
    rotators.push(rotator);
    const link = new THREE.Mesh(await load(LINK_FILES[i + 1]), material);
    rotator.add(link);
    parent = rotator;
  }
  if (typeof window.occtimportjs === "function") {
    try {
      const response = await fetch("./assets/fr3_v6/Assieme_pinza_dita_parallele.stp");
      const occt = await window.occtimportjs();
      const result = occt.ReadStepFile(new Uint8Array(await response.arrayBuffer()), { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.5 });
      const gripper = new THREE.Group();
      for (const stepMesh of result.meshes || []) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(stepMesh.attributes.position.array, 3));
        if (stepMesh.attributes.normal?.array) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(stepMesh.attributes.normal.array, 3));
        geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(stepMesh.index.array), 1));
        geometry.computeVertexNormals();
        gripper.add(new THREE.Mesh(geometry, material));
      }
      const mountGroup = new THREE.Group();
      mountGroup.position.copy(mountOffset());
      mountGroup.quaternion.copy(mountQuaternion());
      mountGroup.scale.setScalar(0.0008);
      mountGroup.add(gripper);
      rotators.at(-1).add(mountGroup);
    } catch {
      // The arm remains useful if the optional STEP gripper cannot load.
    }
  }
  return arm;
}

function frameArm(arm) {
  arm.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(arm);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() * 0.58, 0.8);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(radius * 0.95, radius * 0.55, radius * 1.12));
  camera.lookAt(center);
  controls.update();
}

async function start() {
  resize();
  try {
    const arm = await loadArm();
    robotRoot.add(arm);
    frameArm(arm);
    mount.dataset.ready = "true";
  } catch {
    mount.dataset.error = "true";
  }
}

window.addEventListener("resize", resize);
function render() {
  requestAnimationFrame(render);
  controls.update();
  renderer.render(scene, camera);
}
render();
void start();
