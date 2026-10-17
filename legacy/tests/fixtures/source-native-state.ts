import { GameState, type GameStateContent } from "../../src/core/game-state.js";
import { createNewGame } from "../../src/core/new-game.js";
import { compileNewGame } from "../../src/compiler/new-game.js";
import { newGameFixture } from "./new-game.js";
import { fixture as battleFixture } from "./battle-content.js";
import { fixtureWeaponEffects } from "./equipment.js";
import { itemFixture } from "./items.js";

/** Bound synthetic source initialization with an intentionally unrelated route
 * and transport IDs. It does not represent a reachable original-game scene. */
export function sourceNativeStateFixture() {
  const input = newGameFixture();
  const definition = compileNewGame(input.reader(), input.tables, (name) => name, fixtureWeaponEffects()).definition;
  const plan = createNewGame(definition), member = plan.owned.roster[0]!;
  const template = definition.characters[0]!.template;
  const battle = battleFixture();
  battle.conditions.rules.definitions.push({ id: 9007, type: 607, overlapped: false, eraseGroupId: 4 });
  battle.conditions.rules.eraseRules.push({ id: 4, groupId: 4, conditionId: 9007, type: 2, eraseConditionId: 0 });
  battle.conditions.behaviors.push({ id: 9007, kind: "magitek", name: "", untilType: 3 });
  const player = { ...battle.players[0]!, ...template.confirmed,
    id: member.id, sourceId: member.sourceId, name: member.name,
    level: member.level, exp: member.exp, hp: member.hp, mp: member.mp,
    conditionIds: [9007],
  };
  const content: GameStateContent = {
    kind: "game-state-development-v1",
    limits: { ...definition.limits, hp: 9999, mp: 999, level: 99, exp: 15000000 },
    sourceNewGame: structuredClone(definition),
    initialGil: plan.owned.gil,
    initialParty: structuredClone(plan.owned.party),
    initialOwnedConditions: [{ id: member.id, conditionIds: [9007] }],
    characterInitializations: { [member.id]: structuredClone(template) },
    rosterLifecycle: {
      initial: { [member.id]: {
        ownedId: member.ownedId, jobId: member.jobId, additionalLevel: member.additionalLevel,
        magicStoneId: member.magicStoneId, ownedJobs: structuredClone(member.ownedJobs),
      } },
      releasedJobIds: [...plan.owned.releasedJobIds], jobIds: [1, 12],
    },
    items: { 701: itemFixture(701, true) }, initialItems: structuredClone(plan.owned.items),
    equipment: { [member.id]: [...member.equipment] },
    equipmentSystem: { catalog: structuredClone(definition.equipment), initialStock: structuredClone(plan.owned.equipmentStock),
      contexts: { [member.id]: structuredClone(template.parameterContext) }, limits: structuredClone(template.limits), growth: {} },
  };
  const conditions = battle.conditions;
  const hash = "synthetic-native-state";
  return { content, player, conditions, definition, plan,
    fresh: () => GameState.createNewGame(content, [player], hash, conditions),
    development: () => new GameState(content, [player], hash, conditions),
  };
}
