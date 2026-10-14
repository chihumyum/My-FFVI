/** Source dispatch data. The action host owns queues, payments, condition
 * lifecycle, observations and transactional RNG; these helpers publish none. */
export type DerivedActionCalcResult = { hitType: 0; value: 0 };
export type RandomAbilityDispatchPlan = {
  kind: "random-ability";
  slot: number;
  rawValues: [number, number, 0 | 1];
  groupId: number;
  fallbackAbilityId: number;
  retarget: boolean;
  rows: {
    rowId: number;
    abilityId: number;
    invocationRate: number;
    conditionGroupId: number;
    conditionIds: number[];
  }[];
  primaryResult: DerivedActionCalcResult;
  child: {
    actType: 5;
    useType: 1;
    commandId: null;
    armType: 0;
    actAbilityType: 0;
    continuousCommandCount: 1;
    isCounter: false;
  };
};
export type ForcedEscapeDispatchPlan = {
  kind: "forced-escape";
  slot: number;
  rawValues: [2, 0, 0];
  actorDomain: "enemy";
  target: "self";
  conditionId: number;
  conditionType: 3;
  primaryResult: DerivedActionCalcResult;
};
export type BattleDerivedActionPlan = RandomAbilityDispatchPlan | ForcedEscapeDispatchPlan;

const int32 = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0x7fffffff;
const positive = (value: number) => int32(value) && value > 0;
const slot = (value: number) => Number.isInteger(value) && value >= 1 && value <= 3;
function validateResult(value: DerivedActionCalcResult) {
  if (!value || value.hitType !== 0 || value.value !== 0)
    throw new Error("Invalid derived-action primary calculation");
}

export function validateRandomAbilityDispatch(plan: RandomAbilityDispatchPlan): void {
  if (plan.kind !== "random-ability" || !slot(plan.slot) || !positive(plan.groupId) ||
      !int32(plan.fallbackAbilityId) || !Array.isArray(plan.rawValues) || plan.rawValues.length !== 3 ||
      plan.rawValues[0] !== plan.groupId || plan.rawValues[1] !== plan.fallbackAbilityId ||
      ![0, 1].includes(plan.rawValues[2]) || plan.retarget !== (plan.rawValues[2] === 1) ||
      !Array.isArray(plan.rows) || !plan.rows.length)
    throw new Error("Invalid random-ability dispatch binding");
  const ids = new Set<number>();
  let total = 0;
  for (const row of plan.rows) {
    if (!row || !positive(row.rowId) || ids.has(row.rowId) || !positive(row.abilityId) ||
        !int32(row.invocationRate) || !int32(row.conditionGroupId) ||
        !Array.isArray(row.conditionIds) || row.conditionIds.some(id => !positive(id)) ||
        row.conditionGroupId === 0 && row.conditionIds.length !== 0)
      throw new Error("Invalid random-ability source row");
    ids.add(row.rowId);
    total += row.invocationRate;
    if (total > 0x7fffffff) throw new Error("Random-ability weight total exceeds int32");
  }
  if (total === 0) throw new Error("Random-ability weights have no positive total");
  validateResult(plan.primaryResult);
  const child = plan.child;
  if (!child || child.actType !== 5 || child.useType !== 1 || child.commandId !== null ||
      child.armType !== 0 || child.actAbilityType !== 0 || child.continuousCommandCount !== 1 ||
      child.isCounter !== false)
    throw new Error("Invalid random-ability child action context");
}

/** 981000 preserves duplicate rows and source order; 389880 draws [0,total).
 * The Web host supplies its existing inclusive integer generator. Every
 * possible child is admitted before drawing, including a zero-weight row.
 * Conditional tables and fallback/carrier branches remain explicit gaps. */
export function proposeRandomAbilityDispatch(
  plan: RandomAbilityDispatchPlan,
  readyAbilityIds: readonly number[],
  randomInt: (min: number, max: number) => number,
) {
  validateRandomAbilityDispatch(plan);
  if (plan.fallbackAbilityId !== 0)
    throw new Error("Unresolved random-ability fallback dispatch");
  if (plan.rows.some(row => row.conditionGroupId !== 0))
    throw new Error("Unresolved random-ability condition-group selection");
  if (!Array.isArray(readyAbilityIds) || readyAbilityIds.some(id => !positive(id)) ||
      new Set(readyAbilityIds).size !== readyAbilityIds.length ||
      plan.rows.some(row => !readyAbilityIds.includes(row.abilityId)))
    throw new Error("Random-ability child dependency is unavailable");
  const total = plan.rows.reduce((sum, row) => sum + row.invocationRate, 0);
  let weight = randomInt(0, total - 1);
  if (!Number.isInteger(weight) || weight < 0 || weight >= total)
    throw new Error("Invalid random-ability random value");
  for (const row of plan.rows) {
    weight -= row.invocationRate;
    if (weight < 0) return {
      rowId: row.rowId,
      abilityId: row.abilityId,
      primaryResult: { ...plan.primaryResult },
      child: { ...plan.child },
    };
  }
  throw new Error("Invalid random-ability weight selection");
}

export function validateForcedEscapeDispatch(plan: ForcedEscapeDispatchPlan): void {
  if (plan.kind !== "forced-escape" || !slot(plan.slot) || !Array.isArray(plan.rawValues) ||
      plan.rawValues.length !== 3 || plan.rawValues[0] !== 2 || plan.rawValues[1] !== 0 ||
      plan.rawValues[2] !== 0 || plan.actorDomain !== "enemy" || plan.target !== "self" ||
      !positive(plan.conditionId) || plan.conditionType !== 3)
    throw new Error("Invalid forced-escape dispatch binding");
  validateResult(plan.primaryResult);
}

/** 4fafd0 enemy Value1==2 succeeds without a lottery or not_escape check.
 * 4fa0a0 ordinary self escape adds condition type3. HP is unchanged; reward
 * registration, removals and battle judgment remain with the action host. */
export function proposeForcedEscape(
  plan: ForcedEscapeDispatchPlan,
  input: { actorId: string; actorSide: "player" | "enemy"; targetIds: readonly string[] },
) {
  validateForcedEscapeDispatch(plan);
  if (input.actorSide !== "enemy" || typeof input.actorId !== "string" || !input.actorId ||
      !Array.isArray(input.targetIds) || input.targetIds.length !== 1 || input.targetIds[0] !== input.actorId)
    throw new Error("Unresolved forced-escape actor or target domain");
  return { unitId: input.actorId, conditionId: plan.conditionId,
    conditionType: plan.conditionType, primaryResult: { ...plan.primaryResult } };
}
