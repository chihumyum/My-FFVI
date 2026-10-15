import {parseScriptedBattleAction,type ScriptedBattleAction} from "../core/scripted-battle-action.js";
/** External.Battle.Action b41780 -> IBattleAccessor slots 11..14 ->
 * EventCommand.CreateActData(Event=3, null command). Unknown operands survive
 * as a blocked compiler result; source negative/no-calc casters are not admitted. */
export function compileScriptedBattleAction(raw:{
 type:number; mnemonic:string; operands:{iValues:number[];rValues:number[];sValues:string[]}
}):ScriptedBattleAction {
 const {iValues:i,rValues:r,sValues:s}=raw.operands;
 if(raw.type!==1||raw.mnemonic!=="BattleAction"||i.length!==8||r.length!==8||s.length!==8||
   i.some(v=>!Number.isInteger(v)||v<-2147483648||v>2147483647)||r.some(v=>v!==0)||s.some(v=>v!=="")||
   i[6]!==0||i[7]!==0||![0,1].includes(i[5]!)||![1,2].includes(i[0]!)||![0,1,2].includes(i[3]!))
   throw new Error("Unsupported BattleAction source operands");
 return parseScriptedBattleAction({kind:"script-action",sourceActorKind:i[0],sourceTargetKind:i[3],
   actor:{side:i[0]===1?"player":"enemy",id:i[1]},target:{side:i[0]===1?(i[3]===2?"enemy":"player"):(i[3]===1?"player":"enemy"),id:i[4]},
   abilityId:i[2],asynchronous:i[5]!==0});
}
