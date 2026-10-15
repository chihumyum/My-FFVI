import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
// Read-only complete Encount source inventory plus all candidate battle dependencies.
// The only writes are ignored output artifacts, never a publication or owner edit.
const args=process.argv.slice(2),options={root:resolve(import.meta.dirname,'..'),compiled:'dist',output:'build/reports/source-boss-encounter-candidates',policy:'content-batches/source-battle-directory.policy.json'};
while(args.length){const flag=args.shift();assert.ok(['--root','--compiled','--output','--policy'].includes(flag)&&args[0],
 'Use compile-source-boss-candidates.mjs [--root dir] [--compiled dir] [--output dir]');options[flag.slice(2)]=args.shift();}
const root=resolve(options.root),out=resolve(root,options.output),compiled=resolve(root,options.compiled),
 load=name=>import(pathToFileURL(resolve(compiled,'src',name+'.js')));
assert.ok(out.startsWith(resolve(root,'build')+'/'),'Source-derived output must remain in ignored build/');
await mkdir(out,{recursive:true});
const [{loadCorpus},{hash,canonical},{compileSourceEncounterInstruction,sourceEncounterLiteralCandidates},{compileSourceBossEncounterInstruction},
 {compileSharedBattleSource},{compileGameCatalogModules,assembleGameCatalog,compileSharedGameCatalog},{loadSystemSource},{readSnapshot,snapshotFile},
 {compileBattleEncounterSources},{compileBattleEncounterRuntime},{createBattleHandoffMusicLookup},
 {analyzeBatchEncounters}]=await Promise.all(['compiler/corpus','compiler/content','compiler/source-encounter','compiler/source-boss-encounter',
 'compiler/battle','compiler/game-catalog','compiler/system-source','compiler/integrity','compiler/battle-encounters',
 'compiler/battle-encounter-runtime','compiler/battle-handoff','compiler/content-batch-battle'].map(load));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),inputs=new Map();
