import {checkpointKeys,checkpointRecord} from './checkpoint-validation.js';
import {canonical} from './canonical.js';
import {isEntryOnlySourceBattleFlag,type BattleFlagRowSource} from './battle-flags.js';
import type {BattleParticipantContent,BattleParticipantEnemyParty,BattleParticipantSlot} from './battle-participants.js';
export const WEB_BATTLE_CHILD_ADMISSION='web-source-child-party-entry-v1' as const;
export type WebBattleChildAdmission=typeof WEB_BATTLE_CHILD_ADMISSION;
export function parseWebBattleChildAdmission(raw:unknown):WebBattleChildAdmission{
 if(raw!==WEB_BATTLE_CHILD_ADMISSION)throw new Error('Unknown Web source child-party entry policy');return raw;
}
export type BattleChildGate={code:string;reason:string;dependency:{table:string;id:number;field:string|null}|null};
export type BattleChildPartyEntry={partyId:number;source:BattleFlagRowSource;flagGroupId:number;flagRows:{flagId:number;source:BattleFlagRowSource}[];
 notEscape:number;members:{sourceId:number;uniqueId:number}[];slots:Record<string,BattleParticipantSlot>;gates:BattleChildGate[]};
export type BattleChildAdmission={kind:'source-child-party-admission-v1';policy:WebBattleChildAdmission;rootPartyId:number;
 context:'retain-parent-entry';entries:Record<string,BattleChildPartyEntry>};
function integer(n:unknown,min=0):asserts n is number{if(typeof n!=='number'||!Number.isInteger(n)||n<min||n>2147483647)throw new Error('Invalid child-party identity/value');}
function text(s:unknown):asserts s is string{if(typeof s!=='string'||!s||s.trim()!==s)throw new Error('Invalid child-party source text');}
function source(raw:unknown,table:string):BattleFlagRowSource{
 checkpointKeys(raw,'file,assetPath,serializedFile,objectId,rowId');const s=raw as BattleFlagRowSource;
 for(const v of Object.values(s))text(v);
 if(!(s.assetPath===table||s.assetPath.endsWith('/'+table))||!(/^-?(?:0|[1-9]\d*)$/).test(s.objectId)||BigInt(s.objectId)<-(1n<<63n)||BigInt(s.objectId)>=(1n<<63n)||!(/^[1-9]\d*$/).test(s.rowId)||BigInt(s.rowId)>2147483647n)throw new Error('Invalid child-party physical row source');
 return {...s};
}
export function parseBattleChildGate(raw:unknown):BattleChildGate{
 checkpointKeys(raw,'code,reason,dependency');const g=raw as BattleChildGate;text(g.code);text(g.reason);
 if(g.dependency!==null){checkpointKeys(g.dependency,'table,id,field');text(g.dependency.table);integer(g.dependency.id,1);if(g.dependency.field!==null)text(g.dependency.field);}
 return structuredClone(g);
}
export function parseBattleChildAdmission(raw:unknown):BattleChildAdmission{
 checkpointKeys(raw,'kind,policy,rootPartyId,context,entries');const a=raw as BattleChildAdmission;parseWebBattleChildAdmission(a.policy);integer(a.rootPartyId,1);
 if(a.kind!=='source-child-party-admission-v1'||a.context!=='retain-parent-entry')throw new Error('Unknown child-party applicability context');
 checkpointRecord(a.entries);const entries:Record<string,BattleChildPartyEntry>={};
 for(const [key,e]of Object.entries(a.entries)){
  checkpointKeys(e,'partyId,source,flagGroupId,flagRows,notEscape,members,slots,gates');integer(e.partyId,1);if(String(e.partyId)!==key)throw new Error('Changed child-party entry key');
  const origin=source(e.source,'monster_party.csv');if(origin.rowId!==key)throw new Error('Changed child-party row identity');integer(e.flagGroupId);integer(e.notEscape);
  if(!Array.isArray(e.flagRows)||(e.flagGroupId===0)!==(e.flagRows.length===0))throw new Error('Missing child-party flag binding');
  const seenFlags=new Set<string>(),flagRows=e.flagRows.map(f=>{checkpointKeys(f,'flagId,source');integer(f.flagId,1);const origin=source(f.source,'battle_flag_group.csv');if(seenFlags.has(origin.rowId))throw new Error('Duplicate child-party flag source');seenFlags.add(origin.rowId);return {flagId:f.flagId,source:origin};});
  checkpointRecord(e.slots);const slots:Record<string,BattleParticipantSlot>={};
  for(const [k,p]of Object.entries(e.slots)){integer(Number(k),1);if(String(Number(k))!==k||Number(k)>9)throw new Error('Invalid child-party slot');checkpointKeys(p,'x,y,group');if(!Number.isInteger(p.x)||p.x< -2147483648||p.x>2147483647||!Number.isInteger(p.y)||p.y< -2147483648||p.y>2147483647||![1,2].includes(p.group))throw new Error('Invalid child-party placement');slots[k]={...p};}
  if(Object.keys(slots).length!==9||!Array.isArray(e.members)||!e.members.length||e.members.length>9)throw new Error('Incomplete child-party nine-slot/member proof');
  const seenMembers=new Set<number>(),members=e.members.map(m=>{checkpointKeys(m,'sourceId,uniqueId');integer(m.sourceId,1);integer(m.uniqueId,1);if(m.uniqueId>9||seenMembers.has(m.uniqueId)||!slots[m.uniqueId])throw new Error('Changed child-party member layout');seenMembers.add(m.uniqueId);return {...m};});
  if(!Array.isArray(e.gates))throw new Error('Missing explicit child-party gates');const gates=e.gates.map(parseBattleChildGate);
  if(!gates.length&&(!flagRows.every(f=>isEntryOnlySourceBattleFlag(f.flagId))||![0,2,3].includes(e.notEscape)))throw new Error('Unimplemented child metadata cannot be ready');
  entries[key]={partyId:e.partyId,source:origin,flagGroupId:e.flagGroupId,flagRows,notEscape:e.notEscape,members,slots,gates};
 }
 return {kind:a.kind,policy:a.policy,rootPartyId:a.rootPartyId,context:a.context,entries};
}
export class BattleChildAdmissionError extends Error{
 readonly phase='before-child-factory' as const;
 constructor(readonly partyId:number,readonly source:BattleFlagRowSource,readonly gates:readonly BattleChildGate[]){
  super('Source child party '+partyId+' cannot enter: '+gates.map(g=>g.code+': '+g.reason).join('; '));this.name='BattleChildAdmissionError';
 }
}
/** Pure gate and identity checks. Never prepares media, retires an instance,
 * consumes RNG/resources or mutates a persistent owner. */
export function prepareBattleChildParty(plan:BattleChildAdmission|undefined,partyId:number,participants:BattleParticipantContent|null):BattleParticipantEnemyParty{
 const entry=plan?.entries[String(partyId)];
 if(plan&&!entry)throw new Error('Missing complete source child-party admission entry');
 if(entry?.gates.length)throw new BattleChildAdmissionError(partyId,structuredClone(entry.source),structuredClone(entry.gates));
 const party=participants?.enemyParties?.[partyId];if(!party)throw new Error('Missing admitted replacement enemy party');
 if(entry&&(canonical(party.members)!==canonical(entry.members)||canonical(party.slots)!==canonical(entry.slots)))throw new Error('Changed prepared child-party source layout');
 return party;
}
