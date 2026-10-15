import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initializedBattleDirectoryFixture} from './fixtures/initialized-battle-directory.js';
import {compileFrameworkContent} from '../src/compiler/framework-content.js';
import {hash,canonical} from '../src/compiler/content.js';
import {GameContentRepository} from '../src/core/game-content.js';
import {GameSession} from '../src/core/game-session.js';
import {GameFlow} from '../src/core/game-flow.js';
import {NewGameFieldEntry} from '../src/core/new-game-field-entry.js';
import {FieldFadeState} from '../src/core/field-fade.js';
import {createSourcePresentationContext} from '../src/core/source-presentation.js';
import {GameBattleHandoff} from '../src/core/game-battle-handoff.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import {developmentGameContentRefsFixture} from './fixtures/game-content-refs.js';
const compiledDir=resolve(import.meta.dirname,'..'),root=process.cwd();
const seal=<T extends{contentHash?:string}>(value:T)=>{const{contentHash,...body}=value;return {...body,contentHash:hash(body)} as T&{contentHash:string};};
const producer=()=>import(pathToFileURL(resolve(root,'scripts/framework-source-battle-binding.mjs')).href);
async function fixture(options:{supportedAI?:boolean}={}){
 const f=await initializedBattleDirectoryFixture({newGame:true,...options}),sourceMap=seal(f.native.map),
  sourceEntry=seal({...f.native.content,sourceSetHash:f.sourceWorld.sourceSetHash,parentSourceSetHash:f.sourceWorld.parentSourceSetHash,battleCatalogHash:f.sourceBattle.contentHash,worldCatalogHash:f.sourceWorld.contentHash,mapContentHash:sourceMap.contentHash});
 const framework=compileFrameworkContent(f.sourceWorld,[sourceMap],sourceEntry);
 return {...f,sourceMap,sourceEntry,frameworkEntry:framework.entry,frameworkWorld:framework.catalog,frameworkMap:framework.maps[0]!,root,compiledDir};
}
test('whole title/newgame battle binding keeps the complete conditional/blocked directory and the exact source route/initializer',async()=>{
 const f=await fixture(),before=canonical(f),{bindFrameworkSourceBattleDirectory}=await producer(),out=await bindFrameworkSourceBattleDirectory(f);
 assert.equal(canonical(f),before);assert.deepEqual(out.battle.gameState,f.sourceBattle.gameState);assert.deepEqual(out.battle.encounterDiagnostics,f.directory.frameworkCatalog.encounterDiagnostics);
 assert.deepEqual(out.battle.encounterReport.entries.map((r:any)=>[r.partyId,r.status]),[[9201,'compiled'],[9202,'blocked']]);
 const {contentHash,battleCatalogHash,...other}=out.entry;const{contentHash:oldHash,battleCatalogHash:oldBattle,...previous}=f.frameworkEntry;
 assert.deepEqual(other,previous);assert.equal(battleCatalogHash,out.battle.contentHash);assert.equal(out.report.initialStateChanged,false);assert.equal(out.report.sourceCampaignComplete,false);
 const input=new Map([...out.payloads,['/framework/world/catalog.json',f.frameworkWorld],[f.frameworkWorld.maps[f.frameworkMap.mapId]!.url,f.frameworkMap]]);
 const repo=new GameContentRepository(async url=>{assert(input.has(url));return input.get(url);},'framework',out.refs),bundle=await repo.sourceNewGame();
 assert.equal(bundle.battle.contentHash,out.battle.contentHash);assert(bundle.battle.encounters[9201]);assert.equal(bundle.content.entry.reservedScript.contentHash,f.sourceEntry.entry.reservedScript.contentHash);
});
test('missing directory proof, changed owned state or source pin cannot become a real newgame binding even when rehashed',async()=>{
 const {bindFrameworkSourceBattleDirectory}=await producer();
 for(const mutate of[(f:any)=>{delete f.directory;},(f:any)=>{f.directory.frameworkCatalog=seal({...f.directory.frameworkCatalog,gameState:{...f.directory.frameworkCatalog.gameState,initialGil:999}});},
  (f:any)=>{f.frameworkEntry=seal({...f.frameworkEntry,battleCatalogHash:'a'.repeat(64)});},
  (f:any)=>{f.frameworkEntry=seal({...f.frameworkEntry,entry:{...f.frameworkEntry.entry,entrance:999}});},
  (f:any)=>{f.directory.requests=seal({...f.directory.requests,requestedPartyIds:[9201]});}]){
  const f=await fixture();mutate(f);await assert.rejects(bindFrameworkSourceBattleDirectory(f));
 }
});
test('the same bound source entry launches through the real title contract and Storage restores without the small source battle cache',async()=>{
 const f=await fixture({supportedAI:true}),{bindFrameworkSourceBattleDirectory}=await producer(),out=await bindFrameworkSourceBattleDirectory(f);
 const files=new Map([...out.payloads,['/framework/world/catalog.json',f.frameworkWorld],[f.frameworkWorld.maps[f.frameworkMap.mapId]!.url,f.frameworkMap]]),
  repo=new GameContentRepository(async url=>{assert(files.has(url),'Missing exact full directory dependency '+url);return files.get(url);},'framework',out.refs),bundle=await repo.sourceNewGame();
 const presentation=createSourcePresentationContext({kind:'title-new-game',titleCleanupComplete:true,openingCallbackStarted:false}),entry=new NewGameFieldEntry(bundle.content.entry,presentation),
  initialFade=new FieldFadeState({imageColor:{r:0,g:0,b:0,a:1},rendererColor:{r:1,g:1,b:1,a:0},raycastTarget:false}),start=entry.prepareStart(initialFade,{active:true,callbacks:'absent'});start.commit();let fade=start.fade;fade.advance(.51);
 while(entry.phase!=='field-preparing'){const next=entry.prepareResume(fade,true);assert(next);next.commit();fade=next.fade;}
 const game=GameSession.prepareNewGame(bundle.content,bundle.catalog,bundle.map,bundle.battle,fade,presentation,{battleHandoff:'prepared'}),launch=entry.prepareLaunch(fade,game.newGamePreparation(true));game.launchNewGame(launch.launch);launch.commit();
 const flow=new GameFlow(game);flow.start();for(let i=0;i<100&&!game.checkpointReady;i++)flow.advance(10,{visible:true,mediaReady:true,overlayOpen:false});assert(game.checkpointReady);
 assert.equal(game.state.snapshot().initialization,'source-new-game');assert.equal(game.battleCatalog.contentHash,out.battle.contentHash);
 const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}},'framework','whole-source-battle-newgame');
 await storage.save(game.checkpoint(),game.field.time);const saved=await storage.load();assert(saved);const dependencies=await repo.restoreSessionContent(saved.checkpoint);
 const restored=GameSession.restore(saved.checkpoint,dependencies.initial,dependencies.battle,dependencies.world,{battleHandoff:'prepared'});
 assert.deepEqual(restored.checkpoint(),saved.checkpoint);assert.equal(restored.battleCatalog.contentHash,out.battle.contentHash);
 const restoredFlow=new GameFlow(restored);restoredFlow.start();assert(restored.field.startEvent('directory-fight'));
 restoredFlow.advance(10,{visible:true,mediaReady:true,overlayOpen:false});assert(restored.battleStartRequest);
 const handoff=new GameBattleHandoff(restoredFlow,{prepareStart:async()=>null,prepareReturn:async()=>null,discard(){}}),started=await handoff.start();
 assert.equal(started.status,'committed',started.status==='failed'?String(started.error):started.status);
 assert.equal(restored.battle!.content.encounterId,9201);assert.equal(restored.state.inBattle,true);
 assert.equal(f.sourceBattle.encounters[9201],undefined,'The newgame entered a directory encounter absent from the small strict cache');

 files.set(out.refs.source.battle.url,f.sourceBattle);await assert.rejects(new GameContentRepository(async url=>files.get(url),'framework',out.refs).sourceNewGame(),/hash|payload|binding|identity/i);
});

