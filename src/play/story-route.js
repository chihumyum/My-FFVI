import {advanceM1,pathTo} from './m1-route.js';
const scene = n => `sc_e_${String(n).padStart(4,'0')}`;
// These are ordinary player objectives, not script invocations. The original scripts own all plot state.
export const chapters = [{id:'M2',name:'费加罗、科尔兹山、回归者与雷特河',scenes:[24,26,28,29,32,33,35,36,38,54,56,57,58,59,60,61,62,63].map(scene),end:'sc_e_0063_15'}];
const distanceCaches=new WeakMap();
function distanceToMaps(navigation,targets){
 const cache=distanceCaches.get(navigation)||new Map(),key=targets.join(',');distanceCaches.set(navigation,cache);if(cache.has(key))return cache.get(key);
 const reverse=new Map();for(const m of Object.values(navigation.maps))for(const e of m.entries)if(e.destination){const list=reverse.get(e.destination.mapId)||[];list.push(+m.id);reverse.set(e.destination.mapId,list);}
 const distances=new Map(targets.map(id=>[+id,0])),q=[...distances.keys()];for(let n=0;n<q.length;n++)for(const from of reverse.get(q[n])||[])if(!distances.has(from)){distances.set(from,distances.get(q[n])+1);q.push(from);}cache.set(key,distances);return distances;
}
export function findStoryTarget(game,script){
 const nav=game.data.navigation;if(!nav)return {status:'no-navigation'};
 const active=game.entities.filter(e=>e.script===script);for(const entry of active){const actor=game.actors.get(String(entry.id)),target=actor?{...entry,x:actor.x,y:actor.y}:entry;if(actor?.visible===false)continue;const route=pathTo(game,target);if(route)return {status:'target',target,route};}
 const maps=Object.values(nav.maps).filter(m=>m.entries.some(e=>e.script===script)).map(m=>m.id);
 if(maps.includes(game.mapId))return {status:'inactive-target',script,maps};
 const possibleExits=game.entities.flatMap(e=>e.destination?[e]:(nav.maps[game.mapId]?.entries||[]).filter(n=>n.id===e.id&&n.destination&&n.script===e.script).map(n=>({...e,destination:n.destination})));
 const distances=distanceToMaps(nav,maps),exits=possibleExits.filter(e=>e.destination&&distances.has(e.destination.mapId)).sort((a,b)=>distances.get(a.destination.mapId)-distances.get(b.destination.mapId)||Math.abs(a.x-game.player.x)+Math.abs(a.y-game.player.y)-Math.abs(b.x-game.player.x)-Math.abs(b.y-game.player.y));
 for(const target of exits){const route=pathTo(game,target);if(route)return {status:'target',target,route};}
 return {status:'no-route',script,maps};
}
export function followTarget(game,input){
 if(input.route?.length){game.move(input.route[0]);return {...input,status:'walk'};}
 if(!input.target)return input;game.checkTriggers();if(!game.busy){const dx=input.target.x-game.player.x,dy=input.target.y-game.player.y;game.player.direction=Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up';game.confirm();}return {...input,status:'interact'};
}
export function advanceStory(game,{through='all'}={}){
 if(game.over)return {status:'game-over'};if(game.busy)return {status:'busy'};
 const played=script=>game.history.some(h=>h.script===script);
 if(!played('sc_e_0001_0')||through==='M1')return advanceM1(game);
 const state=game.banks.PlayRoute??={chapter:0,index:0};
 const chapter=chapters[state.chapter];if(!chapter)return {status:'plan-end'};
 if(played(chapter.end)){if(through===chapter.id)return {status:'done',chapter:chapter.id};state.chapter++;state.index=0;return {status:'checkpoint',chapter:chapter.id};}
 while(state.index<chapter.scenes.length&&played(chapter.scenes[state.index]))state.index++;
 if(state.index===chapter.scenes.length)return {status:'needs-input',chapter:chapter.id,script:chapter.end};
 const script=chapter.scenes[state.index],input=findStoryTarget(game,script);return {...followTarget(game,input),objective:script,chapter:chapter.id};
}
