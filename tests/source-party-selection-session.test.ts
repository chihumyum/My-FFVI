import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcePartySelectionSessionFixture,selectionHost } from './fixtures/source-party-selection-session.js';
import { GameCommands } from '../src/core/game-commands.js';
import { emptyPartyState } from '../src/core/party.js';
import { projectSourcePartySelection } from '../src/core/source-party-selection.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { GameMapLoader } from '../src/core/game-map-loader.js';
function open(f:ReturnType<typeof sourcePartySelectionSessionFixture>,mode='one') {
  const h=f.make();assert(h.game.field.startEvent('selection-'+mode));h.flow.advance(10,selectionHost);
  assert.equal(h.flow.phase,'party-selection',h.game.field.stop?.message);return h;
}
function drain(h:ReturnType<typeof open>){for(let i=0;i<100&&!h.game.checkpointReady;i++)h.flow.advance(10,selectionHost);assert(h.game.checkpointReady,h.game.field.stop?.message);}
test('actual native source UI waits, freezes field clock, pauses, commits three groups once and restores without an initialization replay',async()=>{
  const f=sourcePartySelectionSessionFixture(),h=open(f,'two'),{game,flow,commands}=h;
  const pending=commands.sourcePartySelection()!,before=game.state.snapshot(),native=game.field.actors['-1001'],time=game.field.time;
  const edited=emptyPartyState().slots;edited[0][0].id=before.roster[1]!.id;edited[1][2].id=before.roster[0]!.id;
  pending.model.initial.slots[0][0].id='forged';flow.advance(1000,selectionHost);
  assert.equal(game.field.time,time);assert.deepEqual(game.state.snapshot(),before);assert.equal(game.checkpointReady,false);
  assert.throws(()=>game.checkpoint());assert.equal(flow.move('right'),false);
  flow.pause(true);assert.equal(commands.completeSourcePartySelection(pending.token,{kind:'confirm',slots:edited}),false);
  flow.pause(false);flow.observeHost({...selectionHost,mediaReady:false});assert.equal(commands.completeSourcePartySelection(pending.token,{kind:'cancel'}),false);
  flow.observeHost(selectionHost);assert(commands.completeSourcePartySelection(pending.token,{kind:'confirm',slots:edited}));
  assert.equal(commands.completeSourcePartySelection(pending.token,{kind:'cancel'}),false);drain(h);
  assert.equal(game.field.actors['-1001'],native);assert.deepEqual(game.state.snapshot().party,{selectedSlot:0,slots:edited});
  assert.deepEqual(game.field.partyActorCheckpoint!.context.multiParty.map(p=>p.leaderIndex),[0,2,0]);
  const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});
  (await storage.prepareSave(game.checkpoint(),0)).commit();const restored=f.restore((await storage.load())!.checkpoint);
  assert.deepEqual(restored.checkpoint(),game.checkpoint());
  restored.field.startEvent('stone-battle');restored.advance(10);assert(restored.battle);
  assert.deepEqual(restored.battle.players.map(p=>p.id),[before.roster[1]!.id]);
});
test('cancel preserves all saved cells/rows but applies source slot-zero selection and refresh exactly once',()=>{
  const f=sourcePartySelectionSessionFixture({selectedSecond:true}),h=open(f),before=h.game.state.snapshot(),request=h.commands.sourcePartySelection()!;
  assert.equal(before.party.selectedSlot,1);assert(h.commands.completeSourcePartySelection(request.token,{kind:'cancel'}));drain(h);
  assert.deepEqual(h.game.state.snapshot().party,{...before.party,selectedSlot:0});
});
test('owned and event ABA changes revoke the exact request, old channels cannot target replacement sessions',()=>{
  for(const domain of ['owned','event'] as const){const f=sourcePartySelectionSessionFixture(),h=open(f),r=h.commands.sourcePartySelection()!,before=h.game.state.snapshot();
    if(domain==='owned'){const tx=h.game.state.fieldInventory.prepare({kind:'grant-gil',amount:1});tx.commit();h.game.state.fieldInventory.prepare({kind:'pay-gil',amount:1}).commit();}
    else {const e=h.game.field.eventState,ref={category:'MapLocalVariable' as const,index:0},v=e.read(ref);e.write(ref,v+1);e.write(ref,v);}
    const current=h.game.state.snapshot();assert.throws(()=>h.commands.completeSourcePartySelection(r.token,{kind:'cancel'}),/Stale/);
    assert.deepEqual(h.game.state.snapshot(),current);assert.deepEqual(current.party,before.party);
    const next=f.make();h.flow.start(next.game);h.flow.observeHost(selectionHost);
    assert.equal(h.commands.completeSourcePartySelection(r.token,{kind:'cancel'}),false);assert(new GameCommands(h.flow,next.game));
  }
});
test('missing policy and insufficient source members remain actual provider failures',()=>{
  const strict=sourcePartySelectionSessionFixture({policy:false}).make();strict.game.field.startEvent('selection-one');strict.flow.advance(10,selectionHost);
  assert.equal(strict.game.field.stop?.kind,'unsupported');
  for(const mode of ['three','opera']){const h=sourcePartySelectionSessionFixture().make(),before=h.game.state.snapshot();h.game.field.startEvent('selection-'+mode);h.flow.advance(10,selectionHost);
    assert.equal(h.game.field.stop?.kind,'unsupported');assert.deepEqual(h.game.state.snapshot(),before);}
});
test('the final actual actor publication fence can fail, retry succeeds once and an old token cannot finish the next request',()=>{
  const f=sourcePartySelectionSessionFixture(),h=open(f),request=h.commands.sourcePartySelection()!,before=h.game.state.snapshot(),
    native=h.game.field.nativeActorStateFingerprint,party=h.game.field.partyActorCheckpoint;
  let reads=0;
  assert.throws(()=>h.game.completeSourcePartySelection(request.token,{kind:'cancel'},()=>{
    if(++reads===3)throw new Error('Controlled late actor publication failure');return true;
  }),/Controlled late actor publication/);
  assert.equal(reads,3);assert.deepEqual(h.game.state.snapshot(),before);
  assert.equal(h.game.field.nativeActorStateFingerprint,native);assert.deepEqual(h.game.field.partyActorCheckpoint,party);
  assert.equal(h.commands.sourcePartySelection()!.token,request.token);
  assert(h.commands.completeSourcePartySelection(request.token,{kind:'cancel'}));drain(h);
  assert(h.game.field.startEvent('selection-one'));h.flow.advance(10,selectionHost);
  const next=h.commands.sourcePartySelection()!;assert.notEqual(next.token,request.token);
  assert.equal(h.commands.completeSourcePartySelection(request.token,{kind:'cancel'}),false);
  assert(h.commands.completeSourcePartySelection(next.token,{kind:'cancel'}));drain(h);
});
test('a request opened inside a long public frame drops remaining UI time instead of becoming immediately stale',()=>{
  const f=sourcePartySelectionSessionFixture(),h=f.make();h.game.field.startEvent('selection-one');
  h.flow.advance(1234,selectionHost);assert.equal(h.flow.phase,'party-selection');
  const request=h.commands.sourcePartySelection()!,time=h.game.field.time;
  h.flow.advance(4567,selectionHost);assert.equal(h.game.field.time,time);
  assert(h.commands.completeSourcePartySelection(request.token,{kind:'cancel'}));drain(h);
});
test('completed selection survives actual map media failure, cancellation and retry without changing the live owner',async()=>{
  const f=sourcePartySelectionSessionFixture(),h=open(f),request=h.commands.sourcePartySelection()!,slots=emptyPartyState().slots;
  slots[0][0].id=h.game.state.snapshot().roster[1]!.id;
  assert(h.commands.completeSourcePartySelection(request.token,{kind:'confirm',slots}));drain(h);
  const field=h.game.field;field.startEvent('selection-leave');h.flow.advance(10,selectionHost);
  assert.equal(field.stop?.kind,'map-transition');const owned=h.game.state.snapshot(),native=field.nativeActorStateFingerprint;
  let mode:'fail'|'hold'|'pass'='fail',entered!:(value:unknown)=>void,release!:(value:null)=>void;
  const pending=new Promise(resolve=>{entered=resolve;});
  const loader=new GameMapLoader(h.flow,f.repository,{prepare:async()=>{
    if(mode==='fail')throw new Error('Controlled destination media failure');
    if(mode==='hold'){entered(null);return new Promise<null>(resolve=>{release=resolve;});}return null;
  },discard(){}});
  const failed=await loader.load();assert.equal(failed.status,'failed');
  if(failed.status!=='failed')assert.fail('Expected media failure');
  assert.match(String(failed.error),/Controlled destination media failure/);assert.equal(h.game.field,field);
  assert.deepEqual(h.game.state.snapshot(),owned);assert.equal(field.nativeActorStateFingerprint,native);
  mode='hold';const loading=loader.load();await Promise.race([pending,loading.then(r=>{throw new Error('Map preparation ended before media host: '+r.status+('error'in r?String(r.error):''));})]);loader.cancel();release(null);
  assert.equal((await loading).status,'cancelled');assert.equal(h.game.field,field);assert.deepEqual(h.game.state.snapshot(),owned);
  mode='pass';assert.equal((await loader.load()).status,'committed');assert.notEqual(h.game.field,field);
  assert.deepEqual(h.game.state.snapshot(),owned);assert.equal(h.commands.completeSourcePartySelection(request.token,{kind:'cancel'}),false);
});
test('a selection capture on the actual map draft rebinds to its single published owned identity and rejects subsequent ABA',()=>{
  const h=sourcePartySelectionSessionFixture().make(),draft=h.game.state.prepareFieldState(),
    port=draft.ports.sourcePartySelectionPort,captured=port.capture(),
    model=projectSourcePartySelection({kind:'source-party-selection',mode:'one'},captured.current,()=>0);
  captured.validate();assert(draft.sealPublication()());assert(draft.commit());captured.validate();
  const tx=port.prepare(model,{kind:'cancel'});tx.validate();tx.commitWith(()=>captured.validate());
  assert.throws(captured.validate,/Stale/);
});
test('the final host admission cannot change source flags and then authorize an obsolete actor publication',()=>{
  const h=open(sourcePartySelectionSessionFixture()),r=h.commands.sourcePartySelection()!,before=h.game.state.snapshot(),native=h.game.field.nativeActorStateFingerprint;
  let calls=0;
  assert.throws(()=>h.game.completeSourcePartySelection(r.token,{kind:'cancel'},()=>{
    if(++calls===3)h.game.field.eventState.write({category:'ScenarioFlag1',index:155},1);return true;
  }),/Stale/);
  assert.deepEqual(h.game.state.snapshot(),before);assert.equal(h.game.field.nativeActorStateFingerprint,native);
});
test('a destination initializer can suspend its own selection across publication without authorizing an old field token',async()=>{
  const f=sourcePartySelectionSessionFixture({destinationSelection:true}),h=f.make();h.game.field.startEvent('selection-leave');h.flow.advance(10,selectionHost);
  const old=h.game.field,loader=new GameMapLoader(h.flow,f.repository,{prepare:async candidate=>{
    assert.equal(h.game.field,old);assert.equal(h.commands.sourcePartySelection(),null);
    return candidate.currentSourcePartySelection?.token??null;
  },discard(){}}),result=await loader.load();assert.equal(result.status,'committed',result.status==='failed'?String(result.error):undefined);
  for(let i=0;i<10&&!h.commands.sourcePartySelection();i++)h.flow.advance(10,selectionHost);
  const request=h.commands.sourcePartySelection()!;assert(request);assert.notEqual(h.game.field,old);
  assert(h.commands.completeSourcePartySelection(request.token,{kind:'cancel'}));drain(h);
});
