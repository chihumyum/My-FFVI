import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRosterLifecycleEvent, rosterLifecycleSelectors, rosterLifecycleKnownSelectors } from '../src/compiler/roster.js';
import { decodeFieldOp } from '../src/compiler/field.js';
import { rosterNativeSelectors } from '../src/compiler/roster-selectors.js';
import { executeRosterLifecycleEvent, prepareRosterLifecycle, validateRosterCommand } from '../src/core/roster.js';
import { equipmentCatalog, equipmentRoster, fixtureEquipmentGrants } from './fixtures/equipment.js';
import { initialEquipmentStock } from '../src/core/equipment.js';
import { fixtureParty } from './fixtures/party.js';
import { sourcePartySelectionSessionFixture, selectionHost } from './fixtures/source-party-selection-session.js';
import { sealBatchContent } from './fixtures/content-batch.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { GameMapLoader } from '../src/core/game-map-loader.js';
import { GameSession } from '../src/core/game-session.js';
import type { Op } from '../src/field/types.js';

type Mnemonic={mnemonic:string;type:number;operands:{iValues:number[];rValues:number[];sValues:string[]}};
const raw=(selector:string):Mnemonic=>({mnemonic:'SysCall',type:1,operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:[selector,...Array(7).fill('')]}});
const source={file:'authored-roster-family',assetPath:'controlled-roster'};
const site={script:'authored-roster-family',index:0,source};
const tables={ 'character_status.csv':Array.from({length:34},(_,i)=>({id:String(i+1),job_id:'12'})), 'job.csv':[{id:'12'}] };

test('all 62 native registrations retain 57 ordinary commands, two grouped commands and three specific owner gates',()=>{
  assert.equal(rosterLifecycleKnownSelectors.length,62);assert.equal(rosterLifecycleSelectors.length,57);
  const counts={join:0,secede:0,reserve:0};
  for(const selector of rosterLifecycleKnownSelectors){
    const binding=rosterNativeSelectors[selector]!,decoded=decodeFieldOp(raw(selector),site,{},tables);
    if(binding.command){assert.equal(decoded.kind,'roster');const op=compileRosterLifecycleEvent(selector,tables);counts[op.command.kind as keyof typeof counts]++;
      assert.deepEqual(op.command,binding.command);assert.deepEqual(op.dependencies,[{table:'character_status.csv',id:op.command.sourceId},{table:'job.csv',id:12}]);
      op.command.sourceId=999;assert.notEqual(compileRosterLifecycleEvent(selector,tables).command.sourceId,999);
    }else if(selector==='メンバー加入：モーグリたち'||selector==='メンバー離脱：モーグリたち'){assert.equal(decoded.kind,'roster-group');}
    else {assert.equal(decoded.kind,'blocked');assert.match(decoded.kind==='blocked'?decoded.reason:'',/Unimplemented roster lifecycle selector.*native 0x/);}
    for(const corrupt of [(m:Mnemonic)=>{m.operands.iValues[7]=1;},(m:Mnemonic)=>{m.operands.sValues[1]='unexpected';},(m:Mnemonic)=>{m.type=0;},(m:Mnemonic)=>{m.operands.rValues.pop();}]){
      const m=raw(selector);corrupt(m);assert.equal(decodeFieldOp(m,site,{},tables).kind,'blocked');
    }
  }
  assert.deepEqual(counts,{join:18,secede:24,reserve:15});
  assert.equal(compileRosterLifecycleEvent('メンバー加入：モグ',tables).command.kind,'join');
  for(const selector of ['メンバー加入：モグ','メンバー加入：モグ（ナルシェSIM）','メンバー加入：ケフカ']){
    const command=compileRosterLifecycleEvent(selector,tables).command;assert.equal(command.kind,'join');if(command.kind==='join')assert.equal(command.refitEquipment,true);
  }
  assert.throws(()=>compileRosterLifecycleEvent('toString',tables),/Unimplemented/);
  assert.throws(()=>compileRosterLifecycleEvent('控えに移動：ティナ',{'character_status.csv':[],'job.csv':[]}),/character_status/);
});

