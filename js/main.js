/**
 * main.js
 * -----------------------------------------------------------------------
 * Entry point. Restores a shared design from the URL (if any), wires up
 * the static UI shell, then hands the viewer stage to scene.js/
 * modelLoader.js. Stays a thin wiring layer on purpose — all Three.js
 * logic lives in those two files, not here.
 * ----------------------------------------------------------------------- */

import { initUI } from './ui.js';
import { initScene, setModel } from './scene.js';
import { loadTrolleyModel } from './modelLoader.js';
import { updateState } from './state.js';
import { decodeShareUrl } from './share.js';

document.addEventListener('DOMContentLoaded', async () => {
  const sharedDesign = decodeShareUrl();
  if (sharedDesign) {
    updateState(sharedDesign);
    // Don't keep forcing this design back on every future reload of what
    // is now just "the page the user is on" — the link did its job.
    history.replaceState({}, '', window.location.pathname);
  }

  initUI();

  const stage = document.getElementById('viewerStage');
  initScene(stage);
  setModel(await loadTrolleyModel());

  // --- future hook point ---
  // import { initAR } from './ar.js';
  // initAR(stage);
});
