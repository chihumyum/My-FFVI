import {compileEnemyParameters} from './parameters.js';
import {compileEnemyPhysical} from './physical-parameters.js';
import {compileElementResistances} from './elements.js';
import type {BattleEncounterRuntimeInput} from './battle-encounter-runtime.js';
import {canonical} from '../core/canonical.js';
import {isEntryOnlySourceBattleFlag} from '../core/battle-flags.js';
import {parseBattleChildAdmission,WEB_BATTLE_CHILD_ADMISSION,type BattleChildAdmission,type BattleChildGate,type BattleChildPartyEntry} from '../core/battle-child-admission.js';
import {WEB_MANUAL_BATTLE_CONTROLS} from '../core/battle-controls.js';
import type {BattleEncounterDiagnostic} from '../core/battle-content.js';
import type {BattleParticipantSlot} from '../core/battle-participants.js';
import {compileBattleAI} from './battle-ai.js';
import type {SourceBattleEncounter} from './battle-encounters.js';
import type {BattleRow} from './battle.js';
import {tableInteger as int} from './table.js';
type Reader={row(table:string,id:string|number):BattleRow;unique(table:string,key:string,value:string):BattleRow;group(table:string,key:string,value:string|number):BattleRow[]};
const equal=(a:unknown,b:unknown,why:string)=>{if(canonical(a)!==canonical(b))throw new Error('Changed child-party source '+why);};
function row(reader:Reader,table:string,id:number):BattleRow{
 const r=reader.row(table,id);if(!Number.isInteger(id)||id<1||int(r.values.id)!==id||r.source.rowId!==String(id)||!(r.source.assetPath===table||r.source.assetPath.endsWith('/'+table)))throw new Error('Missing exact child-party table identity: '+table+':'+id);return r;
}
/** This runs before any semantic diagnostic can become an execution gate.
 * It binds complete original slots, raw metadata, masters and physical AI.
 * A semantic failure never substitutes an empty source provider. */
