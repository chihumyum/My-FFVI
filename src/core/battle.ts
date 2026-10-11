import type { AbilityEffectResult } from "./ability.js";
import type { ParameterValues } from "./parameters.js";
import { atbIncrement } from "./atb.js";
import {
  initialEnemyBehavior,
  type EnemyBehaviorState,
} from "./enemy-behavior.js";
import {
  BattleAIError,
  selectBattleAIAbilities,
  planBattleAITurn,
  planBattleAIReaction,
  startBattleAI,
  type BattleAIState,
  type BattleAITurn,
} from "./battle-ai.js";
import { battleReaction, validateReactionRules } from "./battle-reactions.js";
import { projectActionTarget } from "./action-effects.js";
import {
  validateItemStacks,
  type BattleInventory,
  type ItemDefinition,
  type ItemStack,
} from "./items.js";
import { validateElements, validateElementResistances } from "./elements.js";
import {
  battleTargetChoices,
  resolveBattleTargets,
  sameTargetSelection,
  type TargetChoice,
  type TargetSelection,
} from "./battle-targets.js";
import {
  BattleConditions,
  conditionsAllowAction,
} from "./battle-conditions.js";
import type {
  BattleContent,
  CombatantDefinition,
  AbilityDefinition,
} from "./battle-content.js";

export type Combatant = CombatantDefinition & {
  maxHp: number;
  maxMp: number;
  atb: number;
  queued: boolean;
  /** Shared enemy parameters; deliberately separate from VM execution state. */
  behavior: EnemyBehaviorState | null;
};
export type BattleStatProjection = Omit<ParameterValues, "hp" | "mp"> &
  Pick<
    Combatant,
    "maxHp" | "maxMp" | "physical" | "attackElements" | "elementResistances"
  >;
export type BattleAction = {
  kind: "normal" | "loop" | "counter";
  actor: string;
  selection: TargetSelection;
  targetIds: string[];
  source: { kind: "ability"; id: number } | { kind: "item"; id: number };
  commandId: number | null;
  charge: number;
  elapsed: number;
  resolved: boolean;
  results: { target: string; effects: AbilityEffectResult[] }[];
};
export type BattleReward = {
  exp: number;
  gil: number;
  each: number;
  recipients: string[];
  levels: { id: string; from: number; to: number }[];
  drops: "pending";
};
export type BattleEvent = { time: number; text: string };

/** Playability profile only. All provisional rules are enumerated in docs/battle-playability.md.
 * Fixed simulation steps + owned PRNG make failures reproducible; they do not reproduce Unity RNG.
 */
