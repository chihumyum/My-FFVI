import {createSourceMessageFeeEvidenceReader,auditSourceMessageFeeAddition} from './source-message-fee-evidence.mjs';
// Complete source message-fee family and whole-world dependency inventory.
// Pure producer only; no public collection or tracked recipe pins are read.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateSourcePrerequisiteInputs} from './compile-source-prerequisites.mjs';
import {loadSourceFamilyPrerequisites} from './source-family-prerequisites.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),o={compiled:'dist',output:'build/reports/source-message-fees'},seen=new Set();
while(args.length){const f=args.shift();assert(['--compiled','--output','--comparison-battle','--candidate-dir'].includes(f)&&args[0]&&!seen.has(f));seen.add(f);o[f.slice(2)]=args.shift();}
const compiled=resolve(root,o.compiled),out=resolve(root,o.output),sha=x=>createHash('sha256').update(x).digest('hex');assert(out.startsWith(resolve(root,'build')+'/'));await mkdir(out,{recursive:true});await mkdir(resolve(out,'maps'),{recursive:true});
const load=p=>import(pathToFileURL(resolve(compiled,'src',p+'.js'))),api=Object.assign({},...await Promise.all(['compiler/content','compiler/corpus','compiler/system-messages','compiler/story-corpus','compiler/map-package','compiler/content-dependencies','core/content-integrity','core/field-message-template'].map(load))),
 runtime=await runtimeDigest(root,compiled),snapshot=await api.loadCorpus(root),sourceDigest=api.hash(snapshot),messages=await api.loadSystemMessages(root,snapshot.manifest.parentSourceSetHash,snapshot.manifest.sources),
 ir=api.compileStoryCorpus({...snapshot,messages:{...snapshot.messages,system_zhc:messages.messages}}),assets=new Map(snapshot.assets.map(a=>[a.id,a])),programs=new Map(ir.scripts.map(p=>[p.id,p]));
const isSelected=i=>i.raw.mnemonic==='SetGilTag'||i.decoded?.kind==='message'&&i.decoded.template&&api.fieldMessageUsesFee(i.decoded.template)||i.decoded?.kind==='source-message'&&i.decoded.command.kind==='sequence'&&i.decoded.command.template&&api.fieldMessageUsesFee(i.decoded.command.template);
const selected=ir.scripts.filter(p=>p.instructions.some(isSelected)),
 sites=selected.flatMap(p=>p.instructions.filter(isSelected).map(i=>({program:p.id,rawHash:p.rawHash,...i}))),
 bindings=api.bindMapPackages(snapshot.assets,snapshot.tables),roots=[];
for(const b of bindings){const namespace={...b.residentScripts,...b.scriptAliases};for(const[alias,id]of Object.entries(namespace))if(id&&selected.some(p=>p.id===id))roots.push({mapId:Number(b.id),alias,programId:id,namespace,bindingIssues:b.issues});}
const closures=roots.map(root=>{const todo=[root.programId],ids=new Set(),edges=[],diagnostics=[];while(todo.length){const id=todo.shift();if(ids.has(id))continue;ids.add(id);const p=programs.get(id);if(!p){diagnostics.push({kind:'missing-program',id});continue;}
 for(const i of p.instructions){if(i.operandDecoded!=='decoded')diagnostics.push({kind:'operand',site:i.site,raw:i.raw,diagnostic:i.diagnostic});
  const op=i.decoded,next=op?.kind==='source-encounter'?op.command.continuation:op?.kind==='script-transition'?op.targetScript:null;
  if(next){const target=root.namespace[next]??null;edges.push({site:i.site,alias:next,target});if(target)todo.push(target);else diagnostics.push({kind:'unresolved-alias',site:i.site,alias:next});}}
 }return{...root,programIds:[...ids],edges,diagnostics,operandClosed:diagnostics.length===0,runtimeAdmission:'unassessed',storyReachability:'unverified'};});
