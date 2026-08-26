/**
 * state.js
 * -----------------------------------------------------------------------
 * Single source of truth for the current trolley configuration.
 * This is deliberately framework-free and 3D-free: ui.js mutates it in
 * response to user interaction, and (later) scene.js / modelLoader.js
 * will subscribe to it to update the live 3D model + AR view.
 *
 * Usage:
 *   import { state, updateState, subscribe } from './state.js';
 *   subscribe((state, patch) => { ... react to change ... });
 *   updateState({ material: 'Aluminium' });
 * ----------------------------------------------------------------------- */

/** @typedef {{ id: string, label: string, hex: string }} ColorOption */

export const COLORS = /** @type {const} */ ([
  { id: 'matte-black', label: 'Matte Black', hex: '#1c1c1e' },
  { id: 'silver', label: 'Silver', hex: '#c9cdd3' },
  { id: 'navy-blue', label: 'Navy Blue', hex: '#1f3358' },
  { id: 'crimson', label: 'Crimson', hex: '#9e1b32' },
]);

export const WHEEL_COLORS = /** @type {const} */ ([
  { id: 'wheel-black', label: 'Black', hex: '#1c1c1e' },
  { id: 'wheel-grey', label: 'Grey', hex: '#8a8f98' },
  { id: 'wheel-red', label: 'Red', hex: '#9e1b32' },
]);

/**
 * Mirrors the two trim dot swatches hardcoded in index.html
 * (#trimColorOptions). Those are static markup, not rendered from a JS
 * list like COLORS/WHEEL_COLORS are, so this exists purely so scene.js
 * can look up a hex value for `state.components.trim.color` without
 * scraping the DOM for the --dot-color CSS var.
 */
export const TRIM_COLORS = {
  black: '#1c1c1e',
  tan: '#b98d5e',
};

/**
 * The canonical shape of the app's configuration state.
 * Keep this flat and serializable — it's what 3D logic + "share design"
 * will read from and write to.
 */
function createInitialState() {
  return {
    material: 'Aluminium',
    color: COLORS[0].id,
    components: {
      wheels: { count: 6, color: WHEEL_COLORS[0].id },
      handles: { type: 'telescopic' }, // 'telescopic' | 'side'
      trim: { color: 'black' },
    },
    monogram: {
      enabled: false,
      initials: '',
      location: 'front-panel',
    },
    // open/closed state for the accordion rows in COMPONENTS
    ui: {
      openSections: { wheels: true, handles: false, trim: false },
      activeThumbnail: 0,
    },
    price: {
      base: 14999,
      currency: 'INR',
    },
  };
}

export const state = createInitialState();

const listeners = new Set();

/**
 * Subscribe to state changes.
 * @param {(state: typeof state, patch: object) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Shallow-merge a patch into state (one level deep for known nested keys)
 * and notify subscribers. This is intentionally simple — swap for a
 * reducer/store later if the app grows.
 * @param {object} patch
 */
export function updateState(patch) {
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      state[key] &&
      typeof state[key] === 'object'
    ) {
      state[key] = { ...state[key], ...value };
    } else {
      state[key] = value;
    }
  }
  listeners.forEach((fn) => fn(state, patch));
  return state;
}

/** Reset state back to defaults (used by tests / "reset" flows). */
export function resetState() {
  Object.assign(state, createInitialState());
  listeners.forEach((fn) => fn(state, { reset: true }));
  return state;
}

/** Compute the running total price from current selections. */
export function computeTotal() {
  let total = state.price.base;
  if (state.monogram.enabled) total += 25;
  if (state.color === 'crimson' || state.color === 'navy-blue') total += 15;
  if (state.components.handles.type === 'side') total += 10;
  return total;
}
