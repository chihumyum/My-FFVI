import { int32 } from "./event-state.js";
import {
  planTreasureInventory, validateTreasureInventory,
  type TreasureBoxRequest, type TreasureInventoryDefinition, type TreasureInventoryEffect,
  type TreasureInventoryLimits, type TreasureInventoryRead,
} from "./treasure-inventory.js";

export type TreasureTaskEffect = TreasureInventoryEffect | { kind: "deactivate-action" };
export type TreasureTaskWait = "sound" | "message" | "frame" | "complete";
export type TreasureTaskMessage = {
  key: string;
  text: string;
  speaker: string;
  alignment?: "center";
};
export type TreasureTaskMessages = {
  /** Missing only when unused by the compiled request and unsupported. A host
   * must preflight every message in the selected branch before any effect. */
  reward: TreasureTaskMessage | null;
  empty: TreasureTaskMessage;
  countOver: TreasureTaskMessage | null;
  parameter: { token: "ITEM_N" | "NUM"; value: string; sourceKey: string | null } | null;
};

/** Transient interpreter state, never a stable save record. Each transition is
 * a candidate: publish it only after all returned effects have been prepared
 * and committed successfully. Keeping the previous state retries that boundary. */
export type TreasureTaskState = {
  kind: "treasure-task-v1";
  definition: TreasureInventoryDefinition;
  request: TreasureBoxRequest;
  wait: "start" | TreasureTaskWait;
  remaining: TreasureInventoryEffect[];
};
type TreasureTaskRead = {
  /** DataStorage TreasureFlag, not FieldTresureBox.isOpen. Read again after SE. */
  flag: boolean | null;
  owned: TreasureInventoryRead;
  limits: TreasureInventoryLimits;
};
export type TreasureTaskInput =
  | ({ kind: "start" | "sound-complete" } & TreasureTaskRead)
  | { kind: "message-complete" | "frame" };
export type TreasureTaskTransition = {
  state: TreasureTaskState;
  effects: TreasureTaskEffect[];
  wait: TreasureTaskWait;
};

export function createTreasureTask(
  definition: TreasureInventoryDefinition,
  request: TreasureBoxRequest,
): TreasureTaskState {
  validateTreasureInventory(definition);
  if (request.kind !== "treasure-box" || request.entityId !== definition.entityId ||
    typeof request.after !== "boolean" || typeof request.message !== "boolean" ||
    int32(request.actionSoundId) < 0)
    throw new Error("Invalid treasure task request");
  return { kind: "treasure-task-v1", definition: structuredClone(definition),
    request: structuredClone(request), wait: "start", remaining: [] };
}

/** EventActionTreasure.MoveNext 0x7b46f0, GetMessage 0x7ae150 and
 * EventTalkTask.MoveNext 0x2f76f0. A sound acknowledgement means PlaySe was
 * attempted, any required load completed and PlaySe was retried; it does not
 * wait for playback. A host may instead acknowledge its explicitly recorded
 * muted-development omission. It must never silently skip an unknown sound.
 *
 * Message acknowledgement means the message has been presented across a frame
 * boundary and its input/playback completed. This reducer then models TalkTask's
 * final yield before the next message, callback or treasure-flag write. */
export function advanceTreasureTask(
  current: TreasureTaskState,
  input: TreasureTaskInput,
): TreasureTaskTransition {
  if (current.kind !== "treasure-task-v1") throw new Error("Invalid treasure task state");
  const state = structuredClone(current), effects: TreasureTaskEffect[] = [];
  const finish = (wait: TreasureTaskWait): TreasureTaskTransition => {
    state.wait = wait;
    return { state, effects, wait };
  };
  if (state.wait === "complete") return finish("complete");
  const expected = state.wait === "sound" ? "sound-complete" :
    state.wait === "message" ? "message-complete" : state.wait;
  if (input.kind !== expected) throw new Error(`Treasure task is waiting for ${expected}`);

  if (input.kind === "start" || input.kind === "sound-complete") {
    if (input.flag !== null && typeof input.flag !== "boolean")
      throw new Error("Invalid treasure opened flag");
    if (input.kind === "start") {
      // The ordinary wrapper invokes IMapAccessor.DeactivateAction. This
      // build's FieldController implementation is a verified ret/no-op, not
      // the source of an input lock. Preserve the call identity explicitly.
      if (!state.request.after) effects.push({ kind: "deactivate-action" });
      if (state.request.actionSoundId > 0) {
        if (input.flag === null) throw new Error("Unknown treasure opened flag");
        if (!input.flag) {
          effects.push({ kind: "sound", id: state.request.actionSoundId,
            waitForLoad: true, waitForPlayback: false });
          return finish("sound");
        }
      }
    }
    // Do not precompute this decision across the sound-loading suspension:
    // native code reads the flag and capacity after it resumes from that wait.
    const plan = planTreasureInventory(state.definition,
      { ...state.request, actionSoundId: 0 }, input.flag, input.owned, input.limits);
    state.remaining = plan.effects;
    // The ordinary wrapper has a mandatory first yield even if its child
    // immediately hands off a script. It does not wait for that script itself.
    if (!state.request.after && plan.kind === "run-script")
      state.remaining.push({ kind: "yield", frames: 1 });
  } else if (input.kind === "message-complete") {
    effects.push({ kind: "yield", frames: 1 });
    return finish("frame");
  }

  while (state.remaining.length) {
    const effect = state.remaining.shift()!;
    effects.push(effect);
    if (effect.kind === "message") return finish("message");
    if (effect.kind === "yield") return finish("frame");
  }
  return finish("complete");
}
