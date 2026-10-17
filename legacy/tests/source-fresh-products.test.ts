import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,realpath,rm,writeFile,lstat,readlink,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hash,canonical} from '../src/compiler/content.js';
import {sourceNewGameFixture} from './fixtures/source-new-game.js';
import {initializedBattleDirectoryFixture} from './fixtures/initialized-battle-directory.js';
const compiledDir=resolve(import.meta.dirname,'..'),script=(n:string)=>import(pathToFileURL(resolve(process.cwd(),'scripts',n+'.mjs')).href),sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const namespace='/content-packages/source-products',fresh='fresh-source-products-v1',freshLock='fresh-source-product-input-lock-v1';
const seal=<T extends{contentHash?:string}>(v:T)=>{const{contentHash,...body}=structuredClone(v);return {...body,contentHash:hash(body)} as T&{contentHash:string};};
async function temporary(work:(root:string)=>Promise<void>){const root=await realpath(await mkdtemp(resolve(tmpdir(),'ffvi-fresh-products-')));try{await work(root);}finally{await rm(root,{recursive:true,force:true});}}
async function put(root:string,path:string,value:string){const file=resolve(root,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,value);return file;}
async function fixtureLock(root:string){
 const files:any[]=[],directories:any[]=[];const sources=[{file:'synthetic',sha256:'c'.repeat(64),bytes:3}],sourceSetHash=hash(sources),parentSourceSetHash='b'.repeat(64);
 async function record(path:string,text:string){const file=await put(root,path,text);files.push({path,sha256:sha(text),bytes:Buffer.byteLength(text),realPath:await realpath(file)});}
 for(const name of['import','corpus','battle','field','world-media','field-background-media','map-ui','bgm','environment','se']){
  const path='build/'+name,body=JSON.stringify(name==='corpus'?{sources,sourceSetHash,parentSourceSetHash}:name==='world-media'?{formatVersion:1,adapterVersion:'world-media-0.1.0',sources,sourceSetHash:hash(sources),parentSourceSetHash:sourceSetHash}:{controlled:name});
  await record(path+'/data.json',body);await record(path+'/snapshot.json',JSON.stringify({formatVersion:1,files:[{file:'data.json',sha256:sha(body)}]}));
  if(name==='corpus'||name==='world-media'){const nameOfFile=name==='corpus'?'corpus.json':'media.json';const entry=files.find(x=>x.path===path+'/data.json');entry.path=path+'/'+nameOfFile;await put(root,entry.path,body);await rm(resolve(root,path+'/data.json'));const snapshot=files.find(x=>x.path===path+'/snapshot.json'),text=JSON.stringify({formatVersion:1,files:[{file:nameOfFile,sha256:sha(body)}]});await writeFile(resolve(root,snapshot.path),text);snapshot.sha256=sha(text);snapshot.bytes=Buffer.byteLength(text);entry.realPath=await realpath(resolve(root,entry.path));}
  directories.push(path);
 }
 for(const path of['build/reports/v71-esper-native-complete/complete.json','build/reports/v71-esper-native-complete/856d80.c','build/runtime/game/FINAL FANTASY VI_Data/level0','build/runtime/game/FINAL FANTASY VI_Data/globalgamemanagers'])await record(path,'controlled evidence');
 await record('compiled/src/compiler.js','export const controlled=true;\n');directories.push('compiled/src');
 const rows=[];for(const path of directories){const values:unknown[]=[['.','real-directory',await realpath(resolve(root,path))]];for(const name of(await readdir(resolve(root,path))).sort()){const file=resolve(root,path,name),stat=await lstat(file);values.push(stat.isSymbolicLink()?[name,'symlink',await readlink(file)]:[name,'file']);}rows.push({path,entriesDigest:sha(JSON.stringify(values))});}
 const code=files.find(x=>x.path==='compiled/src/compiler.js');return{kind:freshLock,packageNamespace:namespace,sourceLockKind:'source-prerequisite-input-lock-v1',sourceSetHash,parentSourceSetHash,compiledDir:resolve(root,'compiled'),compilerDigest:sha(JSON.stringify([{path:'src/compiler.js',sha256:code.sha256,bytes:code.bytes}])),files,directories:rows};
}
test('fresh locks exclude historical seeds while legacy locks retain both seeds and reject mode/field smuggling',async()=>{
 const {validateSourcePrerequisiteInputs:validate}=await script('compile-source-prerequisites');
 const mode=await script('source-production-mode');
 await temporary(async root=>{const lock=await fixtureLock(root),before=structuredClone(lock);assert.equal(await validate(lock,{root}),true);assert.deepEqual(lock,before);
  const old:any=structuredClone(lock);old.kind=old.sourceLockKind;delete old.sourceLockKind;delete old.packageNamespace;await assert.rejects(validate(old,{root}),/Missing.*dependency/);
  const seedPath='build/game/source-catalog.json',seed=await put(root,seedPath,'historical seed');const bad=structuredClone(lock);bad.files.push({path:seedPath,sha256:sha('historical seed'),bytes:15,realPath:await realpath(seed)});await assert.rejects(validate(bad,{root}),/legacy game seeds/);
  for(const mutate of[(v:any)=>{v.sourceLockKind='source-prerequisite-input-lock-v999';},(v:any)=>{v.savedFresh=true;},(v:any)=>{v.kind='source-prerequisite-input-lock-v1';},(v:any)=>{v.compilerDigest='d'.repeat(64);},(v:any)=>{v.parentSourceSetHash='d'.repeat(64);}]){const bad=structuredClone(lock);mutate(bad);await assert.rejects(validate(bad,{root}));}
  await writeFile(resolve(root,'build/field/data.json'),'late raw mutation');await assert.rejects(validate(lock,{root}),/changed/);
 });
 assert.throws(()=>mode.sourceProductionMode('auto-upgrade'));assert.throws(()=>mode.freshSourceInputLock({kind:'save-v1'}));
 const products=await script('compile-source-prerequisites'),candidate=await script('source-candidate');await assert.rejects(products.compileFreshSourceProducts({undeclaredSavedMedia:{kind:'uninstalled-media-owner'}}),/Unknown fresh source product/);await assert.rejects(candidate.compileFreshSourceCandidate({undeclaredSavedMedia:{kind:'uninstalled-media-owner'}}),/Unknown fresh candidate/);
});
test('fresh receipts require their own mode/input fence and exact producer paths; media envelope promotion preserves its separate owner',async()=>{
 const mode=await script('source-production-mode'),{validateSourceCandidateReport:validate}=await script('source-candidate');
 const inputBytes=Buffer.from(JSON.stringify({kind:freshLock,packageNamespace:namespace,sourceLockKind:'source-prerequisite-input-lock-v1'})),runtimeSha256='a'.repeat(64),report:any={kind:'shared-source-candidate-v1',status:'complete',published:false,productMode:fresh,producerPaths:{sourceRoot:'/source',runtimeRoot:'/runtime',compiledDir:'/compiled'},runtimeSha256,producer:{productMode:fresh},link:{productMode:fresh,packageNamespace:namespace},inputLock:{file:'inputs.json',sha256:sha(inputBytes),bytes:inputBytes.length},objects:['/world/catalog.json','/framework/world/catalog.json','/game/source-new-game.json','/game/source-catalog.json'].map(url=>({url,sha256:'b'.repeat(64),bytes:1}))};
 const complete=['/framework/full-new-game.json','/framework/full-battle.json','/framework/full-content-refs.json','/framework/full-battle-binding.json','/framework/full-battle-directory-requests.json','/framework/full-battle-directory-report.json'];report.objects.push(...complete.map(url=>({url,sha256:'b'.repeat(64),bytes:1,contentHash:'c'.repeat(64)})));report.frameworkBattleDirectory={input:{path:'content-batches/source-battle-directory.policy.json',sha256:'d'.repeat(64),bytes:1,realPath:'/controlled/policy'},bindingHash:'c'.repeat(64),catalogHash:'c'.repeat(64),entryHash:'c'.repeat(64),requestsHash:'c'.repeat(64),reportHash:'c'.repeat(64)};
 assert.equal(validate(report,{runtimeSha256,inputBytes}).size,10);
 for(const mutate of[(v:any)=>{delete v.producerPaths;},(v:any)=>{v.producerPaths.runtimeRoot='relative';},(v:any)=>{v.productMode='saved-fresh';},(v:any)=>{delete v.productMode;}]){const bad=structuredClone(report);mutate(bad);assert.throws(()=>validate(bad,{runtimeSha256,inputBytes}));}
 const oldBytes=Buffer.from(JSON.stringify({kind:'source-prerequisite-input-lock-v1'}));assert.throws(()=>validate({...report,inputLock:{file:'inputs.json',sha256:sha(oldBytes),bytes:oldBytes.length}},{runtimeSha256,inputBytes:oldBytes}),/upgrade an old lock/);
 const media={kind:'source-prerequisite-input-lock-v6',baseLockKind:'source-prerequisite-input-lock-v3',sourceSpriteMedia:{kind:'owned-by-separate-media-validator'}},wrapped=mode.freshSourceInputLock(media);mode.promoteSourceInputLockKind(wrapped,'source-prerequisite-input-lock-v5');assert.equal(wrapped.kind,freshLock);assert.equal(wrapped.sourceLockKind,'source-prerequisite-input-lock-v6');assert.equal(wrapped.baseLockKind,'source-prerequisite-input-lock-v5');assert.equal(mode.sourceInputLockKind(wrapped),'source-prerequisite-input-lock-v5');assert.equal(mode.sourceInputEnvelopeKind(wrapped),'source-prerequisite-input-lock-v6');
 // Envelope helpers cannot substitute for the complete media v6 validator.
 // This intentionally incomplete fixture still has no authority.
 const {validateSourcePrerequisiteInputs:check}=await script('compile-source-prerequisites');await assert.rejects(check(wrapped,{root:process.cwd()}),/fields|lock/);
});
async function stageMedia(root:string,world:any){const text=JSON.stringify({sourceSetHash:world.catalog.mediaSourceSetHash}),path='build/world-media/media.json';return{path,sha256:sha(text),bytes:Buffer.byteLength(text),realPath:await realpath(await put(root,path,text))};}
async function strictWorld(){const f=sourceNewGameFixture(),map=seal(f.map),next=structuredClone(map);next.mapId++;next.map!.identity!.mapId=next.mapId;next.map!.entryContext!.mapId=next.mapId;next.partyEntry!.mapId=next.mapId;
 next.blockers.push({code:'unknown-source-fixture',reason:'Retained unassessed source operation',source:{file:'synthetic',assetPath:'unknown'}} as any);const future=seal(next),maps=[map,future];
 return {catalog:seal({...f.world,maps:Object.fromEntries(maps.map(m=>[m.mapId,{...f.world.maps[f.map.mapId]!,url:'/world/maps/'+m.mapId+'.json',contentHash:m.contentHash}]))}),maps};}
