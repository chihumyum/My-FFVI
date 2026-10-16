// Full source conservation and absolute-coordinate parameter evidence only.
// Never reopens an old candidate as gameplay content or invents an actor/media.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runtimeDigest} from './runtime-digest.mjs';
const args=process.argv.slice(2),options={root:resolve(import.meta.dirname,'..'),compiled:'dist',before:null,
 nomination:null,output:'build/reports/source-loop-map-lerp'};
while(args.length){const flag=args.shift();assert(['--root','--compiled','--before','--nomination','--output'].includes(flag)&&args[0],
 'Use --before <independently compiled baseline> --nomination <frozen discovery JSON> [--compiled dir] [--output ignored-dir]');options[flag.slice(2)]=args.shift();}
assert(options.before&&options.nomination,'Both an independent before runtime and frozen discovery nomination are required');
const root=resolve(options.root),compiled=resolve(root,options.compiled),before=resolve(root,options.before),out=resolve(root,options.output),
 sha=bytes=>createHash('sha256').update(bytes).digest('hex'),load=(directory,name)=>import(pathToFileURL(resolve(directory,'src',name+'.js')).href);
assert(out.startsWith(resolve(root,'build')+'/'),'Only ignored build outputs may be written');
const api=Object.assign({},...await Promise.all(['compiler/corpus','compiler/content','compiler/map-package','compiler/field-camera',
 'compiler/field-script-motion','core/field-camera'].map(name=>load(compiled,name)))),
 old=Object.assign({},...await Promise.all(['compiler/field-script-motion','core/field-camera'].map(name=>load(before,name)))),
 runtime=await runtimeDigest(root,compiled),beforeCompiledRuntime=await runtimeDigest(root,before),
 nominationPath=resolve(root,options.nomination),nominationBytes=await readFile(nominationPath),nomination=JSON.parse(nominationBytes);
assert.equal(sha(nominationBytes),'499c57f138edbb24dfb2ebe47eaa0e9d7e98a41c1a08944276d93702b861c92d','Changed complete frozen nomination');
assert.equal(nomination.kind,'whole-source-loop-map-script-motion-nomination-v1');
assert.equal(nomination.runtimePermissionChanged,false);assert.equal(nomination.sourceCampaignComplete,false);
const corpus=await api.loadCorpus(root),sourceDigest=api.hash(corpus),programs=corpus.assets.filter(a=>a.kind==='script'),byId=new Map(corpus.assets.map(a=>[a.id,a])),
 sourceKey=source=>api.canonical(Object.fromEntries(['file','assetPath','objectId','serializedFile','sha256'].map(key=>[key,source[key]]))),
 byPhysical=new Map();
for(const asset of corpus.assets){const key=sourceKey(asset.source);assert(!byPhysical.has(key),'Duplicate physical source identity');byPhysical.set(key,asset);}
assert.equal(sourceDigest,nomination.sourceDigest);assert.equal(corpus.sourceSetHash,nomination.sourceSetHash);
assert.equal(corpus.manifest.parentSourceSetHash,nomination.parentSourceSetHash);
assert.equal(programs.length,3304);assert.equal(programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),186003);
const decode=(fn,raw)=>{try{return {decoded:fn(raw),error:null};}catch(error){return {decoded:null,error:error.message};}},rawSites=[],nomBySite=new Map();
for(const site of nomination.rawSites){const key=site.program+'/'+site.index;assert(!nomBySite.has(key));nomBySite.set(key,site);}
for(const asset of programs)for(const[index,raw]of asset.data.Mnemonics.entries())if(['Move','Lerp','MoveTo'].includes(raw.mnemonic)){
 const now=decode(api.compileFieldScriptMotionInstruction,raw),was=decode(old.compileFieldScriptMotionInstruction,raw),prior=nomBySite.get(asset.id+'/'+index);
 assert(prior,'Missing full-source nomination site');assert.deepEqual(now,was,'Decoder changed source shape');
 assert.deepEqual(now,{decoded:prior.decoded,error:prior.error});assert.deepEqual(raw,prior.raw);
 assert.equal(sourceKey(asset.source),sourceKey(prior.source));assert.equal(api.hash(asset.data),prior.rawScriptHash);
 rawSites.push({program:asset.id,index,source:asset.source,rawScriptHash:api.hash(asset.data),raw,before:was,current:now});
}
assert.equal(rawSites.length,12269);assert.equal(rawSites.length,nomBySite.size);
assert.equal(rawSites.filter(s=>s.current.decoded).length,12258);assert.equal(rawSites.filter(s=>s.current.error).length,11);
for(const[mnemonic,count]of Object.entries({Move:6346,Lerp:4897,MoveTo:1026}))assert.equal(rawSites.filter(s=>s.raw.mnemonic===mnemonic).length,count);
const selectedPrograms=nomination.completeSelectedPrograms.map(prior=>{const current=byId.get(prior.id);
 assert(current&&current.kind==='script');assert.equal(sourceKey(current.source),sourceKey(prior.source));assert.deepEqual(current.data,prior.data);
 return {...current,rawHash:api.hash(current.data),completeBodyExecuted:false};});