async function input(path){const bytes=await readFile(resolve(root,path));inputs.set(path,sha(bytes));return JSON.parse(bytes);}
async function runtime(){const files=[];async function walk(path){for(const e of(await readdir(resolve(compiled,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
 const name=path+'/'+e.name;if(e.isDirectory())await walk(name);else if(name.endsWith('.js'))files.push({path:name,sha256:sha(await readFile(resolve(compiled,name)))});}}
 await walk('src');return{compiled,sha256:hash(files),files};}
const runtimeBefore=await runtime(),snapshot=await loadCorpus(root),sourceDigest=hash(snapshot),sites=[];
for(const asset of snapshot.assets){if(asset.kind!=='script')continue;
 const mnemonics=asset.data?.Mnemonics;if(!Array.isArray(mnemonics))continue;
 for(const[index,raw]of mnemonics.entries())if(raw?.mnemonic==='EncountBoss'){
 let typed=null,diagnostic=null;try{typed=compileSourceBossEncounterInstruction(raw);}catch(error){diagnostic=error.message;}
 sites.push({assetId:asset.id,index,rawHash:hash(asset.data),source:{...asset.source,pointer:'/Mnemonics/'+index},
 raw:structuredClone(raw),typed,diagnostic,candidates:[{slotIndex:0,partyId:raw.operands.iValues[0]}]});
 }}
const supportingNormalSites=[];for(const asset of snapshot.assets){if(asset.kind!=='script'||!Array.isArray(asset.data?.Mnemonics))continue;for(const[index,raw]of asset.data.Mnemonics.entries())if(raw?.mnemonic==='Encount')supportingNormalSites.push({assetId:asset.id,index,rawHash:hash(asset.data),source:{...asset.source,pointer:'/Mnemonics/'+index},raw:structuredClone(raw),candidates:sourceEncounterLiteralCandidates(raw)});}assert.equal(supportingNormalSites.length,185);
assert.equal(sites.length,48);assert.ok(sites.every(site=>site.raw.type===1 && site.raw.operands.iValues.length===8 && site.raw.operands.rValues.length===8 && site.raw.operands.sValues.length===8));
const selectedPrograms=new Set([...sites,...supportingNormalSites].map(site=>site.assetId)),sourcePrograms=snapshot.assets.filter(asset=>selectedPrograms.has(asset.id))
 .map(asset=>({id:asset.id,source:structuredClone(asset.source),rawHash:hash(asset.data),raw:structuredClone(asset.data),
 instructionCount:asset.data.Mnemonics.length,runtimeAdmission:'unassessed',storyReachability:'unassessed'})).sort((a,b)=>a.id.localeCompare(b.id));
const bossPartyIds=[...new Set(sites.flatMap(site=>site.candidates.map(row=>row.partyId)))].sort((a,b)=>a-b),partyIds=[...new Set([...sites,...supportingNormalSites].flatMap(site=>site.candidates.map(row=>row.partyId)))].sort((a,b)=>a-b);
assert.equal(bossPartyIds.length,44);assert.equal(partyIds.length,133);assert.equal(sites.flatMap(site=>site.candidates).length,48);
const {readSourceBattleDirectoryPolicy}=await import(new URL('./source-battle-directory.mjs',import.meta.url)),
 declaration=await readSourceBattleDirectoryPolicy({root,compiledDir:compiled,policy:await input(options.policy)});
const source=await compileSharedBattleSource(root),base=await compileSharedGameCatalog(root,source),exportSnapshot=await readSnapshot(resolve(root,'build/battle')),
 exported=JSON.parse(snapshotFile(exportSnapshot,'battle.json').toString()),corpus=await loadSystemSource(root,snapshot.manifest.parentSourceSetHash),
 bindings=new Map(),reader={};
for(const method of['row','unique','group','matching'])reader[method]=(...args)=>{const rows=corpus.reader[method](...args);
 for(const row of Array.isArray(rows)?rows:[rows])bindings.set(canonical({table:args[0],source:row.source}),{table:args[0],source:row.source});return rows;};
reader.handoffMusic=createBattleHandoffMusicLookup(corpus.tables,reader);
const descriptors=compileBattleEncounterSources(reader,{partyIds,json:name=>{
 const found=Object.values(exported.assets).filter(asset=>asset.source.assetPath.endsWith('/'+name+'.json'));assert.equal(found.length,1);
 const asset=found[0],files=exported.sources.filter(file=>file.file===asset.source.file||file.file.endsWith('/'+asset.source.file));assert.equal(files.length,1);
 return{data:asset.data,source:{...asset.source,sha256:files[0].sha256,sourceSetHash:source.parentSourceSetHash,battleSourceSetHash:source.sourceSetHash}};
},spritePath:suffix=>{const found=Object.keys(exported.sprites).filter(path=>path.toLowerCase().endsWith(suffix.toLowerCase()));assert.equal(found.length,1);return found[0];}});
const {compileSourceBattleDirectoryEntryPolicy,composeFrameworkBattleDirectory}=await import(new URL('./source-battle-directory.mjs',import.meta.url)),
 shared=await compileGameCatalogModules(root,source),development=await compileSourceBattleDirectoryEntryPolicy({root,compiledDir:compiled,
 policy:declaration.framework.entry,encounters:descriptors.encounters}),
 common={...shared.runtimeInput,requestedPartyIds:partyIds,encounters:descriptors.encounters,sourceDiagnostics:descriptors.diagnostics},
 strict=compileBattleEncounterRuntime(shared.reader,{...common,handoff:{policy:null},development:{scripts:[],flagGroups:[]}}),
 framework=compileBattleEncounterRuntime(shared.reader,{...common,...(declaration.framework.manualControls===undefined?{}:{manualControls:declaration.framework.manualControls}),...(declaration.framework.conditionControlPolicy?{conditionControlPolicy:declaration.framework.conditionControlPolicy}:{}),handoff:{policy:declaration.framework.handoff},development}),
 composed=await composeFrameworkBattleDirectory({root,compiledDir:compiled,baseCatalog:base,runtime:framework,conditionControlPolicy:declaration.framework.conditionControlPolicy});
assert.equal(canonical(composed.catalog.gameState),canonical(base.gameState));
const strictCatalog=assembleGameCatalog({...shared,reader:shared.reader,runtimeInput:{...common,handoff:{policy:null}}},
 {kind:'source-new-game',limitations:[...base.common.limitations]});
assert.equal(canonical(strictCatalog.gameState),canonical(base.gameState));
const summarize=value=>({definitions:Object.keys(value.encounters).length,entries:value.report.entries.length,
 statuses:value.report.entries.reduce((a,e)=>(a[e.status]=(a[e.status]??0)+1,a),{}),diagnostics:value.diagnostics.length});
assert.equal((await runtime()).sha256,runtimeBefore.sha256,'Compiler runtime drift');
assert.equal(hash(await loadCorpus(root)),sourceDigest,'Source corpus drift');
for(const[path,digest]of inputs)assert.equal(sha(await readFile(resolve(root,path))),digest,'Input drift '+path);
const body={kind:'source-boss-encounter-candidate-directory-proof-v1',tool:{path:'scripts/compile-source-boss-candidates.mjs',sha256:sha(await readFile(import.meta.filename))},runtime:runtimeBefore,sourceSetHash:snapshot.sourceSetHash,
 parentSourceSetHash:snapshot.manifest.parentSourceSetHash,sourceDigest,inputs:[...inputs].map(([path,sha256])=>({path,sha256})),
 counts:{bossSites:sites.length,bossPhysicalPrograms:new Set(sites.map(site=>site.assetId)).size,ordinarySites:supportingNormalSites.length,ordinaryPhysicalPrograms:new Set(supportingNormalSites.map(site=>site.assetId)).size,physicalPrograms:new Set([...sites,...supportingNormalSites].map(site=>site.assetId)).size,bossReferences:sites.flatMap(site=>site.candidates).length,bossCandidates:bossPartyIds.length,candidates:partyIds.length},sourcePrograms,sites,supportingNormalSites,partyIds,bossPartyIds,
 baseCatalogHash:base.contentHash,sourceDescriptors:descriptors,
 conditionSourceBindings:shared.readConditionSourceBindings(),conditionSourceBindingsHash:hash(shared.readConditionSourceBindings()),
 sourceBindings:[...bindings.values()],strict:{runtime:strict,analysis:analyzeBatchEncounters(strictCatalog,partyIds)},
 web:{policyChanges:composed.policyChanges,policy:declaration.framework,runtime:composed.runtime,analysis:analyzeBatchEncounters(composed.catalog,partyIds)},
 catalogHash:composed.catalog.contentHash,sourceStoryReachability:false,completeSourceProgramExecution:'unassessed',
 limitations:['All 48 raw Boss dependencies, complete programs and exact source identities remain retained; decoding and conditional definitions never grant a playable battle. No ordinary lottery or story state is substituted.',
 'Catalog retains source initializer and owned GameState exactly. Native Unity random/entry scripts/flag omissions are not native parity.',
 'Complete source graph and map entry closure remain independent unassessed boundaries.']};
const report={...body,contentHash:hash(body)};
await writeFile(resolve(out,'source-boss-battle-candidate.json'),JSON.stringify(composed.catalog,null,2)+'\n');
await writeFile(resolve(out,'source-boss-battle-candidate-proof.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...body.counts,strict:summarize(strict),web:summarize(composed.runtime),sourceStateUnchanged:true,
 catalogHash:body.catalogHash,reportHash:report.contentHash}));
