// Whole-source pure compilation and physical/dependency conservation. This
// tool never starts a source program, rebuilds 649 maps or publishes content.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { loadBattleEventMessageSourceInputs } from './battle-event-message-source-inputs.mjs';
import { runtimeDigest } from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),options={compiledDir:'dist',output:'build/reports/source-battle-forced-return'};
while(args.length){const flag=args.shift();assert.ok(['--compiled-dir','--output'].includes(flag)&&args[0]);options[flag==='--compiled-dir'?'compiledDir':'output']=args.shift();}
const compiled=resolve(root,options.compiledDir),out=resolve(root,options.output);assert.ok(out.startsWith(resolve(root,'build')+'/'));
const runtime=await runtimeDigest(root,compiled),source=await loadBattleEventMessageSourceInputs(root,compiled),{api}=source;
const target=new Set(['BattleForceExit','BattleForceExitOnSave']),sites=[];
for(const p of source.programs)for(const[index,raw]of p.data.Mnemonics.entries())if(target.has(raw.mnemonic)){
 const mnemonic=raw.mnemonic,op=p.compiled.instructions[index].op;
 assert.equal(raw.type,1);assert.equal(raw.operands.iValues.length,8);assert.equal(raw.operands.rValues.length,8);assert.equal(raw.operands.sValues.length,8);
 assert.ok(raw.operands.iValues.every(x=>x===0)&&raw.operands.rValues.every(x=>x===0)&&raw.operands.sValues.every(x=>x===''));
 if(mnemonic==='BattleForceExitOnSave'){assert.equal(op.kind,'blocked');assert.match(op.reason,/owned Corps layout.*nonparticipant recovery.*retained steal\/drop/);}
 else assert.deepEqual(op,{kind:'force-return'});
 sites.push({program:p.id,index,source:p.source,rawHash:p.rawHash,raw,typed:op,runtimeExecution:'not-attempted'});
}
const counts=Object.fromEntries([...target].map(name=>[name,sites.filter(row=>row.raw.mnemonic===name).length]));
assert.deepEqual(counts,{BattleForceExit:10,BattleForceExitOnSave:22});
assert.equal(source.programs.length,53);assert.equal(source.programs.reduce((sum,p)=>sum+p.data.Mnemonics.length,0),2312);
assert.equal(source.dependencies.requestedPartyIds.length,490);assert.equal(source.dependencies.encounters.length,483);assert.equal(source.dependencies.diagnostics.length,7);
for(const p of source.programs){assert.equal(p.compiled.instructions.length,p.data.Mnemonics.length);assert.equal(p.rawHash,api.hash(p.data));api.parseBattleEventProgram(p.compiled);}
await mkdir(out,{recursive:true});
const payload={kind:'whole-source-battle-forced-return-programs-v1',sourceSetHash:source.snapshot.sourceSetHash,
 parentSourceSetHash:source.snapshot.manifest.parentSourceSetHash,sourceDigest:source.sourceDigest,
 programs:source.programs,dependencies:source.dependencies,sites,rawPreserved:true,sourceExecutions:0,sourceStoryReachability:false};
const file=resolve(out,'full-source-programs.json'),bytes=Buffer.from(JSON.stringify(payload)+'\n');await writeFile(file,bytes);
assert.equal(await runtimeDigest(root,compiled),runtime,'Runtime changed during source observation');
const report={kind:'source-battle-forced-return-whole-family-v1',result:'passed-pure-compilation-not-source-execution',runtimeSha256:runtime,
 sourceSetHash:payload.sourceSetHash,parentSourceSetHash:payload.parentSourceSetHash,sourceDigest:source.sourceDigest,
 counts:{allSourcePrograms:source.scripts.length,allSourceInstructions:source.scripts.reduce((sum,p)=>sum+p.data.Mnemonics.length,0),
  battlePrograms:53,battleInstructions:2312,exportBoundPrograms:source.programs.filter(p=>p.battleExportBinding.kind==='exact-battle-export-source-binding-v1').length,
  exportUnboundPrograms:source.programs.filter(p=>p.battleExportBinding.kind==='unbound-battle-export-source-v1').length,
  nominatedSites:sites.length,typedSites:sites.filter(row=>row.typed.kind!=='blocked').length,
  unresolvedSaveSites:22,mnemonicSites:counts,requestedParties:490,sourceDescriptors:483,sourceDiagnostics:7,
  remainingBlockedSites:source.programs.reduce((n,p)=>n+p.compiled.instructions.filter(row=>row.op.kind==='blocked').length,0)},
 artifacts:[{path:file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}],
 sourceExecutions:0,worldCompilations:0,publications:0,sourceStoryReachability:false,nativeDynamicParity:false,browserVerified:false,
 limitations:['10 typed no-save forced-return requests are not completed source programs or playable encounters.',
  'All 53 complete original bodies, 490 requested parties, 483 descriptors and 7 diagnostics remain retained.',
  'All 22 OnSave sites retain specific owned save projection gates; all 6 RemoveAllAct sites remain explicitly blocked.',
  'Forced previous-result queries require exact current Corps eligibility and previous-result publication; no fixed 4/6, Escape or Win is fabricated.']};
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,report:resolve(out,'report.json')}));