assert.equal(selectedPrograms.length,41);assert.equal(selectedPrograms.reduce((n,p)=>n+p.data.Mnemonics.length,0),2581);
const bindings=api.bindMapPackages(corpus.assets,corpus.tables),byMap=new Map(bindings.map(binding=>[Number(binding.id),binding])),
 mapRows=new Map(corpus.tables['map.csv'].map(row=>[Number(row.id),row])),mapCoordinates=[];
assert.equal(bindings.length,649);assert.equal(nomination.loopMaps.length,11);assert.equal(nomination.unknownLoopMaps.length,11);
for(const map of nomination.loopMaps){
 const binding=byMap.get(map.mapId),row=mapRows.get(map.mapId);assert(binding&&row);
 const tile=byId.get(binding.tilemap),defaults=byId.get(binding.groups.entity_default);assert(tile&&defaults,'Missing exact range input');
 assert.equal(sourceKey(tile.source),sourceKey(map.source));
 const range=api.compileFieldCameraMapRange(tile.data,defaults.data),loopType=Number(row.loop_type),
 loop={horizontal:(loopType&1)!==0,vertical:(loopType&2)!==0};
 assert(Number.isInteger(loopType)&&loopType>=0&&loopType<=3);assert.deepEqual(loop,map.loop);assert.deepEqual(range,map.mapRange);
 mapCoordinates.push({mapId:map.mapId,binding,sourceMapRow:row,tile:{source:tile.source,rawHash:api.hash(tile.data)},
  defaultEntities:{source:defaults.source,rawHash:api.hash(defaults.data)},range,loop,
  status:'fresh-source-coordinate-input-only',actualActorProvider:'unassessed'});
}
const mapCoords=new Map(mapCoordinates.map(row=>[row.mapId,row])),loopSites=[];
for(const site of nomination.loopMapSites){
 const asset=byPhysical.get(sourceKey(site.op.source)),map=mapCoords.get(site.mapId);assert(asset&&asset.kind==='script'&&map);
 assert.equal(site.rawSource.pointer,'/Mnemonics/'+site.op.index);assert.equal(sourceKey(site.rawSource),sourceKey(asset.source));
 assert(selectedPrograms.some(p=>p.id===asset.id),'Loop site outside complete original body inventory');
 const raw=asset.data.Mnemonics[site.op.index],decoded=api.compileFieldScriptMotionInstruction(raw);assert.equal(decoded.kind,site.op.kind);assert.deepEqual(decoded.command,site.op.command);
 const alias=api.resolveMapScript(map.binding,site.name),record={...site,program:asset.id,raw,rawHash:api.hash(asset.data),
  aliasBinding:alias===asset.id?'exact-current-package-or-Resident':'unresolved-specific-alias',
  actualActorQualification:'unassessed-current-puppet-may-be-camera-or-actor',originalInstructionExecuted:false};
 if(decoded.command.kind==='lerp'){
  const c=decoded.command,localCell={x:(c.x-map.range.x)|0,y:(c.y-map.range.y)|0},
   destination=api.fieldCameraCellToWorld(map.range,localCell,0),prior=old.fieldCameraCellToWorld(map.range,localCell,0);
  assert.deepEqual(destination,prior,'Coordinate provider changed outside loop admission');
  // Only exact parameter projection. No actor, animation, layer callback,
  // clock, interpolation or original complete body is manufactured here.
  record.coordinateParameterProbe={localCell,destination,before:prior,sourceRange:map.range,loop:map.loop,
   normalization:'none',outsideSourceCrop:localCell.x<0||localCell.y<0||localCell.x>=map.range.width||localCell.y>=map.range.height};
  record.remainingActorGates=[...(c.arcHeight!==0?['sprite-animation-intermediate-offset-owner']:[]),
   ...(c.animation!==''?['actual-ActorAnimation-base-cache-current-media-and-completion']:[]),
   'actual-current-puppet-identity-and-map-provider','transport-pose-and-layer-material','motion-exclusivity-and-stale-owner'];
 }else record.remainingActorGates=['Move/MoveTo-routing-collision-loop-and-target-owner-not-granted'];
 loopSites.push(record);
}
assert.equal(loopSites.length,289);assert.equal(loopSites.filter(s=>s.op.command.kind==='lerp').length,254);
assert.equal(loopSites.filter(s=>s.op.command.kind==='move').length,30);assert.equal(loopSites.filter(s=>s.op.command.kind==='move-to').length,5);

