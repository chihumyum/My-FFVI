import { bindSourceMessageFee, restoreSourceMessageFee, parseSourceMessageFeeCatalog, type SourceGilTagOp, type SourceMessageFeeCatalog, type SourceMessageFeeSnapshot } from "./source-message-fees.js";
import { validateFieldEmptyMessage, type FieldEmptyMessageOp } from "./field-empty-message.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { createSourceMessageSequence, advanceSourceMessageSequence, confirmSourceMessageSequence,
  executeSourceMessagePageInput, sourceMessageSequenceStatus, type SourceMessageSequenceCommand,
  type SourceMessageSequenceContext, type SourceMessageSequencePhase, type SourceMessageSequenceValue } from "./source-message-sequence.js";

/** Deliberate Web capability bound, not the native TextGenerator wrap rule.
 * Source field windows expose four rows; glyph/layout parity remains separate. */
export const SOURCE_MESSAGE_WEB_LINE_LIMIT = 20;

/** The admitted ordinary field subtitle path. Other message managers (fade,
 * scroll, opera, battle) have separate lifecycles and are not aliases. */
export type SourceMessageDocument = {
  kind: "source-message-document-v1";
  text: string;
  alignment: "left" | "center";
  /** AUTO_P selects the native automatic-input branch, not a display duration. */
  autoPage: true;
  /** This initial capability admits a single wait at the end of one page. */
  tailWaitSeconds: number | null;
};
export type SourceMessagePlay = {
  kind: "play";
  key: string;
  speaker: "";
  layout: { window: "none"; anchor: "top" | "middle" | "bottom" };
  document: SourceMessageDocument;
  /** Source operand is double. A negative value means interpreter Next. */
  seconds: number;
};
export type SourceMessageCommand = SourceMessagePlay | SourceMessageSequenceCommand | { kind: "close" } | { kind: "finish-wait" };
export type SourceMessageOp = {
  kind: "source-message";
  command: SourceMessageCommand;
};
export type SourceMessageEffect = {
  kind: "entity-update-group";
  /** SubSceneManagerMainGame.StateEntityAttribute index, not a bitmask. */
  group: 8 | 12;
  invokeCallback: false;
};
/** Source StateEntityAttribute[Message/Event]. This changes entity selection,
 * not the independent interpreter, camera, fader or audio manager clocks. */
export function sourceMessageUpdateMask(group: SourceMessageEffect["group"]): 9 | 3 {
  if (group === 8) return 9;
  if (group === 12) return 3;
  throw new Error("Unknown source message update group");
}
export type SourceMessageProjection = {
  documentKind?: "source-message-sequence-v1";
  page?: number;
  windowTicket?: number;
  key: string;
  speaker: string;
  text: string;
  alignment: "left" | "center";
  window: "frame" | "none";
  anchor: "top" | "middle" | "bottom";
  phase: "play" | "playing" | "time-wait" | "input-wait" | "finished" | SourceMessageSequencePhase;
  /** Automatic messages ignore the confirm input; VM Wait continues separately. */
  acceptsInput: boolean;
};
type Message = {
  command: SourceMessagePlay;
  phase: "play" | "playing" | "time-wait" | "input-wait" | "finished";
  elapsed: number;
  waitConsumed: boolean;
};
export type SourceMessageSnapshot = { message: Message | SourceMessageSequenceValue | null } & (
  { kind: "source-message-v1" } | { kind: "source-message-v2"; fee: SourceMessageFeeSnapshot });

