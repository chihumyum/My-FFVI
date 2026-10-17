import { SOURCE_FORMAT_FLAG_IMPORT } from "../core/source-format-import.js";
import { parseSourceCustomAnimation, parseSourceScriptAnimationCatalog,
  type SourceScriptAnimationAsset } from "../core/source-script-animations.js";
import { bindSourceFormatFlags } from "./source-system-flags.js";
import { hash, record } from "./content.js";
import type { CorpusAsset } from "./corpus.js";

/** Pure same-source Format import; the trusted snapshot loader remains the
 * provenance boundary. Raw ordered definitions and their physical indices are
 * retained, including duplicates and unsupported media/playback forms. */
export function compileSourceScriptAnimations(input:{sourceSetHash:string;manifest:{parentSourceSetHash:string;sources:unknown};assets:readonly CorpusAsset[]}) {
  const assets:Record<string,SourceScriptAnimationAsset>={},byProgram:Record<string,string>={},rejected:{program:string;reason:string}[]=[];
  for(const asset of input.assets.filter(asset=>asset.kind==="script")){
    try{
      const raw=record(asset.data);
      if(!Array.isArray(raw.Animations))throw new Error("Source Format Animations array is unavailable");
      if(raw.Animations.length===0)continue;
      // Establish the original Format loader and complete physical/raw binding.
      // Animation import does not require SystemFlag applicability or zero flags.
      const binding=bindSourceFormatFlags({sourceSetHash:input.sourceSetHash,parentSourceSetHash:input.manifest.parentSourceSetHash,sources:input.manifest.sources},asset),
        id=hash({source:binding.source,rawScriptHash:binding.rawScriptHash});
      if(assets[id])throw new Error("Duplicate physical source custom animation asset");
      assets[id]={id,source:binding.source,rawScriptHash:binding.rawScriptHash,animations:raw.Animations.map(parseSourceCustomAnimation)};
      byProgram[asset.id]=id;
    }catch(error){rejected.push({program:asset.id,reason:error instanceof Error?error.message:String(error)});}
  }
  const body={kind:"source-script-custom-animations-v1"as const,sourceSetHash:input.sourceSetHash,parentSourceSetHash:input.manifest.parentSourceSetHash,
    formatImport:SOURCE_FORMAT_FLAG_IMPORT,assets};
  const catalog=parseSourceScriptAnimationCatalog({...body,contentHash:hash(body)});
  return{catalog,byProgram,rejected};
}
