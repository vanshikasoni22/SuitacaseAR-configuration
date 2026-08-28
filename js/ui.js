/**
 * ui.js
 * -----------------------------------------------------------------------
 * All non-3D interactivity: renders dynamic bits (swatches, dot options,
 * selection chips), wires up event listeners, and keeps the DOM in sync
 * with state.js. Nothing in here touches WebGL/Three.js — scene.js will
 * subscribe to state.js independently once it exists.
 * ----------------------------------------------------------------------- */

import { state, updateState, subscribe, computeTotal, COLORS, WHEEL_COLORS, TRIM_COLORS } from './state.js';

const checkIconSvg = `
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <polyline points="5 13 10 18 19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

/* ============================ STEP 1 — MATERIAL & FINISH ============================ */

function renderColorSwatches() {
  const container = document.getElementById('colorSwatches');
  container.innerHTML = COLORS.map((c) => `
    <button
      type="button"
      class="swatch ${state.color === c.id ? 'is-selected' : ''}"
      data-color-id="${c.id}"
      role="radio"
      aria-checked="${state.color === c.id}"
      aria-label="${c.label}"
    >
      <span class="swatch__chip" style="--swatch-color:${c.hex}">
        <span class="swatch__check">${checkIconSvg}</span>
      </span>
      <span class="swatch__label">${c.label}</span>
    </button>
  `).join('');
}

function bindColorSwatches() {
  document.getElementById('colorSwatches').addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch');
    if (!btn) return;
    updateState({ color: btn.dataset.colorId });
  });
}

function bindMaterialSelect() {
  const select = document.getElementById('materialSelect');
  select.value = state.material;
  select.addEventListener('change', () => {
    updateState({ material: select.value });
  });
}

/* ============================ STEP 2 — COMPONENTS ============================ */

function renderWheelColorOptions() {
  const container = document.getElementById('wheelColorOptions');
  container.innerHTML = WHEEL_COLORS.map((c) => `
    <button
      type="button"
      class="dot-option ${state.components.wheels.color === c.id ? 'is-active' : ''}"
      data-wheel-color="${c.id}"
      style="--dot-color:${c.hex}"
      role="radio"
      aria-checked="${state.components.wheels.color === c.id}"
      aria-label="${c.label}"
    ></button>
  `).join('');
}

function bindWheelColorOptions() {
  document.getElementById('wheelColorOptions').addEventListener('click', (e) => {
    const btn = e.target.closest('.dot-option');
    if (!btn) return;
    updateState({ components: { wheels: { ...state.components.wheels, color: btn.dataset.wheelColor } } });
  });
}

function bindHandleOptions() {
  document.getElementById('handleOptions').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    updateState({ components: { handles: { type: btn.dataset.value } } });
  });
}

/** Renders from TRIM_COLORS (state.js) the same way renderWheelColorOptions
 * renders from WHEEL_COLORS — any number of entries, not hardcoded to 2. */
function renderTrimColorOptions() {
  const container = document.getElementById('trimColorOptions');
  container.innerHTML = TRIM_COLORS.map((c) => `
    <button
      type="button"
      class="dot-option ${state.components.trim.color === c.id ? 'is-active' : ''}"
      data-trim-color="${c.id}"
      style="--dot-color:${c.hex}"
      role="radio"
      aria-checked="${state.components.trim.color === c.id}"
      aria-label="${c.label}"
    ></button>
  `).join('');
}

function bindTrimOptions() {
  document.getElementById('trimColorOptions').addEventListener('click', (e) => {
    const btn = e.target.closest('.dot-option');
    if (!btn) return;
    updateState({ components: { trim: { color: btn.dataset.trimColor } } });
  });
}

/** Reflect selected state onto the (statically-authored) handle pills, and
 * keep the "Zippers & Trim <em>…</em>" row label naming the current color. */
function syncComponentOptionButtons() {
  document.querySelectorAll('#handleOptions .pill').forEach((btn) => {
    const active = btn.dataset.value === state.components.handles.type;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-checked', String(active));
  });
  const trimLabelEl = document.querySelector('.accordion-row[data-section="trim"] .accordion-row__label em');
  if (trimLabelEl) trimLabelEl.textContent = TRIM_LABELS[state.components.trim.color];
}

function bindAccordion() {
  document.getElementById('componentsAccordion').addEventListener('click', (e) => {
    const trigger = e.target.closest('.accordion-row__trigger');
    if (!trigger) return;
    const row = trigger.closest('.accordion-row');
    const section = row.dataset.section;
    const isOpen = row.dataset.open === 'true';
    updateState({ ui: { openSections: { ...state.ui.openSections, [section]: !isOpen } } });
  });
}

function syncAccordion() {
  document.querySelectorAll('.accordion-row').forEach((row) => {
    const section = row.dataset.section;
    const isOpen = !!state.ui.openSections[section];
    row.dataset.open = String(isOpen);
    row.querySelector('.accordion-row__trigger').setAttribute('aria-expanded', String(isOpen));
  });
}

/* ============================ STEP 3 — PERSONALIZATION ============================ */

function bindMonogramToggle() {
  document.getElementById('monogramToggle').addEventListener('click', () => {
    updateState({ monogram: { enabled: !state.monogram.enabled } });
  });
}

function bindInitialsInput() {
  const input = document.getElementById('initialsInput');
  input.addEventListener('input', () => {
    updateState({ monogram: { initials: input.value.toUpperCase() } });
  });
}

function bindLocationSelect() {
  const select = document.getElementById('locationSelect');
  select.addEventListener('change', () => {
    updateState({ monogram: { location: select.value } });
  });
}

function syncPersonalization() {
  const toggle = document.getElementById('monogramToggle');
  const fields = document.getElementById('personalizationFields');
  const preview = document.getElementById('monogramPreviewText');

  toggle.setAttribute('aria-checked', String(state.monogram.enabled));
  fields.hidden = !state.monogram.enabled;
  preview.textContent = state.monogram.initials || 'A.K.';
}

/* ============================ VIEWER CONTROLS (non-3D placeholders) ============================ */

function bindViewerControls() {
  // Zoom in/out/reset are now wired directly in scene.js (camera concerns —
  // ui.js stays WebGL-free, see header comment). AR is still a stub until
  // ar.js is implemented.
  document.getElementById('viewInArBtn').addEventListener('click', () => {
    console.log('[viewer] view in AR (hook for ar.js)');
  });
}

function bindThumbnailStrip() {
  document.getElementById('thumbnailStrip').addEventListener('click', (e) => {
    const btn = e.target.closest('.thumbnail');
    if (!btn) return;
    updateState({ ui: { activeThumbnail: Number(btn.dataset.thumb) } });
  });
}

function syncThumbnailStrip() {
  document.querySelectorAll('.thumbnail').forEach((btn) => {
    const active = Number(btn.dataset.thumb) === state.ui.activeThumbnail;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

/* ============================ TOP NAV (mobile menu) ============================ */

function bindMobileNav() {
  const toggle = document.getElementById('navMenuToggle');
  const links = document.getElementById('navLinks');
  toggle.addEventListener('click', () => {
    const isOpen = links.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });
}

/* ============================ SIDEBAR (mobile bottom sheet) ============================ */

function bindSidebarToggle() {
  const toggleBtn = document.getElementById('sidebarToggle');
  const closeBtn = document.getElementById('sidebarClose');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  const open = () => {
    sidebar.classList.add('is-open');
    backdrop.classList.add('is-open');
    toggleBtn.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    toggleBtn.setAttribute('aria-expanded', 'false');
  };

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.contains('is-open') ? close() : open();
  });
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
}

/* ============================ SUMMARY BAR ============================ */

const COLOR_LABELS = Object.fromEntries(COLORS.map((c) => [c.id, c.label]));
const COLOR_HEX = Object.fromEntries(COLORS.map((c) => [c.id, c.hex]));
const WHEEL_LABELS = Object.fromEntries(WHEEL_COLORS.map((c) => [c.id, c.label]));
const WHEEL_HEX = Object.fromEntries(WHEEL_COLORS.map((c) => [c.id, c.hex]));
const TRIM_LABELS = Object.fromEntries(TRIM_COLORS.map((c) => [c.id, c.label]));
const TRIM_HEX = Object.fromEntries(TRIM_COLORS.map((c) => [c.id, c.hex]));

function renderSelectionChips() {
  const chips = [
    { label: state.material, color: null },
    { label: COLOR_LABELS[state.color], color: COLOR_HEX[state.color] },
    { label: `Wheels: ${WHEEL_LABELS[state.components.wheels.color]}`, color: WHEEL_HEX[state.components.wheels.color] },
    { label: state.components.handles.type === 'telescopic' ? 'Telescopic Handle' : 'Side Handle', color: null },
    { label: `${TRIM_LABELS[state.components.trim.color]} Trim`, color: TRIM_HEX[state.components.trim.color] },
  ];

  if (state.monogram.enabled) {
    chips.push({ label: `Monogram: ${state.monogram.initials || '—'}`, color: null });
  }

  document.getElementById('selectionChips').innerHTML = chips.map((chip) => `
    <span class="chip">
      ${chip.color ? `<span class="chip__dot" style="--chip-color:${chip.color}"></span>` : ''}
      ${chip.label}
    </span>
  `).join('');
}

function renderTotalPrice() {
  const total = computeTotal();
  document.getElementById('totalPrice').textContent = total.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  });
}

function bindSummaryBarActions() {
  document.getElementById('shareDesignBtn').addEventListener('click', () => {
    console.log('[summary] share design', JSON.stringify(state));
  });
  document.getElementById('addToBagBtn').addEventListener('click', () => {
    const badge = document.getElementById('bagCount');
    badge.textContent = String(Number(badge.textContent || '0') + 1);
    console.log('[summary] add to bag', JSON.stringify(state));
  });
}

/* ============================ RESPONSIVE LAYOUT SYNC ============================ */

/**
 * The summary bar's real height varies (its chip row / action row can wrap
 * on narrow screens), but layout.css positions fixed/sticky elements
 * (sidebar-toggle, app-shell height) using the --summary-bar-height
 * variable. Keep that variable equal to the bar's actual rendered height
 * so nothing gets tucked behind it, no matter how the content wraps.
 */
function initSummaryBarHeightSync() {
  const bar = document.querySelector('.summary-bar');
  const sync = () => {
    document.documentElement.style.setProperty('--summary-bar-height', `${bar.offsetHeight}px`);
  };
  new ResizeObserver(sync).observe(bar);
  sync();
}

/* ============================ INIT ============================ */

/** Re-render every piece of UI that depends on state. Called on every state change. */
function render() {
  syncComponentOptionButtons();
  syncAccordion();
  syncPersonalization();
  syncThumbnailStrip();
  renderSelectionChips();
  renderTotalPrice();

  // keep radiogroup selection markup (checkmarks / active dots) in sync
  document.querySelectorAll('#colorSwatches .swatch').forEach((btn) => {
    const active = btn.dataset.colorId === state.color;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-checked', String(active));
  });
  document.querySelectorAll('#wheelColorOptions .dot-option').forEach((btn) => {
    const active = btn.dataset.wheelColor === state.components.wheels.color;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-checked', String(active));
  });
  document.querySelectorAll('#trimColorOptions .dot-option').forEach((btn) => {
    const active = btn.dataset.trimColor === state.components.trim.color;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-checked', String(active));
  });
}

export function initUI() {
  renderColorSwatches();
  renderWheelColorOptions();
  renderTrimColorOptions();

  bindColorSwatches();
  bindMaterialSelect();
  bindWheelColorOptions();
  bindHandleOptions();
  bindTrimOptions();
  bindAccordion();
  bindMonogramToggle();
  bindInitialsInput();
  bindLocationSelect();
  bindViewerControls();
  bindThumbnailStrip();
  bindMobileNav();
  bindSidebarToggle();
  bindSummaryBarActions();

  subscribe(render);
  render();
  initSummaryBarHeightSync();
}
