import assert from 'node:assert/strict';

/** Unavailable error metadata is explicit data, not an undefined value that
 * makes the final canonical report fail after a long execution. */
export function observerErrorDetails(error){
 const value=error&&typeof error==='object'?error:{};
 return {message:value.message??String(error),stack:value.stack??null,pc:value.pc??null,source:value.source??null,
  reason:value.reason??null,attemptedVisited:value.attemptedVisited??null,rawInstruction:value.rawInstruction??null};
}

/** A committed return retires game.battle. Its real terminal journal was
 * captured immediately before return; failed/incomplete runs use their last
 * live observation instead. Neither path executes an effect or settlement. */
export function observedBattleEffects(run){
 const journal=(run.battleAtReturn??run.stateAfter)?.effectRequests??[];
 assert(Array.isArray(journal),'Invalid observed battle effect journal');return journal;
}

/** An unaccepted recovery artifact. Unsupported JS values stay visibly tagged;
 * canonical validation of the formal report is still required and may fail. */
export function observationDraftJSON(report){
 return JSON.stringify({kind:'unaccepted-battle-observer-draft-v1',status:'unaccepted',report},(_key,value)=>
  value===undefined?{kind:'unavailable-javascript-value-v1',type:'undefined'}:
  typeof value==='number'&&!Number.isFinite(value)?{kind:'unavailable-javascript-value-v1',type:'non-finite-number',value:String(value)}:value)+'\n';
}
