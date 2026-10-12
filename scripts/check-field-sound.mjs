// All source sites are counted; decoder coverage is not media/runtime coverage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2);
assert.ok(args.length===0||args.length===2&&args[0]==='--compiled-dir','Use --compiled-dir <directory>');
const compiled=resolve(root,args[1]??'dist'), mod=name=>import(pathToFileURL(resolve(compiled,'src',name+'.js')).href);
const{loadCorpus}=await mod('compiler/corpus'),{bindMapPackages,resolveMapScript}=await mod('compiler/map-package'),{hash}=await mod('compiler/content'),{decodeFieldOp}=await mod('compiler/field'),{compileFieldSoundInstruction:compile}=await mod('compiler/field-sound');
const output=root+'build/reports/field-sound-check.json';await mkdir(root+'build/reports',{recursive:true});await rm(output,{force:true});
execFileSync(process.execPath,[root+'scripts/check-field-sound-native.mjs'],{cwd:root,stdio:'pipe'});
const nativeBytes=await readFile(root+'build/reports/field-sound-native-check.json'),native=JSON.parse(nativeBytes), corpus=await loadCorpus(root),byId=new Map(corpus.assets.map(a=>[a.id,a]));
assert.equal(corpus.manifest.sources.find(s=>s.file==='GameAssembly.dll')?.sha256,native.nativeSha256);
const users=new Map();
for(const map of bindMapPackages(corpus.assets,corpus.tables)){
 const seen=new Set(),queue=[...map.scripts];while(queue.length){const id=queue.pop();if(seen.has(id))continue;seen.add(id);if(!users.has(id))users.set(id,new Set());users.get(id).add(map.id);
 for(const raw of byId.get(id).data.Mnemonics){if(!['Encount','ChangeScript'].includes(raw.mnemonic))continue;const next=resolveMapScript(map,raw.operands.sValues[0]);if(next)queue.push(next);}}
}
const counts={PlaySE:0,StopSE:0,SyncSE:0,ReadySE:0},fieldCounts={...counts},decoded={...counts},blocked=[],sites=[];let shared=0,negative=0;
for(const a of corpus.assets){if(a.kind!=='script')continue;for(const[index,raw]of(a.data.Mnemonics??[]).entries()){
 if(!Object.hasOwn(counts,raw.mnemonic))continue;counts[raw.mnemonic]++;const field=users.has(a.id);if(field)fieldCounts[raw.mnemonic]++;
 const provenance={script:a.data.Name??a.id,index,source:{...a.source,pointer:`/Mnemonics/${index}`}};
 // Two legacy cut scripts have short optional arrays. They remain diagnosed;
 // normalizing them is a separate format capability, not an implicit default.
 const arrays=[raw.operands.iValues,raw.operands.rValues,raw.operands.sValues];
 if(arrays.some(v=>!Array.isArray(v)||v.length!==8)){
  assert.throws(()=>compile(raw));blocked.push({...provenance,reason:'source operand arrays are not exactly 8i/8r/8s',field});continue;
 }
 const i=raw.operands.iValues,r=raw.operands.rValues;
 const command=raw.mnemonic==='PlaySE'?{kind:'play',soundId:i[0],asynchronous:i[1]!==0,handleSlot:i[2]<0?null:i[2],fadeSeconds:Math.fround(r[0]),seekSeconds:Math.fround(r[1]),pan:Math.fround(r[2])}
 :raw.mnemonic==='StopSE'?{kind:'stop',handleSlot:i[0],fadeSeconds:Math.fround(r[0])}
 :raw.mnemonic==='SyncSE'?{kind:'sync',handleSlot:i[0]}:{kind:'ready',soundId:i[0]};
 const before=structuredClone(raw),op=compile(raw);assert.deepEqual(op,{kind:'field-sound',command});assert.deepEqual(raw,before);
 if(field){assert.deepEqual(decodeFieldOp(raw,provenance,{},corpus.tables),{...provenance,...op});shared++;}
 const altered=structuredClone(raw);altered.operands.iValues[7]=1;assert.throws(()=>compile(altered),/reserved/);if(field)assert.equal(decodeFieldOp(altered,provenance,{},corpus.tables).kind,'blocked');negative++;
 decoded[raw.mnemonic]++;sites.push({...provenance,type:raw.type,maps:[...(users.get(a.id)??[])].sort(),rawHash:hash(raw),command});
}}
assert.deepEqual(counts,{PlaySE:1974,StopSE:80,SyncSE:72,ReadySE:0});assert.deepEqual(decoded,{PlaySE:1972,StopSE:80,SyncSE:72,ReadySE:0});assert.equal(blocked.length,2);
const opening=sites.find(s=>s.script==='sc_e_0001_3'&&s.index===75);assert.deepEqual(opening.command,{kind:'play',soundId:101,asynchronous:true,handleSlot:0,fadeSeconds:0,seekSeconds:0,pan:0});
const report={kind:'field-sound-source',sourceSetHash:corpus.sourceSetHash,nativeReceiptSha256:createHash('sha256').update(nativeBytes).digest('hex'),counts,fieldCounts,decoded,blocked,sharedDispatcherSites:shared,reservedOperandRejections:negative,opening,sourceInstructions:sites,semanticsVerified:false,originalGameExecuted:false,mediaAdmissionVerified:false,runtimeAdmissionVerified:false,limits:['All corpus and package-bound sites are reported separately; counts are not playable content','ReadySE has native evidence but no source corpus call site','Two short legacy PlaySE formats remain blocked; reserved operands never silently discarded','Compiled sound IDs do not provide media or initialize script-local handle slots','SE looping is an asset property, not operand i2','Precise native fade/callback/mixing is not claimed']};
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:'pass',counts,decoded,fieldCounts,blocked:blocked.length,sharedDispatcherSites:shared,reservedOperandRejections:negative}));
