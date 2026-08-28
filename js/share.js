/**
 * share.js
 * -----------------------------------------------------------------------
 * Turns the current configuration into a shareable URL, and reads one
 * back. Client-side only, no backend/database: the whole design is a
 * base64-encoded JSON blob in a single `?design=` query param.
 *
 * Deliberately only touches the fields that describe "the design" itself
 * (material, color, components, monogram) — UI-only state like which
 * accordion is open or which thumbnail is active isn't part of what
 * should round-trip through a shared link.
 * ----------------------------------------------------------------------- */

/** Pick just the shareable fields out of the full app state. */
function toShareable(state) {
  return {
    material: state.material,
    color: state.color,
    components: {
      wheels: { color: state.components.wheels.color },
      trim: { color: state.components.trim.color },
    },
    monogram: { ...state.monogram },
  };
}

/**
 * @param {typeof import('./state.js').state} state
 * @returns {string} a full URL (same page, current query replaced) that
 *   encodes the given state's shareable fields.
 */
export function buildShareUrl(state) {
  const encoded = btoa(encodeURIComponent(JSON.stringify(toShareable(state))));
  const url = new URL(window.location.href);
  url.search = `?design=${encoded}`;
  url.hash = '';
  return url.toString();
}

/**
 * @param {string} [search] defaults to the current page's query string
 * @returns {object|null} a patch ready for updateState(), or null if
 *   there's no (or an unreadable) `?design=` param.
 */
export function decodeShareUrl(search = window.location.search) {
  const encoded = new URLSearchParams(search).get('design');
  if (!encoded) return null;
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)));
  } catch (err) {
    console.warn('[share] ignoring unreadable ?design= link', err);
    return null;
  }
}

/**
 * Copy text to the clipboard, falling back through progressively less
 * convenient options if the modern async Clipboard API isn't available
 * (insecure context, permission denied, older browser).
 * @returns {Promise<boolean>} whether the copy actually succeeded
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path below
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
