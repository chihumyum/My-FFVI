import {
  calculateDevelopmentEffects,
  type AbilityEffectResult,
} from "./ability.js";
import { atbIncrement } from "./atb.js";
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
};
export type BattleAction = {
  actor: string;
  selection: TargetSelection;
  targetIds: string[];
  ability: number;
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
  private collected = false;
  readonly conditions: BattleConditions;
  constructor(
    readonly content: BattleContent,
    seed: number,
    players?: Combatant[],
  ) {
    if (
      content.kind !== "opening-battle-development" ||
      content.profile !== "narshe-playability-v8"
    )
      throw new Error("Unsupported battle runtime profile");
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new Error("Invalid battle seed");
    this.randomState = seed || 1;
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
          }))),
      ...content.enemies.map((p) => ({
        ...structuredClone(p),
        maxHp: p.hp,
        maxMp: p.mp,
        atb: 0,
        queued: false,
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
    for (const c of this.combatants) {
      validateElements(c.attackElements);
      validateElementResistances(c.elementResistances);
    }
    for (const c of this.combatants) {
      const range = content.initialAtb[c.side];
      c.atb = this.randomInt(range[0], range[1]);
      c.queued = false;
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
    const choices = actor.commands.filter((id) =>
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
  private randomInt(min: number, max: number) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max)
      throw new Error("Invalid random range");
    let x = this.randomState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.randomState = x >>> 0;
    return min + Math.floor((this.randomState / 0x100000000) * (max - min + 1));
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
      .map(
        (choice) => this.combatants.find((c) => c.id === choice.targetIds[0])!,
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
    this.enqueue(
      actor,
      ability,
      choice,
      this.actionCommand(actor, abilityId, commandId)!,
    );
    return true;
  }
  private enqueue(
    actor: Combatant,
    ability: AbilityDefinition,
    choice: TargetChoice,
    commandId: number | null = null,
  ) {
    actor.queued = true;
    this.queue.push({
      actor: actor.id,
      selection: structuredClone(choice.selection),
      targetIds: [...choice.targetIds],
      ability: ability.id,
      commandId,
      charge:
        actor.side === "player"
          ? Math.round((1000 * ability.wait * 20) / (actor.agility * 0.5 + 20))
          : 0,
      elapsed: 0,
      resolved: false,
      results: [],
    });
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
        actor.atb = 0;
        actor.queued = false;
        this.action = null;
        this.checkOutcome();
      }
      return;
    }
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
        const total = c.ai.reduce((sum, a) => sum + a.weight, 0);
        let roll = this.randomInt(1, total),
          choice = c.ai.at(-1)!;
        for (const candidate of c.ai) {
          roll -= candidate.weight;
          if (roll <= 0) {
            choice = candidate;
            break;
          }
        }
        const ability = this.content.abilities[choice.ability];
        if (
          !ability?.plan ||
          ability.plan.effects.length !== 1 ||
          ability.plan.effects[0]!.kind !== "physical"
        )
          throw new Error("Unsupported enemy AI action");
        const choices = this.targetChoices(c.id, ability.id).filter(
          (choice) =>
            choice.selection.kind === "single" &&
            this.players.some((p) => p.id === choice.targetIds[0]),
        );
        if (!choices.length)
          throw new Error("Unsupported enemy AI target selection");
        this.enqueue(
          c,
          ability,
          choices[this.randomInt(0, choices.length - 1)]!,
        );
      }
    }
    const index = this.queue.findIndex((a) => a.charge === 0);
    if (index >= 0) {
      const action = this.queue.splice(index, 1)[0]!,
        actor = this.combatants.find((c) => c.id === action.actor)!;
      if (!this.canUse(actor.id, action.ability, action.commandId)) {
        actor.queued = false;
        actor.atb = 0;
        this.log(`${actor.name} 的行动已失效。`);
        return;
      }
      const choice = resolveBattleTargets(
        action.selection,
        this.targetChoices(actor.id, action.ability),
        this.combatants,
        (min, max) => this.randomInt(min, max),
      );
      if (!choice) {
        actor.queued = false;
        actor.atb = 0;
        this.checkOutcome();
        return;
      }
      action.selection = choice.selection;
      action.targetIds = choice.targetIds;
      this.action = action;
      this.log(
        `${actor.name} · ${this.content.abilities[action.ability]!.name}`,
      );
    }
    this.checkOutcome();
  }
  private resolve(action: BattleAction) {
    const actor = this.combatants.find((c) => c.id === action.actor)!;
    const ability = this.content.abilities[action.ability]!;
    if (action.resolved) return;
    if (!ability.plan) throw new Error("Unimplemented ability cannot execute");
    if (!this.canUse(actor.id, ability.id, action.commandId)) {
      action.resolved = true;
      return;
    }
    const randomBefore = this.randomState;
    try {
      const choice = resolveBattleTargets(
        action.selection,
        this.targetChoices(actor.id, ability.id),
        this.combatants,
        (min, max) => this.randomInt(min, max),
      );
      if (!choice) {
        action.targetIds = [];
        action.resolved = true;
        return;
      }
      const first = ability.plan.effects[0];
      const staged = choice.targetIds.map((id) => {
        const target = this.combatants.find((c) => c.id === id)!;
        this.conditions.validateActive(target.conditionIds);
        let conditionIds = [...target.conditionIds];
        let effects: AbilityEffectResult[];
        if (
          ability.plan!.effects.length === 1 &&
          first &&
          (first.kind === "add-condition" || first.kind === "recover-condition")
        ) {
          const change =
            first.kind === "add-condition"
              ? this.conditions.add(
                  target.conditionIds,
                  target.conditionResistances,
                  first.conditionId,
                  {
                    accuracy: first.accuracy,
                    magicEvasion: target.magicEvasion,
                    fixed: first.fixedHit,
                  },
                  (min, max) => this.randomInt(min, max),
                )
              : this.conditions.recover(
                  target.conditionIds,
                  first.conditionIds,
                );
          conditionIds = change.currentIds;
          effects = [
            {
              slot: first.slot,
              resource: "condition",
              recovery: first.kind === "recover-condition",
              added: change.added,
              removed: change.removed,
              missed: change.missed,
            },
          ];
        } else {
          effects = calculateDevelopmentEffects(
            ability.plan!,
            ability.power,
            actor,
            target,
            (min, max) => this.randomInt(min, max),
            choice.targetIds.length,
          );
        }
        // Include the one action cost before any MP recovery to the actor.
        const state = {
          hp: target.hp,
          mp: target.mp - (target === actor ? ability.cost : 0),
          conditionIds,
        };
        const messages: string[] = [];
        for (const effect of effects) {
          if (effect.missed) {
            messages.push(
              effect.resource === "condition"
                ? `${target.name} 的状态未改变。`
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
            state[resource] = effect.recovery
              ? Math.min(
                  resource === "hp" ? target.maxHp : target.maxMp,
                  state[resource] + effect.amount,
                )
              : Math.max(0, state[resource] - effect.amount);
            messages.push(
              effect.recovery
                ? `${target.name} 恢复 ${effect.amount} ${resource.toUpperCase()}。`
                : `${target.name} 受到 ${effect.amount} 点伤害。`,
            );
          }
        }
        return { target, state, effects, messages };
      });
      // One transaction: no HP, MP, conditions, results or logs change until
      // every target succeeds. The owned random stream also rolls back on error.
      actor.mp -= ability.cost;
      for (const entry of staged) {
        Object.assign(entry.target, entry.state);
        for (const message of entry.messages) this.log(message);
      }
      action.selection = choice.selection;
      action.targetIds = choice.targetIds;
      action.results = staged.map((entry) => ({
        target: entry.target.id,
        effects: entry.effects,
      }));
      action.resolved = true;
    } catch (error) {
      this.randomState = randomBefore;
      throw error;
    }
  }

  private checkOutcome() {
    if (this.phase !== "active" || this.action) return;
    if (!this.players.some((c) => c.hp > 0)) {
      this.clearBattleConditions();
      this.phase = "defeat";
      this.queue = [];
      this.log("队伍倒下了。");
      return;
    }
    if (this.enemies.some((c) => c.hp > 0)) return;
    this.clearBattleConditions();
    this.phase = "victory";
    this.queue = [];
    const exp = this.enemies.reduce((sum, c) => sum + c.exp, 0),
      gil = this.enemies.reduce((sum, c) => sum + c.gil, 0);
    const recipients = this.players.filter((c) => c.hp > 0),
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
        c.maxHp = Math.min(9999, c.maxHp + growth.hp);
        c.maxMp = Math.min(999, c.maxMp + growth.mp);
      }
      c.level = Math.max(c.level, level);
      if (c.level !== from) levels.push({ id: c.id, from, to: c.level });
    }
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
  takeVictory(): { players: Combatant[]; gil: number } | null {
    if (this.phase !== "victory" || !this.reward || this.collected) return null;
    this.collected = true;
    return {
      players: structuredClone(this.players).map((c) => ({
        ...c,
        atb: 0,
        queued: false,
      })),
      gil: this.reward.gil,
    };
  }
}
