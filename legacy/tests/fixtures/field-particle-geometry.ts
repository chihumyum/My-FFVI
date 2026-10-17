import { FIELD_EFFECT_BOARD_PROGRAMS, FIELD_PARTICLE_VERTEX, FIELD_PARTICLE_GEOMETRY_REQUIREMENTS,
  fieldEffectBoardSources, type FieldEffectBoardMaterial, type FieldParticleGeometry, type FieldParticleRendering } from "../../src/core/field-particle-geometry.js";
import { particleMaterial } from "./field-particles.js";

export function effectBoardMaterial(): FieldEffectBoardMaterial {
  return { kind: "source-field-effect-board-material-v1", sources: fieldEffectBoardSources(),
    vertexSha256: FIELD_EFFECT_BOARD_PROGRAMS.vertex,
    fragments: [FIELD_EFFECT_BOARD_PROGRAMS.opaque, FIELD_EFFECT_BOARD_PROGRAMS.color],
    uvScale: [1, 1], uvOffset: [0, 0], vertexColor: [1, 1, 1, 1] };
}
/** Synthetic graph values, with shader metadata fixed to the recovered program.
 * It is deliberately not a qualified engine geometry or RT provider. */
export function particleGeometry(): FieldParticleGeometry {
  const source = { file: "synthetic.bundle", assetPath: "controlled/EffectPrefab.prefab", serializedFile: "CAB-controlled",
    objectId: "1", sha256: "a".repeat(64) };
  const transform = () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
  const camera = transform(); camera.position.z = -20;
  return { kind: "source-field-particle-geometry-v1", assetGroup: "controlled_effect", source,
    sources: ["2", "3", "4", "5"].map((objectId) => ({ ...source, objectId })),
    emitter: { id: "3", transforms: [transform()], simulationSpace: 0, scalingMode: 0 },
    renderer: { id: "4", mode: 0, alignment: 0, allowRoll: true, minSize: 0, maxSize: 0.5,
      pivot: { x: 0, y: 0, z: 0 }, flip: { x: 0, y: 0, z: 0 }, sortMode: 0, vertexStreams: [0, 1, 3, 4] },
    camera: { id: "5", transforms: [camera], orthographicSize: 16, viewport: [0, 0, 1, 1], near: Math.fround(0.3), far: 1000,
      clear: [0, 0, 0, 0], mask: 16384 },
    target: { width: 32, height: 32, filterMode: 0, wrapMode: 1, requestedColorFormat: 0, requestedSRGB: true, depthBits: 0, msaaSamples: 1 },
    vertexSha256: FIELD_PARTICLE_VERTEX, requirements: [...FIELD_PARTICLE_GEOMETRY_REQUIREMENTS] };
}
/** Controlled values with recovered program identities; no game texture or
 * actual emitter state is part of this redistributable fixture. */
export function particleRendering(): FieldParticleRendering {
  const source = fieldEffectBoardSources()[0]!, material = particleMaterial();
  material.vertexSha256 = FIELD_PARTICLE_VERTEX;
  material.fragmentSha256 = "75c814aca4b802512f88f5c9c6ea4cef7d925c3cb4c5d39fd59e55e8490754ff";
  return { kind: "source-field-particle-rendering-v1", geometry: particleGeometry(),
    engine: "unity-2019.4.20f1-generate-0-0-0-0", material,
    colorSpace: { active: 0, source: { file: "FINAL FANTASY VI_Data/globalgamemanagers", serializedFile: "globalgamemanagers",
      objectId: "1", sha256: "bc33b3eaaab47d14fbbf792f5bcc664c7e2f4787376449306739bce658dc7881" } },
    entity: { source, gameObject: { ...source, objectId: "4232085036942990611" },
      transform: { ...source, objectId: "-8226728852999962409" }, parent: null,
      local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } } },
    target: { graphicsFormat: 8, encoding: "rgba8-unorm", depthAttachment: null, samples: 1 } };
}
/** Redistributable shape fixture. It includes identity metadata, no game media. */
export function effectBoardMaterialExport() {
  const refs = fieldEffectBoardSources(), property = (val: number, name = "") => ({ val, name });
  const passes = [FIELD_EFFECT_BOARD_PROGRAMS.opaque, FIELD_EFFECT_BOARD_PROGRAMS.color].map((sha256, n) => ({
    programs: { progVertex: { sha256: FIELD_EFFECT_BOARD_PROGRAMS.vertex }, progFragment: { sha256 } },
    state: { zWrite: property(n === 0 ? 1 : 0), culling: property(0), zClip: property(1), alphaToMask: property(0),
      offsetFactor: property(0), offsetUnits: property(0), stencilReadMask: property(255), stencilWriteMask: property(255),
      zTest: property(4, "_ZTestCmpFunc"), stencilRef: property(2, "_StencilRef"), rtSeparateBlend: false,
      stencilOp: { pass: property(2), comp: property(8), fail: property(0), zFail: property(0) },
      rtBlend0: { colMask: property(15), blendOp: property(0), blendOpAlpha: property(0), srcBlend: property(1, "_SrcBlend"),
        srcBlendAlpha: property(1, "_SrcBlend"), destBlend: property(10, "_DstBlend"), destBlendAlpha: property(10, "_DstBlend") } },
  }));
  return { formatVersion: 1, sources: [refs[0]!, refs[1]!].map(({ file, sha256 }) => ({ file, sha256 })),
    particleEntity: { source: refs[0]!, externals: ["archive:/" + refs[1]!.serializedFile],
      data: { originalEffectMaterial: { m_FileID: 1, m_PathID: refs[1]!.objectId } } },
    material: { source: refs[1]!, externals: ["archive:/" + refs[2]!.serializedFile], data: {
      m_Shader: { m_FileID: 1, m_PathID: refs[2]!.objectId }, m_ShaderKeywords: "", m_CustomRenderQueue: -1,
      disabledShaderPasses: [], m_SavedProperties: { m_TexEnvs: [["_MainTex", {
        m_Texture: { m_FileID: 0, m_PathID: "0" }, m_Scale: { x: 1, y: 1 }, m_Offset: { x: 0, y: 0 } }]] } } },
    shader: { source: refs[2]!, name: "Last/FieldEffectEntityShader", passes } };
}
