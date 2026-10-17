import test from "node:test";
import assert from "node:assert/strict";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { SOURCE_NON_ENCOUNTER_AREAS, prepareSourceNonEncounterAreas, sourceStandingInNonEncounterArea } from "../src/core/field-non-encounter-areas.js";
import { IMMUTABLE_OWNED_FIELD_SOURCE } from "../src/core/field-source-snapshot.js";
import { FieldGame } from "../src/core/field.js";
import { nonEncounterFieldContent, nonEncounterGroup, nonEncounterSource } from "./fixtures/non-encounter-area-session.js";
const options={sourceNonEncounterAreas:SOURCE_NON_ENCOUNTER_AREAS};
const range={x:0,y:0,width:12,height:12};

test("source property23 preserves invisible anonymous data and creates no actor or collision",()=>{
 const group=nonEncounterGroup("anonymous",901,undefined,true);assert.deepEqual(group.blockers,[]);
 const e=group.entities[0]!;assert.equal(e.kind,23);assert.equal(e.nonEncounterArea!.sourceEntityId,null);
 assert.equal(e.nonEncounterArea!.sourceTiledId,901);assert.equal(e.asset,null);assert.equal(e.script,null);assert.equal(e.collision,null);
 const c=nonEncounterFieldContent();c.map.groups!.a=group;c.scripts.a![0]={...c.scripts.a![0]!,kind:"entities",group:"anonymous"};
 c.map.groups!.anonymous=group;delete c.map.groups!.a;
 const f=new FieldGame(c,undefined,undefined,undefined,options);assert.equal(f.startEvent("a"),true);assert.equal(f.stop,null);
 assert.equal(f.actors[e.id],undefined);assert.equal(f.sourceStandingInNonEncounterArea({x:1,y:1}),true);
});

test("inclusive source rectangle edges ignore layer and retain just-outside boundaries",()=>{
 const area=nonEncounterGroup("a").entities[0]!.nonEncounterArea!;
 for(const cell of [{x:1,y:1},{x:3,y:1},{x:1,y:3},{x:3,y:3},{x:2,y:2}])assert.equal(sourceStandingInNonEncounterArea([area],range,cell),true);
 for(const cell of [{x:0.999,y:2},{x:3.001,y:2},{x:2,y:0.999},{x:2,y:3.001}])assert.equal(sourceStandingInNonEncounterArea([area],range,{x:Math.fround(cell.x),y:Math.fround(cell.y)}),false);
 assert.throws(()=>sourceStandingInNonEncounterArea([area],range,{x:NaN,y:2}));
});

test("nonzero crop and half-cell nearest-even conversion use the shared AreaObject projection once",()=>{
 const area=nonEncounterGroup("crop",901,{x:56,y:88,width:40,height:24}).entities[0]!.nonEncounterArea!;
 const crop={x:2,y:3,width:8,height:8}; // local pixel(24,40), cell ties(1.5,2.5)→(2,2), size(2.5,1.5)→(2,2)
 assert.equal(sourceStandingInNonEncounterArea([area],crop,{x:2,y:2}),true);
 assert.equal(sourceStandingInNonEncounterArea([area],crop,{x:4,y:4}),true);
 assert.equal(sourceStandingInNonEncounterArea([area],crop,{x:1,y:2}),false);
 assert.equal(sourceStandingInNonEncounterArea([area],crop,{x:4,y:5}),false);
});

test("source region list accumulates current default/latest selections while minimap stays latest",()=>{
 const c=nonEncounterFieldContent(),f=new FieldGame(c,undefined,undefined,undefined,options);
 assert.equal(f.sourceStandingInNonEncounterArea({x:1,y:1}),false);f.startEvent("a");
 assert.equal(f.sourceStandingInNonEncounterArea({x:1,y:1}),true);f.startEvent("b");
 assert.deepEqual([...f.activeGroups],["entity_default","a","b"]);
 assert.equal(f.sourceStandingInNonEncounterArea({x:1,y:1}),true);assert.equal(f.sourceStandingInNonEncounterArea({x:7,y:7}),true);
 assert.deepEqual(f.minimapEntities.map(e=>e.id),["b:0:0"]);
 const before=f.sourceNonEncounterAreaProperties;f.startEvent("a");assert.match(f.stop!.message,/重复实体组/);assert.deepEqual(f.sourceNonEncounterAreaProperties,before);
});

test("the complete boolean query is order/duplicate independent, without claiming native list identity",()=>{
 const c=nonEncounterFieldContent(),a=c.map.groups!.a!.entities,b=c.map.groups!.b!.entities;
 const ab=prepareSourceNonEncounterAreas(c,options.sourceNonEncounterAreas,b,prepareSourceNonEncounterAreas(c,options.sourceNonEncounterAreas,a,[]));
 const ba=prepareSourceNonEncounterAreas(c,options.sourceNonEncounterAreas,a,prepareSourceNonEncounterAreas(c,options.sourceNonEncounterAreas,b,[]));
 const duplicate=prepareSourceNonEncounterAreas(c,options.sourceNonEncounterAreas,a,ab);
 for(let x=0;x<12;x++)for(let y=0;y<12;y++){assert.equal(sourceStandingInNonEncounterArea(ab,range,{x,y}),sourceStandingInNonEncounterArea(ba,range,{x,y}));assert.equal(sourceStandingInNonEncounterArea(ab,range,{x,y}),sourceStandingInNonEncounterArea(duplicate,range,{x,y}));}
});

