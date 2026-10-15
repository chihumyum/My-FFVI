import { EventState, validVariable, type VariableRef } from "./event-state.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { canonical } from "./canonical.js";
export const WEB_SOURCE_SCRIPT_RANDOM = "web-source-script-random-field-stream-v1" as const;
export type WebSourceScriptRandom = typeof WEB_SOURCE_SCRIPT_RANDOM;
export type FieldScriptRandomCommand = { target: VariableRef; upperInclusive: number };
export type FieldScriptRandomOp = { kind: "script-random"; command: FieldScriptRandomCommand };
export type FieldScriptRandomPort = { prepare(upperInclusive: number): {
  readonly value: number; validate(): void; commitWith(publish: () => void): void;
} };
export function validateScriptRandomUpper(value: number): void {
  // The source adds one in int32 before Range(1, upper+1). Overflow, swapped
  // bounds and non-positive ranges are not part of the observed source domain.
  if (!Number.isInteger(value) || value < 1 || value >= 0x7fffffff)
    throw new Error("Unsupported source script random upper bound");
}
export function validateScriptRandomCommand(command: FieldScriptRandomCommand): void {
  checkpointKeys(command, "target,upperInclusive"); checkpointKeys(command.target, "category,index");
  if (!["MapLocalVariable", "AreaLocalVariable"].includes(command.target.category) || !validVariable(command.target))
    throw new Error("Unsupported source script random destination bank");
  validateScriptRandomUpper(command.upperInclusive);
}
/** Existing EventState is the destination owner; existing GameState.fieldRandom
 * supplies the transaction. Failure leaves both owners unchanged. This explicit
 * Web failure policy differs from the native draw-before-lookup error path. */
export function executeFieldScriptRandom(command: FieldScriptRandomCommand, events: EventState,
  port: FieldScriptRandomPort | undefined, beforePublish: () => void = () => {}): number {
  validateScriptRandomCommand(command);
  if (!port) throw new Error("Source script random requires the explicit Web field-random owner");
  const boundCommand = canonical(command), target = structuredClone(command.target), upper = command.upperInclusive;
  const before = canonical(events.snapshot());
  // Validate destination before asking for even a private random candidate.
  new EventState(events.snapshot()).write(target, 1);
  const prepared = port.prepare(upper), value = prepared.value;
  if (!Number.isInteger(value) || value < 1 || value > upper)
    throw new Error("Source script random provider returned an invalid value");
  new EventState(events.snapshot()).write(target, value);
  prepared.validate();
  prepared.commitWith(() => {
    beforePublish();
    if (canonical(command) !== boundCommand) throw new Error("Stale source script random instruction");
    if (canonical(events.snapshot()) !== before) throw new Error("Stale source script random destination");
    events.write(target, value);
  });
  return value;
}
