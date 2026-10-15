import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const moduleUrl=pathToFileURL(resolve(process.cwd(),'scripts/source-candidate.mjs')).href;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function fixture(){const inputBytes=Buffer.from('{"kind":"source-prerequisite-input-lock-v2"}\n');return{inputBytes,runtimeSha256:'a'.repeat(64),report:{kind:'shared-source-candidate-v1',status:'complete',published:false,runtimeSha256:'a'.repeat(64),producer:{strict:{}},link:{},inputLock:{file:'inputs.json',sha256:digest(inputBytes.toString()),bytes:inputBytes.length},objects:['/world/catalog.json','/framework/world/catalog.json','/game/source-new-game.json','/game/source-catalog.json'].map(url=>({url,sha256:'b'.repeat(64),bytes:1,contentHash:'c'.repeat(64)}))}};}
test('shared source candidate binds exact runtime, lock bytes and complete strict/framework dependency URLs',async()=>{
 const {validateSourceCandidateReport:validate}=await import(moduleUrl),f=fixture(),index=validate(f.report,f);
 assert.equal(index.size,4);index.get('/world/catalog.json').bytes=999;assert.equal(f.report.objects[0]!.bytes,1);
 for(const change of [(r:any)=>r.runtimeSha256='d'.repeat(64),(r:any)=>r.published=true,(r:any)=>r.status='partial',(r:any)=>r.inputLock.sha256='d'.repeat(64),(r:any)=>r.inputLock.bytes++,(r:any)=>r.objects.pop(),(r:any)=>r.objects.push(structuredClone(r.objects[0])),(r:any)=>r.objects[0].bytes=-1,(r:any)=>r.objects[0].url='/../world/catalog.json',(r:any)=>r.objects[0].url='/world\\catalog.json',(r:any)=>r.objects[0].url='/world/catalog.json?cache=old',(r:any)=>r.kind='published-cache-v1']){const bad=structuredClone(f.report);change(bad);assert.throws(()=>validate(bad,f));}
 assert.throws(()=>validate(f.report,{...f,inputBytes:Buffer.from('altered input lock')}));
});
test('legacy entry points remain explicitly scoped and use the same complete candidate reader contract',async()=>{
 const {validateSourceCandidateReport:validate,parseSourceCandidateOptions:parse}=await import(moduleUrl),f=fixture();
 const legacy=structuredClone(f.report);legacy.kind='source-flat-npc-candidate-v1';delete (legacy as any).inputLock;
 assert.equal(validate(legacy,{...f,legacyKind:legacy.kind}).size,4);assert.throws(()=>validate(legacy,{...f,legacyKind:'source-play-animation-candidate-v1'}));
 assert.deepEqual(parse(['--root','/private','--output','build/fresh']),{'--root':'/private','--output':'build/fresh'});
 for(const args of [['--root'],['--root','a','--root','b'],['--candidate-dir','old'],['--output','--root']])assert.throws(()=>parse(args));
});

test('complete candidate catalogs bind every original map even outside one consumer nomination',async()=>{
 const {validateSourceCandidateCatalogs:validate}=await import(moduleUrl),f=fixture(),s='1'.repeat(64),h='2'.repeat(64),base={kind:'world-development',formatVersion:1,sourceSetHash:'3'.repeat(64),parentSourceSetHash:'4'.repeat(64),mediaSourceSetHash:'5'.repeat(64)};
 const source={...base,contentHash:s,maps:{'1':{url:'/world/maps/1.json',contentHash:'6'.repeat(64)},'2':{url:'/world/maps/2.json',contentHash:'7'.repeat(64)}}},framework={...base,contentHash:h,developmentProfile:{kind:'framework-development-v1',sourceContentHash:s},maps:{'1':{url:'/framework/world/maps/1.json',contentHash:'8'.repeat(64)},'2':{url:'/framework/world/maps/2.json',contentHash:'9'.repeat(64)}}};
 const report:any={...f.report,producer:{strict:{maps:2}},link:{sourceMaps:2,frameworkMaps:2,linkedWorldHash:s,frameworkWorldHash:h}},index=new Map([...Object.values(source.maps),...Object.values(framework.maps)].map(ref=>[ref.url,{...ref,sha256:'a'.repeat(64),bytes:1}]));
 assert.equal(validate(report,index,source,framework).size,4);
 // Map 2 deliberately represents a map outside the observer's one-map scope.
 for(const change of [(v:any)=>v.index.delete('/world/maps/2.json'),(v:any)=>v.index.delete('/framework/world/maps/2.json'),(v:any)=>v.index.get('/world/maps/2.json').contentHash='0'.repeat(64),(v:any)=>v.report.producer.strict.maps=1,(v:any)=>v.report.link.sourceMaps=1,(v:any)=>v.report.link.frameworkMaps=1,(v:any)=>delete v.framework.maps['2'],(v:any)=>v.framework.sourceSetHash='0'.repeat(64),(v:any)=>v.framework.developmentProfile.sourceContentHash='0'.repeat(64),(v:any)=>v.report.link.linkedWorldHash='0'.repeat(64),(v:any)=>v.framework.maps['2']=structuredClone(v.framework.maps['1'])]){
  const v=structuredClone({report,index,source,framework});change(v);assert.throws(()=>validate(v.report,v.index,v.source,v.framework));
 }
});
