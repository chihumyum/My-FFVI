import type { CombatantDefinition } from "./battle-content.js";
import type { Combatant } from "./battle.js";
import { projectActionTarget } from "./action-effects.js";
import {
  validateItemStacks,
  type ItemDefinition,
  type ItemStack,
  type BattleInventory,
} from "./items.js";
import {
  BattleConditions,
  type BattleConditionCatalog,
} from "./battle-conditions.js";

export type GameStateContent = {
  kind: "game-state-development-v1";
  limits: {
    gil: number;
    item: number;
    hp: number;
    mp: number;
    level: number;
    exp: number;
  };
  initialGil: number;
  /** Ordinary/important item stacks only; equipment stock and magic stones remain separate capabilities. */
  items: Record<string, ItemDefinition>;
  initialItems: { id: number; count: number }[];
  equipment: Record<string, number[]>;
};
export type OwnedCharacter = {
  id: string;
  sourceId: number;
  name: string;
  level: number;
  exp: number;
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  conditionIds: number[];
  equipment: number[];
};
export type GameStateSnapshot = {
  formatVersion: 1;
  kind: "owned-game-state";
  catalogHash: string;
  roster: OwnedCharacter[];
  party: string[];
  gil: number;
  totalGil: number;
  items: { id: number; count: number }[];
  completedBattles: { serial: number; encounterId: number }[];
};
export type BattleLease = {
  readonly serial: number;
  readonly encounterId: number;
};

function integer(value: number, max: number, min = 0): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("Invalid owned-state integer");
  return value;
}
function distinct<T>(values: readonly T[]) {
  if (new Set(values).size !== values.length)
    throw new Error("Duplicate owned-state identity");
}
function keys(value: object, expected: string) {
  if (
    Object.keys(value).sort().join(",") !== expected.split(",").sort().join(",")
  )
    throw new Error("Unknown or missing owned-state field");
}

