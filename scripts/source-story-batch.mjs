// Complete declared source batches use the existing route executor and owners.
// No startEvent(), task-PC rewrite, state seed or independent VM lives here.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {runContentBatchRoute} from './content-batch-route.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
import {readSourceBatch} from './content-batch-files.mjs';

export async function runSourceStoryBatch({root,compiled='dist',plan,contract:rawContract,repository,binding,witnesses}) {
  const load=name=>import(pathToFileURL(resolve(root,compiled,'src/compiler',name+'.js')));
  const [{parseSourceStoryBatchContract,assessSourceStoryBatch,readSourceStoryCheckpointSlot},{hash,canonical}]=await Promise.all([load('source-story-batch'),load('content')]);
  const contract=parseSourceStoryBatchContract(rawContract),runtimeHash=await runtimeDigest(root,compiled),runs=[];
  assert.equal(binding.runtimeHash,runtimeHash,'Complete story batch requires this actual compiled runtime');
  assert.equal(contract.manifestHash,plan.manifestHash);assert.equal(contract.dependencyHash,plan.dependencyHash);
  assert.deepEqual(contract.routes.map(r=>r.id).sort(),plan.manifest.routes.map(r=>r.id).sort(),'All nominated routes require contracts');
  for(const declaration of contract.routes){
    const route=plan.manifest.routes.find(r=>r.id===declaration.id);assert.ok(route);
    assert.deepEqual([...declaration.requiredEncounterIds].sort((a,b)=>a-b),[...route.requiredEncounterIds].sort((a,b)=>a-b),'Cannot omit required source battles');
    if(contract.lane==='original-source')assert.equal(route.entry,'source-new-game','Original source batches require normal source entry');
    let continuation=null,inputCheckpoint=null;
    if(declaration.predecessorRouteId!==null){
      const previous=runs.find(r=>r.receipt.routeId===declaration.predecessorRouteId);
      if(previous?.receipt.result!=='completed'||!previous.finalState?.checkpoint)break;
      // Consume the actual existing Storage payload bytes, without reserializing
      // the old exit owner to manufacture a later entry.
      const relay=previous.sourceStory?.checkpointRelays.filter(r=>r.final).at(-1);assert.ok(relay);
      inputCheckpoint=readSourceStoryCheckpointSlot(relay.slotBytes);
      assert.equal(canonical(inputCheckpoint.checkpoint),canonical(previous.finalState.checkpoint));
      continuation={predecessorRouteId:declaration.predecessorRouteId,checkpoint:JSON.parse(inputCheckpoint.bytes),checkpointHash:hash(inputCheckpoint.checkpoint)};
    }
    const run=await runContentBatchRoute({root,compiled,plan,routeId:route.id,repository,runtimeHash,
      captureFinalState:true,captureSourceStory:true,continuation});
    if(inputCheckpoint)run.inputCheckpoint=inputCheckpoint;
    runs.push(run);
  }
  const afterRuntime=await runtimeDigest(root,compiled),diagnostics=plan.diagnostics.map(({code,reason})=>({code,reason}));
  if(afterRuntime!==runtimeHash)diagnostics.push({code:'RUNTIME_CHANGED_DURING_STORY_BATCH',reason:'Runtime changed during execution'});
  return {kind:'source-story-batch-execution-v1',runtimeHash,contract,runs,
    assessment:assessSourceStoryBatch({id:contract.id,contract,binding,manifestHash:plan.manifestHash,
      dependencyHash:plan.dependencyHash,diagnostics,witnesses,runs}),sourceCampaignComplete:false,originalGameExecuted:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){assert.ok(['--input-root','--compiled-dir','--manifest','--contract','--report'].includes(args[i])&&args[i+1]);assert.equal(options[args[i]],undefined);options[args[i]]=args[i+1];}
  const root=resolve(options['--input-root']??resolve(import.meta.dirname,'..')),compiled=options['--compiled-dir']??'dist';
  assert.ok(options['--manifest']&&options['--contract']&&options['--report'],'Explicit manifest, complete contract and report required');
  const {plan,repository,packages}=await readSourceBatch(root,options['--manifest'],compiled),
    contract=JSON.parse(await readFile(resolve(root,options['--contract']),'utf8')),
    {loadCorpus}=await import(pathToFileURL(resolve(root,compiled,'src/compiler/corpus.js'))),corpus=await loadCorpus(root);
  assert.equal(contract.lane,'original-source','CLI never promotes synthetic fixtures to source story');
  const binding=contract.routes[0]?.continuity?.binding;assert.ok(binding);
  assert.equal(binding.sourceFingerprints.corpus,corpus.sourceSetHash,'Actual verified corpus fingerprint required');
  const witnesses=contract.roots.map(rootSpec=>{
    const map=packages.maps.find(m=>m.mapId===rootSpec.mapId),typedBody=map?.scripts[rootSpec.script];assert.ok(typedBody);
    const source=typedBody[0]?.source;assert.ok(source);
    const matches=corpus.assets.filter(a=>a.kind==='script'&&a.source.file===source.file&&a.source.assetPath===source.assetPath&&a.source.objectId===source.objectId);
    assert.equal(matches.length,1,'Original raw source binding is missing or ambiguous');
    const asset=matches[0];assert.equal(binding.sourceFingerprints[rootSpec.fingerprintKey],asset.source.sha256);
    return {kind:'verified-source-program-v1',mapId:rootSpec.mapId,script:rootSpec.script,sourceSetHash:binding.sourceSetHash,
      source:asset.source,rawBody:asset.data.Mnemonics,typedBody};
  });
  const report=await runSourceStoryBatch({root,compiled,plan,contract,repository,binding,witnesses});
  const after=await readSourceBatch(root,options['--manifest'],compiled);
  const {hash}=await import(pathToFileURL(resolve(root,compiled,"src/compiler/content.js")));
  assert.equal(hash(await loadCorpus(root)),hash(corpus),"Verified original raw source changed during execution");
  assert.equal(after.plan.manifestHash,plan.manifestHash);assert.equal(after.plan.dependencyHash,plan.dependencyHash);
  const output=resolve(root,options['--report']);await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({id:contract.id,status:report.assessment.status,coverage:report.assessment.coverage,issues:report.assessment.issues.length,sourceCampaignComplete:false}));
  if(report.assessment.status!=='passed')process.exitCode=1;
}
