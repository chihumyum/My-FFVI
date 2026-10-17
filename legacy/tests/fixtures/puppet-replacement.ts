import { worldLoopSessionFixture } from './world-loop-session.js';
import { sealBatchContent } from './content-batch.js';
import { compileFrameworkNewGame } from '../../src/compiler/framework-new-game.js';
import { GameSession } from '../../src/core/game-session.js';
import { GameFlow } from '../../src/core/game-flow.js';
import { mobHost } from './mob-controls.js';
import type { Op, Site } from '../../src/field/types.js';
import type { FieldPuppetReplacementCommand } from '../../src/core/field-puppet-replacement.js';
export { mobHost as puppetHost };
type Instruction<T> = T extends Site ? Omit<T,keyof Site> : never;
export function replacementRaw(suffix:string){return{type:1,mnemonic:'SysCall',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:['パペット入れ替え：'+suffix,...Array(7).fill('')]}};}
/** Authored source-style programs declared before initialization. Roster/Corps
 * writes use the same public GameState party transaction as the VM. */
export async function puppetReplacementFixture(options:{initializationFailure?:boolean}={}) {
 const f=await worldLoopSessionFixture(options),maps=[structuredClone(f.map),structuredClone(f.worldMap)],world=structuredClone(f.world),source={file:'tests/fixtures/puppet-replacement.ts',assetPath:'authored/puppet-replacement'};
 for(const map of maps){const context=structuredClone(Object.values(map.scriptPuppetContexts!)[0]!);
  const add=(name:string,ops:Instruction<Op>[],initialize=false)=>{map.scripts[name]=ops.map((op,index)=>({...op,script:name,index,source}))as Op[];
   map.scriptPuppetContexts![name]={...context,skipInitialize:!initialize,keepPlayerPuppet:!initialize,scriptHash:'f'.repeat(64)};
   (map.scriptLocals??={})[name]=null;(map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};};
  const selection=(name:string,command:FieldPuppetReplacementCommand)=>add(name,[{kind:'field-puppet-replacement',command},{kind:'exit'}]);
  selection('replace-slot2',{kind:'slot',slot:1,selection:'all'});selection('replace-slot3',{kind:'slot',slot:2,selection:'all'});
  selection('replace-leaders',{kind:'leaders'});selection('replace-battle',{kind:'battle-party'});selection('replace-reset',{kind:'reset'});
  add('exec-pair',[{kind:'puppet',slot:0,actor:'-1001',target:7},{kind:'puppet',slot:1,actor:'-1002',target:10},
   {kind:'wait',seconds:0},{kind:'exec-puppets',asynchronous:true},{kind:'wait',seconds:.2},{kind:'finish-puppets'},{kind:'exit'},
   {kind:'nop'},{kind:'wait',seconds:.1},{kind:'exit'},{kind:'nop'},{kind:'wait',seconds:.1},{kind:'exit'}],true);
  add('exec-sparse',[{kind:'puppet',slot:1,actor:'-1001',target:5},{kind:'wait',seconds:0},{kind:'exec-puppets',asynchronous:true},
   {kind:'wait',seconds:.2},{kind:'exit'},{kind:'nop'},{kind:'wait',seconds:.1},{kind:'exit'}],true);
  add('exec-first',[{kind:'puppet',slot:0,actor:'-1001',target:5},{kind:'wait',seconds:0},{kind:'exec-puppets',asynchronous:true},
   {kind:'wait',seconds:.2},{kind:'exit'},{kind:'nop'},{kind:'wait',seconds:.1},{kind:'exit'}],true);
 }
 const [map,worldMap]=maps.map(sealBatchContent);for(const m of [map!,worldMap!])world.maps[m.mapId]!.contentHash=m.contentHash;
 const sourceEntry=structuredClone(f.sourceEntry);
 sourceEntry.puppetCatalog.residents=f.sourceBattle.common.players.map(p=>({assetId:p.sourceId!,characterStatusId:p.sourceId!,isCorps:true}));
 const catalog=sealBatchContent(world),content=await compileFrameworkNewGame({sourceEntry:sealBatchContent(sourceEntry),sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,world:catalog,map:map!,battle:f.battle,entrance:map!.partyEntry!.pointIns[0]!.id}),runtime={battleHandoff:'prepared' as const};
 const make=async()=>{const game=await GameSession.prepareFrameworkNewGame(content,catalog,map!,f.battle,runtime),flow=new GameFlow(game);flow.start(game);flow.observeHost(mobHost);flow.advance(10,mobHost);return{game,flow};};
 const restore=(saved:Parameters<typeof GameSession.restore>[0])=>GameSession.restore(saved,undefined,f.battle,{catalog,map:saved.world.location?.mapId===worldMap!.mapId?worldMap!:map!,initialized:{content,initialMap:map!}},runtime);
 return{...f,map:map!,worldMap:worldMap!,world:catalog,content,runtime,make,restore};
}