/** Owns durable character/item values. Battles borrow a projection, never the roster itself. */
export class GameState {
  private readonly content: GameStateContent;
  private readonly definitions: Map<string, CombatantDefinition>;
  private data: GameStateSnapshot;
  private active: {
    lease: BattleLease;
    players: Combatant[];
    items: ItemStack[];
  } | null = null;
  private revision = 0;
  private readonly conditions: BattleConditions;
  constructor(
    content: GameStateContent,
    players: readonly CombatantDefinition[],
    readonly catalogHash: string,
    conditions: BattleConditionCatalog,
  ) {
    this.conditions = new BattleConditions(structuredClone(conditions));
    this.content = structuredClone(content);
    this.definitions = new Map(players.map((p) => [p.id, structuredClone(p)]));
    distinct(players.map((p) => p.id));
    if (content.kind !== "game-state-development-v1" || !players.length)
      throw new Error("Unsupported owned-state content");
    keys(content.limits, "gil,item,hp,mp,level,exp");
    for (const max of Object.values(content.limits))
      integer(max, 0x7fffffff, 1);
    for (const p of players) {
      const equipment = content.equipment[p.id];
      if (!equipment || equipment.length !== 6)
        throw new Error("Missing source equipment slots");
      equipment.forEach((id) => integer(id, 0x7fffffff, 1));
    }
    for (const [key, item] of Object.entries(content.items)) {
      if (
        key !== String(integer(item.id, 0x7fffffff, 1)) ||
        typeof item.name !== "string" ||
        typeof item.important !== "boolean"
      )
        throw new Error("Invalid item identity");
      integer(item.itemId, 0x7fffffff, 1);
      this.conditions.validateReferences(item.forbiddenConditionIds);
    }
    this.data = {
      formatVersion: 1,
      kind: "owned-game-state",
      catalogHash,
      roster: players.map((p) => ({
        id: p.id,
        sourceId: p.sourceId,
        name: p.name,
        level: p.level,
        exp: p.exp,
        hp: p.hp,
        mp: p.mp,
        maxHp: p.hp,
        maxMp: p.mp,
        conditionIds: [...p.conditionIds],
        equipment: [...(content.equipment[p.id] ?? [])],
      })),
      party: players.map((p) => p.id),
      gil: content.initialGil,
      totalGil: content.initialGil,
      items: structuredClone(content.initialItems),
      completedBattles: [],
    };
    this.validate(this.data);
  }
  private validate(data: GameStateSnapshot) {
    keys(
      data,
      "formatVersion,kind,catalogHash,roster,party,gil,totalGil,items,completedBattles",
    );
    if (
      data.kind !== "owned-game-state" ||
      data.formatVersion !== 1 ||
      data.catalogHash !== this.catalogHash
    )
      throw new Error("Owned-state source/version mismatch");
    const limits = this.content.limits;
    integer(data.gil, limits.gil);
    integer(data.totalGil, 0x7fffffff);
    distinct(data.roster.map((p) => p.id));
    for (const p of data.roster) {
      keys(
        p,
        "id,sourceId,name,level,exp,hp,mp,maxHp,maxMp,conditionIds,equipment",
      );
      const definition = this.definitions.get(p.id);
      if (
        !definition ||
        definition.side !== "player" ||
        definition.sourceId !== p.sourceId ||
        typeof p.name !== "string"
      )
        throw new Error("Unknown roster identity");
      integer(p.level, limits.level, 1);
      integer(p.exp, limits.exp);
      integer(p.maxHp, limits.hp, 1);
      integer(p.maxMp, limits.mp);
      integer(p.hp, p.maxHp);
      integer(p.mp, p.maxMp);
      distinct(p.conditionIds);
      p.conditionIds.forEach((id) => integer(id, 0x7fffffff, 1));
      this.conditions.validateActive(p.conditionIds);
      if ((p.hp === 0) !== this.conditions.isUnableFight(p.conditionIds))
        throw new Error("Owned HP/death state mismatch");
      if (
        p.equipment.length !== 6 ||
        p.equipment.some((id, n) => id !== this.content.equipment[p.id]?.[n])
      )
        throw new Error("Unimplemented equipment change");
    }
    if (data.roster.length !== this.definitions.size)
      throw new Error("Missing roster member");
    distinct(data.party);
    if (
      !data.party.length ||
      data.party.some((id) => !data.roster.some((p) => p.id === id))
    )
      throw new Error("Unknown party member");
    distinct(data.items.map((item) => item.id));
    for (const item of data.items) {
      keys(item, "id,count");
      integer(item.id, 0x7fffffff, 1);
      if (!this.content.items[item.id])
        throw new Error("Unimplemented inventory content: " + item.id);
      integer(item.count, limits.item);
    }
    distinct(data.completedBattles.map((b) => b.serial));
    for (const [index, b] of data.completedBattles.entries()) {
      keys(b, "serial,encounterId");
      if (b.serial !== index)
        throw new Error("Invalid battle receipt sequence");
      integer(b.encounterId, 0x7fffffff, 1);
    }
  }
  get gil() {
    return this.data.gil;
  }
  get completedEncounters() {
    return this.data.completedBattles.map((b) => b.encounterId);
  }
  get inBattle() {
    return this.active !== null;
  }
  snapshot(): GameStateSnapshot {
    return structuredClone(this.data);
  }
  /** A shared-state snapshot is not a complete field/battle save game. */
  restore(snapshot: GameStateSnapshot): void {
    this.requireIdle();
    const next = structuredClone(snapshot);
    this.validate(next);
    this.data = next;
    this.revision++;
  }
  private requireIdle() {
    if (this.active)
      throw new Error("Owned state is reserved by an active battle");
  }
  partyPlayers(): Combatant[] {
    return this.data.party.map((id) => {
      const p = this.data.roster.find((p) => p.id === id)!;
      const { equipment: _, ...progress } = p;
      return {
        ...structuredClone(this.definitions.get(id)!),
        ...structuredClone(progress),
        atb: 0,
        queued: false,
        behavior: null,
      };
    });
  }
  private previewItem(id: number, targetId: string) {
    this.requireIdle();
    const item = this.content.items[id];
    const target = this.partyPlayers().find((p) => p.id === targetId);
    if (
      !item ||
      item.important ||
      !item.uses.menu.plan ||
      !this.data.items.some((i) => i.id === id && i.count > 0) ||
      !target ||
      target.hp <= 0 ||
      target.conditionIds.some((c) => item.forbiddenConditionIds.includes(c))
    )
      return null;
    const projection = projectActionTarget(
      item.uses.menu.plan,
      item.power,
      target,
      target,
      this.conditions,
      () => {
        throw new Error("Unimplemented menu item randomness");
      },
      1,
    );
    return projection.state.hp !== target.hp ||
      projection.state.mp !== target.mp
      ? projection
      : null;
  }
  menuItemTargets(id: number): string[] {
    if (this.active) return [];
    return this.data.party.filter(
      (target) => this.previewItem(id, target) !== null,
    );
  }
  /** Menu eligibility and effects are projected again at confirmation. No effect
   * means no consumption; stock and the entire character projection commit once. */
  useMenuItem(id: number, targetId: string): boolean {
    const projected = this.previewItem(id, targetId);
    if (!projected) return false;
    const next = this.snapshot();
    Object.assign(
      next.roster.find((p) => p.id === targetId)!,
      projected.state,
    );
    next.items.find((i) => i.id === id)!.count--;
    this.validate(next);
    this.data = next;
    this.revision++;
    return true;
  }
  /** Commands validate affordability before consuming; this is not a raw event RemoveOwnedItem emulation. */
  changeItems(
    changes: readonly { id: number; count: number }[],
    mode: "grant" | "consume",
  ): void {
    this.requireIdle();
    if (mode !== "grant" && mode !== "consume")
      throw new Error("Unknown inventory operation");
    const next = this.snapshot();
    for (const change of changes) {
      integer(change.id, 0x7fffffff, 1);
      if (!this.content.items[change.id])
        throw new Error("Unimplemented inventory content: " + change.id);
      integer(change.count, 0x7fffffff);
      let entry = next.items.find((item) => item.id === change.id);
      if (!entry) {
        entry = { id: change.id, count: 0 };
        next.items.push(entry);
      }
      if (mode === "consume" && entry.count < change.count)
        throw new Error("Insufficient inventory");
      entry.count =
        mode === "grant"
          ? Math.min(this.content.limits.item, entry.count + change.count)
          : entry.count - change.count;
    }
    next.items.sort((a, b) => a.id - b.id);
    this.validate(next);
    this.data = next;
    this.revision++;
  }
  openBattle(encounterId: number): BattleLease {
    this.requireIdle();
    integer(encounterId, 0x7fffffff, 1);
    const lease = Object.freeze({
      serial: this.data.completedBattles.length,
      encounterId,
    });
    this.active = {
      lease,
      players: this.partyPlayers(),
      items: structuredClone(this.data.items),
    };
    return lease;
  }
  battlePlayers(lease: BattleLease): Combatant[] {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    return structuredClone(this.active.players);
  }
  battleInventory(lease: BattleLease): BattleInventory {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    return structuredClone({
      definitions: this.content.items,
      stacks: this.active.items,
      limit: this.content.limits.item,
    });
  }
  cancelBattle(lease: BattleLease): void {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    this.active = null;
  }
  prepareVictory(
    lease: BattleLease,
    result: { players: Combatant[]; gil: number; consumedItems: ItemStack[] },
  ): () => void {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    const next = this.snapshot(),
      revision = this.revision;
    integer(result.gil, 0x7fffffff);
    validateItemStacks(
      result.consumedItems,
      this.content.items,
      this.content.limits.item,
    );
    for (const used of result.consumedItems) {
      const stock = next.items.find((i) => i.id === used.id);
      if (
        !stock ||
        stock.count < used.count ||
        this.content.items[used.id]!.important ||
        !this.content.items[used.id]!.uses.battle.plan
      )
        throw new Error("Invalid battle inventory consumption");
      stock.count -= used.count;
    }
    if (
      result.players.length !== next.party.length ||
      result.players.some((p, n) => p.id !== next.party[n])
    )
      throw new Error("Battle party identity changed");
    for (const player of result.players) {
      const target = next.roster.find((p) => p.id === player.id)!;
      if (player.side !== "player" || player.sourceId !== target.sourceId)
        throw new Error("Battle roster identity changed");
      Object.assign(target, {
        hp: player.hp,
        mp: player.mp,
        maxHp: player.maxHp,
        maxMp: player.maxMp,
        level: player.level,
        exp: player.exp,
        conditionIds: [...player.conditionIds],
      });
    }
    next.gil = Math.min(this.content.limits.gil, next.gil + result.gil);
    next.totalGil += result.gil;
    next.completedBattles.push({ ...lease });
    this.validate(next);
    return () => {
      if (this.active?.lease !== lease || this.revision !== revision)
        throw new Error("Stale victory transaction");
      this.data = next;
      this.active = null;
      this.revision++;
    };
  }
}
