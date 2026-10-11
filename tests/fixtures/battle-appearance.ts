import type { BattleAppearanceActor, BattleAppearanceCatalog, BattleAppearanceGeometry } from "../../src/core/battle-appearance.js";

export function appearanceFixture() {
  const shape = (height: number): BattleAppearanceGeometry => ({ width: 32, height,
    pixelsPerUnit: 1, pivot: [0.5, 0], textureWrap: [1, 1], filterMode: 0 });
  const aliases = {
    default: { body: ["idle"], armor: ["mount"], textureOffsets: [{ x: 0, y: .25 }], positions: [{ x: 0, y: 24 }] },
    down: { body: ["down"], armor: ["mount"], textureOffsets: [{ x: 0, y: 0 }], positions: [{ x: 0, y: 20 }] },
    dying: { body: ["dying"], armor: ["mount"], textureOffsets: [{ x: 0, y: .25 }], positions: [{ x: 0, y: 24 }] },
    move: { body: ["walk0", "walk1"], armor: ["mount", "mount1", "mount2", "mount1"],
      textureOffsets: [{ x: .125, y: .25 }], positions: [{ x: 2, y: 25 }, { x: 3, y: 26 }] },
    right: { body: ["right"], armor: ["mountRight"], textureOffsets: [{ x: 0, y: .25 }], positions: [{ x: 0, y: 24 }] },
    IdleR00: { body: ["right"], armor: ["mountRight"], textureOffsets: [{ x: 0, y: .25 }], positions: [{ x: 0, y: 24 }] },
    dyingR00: { body: ["dyingRight"], armor: ["mountRight"], textureOffsets: [{ x: 0, y: .25 }], positions: [{ x: 0, y: 24 }] },
  };
  const actor: BattleAppearanceActor = { sourceId: 101, characterAssetId: 201, sizeType: 3,
    bodySprites: {}, bodyGeometry: {} };
  for (const name of new Set(Object.values(aliases).flatMap((alias) => alias.body))) {
    actor.bodySprites[name] = "synthetic/body/" + name; actor.bodyGeometry[name] = shape(32);
  }
  const catalog: BattleAppearanceCatalog = { kind: "source-magitek", conditionId: 153,
    conditions: [{ id: 153, type: 607 }, { id: 105, type: 5 }, { id: 104, type: 4 },
      { id: 101, type: 601 }, { id: 181, type: 681 }],
    sizeRules: { mog: 11, magitekOffset: 200, magitekKappa: 250 }, aliases,
    armorSprites: {}, armorGeometry: {} };
  for (const name of new Set(Object.values(aliases).flatMap((alias) => alias.armor))) {
    catalog.armorSprites[name] = "synthetic/armor/" + name; catalog.armorGeometry[name] = shape(40);
  }
  const sprites: Record<string, { width: number; height: number }> = {};
  for (const [name, key] of Object.entries(actor.bodySprites)) sprites[key] = actor.bodyGeometry[name]!;
  for (const [name, key] of Object.entries(catalog.armorSprites)) sprites[key] = catalog.armorGeometry[name]!;
  return { actor, catalog, sprites };
}
