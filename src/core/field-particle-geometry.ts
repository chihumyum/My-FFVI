import type { FieldActorViewSource } from "./field-actor-view.js";
import { sampleFieldParticleTexture, shadeFieldParticle,
  type FieldParticleMaterial, type FieldParticleTexture } from "./field-particles.js";
export type FieldParticleSource = FieldActorViewSource & { serializedFile: string };

export type ParticleVector = { x: number; y: number; z: number };
export type ParticleColor = readonly [number, number, number, number];
/** Column-major matrix, matching the recovered DXBC constant-buffer vectors. */
export type ParticleMatrix = readonly number[];
export type ParticleTransform = { position: ParticleVector; rotation: ParticleVector & { w: number }; scale: ParticleVector };
export type FieldParticleGeometry = {
  kind: "source-field-particle-geometry-v1";
  assetGroup: string;
  source: FieldParticleSource;
  sources: FieldParticleSource[];
  emitter: { id: string; transforms: ParticleTransform[]; simulationSpace: 0; scalingMode: 0 };
  renderer: { id: string; mode: 0; alignment: 0; allowRoll: true; minSize: 0; maxSize: 0.5;
    pivot: ParticleVector; flip: ParticleVector; sortMode: 0; vertexStreams: readonly [0, 1, 3, 4] };
  camera: { id: string; transforms: ParticleTransform[]; orthographicSize: number;
    viewport: readonly [0, 0, 1, 1]; near: number; far: number; clear: ParticleColor; mask: 16384 };
  target: { width: number; height: number; filterMode: 0; wrapMode: 1;
    requestedColorFormat: 0; requestedSRGB: true; depthBits: 0; msaaSamples: 1 };
  vertexSha256: string;
  /** The vertex shader does not generate these inputs. Keep the engine
   * providers separate from the source-bound camera and vertex transform. */
  requirements: readonly string[];
};
export type FieldEffectBoardMaterial = {
  kind: "source-field-effect-board-material-v1";
  sources: FieldParticleSource[];
  vertexSha256: string;
  fragments: readonly [string, string];
  uvScale: readonly [1, 1]; uvOffset: readonly [0, 0];
  vertexColor: readonly [1, 1, 1, 1];
};
export const FIELD_EFFECT_BOARD_PROGRAMS = {
  vertex: "573bb1f1dd55909d7e1389b9994c51bd718fcba2039716092899941d4fc5329a",
  opaque: "8d8ce3d84a26de0a2fc2be48649ab767a854a39e5f14ec6ec3e20dfe34c7d7f0",
  color: "4f287a0bbadbaeed64349e4850be00865a71adedce2ea3b12901032d43ac6bd3",
} as const;
export const FIELD_PARTICLE_VERTEX = "cc1c31f410babbf1d6f7cc837871cc885019379db245a8273bfb8f69c64fbdad";
export const FIELD_PARTICLE_GEOMETRY_REQUIREMENTS = [
  "Unity engine billboard generation, size clamp and vertex packing",
  "Particle geometry draw order",
  "Source GPU view-projection and render-target color encoding",
] as const;

export type FieldParticleRendering = {
  kind: "source-field-particle-rendering-v1";
  geometry: FieldParticleGeometry;
  engine: "unity-2019.4.20f1-generate-0-0-0-0";
  colorSpace: { active: 0; source: { file: string; serializedFile: string; objectId: string; sha256: string } };
  entity: { source: FieldParticleSource; gameObject: FieldParticleSource; transform: FieldParticleSource;
    local: ParticleTransform; parent: null };
  material: FieldParticleMaterial;
  target: { graphicsFormat: 8; encoding: "rgba8-unorm"; depthAttachment: null; samples: 1 };
};
/** Live SoA order is retained. Color is the RenderJob's final Color32, not
 * ParticleSystemParticles' seed buffer. Rotation is already in radians. */
export type FieldParticleRenderParticle = {
  position: ParticleVector; size: number; rotation: number; color32: number; normalizedAge: number;
};
export type FieldParticleRenderVertex = { position: ParticleVector; uv: readonly [number, number]; color: ParticleColor };
export type FieldParticleRenderQuad = { particleIndex: number; vertices: readonly [FieldParticleRenderVertex,
  FieldParticleRenderVertex, FieldParticleRenderVertex, FieldParticleRenderVertex] };
