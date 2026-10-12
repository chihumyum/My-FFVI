import { z } from "zod";
import { record } from "./content.js";
import { compileFieldParticleModules } from "./field-particles.js";
import { UNITY_PARTICLE_ENGINE } from "./field-particle-emitter.js";
import { validateFieldParticleArray, type FieldParticleArrayDefinition } from "../core/field-particle-array.js";

export const UNITY_PARTICLE_ARRAY_BODIES: Readonly<Record<string, string>> = {
  "0x1947d0": "fb1338e83a1a841dc6fe6c92b8d9a84dfb04ec01f2fd9fb794e4615a51ac0f4b",
  "0x17e2f0": "440b0f639c25c6823c10a7bec8b2df62785a7bf6261e2f7392fe3558a429f4ce",
  "0x18a500": "f5868d73769ad7f701372f79bff0e18db8872c061002d520be50ebb6daa12062",
  "0x19a270": "cb7eeda858b6278f6ad569352fe91e9eb0b0c2a1c0a1489259e335d0cfcb771c",
  "0x19cc30": "ecc615c5fdcd2b1dfd8f6c1f93679d681c989b2dc0c7e0e1e982f2060c328a61",
  "0x19c5d0": "151b808b08c7d65948651195d1bd1c0a3640f2cc865754f01890df32777f8cd5",
  "0x1957f0": "0e8aec77ebe332e81ac287149693daef0725f3ff4cce26730b8ac5ec3b581bec",
  "0x186c80": "96fd0485fb67faa14363db95c8bb3cae46d873ba6430c453fad0833297b6873d",
};
const array = (value: unknown) => z.array(z.unknown()).parse(value);
/** The adapter verifies original byte/PDB and export receipts. Exact body
 * identities here prevent a different engine from acquiring this semantics. */
export function compileParticleArrayEngine(inspections: readonly unknown[]): FieldParticleArrayDefinition["engine"] {
  const methods = new Map<string, string>();
  for (const raw of inspections) {
    const item = record(raw), native = record(item.native), pdb = record(item.pdb);
    if (item.kind !== "unity-particle-native-inspection-v1" || item.semanticsVerified !== false || native.sha256 !== UNITY_PARTICLE_ENGINE.nativeSha256 ||
        native.imageBase !== "0x180000000" || !array(native.versions).includes(UNITY_PARTICLE_ENGINE.version) || pdb.sha256 !== UNITY_PARTICLE_ENGINE.pdbSha256 ||
        pdb.guid !== UNITY_PARTICLE_ENGINE.pdbGuid || pdb.age !== UNITY_PARTICLE_ENGINE.pdbAge) throw new Error("Particle array evidence does not match this source build");
    for (const rawMethod of array(item.methods)) {
      const m = record(rawMethod), rva = z.string().parse(m.rva), sha = z.string().regex(/^[0-9a-f]{64}$/).parse(m.sha256);
      if (methods.has(rva) && methods.get(rva) !== sha) throw new Error("Conflicting particle array native evidence");
      methods.set(rva, sha);
    }
  }
  for (const [rva, sha] of Object.entries(UNITY_PARTICLE_ARRAY_BODIES)) if (methods.get(rva) !== sha) throw new Error("Missing or changed particle array body " + rva);
  const { nativeSha256, pdbGuid, pdbAge, version } = UNITY_PARTICLE_ENGINE;
  return { nativeSha256, pdbGuid, pdbAge, version };
}
export function compileFieldParticleArray(assetGroup: string, raw: unknown, engine: FieldParticleArrayDefinition["engine"]): FieldParticleArrayDefinition {
  const modules = compileFieldParticleModules(assetGroup, raw), graph = record(raw), ids = new Set(array(graph.hierarchyIds));
  const objects = array(graph.objects).map(record).filter((o) => o.type === "ParticleSystem" && ids.has(record(o.source).objectId));
  if (objects.length !== 1) throw new Error("Unbound source particle array");
  const p = record(objects[0]!.data);
  for (const name of ["CollisionModule", "SubModule", "TrailModule", "TriggerModule", "ClampVelocityModule"]) {
    if (record(p[name]).enabled !== false) throw new Error("Unrecovered particle array provider " + name);
  }
  if (p.ringBufferMode !== 0) throw new Error("Unrecovered particle array ring mode");
  const result: FieldParticleArrayDefinition = { kind: "unity-field-particle-array-v1", source: structuredClone(modules.source), engine: structuredClone(engine),
    maximumParticles: modules.maxParticles, ringBufferMode: 0, collision: false, subEmitters: false, trails: false };
  validateFieldParticleArray(result);
  return result;
}
