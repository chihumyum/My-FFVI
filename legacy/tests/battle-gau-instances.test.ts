import test from "node:test";
import assert from "node:assert/strict";
import { GameState } from "../src/core/game-state.js";
import { equipmentGameFixture } from "./fixtures/equipment-game.js";

function ownedFixture() {
  const f = equipmentGameFixture(), state = new GameState(f.catalog.gameState, f.catalog.common.players,
    f.catalog.contentHash, f.catalog.common.conditions);
  state.fieldRoster.prepare({ kind: "secede", sourceId: 2, removeEquipment: false, refreshActors: true }).commit();
  const before = state.snapshot(), lease = state.openBattle(1000);
  const result = { kind: "battle-no-save-return-v1" as const, resultType: 4 as const,
    participants: state.battlePlayers(lease).map(player => ({ ownedId: player.id, sourceId: player.sourceId })) };
  return { f, state, before, lease, result };
}

test("the actual owned lease privately applies pre-enable then common join; no-save publishes once and restores through Storage shape", () => {
  const f = ownedFixture(), host = f.state.battleGauOwnedHost(f.lease), frame = host.prepareFrame();
  assert.deepEqual(frame.join({ sourceId: 2, firstEncounter: false }), { ownedId: "b", sourceId: 2 });
  assert.deepEqual(f.state.snapshot(), f.before);
  assert.throws(() => f.state.fieldRoster.prepare({ kind: "reserve", sourceId: 1, refreshActors: true }), /battle/i);
  frame.prepareCommit().commit();
  assert.deepEqual(f.state.snapshot(), f.before, "A committed battle frame cannot publish persistent data ahead of the shared return");
  const prepared = f.state.prepareForcedReturn(f.lease, f.result);
  assert.deepEqual(f.state.snapshot(), f.before);
  prepared(); host.retire();
  const after = f.state.snapshot(), joining = after.roster.find(row => row.id === "b")!;
  assert(joining.enabled); assert(after.party.slots[after.party.selectedSlot].some(cell => cell.id === joining.id));
  assert.equal(joining.hp, joining.maxHp); assert.equal(joining.mp, joining.maxMp);
  assert.deepEqual(after.equipmentStock, f.before.equipmentStock);
  assert.deepEqual(after.completedBattles.map(row => row.outcome), ["forced"]);
  const restored = new GameState(f.f.catalog.gameState, f.f.catalog.common.players, f.f.catalog.contentHash, f.f.catalog.common.conditions);
  restored.restore(JSON.parse(JSON.stringify(after))); assert.deepEqual(restored.snapshot(), after);
  assert.throws(prepared, /Stale|lease|candidate/);
});

test("first-equipment and absent-held branches fail before mutation; failed frames discard and retry once", () => {
  const f = ownedFixture(), host = f.state.battleGauOwnedHost(f.lease);
  for (const input of [{ sourceId: 2, firstEncounter: true }, { sourceId: 999, firstEncounter: false }]) {
    const frame = host.prepareFrame(); assert.throws(() => frame.join(input), /separate AddEquippedItem|already held/);
    frame.discard(); assert.deepEqual(f.state.snapshot(), f.before);
  }
  const failed = host.prepareFrame(); failed.join({ sourceId: 2, firstEncounter: false }); failed.discard();
  const retry = host.prepareFrame(); retry.join({ sourceId: 2, firstEncounter: false }); retry.prepareCommit().commit();
  f.state.prepareForcedReturn(f.lease, f.result)();
  assert.deepEqual(f.state.snapshot().equipmentStock, f.before.equipmentStock);
});

test("the complete candidate freezes at preparation; saved outcome remains a specific phase gate", () => {
  const f = ownedFixture(), host = f.state.battleGauOwnedHost(f.lease), frame = host.prepareFrame();
  frame.join({ sourceId: 2, firstEncounter: false }); const prepared = frame.prepareCommit();
  frame.join({ sourceId: 2, firstEncounter: false }); assert.throws(prepared.commit, /changed after preparation/); frame.discard();
  const valid = host.prepareFrame(); valid.join({ sourceId: 2, firstEncounter: false }); valid.prepareCommit().commit();
  assert.throws(() => f.state.prepareEscape(f.lease, { players: f.state.battlePlayers(f.lease), consumedItems: [] }), /saved-result\/owned lifecycle merge order/);
  assert.deepEqual(f.state.snapshot(), f.before);
});

