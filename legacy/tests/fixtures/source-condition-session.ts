import assert from "node:assert/strict";
import { sourceEncounterSessionFixture } from "./source-encounter-session.js";
import { sealBatchContent } from "./content-batch.js";
import { cyclingAI } from "./battle-ai.js";
import type { AbilityDefinition } from "../../src/core/battle-content.js";

/** Authored control clocks and commands on the existing real native actor /
 * NewGame owner fixture. These declarations precede every session launch and
 * are never counted as original enemy content or source story reachability. */
export function sourceConditionSessionFixture(conditionId: 7 | 12 | 70 | 14) {
  const f = sourceEncounterSessionFixture(), common = f.battle.common, owner = f.battle.gameState;
  common.initialAtb.player = [100, 100];
  common.conditionControlPolicy = { kind: "web-source-control-actions-v1" };
  common.playerConditionTraits = Object.fromEntries(common.players.map(player => [String(player.sourceId),
    { kind: "source-condition-traits-v1" as const, baseUndead: false }]));
  common.conditions.rules.definitions.push(
    { id: 7, type: 7, overlapped: false, eraseGroupId: 91 },
    { id: 12, type: 12, overlapped: false, eraseGroupId: 91 },
    { id: 70, type: 630, overlapped: false, eraseGroupId: 91 },
    { id: 14, type: 404, overlapped: false, eraseGroupId: 91 },
  );
  common.conditions.rules.eraseRules.push({ id: 91, groupId: 91, type: 2, conditionId: 0, eraseConditionId: 0 });
  common.conditions.behaviors.push(
    { id: 7, kind: "sleep", name: "", untilType: 9, untilValue: 1 },
    { id: 12, kind: "confusion", name: "", untilType: 8, untilValue: 1 },
    { id: 70, kind: "temptation", name: "", untilType: 17, untilValue: 0 },
    { id: 14, kind: "doom", name: "", untilType: 2, untilValue: 1, pauseConditionTypes: [17, 627, 11] },
  );
  common.battleAbilities!.conditions = common.conditions.rules.definitions.map(({ id, type }) => ({ id, type }));
  const direct = structuredClone(common.battleAbilities!.commands.find(command => command.id === 100)!);
  direct.id = 1; common.battleAbilities!.commands.push(direct);
  common.commands[1] = { ...structuredClone(common.commands[100]!), id: 1 };
  for (const player of common.players) player.commands.push(1);
  for (const row of owner.sourceNewGame!.characters) row.template.initial.abilities.commandIds.push(1);
  for (const template of Object.values(owner.characterInitializations!)) template.initial.abilities.commandIds.push(1);
  for (const plan of Object.values(owner.characterGrowth!)) {
    plan.initialAbilities.commandIds.push(1); plan.commands.push({ id: 1, abilityTypes: [] });
  }
  const control: AbilityDefinition = structuredClone(common.abilities[10]!);
  Object.assign(control, { id: 900, name: "Authored control " + conditionId, cost: 0, wait: 0, power: 0,
    conditionRecoveryHit: { kind: "source-condition-recovery-hit-v1", forAiType: 0, isMagic: false } });
  control.program.abilityId = 900; control.program.range = 3;
  control.plan = { effects: [{ slot: 1, kind: "add-condition", conditionId, fixedHit: true, accuracy: 255 }],
    targeting: { relation: "enemy", modes: ["single"], defaultMode: "single", defaultRelation: "enemy",
      normalFormationOnly: false, life: "alive" }, physical: null, magic: null };
  common.abilities[900] = control;
  for (const ability of Object.values(common.abilities)) ability.conditionRecoveryHit ??= {
    kind: "source-condition-recovery-hit-v1", forAiType: ability.plan?.physical ? 1 : 2, isMagic: Boolean(ability.plan?.magic),
  };
  for (const encounter of Object.values(f.battle.encounters)) for (const enemy of encounter.enemies) {
    enemy.abilities = [900]; enemy.ai = cyclingAI([900]);
    enemy.conditionTraits = { kind: "source-condition-traits-v1", baseUndead: false };
  }
  // The owner, initializer, catalog and map pins are all authored as one
  // pre-launch content graph; no live owner is changed to force a result.
  Object.assign(f.battle, sealBatchContent(f.battle));
  f.content.battleCatalogHash = f.battle.contentHash;
  Object.assign(f.content, sealBatchContent(f.content));
  assert.equal(f.battle.gameState.sourceNewGame!.characters.length, 2);
  return f;
}
