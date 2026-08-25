/**
 * modelLoader.js
 * -----------------------------------------------------------------------
 * Loads the real trolley GLB and resolves the Object3D that scene.js
 * mounts into the viewer. scene.js only ever deals with the returned
 * Object3D + its `.userData.colorTargets` map — it doesn't know or care
 * about raw GLB mesh/material names, so re-pointing this at a different
 * export only means editing MODEL_URL and COLOR_TARGET_MATERIALS below.
 *
 * --- What's actually in the supplied GLBs (inspected via their JSON
 * chunk, then confirmed by isolating each material in the live scene —
 * see console output on load for the live mesh/material inventory) ---
 *
 * Suitcase_1.glb (not used here): ONE fused mesh ("Suitcase003_sc_blue_0")
 * on ONE textured material ("sc_blue"). No separated parts at all — the
 * body/wheels/handle-looking nodes in its hierarchy (W013–W016,
 * Handle003) are empty transform nodes with no mesh attached. Not usable
 * for color/part swapping as exported; would need a re-export with parts
 * actually split into separate meshes/materials.
 *
 * Suitcase_2.glb (used here, copied to assets/models/trolley.glb): 7
 * primitives across 6 solid-color (no texture) PBR materials. What each
 * one visually turned out to be, by isolating it and checking its
 * bounding box:
 *   - "suitcase.001" (Mesh_2)            -> the main outer shell. BODY.
 *   - "zipper" (Mesh_6, its own node)     -> the zipper track around the
 *                                            body seam. ZIPPERS & TRIM.
 *   - "Grey.002" (Mesh_4)                 -> the wheel clusters at the
 *                                            base. WHEELS.
 *   - "grey.001" (Mesh_3)                 -> the wheel housings/brackets
 *                                            sitting just above the
 *                                            wheels — left un-wired so
 *                                            recoloring "wheels" doesn't
 *                                            also recolor its mount.
 *   - "metall" (Mesh_1)                   -> a small hardware nub at the
 *                                            very top of the pull handle.
 *   - "Black.001" (Mesh_0 + Mesh_5,
 *      same material instance shared
 *      by both)                          -> perimeter edge piping that
 *                                            wraps most of the case, PLUS
 *                                            one small unrelated fragment
 *                                            at the very bottom (same
 *                                            material reused, not the
 *                                            same part).
 *
 * "metall" and "Black.001" are left un-wired: the sidebar's Handles row
 * is a TYPE toggle (Telescopic/Side pills), not a color swatch, so there
 * is no UI control to attach a handle color to yet — and Black.001 being
 * shared across two unrelated parts (edge piping + a stray bottom bit)
 * means recoloring it would visibly affect both. Nothing here needs a
 * re-export for what the UI actually asks for today (body/wheels/trim
 * color); it would only matter if a "handle color" control gets added
 * later, since there's no mesh that's *just* the handle bar on its own.
 * ----------------------------------------------------------------------- */

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = 'assets/models/trolley.glb';

/**
 * Semantic part id -> GLB material name(s) it corresponds to. This is the
 * one table to edit if a re-export renames/re-splits materials — nothing
 * else in this file or in scene.js needs to change.
 */
const COLOR_TARGET_MATERIALS = {
  body: ['suitcase.001'],
  trim: ['zipper'],
  wheels: ['Grey.002'],
};

/**
 * @returns {Promise<import('three').Object3D>} the trolley model, with
 *   `model.userData.colorTargets: Record<string, Mesh[]>` populated for
 *   whichever COLOR_TARGET_MATERIALS entries were actually found on it.
 */
export async function loadTrolleyModel() {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(MODEL_URL);

  const model = gltf.scene;
  model.name = 'trolley';

  const colorTargets = tagColorTargets(model);
  model.userData.colorTargets = colorTargets;

  logModelStructure(model, colorTargets);

  return model;
}

/**
 * Walk the loaded scene and, for every mesh whose material name is one
 * we care about, clone that material (so recoloring it can't bleed into
 * an unrelated mesh sharing the same material index — e.g. "Black.001"
 * is shared by two meshes we're deliberately *not* wiring up) and group
 * the meshes by their semantic target id.
 */
function tagColorTargets(model) {
  const materialNameToTarget = {};
  for (const [target, materialNames] of Object.entries(COLOR_TARGET_MATERIALS)) {
    materialNames.forEach((name) => {
      materialNameToTarget[name] = target;
    });
  }

  const colorTargets = {};
  model.traverse((node) => {
    if (!node.isMesh) return;
    const target = materialNameToTarget[node.material?.name];
    if (!target) return;

    node.material = node.material.clone();
    (colorTargets[target] ||= []).push(node);
  });

  return colorTargets;
}

/** Dev-time visibility into what the loaded GLB actually contains. */
function logModelStructure(model, colorTargets) {
  console.groupCollapsed(`[modelLoader] "${model.name}" — mesh/material inventory`);
  model.traverse((node) => {
    if (node.isMesh) {
      console.log(`mesh "${node.name}"  ·  material "${node.material?.name || '(unnamed)'}"`);
    }
  });
  console.log(
    'color targets resolved:',
    Object.fromEntries(
      Object.entries(colorTargets).map(([target, meshes]) => [target, meshes.map((m) => m.name)])
    )
  );
  const missing = Object.keys(COLOR_TARGET_MATERIALS).filter((target) => !colorTargets[target]?.length);
  if (missing.length) {
    console.warn('[modelLoader] no mesh found for expected color target(s):', missing);
  }
  console.groupEnd();
}
