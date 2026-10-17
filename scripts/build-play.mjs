import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {recoverSourceMap} from './play-source-map.mjs';
const root=resolve(import.meta.dirname,'..');
const read=async p=>JSON.parse(await readFile(resolve(root,p),'utf8'));
const npcBundles=new Map();
function sourceBundle(source){
 const file=source.file.split('/').pop().replace(/\.bundle$/,'.json');
 if(!npcBundles.has(file))npcBundles.set(file,read('build/corpus/bundles/'+file));
 return npcBundles.get(file);
}
export async function addNpcFlags(map){
 map.routes={};
 if(map.source?.file){
  const prefix=map.source.assetPath.slice(0,map.source.assetPath.lastIndexOf('/')+1);
  for(const asset of await sourceBundle(map.source)){
   if(!asset.source.assetPath.startsWith(prefix))continue;
   const match=asset.source.assetPath.match(/\/route_instruction_(\d+)\.json$/);
   if(match)map.routes[match[1]]=asset.data.instruction_list||[];
  }
 }
 for(const entity of [...map.entities||[],...Object.values(map.groups||{}).flatMap(group=>group.entities||[])]){
  if(entity.npc)entity.npc.interaction={...entity.npc.interaction,actionId:0,productGroup:0};
  if((!entity.npc&&![9,30].includes(entity.kind))||!entity.source?.pointer)continue;
  const source=entity.source,assets=await sourceBundle(source),asset=assets.find(item=>item.source.assetPath===source.assetPath);
  const object=source.pointer.split('/').filter(Boolean).reduce((value,key)=>value?.[key],asset?.data);
  const props=Object.fromEntries((object?.properties||[]).map(row=>[row.name,row.value]));
  if(entity.npc){entity.npc.allLayers=props.all_layers===true;entity.npc.birdview=props.birdview_puppet===true;Object.assign(entity.npc.interaction,{actionId:Number(props.action_id)||0,productGroup:Number(props.product_group_id)||0});}
  if(entity.kind===30){entity.leaveScriptId=props.leave_script_id||0;entity.actionId=props.action_id||0;}
  if(entity.kind===9)entity.savePoint={actionId:Number(props.action_id)||0,visible:object?.visible!==false};
 }
}
const omit=new Set(['source','sources','contentHash','sha256','blockers','limitations','rawHash','parentSourceSetHash','sourceSetHash']);
function clean(v){if(Array.isArray(v))return v.map(clean);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!omit.has(k)&&!k.endsWith('Blockers')).map(([k,x])=>[k,clean(x)]));return v;}
export async function preparePlayMap(id,{force=false}={}){
 const out=resolve(root,`build/play/maps/${id}.json`);
 if(!force){try{const old=JSON.parse(await readFile(out,'utf8'));const entities=[...old.entities||[],...Object.values(old.groups||{}).flatMap(g=>g.entities||[])];if(old.routes&&(old.layers?.length||old.entities?.length)&&entities.every(e=>(!e.npc||typeof e.npc.allLayers==='boolean'&&'actionId'in(e.npc.interaction||{}))&&(e.kind!==30||'leaveScriptId'in e)&&(e.kind!==9||e.savePoint)))return out;}catch{}}
 const src=await read(`build/world/maps/${id}.json`);
 const map=src.map||await recoverSourceMap(src)||{width:64,height:64,tileSize:16,layers:[],tilesets:[],textures:{},collisions:{},entities:[],groups:{}};await addNpcFlags(map);const value=clean({id:Number(id),name:src.name,areaId:src.areaId,initializer:src.initializer,...map});value.id=Number(id);
 await mkdir(resolve(root,'build/play/maps'),{recursive:true});await writeFile(out,JSON.stringify(value));return out;
}
export async function buildPlay(mapIds=[609,3]){
 await mkdir(resolve(root,'build/play'),{recursive:true});
 const [story,world,text,field,tables,media]=await Promise.all([read('build/story-corpus/corpus.json'),read('build/world/catalog.json'),read('build/corpus/messages.json'),read('build/field/field.json'),read('build/corpus/tables.json'),read('build/source-sprite-media/media.json')]);
 const programs={},byMap={},global={},mnemonics=new Set();let k=0;
 for(const item of story.scripts){const raw=item.raw,name=item.source.assetPath.split('/').pop().replace('.json',''),id=String(k++);
  programs[id]={name,title:raw.Title?.main||'',locals:raw.ScriptLocalValue||[],segments:raw.Segments||[],ops:(raw.Mnemonics||[]).map(m=>{mnemonics.add(m.mnemonic);return[m.mnemonic,m.operands?.iValues||[],m.operands?.rValues||[],m.operands?.sValues||[],m.type||1,m.label||''];})};
  global[name]??=id;for(const map of item.maps||[])(byMap[map]??={})[name]=id;
 }
 const messages=Object.assign({},...Object.values(field.messages).map(v=>v.values||{}),text.story_mes_zhc.values);
 const speakers=text.story_cha_zhc.values;
 const characters=clean(media.characters||world.characters);
 for(const char of Object.values(characters))for(const sprite of Object.values(char.sprites||{}))if(sprite.file){sprite.file=sprite.file.startsWith('/')?sprite.file.replace('/world-media/','/source-media/'):'/source-media/'+sprite.file;}
 const systemTables=Object.fromEntries(['product','content','function_group','character_status','job','learning','transportation','transportation_group','landing_group','product_group'].map(name=>[name.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),tables[name+'.csv']||[]]));
 const data={systemTables,entry:{mapId:609,entrance:1,script:'sc_e_0001'},programs,byMap,global,messages,speakers,characters,
  maps:Object.fromEntries(Object.entries(world.maps).map(([id,m])=>[id,{name:m.name}])),
  audio:clean({bgm:world.bgm,se:world.se,environment:world.environment}),
  init:tables['initialize_data.csv'],scriptIds:Object.fromEntries(tables['script.csv'].map(r=>[r.id,r.script_name])),
  fieldAssets:Object.fromEntries(tables['field_character_asset.csv'].map(r=>[r.id,r])),
  mapTitles:Object.fromEntries(tables['map.csv'].map(r=>[r.id,r.map_title])),mnemonics:[...mnemonics].sort()};
 await writeFile(resolve(root,'build/play/data.json'),JSON.stringify(data));
 for(const id of mapIds)await preparePlayMap(id,{force:true});
 console.log(`Play data ready: ${programs?Object.keys(programs).length:0} programs; maps ${mapIds.join(',')}`);
 return data;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)await buildPlay(process.argv.slice(2).length?process.argv.slice(2).map(Number):undefined);
