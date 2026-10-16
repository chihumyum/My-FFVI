import { defaultFieldWaterProperties } from "./field-actor-view.js";
import { canonical } from "./canonical.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import type { FieldContent, Direction, Evidence } from "../field/types.js";

/** Deliberate source-pixel Web projection. No native shader, virtual LookAt,
 * layer table, render-texture or perspective parity is inferred by this marker. */
export const WEB_FIELD_MAP_TRANSFORMS = "web-flat-field-map-transforms-v1" as const;
export type WebFieldMapTransforms = typeof WEB_FIELD_MAP_TRANSFORMS;
export const waterLayerNames = ["BottomWater", "GroundWater", "UpperWater", "CeilWater"] as const;
export const waterKeys = ["_WaterOffsetY", "_WaterColor:R", "_WaterColor:G", "_WaterColor:B", "_WaterColor:A",
  "_FluctuationMagnification", "_HighlightIntensity", "_CondensingPatternIntensity"] as const;
export type WaterKey = typeof waterKeys[number];
export type FieldWaterCatalog = { kind:"source-flat-water-groups-v1"; sourceSetHash:string; parentSourceSetHash:string;
  source:Evidence & {sha256:string;serializedFile:string}; rawHash:string; groupOpacity:number; layers:{name:string; id:number; width:number;height:number;data:number[];opacity:number; sourceOpacity:number;visible:boolean;properties:Record<string,string|number|boolean>}[];
  properties:Record<string,string|number|boolean>; unresolved:string[] };
export type FieldMapTransformCommand =
  | {kind:"orient"; target:number}
  | {kind:"render-area"; target:0|1; from:number; to:number; seconds:number; heightFrom:number; heightTo:number}
  | {kind:"water"; target:number; key:WaterKey; from:number; to:number; seconds:number};
export type FieldMapTransformOp={kind:"field-map-transform";command:FieldMapTransformCommand};
type Tween={from:number;to:number;elapsedMs:number;durationMs:number};
type WaterState={name:string; values:Record<WaterKey,number>; tweens:Partial<Record<WaterKey,Tween>>};
export type FieldMapTransformSnapshot={kind:"field-map-transforms-state-v1";policy:WebFieldMapTransforms;binding:string;
  areas:{target:0|1;scale:number;height:number}[];water:WaterState[];timeMs:number};