const prerequisites=await loadSourceFamilyPrerequisites({root,compiledDir:compiled,...(o['candidate-dir']?{candidateDir:o['candidate-dir']}:{})}),payloads=prerequisites.payloads,
 strict=payloads.get('/world/catalog.json'),framework=payloads.get('/framework/world/catalog.json'),maps=Object.values(strict.maps).map(r=>payloads.get(r.url)),
 graphRoots=maps.flatMap(m=>[...Object.keys(m.scripts).map(script=>({kind:'script',mapId:m.mapId,script})),...(m.partyEntry?.pointIns??[]).map(p=>({kind:'entry',mapId:m.mapId,entrance:p.id,continuation:null}))]);
const graph=api.analyzeContentDependencies({catalog:strict,maps,roots:graphRoots,mapIds:maps.map(m=>m.mapId)});
const artifacts={};async function artifact(file,value){const bytes=JSON.stringify(value)+'\n';await writeFile(resolve(out,file),bytes);return{file,sha256:sha(bytes),contentHash:api.hash(value),bytes:Buffer.byteLength(bytes)};}
artifacts.completeCorpus=await artifact('complete-corpus.json',ir);artifacts.allSourceDependencies=await artifact('complete-source-dependencies.json',graph);
artifacts.roots=await artifact('roots.json',closures);artifacts.sites=await artifact('all-source-sites.json',sites);
for(const map of maps)await artifact('maps/'+map.mapId+'.json',{source:map,framework:payloads.get(framework.maps[map.mapId].url)});
for(const[name,url]of Object.entries({strictWorld:'/world/catalog.json',frameworkWorld:'/framework/world/catalog.json',sourceEntry:'/game/source-new-game.json',sourceBattle:'/game/source-catalog.json',frameworkEntry:'/framework/new-game.json'}))artifacts[name]=await artifact(name+'.json',payloads.get(url));
artifacts.prerequisites=await artifact('prerequisites.json',{inputs:prerequisites.inputs,report:prerequisites.report,...(prerequisites.candidateEvidence?{candidateEvidence:prerequisites.candidateEvidence}:{})});
const recipeBytes=await readFile(resolve(root,'content-batches/systems-initialized.recipe.json')),recipe=JSON.parse(recipeBytes),
 sourceEntry=payloads.get('/game/source-new-game.json'),sourceBattle=payloads.get('/game/source-catalog.json'),
 fresh=new Map([[recipe.sourceEntry.url,sourceEntry],[recipe.sourceBattle.url,sourceBattle],[recipe.sourceWorld.url,strict],
 [recipe.sourceMap.url,maps.find(m=>m.mapId===Number(recipe.sourceMap.url.match(/(\d+)\.json$/)[1]))]]);
for(const key of ['sourceEntry','sourceBattle','sourceWorld','sourceMap'])recipe[key].contentHash=fresh.get(recipe[key].url).contentHash;
const {compileInitializedSystems}=await import('./build-initialized-systems.mjs'),systems=await compileInitializedSystems(root,recipe,api.hash(recipe),
 {dist:compiled,readJson:async url=>{assert(fresh.has(url),'Unexpected mutable public read '+url);return fresh.get(url);}});
