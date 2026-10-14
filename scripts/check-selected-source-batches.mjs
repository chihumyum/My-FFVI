// Fresh declared routes over the published selection. Complete dependency
// diagnostics remain separate from route completion and source admission.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimeDigest} from './runtime-digest.mjs';
import {runContentBatchRoute} from './content-batch-route.mjs';

const repository=resolve(import.meta.dirname,'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(base,path)=>{const part=relative(base,path);return part!==''&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);};
const digest=/^[a-f0-9]{64}$/;
const slug=/^[a-z0-9][a-z0-9-]{0,79}$/;
const jsonURL=/^\/content-packages\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/;
const selectionURL='/content-packages/source-batches/selection.json';
const workURL='/content-packages/source-batches/work-plan.json';
function keys(value,expected){
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'Invalid published source selection record');
  assert.deepEqual(Object.keys(value).sort(),expected.split(',').sort(),'Unknown published source selection fields');
}
function parseArgs(args){
  const options=new Map(),usage='Use check-selected-source-batches.mjs [--compiled-dir directory] [--content-dir directory] [--report build/reports/name.json]';
  for(let i=0;i<args.length;i++){
    const name=args[i],value=args[++i];
    assert.ok(['--compiled-dir','--content-dir','--report'].includes(name)&&value&&!value.startsWith('--')&&!options.has(name),usage);
    options.set(name,value);
  }
  return {compiledDir:options.get('--compiled-dir')??'dist',contentDir:options.get('--content-dir')??'build/content-packages',
    reportPath:options.get('--report')??'build/reports/selected-source-batches-check.json'};
}

