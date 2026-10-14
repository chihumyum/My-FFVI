import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hash } from "../src/compiler/content.js";
import { canonical } from "../src/core/canonical.js";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { deriveFrameworkRelayHost, deriveFrameworkPassiveEffectsHost } from "../src/compiler/field-services.js";
import type { WorldMapContent } from "../src/field/world.js";

const script=pathToFileURL(resolve(process.cwd(),"scripts/check-selected-source-batches.mjs")).href;
const options={compiledDir:fileURLToPath(new URL("../",import.meta.url))};
const validate=async(input:unknown):Promise<any>=>(await import(script)).validateSelectedSourceFieldServicesBinding(input,options);
function seal<T extends {contentHash:string}>(raw:T):T {
  const {contentHash:_,...body}=structuredClone(raw);return {...body,contentHash:hash(body)} as T;
}
const source={file:"synthetic-services.bundle",assetPath:"Controlled/entity_default.json",objectId:"-9223372036854775807",
  serializedFile:"CAB-controlled-services",sha256:"a".repeat(64)};
const passive={action_id:0,affected:true,asset_id:269,birdview_puppet:false,blend_type:0,collision:false,
  direction:0,entity_id:0,flight_altitude_ratio:1,front:true,ignore_depth_test:false,link_object_id:0,
  object_id:0,object_type:11,play_on_awake:true,script_id:0,split:true,visible_minimap:true,zoffset:-1};
const rawObject=(id:number,values:Record<string,unknown>,x=32)=>({id,name:"Controlled service object",type:"",
  gid:values.object_type===16?1004:1008,x,y:80,width:16,height:16,rotation:0,visible:true,
  properties:Object.entries(values).map(([name,value])=>({name,type:name==="flight_altitude_ratio"?"float":
    typeof value==="boolean"?"bool":"int",value}))});

/** Synthetic source-shape metadata exercises the actual compiler/binder.
 * It is not original imagery, native execution, reachability or a runnable map. */
function fixture(withPassive=true){
  const data={layers:[{name:"GroundObject",objects:[
    rawObject(1,{entity_id:7,object_id:0,object_type:16}),
    ...(withPassive?[rawObject(2,passive,48),rawObject(3,{...passive,collision:true},64)]:[]),
  ]}]};
  const group=compileEntityGroup("entity_default",{source,data},{"mapobject.csv":[{id:"269",asset_name:"controlled_fire"}]});
  group.blockers.push({reason:"Controlled unrelated source dependency remains unknown",source:{...source,pointer:"/unknown"}});
  const range={x:0,y:0,width:24,height:24},mapSource={...source,assetPath:"Controlled/tilemap.json",objectId:"9223372036854775806"};
  const original=seal<WorldMapContent>({formatVersion:1,kind:"world-map-development",sourceSetHash:"b".repeat(64),
    parentSourceSetHash:"c".repeat(64),mediaSourceSetHash:"d".repeat(64),contentHash:"",mapId:59,areaId:8,name:"Controlled service",
    map:{id:"controlled-services",identity:{mapId:59,areaId:8},width:24,height:24,tileSize:16,
      layers:[],tilesets:[],textures:{},collisions:{1:Array(576).fill(0)},entities:structuredClone(group.entities),
      source:mapSource,groups:{entity_default:group},initialGroups:["entity_default"]},
    cameraHost:{kind:"source-field-camera-host-v1",mapRange:range,loop:{horizontal:false,vertical:false},
      playerVisualOffset:{x:0,y:-6},callbacks:"fresh-normal-field-v1",sources:[mapSource]},
    partyEntry:{formatVersion:1,kind:"map-party-entry",mapId:59,width:24,height:24,mapRange:range,
      loopType:0,pointIns:[],conditionColliders:[]},scripts:{},scriptLocals:{},initializer:null,characterAssets:[],
    blockers:[],limitations:["Controlled metadata only"]});
  const otherDraft=structuredClone(original);otherDraft.mapId=60;otherDraft.map!.identity!.mapId=60;otherDraft.partyEntry!.mapId=60;
  const other=seal(otherDraft),sourceMaps=[original,other];
  const corpus={sourceSetHash:original.sourceSetHash,manifest:{parentSourceSetHash:original.parentSourceSetHash},assets:[{source,data}]};
  const relay=deriveFrameworkRelayHost(original),passiveResult=deriveFrameworkPassiveEffectsHost(original,corpus.assets);
  const selected=seal({...original,developmentProfile:{kind:"framework-development-v1" as const,
    policy:"omit-anonymous-environment-particles-v1" as const,sourceContentHash:original.contentHash,omissions:[],
    relayInteraction:relay.policy,passiveEffects:"framework-passive-field-effects-v1" as const},
    frameworkRelayInteraction:relay,...(passiveResult.host?{frameworkPassiveEffects:passiveResult.host}:{})});
  const unselected=seal({...other,developmentProfile:{kind:"framework-development-v1" as const,
    policy:"omit-anonymous-environment-particles-v1" as const,sourceContentHash:other.contentHash,omissions:[]}});
  const declaration={kind:"framework-field-services-declaration-v1",relayInteraction:relay.policy,
    passiveEffects:"framework-passive-field-effects-v1",mapIds:[59]};
  const built={kind:"initialized-source-map-build-v1",recipeKind:"initialized-source-map-recipe-v5",
    battleCatalogSelection:"source-baseline-v1",sourceAreaScopeReceipt:null,
    fieldServices:{declaration,maps:[{mapId:59,relays:relay.bindings.length,passiveEffects:passiveResult.host?.bindings.length??0,
      diagnostics:passiveResult.diagnostics,nativeRulesVerified:false}],nativeRulesVerified:false}};
  const maps:WorldMapContent[]=[selected,unselected];
  return {built,maps,sourceMaps,corpus};
}

