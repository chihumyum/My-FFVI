// Actual BattleView and shared BattleGame; DOM/canvas are controlled. No native
// rendering, source story completion or browser raster parity is claimed.
import assert from 'node:assert/strict';import{readFile,writeFile,mkdir}from'node:fs/promises';import{resolve}from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';
import{BattleView}from'../apps/game/battle-view.js';import{runtimeDigest}from'./runtime-digest.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2);assert(args.length===0||args.length===2&&args[0]==='--compiled-dir');const compiled=resolve(root,args[1]??'dist'),load=p=>import(pathToFileURL(resolve(compiled,p+'.js'))),before=await runtimeDigest(root,compiled),
 [{BattleGame},{absorptionContent},{projectDevelopmentBattleLayout}]=await Promise.all(['src/core/battle','tests/fixtures/resource-absorption','src/core/battle-layout'].map(load));
const cases=[];
for(const resource of ['hp','mp']){
 const content=absorptionContent(resource);content.sprites.synthetic={file:'synthetic.png',width:16,height:16};const images=new Map([['synthetic.png',{id:'synthetic-image'}]]),nodes=new Map();
 globalThis.document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{onclick:null,replaceChildren(){}});return nodes.get(id);}};
 const calls={text:[],strokes:0,images:[]},ctx=new Proxy({fillText:text=>calls.text.push(text),strokeText(){},stroke:()=>{calls.strokes++;},drawImage:(...args)=>calls.images.push(args)},{get:(t,k)=>t[k]??(()=>{})}),canvas={getContext:()=>ctx},battle=new BattleGame(content,314),view=new BattleView(canvas,content,images,()=>{},()=>{},undefined,projectDevelopmentBattleLayout),actor=battle.players[0],target=battle.enemies[0];actor.hp=10;
 const initial={hp:actor.hp,mp:actor.mp,targetHp:target.hp,targetMp:target.mp};assert(battle.command(actor.id,901,target.id));battle.advance(250);view.draw(battle);assert.equal(calls.strokes,0,'Deferred native VFX cannot invent a beam');assert.deepEqual(calls.text,[]);
 assert(calls.images.some(row=>row.length===9&&row[5]===view.position(actor,battle).x-8),'Deferred effect must not invent an attacker lunge');battle.advance(160);assert(battle.action.resolved);const result=battle.action.userResourceResults[0];assert(result.amount>0);view.draw(battle);
 const suffix=resource==='mp'?' MP':'';assert(calls.text.includes(String(result.amount)+suffix));assert(calls.text.includes('+'+result.amount+suffix));assert.equal(actor.mp,initial.mp-2+(resource==='mp'?result.amount:0));assert.equal(actor.hp,initial.hp+(resource==='hp'?result.amount:0));
 cases.push({resource,result:'passed',actualView:true,actualBattleOwner:true,sourceGraphicsDeferred:true,targetResult:battle.action.results[0],casterResult:result,browserVerified:false});
}
assert.equal(await runtimeDigest(root,compiled),before);const report={kind:'actual-resource-absorption-view-v1',result:'passed',runtimeSha256:before,cases,actualBattleView:true,actualBattleGame:true,compilerFixture:true,nativeDynamicParity:false,sourceStoryReachability:false},path=resolve(root,'build/reports/resource-absorption-ui.json');await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,cases:cases.length,runtimeSha256:before,report:path}));
