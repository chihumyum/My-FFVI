import { checkpointKeys } from "./checkpoint-validation.js";
import type { FieldMessageTemplate } from "./field-message-template.js";

const waits: Readonly<Record<string, number>> = Object.freeze({
  "": 1, "00": 1, "01": .25, "02": .5, "03": .75, "04": 1,
  "05": 1.25, "06": 1.5, "07": 1.75, "08": 2, "09": 2.25,
  "0a": 2.5, "0b": 2.75, "0c": 3, "0d": 3.25, "0e": 3.5, "0f": 3.75,
  "10": 4, "11": 4.25, "12": 4.5, "13": 4.75, "14": 5, "15": 5.25,
  "16": 5.5, "18": 6, "19": 6.25, "1a": 6.5, "1c": 7, "20": 8,
  "24": 9, "28": 10, "2a": 10.5, "3c": 15, "50": 20, "78": 30, "ff": 63.75,
});
export function sourceMessageSequenceWait(suffix: string): number {
  if (typeof suffix !== "string" || !Object.hasOwn(waits, suffix))
    throw new Error("Unsupported source sequence WAIT suffix: " + suffix);
  return waits[suffix]!;
}

/** Explicit Web presentation/input policy. Native TextGenerator wrapping,
 * typewriter glyph cadence and held-key repeat are independent parity gaps. */
export const SOURCE_MESSAGE_SEQUENCE_PROFILE = "web-field-message-sequence-v1" as const;
export type SourceMessageToken =
  | { kind: "text"; text: string }
  | { kind: "wait"; seconds: number; suffix: string }
  | { kind: "press" }
  | { kind: "page"; tag: "P" | "AUTO_P" }
  | { kind: "center" };
export type SourceMessageSequenceDocument = {
  kind: "source-message-sequence-v1";
  tokens: SourceMessageToken[];
  alignment: "left" | "center";
};
export type SourceMessageSequenceCommand = {
  kind: "sequence";
  key: string;
  speaker: string;
  layout: { window: "frame" | "none"; anchor: "top" | "middle" | "bottom" };
  document: SourceMessageSequenceDocument;
  seconds: number;
  /** Only positive source duration consults this third integer operand. */
  bypassSpeed: boolean;
  after: "message" | "choice" | "close";
  /** Nonempty text runs occupy template pages, preserving control boundaries. */
  template?: FieldMessageTemplate;
};
export type SourceMessageSequenceContext = {
  kind: typeof SOURCE_MESSAGE_SEQUENCE_PROFILE;
  layout: "source-explicit-pages";
  /** Integrator automatic context affects only positive Msg operands. */
  integratorAutomatic: boolean;
  /** Exact prepared factor, or null when no configuration owner is available.
   * Never silently substitute a default. A declared Web policy may supply it. */
  battleMessageSpeedFactor: number | null;
};
/** Declared browser policy, not a recovered native configuration default.
 * The app and headless source-route probes use this same immutable policy.
 * Preparing a fresh value does not create another message/window owner. */
export function createWebFieldMessageSequencePort(): {
  prepare(): { context: SourceMessageSequenceContext; validate(): void };
} {
  return { prepare: () => ({ context: {
    kind: SOURCE_MESSAGE_SEQUENCE_PROFILE, layout: "source-explicit-pages",
    integratorAutomatic: false, battleMessageSpeedFactor: 1,
  }, validate() {} }) };
}

export type SourceMessageSequenceTiming = {
  autoInput: boolean;
  pageSeconds: number | null;
};
export type SourceMessageSequencePhase = "play" | "playing" | "time-wait" | "press-wait" |
  "page-wait" | "new-page" | "input-wait" | "end-wait";
/** Value stored inside the existing SourceMessageState owner, never another
 * mutable window owner. Only the interpreter's wrapper timer lives in Task. */