test("v5 reconstructs complete service hosts from original raw inputs, preserving unknowns and caller data",async()=>{
  const input=fixture(),before=canonical(input),result=await validate(input);
  assert.equal(result.maps.length,1);assert.equal(result.maps[0].relays,1);assert.equal(result.maps[0].passiveEffects,1);
  assert.equal(result.maps[0].diagnostics.length,1,"A physical effect remains a source dependency");
  assert.equal(result.nativeRulesVerified,false);assert.equal(result.counterReachabilityVerified,false);
  assert.equal(result.runtimeAdmission,"unassessed");assert.equal(canonical(input),before);
  result.maps[0].diagnostics.length=0;
  assert.equal((await validate(input)).maps[0].diagnostics.length,1);
});

test("a map without passive source objects carries zero receipt count and cannot acquire an empty host",async()=>{
  const input=fixture(false),result=await validate(input);
  assert.equal(result.maps[0].passiveEffects,0);assert.equal(result.maps[0].diagnostics.length,0);
  assert.equal(Object.hasOwn(input.maps[0]!,"frameworkPassiveEffects"),false);
  const hidden=fixture().maps[0]!.frameworkPassiveEffects!;hidden.bindings=[];
  input.maps[0]!.frameworkPassiveEffects=hidden;input.maps=input.maps.map(seal);
  await assert.rejects(validate(input),/Empty|hidden|passive/i);
});

test("an existing byte hash or a resealed changed map cannot hide removed source 11/16 entities or diagnostics",async()=>{
  for(const mutate of [
    (f:ReturnType<typeof fixture>)=>{f.maps[0]!.map!.groups!.entity_default!.entities.pop();},
    (f:ReturnType<typeof fixture>)=>{f.maps[0]!.map!.groups!.entity_default!.blockers.pop();},
    (f:ReturnType<typeof fixture>)=>{f.maps[0]!.map!.entities.pop();},
    (f:ReturnType<typeof fixture>)=>{f.maps[1]!.limitations=[];},
  ]){
    const input=fixture();mutate(input);await assert.rejects(validate(input));
    input.maps=input.maps.map(seal);await assert.rejects(validate(input),/changed|binding|entity/i);
  }
});

