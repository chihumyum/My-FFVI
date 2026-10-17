import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceEncounterSessionFixture, encounterReady } from './fixtures/source-encounter-session.js';
import { syntheticAI } from './fixtures/battle-ai.js';
import { compileTargetRule } from '../src/compiler/battle-targets.js';
import { sealBatchContent } from './fixtures/content-batch.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
import { GameFlow } from '../src/core/game-flow.js';
import { GameCommands } from '../src/core/game-commands.js';
import { CheckpointStorage } from '../src/core/saved-game.js';

function setup(bit: boolean){
  const f=sourceEncounterSessionFixture({seed:599}),ability=structuredClone(f.battle.common.abilities[11]!);
  Object.assign(ability,{id:601,name:'Authored session Final',power:1,cost:3,wait:0});ability.program.abilityId=601;ability.program.range=3;
  ability.plan!.targeting=compileTargetRule(3,3)!;ability.plan!.effects=[{slot:1,kind:'recovery',resource:'hp',calculation:'fixed'}];ability.plan!.magic=null;
  f.battle.common.abilities[601]=ability;f.battle.common.battleAbilities!.abilities.push({id:601,typeId:ability.program.rules.type_id!,groupId:ability.program.groupId,range:3});
  f.battle.common.initialAtb={player:[100,100],enemy:[0,0]};
  for(const encounter of Object.values(f.battle.encounters)){
    const enemy=encounter.enemies[0]!;Object.assign(enemy,{hp:1,mp:3,mpParameter:{kind:"source-enemy-mp-parameter-v1",sourceId:enemy.sourceId,isUnableMP:bit},agility:0,weight:21,abilities:[13,601],ai:syntheticAI([
      ['Nop'],['SyncAI'],['StartTable',[0]],['FinalAttackAct',[601],[100]],['Act',[13]],['EndTable'],['JumpBattleAI',[0]],
    ])});
  }
  Object.assign(f.battle,sealBatchContent(f.battle));f.content.battleCatalogHash=f.battle.contentHash;Object.assign(f.content,sealBatchContent(f.content));return f;
}
const host={prepareStart:async()=>({kind:'start'}),prepareReturn:async()=>({kind:'return'}),discard(){}};

for (const bit of [false,true]) test(`MP constructor owner ${bit}: actual Session Final/payment→return failure retry→Storage→new battle`,async()=>{
  const f=setup(bit),{game,flow,commands}=f.make();assert(game.field.startEvent('source-fight'));
  for(let i=0;i<100&&!game.field.stop;i++)flow.advance(10,encounterReady);
  assert.equal(game.field.stop?.kind,'encounter',game.field.stop?.message);
  const request=structuredClone(game.field.stop),owned=game.state.snapshot();let failStart=true,failReturn=true;
  const handoff=new GameBattleHandoff(flow,{...host,prepareStart:async()=>{if(failStart)throw Error('Controlled preparation failure');return {kind:'start'};},
    prepareReturn:async()=>{if(failReturn)throw Error('Controlled return failure');return {kind:'return'};}});
  assert.equal((await handoff.start()).status,'failed');assert.equal(game.battle,null);assert.deepEqual(game.state.snapshot(),owned);assert.deepEqual(game.field.stop,request);
  let release!:(value:{kind:string})=>void;const media=new Promise<{kind:string}>(yes=>{release=yes;});
  const cancelled=new GameBattleHandoff(flow,{...host,prepareStart:()=>media}),pending=cancelled.start();cancelled.cancel();release({kind:'start'});
  assert.equal((await pending).status,'cancelled');assert.equal(game.battle,null);assert.deepEqual(game.state.snapshot(),owned);assert.deepEqual(game.field.stop,request);
  failStart=false;assert.equal((await handoff.start()).status,'committed');const battle=game.battle!,player=battle.ready[0]!,enemy=battle.enemies[0]!;
  assert(commands.command(battle,player.id,10,enemy.id,100));flow.advance(410,encounterReady);
  assert.equal(enemy.hp,0);assert.equal(battle.finalAttackExecution.length,1);assert(battle.pendingActions.some(action=>action.kind==='final'));
  assert.throws(()=>game.checkpoint(),/checkpoint|battle|stable|save/i);
  flow.advance(2000,encounterReady);assert.equal(battle.phase,'victory');assert.equal(enemy.mp,0);assert.deepEqual(battle.finalAttackExecution,[]);
  const finished=structuredClone({units:battle.combatants,result:battle.previewVictory(),state:game.state.snapshot()});
  assert.equal((await handoff.return()).status,'failed');assert.equal(game.battle,battle);assert.deepEqual({units:battle.combatants,result:battle.previewVictory(),state:game.state.snapshot()},finished);
  failReturn=false;assert.equal((await handoff.return()).status,'committed');for(let i=0;i<100&&!game.checkpointReady;i++)flow.advance(10,encounterReady);
  assert(game.checkpointReady,game.field.stop?.message);assert.equal(game.state.completedEncounters.length,1);assert.equal(game.field.eventState.read({category:'MapLocalVariable',index:0}),1);
  await assert.rejects(()=>handoff.return(),/requires/);
  const data=new Map<string,string>(),storage=new CheckpointStorage({getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);}},'framework','final-authored');
  assert(!JSON.stringify(game.checkpoint()).includes("source-enemy-mp-parameter-v1"));
  await storage.save(game.checkpoint(),1234);const saved=(await storage.load())!,restored=f.restore(saved.checkpoint);assert.deepEqual(restored.checkpoint(),saved.checkpoint);
  const nextFlow=new GameFlow(restored);nextFlow.start();nextFlow.advance(0,encounterReady);const nextCommands=new GameCommands(nextFlow,restored);
  assert(restored.field.startEvent('source-next'));const nextHandoff=new GameBattleHandoff(nextFlow,host);assert.equal((await nextHandoff.start()).status,'committed');
  const next=restored.battle!;assert.notEqual(next,battle);assert.deepEqual(next.finalAttackExecution,[]);assert.equal(next.enemyAIState(next.enemies[0]!.id)!.receivedAbility,null);
  const actor=next.ready[0]!;assert(nextCommands.command(next,actor.id,10,next.enemies[0]!.id,100));nextFlow.advance(2500,encounterReady);
  assert.equal(next.phase,'victory');assert.equal((await nextHandoff.return()).status,'committed');nextFlow.advance(100,encounterReady);
  assert(restored.checkpointReady);assert.equal(restored.state.completedEncounters.length,2);
});
