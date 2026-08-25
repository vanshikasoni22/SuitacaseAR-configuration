/**
 * main.js
 * -----------------------------------------------------------------------
 * Entry point. Wires up the static UI shell, then hands the viewer stage
 * to scene.js/modelLoader.js. Stays a thin wiring layer on purpose — all
 * Three.js logic lives in those two files, not here.
 * ----------------------------------------------------------------------- */

import { initUI } from './ui.js';
import { initScene, setModel } from './scene.js';
import { loadTrolleyModel } from './modelLoader.js';

document.addEventListener('DOMContentLoaded', async () => {
  initUI();

  const stage = document.getElementById('viewerStage');
  initScene(stage);
  setModel(await loadTrolleyModel());

  // --- future hook point ---
  // import { initAR } from './ar.js';
  // initAR(stage);
});
