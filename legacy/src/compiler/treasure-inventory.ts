import { z } from "zod";
import { int32 } from "../core/event-state.js";
import {
  validateTreasureInventory,
  type TreasureBoxRequest,
  type TreasureInventoryDefinition,
  type TreasureInventoryLimits,
  type TreasureRewardCommand,
} from "../core/treasure-inventory.js";
import { record } from "./content.js";
import { compileInventoryEvent } from "./inventory-event.js";
import { compileMessage } from "./message.js";
import { tableId } from "./table-id.js";
import type { TreasureTaskMessage, TreasureTaskMessages } from "../core/treasure-task.js";
export type { TreasureTaskMessages } from "../core/treasure-task.js";

export type TreasureInventorySource = {
  sourceSetHash: string;
  file: string;
  assetPath: string;
  objectId?: string;
  serializedFile: string;
  sha256: string;
  pointer: string;
};
export type CompiledTreasureInventory = TreasureInventoryDefinition & {
  source: TreasureInventorySource;
};

function rows(tables: Record<string, unknown>, table: string) {
  if (!Array.isArray(tables[table])) throw new Error(`Missing treasure table ${table}`);
  return (tables[table] as unknown[]).map(record);
}
function row(tables: Record<string, unknown>, table: string, id: number) {
  const found = rows(tables, table).filter((r) => tableId(r.id) === id);
  if (found.length !== 1) throw new Error(`Missing or ambiguous treasure dependency ${table}:${id}`);
  return found[0]!;
}

export function compileTreasureInventoryLimits(tables: Record<string, unknown>): {
  limits: TreasureInventoryLimits;
  dependencies: { table: string; id: number }[];
} {
  const constants = ["MAX_ITEM", "MAX_GIL"].map((name) => {
    const found = rows(tables, "game_constant_int.csv").filter((r) => r.key_name === name);
    if (found.length !== 1 || tableId(found[0]!.value1) <= 0)
      throw new Error(`Missing or ambiguous treasure limit ${name}`);
    return found[0]!;
  });
  return {
    limits: { item: tableId(constants[0]!.value1), gil: tableId(constants[1]!.value1) },
    dependencies: constants.map((r) => ({ table: "game_constant_int.csv", id: tableId(r.id) })),
  };
}

/** The caller retains geometry and the complete source property object. This
 * compiles the real PropertyTresureBox reward inputs, not treasure_box.csv's
 * separate completion-counter records. */
