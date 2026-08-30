/**
 * ar.js
 * -----------------------------------------------------------------------
 * "VIEW IN AR" handoff to the OS-native AR viewers. No Three.js / WebXR
 * here — the native viewers do the rendering:
 *
 *   iOS / iPadOS  ->  AR Quick Look   (<a rel="ar"> pointing at a .usdz)
 *   Android       ->  Scene Viewer    (intent:// URL pointing at a .glb,
 *                                      Play Store fallback for ARCore)
 *   Desktop / other -> no AR launch; a small inline hint instead of a
 *                      dead click.
 *
 * This module owns the #viewInArBtn click behavior end to end. ui.js no
 * longer binds that button (it only left a console.log stub there).
 *
 * ───────────────────────────────────────────────────────────────────────
 * ASSET STATUS (checked 2026-08-30):  assets/ar/ is EMPTY (.gitkeep only).
 * There is NO .usdz (iOS) and NO AR-dedicated .glb (Android) committed.
 * The only model in the repo is assets/models/trolley.glb, which the 3D
 * viewer uses. See AR_ASSETS / PER_COLOR_ASSETS below: drop files in with
 * the names this file expects and AR goes live with no code change. Until
 * then every click logs a clear console error and shows the "not ready"
 * hint instead of a broken handoff.
 *
 * COLOR ACCURACY: AR Quick Look and Scene Viewer both load a *static*
 * file — neither can be told "use the crimson body" at launch time the
 * way the live Three.js viewer is recolored. To make AR reflect the
 * chosen colour you need one pre-exported file per body colour
 * (8 .usdz + 8 .glb). This module already resolves the right file from
 * `state.color`; flip PER_COLOR_ASSETS to true once those exist. With it
 * false, AR shows the single reference model regardless of selection.
 * ----------------------------------------------------------------------- */

import { state, subscribe, COLORS } from './state.js';

const LOG = '[ar]';
const AR_DIR = 'assets/ar/';

/** Single reference files, used when PER_COLOR_ASSETS is false. */
const BASE_ASSETS = {
  usdz: `${AR_DIR}trolley.usdz`,
  glb: `${AR_DIR}trolley.glb`,
};

/**
 * Per-body-colour AR files, keyed by the same ids as state.color / COLORS.
 * These paths are a naming contract for whoever exports the assets:
 *   assets/ar/trolley-matte-black.usdz , assets/ar/trolley-matte-black.glb , ...
 */
const AR_ASSETS = Object.fromEntries(
  COLORS.map((c) => [
    c.id,
    { usdz: `${AR_DIR}trolley-${c.id}.usdz`, glb: `${AR_DIR}trolley-${c.id}.glb` },
  ]),
);

/**
 * FLIP TO TRUE once per-colour .usdz/.glb files exist in assets/ar/.
 * false  -> AR always shows BASE_ASSETS (reference model, colour may vary).
 * true   -> AR loads the file matching the currently selected body colour.
 */
const PER_COLOR_ASSETS = false;

const SCENE_VIEWER_FALLBACK =
  'https://play.google.com/store/apps/details?id=com.google.ar.core';
const AR_TITLE = 'QILO Trolley';

/* ───────────────────────── platform detection ────────────────────────── */

/** @returns {'ios' | 'android' | 'desktop'} */
export function detectPlatform() {
  // QA override for debugging a specific handoff on any device:
  //   ?arPlatform=ios | android | desktop
  try {
    const forced = new URLSearchParams(window.location.search).get('arPlatform');
    if (forced === 'ios' || forced === 'android' || forced === 'desktop') {
      console.warn(`${LOG} platform forced to "${forced}" via ?arPlatform`);
      return forced;
    }
  } catch {
    /* ignore */
  }

  const ua = navigator.userAgent || '';

  // Android first — an Android UA on a touch device must never fall through
  // to the "Mac + touch = iPad" heuristic below.
  if (/Android/.test(ua)) return 'android';

  const appleMobile =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ sends a Macintosh UA; distinguish a real iPad from a
    // desktop Mac by touch support, and exclude non-Safari Mac browsers.
    (/Macintosh/.test(ua) &&
      'ontouchend' in document &&
      !/Chrome|CriOS|Edg|OPR|Firefox/.test(ua));
  if (appleMobile) return 'ios';

  return 'desktop';
}

/** Whether this browser can actually trigger AR Quick Look. */
function quickLookSupported() {
  try {
    const a = document.createElement('a');
    return Boolean(a.relList && a.relList.supports && a.relList.supports('ar'));
  } catch {
    return false;
  }
}

/* ─────────────────────────── asset resolution ────────────────────────── */

function resolveAssets(colorId) {
  if (PER_COLOR_ASSETS && AR_ASSETS[colorId]) return AR_ASSETS[colorId];
  return BASE_ASSETS;
}

/** Absolute URL — Scene Viewer's `file=` param must be absolute. */
function absoluteUrl(path) {
  return new URL(path, window.location.href).href;
}

/**
 * Cache of "does this asset path resolve to a real file?" so the click
 * handler can stay synchronous (needed for the iOS Quick Look user
 * gesture). Populated by preflight().
 */
const availability = new Map();

async function preflight(path) {
  if (availability.has(path)) return availability.get(path);
  let ok = false;
  try {
    const res = await fetch(path, { method: 'HEAD' });
    ok = res.ok;
    if (!ok) {
      // some static hosts don't allow HEAD — retry with a ranged GET
      const res2 = await fetch(path, { headers: { Range: 'bytes=0-0' } });
      ok = res2.ok;
    }
  } catch (err) {
    console.warn(`${LOG} preflight request failed for ${path}`, err);
    ok = false;
  }
  availability.set(path, ok);
  return ok;
}

