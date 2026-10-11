import { sourceQualifiedBattleFixture } from "./battle-abilities.js";
import { battleEntryFixture } from "./battle-entry.js";
import { itemFixture } from "./items.js";
import type { BattleInventoryWithQualification } from "../../src/core/battle-entry.js";
import type { BattleAppearanceGeometry } from "../../src/core/battle-appearance.js";

/** Synthetic owners share stock but intentionally have different hand loadouts. */
export function battleEntryRuntimeFixture(count = 1) {
  const content = sourceQualifiedBattleFixture(), entry = battleEntryFixture();
  content.battleEntry = entry.catalog;
  content.abilityContentIds = { 10: 1010, 11: 1011, 12: 1012, 13: null };
  const equipment = entry.equipment;
  equipment.characters = Object.fromEntries(content.players.map((player) => [player.sourceId,
    { ...structuredClone(equipment.characters[1]!), sourceId: player.sourceId, jobId: 12 }]));
  for (const gear of Object.values(equipment.definitions)) gear.jobIds = [12];
  const inventory: BattleInventoryWithQualification = {
    definitions: Object.fromEntries([10001, 10002, 10003, 10004, 10005].map((id) => [id, itemFixture(id)])),
    stacks: [{ id: 10001, count }], limit: 99,
    qualification: {
      equipmentCatalog: equipment,
      equipmentStock: [{ id: 101, count: 1, equipped: 1 }],
      members: content.players.map((player, index) => ({ id: player.id, sourceId: player.sourceId,
        equipment: [index === 0 ? 1 : 101, 2, 3, 4, 5, 5] })),
    },
  };
  return { content, inventory };
}

export function battleEntryAppearanceFixture(mounted = true) {
  const fixture = battleEntryRuntimeFixture();
  const { content } = fixture;
  content.conditions.rules.definitions.find((row) => row.id === 305)!.eraseGroupId = 9;
  content.conditions.rules.definitions.push({ id: 53, type: 607, overlapped: false, eraseGroupId: 4 });
  content.conditions.rules.eraseRules.push(
    { id: 4, groupId: 4, conditionId: 53, type: 2, eraseConditionId: 0 },
    { id: 9, groupId: 9, conditionId: 305, type: 5, eraseConditionId: 53 },
  );
  content.conditions.behaviors.push({ id: 53, kind: "magitek", name: "", untilType: 3 });
  const shape: BattleAppearanceGeometry = { width: 20, height: 30, pixelsPerUnit: 1,
    pivot: [0.5, 0], textureWrap: [1, 1], filterMode: 0 };
  content.battleAppearance = {
    kind: "source-magitek", conditionId: 53,
    conditions: content.conditions.rules.definitions.map(({ id, type }) => ({ id, type })),
    sizeRules: { mog: 7, magitekOffset: 10, magitekKappa: 18 },
    aliases: Object.fromEntries([["default", "Idle_00"], ["down", "Down_00"], ["dying", "Dying_00"], ["IdleR00", "IdleR_00"], ["dyingR00", "DyingR_00"]].map(([key, body]) =>
      [key!, { body: [body!], armor: [key === "IdleR00" || key === "dyingR00" ? "WalkR_01" : "WalkL_01"], textureOffsets: [{ x: 0, y: 0.25 }], positions: [{ x: 0, y: 12 }] }])),
    armorSprites: { WalkL_01: "armor", WalkR_01: "armor-right" },
    armorGeometry: { WalkL_01: { ...shape, width: 40, height: 40 }, WalkR_01: { ...shape, width: 40, height: 40 } },
  };
  content.sprites.armor = { file: "synthetic-armor.png", width: 40, height: 40 };
  content.sprites["armor-right"] = { file: "synthetic-armor-right.png", width: 40, height: 40 };
  for (const player of content.players) {
    player.conditionIds = mounted ? [53] : [];
    player.appearance = { sourceId: player.sourceId, characterAssetId: player.sourceId + 10, sizeType: 1,
      bodySprites: {}, bodyGeometry: {} };
    for (const name of ["Idle_00", "Down_00", "Dying_00", "IdleR_00", "DyingR_00"]) {
      const key = player.id + ":" + name;
      player.appearance.bodySprites[name] = key;
      player.appearance.bodyGeometry[name] = structuredClone(shape);
      content.sprites[key] = { file: "synthetic-" + name + ".png", width: shape.width, height: shape.height };
    }
  }
  return fixture;
}