function seconds(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      !Number.isFinite(Math.fround(value)))
    throw new Error("Invalid source message scaled delta seconds");
  return Math.fround(value);
}
export function validateSourceMessageDocument(value: SourceMessageDocument): void {
  checkpointKeys(value, "kind,text,alignment,autoPage,tailWaitSeconds");
  if (value.kind !== "source-message-document-v1" || typeof value.text !== "string" ||
      !value.text || /[<>\\\r]/.test(value.text) ||
      /[^\x20-\x7e\u2010-\u2027\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff01-\uffef\n]/.test(value.text) ||
      !["left", "center"].includes(value.alignment) || value.autoPage !== true ||
      value.text.split("\n").length > 4 ||
      value.text.split("\n").some(line => line.length > SOURCE_MESSAGE_WEB_LINE_LIMIT))
    throw new Error("Unsupported source message document or page layout");
  if (value.tailWaitSeconds !== null &&
      (seconds(value.tailWaitSeconds) !== value.tailWaitSeconds || value.tailWaitSeconds <= 0))
    throw new Error("Invalid source message inline wait");
}
function command(value: SourceMessagePlay | { kind: "close" }): void {
  if (value.kind === "close") { checkpointKeys(value, "kind"); return; }
  checkpointKeys(value, "kind,key,speaker,layout,document,seconds");
  checkpointKeys(value.layout, "window,anchor");
  if (value.kind !== "play" || typeof value.key !== "string" || !value.key ||
      value.speaker !== "" || value.layout.window !== "none" ||
      !["top", "middle", "bottom"].includes(value.layout.anchor) ||
      typeof value.seconds !== "number" || !Number.isFinite(value.seconds) || value.seconds >= 0)
    throw new Error("Unsupported source message window, speaker or synchronous timing");
  validateSourceMessageDocument(value.document);
}

/** Single field message owner. Parent FieldGame prepares the actor-update effect
 * and this candidate together, then commits once; rendering never changes flow.
 * Construction is the host's explicit empty MessageWindow initialization, not a
 * fallback for a missing native MessageReady context. */
