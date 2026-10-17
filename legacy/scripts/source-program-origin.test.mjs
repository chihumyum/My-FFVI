import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSourceProgramOrigin} from './source-program-origin.mjs';
import {canonical} from '../dist/src/core/canonical.js';
import {initialNpcPoseSessionFixture} from '../dist/tests/fixtures/initial-npc-pose-session.js';
import {GameFlow} from '../dist/src/core/game-flow.js';
import {GameMapLoader} from '../dist/src/core/game-map-loader.js';
const ready={visible:true,mediaReady:true,overlayOpen:false};
function fixture(){const map={mapId:7,sourceSetHash:'a'.repeat(64),parentSourceSetHash:'b'.repeat(64),
 scripts:{Resident:[{kind:'exit',source:{objectId:'9007199254740993'},script:'Resident',index:0}]},
 scriptLocals:{Resident:null},scriptSystemFlags:{Resident:{keepBadStatusVisual:false}},
 scriptPuppetContexts:{Resident:{identity:'source-context'}},scriptTransitionMetadata:{Resident:{customAnimations:'none'}}},
 field={content:{...structuredClone(map),map:{identity:{mapId:7}}}};
 return{map,field,script:'Resident',canonical};}
test('a complete matching source namespace produces a detached read-only origin receipt',()=>{
 const f=fixture(),before=structuredClone({map:f.map,field:f.field,script:f.script}),proof=assertSourceProgramOrigin(f);
 assert.equal(proof.mapId,7);assert.equal(proof.script,'Resident');assert.match(proof.namespaceSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual({map:f.map,field:f.field,script:f.script},{map:before.map,field:before.field,script:before.script});
 assert.equal(f.field.content.scripts.Resident[0].source.objectId,'9007199254740993');
});
test('a destination with the identical Resident alias and body cannot stand in for the original map',()=>{
 const f=fixture();f.field.content.map.identity.mapId=8;
 assert.throws(()=>assertSourceProgramOrigin(f),e=>e.code==='SOURCE_PROGRAM_ORIGIN_MISMATCH'&&e.actualMapId===8&&e.expectedMapId===7);
});
test('same map and root body do not authorize a replaced called namespace or its metadata',()=>{
 for(const key of ['scripts','scriptLocals','scriptSystemFlags','scriptPuppetContexts','scriptTransitionMetadata']){
  const f=fixture();f.field.content[key].another={changed:true};assert.throws(()=>assertSourceProgramOrigin(f),/namespace or metadata differs/);
 }
});
test('a missing root and an unbound source generation are rejected before invocation',()=>{
 const f=fixture();delete f.field.content.scripts.Resident;assert.throws(()=>assertSourceProgramOrigin(f),/root is missing/);
 for(const key of ['sourceSetHash','parentSourceSetHash']){const x=fixture();x.field.content[key]='c'.repeat(64);assert.throws(()=>assertSourceProgramOrigin(x),/generation differs/);}
});
test('the actual Session map commit revokes the previous source root origin without mutating either owner',async()=>{
 const f=await initialNpcPoseSessionFixture(),game=f.make(),flow=new GameFlow(game);flow.start();flow.advance(0,ready);
 for(let i=0;i<1000&&!game.checkpointReady;i++)flow.advance(10,ready);assert.equal(game.checkpointReady,true);
 const before=game.state.snapshot(),origin=assertSourceProgramOrigin({field:game.field,map:f.map,script:'leave',canonical});
 assert.equal(origin.mapId,f.map.mapId);assert.equal(game.field.startEvent('leave'),true);
 for(let i=0;i<1000&&game.field.stop?.kind!=='map-transition';i++)flow.advance(10,ready);
 assert.equal(game.field.stop?.kind,'map-transition');
 const loader=new GameMapLoader(flow,f.reader,{prepare:async()=>null,discard(){}});assert.equal((await loader.load()).status,'committed');
 assert.equal(game.field.content.map.identity.mapId,f.target.mapId);
 assert.throws(()=>assertSourceProgramOrigin({field:game.field,map:f.map,script:'leave',canonical}),/initializer left/);
 assert.deepEqual(game.state.snapshot(),before);
});
