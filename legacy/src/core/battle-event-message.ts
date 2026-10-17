import type { FieldMessageNamesPort } from "./owned-message-names.js";
import type { SourceMessageEffect, SourceMessageState } from "./source-message.js";
import type { SourceMessageSequenceCommand, SourceMessageSequenceContext } from "./source-message-sequence.js";
import { sourceMessageSequenceTextRuns } from "./source-message-sequence.js";
import { canonical } from "./canonical.js";
import { checkpointKeys, checkpointRecord } from "./checkpoint-validation.js";
import { prepareSourceMessageSequenceTiming } from "./source-message-sequence.js";
import { fieldMessageNameReferences, fieldMessageTemplateSource, fieldMessageUsesFee,
  MESSAGE_VALUE_PATTERN, parseFieldMessageTemplate, resolveFieldMessageTemplate } from "./field-message-template.js";
export const WEB_BATTLE_EVENT_MESSAGE_POLICY = "web-source-battle-event-messages-v1" as const;
export type BattleEventMessagePresentation = { sourceWindow: 0 | 1 | 2; speakerAnchor: "left" | "right" };
export type BattleEventMessageOp = { kind: "message"; command: SourceMessageSequenceCommand | { kind: "close" };
  presentation: BattleEventMessagePresentation | null };
type MessagePhysicalSource = {
  file: string; assetPath: string; objectId: string; serializedFile: string | null; sha256: string;
};
type LegacyMessageRole = "body" | "speaker" | "character-names";
export const BATTLE_MESSAGE_DICTIONARIES = {
  body: "story_mes_zhc", speaker: "story_cha_zhc", "character-names": "character_default_name.csv",
  "system-body": "system_zhc", "etcetera-body": "etc_text_zhc",
} as const;
type MessageRole = keyof typeof BATTLE_MESSAGE_DICTIONARIES;
export type BattleEventMessageBinding = {
  kind: "battle-event-message-binding-v1"; sourceSetHash: string; parentSourceSetHash: string;
  sources: { role: LegacyMessageRole; source: MessagePhysicalSource }[];
} | {
  kind: "battle-event-message-binding-v2"; sourceSetHash: string; parentSourceSetHash: string;
  /** Complete MessageManager dictionary load contract, including native empty
   * speaker semantics. It grants neither a body fallback nor a second window. */
  routing: "native-shared-message-dictionaries-v1";
  sources: { role: MessageRole; source: MessagePhysicalSource; contentHash: string; rowCount: number }[];
};
export function parseBattleEventMessageBinding(raw: unknown): BattleEventMessageBinding {
  checkpointRecord(raw);
  const v2 = (raw as {kind?:unknown}).kind === "battle-event-message-binding-v2";
  checkpointKeys(raw, "kind,sourceSetHash,parentSourceSetHash,sources" + (v2 ? ",routing" : ""));
  const value = raw as BattleEventMessageBinding;
  if ((!v2 && value.kind !== "battle-event-message-binding-v1") ||
      v2 && (value as Extract<BattleEventMessageBinding, {kind:"battle-event-message-binding-v2"}>).routing !== "native-shared-message-dictionaries-v1" ||
      !/^[a-f0-9]{64}$/.test(value.sourceSetHash) || !/^[a-f0-9]{64}$/.test(value.parentSourceSetHash) ||
      !Array.isArray(value.sources) || value.sources.length !== (v2 ? 5 : 3))
    throw new Error("Invalid battle message source binding");
  const roles = new Set<string>();
  for (const row of value.sources) {
    checkpointKeys(row, "role,source" + (v2 ? ",contentHash,rowCount" : "")); checkpointKeys(row.source, "file,assetPath,objectId,serializedFile,sha256");
    if (!(v2 ? Object.keys(BATTLE_MESSAGE_DICTIONARIES) : ["body", "speaker", "character-names"]).includes(row.role) || roles.has(row.role))
      throw new Error("Ambiguous battle message source role");
    roles.add(row.role);
    const s = row.source;
    if ([s.file, s.assetPath].some(v => typeof v !== "string" || !v) || s.serializedFile !== null && (typeof s.serializedFile !== "string" || !s.serializedFile) ||
        typeof s.objectId !== "string" || !/^-?(?:0|[1-9]\d*)$/.test(s.objectId) ||
        BigInt(s.objectId) < -(1n << 63n) || BigInt(s.objectId) >= 1n << 63n || !/^[a-f0-9]{64}$/.test(s.sha256))
      throw new Error("Invalid battle message physical source");
    if (v2) {
      const bound = row as Extract<BattleEventMessageBinding, {kind:"battle-event-message-binding-v2"}>["sources"][number];
      if (!/^[a-f0-9]{64}$/.test(bound.contentHash) || !Number.isSafeInteger(bound.rowCount) || bound.rowCount < 1)
        throw new Error("Invalid battle message dictionary content binding");
    }
  }
  return structuredClone(value);
}
export function parseBattleEventMessageOp(raw: unknown): BattleEventMessageOp {
  checkpointKeys(raw, "kind,command,presentation");
  const value = raw as BattleEventMessageOp;
  if (value.kind !== "message") throw new Error("Invalid battle message operation");
  checkpointRecord(value.command);
  if (value.command.kind === "close") {
    checkpointKeys(value.command, "kind");
    if (value.presentation !== null) throw new Error("Close cannot supply a battle message presentation");
  } else {
    // Structural timing validation is not a runtime factor/configuration grant.
    prepareSourceMessageSequenceTiming(value.command, { kind: "web-field-message-sequence-v1",
      layout: "source-explicit-pages", integratorAutomatic: false, battleMessageSpeedFactor: 1 });
    if (value.command.template) parseFieldMessageTemplate(value.command.template);
    checkpointKeys(value.presentation, "sourceWindow,speakerAnchor");
    if (value.command.layout.window !== "frame" || ![0, 1, 2].includes(value.presentation!.sourceWindow) ||
        value.presentation!.speakerAnchor !== (value.presentation!.sourceWindow === 2 ? "right" : "left"))
      throw new Error("Invalid battle message window/speaker binding");
  }
  return structuredClone(value);
}
export type BattleEventMessageHost = {
  policy: typeof WEB_BATTLE_EVENT_MESSAGE_POLICY;
  /** The actual current FieldGame owner; a BattleGame never constructs one. */
  owner: SourceMessageState;
  sequence: { prepare(): { context: SourceMessageSequenceContext; validate(): void } };
  names?: FieldMessageNamesPort;
  prepareEffects(effects: readonly SourceMessageEffect[]): { validate(): void; commit(): void };
};
/** The existing owned-name/amount template rules; no default names, current
 * party-slot inference or mutable message dictionary participates here. */