function finite(v:number):void{if(!Number.isFinite(v)||!Number.isFinite(Math.fround(v)))throw Error("Invalid map-transform number");}
export function parseFieldMapTransform(c:FieldMapTransformCommand):FieldMapTransformCommand{
  if(c.kind==="orient"){checkpointKeys(c,"kind,target");checkpointInteger(c.target,-2147483648,2147483647);}
  else if(c.kind==="render-area"){
    checkpointKeys(c,"kind,target,from,to,seconds,heightFrom,heightTo");if(c.target!==0&&c.target!==1)throw Error("Unknown render-area domain");
    [c.from,c.to,c.seconds,c.heightFrom,c.heightTo].forEach(finite);if(c.seconds<0||c.seconds>3600)throw Error("Invalid render-area duration");
  }else if(c.kind==="water"){
    checkpointKeys(c,"kind,target,key,from,to,seconds");checkpointInteger(c.target,-1,3);
    if(!(waterKeys as readonly string[]).includes(c.key))throw Error("Unknown Water source property consumer");
    [c.from,c.to,c.seconds].forEach(finite);if(c.seconds<0||c.seconds>3600)throw Error("Invalid water duration");
  }else throw Error("Unknown map-transform command");return structuredClone(c);
}
export function validateFieldWaterCatalog(c:FieldWaterCatalog):void{
  checkpointKeys(c,"kind,sourceSetHash,parentSourceSetHash,source,rawHash,groupOpacity,layers,properties,unresolved");
  if(c.kind!=="source-flat-water-groups-v1"||![c.sourceSetHash,c.parentSourceSetHash,c.rawHash,c.source.sha256].every(s=>/^[a-f0-9]{64}$/.test(s))||!c.source.file||!c.source.assetPath||!c.source.serializedFile||!c.source.objectId||! /^-?\d+$/.test(c.source.objectId)||!Array.isArray(c.layers)||!Array.isArray(c.unresolved))throw Error("Unbound WaterGroup source");
  finite(c.groupOpacity);if(c.groupOpacity<0||c.groupOpacity>1)throw Error("Invalid source water group opacity");
  const seen=new Set<string>();for(const l of c.layers){checkpointKeys(l,"name,id,width,height,data,opacity,sourceOpacity,visible,properties");checkpointInteger(l.width,1,100000);checkpointInteger(l.height,1,100000);if(!Array.isArray(l.data)||l.data.length!==l.width*l.height||l.data.some(g=>!Number.isInteger(g)||g<0||g>0xffffffff))throw Error("Invalid source water cells");finite(l.sourceOpacity);checkpointInteger(l.id,1,2147483647);finite(l.opacity);if(!(waterLayerNames as readonly string[]).includes(l.name)||seen.has(l.name)||l.opacity<0||l.opacity>1||typeof l.visible!=="boolean")throw Error("Invalid source water layer");seen.add(l.name);}
  if(c.unresolved.some(s=>typeof s!=="string"||!s)||!c.properties||Object.values(c.properties).some(v=>typeof v!=="string"&&typeof v!=="boolean"&&(typeof v!=="number"||!Number.isFinite(v))))throw Error("Unknown WaterGroup material declaration");
}
export function projectFieldWaterLayers(map:{layers:FieldContent["map"]["layers"]},water:FieldWaterCatalog):FieldContent["map"]["layers"]{
  validateFieldWaterCatalog(water);if(water.unresolved.length)throw Error(water.unresolved.join("; "));
  return[...structuredClone(map.layers.filter(l=>l.sourceGroup!=="WaterGroup")),...water.layers.map(l=>({name:l.name,sourceGroup:"WaterGroup",width:l.width,height:l.height,data:[...l.data],opacity:l.visible?l.opacity:0}))];
}
export function fieldMapTransformsBinding(content:FieldContent,policy:WebFieldMapTransforms|undefined):string|null{
  if(policy!==undefined&&policy!==WEB_FIELD_MAP_TRANSFORMS)throw Error("Unknown flat map-transform policy");
  if(policy!==WEB_FIELD_MAP_TRANSFORMS||content.developmentProfile?.mapTransforms!==WEB_FIELD_MAP_TRANSFORMS)return null;
  if(content.map.water){const water=content.map.water;validateFieldWaterCatalog(water);if(water.sourceSetHash!==content.sourceSetHash||water.parentSourceSetHash!==content.parentSourceSetHash||canonical(water.source)!==canonical(content.map.source))throw Error("Foreign map water source identity");
    const actual=content.map.layers.filter(l=>l.sourceGroup==="WaterGroup");
    if(!water.unresolved.length&&canonical(actual)!==canonical(projectFieldWaterLayers({layers:[]},water)))throw Error("Water catalog differs from actual source tile layers");}
  return canonical({contentHash:content.contentHash,map:content.map.identity??content.map.id,sourceSetHash:content.sourceSetHash,water:content.map.water??null});
}
/** Web look projection: world XY, dominant axis, vertical wins ties; a
 * coincident target retains its existing direction. This is not native slot41. */
