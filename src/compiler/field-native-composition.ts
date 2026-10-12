import { hash, record } from "./content.js";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { FieldActorViewDefinition, FieldActorViewSource } from "../core/field-actor-view.js";
import { validateFieldActorView } from "../core/field-actor-view.js";
import { FIELD_COMPOSITION_LAYERS, fieldCompositionTexture, validateFieldNativeComposition,
  ordinaryFieldCompositionRenderHost, validateFieldCompositionRenderHost,
  type FieldCompositionRenderHost, type FieldCompositionLayer, type FieldNativeCompositionDefinition } from "../core/field-native-composition.js";
import { compileFieldActorFactory } from "./field-actor-factory.js";

export type { FieldNativeCompositionDefinition } from "../core/field-native-composition.js";
const prefix = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/";
/** The independent source check binds each material's shader object and DXBC
 * program, not a name-only shader substitution. No original program is shipped. */
const inputs = [
  { file: prefix + "chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle",
    sha256: "82befd5fd3adeed5c8055c90a9aa3b8a09837be9094f9677d33ead3cbf3a0daa",
    assetPath: "Assets/GameAssets/Common/Res/Map/Field/FieldCharaEntityShader.shader", objectId: "-2780621064449857182" },
  { file: prefix + "map_common_assets_all_320e510e7137e96ac91fe79e18fdd504.bundle",
    sha256: "c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a",
    assetPath: "Assets/GameAssets/Common/Res/Map/Common/MapTransparentTileMaterial.mat", objectId: "1918821779681963067" },
  { file: prefix + "shaders_assets_all_46e9e3032245a8a2ff9ff3236afcb55a.bundle",
    sha256: "56bebde18b58f95d3e4f9cd23e7e2c13e83892075606f1a85b5c92ac81ce1c6e",
    assetPath: "Assets/GameAssets/Common/Res/Shaders/MapTransparentTileShader.shader", objectId: "-1156586477086012646" },
];

/** The corpus contains bundles but not boot-scene Camera objects. Load that
 * independent, byte-verified source explicitly rather than inferring cameras
 * 23/24 from a null target in a reduced world artifact. */
export async function loadFieldCompositionRenderHost(root: string, sources: readonly { file: string; sha256: string }[]): Promise<FieldCompositionRenderHost> {
  compileFieldActorFactory(sources);
  const host = ordinaryFieldCompositionRenderHost();
  for (const source of new Map(host.sources.map((s) => [s.file, s])).values()) {
    const bytes = await readFile(root + "/build/runtime/game/" + source.file);
    if (createHash("sha256").update(bytes).digest("hex") !== source.sha256)
      throw new Error("Foreign source field render-target camera or color-space inputs");
  }
  return host;
}

/** Ordinary map material qualification is supplied by compileFieldActorView.
 * This additional capability retains layer PRESENCE: even an empty Upper layer
 * enables its source camera and has a valid (clear) pre-render texture. */
export function compileFieldNativeComposition(sources: readonly { file: string; sha256: string }[],
  view: FieldActorViewDefinition, tilemap: { source: FieldActorViewSource; data: unknown },
  renderHost?: FieldCompositionRenderHost): FieldNativeCompositionDefinition {
  compileFieldActorFactory(sources); validateFieldActorView(view);
  if (renderHost) validateFieldCompositionRenderHost(renderHost);
  for (const expected of inputs) {
    const matches = sources.filter((s) => s.file === expected.file);
    if (matches.length !== 1 || matches[0]!.sha256 !== expected.sha256)
      throw new Error("Unrecovered ordinary composition shader source: " + expected.file);
  }
  if (!view.sources.some((s) => s.source.file === tilemap.source.file && s.source.sha256 === tilemap.source.sha256 &&
      s.source.objectId === tilemap.source.objectId && s.source.assetPath === tilemap.source.assetPath && s.contentHash === hash(tilemap.data)))
    throw new Error("Composition tilemap is not the bound actor view");
  const map = record(tilemap.data);
  if (!Array.isArray(map.layers)) throw new Error("Missing ordinary composition layer list");
  const groups = map.layers.map(record).filter((layer) => layer.name === "TileGroup" && layer.type === "group");
  if (groups.length !== 1 || !Array.isArray(groups[0]!.layers)) throw new Error("Ambiguous composition tile group");
  const layers: FieldCompositionLayer[] = [];
  const renderTargets: FieldNativeCompositionDefinition["renderTargets"] = { upper: "disabled", ceil: "disabled" };
  for (const layer of groups[0]!.layers.map(record)) {
    if (!FIELD_COMPOSITION_LAYERS.includes(layer.name as FieldCompositionLayer) || layer.type !== "tilelayer" ||
        (layer.opacity !== undefined && layer.opacity !== 1) || (layer.visible !== undefined && layer.visible !== true) ||
        ["x", "y", "offsetx", "offsety"].some((key) => layer[key] !== undefined && layer[key] !== 0))
      throw new Error("Nonordinary composition tile-layer provider");
    layers.push(layer.name as FieldCompositionLayer);
    if (layer.name === "UpperLayer" || layer.name === "CeilLayer") {
      if (!Number.isSafeInteger(layer.width) || Number(layer.width) <= 0 || !Number.isSafeInteger(layer.height) || Number(layer.height) <= 0 ||
          !Array.isArray(layer.data) || layer.data.length !== Number(layer.width) * Number(layer.height) ||
          layer.data.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 0xffffffff))
        throw new Error("Missing complete pre-render source tile data");
      renderTargets[layer.name === "UpperLayer" ? "upper" : "ceil"] = layer.data.some((n) => (Number(n) & 0x0fffffff) !== 0)
        ? renderHost ? "source-rendered" : "unresolved" : "clear-only";
    }
  }
  const result: FieldNativeCompositionDefinition = {
    kind: "native-ordinary-field-composition-v1", contextId: view.contextId, view: structuredClone(view),
    sources: [...view.sources.map((s) => ({ ...s.source })), ...inputs.map((s) => ({ ...s }))], layers,
    upperTexture: layers.includes("UpperLayer") ? fieldCompositionTexture(view.contextId, "UpperLayer") : null,
    ceilTexture: layers.includes("CeilLayer") ? fieldCompositionTexture(view.contextId, "CeilLayer") : null,
    renderTargets,
    ...(renderHost ? { renderHost: structuredClone(renderHost) } : {}),
  };
  validateFieldNativeComposition(result, view);
  return result;
}
