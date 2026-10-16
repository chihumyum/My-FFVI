import { canonical } from "./canonical.js";
import { checkpointKeys, checkpointInteger } from "./checkpoint-validation.js";

/** Explicit Web projection. Native MapUIView's active table, font/layout and
 * SystemMessageWindow animation remain separate, unclaimed visual evidence. */
export const WEB_SOURCE_FIELD_UI = "web-source-field-ui-v1" as const;
export type WebSourceFieldUi = typeof WEB_SOURCE_FIELD_UI;
export type SourceLocation = { areaId: string; locationId: string };
export type FieldLocationPort = {
  read(): SourceLocation | null;
  prepare(value: SourceLocation): { validate(): void; commitWith(publish: () => void): void };
};
export type FieldUiCommand =
  | { kind: "title"; location: SourceLocation; area: string; title: string }
  | { kind: "event" }
  | { kind: "all" }
  | { kind: "minimap" };
export type FieldUiOp = { kind: "source-field-ui"; command: FieldUiCommand };
export type FieldUiSnapshot = {
  kind: "source-field-ui-state-v1";
  policy: WebSourceFieldUi;
  sourceSetHash: string;
  /** No inferred Field state: only the two recovered explicit transitions. */
  mainGameState: 11 | 12 | null;
  view: "all" | "navi" | null;
  clockMs: number;
  title: { area: string; title: string; shownAt: number } | null;
  /** Integrator callbacks close the current singleton title, including a
   * replacement shown before an older callback fires. */
  closeTimers: number[];
};
export function parseSourceLocation(raw: SourceLocation): SourceLocation {
  checkpointKeys(raw, "areaId,locationId");
  for (const value of [raw.areaId, raw.locationId])
    if (typeof value !== "string" || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value))
      throw new Error("Invalid source CurrentArea/CurrentLocation identity");
  return { ...raw };
}
export function validateFieldUiPolicy(value: unknown): asserts value is WebSourceFieldUi | undefined {
  if (value !== undefined && value !== WEB_SOURCE_FIELD_UI) throw new Error("Unknown source Field UI runtime");
}
export function parseFieldUiCommand(command: FieldUiCommand): FieldUiCommand {
  if (command.kind === "title") {
    checkpointKeys(command, "kind,location,area,title");
    parseSourceLocation(command.location);
    for (const value of [command.area, command.title])
      if (typeof value !== "string" || /[<>\\\u0000-\u001f\u007f]/.test(value))
        throw new Error("Unsupported source map title text/control");
  } else {
    checkpointKeys(command, "kind");
    if (!["event", "all", "minimap"].includes(command.kind)) throw new Error("Unknown source Field UI command");
  }
  return structuredClone(command);
}
export class FieldUiState {
  private value: FieldUiSnapshot;
  constructor(readonly sourceSetHash: string) {
    if (!sourceSetHash) throw new Error("Source Field UI requires a source identity");
    this.value = { kind: "source-field-ui-state-v1", policy: WEB_SOURCE_FIELD_UI, sourceSetHash,
      mainGameState: null, view: null, clockMs: 0, title: null, closeTimers: [] };
  }
  get active(): boolean { return this.value.title !== null || this.value.closeTimers.length > 0; }
  snapshot(): FieldUiSnapshot { return structuredClone(this.value); }
  static restore(raw: FieldUiSnapshot, sourceSetHash: string, stable = false): FieldUiState {
    checkpointKeys(raw, "kind,policy,sourceSetHash,mainGameState,view,clockMs,title,closeTimers");
    if (raw.kind !== "source-field-ui-state-v1" || raw.policy !== WEB_SOURCE_FIELD_UI || raw.sourceSetHash !== sourceSetHash ||
        ![null, 11, 12].includes(raw.mainGameState) || ![null, "all", "navi"].includes(raw.view))
      throw new Error("Source Field UI checkpoint identity mismatch");
    checkpointInteger(raw.clockMs, 0, Number.MAX_SAFE_INTEGER);
    if (!Array.isArray(raw.closeTimers)) throw new Error("Invalid source map title callback queue");
    for (const at of raw.closeTimers) checkpointInteger(at, raw.clockMs + 1, Number.MAX_SAFE_INTEGER);
    if (raw.closeTimers.some((at, index) => index > 0 && at < raw.closeTimers[index - 1]!))
      throw new Error("Source map title callbacks reordered");
    if (raw.title !== null) {
      checkpointKeys(raw.title, "area,title,shownAt");
      parseFieldUiCommand({ kind: "title", location: { areaId: "", locationId: "" }, area: raw.title.area, title: raw.title.title });
      checkpointInteger(raw.title.shownAt, Math.max(0, raw.clockMs - 1999), raw.clockMs);
    }
    if (stable && (raw.title !== null || raw.closeTimers.length)) throw new Error("Active map title cannot be checkpointed");
    const next = new FieldUiState(sourceSetHash); next.value = structuredClone(raw); return next;
  }
  prepare(raw: FieldUiCommand): { validate(): void; commit(): void } {
    const command = parseFieldUiCommand(raw), before = canonical(this.value), next = this.snapshot();
    if (command.kind === "title") {
      next.title = { area: command.area, title: command.title, shownAt: next.clockMs };
      next.closeTimers.push(next.clockMs + 2000);
    } else if (command.kind === "event") next.mainGameState = 12;
    else if (command.kind === "all") next.view = "all";
    else { next.mainGameState = 11; next.view = "navi"; }
    FieldUiState.restore(next, this.sourceSetHash); let consumed = false;
    const validate = () => { if (consumed || canonical(this.value) !== before) throw new Error("Stale source Field UI transaction"); };
    return { validate, commit: () => { validate(); this.value = next; consumed = true; } };
  }
  advance(milliseconds: number): void {
    checkpointInteger(milliseconds, 0, 60000);
    const next = this.snapshot(); next.clockMs += milliseconds; checkpointInteger(next.clockMs, 0, Number.MAX_SAFE_INTEGER);
    if (next.title && next.clockMs - next.title.shownAt >= 2000 || next.closeTimers.some(at => at <= next.clockMs)) next.title = null;
    next.closeTimers = next.closeTimers.filter(at => at > next.clockMs); this.value = next;
  }
}