export type FieldParticleGeometryProjection = {
  quads: FieldParticleRenderQuad[]; cameraPosition: ParticleVector;
  triangles: readonly [0, 1, 2, 0, 2, 3];
};
export type FieldParticleSampledTarget = {
  kind: "field-effect-sampled-rt-v1"; assetGroup: string; cameraId: string; width: number; height: number;
  sampleEncoding: "rgba8-unorm"; rowOrder: "top-to-bottom"; data: Uint8ClampedArray;
};
export function fieldEffectBoardSources(): FieldParticleSource[] {
  const prefix = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/";
  const chara = { file: prefix + "chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle",
    serializedFile: "CAB-d1df3dff5bf4397afeca5b474487624e", sha256: "82befd5fd3adeed5c8055c90a9aa3b8a09837be9094f9677d33ead3cbf3a0daa" };
  return [{ ...chara, assetPath: "Assets/GameAssets/Common/Res/Map/Field/FieldEffectParticleEntity.prefab", objectId: "7463410764001888351" },
    { file: prefix + "map_common_assets_all_320e510e7137e96ac91fe79e18fdd504.bundle", serializedFile: "CAB-1644f96325fca0ef593af05ebed59f7c",
      sha256: "c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a",
      assetPath: "Assets/GameAssets/Common/Res/Map/Common/FieldEffectRenderTextureMaterial.mat", objectId: "-3234337586096406338" },
    { ...chara, assetPath: "Assets/GameAssets/Common/Res/Map/Field/FieldEffectEntityShader.shader", objectId: "-6480062259712071634" }];
}
const f = Math.fround;
function finite(n: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(f(n))) throw new Error("Invalid source particle geometry number");
  return f(n);
}
function vector(v: ParticleVector): void { if (!v) throw new Error("Missing particle vector"); finite(v.x); finite(v.y); finite(v.z); }
function color(c: ParticleColor): void {
  if (!Array.isArray(c) || c.length !== 4 || c.some((n) => !Number.isFinite(n) || n < 0 || n > 1))
    throw new Error("Invalid field effect color");
}
function matrix(m: ParticleMatrix): void {
  if (!Array.isArray(m) || m.length !== 16) throw new Error("Unbound particle matrix");
  m.forEach(finite);
}
function identity(source: FieldParticleSource): void {
  if (!source?.file || !source.assetPath || !source.serializedFile || !/^-?\d+$/.test(source.objectId) ||
      !/^[0-9a-f]{64}$/.test(source.sha256)) throw new Error("Unbound particle geometry source");
}
export function validateFieldParticleGeometry(g: FieldParticleGeometry): void {
  if (g?.kind !== "source-field-particle-geometry-v1" || !g.assetGroup || g.vertexSha256 !== FIELD_PARTICLE_VERTEX ||
      !Array.isArray(g.sources) || g.sources.length < 4 ||
      JSON.stringify(g.requirements) !== JSON.stringify(FIELD_PARTICLE_GEOMETRY_REQUIREMENTS)) throw new Error("Unbound source particle geometry");
  identity(g.source); g.sources.forEach(identity);
  if (g.emitter.simulationSpace !== 0 || g.emitter.scalingMode !== 0 || g.renderer.mode !== 0 || g.renderer.alignment !== 0 ||
      g.renderer.allowRoll !== true || g.renderer.minSize !== 0 || g.renderer.maxSize !== 0.5 || g.renderer.sortMode !== 0 ||
      JSON.stringify(g.renderer.vertexStreams) !== "[0,1,3,4]") throw new Error("Unrecovered particle renderer mode");
  for (const v of [g.renderer.pivot, g.renderer.flip]) { vector(v); if (v.x || v.y || v.z) throw new Error("Unrecovered particle pivot/flip"); }
  for (const chain of [g.emitter.transforms, g.camera.transforms]) {
    if (!Array.isArray(chain) || !chain.length) throw new Error("Unbound particle transform hierarchy");
    for (const t of chain) { vector(t.position); vector(t.rotation); finite(t.rotation.w); vector(t.scale); }
  }
  const c = g.camera, t = g.target;
  if (c.orthographicSize <= 0 || c.near <= 0 || c.far <= c.near || JSON.stringify(c.viewport) !== "[0,0,1,1]" ||
      c.mask !== 16384) throw new Error("Unrecovered particle camera");
  [c.orthographicSize, c.near, c.far].forEach(finite); color(c.clear);
  if (!Number.isSafeInteger(t.width) || t.width !== t.height || t.width !== Math.trunc(f(2 * c.orthographicSize)) ||
      t.width <= 0 || t.width > 2048 || t.filterMode !== 0 || t.wrapMode !== 1 || t.requestedColorFormat !== 0 ||
      t.requestedSRGB !== true || t.depthBits !== 0 || t.msaaSamples !== 1) throw new Error("Unrecovered particle render target");
}
export function assertFieldParticleGeometryExecutable(g: FieldParticleGeometry): void {
  validateFieldParticleGeometry(g);
  if (g.requirements.length) throw new Error("Native particle geometry unavailable: " + g.requirements.join("; "));
}

