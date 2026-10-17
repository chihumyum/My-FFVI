import {gauSessionFixture} from './battle-gau-instances.js';
import type {BattleEventOp} from '../../src/core/battle-event.js';
import {WEB_BATTLE_CHILD_ADMISSION,parseBattleChildAdmission,type BattleChildPartyEntry} from '../../src/core/battle-child-admission.js';
const source=(table:string,id:number)=>({file:'controlled.bundle',assetPath:'Assets/Master/'+table,serializedFile:'controlled',objectId:'90071992547409939',rowId:String(id)});
export function childAdmissionSessionFixture(ops?:BattleEventOp[],blocked=false){
 const f=gauSessionFixture(ops),e=f.catalog.encounters[1000]!,entries:Record<string,BattleChildPartyEntry>={};
 for(const id of [501,502]){const party=e.participants!.enemyParties![id]!;entries[id]={partyId:id,source:source('monster_party.csv',id),flagGroupId:77,flagRows:[{flagId:19,source:source('battle_flag_group.csv',81)},{flagId:14,source:source('battle_flag_group.csv',82)}],notEscape:3,members:structuredClone(party.members),slots:structuredClone(party.slots),gates:blocked?[{code:'controlled-child-behavior',reason:'explicit unknown child condition lifecycle',dependency:{table:'condition.csv',id:700,field:null}}]:[]};
  if(blocked)delete e.participants!.enemyParties![id];}
 e.childPartyAdmission=parseBattleChildAdmission({kind:'source-child-party-admission-v1',policy:WEB_BATTLE_CHILD_ADMISSION,rootPartyId:1000,context:'retain-parent-entry',entries});
 return {...f,runtime:{...f.runtime,battleChildPartyAdmission:WEB_BATTLE_CHILD_ADMISSION}};
}
