/** Source-bound effects of one completed foot-monitor pass. The state owner
 * supplies confirmed parameters and the moving party; this module owns no HP,
 * movement counter, elapsed time, renderer, or save state. */
export type FieldConditionCatalog = {
  definitions: { id: number; type: number }[];
  behaviors: (
    | { id: number; kind: "none" }
    | { id: number; kind: "poison"; hpDivisor: number; soundId: number }
  )[];
  dying: { conditionId: number; thresholdDivisor: number };
  transportations: { id: number; type: number }[];
};

export type FieldConditionMember = {
  id: string;
  hp: number;
  maxHp: number;
  conditionIds: readonly number[];
};

export type FieldConditionProjection = {
  members: { id: string; hp: number; maxHp: number; conditionIds: number[] }[];
  damage: {
    id: string;
    requested: number;
    actual: number;
    hpBefore: number;
    hpAfter: number;
  }[];
  /** CheckCondition selects the last positive field SE, including zero-damage
   * and already-dead members. Presentation never applies the damage again. */
  soundId: number | null;
};

/** GameState implements this transaction port. Prepare captures the moving
 * party at move start; a successful completion commits exactly once before
 * cell events run. The owner rejects stale/repeated commits. This admitted
 * path requires the captured owned state to remain unchanged during movement;
 * native concurrent changes need separate snapshot/live-HP reconciliation. */
export type FieldConditionPort = {
  prepareStep(transportationId: number): {
    result: FieldConditionProjection;
    commit(): void;
  };
};

function integer(value: number, minimum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error("Invalid field condition " + label);
}

export class FieldConditions {
  private readonly definitions = new Map<number, number>();
  private readonly behaviors = new Map<
    number,
    FieldConditionCatalog["behaviors"][number]
  >();
  private readonly transportations = new Map<number, number>();
  private readonly dying;

  constructor(catalog: FieldConditionCatalog) {
    for (const d of catalog.definitions) {
      integer(d.id, 1, "identity");
      integer(d.type, 0, "type");
      if (this.definitions.has(d.id))
        throw new Error("Duplicate field condition identity");
      this.definitions.set(d.id, d.type);
    }
    for (const b of catalog.behaviors) {
      if (!this.definitions.has(b.id) || this.behaviors.has(b.id))
        throw new Error("Invalid field condition behavior identity");
      if (b.kind === "poison") {
        if (this.definitions.get(b.id) !== 10)
          throw new Error("Invalid field poison condition type");
        integer(b.hpDivisor, 1, "poison divisor");
        integer(b.soundId, 0, "sound identity");
      } else if (
        b.kind !== "none" ||
        ![4, 5, 6, 607].includes(this.definitions.get(b.id)!)
      )
        throw new Error("Unsupported field condition behavior");
      this.behaviors.set(b.id, { ...b });
    }
    this.dying = { ...catalog.dying };
    integer(this.dying.thresholdDivisor, 1, "dying divisor");
    if (
      this.definitions.get(this.dying.conditionId) !== 4 ||
      this.behaviors.get(this.dying.conditionId)?.kind !== "none"
    )
      throw new Error("Missing field dying condition dependency");
    for (const t of catalog.transportations) {
      integer(t.id, 1, "transportation identity");
      integer(t.type, 1, "transportation type");
      if (this.transportations.has(t.id))
        throw new Error("Duplicate field transportation identity");
      this.transportations.set(t.id, t.type);
    }
  }

  validateActive(conditionIds: readonly number[]): void {
    if (!Array.isArray(conditionIds))
      throw new Error("Invalid field condition list");
    for (const id of conditionIds) {
      if (!this.definitions.has(id))
        throw new Error("Unknown field condition identity: " + id);
      if (!this.behaviors.has(id))
        throw new Error("Unimplemented active field condition: " + id);
    }
  }

  transportationType(id: number): number {
    const type = this.transportations.get(id);
    if (type === undefined)
      throw new Error("Unknown field transportation identity: " + id);
    return type;
  }

  /** MoveEndAction 0x7da810 runs the condition monitor only for transportation
   * type 1. Its step counter and encounter flags do not gate condition damage.
   * Caller must wait for transport transitions and a successful cell finish. */
  projectStep(
    members: readonly FieldConditionMember[],
    transportationId: number,
  ): FieldConditionProjection {
    const type = this.transportationType(transportationId);
    const identities = new Set<string>();
    const result: FieldConditionProjection = {
      members: members.map((member) => {
        if (!member.id || identities.has(member.id))
          throw new Error("Invalid or duplicate field party member");
        identities.add(member.id);
        integer(member.maxHp, 1, "maximum HP");
        integer(member.hp, 0, "HP");
        if (member.hp > member.maxHp)
          throw new Error("Field HP exceeds confirmed maximum");
        this.validateActive(member.conditionIds);
        return { ...member, conditionIds: [...member.conditionIds] };
      }),
      damage: [],
      soundId: null,
    };
    if (type !== 1) return result;

    for (const member of result.members) {
      let requested = 0;
      for (const id of member.conditionIds) {
        const behavior = this.behaviors.get(id)!;
        if (behavior.kind !== "poison") continue;
        // GetPoisonDamageValue 0x407ff0 uses signed integer division. It does
        // not use battle rate_value1, elemental affinities, or a minimum of 1.
        requested += Math.trunc(member.maxHp / behavior.hpDivisor);
        integer(requested, 0, "damage sum");
        if (behavior.soundId > 0) result.soundId = behavior.soundId;
      }
      // GiveDamageToPartyCharacter 0x9e37e0 does not call SubtractionHp for 0.
      if (requested === 0) continue;
      const hpBefore = member.hp;
      if (hpBefore > 0) {
        // FootMonitoring 0x7da740 passes allowZero=false. SubtractionHp
        // 0x337810 leaves dead members unchanged and surviving members >=1.
        member.hp = Math.max(1, hpBefore - requested);
        const nearDeath = Math.fround(
          Math.fround(member.maxHp) *
            Math.fround(1 / Math.fround(this.dying.thresholdDivisor)),
        );
        if (
          Math.fround(member.hp) <= nearDeath &&
          !member.conditionIds.includes(this.dying.conditionId)
        )
          // OwnedCharacterClient.AddCondition 0x326060 checks Contains and
          // appends. It does not run battle conflicts or remove stale dying.
          member.conditionIds.push(this.dying.conditionId);
      }
      result.damage.push({
        id: member.id,
        requested,
        actual: hpBefore - member.hp,
        hpBefore,
        hpAfter: member.hp,
      });
    }
    return result;
  }
}
