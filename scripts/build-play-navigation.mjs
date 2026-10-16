import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
export async function buildNavigation({force=false}={}){
 const output=resolve(root,'build/play/navigation.json');if(!force){try{await access(output);return output;}catch{}}
 const files=(await readdir(resolve(root,'build/world/maps'))).filter(f=>/^\d+\.json$/.test(f));const maps={};const data=JSON.parse(await readFile(resolve(root,'build/play/data.json'),'utf8'));
 function destinations(name,map,seen=new Set()){const id=data.byMap[map]?.[name]??data.global[name];if(id===undefined||seen.has(id))return [];seen.add(id);return(data.programs[id].ops||[]).flatMap(o=>o[0]==='ChangeMap'?[{mapId:o[1][0],entrance:o[1][1]}]:o[0]==='ChangeScript'?destinations(o[3][0],map,seen):[]);}
 for(let k=0;k<files.length;k+=8)await Promise.all(files.slice(k,k+8).map(async f=>{const raw=JSON.parse(await readFile(resolve(root,'build/world/maps',f),'utf8'));if(!raw.map){maps[raw.mapId]={id:raw.mapId,name:raw.name,initializer:raw.initializer,entries:[]};return;}const list=[];for(const[group,g]of Object.entries(raw.map.groups||{}))for(const e of g.entities||[])if(e.script||e.destination)list.push({id:e.id,kind:e.kind,layer:e.layer,x:e.x,y:e.y,script:e.script,destination:e.destination,group});for(const e of raw.map.entities||[])if((e.script||e.destination)&&!list.some(x=>x.id===e.id&&x.group==='entity_default'))list.push({id:e.id,kind:e.kind,layer:e.layer,x:e.x,y:e.y,script:e.script,destination:e.destination,group:'entity_default'});for(const entry of [...list])if(entry.script&&!entry.destination)for(const destination of destinations(entry.script,raw.mapId))list.push({...entry,destination});maps[raw.mapId]={id:raw.mapId,name:raw.name,initializer:raw.initializer,entries:list};}));
 await writeFile(output,JSON.stringify({maps}));console.log(`Navigation index: ${files.length} maps.`);return output;
}
if(process.argv[1]&&resolve(process.argv[1])===import.meta.filename)await buildNavigation({force:process.argv.includes('--force')});
