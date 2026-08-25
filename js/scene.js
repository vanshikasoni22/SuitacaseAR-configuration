/**
 * scene.js
 * -----------------------------------------------------------------------
 * Three.js scene: renderer, camera, ambient + directional lighting, and
 * OrbitControls, mounted into the existing #viewerStage element. Also
 * owns the viewer's zoom-in/zoom-out/reset buttons and the drag-to-rotate
 * behavior — those are camera concerns, so they live here rather than in
 * ui.js (which stays WebGL-free, per its own header comment).
 *
 * Public API is intentionally small so main.js stays a thin wiring layer
 * and no Three.js logic leaks into it:
 *
 *   initScene(container)  — one-time setup, starts the render loop
 *   setModel(object3D)    — swap in whatever modelLoader.js resolved
 *   zoomIn() / zoomOut() / resetView() — also self-wired to the shell's
 *                                        existing buttons, exported too
 *                                        in case they're useful elsewhere
 *   applyColorTarget(target, hex) — recolor a semantic part of the
 *                                   current model (see modelLoader.js)
 *
 * Color reactivity: this file subscribes to state.js itself (the same
 * way it self-binds to the zoom buttons) and recolors the model whenever
 * `state.color` / `state.components.trim.color` / `state.components.
 * wheels.color` change — ui.js never touches the 3D scene directly, it
 * only ever calls updateState().
 *
 * Not implemented yet: ar.js.
 * ----------------------------------------------------------------------- */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state, subscribe, COLORS, WHEEL_COLORS, TRIM_COLORS } from './state.js';

const COLOR_HEX = Object.fromEntries(COLORS.map((c) => [c.id, c.hex]));
const WHEEL_COLOR_HEX = Object.fromEntries(WHEEL_COLORS.map((c) => [c.id, c.hex]));

let scene = null;
let camera = null;
let renderer = null;
let controls = null;
let container = null;
let currentModel = null;
let resizeObserver = null;

const homeCameraPosition = new THREE.Vector3();
const homeTarget = new THREE.Vector3();

// Fallback distance clamp before a model has been framed; frameCameraOnObject()
// tightens these to the actual model size once setModel() runs.
const DEFAULT_MIN_DISTANCE = 1;
const DEFAULT_MAX_DISTANCE = 10;
const ZOOM_STEP = 0.85; // per-click distance multiplier (in for <1, out for 1/this)

/**
 * Set up the renderer/camera/scene/lights/controls inside `stageEl` and
 * start rendering. Safe to call once at startup.
 * @param {HTMLElement} stageEl the existing #viewerStage element
 */
export function initScene(stageEl) {
  container = stageEl;

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (err) {
    // No WebGL (old browser, disabled GPU, etc.) — leave the static
    // "3D viewer mounts here" placeholder visible instead of a blank box.
    console.warn('[scene] WebGL unavailable, keeping static placeholder.', err);
    renderer = null;
    return;
  }

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, aspectOf(container), 0.1, 100);
  camera.position.set(1.6, 1.2, 2.6);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.classList.add('viewer__canvas');
  container.appendChild(renderer.domElement);

  const staticPlaceholder = container.querySelector('.viewer__placeholder');
  if (staticPlaceholder) staticPlaceholder.style.display = 'none';

  // Basic two-light setup: ambient for overall fill so nothing goes fully
  // black, directional as the key light so the placeholder reads as a
  // solid 3D form rather than a flat silhouette.
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(3, 4, 2);
  scene.add(keyLight);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false; // keep the trolley centered — rotate + zoom only
  controls.minDistance = DEFAULT_MIN_DISTANCE;
  controls.maxDistance = DEFAULT_MAX_DISTANCE;
  controls.update();

  homeCameraPosition.copy(camera.position);
  homeTarget.copy(controls.target);

  bindViewerButtons();
  observeResize();
  startRenderLoop();
  subscribe(syncModelColors);
}

