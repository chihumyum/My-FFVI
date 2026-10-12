import { canonical } from "./canonical.js";
import type { FieldActorViewDefinition, FieldActorViewSource } from "./field-actor-view.js";
import { validateFieldActorView } from "./field-actor-view.js";

export type FieldCompositionColor = readonly [number, number, number, number];
export type FieldCompositionLayer = "BottomLayer" | "GroundLayer" | "UpperLayer" | "CeilLayer";
/** Same-build ordinary 16:9 FieldMain target. These are source inputs, not
 * inferred from Canvas dimensions or from an actor's texture attachments. */
export type FieldCompositionRenderHost = {
  kind: "source-normal-field-targets-v1";
  sources: FieldActorViewSource[];
  sourceHeight: 1080; fieldDivisor: 6; aspect: readonly [16, 9];
  width: 320; height: 180; graphicsFormat: 8; depthBits: 24; filterMode: 0;
  orthographicSize: 90; viewport: readonly [0, 0, 1, 1];
  cameraZ: -50; near: number; far: 300;
  clear: FieldCompositionColor;
  masks: readonly [16777216, 33554432];
};
const bootFile = "FINAL FANTASY VI_Data/level0";
const bootHash = "986e706d7e762c652ac73cacfbb399b1eb69c37ad57d31a8165df0516e07c170";
/** Fixed values are admitted only after the compiler verifies the original
 * scene and native source. Exported for redistributable synthetic tests too. */
export function ordinaryFieldCompositionRenderHost(): FieldCompositionRenderHost {
  return { kind: "source-normal-field-targets-v1",
    sources: [...["305", "150", "170", "165", "160", "142", "124", "145", "108"].map((objectId) => ({ file: bootFile,
      assetPath: "level0", serializedFile: "level0", objectId, sha256: bootHash })),
      { file: "FINAL FANTASY VI_Data/globalgamemanagers", assetPath: "globalgamemanagers",
        serializedFile: "globalgamemanagers", objectId: "1",
        sha256: "bc33b3eaaab47d14fbbf792f5bcc664c7e2f4787376449306739bce658dc7881" }],
    sourceHeight: 1080, fieldDivisor: 6, aspect: [16, 9], width: 320, height: 180,
    graphicsFormat: 8, depthBits: 24, filterMode: 0, orthographicSize: 90,
    viewport: [0, 0, 1, 1], cameraZ: -50, near: Math.fround(0.3), far: 300,
    clear: [Math.fround(24 / 255), Math.fround(24 / 255), Math.fround(24 / 255), 0], masks: [16777216, 33554432] };
}
export function validateFieldCompositionRenderHost(value: FieldCompositionRenderHost): void {
  if (canonical(value) !== canonical(ordinaryFieldCompositionRenderHost()))
    throw new Error("Unknown source field render-target provider");
}
/** Content capability, not an actor/texture owner. The texture names identify
 * this map's two per-frame pre-render targets; they are not image filenames. */
export type FieldNativeCompositionDefinition = {
  kind: "native-ordinary-field-composition-v1";
  contextId: string;
  view: FieldActorViewDefinition;
  sources: FieldActorViewSource[];
  layers: FieldCompositionLayer[];
  upperTexture: string | null;
  ceilTexture: string | null;
  renderHost?: FieldCompositionRenderHost;
  /** An absent allocator never becomes ready from fragment formulas alone. */
  renderTargets: { upper: "disabled" | "clear-only" | "unresolved" | "source-rendered";
    ceil: "disabled" | "clear-only" | "unresolved" | "source-rendered" };
};

export const FIELD_COMPOSITION_LAYERS = ["BottomLayer", "GroundLayer", "UpperLayer", "CeilLayer"] as const;
const f = Math.fround;
const lowAlpha = f(1 / 255), highAlpha = f(254 / 255);

function color(value: FieldCompositionColor): void {
  if (!Array.isArray(value) || value.length !== 4 || value.some((n) => !Number.isFinite(n) || n < 0 || n > 1))
    throw new Error("Invalid ordinary field composition color");
}
export function fieldCompositionTexture(contextId: string, layer: "UpperLayer" | "CeilLayer"): string {
  if (!/^[a-f0-9]{64}$/.test(contextId)) throw new Error("Unknown field composition context");
  return `native-field-rt:${contextId}:${layer}`;
}

