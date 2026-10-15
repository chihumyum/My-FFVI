import { worldLoopSessionFixture } from "./world-loop-session.js";
import { sealBatchContent } from "./content-batch.js";
import { compileFrameworkNewGame } from "../../src/compiler/framework-new-game.js";
import { decodeFieldOp } from "../../src/compiler/field.js";
import { GameSession, type GameSessionRuntime } from "../../src/core/game-session.js";
import { GameFlow } from "../../src/core/game-flow.js";
import { WEB_FLAT_BIRD_VIEW_ACTORS } from "../../src/core/field-bird-view-actors.js";
import type { Op, Site } from "../../src/field/types.js";
type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
export const birdHost = { visible: true, mediaReady: true, overlayOpen: false };
export const birdReached = { category: "MapLocalVariable" as const, index: 6 };
export function birdRaw(ints = [1, 1, 0], reals = [0, 0], animation = "") {
  return { type: 2, mnemonic: "MoveBirdView", operands: { iValues: [...ints, ...Array(8 - ints.length).fill(0)],
    rValues: [...reals, ...Array(8 - reals.length).fill(0)], sValues: [animation, ...Array(7).fill("")] } };
}
/** Source-shaped authored mechanism fixture. No original dialogue, actor or
 * scene identity is needed to execute the same production owners. */
export async function birdViewActorsFixture(options: { runtime?: GameSessionRuntime; contentPolicy?: boolean } = {}) {
  const f = await worldLoopSessionFixture(), maps = [structuredClone(f.map), structuredClone(f.worldMap)],
    source = { file: "tests/fixtures/bird-view-actors.ts", assetPath: "authored/bird-view-actors" };
  for (const map of maps) {
    if (options.contentPolicy !== false) map.developmentProfile!.birdViewActors = WEB_FLAT_BIRD_VIEW_ACTORS;
    const context = structuredClone(Object.values(map.scriptPuppetContexts!)[0]!);
    const add = (name: string, raw: ReturnType<typeof birdRaw>, wait = 0, camera = false, conflict = false) => {
      const decoded = decodeFieldOp(raw, { script: name, index: 5, source }, {});
      if (decoded.kind !== "field-bird-view-move") throw new Error("Authored BirdView command failed decoding");
      const instructions: Instruction<Op>[] = [
        { kind: "puppet", slot: 0, actor: camera ? "0" : "-1001", target: conflict ? 5 : 4 },
        ...(conflict ? [{ kind: "puppet" as const, slot: 1, actor: "-1001", target: 8 }] : []),
        { kind: "exec-puppets", asynchronous: false },
        { kind: "calc", left: birdReached, operator: "＋", right: { kind: "immediate", value: 1 } },
        { kind: "exit" }, { kind: "nop" },
        ...(wait ? [{ kind: "wait" as const, seconds: wait }] : []), decoded, { kind: "exit" },
        ...(conflict ? [{ kind: "wait" as const, seconds: .03 }, decoded, { kind: "exit" as const }] : []),
      ];
      map.scripts[name] = instructions.map((op, index) => ({ ...op, script: name, index, source })) as Op[];
      map.scriptPuppetContexts![name] = { ...context, scriptHash: "9".repeat(64) };
      (map.scriptLocals ??= {})[name] = null;
      (map.scriptSystemFlags ??= {})[name] = { keepBadStatusVisual: false };
    };
    add("bird-instant", birdRaw([4, 0, 900], [0, 0], "UnusedHeightAnimation"));
    add("bird-up", birdRaw([1, 0, 0], [1, .5]));
    add("bird-down", birdRaw([1, 0, 0], [-1, .1]));
    add("bird-move", birdRaw([1, 2, 0], [.5, .3]));
    add("bird-missing-animation", birdRaw([1, 2, 0], [.5, .3], "MissingControlledAnimation"));
    add("bird-camera", birdRaw([4, 0, 0], [1, 0]), 0, true);
    add("bird-conflict", birdRaw([1, 0, 0], [1, .5]), 0, false, true);
    for (const name of ["stone-battle", "after-stone-battle"]) {
      map.scripts[name] = structuredClone(f.map.scripts[name]!);
      map.scriptPuppetContexts![name] = structuredClone(f.map.scriptPuppetContexts![name]!);
      if (map.scriptLocals) map.scriptLocals[name] = null;
    }
  }
  const [map, worldMap] = maps.map(sealBatchContent), world = structuredClone(f.world);
  if (options.contentPolicy !== false) world.developmentProfile!.birdViewActors = WEB_FLAT_BIRD_VIEW_ACTORS;
  for (const m of [map!, worldMap!]) world.maps[m.mapId]!.contentHash = m.contentHash;
  const catalog = sealBatchContent(world), content = await compileFrameworkNewGame({ sourceEntry: f.sourceEntry,
    sourceBattle: f.sourceBattle, sourceMap: f.sourceMap, world: catalog, map: map!, battle: f.battle,
    entrance: map!.partyEntry!.pointIns[0]!.id });
  const runtime: GameSessionRuntime = { birdViewActors: WEB_FLAT_BIRD_VIEW_ACTORS, battleHandoff: "prepared", ...options.runtime };
  const restore = (saved: Parameters<typeof GameSession.restore>[0], ports: GameSessionRuntime = runtime) =>
    GameSession.restore(saved, undefined, f.battle, { catalog, map: saved.world.location?.mapId === worldMap!.mapId ? worldMap! : map!,
      initialized: { content, initialMap: map! } }, ports);
  const make = async (ports: GameSessionRuntime = runtime) => {
    const game = await GameSession.prepareFrameworkNewGame(content, catalog, map!, f.battle, ports), flow = new GameFlow(game);
    flow.start(game); flow.observeHost(birdHost); flow.advance(10, birdHost); return { game, flow };
  };
  return { ...f, map: map!, worldMap: worldMap!, world: catalog, content, runtime, make, restore };
}