// Rebind the already reviewed common coordinate methods to original PE bytes.
// Existing complete motion/camera receipts retain their wider independent scope.
const receiptFiles=['build/reports/field-script-motion-native-check.json','build/reports/field-camera-native-check.json'],nativeReports=[];
for(const file of receiptFiles){const bytes=await readFile(resolve(root,file)),report=JSON.parse(bytes);
 assert.equal(report.semanticsVerified,false);assert.equal(report.originalGameExecuted,false);nativeReports.push({file,sha256:sha(bytes),report});}
const identity={nativeSha256:'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',
 symbolsSha256:'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3',
 headerSha256:'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'};
for(const report of nativeReports)for(const[key,value]of Object.entries(identity))assert.equal(report.report[key],value);
for(const[key,file]of Object.entries({nativeSha256:'build/runtime/game/GameAssembly.dll',symbolsSha256:'build/native/il2cpp/script.json',headerSha256:'build/native/il2cpp/il2cpp_ghidra.h'}))
 assert.equal(sha(await readFile(resolve(root,file))),identity[key]);
const header=(await readFile(resolve(root,'build/native/il2cpp/il2cpp_ghidra.h'))).toString(),nativeMethods=[];
assert.match(header,/struct Last_Map_FieldController_VTable[\s\S]*?_7_ConvertCellPositionToWorldPosition;/);
assert.match(header,/struct Last_Map_FieldController_VTable[\s\S]*?_125_Last_Map_IMapAccessor_ConversionMapRangeCell;/);
for(const rva of ['0x2c10c0','0x2dfe30','0x2d6690','0xe10020']){
 const matches=nativeReports.flatMap(r=>r.report.methods.filter(m=>m.rva===rva));assert(matches.length);
 for(const row of matches)assert.equal(row.nativeRangeSha256,matches[0].nativeRangeSha256);
 const row=matches[0],receiptPath=resolve(root,'build/native',row.batch,'complete.json'),bytes=await readFile(receiptPath),complete=JSON.parse(bytes),
  body=await readFile(resolve(root,'build/native',row.batch,rva.slice(2)+'.c'));
 assert.equal(complete.status,'complete');assert.equal(complete.semanticsVerified,false);
 for(const[key,value]of Object.entries(identity))assert.equal(complete[key],value);
 const actual=complete.methods.filter(m=>m.rva===rva);assert.equal(actual.length,1);assert.equal(actual[0].decompiledSha256,sha(body));
 assert.equal(row.decompiledSha256,sha(body));assert.equal(actual[0].nativeRangeSha256,row.nativeRangeSha256);
 nativeMethods.push({batch:row.batch,rva,name:row.name,size:Number(row.nextSymbolRva)-Number(rva),
  nativeRangeSha256:row.nativeRangeSha256,decompiledSha256:sha(body),completeReceipt:{path:receiptPath,sha256:sha(bytes)}});
}
const python=String.raw`import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
print(json.dumps([dict(rva=r['rva'],size=r['size'],sha256=hashlib.sha256(p.read(int(r['rva'],0),r['size'])[2]).hexdigest()) for r in json.load(sys.stdin)]))`,
 pe=JSON.parse(execFileSync(resolve(root,'.venv/bin/python'),['-c',python,root],{input:JSON.stringify(nativeMethods),maxBuffer:1024*1024}));
