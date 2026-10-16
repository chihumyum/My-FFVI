import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { sourceWebReplayRuntimePorts, sourceWebReplayFieldEffectsHost, sourceWebReplayPeriodicNumberHost } from './source-web-replay-runtime.mjs';

const root=resolve(import.meta.dirname,'..'),compiled=resolve(root,process.env.FFVI_REPLAY_PORTS_COMPILED??'dist'),
 load=path=>import(pathToFileURL(resolve(compiled,path+'.js')));

test('the detached Web replay policies are exactly the real app policy and current core constants',async()=>{
 const [{WEB_SOURCE_BOSS_ENTRY},{WEB_COMMITTED_BATTLE_RESULT},{WEB_PUPPET_ROUTE_POLICY},{WEB_SCRIPTED_BATTLE_ACTIONS},{WEB_SOURCE_PARTY_SELECTION},{WEB_BATTLE_EVENT_MESSAGE_POLICY},{WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE},{WEB_BATTLE_EVENT_CONTROLS},{WEB_BATTLE_EVENT_EFFECTS},{WEB_BATTLE_BRANCH_EXECUTION}]=await Promise.all([load('src/core/source-boss-encounter'),load('src/core/source-battle-result'),load('src/core/field-puppet-route'),load('src/core/scripted-battle-action'),load('src/core/source-party-selection'),load('src/core/battle-event-message'),load('src/core/field-view-change'),load('src/core/battle-controls'),load('src/core/battle-event-effect'),load('src/core/battle-branch-execution')]),
  text=await readFile(resolve(root,'apps/game/app.js'),'utf8'),ast=ts.createSourceFile('app.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),imports=new Map();
 for(const node of ast.statements)if(ts.isImportDeclaration(node)&&node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings))for(const name of node.importClause.namedBindings.elements)imports.set(name.name.text,node.moduleSpecifier.text);
 let runtime;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='runtime')runtime=node.initializer;ts.forEachChild(node,visit);}visit(ast);
 assert.ok(runtime&&ts.isObjectLiteralExpression(runtime));
 const {WEB_FLAT_WORLD_AUTO_TASKS}=await load("src/core/field-world-auto-tasks");
 const {WEB_FLAT_WORLD_AUTO_MOVE}=await load("src/core/field-world-auto-move");
 const {WEB_FLAT_BIRD_VIEW_ACTORS}=await load("src/core/field-bird-view-actors");
 const {WEB_FLAT_MOB_COLOR_FILTER}=await load("src/core/field-mob-controls");
 const {WEB_BATTLE_GLOBAL_FADE}=await load("src/core/battle-global-fade");
 const {WEB_BATTLE_EVENT_CONDITIONS}=await load("src/core/battle-event-condition");
 const {WEB_BATTLE_CHILD_ADMISSION}=await load('src/core/battle-child-admission');
 const {WEB_RTS_PARTY_SWITCH}=await load('src/core/field-rts-party');
 const {WEB_FIELD_EFFECT_TRANSFORMS}=await load('src/core/field-effect-transforms');
 const {IMMUTABLE_OWNED_FIELD_SOURCE}=await load('src/core/field-source-snapshot');
 const {WEB_SOURCE_CHARACTER_NAMING}=await load('src/core/source-character-naming');
 const {WEB_BATTLE_PERIODIC_NUMBERS}=await load("src/core/battle-periodic-number");
 const expected={sourceFieldUi:[null,null,'web-source-field-ui-v1'],battlePeriodicNumbers:["WEB_BATTLE_PERIODIC_NUMBERS","/runtime/core/battle-periodic-number.js",WEB_BATTLE_PERIODIC_NUMBERS],sourceNonEncounterAreas:[null,null,'source-non-encounter-areas-v1'],transportationParkingUpload:[null,null,"web-source-transport-parking-upload-v1"],sourceSnapshot:[null,null,IMMUTABLE_OWNED_FIELD_SOURCE],rtsPartySwitch:['WEB_RTS_PARTY_SWITCH','/runtime/core/field-rts-party.js',WEB_RTS_PARTY_SWITCH],sourceCharacterNaming:['WEB_SOURCE_CHARACTER_NAMING','/runtime/core/source-character-naming.js',WEB_SOURCE_CHARACTER_NAMING],vehicleLifecycle:[null,null,"web-source-vehicle-lifecycle-v1"],fieldEffectTransforms:[null,null,WEB_FIELD_EFFECT_TRANSFORMS],battleChildPartyAdmission:['WEB_BATTLE_CHILD_ADMISSION','/runtime/core/battle-child-admission.js',WEB_BATTLE_CHILD_ADMISSION],skyboxPresentation:[null,null,"web-flat-skybox-panorama-v1"],battleEventConditions:[null,null,WEB_BATTLE_EVENT_CONDITIONS],battleGlobalFade:[null,null,WEB_BATTLE_GLOBAL_FADE],screenPresentation:[null,null,'web-field-screen-presentation-2d-v1'],mobColorFilter:[null,null,WEB_FLAT_MOB_COLOR_FILTER],birdViewActors:[null,null,WEB_FLAT_BIRD_VIEW_ACTORS],worldAutoMove:["WEB_FLAT_WORLD_AUTO_MOVE","/runtime/core/field-world-auto-move.js",WEB_FLAT_WORLD_AUTO_MOVE],worldAutoTasks:["WEB_FLAT_WORLD_AUTO_TASKS","/runtime/core/field-world-auto-tasks.js",WEB_FLAT_WORLD_AUTO_TASKS],battleBranchExecution:['WEB_BATTLE_BRANCH_EXECUTION','/runtime/core/battle-branch-execution.js',WEB_BATTLE_BRANCH_EXECUTION],battleEventEffects:[null,null,WEB_BATTLE_EVENT_EFFECTS],battleEventControls:['WEB_BATTLE_EVENT_CONTROLS','/runtime/core/battle-controls.js',WEB_BATTLE_EVENT_CONTROLS],viewChange:[null,null,WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE],battleEventMessages:['WEB_BATTLE_EVENT_MESSAGE_POLICY','/runtime/core/battle-event-message.js',WEB_BATTLE_EVENT_MESSAGE_POLICY],sourcePartySelection:['WEB_SOURCE_PARTY_SELECTION','/runtime/core/source-party-selection.js',WEB_SOURCE_PARTY_SELECTION],sourceBossEntry:['WEB_SOURCE_BOSS_ENTRY','/runtime/core/source-boss-encounter.js',WEB_SOURCE_BOSS_ENTRY],sourceBattleResult:['WEB_COMMITTED_BATTLE_RESULT','/runtime/core/source-battle-result.js',WEB_COMMITTED_BATTLE_RESULT],puppetRoutes:[null,null,WEB_PUPPET_ROUTE_POLICY],scriptedBattleActions:['WEB_SCRIPTED_BATTLE_ACTIONS','/runtime/core/scripted-battle-action.js',WEB_SCRIPTED_BATTLE_ACTIONS]},first=sourceWebReplayRuntimePorts();
 const {WEB_FIELD_LAYER_SCROLLING}=await load('src/core/field-layer-scrolling');
 expected.fieldLayerScrolling=[null,null,WEB_FIELD_LAYER_SCROLLING];
 assert.deepEqual(Object.keys(first).sort(),Object.keys(expected).sort());assert.equal(Object.isFrozen(first),true);
 for(const[key,[identifier,path,value]]of Object.entries(expected)){const field=runtime.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(ast)===key);assert.ok(field);if(identifier===null){assert.ok(ts.isStringLiteral(field.initializer));assert.equal(field.initializer.text,value);}else{assert.equal(field.initializer.getText(ast),identifier);assert.equal(imports.get(identifier),path);}assert.equal(first[key],value);}
 assert.throws(()=>{first.sourceBattleResult='fallback-zero';});assert.notEqual(first,sourceWebReplayRuntimePorts());assert.deepEqual(sourceWebReplayRuntimePorts(),first);
});