export function validateFieldNativeComposition(definition: FieldNativeCompositionDefinition,
  view?: FieldActorViewDefinition): void {
  if (!definition || definition.kind !== "native-ordinary-field-composition-v1" ||
      !/^[a-f0-9]{64}$/.test(definition.contextId) || !Array.isArray(definition.sources) || definition.sources.length < 3 ||
      !Array.isArray(definition.layers) || !definition.layers.length ||
      definition.layers.some((l) => !FIELD_COMPOSITION_LAYERS.includes(l)) ||
      new Set(definition.layers).size !== definition.layers.length)
    throw new Error("Unbound ordinary field composition");
  for (const source of definition.sources) if (!source.file || !source.assetPath || !/^-?\d+$/.test(source.objectId) ||
      !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Unknown composition source identity");
  validateFieldActorView(definition.view);
  if (definition.view.contextId !== definition.contextId || !definition.view.sources.every((item) =>
      definition.sources.some((source) => canonical(source) === canonical(item.source))))
    throw new Error("Composition does not belong to the bound actor view");
  const expected = (layer: "UpperLayer" | "CeilLayer") => definition.layers.includes(layer)
    ? fieldCompositionTexture(definition.contextId, layer) : null;
  if (definition.upperTexture !== expected("UpperLayer") || definition.ceilTexture !== expected("CeilLayer"))
    throw new Error("Unbound field pre-render target");
  if (definition.renderHost !== undefined) validateFieldCompositionRenderHost(definition.renderHost);
  for (const [name, texture] of [["upper", definition.upperTexture], ["ceil", definition.ceilTexture]] as const) {
    const status = definition.renderTargets?.[name];
    if (!["disabled", "clear-only", "unresolved", "source-rendered"].includes(status) || (status === "disabled") !== (texture === null) ||
        (status === "source-rendered" && !definition.renderHost))
      throw new Error("Unknown field pre-render target qualification");
  }
  if (view !== undefined) {
    validateFieldActorView(view);
    if (canonical(view) !== canonical(definition.view))
      throw new Error("Composition does not belong to the actor view");
  }
}

export function assertFieldCompositionRenderTargets(definition: FieldNativeCompositionDefinition): void {
  validateFieldNativeComposition(definition);
  if (definition.renderTargets.upper === "unresolved" || definition.renderTargets.ceil === "unresolved")
    throw new Error("Native field nonempty Upper/Ceil render-target allocation and sampling are unresolved");
}

/** AttachTransparentTexture(0x878af0). Layer here is the native entity layer,
 * not the renderer object's layer and not the zero-based Web layer. */
export function fieldCompositionActorTextures(definition: FieldNativeCompositionDefinition, unityLayer: number) {
  validateFieldNativeComposition(definition);
  if (!Number.isInteger(unityLayer) || unityLayer < 0 || unityLayer > 31)
    throw new Error("Unknown field composition actor layer");
  return unityLayer === 9 ? { first: definition.upperTexture, second: definition.ceilTexture }
    : unityLayer === 10 ? { first: definition.ceilTexture, second: null }
      : { first: null, second: null };
}

/** Ordinary MapOpaque/MapTransparentTileShader fragments, after the explicitly
 * absent palette/filter providers. The 254/255 boundary belongs to BOTH passes.
 * Null means discard, which preserves both previous color and depth. */
export function fieldTileFragment(sample: FieldCompositionColor, pass: "opaque" | "transparent"): FieldCompositionColor | null {
  color(sample);
  const a = f(sample[3]);
  if (pass === "opaque") return a < highAlpha ? null : sample.map(f) as [number, number, number, number];
  if (pass !== "transparent") throw new Error("Unknown field tile shader pass");
  return a < lowAlpha || a > highAlpha ? null : sample.map(f) as [number, number, number, number];
}

/** Native Blend SrcAlpha OneMinusSrcAlpha applies to alpha too. This is not
 * Canvas source-over's alpha equation and not a premultiplied texture sample. */
export function blendFieldTransparent(source: FieldCompositionColor, destination: FieldCompositionColor): FieldCompositionColor {
  color(source); color(destination);
  const a = f(source[3]), inv = f(1 - a);
  return source.map((n, i) => f(f(f(n) * a) + f(f(destination[i]!) * inv))) as [number, number, number, number];
}

/** Recovered ordinary FieldCharaEntityShader. Body/head split uses normalized
 * sprite UV (bottom-up), never a fixed number of PNG rows. Optional pre-render
 * inputs are head-only, sequential RGBA lerps. The caller REPLACES the target
 * pixel (Blend One Zero); it must not source-over this returned sample. */
export function fieldCharacterFragment(input: {
  sample: FieldCompositionColor;
  vertexAlpha: number;
  normalizedV: number;
  part: "body" | "head";
  first: FieldCompositionColor | null;
  second: FieldCompositionColor | null;
}): FieldCompositionColor | null {
  color(input.sample);
  if (!Number.isFinite(input.vertexAlpha) || input.vertexAlpha < 0 || input.vertexAlpha > 1 ||
      !Number.isFinite(input.normalizedV) || input.normalizedV < 0 || input.normalizedV > 1)
    throw new Error("Invalid ordinary character shader input");
  if (input.part !== "body" && input.part !== "head") throw new Error("Unknown character shader part");
  if (input.first !== null) color(input.first);
  if (input.second !== null) color(input.second);
  const a = f(f(input.sample[3]) * f(input.vertexAlpha));
  if (a < lowAlpha || (input.part === "body" ? f(input.normalizedV) > 0.25 : f(input.normalizedV) < 0.25)) return null;
  let result: FieldCompositionColor = [f(input.sample[0]), f(input.sample[1]), f(input.sample[2]), a];
  if (input.part === "head") for (const overlay of [input.first, input.second]) {
    if (overlay === null) continue;
    const alpha = f(overlay[3]);
    result = result.map((n, i) => f(f(f(f(overlay[i]!) - n) * alpha) + n)) as [number, number, number, number];
  }
  return result;
}

function finite(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(f(value))) throw new Error("Invalid native composition coordinate");
  return f(value);
}
/** Native float Round at 0x50c20 uses ties-to-even, including negative halves. */
export function fieldCompositionRound(value: number): number {
  const n = finite(value), floor = Math.floor(n), fraction = n - floor;
  return fraction < 0.5 ? floor : fraction > 0.5 ? floor + 1 : floor % 2 === 0 ? floor : floor + 1;
}
/** CalcInRangeVertex + UpdateLayerOffsetBase. The mesh-window clamp cancels
 * with mainBGLayer.localZ; the resulting row uses the UNCLAMPED center cell. */