test("service membership and receipt are exact, including all failed passive derivations",async()=>{
  for(const mutate of [
    (f:ReturnType<typeof fixture>)=>{f.built.fieldServices.maps=[];},
    (f:ReturnType<typeof fixture>)=>{f.built.fieldServices.maps[0]!.diagnostics=[];},
    (f:ReturnType<typeof fixture>)=>{f.built.fieldServices.maps[0]!.relays=0;},
    (f:ReturnType<typeof fixture>)=>{f.built.fieldServices.maps.push(structuredClone(f.built.fieldServices.maps[0]!));},
    (f:ReturnType<typeof fixture>)=>{f.built.fieldServices.declaration.mapIds.push(59);},
    (f:ReturnType<typeof fixture>)=>{f.built.fieldServices.declaration.mapIds=[61];},
    (f:ReturnType<typeof fixture>)=>{f.maps.pop();},
    (f:ReturnType<typeof fixture>)=>{f.sourceMaps.push(structuredClone(f.sourceMaps[0]!));},
  ]){const input=fixture();mutate(input);await assert.rejects(validate(input));}
});

test("trusted source hashes, full relay binding and raw passive provenance cannot be relabelled",async()=>{
  for(const mutate of [
    (f:ReturnType<typeof fixture>)=>{f.maps[0]!.frameworkRelayInteraction!.sourceMapHash="f".repeat(64);},
    (f:ReturnType<typeof fixture>)=>{f.maps[0]!.frameworkRelayInteraction!.bindings=[];},
    (f:ReturnType<typeof fixture>)=>{f.maps[0]!.frameworkPassiveEffects!.bindings=[];},
    (f:ReturnType<typeof fixture>)=>{f.maps[0]!.frameworkPassiveEffects!.bindings[0]!.rawSource.x=1;},
    (f:ReturnType<typeof fixture>)=>{f.corpus.assets=[];},
    (f:ReturnType<typeof fixture>)=>{f.corpus.sourceSetHash="e".repeat(64);},
  ]){const input=fixture();mutate(input);input.maps=input.maps.map(seal);await assert.rejects(validate(input));}
});

test("old recipe kinds reject hidden service receipts, profiles and hosts, while plain old records remain compatible",async()=>{
  for(const version of [1,2,3,4]){
    const input=fixture();input.built.recipeKind=`initialized-source-map-recipe-v${version}`;
    await assert.rejects(validate(input),/version 5/);
    const {fieldServices:_,...old}=input.built;await assert.rejects(validate({...input,built:old}),/Hidden field services/);
    input.maps=input.maps.map(map=>{const {frameworkRelayInteraction:_,frameworkPassiveEffects:__,...body}=map;
      delete body.developmentProfile!.relayInteraction;delete body.developmentProfile!.passiveEffects;return seal(body);});
    assert.equal(await validate({...input,built:old}),null);
  }
});

test("unselected maps and asserted native acceptance never inherit service permission",async()=>{
  const hidden=fixture();hidden.maps[1]!.frameworkPassiveEffects=structuredClone(hidden.maps[0]!.frameworkPassiveEffects!);
  hidden.maps=hidden.maps.map(seal);await assert.rejects(validate(hidden),/outside declared/);
  const hiddenProfile=fixture();hiddenProfile.maps[1]!.developmentProfile!.passiveEffects="framework-passive-field-effects-v1";
  hiddenProfile.maps=hiddenProfile.maps.map(seal);await assert.rejects(validate(hiddenProfile),/outside declared/);
  const native=fixture();Object.assign(native.built.fieldServices,{nativeRulesVerified:true});await assert.rejects(validate(native));
  const missing=fixture();const {sourceAreaScopeReceipt:_,...built}=missing.built;
  await assert.rejects(validate({...missing,built}),/Version 3/);
});
