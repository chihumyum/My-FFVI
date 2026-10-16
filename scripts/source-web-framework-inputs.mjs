// Explicit playable Web inputs, shared by the public producer and whole-source
// candidate tools. Strict compilers receive none of these unless a caller opts in.
// Return new records: one caller's override cannot alter another build's policy.
export function webSourceFrameworkInputs() {
  return {
    vehicleLifecycle:'web-source-vehicle-lifecycle-v1',
    worldAutoTasks: 'web-flat-world-auto-tasks-v1',
    worldAutoMove: 'web-flat-world-auto-move-v1',
    birdViewActors: 'web-flat-bird-view-actors-v1',
    mobColorFilter: 'web-flat-mob-color-filter-v1',
    screenPresentation:'web-field-screen-presentation-2d-v1',
    skyboxPresentation:'web-flat-skybox-panorama-v1',
    fieldEffectTransforms:'web-source-logical-board-transforms-v1',
    mapAnimatedEntities: 'web-field-animated-map-entities-v1',
    fieldEffectFlat: {kind:'web-source-field-effect-flat-input-v1',reason:'Explicit playable Web display deferral for source-bound Birdview boards with complete all-loop side-effect-free prefab proofs; retain original definitions, layers, logical playback and unresolved source gates.'},
    npcFlat: { kind: 'web-source-npc-flat-input-v1', reason: 'Explicit playable Web framework: retain original NPC layer/collision/selectors; use source all-layer interaction eligibility and flat display instead of Birdview perspective.' },
    npcAreas: { kind: 'web-source-npc-area-input-v1',
      reason: 'Explicit playable Web framework: use the existing declared Area NPC lifecycle over every original source map; all original blockers and strict source data retained.' },
    periodicMaps: { kind: 'web-source-periodic-presentation-input-v1',
      reason: 'Explicit playable Web framework: fixed flat presentation for the complete source periodic-map family; strict diagnostics retained.' },
    ordinaryFields: {kind:'web-source-ordinary-field-presentation-input-v1',
      reason:'Explicit playable Web framework: flat display for the complete nonperiodic ordinary-map family using proven backdrop/body_threshold shapes; retain original layers, source diagnostics, collision, scripts and every unsupported water/palette/group shape.'},
    logicalFieldEffects: { kind: 'web-logical-field-effects-input-v1', input: 'build/field-effect-media',
      reason: 'Explicit playable Web framework: retain proven all-loop board logic while deferring particle/material/minimap display.' },
  };
}