test('the same two fields reach a real source-initialized Session and retain the missing-frame and native-actor gates',async()=>{
 const [{sourceBossEncounterSessionFixture,encounterReady}]=await Promise.all([load('tests/fixtures/source-boss-encounter-session')]);
 const strict=sourceBossEncounterSessionFixture({policy:false});delete strict.runtime.sourceBattleResult;
 const missing=strict.make();assert.equal(missing.game.field.startEvent('query'),true);missing.flow.advance(10,encounterReady);assert.equal(missing.game.field.stop.kind,'unsupported');assert.match(missing.game.field.stop.message,/Source result requires an actual committed terminal fact and existing ScriptLocal frame/);
 const f=sourceBossEncounterSessionFixture({policy:false});Object.assign(f.runtime,sourceWebReplayRuntimePorts());const live=f.make(),before=live.game.state.snapshot();
 assert.equal(live.game.field.startEvent('query'),true);live.flow.advance(10,encounterReady);assert.equal(live.game.field.eventState.read({category:'ScriptLocalVariable',index:0}),0);live.flow.advance(100,encounterReady);
 assert.equal(live.game.field.startEvent('source-fight'),true);for(let i=0;i<100&&!live.game.field.stop;i++)live.flow.advance(10,encounterReady);
 assert.equal(live.game.field.stop.kind,'encounter');assert.equal(live.game.field.stop.sourceBoss.policy,sourceWebReplayRuntimePorts().sourceBossEntry);
 assert.deepEqual(live.game.state.snapshot(),before);assert.equal(live.game.battle,null);assert.throws(()=>live.game.prepareCommittedBattleResult(),/uncommitted/);
 const invalid=sourceBossEncounterSessionFixture({missingResultFrame:true});Object.assign(invalid.runtime,sourceWebReplayRuntimePorts());const noFrame=invalid.make();assert.equal(noFrame.game.field.startEvent('query'),true);noFrame.flow.advance(10,encounterReady);assert.equal(noFrame.game.field.stop.kind,'unsupported');assert.equal(noFrame.game.state.snapshot().completedBattles.length,0);
});

