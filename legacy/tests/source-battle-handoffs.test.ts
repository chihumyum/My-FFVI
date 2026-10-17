import {BattleGame} from '../src/core/battle.js';
import {encounterContent} from '../src/core/battle-content.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {GameState} from '../src/core/game-state.js';
import {BattleConditions} from '../src/core/battle-conditions.js';
import {WEB_SOURCE_BATTLE_HANDOFFS, captureSourceTakeOver0055, sourceFinalWaiting, projectSourceColosseumRecovery,
  projectSourceRestore0055, projectSourceHandoffReturn, parseSourceBattleHandoffEntry, validateSourceBattleHandoffState, type SourceBattleHandoffCatalog} from '../src/core/source-battle-handoffs.js';
import {compileSourceBattleHandoffInstruction,compileSourceBattleHandoffCatalog} from '../src/compiler/source-battle-handoffs.js';
import {equipmentGameFixture} from './fixtures/equipment-game.js';
import {emptyPartyState} from '../src/core/party.js';

function fixture(){
  const {catalog}=equipmentGameFixture(),source:SourceBattleHandoffCatalog={kind:'source-battle-handoff-catalog-v1',policy:WEB_SOURCE_BATTLE_HANDOFFS,
    sourceSetHash:'authored',conditions:catalog.common.conditions.rules.definitions.map(({id,type})=>({id,type,untilType:type===5?3:0}))};
  catalog.gameState.sourceBattleHandoffs=source;
  const make=()=>new GameState(catalog.gameState,catalog.common.players,catalog.contentHash,catalog.common.conditions);
  return {state:make(),make,catalog,source,conditions:new BattleConditions(catalog.common.conditions)};
}
const capture={battleSerial:0,encounterId:1000,programHash:'c'.repeat(64),pc:31};
const raw=(selector:string)=>({type:1,mnemonic:'SysCall',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:[selector,...Array(7).fill('')]}});
test('handoff decoders reject every nonzero reserved operand and preserve the Colosseum start dependency gate',()=>{
  for(const [selector,command] of [['コロシアム回復','colosseum-recovery'],['バトルデータ復元：sc_b_0055','restore-0055']] as const){
    assert.deepEqual(compileSourceBattleHandoffInstruction(raw(selector)),{kind:'source-battle-handoff',command});
    for(const field of ['iValues','rValues','sValues'] as const)for(let i=field==='sValues'?1:0;i<8;i++){
      const input=raw(selector);(input.operands[field] as (number|string)[])[i]=field==='sValues'?'x':1;assert.throws(()=>compileSourceBattleHandoffInstruction(input),/reserved/);
    }
    for(const type of [0,2,3])assert.throws(()=>compileSourceBattleHandoffInstruction({...raw(selector),type}),/MainCore/);
  }
  assert.throws(()=>compileSourceBattleHandoffInstruction(raw('コロシアム開始')),/bet\/opponent/);
});
test('catalog keeps native row identity, Type and UntilType independent and rejects missing/duplicate data',()=>{
  const catalog=compileSourceBattleHandoffCatalog({'condition.csv':[{id:'19',condition_type:'5',until_type:'3'},{id:'5',condition_type:'607',until_type:'0'}]},'source');
  assert.deepEqual(catalog.conditions,[{id:19,type:5,untilType:3},{id:5,type:607,untilType:0}]);
  assert.throws(()=>compileSourceBattleHandoffCatalog({},'source'),/Missing/);
  assert.throws(()=>compileSourceBattleHandoffCatalog({'condition.csv':[{id:'1',condition_type:'5',until_type:'3'},{id:'1',condition_type:'6',until_type:'3'}]},'source'),/master/);
});
test('actual capture uses numeric owned identity and UntilType3 maps row ID to native Type; restore never launders an unclosed add',()=>{
  const {state,source,conditions}=fixture(),roster=state.snapshot().roster;
  const history=captureSourceTakeOver0055(source,roster,[{...roster[0]!,hp:0,mp:2,conditionIds:[305,304]}],capture);
  assert.deepEqual(history.characters.map(p=>[p.id,p.ownedId,p.hp,p.mp,p.conditionTypes]),[['a',1,0,2,[5]]]);
  assert.throws(()=>projectSourceRestore0055(roster,history,source,conditions),/Type5.*field AddCondition/);
  assert.throws(()=>projectSourceRestore0055(roster,undefined,source,conditions),/actual prior/);
  const forged=structuredClone(history);forged.characters[0]!.conditionTypes=[305];
  assert.throws(()=>validateSourceBattleHandoffState({takeOver0055:forged},source,roster),/ConditionId/);
  forged.characters[0]!.conditionTypes=[5];forged.characters[0]!.ownedId=roster[1]!.ownedId;
  assert.throws(()=>validateSourceBattleHandoffState({takeOver0055:forged},source,roster),/identity/);
});
test('Colosseum recovers only the ScenarioVariable6 owned ID within current Corps, preserving disabled owners and native refresh order',()=>{
  const {state,conditions}=fixture(),before=state.snapshot(),roster=before.roster;
  roster[0]!.enabled=false;roster[0]!.hp=0;roster[0]!.mp=2;roster[0]!.conditionIds=[305];
  roster[1]!.hp=40;
  const projected=projectSourceColosseumRecovery(roster,before.party,1,conditions);
  assert.deepEqual(projected.targets,['a']);assert.deepEqual(projected.steps[0]!.roster.map(p=>[p.hp,p.mp,p.conditionIds]),[[1,2,[304]],[40,28,[]]]);
  assert.deepEqual(projected.roster.map(p=>[p.hp,p.mp,p.conditionIds]),[[130,28,[]],[40,28,[]]]);
  assert.equal(projected.roster[0]!.enabled,false);assert.deepEqual(roster[0]!.conditionIds,[305]);
  assert.deepEqual(projectSourceColosseumRecovery(roster,before.party,99,conditions).targets,[]);
});
test('owned live/draft handoffs share one generation, fence late host failures and preserve old schema without actual facts',()=>{
  const {state,make}=fixture(),injured=state.snapshot();injured.roster[0]!.hp=50;state.restore(injured);
  assert.equal(state.snapshot().formatVersion,12);assert.equal(Object.hasOwn(state.snapshot(),'sourceBattleHandoffs'),false);
  const tx=state.fieldSourceBattleHandoffs.prepare('colosseum-recovery',1),draft=state.prepareFieldState(),pending=draft.ports.sourceBattleHandoffs.prepare('colosseum-recovery',1);
  assert.throws(()=>tx.commitWith(()=>{throw Error('late host');}),/late host/);assert.deepEqual(state.snapshot(),injured);
  tx.commit();assert.throws(tx.commit,/Stale/);assert.throws(pending.commit,/Stale/);assert.equal(draft.commit(),false);
  assert.equal(state.snapshot().roster[0]!.hp,130);assert.equal(state.snapshot().formatVersion,12);
  const restored=make();restored.restore(state.snapshot());assert.deepEqual(restored.snapshot(),state.snapshot());
  const candidate=restored.prepareFieldState(),obsolete=candidate.ports.sourceBattleHandoffs.prepare('colosseum-recovery',1);
  candidate.ports.inventory.prepare({kind:'grant-gil',amount:1}).commit();assert.throws(obsolete.commit,/Stale/);
  candidate.ports.sourceBattleHandoffs.prepare('colosseum-recovery',2).commit();assert(candidate.commit());
});
test('source final queue is the exact interleaved numeric Corps1/2 order, never sourceId order',()=>{
  const {state,source}=fixture(),roster=state.snapshot().roster,party=emptyPartyState();
  party.slots[1][2].id='a';party.slots[2][0].id='b';
  assert.deepEqual(sourceFinalWaiting(party,roster,source).ownedIds,[2,1]);
});