export function compileTreasureInventoryDefinition(
  properties: Record<string, unknown>,
  tables: Record<string, unknown>,
): TreasureInventoryDefinition {
  const p = properties;
  if (int32(p.object_type) !== 7) throw new Error("Expected source treasure entity");
  if (row(tables, "action.csv", int32(p.action_id)).action_name !== "OpenTresureBox")
    throw new Error("Unsupported treasure action binding");
  const contentId = int32(p.content_id), contentNum = int32(p.content_num);
  if (contentNum < 0) throw new Error("Negative treasure rewards are not admitted");
  // GetItem and the treasure coroutine both reach AddOwnedItem. Use the same
  // content/type dependency validation, preserving this caller's source zero.
  const inventory = compileInventoryEvent("GetItem", [contentId, Math.max(1, contentNum)], tables);
  let reward: TreasureRewardCommand;
  switch (inventory.command.kind) {
    case "grant-gil": reward = { kind: "grant-gil", amount: contentNum }; break;
    case "grant-item":
    case "grant-equipment": reward = { kind: inventory.command.kind,
      id: inventory.command.id, count: contentNum }; break;
    case "grant-magic-stone":
      throw new Error("Magic-stone treasure capacity and reward context are not implemented");
    default: throw new Error("Unexpected treasure reward projection");
  }
  const content = row(tables, "content.csv", contentId);
  const ownedList = reward.kind === "grant-gil" ? "gil" : reward.kind === "grant-item" &&
    tableId(row(tables, "item.csv", tableId(content.type_value)).type_id) === 2 ? "important" : "normal";
  const capacity = compileTreasureInventoryLimits(tables);
  // The shared inventory snapshot retains zero counts, while native removal can
  // remove a record. Below this bound, absent and present-zero capacity agree.
  if (ownedList !== "gil" && contentNum > capacity.limits.item)
    throw new Error("Treasure reward above MAX_ITEM needs native inventory record-presence state");
  const scriptId = int32(p.script_id);
  const scriptName = scriptId === 0 ? null : z.string().min(1).parse(row(tables, "script.csv", scriptId).script_name);
  const messageRows = ["NO_TREASURE_BOX_CONTENT", "MAX_POSSESSION_TREASURE_BOX_CONTENT"].map((key) => {
    const found = rows(tables, "message_conclusion.csv").filter((r) => r.key_name === key);
    if (found.length !== 1) throw new Error(`Missing or ambiguous treasure message ${key}`);
    return found[0]!;
  });
  const definition: TreasureInventoryDefinition = {
    kind: "treasure-inventory-v1",
    entityId: int32(p.entity_id), contentId, contentNum, ownedList, reward,
    flagId: int32(p.flag_id), scriptId, scriptName,
    presentation: {
      pickUp: z.boolean().parse(p.pick_up), soundId: int32(p.se_id),
      linkObjectId: int32(p.link_object_id), messageKey: z.string().parse(p.message_key),
    },
    messages: {
      emptyKey: z.string().min(1).parse(messageRows[0]!.message_id),
      countOverKey: z.string().min(1).parse(messageRows[1]!.message_id),
      contentNameKey: z.string().min(1).parse(content.mes_id_name),
      valueToken: ownedList === "gil" ? "NUM" : "ITEM_N",
    },
    dependencies: [
      { table: "action.csv", id: int32(p.action_id) },
      ...inventory.dependencies,
      ...capacity.dependencies,
      ...(scriptId === 0 ? [] : [{ table: "script.csv", id: scriptId }]),
      ...messageRows.map((r) => ({ table: "message_conclusion.csv", id: tableId(r.id) })),
    ],
  };
  validateTreasureInventory(definition);
  return definition;
}

/** Standalone source checks retain the full extraction identity. Entity groups
 * retain this identity at their source package and individual Evidence pointer. */
export function compileTreasureInventory(
  properties: Record<string, unknown>,
  tables: Record<string, unknown>,
  source: TreasureInventorySource,
): CompiledTreasureInventory {
  if (!/^[a-f0-9]{64}$/.test(source.sourceSetHash) || !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !source.file || !source.assetPath || !source.serializedFile || !source.pointer.startsWith("/") ||
    (source.objectId !== undefined && !/^-?\d+$/.test(source.objectId)))
    throw new Error("Invalid treasure source identity");
  return { ...compileTreasureInventoryDefinition(properties, tables), source: structuredClone(source) };
}

/** External.Item.TreasureBox 0xb4cf20 ignores iValues[1], always supplies
 * after=true, and sets message=(iValues[2] != 1). Caller attaches the VM site. */
export function compileTreasureBoxInstruction(raw: unknown): TreasureBoxRequest {
  const m = record(raw), operands = record(m.operands);
  if (m.mnemonic !== "TreasureBox" || m.type !== 1)
    throw new Error("Expected source TreasureBox instruction");
  const integers = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (integers[0]! <= 0 || integers.slice(3).some((v) => v !== 0) ||
    reals.some((v) => v !== 0) || strings.some((v) => v !== ""))
    throw new Error("Unsupported TreasureBox operand shape");
  return { kind: "treasure-box", entityId: integers[0]!, after: true,
    message: integers[2] !== 1, actionSoundId: 0 };
}

/** EventAction.OpenTreasureBox.MoveNext 0x7b7860 creates the ordinary action
 * with after=false/message=true and copies PropertyTresureBox.SoundId. Its
 * entity may be anonymous (native ID 0); the field host retains its Web key. */
