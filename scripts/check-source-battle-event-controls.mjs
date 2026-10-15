// Whole-source pure compilation and physical/dependency conservation. This
// tool never starts a source program, rebuilds 649 maps or publishes content.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { loadBattleEventMessageSourceInputs } from './battle-event-message-source-inputs.mjs';
import { runtimeDigest } from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),options={compiledDir:'dist',output:'build/reports/source-battle-event-controls'};
while(args.length){const flag=args.shift();assert.ok(['--compiled-dir','--output'].includes(flag)&&args[0]);options[flag==='--compiled-dir'?'compiledDir':'output']=args.shift();}
const compiled=resolve(root,options.compiledDir),out=resolve(root,options.output);assert.ok(out.startsWith(resolve(root,'build')+'/'));
const runtime=await runtimeDigest(root,compiled),source=await loadBattleEventMessageSourceInputs(root,compiled),{api}=source;
const target=new Set(['HideBattleUI','ShowBattleUI','StopAutoBattle','RemoveAllAct']),sites=[];
for(const p of source.programs)for(const[index,raw]of p.data.Mnemonics.entries())if(raw.mnemonic==='SysCall'&&target.has(raw.operands.sValues[0])){
 const selector=raw.operands.sValues[0],op=p.compiled.instructions[index].op;
 assert.equal(raw.operands.iValues.length,8);assert.equal(raw.operands.rValues.length,8);assert.equal(raw.operands.sValues.length,8);
 assert.ok(raw.operands.iValues.every(x=>x===0)&&raw.operands.rValues.every(x=>x===0)&&raw.operands.sValues.slice(1).every(x=>x===''));
 if(selector==='RemoveAllAct'){assert.equal(op.kind,'blocked');assert.match(op.reason,/staged-action cancellation.*executor state/);}
 else assert.deepEqual(op,selector==='StopAutoBattle'?{kind:'stop-auto'}:{kind:'ui-visibility',visible:selector==='ShowBattleUI'});
 sites.push({program:p.id,index,source:p.source,rawHash:p.rawHash,raw,typed:op,runtimeExecution:'not-attempted'});
}
const counts=Object.fromEntries([...target].map(name=>[name,sites.filter(row=>row.raw.operands.sValues[0]===name).length]));
assert.deepEqual(counts,{HideBattleUI:22,ShowBattleUI:14,StopAutoBattle:8,RemoveAllAct:6});
assert.equal(source.programs.length,53);assert.equal(source.programs.reduce((sum,p)=>sum+p.data.Mnemonics.length,0),2312);
assert.equal(source.dependencies.requestedPartyIds.length,490);assert.equal(source.dependencies.encounters.length,483);assert.equal(source.dependencies.diagnostics.length,7);
for(const p of source.programs){assert.equal(p.compiled.instructions.length,p.data.Mnemonics.length);assert.equal(p.rawHash,api.hash(p.data));api.parseBattleEventProgram(p.compiled);}
await mkdir(out,{recursive:true});
const payload={kind:'whole-source-battle-event-controls-programs-v1',sourceSetHash:source.snapshot.sourceSetHash,
 parentSourceSetHash:source.snapshot.manifest.parentSourceSetHash,sourceDigest:source.sourceDigest,
 programs:source.programs,dependencies:source.dependencies,sites,rawPreserved:true,sourceExecutions:0,sourceStoryReachability:false};
const file=resolve(out,'full-source-programs.json'),bytes=Buffer.from(JSON.stringify(payload)+'\n');await writeFile(file,bytes);
assert.equal(await runtimeDigest(root,compiled),runtime,'Runtime changed during source observation');
const report={kind:'source-battle-event-controls-whole-family-v1',result:'passed-pure-compilation-not-source-execution',runtimeSha256:runtime,
 sourceSetHash:payload.sourceSetHash,parentSourceSetHash:payload.parentSourceSetHash,sourceDigest:source.sourceDigest,
 counts:{allSourcePrograms:source.scripts.length,allSourceInstructions:source.scripts.reduce((sum,p)=>sum+p.data.Mnemonics.length,0),
  battlePrograms:53,battleInstructions:2312,exportBoundPrograms:source.programs.filter(p=>p.battleExportBinding.kind==='exact-battle-export-source-binding-v1').length,
  exportUnboundPrograms:source.programs.filter(p=>p.battleExportBinding.kind==='unbound-battle-export-source-v1').length,
  nominatedSites:sites.length,typedSites:sites.filter(row=>row.typed.kind!=='blocked').length,
  unresolvedCancellationSites:6,selectorSites:counts,requestedParties:490,sourceDescriptors:483,sourceDiagnostics:7,
  remainingBlockedSites:source.programs.reduce((n,p)=>n+p.compiled.instructions.filter(row=>row.op.kind==='blocked').length,0)},
 artifacts:[{path:file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}],
 sourceExecutions:0,worldCompilations:0,publications:0,sourceStoryReachability:false,nativeDynamicParity:false,browserVerified:false,
 limitations:['44 typed UI/manual-control requests are not completed source programs or playable encounters.',
  'All 53 complete original bodies, 490 requested parties, 483 descriptors and 7 diagnostics remain retained.',
  'RemoveAllAct retains all 6 source sites blocked until staged cancellation/state-machine callbacks and resources have a proven lifecycle.']};
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,report:resolve(out,'report.json')}));
