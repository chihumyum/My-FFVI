import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { sourceWebReplayRuntimePorts } from './source-web-replay-runtime.mjs';

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
 const expected={battleGlobalFade:[null,null,WEB_BATTLE_GLOBAL_FADE],screenPresentation:[null,null,'web-field-screen-presentation-2d-v1'],mobColorFilter:[null,null,WEB_FLAT_MOB_COLOR_FILTER],birdViewActors:[null,null,WEB_FLAT_BIRD_VIEW_ACTORS],worldAutoMove:["WEB_FLAT_WORLD_AUTO_MOVE","/runtime/core/field-world-auto-move.js",WEB_FLAT_WORLD_AUTO_MOVE],worldAutoTasks:["WEB_FLAT_WORLD_AUTO_TASKS","/runtime/core/field-world-auto-tasks.js",WEB_FLAT_WORLD_AUTO_TASKS],battleBranchExecution:['WEB_BATTLE_BRANCH_EXECUTION','/runtime/core/battle-branch-execution.js',WEB_BATTLE_BRANCH_EXECUTION],battleEventEffects:[null,null,WEB_BATTLE_EVENT_EFFECTS],battleEventControls:['WEB_BATTLE_EVENT_CONTROLS','/runtime/core/battle-controls.js',WEB_BATTLE_EVENT_CONTROLS],viewChange:[null,null,WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE],battleEventMessages:['WEB_BATTLE_EVENT_MESSAGE_POLICY','/runtime/core/battle-event-message.js',WEB_BATTLE_EVENT_MESSAGE_POLICY],sourcePartySelection:['WEB_SOURCE_PARTY_SELECTION','/runtime/core/source-party-selection.js',WEB_SOURCE_PARTY_SELECTION],sourceBossEntry:['WEB_SOURCE_BOSS_ENTRY','/runtime/core/source-boss-encounter.js',WEB_SOURCE_BOSS_ENTRY],sourceBattleResult:['WEB_COMMITTED_BATTLE_RESULT','/runtime/core/source-battle-result.js',WEB_COMMITTED_BATTLE_RESULT],puppetRoutes:[null,null,WEB_PUPPET_ROUTE_POLICY],scriptedBattleActions:['WEB_SCRIPTED_BATTLE_ACTIONS','/runtime/core/scripted-battle-action.js',WEB_SCRIPTED_BATTLE_ACTIONS]},first=sourceWebReplayRuntimePorts();
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
