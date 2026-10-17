import { compileBattleEvent } from '../../src/compiler/battle-event.js';
import { WEB_BATTLE_BRANCH_EXECUTION } from '../../src/core/battle-branch-execution.js';
import { effectReader } from './battle-event-effect.js';
import { battleMessageDictionariesInput } from './battle-message-dictionaries.js';
export function branchRaw(mnemonic:string,ints:number[]=[],reals:number[]=[],strings:string[]=[]){return {type:1,mnemonic,operands:{iValues:Array.from({length:8},(_,i)=>ints[i]??0),rValues:Array.from({length:8},(_,i)=>reals[i]??0),sValues:Array.from({length:8},(_,i)=>strings[i]??'')}};}
export function branchSourceData(ops:ReturnType<typeof branchRaw>[]){return {Name:'authored branch caller',Title:{main:'',sub:''},Mnemonics:structuredClone(ops),Segments:[{Label:'Main',EntryPoint:0,Count:ops.length}],ScriptLocal:['AI','After'],ScriptLocalValue:[0,0],SystemFlag:{KeepBadStatusVisual:0,KeepPlayerPuppet:0,RidingVehicle:0,SkipInitialize:0},Animations:[]};}
export function branchInputs(){const messages=battleMessageDictionariesInput(),source={sourceSetHash:messages.binding!.parentSourceSetHash,battleSourceSetHash:'b'.repeat(64),file:'authored-branch.bundle',sha256:'a'.repeat(64),assetPath:'authored/battle-branch',serializedFile:'authored-cab',objectId:'-9223372036854775808'};return {messages,source};}
export function branchProgram(ops:ReturnType<typeof branchRaw>[]){const f=branchInputs();return compileBattleEvent(branchSourceData(ops),f.source,f.messages,effectReader,WEB_BATTLE_BRANCH_EXECUTION);}
export const unknownBranchRaw=()=>branchRaw('AuthoredUnimplementedInstruction',[],[],['Unimplemented, preserved verbatim']);