const settingSource = { file: "FINAL FANTASY VI_Data/globalgamemanagers", serializedFile: "globalgamemanagers",
  objectId: "1", sha256: "bc33b3eaaab47d14fbbf792f5bcc664c7e2f4787376449306739bce658dc7881" };
function unitTransform(t: ParticleTransform, rotateZ: boolean): void {
  if (!t) throw new Error("Missing source particle parent transform");
  vector(t.position); vector(t.rotation); vector(t.scale); finite(t.rotation.w);
  if (t.scale.x !== 1 || t.scale.y !== 1 || t.scale.z !== 1 || t.rotation.x !== 0 || t.rotation.y !== 0 ||
      (!rotateZ && (t.rotation.z !== 0 || t.rotation.w !== 1)) ||
      Math.abs(f(f(t.rotation.z * t.rotation.z) + f(t.rotation.w * t.rotation.w)) - 1) > 1e-6)
    throw new Error("Unrecovered particle transform scale/rotation");
}
export function validateFieldParticleRendering(d: FieldParticleRendering): void {
  if (d?.kind !== "source-field-particle-rendering-v1" || d.engine !== "unity-2019.4.20f1-generate-0-0-0-0")
    throw new Error("Missing source particle rendering provider");
  validateFieldParticleGeometry(d.geometry);
  if (d.colorSpace?.active !== 0 || Object.entries(settingSource).some(([k, v]) =>
      (d.colorSpace.source as unknown as Record<string, unknown>)?.[k] !== v)) throw new Error("Unbound particle Gamma settings");
  if (d.target?.graphicsFormat !== 8 || d.target.encoding !== "rgba8-unorm" || d.target.depthAttachment !== null || d.target.samples !== 1)
    throw new Error("Unrecovered particle target storage/depth");
  const e = d.entity, expected = fieldEffectBoardSources()[0]!;
  if (!e || e.parent !== null) throw new Error("Unbound source particle entity prefab");
  for (const [s, objectId] of [[e.source, expected.objectId], [e.gameObject, "4232085036942990611"],
    [e.transform, "-8226728852999962409"]] as const) {
    identity(s);
    for (const key of ["file", "assetPath", "serializedFile", "sha256"] as const)
      if (s[key] !== expected[key]) throw new Error("Foreign particle entity transform source");
    if (s.objectId !== objectId) throw new Error("Foreign particle entity object identity");
  }
  unitTransform(e.local, false);
  if (e.local.position.x || e.local.position.y || e.local.position.z) throw new Error("Unrecovered particle prefab position");
  d.geometry.emitter.transforms.forEach((t) => unitTransform(t, true));
  d.geometry.camera.transforms.forEach((t) => unitTransform(t, false));
  for (const chain of [d.geometry.emitter.transforms, d.geometry.camera.transforms])
    for (const t of chain.slice(0, -1))
      if (t.position.x || t.position.y || t.position.z || t.rotation.z || t.rotation.w !== 1)
        throw new Error("Unrecovered particle ancestor matrix composition");
  const m = d.material;
  if (m?.kind !== "field-particle-material-v1" || m.colorSpace !== "gamma" || m.vertexSha256 !== FIELD_PARTICLE_VERTEX ||
      m.fragmentSha256 !== "75c814aca4b802512f88f5c9c6ea4cef7d925c3cb4c5d39fd59e55e8490754ff" ||
      JSON.stringify(m.blend) !== JSON.stringify({ source: 1, destination: 10, depthWrite: false, depthTest: 4, colorMask: 15, cull: 0 }))
    throw new Error("Unbound source particle material program");
}

/** Source SIMD cosine/sine approximation, including cvtps2dq nearest-even.
 * Math.sin/cos and remainder-based wrapping are observably different. */
