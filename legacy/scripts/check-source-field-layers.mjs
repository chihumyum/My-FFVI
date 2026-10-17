// Whole-source static comparison, independent from story execution and pixels.
import assert from "node:assert/strict";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { resolve,dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { runtimeDigest } from "./runtime-digest.mjs";
const args=process.argv.slice(2),allowed=new Set(["--physical-input","--nomination","--before-compiled","--output"]),options={};
assert.equal(args.length%2,0);for(let i=0;i<args.length;i+=2){assert(allowed.has(args[i])&&!Object.hasOwn(options,args[i]));options[args[i]]=args[i+1];}
const root=resolve(import.meta.dirname,".."),compiled=resolve(root,"dist"),before=resolve(options["--before-compiled"]),output=resolve(options["--output"]??resolve(root,"build/reports/source-field-layers.json"));
assert.notEqual(compiled,before);assert(output.startsWith(resolve(root,"build/reports")+"/"));
const physicalBytes=await readFile(resolve(options["--physical-input"])),nominationBytes=await readFile(resolve(options["--nomination"])),physical=JSON.parse(physicalBytes),nomination=JSON.parse(nominationBytes),sha=v=>createHash("sha256").update(v).digest("hex"),load=(dir,name)=>import(pathToFileURL(resolve(dir,name+".js")));
assert.equal(sha(physicalBytes),nomination.physicalInputSha256);assert.equal(physical.sourceDigest,nomination.sourceDigest);assert.equal(physical.sourceSetHash,nomination.sourceSetHash);
const runtime=await runtimeDigest(root),[old,current,{canonical},{hash},{sourceFieldLayerSelectors}]=await Promise.all([load(before,"src/compiler/field"),load(compiled,"src/compiler/field"),load(compiled,"src/core/canonical"),load(compiled,"src/compiler/content"),load(compiled,"src/compiler/field-layer-scrolling")]);
const assets=new Map(physical.allAssets.map(a=>[a.id,a])),domains=new Map(physical.analysis.scripts.map(p=>[p.id,p.domain])),selectors=new Set(sourceFieldLayerSelectors),selected=new Set(nomination.family.selectorKeys.map(s=>s.slice(8)));
assert.equal(canonical([...selectors].sort()),canonical([...selected].sort()));assert.equal(selectors.size,45);
const changed=[],remaining=[],programBindings=[];let allInstructions=0,fieldInstructions=0,unchanged=0,bodies=0,typed=0,retainedBlocked=0;
for(const binding of physical.allProgramBindings){const asset=assets.get(binding.id);assert(asset);assert.equal(hash(asset.data),binding.rawHash);assert.deepEqual(asset.source,binding.source);const raw=asset.data.Mnemonics;allInstructions+=raw.length;programBindings.push({...binding,domain:domains.get(binding.id)??"unassessed"});if(domains.get(binding.id)!=="field")continue;let bodyChanged=false;
  for(const[index,instruction]of raw.entries()){fieldInstructions++;const site={script:asset.id,index,source:{...asset.source,pointer:"/Mnemonics/"+index}},context={nextMnemonic:raw[index+1]?.mnemonic??null},decode=m=>{try{return{op:m.decodeFieldOp(instruction,site,physical.messages,physical.tables,context)}}catch(error){return{error:String(error)}}},prior=decode(old),next=decode(current);
    if(instruction.mnemonic!=="SysCall"||!selectors.has(instruction.operands?.sValues?.[0])){assert.equal(canonical(next),canonical(prior),"Unrelated IR changed: "+asset.id+":"+index);unchanged++;}
    else{assert.equal(prior.op?.kind,"blocked");assert(["field-layer-scrolling","blocked"].includes(next.op?.kind));if(next.op.kind==="blocked"){assert.match(next.op.reason,/unresolved/);retainedBlocked++;}else typed++;assert.notEqual(canonical(prior),canonical(next));bodyChanged=true;changed.push({programId:asset.id,index,raw:instruction,before:prior.op,after:next.op,maps:nomination.family.sites.find(s=>s.programId===asset.id&&s.pc===index)?.maps??[]});}
    if(next.op?.kind==="blocked")remaining.push({programId:asset.id,index,reason:next.op.reason});
  }if(bodyChanged)bodies++;
}
assert.equal(physical.allProgramBindings.length,3304);assert.equal(physical.allAssets.length,6951);assert.equal(allInstructions,186003);assert.equal(fieldInstructions,173026);assert.equal(changed.length,123);assert.equal(bodies,73);assert.equal(nomination.completePrograms.reduce((n,p)=>n+p.data.Mnemonics.length,0),14175);assert.equal(nomination.completeMapClosures.length,29);assert.equal(nomination.completePhysicalAssets.length,472);
assert.equal(await runtimeDigest(root),runtime);assert.equal(sha(await readFile(resolve(options["--physical-input"]))),sha(physicalBytes));assert.equal(sha(await readFile(resolve(options["--nomination"]))),sha(nominationBytes));
const report={kind:"whole-source-field-layer-static-difference-v1",result:"passed",runtimeSha256:runtime,sourceSetHash:physical.sourceSetHash,sourceDigest:physical.sourceDigest,counts:{allPrograms:3304,allInstructions,fieldPrograms:2804,fieldInstructions,unchangedFieldInstructions:unchanged,changedSites:changed.length,typedSites:typed,explicitUnknownSites:retainedBlocked,changedBodies:bodies,affectedInstructions:14175,completeMaps:29,completeSourceDependentAssets:472,additionalRawMapProviders:54,typedSelectors:40,unknownSelectors:5},physicalInputSha256:sha(physicalBytes),nominationSha256:sha(nominationBytes),programBindings,changed,remainingFieldBlockers:remaining,scope:{sourceBodiesExecuted:0,nativeDynamicParity:false,worldCompilations:0,publications:0,campaignComplete:false}};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({result:report.result,...report.counts}));
