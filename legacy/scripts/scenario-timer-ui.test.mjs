import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../dist/src/compiler/content.js';
import {FieldGame} from '../dist/src/core/field.js';
import {EventState} from '../dist/src/core/event-state.js';
import {checkpointFixture} from '../dist/tests/fixtures/checkpoint-game.js';
import {drawStoryTimer} from '../apps/game/story-overlay.js';
import {SourceFieldUiView} from '../apps/game/source-field-ui-view.js';
function dom(){let root;const document={createElement:()=>new Element()};class Element{constructor(){this.parentNode=null;this.children=[];this.dataset={};this.ownerDocument=document;this.hidden=false;}get isConnected(){return this===root||this.parentNode?.isConnected===true;}append(...children){for(const child of children){child.parentNode=this;this.children.push(child);}}setAttribute(){}}root=new Element();return root;}
test('actual timer-only UI projects the callback-free Cid owner into Canvas and current DOM without renderer clocks',()=>{
 const content=structuredClone(checkpointFixture().field);content.parentSourceSetHash='a'.repeat(64);content.map.identity={mapId:1,areaId:1};content.developmentProfile={kind:'framework-development-v1',policy:'omit-anonymous-environment-particles-v1',sourceContentHash:'b'.repeat(64),omissions:[],storyRuntime:'web-field-story-runtime-v1'};
 const source={file:'synthetic-timer-ui',assetPath:'author/program.json'},scripts={start:[{kind:'calc',left:{category:'ScenarioVariable',index:2},operator:'←',right:{kind:'immediate',value:61}},{kind:'field-scenario-timer',command:'cid-resume'},{kind:'exit'}],show:[{kind:'source-field-ui',command:{kind:'timer-only'}},{kind:'exit'}]};
 for(const[name,ops]of Object.entries(scripts)){content.scripts[name]=ops.map((op,index)=>({...op,script:name,index,source}));(content.scriptLocals??={})[name]=null;}
 const {contentHash:oldHash,...body}=content;content.contentHash=hash(body);
 const field=new FieldGame(content,EventState.initialized(),undefined,undefined,{sourceFieldUi:'web-source-field-ui-v1'});assert(field.startEvent('start'));assert.equal(field.stop,null);assert.equal(field.timerProjection.visible,false);assert(field.startEvent('show'));assert.equal(field.stop,null);
 const before=JSON.stringify(field.storyRuntimeSnapshot),root=dom(),view=new SourceFieldUiView(root),calls=[],ctx={save(){},restore(){},fillText(...values){calls.push(values);}};
 assert.deepEqual(view.render(field),{source:true,event:false,view:'timer'});assert.equal(root.dataset.sourceMapView,'timer');
 drawStoryTimer(ctx,640,field.timerProjection);assert.deepEqual(calls,[['1:01',620,20]]);assert.equal(JSON.stringify(field.storyRuntimeSnapshot),before);
 field.advance(1000);drawStoryTimer(ctx,640,field.timerProjection);assert.deepEqual(calls.at(-1),['1:00',620,20]);
});
