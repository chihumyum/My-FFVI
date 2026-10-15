import test from'node:test';import assert from'node:assert/strict';
import{enemySpawnFixture,spawnPolicy}from'./fixtures/battle-spawn-conditions.js';
import{parseWebEnemySpawnConditions}from'../src/core/battle-spawn-conditions.js';
import{BattleGame}from'../src/core/battle.js';import{GameSession}from'../src/core/game-session.js';import{CheckpointStorage}from'../src/core/saved-game.js';import{WEB_BATTLE_EVENT_CONTROLS}from'../src/core/battle-controls.js';
const runtime={battleHandoff:'prepared' as const,battleEventControls:WEB_BATTLE_EVENT_CONTROLS};
function setup(){const f=enemySpawnFixture();f.source.input.spawnConditionPolicy=spawnPolicy;const built=f.build(),game=new GameSession(built.field,built.battle,83,runtime);assert(game.field.startEvent('fight'));game.advance(10);assert(game.prepareBattleStart()!.commit());return{...f,...built,game,b:game.battle!};}
function projection(b:BattleGame){return{units:structuredClone(b.combatants),history:b.participantExecution,event:b.eventExecution,actions:b.pendingActions,action:b.action,ai:b.enemies.map(u=>b.enemyAIState(u.id)),time:b.time,events:[...b.events]};}
test('explicit Web spawn grants supported group expansion to late definitions while strict absence and unknown kinds stay hard',()=>{
 const f=enemySpawnFixture(),strict=f.source.runtime();assert.equal(strict.encounters[9201],undefined);assert(strict.diagnostics.some(d=>d.code==='enemy-initial-condition'&&d.kind==='blocked'));
 f.source.input.spawnConditionPolicy=spawnPolicy;const result=f.source.runtime(),encounter=result.encounters[9201]!;assert(encounter);assert.deepEqual(encounter.spawnConditionPolicy,spawnPolicy);
 assert.deepEqual(encounter.participants!.enemyDefinitions[9103]!.conditionIds,[110,121,196]);assert(result.diagnostics.some(d=>d.code==='enemy-spawn-condition-policy'&&d.kind==='development-omission'));
 for(const raw of [{kind:'unknown'},{...spawnPolicy,extra:true},null])assert.throws(()=>parseWebEnemySpawnConditions(raw));
 const unknown=enemySpawnFixture();unknown.source.input.spawnConditionPolicy=spawnPolicy;unknown.source.input.conditions.behaviors=unknown.source.input.conditions.behaviors.filter(b=>b.id!==196);assert.equal(unknown.source.runtime().encounters[9201],undefined);
});
test('fresh AddEnemy state, AI and resource owners survive the following whole party transition, then Save and actual Storage restore once',async()=>{
 const f=setup(),old=f.b.enemies.map(u=>u.id),before=f.game.state.snapshot();
 for(let n=0;n<30&&!f.b.enemies.some(u=>u.sourceId===9103);n++)f.game.advance(10);
 const first=f.b.enemies.find(u=>u.sourceId===9103)!;assert(first);assert.deepEqual(first.conditionIds,[110,121,196]);assert.equal(first.hp,first.maxHp);assert.equal(first.mp,first.maxMp);assert(f.b.enemyAIState(first.id));assert(f.b.conditionClockState(first.id));assert(f.b.slowClockState(first.id));
 for(let n=0;n<40&&f.b.enemyPartyExecution.partyId!==513;n++)f.game.advance(10);assert.equal(f.b.enemyPartyExecution.partyId,513);
 const next=f.b.enemies[0]!;assert.notEqual(next.id,first.id);assert.equal(f.b.enemyAIState(first.id),null);assert.throws(()=>f.b.conditionClockState(first.id),/Unknown/);assert.throws(()=>f.b.slowClockState(first.id),/Unknown/);for(const id of old)assert.equal(f.b.enemyAIState(id),null);assert.deepEqual(next.conditionIds,[110,121,196]);assert(f.b.enemyAIState(next.id));assert.equal(f.b.command('a',10,first.id),false);
 for(let n=0;n<40&&f.b.phase==='active';n++)f.game.advance(10);assert.equal(f.b.phase,'forced');const cancelled=f.game.prepareBattleReturn()!;cancelled.discard();assert.equal(f.game.battle,f.b);assert.deepEqual(f.game.state.snapshot(),before);assert(f.game.prepareBattleReturn()!.commit());f.game.advance(10);
 const after=f.game.state.snapshot();assert.equal(after.completedBattles.length,1);assert.equal(after.completedBattles[0]!.outcome,'forced-save');assert.equal(after.gil,before.gil);assert.equal(f.game.prepareBattleReturn(),null);
 const data=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);}});await storage.save(f.game.checkpoint(),0);const saved=await storage.load();assert(saved);const restored=GameSession.restore(saved.checkpoint,f.field,f.battle,undefined,runtime);assert.deepEqual(restored.state.snapshot(),after);
});
test('a late spawn frame failure rolls back IDs, true condition owners, AI, clocks and RNG before retry',()=>{
 const f=setup(),control=setup();const before=projection(f.b),owners=[...f.b.combatants];
 Object.defineProperty(f.b.events,'push',{configurable:true,value(){throw Error('Controlled late spawn publish failure');}});
 assert.throws(()=>f.game.advance(10),/Controlled late spawn publish failure/);assert.deepEqual(projection(f.b),before);assert(f.b.combatants.every((u,i)=>u===owners[i]));delete(f.b.events as unknown as{push?:unknown}).push;
 f.b.advance(0);control.game.advance(10);assert.deepEqual(projection(f.b),projection(control.b));
});