export function sourceFieldParticleSinCos(radians: number): { sin: number; cos: number } {
  const turns = f(finite(radians) * f(0.15915493667125702));
  // cvtps2dq is only defined in this translated branch for finite int32 input.
  if (Math.abs(turns) >= 0x7fffffff) throw new Error("Particle rotation exceeds source SIMD integer domain");
  const polynomial = (x: number) => {
    const u = f(0.25 - Math.abs(f(x - roundEven(x)))), u2 = f(u * u), u4 = f(u2 * u2);
    let y = f(f(f(-76.56861877441406 * u2) + f(81.60182189941406)) * u4);
    y = f(y + f(f(-41.34165954589844 * u2) + f(6.283185005187988)));
    y = f(y + f(f(u4 * u4) * f(39.65703201293945)));
    return f(y * u);
  };
  return { cos: polynomial(turns), sin: polynomial(f(turns - 0.25)) };
}

/** Matrix4x4.SetTRS/QuaternionToMatrix ordinary Z-rotation branch. The
 * serialized quaternion is used as-is; it is never converted via Euler angles. */
function transformPoint(v: ParticleVector, t: ParticleTransform): ParticleVector {
  const z2 = f(t.rotation.z + t.rotation.z), zz = f(t.rotation.z * z2), wz = f(t.rotation.w * z2);
  const diagonal = f(1 - zz);
  // d5cc79..d5cc7f adds translation to Z, then Y, then X. Reassociating
  // translation to the end changes real rotated emitter coordinates by 1 ULP.
  return { x: f(f(v.x * diagonal) + f(f(v.y * -wz) + t.position.x)),
    y: f(f(v.x * wz) + f(f(v.y * diagonal) + t.position.y)), z: f(v.z + t.position.z) };
}
function transformChain(v: ParticleVector, chain: readonly ParticleTransform[], parent: ParticleTransform): ParticleVector {
  // All admitted ancestors are identity and the explicit root has unit basis.
  // Fold its translation into the source matrix before transforming the point.
  const local = chain.at(-1)!;
  return transformPoint(v, { ...local, position: { x: f(parent.position.x + local.position.x),
    y: f(parent.position.y + local.position.y), z: f(parent.position.z + local.position.z) } });
}
export function projectSourceFieldParticleGeometry(definition: FieldParticleRendering,
  particles: readonly FieldParticleRenderParticle[], parentTransform: ParticleTransform): FieldParticleGeometryProjection {
  validateFieldParticleRendering(definition); unitTransform(parentTransform, false);
  if (!Array.isArray(particles) || particles.length > 65536) throw new Error("Invalid source particle geometry input");
  const g = definition.geometry, cameraPosition = transformChain({ x: 0, y: 0, z: 0 }, g.camera.transforms, parentTransform);
  vector(cameraPosition);
  const maximum = f(f(g.camera.orthographicSize * 2) * g.renderer.maxSize);
  const quads = particles.map((p, particleIndex): FieldParticleRenderQuad => {
    vector(p.position); finite(p.size); finite(p.rotation); finite(p.normalizedAge);
    if (p.size < 0 || p.normalizedAge < 0 || !Number.isSafeInteger(p.color32) || p.color32 < 0 || p.color32 > 0xffffffff)
      throw new Error("Invalid source particle render state");
    const center = transformChain(p.position, g.emitter.transforms, parentTransform);
    vector(center);
    const safeSize = Math.max(f(p.size), f(1e-6));
    const factor = f(f(Math.min(f(safeSize * 0.5), f(maximum * 0.5))) / safeSize);
    const half = p.normalizedAge < 100 ? f(f(p.size) * factor) : 0;
    const { sin, cos } = sourceFieldParticleSinCos(p.rotation), sh = f(sin * half), ch = f(cos * half);
    const a = { x: f(sh - ch), y: f(sh + ch) }, b = { x: f(sh + ch), y: f(ch - sh) };
    const rgba = [0, 8, 16, 24].map((shift) => f(((p.color32 >>> shift) & 255) / 255)) as [number, number, number, number];
    const v = (offset: typeof a, sign: 1 | -1, uv: readonly [number, number]): FieldParticleRenderVertex => {
      const position = { x: f(center.x + f(offset.x * sign)), y: f(center.y + f(offset.y * sign)), z: center.z };
      vector(position); return { position, uv, color: [...rgba] };
    };
    return { particleIndex, vertices: [v(a, 1, [0, 1]), v(b, 1, [1, 1]), v(a, -1, [1, 0]), v(b, -1, [0, 0])] };
  });
  return { quads, cameraPosition, triangles: [0, 1, 2, 0, 2, 3] };
}

