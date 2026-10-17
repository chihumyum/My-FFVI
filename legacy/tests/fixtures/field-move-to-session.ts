import { compileFieldNativeNpc } from "../../src/compiler/field-native-npc.js";
import { contentDigest } from "../../src/core/content-integrity.js";
import { GameSession, type GameCheckpoint } from "../../src/core/game-session.js";
import type { FieldScriptMoveTo } from "../../src/core/field-script-motion.js";
import type { FieldEntity, Op, Site } from "../../src/field/types.js";
import { scriptMotionIntegrationFixture, launchScriptMotionIntegration } from "./script-motion-integration.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
export const fieldMoveToSessionCounters = {
  completed: { category: "MapLocalVariable" as const, index: 0 },
  continued: { category: "MapLocalVariable" as const, index: 1 },
};
export const fieldMoveToSessionActors = {
  party: { selector: -1001, id: "native:puppet:0" },
  npc: { selector: 601, id: "601" },
} as const;

async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
  const { contentHash: _, ...payload } = structuredClone(value);
  return { ...payload, contentHash: await contentDigest(payload) } as T;
}

/** Authored source-style mechanism content, not an original map/story claim.
 * The real source initializer creates one owned member; the second moving
 * actor is a declared Wait NPC installed by the native entity-group factory.
 * No live actor, ownership, position, motion or story flag is patched. */
export async function fieldMoveToSessionFixture() {
  const f = scriptMotionIntegrationFixture();
  const source = { file: "controlled-field-move-to-session", assetPath: "Fixtures/FieldMoveTo/v1" };
  const asset = f.world.characters.bravo ? "bravo" : Object.keys(f.world.characters)[0]!;
  const npcSource = { ...source, pointer: "/layers/0/objects/1" };
  const compiled = compileFieldNativeNpc({ group: "entity_default",
    object: { x: 80, y: 96, width: 16, height: 16 },
    entity: { id: fieldMoveToSessionActors.npc.id, kind: 6, layer: 0, source: npcSource },
    properties: { entity_id: fieldMoveToSessionActors.npc.selector, asset_id: 77, direction: 1,
      move_type: 0, turn_around: true, move_while_display_message: false },
    tables: { "mapobject.csv": [{ id: 77, asset_name: asset, shadow_type: 1 }] } });
  if (!compiled.definition || compiled.blockers.length)
    throw new Error("Controlled MoveTo NPC did not compile: " + compiled.blockers.join(","));
  const npc: FieldEntity = { id: fieldMoveToSessionActors.npc.id, objectId: 601, kind: 6,
    x: 5, y: 5, width: 1, height: 1, layer: 0, direction: "up", asset,
    script: null, collision: null, destinationLayer: null, source: npcSource, nativeNpc: compiled.definition };
  const trigger = (id: string, y: number, script: string): FieldEntity => ({
    id, kind: 2, x: id === "move-to-first-trigger" ? 3 : 7, y,
    width: 1, height: 1, layer: 0, direction: "up", asset: null,
    script, collision: null, destinationLayer: null, source,
  });
  const entities = [...f.map.map!.groups!.entity_default!.entities, npc,
    trigger("move-to-first-trigger", 5, "move-to-pair"),
    trigger("move-to-followup-trigger", 6, "move-to-followup")];
  f.map.map!.groups!.entity_default!.entities = entities;
  f.map.map!.entities = structuredClone(entities);
  const emit = (script: string, instructions: Instruction<Op>[]): Op[] =>
    instructions.map((instruction, index) => ({ ...instruction, script, index, source }) as Op);
  const motion = (command: FieldScriptMoveTo): Instruction<Op> => ({ kind: "field-script-motion", command });
  const add = (name: string, instructions: Instruction<Op>[], hash: string): void => {
    f.map.scripts[name] = emit(name, instructions);
    f.map.scriptPuppetContexts![name] = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: hash.repeat(64) };
    f.map.scriptLocals![name] = null;
  };
  f.map.scripts.reserved = emit("reserved", [
    { kind: "calc", left: fieldMoveToSessionCounters.completed, operator: "←", right: { kind: "immediate", value: 0 } },
    { kind: "calc", left: fieldMoveToSessionCounters.continued, operator: "←", right: { kind: "immediate", value: 0 } },
    ...f.map.scripts.reserved!.map(({ script: _, index: __, source: ___, ...instruction }) => instruction),
  ]);
  add("move-to-pair", [
    { kind: "puppet", slot: 0, actor: String(fieldMoveToSessionActors.party.selector), target: 7 },
    { kind: "puppet", slot: 1, actor: String(fieldMoveToSessionActors.npc.selector), target: 10 },
    { kind: "exec-puppets", asynchronous: true }, { kind: "finish-puppets" },
    { kind: "calc", left: fieldMoveToSessionCounters.completed, operator: "＋", right: { kind: "immediate", value: 1 } },
    { kind: "message", key: "CONTROLLED_MOVETO_PAIR", speaker: "", text: "Both actor routes have drained." },
    { kind: "exit" }, { kind: "nop" },
    motion({ kind: "move-to", axis: "x", target: { kind: "direct", value: 7, layer: 0 }, speedId: 0, animation: "" }),
    { kind: "exit" }, { kind: "nop" },
    motion({ kind: "move-to", axis: "y", target: { kind: "direct", value: 7, layer: 0 }, speedId: 2, animation: "" }),
    { kind: "exit" },
  ], "5");
  add("move-to-followup", [
    { kind: "puppet", slot: 0, actor: String(fieldMoveToSessionActors.party.selector), target: 7 },
    { kind: "puppet", slot: 1, actor: String(fieldMoveToSessionActors.npc.selector), target: 10 },
    { kind: "exec-puppets", asynchronous: true }, { kind: "finish-puppets" },
    { kind: "calc", left: fieldMoveToSessionCounters.continued, operator: "＋", right: { kind: "immediate", value: 1 } },
    { kind: "message", key: "CONTROLLED_MOVETO_FOLLOWUP", speaker: "", text: "The restored owner completed its next routes." },
    { kind: "exit" }, { kind: "nop" },
    motion({ kind: "move-to", axis: "x", target: { kind: "entity", selector: fieldMoveToSessionActors.npc.selector, offset: 1 },
      speedId: 0, animation: "" }),
    { kind: "exit" }, { kind: "nop" },
    motion({ kind: "move-to", axis: "y", target: { kind: "entity", selector: fieldMoveToSessionActors.party.selector, offset: 2 },
      speedId: 2, animation: "" }),
    { kind: "exit" },
  ], "6");
  const battle = await seal(f.battle), map = await seal(f.map);
  const world = structuredClone(f.world);
  world.maps[String(map.mapId)]!.contentHash = map.contentHash;
  const catalog = await seal(world);
  const content = await seal({ ...f.content, battleCatalogHash: battle.contentHash,
    worldCatalogHash: catalog.contentHash, mapContentHash: map.contentHash });
  const dependencies = { catalog, map, source: { content, initialMap: map } };
  return { ...f, content, battle, map, world: catalog, dependencies,
    actors: fieldMoveToSessionActors, counters: fieldMoveToSessionCounters,
    restore: (saved: GameCheckpoint) => GameSession.restore(saved, undefined, battle, dependencies),
  };
}

export function launchFieldMoveToSession(f: Awaited<ReturnType<typeof fieldMoveToSessionFixture>>): GameSession {
  return launchScriptMotionIntegration(f);
}
