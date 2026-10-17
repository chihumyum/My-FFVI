import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { z } from "zod";
import { Hash } from "../contracts.js";
import { canonical } from "../core/canonical.js";

export const SPRITE_LOGICAL_CANVAS = "source-sprite-logical-canvas-v1" as const;
const number = z.number().finite(), pair = z.tuple([number, number]), rect = z.tuple([number, number, number, number]);
const metadata = z.object({ logicalRect: rect, pivot: pair, pixelsPerUnit: number.positive(),
  textureRect: rect, textureRectOffset: pair, atlasRectOffset: pair, settingsRaw: z.number().int().min(0).max(127),
  packed: z.boolean(), packingMode: z.union([z.literal(0), z.literal(1)]), packingRotation: z.number().int().min(0).max(4),
  downscaleMultiplier: z.literal(1), mesh: z.object({ vertices: z.array(z.tuple([number, number, z.literal(0)])).min(3),
    uv: z.array(pair).nullable(), triangles: z.array(z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()])).min(1)).min(1) }).strict() }).strict();
const padding = z.object({ left: z.number().int().nonnegative(), right: z.number().int().nonnegative(),
  top: z.number().int().nonnegative(), bottom: z.number().int().nonnegative() }).strict();
export const SpriteLogicalCanvas = z.object({ kind: z.literal(SPRITE_LOGICAL_CANVAS), metadata,
  decodedSize: z.tuple([z.number().int().positive(), z.number().int().positive()]), decodedRgbaSha256: Hash, padding }).strict();
export type SpriteLogicalCanvas = z.infer<typeof SpriteLogicalCanvas>;

/** This adapter emits only noninterlaced RGBA8 PNG. Decode every pixel, rather
 * than trusting dimensions or an exporter-supplied conservation claim. */
export function sourceCanvasRgba(bytes: Buffer, width: number, height: number): Buffer {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error("Invalid source canvas PNG");
  let at = 8, header = false, ended = false; const chunks: Buffer[] = [];
  while (at + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(at), type = bytes.toString("ascii", at + 4, at + 8), data = bytes.subarray(at + 8, at + 8 + size);
    if (at + 12 + size > bytes.length || ended) throw Error("Invalid source canvas PNG chunk");
    if (type === "IHDR") {
      if (header || at !== 8 || size !== 13 || data.readUInt32BE(0) !== width || data.readUInt32BE(4) !== height ||
          !data.subarray(8).equals(Buffer.from([8,6,0,0,0]))) throw Error("Unsupported source canvas PNG geometry");
      header = true;
    } else if (type === "IDAT") { if (!header) throw Error("Missing source canvas header"); chunks.push(data); }
    else if (type === "IEND") { if (size !== 0 || !chunks.length) throw Error("Incomplete source canvas PNG"); ended = true; }
    else throw Error("Unknown source canvas PNG chunk");
    at += size + 12;
  }
  if (!ended || at !== bytes.length) throw Error("Incomplete source canvas PNG");
  const stride = width * 4, raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw Error("Invalid source canvas pixel length");
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    if (filter > 4) throw Error("Unknown source canvas PNG filter");
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x < 4 ? 0 : pixels[i - 4]!, b = y ? pixels[i - stride]! : 0,
        c = x < 4 || !y ? 0 : pixels[i - stride - 4]!, p = a + b - c,
        paeth = Math.abs(p-a) <= Math.abs(p-b) && Math.abs(p-a) <= Math.abs(p-c) ? a : Math.abs(p-b) <= Math.abs(p-c) ? b : c;
      pixels[i] = (raw[y * (stride + 1) + x + 1]! + [0,a,b,Math.floor((a+b)/2),paeth][filter]!) & 255;
    }
  }
  return pixels;
}