export type FieldParticleRasterProjection = {
  /** This matrix must come from the source camera/GfxDevice host. The prefab's
   * orthographic size does not by itself prove the GPU Y/depth conversion. */
  kind: "source-d3d11-particle-view-projection"; matrix: ParticleMatrix;
};
const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
const clampUnit = (n: number) => Math.max(0, Math.min(1, n));
function roundEven(n: number): number {
  const floor = Math.floor(n), remainder = n - floor;
  return remainder < 0.5 || (remainder === 0.5 && floor % 2 === 0) ? floor : floor + 1;
}
/** UNorm blending clamps source BEFORE blending, then clamps/quantizes each
 * completed fragment. It does not apply sRGB conversion in this Gamma build. */
export function blendSourceFieldParticleTarget(source: ParticleColor, destination: readonly number[]): readonly number[] {
  if (!Array.isArray(source) || source.length !== 4 || source.some((n) => !Number.isFinite(n)) ||
      destination.length !== 4 || destination.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    throw new Error("Invalid particle target fragment/storage");
  const src = source.map((n) => f(clampUnit(n))), inverse = f(1 - src[3]!);
  return src.map((n, i) => Math.floor(f(clampUnit(f(n + f(f(destination[i]! / 255) * inverse)))) * 255 + 0.5));
}
/** CPU execution of the admitted single-sample pipeline. D3D raster coverage
 * uses 8 subpixel bits and top-left ownership; UNorm conversion uses a valid
 * round-to-nearest implementation. This is not a native-GPU bitwise oracle.
 * The GPU projection is deliberately required rather than inferred from the
 * prefab camera, whose GfxDevice conversion is a separate host dependency. */
export function renderSourceFieldParticleTarget(input: {
  definition: FieldParticleRendering; particles: readonly FieldParticleRenderParticle[]; parentTransform: ParticleTransform;
  projection: FieldParticleRasterProjection; textures: ReadonlyMap<string, FieldParticleTexture>;
  engineSeconds: number; elapsedSeconds: number;
}): FieldParticleSampledTarget {
  const { definition, projection } = input, staged = projectSourceFieldParticleGeometry(definition, input.particles, input.parentTransform);
  if (projection?.kind !== "source-d3d11-particle-view-projection") throw new Error("Missing source particle GPU projection host");
  matrix(projection.matrix);
  if (projection.matrix[3] !== 0 || projection.matrix[7] !== 0 || projection.matrix[11] !== 0 || projection.matrix[15] !== 1)
    throw new Error("Unrecovered nonorthographic particle GPU projection");
  finite(input.engineSeconds); finite(input.elapsedSeconds);
  const material = definition.material, g = definition.geometry, { width, height } = g.target;
  const textures = new Map<string, FieldParticleTexture>();
  for (const key of Object.values(material.textures)) {
    const texture = input.textures?.get(key); if (!texture) throw new Error("Missing source particle texture " + key);
    sampleFieldParticleTexture(texture, 0, 0); textures.set(key, texture);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let n = 0; n < data.length; n++) data[n] = Math.floor(g.camera.clear[n % 4]! * 255 + 0.5);
  type Vertex = { clip: [number, number, number, number]; uv: [number, number]; color: ParticleColor };
  const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => ({
    clip: a.clip.map((v, i) => f(v + f(f(b.clip[i]! - v) * t))) as Vertex["clip"],
    uv: a.uv.map((v, i) => f(v + f(f(b.uv[i]! - v) * t))) as Vertex["uv"],
    color: a.color.map((v, i) => f(v + f(f(b.color[i]! - v) * t))) as [number, number, number, number] });
  const planes = [(v: Vertex) => f(v.clip[0] + v.clip[3]), (v: Vertex) => f(v.clip[3] - v.clip[0]),
    (v: Vertex) => f(v.clip[1] + v.clip[3]), (v: Vertex) => f(v.clip[3] - v.clip[1]),
    (v: Vertex) => v.clip[2], (v: Vertex) => f(v.clip[3] - v.clip[2])];
  const raster = (raw: readonly [Vertex, Vertex, Vertex]) => {
    const pixel = (v: Vertex) => ({ x: roundEven(f(f(v.clip[0] + 1) * f(width / 2)) * 256),
      y: roundEven(f(f(1 - v.clip[1]) * f(height / 2)) * 256), vertex: v });
    let [a, b, c] = raw.map(pixel) as [ReturnType<typeof pixel>, ReturnType<typeof pixel>, ReturnType<typeof pixel>];
    const edge = (p: typeof a, q: typeof a, x: number, y: number) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
    let area = edge(a, b, c.x, c.y); if (area === 0) return;
    if (area < 0) { [b, c] = [c, b]; area = -area; }
    const topLeft = (p: typeof a, q: typeof a) => q.y < p.y || (q.y === p.y && q.x > p.x);
    const minX = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - 128) / 256));
    const maxX = Math.min(width - 1, Math.floor((Math.max(a.x, b.x, c.x) - 128) / 256));
    const minY = Math.max(0, Math.ceil((Math.min(a.y, b.y, c.y) - 128) / 256));
    const maxY = Math.min(height - 1, Math.floor((Math.max(a.y, b.y, c.y) - 128) / 256));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const sx = x * 256 + 128, sy = y * 256 + 128;
      const ea = edge(b, c, sx, sy), eb = edge(c, a, sx, sy), ec = edge(a, b, sx, sy);
      if (ea < 0 || eb < 0 || ec < 0 || (ea === 0 && !topLeft(b, c)) ||
          (eb === 0 && !topLeft(c, a)) || (ec === 0 && !topLeft(a, b))) continue;
      const attribute = (values: readonly number[]) => f((ea * values[0]! + eb * values[1]! + ec * values[2]!) / area);
      const colors = [0, 1, 2, 3].map((i) => attribute([a.vertex.color[i]!, b.vertex.color[i]!, c.vertex.color[i]!]));
      const fragment = shadeFieldParticle(material, { uv: [0, 1].map((i) =>
        attribute([a.vertex.uv[i]!, b.vertex.uv[i]!, c.vertex.uv[i]!])) as [number, number],
        color: { r: colors[0]!, g: colors[1]!, b: colors[2]!, a: colors[3]! },
        engineSeconds: input.engineSeconds, elapsedSeconds: input.elapsedSeconds },
        (key, u, v) => sampleFieldParticleTexture(textures.get(key)!, u, v));
      if (!fragment) continue;
      // GPU storage is top-origin. The public sampled frame is normalized to
      // Unity texture UV: first row is V=1. Do not flip its board UV again.
      const at = ((height - 1 - y) * width + x) * 4;
      const result = blendSourceFieldParticleTarget([fragment.r, fragment.g, fragment.b, fragment.a], Array.from(data.subarray(at, at + 4)));
      data.set(result, at);
    }
  };
  for (const quad of staged.quads) {
    const vertices = quad.vertices.map((v) => transformFieldParticleVertex({ ...v, objectToWorld: identityMatrix,
      viewProjection: projection.matrix }));
    for (let start = 0; start < staged.triangles.length; start += 3) {
      let polygon: Vertex[] = staged.triangles.slice(start, start + 3).map((i) => vertices[i]!);
      for (const distance of planes) {
        const result: Vertex[] = [];
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!, da = distance(a), db = distance(b);
          if (da >= 0) result.push(a);
          if ((da >= 0) !== (db >= 0)) result.push(interpolate(a, b, f(da / f(da - db))));
        }
        polygon = result;
      }
      for (let n = 1; n + 1 < polygon.length; n++) raster([polygon[0]!, polygon[n]!, polygon[n + 1]!]);
    }
  }
  return { kind: "field-effect-sampled-rt-v1", assetGroup: g.assetGroup, cameraId: g.camera.id, width, height,
    sampleEncoding: "rgba8-unorm", rowOrder: "top-to-bottom", data };
}

