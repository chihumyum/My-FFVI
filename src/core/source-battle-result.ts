import type { GameStateSnapshot } from "./game-state.js";
import { EventState } from "./event-state.js";
import { canonical } from "./canonical.js";
export const WEB_COMMITTED_BATTLE_RESULT = "web-committed-battle-result-v1" as const;
export type WebCommittedBattleResult = typeof WEB_COMMITTED_BATTLE_RESULT;
/** Only outcomes actually produced and committed by the current session.
 * Native Lose/Forced/Restart/ForcedOnSave are not fabricated from HP. */
export type CommittedBattleResultValue = 0 | 1 | 3;
export type FieldBattleResultPort = { readonly policy: WebCommittedBattleResult; prepare(): {
  readonly value: CommittedBattleResultValue;
  readonly receipt: GameStateSnapshot["completedBattles"][number] | null;
  validate(): void;
} };
/** The caller supplies the existing validated GameState snapshot and Session
 * serial. This is not a save parser or an arbitrary terminal-value setter. */
export function projectCommittedBattleResult(owned: GameStateSnapshot, encounterSerial: number): {
  value: CommittedBattleResultValue; receipt: GameStateSnapshot["completedBattles"][number] | null;
} {
  if (!Number.isSafeInteger(encounterSerial) || encounterSerial < 0 ||
      owned.completedBattles.length !== encounterSerial)
    throw new Error("Committed battle result identity disagrees with the session");
  const receipt = owned.completedBattles.at(-1);
  if (receipt === undefined) {
    if (owned.initialization !== "source-new-game") throw new Error("Fresh native result context is unavailable");
    return { value: 0, receipt: null };
  }
  if (receipt.serial !== encounterSerial - 1 || !Number.isInteger(receipt.encounterId) || receipt.encounterId <= 0 ||
      receipt.outcome !== "victory" && receipt.outcome !== "escaped")
    throw new Error("Unimplemented or invalid committed battle result producer");
  return { value: receipt.outcome === "victory" ? 1 : 3, receipt: structuredClone(receipt) };
}
export function executeCommittedBattleResult(events: EventState, port: FieldBattleResultPort | undefined,
  beforePublish: () => void): CommittedBattleResultValue {
  if (!port || port.policy !== WEB_COMMITTED_BATTLE_RESULT) throw new Error("Committed battle result host is unavailable");
  const target = { category: "ScriptLocalVariable", index: 0 } as const,
    revision = events.mutationRevision, before = canonical(events.snapshot());
  // Existing script frame only: write must not create a local bank.
  new EventState(events.snapshot()).write(target, 0);
  const prepared = port.prepare(), value = prepared.value;
  if (![0, 1, 3].includes(value) || typeof prepared.validate !== "function" ||
      value === 0 && prepared.receipt !== null || value !== 0 && (prepared.receipt === null ||
        prepared.receipt.outcome !== (value === 1 ? 'victory' : 'escaped') || !Number.isSafeInteger(prepared.receipt.serial) ||
        prepared.receipt.serial < 0 || !Number.isSafeInteger(prepared.receipt.encounterId) || prepared.receipt.encounterId <= 0))
    throw new Error("Unimplemented committed battle result value");
  beforePublish(); prepared.validate();
  if (events.mutationRevision !== revision || canonical(events.snapshot()) !== before)
    throw new Error("Stale committed battle result script frame");
  // No external calls or fallible work remain after the final producer fence.
  events.write(target, value);
  return value;
}
