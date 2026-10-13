import type { BattleContent } from "../../src/core/battle-content.js";
import type { BattleEventOp, BattleEventProgram } from "../../src/core/battle-event.js";
import { enemyBattleDefinition, type BattleParticipantRewardScope } from "../../src/core/battle-participants.js";
import { fixture } from "./battle-content.js";
import { checkpointFixture } from "./checkpoint-game.js";

/** Explicitly authored, redistributable framework inputs; no source encounter
 * or story script is represented by these synthetic definitions. */
export function participantProgram(ops: BattleEventOp[]): BattleEventProgram {
  return { kind: "battle-event-v1", source: null, entry: 0, end: ops.length,
    localNames: ["AI"], initialLocals: [0], blockers: [],
    instructions: ops.map(op => ({ mnemonic: op.kind, op: structuredClone(op) })) };
}
export function participantLoop(ops: BattleEventOp[] = []): BattleEventProgram {
  const prefix: BattleEventOp[] = [{ kind: "exec-ai" }, { kind: "blank" }, ...ops];
  const loop = prefix.length;
  return participantProgram([...prefix, { kind: "nop" }, { kind: "blank" }, { kind: "sync-ai" },
    { kind: "branch", index: 0, operator: "＝", right: { kind: "immediate", value: 0 }, target: loop },
    { kind: "sync-action" }, { kind: "exit" }]);
}
export function participantFixture(
  ops: BattleEventOp[] = [{ kind: "add-enemy", monsterId: 341, uniqueId: 2 },
    { kind: "add-enemy", monsterId: 72, uniqueId: 9 }],
  rewardScope: BattleParticipantRewardScope = "active-units",
): BattleContent {
  const c = fixture();
  c.enemies.forEach((unit, index) => {
    unit.sourceId = 2000 + index;
    unit.placement = { x: index * 30, y: 0, group: 1 };
  });
  const template = enemyBattleDefinition(c.enemies[0]!);
  c.participants = { kind: "battle-participant-content-v1", profile: "web-unique-id-slots-v1", rewardScope,
    enemyDefinitions: {
      2000: template, 2001: enemyBattleDefinition(c.enemies[1]!),
      ...Object.fromEntries([341, 342, 72, 46].map(sourceId => [sourceId,
        { ...structuredClone(template), sourceId, name: "Synthetic reserve " + sourceId, exp: 11, gil: 13 }])),
    },
    slots: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index + 1,
      { x: index * 15, y: 0, group: 1 }])),
    initial: [{ id: "e1", sourceId: 2000, uniqueId: 2 }, { id: "e2", sourceId: 2001, uniqueId: 8 }],
  };
  c.participants.slots[2] = { ...c.enemies[0]!.placement! };
  c.participants.slots[8] = { ...c.enemies[1]!.placement! };
  c.battleEvents = { conditions: c.conditions.rules.definitions.map(({ id, type }) =>
    ({ id, type, attackTarget: type === 5 ? 1 : 0, gameOverTarget: type === 5 ? 1 : 0 })) };
  c.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 1, program: participantLoop(ops) };
  return c;
}
export function participantSessionFixture(ops?: BattleEventOp[], rewardScope?: BattleParticipantRewardScope) {
  const f = checkpointFixture(), c = participantFixture(ops, rewardScope);
  f.battle.common.battleEvents = c.battleEvents!;
  f.battle.encounters[1000]!.enemies = c.enemies;
  f.battle.encounters[1000]!.participants = c.participants!;
  f.battle.encounters[1000]!.lifecycle = c.lifecycle!;
  return f;
}