test('the real public base producer binds the framework newgame role to its complete directory while retaining the strict source role',async()=>{
 const f=await fixture(),development=await developmentGameContentRefsFixture(),
  files=new Map<string,unknown>([['/game/source-new-game.json',f.sourceEntry],['/world/catalog.json',f.sourceWorld],['/game/source-catalog.json',f.sourceBattle],
   ['/game/narshe.json',development.field],['/game/opening-playable.json',development.battle],['/framework/new-game.json',f.frameworkEntry],['/framework/world/catalog.json',f.frameworkWorld],
   [f.sourceWorld.maps[f.sourceMap.mapId]!.url,f.sourceMap],[f.frameworkWorld.maps[f.frameworkMap.mapId]!.url,f.frameworkMap]]),
  {compileBaseContentPackages}=await import(pathToFileURL(resolve(root,'scripts/build-content-packages.mjs')).href),before=canonical([...files]);
 const result=await compileBaseContentPackages({root,frameworkBattleDirectory:f.directory,readJson:async(url:string)=>{assert(files.has(url),'Missing candidate '+url);return files.get(url);}});
 assert.equal(canonical([...files]),before);assert.equal(result.refs.get('source').source.battle.url,'/content-packages/source/battle.json');
 assert.equal(result.payloads.get('/content-packages/source/battle.json').contentHash,f.sourceBattle.contentHash);
 const refs=result.refs.get('framework');assert.equal(refs.source.battle.url,'/content-packages/framework/battle.json');
 assert.equal(result.payloads.get(refs.source.entry.url).battleCatalogHash,f.directory.frameworkCatalog.contentHash);
 assert.equal(result.payloads.get(refs.source.battle.url).contentHash,f.directory.frameworkCatalog.contentHash);
 assert.equal(result.report.frameworkSourceBattleBinding.sourceRoutesChanged,false);assert.equal(result.report.sourceGameplayAdmitted,false);
});
