/** The current-list part of ConditionUtility.Conflict (0x4d1000).
 * This is not status application: callers have already appended the incoming
 * master record. Hit/resistance, equipment, timers and behavior functions are
 * separate, currently unsupported stages. See docs/conditions.md.
 */
export type ConditionDefinition = {
  id: number;
  type: number;
  overlapped: boolean;
  eraseGroupId: number;
};
export type ConditionEraseRule = {
  id: number;
  groupId: number;
  conditionId: number;
  type: number;
  eraseConditionId: number;
};
export type ConditionCatalog = {
  definitions: ConditionDefinition[];
  eraseRules: ConditionEraseRule[];
};
export type ConditionConflictInput = {
  /** Ordered master row IDs, with duplicates. Not condition types or flags. */
  currentIds: readonly number[];
  equipmentIds: readonly number[];
  incomingId: number;
};
export type ConditionConflictResult = {
  currentIds: number[];
  removed: {
    id: number;
    reason: "invalid" | "negate" | "duplicate" | "replace";
  }[];
  invalidated: boolean;
  negated: boolean;
};

function positiveId(id: number) {
  if (!Number.isInteger(id) || id <= 0 || id > 0x7fffffff)
    throw new Error("Invalid condition identity: " + id);
}
function conditionType(type: number) {
  if (!Number.isInteger(type) || type < 0 || type > 0x7fffffff)
    throw new Error("Invalid condition type: " + type);
}

/** Owns a copy of compiled master definitions, never active battle state. */
export class ConditionRules {
  private readonly definitions = new Map<number, ConditionDefinition>();
  private readonly groups = new Map<number, ConditionEraseRule[]>();

  constructor(catalog: ConditionCatalog) {
    for (const definition of catalog.definitions) {
      positiveId(definition.id);
      conditionType(definition.type);
      positiveId(definition.eraseGroupId);
      if (typeof definition.overlapped !== "boolean")
        throw new Error("Invalid condition overlap selector");
      if (this.definitions.has(definition.id))
        throw new Error("Duplicate condition identity: " + definition.id);
      this.definitions.set(definition.id, { ...definition });
    }
    const seen = new Set<number>();
    for (const rule of catalog.eraseRules) {
      positiveId(rule.id);
      positiveId(rule.groupId);
      if (seen.has(rule.id))
        throw new Error("Duplicate erase rule: " + rule.id);
      seen.add(rule.id);
      if (!Number.isInteger(rule.type) || rule.type < 1 || rule.type > 6)
        throw new Error("Unsupported condition erase type: " + rule.type);
      if (rule.conditionId !== 0) this.definition(rule.conditionId);
      if (rule.type >= 3) this.definition(rule.eraseConditionId);
      else if (rule.eraseConditionId !== 0)
        throw new Error("Unexpected erase target for type " + rule.type);
      const group = this.groups.get(rule.groupId) ?? [];
      group.push({ ...rule });
      this.groups.set(rule.groupId, group);
    }
    for (const definition of this.definitions.values())
      this.rules(definition.id);
  }

  private definition(id: number): ConditionDefinition {
    positiveId(id);
    const value = this.definitions.get(id);
    if (!value) throw new Error("Unresolved condition identity: " + id);
    return value;
  }

  private rules(id: number): readonly ConditionEraseRule[] {
    const groupId = this.definition(id).eraseGroupId;
    const rules = this.groups.get(groupId);
    if (!rules) throw new Error("Unresolved condition erase group: " + groupId);
    return rules;
  }

  /** A type query is derived from identities; it never rewrites stored IDs. */
  hasType(ids: readonly number[], type: number): boolean {
    conditionType(type);
    const types = ids.map((id) => this.definition(id).type);
    return types.includes(type);
  }

  /** CharacterParameterBase.IsAddable (0x4ac5f0) compares master identities. */
  isAddable(ids: readonly number[], incomingId: number): boolean {
    const current = ids.map((id) => this.definition(id).id);
    const incoming = this.definition(incomingId);
    return incoming.overlapped || !current.includes(incoming.id);
  }

  resolveConflict(input: ConditionConflictInput): ConditionConflictResult {
    // Reject the entire unsupported context before any list operation.
    const currentIds = input.currentIds.map((id) => this.definition(id).id);
    const incoming = this.definition(input.incomingId);
    if (input.equipmentIds.length)
      throw new Error("Equipment condition conflict remains unresolved");
    if (!currentIds.includes(incoming.id))
      throw new Error(
        "Condition conflict requires the already-appended identity",
      );
    const result: ConditionConflictResult = {
      currentIds,
      removed: [],
      invalidated: false,
      negated: false,
    };
    const removeOne = (
      id: number,
      reason: ConditionConflictResult["removed"][number]["reason"],
    ) => {
      const index = currentIds.indexOf(id);
      if (index < 0) return;
      currentIds.splice(index, 1);
      result.removed.push({ id, reason });
    };
    const removeAll = (
      id: number,
      reason: ConditionConflictResult["removed"][number]["reason"],
    ) => {
      while (currentIds.includes(id)) removeOne(id, reason);
    };

    // InvalidCondition: any existing record's type-6 rule rejects all current
    // copies of the incoming ID; no subsequent conflict stage runs.
    if (
      currentIds.some((id) =>
        this.rules(id).some(
          (r) => r.type === 6 && r.eraseConditionId === incoming.id,
        ),
      )
    ) {
      removeAll(incoming.id, "invalid");
      result.invalidated = true;
      return result;
    }

    // IsNegate excludes ONE copy of the incoming record, not every same-type
    // record. Negate removes one incoming copy, then all specified opponents.
    const rules = this.rules(incoming.id);
    const others = [...currentIds];
    others.splice(others.indexOf(incoming.id), 1);
    const negate = rules.filter((r) => r.type === 4);
    if (negate.some((r) => others.includes(r.eraseConditionId))) {
      removeOne(incoming.id, "negate");
      for (const rule of negate) removeAll(rule.eraseConditionId, "negate");
      result.negated = true;
    }

    if (!incoming.overlapped) {
      let count = currentIds.filter((id) => id === incoming.id).length;
      while (count-- > 1) removeOne(incoming.id, "duplicate");
    }

    // GetRemoveConditions preserves master-list order and rule multiplicity.
    // Types 2/4/6 add no replacement candidates here; 4 and 6 ran above.
    const candidates: number[] = [];
    const preserved: number[] = [];
    const appendAllExceptIncoming = () => {
      candidates.push(...this.definitions.keys());
      candidates.splice(candidates.indexOf(incoming.id), 1);
    };
    for (const rule of rules) {
      if (rule.type === 1) appendAllExceptIncoming();
      else if (rule.type === 3) {
        if (
          rule.eraseConditionId === incoming.id &&
          currentIds.filter((id) => id === incoming.id).length === 1
        )
          continue;
        candidates.push(rule.eraseConditionId);
      } else if (rule.type === 5) preserved.push(rule.eraseConditionId);
    }
    if (preserved.length) {
      appendAllExceptIncoming();
      for (const id of preserved) {
        const index = candidates.indexOf(id);
        if (index >= 0) candidates.splice(index, 1);
      }
    }
    for (const id of candidates) removeAll(id, "replace");
    return result;
  }
}
