import type { FieldEntity, Op } from "../../src/field/types.js";
import { contentBatchProgramFixture } from "./content-batch-program.js";
import { sealBatchContent } from "./content-batch.js";

/** Authored ordinary economy route on the existing shared gameplay fixture.
 * Purchases provide its consumables/equipment; scheduled battles provide its
 * damage and rewards. No original story, initial money or grants are changed. */
export function shopEconomyLoopFixture() {
  const fixture = contentBatchProgramFixture(), { battle, catalog, maps } = fixture.packages;
  const field = fixture.packages.entry;
  const source = { file: "synthetic", assetPath: "shop-economy-loop" };
  const npc: FieldEntity = {
    id: "economy-clerk", kind: 17, x: 2, y: 1, layer: 1, width: 1, height: 1,
    direction: "left", asset: "hero", script: null, collision: null, destinationLayer: null, source,
    npc: { moveType: 0, collision: true, pushed: false, eyeContact: true, turnAround: true,
      acceptDirection: 15, talkMounts: [""], soundId: 0, interaction: {
        kind: "shop", groupId: 7,
        start: { key: "ECONOMY_OPEN", speaker: "Clerk", text: "Choose supplies" },
        close: { key: "ECONOMY_CLOSE", speaker: "Clerk", text: "Continue your journey" },
      } },
  };
  const entities = field.map.entities;
  entities.find(entity => entity.id === "first-battle")!.x = 3;
  entities.find(entity => entity.id === "map-exit")!.x = 4;
  entities.push(npc);
  field.map.groups!.entity_default!.entities = entities;
  field.scripts.first = field.scripts.first!.filter(op => op.kind === "encounter")
    .map((op, index) => ({ ...op, index }));
  maps[0]!.map = structuredClone(field.map);
  maps[0]!.scripts = structuredClone(field.scripts);
  // Destination initialization retains its ordinary flag but grants no stock:
  // all potion counts in this route come from the declared shop transactions.
  maps[1]!.scripts.init = maps[1]!.scripts.init!.filter(op => op.kind !== "inventory")
    .map((op, index) => ({ ...op, index }) as Op);
  const definitions = battle.gameState.equipmentSystem!.catalog.definitions;
  battle.gameState.shops = {
    kind: "ordinary-shops-v1", pricing: "unit-price-times-count",
    itemLimit: battle.gameState.limits.item, gilLimit: battle.gameState.limits.gil,
    groups: [{ id: 7, name: "Authored ordinary supply shop", productIds: [1001, 1002] }],
    products: [
      { id: 1001, groupId: 7, contentId: 10, buy: 10, limit: 0 },
      { id: 1002, groupId: 7, contentId: 202, buy: 20, limit: 0 },
    ],
    contents: [
      { id: 10, kind: "item", name: "Synthetic potion", buy: 10, sell: 5, sellable: true },
      ...Object.values(definitions).map(definition => ({ id: definition.id, kind: "equipment" as const,
        name: definition.name, buy: definition.id === 202 ? 20 : 40,
        sell: definition.id === 202 ? 10 : 20, sellable: !definition.empty })),
    ],
  };
  const sealVariant = <T extends { contentHash: string; developmentProfile?: { sourceContentHash: string } }>(value: T): T => {
    const { developmentProfile, ...base } = value;
    const raw = sealBatchContent(base as T);
    return sealBatchContent({ ...raw,
      ...(developmentProfile ? { developmentProfile: { ...developmentProfile, sourceContentHash: raw.contentHash } } : {}) } as T);
  };
  fixture.packages.entry = sealVariant(field);
  fixture.packages.maps = maps.map(sealVariant);
  catalog.maps = Object.fromEntries(fixture.packages.maps.map(map => [map.mapId, {
    ...catalog.maps[map.mapId]!, contentHash: map.contentHash,
  }]));
  fixture.packages.catalog = sealVariant(catalog);
  fixture.packages.battle = sealBatchContent(battle);
  fixture.manifest.id = "synthetic-shop-economy-loop";
  const route = fixture.manifest.routes[0]!;
  route.id = "shop-equip-battle-restore-continue";
  route.inputs = [
    { kind: "confirm" },
    { kind: "shop", groupId: 7, request: { kind: "buy", productId: 1001, count: 3 } },
    { kind: "shop", groupId: 7, request: { kind: "sell", contentId: 10, count: 1 } },
    { kind: "shop", groupId: 7, request: { kind: "buy", productId: 1002, count: 1 } },
    { kind: "leave-shop", groupId: 7 },
    { kind: "menu", command: { kind: "change-equipment", playerId: "a", slot: 2, contentId: 202 } },
    { kind: "move", direction: "down" }, { kind: "move", direction: "right" },
    { kind: "move", direction: "right" }, { kind: "move", direction: "up" },
    { kind: "menu", command: { kind: "use-item", itemId: 10, targetId: "a" } },
    { kind: "save-restore" },
    { kind: "menu", command: { kind: "set-preferences", preferences: { mode: "wait", speedIndex: 3 } } },
    { kind: "move", direction: "right" }, { kind: "move", direction: "right" },
  ];
  return fixture;
}