for(const[index,row]of pe.entries())assert.equal(row.sha256,nativeMethods[index].nativeRangeSha256);
assert.equal(api.hash(corpus),sourceDigest,'Compiler mutated original corpus');
assert.equal(await runtimeDigest(root,compiled),runtime,'Current runtime changed during source audit');assert.equal(await runtimeDigest(root,before),beforeCompiledRuntime);
const lerps=loopSites.filter(s=>s.op.command.kind==='lerp'),counts={allPrograms:3304,allInstructions:186003,maps:649,
 rawMotionSites:12269,rawDecoded:12258,rawRejected:11,decoderChanges:0,loopMaps:11,unknownLoopMaps:11,
 loopMapMotionSites:289,loopMapBodies:41,loopMapBodyInstructions:2581,loopLerpAliases:254,loopMoveAliases:30,loopMoveToAliases:5,
 coordinateParameterProbes:lerps.length,nonemptyAnimationAliases:lerps.filter(s=>s.op.command.animation!=='').length,
 nonzeroArcAliases:lerps.filter(s=>s.op.command.arcHeight!==0).length,zeroDurationAliases:lerps.filter(s=>s.op.command.duration===0).length,
 outsideCropAliases:lerps.filter(s=>s.coordinateParameterProbe.outsideSourceCrop).length,
 unresolvedAliasBindings:loopSites.filter(s=>s.aliasBinding!=='exact-current-package-or-Resident').length,
 actualActorExecutions:0,originalInstructionExecutions:0,originalCompleteBodyExecutions:0,worldCompilations:0,publications:0};
const payload={kind:'whole-source-loop-map-lerp-conservation-v1',result:'passed',runtimeSha256:runtime,beforeCompiledRuntimeSha256:beforeCompiledRuntime,
 sourceDigest,sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash,
 discovery:{path:nominationPath,sha256:sha(nominationBytes),runtimeSha256:nomination.runtimeSha256,candidateReportSha256:nomination.candidateReportSha256,
  use:'frozen-static-source-discovery-only',isCurrentGameplayCandidate:false},counts,rawSites,completeSelectedPrograms:selectedPrograms,
 mapCoordinates,unknownLoopMaps:nomination.unknownLoopMaps,loopSites,
 native:{identity,existingReports:nativeReports.map(({file,sha256})=>({file,sha256})),methods:nativeMethods,peRanges:pe,
  semanticsVerified:false,dynamicNativeParity:false},
 sourceCampaignComplete:false,sourceRuntimePermissionGranted:false,browserVerified:false,
 limitations:['All254 Lerp aliases include camera/current-puppet and repeated bindings; none is counted as an admitted actor or executed original instruction.',
  'Coordinates are projected from fresh raw tile/default-entity map range only. Actual actor identity/factory, pose, animation media, layer callbacks and clocks remain independently qualified.',
  'No modulo/nearest image/shortest route/clamping/Move or MoveTo authorization is introduced.',
  'Frozen v113 content was not reopened, modified or relabelled as gameplay content for the current runtime.']};
await mkdir(out,{recursive:true});const bytes=JSON.stringify(payload)+'\n',file=resolve(out,'full-source.json');await writeFile(file,bytes);
const report={kind:payload.kind,result:payload.result,runtimeSha256:runtime,beforeCompiledRuntimeSha256:beforeCompiledRuntime,sourceDigest,counts,
 discovery:payload.discovery,nativeMethods:nativeMethods.length,nativeBytes:nativeMethods.reduce((n,m)=>n+m.size,0),
 artifact:{path:file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)},sourceCampaignComplete:false,sourceRuntimePermissionGranted:false,browserVerified:false};
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