test("current content and runtime are independently required and source binding errors cannot partially publish",()=>{
 for(const missing of ["runtime","content","definition","rectangle"]){
  const c=nonEncounterFieldContent();if(missing==="content")delete c.map.sourceNonEncounterAreas;
  if(missing==="definition")delete c.map.groups!.a!.entities[0]!.nonEncounterArea;
  if(missing==="rectangle")c.map.groups!.a!.entities[0]!.nonEncounterArea!.pixelBounds.x+=16;
  const f=new FieldGame(c,undefined,undefined,undefined,missing==="runtime"?{}:options),before={groups:[...f.activeGroups],entities:[...f.entities],current:[...f.minimapEntities]};
  f.startEvent("a");assert.equal(f.stop?.kind,"unsupported",missing);
  assert.deepEqual([...f.activeGroups],before.groups);assert.deepEqual(f.entities,before.entities);assert.deepEqual(f.minimapEntities,before.current);assert.equal(f.sourceNonEncounterAreaProperties.length,0);
 }
});

test("restore rebuilds admitted history from current content only; save cannot grant capability or invented data",()=>{
 const c=nonEncounterFieldContent(),f=new FieldGame(c,undefined,undefined,undefined,options);f.startEvent("a");f.startEvent("b");
 const s=f.checkpoint(),restored=FieldGame.restore(c,s,options);assert.deepEqual(restored.checkpoint(),s);
 assert.equal(restored.sourceStandingInNonEncounterArea({x:1,y:1}),true);assert.equal(restored.sourceStandingInNonEncounterArea({x:7,y:7}),true);
 assert.deepEqual(restored.minimapEntities,f.minimapEntities);assert.throws(()=>FieldGame.restore(c,s,{}),/runtime authority/);
 assert.throws(()=>FieldGame.restore(c,{...s,sourceNonEncounterAreas:[]}as unknown as typeof s,options),/fields/);
 f.retireSourceNonEncounterAreas();assert.throws(()=>f.sourceStandingInNonEncounterArea({x:1,y:1}),/Retired/);assert.throws(()=>f.checkpoint(),/Retired/);
 assert.equal(restored.sourceStandingInNonEncounterArea({x:1,y:1}),true);
});

test("unknown property/geometry/transform stays hard and metadata cannot grant another factory kind",()=>{
 for(const extra of [{name:"callback",value:"unknown"},{name:"asset_id",value:1}]){
  const g=compileEntityGroup("bad",{source:nonEncounterSource,data:{layers:[{name:"GroundObject",objects:[{id:1,x:0,y:0,width:16,height:16,visible:true,properties:[{name:"object_type",value:23},extra]}]}]}},{});
  assert.match(g.blockers.map(b=>b.reason).join(),/properties/);
 }
 const c=nonEncounterFieldContent();c.map.groups!.a!.entities[0]!.kind=5;
 const f=new FieldGame(c,undefined,undefined,undefined,options);f.startEvent("a");assert.equal(f.stop?.kind,"unsupported");assert.equal(f.sourceNonEncounterAreaProperties.length,0);
});


test("late mutable carriers cannot change geometry, attach another provider or create ambiguous current region authority",()=>{
 for(const corrupt of [
  (c:ReturnType<typeof nonEncounterFieldContent>)=>{c.map.groups!.a!.entities[0]!.x+=1;},
  (c:ReturnType<typeof nonEncounterFieldContent>)=>{c.map.groups!.a!.entities[0]!.effect={} as never;},
  (c:ReturnType<typeof nonEncounterFieldContent>)=>{c.map.groups!.a!.entities.push(structuredClone(c.map.groups!.a!.entities[0]!));},
 ])for(const operation of ["query","step","checkpoint"]){
  const c=nonEncounterFieldContent(),f=new FieldGame(c,undefined,undefined,undefined,options);f.startEvent("a");corrupt(c);
  if(operation==="query")assert.throws(()=>f.sourceStandingInNonEncounterArea({x:1,y:1}),/source|unique|carrier/i);
  else if(operation==="checkpoint")assert.throws(()=>f.checkpoint(),/source|unique|carrier/i);
  else{assert.equal(f.move("right"),false);assert.equal(f.stop?.kind,"unsupported");assert.match(f.stop!.message,/source|unique|carrier/i);}
 }
});

test("actual immutable owned source snapshot keeps caller mutations separate from its current region binding",()=>{
 const c=nonEncounterFieldContent(),f=new FieldGame(c,undefined,undefined,undefined,{...options,sourceSnapshot:IMMUTABLE_OWNED_FIELD_SOURCE});
 f.startEvent("a");const before=f.checkpoint();c.map.groups!.a!.entities[0]!.x+=100;
 assert.equal(f.sourceStandingInNonEncounterArea({x:1,y:1}),true);assert.deepEqual(f.checkpoint(),before);
 assert.throws(()=>{f.content.map.groups!.a!.entities[0]!.x=100;},/read only|readonly|Cannot assign/i);
});
