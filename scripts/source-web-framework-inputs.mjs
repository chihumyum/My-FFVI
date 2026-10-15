// Explicit playable Web inputs, shared by the public producer and whole-source
// candidate tools. Strict compilers receive none of these unless a caller opts in.
// Return new records: one caller's override cannot alter another build's policy.
export function webSourceFrameworkInputs() {
  return {
    mapAnimatedEntities: 'web-field-animated-map-entities-v1',
    npcFlat: { kind: 'web-source-npc-flat-input-v1', reason: 'Explicit playable Web framework: retain original NPC layer/collision/selectors; use source all-layer interaction eligibility and flat display instead of Birdview perspective.' },
    npcAreas: { kind: 'web-source-npc-area-input-v1',
      reason: 'Explicit playable Web framework: use the existing declared Area NPC lifecycle over every original source map; all original blockers and strict source data retained.' },
    periodicMaps: { kind: 'web-source-periodic-presentation-input-v1',
      reason: 'Explicit playable Web framework: fixed flat presentation for the complete source periodic-map family; strict diagnostics retained.' },
    logicalFieldEffects: { kind: 'web-logical-field-effects-input-v1', input: 'build/field-effect-media',
      reason: 'Explicit playable Web framework: retain proven all-loop board logic while deferring particle/material/minimap display.' },
  };
}
