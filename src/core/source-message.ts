import { checkpointKeys } from "./checkpoint-validation.js";

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
export type SourceMessageCommand = SourceMessagePlay | { kind: "close" };
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
  key: string;
  speaker: "";
  text: string;
  alignment: "left" | "center";
  window: "none";
  anchor: "top" | "middle" | "bottom";
  phase: "play" | "playing" | "time-wait" | "input-wait" | "finished";
  /** Automatic messages ignore the confirm input; VM Wait continues separately. */
  acceptsInput: false;
};
type Message = {
  command: SourceMessagePlay;
  phase: SourceMessageProjection["phase"];
  elapsed: number;
  waitConsumed: boolean;
};
export type SourceMessageSnapshot = {
  kind: "source-message-v1";
  message: Message | null;
};

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
function command(value: SourceMessageCommand): void {
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
  private value: Message | null = null;
  private revision = 0;
  get active(): boolean { return this.value !== null; }
  get projection(): SourceMessageProjection | null {
    const value = this.value;
    if (value === null) return null;
    return { key: value.command.key, speaker: "", text: value.phase === "play" ? "" : value.command.document.text,
      alignment: value.command.document.alignment, ...value.command.layout,
      phase: value.phase, acceptsInput: false };
  }
  snapshot(): SourceMessageSnapshot {
    return { kind: "source-message-v1", message: structuredClone(this.value) };
  }
  fork(): SourceMessageState {
    const copy = new SourceMessageState(); copy.value = structuredClone(this.value); return copy;
  }
  /** Retained finished text is still an open window. No live message coroutine
   * or retained global window is admitted to the stable field save format. */
  static restore(value: SourceMessageSnapshot): SourceMessageState {
    checkpointKeys(value, "kind,message");
    if (value.kind !== "source-message-v1" || value.message !== null)
      throw new Error("Active or invalid source message checkpoint");
    return new SourceMessageState();
  }
  prepare(op: SourceMessageOp): {
    flow: "next";
    effects: SourceMessageEffect[];
    commit(): void;
  } {
    if (op.kind !== "source-message") throw new Error("Expected source message operation");
    command(op.command);
    const next: Message | null = op.command.kind === "close" ? null : {
      command: structuredClone(op.command), phase: "play", elapsed: 0, waitConsumed: false,
    };
    const revision = this.revision;
    let committed = false;
    return { flow: "next", effects: [{ kind: "entity-update-group", group: next ? 8 : 12, invokeCallback: false }],
      commit: () => {
        if (committed || revision !== this.revision) throw new Error("Stale source message transaction");
        this.value = next; this.revision++; committed = true;
      } };
  }
  /** Source AUTO_P makes InputAction return before querying physical input. */
  confirm(): boolean { return false; }
  /** One manager Update per call. TimeFunction uses float32 accumulation and
   * resets excess time; it does not catch up several state transitions at once.
   * Web host orders this before its interpreter clock. */
  advance(deltaSeconds: number): void {
    const dt = seconds(deltaSeconds), next = structuredClone(this.value);
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
