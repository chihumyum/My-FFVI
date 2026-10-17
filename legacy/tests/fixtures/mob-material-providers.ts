import { worldTransportSessionFixture } from './world-transport-session.js';
import { logicalEffectCatalog } from './logical-field-effects.js';
import { sealBatchContent } from './content-batch.js';
import { compileFrameworkNewGame } from '../../src/compiler/framework-new-game.js';
import { GameSession } from '../../src/core/game-session.js';
import { GameFlow } from '../../src/core/game-flow.js';
import { WEB_FLAT_MOB_COLOR_FILTER } from '../../src/core/field-mob-controls.js';
import { WEB_LOGICAL_FIELD_EFFECTS, createWebLogicalFieldEffectsHost } from '../../src/core/field-logical-effects.js';
import { decodeFieldOp } from '../../src/compiler/field.js';
import { mobRaw, mobHost } from './mob-controls.js';
import type { FieldEntity, Op, Site } from '../../src/field/types.js';
type Instruction<T> = T extends Site ? Omit<T,keyof Site> : never;
/** All original fixture dependencies are declared before actual initialization.
 * Riding is performed by the existing VM/transport owner, never actor mutation. */
export async function mobMaterialProvidersFixture(options:{effects?:boolean;armor?:boolean}={}){
 const f=await worldTransportSessionFixture(),maps=[structuredClone(f.map),structuredClone(f.worldMap)],world=structuredClone(f.world),
  fx=logicalEffectCatalog(f.map.sourceSetHash,f.map.parentSourceSetHash),source={file:'tests/fixtures/mob-material-providers.ts',assetPath:'authored/mob-material-providers'};
 for(const [asset,character]of Object.entries(world.characters))for(const [key,sprite]of Object.entries(character.sprites))sprite.file='/authored-mob-material/'+asset+'/'+key+'.png';
 for(const map of maps){
  map.developmentProfile!.mobColorFilter=WEB_FLAT_MOB_COLOR_FILTER;
  const base=structuredClone(Object.values(map.scriptPuppetContexts!)[0]!);
  const add=(name:string,ops:Instruction<Op>[])=>{map.scripts[name]=ops.map((op,index)=>({...op,script:name,index,source})) as Op[];
   map.scriptPuppetContexts![name]={...base,skipInitialize:true,keepPlayerPuppet:true,scriptHash:'e'.repeat(64)};
   (map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};(map.scriptLocals??={})[name]=null;};
  for(const [name,raw]of [['mob-hide',mobRaw('HideMob')],['mob-restore',mobRaw('RestoreMob')],['mob-darken',mobRaw('HideMob',[],.1)]]as const){
   const op=decodeFieldOp(raw,{script:name,index:0,source},{});if(op.kind!=='field-mob-control')throw Error('Authored Mob decode failed');add(name,[op,{kind:'exit'}]);
  }
  add('mob-npc-during',[{kind:'puppet',slot:0,actor:'-1001',target:7},{kind:'exec-puppets',asynchronous:true},
   {kind:'wait',seconds:.03},{kind:'field-mob-control',command:{kind:'hide',exemptions:[],durationSeconds:0}},{kind:'wait',seconds:.05},
   {kind:'field-mob-control',command:{kind:'restore',durationSeconds:0}},{kind:'exit'},{kind:'nop'},
   {kind:'actor-visibility',visible:true},{kind:'wait',seconds:1},{kind:'exit'}]);
  map.scriptPuppetContexts!['mob-npc-during']={...map.scriptPuppetContexts!['mob-npc-during']!,skipInitialize:false,keepPlayerPuppet:false,ridingVehicle:true};
  add('mount-npc',[{kind:'field-transportation',command:{kind:'ride-npc',transportationId:6,actorSelector:-1001}},{kind:'exit'}]);
  if(options.effects){
   map.developmentProfile!.logicalFieldEffects=WEB_LOGICAL_FIELD_EFFECTS;map.fieldEffects=structuredClone(fx.catalog);
   const evidence={...source,pointer:'/controlled-effect/404'},board:FieldEntity={id:'404',kind:11,objectId:0,layer:0,x:2,y:2,width:1,height:1,
    direction:'down',asset:null,script:null,collision:null,destinationLayer:null,source:evidence,effect:{...structuredClone(fx.definition),source:evidence}};
   map.map!.entities.push(board);map.map!.groups!.entity_default!.entities.push(structuredClone(board));
  }
 }
 world.developmentProfile!.mobColorFilter=WEB_FLAT_MOB_COLOR_FILTER;
 if(options.effects)world.developmentProfile!.logicalFieldEffects=WEB_LOGICAL_FIELD_EFFECTS;
 const [map,worldMap]=maps.map(sealBatchContent);for(const m of [map!,worldMap!])world.maps[m.mapId]!.contentHash=m.contentHash;
 const catalog=sealBatchContent(world),content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,
  world:catalog,map:map!,battle:f.battle,entrance:map!.partyEntry!.pointIns[0]!.id}),
  runtime={...f.runtime,mobColorFilter:WEB_FLAT_MOB_COLOR_FILTER,...(options.effects?{fieldEffects:createWebLogicalFieldEffectsHost()}:{})};
 const make=async()=>{const game=await GameSession.prepareFrameworkNewGame(content,catalog,map!,f.battle,runtime),flow=new GameFlow(game);
  flow.start(game);flow.observeHost(mobHost);flow.advance(10,mobHost);
  if(options.armor!==false){if(!game.field.startEvent('board'))throw Error('Board event unavailable');flow.advance(10,mobHost);if(game.field.stop)throw Error(game.field.stop.message);}
  return{game,flow};};
 const restore=(saved:Parameters<typeof GameSession.restore>[0])=>GameSession.restore(saved,undefined,f.battle,{catalog,
  map:saved.world.location?.mapId===worldMap!.mapId?worldMap!:map!,initialized:{content,initialMap:map!}},runtime);
 return{...f,map:map!,worldMap:worldMap!,world:catalog,content,runtime,make,restore};
}
