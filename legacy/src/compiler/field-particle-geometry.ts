import { record } from "./content.js";
import { compileFieldEffectMedia } from "./field-effects.js";
import { compileFieldParticleMaterial, compileFieldParticleModules } from "./field-particles.js";
import { FIELD_EFFECT_BOARD_PROGRAMS, FIELD_PARTICLE_VERTEX, FIELD_PARTICLE_GEOMETRY_REQUIREMENTS, fieldEffectBoardSources,
  validateFieldEffectBoardMaterial, validateFieldParticleGeometry, validateFieldParticleRendering,
  type FieldEffectBoardMaterial, type FieldParticleGeometry, type FieldParticleRendering,
  type FieldParticleSource, type ParticleTransform, type ParticleVector } from "../core/field-particle-geometry.js";

const array = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error("Missing particle geometry array"); return v; };
const number = (v: unknown): number => { if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Invalid particle geometry number"); return v; };
const id = (v: unknown): string => { if (typeof v !== "string" || !/^-?\d+$/.test(v)) throw new Error("Unpreserved particle object ID"); return v; };
function source(v: unknown): FieldParticleSource {
  const s = record(v);
  for (const k of ["file", "assetPath", "serializedFile"]) if (typeof s[k] !== "string" || !s[k]) throw new Error("Missing geometry source identity");
  if (typeof s.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(s.sha256)) throw new Error("Missing geometry source hash");
  return { file: String(s.file), assetPath: String(s.assetPath), serializedFile: String(s.serializedFile), objectId: id(s.objectId), sha256: s.sha256 };
}
function vector(v: unknown): ParticleVector { const a = record(v); return { x: number(a.x), y: number(a.y), z: number(a.z) }; }
function exact(value: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error(message);
}
/** Serializes the actual renderer/camera constraints. Success establishes
 * source inputs, not the missing Unity engine billboard/raster providers. */
export function compileFieldParticleGeometry(assetGroup: string, raw: unknown, dependencies: unknown): FieldParticleGeometry {
  const media = compileFieldEffectMedia(assetGroup, raw), material = compileFieldParticleMaterial(assetGroup, dependencies);
  const input = record(raw), hierarchy = new Set(array(input.hierarchyIds).map(id));
  const all = new Map(array(input.objects).map((v) => { const o = record(v); return [id(record(o.source).objectId), o] as const; }));
  const find = (type: string) => { const found = [...all.values()].filter((o) => o.type === type && hierarchy.has(id(record(o.source).objectId)));
    if (found.length !== 1) throw new Error("Ambiguous particle geometry " + type); return found[0]!; };
  const renderer = find("ParticleSystemRenderer"), particle = find("ParticleSystem"), camera = find("Camera");
  const rd = record(renderer.data), pd = record(particle.data), cd = record(camera.data);
  const local = (value: unknown, type: string) => { const p = record(value);
    if (p.m_FileID !== 0) throw new Error("External particle transform");
    const o = all.get(id(p.m_PathID)); if (!o || o.type !== type || !hierarchy.has(id(p.m_PathID))) throw new Error("Unbound particle transform"); return o; };
  const chain = (component: Record<string, unknown>): ParticleTransform[] => {
    const go = local(component.m_GameObject, "GameObject"), components = array(record(go.data).m_Component).map(record);
    const transforms = components.map((c) => all.get(id(record(c.component).m_PathID))).filter((o) => o?.type === "Transform");
    if (transforms.length !== 1) throw new Error("Ambiguous particle component transform");
    const result: ParticleTransform[] = [], seen = new Set<string>(); let next = transforms[0]!;
    while (true) {
      const objectId = id(record(next.source).objectId); if (seen.has(objectId)) throw new Error("Cyclic particle transform chain"); seen.add(objectId);
      const t = record(next.data), q = record(t.m_LocalRotation);
      result.unshift({ position: vector(t.m_LocalPosition), rotation: { ...vector(q), w: number(q.w) }, scale: vector(t.m_LocalScale) });
      const parent = record(t.m_Father);
      if (parent.m_FileID === 0 && parent.m_PathID === "0") {
        if (record(t.m_GameObject).m_PathID !== input.rootId) throw new Error("Particle hierarchy escaped EffectPrefab");
        break;
      }
      next = local(parent, "Transform");
    }
    return result;
  };
  const expectedRenderer: Record<string, unknown> = { m_Enabled: true, m_RenderMode: 0, m_RenderAlignment: 0, m_AllowRoll: true,
    m_MinParticleSize: 0, m_MaxParticleSize: 0.5, m_SortMode: 0, m_SortingFudge: 0, m_SortingLayer: 0, m_SortingLayerID: 0,
    m_SortingOrder: 0, m_RendererPriority: 0, m_UseCustomVertexStreams: false, m_NormalDirection: 1,
    m_CameraVelocityScale: 0, m_VelocityScale: 0, m_CastShadows: 0, m_ReceiveShadows: 0,
    m_LightProbeUsage: 0, m_ReflectionProbeUsage: 0, m_MaskInteraction: 0, m_ApplyActiveColorSpace: true };
  for (const [key, expected] of Object.entries(expectedRenderer)) if (rd[key] !== expected) throw new Error("Unrecovered particle renderer " + key);
  for (const key of ["m_Mesh", "m_Mesh1", "m_Mesh2", "m_Mesh3", "m_ProbeAnchor", "m_LightProbeVolumeOverride"])
    exact(rd[key], { m_FileID: 0, m_PathID: "0" }, "Unrecovered particle renderer object provider");
  if (pd.moveWithTransform !== 0 || pd.scalingMode !== 0 || record(rd.m_GameObject).m_PathID !== record(pd.m_GameObject).m_PathID)
    throw new Error("Particle simulation/renderer transform identity mismatch");
  for (const [key, expected] of Object.entries({ orthographic: true, m_projectionMatrixMode: 1, m_ClearFlags: 2,
    m_Enabled: 1, m_Depth: 0, m_HDR: false, m_AllowMSAA: false, m_AllowDynamicResolution: false, m_OcclusionCulling: false, m_TargetDisplay: 0 }))
    if (cd[key] !== expected) throw new Error("Unrecovered source particle camera " + key);
  const viewport = record(cd.m_NormalizedViewPortRect), clear = record(cd.m_BackGroundColor);
  const result: FieldParticleGeometry = { kind: "source-field-particle-geometry-v1", assetGroup, source: source(input.source),
    sources: [source(particle.source), source(renderer.source), source(camera.source), ...chainSources()],
    emitter: { id: id(record(particle.source).objectId), transforms: chain(pd), simulationSpace: 0, scalingMode: 0 },
    renderer: { id: id(record(renderer.source).objectId), mode: 0, alignment: 0, allowRoll: true, minSize: 0, maxSize: 0.5,
      pivot: vector(rd.m_Pivot), flip: vector(rd.m_Flip), sortMode: 0, vertexStreams: array(rd.m_VertexStreams).map(number) as [0, 1, 3, 4] },
    camera: { id: id(record(camera.source).objectId), transforms: chain(cd), orthographicSize: number(cd["orthographic size"]),
      viewport: [number(viewport.x), number(viewport.y), number(viewport.width), number(viewport.height)] as [0, 0, 1, 1],
      near: number(cd["near clip plane"]), far: number(cd["far clip plane"]),
      clear: [number(clear.r), number(clear.g), number(clear.b), number(clear.a)], mask: 16384 },
    target: { width: media.renderTexture.width, height: media.renderTexture.height, filterMode: 0, wrapMode: 1,
      requestedColorFormat: 0, requestedSRGB: true, depthBits: 0, msaaSamples: 1 }, vertexSha256: material.vertexSha256,
    requirements: [...FIELD_PARTICLE_GEOMETRY_REQUIREMENTS] };
  function chainSources(): FieldParticleSource[] {
    const d = record(dependencies), mat = record(record(d.materials)[assetGroup]), shader = record(record(d.shaders)[String(mat.shader)]);
    return [source(shader.source), ...[...all.values()].filter((o) => o.type === "Transform" && hierarchy.has(id(record(o.source).objectId))).map((o) => source(o.source))];
  }
  if (result.vertexSha256 !== FIELD_PARTICLE_VERTEX) throw new Error("Unrecovered source particle vertex program");
  validateFieldParticleGeometry(result); return result;
}

/** Qualifies the recovered ordinary engine template and target format. A
 * live effectRoot transform and live particle state remain explicit inputs;
 * this does not qualify an emitter's birth, Noise or lifetime owner. */
export function compileFieldParticleRendering(assetGroup: string, raw: unknown, dependencies: unknown,
  geometryExport: unknown): FieldParticleRendering {
  const geometry = compileFieldParticleGeometry(assetGroup, raw, dependencies);
  compileFieldParticleModules(assetGroup, raw);
  const input = record(raw), all = array(input.objects).map(record), hierarchy = new Set(array(input.hierarchyIds).map(id));
  const particles = all.filter((o) => o.type === "ParticleSystem" && hierarchy.has(id(record(o.source).objectId)));
  if (particles.length !== 1) throw new Error("Unbound particle render branch");
  const p = record(particles[0]!.data);
  if (record(p.InitialModule).rotation3D !== false || record(p.InitialModule).size3D !== false || record(p.UVModule).enabled !== false)
    throw new Error("Unrecovered particle geometry template inputs");
  const exported = record(geometryExport), dependenciesRoot = record(dependencies);
  if (exported.parentSourceSetHash !== dependenciesRoot.parentSourceSetHash ||
      typeof exported.parentSourceSetHash !== "string") throw new Error("Foreign particle entity dependency snapshot");
  compileFieldEffectBoardMaterial(geometryExport);
  const entity = record(exported.particleEntity), go = record(entity.gameObject), transform = record(entity.transform);
  const ed = record(entity.data), gd = record(go.data), td = record(transform.data);
  const entitySource = source(entity.source), goSource = source(go.source), transformSource = source(transform.source);
  const ptr = (objectId: string) => ({ m_FileID: 0, m_PathID: objectId });
  exact(ed.m_GameObject, ptr(goSource.objectId), "Particle entity GameObject binding mismatch");
  exact(td.m_GameObject, ptr(goSource.objectId), "Particle Transform GameObject binding mismatch");
  exact(td.m_Father, ptr("0"), "Particle entity prefab has an unresolved parent");
  exact(td.m_Children, [], "Unexpected particle entity prefab child");
  exact(array(gd.m_Component).map((c) => record(c).component), [ptr(transformSource.objectId), ptr(entitySource.objectId)],
    "Unrecovered particle entity components");
  if (gd.m_IsActive !== true || gd.m_Layer !== 0) throw new Error("Unrecovered particle entity activation/layer");
  const manifest = array(exported.sources).map(record);
  for (const s of [entitySource, goSource, transformSource])
    if (manifest.filter((entry) => entry.file === s.file && entry.sha256 === s.sha256).length !== 1)
      throw new Error("Unbound particle entity source manifest");
  const settings = record(dependenciesRoot.settings), ss = record(settings.source), q = record(td.m_LocalRotation);
  if (settings.type !== "PlayerSettings" || settings.activeColorSpace !== 0) throw new Error("Unrecovered active particle color space");
  const result: FieldParticleRendering = { kind: "source-field-particle-rendering-v1", geometry,
    engine: "unity-2019.4.20f1-generate-0-0-0-0",
    colorSpace: { active: 0, source: { file: String(ss.file), serializedFile: String(ss.serializedFile),
      objectId: id(ss.objectId), sha256: String(ss.sha256) } },
    entity: { source: entitySource, gameObject: goSource, transform: transformSource, parent: null,
      local: { position: vector(td.m_LocalPosition), rotation: { ...vector(q), w: number(q.w) }, scale: vector(td.m_LocalScale) } },
    material: compileFieldParticleMaterial(assetGroup, dependencies),
    target: { graphicsFormat: 8, encoding: "rgba8-unorm", depthAttachment: null, samples: 1 } };
  validateFieldParticleRendering(result); return result;
}

/** Locks the particle entity→original material→shader chain, plus the exact
 * two pass states. Texture contents are a separate runtime RT provider. */
export function compileFieldEffectBoardMaterial(raw: unknown): FieldEffectBoardMaterial {
  const d = record(raw), entity = record(d.particleEntity), material = record(d.material), shader = record(d.shader);
  if (d.formatVersion !== 1) throw new Error("Unknown field particle geometry export format");
  const refs = [source(entity.source), source(material.source), source(shader.source)], expected = fieldEffectBoardSources();
  for (let i = 0; i < expected.length; i++) for (const [key, value] of Object.entries(expected[i]!))
    if ((refs[i] as unknown as Record<string, unknown>)[key] !== value) throw new Error("Foreign field effect board dependency");
  const sources = array(d.sources).map(record);
  for (const ref of refs) if (sources.filter((s) => s.file === ref.file && s.sha256 === ref.sha256).length !== 1)
    throw new Error("Unbound field effect board source set");
  const verifyPointer = (owner: Record<string, unknown>, pointer: unknown, target: FieldParticleSource) => {
    const p = record(pointer), external = array(owner.externals);
    if (p.m_PathID !== target.objectId || !Number.isSafeInteger(p.m_FileID) || Number(p.m_FileID) < 1 ||
        String(external[Number(p.m_FileID) - 1]).split("/").at(-1) !== target.serializedFile)
      throw new Error("Broken field particle material pointer");
  };
  verifyPointer(entity, record(entity.data).originalEffectMaterial, expected[1]!);
  const md = record(material.data); verifyPointer(material, md.m_Shader, expected[2]!);
  if (shader.name !== "Last/FieldEffectEntityShader" || md.m_ShaderKeywords !== "" || md.m_CustomRenderQueue !== -1 ||
      array(md.disabledShaderPasses).length) throw new Error("Unknown field board shader variant");
  const saved = record(md.m_SavedProperties), pairs = (raw: unknown) => {
    const result = new Map<string, unknown>();
    for (const v of array(raw)) {
      const a = array(v); if (a.length !== 2 || typeof a[0] !== "string" || result.has(a[0])) throw new Error("Invalid board material property");
      result.set(a[0], a[1]);
    }
    return result;
  };
  const textures = pairs(saved.m_TexEnvs), texture = record(textures.get("_MainTex"));
  exact(texture.m_Texture, { m_FileID: 0, m_PathID: "0" }, "Unbound initial particle RT");
  const scale = record(texture.m_Scale), offset = record(texture.m_Offset);
  const passes = array(shader.passes).map(record);
  if (passes.length !== 2) throw new Error("Unknown board shader pass count");
  const hashes = [FIELD_EFFECT_BOARD_PROGRAMS.opaque, FIELD_EFFECT_BOARD_PROGRAMS.color];
  for (let n = 0; n < passes.length; n++) {
    const p = passes[n]!, programs = record(p.programs), state = record(p.state), blend = record(state.rtBlend0), stencil = record(state.stencilOp);
    if (record(programs.progVertex).sha256 !== FIELD_EFFECT_BOARD_PROGRAMS.vertex || record(programs.progFragment).sha256 !== hashes[n])
      throw new Error("Unrecovered board shader bytecode");
    for (const [key, value] of [["zWrite", n === 0 ? 1 : 0], ["culling", 0], ["zClip", 1], ["alphaToMask", 0],
      ["offsetFactor", 0], ["offsetUnits", 0], ["stencilReadMask", 255], ["stencilWriteMask", 255]] as const)
      if (record(state[key]).val !== value) throw new Error("Unrecovered board render state " + key);
    if (record(state.zTest).name !== "_ZTestCmpFunc" || record(state.stencilRef).name !== "_StencilRef" ||
        record(stencil.pass).val !== 2 || record(stencil.comp).val !== 8 || record(stencil.fail).val !== 0 || record(stencil.zFail).val !== 0 ||
        state.rtSeparateBlend !== false || record(blend.colMask).val !== 15 || record(blend.blendOp).val !== 0 || record(blend.blendOpAlpha).val !== 0)
      throw new Error("Unknown board depth/stencil/blend provider");
    for (const key of ["srcBlend", "srcBlendAlpha"]) if (record(blend[key]).name !== "_SrcBlend") throw new Error("Unknown source blend binding");
    for (const key of ["destBlend", "destBlendAlpha"]) if (record(blend[key]).name !== "_DstBlend") throw new Error("Unknown destination blend binding");
  }
  const result: FieldEffectBoardMaterial = { kind: "source-field-effect-board-material-v1", sources: refs,
    vertexSha256: FIELD_EFFECT_BOARD_PROGRAMS.vertex, fragments: [FIELD_EFFECT_BOARD_PROGRAMS.opaque, FIELD_EFFECT_BOARD_PROGRAMS.color],
    uvScale: [number(scale.x), number(scale.y)] as [1, 1], uvOffset: [number(offset.x), number(offset.y)] as [0, 0], vertexColor: [1, 1, 1, 1] };
  validateFieldEffectBoardMaterial(result); return result;
}