/**
 * Swap whatever's currently shown for a new Object3D and frame the camera
 * on it. Works for the placeholder box today and for a real GLB later —
 * it only depends on the object's bounding box.
 * @param {THREE.Object3D} object3D
 */
export function setModel(object3D) {
  if (!scene) return; // initScene() bailed (no WebGL) — nothing to mount into
  if (currentModel) scene.remove(currentModel);
  currentModel = object3D;
  scene.add(currentModel);
  frameCameraOnObject(currentModel);
  syncModelColors(); // apply whatever state.js already holds, immediately — no flash of GLB-default colors
}

/**
 * Recolor a semantic part of the current model — `target` matches a key
 * in modelLoader.js's COLOR_TARGET_MATERIALS (e.g. 'body', 'trim'). A
 * direct material.color mutation on the already-rendering mesh: no scene
 * rebuild, no reload, so it's instant and flicker-free. Silently a no-op
 * if this model doesn't have that part (see modelLoader.js's header for
 * which parts the current GLB actually has).
 * @param {string} target
 * @param {string} [hex]
 */
export function applyColorTarget(target, hex) {
  const meshes = currentModel?.userData?.colorTargets?.[target];
  if (!meshes || !hex) return;
  meshes.forEach((mesh) => mesh.material.color.set(hex));
}

function syncModelColors() {
  applyColorTarget('body', COLOR_HEX[state.color]);
  applyColorTarget('trim', TRIM_COLORS[state.components.trim.color]);
  applyColorTarget('wheels', WHEEL_COLOR_HEX[state.components.wheels.color]);
}

/** Move the camera closer to its target, clamped to controls.minDistance. */
export function zoomIn() {
  dolly(ZOOM_STEP);
}

/** Move the camera farther from its target, clamped to controls.maxDistance. */
export function zoomOut() {
  dolly(1 / ZOOM_STEP);
}

/** Restore the camera to the position/target established when the model was last framed. */
export function resetView() {
  if (!camera || !controls) return;
  camera.position.copy(homeCameraPosition);
  controls.target.copy(homeTarget);
  controls.update();
}

/* ============================ internals ============================ */

function aspectOf(el) {
  return (el.clientWidth || 1) / (el.clientHeight || 1);
}

function startRenderLoop() {
  const tick = () => {
    controls.update(); // no-op unless damping/autorotate is on, cheap either way
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();
}

function frameCameraOnObject(object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fitDistance =
    (maxDim / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.6; // 1.6 = a little breathing room

  // Re-use the current camera-to-target direction so re-framing (e.g. a
  // real GLB with different proportions) doesn't snap the view around.
  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() === 0) direction.set(0.5, 0.35, 1);
  direction.normalize();

  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, fitDistance);
  camera.near = Math.max(fitDistance / 100, 0.01);
  camera.far = fitDistance * 100;
  camera.updateProjectionMatrix();

  controls.minDistance = fitDistance * 0.4;
  controls.maxDistance = fitDistance * 3;
  controls.update();

  homeCameraPosition.copy(camera.position);
  homeTarget.copy(controls.target);
}

function dolly(factor) {
  if (!camera || !controls) return;
  const offset = camera.position.clone().sub(controls.target);
  const nextDistance = THREE.MathUtils.clamp(
    offset.length() * factor,
    controls.minDistance,
    controls.maxDistance
  );
  offset.setLength(nextDistance);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

function bindViewerButtons() {
  document.getElementById('zoomInBtn')?.addEventListener('click', zoomIn);
  document.getElementById('zoomOutBtn')?.addEventListener('click', zoomOut);
  document.getElementById('resetViewBtn')?.addEventListener('click', resetView);
}

function observeResize() {
  const handleResize = () => {
    if (!container || !renderer || !camera) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return; // hidden (e.g. display:none mid-transition)
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  // ResizeObserver catches layout-driven size changes (sidebar collapsing,
  // breakpoint changes) that don't necessarily fire a window 'resize'.
  resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container);
  window.addEventListener('resize', handleResize);
}
