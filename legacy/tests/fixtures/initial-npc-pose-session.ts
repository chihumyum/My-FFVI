import { compileFieldEntityPoseBlockers } from "../../src/compiler/field-initial-npc-pose.js";
import { contentDigest } from "../../src/core/content-integrity.js";
import { GameSession } from "../../src/core/game-session.js";
import type { Op, Site } from "../../src/field/types.js";
import { fieldMoveToSessionFixture, launchFieldMoveToSession } from "./field-move-to-session.js";
type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
 const { contentHash: _, ...body } = structuredClone(value); return { ...body, contentHash: await contentDigest(body) } as T;
}
/** Authored before-launch media has a single source direction and authored
 * next cycle. It is independent of the party asset: no real asset is aliased,
 * extended or substituted, and no existing live state is patched. */
export async function initialNpcPoseSessionFixture() {
 const f = await fieldMoveToSessionFixture(), map = structuredClone(f.map), world = structuredClone(f.world),
  id = f.actors.npc.id, asset = "controlled-one-direction-npc", group = map.map!.groups!.entity_default!,
  npc = group.entities.find(e => e.id === id)!, original = world.characters[npc.asset!]!, first = original.animations.WalkB!;
 world.characters[asset] = { ...structuredClone(original), source: { file: "controlled-one-direction-npc.bundle", assetPath: "authored/anim_info.json" },
  animations: { WalkB: { ...structuredClone(first), next: "WalkB-S" }, "WalkB-S": { ...structuredClone(first), next: "WalkB" } } };
 npc.asset = asset; npc.nativeNpc!.asset.asset = asset; npc.nativeNpc!.asset.animationAsset = asset.toUpperCase();
 const points = group.entities.filter(e => e.kind === 0); group.entities = [...points, npc];
 group.blockers.push(...compileFieldEntityPoseBlockers(group.entities, world.characters));
 map.map!.entities = structuredClone(group.entities); map.characterAssets = [...new Set([...map.characterAssets, asset])];
 const source = { file: "tests/fixtures/initial-npc-pose-session.ts", assetPath: "authored/pose-lifecycle" },
  emit = (script: string, ops: Instruction<Op>[]): Op[] => ops.map((op, index) => ({ ...op, script, index, source }) as Op),
  context = map.scriptPuppetContexts!.reserved!;
 const program = (name: string, ops: Instruction<Op>[]) => {
  map.scripts[name] = emit(name, ops); map.scriptLocals![name] = null;
  map.scriptPuppetContexts![name] = { ...context, scriptHash: name === "missing-pose" ? "7".repeat(64) : "8".repeat(64) };
 };
 program("missing-pose", [{ kind: "puppet", slot: 0, actor: "601", target: 4 }, { kind: "exec-puppets", asynchronous: false },
  { kind: "finish-puppets" }, { kind: "exit" }, { kind: "nop" }, { kind: "look", direction: "left" }, { kind: "exit" }]);
 const targetId = map.mapId + 1, target = structuredClone(map);
 target.mapId = targetId; target.name = "Authored initial pose retirement map";
 target.map!.identity!.mapId = targetId; target.map!.entryContext!.mapId = targetId; target.partyEntry!.mapId = targetId;
 target.map!.groups = { entity_default: { ...group, entities: structuredClone(points) } }; target.map!.entities = structuredClone(points);
 target.scripts = { arrived: emit("arrived", [{ kind: "exit" }]) }; target.scriptLocals = { arrived: null };
 target.scriptPuppetContexts = { arrived: { ...context, scriptHash: "9".repeat(64) } }; target.initializer = "arrived";
 program("leave", [{ kind: "change-map", request: { mapId: targetId, entrance: target.partyEntry!.pointIns[0]!.id,
  continuation: null, birdview: false, skipFade: true, skipBgm: true, origin: "script" } }]);
 const current = await seal(map), destination = await seal(target);
 world.transportation = structuredClone(f.battle.gameState.sourceNewGame!.transportation);
 world.maps[String(map.mapId)]!.contentHash = current.contentHash;
 world.maps[String(targetId)] = { ...world.maps[String(map.mapId)]!, url: "/authored/npc-pose-target.json", name: destination.name, contentHash: destination.contentHash };
 const catalog = await seal(world), content = await seal({ ...f.content, mapContentHash: current.contentHash, worldCatalogHash: catalog.contentHash }),
  dependencies = { catalog, map: current, source: { content, initialMap: current } }, result = { ...f, map: current, world: catalog, content, dependencies };
 return { ...result, asset, npcId: id, target: destination,
  make: () => launchFieldMoveToSession(result),
  restore: (saved: Parameters<typeof GameSession.restore>[0]) => GameSession.restore(saved, undefined, f.battle, dependencies),
  reader: { world: async () => catalog, map: async (id: number) => {
   if (id !== targetId) throw new Error("Unknown authored NPC pose map"); return destination;
  } } };
}
