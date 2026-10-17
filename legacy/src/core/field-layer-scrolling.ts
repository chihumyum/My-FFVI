import { canonical } from "./canonical.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import type { FieldBackgroundSource } from "./field-background.js";
import type { FieldContent } from "../field/types.js";

/** Explicit flat Web projection. Tile collision, animation cells and actor
 * anchors are never moved. Native shader, particle and renderer internals are
 * independent evidence; recovered IMapAccessor arguments remain source data. */
export const WEB_FIELD_LAYER_SCROLLING = "web-field-layer-scrolling-v1" as const;
export type WebFieldLayerScrolling = typeof WEB_FIELD_LAYER_SCROLLING;
export const fieldScrollLayerNames = ["BottomLayer", "GroundLayer", "UpperLayer", "CeilLayer"] as const;
export type FieldSceneryLayer = {
  id: number; scenery: 1 | 3; name: string; source: FieldBackgroundSource;
  active: boolean; autoScroll: boolean; speed: { x: number; y: number };
  size: { width: number; height: number }; offset: { x: number; y: number };
  manualSpeed: { x: number; y: number }; blend: 0 | 1 | 2;
  texture: { url: string; sha256: string; width: number; height: number; source: FieldBackgroundSource; textureSource: FieldBackgroundSource };
};
export type FieldSceneryCatalog = {
  kind: "web-flat-field-scenery-v1"; sourceSetHash: string; parentSourceSetHash: string;
  layers: FieldSceneryLayer[];
  unresolved: { id: number; scenery: 1 | 3; reason: string; source: FieldBackgroundSource }[];
};
type Point = { x: number; y: number };
export type FieldLayerAction =
  | { kind: "offset"; layer: number; x: number; y: number }
  | { kind: "velocity"; layer: number; x: number; y: number }
  | { kind: "show"; id: number; scenery: 1 | 3; seconds: number }
  | { kind: "hide"; id: number; scenery: 1 | 3; seconds: number }
  | { kind: "scenery-velocity"; id: number; scenery: 1 | 3; enabled: boolean; x: number; y: number };
export type FieldLayerCommand =
  | { kind: "apply"; mask?: number; actions: FieldLayerAction[] }
  | { kind: "reset" }
  | { kind: "tween"; mask: number; layers: number[]; axis: "x" | "y"; from: number; to: number; seconds: number; easing: "linear" | "in-cubic" | "out-cubic"; end?: number };