test("retired attempts cannot finish late; explicit battle retry uses the still unpublished entry", () => {
  const f = ownedFixture(), old = f.state.battleGauOwnedHost(f.lease), frame = old.prepareFrame();
  frame.join({ sourceId: 2, firstEncounter: false }); const late = frame.prepareCommit(); old.retire();
  assert.throws(late.commit, /Retired|Stale/); frame.discard();
  const retry = f.state.battleGauOwnedHost(f.lease), untouched = retry.prepareFrame(); untouched.prepareCommit().commit();
  const returned = f.state.prepareForcedReturn(f.lease, f.result); returned();
  const after = f.state.snapshot(); after.completedBattles = [];
  assert.deepEqual(after, f.before);
});

import {gauSessionFixture} from './fixtures/battle-gau-instances.js';
import {GameSession} from '../src/core/game-session.js';
import {GameFlow} from '../src/core/game-flow.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import {encounterContent} from '../src/core/battle-content.js';
import {battleMediaUrls} from '../src/core/game-content.js';
import {parseBattleEventProgram} from '../src/core/battle-event.js';
import {WEB_BATTLE_GAU_INSTANCES} from '../src/core/battle-gau-instances.js';
const ready={visible:true,mediaReady:true,overlayOpen:false};
function session(f=gauSessionFixture()){
  const game=new GameSession(f.field,f.catalog,71,f.runtime),flow=new GameFlow(game);
  game.state.fieldRoster.prepare({kind:'secede',sourceId:2,removeEquipment:false,refreshActors:true}).commit();
  game.field.eventState.write({category:'ScenarioVariable',index:8},1);
  flow.start();flow.advance(0,ready);assert(game.field.startEvent('fight'));flow.advance(10,ready);
  assert(game.prepareBattleStart()!.commit());return {...f,game,flow,battle:game.battle!,before:game.state.snapshot()};
}
test('actual Session replaces source-bound enemies, draws four cues, joins the held owner and returns through Storage exactly once',async()=>{
  const f=session(),old=f.battle.enemies.map(unit=>unit.id),before=f.game.state.snapshot();
  f.flow.advance(10,ready);assert.equal(f.battle.eventExecution.state!.wait!.kind,'gau-replace');
  f.flow.advance(10,ready);assert.equal(f.battle.enemyPartyExecution.partyId,502);assert(f.battle.enemies.every(unit=>!old.includes(unit.id)));
  assert.equal(f.battle.enemies[0]!.sourceId,342);assert.equal(f.battle.enemies[0]!.hp,f.catalog.encounters[1000]!.participants!.enemyDefinitions[342]!.hp);assert(f.battle.enemyAIState(f.battle.enemies[0]!.id));
  assert.equal(f.battle.players.length,1,'Visual enemy is not promoted to a player');
  const frames:string[]=[];
  for(let i=0;i<61;i++){f.flow.advance(10,ready);const frame=f.battle.appearanceFrame(f.battle.enemies[0]!.id,{key:'default',bodyFrame:0,armorFrame:0});
    if(frame)frames.push(frame.key);}
  assert.deepEqual([...new Set(frames)],['handsUpB00','winR00','handsUp00','WalkL01']);
  assert.equal(f.battle.phase,'forced');assert.deepEqual(f.game.state.snapshot(),before);
  assert.equal(f.battle.gauInstanceExecution.journal.filter(row=>row.action==='complete').length,2);
  const cancelled=f.game.prepareBattleReturn()!;cancelled.discard();assert.deepEqual(f.game.state.snapshot(),before);
  const returned=f.game.prepareBattleReturn()!;assert(returned.commit());assert.equal(returned.commit(),false);
  assert(f.game.state.snapshot().roster.find(row=>row.id==='b')!.enabled);assert.equal(f.game.state.activeParty.length,2);
  assert.equal(f.game.state.snapshot().completedBattles.length,1);assert.deepEqual(f.game.state.snapshot().equipmentStock,before.equipmentStock);
  assert.throws(()=>f.battle.advance(10),/Retired/);
  const map=new Map<string,string>(),storage=new CheckpointStorage({getItem:key=>map.get(key)??null,setItem:(key,value)=>{map.set(key,value);}});
  f.game.advance(2000);assert(f.game.checkpointReady);await storage.save(f.game.checkpoint(),1000);const saved=await storage.load();assert(saved);
  const restored=GameSession.restore(saved.checkpoint,f.field,f.game.battleCatalog,undefined,f.runtime);
  assert.deepEqual(restored.state.snapshot(),f.game.state.snapshot());
  assert(battleMediaUrls(encounterContent(f.game.battleCatalog,1000)!).includes('synthetic/body/handsUp00.png'));
});
test('loading/failed actual media leaves prior instances and owned state intact; retry retires late tickets',()=>{
  const f=session();f.setMediaReady(false);f.flow.advance(10,ready);const old=structuredClone(f.battle.combatants);
  f.flow.advance(200,ready);assert.deepEqual(f.battle.combatants,old);assert.deepEqual(f.game.state.snapshot(),f.before);
  f.setMediaValid(false);assert.throws(()=>f.flow.advance(10,ready),/Gau media|invalid Gau/);assert.deepEqual(f.battle.combatants,old);
  f.setMediaValid(true);f.setMediaReady(true);f.flow.advance(10,ready);assert.equal(f.battle.enemies.length,1);
  f.flow.advance(50,ready);const retired=f.battle;
  // The explicit retry retires this complete Battle, not a manufactured owner.
  retired.players[0]!.hp=0;retired.players[0]!.conditionIds=[305];f.flow.advance(10,ready);
  assert.equal(retired.phase,'defeat');assert(f.game.prepareBattleRetry()!.commit());assert.throws(()=>retired.advance(10),/Retired/);assert.deepEqual(f.game.state.snapshot(),f.before);
});
test('first equipment, actual held owner and independent runtime declaration remain specific gates',()=>{
  const f=session(gauSessionFixture([{kind:'gau-join'},{kind:'wait',seconds:1},{kind:'exit'}]));
  f.game.field.eventState.write({category:'ScenarioVariable',index:8},0);
  // Entry shared state is frozen, so a fresh first-branch Session is required.
  const first=gauSessionFixture([{kind:'gau-join'},{kind:'wait',seconds:1},{kind:'exit'}]),g=new GameSession(first.field,first.catalog,1,first.runtime);
  g.field.eventState.write({category:'ScenarioVariable',index:8},0);g.advance(0);assert(g.field.startEvent('fight'));g.advance(10);assert(g.prepareBattleStart()!.commit());
  assert.throws(()=>g.advance(10),/AddEquippedItem\/RefitEquip/);assert.equal(g.battle!.eventExecution.state!.pc,0);
  const absent=gauSessionFixture();delete (absent.runtime as {battleGauInstances?:unknown}).battleGauInstances;
  const missing=new GameSession(absent.field,absent.catalog,1,absent.runtime);missing.advance(0);assert(missing.field.startEvent('fight'));missing.advance(10);
  assert.throws(()=>missing.prepareBattleStart()!.commit(),/explicit content and actual media\/owned host/);
  const invalid=structuredClone(first.catalog.encounters[1000]!.lifecycle!);if(invalid.mode!=='script')throw new Error('fixture');
  (invalid.program.instructions[0]!.op as unknown as Record<string,unknown>).extra=1;assert.throws(()=>parseBattleEventProgram(invalid.program),/checkpoint fields/);
  assert.equal(WEB_BATTLE_GAU_INSTANCES,'web-source-battle-gau-instances-v1');
});