export function fieldCompositionTileDepth(input: {
  layer: FieldCompositionLayer; localRow: number; mapHeight: number; cameraY: number;
}): number {
  if (!FIELD_COMPOSITION_LAYERS.includes(input.layer) || !Number.isSafeInteger(input.localRow) ||
      !Number.isSafeInteger(input.mapHeight) || input.mapHeight <= 0)
    throw new Error("Invalid source tile depth input");
  const center = Math.ceil(f(f(f(input.mapHeight * 0.5) - 0.5) - f(finite(input.cameraY) * 0.0625)));
  return finite([350, 250, 150, 50][FIELD_COMPOSITION_LAYERS.indexOf(input.layer)]! + 2 * (center - input.localRow) - 2);
}
/** FF6 ordinary FieldChara: native visual-parent row correction. The explicit
 * player/NPC CharaZOffset stays on its source actor; it is not inferred from id.
 * CharacterOffset is +6, while prefab Offset.y is -6. Sprite placement cancels
 * these two; the depth formula separately uses serialOffset+2. */
export function fieldCompositionActorDepth(input: {
  position: { y: number; z: number }; cameraY: number; frameY: number; clampTileSubY: number; charaZOffset: number;
}): number {
  let rowY = f(f(finite(input.position.y) - finite(input.cameraY)) - 16);
  rowY = f(rowY + Math.min(finite(input.frameY), 0));
  rowY = f(rowY + 8); // source CharacterOffset() 6 + native literal 2
  rowY = f(rowY + finite(input.clampTileSubY));
  const localZ = f(Math.floor(f(fieldCompositionRound(rowY) * 0.0625)) * 2 - finite(input.charaZOffset));
  return finite(finite(input.position.z) + localZ);
}

/** Transient CPU staging pixels, not saved gameplay state or another actor
 * store. Top-left addressing matches the exported PNG/Canvas image contract. */