export function prepareBattleEventMessagePresentation(command: SourceMessageSequenceCommand,
  host: Pick<BattleEventMessageHost, "names">, owner: SourceMessageState) {
  const before = canonical(command), runs = sourceMessageSequenceTextRuns(command.document),
    resolved = structuredClone(command);
  let validate = () => {};
  if (command.template) {
    const template = parseFieldMessageTemplate(command.template), source = fieldMessageTemplateSource(template);
    if (canonical(source.pages) !== canonical(runs) || source.speaker !== command.speaker)
      throw new Error("Battle message template/text binding mismatch");
    const references = fieldMessageNameReferences(template);
    if (references.length && !host.names) throw new Error("Battle message requires the actual held-name owner");
    const names = references.length ? host.names!.prepare(references) : null,
      fee = fieldMessageUsesFee(template) ? owner.prepareFeeValue() : null,
      feeBefore = canonical(owner.feeSnapshot), value = resolveFieldMessageTemplate(template, names?.names ?? [], fee?.value);
    fee?.validate();
    let index = 0; resolved.speaker = value.speaker;
    for (const token of resolved.document.tokens) if (token.kind === "text") token.text = value.pages[index++]!;
    delete resolved.template;
    validate = () => { names?.validate();
      if (canonical(owner.feeSnapshot) !== feeBefore) throw new Error("Battle message amount changed during preparation");
    };
  } else if ([command.speaker, ...runs].some(value => [...value.matchAll(MESSAGE_VALUE_PATTERN)].length))
    throw new Error("Battle message source value requires its compiled template");
  return { command: resolved, validate: () => {
    if (canonical(command) !== before) throw new Error("Battle message content changed during preparation");
    validate();
  } };
}
