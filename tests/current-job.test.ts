import {projectBattleAbilities}from'../src/core/battle-abilities.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {originalJobPreludeSessionFixture,currentJobSessionFixture as fixture}from'./fixtures/current-job-session.js';
import {selectionHost as host}from'./fixtures/source-character-naming-session.js';
import {GameState}from'../src/core/game-state.js';import{hash}from'../src/compiler/content.js';
import{validateCurrentJobCatalog,projectCurrentJob,setReleasedJob}from'../src/core/current-job.js';
import{CheckpointStorage}from'../src/core/saved-game.js';
const make=()=>{const f=fixture();return{f,...f.make()};};
function switchJob(h:ReturnType<typeof make>){const s=h.game.state,owner=s.snapshot().roster.find(m=>m.id===h.f.id)!;
 s.prepareJobCommand({kind:'release',jobId:21}).commit();s.prepareJobCommand({kind:'switch',ownedId:owner.ownedId,jobId:21}).commit();}
test('generic release updates every actual owner, including disabled; global removal preserves individual proficiency/order',()=>{
 const h=make(),s=h.game.state,open=s.fieldCharacterNaming.prepareOpen({kind:'source-character-naming',sourceId:12,prelude:'none',completion:'first-join-level'});open.commitWith(()=>{});open.lease.prepareCompletion(false).commitWith(()=>{});
 s.prepareJobCommand({kind:'release',jobId:21}).commit();const released=s.snapshot();assert(released.roster.every(m=>m.ownedJobs.some(j=>j.id===21)));assert.equal(released.roster.find(m=>m.sourceId===12)!.enabled,false);
 s.prepareJobCommand({kind:'release',jobId:21}).commit();assert.deepEqual(s.snapshot(),released);
 s.prepareJobCommand({kind:'unrelease',jobId:21}).commit();const after=s.snapshot();assert(!after.releasedJobIds.includes(21));assert.deepEqual(after.roster,released.roster);
 const state={roster:structuredClone(after.roster),releasedJobIds:[] as number[]};state.roster[0]!.ownedJobs.find(j=>j.id===21)!.proficiency=87;
 setReleasedJob(state,[21],21,true);assert.equal(state.roster[0]!.ownedJobs.find(j=>j.id===21)!.proficiency,87);
});
test('released switch binds actual owned identity and complete context, preserves all resources/equipment/learning and rejects stale/failed publication',()=>{
 const h=make(),s=h.game.state,member=s.snapshot().roster.find(m=>m.id===h.f.id)!;
 assert.equal(s.prepareJobCommand({kind:'switch',ownedId:999,jobId:21}).changed,false);
 s.prepareJobCommand({kind:'release',jobId:21}).commit();const before=s.snapshot(),a=s.prepareJobCommand({kind:'switch',ownedId:member.ownedId,jobId:21}),b=s.prepareJobCommand({kind:'switch',ownedId:member.ownedId,jobId:21});
 assert.throws(()=>a.commitWith(()=>{throw Error('job publication failed');}),/publication failed/);assert.deepEqual(s.snapshot(),before);a.commit();assert.throws(()=>b.commit(),/Stale/);
 const after=s.snapshot(),expected=structuredClone(before);expected.roster.find(m=>m.id===h.f.id)!.jobId=21;assert.deepEqual(after,expected);
 assert.equal(s.characterGrowthPlan(h.f.id)!.jobId,21);assert.equal(s.currentEquipmentCatalog!.characters[3]!.jobId,21);
 assert.throws(()=>s.prepareJobCommand({kind:'switch',ownedId:1,jobId:21}),/current job context/);
 assert.throws(()=>s.prepareJobCommand({kind:'switch',ownedId:999,jobId:21}),/actual owned/);
 assert.throws(()=>s.prepareJobCommand({kind:'release',jobId:999}),/master/);
});
test('complete growth/parameters/equipment/name/media equality is required; legacy content never gets a context from saves',()=>{
 for(const mutate of [
  (f:ReturnType<typeof fixture>)=>{f.battle.gameState.currentJobs!.contexts[0]!.growth.growth[0]!.hp++;},
  (f:ReturnType<typeof fixture>)=>{f.battle.gameState.currentJobs!.contexts[0]!.growth.learning.reverse();},
  (f:ReturnType<typeof fixture>)=>{f.battle.gameState.currentJobs!.contexts[0]!.parameters.parameters.additional.hp++;},
  (f:ReturnType<typeof fixture>)=>{f.battle.gameState.currentJobs!.contexts[0]!.equipment.dominantArm=2;},
  (f:ReturnType<typeof fixture>)=>{f.battle.gameState.currentJobs!.contexts[0]!.nameKey='wrong';},
  (f:ReturnType<typeof fixture>)=>{f.battle.gameState.equipmentSystem!.catalog.definitions[101]!.jobIds=[12];},
  (f:ReturnType<typeof fixture>)=>{f.battle.gameState.partyActors!.characterAssets.find(r=>r.sourceId===3&&r.jobId===21)!.fieldAssetId=1;},
 ]){const f=fixture();mutate(f);const o=f.battle.gameState;assert.throws(()=>validateCurrentJobCatalog(o.currentJobs!,{templates:o.characterInitializations!,growth:o.characterGrowth!,equipment:o.equipmentSystem!.catalog,parameters:o.equipmentSystem!.contexts,partyActors:o.partyActors!}),/context|eligibility|asset/);}
 const h=make();switchJob(h);const saved=h.game.state.snapshot(),o=structuredClone(h.f.battle.gameState);delete o.currentJobs;
 const legacy=GameState.createNewGame(o,h.f.battle.common.players,hash(o),h.f.battle.common.conditions),tampered=structuredClone(saved);tampered.catalogHash=hash(o);
 assert.throws(()=>legacy.restore(tampered),/current job context/);
 const fake=structuredClone(saved);fake.roster.find(m=>m.id===h.f.id)!.jobId=999;assert.throws(()=>h.game.state.restore(fake),/current job context/);
});
test('actual Session naming input, battle qualification/borrow/return, growth and Storage continue with the current job',async()=>{
 const h=make();switchJob(h);assert(h.game.field.startEvent('name-held'));h.flow.advance(10,host);const r=h.commands.characterNaming()!;assert(r);assert(h.commands.submitCharacterName(r.token,'Job name'));assert(h.commands.confirmCharacterName(r.token,true));
 for(let i=0;i<100&&!h.game.checkpointReady;i++)h.flow.advance(10,host);assert(h.game.checkpointReady,h.game.field.stop?.message);
 assert.equal(h.game.characterMenu(h.f.id).name,'Job name');const before=h.game.state.snapshot(),job=before.roster.find(m=>m.id===h.f.id)!;h.f.startBattle(h.game);
 assert.equal(h.game.battle!.players.find(m=>m.id===h.f.id)!.ownedAbilities!.jobId,21);assert.throws(()=>h.game.state.prepareJobCommand({kind:'unrelease',jobId:21}),/battle/i);
 h.f.previewVictory(h.game);const pending=h.game.prepareBattleReturn()!;pending.discard();assert.deepEqual(h.game.state.snapshot(),before);assert(h.game.prepareBattleReturn()!.commit());h.game.advance(10);assert(h.game.checkpointReady,h.game.field.stop?.message);
 const after=h.game.state.snapshot().roster.find(m=>m.id===h.f.id)!;assert.equal(after.jobId,21);assert.equal(after.name,'Job name');assert.deepEqual(after.ownedJobs,job.ownedJobs);assert(after.exp>=job.exp);
 const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});(await storage.prepareSave(h.game.checkpoint(),0)).commit();assert.deepEqual(h.f.restore((await storage.load())!.checkpoint).checkpoint(),h.game.checkpoint());
});
test('unknown commands do not invoke an admission callback or mutate released owners',()=>{
 const state={roster:[] as never[],releasedJobIds:[21]};let calls=0;assert.throws(()=>projectCurrentJob(state,[21],{kind:'bogus',jobId:21}as never,()=>{calls++;}));assert.equal(calls,0);
});

