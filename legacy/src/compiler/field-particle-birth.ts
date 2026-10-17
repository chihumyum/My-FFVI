import { z } from "zod";
import { record } from "./content.js";
import { compileFieldParticleModules } from "./field-particles.js";
import { UNITY_PARTICLE_ENGINE } from "./field-particle-emitter.js";
import { validateFieldParticleBirth, type FieldParticleBirthDefinition, type ParticleBirthRange, type ParticleBirthVector } from "../core/field-particle-birth.js";

export const UNITY_PARTICLE_BIRTH_BODIES: Readonly<Record<string, string>> = {
  "0x20b2d0": "6e506f8d65a831ca263d608c8a51f555a0068ec7c91ee6cfc537bf9bed07ec06",
  "0xd972c0": "2646de00f25694f70fd2a48e1d9af8b03ccddeb9d10a6e1aec68449a8aad4248",
  "0xda9940": "b1b53d24f932b64d2fcfc9b821c8e81205ea09d5d67c72f5525b65f3ddaea1b3",
  "0xda6ef0": "3012271e79083c68609e2fe896dcb9a41d5a4058b0338ecd1de906870fec2f20",
  "0xda7d90": "d23053d5e882bdc060d4e215af449f018bc737cf6d83c3c2db54e020fc805c04",
  "0x185510": "4753f6d9a19b57d280c6cdbe6666f5c4b42118ea691a8c5ecfd9d93b724cea3d",
  "0x206f90": "8f213de2490f5db6ca31fe3a9462d4888f1aba2cf75eb10bee30b51731562c3e",
  "0x1957f0": "0e8aec77ebe332e81ac287149693daef0725f3ff4cce26730b8ac5ec3b581bec",
  "0x20b260": "12e9e252a7ffc4de5f9944c0049b5706ec5a8b36912e9e699ec5ae18981b6bae",
  "0x206540": "588b2ae3544895545d8d79cbb0bc166ad716eb466c43271f0b81eeb4e561cadc",
  "0x196260": "1628ebf42e514b02e911e88b4c5622baa3d58eb1e5ee89e69ac05301b508d6eb",
  "0x80c10": "a4b83842086554693842ea17b253c09222e9f9d3183850a4b0746458e05e4433",
};
const array = (v: unknown) => z.array(z.unknown()).parse(v);
const number = (v: unknown) => z.number().finite().refine((n) => Number.isFinite(Math.fround(n))).parse(v);
const tuple = (v: unknown): ParticleBirthVector => { const r = record(v); return [number(r.x), number(r.y), number(r.z)]; };

/** Byte/PDB receipts are verified by the input adapter/checker. These exact
 * identities bind this compiler to the reviewed source implementation. */
export function compileParticleBirthEngine(inspections: readonly unknown[]): FieldParticleBirthDefinition["engine"] {
  const methods = new Map<string, string>();
  for (const raw of inspections) {
    const item = record(raw), native = record(item.native), pdb = record(item.pdb);
    if (item.kind !== "unity-particle-native-inspection-v1" || item.semanticsVerified !== false || native.sha256 !== UNITY_PARTICLE_ENGINE.nativeSha256 ||
      native.imageBase !== "0x180000000" || !array(native.versions).includes(UNITY_PARTICLE_ENGINE.version) || pdb.sha256 !== UNITY_PARTICLE_ENGINE.pdbSha256 ||
      pdb.guid !== UNITY_PARTICLE_ENGINE.pdbGuid || pdb.age !== UNITY_PARTICLE_ENGINE.pdbAge) throw new Error("Particle birth evidence does not match this source build");
    for (const rawMethod of array(item.methods)) {
      const method = record(rawMethod), rva = z.string().parse(method.rva), sha = z.string().regex(/^[0-9a-f]{64}$/).parse(method.sha256);
      if (methods.has(rva) && methods.get(rva) !== sha) throw new Error("Conflicting particle birth native evidence");
      methods.set(rva, sha);
    }
  }
  for (const [rva, sha] of Object.entries(UNITY_PARTICLE_BIRTH_BODIES)) if (methods.get(rva) !== sha) throw new Error("Missing or changed particle birth body " + rva);
  const { nativeSha256, pdbGuid, pdbAge, version } = UNITY_PARTICLE_ENGINE;
  return { nativeSha256, pdbGuid, pdbAge, version };
}

export function compileFieldParticleBirth(assetGroup: string, raw: unknown, engine: FieldParticleBirthDefinition["engine"]): FieldParticleBirthDefinition {
  const modules = compileFieldParticleModules(assetGroup, raw), shape = record(modules.requirements.shape);
  if (modules.maxParticles !== 1000 || shape.type !== 4 || shape.placementMode !== 0 || shape.radiusThickness !== 1 ||
    shape.alignToDirection !== false || shape.randomDirectionAmount !== 0 || shape.sphericalDirectionAmount !== 0 || shape.randomPositionAmount !== 0)
    throw new Error("Native particle birth requires the recovered full-thickness Cone subset");
  const arc = record(shape.arc), radius = record(shape.radius);
  if (arc.mode !== 0 || arc.value !== 360 || arc.spread !== 0 || radius.mode !== 0 || radius.spread !== 0)
    throw new Error("Unsupported native Cone arc/radius sampling mode");
  for (const key of ["m_Texture", "m_Mesh", "m_MeshRenderer", "m_SkinnedMeshRenderer", "m_Sprite", "m_SpriteRenderer"]) {
    const p = record(shape[key]); if (p.m_FileID !== 0 || p.m_PathID !== "0") throw new Error("Native textured/mesh Cone birth is unavailable");
  }
  if (tuple(shape.m_Position).some((v) => v !== 0) || tuple(shape.m_Scale).some((v) => v !== 1))
    throw new Error("Native Cone nonzero position/non-unit scale is unavailable");
  const range = (key: "lifetime" | "speed" | "size" | "rotation"): ParticleBirthRange => {
    const v = modules.start[key]; if (v.mode !== "constant" && v.mode !== "two-constants") throw new Error("Varying native particle birth curve is unavailable");
    return structuredClone(v);
  };
  if (modules.start.color.mode !== "color") throw new Error("Varying native particle birth color is unavailable");
  const c = modules.start.color.color;
  const result: FieldParticleBirthDefinition = { kind: "unity-local-cone-particle-birth-v1", source: structuredClone(modules.source), engine: structuredClone(engine),
    initial: { lifetime: range("lifetime"), speed: range("speed"), size: range("size"), rotation: range("rotation"), color: [c.r, c.g, c.b, c.a] },
    cone: { angle: number(shape.angle), radius: number(radius.value), rotation: tuple(shape.m_Rotation) } };
  validateFieldParticleBirth(result);
  return result;
}
