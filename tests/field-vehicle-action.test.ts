import test from 'node:test';import assert from 'node:assert/strict';
import{compileEntityGroup}from '../src/compiler/entity-group.js';
import{validateFieldVehicleAction}from '../src/core/field-vehicle-action.js';
const source={file:'controlled-source.bundle',assetPath:'controlled-source/entity_default.json'};
function compile(change:(raw:Record<string,unknown>,p:Record<string,unknown>,tables:Record<string,unknown>)=>void=()=>{}){
 const p={action_id:2,direction:0,entity_id:927,gimmick:false,interactive_icon_type:3,link_object_id:0,object_id:0,object_type:21,script_id:882,target_transportation_ids:'31,72'},
 raw:Record<string,unknown>={id:554,gid:998,name:'controlled action',width:16,height:16,x:48,y:64,visible:true,rotation:0,type:''},tables={'action.csv':[{id:'2',action_name:'RunScript'}],'script.csv':[{id:'882',script_name:'original_source_action'}],'transportation.csv':[{id:'31',type_id:'8',asset_id:'73'},{id:'72',type_id:'8',asset_id:'74'}]};
 change(raw,p,tables);raw.properties=Object.entries(p).map(([name,value])=>({name,value,type:typeof value==='boolean'?'bool':typeof value==='number'?'int':'string'}));
 return compileEntityGroup('entity_default',{source,data:{layers:[{name:'BottomObject',objects:[raw]}]}},tables);
}
test('all source property/table/geometry inputs stay in a typed descriptor while strict admission remains blocked',()=>{
 const g=compile(),e=g.entities[0]!;assert.deepEqual(g.blockers,[{reason:'Unsupported entity kind 21',source:e.source}]);const d=validateFieldVehicleAction(e);assert.equal(d.script.script_name,'original_source_action');assert.deepEqual(d.targets.map(t=>t.id),['31','72']);assert.equal(d.properties.target_transportation_ids,'31,72');
 const changed=structuredClone(e);changed.vehicleAction!.rawObject.x=64;assert.throws(()=>validateFieldVehicleAction(changed),/differs/);changed.vehicleAction!.rawObject.x=48;changed.vehicleAction!.targets[0]!.id='72';assert.throws(()=>validateFieldVehicleAction(changed),/identity/);
});
test('unknown source fields/targets/action/phase and geometry keep the original strict entity plus specific typed gaps',()=>{
 for(const change of [(r:Record<string,unknown>,p:Record<string,unknown>)=>{p.gimmick=true;},(r:Record<string,unknown>,p:Record<string,unknown>)=>{p.link_object_id=9;},(r:Record<string,unknown>,p:Record<string,unknown>)=>{p.target_transportation_ids='31,';},(r:Record<string,unknown>,p:Record<string,unknown>)=>{p.native_unknown=1;},(r:Record<string,unknown>)=>{r.width=32;},(_r:Record<string,unknown>,_p:Record<string,unknown>,t:Record<string,unknown>)=>{(t['action.csv']as {action_name:string}[])[0]!.action_name='Boarding';}]){
  const g=compile(change);assert.equal(g.entities.length,1);assert(g.blockers.some(b=>b.reason==='Unsupported entity kind 21'));assert(g.entities[0]!.vehicleActionBlockers?.length);assert.throws(()=>validateFieldVehicleAction(g.entities[0]!));
 }
});