/* ─────────────────────────── launch handlers ─────────────────────────── */

function launchIOS(usdzPath) {
  if (!quickLookSupported()) {
    console.error(
      `${LOG} iOS detected but AR Quick Look (rel="ar") is not supported by this browser. UA:`,
      navigator.userAgent,
    );
    showHint("Couldn't open AR on this browser — try Safari.");
    return;
  }

  // Apple's AR Quick Look trigger: an <a rel="ar"> whose single child is an
  // <img> (or <picture>). With that child present Safari opens the AR
  // overlay in place; without it, the click just navigates to the .usdz.
  const anchor = document.createElement('a');
  anchor.setAttribute('rel', 'ar');
  anchor.href = usdzPath;
  const img = document.createElement('img');
  img.alt = '';
  // 1×1 transparent GIF — the child just has to exist, it isn't shown.
  img.src =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  anchor.appendChild(img);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);

  console.info(`${LOG} iOS → AR Quick Look:`, absoluteUrl(usdzPath));
  anchor.addEventListener('message', (e) => console.info(`${LOG} Quick Look message:`, e.data));
  anchor.click();

  window.setTimeout(() => anchor.remove(), 1000);
}

function launchAndroid(glbPath) {
  const fileUrl = absoluteUrl(glbPath);
  if (/^https?:\/\/localhost|^https?:\/\/127\.|^https?:\/\/(?:[0-9]{1,3}\.){3}/.test(fileUrl)) {
    console.warn(
      `${LOG} Scene Viewer needs a publicly reachable https URL for the model. ` +
        `Current URL "${fileUrl}" is local — AR will likely fail on-device until deployed.`,
    );
  }

  const params = new URLSearchParams({
    file: fileUrl,
    mode: 'ar_preferred',
    title: AR_TITLE,
  });
  const intentUrl =
    `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}` +
    `#Intent;scheme=https;package=com.google.android.googlequicksearchbox;` +
    `action=android.intent.action.VIEW;` +
    `S.browser_fallback_url=${encodeURIComponent(SCENE_VIEWER_FALLBACK)};end;`;

  console.info(`${LOG} Android → Scene Viewer intent:`, intentUrl);
  // Assigning location keeps the current page in history so returning from
  // Scene Viewer lands back on the configurator.
  window.location.href = intentUrl;
}

/* ──────────────────────────── hint element ──────────────────────────── */

let hintEl = null;
let hintTimer = 0;

function showHint(message) {
  const btn = document.getElementById('viewInArBtn');
  if (!btn) return;

  if (!hintEl) {
    hintEl = document.createElement('p');
    hintEl.className = 'ar-hint';
    hintEl.setAttribute('role', 'status');
    btn.insertAdjacentElement('afterend', hintEl);
  }
  hintEl.textContent = message;
  hintEl.classList.add('is-visible');

  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => hintEl && hintEl.classList.remove('is-visible'), 4000);
}

/* ─────────────────────────────── init ───────────────────────────────── */

/**
 * Wire the "VIEW IN AR" button. Call once from main.js after the DOM and
 * UI shell are ready.
 */
export function initAR() {
  const btn = document.getElementById('viewInArBtn');
  if (!btn) {
    console.error(`${LOG} #viewInArBtn not found — AR button not wired.`);
    return;
  }

  const platform = detectPlatform();
  btn.dataset.arPlatform = platform;

  console.info(
    `${LOG} init · platform="${platform}" · quickLook=${quickLookSupported()} · ` +
      `perColorAssets=${PER_COLOR_ASSETS} · UA="${navigator.userAgent}"`,
  );

  if (platform === 'desktop') {
    // Keep the button visible (it signals the feature exists) but make the
    // click explain itself instead of firing a doomed AR launch.
    btn.setAttribute('aria-disabled', 'true');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      console.info(`${LOG} click ignored on desktop — AR is a mobile-only handoff.`);
      showHint('View in AR is available on a phone or tablet.');
    });
    return;
  }

  // Mobile: preflight the asset(s) we might need so the click stays sync.
  const kind = platform === 'ios' ? 'usdz' : 'glb';
  const warmPaths = new Set([BASE_ASSETS[kind]]);
  if (PER_COLOR_ASSETS) COLORS.forEach((c) => warmPaths.add(AR_ASSETS[c.id][kind]));
  warmPaths.forEach((p) => {
    preflight(p).then((ok) => {
      if (!ok) console.error(`${LOG} AR asset missing or unreachable: ${absoluteUrl(p)}`);
    });
  });

  // Re-preflight a per-colour file the first time that colour is chosen.
  if (PER_COLOR_ASSETS) {
    subscribe((s, patch) => {
      if (!('color' in patch)) return;
      preflight(AR_ASSETS[s.color]?.[kind]);
    });
  }

  btn.addEventListener('click', () => {
    const { usdz, glb } = resolveAssets(state.color);
    const path = platform === 'ios' ? usdz : glb;

    console.info(`${LOG} click · platform="${platform}" · color="${state.color}" · asset="${path}"`);

    if (availability.get(path) === false) {
      console.error(
        `${LOG} not launching — AR asset "${absoluteUrl(path)}" is missing. ` +
          `Add the file to assets/ar/ (see ar.js header).`,
      );
      showHint('AR model isn’t available yet.');
      return;
    }
    if (!availability.has(path)) {
      console.warn(`${LOG} asset "${path}" not preflighted yet — attempting handoff anyway.`);
    }

    if (platform === 'ios') launchIOS(path);
    else launchAndroid(path);
  });
}
