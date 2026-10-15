import { checkpointKeys, checkpointRecord } from './checkpoint-validation.js';
import { int32 } from './script-integer.js';
export const WEB_BATTLE_BRANCH_EXECUTION = 'web-source-battle-branch-execution-v1' as const;
export type WebBattleBranchExecution = typeof WEB_BATTLE_BRANCH_EXECUTION;
export function validateBattleBranchExecutionPolicy(raw:unknown):void {
  if(raw!==undefined&&raw!==WEB_BATTLE_BRANCH_EXECUTION)throw new Error('Unknown Web battle branch execution policy');
}
export type BattleSourceInstruction = {mnemonic:string;type:number;operands:{iValues:number[];rValues:number[];sValues:string[]};label?:string;comment?:string};
/** Known instructions with unsupported operands/dependencies remain hard. New
 * opcode implementations must extend this shared set before their bad forms
 * can be considered unimplemented instructions by the branch policy. */
const KNOWN_BATTLE_EVENT_MNEMONICS = new Set(['PlayBattleEffect','SyncBattleEffect','Msg','MsgClose','Nop','Blank','Exit','Return','GetEnemyMode',
 'WaitToBattleStart','ExecBattleAI','BattleSyncAction','SyncBattleAI','Call','Jump','BattleAction','BattleForceExit','BattleForceExitOnSave','BattleEndEnabled','BattlePause',
 'BattleInteractive','BattleSleepEnemy','BattleAddEnemy','BattleAddFellow','SysCall','Wait','SetFlag','ResetFlag','FlipFlag','Calc','Branch']);
const knownCalls=new Set(['プレイヤーの状況で戦闘終了','HideBattleUI','ShowBattleUI','StopAutoBattle','RemoveAllAct','ガウバトルモード設定','血塗られた盾','シャドウ離脱抽選',
 'LB:敵パーティラウンド2','LB:敵パーティラウンド3','LB:敵パーティラウンド4']);
export function parseBattleSourceInstruction(raw:unknown):BattleSourceInstruction {
 checkpointRecord(raw);const v=raw as Record<string,unknown>;
 checkpointKeys(v,'mnemonic,type,operands'+(Object.hasOwn(v,'label')?',label':'')+(Object.hasOwn(v,'comment')?',comment':''));
 if(typeof v.mnemonic!=='string'||!v.mnemonic)throw new Error('Invalid original battle instruction name');
 int32(v.type);checkpointKeys(v.operands,'iValues,rValues,sValues');const values=v.operands as Record<string,unknown>;
 const parse=(data:unknown,check:(v:unknown)=>boolean)=>{if(!Array.isArray(data)||Array.from(data).some(x=>!check(x)))throw new Error('Invalid original battle instruction operands');return Array.from(data);};
 const iValues=parse(values.iValues,v=>{try{int32(v);return true;}catch{return false;}})as number[],
  rValues=parse(values.rValues,v=>typeof v==='number'&&Number.isFinite(v))as number[],sValues=parse(values.sValues,v=>typeof v==='string')as string[];
 if(!([iValues.length,rValues.length,sValues.length].every(n=>n===8)||v.mnemonic==='Nop'&&[iValues.length,rValues.length,sValues.length].every(n=>n===0)))
  throw new Error('Invalid complete original battle operand dimensions');
 for(const key of ['label','comment'])if(Object.hasOwn(v,key)&&typeof v[key]!=='string')throw new Error('Invalid original battle instruction annotation');
 return structuredClone(raw)as BattleSourceInstruction;
}
export type BattleDeferredInstructionCategory='unimplemented-instruction'|'unimplemented-selector';
/** Classification uses complete original encoding and implemented semantics.
 * Diagnostic wording is deliberately irrelevant. A valid opaque SysCall does
 * not grant its lifecycle: execution still throws its original blocked reason. */
export function classifyDeferredBattleInstruction(raw:BattleSourceInstruction):BattleDeferredInstructionCategory|null {
 const {iValues:i,rValues:r,sValues:s}=raw.operands;
 if(raw.type!==1||i.length!==8||r.length!==8||s.length!==8)return null;
 if(!KNOWN_BATTLE_EVENT_MNEMONICS.has(raw.mnemonic))return 'unimplemented-instruction';
 if(raw.mnemonic==='SysCall'&&i.every(v=>v===0)&&r.every(v=>v===0)&&s[0]!==''&&s.slice(1).every(v=>v==='')&&!knownCalls.has(s[0]!))return 'unimplemented-selector';
 return null;
}
