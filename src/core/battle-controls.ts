import { sourceBossDataKeys } from "./source-boss-encounter.js";
export const WEB_MANUAL_BATTLE_CONTROLS = "web-manual-battle-controls-v1" as const;
/** Prepared Web controls commit source UI requests on the existing battle
 * frame. Native Unity coroutine ordering and automatic actions stay deferred. */
export const WEB_BATTLE_EVENT_CONTROLS = "web-source-battle-event-controls-v1" as const;
export type WebBattleEventControls = typeof WEB_BATTLE_EVENT_CONTROLS;
export function validateBattleEventControls(value: unknown): void {
  if (value !== undefined && value !== WEB_BATTLE_EVENT_CONTROLS)
    throw new Error("Unknown battle event control policy");
}
export type SourceBattleControls = {
  kind: "source-battle-controls-v1";
  policy: typeof WEB_MANUAL_BATTLE_CONTROLS;
  initialMode: "manual";
  /** Exact implemented source effect: StartInit flag19 -> SetIsAuto(false).
   * This does not mean flag19 forbids a later native auto toggle. */
  offAutoBattle: true;
};
export function parseSourceBattleControls(raw: unknown): SourceBattleControls {
  sourceBossDataKeys(raw, "kind,policy,initialMode,offAutoBattle");
  if (raw.kind !== "source-battle-controls-v1" || raw.policy !== WEB_MANUAL_BATTLE_CONTROLS ||
      raw.initialMode !== "manual" || raw.offAutoBattle !== true)
    throw new Error("Unimplemented source battle control policy");
  return { kind: "source-battle-controls-v1", policy: WEB_MANUAL_BATTLE_CONTROLS,
    initialMode: "manual", offAutoBattle: true };
}
