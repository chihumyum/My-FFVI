import { checkpointKeys } from "./checkpoint-validation.js";

export type FieldChoiceAnchor = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "bottom-center";
export type FieldChoiceOption = { key: string; text: string };
/** Source Select keeps its current ordinary message until completion. The
 * compiler binds retainMessage from the next raw mnemonic, not the decoded
 * opcode (which may itself be blocked). */
export type FieldChoiceOp = {
  kind: "choice";
  options: FieldChoiceOption[];
  initialIndex: number;
  cancelIndex: number | null;
  anchor: FieldChoiceAnchor;
  presentation: "yes-no" | "multiple";
  retainMessage: boolean;
};
export type FieldChoiceRequest = Readonly<{
  /** Ephemeral FieldGame-instance identity. Never serialized into a save. */
  id: string;
  task: number;
  options: readonly Readonly<FieldChoiceOption>[];
  initialIndex: number;
  cancelIndex: number | null;
  anchor: FieldChoiceAnchor;
  presentation: "yes-no" | "multiple";
}>;
export type FieldChoiceAnswer = number | "cancel";

export function validateFieldChoice(op: FieldChoiceOp): void {
  if (op.kind !== "choice" || !Array.isArray(op.options) || op.options.length < 2 || op.options.length > 6 ||
      !["yes-no", "multiple"].includes(op.presentation) ||
      !["top-left", "top-right", "bottom-left", "bottom-right", "bottom-center"].includes(op.anchor) ||
      typeof op.retainMessage !== "boolean" ||
      !Number.isInteger(op.initialIndex) || op.initialIndex < 0 || op.initialIndex >= op.options.length ||
      op.cancelIndex !== null)
    throw new Error("Invalid ordinary field choice");
  if (op.presentation === "yes-no" && (op.options.length !== 2 || op.anchor === "bottom-center"))
    throw new Error("Yes/no field choice requires two source options");
  if (op.presentation === "multiple" && (op.anchor !== "bottom-center" || op.initialIndex !== 0))
    throw new Error("Multiple field choices require the source fixed anchor");
  for (const option of op.options) {
    checkpointKeys(option, "key,text");
    if (typeof option.key !== "string" || !option.key || typeof option.text !== "string" || !option.text)
      throw new Error("Missing field choice option text or source key");
  }
}

/** Detached, immutable presentation data. This projection cannot own or write
 * the event selection register; only FieldGame accepts the matching request. */
export function createFieldChoiceRequest(op: FieldChoiceOp, id: string, task: number): FieldChoiceRequest {
  validateFieldChoice(op);
  if (typeof id !== "string" || !id || !Number.isSafeInteger(task) || task < 1)
    throw new Error("Invalid field choice owner");
  return Object.freeze({ id, task, options: Object.freeze(op.options.map(option => Object.freeze({ ...option }))),
    initialIndex: op.initialIndex, cancelIndex: op.cancelIndex, anchor: op.anchor, presentation: op.presentation });
}

/** Initial highlight is never an answer. The admitted native yes/no and
 * multiple-choice controllers do not dispatch the Cancel input. */
export function resolveFieldChoiceAnswer(request: FieldChoiceRequest, answer: FieldChoiceAnswer): number | null {
  const index = answer === "cancel" ? request.cancelIndex : answer;
  return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < request.options.length ? index : null;
}