export function sourceChildPartyEntry(reader:Reader,child:SourceBattleEncounter,context:Pick<BattleEncounterRuntimeInput,'parameters'|'physical'|'sprites'>):BattleChildPartyEntry{
 const party=row(reader,'monster_party.csv',child.partyId),m=child.metadata;equal(party.source,child.source,'party row');
 const fields={battleFlagGroupId:'battle_flag_group_id',backgroundId:'battle_background_asset_id',bgmId:'battle_bgm_asset_id',appearanceProduction:'appearance_production',notEscape:'not_escape',getAp:'get_ap',getValue:'get_value',scriptId:'script_name'} as const;
 for(const[k,v]of Object.entries(fields))equal(m[k as keyof typeof fields],int(party.values[v]),v);
 equal(child.patterns,Array.from({length:6},(_,i)=>int(party.values['battle_pattern'+(i+1)])),'formation');
 const flags=m.battleFlagGroupId===0?[]:reader.group('battle_flag_group.csv','group_id',m.battleFlagGroupId);equal(flags,m.battleFlags,'flag rows');
 for(const f of flags){if(int(f.values.group_id)!==m.battleFlagGroupId||f.source.rowId!==String(int(f.values.id))||int(f.values.battle_flag_id)<1)throw new Error('Invalid complete child flag group');}
 const members:{sourceId:number;uniqueId:number}[]=[],slots:Record<string,BattleParticipantSlot>={};
 for(let slot=1;slot<=9;slot++){
  const expected={x:int(party.values['monster'+slot+'_x_position']),y:int(party.values['monster'+slot+'_y_position']),group:int(party.values['monster'+slot+'_group'])};if(![1,2].includes(expected.group))throw new Error('Unknown source child slot group');slots[slot]=expected;
  const id=int(party.values['monster'+slot]);if(!id)continue;
  const member=child.enemies.find(e=>e.slot===slot);if(!member||member.monsterId!==id)throw new Error('Missing exact child source member');equal({x:member.x,y:member.y,group:member.group},expected,'member placement');
  const monster=row(reader,'monster.csv',id);for(const[k,v]of Object.entries(monster.values))if(k!=='mes_id_name')int(v);
  if(typeof monster.values.mes_id_name!=='string'||!monster.values.mes_id_name)throw new Error('Missing child monster name reference identity');
  for(const key of ['lv','exp','gill','attack_attribute','attack_plus','attack_plus_grop','resistance_attribute','resistance_condition','initial_condition'])int(monster.values[key]);
  const parameters=compileEnemyParameters(reader,id,context.parameters.temporary,context.parameters.limits).confirmed;compileEnemyPhysical(reader,id,context.physical.temporary,context.physical.limits);
  if(int(monster.values.lv)<1||int(monster.values.lv)>0x7fffffff||parameters.hp<=0||int(monster.values.exp)<0||int(monster.values.gill)<0)throw new Error('Invalid initial enemy level, life or rewards');
  const resistanceGroup=int(monster.values.resistance_attribute);if(resistanceGroup&&reader.group('attribute_group.csv','group_id',resistanceGroup).length===0)throw new Error('Missing child element resistance group');
  compileElementResistances(reader,resistanceGroup);
  const sprite=context.sprites[member.sprite];if(!sprite||typeof sprite.file!=='string'||!sprite.file||!Number.isInteger(sprite.width)||sprite.width<=0||!Number.isInteger(sprite.height)||sprite.height<=0)throw new Error('Missing or invalid child sprite geometry');
  const asset=row(reader,'monster_asset.csv',int(monster.values.monster_asset_id)),aiRow=row(reader,'monster_ai_script.csv',int(monster.values.script_id));
  if(typeof asset.values.group_name!=='string'||!asset.values.group_name||typeof asset.values.asset_name!=='string'||!asset.values.asset_name||typeof aiRow.values.script_name!=='string'||!aiRow.values.script_name)throw new Error('Missing actual child asset/AI binding');
  if(typeof member.sprite!=='string'||!member.sprite.toLowerCase().endsWith('/'+(asset.values.group_name+'_'+asset.values.asset_name+'.png').toLowerCase()))throw new Error('Changed exact child monster sprite/asset binding');
  const source=member.ai.source;if(!source||!source.assetPath.endsWith('/'+aiRow.values.script_name+'.json')||!source.file||!source.serializedFile||!(/^[a-f0-9]{64}$/).test(source.sha256)||!(/^[a-f0-9]{64}$/).test(source.sourceSetHash)||!(/^[a-f0-9]{64}$/).test(source.battleSourceSetHash)||!(/^-?(?:0|[1-9]\d*)$/).test(source.objectId)||BigInt(source.objectId)<-(1n<<63n)||BigInt(source.objectId)>=(1n<<63n))throw new Error('Missing exact child physical AI source');
  compileBattleAI(member.ai.data,source);members.push({sourceId:id,uniqueId:slot});
 }
 if(child.enemies.length!==members.length)throw new Error('Changed child member count');
 return {partyId:child.partyId,source:structuredClone(party.source),flagGroupId:m.battleFlagGroupId,flagRows:flags.map(f=>({flagId:int(f.values.battle_flag_id),source:structuredClone(f.source)})),notEscape:m.notEscape,members,slots:structuredClone(slots),gates:[]};
}
export function childMetadataGates(entry:BattleChildPartyEntry,manualControls:unknown,sourceFlagContext:unknown):BattleChildGate[]{
 const gates:BattleChildGate[]=[];
 if(entry.flagRows.some(f=>f.flagId===14)&&sourceFlagContext!=="story")gates.push({code:"enemy-party-flags",reason:"Child source flag14 requires the declared ordinary story entry context",dependency:{table:"battle_flag_group.csv",id:entry.flagGroupId,field:null}});
 if(!entry.flagRows.every(f=>isEntryOnlySourceBattleFlag(f.flagId)))gates.push({code:'enemy-party-flags',reason:'Child battle flags need a reviewed applicability provider',dependency:{table:'battle_flag_group.csv',id:entry.flagGroupId,field:null}});
 else if(entry.flagRows.some(f=>f.flagId===19)&&manualControls!==WEB_MANUAL_BATTLE_CONTROLS)gates.push({code:'enemy-party-flags',reason:'Child entry-only source flag19 requires the explicit existing Web manual controller',dependency:{table:'battle_flag_group.csv',id:entry.flagGroupId,field:null}});
 if(![0,2,3].includes(entry.notEscape))gates.push({code:'enemy-party-escape',reason:'Unresolved child escape mode',dependency:{table:'monster_party.csv',id:entry.partyId,field:'not_escape'}});
 return gates;
}
export function childGate(d:Pick<BattleEncounterDiagnostic,'code'|'reason'|'dependency'>):BattleChildGate{
 return {code:d.code,reason:d.reason,dependency:d.dependency?{table:d.dependency.table,id:d.dependency.id,field:d.dependency.field??null}:null};
}
export function childAdmissionPlan(rootPartyId:number,entries:Record<string,BattleChildPartyEntry>):BattleChildAdmission{
 return parseBattleChildAdmission({kind:'source-child-party-admission-v1',policy:WEB_BATTLE_CHILD_ADMISSION,rootPartyId,context:'retain-parent-entry',entries});
}
