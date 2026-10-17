import {encounterRuntimeFixture} from './battle-encounter-runtime.js';
import {compileSourceBattleParticipantClosure,type SourceBattleParticipantPolicy} from '../../src/compiler/source-battle-participant-closure.js';
import {compileBattleEncounterRuntime} from '../../src/compiler/battle-encounter-runtime.js';

export const dynamicSourcePolicy:SourceBattleParticipantPolicy={kind:'web-source-dynamic-participants-v1',slotLayout:'source-party-nine-slots',rewardScope:'all-entered'};
/** Controlled source tables, deliberately containing empty but positioned slots
 * and a reserve master absent from every initial descriptor. */
export function sourceParticipantFixture({child=false}:{child?:boolean}={}){
 const f=encounterRuntimeFixture(),ai=structuredClone(f.input.encounters[0]!.enemies[0]!.ai);
 for(const row of f.tables['monster.csv']!){row.monster_asset_id='1';row.script_id='1';}
 f.tables['monster.csv']!.push({...structuredClone(f.tables['monster.csv']![0]!),id:'9103',exp:'19',gill:'23'});
 f.tables['monster_asset.csv']=[{id:'1',group_name:'controlled',asset_name:'enemy'}];
 f.tables['monster_ai_script.csv']=[{id:'1',script_name:'ai'}];
 f.tables['ability.csv']=[{id:'13'}];
 f.tables['battle_background_asset.csv']=[{id:'1',asset_name:'controlled-background'}];
 const party=(id:number,master:number,script=0):Record<string,string>=>({id:String(id),battle_background_asset_id:'1',battle_bgm_asset_id:'0',
  appearance_production:'0',not_escape:'0',get_ap:'0',get_value:'0',script_name:String(script),battle_flag_group_id:'0',
  ...Object.fromEntries(Array.from({length:6},(_,i)=>['battle_pattern'+(i+1),i===0?'1':'0'])),
  ...Object.fromEntries(Array.from({length:9},(_,i)=>[['monster'+(i+1),i===4?String(master):'0'],['monster'+(i+1)+'_group','1'],
   ['monster'+(i+1)+'_x_position',i===4?'12':String(-20-i)],['monster'+(i+1)+'_y_position',i===4?'-8':String(30+i)]]).flat())});
 f.tables['monster_party.csv']=[party(9201,9101,8123),party(9202,9102),party(513,9103)];
 const raw=(mnemonic:string,i:number[]=[],s:string[]=[])=>({mnemonic,type:1,operands:{iValues:[...i,...Array(8-i.length).fill(0)],rValues:Array(8).fill(0),sValues:[...s,...Array(8-s.length).fill('')]}});
 const rows=[raw('BattleAddEnemy',[9103,2]),...(child?[raw('SysCall',[],['LB:敵パーティラウンド2'])]:[]),raw('Exit')];
 const root=f.input.encounters[0]!;root.metadata.scriptId=8123;
 root.script={source:{...f.aiIdentity,sourceSetHash:'a'.repeat(64),battleSourceSetHash:'b'.repeat(64),sha256:'c'.repeat(64),assetPath:'synthetic/participant-root.json'},data:{Name:'Controlled dynamic source',Title:{main:'Controlled',sub:'Redistributable'},
  ScriptLocal:[],ScriptLocalValue:[],SystemFlag:{KeepBadStatusVisual:0,KeepPlayerPuppet:0,RidingVehicle:0,SkipInitialize:0},Animations:[],
  Segments:[{Label:'Main',EntryPoint:0,Count:rows.length}],Mnemonics:rows}};
 const sources={json(name:string){if(name!=='ai')throw Error('Missing controlled AI '+name);return structuredClone(ai);},
  spritePath(suffix:string){if(suffix==='/controlled_enemy.png')return 'synthetic-enemy';if(suffix==='/controlled-background.png')return 'synthetic-background';throw Error('Missing controlled sprite '+suffix);}};
 const closure=()=>compileSourceBattleParticipantClosure(f.reader(),{policy:dynamicSourcePolicy,encounters:f.input.encounters,sources});
 const runtime=(c=closure())=>compileBattleEncounterRuntime(f.reader(),{...f.input,reserveEnemies:c.reserveEnemies,enemyParties:c.enemyParties,
  sourceDiagnostics:[...f.input.sourceDiagnostics,...c.diagnostics],development:{...f.input.development,participants:c.participants}});
 return {...f,sources,closure,runtime,entryScriptGroups:()=>[{id:8123,partyIds:[9201],source:structuredClone(root.script)}]};
}
