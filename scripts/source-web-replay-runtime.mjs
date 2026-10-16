// These explicit policies are installed by apps/game/app.js.
// A positive Web replay opts in at its own runtime construction; strict/native
// unknown lanes keep their existing missing providers. No state or fallback
// result is supplied, and GameSession remains the only terminal producer.
export function sourceWebReplayRuntimePorts() {
  return Object.freeze({
    vehicleLifecycle:'web-source-vehicle-lifecycle-v1',
    battleChildPartyAdmission:'web-source-child-party-entry-v1',
    battleEventConditions: "web-source-battle-condition-lists-v1",
    battleBranchExecution: 'web-source-battle-branch-execution-v1',
    worldAutoTasks: 'web-flat-world-auto-tasks-v1',
    worldAutoMove: 'web-flat-world-auto-move-v1',
    birdViewActors: 'web-flat-bird-view-actors-v1',
    mobColorFilter: 'web-flat-mob-color-filter-v1',
    screenPresentation:'web-field-screen-presentation-2d-v1',
    fieldEffectTransforms:'web-source-logical-board-transforms-v1',
    sourceSnapshot:'immutable-owned-field-source-v1',
    skyboxPresentation:'web-flat-skybox-panorama-v1',
    viewChange: 'web-flat-field-view-change-v2',
    battleEventEffects: 'web-source-battle-effects-pulse-v1',
    battleGlobalFade: 'web-source-battle-global-fade-v1',
    sourcePartySelection: 'web-source-party-selection-atomic-v1',
    sourceCharacterNaming:'web-source-character-naming-input-v1',
    rtsPartySwitch:'web-source-rts-party-switch-v1',
    battleEventMessages: 'web-source-battle-event-messages-v1',
    battleEventControls: 'web-source-battle-event-controls-v1',
    sourceBossEntry: 'web-source-boss-entry-v1',
    sourceBattleResult: 'web-committed-battle-result-v1',
    scriptedBattleActions: 'web-source-scripted-battle-actions-v1',
    puppetRoutes: 'web-source-puppet-route-grid-v1',
  });
}

// A content/runtime transform policy alone cannot authorize the separate
// display host. Use the same explicit capability as the app while preserving
// the caller's exact compiled factory and per-session host lifetime.
export function sourceWebReplayFieldEffectsHost(createHost) {
  if (typeof createHost !== 'function') throw new Error('Missing compiled logical field effects factory');
  return createHost({boardTransforms:sourceWebReplayRuntimePorts().fieldEffectTransforms});
}