export function validateSpriteLogicalCanvas(raw: unknown, sprite: { width: number; height: number; pivot: number[] }, bytes: Buffer): SpriteLogicalCanvas {
  const value = SpriteLogicalCanvas.parse(raw), m = value.metadata, { width, height } = sprite;
  if (width > 16384 || height > 16384 || m.logicalRect[2] !== width || m.logicalRect[3] !== height ||
      m.pivot.some((v,i) => v !== sprite.pivot[i]) || Boolean(m.settingsRaw & 1) !== m.packed ||
      ((m.settingsRaw >> 1) & 1) !== m.packingMode || ((m.settingsRaw >> 2) & 15) !== m.packingRotation ||
      !m.packed && m.packingRotation !== 0 || m.textureRect[2] <= 0 || m.textureRect[3] <= 0 ||
      m.mesh.uv !== null && (m.mesh.uv.length !== 0 && m.mesh.uv.length !== m.mesh.vertices.length || m.mesh.uv.some(v => v.some(n => n !== 0))) ||
      m.mesh.triangles.some(t => t.some(v => v.some(i => i >= m.mesh.vertices.length)))) throw Error("Unverified source Sprite geometry/packing");
  const low = [0,1].map(i => Math.min(...m.mesh.vertices.map(v => v[i]!)) * m.pixelsPerUnit + m.pivot[i]! * [width,height][i]!),
    high = [0,1].map(i => Math.max(...m.mesh.vertices.map(v => v[i]!)) * m.pixelsPerUnit + m.pivot[i]! * [width,height][i]!);
  if ([...low,...high].some(v => !Number.isInteger(v)) || low[0]! < 0 || low[1]! < 0 || high[0]! > width || high[1]! > height ||
      high[0]! - low[0]! !== value.decodedSize[0] || high[1]! - low[1]! !== value.decodedSize[1] ||
      value.padding.left !== low[0] || value.padding.bottom !== low[1] || value.padding.right !== width - high[0]! || value.padding.top !== height - high[1]!)
    throw Error("Source Sprite logical anchor does not match its mesh");
  const rgba = sourceCanvasRgba(bytes,width,height), crop = Buffer.alloc(value.decodedSize[0]*value.decodedSize[1]*4);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const offset=(y*width+x)*4, inside=x>=low[0]!&&x<high[0]!&&y>=value.padding.top&&y<height-low[1]!;
    if (inside) rgba.copy(crop, ((y-value.padding.top)*value.decodedSize[0]+x-low[0]!)*4, offset,offset+4);
    else if (rgba.subarray(offset,offset+4).some(v=>v!==0)) throw Error("Source Sprite padding is not transparent black");
  }
  if (createHash("sha256").update(crop).digest("hex") !== value.decodedRgbaSha256) throw Error("Source Sprite crop pixels changed");
  return value;
}

export function assertWorldMediaAdapter(media: Record<string, unknown>): void {
  if (media.adapterVersion === "world-media-0.1.0") {
    if (media.spriteLogicalCanvas !== undefined) throw Error("Legacy source media has an undeclared Sprite projection");
    return;
  }
  if (media.adapterVersion !== "world-media-0.2.0") throw Error("Unknown world media adapter");
  const protocol = z.object({ kind: z.literal(SPRITE_LOGICAL_CANVAS), projections: z.array(z.object({ asset:z.string().min(1),sprite:z.string().min(1),
    source:z.record(z.string(),z.unknown()),imageSha256:Hash,padding }).strict()), unresolved:z.array(z.object({asset:z.string().min(1),sprite:z.string().min(1),source:z.record(z.string(),z.unknown()),reason:z.string().min(1)}).strict()) }).strict().parse(media.spriteLogicalCanvas);
  const expected: unknown[] = [];
  for (const [asset,c] of Object.entries(z.record(z.string(),z.object({sprites:z.record(z.string(),z.record(z.string(),z.unknown()))}).passthrough()).parse(media.characters)))
    for (const [sprite,s] of Object.entries(c.sprites)) if (s.representation === SPRITE_LOGICAL_CANVAS) {
      const proof=SpriteLogicalCanvas.parse(s.logicalCanvas);
      expected.push({asset,sprite,source:s.source,imageSha256:s.sha256,padding:proof.padding});
    }
  const sorted=(values:unknown[])=>values.map(canonical).sort();
  if (canonical(sorted(expected)) !== canonical(sorted(protocol.projections)) || new Set(protocol.projections.map(p=>p.asset+"\0"+p.sprite)).size !== protocol.projections.length)
    throw Error("Source Sprite projection manifest does not match its complete media domain");
}
