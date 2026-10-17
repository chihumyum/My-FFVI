import { GameFlow, type GameFlowHostState } from "../../src/core/game-flow.js";
import { GameSession } from "../../src/core/game-session.js";
import type { FieldEntity, Op } from "../../src/field/types.js";
import { checkpointFixture } from "./checkpoint-game.js";
import { equipmentGameFixture } from "./equipment-game.js";

export const readyHost: GameFlowHostState = {
  visible: true, mediaReady: true, overlayOpen: false,
};
const source = { file: "synthetic", assetPath: "game-flow" };
const op = (value: Record<string, unknown>): Op =>
  ({ script: "flow", index: 0, source, ...value }) as Op;

/** Explicit development content, with real field, owned, world and battle
 * owners. No mock session or replacement clock participates in flow tests. */
export function gameFlowFixture({ shop = false }: { shop?: boolean } = {}) {
  const fixture = checkpointFixture();
  const equipment = shop ? equipmentGameFixture() : null;
  const field = equipment?.field ?? fixture.field;
  const catalog = equipment?.catalog ?? fixture.battle;
  const entities: FieldEntity[] = shop ? [{
    id: "shopkeeper", kind: 6, x: 2, y: 1, layer: 1,
    width: 1, height: 1, direction: "left", asset: "hero", script: null,
    collision: null, destinationLayer: null, source,
    npc: { moveType: 0, collision: true, pushed: false, eyeContact: true,
      turnAround: true, acceptDirection: 15, talkMounts: [""], soundId: 0,
      interaction: { kind: "shop", groupId: 7,
        start: { key: "WELCOME", speaker: "Clerk", text: "Welcome" },
        close: { key: "GOODBYE", speaker: "Clerk", text: "Goodbye" } } },
  }] : [];
  field.map.entities = entities;
  field.map.groups!.entity_default = {
    ...field.map.groups!.entity_default!, entities,
  };
  field.scripts.conversation = [
    op({ kind: "wait", seconds: 0.03 }),
    op({ kind: "message", key: "FLOW", speaker: "Guide", text: "Continue" }),
    op({ kind: "flag", ref: { category: "ScenarioFlag1", index: 3 }, operation: "set" }),
    op({ kind: "exit" }),
  ];
  field.scripts.blocked = [op({ kind: "blocked", mnemonic: "Unknown", reason: "Controlled unavailable provider" })];
  field.scripts.leave = [op({ kind: "change-map", request: {
    mapId: 2, entrance: 1, continuation: null, birdview: false,
    skipFade: false, skipBgm: false, origin: "script",
  } })];
  if (shop) catalog.gameState.shops = {
    kind: "ordinary-shops-v1", pricing: "unit-price-times-count",
    itemLimit: catalog.gameState.limits.item, gilLimit: catalog.gameState.limits.gil,
    groups: [{ id: 7, name: "Synthetic shop", productIds: [1001] }],
    products: [{ id: 1001, groupId: 7, contentId: 10, buy: 30, limit: 0 }],
    contents: [
      { id: 10, kind: "item", name: "Synthetic item", buy: 30, sell: 15, sellable: true },
      ...Object.values(catalog.gameState.equipmentSystem!.catalog.definitions).map((definition) => ({
        id: definition.id, kind: "equipment" as const, name: definition.name,
        buy: 40, sell: 20, sellable: !definition.empty,
      })),
    ],
  };
  const game = new GameSession(field, catalog, 314);
  return { ...fixture, field, battle: catalog, game, flow: new GameFlow(game) };
}

export function startFlow(flow: GameFlow): void {
  flow.start();
  flow.advance(0, readyHost);
}
