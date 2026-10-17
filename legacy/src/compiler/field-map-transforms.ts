import { record,hash } from "./content.js";
import { loadCorpus } from "./corpus.js";
import { bindMapPackages } from "./map-package.js";
import { parseFieldMapTransform,validateFieldWaterCatalog,waterLayerNames,type FieldMapTransformOp,type FieldMapTransformCommand,type FieldWaterCatalog } from "../core/field-map-transforms.js";
import type { Evidence } from "../field/types.js";
export function compileFieldMapTransform(raw:unknown):FieldMapTransformOp{
  const m=record(raw),o=record(m.operands),i=o.iValues as number[],r=o.rValues as number[],s=o.sValues as string[];
  if(![i,r,s].every(a=>Array.isArray(a)&&a.length===8)||i.some(v=>!Number.isInteger(v)||v< -2147483648||v>2147483647)||r.some(v=>typeof v!=="number"||!Number.isFinite(v))||s.some(v=>typeof v!=="string"))throw Error("Invalid complete map-transform operands");
  const shape=(type:number,ii:number[],rr:number[],ss:number[])=>{if(m.type!==type||i.some((v,n)=>!ii.includes(n)&&v!==0)||r.some((v,n)=>!rr.includes(n)&&v!==0)||s.some((v,n)=>!ss.includes(n)&&v!==""))throw Error("Unsupported source map-transform operand form");};
  let c:FieldMapTransformCommand;
  if(m.mnemonic==="Orient"){shape(2,[0],[],[]);c={kind:"orient",target:i[0]!};}
  else if(m.mnemonic==="ChangeMapRenderArea"){shape(1,[0],[0,1,2,3,4],[]);if(![0,1].includes(i[0]!))throw Error("Unknown source render-area target");c={kind:"render-area",target:i[0] as 0|1,from:r[0]!,to:r[1]!,seconds:r[2]!,heightFrom:r[3]!,heightTo:r[4]!};}
  else if(m.mnemonic==="Water"){shape(1,[0],[0,1,2],[0]);c={kind:"water",target:i[0]!,key:s[0] as Extract<FieldMapTransformCommand,{kind:"water"}>["key"],from:r[0]!,to:r[1]!,seconds:r[2]!};}
  else throw Error("Unknown source map-transform instruction");return{kind:"field-map-transform",command:parseFieldMapTransform(c)};
}
const list=(v:unknown):unknown[]=>{if(!Array.isArray(v))throw Error("Missing complete source water list");return v;};
export function compileFieldWaterCatalog(input:{tilemap:{data:unknown;source:Evidence&{sha256:string;serializedFile:string}};sourceSetHash:string;parentSourceSetHash:string}):FieldWaterCatalog{
  const m=record(input.tilemap.data),result:FieldWaterCatalog={kind:"source-flat-water-groups-v1",sourceSetHash:input.sourceSetHash,parentSourceSetHash:input.parentSourceSetHash,source:structuredClone(input.tilemap.source),rawHash:hash(m),groupOpacity:1,layers:[],properties:{},unresolved:[]};
  const groups=list(m.layers).map(record).filter(l=>l.name==="WaterGroup");
  if(groups.length>1)result.unresolved.push("Ambiguous source WaterGroup identity");
  for(const g of groups){
    if(g.type!=="group"||g.visible!==true||(typeof g.opacity!=="number"||g.opacity<0||g.opacity>1)||[g.x??0,g.y??0,g.offsetx??0,g.offsety??0].some(n=>n!==0))result.unresolved.push("Unsupported source WaterGroup transform");
    result.groupOpacity=Number(g.opacity);
    const supported=new Set(["reflection_intensity","noise_aspect_ratio","noise_speed","noise_magnification","use_custom_water_color","custom_water_color","base_color_brightness","water_blend_ratio","base_color_saturation","falling_speed","highlight_intensity","condensing_pattern_color","condensing_pattern_intensity","condensing_pattern_scale","condensing_pattern_speed","highlight_cutoff_threshold","normal_map_scroll_speed_x","normal_map_scroll_speed_y","normal_map_speed_scale","bottom_unified_water_depth_alpha","bottom_water_depth_level","ground__water_depth_level","water_depth_level"]);
    for(const p of list(g.properties??[]).map(record)){
      if(typeof p.name!=="string"||!supported.has(p.name)||Object.hasOwn(result.properties,p.name)||!["float","int","color","bool"].includes(String(p.type))||!["number","string","boolean"].includes(typeof p.value))result.unresolved.push("Unknown source water property");else result.properties[p.name]=p.value as string|number|boolean;
    }
    for(const l of list(g.layers).map(record)){
      const properties:Record<string,string|number|boolean>={};for(const p of list(l.properties??[]).map(record)){if(typeof p.name!=="string"||!["number","boolean","string"].includes(typeof p.value)||Object.hasOwn(properties,p.name))result.unresolved.push("Unknown source water layer property");else properties[p.name]=p.value as string|number|boolean;}
      if(Object.keys(properties).length)result.unresolved.push("Independent per-layer water material is unresolved");
      if(l.type!=="tilelayer"||!(waterLayerNames as readonly unknown[]).includes(l.name)||l.width!==m.width||l.height!==m.height||[l.x??0,l.y??0,l.offsetx??0,l.offsety??0].some(n=>n!==0)||list(l.data).length!==Number(m.width)*Number(m.height))result.unresolved.push("Unsupported source water tile geometry");
      else result.layers.push({name:String(l.name),id:Number(l.id),width:Number(l.width),height:Number(l.height),data:[...l.data as number[]],opacity:Number(g.opacity)*Number(l.opacity),sourceOpacity:Number(l.opacity),visible:l.visible===true,properties});
    }
  }
  validateFieldWaterCatalog(result);return result;
}
export type FieldWaterWorldCatalog={kind:"source-flat-water-world-v1";sourceSetHash:string;parentSourceSetHash:string;maps:Record<string,FieldWaterCatalog>;contentHash:string};
export async function loadFieldWaterWorldCatalog(root:string):Promise<FieldWaterWorldCatalog>{
  const c=await loadCorpus(root),assets=new Map(c.assets.map(a=>[a.id,a])),maps:Record<string,FieldWaterCatalog>={};
  for(const binding of bindMapPackages(c.assets,c.tables)){const tile=assets.get(binding.tilemap??"");if(tile){if(!tile.source.sha256||!tile.source.objectId)throw Error("Unbound physical water tile source");maps[binding.id]=compileFieldWaterCatalog({tilemap:{data:tile.data,source:{...tile.source,objectId:tile.source.objectId,sha256:tile.source.sha256,serializedFile:tile.source.serializedFile}},sourceSetHash:c.sourceSetHash,parentSourceSetHash:String(c.manifest.parentSourceSetHash)});}}
  const body={kind:"source-flat-water-world-v1" as const,sourceSetHash:c.sourceSetHash,parentSourceSetHash:String(c.manifest.parentSourceSetHash),maps};return{...body,contentHash:hash(body)};
}
export function verifyFieldWaterWorldCatalog(c:FieldWaterWorldCatalog):void{const{contentHash,...body}=c;if(c.kind!=="source-flat-water-world-v1"||hash(body)!==contentHash)throw Error("Invalid water world catalog identity");for(const [id,m]of Object.entries(c.maps)){if(!/^[1-9]\d*$/.test(id)||m.sourceSetHash!==c.sourceSetHash||m.parentSourceSetHash!==c.parentSourceSetHash)throw Error("Foreign water map source");validateFieldWaterCatalog(m);}}
