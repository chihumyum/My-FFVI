import test from 'node:test';
import assert from 'node:assert/strict';
import { worldLoopSessionFixture } from './fixtures/world-loop-session.js';
import { participantLoop } from './fixtures/battle-participant-game.js';
import { authoredMessageSource } from './fixtures/battle-event-message.js';
import { sealBatchContent } from './fixtures/content-batch.js';
import { compileFrameworkNewGame } from '../src/compiler/framework-new-game.js';
import { GameSession } from '../src/core/game-session.js';
import { GameFlow } from '../src/core/game-flow.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
const host={visible:true,mediaReady:true,overlayOpen:false};
test('one source Session captures Shadow facts once and returns shared post-battle state with owned rewards; failed media leaves no lease or writes',async()=>{
  const f=await worldLoopSessionFixture(),draft=structuredClone(f.battle),program=participantLoop([{kind:'cursed-shield-check'},{kind:'shadow-secede-lot'}]);
  draft.common.battleEvents={conditions:draft.common.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
  program.source=structuredClone(authoredMessageSource);program.localNames=['AI','EnemyMode','GauMode','ShadowLot'];program.initialLocals=[0,0,0,7];
  draft.encounters[f.encounterId]!.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:9000,program};
  const battle=sealBatchContent(draft),content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,
    world:f.world,map:f.map,battle,entrance:f.map.partyEntry!.pointIns[0]!.id}),
    game=await GameSession.prepareFrameworkNewGame(content,f.world,f.map,battle,{battleHandoff:'prepared'}),flow=new GameFlow(game);
  flow.start(game);flow.observeHost(host);flow.advance(10,host);
  game.field.eventState.write({category:'ScenarioVariable',index:2},-1001);
  const owned=game.state.snapshot(),field=game.field,banks=field.eventState.snapshot();assert(field.startEvent('stone-battle'));flow.advance(10,host);
  let fail=true;const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>{if(fail)throw Error('held post-battle media');return {};},prepareReturn:async()=>({}),discard(){}});
  assert.equal((await handoff.start()).status,'failed');assert.equal(game.battle,null);assert.equal(game.state.inBattle,false);assert.deepEqual(game.state.snapshot(),owned);
  fail=false;const started=await handoff.start();assert.equal(started.status,'committed',started.status==='failed'?String(started.error):started.status);
  flow.advance(20,host);const active=game.battle!,entry=active.gauLifecycle.entry!;
  assert.deepEqual(entry.roster,owned.roster.map(({id,sourceId,ownedId,enabled})=>({id,sourceId,ownedId,enabled})));
  assert.deepEqual(entry.party,owned.party);assert.equal(entry.fixedPreemptiveState,null);assert.equal(active.eventExecution.state!.locals[3],0);
  for(let i=0;i<2000&&active.phase==='active';i++){
    for(const actor of active.ready){const enemy=active.enemies.find(e=>e.hp>0);if(enemy)active.command(actor.id,10,enemy.id,100);}flow.advance(20,host);
  }
  assert.equal(active.phase,'victory');assert.equal((await handoff.return()).status,'committed');flow.advance(20,host);
  assert.equal(game.field,field);assert.deepEqual(field.eventState.snapshot().global,banks.global);assert.equal(game.state.snapshot().completedBattles.length,owned.completedBattles.length+1);
  const saved=game.checkpoint(),restored=GameSession.restore(saved,undefined,battle,{catalog:f.world,map:f.map,initialized:{content,initialMap:f.map}},{battleHandoff:'prepared'});
  assert.deepEqual(restored.checkpoint(),saved);
});
