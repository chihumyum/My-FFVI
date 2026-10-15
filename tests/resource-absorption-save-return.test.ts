import test from 'node:test';
import assert from 'node:assert/strict';
import {GameSession} from '../src/core/game-session.js';
import {GameFlow} from '../src/core/game-flow.js';
import {GameBattleHandoff} from '../src/core/game-battle-handoff.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import {WEB_SCRIPTED_BATTLE_ACTIONS} from '../src/core/scripted-battle-action.js';
import {WEB_BATTLE_EVENT_CONTROLS} from '../src/core/battle-controls.js';
import {WEB_BATTLE_FORCED_SAVE} from '../src/core/battle-forced-save.js';
import {compileScriptedBattleAction} from '../src/compiler/battle-scripted-action.js';
import {checkpointFixture} from './fixtures/checkpoint-game.js';
import {absorptionSource} from './fixtures/resource-absorption.js';

const ready={visible:true,mediaReady:true,overlayOpen:false};
const action=(id:number,side=1,caster=1000,targetSide=2,target=1)=>compileScriptedBattleAction({
 type:1,mnemonic:'BattleAction',operands:{iValues:[side,caster,id,targetSide,target,0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill('')}});

for(const resource of ['hp','mp']as const)test(`a real ${resource} drain survives forced Save and failed return preparation without another payment or resource write`,async()=>{
 const f=checkpointFixture();f.battle.common.abilities[901]=absorptionSource(resource).compile().abilities[901]!;
 f.battle.common.playerConditionTraits=Object.fromEntries(f.battle.common.players.map(p=>[p.sourceId,{kind:'source-condition-traits-v1',baseUndead:false}]));
 for(const encounter of Object.values(f.battle.encounters))for(const enemy of encounter.enemies){enemy.mp=20;enemy.conditionTraits={kind:'source-condition-traits-v1',baseUndead:false};}
 const ops=[...(resource==='hp'?[action(13,2,1,1,1000)]:[]),action(901),
  {kind:'force-save-return'as const},{kind:'wait'as const,seconds:.1},{kind:'exit'as const}];
 f.battle.common.battleEvents={conditions:f.battle.common.conditions.rules.definitions.map(({id,type})=>
  ({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
 f.battle.encounters[1000]!.forcedSavePolicy={kind:WEB_BATTLE_FORCED_SAVE};
 f.battle.encounters[1000]!.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:{
  kind:'battle-event-v1',source:null,entry:0,end:ops.length,localNames:[],initialLocals:[],
  instructions:ops.map(op=>({mnemonic:op.kind,op})),blockers:[]}};
 const runtime={battleHandoff:'prepared'as const,scriptedBattleActions:WEB_SCRIPTED_BATTLE_ACTIONS,battleEventControls:WEB_BATTLE_EVENT_CONTROLS};
 const game=new GameSession(f.field,f.battle,123,runtime),flow=new GameFlow(game);flow.start();flow.advance(0,ready);
 const before=game.state.snapshot();assert(game.field.startEvent('fight'));flow.advance(10,ready);assert(game.prepareBattleStart()!.commit());
 const battle=game.battle!;let absorbed=false;
 for(let clock=0;clock<1000&&battle.phase==='active';clock++){
  flow.advance(10,ready);
  if(battle.action?.source.id===901&&battle.action.resolved){
   const received=battle.action.userResourceResults?.[0];assert(received&&received.amount>0);assert.equal(received.resource,resource);absorbed=true;
  }
 }
 assert(absorbed);assert.equal(battle.phase,'forced');assert.equal(battle.reward,null);assert.deepEqual(game.state.snapshot(),before);
 const result=battle.previewForcedReturn()!;assert.equal(result.kind,'battle-save-return-v1');
 const expected=result.players.find(p=>p.id===battle.players[0]!.id)![resource];
 let fail=true;const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>null,prepareReturn:async()=>{if(fail)throw Error('controlled combined return failure');return null;},discard(){}});
 assert.equal((await handoff.return()).status,'failed');assert.equal(game.battle,battle);assert.deepEqual(game.state.snapshot(),before);
 assert.deepEqual(battle.previewForcedReturn(),result);fail=false;assert.equal((await handoff.return()).status,'committed');flow.advance(10,ready);
 const after=game.state.snapshot();assert.equal(after.roster[0]![resource],expected);assert.equal(after.formatVersion,15);
 assert.deepEqual(after.completedBattles,[{serial:0,encounterId:1000,outcome:'forced-save'}]);assert.deepEqual(game.state.completedEncounters,[]);
 assert.equal(after.gil,before.gil);assert.equal(after.roster[0]!.exp,before.roster[0]!.exp);assert.deepEqual(after.learnedAbilityIds,before.learnedAbilityIds);
 assert.equal(game.prepareBattleReturn(),null);
 const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});
 await storage.save(game.checkpoint(),1);const saved=(await storage.load())!;
 const restored=GameSession.restore(saved.checkpoint,f.field,f.battle,undefined,runtime);assert.deepEqual(restored.checkpoint(),saved.checkpoint);
 restored.advance(100);assert.deepEqual(restored.state.snapshot(),after);assert.throws(()=>battle.advance(10),/Retired/);
});