export type SourceMessageSequenceValue = {
  command: SourceMessageSequenceCommand;
  timing: SourceMessageSequenceTiming;
  phase: SourceMessageSequencePhase;
  token: number;
  text: string;
  page: number;
  elapsed: number;
  playing: boolean;
};
const badText = /[<>\\\r\u0000-\u0009\u000b-\u001f\u007f]/;
function floatSeconds(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isFinite(Math.fround(value)))
    throw new Error("Invalid source sequence delta seconds");
  return Math.fround(value);
}
export function validateSourceMessageSequenceDocument(document: SourceMessageSequenceDocument): void {
  checkpointKeys(document, "kind,tokens,alignment");
  if (document.kind !== "source-message-sequence-v1" || !Array.isArray(document.tokens) || !document.tokens.length ||
      !["left", "center"].includes(document.alignment)) throw new Error("Invalid source sequence document");
  let text = "", hasCenter = false, pageText = false;
  document.tokens.forEach((token, index) => {
    if (token.kind === "text") {
      checkpointKeys(token, "kind,text");
      if (typeof token.text !== "string" || !token.text || badText.test(token.text))
        throw new Error("Unsupported source sequence text");
      text += token.text; pageText = true;
    } else if (token.kind === "wait") {
      checkpointKeys(token, "kind,seconds,suffix");
      if (floatSeconds(token.seconds) !== token.seconds || token.seconds <= 0 || typeof token.suffix !== "string" ||
          sourceMessageSequenceWait(token.suffix) !== token.seconds)
        throw new Error("Invalid source sequence wait");
    } else if (token.kind === "page") {
      checkpointKeys(token, "kind,tag");
      if (!["P", "AUTO_P"].includes(token.tag) || !pageText)
        throw new Error("Unsupported empty source sequence page");
      // Native drops the trailing NewLineTag. Do not create a phantom page.
      if (index + 1 < document.tokens.length) pageText = false;
    } else if (token.kind === "center") {
      checkpointKeys(token, "kind"); hasCenter = true;
    } else if (token.kind === "press") checkpointKeys(token, "kind");
    else throw new Error("Unsupported source sequence control");
  });
  if (!pageText) {
    const lastPage = document.tokens.map(token => token.kind).lastIndexOf("page");
    if (lastPage >= 0 && document.tokens.slice(lastPage + 1).some(token => token.kind !== "center"))
      throw new Error("Unsupported control-only source sequence page");
  }
  if (!text || document.alignment !== (hasCenter ? "center" : "left"))
    throw new Error("Source sequence alignment/text binding mismatch");
}
export function sourceMessageSequenceTextRuns(document: SourceMessageSequenceDocument): string[] {
  validateSourceMessageSequenceDocument(document);
  return document.tokens.flatMap(token => token.kind === "text" ? [token.text] : []);
}
export function prepareSourceMessageSequenceTiming(command: SourceMessageSequenceCommand,
  context: SourceMessageSequenceContext): SourceMessageSequenceTiming {
  checkpointKeys(context, "kind,layout,integratorAutomatic,battleMessageSpeedFactor");
  if (context.kind !== SOURCE_MESSAGE_SEQUENCE_PROFILE || context.layout !== "source-explicit-pages" ||
      typeof context.integratorAutomatic !== "boolean" || context.battleMessageSpeedFactor !== null &&
      (typeof context.battleMessageSpeedFactor !== "number" || !Number.isFinite(context.battleMessageSpeedFactor) ||
       context.battleMessageSpeedFactor <= 0 || Math.fround(context.battleMessageSpeedFactor) !== context.battleMessageSpeedFactor))
    throw new Error("Source message sequence profile/timing owner is unavailable");
  checkpointKeys(command, "kind,key,speaker,layout,document,seconds,bypassSpeed,after" +
    (command.template === undefined ? "" : ",template"));
  checkpointKeys(command.layout, "window,anchor");
  validateSourceMessageSequenceDocument(command.document);
  if (command.kind !== "sequence" || typeof command.key !== "string" || !command.key ||
      typeof command.speaker !== "string" || badText.test(command.speaker) || command.speaker.includes("\n") ||
      !["frame", "none"].includes(command.layout.window) || !["top", "middle", "bottom"].includes(command.layout.anchor) ||
      !["message", "choice", "close"].includes(command.after) || typeof command.bypassSpeed !== "boolean" ||
      typeof command.seconds !== "number" || !Number.isFinite(command.seconds))
    throw new Error("Invalid source sequence command");
  const positive = command.seconds > 0;
  const autoInput = command.document.tokens.some(token => token.kind === "page" && token.tag === "AUTO_P") ||
    positive && context.integratorAutomatic;
  if (autoInput && command.document.tokens.some(token => token.kind === "press"))
    throw new Error("Automatic source message with PRESS requires an external input callback host");
  let pageSeconds: number | null = null;
  if (positive) {
    pageSeconds = command.seconds / (command.document.tokens.filter(token => token.kind === "page" && token.tag === "P").length + 1);
    if (!context.integratorAutomatic && !command.bypassSpeed) {
      if (context.battleMessageSpeedFactor === null) throw new Error("Source Msg BattleMessageSpeed factor owner is unavailable");
      pageSeconds /= context.battleMessageSpeedFactor;
    }
    if (!Number.isFinite(pageSeconds) || pageSeconds <= 0) throw new Error("Source Msg page timing overflow/underflow");
  }
  return { autoInput, pageSeconds };
}
function reveal(value: SourceMessageSequenceValue): void {
  const tokens = value.command.document.tokens;
  while (value.token < tokens.length) {
    const token = tokens[value.token]!;
    if (token.kind === "center") { value.token++; continue; }
    if (token.kind !== "text") break;
    value.text += token.text; value.token++;
  }
}
function phase(value: SourceMessageSequenceValue, next: SourceMessageSequencePhase): void {
  value.phase = next; value.elapsed = 0;
  if (next === "playing") reveal(value);
  if (next === "end-wait" && value.timing.autoInput) value.playing = false;
}
export function createSourceMessageSequence(command: SourceMessageSequenceCommand,
  context: SourceMessageSequenceContext): SourceMessageSequenceValue {
  const timing = prepareSourceMessageSequenceTiming(command, context);
  // The caller resolves values once through the existing prepared name/fee
  // view, then removes the compile-time template before this publication.
  if (command.template !== undefined || [command.speaker, ...sourceMessageSequenceTextRuns(command.document)]
    .some(text => /\(([\p{L}\p{Mn}\p{Nd}\p{Pc}]+)\)/u.test(text)))
    throw new Error("Source sequence requires a resolved source-value presentation");
  return { command: structuredClone(command), timing, phase: "play", token: 0, text: "", page: 0, elapsed: 0, playing: true };
}
/** A manager Update never spills excess time through another wait or page. */
export function advanceSourceMessageSequence(value: SourceMessageSequenceValue, deltaSeconds: number): SourceMessageSequenceValue {
  const dt = floatSeconds(deltaSeconds), next = structuredClone(value);
  next.elapsed = Math.fround(next.elapsed + dt);
  if (!Number.isFinite(next.elapsed)) throw new Error("Source sequence clock overflows float32");
  if (next.phase === "play") phase(next, "playing");
  else if (next.phase === "playing") {
    const token = next.command.document.tokens[next.token];
    if (token?.kind === "wait") phase(next, "time-wait");
    else if (token?.kind === "press") phase(next, "press-wait");
    else if (token?.kind === "page" && next.command.document.tokens.slice(next.token + 1).some(token => token.kind !== "center")) phase(next, "page-wait");
    else { if (token?.kind === "page") next.token++; phase(next, "input-wait"); }
  } else if (next.phase === "time-wait") {
    const token = next.command.document.tokens[next.token];
    if (token?.kind !== "wait") throw new Error("Source sequence lost its inline wait");
    if (next.elapsed >= token.seconds) { next.token++; phase(next, "playing"); }
  } else if (next.phase === "page-wait" && next.elapsed >= Math.fround(.3)) phase(next, "new-page");
  else if (next.phase === "input-wait" && next.elapsed >= Math.fround(.3)) phase(next, "end-wait");
  else if (next.phase === "new-page" && next.timing.autoInput) return executeSourceMessagePageInput(next)!;
  return next;
}
/** ExecutionInputAction only invokes the current callback. During the initial
 * page-wait coroutine there is no callback and the call changes nothing. */