export class BattleGame {
  readonly combatants: Combatant[];
  readonly events: BattleEvent[] = [];
  phase: "active" | "victory" | "defeat" = "active";
  action: BattleAction | null = null;
  reward: BattleReward | null = null;
  time = 0;
  private remainder = 0;
  private randomState: number;
  private queue: BattleAction[] = [];
  private reactions: BattleAction[] = [];
  private aiStates = new Map<string, BattleAIState>();
  private collected = false;
  readonly conditions: BattleConditions;
  readonly items: Record<string, ItemDefinition>;
  private stock: ItemStack[];
  private consumedItems: ItemStack[] = [];
  constructor(
    readonly content: BattleContent,
    seed: number,
    players?: Combatant[],
    inventory: BattleInventory = { definitions: {}, stacks: [], limit: 99 },
    private readonly projectProgression?: (
      player: Combatant,
    ) => BattleStatProjection,
  ) {
    if (
      content.kind !== "opening-battle-development" ||
      content.profile !== "narshe-playability-v16"
    )
      throw new Error("Unsupported battle runtime profile");
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new Error("Invalid battle seed");
    this.randomState = seed || 1;
    this.items = structuredClone(inventory.definitions);
    validateItemStacks(inventory.stacks, this.items, inventory.limit);
    this.stock = structuredClone(inventory.stacks);
    validateReactionRules(content.reactions);
    this.conditions = new BattleConditions(content.conditions);
    this.combatants = [
      ...(players
        ? structuredClone(players)
        : content.players.map((p) => ({
            ...structuredClone(p),
            maxHp: p.hp,
            maxMp: p.mp,
            atb: 0,
            queued: false,
            behavior: null,
          }))),
      ...content.enemies.map((p) => ({
        ...structuredClone(p),
        maxHp: p.hp,
        maxMp: p.mp,
        atb: 0,
        queued: false,
        behavior: initialEnemyBehavior(),
      })),
    ];
    if (
      new Set(this.combatants.map((c) => c.id)).size !== this.combatants.length
    )
      throw new Error("Duplicate battle identity");
    this.validateConditionState();
    for (const ability of Object.values(content.abilities))
      this.conditions.validateReferences(ability.program.forbiddenConditionIds);
    for (const command of Object.values(content.commands))
      this.conditions.validateReferences(command.forbiddenConditionIds);
    for (const item of Object.values(this.items))
      this.conditions.validateReferences(item.forbiddenConditionIds);
    for (const c of this.combatants) {
      validateElements(c.attackElements);
      validateElementResistances(c.elementResistances);
    }
    for (const c of this.enemies) {
      if (!c.ai) throw new BattleAIError(null, 0, "missing enemy AI program");
      const initial = startBattleAI(c.ai, this.aiContext(c));
      const context = this.aiContext(c);
      context.self.behavior = initial.behavior;
      this.admitAITurn(c, planBattleAITurn(c.ai, initial.state, context));
      // Initialization writes are real; speculative first-turn writes are not.
      c.behavior = initial.behavior;
      this.aiStates.set(c.id, initial.state);
    }
    for (const c of this.combatants) {
      const range = content.initialAtb[c.side];
      c.atb = this.randomInt(range[0], range[1]);
      c.queued = false;
      Object.assign(c, this.conditions.settleLife(c.hp, c.conditionIds, false));
      if (c.hp === 0) c.atb = 0;
    }
    this.log("敌人出现了。");
  }
  get players() {
    return this.combatants.filter((c) => c.side === "player");
  }
  get enemies() {
    return this.combatants.filter((c) => c.side === "enemy");
  }
  get ready() {
    return this.players.filter((c) => c.hp > 0 && c.atb >= 100 && !c.queued);
  }
  get inventory() {
    return this.stock.map((i) => ({
      ...i,
      available: this.availableItemCount(i.id),
    }));
  }
  private availableItemCount(id: number, except?: BattleAction) {
    const reserved = [
      ...this.queue,
      ...this.reactions,
      ...(this.action ? [this.action] : []),
    ].filter(
      (a) =>
        a !== except &&
        !a.resolved &&
        a.source.kind === "item" &&
        a.source.id === id,
    ).length;
    return (this.stock.find((i) => i.id === id)?.count ?? 0) - reserved;
  }
  canUseItem(actorId: string, itemId: number, commandId: number): boolean {
    return this.itemAllowed(actorId, itemId, commandId);
  }
  private itemAllowed(
    actorId: string,
    itemId: number,
    commandId: number,
    except?: BattleAction,
  ): boolean {
    const actor = this.players.find((c) => c.id === actorId),
      item = this.items[itemId],
      command = this.content.commands[commandId];
    if (
      !actor ||
      actor.hp <= 0 ||
      !item ||
      item.important ||
      !item.uses.battle.plan ||
      !actor.commands.includes(commandId) ||
      command?.kind !== "item" ||
      this.availableItemCount(itemId, except) < 1
    )
      return false;
    this.conditions.validateActive(actor.conditionIds);
    return conditionsAllowAction(
      actor.conditionIds,
      item.forbiddenConditionIds,
      command.forbiddenConditionIds,
    );
  }
  itemTargetChoices(actorId: string, itemId: number): TargetChoice[] {
    const actor = this.players.find((c) => c.id === actorId),
      item = this.items[itemId];
    if (!actor || !item?.uses.battle.plan || item.important) return [];
    // Enemy-target item reactions still need their own received-item provider.
    // Keep the source range intact; this bounded host admits player targets only.
    return battleTargetChoices(
      item.uses.battle.plan.targeting,
      actor,
      this.combatants,
      this.content.formation,
    ).filter((choice) =>
      choice.targetIds.every((id) => this.players.some((p) => p.id === id)),
    );
  }
  commandItem(
    actorId: string,
    itemId: number,
    selection: TargetSelection,
    commandId: number,
  ): boolean {
    const actor = this.ready.find((c) => c.id === actorId);
    if (
      this.phase !== "active" ||
      !actor ||
      !this.canUseItem(actorId, itemId, commandId)
    )
      return false;
    const choice = this.itemTargetChoices(actorId, itemId).find((c) =>
      sameTargetSelection(c.selection, selection),
    );
    if (!choice) return false;
    this.queue.push({
      kind: "normal",
      actor: actorId,
      source: { kind: "item", id: itemId },
      selection: structuredClone(choice.selection),
      targetIds: [...choice.targetIds],
      commandId,
      // Ordinary item command 3 has command_wait=0; the profile's presentation
      // timing remains the same provisional 400/900 ms used by abilities.
      charge: 0,
      elapsed: 0,
      resolved: false,
      results: [],
    });
    actor.queued = true;
    return true;
  }
  actionDefinition(action: BattleAction) {
    if (action.source.kind === "ability")
      return this.content.abilities[action.source.id]!;
    const item = this.items[action.source.id]!,
      use = item.uses.battle;
    return {
      name: item.name,
      plan: use.plan,
      power: item.power,
      cost: 0,
      presentation: use.plan?.effects.every(
        (e) => e.kind === "recover-condition",
      )
        ? "condition"
        : "heal",
      attribute: 0,
      program: {
        functions: use.program.functions,
        rules: { system_id: item.systemId },
      },
    };
  }
  private canUseAction(action: BattleAction) {
    return action.source.kind === "ability"
      ? this.canUse(action.actor, action.source.id, action.commandId)
      : action.commandId !== null &&
          this.itemAllowed(
            action.actor,
            action.source.id,
            action.commandId,
            action,
          );
  }
  private validateConditionState() {
    for (const c of this.combatants) {
      this.conditions.validateActive(c.conditionIds);
      this.conditions.validateResistances(c.conditionResistances);
      for (const id of c.commands)
        if (!this.content.commands[id])
          throw new Error("Unknown battle command: " + id);
    }
  }
  /** Keep command context separate from ability identity: one ability may be
   * offered by several commands. An omitted, ambiguous context is rejected. */
  private actionCommand(
    actor: Combatant,
    abilityId: number,
    requested?: number | null,
  ) {
    if (actor.side === "enemy") return requested == null ? null : undefined;
    const choices = actor.commands.filter(
      (id) =>
        this.content.commands[id]?.kind === "ability" &&
        this.content.commands[id]?.abilityIds.includes(abilityId),
    );
    if (requested === undefined)
      return choices.length === 1 ? choices[0] : undefined;
    return requested !== null && choices.includes(requested)
      ? requested
      : undefined;
  }
  canUse(
    actorId: string,
    abilityId: number,
    commandId?: number | null,
  ): boolean {
    const actor = this.combatants.find((c) => c.id === actorId),
      ability = this.content.abilities[abilityId];
    if (
      !actor ||
      !ability?.plan ||
      !actor.abilities.includes(abilityId) ||
      actor.hp <= 0 ||
      actor.mp < ability.cost ||
      (ability.plan.targeting.normalFormationOnly &&
        this.content.formation !== "normal")
    )
      return false;
    this.conditions.validateActive(actor.conditionIds);
    const command = this.actionCommand(actor, abilityId, commandId);
    if (command === undefined) return false;
    return (
      conditionsAllowAction(
        actor.conditionIds,
        ability.program.forbiddenConditionIds,
        command === null
          ? []
          : this.content.commands[command]!.forbiddenConditionIds,
      ) &&
      !(
        !actor.physical &&
        ability.plan.effects.some((e) => e.kind === "physical")
      )
    );
  }
  private randomUnit() {
    let x = this.randomState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.randomState = x >>> 0;
    return this.randomState / 0x100000000;
  }
  private randomInt(min: number, max: number) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max)
      throw new Error("Invalid random range");
    return min + Math.floor(this.randomUnit() * (max - min + 1));
  }
  private aiContext(
    actor: Combatant,
    units: readonly Combatant[] = this.combatants,
  ) {
    if (!actor.behavior) throw new Error("Missing enemy behavior parameters");
    return {
      self: {
        hp: actor.hp,
        mp: actor.mp,
        monsterId: actor.sourceId,
        behavior: actor.behavior,
      },
      conditionIds: actor.conditionIds,
      players: units.filter((c) => c.side === "player"),
      enemies: units.filter((c) => c.side === "enemy"),
    };
  }
  enemyAIState(actorId: string): BattleAIState | null {
    const state = this.aiStates.get(actorId);
    return state ? structuredClone(state) : null;
  }
  /** Inspection/replay callers cannot mutate the live queue or its selections. */
  get pendingActions(): readonly BattleAction[] {
    return structuredClone([...this.reactions, ...this.queue]);
  }
  private admitAITurn(actor: Combatant, turn: BattleAITurn) {
    const program = actor.ai!;
    const fail = (pc: number, reason: string): never => {
      throw new BattleAIError(program.source, pc, reason);
    };
    if (turn.state.status !== "waiting")
      fail(
        turn.state.pc,
        `${turn.trigger} action path does not return to SyncAI`,
      );
    if (
      turn.trigger === "normal" &&
      turn.acts.filter((a) => a.selected).length !== 1
    )
      fail(
        turn.state.pc,
        "normal action path must select exactly one table row",
      );
    if (
      turn.trigger === "reaction" &&
      turn.acts.some((a) => a.kind !== "counter-act")
    )
      fail(turn.state.pc, "reaction path emitted a normal action");
    if (turn.acts.length > 1000)
      fail(turn.state.pc, "AI exceeded host action budget");
    for (const pc of turn.visited) {
      const op = program.instructions[pc]!.op;
      if (op.kind === "condition")
        this.conditions.validateReferences([op.conditionId]);
    }
    for (const act of turn.acts) {
      if (act.kind === "loop-act") {
        const count = act.counts.reduce((sum, n) => sum + Math.max(0, n), 0);
        if (count > 1000) fail(act.pc, "AI loop exceeded host action budget");
        if (act.selected && count === 0)
          fail(act.pc, "empty loop action decision");
      }
      for (const id of act.abilities) {
        const ability = this.content.abilities[id];
        if (!actor.abilities.includes(id) || !ability?.plan)
          fail(
            act.pc,
            `unimplemented ability ${id}: ${ability?.blockers.join("; ") ?? "missing definition"}`,
          );
        // Native automatic targets differ from the player's menu defaults. The
        // reviewed normal path covers random player targeting for ranges 3/7.
        // Other ranges and special target filters remain explicit capabilities.
        if (
          ![3, 7].includes(ability!.program.range) ||
          ability!.plan!.targeting.life !== "alive"
        )
          fail(
            act.pc,
            `unimplemented automatic target range for ability ${id}`,
          );
        if (
          !actor.physical &&
          ability!.plan!.effects.some((e) => e.kind === "physical")
        )
          fail(act.pc, `missing physical parameters for ability ${id}`);
        if (
          ability!.plan!.targeting.normalFormationOnly &&
          this.content.formation !== "normal"
        )
          fail(act.pc, `unimplemented formation for ability ${id}`);
      }
    }
  }
  private decideEnemyAction(actor: Combatant) {
    const state = this.aiStates.get(actor.id)!;
    const turn = planBattleAITurn(actor.ai!, state, this.aiContext(actor));
    this.admitAITurn(actor, turn);
    const previousRandom = this.randomState;
    try {
      const decisions: BattleAction[] = [];
      for (const act of turn.acts) {
        const ids = selectBattleAIAbilities(act, {
          integer: (min, max) => this.randomInt(min, max),
          float: (min, max) =>
            Math.fround(min + this.randomUnit() * (max - min)),
        });
        for (const id of ids) {
          const ability = this.content.abilities[id]!;
          const choices = this.targetChoices(actor.id, id).filter(
            (choice) =>
              choice.selection.kind === "single" &&
              this.players.some((p) => p.id === choice.targetIds[0]),
          );
          if (!choices.length)
            throw new BattleAIError(
              actor.ai!.source,
              act.pc,
              `no admitted automatic target for ability ${id}`,
            );
          decisions.push(
            this.createAction(
              actor,
              ability,
              choices[this.randomInt(0, choices.length - 1)]!,
              null,
              act.kind === "loop-act" ? "loop" : "normal",
            ),
          );
        }
      }
      if (!decisions.length)
        throw new BattleAIError(
          actor.ai!.source,
          state.pc,
          "no normal action decision",
        );
      // Commit the whole group only after every target has been selected. A
      // later failure cannot leave half a LoopAct in the live queue.
      this.queue.push(...decisions);
      actor.queued = true;
      this.aiStates.set(actor.id, turn.state);
      actor.behavior = turn.behavior;
    } catch (error) {
      this.randomState = previousRandom;
      throw error;
    }
  }
  private log(text: string) {
    this.events.push({ time: this.time, text });
    if (this.events.length > 80) this.events.shift();
  }
  targetChoices(actorId: string, abilityId: number): TargetChoice[] {
    const actor = this.combatants.find((c) => c.id === actorId),
      ability = this.content.abilities[abilityId];
    if (
      !actor ||
      !ability ||
      !actor.abilities.includes(abilityId) ||
      !ability.plan
    )
      return [];
    if (
      !actor.physical &&
      ability.plan.effects.some((e) => e.kind === "physical")
    )
      return [];
    return battleTargetChoices(
      ability.plan.targeting,
      actor,
      this.combatants,
      this.content.formation,
    );
  }
  /** Single-unit candidates for existing callers. Group requests must use an
   * explicit selection so a one-member group never silently becomes single. */
  targets(actorId: string, abilityId: number): Combatant[] {
    return this.targetChoices(actorId, abilityId)
      .filter((choice) => choice.selection.kind === "single")
      .map((choice) =>
        this.combatants.find((c) => c.id === choice.targetIds[0])!,
      );
  }
  command(
    actorId: string,
    abilityId: number,
    target: string | TargetSelection,
    commandId?: number | null,
  ): boolean {
    if (this.phase !== "active") return false;
    const actor = this.ready.find((c) => c.id === actorId),
      ability = this.content.abilities[abilityId];
    if (
      !actor ||
      !ability ||
      !ability.plan ||
      !this.canUse(actorId, abilityId, commandId)
    )
      return false;
    const selection: TargetSelection =
      typeof target === "string" ? { kind: "single", id: target } : target;
    const choice = this.targetChoices(actorId, abilityId).find((c) =>
      sameTargetSelection(c.selection, selection),
    );
    if (!choice) return false;
    const action = this.createAction(
      actor,
      ability,
      choice,
      this.actionCommand(actor, abilityId, commandId)!,
    );
    this.queue.push(action);
    actor.queued = true;
    return true;
  }
  private createAction(
    actor: Combatant,
    ability: AbilityDefinition,
    choice: TargetChoice,
    commandId: number | null = null,
    kind: BattleAction["kind"] = "normal",
  ): BattleAction {
    return {
      kind,
      actor: actor.id,
      selection: structuredClone(choice.selection),
      targetIds: [...choice.targetIds],
      source: { kind: "ability", id: ability.id },
      commandId,
      charge:
        actor.side === "player"
          ? Math.round((1000 * ability.wait * 20) / (actor.agility * 0.5 + 20))
          : 0,
      elapsed: 0,
      resolved: false,
      results: [],
    };
  }
  private finishActorAction(actor: Combatant, kind: BattleAction["kind"]) {
    // Interrupt actions have no ordinary ATB completion delegate. In particular,
    // a counter must preserve a partially filled gauge or an already queued turn.
    if (kind === "counter") return;
    // Native ActExectionEndDelegate keeps the gauge while normal/Loop actions
    // remain in chanting or execution stacks. One LoopAct is one table turn.
    actor.queued = this.queue.some((pending) => pending.actor === actor.id);
    if (!actor.queued) actor.atb = 0;
  }
  advance(ms: number) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000)
      throw new Error("Invalid battle elapsed time");
    this.validateConditionState();
    this.remainder += ms;
    while (this.remainder >= 10) {
      this.remainder -= 10;
      if (this.phase === "active") this.tick();
    }
  }
  private tick() {
    this.time += 10;
    // Serial action presentation freezes meters; command input still works for already-ready actors.
    if (this.action) {
      this.action.elapsed += 10;
      if (!this.action.resolved && this.action.elapsed >= 400)
        this.resolve(this.action);
      if (this.action.elapsed >= 900) {
        const actor = this.combatants.find((c) => c.id === this.action!.actor)!;
        const kind = this.action.kind;
        this.action = null;
        this.finishActorAction(actor, kind);
        this.checkOutcome();
      }
      return;
    }
    if (!this.reactions.length) {
      for (const pending of this.queue)
        pending.charge = Math.max(0, pending.charge - 10);
      for (const c of this.combatants) {
        if (c.hp <= 0 || c.queued) continue;
        c.atb = Math.min(
          100,
          c.atb +
            atbIncrement(this.content.atb, {
              agility: c.agility,
              weight: c.weight,
              enemy: c.side === "enemy",
              speedPercent: 100,
              battleSpeed: 1,
              seconds: 0.01,
            }),
        );
        if (c.side === "enemy" && c.atb >= 100) {
          if (!this.players.some((p) => p.hp > 0)) break;
          this.decideEnemyAction(c);
        }
      }
    }
    const queue = this.reactions.length ? this.reactions : this.queue;
    const index = queue.findIndex((a) => a.charge === 0);
    if (index >= 0) {
      const action = queue.splice(index, 1)[0]!,
        actor = this.combatants.find((c) => c.id === action.actor)!;
      if (!this.canUseAction(action)) {
        this.finishActorAction(actor, action.kind);
        this.log(`${actor.name} 的行动已失效。`);
        return;
      }
      const choice = resolveBattleTargets(
        action.selection,
        this.actionTargetChoices(action),
        this.combatants,
        (min, max) => this.randomInt(min, max),
      );
      if (!choice) {
        this.finishActorAction(actor, action.kind);
        this.checkOutcome();
        return;
      }
      action.selection = choice.selection;
      action.targetIds = choice.targetIds;
      this.action = action;
      this.log(`${actor.name} · ${this.actionDefinition(action).name}`);
    }
    this.checkOutcome();
  }
  /** CounterAct supplies the attacker explicitly, even for friendly fire. Its
   * target is not selected through the player's menu or the normal enemy AI.
   * This profile admits living single-target ranges 3/7 only. Existing fallback
   * keeps the selected faction if that attacker dies before the counter starts. */
  private counterTargetChoices(units: readonly Combatant[]): TargetChoice[] {
    return units
      .filter((c) => c.hp > 0)
      .map((c) => ({
        selection: { kind: "single" as const, id: c.id },
        targetIds: [c.id],
      }));
  }
  private actionTargetChoices(action: BattleAction) {
    return action.kind === "counter"
      ? this.counterTargetChoices(this.combatants)
      : action.source.kind === "item"
        ? this.itemTargetChoices(action.actor, action.source.id)
        : this.targetChoices(action.actor, action.source.id);
  }
  private planReactions(
    action: BattleAction,
    units: readonly Combatant[],
    results: readonly { target: string; effects: AbilityEffectResult[] }[],
  ) {
    const ability = this.actionDefinition(action);
    const updates: { actor: string; turn: BattleAITurn }[] = [];
    const decisions: BattleAction[] = [];
    for (const result of results) {
      const actor = units.find((c) => c.id === result.target)!;
      if (actor.side !== "enemy") continue;
      if (action.source.kind === "item")
        throw new Error("Unimplemented enemy item reaction");
      const reaction = battleReaction(this.content.reactions, {
        actor: action.actor,
        target: actor.id,
        isCounter: action.kind === "counter",
        abilityId: action.source.id,
        systemId: ability.program.rules.system_id!,
        primarySlot: ability.program.functions[0]?.slot ?? -1,
        effects: result.effects,
      });
      if (!reaction) continue;
      const turn = planBattleAIReaction(
        actor.ai!,
        this.aiStates.get(actor.id)!,
        this.aiContext(actor, units),
        reaction,
      );
      this.admitAITurn(actor, turn);
      for (const act of turn.acts) {
        for (const id of selectBattleAIAbilities(act, {
          integer: (min, max) => this.randomInt(min, max),
          float: (min, max) =>
            Math.fround(min + this.randomUnit() * (max - min)),
        })) {
          const choice = this.counterTargetChoices(units).find(
            (c) => c.targetIds[0] === action.actor,
          );
          if (!choice)
            throw new BattleAIError(
              actor.ai!.source,
              act.pc,
              `no admitted counter target for ability ${id}`,
            );
          decisions.push(
            this.createAction(
              actor,
              this.content.abilities[id]!,
              choice,
              null,
              "counter",
            ),
          );
        }
      }
      updates.push({ actor: actor.id, turn });
    }
    return { updates, decisions };
  }
  private resolve(action: BattleAction) {
    const actor = this.combatants.find((c) => c.id === action.actor)!;
    const ability = this.actionDefinition(action);
    if (action.resolved) return;
    if (!ability.plan) throw new Error("Unimplemented ability cannot execute");
    if (!this.canUseAction(action)) {
      action.resolved = true;
      return;
    }
    const randomBefore = this.randomState;
    try {
      const choice = resolveBattleTargets(
        action.selection,
        this.actionTargetChoices(action),
        this.combatants,
        (min, max) => this.randomInt(min, max),
      );
      if (!choice) {
        action.targetIds = [];
        action.resolved = true;
        return;
      }
      const staged = choice.targetIds.map((id) => {
        const target = this.combatants.find((c) => c.id === id)!;
        const { state, effects } = projectActionTarget(
          ability.plan!,
          ability.power,
          actor,
          target,
          this.conditions,
          (min, max) => this.randomInt(min, max),
          choice.targetIds.length,
          ability.cost,
        );
        const messages: string[] = [];
        for (const effect of effects) {
          if (effect.missed) {
            messages.push(
              effect.resource === "condition"
                ? `${target.name} 的状态未改变。`
                : effect.recovery
                  ? `${target.name} 的恢复未生效。`
                  : `${target.name} 闪避了攻击。`,
            );
          } else if (effect.resource !== "condition" && effect.nullified) {
            messages.push(`${target.name} · 无效。`);
          } else if (effect.resource === "condition") {
            for (const id of effect.added)
              messages.push(`${target.name} 陷入${this.conditions.name(id)}。`);
            for (const id of effect.removed)
              messages.push(
                `${target.name} 的${this.conditions.name(id)}已解除。`,
              );
          } else {
            const resource = effect.resource;
            messages.push(
              effect.recovery
                ? `${target.name} 恢复 ${effect.amount} ${resource.toUpperCase()}。`
                : `${target.name} 受到 ${effect.amount} 点伤害。`,
            );
          }
        }
        if (target.hp > 0 && state.hp === 0)
          messages.push(`${target.name} 倒下了。`);
        else if (target.hp === 0 && state.hp > 0)
          messages.push(`${target.name} 重新加入战斗。`);
        return { target, state, effects, messages };
      });
      // AI must see the completed action's HP/MP/conditions, including its cost,
      // but cannot mutate the live battle until EVERY target and reaction admits.
      const projected = this.combatants.map((c) => ({
        ...c,
        mp: c.mp - (c === actor ? ability.cost : 0),
        ...staged.find((entry) => entry.target.id === c.id)?.state,
      }));
      const results = staged.map((entry) => ({
        target: entry.target.id,
        effects: entry.effects,
      }));
      const reactions = this.planReactions(action, projected, results);
      // One transaction includes effects, enemy parameters, AI PCs, both queues,
      // result/log publication and the owned random stream.
      if (action.source.kind === "item") {
        this.stock.find((i) => i.id === action.source.id)!.count--;
        const used = this.consumedItems.find((i) => i.id === action.source.id);
        if (used) used.count++;
        else this.consumedItems.push({ id: action.source.id, count: 1 });
      }
      actor.mp -= ability.cost;
      for (const entry of staged) {
        const lifeChanged = (entry.target.hp === 0) !== (entry.state.hp === 0);
        Object.assign(entry.target, entry.state);
        if (lifeChanged) {
          entry.target.atb = 0;
          entry.target.queued = false;
          this.queue = this.queue.filter((a) => a.actor !== entry.target.id);
          this.reactions = this.reactions.filter(
            (a) => a.actor !== entry.target.id,
          );
        }
        for (const message of entry.messages) this.log(message);
      }
      for (const update of reactions.updates) {
        this.aiStates.set(update.actor, update.turn.state);
        this.combatants.find((c) => c.id === update.actor)!.behavior =
          update.turn.behavior;
      }
      this.reactions.push(...reactions.decisions);
      action.selection = choice.selection;
      action.targetIds = choice.targetIds;
      action.results = results;
      action.resolved = true;
    } catch (error) {
      this.randomState = randomBefore;
      throw error;
    }
  }

  private checkOutcome() {
    if (this.phase !== "active" || this.action) return;
    for (const c of this.combatants) {
      Object.assign(c, this.conditions.settleLife(c.hp, c.conditionIds, false));
      if (c.hp === 0) {
        c.atb = 0;
        c.queued = false;
        this.queue = this.queue.filter((a) => a.actor !== c.id);
        this.reactions = this.reactions.filter((a) => a.actor !== c.id);
      }
    }
    if (!this.players.some((c) => c.hp > 0)) {
      this.clearBattleConditions();
      this.phase = "defeat";
      this.queue = [];
      this.reactions = [];
      this.log("队伍倒下了。");
      return;
    }
    if (this.enemies.some((c) => c.hp > 0)) return;
    // Missing growth for a later recipient must not leave an earlier recipient
    // upgraded, or publish a victory whose reward cannot be collected.
    const players = this.players.map((c) => ({
      ...structuredClone(c),
      conditionIds: this.conditions.battleEnd(c.conditionIds),
    }));
    const exp = this.enemies.reduce((sum, c) => sum + c.exp, 0),
      gil = this.enemies.reduce((sum, c) => sum + c.gil, 0);
    const recipients = players.filter((c) => c.hp > 0),
      each = Math.trunc(exp / Math.max(1, recipients.length));
    const levels: BattleReward["levels"] = [];
    for (const c of recipients) {
      c.exp += each;
      const from = c.level,
        level =
          this.content.experience.filter((l) => l.exp <= c.exp).at(-1)?.level ??
          c.level;
      for (let next = c.level + 1; next <= level; next++) {
        const growth = this.content.growth[c.growthGroup!]?.find(
          (g) => g.level === next,
        );
        if (!growth) throw new Error("Missing level growth dependency");
        if (!this.projectProgression) {
          c.maxHp = Math.min(9999, c.maxHp + growth.hp);
          c.maxMp = Math.min(999, c.maxMp + growth.mp);
        }
      }
      c.level = Math.max(c.level, level);
      if (this.projectProgression) {
        Object.assign(c, this.projectProgression(structuredClone(c)));
        c.hp = Math.min(c.hp, c.maxHp);
        c.mp = Math.min(c.mp, c.maxMp);
      }
      c.conditionIds = this.conditions.updateDying(
        c.hp,
        c.maxHp,
        c.conditionIds,
      );
      if (c.level !== from) levels.push({ id: c.id, from, to: c.level });
    }
    for (const player of players)
      Object.assign(
        this.combatants.find((c) => c.id === player.id)!,
        player,
      );
    this.phase = "victory";
    this.queue = [];
    this.reactions = [];
    this.reward = {
      exp,
      gil,
      each,
      recipients: recipients.map((c) => c.id),
      levels,
      drops: "pending",
    };
    this.log(`战斗胜利！获得 ${exp} EXP / ${gil} Gil。`);
  }
  private clearBattleConditions() {
    for (const c of this.players)
      c.conditionIds = this.conditions.battleEnd(c.conditionIds);
  }
  previewVictory(): {
    players: Combatant[];
    gil: number;
    consumedItems: ItemStack[];
  } | null {
    if (this.phase !== "victory" || !this.reward || this.collected) return null;
    return {
      players: structuredClone(this.players).map((c) => ({
        ...c,
        atb: 0,
        queued: false,
      })),
      gil: this.reward.gil,
      consumedItems: structuredClone(this.consumedItems).sort(
        (a, b) => a.id - b.id,
      ),
    };
  }
  takeVictory(): {
    players: Combatant[];
    gil: number;
    consumedItems: ItemStack[];
  } | null {
    const result = this.previewVictory();
    if (result) this.collected = true;
    return result;
  }
}
