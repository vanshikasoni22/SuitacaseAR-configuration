/**
 * main.js
 * -----------------------------------------------------------------------
 * Entry point. Wires up the static UI shell. 3D initialization (scene.js
 * / modelLoader.js / ar.js) will be called from here once implemented —
 * left commented out as the intended hook point.
 * ----------------------------------------------------------------------- */

import { initUI } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
  initUI();

  // --- future 3D hook point ---
  // import { initScene } from './scene.js';
  // import { loadModel } from './modelLoader.js';
  // import { initAR } from './ar.js';
  // const stage = document.getElementById('viewerStage');
  // initScene(stage).then(loadModel).then(initAR);
});