assert.equal(api.canonical(systems.battle.gameState),api.canonical(sourceBattle.gameState));
artifacts.sourceFees=await artifact('source-fee-catalog.json',sourceBattle.common.sourceMessageFees);
const pinnedPrivateGame=JSON.parse(await readFile(resolve(root,'build/game/source-catalog.json'),'utf8'));assert.equal(api.canonical(sourceBattle.gameState),api.canonical(pinnedPrivateGame.gameState),'Original source-owned initialization must remain byte-identical');
// An older fixed source payload can predate other already-delivered capability
// changes. A caller may supply a separately captured same-source compiler
// baseline; it must still pass the exact whole-common/whole-owned comparison.
const comparisonPath=resolve(root,o['comparison-battle']??'build/game/source-catalog.json'),comparisonBytes=await readFile(comparisonPath),comparisonBattle=await api.verifyContent(JSON.parse(comparisonBytes)),comparisonInput={file:comparisonPath,sha256:sha(comparisonBytes),kind:o['comparison-battle']?'explicit-captured-compiler-baseline':'locked-game-catalog'};
const addition=await auditSourceMessageFeeAddition({before:comparisonBattle,after:sourceBattle,canonical:api.canonical,declaration:{kind:'compiled-source-message-fee-addition-v1',compilerDigest:prerequisites.inputs.compilerDigest,sourceSetHash:snapshot.sourceSetHash,parentSourceSetHash:snapshot.manifest.parentSourceSetHash},evidence:createSourceMessageFeeEvidenceReader({root,compiledDir:compiled})});
artifacts.sourceFeeAddition=await artifact('source-fee-addition-audit.json',addition);
artifacts.systems=await artifact('controlled-systems.json',{content:systems.entry,world:systems.catalog,map:systems.map,battle:systems.battle,
 originalRecipeSha256:sha(recipeBytes),detachedPins:recipe,sourceOwnedInitializationUnchanged:true});
const combinations=new Map();for(const s of sites){const k=api.hash(s.raw.operands);const r=combinations.get(k)??{raw:s.raw.operands,sites:[]};r.sites.push(s.site);combinations.set(k,r);}
const ids=new Set(closures.flatMap(c=>c.programIds)),counts={...ir.counts,maps:maps.length,physicalPrograms:selected.length,physicalSites:sites.length,mapIds:[...new Set(sites.flatMap(s=>s.site.maps))].length,
 parameterCombinations:combinations.size,feeInstructionSites:sites.filter(s=>s.raw.mnemonic==='SetGilTag').length,amountMessageSites:sites.filter(s=>s.raw.mnemonic!=='SetGilTag').length,sourceFeeGroups:sourceBattle.common.sourceMessageFees.fees.length,sourceFeeBlockers:sourceBattle.common.sourceMessageFees.blockers.length,wholeAliasRoots:roots.length,closurePrograms:ids.size,closureInstructions:[...ids].reduce((n,id)=>n+(programs.get(id)?.instructions.length??0),0),operandClosedRoots:closures.filter(c=>c.operandClosed).length,allGraphRoots:graphRoots.length,allGraphEdges:graph.edges.length,allGraphDiagnostics:graph.diagnostics.length};
assert.equal(await runtimeDigest(root,compiled),runtime);assert.equal(api.hash(await api.loadCorpus(root)),sourceDigest);await validateSourcePrerequisiteInputs(prerequisites.inputs,{root});if(prerequisites.validate)await prerequisites.validate();assert.equal(sha(await readFile(comparisonPath)),comparisonInput.sha256,'Captured comparison input changed');
const report={kind:'source-message-fees-whole-family-inventory-v1',result:'whole-family-retained',runtime,sourceDigest,sourceSetHash:snapshot.sourceSetHash,parentSourceSetHash:snapshot.manifest.parentSourceSetHash,comparisonInput,counts,parameterCombinations:[...combinations.values()],artifacts,
 semantics:{native:'SetGilTag selects Product.GroupId==i0 and formats Product.Coefficient into MessageManager replacement KINGAKU',web:'Same SourceMessageState holds the source-bound replacement; window snapshot; original GameState payment and recovery owners remain separate',persistence:'Explicit Web source-bound replacement codec across maps, event/stable Storage and battle return; native save parity unassessed'},publishedInputsRead:false,sourceCampaignComplete:false,nativeParity:false,browserVerified:false,runtimeAdmission:'unassessed'};
report.contentHash=api.hash(report);await writeFile(resolve(out,'inventory.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts,contentHash:report.contentHash}));
