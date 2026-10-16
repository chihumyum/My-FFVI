import {removeLifeConditionSessionFixture} from './remove-life-condition-session.js';
import {compileOwnedConditionInstruction} from '../../src/compiler/owned-condition.js';
import {compileFieldRecoveryInstruction,sourceOwnedRevivalSelector} from '../../src/compiler/field-recovery.js';
import {sealBatchContent} from './content-batch.js';
import type {Op} from '../../src/field/types.js';
import assert from 'node:assert/strict';
import {GameBattleHandoff} from '../../src/core/game-battle-handoff.js';
import {encounterReady} from './source-encounter-session.js';

/** Controlled declarations before the real source-initializer launch. Battle
 * damage creates death. Literal row5 is present because Current's revival uses
 * that exact row, independently of a synthetic catalog's usual HP-zero alias. */
export function sourceOwnedRecoverySessionFixture(){
  const f=removeLifeConditionSessionFixture(),common=f.battle.common;
  const old=common.conditions.hpZeroConditionId;
  common.conditions.rules.definitions.push({...common.conditions.rules.definitions.find(d=>d.id===old)!,id:5},
    {id:79,type:665,overlapped:false,eraseGroupId:common.conditions.rules.definitions.find(d=>d.id===old)!.eraseGroupId});
  common.conditions.behaviors.push({...common.conditions.behaviors.find(b=>b.id===old)!,id:5});
  common.conditions.hpZeroConditionId=5;
  const fieldConditions=f.battle.gameState.fieldConditions!;
  fieldConditions.definitions.push({...fieldConditions.definitions.find(d=>d.id===old)!,id:5});
  fieldConditions.behaviors.push({...fieldConditions.behaviors.find(b=>b.id===old)!,id:5});
  f.battle.gameState.partyActors!.conditionTypes[5]=5;
  const tables={'condition.csv':common.conditions.rules.definitions.map(({id,type})=>({id:String(id),condition_type:String(type)}))};
  const raw=(mnemonic:string,r=Array(8).fill(0),s=Array(8).fill(''))=>({type:1,mnemonic,operands:{iValues:Array(8).fill(0),rValues:r,sValues:s}});
  const subtract=compileFieldRecoveryInstruction(raw('SubtractionHP',[8,0,0,0,0,0,0,0]),tables),
    revive=compileFieldRecoveryInstruction(raw('SysCall',undefined,[sourceOwnedRevivalSelector,'','','','','','','']),tables),
    remove=compileOwnedConditionInstruction({...raw('RemoveCondition'),operands:{...raw('RemoveCondition').operands,iValues:[665,0,0,0,0,0,0,0]}},tables);
  f.map.scripts['resource-change']=[subtract,revive,remove,{kind:'exit'}].map((op,index)=>({...op,script:'resource-change',index,source:f.source})as Op);
  f.map.scriptPuppetContexts!['resource-change']={...f.map.scriptPuppetContexts!['life-noop']!,scriptHash:'6'.repeat(64)};
  (f.map.scriptLocals??={})['resource-change']=null;
  (f.map.scriptTransitionMetadata??={})['resource-change']={customAnimations:'none'};
  (f.map.scriptSystemFlags??={})['resource-change']={keepBadStatusVisual:false};
  Object.assign(f.battle,sealBatchContent(f.battle));Object.assign(f.map,sealBatchContent(f.map));
  f.world.maps[f.map.mapId]!.contentHash=f.map.contentHash;Object.assign(f.world,sealBatchContent(f.world));
  Object.assign(f.content,{battleCatalogHash:f.battle.contentHash,worldCatalogHash:f.world.contentHash,mapContentHash:f.map.contentHash});
  Object.assign(f.content,sealBatchContent(f.content));
  const enter=async()=>{
    const live=f.make();assert(live.game.field.startEvent('source-fight'));
    for(let i=0;i<100&&!live.game.field.stop;i++)live.flow.advance(10,encounterReady);
    const handoff=new GameBattleHandoff(live.flow,{prepareStart:async()=>({}),prepareReturn:async()=>({}),discard(){}});
    assert.equal((await handoff.start()).status,'committed');const battle=live.game.battle!,before=live.game.state.snapshot();
    for(let i=0;i<5000&&!battle.players.some(p=>p.hp===0);i++)live.flow.advance(10,encounterReady);
    assert.equal(battle.players.filter(p=>p.hp===0).length,1);const dead=battle.players.find(p=>p.hp===0)!;
    assert(dead.conditionIds.includes(5));assert.deepEqual(live.game.state.snapshot(),before);
    for(let i=0;i<5000&&battle.phase==='active';i++){
      for(const player of battle.ready){const target=battle.enemies.find(e=>e.hp>0);if(target)live.commands.command(battle,player.id,10,{kind:'single',id:target.id},100);}
      live.flow.advance(10,encounterReady);
    }
    assert.equal(battle.phase,'victory');assert.equal((await handoff.return()).status,'committed');
    for(let i=0;i<100&&!live.game.checkpointReady;i++)live.flow.advance(10,encounterReady);
    assert(live.game.checkpointReady,live.game.field.stop?.message);assert.equal(live.game.state.snapshot().roster.find(m=>m.id===dead.id)!.hp,0);
    return{...live,handoff,battle,deadId:dead.id};
  };
  return{...f,enter};
}
