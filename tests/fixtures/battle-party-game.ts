import type { BattleEventOp } from "../../src/core/battle-event.js";
import type { BattleParticipantRewardScope } from "../../src/core/battle-participants.js";
import { participantFixture, participantProgram } from "./battle-participant-game.js";
import { checkpointFixture } from "./checkpoint-game.js";

export function enemyPartyProgram(ops: BattleEventOp[]) {
  const prefix: BattleEventOp[] = [{ kind: "exec-ai" }, { kind: "blank" }, ...ops];
  const loop = prefix.length;
  const p = participantProgram([...prefix, { kind: "nop" }, { kind: "blank" }, { kind: "sync-ai" },
    { kind: "branch", index: 0, operator: "＝", right: { kind: "immediate", value: 0 }, target: loop },
    { kind: "sync-action" }, { kind: "exit" }]);
  p.localNames.push("Stage"); p.initialLocals.push(0); return p;
}
export function allRoundsProgram() {
  const ops: BattleEventOp[] = [{ kind: "exec-ai" }];
  for (const partyId of [513, 514, 515, null]) {
    const loop = ops.length; ops.push({ kind: "nop" }, { kind: "blank" }, { kind: "sync-ai" },
      { kind: "branch", index: 0, operator: "＝", right: { kind: "immediate", value: 0 }, target: loop },
      { kind: "sync-action" });
    if (partyId !== null) ops.push({ kind: "change-enemy-party", partyId, hidden: partyId === 515 },
      { kind: "calc", index: 1, operator: "＋", right: { kind: "immediate", value: 1 } });
  }
  ops.push({ kind: "exit" });
  const p = participantProgram(ops); p.localNames.push("Stage"); p.initialLocals.push(0); return p;
}
/** IDs name the native selector operands; definitions/layouts are explicitly
 * synthetic and must not count as source parties 513/514/515 being playable. */
export function enemyPartyFixture(ops: BattleEventOp[] = [{ kind: "change-enemy-party", partyId: 513, hidden: false }],
  rewardScope: BattleParticipantRewardScope = "active-units") {
  const c = participantFixture([], rewardScope), slots = c.participants!.slots;
  c.participants!.enemyParties = {
    513: { members: [{ sourceId: 341, uniqueId: 1 }, { sourceId: 341, uniqueId: 9 }],
      slots: { ...structuredClone(slots), 2: { x: 222, y: -11, group: 2 } } },
    514: { members: [{ sourceId: 72, uniqueId: 4 }], slots: structuredClone(slots) },
    515: { members: [{ sourceId: 46, uniqueId: 7 }], slots: structuredClone(slots) },
  };
  c.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 1, program: enemyPartyProgram(ops) };
  return c;
}
export function enemyPartySessionFixture(rewardScope: BattleParticipantRewardScope = "all-entered") {
  const f = checkpointFixture(), c = enemyPartyFixture([], rewardScope);
  f.battle.common.battleEvents = c.battleEvents!;
  f.battle.encounters[1000]!.enemies = c.enemies;
  f.battle.encounters[1000]!.participants = c.participants!;
  f.battle.encounters[1000]!.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 1, program: allRoundsProgram() };
  return f;
}