test('waiting returns may consume only an original prefix and empty owned17 facts cannot grant history',()=>{
  const {state,source}=fixture(),roster=state.snapshot().roster,entry={kind:'source-final-waiting-v1' as const,sourceSetHash:source.sourceSetHash,ownedIds:[1,2]};
  assert.deepEqual(projectSourceHandoffReturn({finalWaiting:entry},{finalWaiting:{entry,remaining:{...entry,ownedIds:[2]}}},source,roster)?.finalWaiting?.ownedIds,[2]);
  for(const ownedIds of [[2,1],[1],[2,1,2]])assert.throws(()=>projectSourceHandoffReturn({finalWaiting:entry},{finalWaiting:{entry,remaining:{...entry,ownedIds}}},source,roster),/prefix/);
  const forged=state.snapshot();forged.formatVersion=17;forged.sourceBattleHandoffs={};assert.throws(()=>state.restore(forged),/Empty/);
});

test('ephemeral actual entry rejects another catalog/lease, repeated held identities and a mismatched condition master',()=>{
  const {state,catalog}=fixture(),lease=state.openBattle(1000),entry=state.sourceBattleHandoffEntry(lease);
  assert.deepEqual(parseSourceBattleHandoffEntry(entry),entry);
  const repeated=structuredClone(entry);repeated.roster[1]!.ownedId=repeated.roster[0]!.ownedId;assert.throws(()=>parseSourceBattleHandoffEntry(repeated),/identity/);
  assert.throws(()=>parseSourceBattleHandoffEntry({...entry,battleSerial:-1}),/lease/);
  const content=encounterContent(catalog,1000)!;
  assert.throws(()=>new BattleGame(content,1,undefined,undefined,undefined,undefined,undefined,undefined,{sourceHandoffs:{...entry,catalogHash:'another'}}),/another actual catalog/);
  const wrong=structuredClone(entry);wrong.catalog.conditions[0]!.type++;
  assert.throws(()=>new BattleGame(content,1,undefined,undefined,undefined,undefined,undefined,undefined,{sourceHandoffs:wrong}),/condition master/);
});