export function projectFlatOrient(self:{x:number;y:number},target:{x:number;y:number},prior:Direction|null):Direction{
  [self.x,self.y,target.x,target.y].forEach(finite);const x=target.x-self.x,y=target.y-self.y;
  if(x===0&&y===0){if(prior===null)throw Error("Coincident Orient requires an existing direction");return prior;}
  return Math.abs(x)>Math.abs(y)?x>0?"right":"left":y>0?"up":"down";
}
export function fieldRenderAreaSample(c:Extract<FieldMapTransformCommand,{kind:"render-area"}>,now:number,started:number,start=c.from,end=c.to){
  parseFieldMapTransform(c);finite(now);finite(started);const f=Math.fround;
  const elapsed=f(now)-f(started),raw=c.seconds===0?1:elapsed/c.seconds,progress=Math.min(1,Math.max(0,raw));
  const lerp=(a:number,b:number)=>f(f(a)+f(f(f(b)-f(a))*f(progress)));
  return {scale:lerp(Math.max(f(.03),start),Math.max(f(.03),end)),height:lerp(c.heightFrom,c.heightTo),complete:raw>=1};
}
export class FieldMapTransforms{
  private value:FieldMapTransformSnapshot;
  constructor(readonly binding:string,readonly catalog:FieldWaterCatalog|undefined){
    if(!binding)throw Error("Missing map-transform binding");if(catalog)validateFieldWaterCatalog(catalog);
    const p=catalog?.properties??{},color=typeof p.custom_water_color==="string"&&/^#[a-fA-F0-9]{8}$/.test(p.custom_water_color)?p.custom_water_color:null;
    const defaults=defaultFieldWaterProperties();const component=(offset:number)=>color?parseInt(color.slice(offset,offset+2),16)/255:defaults.waterColor[({1:3,3:0,5:1,7:2}as Record<number,number>)[offset]!]!;
    const initial:Record<WaterKey,number>={_WaterOffsetY:0,"_WaterColor:R":component(3),"_WaterColor:G":component(5),"_WaterColor:B":component(7),"_WaterColor:A":component(1),
      _FluctuationMagnification:typeof p.noise_magnification==="number"?p.noise_magnification:0,_HighlightIntensity:typeof p.highlight_intensity==="number"?p.highlight_intensity:0,_CondensingPatternIntensity:typeof p.condensing_pattern_intensity==="number"?p.condensing_pattern_intensity:0};
    this.value={kind:"field-map-transforms-state-v1",policy:WEB_FIELD_MAP_TRANSFORMS,binding,areas:[{target:0,scale:1,height:1},{target:1,scale:1,height:1}],water:(catalog?.layers??[]).map(l=>({name:l.name,values:{...initial},tweens:{}})),timeMs:0};
  }
  snapshot():FieldMapTransformSnapshot{return structuredClone(this.value);}
  get active():boolean{return this.value.water.some(l=>Object.keys(l.tweens).length>0);}
  static restore(raw:FieldMapTransformSnapshot,binding:string,catalog:FieldWaterCatalog|undefined,stable=false):FieldMapTransforms{
    checkpointKeys(raw,"kind,policy,binding,areas,water,timeMs");const owner=new FieldMapTransforms(binding,catalog),expected=owner.snapshot();
    if(raw.kind!==expected.kind||raw.policy!==expected.policy||raw.binding!==binding||canonical(raw.areas.map(a=>a.target))!==canonical(expected.areas.map(a=>a.target))||canonical(raw.water.map(l=>l.name))!==canonical(expected.water.map(l=>l.name)))throw Error("Map-transform checkpoint identity mismatch");finite(raw.timeMs);if(raw.timeMs<0)throw Error("Invalid map-transform clock");
    for(const a of raw.areas){checkpointKeys(a,"target,scale,height");finite(a.scale);finite(a.height);if(a.scale<Math.fround(.03))throw Error("Invalid render scale");}
    for(const l of raw.water){checkpointKeys(l,"name,values,tweens");checkpointKeys(l.values,waterKeys.join(","));Object.values(l.values).forEach(finite);for(const [key,t]of Object.entries(l.tweens)){if(!(waterKeys as readonly string[]).includes(key)||!t||stable)throw Error("Unstable or unknown water tween checkpoint");checkpointKeys(t,"from,to,elapsedMs,durationMs");Object.values(t).forEach(finite);if(t.durationMs<=0||t.elapsedMs<0||t.elapsedMs>=t.durationMs)throw Error("Invalid water tween");}}
    owner.value=structuredClone(raw);return owner;
  }
  prepareArea(target:0|1,scale:number,height:number){finite(scale);finite(height);if(scale<Math.fround(.03))throw Error("Invalid render scale");const next=this.snapshot();Object.assign(next.areas.find(a=>a.target===target)!,{scale,height});return this.transaction(next);}
  prepareWater(c:Extract<FieldMapTransformCommand,{kind:"water"}>){
    parseFieldMapTransform(c);if(!this.catalog||this.catalog.unresolved.length)throw Error(this.catalog?.unresolved.join("; ")||"Missing real source WaterGroup provider");
    const next=this.snapshot(),layers=c.target===-1?next.water:next.water.filter(l=>l.name===waterLayerNames[c.target]);if(!layers.length)throw Error("Water target has no real source logical layer");
    const divide=c.key.includes(":")?255:1;for(const l of layers){l.values[c.key]=c.from/divide;delete l.tweens[c.key];if(c.seconds>0)l.tweens[c.key]={from:c.from/divide,to:c.to/divide,elapsedMs:0,durationMs:c.seconds*1000};}return this.transaction(next);
  }
  private transaction(next:FieldMapTransformSnapshot){const before=canonical(this.value);let used=false;const validate=()=>{if(used||canonical(this.value)!==before)throw Error("Stale map-transform transaction");};return{validate,commit:()=>{validate();used=true;this.value=next;}};}
  advance(ms:number):void{finite(ms);if(ms<0)throw Error("Negative map-transform clock");this.value.timeMs+=ms;for(const l of this.value.water)for(const [key,t]of Object.entries(l.tweens)as[WaterKey,Tween][]){t.elapsedMs=Math.min(t.durationMs,t.elapsedMs+ms);l.values[key]=t.from+(t.to-t.from)*t.elapsedMs/t.durationMs;if(t.elapsedMs===t.durationMs)delete l.tweens[key];}}
}

