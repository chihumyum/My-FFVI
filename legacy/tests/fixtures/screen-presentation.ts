import {worldAutoMoveFixture}from'./world-auto-move.js';import{sealBatchContent}from'./content-batch.js';import{compileFrameworkNewGame}from'../../src/compiler/framework-new-game.js';import{decodeFieldOp}from'../../src/compiler/field.js';import{GameSession}from'../../src/core/game-session.js';import{GameFlow}from'../../src/core/game-flow.js';import{WEB_FIELD_SCREEN_PRESENTATION}from'../../src/core/field-screen-presentation.js';import type{Op,Site}from'../../src/field/types.js';
type Instruction<T=Op>=T extends Site?Omit<T,keyof Site>:never;
export const screenHost={visible:true,mediaReady:true,overlayOpen:false},screenSource={file:'tests/fixtures/screen-presentation.ts',assetPath:'authored/screen-presentation'};
export const screenRaw=(mnemonic:string,integers:number[]=[],reals:number[]=[],selector='')=>({type:1,mnemonic,operands:{iValues:Array.from({length:8},(_,i)=>integers[i]??0),rValues:Array.from({length:8},(_,i)=>reals[i]??0),sValues:[selector,...Array(7).fill('')]}});
export function screenOp(raw:ReturnType<typeof screenRaw>){return decodeFieldOp(raw,{script:'screen-decoder',index:0,source:screenSource},{});}
export async function screenPresentationFixture(options:{policy?:boolean;declared?:boolean;entryTasks?:boolean;lateFailure?:boolean;actual?:ReturnType<typeof screenRaw>}={}){
 const f=await worldAutoMoveFixture(),map=structuredClone(f.map),target=structuredClone(f.worldMap),world=structuredClone(f.world);
 const sourceMap=sealBatchContent({...f.sourceMap,parentSourceSetHash:'b'.repeat(64)}),sourceEntry=sealBatchContent({...f.sourceEntry,parentSourceSetHash:'b'.repeat(64),mapContentHash:sourceMap.contentHash});
 for(const m of [map,target,world]){m.parentSourceSetHash='b'.repeat(64);Object.assign(m.developmentProfile!,{storyRuntime:'web-field-story-runtime-v1',autoSave:'web-field-autosave-barrier-v1'});if(options.declared!==false)m.developmentProfile!.screenPresentation=WEB_FIELD_SCREEN_PRESENTATION;}
 const install=(m:typeof map,name:string,values:Instruction[])=>{m.scripts[name]=values.map((v,index)=>({...v,script:name,index,source:screenSource}as Op));m.scriptPuppetContexts![name]=structuredClone(map.scriptPuppetContexts!.auto!);m.scriptLocals![name]=null;m.scriptSystemFlags![name]={keepBadStatusVisual:false};m.scriptTransitionMetadata![name]={customAnimations:'none'};};
 for(const m of [map,target]){
  install(m,'screen',[screenOp(options.actual??screenRaw('ScreenEffect',[1,0,12,9],[.05])),{kind:'exit'}]);
  install(m,'screen-long',[screenOp(screenRaw('ScreenEffect',[3,0],[1])),{kind:'exit'}]);
  install(m,'screen-monochrome',[screenOp(screenRaw('SysCall',[],[],'モノクロフィルターかける')),{kind:'exit'}]);
  install(m,'screen-clear-monochrome',[screenOp(screenRaw('SysCall',[],[],'モノクロフィルターはずす')),{kind:'exit'}]);
  for(const [name,selector]of [['screen-start','セピア中めまい開始'],['screen-stop','セピア中めまい終了'],['screen-playing','セピア中めまい再生中']]as const)install(m,name,[screenOp(screenRaw('SysCall',[],[],selector)),{kind:'exit'}]);
  install(m,'screen-backdrop',[screenOp(screenRaw('BackdropColor',[151,72,57,255],[.03])),{kind:'calc',left:{category:'MapLocalVariable',index:5},operator:'＋',right:{kind:'immediate',value:1}},{kind:'exit'}]);
  install(m,'screen-fight',[screenOp(screenRaw('ScreenEffect',[3,0],[1])),{kind:'encounter',party:f.encounterId,continuation:'screen-return'},{kind:'exit'}]);install(m,'screen-return',[{kind:'exit'}]);
 }
 if(options.entryTasks){const original=target.scripts[target.initializer!]!.map(({script,index,source,...op})=>op);install(target,target.initializer!,[screenOp(screenRaw('ScreenEffect',[1,0],[.05])),screenOp(screenRaw('SysCall',[],[],'モノクロフィルターかける')),...original]);
  if(options.lateFailure){const body=target.scripts[target.initializer!]!;body.splice(body.findIndex(op=>op.kind==='exit'),1,{kind:'blocked',mnemonic:'AuthoredScreenEntryFailure',reason:'Authored failure after private screen and inventory requests',script:target.initializer!,index:9,source:screenSource});}
 }
 const pinnedMap=sealBatchContent(map),pinnedTarget=sealBatchContent(target);for(const m of [pinnedMap,pinnedTarget])world.maps[m.mapId]!.contentHash=m.contentHash;const catalog=sealBatchContent(world),content=await compileFrameworkNewGame({sourceEntry,sourceBattle:f.sourceBattle,sourceMap,world:catalog,map:pinnedMap,battle:f.battle,entrance:pinnedMap.partyEntry!.pointIns[0]!.id}),runtime={...f.runtime,...(options.policy===false?{}:{screenPresentation:WEB_FIELD_SCREEN_PRESENTATION})};
 const make=async()=>{const game=await GameSession.prepareFrameworkNewGame(content,catalog,pinnedMap,f.battle,runtime),flow=new GameFlow(game);flow.start();flow.advance(10,screenHost);return{game,flow};};
 const restore=(saved:Parameters<typeof GameSession.restore>[0],ports=runtime)=>GameSession.restore(saved,undefined,f.battle,{catalog,map:saved.world.location?.mapId===pinnedTarget.mapId?pinnedTarget:pinnedMap,initialized:{content,initialMap:pinnedMap}},ports);
 return{...f,map:pinnedMap,worldMap:pinnedTarget,world:catalog,content,runtime,make,restore};
}
