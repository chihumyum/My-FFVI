import { int32, type VariableRef } from "./event-state.js";

/** AddOwnedItem accepts zero here. This is distinct from the admitted GetItem
 * event contract, which currently requires a positive item amount. */
export type TreasureRewardCommand =
  | { kind: "grant-item" | "grant-equipment"; id: number; count: number }
  | { kind: "grant-gil"; amount: number };

export type TreasureInventoryDefinition = {
  kind: "treasure-inventory-v1";
  /** IEntityAccessor.GetFieldEntity identity, not the linked tile object ID. */
  entityId: number;
  contentId: number;
  contentNum: number;
  ownedList: "normal" | "important" | "gil";
  reward: TreasureRewardCommand;
  flagId: number;
  scriptId: number;
  scriptName: string | null;
  presentation: {
    pickUp: boolean;
    soundId: number;
    linkObjectId: number;
    messageKey: string;
  };
  messages: {
    emptyKey: string;
    countOverKey: string;
    contentNameKey: string;
    valueToken: "ITEM_N" | "NUM";
  };
  dependencies: { table: string; id: number }[];
};

export type TreasureBoxRequest = {
  kind: "treasure-box";
  entityId: number;
  after: boolean;
  message: boolean;
  /** EventAction.SoundId belongs to the caller. The explicit instruction
   * constructs a new action with zero; it does not copy property.se_id. */
  actionSoundId: number;
};

export type TreasureInventoryLimits = { item: number; gil: number };
export type TreasureInventoryRead = {
  gil: number;
  /** Exact NormalOwnedItemList projection, including equipped copies. Do not
   * use free equipment counts or merge ImportantOwendItemList into this list.
   * A missing source record is distinct from an existing zero-count record. */
  normalOwnedItems: readonly { id: number; count: number }[];
};

type TreasurePrelude = {
  /** Sound load/play precedes Open and link animation in the native task. */
  soundId: number | null;
  openVisual: true;
  pickUp: boolean;
  linkObjectId: number;
};
export type TreasureInventoryEffect =
  | { kind: "sound"; id: number; waitForLoad: true; waitForPlayback: false }
  | { kind: "open"; entityId: number; hide: boolean }
  | { kind: "tile-animation"; firstObjectId: number; waitForCompletion: false }
  | { kind: "run-script"; id: number; name: string }
  | { kind: "grant"; command: TreasureRewardCommand }
  | { kind: "set-message-value"; token: "ITEM_N"; messageKey: string }
  | { kind: "set-message-value"; token: "NUM"; number: number }
  | { kind: "scene-state"; state: "message" | "player" }
  | { kind: "message"; key: string; close: boolean }
  | { kind: "flag"; ref: VariableRef; value: 1 }
  | { kind: "yield"; frames: 1 };

type TreasureInventoryDecision = {
  entityId: number;
  prelude: TreasurePrelude;
} & (
  | { kind: "empty-message" }
  | { kind: "run-script"; scriptId: number; scriptName: string }
  | {
      kind: "grant";
      command: TreasureRewardCommand;
      /** This chooses the source message; it never rejects the grant. */
      overCapacity: boolean;
      message: boolean;
      flagWrite: { ref: VariableRef; value: 1 };
      flagAfter: "reward-message-complete" | "reward-commit";
      completionYieldFrames: 1;
    }
);
export type TreasureInventoryPlan = TreasureInventoryDecision & {
  /** Ordered source effects. Every message effect waits for task completion;
   * visual open and tile-animation start do not wait for animation playback. */
  effects: TreasureInventoryEffect[];
};

function nonnegative(value: number, name: string) {
  if (int32(value) < 0) throw new Error(`Invalid treasure ${name}`);
  return value;
}

export function treasureFlagRef(flagId: number): VariableRef {
  if (nonnegative(flagId, "flag") >= 1024)
    throw new Error("Unsupported treasure flag address");
  const banks = ["TreasureFlag1", "TreasureFlag2", "TreasureFlag3", "TreasureFlag4"] as const;
  return { category: banks[Math.floor(flagId / 256)]!, index: flagId % 256 };
}

export function validateTreasureInventory(definition: TreasureInventoryDefinition): void {
  if (definition.kind !== "treasure-inventory-v1")
    throw new Error("Unsupported treasure inventory definition");
  // Source anonymous treasures may have entity_id=0. The explicit instruction
  // compiler admits only its observed positive lookup IDs; no ID is invented.
  if (int32(definition.entityId) < 0 || int32(definition.contentId) <= 0)
    throw new Error("Invalid treasure identity");
  nonnegative(definition.contentNum, "amount");
  treasureFlagRef(definition.flagId);
  nonnegative(definition.scriptId, "script");
  if (definition.scriptId === 0 ? definition.scriptName !== null :
    typeof definition.scriptName !== "string" || !definition.scriptName)
    throw new Error("Invalid treasure script dependency");
  const p = definition.presentation;
  if (typeof p.pickUp !== "boolean" || typeof p.messageKey !== "string")
    throw new Error("Invalid treasure presentation input");
  nonnegative(p.soundId, "sound");
  nonnegative(p.linkObjectId, "linked object");
  const reward = definition.reward;
  if (reward.kind === "grant-gil") {
    if (definition.ownedList !== "gil" || reward.amount !== definition.contentNum)
      throw new Error("Treasure Gil projection mismatch");
  } else if (reward.kind === "grant-item" || reward.kind === "grant-equipment") {
    if (reward.id !== definition.contentId || reward.count !== definition.contentNum ||
      !["normal", "important"].includes(definition.ownedList) ||
      (reward.kind === "grant-equipment" && definition.ownedList !== "normal"))
      throw new Error("Treasure item projection mismatch");
  } else throw new Error("Unsupported treasure reward");
  const m = definition.messages;
  if (typeof m?.emptyKey !== "string" || !m.emptyKey ||
    typeof m.countOverKey !== "string" || !m.countOverKey ||
    typeof m.contentNameKey !== "string" || !m.contentNameKey ||
    m.valueToken !== (definition.ownedList === "gil" ? "NUM" : "ITEM_N"))
    throw new Error("Invalid treasure message dependency");
}

