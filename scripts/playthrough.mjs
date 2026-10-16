import{readFile,writeFile}from'node:fs/promises';import{PlayGame}from'../src/play/game.js';import{Battle}from'../src/play/battle.js';import{preparePlayMap}from'./build-play.mjs';import{advanceM1}from'../src/play/m1-route.js';
const data=JSON.parse(await readFile('build/play/data.json')),battleData=JSON.parse(await readFile('build/play/battle.json'));let last='';const events=[];
const game=new PlayGame({data,battleData,Battle,testBoost:process.env.PLAY_TEST_BOOST!=='0',random:()=>.35,loadMap:async id=>JSON.parse(await readFile(await preparePlayMap(id))),onEvent:e=>{if(['script','map','battle','battle-end'].includes(e.kind)){events.push(e);if(e.kind==='script'&&last!==e.script){console.log(`${Math.floor(e.time)}s map${e.mapId} ${e.script} ${e.scene}`);last=e.script;}}}});
await game.start();let idle=0,stop='time-budget',targetKey='';
for(let tick=0;tick<Number(process.env.TICKS||90000);tick++){
 game.tick(.1,{auto:true});if(game.loading)await game.pending;
 if(game.mapId===1&&!game.busy&&(!game.fade||game.time-game.fade.start>game.fade.duration)){stop='M1-world-map';break;}
 const input=advanceM1(game);
 if(input.target){const key=`${game.mapId}:${input.target.id}`;if(key!==targetKey){console.log('walk',game.mapId,input.target.script||input.target.destination,input.target.x,input.target.y);targetKey=key;}}
 if(['no-route','no-input','interact','game-over'].includes(input.status)){if(++idle>20){stop=input.status;break;}}else idle=0;

}
const result={mode:game.testBoost?'story-test':'normal',stop,furthest:game.furthest,mapId:game.mapId,player:game.player,lastInstruction:game.lastInstruction,time:game.time,history:game.history,battles:game.battles,partySlots:game.partySlots,party:game.party,warnings:game.warnings,tasks:game.tasks.map(t=>({script:data.programs[t.program].name,index:t.pc,waitFor:t.waitFor,wait:t.wait})),groups:[...game.groups],events};
await writeFile('build/play/playthrough.json',JSON.stringify(result,null,2));console.log(JSON.stringify({mode:result.mode,stop,mapId:game.mapId,furthest:game.furthest,battles:game.battles.map(b=>[b.encounterId,b.outcome]),time:game.time,position:[game.player.x,game.player.y],tasks:result.tasks},null,2));