test('strict world stage survives a later failure and reuses every map/unknown only with exact raw/mode binding',async()=>{
 const {sourceWorldStage:stage}=await script('source-world-stage-cache');await temporary(async root=>{const world=await strictWorld();let calls=0,raw='source generation one',valid=true;
 const inputs={sourceSetHash:world.catalog.sourceSetHash,parentSourceSetHash:world.catalog.parentSourceSetHash,files:[{path:'build/raw.json',sha256:sha(raw),bytes:raw.length,realPath:await put(root,'build/raw.json',raw)},await stageMedia(root,world)],directories:[]};
 const options=()=>({root,compiledDir,inputs,productMode:fresh,cache:{kind:'strict-source-world-stage-cache-v1',directory:'build/cache/strict-world'},expectedMapIds:world.maps.map(m=>m.mapId).sort((a,b)=>a-b),compile:async()=>{calls++;return structuredClone(world);},validateInputs:async()=>{assert(valid,'late source mutation');assert.equal(await readFile(resolve(root,'build/raw.json'),'utf8'),raw);}});
 const first=await stage(options());assert.equal(first.receipt.status,'compiled-and-retained');assert.equal(first.receipt.completeCandidate,false);assert.equal(calls,1);
 await assert.rejects((async()=>{throw Error('later framework consumer failed');})(),/later framework/);
 const second=await stage(options());assert.equal(second.receipt.status,'reused-complete-stage');assert.deepEqual(second.world,world);assert.equal(second.world.maps[1].blockers.length,1);assert.equal(calls,1);
 valid=false;await assert.rejects(stage(options()),/late source/);valid=true;
 await assert.rejects(stage({...options(),expectedMapIds:[world.maps[0]!.mapId]}),/complete raw source map domain/);
 const corrupt=resolve(root,'build/cache/strict-world',first.receipt.stageBindingHash,'world.json');await writeFile(corrupt,'{}');await assert.rejects(stage(options()),/bytes changed/);assert.equal(calls,1);
 raw='source generation two';await writeFile(resolve(root,'build/raw.json'),raw);inputs.files[0]!.sha256=sha(raw);inputs.files[0]!.bytes=raw.length;
 const third=await stage(options());assert.equal(third.receipt.status,'compiled-and-retained');assert.equal(calls,2);assert.notEqual(first.receipt.stageBindingHash,third.receipt.stageBindingHash);
 const legacy=await stage({...options(),productMode:'legacy-source-compatibility-v1'});assert.equal(legacy.receipt.status,'compiled-and-retained');assert.equal(calls,3);
 });
});
test('strict stage module closure ignores a framework-only edit but detects consumed modules, new dependencies and cache-time raw changes',async()=>{
 const {sourceWorldStageBinding:binding,sourceWorldStage:stage}=await script('source-world-stage-cache');await temporary(async root=>{
  const dist=resolve(root,'compiled');await put(root,'compiled/src/compiler/world.js',"import {x} from './leaf.js'; export const compileWorld=()=>x;\n");await put(root,'compiled/src/compiler/leaf.js','export const x=1;\n');await put(root,'compiled/src/compiler/framework-content.js','export const unrelated=1;\n');
  const options={root,compiledDir:dist,inputs:{sourceSetHash:'a'.repeat(64),parentSourceSetHash:'b'.repeat(64),files:[{path:'build/raw',sha256:'c'.repeat(64),bytes:3,realPath:'/controlled/raw'}],directories:[]},productMode:fresh};
  const first=await binding(options);await writeFile(resolve(dist,'src/compiler/framework-content.js'),'export const unrelated=2;\n');assert.deepEqual(await binding(options),first);
  await writeFile(resolve(dist,'src/compiler/leaf.js'),'export const x=2;\n');assert.notEqual((await binding(options)).contentHash,first.contentHash);
  await writeFile(resolve(dist,'src/compiler/leaf.js'),"import unknown from 'unaudited-package'; export const x=unknown;\n");await assert.rejects(binding(options),/Unaudited/);
  const world=await strictWorld();let valid=true;await assert.rejects(stage({root,compiledDir,inputs:{...options.inputs,files:[...options.inputs.files,await stageMedia(root,world)],sourceSetHash:world.catalog.sourceSetHash,parentSourceSetHash:world.catalog.parentSourceSetHash},productMode:fresh,cache:{kind:'strict-source-world-stage-cache-v1',directory:'build/cache/late'},expectedMapIds:world.maps.map(m=>m.mapId),validateInputs:async()=>assert(valid,'late raw'),compile:async()=>{valid=false;return world;}}),/late raw/);
  await assert.rejects(readFile(resolve(root,'build/cache/late/stage.json')),/ENOENT/);
 });
});
async function collectionCandidate(root:string){
 const f=await initializedBattleDirectoryFixture({newGame:true,supportedAI:true}),sourceMap=seal(f.native.map),sourceEntry=seal({...f.native.content,sourceSetHash:f.sourceWorld.sourceSetHash,parentSourceSetHash:f.sourceWorld.parentSourceSetHash,battleCatalogHash:f.sourceBattle.contentHash,worldCatalogHash:f.sourceWorld.contentHash,mapContentHash:sourceMap.contentHash});
 const futureDraft=structuredClone(sourceMap);futureDraft.mapId++;futureDraft.map!.identity!.mapId=futureDraft.mapId;futureDraft.map!.entryContext!.mapId=futureDraft.mapId;futureDraft.partyEntry!.mapId=futureDraft.mapId;futureDraft.blockers.push({code:'controlled-unknown-future',reason:'Unassessed unvisited content',source:{file:'synthetic',assetPath:'future'}} as any);const future=seal(futureDraft),sourceWorld:typeof f.sourceWorld=seal({...f.sourceWorld,maps:{...f.sourceWorld.maps,[future.mapId]:{...f.sourceWorld.maps[sourceMap.mapId]!,url:'/world/maps/'+future.mapId+'.json',contentHash:future.contentHash,blockers:future.blockers}}});
 const {linkSourcePrerequisites:link}=await script('link-source-prerequisites'),linked=await link({root,compiledDir,productMode:fresh,payloads:new Map<string,unknown>([['/world/catalog.json',sourceWorld],['/game/source-new-game.json',seal({...sourceEntry,worldCatalogHash:sourceWorld.contentHash})],['/game/source-catalog.json',f.sourceBattle],[sourceWorld.maps[sourceMap.mapId]!.url,sourceMap],[sourceWorld.maps[future.mapId]!.url,future]])});
 const linkedWorld=linked.inputs.get('/world/catalog.json');f.directory.requests=seal({...f.directory.requests,sourceRequests:seal({...f.directory.requests.sourceRequests,worldCatalogHash:linkedWorld.contentHash,mapBindings:Object.entries(linkedWorld.maps).map(([id,ref]:any)=>({mapId:Number(id),contentHash:ref.contentHash})).sort((a,b)=>a.mapId-b.mapId)})});f.directory.report=seal({...f.directory.report,requestsHash:f.directory.requests.contentHash});
 const {bindFrameworkSourceBattleDirectory:bind}=await script('framework-source-battle-binding'),bound=await bind({root,compiledDir,sourceWorld:linked.inputs.get('/world/catalog.json'),sourceEntry:linked.inputs.get('/game/source-new-game.json'),sourceBattle:f.sourceBattle,frameworkWorld:linked.inputs.get('/framework/world/catalog.json'),frameworkEntry:linked.inputs.get('/framework/new-game.json'),directory:f.directory});
 for(const[u,v]of bound.payloads)linked.inputs.set(u,v);linked.inputs.set('/framework/full-battle-directory-requests.json',f.directory.requests);linked.inputs.set('/framework/full-battle-directory-report.json',f.directory.report);
 const {runtimeDigest}=await script('runtime-digest');let valid=true;
 return {report:{status:'complete',productMode:fresh,frameworkBattleDirectory:{bindingHash:bound.report.contentHash},link:linked.report,producer:{strict:{maps:2}}},lock:{kind:freshLock,packageNamespace:namespace,sourceLockKind:'source-prerequisite-input-lock-v1',sourceSetHash:f.sourceWorld.sourceSetHash,parentSourceSetHash:f.sourceWorld.parentSourceSetHash,files:[],directories:[]},runtimeSha256:await runtimeDigest(root,compiledDir),read:async(u:string)=>{assert(linked.inputs.has(u),'Missing candidate '+u);return structuredClone(linked.inputs.get(u));},validate:async()=>assert(valid,'late candidate mutation'),invalidate:()=>{valid=false;},linked};
}
test('fresh full source collection uses actual Repository newgame roles, null development and same-generation full Battle catalog',async()=>{
 const {prepareSourceProductCollection:prepare}=await script('compile-source-product-collection');await temporary(async root=>{
  // Tool/app bytes remain the actual runtimeRoot, while inputs/publication are
  // temporary. Different roots cannot fake matching source/runtime identities.
  const candidate=await collectionCandidate(process.cwd());const out=await prepare({root:process.cwd(),compiledDir,candidate});
  assert.equal(out.payloads.get('/content-packages/source-products-source.json').development,null);assert.equal(out.payloads.get('/content-packages/source-products-framework.json').development,null);
  assert.equal(out.payloads.get('/content-packages/source-products/framework/battle.json').contentHash,candidate.linked.inputs.get('/framework/full-battle.json').contentHash);
  assert.equal(out.reports[0].report.sourceGameplayAdmitted,false);assert.equal(out.recipes.size,0);
  for(const mutate of[(c:any)=>{c.report.productMode='legacy-source-compatibility-v1';},(c:any)=>{c.runtimeSha256='a'.repeat(64);},(c:any)=>{c.report.producer.strict.maps=3;},(c:any)=>{c.lock.kind='source-prerequisite-input-lock-v1';}]){
   const c={...candidate,report:structuredClone(candidate.report),lock:structuredClone(candidate.lock)};mutate(c);await assert.rejects(prepare({root:process.cwd(),compiledDir,candidate:c}));}
  const future=[...out.payloads.values()].find((v:any)=>v.kind==='world-map-development'&&v.blockers?.some((b:any)=>b.code==='controlled-unknown-future'));assert(future,'Unvisited unknown map retained');const missing={...candidate,read:async(u:string)=>{if(u==='/content-packages/source-products/source/maps/'+future.mapId+'.json')throw Error('missing unvisited map');return candidate.read(u);}};await assert.rejects(prepare({root:process.cwd(),compiledDir,candidate:missing}),/missing unvisited/);
  candidate.invalidate();await assert.rejects(out.validateInputs(),/late candidate/);
 });
});
test('fresh collection retains the shared publisher atomic boundary and old registry while a late validation failure leaves it untouched',async()=>{
 const {prepareSourceProductCollection:prepare}=await script('compile-source-product-collection'),{publishContentPackages:publish}=await script('content-package-pipeline');
 await temporary(async root=>{await symlink(resolve(process.cwd(),'scripts'),resolve(root,'scripts'),'dir');await symlink(resolve(process.cwd(),'apps'),resolve(root,'apps'),'dir');const candidate=await collectionCandidate(root),out=await prepare({root,compiledDir,candidate});
  await put(root,'build/content-packages/independent/kept.bin','old registry bytes');
  const native=sourceNewGameFixture(),oldMap=seal(native.map),oldBattle=seal(native.battle),oldWorld=seal({...native.world,maps:{[oldMap.mapId]:{...native.world.maps[oldMap.mapId]!,url:'/content-packages/legacy-sample/map.json',contentHash:oldMap.contentHash}}}),oldEntry=seal({...native.content,worldCatalogHash:oldWorld.contentHash,mapContentHash:oldMap.contentHash,battleCatalogHash:oldBattle.contentHash});
  const oldRefs={kind:'game-content-refs-v1',profile:'source',world:{url:'/content-packages/legacy-sample/world.json',contentHash:oldWorld.contentHash},source:{entry:{url:'/content-packages/legacy-sample/entry.json',contentHash:oldEntry.contentHash},battle:{url:'/content-packages/legacy-sample/battle.json',contentHash:oldBattle.contentHash}},development:null};
  const oldFiles=new Map([['build/content-packages/legacy-sample.json',canonical(oldRefs)+'\n'],...Object.entries({world:oldWorld,entry:oldEntry,battle:oldBattle,map:oldMap}).map(([name,body])=>['build/content-packages/legacy-sample/'+name+'.json',canonical(body)+'\n'])] as [string,string][]);for(const[path,raw]of oldFiles)await put(root,path,raw);
  const archive=async()=>({packages:[],reports:[]});
  // Synthetic temporary publication uses the existing publisher and exact
  // Repository closure; its runtime fence is checked by the prepared consumer.
  const base={root,compiledDir,collectionMode:'fresh-source-product-collection-v1',sourceCandidateDir:'build/controlled-candidate',compile:async()=>out,archive};
  await assert.rejects(publish({...base,reportPath:'build/reports/late.json',archive:async()=>{candidate.invalidate();return archive();}}),/late candidate/);
  assert.equal(await readFile(resolve(root,'build/content-packages/independent/kept.bin'),'utf8'),'old registry bytes');
  await assert.rejects(readFile(resolve(root,'build/content-packages/source-products-source.json')),/ENOENT/);
  const next=await prepare({root,compiledDir,candidate:await collectionCandidate(root)});const committed=await publish({...base,compile:async()=>next,reportPath:'build/reports/committed.json'});assert.equal(committed.published,true);assert.equal(committed.result,'passed');for(const[path,raw]of oldFiles)assert.equal(await readFile(resolve(root,path),'utf8'),raw,'Old pinned sample closure retained byte-for-byte');assert.equal(await readFile(resolve(root,'build/content-packages/independent/kept.bin'),'utf8'),'old registry bytes');
  const refs=JSON.parse(await readFile(resolve(root,'build/content-packages/source-products-framework.json'),'utf8'));assert.equal(refs.development,null);assert.equal(refs.source.battle.contentHash,next.payloads.get('/content-packages/source-products/framework/battle.json').contentHash);
  await assert.rejects(publish({...base,collectionMode:'auto',reportPath:'build/reports/unknown.json'}),/Unknown/);
  await assert.rejects(publish({...base,sourceRecipePaths:['old.recipe.json'],reportPath:'build/reports/mixed.json'}),/only an explicit/);
 });
});
