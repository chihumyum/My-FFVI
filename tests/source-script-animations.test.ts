import test from "node:test";
import assert from "node:assert/strict";
import { ActorAnimation } from "../src/core/actor-animation.js";
import { compileSourceScriptAnimations } from "../src/compiler/source-script-animations.js";
import { hash } from "../src/compiler/content.js";
import { SOURCE_FORMAT_FLAG_IMPORT } from "../src/core/source-format-import.js";
import { sourceCustomAnimationByName, parseSourceScriptAnimationCatalog, projectSourceCustomAnimation,
  type SourceCustomAnimation } from "../src/core/source-script-animations.js";
import type { Animation, Character } from "../src/field/types.js";

const source={file:"authored.bundle",assetPath:"authored/hero",objectId:"-9007199254740993",serializedFile:"authored-cab",sha256:"a".repeat(64)};
const raw=(name="Pose",sprite="a",duration=.1):SourceCustomAnimation=>({name,frames:[{sprite_name:sprite,offsetx:0,offsety:0,alpha:1,rgb:{r:1,g:1,b:1,a:1},flip:false}],play_speed:duration,play_mode:0,is_reverse:false,next_anim_name:""});
const clip=(sprite="a"):Animation=>({frames:[{sprite,x:0,y:0,alpha:1,flip:false}],duration:.1,mode:0,flip:false,next:""});
const character=():Character=>({source,sprites:Object.fromEntries(["a","b"].map(key=>[key,{file:key+".png",width:16,height:16,pivot:[.5,0],sha256:"b".repeat(64),source}])),animations:{Default:clip(),Wave:clip("b")}});
function fixture(first=[raw()],second=[raw("Pose","b")]){
  const sources=[{file:"GameAssembly.dll",sha256:SOURCE_FORMAT_FLAG_IMPORT.nativeSha256},{file:source.file,sha256:source.sha256}],
    assets=[first,second].map((animations,index)=>({id:"authored:"+index,kind:"script"as const,source:{...source,assetPath:"authored/script"+index+".json",objectId:String(-9007199254740993n-BigInt(index))},data:{SystemFlag:{},Animations:animations}})),
    input={sourceSetHash:hash(sources),manifest:{parentSourceSetHash:"d".repeat(64),sources},assets},result=compileSourceScriptAnimations(input),
    authority={catalog:result.catalog,baseKeys:["Default","Wave"]};
  assert.equal(result.rejected.length,0);
  return{...result,input,authority,first:result.byProgram["authored:0"]!,second:result.byProgram["authored:1"]!};
}