export class SourceMessageState {
  private frameReservation: object | null = null;
  private requireWritable(): void {
    if (this.frameReservation) throw new Error("Source message owner is reserved by a frame transaction");
  }
  /** The field and battle share this actual owner. A frame may operate only on
   * its private fork until all VM/action/provider work succeeds. Discard leaves
   * the window, ticket and fee untouched; a commit never reuses a prior ticket. */
  prepareFrame() {
    this.requireWritable();
    const token = {}, revision = this.revision, entryTicket = this.windowTicket, state = this.fork();
    this.frameReservation = token;
    let closed = false;
    const validate = () => {
      if (closed || this.frameReservation !== token || this.revision !== revision)
        throw new Error("Stale source message frame transaction");
    };
    const discard = () => { validate(); closed = true; this.frameReservation = null; };
    return { state, validate, discard,
      prepareCommit: () => {
        validate();
        const candidateRevision = state.revision, value = structuredClone(state.value),
          fee = structuredClone(state.fee), ticket = state.windowTicket, emptyStops = structuredClone(state.emptyStops);
        if (!Number.isSafeInteger(ticket) || ticket < entryTicket)
          throw new Error("Source message frame cannot restore an earlier window ticket");
        const finalValidate = () => {
          validate();
          if (state.revision !== candidateRevision)
            throw new Error("Source message frame candidate changed after preparation");
        };
        return { validate: finalValidate, commit: () => {
          finalValidate();
          this.value = value; this.fee = fee; this.windowTicket = ticket; this.emptyStops = emptyStops;
          this.revision++; closed = true; this.frameReservation = null;
        } };
      } };
  }
  private emptyStops: { key: string; reason: FieldEmptyMessageOp["reason"]; ticket: number; retiredTicket: number; warning: "missing-static-source-message" | null }[] = [];
  get emptyStopJournal() { return structuredClone(this.emptyStops); }
  /** Dedicated native empty-lookup branch: no message update-group effect. */
  prepareEmptyStop(op: FieldEmptyMessageOp) {
    this.requireWritable(); validateFieldEmptyMessage(op);
    const revision = this.revision, ticket = this.windowTicket + 1, retiredTicket = this.windowTicket;
    if (!Number.isSafeInteger(ticket)) throw new Error("Source empty-message window ticket overflows");
    const journal = [...structuredClone(this.emptyStops), { key: op.key, reason: op.reason, ticket, retiredTicket,
      warning: op.reason === "missing-static-row" ? "missing-static-source-message" as const : null }];
    let committed = false;
    const validate = () => { this.requireWritable(); if (committed || this.revision !== revision) throw new Error("Stale source empty-message Stop transaction"); };
    return { ticket, retiredTicket, effects: [] as SourceMessageEffect[], validate, commit: () => {
      validate(); this.value = null; this.windowTicket = ticket; this.emptyStops = journal; this.revision++; committed = true;
    } };
  }
  private value: Message | SourceMessageSequenceValue | null = null;
  private revision = 0;
  /** Ephemeral owner revision for prepared-map publication; never serialized. */
  get mutationRevision(): number { return this.revision; }
  private windowTicket = 0;
  private readonly feeCatalog: SourceMessageFeeCatalog | undefined;
  private fee: SourceMessageFeeSnapshot | null = null;
  constructor(catalog?: SourceMessageFeeCatalog, seed?: SourceMessageFeeSnapshot) {
    this.feeCatalog = catalog && parseSourceMessageFeeCatalog(catalog);
    if (seed) this.fee = restoreSourceMessageFee(seed, this.feeCatalog);
  }
  get feeSnapshot(): SourceMessageFeeSnapshot | null { return structuredClone(this.fee); }
  prepareFee(op: SourceGilTagOp) {
    const value = bindSourceMessageFee(this.feeCatalog, op), revision = this.revision; let committed = false;
    return { commit: () => {
      this.requireWritable();
      if (committed || revision !== this.revision) throw new Error("Stale source message fee replacement");
      this.fee = value; this.revision++; committed = true;
    } };
  }
  prepareFeeValue() {
    if (!this.fee) throw new Error("Source message KINGAKU has not been set");
    const fee = restoreSourceMessageFee(this.fee, this.feeCatalog), revision = this.revision;
    return { value: String(fee.amount), validate: () => {
      if (revision !== this.revision) throw new Error("Stale source message fee presentation");
    } };
  }
  get endWaiting(): boolean {
    return this.value !== null && (isSequence(this.value) ? this.value.phase === "end-wait" : this.value.phase === "finished");
  }
  sequenceStatus(ticket: number) {
    if (ticket !== this.windowTicket || !this.value || !isSequence(this.value))
      throw new Error("Stale source Msg wrapper window");
    return sourceMessageSequenceStatus(this.value, ticket);
  }
  executePageInput(ticket: number): boolean {
    this.requireWritable();
    this.sequenceStatus(ticket);
    const next = executeSourceMessagePageInput(this.value as SourceMessageSequenceValue);
    if (next === null) return false;
    this.value = next; this.revision++; return true;
  }
  get sequenceAfter(): SourceMessageSequenceCommand["after"] | null {
    return this.value && isSequence(this.value) ? this.value.command.after : null;
  }
  /** Legacy ordinary dialogue and this controller are exclusive projections of
   * the same global window. Transfer preserves the Message update mask. */
  prepareManualHandoff() {
    if (!this.value || !isSequence(this.value) || this.value.command.after !== "message")
      throw new Error("Source sequence has no ordinary-message continuation");
    const revision = this.revision; let committed = false;
    return { commit: () => {
      this.requireWritable();
      if (committed || revision !== this.revision) throw new Error("Stale source message handoff");
      this.value = null; this.windowTicket++; this.revision++; committed = true;
    } };
  }
  retainAfterChoice(): void {
    this.requireWritable();
    if (!this.value || !isSequence(this.value) || this.value.command.after !== "choice" ||
        !sourceMessageSequenceStatus(this.value, this.windowTicket).complete)
      throw new Error("Source choice lost its complete ordinary window");
    this.value = structuredClone(this.value); this.value.command.after = "message"; this.revision++;
  }
  get active(): boolean { return this.value !== null; }
  get projection(): SourceMessageProjection | null {
    const value = this.value;
    if (value === null) return null;
    if (isSequence(value)) return { documentKind: "source-message-sequence-v1", page: value.page, windowTicket: this.windowTicket,
      key: value.command.key, speaker: value.command.speaker,
      text: value.text, alignment: value.command.document.alignment, ...value.command.layout, phase: value.phase,
      acceptsInput: !value.timing.autoInput && ["new-page", "press-wait", "end-wait"].includes(value.phase) &&
        value.elapsed >= Math.fround(.01) && (value.phase !== "end-wait" || value.playing) };
    return { key: value.command.key, speaker: "", text: value.phase === "play" ? "" : value.command.document.text,
      alignment: value.command.document.alignment, ...value.command.layout,
      phase: value.phase, acceptsInput: false };
  }
  snapshot(): SourceMessageSnapshot {
    return this.fee ? { kind: "source-message-v2", message: structuredClone(this.value), fee: structuredClone(this.fee) }
      : { kind: "source-message-v1", message: structuredClone(this.value) };
  }
  fork(): SourceMessageState {
    const copy = new SourceMessageState(this.feeCatalog, this.fee ?? undefined); copy.value = structuredClone(this.value); copy.windowTicket = this.windowTicket; copy.emptyStops = structuredClone(this.emptyStops); return copy;
  }
  /** Retained finished text is still an open window. No live message coroutine
   * or retained global window is admitted to the stable field save format. */
  static restore(value: SourceMessageSnapshot, catalog?: SourceMessageFeeCatalog): SourceMessageState {
    const fee = value.kind === "source-message-v2";
    checkpointKeys(value, "kind,message" + (fee ? ",fee" : ""));
    if (value.kind !== "source-message-v1" && !fee || value.message !== null)
      throw new Error("Active or invalid source message checkpoint");
    return new SourceMessageState(catalog, fee ? value.fee : undefined);
  }
  prepare(op: SourceMessageOp, context?: SourceMessageSequenceContext): {
    flow: "next";
    ticket: number;
    timing: SourceMessageSequenceValue["timing"] | null;
    effects: SourceMessageEffect[];
    commit(): void;
  } {
    if (op.kind !== "source-message") throw new Error("Expected source message operation");
    if (op.command.kind === "finish-wait") throw new Error("MsgFinishWait polls the existing window and cannot publish a new one");
    let next: Message | SourceMessageSequenceValue | null;
    if (op.command.kind === "sequence") {
      if (!context) throw new Error("Source message sequence profile/timing owner is unavailable");
      next = createSourceMessageSequence(op.command, context);
    } else {
      command(op.command);
      next = op.command.kind === "close" ? null : {
        command: structuredClone(op.command), phase: "play", elapsed: 0, waitConsumed: false };
    }
    const ticket = this.windowTicket + 1;
    if (!Number.isSafeInteger(ticket)) throw new Error("Source message window ticket overflows");
    const revision = this.revision;
    let committed = false;
    return { flow: "next", ticket, timing: next !== null && isSequence(next) ? structuredClone(next.timing) : null, effects: [{ kind: "entity-update-group", group: next ? 8 : 12, invokeCallback: false }],
      commit: () => {
        this.requireWritable();
        if (committed || revision !== this.revision) throw new Error("Stale source message transaction");
        this.value = next; this.windowTicket = ticket; this.revision++; committed = true;
      } };
  }
  /** Source AUTO_P makes InputAction return before querying physical input. */
  confirm(): boolean {
    this.requireWritable();
    if (this.value === null || !isSequence(this.value)) return false;
    const next = confirmSourceMessageSequence(this.value);
    if (next === null) return false;
    this.value = next; this.revision++; return true;
  }
  /** One manager Update per call. TimeFunction uses float32 accumulation and
   * resets excess time; it does not catch up several state transitions at once.
   * Web host orders this before its interpreter clock. */
  advance(deltaSeconds: number): void {
    this.requireWritable();
    const dt = seconds(deltaSeconds), value = this.value;
    if (value !== null && isSequence(value)) {
      this.value = advanceSourceMessageSequence(value, dt); this.revision++; return;
    }
    const next = structuredClone(value);
    if (next === null || next.phase === "finished") return;
    if (next.phase === "play") {
      // PlayingInit tail-calls ToNextMessage: reveal this page up to the tail wait.
      next.phase = "playing";
    } else if (next.phase === "playing") {
      next.phase = !next.waitConsumed && next.command.document.tailWaitSeconds !== null
        ? "time-wait" : "input-wait";
      next.elapsed = 0;
    } else {
      next.elapsed = Math.fround(next.elapsed + dt);
      if (!Number.isFinite(next.elapsed)) throw new Error("Source message time overflows float32");
      const limit = next.phase === "time-wait" ? next.command.document.tailWaitSeconds! : Math.fround(0.3);
      if (next.elapsed >= limit) {
        if (next.phase === "time-wait") { next.waitConsumed = true; next.phase = "playing"; }
        else next.phase = "finished";
        next.elapsed = 0;
      }
    }
    this.value = next; this.revision++;
  }
}

function isSequence(value: Message | SourceMessageSequenceValue): value is SourceMessageSequenceValue {
  return value.command.kind === "sequence";
}
