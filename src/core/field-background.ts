/** Recovered ordinary MapMultipleScroll center mesh. Units are source pixels,
 * with native world Y up and Canvas rectangles Y down. No persistent copy of
 * the camera or renderer is kept here. */
export type FieldBackgroundSource = { file: string; assetPath: string; objectId: string; serializedFile: string; sha256: string };
export type FieldBackgroundRenderHost = { kind: "source-fresh-normal-background-host-v1";
  rendererWorld: { x: number; y: number }; renderCamera: { x: number; y: number };
  sources: FieldBackgroundSource[] };
export type FieldBackgroundLayer = {
  kind: "native-center-repeat-background-v1";
  layerId: number;
  name: string;
  source: FieldBackgroundSource;
  mapSize: { width: number; height: number };
  size: { width: number; height: number };
  offset: { x: number; y: number };
  manualSpeed: { x: number; y: number };
  renderHost: FieldBackgroundRenderHost;
  texture: { url: string; sha256: string; width: number; height: number;
    source: FieldBackgroundSource; textureSource: FieldBackgroundSource };
};
export type FieldBackgroundRect = { x: number; y: number; width: number; height: number };
export type FieldBackgroundInput = {
  /** CameraFieldMain.transform.position, not an unclamped actor position. */
  scrollCamera: { x: number; y: number };
  /** CameraFieldTileMap, the separate raster camera used by the source mesh. */
  renderCamera: { x: number; y: number };
  /** MainViewMapRenderer.transform.position. Its source host is explicit. */
  rendererWorld: { x: number; y: number };
  /** ChangeMeshSize(viewSize), in source logical pixels. */
  screen: { width: number; height: number };
  /** FrontRenderTarget.GetSize(kField), in source logical pixels. */
  renderTarget: { width: number; height: number };
};
export type FieldBackgroundProjection = {
  localOffset: { x: number; y: number };
  meshSize: { width: number; height: number };
  uvOffset: { x: number; y: number };
  patches: { source: FieldBackgroundRect; destination: FieldBackgroundRect }[];
};
const f = Math.fround;
function finite(value: number): void {
  if (!Number.isFinite(value) || !Number.isFinite(f(value))) throw new Error("Invalid source background number");
}
function dimension(value: number): void {
  finite(value);
  if (value <= 0 || value > 1_000_000) throw new Error("Invalid source background dimension");
}
export function validateFieldBackground(layer: FieldBackgroundLayer): void {
  if (layer.kind !== "native-center-repeat-background-v1" || !Number.isInteger(layer.layerId) ||
      layer.layerId < 0 || !/^FarBGLayer[0-9]*$/.test(layer.name)) throw new Error("Unsupported source background layer");
  for (const size of [layer.mapSize, layer.size, layer.texture]) { dimension(size.width); dimension(size.height); }
  for (const point of [layer.offset, layer.manualSpeed]) { finite(point.x); finite(point.y); }
  if (layer.renderHost.kind !== "source-fresh-normal-background-host-v1" || layer.renderHost.sources.length < 2)
    throw new Error("Unbound source background render host");
  for (const point of [layer.renderHost.rendererWorld, layer.renderHost.renderCamera]) { finite(point.x); finite(point.y); }
  if (!/^\/field-background-media\/textures\/[a-f0-9]{64}\.png$/.test(layer.texture.url) ||
      !layer.texture.url.endsWith(layer.texture.sha256 + ".png")) throw new Error("Unbound background texture");
  for (const source of [layer.source, layer.texture.source, layer.texture.textureSource, ...layer.renderHost.sources])
    if (!/^-?\d+$/.test(source.objectId) || !/^[a-f0-9]{64}$/.test(source.sha256) ||
        !source.file || !source.assetPath || !source.serializedFile) throw new Error("Unbound background source");
}
function clampAxis(desired: number, limit: number, texture: number): { offset: number; local: number } {
  // The native negative-limit branch centers an undersized property region;
  // it is not equivalent to clamping into an inverted [0, limit] interval.
  if (limit < 0) return { offset: 0, local: f(f(f(limit * 0.5) - desired) * texture) };
  if (desired > limit) return { offset: limit, local: f(f(limit - desired) * texture) };
  if (desired < 0) return { offset: 0, local: f(-desired * texture) };
  return { offset: desired, local: 0 };
}
function positiveMod(value: number, length: number): number {
  return ((value % length) + length) % length;
}
function segments(start: number, length: number, texture: number): { source: number; destination: number; size: number }[] {
  const out: { source: number; destination: number; size: number }[] = [];
  let source = positiveMod(start, texture), destination = 0;
  while (destination < length) {
    const size = Math.min(texture - source, length - destination);
    if (!(size > 0) || out.length > 4096) throw new Error("Background repeat mesh exceeds supported projection bounds");
    out.push({ source, destination, size }); destination += size; source = 0;
  }
  return out;
}
export function projectFieldBackground(layer: FieldBackgroundLayer, input: FieldBackgroundInput): FieldBackgroundProjection {
  validateFieldBackground(layer);
  for (const point of [input.scrollCamera, input.renderCamera, input.rendererWorld]) { finite(point.x); finite(point.y); }
  for (const size of [input.screen, input.renderTarget]) { dimension(size.width); dimension(size.height); }
  const sw = f(input.screen.width), sh = f(input.screen.height), rw = f(input.renderTarget.width);
  const tw = f(layer.texture.width), th = f(layer.texture.height);
  const mw = f(layer.mapSize.width), mh = f(layer.mapSize.height);
  const pw = f(layer.size.width), ph = f(layer.size.height);
  const cx = f(input.scrollCamera.x), cy = f(input.scrollCamera.y), ratio = f(sw / rw);
  // StandardRenderTextureSize=320x180; MainView's source Scale is 1.
  const desiredU = f(f(f(layer.manualSpeed.x) * f(f(f(f(cx - f(layer.offset.x)) + f(mw * 0.5)) -
    f(f(320 * ratio) * 0.5)) / tw)) - f(f(f(f(rw - 320) * ratio) * 0.5) / tw));
  const desiredV = f(f(f(1 - f(layer.manualSpeed.y)) * f(f(f(f(mh * 0.5) - cy) - f(sh * 0.5)) / th)) +
    f(f(f(f(f(cy + f(ph - mh)) + f(layer.offset.y)) + f(mh * 0.5)) - f(sh * 0.5)) / th));
  const horizontal = clampAxis(desiredU, f(f(pw - sw) / tw), tw);
  const vertical = clampAxis(desiredV, f(f(ph - sh) / th), th);
  const meshSize = { width: Math.min(sw, pw), height: Math.min(sh, ph) };
  const left = input.screen.width / 2 + f(f(input.rendererWorld.x + horizontal.local) - f(input.renderCamera.x)) - meshSize.width / 2;
  const top = input.screen.height / 2 - f(f(input.rendererWorld.y + vertical.local) - f(input.renderCamera.y)) - meshSize.height / 2;
  const xs = segments(f(horizontal.offset * tw), meshSize.width, tw);
  const ys = segments(f(th - f(meshSize.height + f(vertical.offset * th))), meshSize.height, th);
  if (xs.length * ys.length > 4096) throw new Error("Background repeat patch count exceeds supported projection bounds");
  return { localOffset: { x: horizontal.local, y: vertical.local }, meshSize,
    uvOffset: { x: horizontal.offset, y: vertical.offset },
    patches: ys.flatMap((y) => xs.map((x) => ({
      source: { x: x.source, y: y.source, width: x.size, height: y.size },
      destination: { x: left + x.destination, y: top + y.destination, width: x.size, height: y.size },
    }))) };
}
