import { checkpointKeys } from "./checkpoint-validation.js";
import { int32 } from "./script-integer.js";
import { canonical } from "./canonical.js";
import { SOURCE_FORMAT_FLAG_IMPORT, type SourceFormatPhysicalSource } from "./source-format-import.js";
import type { Animation, Character } from "../field/types.js";

export type SourceCustomAnimationFrame = { sprite_name: string; offsetx: number; offsety: number;
  alpha: number; rgb: { r: number; g: number; b: number; a: number }; flip: boolean };
export type SourceCustomAnimation = { name: string; frames: SourceCustomAnimationFrame[];
  play_speed: number; play_mode: number; is_reverse: boolean; next_anim_name?: string | null };
export type SourceScriptAnimationAsset = { id: string; source: SourceFormatPhysicalSource;
  rawScriptHash: string; animations: SourceCustomAnimation[] };
export type SourceScriptAnimationCatalog = { kind: "source-script-custom-animations-v1";
  contentHash: string; sourceSetHash: string; parentSourceSetHash: string;
  formatImport: typeof SOURCE_FORMAT_FLAG_IMPORT; assets: Record<string, SourceScriptAnimationAsset> };
export type SourceCustomAnimationRef = { assetId: string; index: number };
export type SourceActorAnimationAuthority = { catalog: SourceScriptAnimationCatalog; baseKeys: readonly string[] };

const digest = /^[a-f0-9]{64}$/;
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error("Invalid source animation object");
  for (const key of Reflect.ownKeys(raw)) {
    const d=Object.getOwnPropertyDescriptor(raw,key)!;
    if(typeof key!=="string" || !d.enumerable || !Object.hasOwn(d,"value")) throw new Error("Source animation requires own data");
  }
  return raw as Record<string, unknown>;
}
function dense(raw: unknown): unknown[] {
  if (!Array.isArray(raw) || Reflect.ownKeys(raw).length!==raw.length+1) throw new Error("Invalid dense source animation array");
  return Array.from(raw);
}
function finite(raw: unknown): number {
  if(typeof raw!=="number" || !Number.isFinite(raw) || !Number.isFinite(Math.fround(raw))) throw new Error("Invalid source animation float32");
  return raw;
}
function text(raw:unknown):string { if(typeof raw!=="string")throw new Error("Invalid source animation name");return raw; }
function boolean(raw:unknown):boolean { if(typeof raw!=="boolean")throw new Error("Invalid source animation boolean");return raw; }

/** Exact original AnimAssetData shape. Unsupported renderer/playback behavior
 * stays represented here; mere metadata parsing is not execution admission. */
export function parseSourceCustomAnimation(raw:unknown):SourceCustomAnimation {
  const v=object(raw),hasNext=Object.hasOwn(v,"next_anim_name");
  checkpointKeys(v,"name,frames,play_speed,play_mode,is_reverse"+(hasNext?",next_anim_name":""));
  if(hasNext && v.next_anim_name!==null)text(v.next_anim_name);
  const frames=dense(v.frames).map(raw=>{const f=object(raw),rgb=object(f.rgb);
    checkpointKeys(f,"sprite_name,offsetx,offsety,alpha,rgb,flip");checkpointKeys(rgb,"r,g,b,a");
    return{sprite_name:text(f.sprite_name),offsetx:finite(f.offsetx),offsety:finite(f.offsety),alpha:finite(f.alpha),
      rgb:{r:finite(rgb.r),g:finite(rgb.g),b:finite(rgb.b),a:finite(rgb.a)},flip:boolean(f.flip)};});
  return{name:text(v.name),frames,play_speed:finite(v.play_speed),play_mode:int32(v.play_mode),is_reverse:boolean(v.is_reverse),
    ...(hasNext?{next_anim_name:v.next_anim_name===null?null:text(v.next_anim_name)}:{})};
}

/** Already verified compiled content supplies authority. This parser verifies
 * native/source and structural consistency; it is not a signature verifier. */
export function parseSourceScriptAnimationCatalog(raw:unknown):SourceScriptAnimationCatalog {
  const v=object(raw);checkpointKeys(v,"kind,contentHash,sourceSetHash,parentSourceSetHash,formatImport,assets");
  if(v.kind!=="source-script-custom-animations-v1" || [v.contentHash,v.sourceSetHash,v.parentSourceSetHash].some(x=>typeof x!=="string"||!digest.test(x)) ||
      canonical(v.formatImport)!==canonical(SOURCE_FORMAT_FLAG_IMPORT)) throw new Error("Changed source custom animation catalog identity");
  const assets=object(v.assets),parsed:Record<string,SourceScriptAnimationAsset>={};
  for(const[id,rawAsset]of Object.entries(assets)){
    const a=object(rawAsset),s=object(a.source);checkpointKeys(a,"id,source,rawScriptHash,animations");checkpointKeys(s,"file,assetPath,objectId,sha256,serializedFile");
    if(a.id!==id||!digest.test(id)||typeof a.rawScriptHash!=="string"||!digest.test(a.rawScriptHash)||
      [s.file,s.assetPath,s.serializedFile].some(x=>typeof x!=="string"||!x)||typeof s.objectId!=="string"||! /^-?\d+$/.test(s.objectId)||
      typeof s.sha256!=="string"||!digest.test(s.sha256))throw new Error("Invalid physical source custom animation asset");
    parsed[id]={id,source:structuredClone(s)as SourceFormatPhysicalSource,rawScriptHash:a.rawScriptHash,
      animations:dense(a.animations).map(parseSourceCustomAnimation)};
  }
  return{kind:"source-script-custom-animations-v1",contentHash:v.contentHash as string,sourceSetHash:v.sourceSetHash as string,
    parentSourceSetHash:v.parentSourceSetHash as string,formatImport:SOURCE_FORMAT_FLAG_IMPORT,assets:parsed};
}

