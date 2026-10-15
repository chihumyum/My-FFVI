// These are the two explicit policies already installed by apps/game/app.js.
// A positive Web replay opts in at its own runtime construction; strict/native
// unknown lanes keep their existing missing providers. No state or fallback
// result is supplied, and GameSession remains the only terminal producer.
export function sourceWebReplayRuntimePorts() {
  return Object.freeze({
    sourceBossEntry: 'web-source-boss-entry-v1',
    sourceBattleResult: 'web-committed-battle-result-v1',
  });
}
