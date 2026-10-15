import { canonical, hash, record } from './content.js';
import { bindMapPackages } from './map-package.js';
import { compileEntityGroup, entityProperties } from './entity-group.js';
import { compileFieldNativeNpc } from './field-native-npc.js';
import { WEB_NPC_FLAT_PROJECTION, validateFieldNpcFlatBinding, type FieldNpcFlatBinding, type FieldNpcFlatHost } from '../core/field-npc-flat-projection.js';
import type { FieldNpcActivityCorpus } from './field-npc-activity.js';
import type { FrameworkContent } from './framework-content.js';
import type { Evidence } from '../field/types.js';
import type { WorldCatalog, WorldMapContent } from '../field/world.js';
export type FrameworkNpcFlatAssessment = {
  kind: 'framework-npc-flat-assessment-v1'; contentHash: string; sourceSetHash: string; parentSourceSetHash: string;
  mapId: number; sourceMapHash: string; reason: string; host: FieldNpcFlatHost;
  objects: { group: string; source: Evidence; raw: Record<string, unknown>; properties: Record<string, unknown>; reasons: string[] }[];
};
function verify(value: { contentHash: string }): void {
  const { contentHash, ...body } = value;
  if (!/^[a-f0-9]{64}$/.test(contentHash) || hash(body) !== contentHash) throw new Error('NPC flat content hash mismatch');
}
type SourceIndex={bindings:ReturnType<typeof bindMapPackages>;assets:Map<string,FieldNpcActivityCorpus['assets'][number]>};
function sourceIndex(corpus:FieldNpcActivityCorpus):SourceIndex {const assets=new Map(corpus.assets.map(a=>[a.id,a]));if(assets.size!==corpus.assets.length)throw new Error('Duplicate NPC flat physical source identity');return {bindings:bindMapPackages(corpus.assets,corpus.tables),assets};}
export function assessFrameworkNpcFlatMap(corpus: FieldNpcActivityCorpus, map: WorldMapContent, reason: string): FrameworkNpcFlatAssessment {
 return assessMap(corpus,map,reason,sourceIndex(corpus));
}
function assessMap(corpus: FieldNpcActivityCorpus, map: WorldMapContent, reason: string,index:SourceIndex): FrameworkNpcFlatAssessment {
  verify(map);
  if (map.developmentProfile !== undefined || map.frameworkNpcFlat !== undefined || map.sourceSetHash !== corpus.sourceSetHash ||
      map.parentSourceSetHash !== corpus.manifest.parentSourceSetHash || hash(corpus.manifest.sources) !== corpus.sourceSetHash ||
      typeof reason !== 'string' || !reason.trim()) throw new Error('NPC flat requires matching strict source and explicit Web reason');
  const matches = index.bindings.filter(b=>Number(b.id)===map.mapId);
  if (matches.length !== 1) throw new Error('NPC flat source package identity mismatch');
  const assets = index.assets;
  const objects: FrameworkNpcFlatAssessment['objects'] = [], bindings: FieldNpcFlatBinding[] = [];
  for (const [groupName,id] of Object.entries(matches[0]!.groups)) {
    const asset = assets.get(id); if (!asset) throw new Error('Missing NPC flat physical group');
    const sources=(corpus.manifest.sources as {file:string;sha256:string}[]).filter(s=>s.file===asset.source.file);
    if(sources.length!==1 || sources[0]!.sha256!==asset.source.sha256) throw new Error('Foreign NPC flat physical group');
    let compiled:ReturnType<typeof compileEntityGroup>|undefined;const data=record(asset.data);
    if (!Array.isArray(data.layers)) throw new Error('Missing NPC flat raw layers');
    for (const [li,value] of data.layers.entries()) {
      const layer=record(value); if(!Array.isArray(layer.objects)) throw new Error('Missing NPC flat raw objects');
      for (const [oi,value] of layer.objects.entries()) {
        const raw=record(value), p=entityProperties(raw.properties);
        if (![6,17].includes(Number(p.object_type)) || !(p.all_layers===true || p.birdview_puppet===true)) continue;
        const source={...asset.source,pointer:`/layers/${li}/objects/${oi}`}, reasons:string[]=[], row={group:groupName,source,raw:structuredClone(raw),properties:structuredClone(p),reasons};objects.push(row);
        try {
          compiled??=compileEntityGroup(groupName,asset,corpus.tables,corpus.messages);
          const exact=compiled.entities.filter(e=>canonical(e.source)===canonical(source)), actual=map.map?.groups?.[groupName]?.entities.filter(e=>canonical(e.source)===canonical(source));
          if (exact.length!==1 || actual?.length!==1 || canonical(exact[0])!==canonical(actual[0])) throw new Error('NPC flat source entity/geometry binding missing');
          if(layer.visible===false || ['offsetx','offsety','x','y'].some(k=>Number(layer[k]??0)!==0)) throw new Error('NPC flat transformed source layer is unresolved');
          const entity=actual[0]!, result=compileFieldNativeNpc({group:groupName,object:raw,entity,properties:p,tables:corpus.tables,flatProjection:WEB_NPC_FLAT_PROJECTION});
          if(result.blockers.length || !result.definition) throw new Error(result.blockers.join('; ') || 'NPC flat definition unavailable');
          const binding: FieldNpcFlatBinding={entity:structuredClone(entity),rawObject:structuredClone(raw),definition:result.definition,
            allLayerTarget:p.all_layers as boolean,birdviewPuppet:p.birdview_puppet as boolean};
          validateFieldNpcFlatBinding(binding);bindings.push(binding);
        } catch(error) { reasons.push(error instanceof Error?error.message:String(error)); }
      }
    }
  }
  // Source duplicate selectors retain their explicit ambiguity, including
  // inactive groups; no inferred scene variant chooses one actor definition.
  const counts=new Map<string,number>();for(const b of bindings)counts.set(b.definition.entityId,(counts.get(b.definition.entityId)??0)+1);
  const unique=bindings.filter(b=>{if(counts.get(b.definition.entityId)===1)return true;
    objects.find(o=>canonical(o.source)===canonical(b.entity.source))!.reasons.push('Ambiguous NPC flat map selector');return false;});
  const host:FieldNpcFlatHost={kind:'web-source-npc-flat-host-v1',policy:WEB_NPC_FLAT_PROJECTION,sourceMapHash:map.contentHash,
    sourceSetHash:map.sourceSetHash,parentSourceSetHash:map.parentSourceSetHash,bindings:unique,
    diagnostics:objects.flatMap(o=>o.reasons.map(reason=>({source:o.source,reason}))),nativeParity:false};
  const body={kind:'framework-npc-flat-assessment-v1' as const,sourceSetHash:map.sourceSetHash,parentSourceSetHash:map.parentSourceSetHash,
    mapId:map.mapId,sourceMapHash:map.contentHash,reason,host,objects};return{...body,contentHash:hash(body)};
}
export function assessFrameworkNpcFlatWorld(corpus:FieldNpcActivityCorpus,catalog:WorldCatalog,maps:readonly WorldMapContent[],reason:string):FrameworkNpcFlatAssessment[]{
  verify(catalog);if(catalog.developmentProfile!==undefined || catalog.sourceSetHash!==corpus.sourceSetHash ||
    catalog.parentSourceSetHash!==corpus.manifest.parentSourceSetHash || maps.length!==Object.keys(catalog.maps).length ||
    new Set(maps.map(m=>m.mapId)).size!==maps.length || maps.some(m=>catalog.maps[String(m.mapId)]?.contentHash!==m.contentHash))
    throw new Error('NPC flat requires complete matching strict world');
  const index=sourceIndex(corpus);return [...maps].sort((a,b)=>a.mapId-b.mapId).map(m=>assessMap(corpus,m,reason,index));
}
export function validateFrameworkNpcFlatAssessment(map:WorldMapContent,a:FrameworkNpcFlatAssessment):void {
  verify(map);verify(a);
  if(a.kind!=='framework-npc-flat-assessment-v1'||a.sourceMapHash!==map.contentHash||a.mapId!==map.mapId||
      a.sourceSetHash!==map.sourceSetHash||a.parentSourceSetHash!==map.parentSourceSetHash||a.host.sourceMapHash!==map.contentHash||
      a.host.policy!==WEB_NPC_FLAT_PROJECTION||a.host.sourceSetHash!==map.sourceSetHash||a.host.parentSourceSetHash!==map.parentSourceSetHash)
    throw new Error('NPC flat assessment source binding mismatch');
  const expectedSources=Object.values(map.map?.groups??{}).flatMap(g=>g.blockers.filter(b=>b.reason==='Unsupported cross-layer or birdview NPC').map(b=>canonical(b.source))).sort(),
    recordedSources=a.objects.map(o=>canonical(o.source)).sort();
  if(map.map && canonical(expectedSources)!==canonical(recordedSources))throw new Error('NPC flat assessment source membership mismatch');
  if(a.host.nativeParity!==false || a.host.kind!=='web-source-npc-flat-host-v1' ||
      canonical(a.host.diagnostics)!==canonical(a.objects.flatMap(o=>o.reasons.map(reason=>({source:o.source,reason})))))throw new Error('NPC flat assessment diagnostics mismatch');
  const seen=new Set<string>();
  for(const b of a.host.bindings){validateFieldNpcFlatBinding(b);if(seen.has(b.definition.entityId))throw new Error('NPC flat duplicate actor binding');seen.add(b.definition.entityId);if(!a.objects.some(o=>!o.reasons.length&&canonical(o.raw)===canonical(b.rawObject)&&canonical(o.source)===canonical(b.entity.source)))throw new Error('NPC flat assessment omitted source');}
  if(a.objects.filter(o=>!o.reasons.length).length!==a.host.bindings.length)throw new Error('NPC flat assessment membership mismatch');
}
function seal<T extends {contentHash:string}>(value:T):T{const{contentHash:_,...body}=value;return{...body,contentHash:hash(body)} as T;}
export function deriveFrameworkNpcFlatContent(content:FrameworkContent,sourceMaps:readonly WorldMapContent[],assessments:readonly FrameworkNpcFlatAssessment[]):FrameworkContent{
  const byId=new Map(assessments.map(a=>[a.mapId,a]));
  if(byId.size!==assessments.length||sourceMaps.length!==assessments.length||content.maps.length!==assessments.length)throw new Error('NPC flat requires complete assessment collection');
  let reason:string|undefined;
  for(const source of sourceMaps){const a=byId.get(source.mapId);if(!a)throw new Error('Missing NPC flat assessment');validateFrameworkNpcFlatAssessment(source,a);if(reason!==undefined&&reason!==a.reason)throw new Error('Mixed NPC flat Web declaration');reason=a.reason;}
  const next=structuredClone(content);
  for(let i=0;i<next.maps.length;i++){const map=next.maps[i]!,a=byId.get(map.mapId);if(!a||map.developmentProfile.sourceContentHash!==a.sourceMapHash||map.frameworkNpcFlat!==undefined||map.developmentProfile.npcProjection!==undefined)throw new Error('NPC flat cannot replace source host');
    map.developmentProfile.npcProjection=WEB_NPC_FLAT_PROJECTION;map.frameworkNpcFlat=structuredClone(a.host);next.maps[i]=seal(map);next.catalog.maps[String(map.mapId)]!.contentHash=next.maps[i]!.contentHash;}
  next.catalog.developmentProfile.npcProjection=WEB_NPC_FLAT_PROJECTION;next.catalog=seal(next.catalog);next.entry.developmentProfile.npcProjection=WEB_NPC_FLAT_PROJECTION;
  next.entry.worldCatalogHash=next.catalog.contentHash;next.entry.mapContentHash=next.maps.find(m=>m.mapId===next.entry.entry.mapId)!.contentHash;next.entry=seal(next.entry);
  next.report.npcProjection={maps:assessments.length,declared:assessments.reduce((n,a)=>n+a.objects.length,0),derived:assessments.reduce((n,a)=>n+a.host.bindings.length,0),unready:assessments.reduce((n,a)=>n+a.objects.length-a.host.bindings.length,0),nativeParity:false};
  next.report.catalogHash=next.catalog.contentHash;next.report.entryHash=next.entry.contentHash;next.report.maps=next.maps.map(m=>({mapId:m.mapId,sourceContentHash:m.developmentProfile.sourceContentHash,contentHash:m.contentHash}));return next;
}