export function executeSourceMessagePageInput(value: SourceMessageSequenceValue): SourceMessageSequenceValue | null {
  if (value.phase !== "new-page") return null;
  const next = structuredClone(value), token = next.command.document.tokens[next.token];
  if (token?.kind !== "page") throw new Error("Source sequence lost its page boundary");
  next.token++; next.page++; next.text = ""; phase(next, "play"); return next;
}
export function confirmSourceMessageSequence(value: SourceMessageSequenceValue): SourceMessageSequenceValue | null {
  // Explicit Web edge-input guard; native held-key cadence is not asserted.
  if (value.timing.autoInput || value.elapsed < Math.fround(.01)) return null;
  if (value.phase === "new-page") return executeSourceMessagePageInput(value);
  const next = structuredClone(value);
  if (next.phase === "press-wait") { next.token++; phase(next, "playing"); return next; }
  if (next.phase === "end-wait" && next.playing) { next.playing = false; return next; }
  return null;
}
export type SourceMessageSequenceStatus = {
  ticket: number;
  complete: boolean;
  endWaiting: boolean;
  newPageInputWaiting: boolean;
  playing: boolean;
};
export function sourceMessageSequenceStatus(value: SourceMessageSequenceValue, ticket: number): SourceMessageSequenceStatus {
  return { ticket, complete: value.phase === "input-wait" || value.phase === "end-wait",
    endWaiting: value.phase === "end-wait", newPageInputWaiting: value.phase === "page-wait" || value.phase === "new-page",
    playing: value.playing };
}
/** Source Msg wrapper registers belong to its existing interpreter Task. */
export type SourceMessageTaskCursor = {
  ticket: number;
  pageSeconds: number | null;
  after: SourceMessageSequenceCommand["after"];
  anchorTime: number;
  finalTimerStarted: boolean;
};
export function createSourceMessageTaskCursor(command: SourceMessageSequenceCommand, timing: SourceMessageSequenceTiming,
  ticket: number, timeMilliseconds: number): SourceMessageTaskCursor | null {
  if (!Number.isSafeInteger(ticket) || ticket < 1 || !Number.isFinite(timeMilliseconds) || timeMilliseconds < 0)
    throw new Error("Invalid source Msg wrapper cursor");
  return command.seconds < 0 ? null : { ticket, pageSeconds: timing.pageSeconds, after: command.after,
    anchorTime: timeMilliseconds, finalTimerStarted: false };
}
export function pollSourceMessageTask(cursor: SourceMessageTaskCursor, status: SourceMessageSequenceStatus,
  timeMilliseconds: number): { flow: "next" | "wait"; cursor: SourceMessageTaskCursor; action: "page-input" | "close" | null } {
  if (status.ticket !== cursor.ticket || !Number.isFinite(timeMilliseconds) || timeMilliseconds < cursor.anchorTime)
    throw new Error("Stale source Msg wrapper window/clock");
  const next = { ...cursor }, result = { flow: "wait" as "next" | "wait", cursor: next, action: null as "page-input" | "close" | null };
  if (next.after === "choice" && status.complete) { result.flow = "next"; return result; }
  if (status.endWaiting) {
    let completed = !status.playing;
    if (next.pageSeconds !== null) {
      completed = false;
      if (!next.finalTimerStarted) { next.finalTimerStarted = true; next.anchorTime = timeMilliseconds; }
      else completed = (timeMilliseconds - next.anchorTime) / 1000 >= next.pageSeconds;
    }
    if (completed) { result.flow = "next"; if (next.after === "close") result.action = "close"; }
  } else if (next.pageSeconds !== null) {
    if (!status.newPageInputWaiting) next.anchorTime = timeMilliseconds;
    else if ((timeMilliseconds - next.anchorTime) / 1000 >= next.pageSeconds) result.action = "page-input";
  }
  return result;
}
