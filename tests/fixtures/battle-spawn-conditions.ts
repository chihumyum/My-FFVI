import {sourceParticipantFixture} from './source-battle-participants.js';
import {levitateFixture} from './condition-levitate.js';
import {checkpointFixture} from './checkpoint-game.js';
import {WEB_ENEMY_SPAWN_CONDITIONS} from '../../src/core/battle-spawn-conditions.js';
import type {Op} from '../../src/field/types.js';
import type {BattleCatalog} from '../../src/core/battle-content.js';
import {WEB_BATTLE_FORCED_SAVE} from '../../src/core/battle-forced-save.js';
export const spawnPolicy={kind:WEB_ENEMY_SPAWN_CONDITIONS};
/** Complete source-shaped group and master rows, with IDs distinct from types.
 * The same late master is first added and then used by a whole replacement party. */
export function enemySpawnFixture(){
 const source=sourceParticipantFixture({child:true}),conditions=levitateFixture(),group=conditions.group([196,110,121]),catalog=conditions.compile().catalog;
 for(const table of ['condition.csv','condition_group.csv','erase_condition_group.csv','attribute_group.csv','attribute.csv'])source.tables[table]=structuredClone(conditions.tables[table]!);
 source.tables['monster.csv']!.find(r=>r.id==='9103')!.initial_condition=String(group);
 source.input.conditions.rules.definitions.push(...catalog.rules.definitions);source.input.conditions.rules.eraseRules.push(...catalog.rules.eraseRules.map((r,i)=>({...r,id:10000+i})));source.input.conditions.behaviors.push(...catalog.behaviors);
 const script=source.input.encounters[0]!.script!.data as {Mnemonics:{mnemonic:string;type:number;operands:{iValues:number[];rValues:number[];sValues:string[]}}[];Segments:{Count:number}[]};
 const raw=(mnemonic:string,seconds=0)=>({mnemonic,type:1,operands:{iValues:Array(8).fill(0),rValues:[seconds,...Array(7).fill(0)],sValues:Array(8).fill('')}});
 const [add,wave]=script.Mnemonics;script.Mnemonics=[raw('Wait',.01),raw('ExecBattleAI'),add!,raw('Wait',.08),wave!,raw('Wait',.08),raw('BattleForceExitOnSave'),raw('Wait',.1),raw('Exit')];script.Segments[0]!.Count=script.Mnemonics.length;
 source.input.forcedSavePolicy={kind:WEB_BATTLE_FORCED_SAVE};
 const build=()=>{const result=source.runtime(),base=checkpointFixture();const battle:BattleCatalog={...base.battle,common:{...base.battle.common,conditions:source.input.conditions,abilities:source.input.abilities,
  sprites:source.input.sprites,drops:result.drops,battleEvents:{conditions:source.input.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))}},encounters:result.encounters,encounterDiagnostics:result.diagnostics,encounterReport:result.report};
 base.field.scripts.fight![0]={...base.field.scripts.fight![0]!,kind:'encounter',party:9201,continuation:'after'} as Op;return{field:base.field,battle,result};};
 return{source,conditions,build};
}
