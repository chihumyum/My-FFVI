// Read an already complete frozen candidate. This tool never produces worlds.
import assert from 'node:assert/strict';import{readFile,writeFile,mkdir}from'node:fs/promises';import{resolve}from'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';
import{readSourceStoryExecutionGraph}from'./source-story-execution-inputs.mjs';import{runSourceStoryExploration}from'./source-story-explore.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),load=(dist,n)=>import(pathToFileURL(resolve(dist,'src',n+'.js')).href);
/** Select one frozen candidate role. Framework is the source-new-game role
 * under explicit Web policy, never initialized/custom placement authority. */
export async function prepareSourceStoryExploration({sourceCompiled,read,graph,profile='source',maxTicks=30000,battleAbilityIds=[]}){
 assert(['source','framework'].includes(profile),'Unknown source story content profile');
 const [{GameContentRepository},{parseGameContentRefs}]=await Promise.all([load(sourceCompiled,'core/game-content'),load(sourceCompiled,'core/game-content-refs')]);
 const urls=profile==='framework'?['/framework/world/catalog.json','/framework/full-new-game.json','/framework/full-battle.json']:['/world/catalog.json','/game/source-new-game.json','/game/source-catalog.json'];
 const [catalog,entry,battle]=await Promise.all(urls.map(url=>read(url)));
 assert.equal(entry.kind,'source-new-game-content-v1','Normal source-new-game body required');
 const expected={kind:'game-content-refs-v1',profile,world:{url:urls[0],contentHash:catalog.contentHash},source:{entry:{url:urls[1],contentHash:entry.contentHash},battle:{url:urls[2],contentHash:battle.contentHash}},development:null};
 const refs=parseGameContentRefs(profile==='framework'?await read('/framework/full-content-refs.json'):expected);
 assert.deepEqual(refs,expected,'Frozen source story refs/profile/body mismatch');
 const repository=new GameContentRepository(read,refs.profile,refs),bound=await repository.sourceNewGame();
 assert.equal(bound.catalog.contentHash,catalog.contentHash);assert.equal(bound.content.contentHash,entry.contentHash);assert.equal(bound.battle.contentHash,battle.contentHash);
 const maps=await Promise.all(Object.keys(catalog.maps).map(id=>repository.map(Number(id),catalog)));
 assert.deepEqual(maps.map(m=>m.mapId).sort((a,b)=>a-b),graph.maps.map(m=>m.mapId).sort((a,b)=>a-b),'All source maps must remain');
 const manifest={kind:'content-batch-manifest-v1',id:'automatic-source-execution-obligations',profile:refs.profile,contentRefs:refs,mapIds:maps.map(m=>m.mapId),
  roots:[{kind:'entry',mapId:entry.entry.mapId,entrance:entry.entry.entrance,continuation:entry.entry.reservedScript.name},...graph.roots.map(r=>({kind:'script',mapId:r.mapId,script:r.alias}))],
  routes:[{id:'normal-source-exploration',entry:'source-new-game',expectedMapId:entry.entry.mapId,requiredMapIds:maps.map(m=>m.mapId),requiredEncounterIds:[],maxTicks,inputs:[],choiceAnswers:[],battleAbilityIds}]};
 return {repository,packages:{catalog,entry,battle,maps},manifest};
}
export async function checkSourceStoryExploration({sourceRoot,sourceCompiled=resolve(sourceRoot,'dist'),candidateDir,output,
 toolingCompiled=resolve(import.meta.dirname,'../dist'),profile='source',maxTicks=30000,limits={maxTrials:16,maxInputDepth:4,maxChoiceDepth:8},battleAbilityIds=[]}){
 assert(['source','framework'].includes(profile),'Unknown source story content profile');
 sourceRoot=resolve(sourceRoot);assert(candidateDir&&output,'Explicit frozen candidate/output required');
 const {openSourceCandidate}=await import(pathToFileURL(resolve(sourceRoot,'scripts/source-candidate.mjs'))),candidate=await openSourceCandidate({root:sourceRoot,runtimeRoot:sourceRoot,compiledDir:sourceCompiled,candidateDir:resolve(candidateDir)}),
  {hash}=await load(sourceCompiled,'compiler/content'),
  {graph,binding}=await readSourceStoryExecutionGraph({sourceRoot,sourceCompiled,graphCompiled:toolingCompiled});
 assert.equal(candidate.runtimeSha256,graph.runtimeHash);
 const {repository,packages,manifest}=await prepareSourceStoryExploration({sourceCompiled,read:url=>candidate.read(url),graph,profile,maxTicks,battleAbilityIds});
 const report=await runSourceStoryExploration({root:sourceRoot,compiled:sourceCompiled,graph,packages,repository,manifest,toolingCompiled,lane:'original-source',limits});
 await candidate.validate();const directory=resolve(output);await mkdir(directory,{recursive:true});
 const graphBytes=Buffer.from(JSON.stringify({graph,binding})+'\n');await writeFile(resolve(directory,'graph.json'),graphBytes);
 const bytes=Buffer.from(JSON.stringify({...report,contentRefs:manifest.contentRefs,contentRefsHash:hash(manifest.contentRefs),sourceBinding:binding,candidateReportSha256:sha(candidate.reportBytes),inputLockHash:hash(candidate.lock)})+'\n');await writeFile(resolve(directory,'execution.json'),bytes);
 const summary={kind:'source-story-normal-exploration-check-v1',result:'execution-evidence-recorded-not-campaign-acceptance',lane:'original-source',profile,entry:'source-new-game',nativeParity:false,sourceRuntimeSha256:graph.runtimeHash,sourceSetHash:graph.sourceSetHash,sourceDigest:graph.sourceDigest,
  candidateReportSha256:sha(candidate.reportBytes),contentRefsHash:hash(manifest.contentRefs),graph:{file:resolve(directory,'graph.json'),sha256:sha(graphBytes),bytes:graphBytes.length,counts:graph.counts},
  execution:{file:resolve(directory,'execution.json'),sha256:sha(bytes),bytes:bytes.length},counts:report.ledger.counts,
  frontiers:report.unexpanded,completeStoryBatches:0,sourceCampaignComplete:false,worldCompilations:0,publications:0,browserVerified:false,originalGameExecuted:false};
 await writeFile(resolve(directory,'report.json'),JSON.stringify(summary,null,2)+'\n');return summary;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2){assert(['--source-root','--source-compiled','--candidate-dir','--tooling-compiled','--output','--profile','--max-ticks','--max-trials','--max-depth','--max-choice-depth','--battle-abilities'].includes(args[i])&&args[i+1]);assert(!Object.hasOwn(o,args[i]));o[args[i]]=args[i+1];}
 assert(o['--source-root']&&o['--candidate-dir']&&o['--output']);
 const summary=await checkSourceStoryExploration({sourceRoot:resolve(o['--source-root']),...(o['--source-compiled']?{sourceCompiled:resolve(o['--source-compiled'])}:{}),candidateDir:resolve(o['--candidate-dir']),output:resolve(o['--output']),
  ...(o['--tooling-compiled']?{toolingCompiled:resolve(o['--tooling-compiled'])}:{}),profile:o['--profile']??'source',maxTicks:Number(o['--max-ticks']??30000),
  limits:{maxTrials:Number(o['--max-trials']??16),maxInputDepth:Number(o['--max-depth']??4),maxChoiceDepth:Number(o['--max-choice-depth']??8)},battleAbilityIds:o['--battle-abilities']?o['--battle-abilities'].split(',').map(Number):[]});
 console.log(JSON.stringify({...summary,frontiers:summary.frontiers.map(f=>({reason:f.reason,frontier:f.frontier?.kind??null}))}));
}