test("source definitions remain ordered and duplicates use their first original physical index",()=>{
  const f=fixture([raw("Pose","a"),raw("Pose","b")]),before=structuredClone(f.input);
  assert.equal(sourceCustomAnimationByName(f.catalog,f.first,"Pose")!.index,0);
  assert.equal(f.catalog.assets[f.first]!.animations.length,2);
  assert.deepEqual(parseSourceScriptAnimationCatalog(f.catalog),f.catalog);
  assert.deepEqual(f.input,before);assert.equal(f.catalog.assets[f.first]!.source.objectId,"-9007199254740993");
  const actor=new ActorAnimation(character());actor.prepareSourceCustomKey("Pose",f.first,f.authority);actor.cue("Pose",0);assert.equal(actor.frame().sprite,"a");
});
test("base then actual actor cache then current Integrator asset; a new component does not inherit a former component cache",()=>{
  const f=fixture([raw("Default","missing"),raw("Pose","a"),raw("Wave","a")]),actor=new ActorAnimation(character());
  actor.prepareSourceCustomKey("Default",f.first,f.authority);actor.cue("Default",0);assert.equal(actor.frame().sprite,"a");assert.equal(Object.hasOwn(actor.snapshot()!,"sourceCustomCache"),false);
  actor.prepareSourceCustomKey("Pose",f.first,f.authority);actor.cue("Pose",0);
  const copy=actor.clone();copy.prepareSourceCustomKey("Pose",f.second,f.authority);copy.cue("Pose",0);assert.equal(copy.frame().sprite,"a");
  actor.prepareSourceCustomKey("Pose",null,f.authority);actor.cue("Pose",0);assert.equal(actor.frame().sprite,"a");
  const fresh=new ActorAnimation(character());fresh.prepareSourceCustomKey("Pose",f.second,f.authority);fresh.cue("Pose",0);assert.equal(fresh.frame().sprite,"b");
  const inherited=fixture([raw("constructor","b")]),literal=new ActorAnimation(character());literal.prepareSourceCustomKey("constructor",inherited.first,inherited.authority);literal.cue("constructor",0);assert.equal(literal.frame().sprite,"b");
  const incomplete=character();delete incomplete.animations.Wave;
  const blocked=new ActorAnimation(incomplete);assert.throws(()=>blocked.prepareSourceCustomKey("Wave",f.first,{...f.authority,baseKeys:["Default","Wave"]}),/Uncompiled native base/);
});
test("successors use only the base namespace even if a same-named custom entry was already loaded",()=>{
  const a=raw("Pose");a.next_anim_name="Other";const f=fixture([a,raw("Other")]),actor=new ActorAnimation(character());
  actor.prepareSourceCustomKey("Other",f.first,f.authority);actor.cue("Other",0);const before=actor.snapshot();
  const draft=actor.clone();draft.prepareSourceCustomKey("Pose",f.first,f.authority);assert.throws(()=>draft.cue("Pose",0),/base namespace/);assert.deepEqual(actor.snapshot(),before);
  a.next_anim_name="Wave";const good=fixture([a]),next=new ActorAnimation(character());next.prepareSourceCustomKey("Pose",good.first,good.authority);next.cue("Pose",0);next.cue("Pose",0);assert.equal(next.frame().sprite,"b");
});
test("zero-duration single-frame One pose selects frame0 and ends only after a positive clock; loop override has one transition per update",()=>{
  const f=fixture([raw("Pose","b",0)]),actor=new ActorAnimation(character());actor.prepareSourceCustomKey("Pose",f.first,f.authority);actor.play("Pose",false,1);
  assert.equal(actor.frame().sprite,"b");assert.equal(actor.playing,true);actor.advance(0);assert.equal(actor.playing,true);actor.advance(10);assert.equal(actor.playing,false);assert.equal(actor.snapshot()!.duration,0);
  actor.play("Pose",true,1);actor.advance(10);assert.equal(actor.playing,true);assert.equal(actor.snapshot()!.loops,1);assert.equal(actor.frame().sprite,"b");
  const restored=new ActorAnimation(character());restored.restore(actor.snapshot(),f.authority);assert.deepEqual(restored.snapshot(),actor.snapshot());
});
test("saved caches are references into current trusted content and cannot import definitions, a later duplicate, new catalog or missing media",()=>{
  const f=fixture([raw(),raw("Pose","b")]),actor=new ActorAnimation(character());actor.prepareSourceCustomKey("Pose",f.first,f.authority);actor.cue("Pose",0);const snapshot=actor.snapshot()!;
  assert.throws(()=>new ActorAnimation(character()).restore(snapshot),/trusted source/);
  const after=new ActorAnimation(character());after.restore(snapshot,f.authority);assert.deepEqual(after.snapshot(),snapshot);
  for(const change of [(s:typeof snapshot)=>{s.sourceCustomCache!.catalogHash="f".repeat(64);},
    (s:typeof snapshot)=>{s.sourceCustomCache!.entries[0]!.ref.index=1;},
    (s:typeof snapshot)=>{s.sourceCustomCache!.entries[0]!.ref.assetId="f".repeat(64);},
    (s:typeof snapshot)=>{(s.sourceCustomCache as unknown as Record<string,unknown>).definitions=[raw()];}]){
    const changed=structuredClone(snapshot);change(changed);assert.throws(()=>after.restore(changed,f.authority));assert.deepEqual(after.snapshot(),snapshot);
  }
  const media=character();delete media.sprites.a;assert.throws(()=>new ActorAnimation(media).restore(snapshot,f.authority),/Missing actual actor sprite/);
});
test("unknown media, mode, color/alpha interpolation and nontrivial zero duration stay specific gates",()=>{
  const sprites=character().sprites;
  for(const [change,reason]of [
    [(d:SourceCustomAnimation)=>{d.frames[0]!.sprite_name="missing";},/actual actor sprite/],
    [(d:SourceCustomAnimation)=>{d.play_mode=2;},/play mode 2/],
    [(d:SourceCustomAnimation)=>{d.frames[0]!.rgb.r=.5;},/color interpolation/],
    [(d:SourceCustomAnimation)=>{d.frames.push({...structuredClone(d.frames[0]!),alpha:.5});},/alpha interpolation/],
    [(d:SourceCustomAnimation)=>{d.play_speed=0;d.frames.push(structuredClone(d.frames[0]!));},/zero-pose/],
  ]as const){const d=raw();change(d);assert.throws(()=>projectSourceCustomAnimation(d,sprites),reason);}
  const noBase=character();noBase.animations={};const unknownProjection=fixture();
  assert.throws(()=>new ActorAnimation(noBase).prepareSourceCustomKey("Pose",unknownProjection.first,{...unknownProjection.authority,baseKeys:[]}),/ordinary base sprite projection/);
  const malformed=fixture();const catalog={...structuredClone(malformed.catalog),formatImport:{...malformed.catalog.formatImport,nativeSha256:"f".repeat(64)}};assert.throws(()=>parseSourceScriptAnimationCatalog(catalog),/identity/);
});
