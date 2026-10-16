import test from "node:test";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {canonical} from "../src/core/canonical.js";
import {hash} from "../src/compiler/content.js";
const script=pathToFileURL(resolve(process.cwd(),"scripts/source-sprite-media-evidence.mjs")).href;
const seal=(value:any)=>{const{contentHash:_,...body}=value;return{...body,contentHash:hash(body)};};
async function fixture(){
 const api=await import(script),source={file:"synthetic.bundle",assetPath:"controlled/source",objectId:"9007199254740999"},
  miss={reason:"Missing character pose asset/Default",source},unknown={reason:"Unresolved independent source provider",source},
  additions=Array.from({length:179},(_,i)=>({asset:"asset",sprite:"sprite"+i,source,sha256:"a".repeat(64)})),
  character={source,sprites:{},animations:{}},nextCharacter={source,sprites:Object.fromEntries(additions.map(a=>[a.sprite,{source,file:"/world-media/sprites/"+a.sha256+".png",sha256:a.sha256,width:4,height:4,pivot:[.5,0]}])),
   animations:{Default:{frames:[{sprite:"sprite0",x:0,y:0,flip:false,alpha:1}],duration:1,mode:0,flip:false,next:""}}};
 const baselineMaps=Array.from({length:649},(_,i)=>seal({formatVersion:1,kind:"world-map-development",sourceSetHash:"b".repeat(64),
  parentSourceSetHash:"c".repeat(64),mediaSourceSetHash:"d".repeat(64),mapId:i+1,areaId:0,name:"map"+(i+1),scripts:{},
  map:{identity:{mapId:i+1,areaId:0},source,entities:[{kind:10,id:"actor",source}],groups:{entity_default:{source,entities:[{kind:10,id:"actor",source}],blockers:i===0?[miss,unknown]:[unknown]}}}})),
  candidateMaps=baselineMaps.map((m,i)=>i?structuredClone(m):seal({...m,contentHash:undefined,map:{...m.map,groups:{entity_default:{...m.map.groups.entity_default,blockers:[unknown]}}}}));
 const catalog=(maps:any[],next=false)=>seal({formatVersion:1,kind:"world-development",sourceSetHash:"b".repeat(64),parentSourceSetHash:"c".repeat(64),mediaSourceSetHash:"d".repeat(64),
  characters:{asset:next?nextCharacter:character},characterIssues:{asset:next?[]:[{reason:"Missing animation sprite sprite0",source}]},characterImports:{},
  maps:Object.fromEntries(maps.map(m=>[m.mapId,{url:"/world/maps/"+m.mapId+".json",contentHash:m.contentHash,name:m.name,areaId:0,geometryReady:true,defaultGroupReady:false,blockers:[]}]))});
 const baseline={catalog:catalog(baselineMaps),maps:baselineMaps},candidate={catalog:catalog(candidateMaps,true),maps:candidateMaps},
  pair={canonical,sourceSetHash:"b".repeat(64),mediaSourceSetHash:"d".repeat(64),baselineMediaSha256:"e".repeat(64),candidateMediaSha256:"f".repeat(64),additions,
   counts:{characters:1,oldSprites:0,candidateSprites:179,remainingIssues:1}};
 return{api,baseline,candidate,pair,miss,unknown,create:()=>api.createSourceSpriteMediaComparison({baseline,candidate,pair,compilerDigest:"1".repeat(64)})};
}
test("Sprite comparison projects exact whole-source additions without mutating either generation or borrowing mutable evidence",async()=>{
 const f=await fixture(),expected=structuredClone({baseline:f.baseline,candidate:f.candidate}),owner=f.create(),proof=structuredClone(owner.proof);
 let result=owner.compare(f.baseline.catalog,f.candidate.catalog,proof);
 assert.deepEqual(result.before.characters,result.after.characters);assert.deepEqual(result.after.characterIssues,f.baseline.catalog.characterIssues);
 const map=owner.compare(f.baseline.maps[0],f.candidate.maps[0],proof);assert.deepEqual(map.after.map.groups.entity_default.blockers,[f.miss,f.unknown]);
 assert.deepEqual({baseline:f.baseline,candidate:f.candidate},expected);
 owner.proof.candidateMediaSha256="0".repeat(64);f.candidate.catalog.characters.asset.sprites.sprite0!.sha256="0".repeat(64);
 result=owner.compare(expected.baseline.catalog,expected.candidate.catalog,proof);assert.deepEqual(result.before.characters,result.after.characters);
 assert.throws(()=>owner.compare(expected.baseline.catalog,expected.candidate.catalog,owner.proof),/declaration differs/);
 const repeated=owner.compare(expected.candidate.catalog,expected.candidate.catalog,proof);assert.deepEqual(repeated.before.characters,repeated.after.characters);
});
test("source media proof cannot hide non-media gates, altered existing geometry, partial Sprite generation or changed source",async()=>{
 const f=await fixture();f.candidate.maps[0]!.map.groups.entity_default.blockers=[];
 assert.throws(()=>f.create(),/another entity gate/);
 const g=await fixture();(g.candidate.maps[0]!.map as any).authoredGeometry="changed";assert.throws(()=>g.create(),/Unrelated map data/);
 const h=await fixture(),owner=h.create(),partial=structuredClone(h.candidate.catalog);delete partial.characters.asset.sprites.sprite0;
 assert.throws(()=>owner.compare(h.baseline.catalog,partial,owner.proof),/Partial/);
 const foreign={...h.candidate.catalog,sourceSetHash:"0".repeat(64)};assert.throws(()=>owner.compare(h.baseline.catalog,foreign,owner.proof));
 const altered=structuredClone(h.candidate.catalog);altered.characters.asset.sprites.sprite0!.source.objectId="9007199254740998";
 assert.throws(()=>owner.compare(h.baseline.catalog,altered,owner.proof),/Sprite changed/);
});