test('real prelude phases precede actual input; later No/failed input preserve committed job and default name, repeat skips reset',async()=>{
 const f=originalJobPreludeSessionFixture(),h=f.make(),before=h.game.state.snapshot();assert(h.game.field.startEvent('name-prelude'));h.flow.advance(10,host);
 const r=h.commands.characterNaming()!;assert(r,h.game.field.stop?.message);const opened=h.game.state.snapshot(),owner=opened.roster.find(m=>m.id===f.id)!;
 assert.equal(owner.jobId,1);assert.equal(owner.name,'Original default');assert(!opened.releasedJobIds.includes(19));assert(opened.roster.every(m=>m.ownedJobs.some(j=>j.id===1)));
 const expected=structuredClone(before),m=expected.roster.find(m=>m.id===f.id)!;m.jobId=1;m.name='Original default';expected.characterNames[f.battle.gameState.characterInitializations![f.id]!.nameTag!]=m.name;
 assert.deepEqual(opened,expected);assert.throws(()=>h.commands.submitCharacterName(r.token,''),/empty/);assert.deepEqual(h.game.state.snapshot(),opened);
 assert(h.commands.submitCharacterName(r.token,'User name'));assert(h.commands.confirmCharacterName(r.token,false));assert.deepEqual(h.game.state.snapshot(),opened);
 assert(h.commands.submitCharacterName(r.token,'User name'));assert(h.commands.confirmCharacterName(r.token,true));for(let i=0;i<100&&!h.game.checkpointReady;i++)h.flow.advance(10,host);assert(h.game.checkpointReady);
 f.startBattle(h.game);assert.equal(h.game.battle!.players.find(m=>m.id===f.id)!.ownedAbilities!.jobId,1);f.previewVictory(h.game);assert(h.game.prepareBattleReturn()!.commit());h.game.advance(10);assert(h.game.checkpointReady);
 const checkpoint=h.game.checkpoint();assert.deepEqual(f.restore(checkpoint).checkpoint(),checkpoint);const stable=h.game.state.snapshot();h.game.field.startEvent('name-prelude');h.flow.advance(10,host);assert.equal(h.commands.characterNaming()!.model.currentName,'User name');assert.deepEqual(h.game.state.snapshot(),stable);
});

