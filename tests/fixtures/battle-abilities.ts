import type { BattleAbilityCatalog, BattleAbilityContext, BattleAbilityMember } from "../../src/core/battle-abilities.js";
import { fixture } from "./battle-content.js";

/** Authored mechanism fixture, not redistributed original-game tables. */
export function battleAbilityFixture() {
  const command = (id: number, values: Partial<BattleAbilityCatalog["commands"][number]> = {}) => ({
    id, nameKey: "SYNTHETIC_COMMAND_" + id, type: 1, listType: 0, executionType: 1,
    abilityId: 13, contentId: 2000 + id, abilityTypes: [], releaseType: 0,
    releaseValues: [0, 0] as [number, number], forbiddenConditionIds: [], blockers: [], ...values,
  });
  const catalog: BattleAbilityCatalog = {
    kind: "battle-abilities-v1",
    characters: [{ sourceId: 1000, jobId: 12, blockers: [] }, { sourceId: 1001, jobId: 12, blockers: [] }],
    commands: [
      command(1, { releaseType: 5, releaseValues: [53, 78] }),
      command(7, { executionType: 2, listType: 2, abilityId: 0, abilityTypes: [1], forbiddenConditionIds: [306] }),
      command(26, { executionType: 2, listType: 3, abilityId: 0, abilityTypes: [604], releaseType: 3, releaseValues: [53, 0] }),
      command(3, { executionType: 2, listType: 1, abilityId: 0 }),
      command(2, { type: 2 }), command(4, { type: 5 }), command(5, { type: 2 }),
      command(30, { type: 6, releaseType: 3, releaseValues: [53, 0] }),
      command(8), command(90, { executionType: 2, listType: 3, abilityId: 0, abilityTypes: [601] }),
    ],
    abilities: [
      { id: 10, typeId: 1, groupId: 4, range: 3 },
      { id: 11, typeId: 1, groupId: 4, range: 1 },
      { id: 12, typeId: 1, groupId: 4, range: 3 },
      { id: 13, typeId: 4, groupId: 0, range: 7 },
      { id: 20, typeId: 604, groupId: 8, range: 3 },
      { id: 21, typeId: 604, groupId: 8, range: 3 },
      { id: 22, typeId: 1, groupId: 0, range: 3 },
    ],
    conditions: [{ id: 53, type: 607 }, { id: 78, type: 670 }, { id: 607, type: 700 },
      { id: 305, type: 5 }, { id: 304, type: 4 }, { id: 306, type: 6 }, { id: 501, type: 501 }],
  };
  const member: BattleAbilityMember = {
    sourceId: 1000, jobId: 12, magicStoneId: 0,
    abilities: {
      commandIds: [7, 26, 1, 3, 2, 4, 5, 30],
      owned: [{ abilityId: 10, contentId: 1010, skillLevel: 100 },
        { abilityId: 11, contentId: 1011, skillLevel: 99 },
        { abilityId: 12, contentId: 1012, skillLevel: 100 },
        { abilityId: 20, contentId: 1020, skillLevel: 100 },
        { abilityId: 21, contentId: 1021, skillLevel: 0 },
        { abilityId: 22, contentId: 1022, skillLevel: 100 }],
      byCommand: [{ commandId: 7, abilityIds: [10, 12] }],
      additionOrder: [], sortOrder: [],
      slots: Array.from({ length: 8 }, (_, i) => ({ level: i + 1, abilityIds: [null, null, null] })),
      skillLevelTargets: {}, learning: [], equipment: [0, 0, 0],
    },
  };
  const context: BattleAbilityContext = { conditionIds: [], battleType: 0, magicLearningValue: null,
    invalidContentIds: [], itemMenuAvailable: true, partySize: 2 };
  return { catalog, member, context };
}

export function sourceQualifiedBattleFixture() {
  const { catalog, member, context } = battleAbilityFixture();
  const content = fixture();
  content.battleAbilities = catalog;
  const { conditionIds: _conditions, partySize: _size, ...host } = context;
  content.qualificationContext = { ...host, mode: "source", conditionContext: "current" };
  for (const player of content.players) {
    player.ownedAbilities = { ...structuredClone(member), sourceId: player.sourceId };
    // Deliberately stale development lists: neither grants nor denies ownership.
    player.abilities = [11];
    player.commands = [];
  }
  for (const command of catalog.commands) content.commands[command.id] = {
    id: command.id, name: command.nameKey, kind: command.executionType === 2 && command.listType === 1 ? "item" : "ability",
    abilityIds: [], forbiddenConditionIds: command.forbiddenConditionIds, referencedAbility: null,
  };
  content.conditions.rules.definitions.push({ id: 306, type: 6, overlapped: false, eraseGroupId: 3 });
  content.conditions.behaviors.push({ id: 306, kind: "silence", name: "Synthetic silence", untilType: 2 });
  return content;
}
