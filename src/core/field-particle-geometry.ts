import type { FieldActorViewSource } from "./field-actor-view.js";
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