import {WEB_BATTLE_EVENT_EFFECTS} from '../src/core/battle-event-effect.js';
import {authoredBattleEffect} from './fixtures/battle-event-effect.js';
import {compileBattleEvent} from '../src/compiler/battle-event.js';
import {classifyDeferredBattleInstruction,WEB_BATTLE_BRANCH_EXECUTION} from '../src/core/battle-branch-execution.js';
import {battleMessageProgram,messageRaw} from './fixtures/battle-event-message.js';
test('same-frame owned join is discarded on an effect publication failure, with shared banks and source cursor retained for one retry',()=>{
  const f=gauSessionFixture([{kind:'gau-join'},authoredBattleEffect(1,1),{kind:'force-return'},{kind:'wait',seconds:.1},{kind:'exit'}]);
  let fail=true;const runtime={...f.runtime,battleEventEffects:{policy:WEB_BATTLE_EVENT_EFFECTS,prepare(){return {status:()=> 'ready' as const,validate(){},commit(){if(fail)throw new Error('authored concurrent effect failure');},discard(){}};}}};
  const g=new GameSession(f.field,f.catalog,71,runtime);g.state.fieldRoster.prepare({kind:'secede',sourceId:2,removeEquipment:false,refreshActors:true}).commit();
  g.field.eventState.write({category:'ScenarioVariable',index:8},1);g.advance(0);assert(g.field.startEvent('fight'));g.advance(10);assert(g.prepareBattleStart()!.commit());
  const before=g.state.snapshot(),b=g.battle!;assert.throws(()=>g.advance(10),/concurrent effect failure/);
  assert.equal(b.time,0);assert.equal(b.eventExecution.state!.pc,0);assert.equal(b.gauInstanceExecution.journal.length,0);assert.deepEqual(g.state.snapshot(),before);
  fail=false;g.advance(10);assert.equal(b.phase,'forced');assert.equal(b.gauInstanceExecution.journal.filter(row=>row.action==='join').length,1);
  assert(g.prepareBattleReturn()!.commit());assert(g.state.snapshot().roster.find(row=>row.id==='b')!.enabled);assert.deepEqual(g.state.snapshot().equipmentStock,before.equipmentStock);
});
test('all three original selector encodings are typed but altered unused operands remain hard under the branch policy',()=>{
  const kinds=['gau-replace','gau-appearance','gau-join'];
  ['敵パーティをガウに','ガウ登場アニメ','バトル加入：ガウ'].forEach((selector,index)=>{
    const raw=messageRaw('SysCall');raw.operands.sValues[0]=selector;assert.equal(battleMessageProgram([raw]).instructions[0]!.op.kind,'blocked');
    const data={Name:'typed',Title:{main:'',sub:''},Mnemonics:[raw],Segments:[{Label:'Main',EntryPoint:0,Count:1}],ScriptLocal:[],ScriptLocalValue:[],SystemFlag:{KeepBadStatusVisual:0,KeepPlayerPuppet:0,RidingVehicle:0,SkipInitialize:0},Animations:[]};
    assert.equal(compileBattleEvent(data,null,undefined,undefined,undefined,undefined,WEB_BATTLE_GAU_INSTANCES).instructions[0]!.op.kind,kinds[index]);
    for(const key of ['iValues','rValues','sValues'] as const){const bad=structuredClone(raw);(bad.operands[key] as (number|string)[])[7]=key==='sValues'?'unknown':1;
      const p=compileBattleEvent({Name:'bad',Title:{main:'',sub:''},Mnemonics:[bad],Segments:[{Label:'Main',EntryPoint:0,Count:1}],ScriptLocal:[],ScriptLocalValue:[],SystemFlag:{},Animations:[]},null,undefined,undefined,WEB_BATTLE_BRANCH_EXECUTION,undefined,WEB_BATTLE_GAU_INSTANCES);
      assert.equal(p.instructions[0]!.op.kind,'blocked');assert.equal(p.blockers.length,1);assert.equal(classifyDeferredBattleInstruction(bad),null);}
  });
});
test('a retired committed but unpublished attempt cannot leak its owned join into a retry which makes no owned change',()=>{
 const f=ownedFixture(),old=f.state.battleGauOwnedHost(f.lease),frame=old.prepareFrame();frame.join({sourceId:2,firstEncounter:false});frame.prepareCommit().commit();old.retire();
 // A merely constructed retry remains lazy, as in actual handoff preparation.
 f.state.battleGauOwnedHost(f.lease);f.state.prepareForcedReturn(f.lease,f.result)();
 const after=f.state.snapshot();after.completedBattles=[];assert.deepEqual(after,f.before);
});
