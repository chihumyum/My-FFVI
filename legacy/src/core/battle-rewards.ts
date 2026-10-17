import { drawBattleRandom, type BattleRandom } from "./battle-hit.js";

export type BattleDropSlot = { contentId: number; count: number };
export type MonsterDropDefinition = {
  id: number;
  rate: number;
  /** Source DropContentId1..8 in source order; never sorted by item identity. */
  slots: BattleDropSlot[];
};
export type BattleDropCatalog = {
  kind: "battle-drops-v1";
  /** MONSTER_DROP_RATE_1..8, not the monster's overall DropRate. */
  weights: number[];
  monsters: MonsterDropDefinition[];
  contents: { id: number; kind: "item" | "equipment" }[];
};
export type BattleDropGrant = {
  kind: "grant-item" | "grant-equipment";
  id: number;
  count: number;
};
export type BattleDropPlan = {
  /** SetLotMonster appends every registration, including repeated identities. */
  registrations: number[];
  rolls: {
    monsterId: number;
    chanceDraw: number;
    slotDraw: number | null;
    /** The source switch uses indices 0..7. Null means the overall roll failed. */
    slot: number | null;
    contentId: number;
    count: number;
  }[];
  /** First successful content appearance determines output order. */
  drops: { id: number; kind: "item" | "equipment"; count: number }[];
  /** Inventory capacity is applied by the owned-state transaction at receipt. */
  grants: BattleDropGrant[];
};

const int = (value: number, minimum = 0) =>
  Number.isInteger(value) && value >= minimum && value <= 0x7fffffff;

/** This catalog admits the ordinary monster item/equipment path. Independent
 * special-action deposits (including Gil rows) require their own provider and
 * must not be silently folded into this planner or discarded by its host. */
export function validateBattleDropCatalog(catalog: BattleDropCatalog): void {
  if (catalog.kind !== "battle-drops-v1" || !Array.isArray(catalog.weights) ||
      catalog.weights.length !== 8 || catalog.weights.some((n) => !int(n)) ||
      !int(catalog.weights.reduce((sum, n) => sum + n, 0), 1) ||
      !Array.isArray(catalog.monsters) || !Array.isArray(catalog.contents))
    throw new Error("Invalid battle drop rules");
  const contents = new Set<number>();
  for (const content of catalog.contents) {
    // Source SetLotData treats content 1 as a separate Gil entry. It is outside
    // this item/equipment subset even if an invalid catalog changes its kind.
    if (!int(content.id, 2) || contents.has(content.id) ||
        !["item", "equipment"].includes(content.kind))
      throw new Error("Invalid or duplicate battle drop content");
    contents.add(content.id);
  }
  const monsters = new Set<number>();
  for (const monster of catalog.monsters) {
    if (!int(monster.id, 1) || monsters.has(monster.id) ||
        !int(monster.rate) || monster.rate > 100 || !Array.isArray(monster.slots) ||
        monster.slots.length !== 8)
      throw new Error("Invalid or duplicate battle drop monster");
    monsters.add(monster.id);
    for (const [index, slot] of monster.slots.entries()) {
      if (!int(slot.contentId) || !int(slot.count))
        throw new Error("Invalid battle drop slot");
      if (monster.rate > 0 && catalog.weights[index]! > 0 && slot.contentId !== 0 &&
          (!contents.has(slot.contentId) || slot.count === 0))
        throw new Error("Unresolved reachable battle drop content");
    }
  }
}

/** Called exactly once while preparing victory, with the native death-start
 * registration order. It does not own state or RNG; its host must roll back
 * the RNG and registration queue if the larger action transaction fails. */
export function projectBattleDrops(
  catalog: BattleDropCatalog,
  orderedMonsterIds: readonly number[],
  random: BattleRandom,
): BattleDropPlan {
  validateBattleDropCatalog(catalog);
  const definitions = new Map(catalog.monsters.map((row) => [row.id, row]));
  const identities = new Map(catalog.contents.map((row) => [row.id, row.kind]));
  // Validate the entire request before drawing, so an unknown late enemy does
  // not partially advance an otherwise valid stream.
  if (!Array.isArray(orderedMonsterIds) ||
      orderedMonsterIds.some((id) => !int(id, 1) || !definitions.has(id)))
    throw new Error("Unresolved registered monster drop definition");
  const totalWeight = catalog.weights.reduce((sum, n) => sum + n, 0);
  const rolls: BattleDropPlan["rolls"] = [], drops: BattleDropPlan["drops"] = [];
  for (const monsterId of orderedMonsterIds) {
    const monster = definitions.get(monsterId)!;
    // GetBoolRand always calls Range(0, 100), including rates 0 and 100.
    const chanceDraw = drawBattleRandom(random, 0, 99);
    if (chanceDraw >= monster.rate) {
      rolls.push({ monsterId, chanceDraw, slotDraw: null, slot: null, contentId: 0, count: 0 });
      continue;
    }
    const slotDraw = drawBattleRandom(random, 0, totalWeight - 1);
    let remaining = slotDraw, slot = 7;
    for (let index = 0; index < 8; index++) {
      remaining -= catalog.weights[index]!;
      if (remaining < 0) { slot = index; break; }
    }
    const selected = monster.slots[slot]!;
    rolls.push({ monsterId, chanceDraw, slotDraw, slot, ...selected });
    // Lot constructs (0, 0) for failed rolls; the outer loop also ignores any
    // successful slot with ContentId==0, without rerolling another slot.
    if (selected.contentId === 0) continue;
    const found = drops.find((row) => row.id === selected.contentId);
    if (found) {
      const count = found.count + selected.count;
      if (!int(count, 1)) throw new Error("Battle drop quantity overflow is not admitted");
      found.count = count;
    } else drops.push({ id: selected.contentId, kind: identities.get(selected.contentId)!, count: selected.count });
  }
  return {
    registrations: [...orderedMonsterIds], rolls, drops,
    grants: drops.map((row) => ({ kind: row.kind === "item" ? "grant-item" : "grant-equipment",
      id: row.id, count: row.count })),
  };
}