/** EventActionTreasure.CheckItemCountOver 0x7adba0. This is a contextual
 * capacity read, not an invented interpreter quantity-query instruction. */
export function checkTreasureCapacity(
  definition: TreasureInventoryDefinition,
  owned: TreasureInventoryRead,
  limits: TreasureInventoryLimits,
): boolean {
  validateTreasureInventory(definition);
  if (nonnegative(limits.item, "item limit") === 0 ||
    nonnegative(limits.gil, "Gil limit") === 0)
    throw new Error("Invalid treasure inventory limits");
  if (nonnegative(owned.gil, "owned Gil") > limits.gil)
    throw new Error("Treasure owned Gil exceeds its limit");
  if (!Array.isArray(owned.normalOwnedItems))
    throw new Error("Missing treasure normal inventory");
  const seen = new Set<number>();
  for (const entry of owned.normalOwnedItems) {
    if (int32(entry.id) <= 0 || seen.has(entry.id) ||
      nonnegative(entry.count, "owned count") > limits.item)
      throw new Error("Invalid treasure normal inventory");
    seen.add(entry.id);
  }
  if (definition.ownedList === "gil")
    return int32(owned.gil + definition.contentNum) > limits.gil;
  const entry = owned.normalOwnedItems.find((item) => item.id === definition.contentId);
  // The original returns false without adding ContentNum when no record exists.
  return entry !== undefined && int32(entry.count + definition.contentNum) > limits.item;
}

/** Pure decision at the source treasure task boundary. The host must prepare
 * every required visual/audio/message dependency before publishing changes,
 * read the current draft, and preserve grant -> message completion -> flag.
 * Returning a plan does not admit the field presentation or mutate any owner. */
export function planTreasureInventory(
  definition: TreasureInventoryDefinition,
  request: TreasureBoxRequest,
  opened: boolean | null,
  owned: TreasureInventoryRead,
  limits: TreasureInventoryLimits,
): TreasureInventoryPlan {
  validateTreasureInventory(definition);
  if (request.kind !== "treasure-box" || request.entityId !== definition.entityId ||
    typeof request.after !== "boolean" || typeof request.message !== "boolean")
    throw new Error("Invalid treasure request");
  nonnegative(request.actionSoundId, "action sound");
  if (opened !== null && typeof opened !== "boolean")
    throw new Error("Invalid treasure opened flag");
  const p = definition.presentation;
  if (opened === null && (request.message || request.actionSoundId > 0))
    throw new Error("Unknown treasure opened flag");
  const common = {
    entityId: definition.entityId,
    prelude: {
      soundId: request.actionSoundId > 0 && opened === false ? request.actionSoundId : null,
      openVisual: true as const,
      pickUp: p.pickUp,
      linkObjectId: p.linkObjectId,
    },
  };
  const finish = (decision: TreasureInventoryDecision): TreasureInventoryPlan => {
    const effects: TreasureInventoryEffect[] = [];
    if (decision.prelude.soundId !== null)
      effects.push({ kind: "sound", id: decision.prelude.soundId, waitForLoad: true, waitForPlayback: false });
    effects.push({ kind: "open", entityId: definition.entityId, hide: p.pickUp },
      { kind: "tile-animation", firstObjectId: p.linkObjectId, waitForCompletion: false });
    if (decision.kind === "empty-message") {
      // EmptyMessage's callback always returns to Player, even after=true.
      effects.push({ kind: "scene-state", state: "message" },
        { kind: "message", key: definition.messages.emptyKey, close: true },
        { kind: "scene-state", state: "player" });
    } else if (decision.kind === "run-script") {
      effects.push({ kind: "run-script", id: decision.scriptId, name: decision.scriptName });
    } else {
      effects.push({ kind: "grant", command: structuredClone(decision.command) });
      if (decision.message) {
        effects.push(definition.messages.valueToken === "NUM" ?
          { kind: "set-message-value", token: "NUM", number: definition.contentNum } :
          { kind: "set-message-value", token: "ITEM_N", messageKey: definition.messages.contentNameKey });
        if (!request.after) effects.push({ kind: "scene-state", state: "message" });
        effects.push({ kind: "message", key: p.messageKey, close: !decision.overCapacity });
        if (decision.overCapacity)
          effects.push({ kind: "message", key: definition.messages.countOverKey, close: true });
        if (!request.after) effects.push({ kind: "scene-state", state: "player" });
      }
      effects.push({ kind: "flag", ...structuredClone(decision.flagWrite) }, { kind: "yield", frames: 1 });
    }
    return { ...decision, effects };
  };
  // Open() changes entity presentation, not DataStorage's treasure flag.
  // message=false deliberately bypasses this check in 0x7b46f0.
  if (request.message && opened === true) return finish({ ...common, kind: "empty-message" });
  if (!request.after && definition.scriptId > 0)
    return finish({ ...common, kind: "run-script", scriptId: definition.scriptId,
      scriptName: definition.scriptName! });
  return finish({
    ...common,
    kind: "grant",
    command: structuredClone(definition.reward),
    overCapacity: checkTreasureCapacity(definition, owned, limits),
    message: request.message,
    flagWrite: { ref: treasureFlagRef(definition.flagId), value: 1 },
    flagAfter: request.message ? "reward-message-complete" : "reward-commit",
    completionYieldFrames: 1,
  });
}