test("recipe rebind uses the two real generations, preserves actual candidate bodies and requires the live comparison owner",async()=>{
 const f=await fixture(),owner=f.create(),{resolveSourceRecipeInputs}=await import(pathToFileURL(resolve(process.cwd(),"scripts/source-recipe-inputs.mjs")).href),
  worldURL="/world/catalog.json",mapURL="/world/maps/1.json",recipe={kind:"initialized-systems-recipe-v1",id:"sprite-generation-fixture",
   sourceWorld:{url:worldURL,contentHash:f.baseline.catalog.contentHash},sourceMap:{url:mapURL,contentHash:f.baseline.maps[0]!.contentHash}},
  encoded=JSON.stringify(recipe),current=new Map([[worldURL,f.baseline.catalog],[mapURL,f.baseline.maps[0]]]),candidate=new Map([[worldURL,f.candidate.catalog],[mapURL,f.candidate.maps[0]]]),
  options={recipePath:"content-batches/sprite-fixture.json",recipeBytes:encoded,readCurrentJson:async(url:string)=>current.get(url),readCandidateJson:async(url:string)=>candidate.get(url)},
  before=structuredClone({current,candidate,recipe});
 await assert.rejects(resolveSourceRecipeInputs(options),/Source identity\/profile\/media changed/);
 await assert.rejects(resolveSourceRecipeInputs({...options,sourceSpriteMediaAddition:owner.proof}),/current pure compilation evidence/);
 const result=await resolveSourceRecipeInputs({...options,sourceSpriteMediaAddition:owner.proof,sourceSpriteMediaComparison:owner});
 assert.equal(result.recipe.sourceWorld.contentHash,f.candidate.catalog.contentHash);assert.equal(result.recipe.sourceMap.contentHash,f.candidate.maps[0]!.contentHash);
 assert.equal(result.report.sourceSpriteMediaAdditions.length,2);assert.deepEqual({current,candidate,recipe},before);
 assert.equal(result.report.recipeSha256,await import('node:crypto').then(c=>c.createHash('sha256').update(encoded).digest('hex')));
});

test("publisher rejects compiler/archive generation disagreement before archive or publication",async()=>{
 const{publishContentPackages}=await import(pathToFileURL(resolve(process.cwd(),"scripts/content-package-pipeline.mjs")).href),
  declaration={kind:"source-sprite-logical-canvas-input-v1",input:"build/candidate-media",baselineInput:"build/baseline-media"};
 for(const direction of ['undeclared-compiler','undeclared-archive']){
  const root=await mkdtemp(resolve(tmpdir(),'ffvi-sprite-media-mapping-'));let archived=false;
  try{await mkdir(resolve(root,'build/reports'),{recursive:true});
   await assert.rejects(publishContentPackages({root,...(direction==='undeclared-compiler'?{sourceSpriteMedia:declaration}:{}),
    compile:async()=>({payloads:new Map([['/content-packages/fixture.json',{controlled:true}]]),
     ...(direction==='undeclared-archive'?{sourceInputs:{kind:'source-prerequisite-input-lock-v6',sourceSpriteMedia:declaration}}:{})}),
    archive:async()=>{archived=true;throw Error('must not archive');}}),/Sprite media/);
   assert.equal(archived,false);
  }finally{await rm(root,{recursive:true,force:true});}
 }
});