test('growth history before and after switching is preserved without learning replay or grants; battle ABA fences prepared jobs',()=>{
 const h=make();h.f.win(h.game);const grown=h.game.state.snapshot().roster.find(m=>m.id===h.f.id)!;assert(grown.growth!.history!.some(r=>r.kind==='status-up'));switchJob(h);
 const current=h.game.state.snapshot().roster.find(m=>m.id===h.f.id)!;assert.deepEqual(current.growth,grown.growth);assert.deepEqual(current.abilities,grown.abilities);
 const pending=h.game.state.prepareJobCommand({kind:'unrelease',jobId:21}),lease=h.game.state.openBattle(77,{kind:'battle-reward-policy-v1',ap:0,magicPoints:0});h.game.state.cancelBattle(lease);assert.throws(()=>pending.commit(),/Stale/);
 h.f.win(h.game);assert.equal(h.game.state.snapshot().roster.find(m=>m.id===h.f.id)!.jobId,21);
});

test('candidate-map job prelude uses one draft generation and never mutates live on discard or failed publication',()=>{
 const f=originalJobPreludeSessionFixture(),s=f.make().game.state,before=s.snapshot(),command={kind:'source-character-naming' as const,sourceId:1,prelude:'original-job' as const,completion:'none' as const};
 const staleDraft=s.prepareFieldState(),stale=staleDraft.ports.characterNamingPort.prepareOpen(command);staleDraft.ports.inventory.prepare({kind:'grant-gil',amount:1}).commit();assert.throws(()=>stale.commitWith(()=>{}),/Stale/);assert.deepEqual(s.snapshot(),before);
 const draft=s.prepareFieldState(),q=draft.ports.characterNamingPort.prepareOpen(command);assert.throws(()=>q.commitWith(()=>{throw Error('candidate publication failed');}),/publication failed/);assert.deepEqual(s.snapshot(),before);
 q.commitWith(()=>{});assert.deepEqual(s.snapshot(),before);assert(draft.sealPublication()());assert(draft.commit());assert.equal(s.snapshot().roster.find(m=>m.id===f.id)!.jobId,1);
 q.lease.prepareName('Draft name').commitWith(()=>{});q.lease.prepareCompletion(false).commitWith(()=>{});assert.equal(s.snapshot().roster.find(m=>m.id===f.id)!.name,'Draft name');
});

test('battle metadata alone cannot grant jobs; actual owner must bind the exact set and source catalog',()=>{
 const h=make(),s=h.game.state,catalog=h.f.battle.common.battleAbilities!;
 const member=s.partyPlayers().find(m=>m.id===h.f.id)!.ownedAbilities!,context={conditionIds:[] as number[],battleType:0 as const,magicLearningValue:0,invalidContentIds:[] as number[],itemMenuAvailable:false,partySize:2};
 assert.throws(()=>projectBattleAbilities(catalog,{...member,jobId:21},context),/actual owned/);
 const host=s.battleJobQualification;host.validateCatalog(catalog,s.catalogHash);assert.throws(()=>host.validateCatalog(catalog,'different-source'),/another source catalog/);
 for(const mutate of [
  (c:typeof catalog)=>{delete c.characters.find(r=>r.sourceId===3)!.equivalentJobIds;},
  (c:typeof catalog)=>{c.characters.find(r=>r.sourceId===3)!.equivalentJobIds=[21,21];},
  (c:typeof catalog)=>{c.characters.find(r=>r.sourceId===3)!.equivalentJobIds=[22];},
  (c:typeof catalog)=>{c.characters.find(r=>r.sourceId===3)!.sourceId=99;},
  (c:typeof catalog)=>{c.characters.find(r=>r.sourceId===3)!.jobId=99;},
  (c:typeof catalog)=>{c.characters[0]!.equivalentJobIds=[];},
 ]){const changed=structuredClone(catalog);mutate(changed);assert.throws(()=>host.validateCatalog(changed),/metadata|source binding/);}
 const content=structuredClone(h.f.battle.gameState);delete content.currentJobs;const legacy=GameState.createNewGame(content,h.f.battle.common.players,hash(content),h.f.battle.common.conditions);
 assert.throws(()=>legacy.battleJobQualification.validateCatalog(catalog),/metadata/);
});