test('reserve preserves the complete held owner, current empty row, other groups and stock, without initialization or recovery',()=>{
  const equipment=equipmentCatalog();const roster=equipmentRoster(equipment).map((member,i)=>({...member,ownedId:i+1,enabled:true,jobId:i+1,additionalLevel:6,magicStoneId:0,ownedJobs:[{id:i+1,level:1,proficiency:0}],hp:7,mp:2,learned:[99],conditionIds:[123]}));
  const state={roster,party:fixtureParty(roster.map(m=>m.id)),equipmentStock:initialEquipmentStock(equipment,roster,fixtureEquipmentGrants(equipment)),releasedJobIds:[1,2]};
  state.party.slots[0][0]!.row='back';state.party.slots[1][2]={id:roster[0]!.id,row:'front'};
  const before=structuredClone(state),command={kind:'reserve' as const,sourceId:roster[0]!.sourceId,refreshActors:true as const};
  const providers={validateMember:()=>{},initialize:()=>{throw new Error('Must never initialize');},projectEquipment:()=>{throw new Error('Must never unequip');},recover:()=>{throw new Error('Must never recover');}};
  const result=prepareRosterLifecycle(state,command,{equipment,jobIds:[1,2]},providers);
  assert.deepEqual(state,before);assert.deepEqual(result.state.roster,before.roster);assert.deepEqual(result.state.equipmentStock,before.equipmentStock);assert.deepEqual(result.state.releasedJobIds,before.releasedJobIds);
  assert.deepEqual(result.state.party.slots[0][0],{id:null,row:'back'});assert.deepEqual(result.state.party.slots.slice(1),before.party.slots.slice(1));assert.equal(result.refreshActors,true);
  const again=prepareRosterLifecycle(result.state,command,{equipment,jobIds:[1,2]},providers);assert.deepEqual(again.state,result.state);assert.equal(again.refreshActors,true);
  assert.throws(()=>prepareRosterLifecycle(state,{...command,sourceId:99},{equipment,jobIds:[1,2]},providers),/unowned character/);
  assert.throws(()=>validateRosterCommand({...command,refreshActors:false} as never),/reserve refresh/);
  assert.throws(()=>validateRosterCommand({...command,removeEquipment:true} as never),/checkpoint/i);
});

function sessionFixture(){
  const f=sourcePartySelectionSessionFixture();
  for(const [name,selector]of [['roster-join','メンバー加入：カイエン'],['roster-reserve','控えに移動：カイエン'],['roster-secede','メンバー離脱：カイエン'],['roster-unowned','控えに移動：シャドウ'],['roster-special','メンバー加入：ガウ']]){
    const decoded=decodeFieldOp(raw(selector!),{...site,script:name!}, {},tables);
    f.map.scripts[name!]=[{...decoded,index:0},{kind:'wait',seconds:.01,script:name!,index:1,source},{kind:'exit',script:name!,index:2,source}]as Op[];
    f.map.scriptPuppetContexts![name!]={...f.map.scriptPuppetContexts!.reserved!};(f.map.scriptSystemFlags??={})[name!]={keepBadStatusVisual:false};f.map.scriptLocals![name!]=null;
  }
  Object.assign(f.map,sealBatchContent(f.map));f.world.maps[f.map.mapId]!.contentHash=f.map.contentHash;
  Object.assign(f.world,sealBatchContent(f.world));f.content.mapContentHash=f.map.contentHash;f.content.worldCatalogHash=f.world.contentHash;Object.assign(f.content,sealBatchContent(f.content));return f;
}
function drain(h:ReturnType<ReturnType<typeof sessionFixture>['make']>){for(let i=0;i<100&&!h.game.checkpointReady;i++)h.flow.advance(10,selectionHost);assert(h.game.checkpointReady,h.game.field.stop?.message);}
function run(h:ReturnType<ReturnType<typeof sessionFixture>['make']>,script:string){assert(h.game.field.startEvent(script));h.flow.advance(10,selectionHost);drain(h);}

