import { posix } from "node:path";
import { createHash } from "node:crypto";
import { hash, record } from "./content.js";
import { readSnapshot, snapshotFile } from "./integrity.js";
import { validateFieldBackground, type FieldBackgroundLayer, type FieldBackgroundSource, type FieldBackgroundRenderHost } from "../core/field-background.js";
import { validateFieldSceneryCatalog, type FieldSceneryCatalog, type FieldSceneryLayer } from "../core/field-layer-scrolling.js";
import { loadCorpus } from "./corpus.js";
import { bindMapPackages } from "./map-package.js";

type Asset = { data: unknown; source: FieldBackgroundSource };
type Verify = (file: string, sha256: string) => void;
export type FieldBackgroundMedia = { parentSourceSetHash: string; sources: { file: string; sha256: string }[];
  sourceSetHash: string; images: Record<string, Record<string, unknown>>; shader: unknown; prefab: unknown; renderHost: unknown };
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const shaderPrograms = ["51435b11255bd644dca330fd869b300a75b2ea179f6249734cd7c74cba7c683e",
  "454aa9357a278171ce3d25ac32f289154ac5995bdd39a9c04732bebd787dd0fe"];
const mapCommonSha = "c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a";
const list = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error("Missing background source list"); return v; };
const num = (v: unknown): number => { if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Invalid background source number"); return v; };
function provenance(v: unknown, sources: readonly { file: string; sha256: string }[]): FieldBackgroundSource {
  const s = record(v);
  if (typeof s.file !== "string" || typeof s.sha256 !== "string" || typeof s.assetPath !== "string" ||
      typeof s.objectId !== "string" || !/^-?\d+$/.test(s.objectId) || typeof s.serializedFile !== "string" ||
      sources.filter((x) => x.file === s.file && x.sha256 === s.sha256).length !== 1)
    throw new Error("Foreign or ambiguous background source");
  return s as FieldBackgroundSource;
}
function provider(media: FieldBackgroundMedia, sources: readonly { file: string; sha256: string }[], verify: Verify): FieldBackgroundRenderHost {
  if (hash(media.sources) !== media.sourceSetHash) throw new Error("Background media source hash mismatch");
  for (const s of media.sources)
    if (sources.filter((x) => x.file === s.file && x.sha256 === s.sha256).length !== 1)
      throw new Error("Foreign background media source set");
  const shader = record(media.shader), shaderSource = provenance(shader.source, sources);
  if (shader.name !== "Unlit/MultipleScrollShader" || shaderSource.sha256 !== mapCommonSha ||
      shaderSource.objectId !== "5482222517167677832") throw new Error("Unrecovered background shader provider");
  const programs = list(shader.programs).map(record);
  if (programs.length !== 2) throw new Error("Missing background shader programs");
  programs.forEach((p, i) => {
    if (p.index !== i + 4 || p.sha256 !== shaderPrograms[i] || p.file !== `shaders/${p.sha256}.dxbc`)
      throw new Error("Unrecovered background shader bytecode");
    verify(String(p.file), String(p.sha256));
  });
  const prefab = record(media.prefab), source = provenance(prefab.source, sources), transform = record(prefab.transform);
  if (source.sha256 !== mapCommonSha || source.objectId !== "8979836032843371103" ||
      hash(transform.m_LocalScale) !== hash({ x: 1, y: 1, z: 1 }) ||
      hash(transform.m_LocalRotation) !== hash({ x: 0, y: 0, z: 0, w: 1 })) throw new Error("Unrecovered background prefab transform");
  const host = record(media.renderHost);
  const boot = { file: "FINAL FANTASY VI_Data/level0", sha256: "986e706d7e762c652ac73cacfbb399b1eb69c37ad57d31a8165df0516e07c170" };
  const hostSources = [...sources, boot];
  const field = provenance(host.fieldMapSource, sources), common = provenance(host.commonCameraSource, hostSources),
    camera = provenance(host.cameraSource, hostSources);
  if (host.kind !== "source-fresh-normal-background-host-v1" ||
      field.sha256 !== "9b406d18f7e629a9cd224fdae27757897753554e5468fb7ee411baf8de8fe5c7" ||
      field.serializedFile !== "CAB-2551423dda0aad973a6f5a52774d59d7" || field.objectId !== "17" ||
      host.rendererParentId !== "9" || common.file !== boot.file || common.objectId !== "305" ||
      camera.file !== boot.file || camera.objectId !== "170" || host.cameraIndex !== 12 || host.selectedCameraId !== "170" ||
      host.orthographic !== true || host.cullingMask !== 58867457) throw new Error("Unrecovered background raster camera host");
  const chain = (raw: unknown, ids: string[], firstZ: number, firstSource: FieldBackgroundSource) => {
    const entries = list(raw).map(record);
    if (entries.length !== ids.length) throw new Error("Unrecovered background transform parent chain");
    entries.forEach((entry, index) => {
      const src = provenance(entry.source, hostSources);
      if (src.file !== firstSource.file || src.serializedFile !== firstSource.serializedFile || src.objectId !== ids[index] ||
          entry.parentId !== (ids[index + 1] ?? "0") ||
          hash(entry.position) !== hash({ x: 0, y: 0, z: index === 0 ? firstZ : 0 }) ||
          hash(entry.rotation) !== hash({ x: 0, y: 0, z: 0, w: 1 }) || hash(entry.scale) !== hash({ x: 1, y: 1, z: 1 }))
        throw new Error("Unrecovered background transform provider");
    });
  };
  chain(host.rendererTransforms, ["9", "6", "7"], 0, field);
  chain(host.cameraTransforms, ["142", "108"], -50, camera);
  return { kind: "source-fresh-normal-background-host-v1", rendererWorld: { x: 0, y: 0 }, renderCamera: { x: 0, y: 0 },
    sources: [field, common, camera] };
}
export async function loadFieldBackgroundMedia(root: string, corpusSourceSetHash: string): Promise<{ media: FieldBackgroundMedia; verify: Verify }> {
  const files = await readSnapshot(root + "/build/field-background-media");
  const value = JSON.parse(snapshotFile(files, "media.json").toString("utf8"));
  if (value.formatVersion !== 1 || value.adapterVersion !== "field-background-0.1.0" ||
      value.parentSourceSetHash !== corpusSourceSetHash) throw new Error("Background media belongs to another corpus");
  return { media: value as FieldBackgroundMedia,
    verify: (file, digest) => { if (sha(snapshotFile(files, file)) !== digest) throw new Error("Background media digest mismatch"); } };
}
export function compileFieldBackgroundLayers(input: {
  sources: readonly { file: string; sha256: string }[]; tilemap: Asset;
  mapRange: { width: number; height: number }; loopType: number;
  media: FieldBackgroundMedia; verify: Verify;
}): { layers: FieldBackgroundLayer[]; blockers: { layerId: number; reason: string }[] } {
  const { sources, tilemap, mapRange, media, verify } = input;
  const map = record(tilemap.data), source = provenance(tilemap.source, sources);
  if (map.tilewidth !== 16 || map.tileheight !== 16 || map.orientation !== "orthogonal" || map.infinite === true ||
      !Number.isInteger(mapRange.width) || !Number.isInteger(mapRange.height) || mapRange.width <= 0 || mapRange.height <= 0)
    throw new Error("Unsupported background map geometry");
  const renderHost = provider(media, sources, verify);
  const layers: FieldBackgroundLayer[] = [], blockers: { layerId: number; reason: string }[] = [], ids = new Set<number>();
  for (const raw of list(map.layers)) {
    const layer = record(raw);
    if (layer.type !== "imagelayer") continue;
    const id = num(layer.id);
    if (!Number.isInteger(id) || ids.has(id)) throw new Error("Duplicate background layer identity"); ids.add(id);
    try {
      const p: Record<string, unknown> = {};
      for (const entry of list(layer.properties)) {
        const v = record(entry);
        if (typeof v.name !== "string" || Object.hasOwn(p, v.name)) throw new Error("Duplicate background property");
        p[v.name] = v.value;
      }
      // Init explicitly disables active=false scenery. Later ShowScenery is a
      // separate, still gated VM capability, not permission to display it now.
      if (p.active === false) continue;
      if (typeof layer.name !== "string" || !/^FarBGLayer[0-9]*$/.test(layer.name) || layer.visible !== true ||
          layer.opacity !== 1 || (layer.x ?? 0) !== 0 || (layer.y ?? 0) !== 0 || input.loopType !== 0)
        throw new Error("Background visibility, transform, foreground or map-loop provider is unresolved");
      const supported = new Set(["tex_asset_group", "width", "height", "h_center_width", "v_center_height", "h_manual_scroll",
        "v_manual_scroll", "h_manual_speed_scale", "v_manual_speed_scale", "h_left_width", "h_right_width", "v_top_height",
        "v_bottom_height", "h_speed", "v_speed", "screen_effect", "auto_scroll", "active", "blend_type", "asset_id", "front",
        "use_far_clip", "zero_clip", "opaque_shader", "transparent_shader", "pivot_type", "fit_screen_width", "fit_screen_height",
        "h_pivot_center", "v_pivot_middle"]);
      if (Object.keys(p).some((key) => !supported.has(key))) throw new Error("Custom background provider is unresolved");
      const defaults: Record<string, unknown> = { h_left_width: 0, h_right_width: 0, v_top_height: 0, v_bottom_height: 0,
        h_speed: 0, v_speed: 0, screen_effect: false, auto_scroll: false, active: true, blend_type: 0, asset_id: 0, front: false,
        use_far_clip: false, zero_clip: true, opaque_shader: "", transparent_shader: "", pivot_type: 0,
        fit_screen_width: false, fit_screen_height: false, h_pivot_center: false, v_pivot_middle: false };
      if (Object.entries(defaults).some(([key, value]) => Object.hasOwn(p, key) && p[key] !== value) ||
          p.h_manual_scroll !== true || p.v_manual_scroll !== true)
        throw new Error("Background borders, fixed scrolling, auto scroll or custom shader provider is unresolved");
      if (typeof p.tex_asset_group !== "string" || typeof layer.image !== "string") throw new Error("Missing background media reference");
      const rawImage = media.images[p.tex_asset_group]?.[posix.basename(layer.image)];
      if (!rawImage) throw new Error("Missing background source texture");
      const image = record(rawImage), sprite = provenance(image.source, sources), texture = provenance(image.textureSource, sources);
      if (posix.basename(sprite.assetPath) !== posix.basename(layer.image) || sprite.file !== texture.file ||
          !posix.basename(sprite.file).startsWith(p.tex_asset_group + "_assets_all_") ||
          image.filterMode !== 0 || hash(image.wrap) !== hash([0, 0]) || image.rowOrder !== "top-to-bottom" ||
          image.pixelsPerUnit !== 1 || hash(image.spriteRect) !== hash([0, 0, image.width, image.height]) ||
          p.h_center_width !== image.width || p.v_center_height !== image.height)
        throw new Error("Background full-texture center-repeat sampler is unresolved");
      if (typeof image.file !== "string" || image.file !== `textures/${image.sha256}.png` || typeof image.sha256 !== "string")
        throw new Error("Invalid background media identity");
      verify(image.file, image.sha256);
      const result: FieldBackgroundLayer = { kind: "native-center-repeat-background-v1", layerId: id, name: layer.name,
        source: { ...source }, mapSize: { width: mapRange.width * 16, height: mapRange.height * 16 },
        size: { width: num(p.width), height: num(p.height) }, offset: { x: num(layer.offsetx ?? 0), y: num(layer.offsety ?? 0) },
        manualSpeed: { x: num(p.h_manual_speed_scale ?? 1), y: num(p.v_manual_speed_scale ?? 1) },
        renderHost: structuredClone(renderHost),
        texture: { url: "/field-background-media/" + image.file, sha256: image.sha256,
          width: num(image.width), height: num(image.height), source: sprite, textureSource: texture } };
      validateFieldBackground(result); layers.push(result);
    } catch (error) { blockers.push({ layerId: id, reason: error instanceof Error ? error.message : String(error) }); }
  }
  return { layers, blockers };
}

/** Provider catalog only. It does not replace compileFieldBackgroundLayers'
 * strict native diagnostics or authorize a runtime. All original image-layer
 * properties remain bound through their complete tilemap source identity. */
export function compileFlatFieldScenery(input: {
  sources: readonly { file: string; sha256: string }[]; tilemap: Asset;
  sourceSetHash: string; parentSourceSetHash: string; media: FieldBackgroundMedia; verify: Verify;
}): FieldSceneryCatalog {
  const source = provenance(input.tilemap.source, input.sources), map=record(input.tilemap.data);
  if(input.media.parentSourceSetHash!==input.sourceSetHash || hash(input.media.sources)!==input.media.sourceSetHash) throw new Error("Foreign scenery media/source set");
  const result:FieldSceneryCatalog={kind:"web-flat-field-scenery-v1",sourceSetHash:input.sourceSetHash,parentSourceSetHash:input.parentSourceSetHash,layers:[],unresolved:[]};
  for(const raw of list(map.layers)) {
    const l=record(raw);if(l.type!=="imagelayer"||typeof l.name!=="string")continue;
    const match=/^(Far|Near)BGLayer([1-9][0-9]*)$/.exec(l.name);if(!match)continue;
    const id=Number(match[2]),scenery=match[1]==="Far"?1 as const:3 as const;
    try {
      const p:Record<string,unknown>={};for(const raw of list(l.properties)){const v=record(raw);if(typeof v.name!=="string"||Object.hasOwn(p,v.name))throw new Error("Ambiguous scenery property");p[v.name]=v.value;}
      const bool=(name:string,fallback:boolean)=>{const value=p[name]??fallback;if(typeof value!=="boolean")throw new Error("Invalid scenery "+name);return value;};
      if(l.visible!==true||l.opacity!==1||(l.x??0)!==0||(l.y??0)!==0)throw new Error("Scenery transform/visibility provider is unresolved");
      if(bool("screen_effect",false)||num(p.asset_id??0)!==0)throw new Error("Scenery requires the independent particle/effect provider");
      if(typeof p.tex_asset_group!=="string"||typeof l.image!=="string"||!l.image)throw new Error("Missing source scenery texture reference");
      const rawImage=input.media.images[p.tex_asset_group]?.[posix.basename(l.image)];if(!rawImage)throw new Error("Missing exact source scenery image");
      const image=record(rawImage),sprite=provenance(image.source,input.sources),texture=provenance(image.textureSource,input.sources);
      if(posix.basename(sprite.assetPath)!==posix.basename(l.image)||sprite.file!==texture.file||!posix.basename(sprite.file).startsWith(p.tex_asset_group+"_assets_all_")||image.filterMode!==0||image.rowOrder!=="top-to-bottom"||image.pixelsPerUnit!==1||hash(image.spriteRect)!==hash([0,0,image.width,image.height]))throw new Error("Scenery image sampler/identity is unresolved");
      if(typeof image.sha256!=="string"||image.file!==`textures/${image.sha256}.png`)throw new Error("Invalid scenery media digest");input.verify(String(image.file),image.sha256);
      const blend=num(p.blend_type??0);if(![0,1,2].includes(blend))throw new Error("Scenery blend mode is unresolved");
      const layer:FieldSceneryLayer={id,scenery,name:l.name,source:{...source},active:bool("active",true),autoScroll:bool("auto_scroll",false),speed:{x:num(p.h_speed??0),y:num(p.v_speed??0)},
        size:{width:num(p.width),height:num(p.height)},offset:{x:num(l.offsetx??0),y:num(l.offsety??0)},manualSpeed:{x:bool("h_manual_scroll",false)?num(p.h_manual_speed_scale??1):0,y:bool("v_manual_scroll",false)?num(p.v_manual_speed_scale??1):0},blend:blend as 0|1|2,
        texture:{url:"/field-background-media/"+image.file,sha256:image.sha256,width:num(image.width),height:num(image.height),source:sprite,textureSource:texture}};
      result.layers.push(layer);
    }catch(error){result.unresolved.push({id,scenery,reason:error instanceof Error?error.message:String(error),source:{...source}});}
  }
  validateFieldSceneryCatalog(result);return result;
}

export type FieldSceneryWorldCatalog = {kind:"source-flat-field-scenery-world-v1";sourceSetHash:string;parentSourceSetHash:string;mediaSourceSetHash:string;maps:Record<string,FieldSceneryCatalog>;contentHash:string};
/** Pure, complete source provider compilation. No world candidate, package or
 * public output is built. Used by v14's explicitly authorized metadata upgrade. */
export async function loadFieldSceneryWorldCatalog(root:string):Promise<FieldSceneryWorldCatalog> {
  const corpus=await loadCorpus(root),media=await loadFieldBackgroundMedia(root,corpus.sourceSetHash),byId=new Map(corpus.assets.map(a=>[a.id,a])),maps:Record<string,FieldSceneryCatalog>={};
  const sources=list(corpus.manifest.sources).map(record).map(s=>({file:String(s.file),sha256:String(s.sha256)}));
  for(const binding of bindMapPackages(corpus.assets,corpus.tables)) {
    const tile=byId.get(binding.tilemap??"");if(!tile)continue;
    maps[binding.id]=compileFlatFieldScenery({sources,tilemap:{data:tile.data,source:{...tile.source,objectId:String(tile.source.objectId)}},sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:String(corpus.manifest.parentSourceSetHash),...media});
  }
  const body={kind:"source-flat-field-scenery-world-v1" as const,sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:String(corpus.manifest.parentSourceSetHash),mediaSourceSetHash:media.media.sourceSetHash,maps};
  return {...body,contentHash:hash(body)};
}
export function verifyFieldSceneryWorldCatalog(raw:FieldSceneryWorldCatalog):void {
  const {contentHash,...body}=raw;
  if(raw.kind!=="source-flat-field-scenery-world-v1"||hash(body)!==contentHash||![raw.sourceSetHash,raw.parentSourceSetHash,raw.mediaSourceSetHash].every(s=>/^[a-f0-9]{64}$/.test(s)))throw new Error("Invalid source scenery world catalog");
  for(const [id,catalog]of Object.entries(raw.maps)){if(!/^[1-9][0-9]*$/.test(id)||catalog.sourceSetHash!==raw.sourceSetHash||catalog.parentSourceSetHash!==raw.parentSourceSetHash)throw new Error("Foreign scenery map identity");validateFieldSceneryCatalog(catalog);}
}