/** Exact instruction order of particle vertex285 (also board vertex0 after
 * its UV scale/offset instruction). Inputs are actual engine vertices, not
 * inferred billboard centers. No hidden transform is applied a second time. */
export function transformFieldParticleVertex(input: {
  position: ParticleVector; uv: readonly [number, number]; color: ParticleColor;
  objectToWorld: ParticleMatrix; viewProjection: ParticleMatrix;
}): { clip: [number, number, number, number]; uv: [number, number]; color: ParticleColor } {
  vector(input.position); matrix(input.objectToWorld); matrix(input.viewProjection); color(input.color);
  if (!Array.isArray(input.uv) || input.uv.length !== 2) throw new Error("Unbound particle UV");
  const transform = (v: readonly number[], m: ParticleMatrix, point: boolean) => [0, 1, 2, 3].map((n) => {
    let value = f(f(v[1]!) * f(m[4 + n]!));
    value = f(f(m[n]!) * f(v[0]!) + value);
    value = f(f(m[8 + n]!) * f(v[2]!) + value);
    return point ? f(value + f(m[12 + n]!)) : f(f(m[12 + n]!) * f(v[3]!) + value);
  });
  const world = transform([input.position.x, input.position.y, input.position.z, 1], input.objectToWorld, true);
  return { clip: transform(world, input.viewProjection, false) as [number, number, number, number],
    uv: [finite(input.uv[0]), finite(input.uv[1])], color: input.color.map(f) as [number, number, number, number] };
}

