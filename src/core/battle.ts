import { atbIncrement } from "./atb.js";
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
  target: string;
  ability: number;
  charge: number;
  elapsed: number;
  resolved: boolean;
  amount: number | null;
  missed: boolean;
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
  constructor(
    readonly content: BattleContent,
    seed: number,
    players?: Combatant[],
  ) {
    if (
      content.kind !== "opening-battle-development" ||
      content.profile !== "opening-playability-v1"
    )
      throw new Error("Unsupported battle runtime profile");
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new Error("Invalid battle seed");
    this.randomState = seed || 1;
    this.combatants = [
      ...(players
        ? structuredClone(players)
        : content.players.map((p) => ({
            ...p,
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
    for (const c of this.combatants) {
      const range = content.initialAtb[c.side];
      c.atb = this.randomInt(range[0], range[1]);
      c.queued = false;
    }
    this.log("守卫挡住了去路。");
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
  targets(actorId: string, abilityId: number): Combatant[] {
    const actor = this.combatants.find((c) => c.id === actorId),
      ability = this.content.abilities[abilityId];
    if (
      !actor ||
      !ability ||
      !actor.abilities.includes(abilityId) ||
      ability.kind === "unsupported"
    )
      return [];
    return this.combatants.filter(
      (t) =>
        t.hp > 0 &&
        (ability.target === "ally"
          ? t.side === actor.side
          : t.side !== actor.side),
    );
  }
  command(actorId: string, abilityId: number, targetId: string): boolean {
    if (this.phase !== "active") return false;
    const actor = this.ready.find((c) => c.id === actorId),
      ability = this.content.abilities[abilityId];
    if (
      !actor ||
      !ability ||
      ability.kind === "unsupported" ||
      actor.mp < ability.cost ||
      !this.targets(actorId, abilityId).some((t) => t.id === targetId)
    )
      return false;
    this.enqueue(actor, ability, targetId);
    return true;
  }
  private enqueue(
    actor: Combatant,
    ability: AbilityDefinition,
    target: string,
  ) {
    actor.queued = true;
    this.queue.push({
      actor: actor.id,
      target,
      ability: ability.id,
      charge:
        actor.side === "player"
          ? Math.round((1000 * ability.wait * 20) / (actor.agility * 0.5 + 20))
          : 0,
      elapsed: 0,
      resolved: false,
      amount: null,
      missed: false,
    });
  }
  advance(ms: number) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000)
      throw new Error("Invalid battle elapsed time");
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
        const targets = this.players.filter((p) => p.hp > 0);
        if (!targets.length) break;
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
        if (!ability || ability.kind !== "physical")
          throw new Error("Unsupported enemy AI action");
        this.enqueue(
          c,
          ability,
          targets[this.randomInt(0, targets.length - 1)]!.id,
        );
      }
    }
    const index = this.queue.findIndex((a) => a.charge === 0);
    if (index >= 0) {
      const action = this.queue.splice(index, 1)[0]!,
        actor = this.combatants.find((c) => c.id === action.actor)!;
      if (actor.hp <= 0) {
        actor.queued = false;
        return;
      }
      const targets = this.targets(actor.id, action.ability);
      if (!targets.some((t) => t.id === action.target)) {
        // Revalidate at execution. Dead enemies never absorb another queued attack.
        if (!targets.length) {
          actor.queued = false;
          actor.atb = 0;
          this.checkOutcome();
          return;
        }
        action.target = targets[0]!.id;
      }
      this.action = action;
      this.log(
        `${actor.name} · ${this.content.abilities[action.ability]!.name}`,
      );
    }
    this.checkOutcome();
  }
  private resolve(action: BattleAction) {
    const actor = this.combatants.find((c) => c.id === action.actor)!,
      target = this.combatants.find((c) => c.id === action.target)!;
    const ability = this.content.abilities[action.ability]!;
    action.resolved = true;
    if (actor.hp <= 0 || target.hp <= 0 || actor.mp < ability.cost) return;
    actor.mp -= ability.cost;
    let amount: number;
    if (ability.kind === "physical") {
      // Bounded Guard branch. Accuracy/evasion and multiply order are provisional.
      if (this.randomInt(0, 99) < Math.min(100, target.evasion)) {
        action.missed = true;
        action.amount = 0;
        this.log(`${target.name} 闪避了攻击。`);
        return;
      }
      const base = Math.trunc(
        ((this.randomInt(56, 63) + 4 * actor.attack) *
          actor.level *
          actor.level) /
          256,
      );
      const varied =
        Math.trunc(
          (base * ability.multiplier * this.randomInt(224, 255)) / 256,
        ) + 1;
      amount = Math.max(
        1,
        Math.trunc(((255 - target.defense) * varied) / 256) + 1,
      );
    } else if (ability.kind === "beam" || ability.kind === "heal") {
      const base =
        Math.trunc((actor.level * actor.magic * ability.power) / 32) +
        4 * ability.power;
      const varied = Math.trunc((base * this.randomInt(224, 255)) / 256) + 1;
      amount =
        ability.kind === "heal"
          ? varied
          : Math.max(
              1,
              Math.trunc(((255 - target.magicDefense) * varied) / 256) + 1,
            );
    } else throw new Error("Unimplemented ability cannot execute");
    action.amount = amount;
    if (ability.kind === "heal") {
      target.hp = Math.min(target.maxHp, target.hp + amount);
      this.log(`${target.name} 恢复 ${amount} HP。`);
    } else {
      target.hp = Math.max(0, target.hp - amount);
      this.log(`${target.name} 受到 ${amount} 点伤害。`);
    }
  }
  private checkOutcome() {
    if (this.phase !== "active" || this.action) return;
    if (!this.players.some((c) => c.hp > 0)) {
      this.phase = "defeat";
      this.queue = [];
      this.log("队伍倒下了。");
      return;
    }
    if (this.enemies.some((c) => c.hp > 0)) return;
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
