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

/**
 * All three palettes below are plain arrays of {id, label, hex} for a
 * reason: ui.js renders every swatch/dot from these lists (nothing is
 * hardcoded to "4 options" anywhere), and scene.js derives its
 * id->hex lookup the same way for all three (`Object.fromEntries(LIST.
 * map(c => [c.id, c.hex]))`). Adding, removing, or reordering an entry
 * here is the entire change — no other file needs to know the count.
 * Hex values are reasonable placeholders; swap in exact brand hex codes
 * whenever they're finalized.
 */

export const COLORS = /** @type {const} */ ([
  { id: 'matte-black', label: 'Matte Black', hex: '#1c1c1e' },
  { id: 'silver', label: 'Silver', hex: '#c9cdd3' },
  { id: 'navy-blue', label: 'Navy Blue', hex: '#1f3358' },
  { id: 'crimson', label: 'Crimson', hex: '#9e1b32' },
  { id: 'graphite', label: 'Graphite', hex: '#3a3a3d' },
  { id: 'champagne-gold', label: 'Champagne Gold', hex: '#c9a86a' },
  { id: 'forest-green', label: 'Forest Green', hex: '#2c4a3e' },
  { id: 'ivory', label: 'Ivory', hex: '#ece7dd' },
]);

export const WHEEL_COLORS = /** @type {const} */ ([
  { id: 'wheel-black', label: 'Black', hex: '#1c1c1e' },
  { id: 'wheel-grey', label: 'Grey', hex: '#8a8f98' },
  { id: 'wheel-red', label: 'Red', hex: '#9e1b32' },
  { id: 'wheel-silver', label: 'Silver', hex: '#b7bbc2' },
  { id: 'wheel-gold', label: 'Gold', hex: '#c9a86a' },
  { id: 'wheel-white', label: 'White', hex: '#ececeb' },
  { id: 'wheel-navy', label: 'Navy', hex: '#29456e' },
]);

/**
 * Previously a hardcoded {black, tan} object backing two static HTML
 * buttons — converted to the same array shape as COLORS/WHEEL_COLORS so
 * it renders dynamically (see ui.js's renderTrimColorOptions) and scales
 * the same way.
 */
export const TRIM_COLORS = /** @type {const} */ ([
  { id: 'trim-black', label: 'Black', hex: '#1c1c1e' },
  { id: 'trim-tan', label: 'Tan', hex: '#b98d5e' },
  { id: 'trim-grey', label: 'Grey', hex: '#8a8f98' },
  { id: 'trim-gold', label: 'Gold', hex: '#c9a86a' },
  { id: 'trim-navy', label: 'Navy', hex: '#29456e' },
  { id: 'trim-white', label: 'White', hex: '#ececeb' },
]);

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
      trim: { color: TRIM_COLORS[0].id },
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
