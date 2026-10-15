// These explicit policies are installed by apps/game/app.js.
// A positive Web replay opts in at its own runtime construction; strict/native
// unknown lanes keep their existing missing providers. No state or fallback
// result is supplied, and GameSession remains the only terminal producer.
export function sourceWebReplayRuntimePorts() {
  return Object.freeze({
    battleBranchExecution: 'web-source-battle-branch-execution-v1',
    viewChange: 'web-flat-field-view-change-v2',
    battleEventEffects: 'web-source-battle-effects-pulse-v1',
    sourcePartySelection: 'web-source-party-selection-atomic-v1',
    battleEventMessages: 'web-source-battle-event-messages-v1',
    battleEventControls: 'web-source-battle-event-controls-v1',
    sourceBossEntry: 'web-source-boss-entry-v1',
    sourceBattleResult: 'web-committed-battle-result-v1',
    scriptedBattleActions: 'web-source-scripted-battle-actions-v1',
    puppetRoutes: 'web-source-puppet-route-grid-v1',
  });
}