export type FieldCompositionPixels = { width: number; height: number; data: Uint8ClampedArray };
export type FieldCompositionQuad = {
  image: FieldCompositionPixels;
  source: { x: number; y: number; width: number; height: number };
  destination: { x: number; y: number; width: number; height: number };
  flipX: boolean; flipY: boolean; diagonal: boolean; depth: number;
};
export type FieldCompositionLayerQuad = FieldCompositionQuad & { layer: FieldCompositionLayer };
export type FieldCompositionActorQuad = FieldCompositionQuad & {
  alpha: number; first: FieldCompositionPixels | null; second: FieldCompositionPixels | null;
};
function pixels(image: FieldCompositionPixels): void {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width <= 0 || image.height <= 0 ||
      !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4)
    throw new Error("Invalid native composition image pixels");
}
function quad(value: FieldCompositionQuad): void {
  pixels(value.image); finite(value.depth);
  for (const rect of [value.source, value.destination]) {
    for (const n of Object.values(rect)) finite(n);
    if (rect.width <= 0 || rect.height <= 0) throw new Error("Invalid composition rectangle");
  }
  const s = value.source;
  if (!Object.values(s).every(Number.isSafeInteger) || s.x < 0 || s.y < 0 || s.x + s.width > value.image.width ||
      s.y + s.height > value.image.height || [value.flipX, value.flipY, value.diagonal].some((b) => typeof b !== "boolean"))
    throw new Error("Unknown native composition UV geometry");
}
function readPixel(image: FieldCompositionPixels, x: number, y: number): FieldCompositionColor {
  const i = (y * image.width + x) * 4;
  return [f(image.data[i]! / 255), f(image.data[i + 1]! / 255), f(image.data[i + 2]! / 255), f(image.data[i + 3]! / 255)];
}
function writePixel(image: FieldCompositionPixels, index: number, color: FieldCompositionColor): void {
  // RGBA8 render-target storage, separately from the fragment's float32 math.
  for (let c = 0; c < 4; c++) image.data[index * 4 + c] = Math.round(color[c]! * 255);
}
function screenSample(image: FieldCompositionPixels | null, x: number, y: number, width: number, height: number): FieldCompositionColor | null {
  if (image === null) return null;
  return readPixel(image, Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / width)),
    Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / height)));
}
/** FieldController.Initialize copies the normal FieldTileMap target into two
 * separate RTs. Their source cameras clear every enabled frame, cull only
 * transparent Upper/Ceil mesh layers 24/25, and do not include opaque meshes.
 * Rebuilding transient pixels means an old map/frame cannot leak into a new RT. */
export function prepareFieldCompositionTargets(definition: FieldNativeCompositionDefinition, input: {
  width: number; height: number; tiles: readonly FieldCompositionLayerQuad[];
}): { upper: FieldCompositionPixels | null; ceil: FieldCompositionPixels | null } {
  assertFieldCompositionRenderTargets(definition);
  const host = definition.renderHost;
  if (!host) throw new Error("Missing source field render-target allocator");
  if (input.width !== host.width || input.height !== host.height)
    throw new Error("Field pre-render viewport differs from the source target");
  for (const tile of input.tiles) {
    quad(tile);
    if (!definition.layers.includes(tile.layer)) throw new Error("Unbound pre-render tile layer");
  }
  const render = (layer: "UpperLayer" | "CeilLayer", status: "upper" | "ceil"): FieldCompositionPixels | null => {
    if (definition.renderTargets[status] === "disabled") return null;
    const output: FieldCompositionPixels = { width: input.width, height: input.height,
      data: new Uint8ClampedArray(input.width * input.height * 4) };
    for (let i = 0; i < input.width * input.height; i++) writePixel(output, i, host.clear);
    for (const q of input.tiles) {
      if (q.layer !== layer || q.depth < f(host.cameraZ + host.near) || q.depth > f(host.cameraZ + host.far)) continue;
      const d = q.destination, s = q.source;
      for (let y = Math.max(0, Math.ceil(d.y - 0.5)); y < Math.min(input.height, Math.ceil(d.y + d.height - 0.5)); y++) {
        for (let x = Math.max(0, Math.ceil(d.x - 0.5)); x < Math.min(input.width, Math.ceil(d.x + d.width - 0.5)); x++) {
          let u = (x + 0.5 - d.x) / d.width, v = (y + 0.5 - d.y) / d.height;
          if (q.diagonal) [u, v] = [q.flipY ? 1 - v : v, q.flipX ? 1 - u : u];
          else { if (q.flipX) u = 1 - u; if (q.flipY) v = 1 - v; }
          const sample = readPixel(q.image, s.x + Math.min(s.width - 1, Math.floor(u * s.width)),
            s.y + Math.min(s.height - 1, Math.floor(v * s.height)));
          const fragment = fieldTileFragment(sample, "transparent");
          if (fragment !== null) writePixel(output, y * input.width + x,
            blendFieldTransparent(fragment, readPixel(output, x, y)));
        }
      }
    }
    return output;
  };
  return { upper: render("UpperLayer", "upper"), ceil: render("CeilLayer", "ceil") };
}

