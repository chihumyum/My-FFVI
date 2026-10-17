import test from 'node:test';
import assert from 'node:assert/strict';
import { worldLoopSessionFixture } from './fixtures/world-loop-session.js';
import { participantLoop } from './fixtures/battle-participant-game.js';
import { authoredMessageSource } from './fixtures/battle-event-message.js';
import { checkpointFixture } from './fixtures/checkpoint-game.js';
import { sealBatchContent } from './fixtures/content-batch.js';
import { compileFrameworkNewGame } from '../src/compiler/framework-new-game.js';
import { GameSession } from '../src/core/game-session.js';
import { GameFlow } from '../src/core/game-flow.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
const host={visible:true,mediaReady:true,overlayOpen:false};
async function fixture(){
  const f=await worldLoopSessionFixture(),battle=structuredClone(f.battle),program=participantLoop([{kind:'set-gau-mode'}]);
  battle.common.battleEvents={conditions:battle.common.conditions.rules.definitions.map(({id,type})=>
    ({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
  program.source=structuredClone(authoredMessageSource);program.localNames=['AI','EnemyMode','GauMode'];program.initialLocals=[0,0,9];
  battle.encounters[f.encounterId]!.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:9000,program};
  const sealed=sealBatchContent(battle),content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,
    world:f.world,map:f.map,battle:sealed,entrance:f.map.partyEntry!.pointIns[0]!.id}),
    game=await GameSession.prepareFrameworkNewGame(content,f.world,f.map,sealed,{battleHandoff:'prepared'}),flow=new GameFlow(game);
  flow.start(game);flow.observeHost(host);flow.advance(10,host);
  return {...f,battle:sealed,content,game,flow};
}
test('real source-initialized lease captures the complete owned roster and current Field predicate; media failure and retry publish no fake facts',async()=>{
  const h=await fixture(),owned=h.game.state.snapshot();assert(h.game.field.startEvent('stone-battle'));h.flow.advance(10,host);
  const field=h.game.field;let fail=true;
  const handoff=new GameBattleHandoff(h.flow,{prepareStart:async()=>{if(fail)throw Error('held battle media');return {};},prepareReturn:async()=>({}),discard(){}});
  assert.equal((await handoff.start()).status,'failed');assert.equal(h.game.battle,null);assert.deepEqual(h.game.state.snapshot(),owned);
  fail=false;const started=await handoff.start();assert.equal(started.status,'committed',started.status==='failed'?String(started.error):started.status);
  h.flow.advance(20,host);const battle=h.game.battle!,entry=battle.gauLifecycle.entry!;
  assert.deepEqual(entry.roster,owned.roster.map(({id,sourceId,ownedId,enabled})=>({id,sourceId,ownedId,enabled})));
  assert.deepEqual(entry.party,owned.party);assert.deepEqual(entry.field,field.battleEntryContext.state);assert.equal(entry.fixedPreemptiveState,null);
  assert.equal(battle.eventExecution.state!.locals[2],9);assert.equal(battle.gauLifecycle.journal.length,1);
  for(let i=0;i<2000&&battle.phase==='active';i++){
    for(const actor of battle.ready){const enemy=battle.enemies.find(e=>e.hp>0);if(enemy)battle.command(actor.id,10,enemy.id,100);}h.flow.advance(20,host);
  }
  assert.equal(battle.phase,'victory');assert.equal((await handoff.return()).status,'committed');h.flow.advance(20,host);
  assert.equal(h.game.field,field);assert.equal(h.game.state.snapshot().completedBattles.length,owned.completedBattles.length+1);
  const saved=h.game.checkpoint(),restored=GameSession.restore(saved,undefined,h.battle,
    {catalog:h.world,map:h.map,initialized:{content:h.content,initialMap:h.map}},{battleHandoff:'prepared'});
  assert.deepEqual(restored.checkpoint(),saved);
});
test('a bounded development roster cannot prove absence of Gau or acquire a source-owned entry',()=>{
  const f=checkpointFixture(),program=participantLoop([{kind:'set-gau-mode'}]);program.localNames=['AI','EnemyMode','GauMode'];program.initialLocals=[0,0,9];
  f.battle.encounters[1000]!.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program};
  const game=new GameSession(f.field,f.battle,8,{battleHandoff:'prepared'}),before=game.state.snapshot();assert(game.field.startEvent('fight'));game.advance(10);
  assert.throws(()=>game.prepareBattleStart(),/complete source-initialized/);assert.equal(game.state.inBattle,false);assert.deepEqual(game.state.snapshot(),before);
});