test('an explicit Web policy never turns a legacy unknown result into fresh None or changes the owned owner',async()=>{
 const [{checkpointFixture},{GameSession}]=await Promise.all([load('tests/fixtures/checkpoint-game'),load('src/core/game-session')]),f=checkpointFixture();
 f.field.scripts['result-query']=[{kind:'source-battle-result',script:'result-query',index:0,source:{file:'controlled',assetPath:'legacy-query'}}];
 (f.field.scriptLocals??={})['result-query']={labels:['result'],values:[-1]};
 const game=new GameSession(f.field,f.battle,314,sourceWebReplayRuntimePorts()),owner=game.state,before=game.state.snapshot();
 assert.notEqual(before.initialization,'source-new-game');assert.equal(game.field.startEvent('result-query'),true);game.advance(10);
 assert.equal(game.field.stop.kind,'unsupported');assert.match(game.field.stop.message,/Fresh native result context is unavailable/);
 assert.equal(game.field.eventState.read({category:'ScriptLocalVariable',index:0}),-1);assert.equal(game.state,owner);assert.deepEqual(game.state.snapshot(),before);
});

test('positive replay composes the actual board host before Session entry and keeps the missing-host rejection',async()=>{
 const [{movableFieldEffectsFixture},{createWebLogicalFieldEffectsHost},{GameFlow}]=await Promise.all([load('tests/fixtures/movable-field-effects'),load('src/core/field-logical-effects'),load('src/core/game-flow')]);
 const f=await movableFieldEffectsFixture(),ready={visible:true,mediaReady:true,overlayOpen:false};
 f.runtime.fieldEffects=createWebLogicalFieldEffectsHost();
 await assert.rejects(async()=>f.make(),/Movable logical boards require an explicit matching runtime host/);
 f.runtime.fieldEffects=sourceWebReplayFieldEffectsHost(createWebLogicalFieldEffectsHost);
 const game=await f.make(),flow=new GameFlow(game);flow.start();flow.advance(10,ready);
 assert.equal(game.field.stop,null);const before=game.field.fieldEffectsSnapshot.boards[0].position;
 assert.equal(game.field.startEvent('fx-transform'),true);
 for(let i=0;i<100&&game.field.busy&&!game.field.stop;i++)flow.advance(10,ready);
 assert.equal(game.field.stop,null);assert.notDeepEqual(game.field.fieldEffectsSnapshot.boards[0].position,before);
 assert.equal(game.checkpointReady,true);assert.deepEqual(f.restore(game.checkpoint()).checkpoint(),game.checkpoint());
 assert.throws(()=>sourceWebReplayFieldEffectsHost(null),/Missing compiled/);
});

test('headless periodic consumer records real requests with no-pixels evidence and no default consumer',async()=>{
 const {createControlledBattlePeriodicNumberHost}=await load('src/core/battle-periodic-number');
 assert.throws(()=>sourceWebReplayPeriodicNumberHost(createControlledBattlePeriodicNumberHost),/Missing/);
 const requests=[],host=sourceWebReplayPeriodicNumberHost(createControlledBattlePeriodicNumberHost,r=>requests.push(r));
 const request={ticket:1,epoch:4,unitId:'actual-instance',conditionId:17,amount:4},lease=host.prepare(request);assert.equal(lease.consumption(),null);lease.commit();assert.deepEqual(requests,[request]);assert.equal(lease.consumption(),'controlled-request-consumed');assert.throws(()=>lease.acknowledge('drawn'),/Wrong/);lease.discard();assert.throws(()=>lease.consumption(),/Stale/);
});
