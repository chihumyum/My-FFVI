import type { FieldEffectBoardDefinition, FieldEffectCatalog } from "../../src/core/field-effects.js";

export function effectDefinition(overrides: Partial<FieldEffectBoardDefinition> = {}): FieldEffectBoardDefinition {
  return { kind: "source-field-effect-board-v1", assetId: 1, assetGroup: "controlled_effect", assetName: "Prefabs/EffectPrefab",
    pixelPosition: { x: 32, y: 32 }, pixelSize: { width: 16, height: 16 },
    playOnAwake: true, front: true, split: true, zOffset: 2, affected: true, blendType: 0,
    zTest: 4, collision: false, building: false, birdviewPuppet: false, screen: false, visibleMinimap: false,
    source: { file: "synthetic", assetPath: "synthetic/controlled.json", objectId: "1" }, ...overrides };
}
/** Explicit controlled observation host data, never a source-media fallback. */
export function effectCatalog(loop = true): FieldEffectCatalog {
  return { media: { controlled_effect: { kind: "source-field-effect-media-v1", assetGroup: "controlled_effect",
    source: { file: "synthetic", assetPath: "synthetic/Prefabs/EffectPrefab.prefab", objectId: "1" },
    orthographicSize: 16, renderTexture: { width: 32, height: 32, filterMode: 0, wrapMode: 1 },
    particles: [{ id: "3", loop, enabledModules: ["InitialModule"] }], animator: null, blockers: [] } } };
}
export function effectMediaExport() {
  const source = { file: "controlled_effect_assets_all_123.bundle", assetPath: "Effects/Prefabs/EffectPrefab.prefab",
    serializedFile: "CAB-controlled", sha256: "a".repeat(64), objectId: "1" };
  const ptr = (m_PathID: string, m_FileID = 0) => ({ m_PathID, m_FileID });
  const go = ptr("1");
  const raw: [string, string, Record<string, unknown>][] = [
    ["1", "GameObject", { m_Component: ["2", "3", "4", "5"].map((i) => ({ component: ptr(i) })) }],
    ["2", "Transform", { m_GameObject: go, m_Children: [], m_Father: ptr("0") }],
    ["3", "ParticleSystem", { m_GameObject: go, looping: true, autoRandomSeed: true, prewarm: true,
      InitialModule: { enabled: true }, NoiseModule: { enabled: true } }],
    ["4", "ParticleSystemRenderer", { m_GameObject: go, m_Materials: [ptr("6")] }],
    ["5", "Camera", { m_GameObject: go, orthographic: true, "orthographic size": 16 }],
    ["6", "Material", { m_Shader: ptr("9007199254740993", 1), m_SavedProperties: { m_TexEnvs: [] } }],
  ];
  return { source, rootId: "1", hierarchyIds: ["1", "2", "3", "4", "5"],
    externals: [{ fileId: 1, path: "archive:/CAB-external/CAB-external" }],
    objects: raw.map(([id, type, data]) => ({ source: { ...source, objectId: id }, type, data })) };
}