test('actual source Session rejoin → organization → real battle victory → reserve/secede → Storage → next-map failure/cancel/retry',async()=>{
  const f=sessionFixture(),h=f.make(),initial=h.game.state.snapshot(),second=initial.roster.find(m=>m.sourceId===3)!;
  run(h,'roster-secede');assert.equal(h.game.state.snapshot().roster.find(m=>m.sourceId===3)!.enabled,false);
  run(h,'roster-join');const joined=h.game.state.snapshot();assert.equal(joined.roster.find(m=>m.sourceId===3)!.enabled,true);assert.equal(joined.roster.find(m=>m.sourceId===3)!.ownedId,second.ownedId);
  h.flow.pause(true);assert(h.commands.changeParty({expected:h.game.partyMenu().expected,change:{kind:'set-member',slot:1,position:0,ownedId:initial.roster[0]!.id,row:'front'}}));assert(h.commands.changeParty({expected:h.game.partyMenu().expected,change:{kind:'set-member',slot:1,position:2,ownedId:second.id,row:'back'}}));assert(h.commands.changeParty({expected:h.game.partyMenu().expected,change:{kind:'select-slot',slot:1}}));h.flow.pause(false);
  const organized=h.game.state.snapshot();assert.deepEqual(organized.party.slots[1][2],{id:second.id,row:'back'});
  assert(h.game.field.startEvent('stone-battle'));h.flow.advance(10,selectionHost);assert(h.game.battle);assert.deepEqual(h.game.battle.players.map(p=>p.id),[initial.roster[0]!.id,second.id]);
  for(let i=0;h.game.battle.phase==='active';i++){
    assert(i<3000);for(const actor of h.game.battle.ready)h.game.battle.command(actor.id,10,h.game.battle.enemies[0]!.id,100);h.flow.advance(10,selectionHost);
  }
  assert.equal(h.game.battle.phase,'victory');assert(h.game.continueVictory());drain(h);
  const returned=h.game.state.snapshot();assert.equal(returned.completedBattles.length,1);assert.equal(returned.completedBattles[0]!.outcome,'victory');assert.equal(returned.gil,organized.gil+7);
  run(h,'roster-reserve');const reserved=h.game.state.snapshot();assert.deepEqual(reserved.roster,returned.roster);assert.deepEqual(reserved.equipmentStock,returned.equipmentStock);assert.deepEqual(reserved.party.slots[1][2],{id:null,row:'back'});assert.deepEqual(reserved.party.slots[0],returned.party.slots[0]);
  // The ordinary source join fills the first empty cell of the selected group.
  run(h,'roster-join');assert.equal(h.game.state.snapshot().party.slots[1][1]!.id,second.id);run(h,'roster-secede');
  const left=h.game.state.snapshot();assert.equal(left.roster.find(m=>m.sourceId===3)!.enabled,false);assert.equal(left.completedBattles.length,1);
  // Current group retains its first enabled owner. Other groups still hold the
  // disabled saved reference, which the menu correctly refuses to select.
  const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});(await storage.prepareSave(h.game.checkpoint(),0)).commit();
  const loaded=(await storage.load())!.checkpoint,restored=f.restore(loaded);assert.deepEqual(restored.checkpoint(),h.game.checkpoint());
  assert(h.game.field.startEvent('selection-leave'));h.flow.advance(10,selectionHost);assert.equal(h.game.field.stop?.kind,'map-transition');
  const stable=h.game.state.snapshot(),old=h.game.field;let mode='fail',entered!:(v:null)=>void,release!:(v:null)=>void;const pending=new Promise<null>(resolve=>{entered=resolve;});
  const loader=new GameMapLoader(h.flow,f.repository,{prepare:async()=>{if(mode==='fail')throw new Error('Controlled roster map media failure');if(mode==='hold'){entered(null);return new Promise<null>(resolve=>{release=resolve;});}return null;},discard(){}});
  assert.equal((await loader.load()).status,'failed');assert.equal(h.game.field,old);assert.deepEqual(h.game.state.snapshot(),stable);
  mode='hold';const loading=loader.load();await pending;loader.cancel();release(null);assert.equal((await loading).status,'cancelled');assert.deepEqual(h.game.state.snapshot(),stable);
  mode='pass';assert.equal((await loader.load()).status,'committed');drain(h);assert.deepEqual(h.game.state.snapshot(),stable);
  const afterMap=h.game.checkpoint();const again=GameSession.restore(afterMap,undefined,f.battle,{catalog:f.world,map:f.target,source:{content:f.content,initialMap:f.map}},f.runtime);assert.deepEqual(again.checkpoint(),afterMap);
});

test('actual actor preflight failure leaves roster and actors untouched; retry publishes exactly once; unknown owners remain hard',()=>{
  const f=sessionFixture(),h=f.make(),before=h.game.state.snapshot(),actor=h.game.field.nativeActorStateFingerprint;
  const prepared=h.game.state.fieldRoster.prepare({kind:'reserve',sourceId:3,refreshActors:true});
  const op=compileRosterLifecycleEvent('控えに移動：カイエン',tables);let preparedActors=0;
  assert.throws(()=>executeRosterLifecycleEvent(op,h.game.state.fieldRoster,(_members,appearance)=>{
    const actual=h.game.field.prepareMenuPartyAppearance(appearance!);preparedActors++;
    return Object.assign(()=>actual(),{validate(){actual.validate();throw new Error('Controlled actual actor preflight failure');}});
  }),/Controlled actual actor preflight/);assert.equal(preparedActors,1);assert.deepEqual(h.game.state.snapshot(),before);assert.equal(h.game.field.nativeActorStateFingerprint,actor);
  run(h,'roster-reserve');const after=h.game.state.snapshot();assert.notDeepEqual(after.party,before.party);assert.deepEqual(after.roster,before.roster);assert.throws(prepared.commit,/Stale/);
  for(const name of ['roster-unowned','roster-special']){
    const fresh=f.make(),owned=fresh.game.state.snapshot(),native=fresh.game.field.nativeActorStateFingerprint;assert(fresh.game.field.startEvent(name));fresh.flow.advance(10,selectionHost);
    assert.equal(fresh.game.field.stop?.kind,'unsupported');assert.match(fresh.game.field.stop!.message,name==='roster-unowned'?/unowned character/:/Gau join native learned/);assert.deepEqual(fresh.game.state.snapshot(),owned);assert.equal(fresh.game.field.nativeActorStateFingerprint,native);
  }
});
