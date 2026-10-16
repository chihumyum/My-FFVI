// One complete frozen source/candidate feeds the global implementation queue.
// The planner is separately fingerprinted; it never signs a different game
// runtime or treats a structural closure as an executed story contract.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {normalizeSourceMigrationInput} from './source-migration-input.mjs';

const repository=resolve(import.meta.dirname,'..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const load=(dist,name)=>import(pathToFileURL(resolve(dist,'src',name+'.js')).href);
export function parseSourceMigrationOptions(args){
  const options={};for(let index=0;index<args.length;index+=2){
    const key=args[index],value=args[index+1];
    assert(['--source-root','--source-compiled','--candidate-dir','--planner-compiled','--registry','--battle-audit','--output','--parallelism'].includes(key)&&value&&!value.startsWith('--'),'Unknown or missing source migration option');
    assert(!Object.hasOwn(options,key),'Duplicate source migration option');options[key]=value;
  }
  assert(options['--source-root']&&options['--candidate-dir']&&options['--battle-audit'],'A complete frozen source, candidate and full-source battle audit are required');
  const parallelism=Number(options['--parallelism']??3);assert(Number.isSafeInteger(parallelism)&&parallelism>=1&&parallelism<=8,'Invalid parallelism');
  return{...options,parallelism};
}
function markdown(workset,report){
  const escape=text=>String(text).replaceAll('|','\\|').replaceAll('\n',' '),byGap=new Map(workset.gaps.map(g=>[g.id,g]));
  return['# 全来源共用能力工作队列','',
    `来源程序 ${workset.counts.programs}，原指令 ${workset.counts.instructions}，地图 ${report.maps}。`,
    '每波按不同系统 owner 并行，每条工作流最多提名三个互补缺口。完整地图和已声明剧情合同优先，独立程序不计作同等剧情收益。开场首个报错不参与评分。','',
    '已知准备度只计算当前可归类缺口；所有未知继续阻塞严格闭合。下表收益属于整波的共同假设，不能当作单项成果或已完成剧情。','',
    '| 波次 | 并行工作流 | 共用能力 | 本波潜在已知准备地图 | 本波潜在严格闭合地图 |',
    '| --- | --- | --- | ---: | ---: |',
    ...workset.waves.flatMap(w=>w.ownerLanes.map(lane=>`| ${w.index} | ${escape(lane.owner)} | ${lane.gapIds.map(id=>escape(byGap.get(id).code)).join(' + ')} | ${w.potentialMapIdsPrepared.length} | ${w.potentialMapIdsClosed.length} |`)),
    '',`保留 ${workset.blocked.length} 个未归类或依赖阻塞任务；完整定位与原诊断见 workset.json。`,
    `剧情合同缺失 ${workset.batches.filter(b=>b.executionAcceptance==='missing-contract').length} 批。静态闭包不代表剧情章节，只有真正执行完整剧情合同才记贯通。`,
    '','实际主线连玩、浏览器实玩、原版一致性和全游戏完成均须独立验收。',''].join('\n');
}
export async function planSourceMigration(options){
  const sourceRoot=await realpath(resolve(options['--source-root'])),sourceCompiled=resolve(sourceRoot,options['--source-compiled']??'dist'),
    plannerCompiled=resolve(repository,options['--planner-compiled']??'dist'),candidateDir=resolve(sourceRoot,options['--candidate-dir']),
    registryPath=resolve(repository,options['--registry']??'content-batches/source-common-capabilities.json'),
    output=resolve(repository,options['--output']??'build/reports/source-migration');
  const outputRelative=relative(repository,output);assert(outputRelative.startsWith('build/reports/')&&!outputRelative.includes('..')&&!isAbsolute(outputRelative),'Planning output must be private build/reports');
  const plannerRuntime=await runtimeDigest(repository,plannerCompiled),sourceRuntime=await runtimeDigest(sourceRoot,sourceCompiled),
    registryBytes=await readFile(registryPath),selfBytes=await readFile(new URL(import.meta.url)),normalizerBytes=await readFile(new URL('./source-migration-input.mjs',import.meta.url));
  const [{openSourceCandidate},{loadBattleEventMessageSourceInputs},{readSourceBattleDirectoryPolicy},planner,owners]=await Promise.all([
    import(pathToFileURL(resolve(sourceRoot,'scripts/source-candidate.mjs')).href),
    import(pathToFileURL(resolve(sourceRoot,'scripts/battle-event-message-source-inputs.mjs')).href),
    import(pathToFileURL(resolve(sourceRoot,'scripts/source-battle-directory.mjs')).href),
    load(plannerCompiled,'compiler/source-migration-workset'),load(plannerCompiled,'compiler/content-batch-work-plan')]);
  const candidate=await openSourceCandidate({root:sourceRoot,runtimeRoot:sourceRoot,compiledDir:sourceCompiled,candidateDir});
  assert.equal(candidate.runtimeSha256,sourceRuntime);
  const policy=JSON.parse(await readFile(resolve(sourceRoot,'content-batches/source-battle-directory.policy.json'))),
    framework=(await readSourceBattleDirectoryPolicy({root:sourceRoot,compiledDir:sourceCompiled,policy})).framework;
  const sourceInputs=await loadBattleEventMessageSourceInputs(sourceRoot,sourceCompiled,{branchExecution:framework.branchExecution,sourceFormatImport:true,gauInstancePolicy:framework.gauInstances});
  const api=Object.assign({},sourceInputs.api,...await Promise.all(['compiler/field','compiler/field-empty-message','compiler/battle-ai','compiler/battle-ability-content','compiler/source-catalog-name','compiler/content-dependencies'].map(name=>load(sourceCompiled,name))),
    {contentBatchDiagnosticSystem:owners.contentBatchDiagnosticSystem});
  const catalog=await candidate.read('/framework/world/catalog.json');assert.equal(catalog.sourceSetHash,sourceInputs.snapshot.sourceSetHash);
  const mapIds=Object.keys(catalog.maps).map(Number).sort((a,b)=>a-b),maps=[];
  for(const id of mapIds){const ref=catalog.maps[String(id)];maps.push(await candidate.read(ref.url));}
  assert.equal(maps.length,sourceInputs.analysis.maps.length,'A source map disappeared from candidate planning');
  assert.deepEqual(maps.map(map=>map.mapId),mapIds);
  const roots=maps.flatMap(map=>[...Object.keys(map.scripts).sort().map(script=>({kind:'script',mapId:map.mapId,script})),
    ...(map.partyEntry?.pointIns??[]).map(entry=>({kind:'entry',mapId:map.mapId,entrance:entry.id,continuation:null}))]);
  const worldAnalysis=api.analyzeContentDependencies({catalog,maps,roots,mapIds});
  const names=api.createSourceCatalogNameResolver(sourceInputs.input),literal=key=>{try{return names.literalBody(key);}catch{return null;}},
    abilityContent=api.compileBattleAbilityContent(sourceInputs.snapshot.reader,sourceInputs.snapshot.tables,literal),
    battleDirectoryReport=await candidate.read('/framework/full-battle-directory-report.json');
  const auditPath=resolve(sourceRoot,options['--battle-audit']),auditBytes=await readFile(auditPath),auditReport=JSON.parse(auditBytes);
  assert.equal(auditReport.result,'passed');assert.equal(auditReport.runtimeSha256,sourceRuntime);assert.equal(auditReport.sourceDigest,sourceInputs.sourceDigest);
  const fullAuditPath=resolve(auditReport.artifact.file),auditRelative=relative(sourceRoot,fullAuditPath);
  assert(auditRelative.startsWith('build/reports/')&&!auditRelative.includes('..')&&!isAbsolute(auditRelative),'Battle audit must belong to the frozen source build');
  let fullAuditBytes=await readFile(fullAuditPath);assert.equal(fullAuditBytes.length,auditReport.artifact.bytes);assert.equal(sha(fullAuditBytes),auditReport.artifact.sha256);
  let fullAudit=JSON.parse(fullAuditBytes);fullAuditBytes=null;
  assert.equal(fullAudit.runtimeSha256,sourceRuntime);assert.equal(fullAudit.sourceDigest,sourceInputs.sourceDigest);
  const physical=new Map(sourceInputs.scripts.map(p=>[p.id,{rawHash:api.hash(p.data),source:p.source}]));
  assert.equal(fullAudit.allSourceInventory.length,physical.size);
  for(const row of fullAudit.allSourceInventory){const expected=physical.get(row.id);assert(expected);assert.equal(row.rawHash,expected.rawHash);assert.equal(api.canonical(row.source),api.canonical(expected.source));physical.delete(row.id);}
  assert.equal(physical.size,0);
  const battleAudit={runtimeSha256:sourceRuntime,sourceDigest:sourceInputs.sourceDigest,lanes:fullAudit.observations.map(row=>({label:row.label,
    requestedPartyIds:row.current.input.requestedPartyIds,definitionIds:Object.keys(row.current.result.encounters).map(Number),diagnostics:row.current.result.diagnostics}))};
  assert.deepEqual(battleAudit.lanes.map(lane=>lane.label).sort(),['original490','walkingUnion492']);fullAudit=null;
  const input=normalizeSourceMigrationInput({sourceInputs,api,registry:JSON.parse(registryBytes),runtimeSha256:sourceRuntime,worldAnalysis,abilityContent,battleDirectoryReport,battleAudit,parallelism:options.parallelism});
  assert.equal(input.programs.length,sourceInputs.scripts.length);assert.equal(input.programs.reduce((n,p)=>n+p.instructionCount,0),sourceInputs.inventory.counts.allInstructions);
  const workset=planner.compileSourceMigrationWorkSet(input);
  await candidate.validate();
  assert.equal(await runtimeDigest(sourceRoot,sourceCompiled),sourceRuntime);assert.equal(await runtimeDigest(repository,plannerCompiled),plannerRuntime);
  assert.equal(sha(await readFile(registryPath)),sha(registryBytes));assert.equal(sha(await readFile(auditPath)),sha(auditBytes));assert.equal(sha(await readFile(fullAuditPath)),auditReport.artifact.sha256);
  assert.equal(sha(await readFile(new URL(import.meta.url))),sha(selfBytes));assert.equal(sha(await readFile(new URL('./source-migration-input.mjs',import.meta.url))),sha(normalizerBytes));
  const report={kind:'all-source-common-migration-plan-v1',result:'planned-not-executed',sourceRuntimeSha256:sourceRuntime,plannerRuntimeSha256:plannerRuntime,
    sourceSetHash:input.sourceSetHash,sourceDigest:input.sourceDigest,candidateReportSha256:sha(candidate.reportBytes),inputLockSha256:sha(await readFile(resolve(candidateDir,'inputs.json'))),
    registrySha256:sha(registryBytes),plannerSha256:sha(selfBytes),normalizerSha256:sha(normalizerBytes),battleAuditReportSha256:sha(auditBytes),battleAuditFullSha256:auditReport.artifact.sha256,
    maps:maps.length,counts:workset.counts,planningMethod:workset.planningMethod,
    hypotheticalKnownMapPreparations:workset.batches.filter(b=>b.scope==='complete-map'&&b.plannedPreparationWave!==null).length,
    hypotheticalStrictMapClosures:workset.batches.filter(b=>b.scope==='complete-map'&&b.plannedClosureWave!==null).length,
    allProgramsRetained:true,allOriginalInstructionsRetained:true,allMapsRetained:true,
    missingStoryContracts:workset.batches.filter(b=>b.executionAcceptance==='missing-contract').length,readyForNomination:workset.readyForNominationGapIds.length,
    actualCompleteStoryBatches:0,openingFrontierUsedForScheduling:false,worldCompilations:0,publications:0,sourceCampaignComplete:false,browserVerified:false};
  const staging=output+'.preparing-'+randomUUID();await mkdir(staging,{recursive:true});
  for(const[name,value]of [['input.json',input],['workset.json',workset],['report.json',report]])await writeFile(resolve(staging,name),JSON.stringify(value)+'\n');
  await writeFile(resolve(staging,'queue.md'),markdown(workset,report));
  try{await rename(output,output+'.previous-'+randomUUID());}catch(error){if(error.code!=='ENOENT')throw error;}
  await rename(staging,output);return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  console.log(JSON.stringify(await planSourceMigration(parseSourceMigrationOptions(process.argv.slice(2)))));
