import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { GameSession } from "../src/core/game-session.js";
import { sourceQualifiedBattleFixture } from "./fixtures/battle-abilities.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const requirements = () => ({ qualification: "source" as const,
  conditionContext: "current" as const, forbiddenConditionTypes: [607] });

test("ordinary templates cannot enter a static or unknown-condition battle and cannot masquerade as Magitek", () => {
  for (const kind of ["static", "unknown", "special"] as const) {
    const content = sourceQualifiedBattleFixture();
    content.players[0]!.battleRequirements = requirements();
    if (kind === "static") content.qualificationContext!.mode = "development-static";
    else if (kind === "unknown") content.qualificationContext!.conditionContext = "unknown";
    else {
      content.conditions.rules.definitions.push({ id: 53, type: 607, overlapped: false, eraseGroupId: 3 });
      content.players[0]!.conditionIds = [53];
    }
    assert.throws(() => new BattleGame(content, 1), /上下文|特殊战斗外观/);
  }
  const content = sourceQualifiedBattleFixture();
  content.players.forEach((p) => { p.battleRequirements = requirements(); });
  const game = new BattleGame(content, 1);
  assert.ok(game.commandQualification("a"));
  assert.deepEqual(content.players[0]!.commands, []);
});

test("session rejects unmet template entry before borrowing inventory or publishing a battle", () => {
  const { field, battle } = checkpointFixture();
  battle.gameState.battleDefinitions = structuredClone(battle.common.players);
  battle.gameState.battleDefinitions[1]!.battleRequirements = requirements();
  const session = new GameSession(field, battle);
  const before = session.state.snapshot();
  session.field.startEvent("fight");
  const request = session.field.stop;
  session.advance(10);
  assert.equal(session.battle, null);
  assert.equal(session.field.stop, request);
  assert.equal(session.field.stop!.kind, "encounter");
  assert.match(session.encounterPreparationError!, /来源战斗入口/);
  assert.deepEqual(session.state.snapshot(), before);
  // A leaked lease would reject an otherwise valid field transaction.
  session.state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  assert.equal(session.state.snapshot().gil, before.gil + 1);
});
