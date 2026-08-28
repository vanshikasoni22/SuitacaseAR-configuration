/**
 * scene.js
 * -----------------------------------------------------------------------
 * Three.js scene: renderer, camera, studio 3-point lighting (key/fill/
 * rim + ambient), and OrbitControls, mounted into the existing
 * #viewerStage element. Also
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
 *   setView(viewId)        — smoothly animate the camera to a preset
 *                             angle ('front'/'side'/'back'/'detail'),
 *                             self-wired to the thumbnail strip the same
 *                             way zoom/reset are wired to their buttons
 *
 * Color reactivity: this file subscribes to state.js itself (the same
 * way it self-binds to the zoom buttons) and recolors the model whenever
 * `state.color` / `state.components.trim.color` / `state.components.
 * wheels.color` change — ui.js never touches the 3D scene directly, it
 * only ever calls updateState(). The active-thumbnail view preset works
 * the same way (see syncActiveView()).
 *
 * Not implemented yet: ar.js.
 * ----------------------------------------------------------------------- */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state, subscribe, COLORS, WHEEL_COLORS, TRIM_COLORS } from './state.js';

const COLOR_HEX = Object.fromEntries(COLORS.map((c) => [c.id, c.hex]));
const WHEEL_COLOR_HEX = Object.fromEntries(WHEEL_COLORS.map((c) => [c.id, c.hex]));
const TRIM_COLOR_HEX = Object.fromEntries(TRIM_COLORS.map((c) => [c.id, c.hex]));

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

  // Studio-style 3-point lighting so a dark/matte GLB material (e.g. the
  // default matte-black finish) still reads as a solid shaded form instead
  // of a flat silhouette:
  //   - key: the main light, angled above-front, does most of the modeling
  //   - fill: softer, opposite side, lifts the shadow side without
  //           flattening the key light's contrast
  //   - rim: from behind, separates the model's edge from the background
  // Ambient is a little brighter than a single-light setup would need, so
  // nothing ever reads as pure black even from an unlit angle.
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(2.5, 3.2, 2.6); // ~45° above, from the front
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
  fillLight.position.set(-3, 1.4, 2); // opposite side of the key, lower + softer
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.9);
  rimLight.position.set(-1.5, 2.2, -3); // behind the model, for edge definition
  scene.add(rimLight);

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
  subscribe(syncActiveView);
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
  applyColorTarget('trim', TRIM_COLOR_HEX[state.components.trim.color]);
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

/**
 * Smoothly animate the camera to a preset angle around the current
 * model — reuses the same camera/OrbitControls the drag-to-rotate and
 * zoom buttons already drive, it just moves them to a new spot instead
 * of reading pointer input. Angles are approximate/placeholder (there's
 * no reference footage to match exactly yet); easy to retune later since
 * they're all in one place.
 * @param {'front'|'side'|'back'|'detail'} viewId
 */
export function setView(viewId) {
  if (!scene || !currentModel || !camera || !controls) return;

  const box = new THREE.Box3().setFromObject(currentModel);
  const center = box.getCenter(new THREE.Vector3());
  // Reuse the distance the model was originally framed at, so front/side/back
  // all sit at the same "zoomed out enough to see the whole case" level —
  // only "detail" deliberately moves in closer.
  const baseDistance = homeCameraPosition.distanceTo(homeTarget) || 1;

  let lookAt = center;
  let distance = baseDistance;
  let azimuthDeg;
  let elevationDeg;

  switch (viewId) {
    case 'front':
      azimuthDeg = 32;
      elevationDeg = 20;
      break;
    case 'side':
      azimuthDeg = 95;
      elevationDeg = 15;
      break;
    case 'back':
      azimuthDeg = 212;
      elevationDeg = 20;
      break;
    case 'detail': {
      // Zoom in on the zipper track — the one part we can point to by name
      // on this GLB (see modelLoader.js's inventory). There's no separate
      // logo-plate mesh on this model to focus on instead.
      const zipperMeshes = currentModel.userData?.colorTargets?.trim;
      if (zipperMeshes?.length) {
        const detailBox = new THREE.Box3();
        zipperMeshes.forEach((mesh) => detailBox.expandByObject(mesh));
        lookAt = detailBox.getCenter(new THREE.Vector3());
      }
      azimuthDeg = 50;
      elevationDeg = 12;
      distance = baseDistance * 0.42;
      break;
    }
    default:
      return; // unknown view id — no-op rather than guessing
  }

  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const newCameraPosition = new THREE.Vector3(
    lookAt.x + distance * Math.cos(elevation) * Math.sin(azimuth),
    lookAt.y + distance * Math.sin(elevation),
    lookAt.z + distance * Math.cos(elevation) * Math.cos(azimuth)
  );

  animateCameraTo(newCameraPosition, lookAt);
}

/* ============================ internals ============================ */

function aspectOf(el) {
  return (el.clientWidth || 1) / (el.clientHeight || 1);
}

// Thumbnail index -> preset view id. Index 3 ("Interior") is intentionally
// null: this GLB has no interior/lining geometry (confirmed by walking its
// full mesh list — see modelLoader.js's header), so there's no honest
// camera preset for it. Its button is `disabled` in index.html rather than
// wired to a view that would just show more exterior.
const THUMBNAIL_VIEWS = ['front', 'side', 'back', null, 'detail'];

let lastActiveThumbnail = state.ui.activeThumbnail;

/** Only react when the *active* thumbnail actually changes, not on every
 * unrelated state update (color swaps etc. also call every subscriber). */
function syncActiveView() {
  if (state.ui.activeThumbnail === lastActiveThumbnail) return;
  lastActiveThumbnail = state.ui.activeThumbnail;
  const viewId = THUMBNAIL_VIEWS[lastActiveThumbnail];
  if (viewId) setView(viewId);
}

let activeCameraAnimationId = null;

/** Ease + lerp the camera position and OrbitControls target from wherever
 * they currently are to a new spot, over `duration` ms. Disables user
 * input for the duration so a drag mid-animation can't fight the tween. */
function animateCameraTo(targetPosition, targetLookAt, duration = 700) {
  if (!camera || !controls) return;
  if (activeCameraAnimationId !== null) cancelAnimationFrame(activeCameraAnimationId);

  const startPosition = camera.position.clone();
  const startLookAt = controls.target.clone();
  const startTime = performance.now();

  controls.enabled = false;

  const tick = (now) => {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = easeInOutCubic(t);
    camera.position.lerpVectors(startPosition, targetPosition, eased);
    controls.target.lerpVectors(startLookAt, targetLookAt, eased);
    controls.update();

    if (t < 1) {
      activeCameraAnimationId = requestAnimationFrame(tick);
    } else {
      activeCameraAnimationId = null;
      controls.enabled = true;
    }
  };
  activeCameraAnimationId = requestAnimationFrame(tick);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
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