/** Original CustomAnimAsset.GetDataByName walks the array in order and returns
 * the first exact name match. Repeated names are not deduplicated or rejected. */
export function sourceCustomAnimationByName(catalog:SourceScriptAnimationCatalog,assetId:string,key:string):SourceCustomAnimationRef|null {
  const asset=catalog.assets[assetId];if(!asset)throw new Error("Current source custom animation asset is unavailable");
  const index=asset.animations.findIndex(animation=>animation.name===key);
  return index<0?null:{assetId,index};
}
export function sourceCustomAnimationAt(catalog:SourceScriptAnimationCatalog,ref:SourceCustomAnimationRef):SourceCustomAnimation {
  checkpointKeys(ref,"assetId,index");const asset=catalog.assets[ref.assetId];
  if(!asset||!Number.isInteger(ref.index)||ref.index<0||ref.index>=asset.animations.length)throw new Error("Unbound source custom animation reference");
  return asset.animations[ref.index]!;
}

/** Materialize only through this actual actor's spriteModel projection. No
 * lookup in other characters, maps, atlases or a nearest/default sprite. */
export function projectSourceCustomAnimation(raw:SourceCustomAnimation,sprites:Character["sprites"]):Animation {
  const d=parseSourceCustomAnimation(raw),duration=Math.fround(d.play_speed),next=d.next_anim_name??"";
  if(![0,1,3].includes(d.play_mode))throw new Error("Unsupported source custom animation play mode "+d.play_mode);
  if(!d.frames.length)throw new Error("Source custom animation has no frames");
  if(duration<0||duration===0&&(d.frames.length!==1||d.play_mode!==0||next!==""))
    throw new Error("Source custom animation duration/zero-pose behavior is unavailable");
  const first=Math.fround(d.frames[0]!.alpha);
  const frames=d.frames.map(frame=>{
    if(!Object.hasOwn(sprites,frame.sprite_name))throw new Error("Missing actual actor sprite for source custom animation: "+frame.sprite_name);
    if(Object.values(frame.rgb).some(x=>x!==1))throw new Error("Source custom animation color interpolation is unavailable");
    const alpha=Math.fround(frame.alpha);
    if(alpha<0||alpha>1||alpha!==first)throw new Error("Source custom animation alpha interpolation is unavailable");
    return{sprite:frame.sprite_name,x:Math.fround(frame.offsetx),y:Math.fround(frame.offsety),alpha,flip:frame.flip};
  });
  return{frames,duration,mode:d.play_mode,flip:d.is_reverse,next};
}

export type SourceScriptAnimationContext = { customAnimations: "source-script-custom-animations-v1";
  assetId: string; catalogHash: string; rawScriptHash: string };
/** Resolve a source program's current asset reference, without selecting or
 * rendering a definition. Empty arrays retain the exact legacy declaration. */
export function sourceScriptAnimationAsset(raw: unknown, catalog?: SourceScriptAnimationCatalog): string | null {
  const v=object(raw);
  if(v.customAnimations==="none"){checkpointKeys(v,"customAnimations");return null;}
  checkpointKeys(v,"customAnimations,assetId,catalogHash,rawScriptHash");
  if(v.customAnimations!=="source-script-custom-animations-v1"||!catalog||v.catalogHash!==catalog.contentHash||
      typeof v.assetId!=="string"||catalog.assets[v.assetId]?.rawScriptHash!==v.rawScriptHash)
    throw new Error("Source script custom animation context is unavailable or changed");
  return v.assetId;
}

export type SourceFieldScriptAnimationState = { kind: "source-field-script-animation-state-v1";
  catalogHash: string; currentAsset: string | null; hookedAsset?: string | null };
export function parseSourceFieldScriptAnimationState(raw: unknown, catalog: SourceScriptAnimationCatalog, hooked: boolean): SourceFieldScriptAnimationState {
  const v=object(raw);checkpointKeys(v,"kind,catalogHash,currentAsset"+(hooked?",hookedAsset":""));
  if(v.kind!=="source-field-script-animation-state-v1"||v.catalogHash!==catalog.contentHash)
    throw new Error("Saved source custom animation catalog changed");
  for(const key of hooked?["currentAsset","hookedAsset"]:["currentAsset"])
    if(v[key]!==null&&(typeof v[key]!=="string"||!catalog.assets[v[key] as string]))throw new Error("Saved source custom animation asset is unavailable");
  return structuredClone(raw)as SourceFieldScriptAnimationState;
}
