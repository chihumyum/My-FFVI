import { checkpointKeys, checkpointInteger, checkpointRecord } from "./checkpoint-validation.js";
export const WEB_SCRIPTED_BATTLE_ACTIONS = "web-source-scripted-battle-actions-v1" as const;
export type WebScriptedBattleActions = typeof WEB_SCRIPTED_BATTLE_ACTIONS;
/** Source IDs are not current array positions or Web instance IDs. */
export type ScriptedBattleAction = {
  kind: "script-action";
  sourceActorKind: 1 | 2;
  sourceTargetKind: 0 | 1 | 2;
  actor: { side: "player" | "enemy"; id: number };
  target: { side: "player" | "enemy"; id: number };
  abilityId: number;
  asynchronous: boolean;
};
export function validateScriptedBattleActionPolicy(raw: unknown): void {
  if (raw !== undefined && raw !== WEB_SCRIPTED_BATTLE_ACTIONS) throw new Error("Unknown scripted battle action policy");
}
export function parseScriptedBattleAction(raw: unknown): ScriptedBattleAction {
  checkpointKeys(raw,"kind,sourceActorKind,sourceTargetKind,actor,target,abilityId,asynchronous");
  const v=raw as ScriptedBattleAction;
  if(v.kind!=="script-action" || ![1,2].includes(v.sourceActorKind) || ![0,1,2].includes(v.sourceTargetKind) ||
      typeof v.asynchronous!=="boolean")throw new Error("Invalid source battle action selectors");
  for(const ref of [v.actor,v.target]){
    checkpointRecord(ref);checkpointKeys(ref,"side,id");checkpointInteger(ref.id,-2147483648,2147483647);
    if(ref.side!=="player"&&ref.side!=="enemy")throw new Error("Unknown scripted battle side");
  }
  if(v.actor.side!==(v.sourceActorKind===1?"player":"enemy") || v.target.side!==(v.sourceActorKind===1?(v.sourceTargetKind===2?"enemy":"player"):(v.sourceTargetKind===1?"player":"enemy")) ||
      v.actor.id<1 || v.actor.side==="enemy"&&v.actor.id>9 || v.target.side==="enemy"&&v.target.id>9)
    throw new Error("Source battle action identity/category mismatch");
  checkpointInteger(v.abilityId,1,2147483647);
  return structuredClone(v);
}