export type FieldLayerOp = { kind: "field-layer-scrolling"; command: FieldLayerCommand };
type Fade = { elapsedMs: number; durationMs: number; direction: "in" | "out" };
export type FieldLayerSnapshot = {
  kind: "field-layer-scrolling-state-v1"; policy: WebFieldLayerScrolling; binding: string;
  tiles: { name: string; offset: Point; velocity: Point }[];
  scenery: { id: number; scenery: 1 | 3; visible: boolean; alpha: number; offset: Point; velocity: Point; autoScroll: boolean; fade: Fade | null }[];
};
export function fieldLayerScrollingBinding(content: FieldContent, policy: WebFieldLayerScrolling | undefined): string | null {
  if(policy!==undefined&&policy!==WEB_FIELD_LAYER_SCROLLING)throw new Error("Unknown Field layer scrolling policy");
  if(policy!==WEB_FIELD_LAYER_SCROLLING||content.developmentProfile?.fieldLayerScrolling!==WEB_FIELD_LAYER_SCROLLING)return null;
  if(content.map.scenery){validateFieldSceneryCatalog(content.map.scenery);if(content.map.scenery.parentSourceSetHash!==content.parentSourceSetHash||content.map.scenery.sourceSetHash!==content.sourceSetHash)throw new Error("Foreign Field scenery source set");}
  return canonical({contentHash:content.contentHash,sourceSetHash:content.parentSourceSetHash,mapId:content.map.identity??content.map.id,layers:content.map.layers.map(l=>l.name),scenery:content.map.scenery??null});
}
function number(v: number): void { if (!Number.isFinite(v) || !Number.isFinite(Math.fround(v))) throw new Error("Invalid Field scrolling number"); }
function point(v: Point): void { checkpointKeys(v, "x,y"); number(v.x); number(v.y); }
function source(s: FieldBackgroundSource): void {
  if (!s.file || !s.assetPath || !s.serializedFile || !/^-?\d+$/.test(s.objectId) || !/^[a-f0-9]{64}$/.test(s.sha256)) throw new Error("Unbound Field scenery source");
}
export function validateFieldSceneryCatalog(c: FieldSceneryCatalog): void {
  checkpointKeys(c, "kind,sourceSetHash,parentSourceSetHash,layers,unresolved");
  if (c.kind !== "web-flat-field-scenery-v1" || !/^[a-f0-9]{64}$/.test(c.sourceSetHash) || !/^[a-f0-9]{64}$/.test(c.parentSourceSetHash) || !Array.isArray(c.layers) || !Array.isArray(c.unresolved)) throw new Error("Invalid flat Field scenery catalog");
  const ids = new Set<string>();
  for (const l of [...c.layers, ...c.unresolved]) {
    checkpointInteger(l.id, 1, 9999); source(l.source);
    if (![1, 3].includes(l.scenery) || ids.has(`${l.scenery}:${l.id}`)) throw new Error("Ambiguous Field scenery identity");
    ids.add(`${l.scenery}:${l.id}`);
  }
  for (const l of c.layers) {
    checkpointKeys(l, "id,scenery,name,source,active,autoScroll,speed,size,offset,manualSpeed,blend,texture");
    if (l.name !== `${l.scenery === 1 ? "Far" : "Near"}BGLayer${l.id}` || typeof l.active !== "boolean" || typeof l.autoScroll !== "boolean" || ![0,1,2].includes(l.blend)) throw new Error("Invalid Field scenery parameters");
    point(l.speed); point(l.offset); point(l.manualSpeed);
    for (const d of [l.size, l.texture]) for (const n of [d.width,d.height]) { number(n); if (n <= 0 || n > 1000000) throw new Error("Invalid scenery dimensions"); }
    if (!/^[a-f0-9]{64}$/.test(l.texture.sha256) || l.texture.url !== `/field-background-media/textures/${l.texture.sha256}.png`) throw new Error("Unbound Field scenery texture");
    source(l.texture.source); source(l.texture.textureSource);
  }
  for (const l of c.unresolved) { checkpointKeys(l,"id,scenery,reason,source"); if (!l.reason) throw new Error("Missing scenery diagnostic"); }
}
export function parseFieldLayerCommand(c: FieldLayerCommand): FieldLayerCommand {
  const mask = (n: number) => checkpointInteger(n, 0, 15), layer = (n: number) => checkpointInteger(n,0,3);
  if (c.kind === "reset") checkpointKeys(c,"kind");
  else if (c.kind === "tween") {
    checkpointKeys(c,"kind,mask,layers,axis,from,to,seconds,easing" + (Object.hasOwn(c,"end")?",end":"")); mask(c.mask);
    if (!Array.isArray(c.layers) || !c.layers.length || new Set(c.layers).size !== c.layers.length || !["x","y"].includes(c.axis) || !["linear","in-cubic","out-cubic"].includes(c.easing)) throw new Error("Invalid layer tween");
    c.layers.forEach(layer); number(c.from); number(c.to); number(c.seconds); if (c.seconds <= 0 || c.seconds > 600) throw new Error("Invalid layer tween duration"); if(c.end!==undefined) number(c.end);
  } else if (c.kind === "apply") {
    checkpointKeys(c,"kind,actions"+(Object.hasOwn(c,"mask")?",mask":"")); if(c.mask!==undefined)mask(c.mask);
    if(!Array.isArray(c.actions) || c.actions.length>32)throw new Error("Invalid layer action list");
    for(const a of c.actions) {
      if(a.kind==="offset"||a.kind==="velocity") { checkpointKeys(a,"kind,layer,x,y");layer(a.layer);number(a.x);number(a.y); }
      else if(a.kind==="show"||a.kind==="hide") { checkpointKeys(a,"kind,id,scenery,seconds");checkpointInteger(a.id,1,9999);if(![1,3].includes(a.scenery))throw new Error("Invalid scenery target");number(a.seconds);if(a.seconds<0||a.seconds>600)throw new Error("Invalid scenery fade"); }
      else if(a.kind==="scenery-velocity") { checkpointKeys(a,"kind,id,scenery,enabled,x,y");checkpointInteger(a.id,1,9999);if(![1,3].includes(a.scenery)||typeof a.enabled!=="boolean")throw new Error("Invalid scenery velocity");number(a.x);number(a.y); }
      else throw new Error("Unknown Field layer action");
    }
  } else throw new Error("Unknown Field layer command");
  return structuredClone(c);
}
export function fieldLayerTweenSample(c: Extract<FieldLayerCommand,{kind:"tween"}>, nowSeconds: number, startedSeconds: number): { actions: FieldLayerAction[]; complete: boolean } {
  parseFieldLayerCommand(c);number(nowSeconds);number(startedSeconds);
  const f=Math.fround, t=Math.max(0,Math.min(1,f(f(f(nowSeconds)-f(startedSeconds))/f(c.seconds))));
  const eased=c.easing==="in-cubic"?f(f(t*t)*t):c.easing==="out-cubic"?f(1-f(f(f(1-t)*f(1-t))*f(1-t))):t;
  const value=t===1&&c.end!==undefined?c.end:Math.trunc(f(f(c.from)+f(f(c.to-c.from)*eased)));
  return {actions:c.layers.map(layer=>({kind:"offset",layer,x:c.axis==="x"?value:0,y:c.axis==="y"?value:0})),complete:t===1};
}
export class FieldLayerScrolling {
  private value: FieldLayerSnapshot;
  readonly definition: FieldSceneryCatalog | undefined;
  constructor(readonly binding: string, names: readonly string[], catalog?: FieldSceneryCatalog) {
    if(!binding)throw new Error("Missing Field scrolling binding"); if(catalog)validateFieldSceneryCatalog(catalog);this.definition=catalog&&structuredClone(catalog);
    const recognized=names.filter(name=>(fieldScrollLayerNames as readonly string[]).includes(name));
    if(new Set(recognized).size!==recognized.length)throw new Error("Ambiguous logical tile layer");
    this.value={kind:"field-layer-scrolling-state-v1",policy:WEB_FIELD_LAYER_SCROLLING,binding,
      tiles:recognized.map(name=>({name,offset:{x:0,y:0},velocity:{x:0,y:0}})),
      scenery:(catalog?.layers??[]).map(l=>({id:l.id,scenery:l.scenery,visible:l.active,alpha:1,offset:{x:0,y:0},velocity:{...l.speed},autoScroll:l.autoScroll,fade:null}))};
  }
  snapshot(): FieldLayerSnapshot{return structuredClone(this.value);}
  get active(): boolean{return this.value.scenery.some(l=>l.fade!==null);}
  tileOffset(name:string):Point {const l=this.value.tiles.find(l=>l.name===name);return l?{...l.offset}:{x:0,y:0};}
  static restore(raw:FieldLayerSnapshot,binding:string,names:readonly string[],catalog?:FieldSceneryCatalog,stable=false):FieldLayerScrolling {
    checkpointKeys(raw,"kind,policy,binding,tiles,scenery");const owner=new FieldLayerScrolling(binding,names,catalog),expected=owner.snapshot();
    if(raw.kind!==expected.kind||raw.policy!==expected.policy||raw.binding!==binding||!Array.isArray(raw.tiles)||!Array.isArray(raw.scenery)||canonical(raw.tiles.map(l=>l.name))!==canonical(expected.tiles.map(l=>l.name))||canonical(raw.scenery.map(l=>[l.scenery,l.id]))!==canonical(expected.scenery.map(l=>[l.scenery,l.id])))throw new Error("Field scrolling checkpoint identity mismatch");
    for(const l of raw.tiles){checkpointKeys(l,"name,offset,velocity");point(l.offset);point(l.velocity);}
    for(const l of raw.scenery){checkpointKeys(l,"id,scenery,visible,alpha,offset,velocity,autoScroll,fade");point(l.offset);point(l.velocity);number(l.alpha);if(l.alpha<0||l.alpha>1||typeof l.visible!=="boolean"||typeof l.autoScroll!=="boolean")throw new Error("Invalid scenery state");if(l.fade){checkpointKeys(l.fade,"elapsedMs,durationMs,direction");number(l.fade.elapsedMs);number(l.fade.durationMs);if(!["in","out"].includes(l.fade.direction)||l.fade.durationMs<=0||l.fade.elapsedMs<0||l.fade.elapsedMs>=l.fade.durationMs||stable)throw new Error("Unstable scenery fade checkpoint");}}
    owner.value=structuredClone(raw);return owner;
  }
  prepare(raw:FieldLayerCommand,resetMask?:number):{validate():void;commit():void} {
    const c=parseFieldLayerCommand(raw),before=canonical(this.value),next=this.snapshot();
    let actions:FieldLayerAction[];
    if(c.kind==="tween")throw new Error("Layer tween requires the owning Core clock");
    if(c.kind==="reset"){if(resetMask===undefined)throw new Error("Unknown ScenarioVariable[0] layer reset mask");checkpointInteger(resetMask,-2147483648,2147483647);actions=fieldScrollLayerNames.flatMap((_,layer)=>(resetMask!&(1<<layer))?[{kind:"velocity"as const,layer,x:0,y:0},{kind:"offset"as const,layer,x:0,y:0}]:[]);}
    else actions=c.actions;
    // Resolve the entire list before the caller publishes mask/Core writes.
    for(const a of actions) {
      if(a.kind==="offset"||a.kind==="velocity") {const l=next.tiles.find(l=>l.name===fieldScrollLayerNames[a.layer]);if(!l)throw new Error("Missing source logical tile layer "+a.layer);l[a.kind==="offset"?"offset":"velocity"]={x:a.x,y:a.y};}
      else {const l=next.scenery.find(l=>l.id===a.id&&l.scenery===a.scenery);if(!l){const gap=this.definition?.unresolved.find(l=>l.id===a.id&&l.scenery===a.scenery);throw new Error(gap?.reason??`Missing source scenery ${a.scenery}:${a.id}`);}if(a.kind==="scenery-velocity"){l.autoScroll=a.enabled;l.velocity={x:a.x,y:a.y};}else {if(a.kind==="show")l.visible=true;else if(a.seconds<=0)l.visible=false;l.alpha=1;if(a.seconds>0)l.fade={direction:a.kind==="show"?"in":"out",elapsedMs:0,durationMs:a.seconds*1000};}}
    }
    FieldLayerScrolling.restore(next,this.binding,this.value.tiles.map(l=>l.name),this.definition);let consumed=false;
    const validate=()=>{if(consumed||canonical(this.value)!==before)throw new Error("Stale Field scrolling transaction");};
    return{validate,commit:()=>{validate();this.value=next;consumed=true;}};
  }
  advance(milliseconds:number):void {
    checkpointInteger(milliseconds,0,60000);const next=this.snapshot(),dt=milliseconds/1000;
    for(const l of next.tiles){l.offset.x+=l.velocity.x*dt;l.offset.y+=l.velocity.y*dt;}
    for(const l of next.scenery){if(l.visible&&l.autoScroll){l.offset.x-=l.velocity.x*dt;l.offset.y-=l.velocity.y*dt;}if(l.fade&&l.visible){l.fade.elapsedMs+=milliseconds;const t=Math.min(1,l.fade.elapsedMs/l.fade.durationMs);l.alpha=l.fade.direction==="in"?t:1-t;if(t===1){if(l.fade.direction==="out")l.visible=false;l.fade=null;}}}
    FieldLayerScrolling.restore(next,this.binding,this.value.tiles.map(l=>l.name),this.definition);this.value=next;
  }
}
/** Pure flat repeat, including inactive variants once ShowScenery activates
 * them. Manual source speeds remain explicit; this is not native ninepatch. */
export function projectFlatFieldScenery(l:FieldSceneryLayer,state:FieldLayerSnapshot["scenery"][number],camera:Point,width:number,height:number):{source:{x:number;y:number;width:number;height:number};destination:{x:number;y:number;width:number;height:number}}[] {
  if(l.id!==state.id||l.scenery!==state.scenery)throw new Error("Foreign scenery projection");if(!state.visible)return[];
  const mod=(x:number,n:number)=>((x%n)+n)%n,tw=l.texture.width,th=l.texture.height;
  const origin={x:mod(camera.x*l.manualSpeed.x-l.offset.x+state.offset.x,tw),y:mod(-camera.y*l.manualSpeed.y-l.offset.y-state.offset.y,th)},out=[];
  for(let y=0;y<height;){const sy=y===0?origin.y:0,h=Math.min(th-sy,height-y);for(let x=0;x<width;){const sx=x===0?origin.x:0,w=Math.min(tw-sx,width-x);out.push({source:{x:sx,y:sy,width:w,height:h},destination:{x,y,width:w,height:h}});if(out.length>4096)throw new Error("Flat scenery repeat bounds exceeded");x+=w;}y+=h;}return out;
}