/** Source-pixel effects for the explicit flat WaterGroup renderer. All eight
 * instruction keys have real consumers; the retained original shader remains
 * an independent diagnostic. Pixels outside source alpha remain unchanged. */
export function projectFlatWaterPixels(input:{width:number;height:number;data:ArrayLike<number>},values:Record<WaterKey,number>,timeMs:number){
  Object.values(values).forEach(finite);finite(timeMs);const {width,height}=input,data=new Uint8ClampedArray(input.data);
  if(data.length!==width*height*4)throw Error("Invalid water pixel buffer");const rgba=[values["_WaterColor:R"],values["_WaterColor:G"],values["_WaterColor:B"]];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const wave=Math.round(Math.sin((y+timeMs*.02)*.2)*values._FluctuationMagnification),sx=((x+wave)%width+width)%width,from=(y*width+sx)*4,to=(y*width+x)*4;
    if(input.data[from+3]===0){data[to]=data[to+1]=data[to+2]=data[to+3]=0;continue;}
    const highlight=(1+Math.sin((x+y+timeMs*.01)*.3))*.5*values._HighlightIntensity;
    const pattern=((Math.floor(x/4)+Math.floor((y+timeMs*.005)/4))%2)*values._CondensingPatternIntensity;
    for(let c=0;c<3;c++)data[to+c]=Number(input.data[from+c])*Math.max(0,rgba[c]!)+highlight*8+pattern*3;
    data[to+3]=Number(input.data[from+3])*Math.max(0,Math.min(1,values["_WaterColor:A"]));
  }return{width,height,data};
}
export function flatMapViewport(area:{scale:number;height:number},width:number,height:number){
  finite(area.scale);finite(area.height);if(area.scale<=0)throw Error("Invalid flat viewport scale");
  // Height is an explicit flat vertical aspect projection, not recovered bird
  // perspective. Its reversible bound keeps source hit coordinates finite.
  const sx=1/area.scale,sy=sx*Math.max(.03,Math.abs(area.height));return{sx,sy,x:width*(1-sx)/2,y:height*(1-sy)/2};
}