export function compileTreasureInteraction(
  definition: TreasureInventoryDefinition,
): TreasureBoxRequest {
  validateTreasureInventory(definition);
  return { kind: "treasure-box", entityId: definition.entityId, after: false,
    message: true, actionSoundId: definition.presentation.soundId };
}

/** Compile only the treasure templates' demonstrated parameter and leading CT
 * control. Other substitutions/inline controls remain explicit blockers. The
 * resulting text is passed through the existing field-message validation. */
export function compileTreasureTaskMessages(
  definition: TreasureInventoryDefinition,
  messages: Record<string, unknown>,
  systemMessages: Record<string, unknown>,
  request?: TreasureBoxRequest,
): TreasureTaskMessages {
  validateTreasureInventory(definition);
  if (request && (request.kind !== "treasure-box" || request.entityId !== definition.entityId ||
    typeof request.after !== "boolean" || typeof request.message !== "boolean" ||
    int32(request.actionSoundId) < 0)) throw new Error("Invalid treasure message request");
  const needsReward = request === undefined || request.message && (request.after || definition.scriptId === 0);
  const token = definition.messages.valueToken;
  const parameter = () => {
    if (token === "NUM") return { token, value: String(definition.contentNum), sourceKey: null };
    const name = systemMessages[definition.messages.contentNameKey];
    if (typeof name !== "string" || !name)
      throw new Error("Missing localized treasure content name");
    // SetValue -> IconTextUtility.GetRepraceIconText removes all occurrences
    // of the first angle tag. The observed content names use IC_* icons. Do
    // not silently discard an unknown control as if it were a known icon.
    const firstTag = name.match(/<[\s\S]*?>/u)?.[0];
    if (firstTag && !/^<IC_[A-Z0-9_]+>$/u.test(firstTag))
      throw new Error("Unsupported treasure content-name control");
    const value = firstTag ? name.replaceAll(firstTag, "") : name;
    if (/[<\\]/u.test(value) || /\([\p{L}\p{N}_]+\)/u.test(value))
      throw new Error("Unsupported treasure content-name substitution");
    return { token, value, sourceKey: definition.messages.contentNameKey };
  };
  // Script chests can contain a placeholder reward that their ordinary caller
  // never formats. Retain every independently compilable message, but do not
  // turn an unused reward-template failure into a false interaction blocker.
  const optional = <T>(compile: () => T): T | null => {
    try { return compile(); } catch (error) { if (needsReward) throw error; return null; }
  };
  const compiledParameter = optional(parameter);
  const compile = (key: string, substitute: boolean): TreasureTaskMessage => {
    const text = record(messages.story_mes_zhc ?? {})[key];
    const speaker = record(messages.story_cha_zhc ?? {})[key];
    if (!key || typeof text !== "string" || typeof speaker !== "string")
      throw new Error("Missing localized treasure message or speaker");
    let projected = text;
    if (substitute && compiledParameter) projected = projected.replaceAll(`(${token})`, compiledParameter.value);
    // EmptyMessage does not SetValue, so it cannot assume stale global tokens.
    if (/\([\p{L}\p{N}_]+\)/u.test(projected) || /\([\p{L}\p{N}_]+\)/u.test(speaker))
      throw new Error("Unsupported treasure message substitution");
    const centered = /^<CT>/iu.test(projected);
    if (centered) projected = projected.slice(4);
    const result = compileMessage(key, {
      story_mes_zhc: { [key]: projected }, story_cha_zhc: { [key]: speaker },
    });
    return { ...result, ...(centered ? { alignment: "center" as const } : {}) };
  };
  return {
    reward: optional(() => compile(definition.presentation.messageKey, true)),
    empty: compile(definition.messages.emptyKey, false),
    countOver: optional(() => compile(definition.messages.countOverKey, true)),
    parameter: compiledParameter,
  };
}