/** The Web display is a separate point-resampled presentation surface. It is
 * never fed back as the source camera viewport, and never blends RGBA twice. */
export function scaleFieldCompositionPixels(input: FieldCompositionPixels, width: number, height: number): FieldCompositionPixels {
  pixels(input);
  const result = { width, height, data: new Uint8ClampedArray(width * height * 4) }; pixels(result);
  if (width * input.height !== height * input.width) throw new Error("Source field aspect/letterbox provider is unresolved");
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (Math.floor((y + 0.5) * input.height / height) * input.width + Math.floor((x + 0.5) * input.width / width)) * 4;
    result.data.set(input.data.subarray(source, source + 4), (y * width + x) * 4);
  }
  return result;
}
/** Executable ordinary material passes. Caller supplies already prepared RT
 * samples; this function cannot turn an unresolved map into a ready RT host.
 * Actual queues: opaque 2450, body 2455, transparent 2456, head material 2457.
 * Each part keeps source depth; transparent tiles do not write depth. */
export function composeFieldNativePixels(input: {
  width: number; height: number; tiles: readonly FieldCompositionQuad[]; actors: readonly FieldCompositionActorQuad[];
  /** Existing color attachment before material queues. Omission creates a
   * transparent target for independent RT/formula checks; the Web host passes
   * its complete prepared background and publishes with putImageData. */
  background?: FieldCompositionPixels;
}): FieldCompositionPixels {
  const output: FieldCompositionPixels = { width: input.width, height: input.height,
    data: new Uint8ClampedArray(input.width * input.height * 4) };
  pixels(output);
  if (input.background) {
    pixels(input.background);
    if (input.background.width !== input.width || input.background.height !== input.height)
      throw new Error("Composition background dimensions differ from the target");
    output.data.set(input.background.data);
  }
  for (const tile of input.tiles) quad(tile);
  for (const actor of input.actors) {
    quad(actor);
    if (!Number.isFinite(actor.alpha) || actor.alpha < 0 || actor.alpha > 1 || actor.diagonal || actor.flipY)
      throw new Error("Unrecovered native character alpha/UV transformation");
    if (actor.first) pixels(actor.first);
    if (actor.second) pixels(actor.second);
  }
  const depths = new Float64Array(input.width * input.height); depths.fill(Infinity);
  const render = (q: FieldCompositionQuad, pass: "opaque" | "transparent" | "body" | "head") => {
    // CameraTileMap source near/far relative to world z=-50.
    if (q.depth < f(-50 + f(0.3)) || q.depth > 950) return;
    const d = q.destination, s = q.source;
    for (let y = Math.max(0, Math.ceil(d.y - 0.5)); y < Math.min(input.height, Math.ceil(d.y + d.height - 0.5)); y++) {
      for (let x = Math.max(0, Math.ceil(d.x - 0.5)); x < Math.min(input.width, Math.ceil(d.x + d.width - 0.5)); x++) {
        const index = y * input.width + x;
        if (q.depth > depths[index]!) continue;
        let u = (x + 0.5 - d.x) / d.width, v = (y + 0.5 - d.y) / d.height;
        if (q.diagonal) [u, v] = [q.flipY ? 1 - v : v, q.flipX ? 1 - u : u];
        else { if (q.flipX) u = 1 - u; if (q.flipY) v = 1 - v; }
        const sample = readPixel(q.image, s.x + Math.min(s.width - 1, Math.floor(u * s.width)),
          s.y + Math.min(s.height - 1, Math.floor(v * s.height)));
        let result: FieldCompositionColor | null;
        if (pass === "opaque" || pass === "transparent") result = fieldTileFragment(sample, pass);
        else {
          const actor = q as FieldCompositionActorQuad;
          result = fieldCharacterFragment({ sample, vertexAlpha: actor.alpha, normalizedV: 1 - v, part: pass,
            first: screenSample(actor.first, x, y, input.width, input.height),
            second: screenSample(actor.second, x, y, input.width, input.height) });
        }
        if (result === null) continue;
        if (pass === "transparent") result = blendFieldTransparent(result, readPixel(output, x, y));
        else depths[index] = q.depth;
        writePixel(output, index, result);
      }
    }
  };
  for (const tile of input.tiles) render(tile, "opaque");
  for (const actor of input.actors) render(actor, "body");
  for (const tile of input.tiles) render(tile, "transparent");
  for (const actor of input.actors) render(actor, "head");
  return output;
}
