/**
 * scene.js
 * -----------------------------------------------------------------------
 * Three.js scene: renderer (sRGB output, ACES filmic tone mapping), a
 * PMREM-filtered studio environment map for PBR reflections, camera,
 * studio 3-point lighting (key/fill/rim + ambient), and OrbitControls,
 * mounted into the existing #viewerStage element. Also
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
 * Also renders the thumbnail strip's own preview images: captureThumbnails()
 * (internal) briefly reuses the main renderer at thumbnail resolution to
 * snapshot the model from each preset angle and sets it as that button's
 * background-image — see its own comment for how that avoids a visible
 * flicker or a second WebGL context.
 *
 * Color reactivity: this file subscribes to state.js itself (the same
 * way it self-binds to the zoom buttons) and recolors the model whenever
 * `state.color` / `state.components.trim.color` / `state.components.
 * wheels.color` change — ui.js never touches the 3D scene directly, it
 * only ever calls updateState(). The active-thumbnail view preset works
 * the same way (see syncActiveView()), and the thumbnail preview images
 * are re-rendered on the same color-change trigger.
 *
 * Not implemented yet: ar.js.
 * ----------------------------------------------------------------------- */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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

  // Was missing entirely (defaulted to THREE.NoToneMapping) — that's the
  // main reason PBR materials were reading dull/flat: NoToneMapping just
  // clips values above 1.0 instead of rolling them off, which crushes
  // exactly the highlight/reflection detail that gives a material depth.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  renderer.domElement.classList.add('viewer__canvas');
  container.appendChild(renderer.domElement);

  const staticPlaceholder = container.querySelector('.viewer__placeholder');
  if (staticPlaceholder) staticPlaceholder.style.display = 'none';

  // This was the other (bigger) piece actually missing: PBR materials with
  // any metalness rely on environment reflections for their specular
  // response — direct lights alone only ever produce small hard
  // highlights, never the soft sheen/reflection that reads as "material
  // depth". No HDRI asset is bundled with this project, so this uses
  // Three's built-in procedural studio room (RoomEnvironment) baked into a
  // PMREM-filtered environment map — same effect as an HDRI for IBL
  // purposes, no extra asset to host/load. Only sets scene.environment
  // (lighting/reflections), not scene.background, so the canvas stays
  // transparent over the page's own surface behind it.
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  pmremGenerator.dispose();

  // Studio-style 3-point lighting so the model still has clear directional
  // modeling (the environment map above supplies soft ambient-ish fill +
  // reflections, but no strong directionality on its own):
  //   - key: the main light, angled above-front, does most of the modeling
  //   - fill: softer, opposite side, lifts the shadow side without
  //           flattening the key light's contrast
  //   - rim: from behind, separates the model's edge from the background
  // Intensities are dialed down from the pre-environment/pre-tone-mapping
  // version — with IBL doing real ambient work now, the old values (meant
  // to compensate for having *only* direct light) blow out highlights.
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(2.5, 3.2, 2.6); // ~45° above, from the front
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
  fillLight.position.set(-3, 1.4, 2); // opposite side of the key, lower + softer
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.45);
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
  captureThumbnails(); // re-render the thumbnail strip so it reflects the new colors too
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
 * of reading pointer input.
 * @param {'front'|'side'|'back'|'detail'} viewId
 */
export function setView(viewId) {
  if (!scene || !currentModel || !camera || !controls) return;
  const transform = getViewTransform(viewId);
  if (!transform) return;
  animateCameraTo(transform.position, transform.lookAt);
}

/**
 * Pure math for where the camera should sit for a named preset view —
 * shared by setView() (the animated live move) and captureThumbnails()
 * (instant snapshots for the thumbnail strip), so a thumbnail can never
 * drift out of sync with what clicking it actually shows. Angles are
 * approximate/placeholder (there's no reference footage to match exactly
 * yet); easy to retune later since they're all in one place.
 * @param {'front'|'side'|'back'|'detail'} viewId
 * @returns {{position: THREE.Vector3, lookAt: THREE.Vector3}|null}
 */
function getViewTransform(viewId) {
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
      return null; // unknown view id — no-op rather than guessing
  }

  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const position = new THREE.Vector3(
    lookAt.x + distance * Math.cos(elevation) * Math.sin(azimuth),
    lookAt.y + distance * Math.sin(elevation),
    lookAt.z + distance * Math.cos(elevation) * Math.cos(azimuth)
  );

  return { position, lookAt };
}

const THUMBNAIL_CAPTURE_WIDTH = 152; // 2x the CSS 76px thumbnail width, for a sharp image on retina
const THUMBNAIL_CAPTURE_HEIGHT = 120; // 2x the CSS 60px thumbnail height (same 76:60 aspect)

/**
 * Renders the live model from each preset angle into the *same* renderer/
 * canvas the real viewer uses (briefly, at thumbnail resolution) and sets
 * the result as that thumbnail button's background-image — so the strip
 * shows an actual small render of "what Side looks like" etc., not just a
 * text label. Re-run on every color change (see syncModelColors()) so the
 * previews always match the current customization.
 *
 * Deliberately reuses the main renderer/camera instead of spinning up a
 * second WebGL context per call: everything here happens synchronously in
 * one tick (resize down, move camera, render+capture x4, restore), so the
 * visible canvas's own render loop — which only ever paints on the next
 * animation frame — never has a chance to show the intermediate state.
 */
function captureThumbnails() {
  if (!scene || !camera || !renderer || !controls || !currentModel) return;

  const savedSize = new THREE.Vector2();
  renderer.getSize(savedSize);
  const savedPixelRatio = renderer.getPixelRatio();
  const savedAspect = camera.aspect;
  const savedCameraPosition = camera.position.clone();
  const savedTarget = controls.target.clone();

  renderer.setPixelRatio(1);
  renderer.setSize(THUMBNAIL_CAPTURE_WIDTH, THUMBNAIL_CAPTURE_HEIGHT, false);
  camera.aspect = THUMBNAIL_CAPTURE_WIDTH / THUMBNAIL_CAPTURE_HEIGHT;
  camera.updateProjectionMatrix();

  THUMBNAIL_VIEWS.forEach((viewId, index) => {
    const transform = getViewTransform(viewId);
    if (!transform) return;
    camera.position.copy(transform.position);
    camera.lookAt(transform.lookAt);
    renderer.render(scene, camera);

    const thumbBtn = document.querySelector(`.thumbnail[data-thumb="${index}"]`);
    if (thumbBtn) thumbBtn.style.backgroundImage = `url("${renderer.domElement.toDataURL('image/png')}")`;
  });

  // Restore the real viewport/camera before the next visible frame.
  renderer.setPixelRatio(savedPixelRatio);
  renderer.setSize(savedSize.x, savedSize.y, false);
  camera.aspect = savedAspect;
  camera.position.copy(savedCameraPosition);
  controls.target.copy(savedTarget);
  camera.updateProjectionMatrix();
  controls.update();
  renderer.render(scene, camera);
}

/* ============================ internals ============================ */

function aspectOf(el) {
  return (el.clientWidth || 1) / (el.clientHeight || 1);
}

// Thumbnail index -> preset view id (data-thumb="0..3" in index.html).
// There's no "Interior" entry: this GLB has no interior/lining geometry
// (confirmed by walking its full mesh list — see modelLoader.js's header),
// so that thumbnail was removed entirely rather than wired to a view that
// would just show more exterior.
const THUMBNAIL_VIEWS = ['front', 'side', 'back', 'detail'];

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