export function validateFieldEffectBoardMaterial(m: FieldEffectBoardMaterial): void {
  if (m?.kind !== "source-field-effect-board-material-v1" || m.vertexSha256 !== FIELD_EFFECT_BOARD_PROGRAMS.vertex ||
      JSON.stringify(m.fragments) !== JSON.stringify([FIELD_EFFECT_BOARD_PROGRAMS.opaque, FIELD_EFFECT_BOARD_PROGRAMS.color]) ||
      JSON.stringify(m.uvScale) !== "[1,1]" || JSON.stringify(m.uvOffset) !== "[0,0]" ||
      JSON.stringify(m.vertexColor) !== "[1,1,1,1]" || !Array.isArray(m.sources) || m.sources.length !== 3)
    throw new Error("Unbound source effect board material");
  m.sources.forEach(identity);
  const expected = fieldEffectBoardSources();
  for (let n = 0; n < expected.length; n++) for (const [key, value] of Object.entries(expected[n]!))
    if ((m.sources[n] as unknown as Record<string, unknown>)[key] !== value) throw new Error("Foreign field board shader/material source");
}
/** FieldEffectEntityShader has TWO nonexclusive passes. The color pass tests
 * RGB sum, not alpha and not the complement of the opaque alpha threshold. */
export function fieldEffectBoardFragment(sample: ParticleColor, vertex: ParticleColor, materialAlpha: number,
  pass: "opaque" | "color"): ParticleColor | null {
  color(sample); color(vertex);
  if (!Number.isFinite(materialAlpha) || materialAlpha < 0 || materialAlpha > 1) throw new Error("Invalid board fade alpha");
  const base = sample.map((v, i) => f(f(v) * f(vertex[i]!)));
  const result = base.map((v) => f(v * f(materialAlpha))) as [number, number, number, number];
  if (pass === "opaque") return f(base[3]! * f(materialAlpha) - f(254 / 255)) < 0 ? null : result;
  if (pass !== "color") throw new Error("Unknown field board shader pass");
  const sum = f(result[2] + f(result[1] + result[0]));
  return f(sum - f(1 / 255)) < 0 ? null : result;
}
/** MapConstants.BlendTypeTable, with Board.Init's type0 Src=One override.
 * RGBA use the same factors. Storage clamps once, after the two terms sum. */
export function blendFieldEffectBoard(source: ParticleColor, destination: ParticleColor, blendType: 0 | 1 | 2): ParticleColor {
  color(source); color(destination);
  if (![0, 1, 2].includes(blendType)) throw new Error("Unknown field effect blend mode");
  return source.map((v, i) => {
    const srcFactor = blendType === 2 ? f(destination[i]!) : 1;
    const dstFactor = blendType === 0 ? f(1 - f(source[3])) : blendType === 1 ? 1 : 0;
    return f(Math.min(1, Math.max(0, f(f(f(v) * srcFactor) + f(f(destination[i]!) * dstFactor)))));
  }) as [number, number, number, number];
}

/** Ephemeral board staging data. It is consumed by the ordinary field
 * compositor's existing attachments, never drawn as a Canvas overlay. */
export type FieldEffectCompositionBatch = {
  id: string; queue: 2453 | 2458 | 2460; blendType: 0 | 1 | 2; zTest: 4 | 8;
  stencilReference: 0 | 2; alpha: number;
  quads: readonly {
    image: { width: number; height: number; data: Uint8ClampedArray };
    destination: { x: number; y: number; width: number; height: number };
    uv: { left: number; right: number; top: number; bottom: number };
    depth: number;
  }[];
};