export async function checkSelectedSourceBatches({root=repository,compiledDir='dist',contentDir='build/content-packages',
  reportPath='build/reports/selected-source-batches-check.json'}={}){
  root=await realpath(resolve(root));
  const reportRoot=resolve(root,'build/reports');let output=resolve(reportRoot,'selected-source-batches-check.json');
  const report={kind:'selected-source-batches-check-v1',result:'running',tests:[],batches:[],
    declaredRoutes:{status:'not-run',completed:0},wholeSourceBatchAdmission:{status:'not-assessed',
      reason:'Declared routes do not admit the whole source batch; all diagnostics are retained.'},
    runtimeAdmission:'unassessed',sourceCampaignComplete:false,sourceStoryReachability:false,browserVerified:false,
    originalGameExecuted:false,fullGameMigration:false,
    evidence:{execution:'actual GameContentRepository and runContentBatchRoute; existing entry/Flow/map/prepared battle/commands/storage owners',
      media:'controlled immediate completion; no decoding, audible output or browser pixels',
      entry:'source DataInitialize with declared authored PointIn and ordinary flat presentation; no story-state substitution'}};
  const inputs=new Map();
  try{
    const requested=resolve(root,reportPath);
    assert.ok(within(reportRoot,requested)&&requested.endsWith('.json'),'Report must be a JSON file inside build/reports');output=requested;
    const compiled=await realpath(resolve(root,compiledDir)),content=await realpath(resolve(root,contentDir));
    assert.ok(within(root,compiled),'Compiled modules must remain inside the repository');
    assert.ok(within(resolve(root,'build'),content),'Content collection must remain inside build');
    assert.ok((await lstat(compiled)).isDirectory()&&(await lstat(content)).isDirectory(),'Expected compiled and content directories');
    report.compiledDirectory=relative(root,compiled);report.contentDirectory=relative(root,content);
    const load=name=>import(pathToFileURL(resolve(compiled,'src',name+'.js')).href);
    const api=Object.assign({},...await Promise.all(['core/game-content','core/game-content-refs','core/content-integrity','core/canonical',
      'compiler/content-batch','compiler/content-batch-work-set','compiler/source-walk-policy'].map(load)));
    const read=async url=>{
      assert.match(url,jsonURL,'Only this published collection supplies JSON dependencies');
      const logical=resolve(content,url.slice('/content-packages/'.length)),file=await realpath(logical);
      assert.ok(within(content,file),'Published JSON escaped the selected collection');
      const info=await lstat(logical);assert.ok(info.isFile()&&!info.isSymbolicLink(),'Published JSON must be a regular file');
      const bytes=await readFile(file),fingerprint=sha(bytes),prior=inputs.get(url);
      if(prior)assert.ok(prior.file===file&&prior.fingerprint===fingerprint,'Published collection changed during validation: '+url);
      else inputs.set(url,{logical,file,fingerprint});
      return JSON.parse(bytes.toString('utf8'));
    };
    const validateInputs=async()=>{
      for(const [url,{logical,file,fingerprint}] of inputs){
        assert.equal(await realpath(logical),file,'Published JSON path changed: '+url);
        assert.equal(sha(await readFile(file)),fingerprint,'Published JSON bytes changed: '+url);
      }
    };
    const initialRuntime=await runtimeDigest(root,compiled);report.runtimeSha256=initialRuntime;
    const receipt=await api.verifyContent(await read(selectionURL));
    keys(receipt,'kind,id,path,sha256,items,workPlan,contentHash');
    assert.equal(receipt.kind,'source-content-selection-receipt-v1');
    assert.ok(typeof receipt.id==='string'&&receipt.id.trim()&&receipt.id.length<=160);assert.match(receipt.sha256,digest);
    assert.ok(receipt.path===null||typeof receipt.path==='string'&&/^content-batches\/[a-z0-9][a-z0-9_.-]*\.json$/.test(receipt.path));
    assert.ok(Array.isArray(receipt.items),'Published selection items must be an array');
    const packageIds=new Set(),manifestIds=new Set(),recipePaths=new Set();
    for(const item of receipt.items){
      keys(item,'path,sha256,label,id,manifestId');assert.match(item.id,slug);assert.match(item.sha256,digest);
      assert.match(item.path,/^content-batches\/[a-z0-9][a-z0-9-]{0,79}\.recipe\.json$/);
      assert.match(item.manifestId,/^[a-z0-9][a-z0-9-]{0,159}$/);
      assert.ok(typeof item.label==='string'&&item.label.trim()&&item.label.length<=160);
      assert.ok(!packageIds.has(item.id)&&!manifestIds.has(item.manifestId)&&!recipePaths.has(item.path),'Ambiguous published selection ownership');
      packageIds.add(item.id);manifestIds.add(item.manifestId);recipePaths.add(item.path);
    }
    report.selection={id:receipt.id,path:receipt.path,sha256:receipt.sha256,contentHash:receipt.contentHash,items:receipt.items};
    if(receipt.items.length===0){
      assert.equal(receipt.workPlan,null,'An empty selection cannot point at a retained old work set');
      await validateInputs();assert.equal(await runtimeDigest(root,compiled),initialRuntime,'Runtime changed during empty selection validation');
      report.result='not-assessed';report.declaredRoutes.status='no-selected-source-batches';return report;
    }
    keys(receipt.workPlan,'url,contentHash');assert.equal(receipt.workPlan.url,workURL);assert.match(receipt.workPlan.contentHash,digest);
    const work=await api.verifyContent(await read(receipt.workPlan.url),receipt.workPlan.contentHash);
    assert.equal(work.kind,'content-batch-work-set-v1');assert.equal(work.runtimeSha256,initialRuntime,'Work set belongs to another runtime');
    assert.equal(work.runtimeAdmission,'unassessed');assert.equal(work.sourceCampaignComplete,false);
    assert.equal(api.canonical(work.selection),api.canonical({id:receipt.id,sha256:receipt.sha256}));
    assert.ok(Array.isArray(work.batches)&&work.batches.length===receipt.items.length,'Selection/work-set membership changed');
    const selected=work.batches.map(batch=>({path:batch.recipePath,sha256:batch.recipeSha256,label:batch.label,
      id:batch.packageId,manifestId:batch.work.batchId}));
    assert.equal(api.canonical(selected),api.canonical(receipt.items),'Selection/work-set identities or order changed');
    report.workSet={contentHash:work.contentHash,counts:work.counts};
    const sourceRefs=api.parseGameContentRefs(await read('/content-packages/source.json'));
    assert.equal(sourceRefs.profile,'source');assert.ok(sourceRefs.source,'Published collection requires its strict source lane');
    const sourceRepository=new api.GameContentRepository(read,'source',sourceRefs),sourceWorld=await sourceRepository.world();
    const prepared=[];
    for(const batch of work.batches){
      const prefix='/content-packages/'+batch.packageId,refs=api.parseGameContentRefs(await read(prefix+'.json'));
      const manifest=api.ContentBatchManifest.parse(await read(prefix+'/manifest.json'));
      assert.equal(manifest.id,batch.work.batchId);assert.equal(api.canonical(manifest.contentRefs),api.canonical(refs));
      assert.equal(refs.profile,manifest.profile);assert.equal(refs.profile,'framework');
      assert.ok(refs.kind==='game-content-refs-v2'&&refs.initialized&&refs.source===null&&refs.development===null,
        'Selected source-map package must retain its declared initialized lane');
      const repository=new api.GameContentRepository(read,refs.profile,refs),bundle=await repository.initializedNewGame();
      const maps=await Promise.all(manifest.mapIds.map(id=>repository.map(id,bundle.catalog)));
      const plan=api.planContentBatch(manifest,{entry:bundle.content,battle:bundle.battle,catalog:bundle.catalog,maps});
      assert.equal(plan.manifestHash,batch.work.manifestHash);assert.equal(plan.dependencyHash,batch.work.dependencyHash);
      assert.equal(api.canonical(plan.contentHashes),api.canonical(batch.work.contentHashes));
      const built=await read(prefix+'/build-report.json');
      assert.equal(built.kind,'initialized-source-map-build-v1');assert.equal(built.package,batch.packageId);
      assert.equal(built.recipeSha256,batch.recipeSha256);assert.equal(api.canonical(built.refs),api.canonical(refs));
      assert.equal(built.sourceInputs.world.contentHash,sourceWorld.contentHash);
      assert.equal(bundle.catalog.developmentProfile.sourceContentHash,sourceWorld.contentHash);
      assert.equal(built.sourceInputs.battle.contentHash,sourceRefs.source.battle.contentHash);
      const walkingMaps=new Map();
      if(built.walking!==undefined){
        assert.equal(built.nativeWalkingRulesVerified,false);assert.ok(Array.isArray(built.walking));
        assert.ok(built.battleDirectory,'Walking package must name the shared bulk directory');
        const directory=await api.verifyContent(await read('/content-packages/source-battle-directory/framework.json'));
        assert.equal(directory.contentHash,built.battleDirectory.catalogHash);
        assert.equal(directory.contentHash,bundle.battle.contentHash);
        const requests=await api.verifyContent(await read('/content-packages/source-battle-directory/requests.json'));
        assert.equal(requests.contentHash,built.battleDirectory.requestsHash);
        const directoryReport=await api.verifyContent(await read('/content-packages/source-battle-directory/build-report.json'),
          built.battleDirectory.reportHash);
        assert.equal(directoryReport.frameworkCatalogHash,directory.contentHash);
        assert.equal(directoryReport.requestsHash,requests.contentHash);
        assert.equal(directoryReport.baselineHash,sourceRefs.source.battle.contentHash);
        assert.equal(requests.sourceRequests.worldCatalogHash,sourceWorld.contentHash);
        for(const result of built.walking){
          assert.equal(result.status,'ready');assert.ok(!walkingMaps.has(result.binding.mapId));
          walkingMaps.set(result.binding.mapId,result);
        }
      }
      const row={packageId:batch.packageId,label:batch.label,manifestHash:plan.manifestHash,dependencyHash:plan.dependencyHash,
        contentHashes:plan.contentHashes,diagnostics:plan.diagnostics,referenceClosure:plan.dependencies.referenceClosure,
        providerRequirements:plan.dependencies.providerRequirements,providerAssessments:plan.dependencies.providerAssessments,
        maps:[],routes:manifest.routes.map(route=>({id:route.id,status:'not-run'}))};
      report.batches.push(row);
      for(const map of maps){
        const original=await sourceRepository.map(map.mapId,sourceWorld);
        assert.equal(original.developmentProfile,undefined);assert.equal(original.frameworkPresentation,undefined);
        assert.equal(map.developmentProfile.sourceContentHash,original.contentHash);
        const sourcePin=built.sourceInputs.maps.filter(item=>item.mapId===map.mapId);assert.equal(sourcePin.length,1);
        assert.equal(sourcePin[0].contentHash,original.contentHash);
        const {contentHash:_sourceHash,...sourceBody}=original;
        const {contentHash:_derivedHash,developmentProfile:_profile,frameworkPresentation:_presentation,...derivedBody}=map;
        if(walkingMaps.has(map.mapId)){
          const result=walkingMaps.get(map.mapId);
          assert.equal(api.canonical(result.source),api.canonical(original.sourceWalkEncounters));
          assert.equal(api.canonical(result.binding),api.canonical(map.frameworkWalkBinding));
          assert.equal(api.canonical(result.policy),api.canonical(map.walkEncounters));
          api.assertSourceWalkPolicyBinding({mapId:map.mapId,source:original.sourceWalkEncounters,
            catalog:bundle.battle,binding:map.frameworkWalkBinding,policy:map.walkEncounters});
          delete derivedBody.walkEncounters;delete derivedBody.frameworkWalkBinding;
        }
        assert.equal(api.canonical(derivedBody),api.canonical(sourceBody),'Source map payload changed: '+batch.packageId+'/'+map.mapId);
        row.maps.push({mapId:map.mapId,sourceHash:original.contentHash,derivedHash:map.contentHash,fullPayloadPreserved:true});
      }
      assert.ok([...walkingMaps.keys()].every(id=>maps.some(map=>map.mapId===id)),
        'Walking build record names a map outside this package');
      report.tests.push({name:batch.packageId+': exact selected content and complete original map payloads',passed:true});
      prepared.push({batch,plan,repository,row});
    }
    const projected=api.projectContentBatchWorkSet({selection:work.selection,runtimeSha256:initialRuntime,batches:prepared.map(({batch,plan})=>
      ({packageId:batch.packageId,label:batch.label,recipePath:batch.recipePath,recipeSha256:batch.recipeSha256,plan}))});
    assert.equal(api.canonical(projected),api.canonical(work),'Published unified work set differs from fresh complete plans');
    report.tests.push({name:'selection and unified work set retain every current diagnostic/provider record',passed:true});
    for(const {plan,repository,row} of prepared)for(const route of plan.manifest.routes){
      assert.equal(await runtimeDigest(root,compiled),initialRuntime,'Runtime changed before a declared route');
      const result=await runContentBatchRoute({root,compiled,plan,routeId:route.id,repository,runtimeHash:initialRuntime});
      const record=row.routes.find(item=>item.id===route.id);Object.assign(record,{status:result.receipt.result,...result});
      assert.equal(result.receipt.result,'completed',JSON.stringify(result.receipt.boundary));
      assert.equal(result.receipt.runtimeHash,initialRuntime);assert.equal(result.receipt.manifestHash,plan.manifestHash);
      assert.equal(result.receipt.dependencyHash,plan.dependencyHash);assert.equal(api.canonical(result.receipt.contentHashes),api.canonical(plan.contentHashes));
      assert.equal(result.receipt.saveRestored,true);assert.equal(result.receipt.checkpointReady,true);
      report.declaredRoutes.completed++;report.tests.push({name:row.packageId+': '+route.id+' declared route and save/restore continuation',passed:true});
      await validateInputs();assert.equal(await runtimeDigest(root,compiled),initialRuntime,'Runtime changed during a declared route');
    }
    await validateInputs();assert.equal(await runtimeDigest(root,compiled),initialRuntime,'Runtime changed during selected-source validation');
    report.declaredRoutes.status='passed';report.result='passed';return report;
  }catch(error){report.result='failed';report.declaredRoutes.status='failed';report.error=String(error.stack??error);throw error;}
  finally{
    report.readJSONFiles=inputs.size;await mkdir(resolve(output,'..'),{recursive:true});
    await writeFile(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({result:report.result,tests:report.tests.length,batches:report.batches.length,
      routes:report.declaredRoutes,wholeSourceBatchAdmission:'not-assessed',report:output}));
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let options;
  try{options=parseArgs(process.argv.slice(2));}
  catch(error){
    const output=resolve(repository,'build/reports/selected-source-batches-check.json');await mkdir(resolve(output,'..'),{recursive:true});
    await writeFile(output,JSON.stringify({kind:'selected-source-batches-check-v1',result:'failed',tests:[],error:String(error),
      wholeSourceBatchAdmission:{status:'not-assessed'},sourceCampaignComplete:false,browserVerified:false,fullGameMigration:false},null,2)+'\n');
    throw error;
  }
  await checkSelectedSourceBatches(options);
}
