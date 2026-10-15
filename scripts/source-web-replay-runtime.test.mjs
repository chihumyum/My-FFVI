import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { sourceWebReplayRuntimePorts } from './source-web-replay-runtime.mjs';

const root=resolve(import.meta.dirname,'..'),compiled=resolve(root,process.env.FFVI_REPLAY_PORTS_COMPILED??'dist'),
 load=path=>import(pathToFileURL(resolve(compiled,path+'.js')));

test('the detached Web replay pair is exactly the real app policy and current core constants',async()=>{
 const [{WEB_SOURCE_BOSS_ENTRY},{WEB_COMMITTED_BATTLE_RESULT}]=await Promise.all([load('src/core/source-boss-encounter'),load('src/core/source-battle-result')]),
  text=await readFile(resolve(root,'apps/game/app.js'),'utf8'),ast=ts.createSourceFile('app.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),imports=new Map();
 for(const node of ast.statements)if(ts.isImportDeclaration(node)&&node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings))for(const name of node.importClause.namedBindings.elements)imports.set(name.name.text,node.moduleSpecifier.text);
 let runtime;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='runtime')runtime=node.initializer;ts.forEachChild(node,visit);}visit(ast);
 assert.ok(runtime&&ts.isObjectLiteralExpression(runtime));
 const expected={sourceBossEntry:['WEB_SOURCE_BOSS_ENTRY','/runtime/core/source-boss-encounter.js',WEB_SOURCE_BOSS_ENTRY],sourceBattleResult:['WEB_COMMITTED_BATTLE_RESULT','/runtime/core/source-battle-result.js',WEB_COMMITTED_BATTLE_RESULT]},first=sourceWebReplayRuntimePorts();
 assert.deepEqual(Object.keys(first).sort(),Object.keys(expected).sort());assert.equal(Object.isFrozen(first),true);
 for(const[key,[identifier,path,value]]of Object.entries(expected)){const field=runtime.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(ast)===key);assert.ok(field);assert.equal(field.initializer.getText(ast),identifier);assert.equal(imports.get(identifier),path);assert.equal(first[key],value);}
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
