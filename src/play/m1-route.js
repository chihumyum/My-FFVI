import { isMapExit } from './navigation.js';
export function pathTo(game,target){
 const start=[Math.round(game.player.x),Math.round(game.player.y),game.player.layer],cacheKey=`${game.mapId}:${target.id}:${target.x},${target.y},${target.layer}:${target.allowedDirections||''}:${!!target.approach}:${[...game.groups]}:${game.history.length}`;
 const cache=game.walkCache;if(cache?.key===cacheKey){const n=cache.cells.findIndex(cell=>cell.join(',')===start.join(','));if(n>=0)return cache.route.slice(n);}
 const isWarp=e=>e.kind===2&&isMapExit(game,e);
 const actualEntities=game.entities.map(e=>({...e,...game.actors?.get(String(e.id))})).filter(e=>e.visible!==false);
 const blocked=new Set(actualEntities.filter(e=>(e.kind===3||isWarp(e))&&e.id!==target.id).map(e=>`${e.x},${e.y},${e.layer}`)),changes=new Map(actualEntities.filter(e=>e.kind===4).map(e=>[`${e.x},${e.y},${e.layer}`,e.destinationLayer]));
 const approach=target.approach||[5,6,8].includes(target.kind);
 if(approach)blocked.add(`${target.x},${target.y},${target.layer}`);
 const q=[start],seen=new Set([start.join(',')]),parent=new Map();let found;
 for(let n=0;n<q.length&&n<100000;n++){
  const [x,y,layer]=q[n],direction=target.y>y?'down':target.y<y?'up':target.x>x?'right':'left';if((!target.layer||layer===target.layer)&&(approach?(target.approach?Math.abs(x-target.x)+Math.abs(y-target.y)===1:game.interactionDistance(target,x,y,layer)>0)&&(!target.allowedDirections||target.allowedDirections.includes(direction)):Math.abs(x-target.x)<.6&&Math.abs(y-target.y)<.6)){found=q[n];break;}
  for(const[d,dx,dy]of[['up',0,-1],['right',1,0],['down',0,1],['left',-1,0]]){
   const nx=x+dx,ny=y+dy;if(!game.canMove(nx,ny,layer))continue;
   if(blocked.has(`${nx},${ny},${layer}`))continue;
   const nl=changes.get(`${nx},${ny},${layer}`)||layer,key=[nx,ny,nl].join(',');if(seen.has(key))continue;
   seen.add(key);parent.set(key,{from:q[n],dir:d});q.push([nx,ny,nl]);
  }
 }
 if(!found)return null;const route=[],cells=[found];while(found.join(',')!==start.join(',')){const p=parent.get(found.join(','));if(!p)return null;route.push(p.dir);found=p.from;cells.push(found);}route.reverse();cells.reverse();game.walkCache={key:cacheKey,route,cells};return route;
}



export function targetForM1(game){
 const played=name=>game.history.some(h=>h.script===name);
 const exitTo=id=>game.entities.find(e=>e.kind===3&&e.destination?.mapId===id);
 const eventNamed=name=>game.entities.find(e=>e.script===name);
 if(game.mapId===3){if(played('sc_e_0018_5'))return game.entities.filter(e=>e.script==='sc_e_0001_0').sort((a,b)=>Math.abs(a.x-game.player.x)-Math.abs(b.x-game.player.x))[0];return exitTo(played('sc_e_0013')?317:18);}
 if(game.mapId===18)return exitTo(323);
 if(game.mapId===323){if(!played('sc_e_0010'))return eventNamed('sc_e_0010');if(!played('sc_e_0011'))return eventNamed('sc_e_0011');return exitTo(324);}
 if(game.mapId===324)return eventNamed('sc_e_0012');
 if(game.mapId===318&&game.rts?.active)return eventNamed('sc_e_0018');
 if(game.mapId===17)return played('sc_e_0013_2')?game.entities.find(e=>e.kind===3&&e.destination?.mapId===3&&e.destination.entrance===13):eventNamed('sc_e_0013');
 return game.entities.find(e=>e.kind===2&&e.script&&/^sc_e_00[01]/.test(e.script)&&!played(e.script));
}
export function advanceM1(game){
 if(game.over)return {status:'game-over'};
 if(game.busy)return {status:'busy'};
 if(game.mapId===1)return {status:!game.fade||game.time-game.fade.start>game.fade.duration?'done':'busy'};
 if(game.rts?.active){
  const health=slot=>slot.reduce((n,id)=>n+game.unit(id).hp,0)/Math.max(1,slot.reduce((n,id)=>n+game.unit(id).maxHp,0));
  const best=game.partySlots.reduce((a,slot,n)=>health(slot)>health(game.partySlots[a])?n:a,game.partyIndex);
  if(best!==game.partyIndex&&health(game.partySlots[game.partyIndex])<.6){while(game.partyIndex!==best)game.switchParty();return {status:'party',party:best};}
 }
 const target=targetForM1(game);if(!target)return {status:'no-input'};
 const route=pathTo(game,target);if(!route)return {status:'no-route',target};
 if(route.length){game.move(route[0]);return {status:'walk',target};}
 game.checkTriggers();if(!game.busy){const dx=target.x-game.player.x,dy=target.y-game.player.y;game.player.direction=Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up';game.confirm();}
 return {status:'interact',target};
}
