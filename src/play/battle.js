import { MonsterAI } from "./monster-ai.js";
import { BattleEvents } from "./battle-events.js";
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const value = (n, fallback) =>
  Number.isFinite(Number(n)) ? Number(n) : fallback;

// SNES CalcDmg/CalcMagicDmg and CalcDmgMod. PR power and participant stats take precedence.
export function calculateDamage(
  actor,
  target,
  ability,
  random = Math.random,
  targetCount = 1,
) {
  const physical = ability.kind === "physical";
  const power = value(ability.power, 0);
  const level = value(actor.level, 1);
  const healing = ability.kind === "heal";
  const accuracy = ability.flags?.includes(1)
    ? 255
    : value(ability.accuracy, actor.accuracy ?? 100);
  const evade = clamp(
    value(physical ? target.evasion : target.magicEvasion, 0),
    0,
    128,
  );
  if (
    !healing &&
    accuracy < 255 &&
    random() * 100 >= Math.floor(((256 - evade * 2) * accuracy) / 256)
  ) {
    return { amount: 0, missed: true, critical: false };
  }
  let base;
  if (physical) {
    const attack = value(actor.attack, 20) + power;
    base =
      actor.side === "enemy"
        ? Math.floor(
            ((56 + Math.floor(random() * 8) + 4 * attack) * level * level) /
              256,
          )
        : attack +
          Math.floor(
            ((level *
              level *
              (Math.min(255, value(actor.strength, 30) * 2) + attack)) /
              256) *
              1.5,
          );
    base = Math.floor(base * value(ability.multiplier, 1));
    if (actor.row === "back") base = Math.floor(base / 2);
  } else {
    const magic = value(actor.magic, 30);
    base =
      power * 4 +
      Math.floor(
        (level * magic * power * (actor.side === "enemy" ? 1.5 : 1)) / 32,
      );
  }
  let amount = Math.floor((base * (224 + Math.floor(random() * 32))) / 256) + 1;
  if (!healing && !ability.flags?.includes(5)) {
    const defense = clamp(
      value(physical ? target.defense : target.magicDefense, 0),
      0,
      255,
    );
    amount = Math.floor((amount * (255 - defense)) / 256) + 1;
    if ((physical && target.protect) || (!physical && target.shell))
      amount = Math.floor((amount * 170) / 256) + 1;
    if (physical && target.row === "back") amount = Math.floor(amount / 2);
    if (physical && target.defending) amount = Math.floor(amount / 2);
  }
  const critical = physical && random() * 100 < value(actor.criticalRate, 0);
  if (critical) amount *= 2;
  const affinities = (ability.elements ?? []).map(
    (id) => target.elementResistances?.[id],
  );
  if (affinities.includes(4)) amount = -amount;
  else if (affinities.includes(3)) amount = 0;
  else if (affinities.includes(2)) amount = Math.floor(amount / 2);
  else if (affinities.includes(1)) amount *= 2;
  if (targetCount > 1 && !ability.flags?.includes(2))
    amount = Math.trunc(amount / 2);
  return {
    amount: clamp(Math.trunc(amount), -9999, 9999),
    missed: false,
    critical,
  };
}

export function atbRate(unit, battleSpeed = 3) {
  // UpdateBattleTime runs once per two SNES frames; CalcSpeed gives 6*(speed+20).
  const enemyFactor =
    unit.side === "enemy" ? (255 - clamp(battleSpeed, 0, 7) * 24) / 256 : 1;
  return ((value(unit.speed, 30) + 20) * 6 * enemyFactor * 30 * 100) / 65536;
}

export class Battle {
  constructor({
    data = {},
    party = [],
    encounterId,
    inventory = {},
    random = Math.random,
    warn = () => {},
    onEnd = () => {},
    banks = {},
    character,
    event = () => {},
    eventCallbacks = {},
    isVeldt = false,
    context = {},
    finalParty = null,
  }) {
    this.data = data;
    this.banks = banks;
    this.character = character || ((id) => ({ ...data.characters?.[id], id }));
    this.event = event;
    this.eventCallbacks = eventCallbacks;
    this.context = context;
    this.finalParty = finalParty ?? context.finalParty ?? [];
    this.isVeldt = Boolean(isVeldt || context.isVeldt);
    this.aiQueue = [];
    this.ais = [];
    this.draining = false;
    this.inventory = inventory;
    this.random = random;
    this.warn = warn;
    this.onEnd = onEnd;
    this.encounterId = encounterId;
    this.formation = data.parties?.[encounterId] ?? { members: [] };
    this.players = party;
    this.enemies = [];
    this.phase = "active";
    this.log = [];
    this.elapsed = 0;
    this.turns = 0;
    this.outcome = null;
    this.result = null;
    this.warnings = new Set();

    this.yielded = false;
    this.players.forEach((unit, index) =>
      this.completeUnit(
        unit,
        data.characters?.[unit.id] ?? {},
        "player",
        index,
      ),
    );
    for (const [index, member] of (this.formation.members ?? []).entries()) {
      const base = data.monsters?.[member.monsterId];
      if (!base) {
        this.warning(`Missing monster ${member.monsterId}; skipped.`);
        continue;
      }
      const enemy = { ...base, ...member, monsterId: base.id };
      this.completeUnit(enemy, base, "enemy", index);
      this.enemies.push(enemy);
    }
    if (!data.parties?.[encounterId])
      this.warning(
        `Missing formation ${encounterId}; empty battle returns victory.`,
      );
    this.ymirHead = this.enemies.find((unit) => unit.role === "ymir-head");
    this.ymirShell = this.enemies.find((unit) => unit.role === "ymir-shell");
    if (this.ymirHead && this.ymirShell)
      this.addLog("尤弥尔的壳会吸收雷电。趁头部出现时攻击！");
    this.addLog(
      `遭遇：${this.enemies.map((unit) => unit.name).join("、") || "无敌人"}`,
    );
    const veldtEvent = this.isVeldt
      ? (context.worldOfRuin ?? Number(banks.ScenarioFlag2?.[44] ?? 0) === 1)
        ? "sc_b_0738" : "sc_b_0239"
      : null;
    this.events = new BattleEvents(this, context.eventProgram ?? veldtEvent);
    for (const enemy of this.enemies) this.setupAI(enemy);
    this.events.tick(0);
    this.drainAI();
    this.checkEnd();
  }

  completeUnit(unit, base, side, index) {
    for (const [key, entry] of Object.entries(base))
      if (unit[key] === undefined) unit[key] = entry;
    unit.id ??= index + 1;
    unit.name ??= side === "player" ? `角色 ${unit.id}` : `怪物 ${unit.id}`;
    unit.maxHp = Math.max(1, value(unit.maxHp, value(unit.hp, 100)));
    unit.hp = clamp(value(unit.hp, unit.maxHp), 0, unit.maxHp);
    unit.maxMp = Math.max(0, value(unit.maxMp, value(unit.mp, 20)));
    unit.mp = clamp(value(unit.mp, unit.maxMp), 0, unit.maxMp);
    for (const [key, fallback] of Object.entries({
      level: 3,
      strength: 30,
      magic: 30,
      defense: 40,
      magicDefense: 30,
      speed: 30,
      attack: 30,
      accuracy: 100,
    }))
      unit[key] = value(unit[key], fallback);
    unit.side = side;
    unit.index = index;
    if (Array.isArray(unit.abilities)) unit.abilities = [...unit.abilities];
    unit.atb = clamp(
      ((unit.speed +
        this.random() * unit.speed +
        this.random() * 72 +
        Math.max(
          0,
          10 - this.players.length - (this.formation.members?.length ?? 0),
        ) *
          16) /
        256) *
        100,
      0,
      95,
    );
    unit.ready = false;
    unit.hidden = false;
    unit.defending = false;
    unit.stopUntil = 0;
    if (unit.stopConditionId)
      unit.conditions = (unit.conditions ?? []).filter(
        (id) => id !== unit.stopConditionId,
      );
    unit.stopConditionId = null;
    unit.normalSprite ??= base.sprite ?? unit.sprite;
    unit.sprite = unit.magitek
      ? (unit.magitekSprite ?? unit.sprite)
      : (unit.normalSprite ?? unit.sprite);
  }

  setupAI(unit) {
    const ai = new MonsterAI(this, unit, this.data.aiPrograms?.[unit.aiName]);
    this.ais.push(ai);
    return ai;
  }
  addPlayer(id) {
    const old = this.players.find((p) => p.id === id);
    if (old) {
      old.removed = false;
      old.hidden = false;
      old.escaped = false;
      return old;
    }
    const unit = this.character(id);
    this.completeUnit(
      unit,
      this.data.characters?.[id] || {},
      "player",
      this.players.length,
    );
    unit.removed = false;
    unit.escaped = false;
    this.players.push(unit);
    return unit;
  }
  addEnemy(monsterId, uniqueId) {
    const base = this.data.monsters?.[monsterId];
    if (!base) {
      this.warning(`Missing reinforcement ${monsterId}; skipped.`);
      return null;
    }
    const unit = { ...base, monsterId, slot: uniqueId - 1, uniqueId };
    this.completeUnit(unit, base, "enemy", this.enemies.length);
    const old = this.enemies.find(
      (u) => (u.uniqueId ?? u.slot + 1) === uniqueId,
    );
    if (old) {
      old.removed = true;
      this.enemies.splice(this.enemies.indexOf(old), 1, unit);
    } else this.enemies.push(unit);
    this.setupAI(unit);
    return unit;
  }
  changeEnemyParty(id, { hidden = false } = {}) {
    const source = this.data.parties?.[id];
    if (!source) {
      this.warning(`Missing replacement party ${id}; skipped.`);
      return;
    }
    for (const unit of this.enemies) unit.removed = true;
    this.enemies = [];
    for (const m of source.members) {
      const unit = this.addEnemy(m.monsterId, m.slot + 1);
      if (unit) unit.hidden = hidden;
    }
    this.event("battle-party", { partyId: id });
  }
  queueAIAction(action) {
    action.depth = Math.max(action.depth || 0, (this.actionDepth || 0) + 1);
    if (action.depth > 8) {
      this.warning(
        `AI ${action.script}:${action.index}: reaction chain stopped at depth 8.`,
      );
      return;
    }
    if (this.aiQueue.length < 256) this.aiQueue.push(action);
    else
      this.warning(
        `AI ${action.script}:${action.index}: action queue limit reached.`,
      );
  }
  alive(unit) {
    return unit.hp > 0 && !unit.removed && !unit.escaped;
  }
  targetable(unit) {
    return this.alive(unit) && !unit.hidden && !unit.untargetable;
  }
  supported(ability) {
    if (!ability) return false;
    if (["ADD_VARIABLE_CALC", "SET_VARIABLE_CALC"].includes(ability.process) &&
        (!Number.isInteger(ability.dataB) || ability.dataB < 0 || ability.dataB >= 15 || !Number.isFinite(ability.dataC))) return false;
    if (ability.functions && !ability.functions.length) return false;
    if (
      !["None", "multiply", "SM_ERASER", "BATTLE_FORCE", "BATTLE_FORCE_ON_SAVE", "ADD_VARIABLE_CALC", "SET_VARIABLE_CALC"].includes(
        ability.process || "None",
      )
    )
      return false;
    return (
      ability.functions || [{ id: ability.functionId || 0, values: [] }]
    ).every(
      (f) =>
        [0, 1, 2, 3, 11, 15, 16, 23, 38, 52].includes(f.id) ||
        (f.id === 19 && ["ADD_VARIABLE_CALC", "SET_VARIABLE_CALC"].includes(ability.process)) ||
        (f.id === 9 &&
          ((f.values?.[0] || 0) >= 60 ||
            [5, 12, 17, 26].includes(f.values?.[0]))),
    );
  }
  selectAITargets(actor, ability, forced, all = false) {
    if (ability.range === 5) return [actor];
    const allies = actor.side === "enemy" ? this.enemies : this.players,
      opponents = actor.side === "enemy" ? this.players : this.enemies;
    const revive = (ability.functions || []).some(
        (f) => f.id === 11 && f.values[0] === 5,
      ),
      control = (ability.functions || []).some((f) => [9, 11].includes(f.id)),
      eligible = (units) =>
        units.filter(
          (u) =>
            !u.removed &&
            !u.escaped &&
            (revive ? u.hp <= 0 : control ? u.hp > 0 : this.targetable(u)),
        );
    if (forced) {
      const list = eligible(Array.isArray(forced) ? forced : [forced]);
      if (list.length) return all || Array.isArray(forced) ? list : [list[0]];
    }
    let pool = (actor.conditions || []).includes(12)
      ? [...allies, ...opponents]
      : [1, 2, 12].includes(ability.range) || ability.kind === "heal"
        ? allies
        : ability.range === 9
          ? [...allies, ...opponents]
          : opponents;
    pool = eligible(pool);
    if (!pool.length) return [];
    if (all || [2, 4, 8, 9, 16].includes(ability.range)) return pool;
    return [pool[Math.floor(this.random() * pool.length)]];
  }
  drainAI() {
    if (this.draining) return;
    this.draining = true;
    try {
      let steps = 0;
      while (this.aiQueue.length && steps++ < 64 && this.phase === "active") {
        const action = this.aiQueue.shift();
        if (!action.final && !this.alive(action.actor)) continue;
        let ability = this.data.abilities?.[action.abilityId],
          forced = action.target;
        if (!this.supported(ability) || ability.mp > action.actor.mp) {
          const reason = this.supported(ability) ? "has insufficient MP" : "effect is not implemented";
          this.warning(`AI ${action.script}:${action.index}: ability ${action.abilityId} ${reason}; using Fight.`);
          ability = this.data.abilities?.[1] || {
            id: 1,
            kind: "physical",
            power: 0,
            range: 3,
            systemId: 3,
            typeId: 4,
          };
          forced = null;
        }
        for (const key of action.messages || [])
          if (key)
            this.addLog(
              this.data.messages?.[key]?.replaceAll("\\n", "\n") || key,
            );
        action.actor.mp = Math.max(0, action.actor.mp - (ability.mp || 0));
        const targets = this.selectAITargets(
          action.actor,
          ability,
          forced,
          action.all,
        );
        const previousDepth = this.actionDepth;
        this.actionDepth = action.depth;
        for (const [index, target] of targets.entries())
          this.perform(action.actor, target, ability, targets.length, { updateVariables: index === 0 });
        this.actionDepth = previousDepth;
        this.events?.advance();
      }
      if (this.aiQueue.length)
        this.warning(
          "AI reaction cascade yielded after 64 actions; remaining actions resume next tick.",
        );
    } finally {
      this.draining = false;
    }
  }
  notifyAction(action) {
    this.lastAction = action;
    this.events?.onAction(action);
    for (const ai of this.ais) {
      if (ai.unit.removed || ai.unit.escaped) continue;
      if (ai.unit === action.target && action.actor !== action.target) {
        ai.wake(ai.unit.hp <= 0 ? "final" : "reaction", action);
      } else if (action.actor?.side === "player" && ai.unit.hp > 0)
        ai.wake("observer", action);
    }
    this.drainAI();
  }
  warning(message) {
    if (this.warnings.has(message)) return;
    this.warnings.add(message);
    this.warn(message);
  }

  addLog(message) {
    this.log.push(message);
    if (this.log.length > 120) this.log.shift();
  }

  commandsFor(actorIndex) {
    const unit = this.players[actorIndex];
    if (!unit) return [];
    const ids = unit.magitek
      ? [
          1,
          218,
          219,
          220,
          222,
          ...(Number(unit.id) === 1 ? [221, 223, 224, 225] : []),
          2,
        ]
      : [
          ...new Set([
            1,
            ...(unit.abilities ?? []).map((a) =>
              typeof a === "object" ? a.id : a,
            ),
            2,
          ]),
        ];
    return ids
      .map(
        (id) =>
          this.data.abilities?.[id] ?? {
            id,
            name: id === 1 ? "战斗" : id === 2 ? "防御" : `技能 ${id}`,
            mp: 0,
            kind: id === 2 ? "defend" : "physical",
            target: "enemy",
          },
      )
      .map((a) => ({ ...a, disabled: a.mp > unit.mp }))
      .concat(this.itemsFor(actorIndex));
  }

  itemsFor(actorIndex) {
    if (!this.players[actorIndex]) return [];
    const names = {
      1: "恢复剂",
      2: "高级恢复剂",
      3: "全恢复剂",
      4: "以太",
      5: "高级以太",
      6: "超级以太",
      7: "万能药",
      8: "全体万能药",
      9: "凤凰之尾",
      23: "干肉",
    };
    return Object.entries(this.inventory).flatMap(([contentId, count]) => {
      const content = this.data.contents?.[contentId];
      const item =
        content?.type_id === 1 ? this.data.items?.[content.type_value] : null;
      if (
        !(count > 0) ||
        !item ||
        ![1, 2, 3, 4].includes(item.battle_function_group_id)
      )
        return [];
      return [
        {
          id: `item:${contentId}`,
          contentId: Number(contentId),
          itemId: item.id,
          name: names[item.id] ?? `道具 ${item.id}`,
          kind: "item",
          // PR range7 permits either side. Food defaults to the hungry Gau
          // when he is present; an explicit side can still select a player.
          target: item.id === 23 && this.enemies.some(enemy =>
            [549, 550].includes(enemy.monsterId) && this.targetable(enemy)) ? "enemy" : "ally",
          targetSides: item.battle_renge_id === 7 ? ["player", "enemy"] : ["player"],
          mp: 0,
          count,
          revive: item.battle_function_group_id === 2,
          amount: item.standard_value,
          all: item.battle_renge_id === 2,
          disabled: false,
        },
      ];
    });
  }

  useItem(actorIndex, contentId, targetIndex = actorIndex) {
    const actor = this.players[actorIndex],
      command = this.itemsFor(actorIndex).find(
        (item) => item.contentId === Number(contentId),
      );
    if (
      this.phase !== "active" ||
      !actor ||
      !this.targetable(actor) ||
      !this.events.interactive ||
      this.events.paused ||
      !actor.ready ||
      !command ||
      actor.stopUntil > this.elapsed
    )
      return false;
    const requestedSide = typeof targetIndex === "object" && targetIndex !== null
      ? targetIndex.side : command.target === "enemy" ? "enemy" : "player";
    const side = requestedSide === 2 || requestedSide === "enemy" ? "enemy" : "player";
    if (!command.targetSides.includes(side)) return false;
    const pool = side === "enemy" ? this.enemies : this.players;
    const index = typeof targetIndex === "object" && targetIndex !== null ? targetIndex.index : targetIndex;
    const target = pool[index];
    if (!target || target.removed || target.escaped || target.hidden ||
      (command.revive ? target.hp > 0 : target.hp <= 0))
      return false;
    const item = this.data.items[command.itemId],
      group = item.battle_function_group_id;
    const targets = command.all
      ? pool.filter((unit) =>
          !unit.removed && !unit.escaped && !unit.hidden && (command.revive ? unit.hp <= 0 : unit.hp > 0),
        )
      : [target];
    this.inventory[contentId] -= 1;
    for (const unit of targets) {
      const hpBefore = unit.hp,
        mpBefore = unit.mp;
      if (group === 2) {
        unit.hp = Math.max(1, Math.floor(unit.maxHp / 8));
        unit.conditions = (unit.conditions ?? []).filter(
          (condition) => condition !== 5,
        );
        unit.atb = 0;
        unit.ready = false;
      } else {
        if (group === 1 || group === 4)
          unit.hp = Math.min(unit.maxHp, unit.hp + item.standard_value);
        if (group === 3 || group === 4)
          unit.mp = Math.min(unit.maxMp, unit.mp + item.standard_value);
      }
      this.notifyAction({
        actor,
        target: unit,
        item: command,
        hit: true,
        depth: 0,
        amount: hpBefore - unit.hp,
        mp: mpBefore - unit.mp,
        time: this.elapsed,
      });
      this.addLog(
        `${actor.name} → ${unit.name}：${command.name}，${group === 2 ? "复活，" : ""}HP +${unit.hp - hpBefore}，MP +${unit.mp - mpBefore}`,
      );
    }
    actor.defending = false;
    this.consumeTurn(actor);
    this.checkEnd();
    return true;
  }

  get commands() {
    return this.players.map((_, index) => this.commandsFor(index));
  }
  get readyPlayers() {
    return this.players.filter((unit) => unit.hp > 0 && unit.ready);
  }

  tick(seconds, auto = false) {
    let remaining = Math.max(0, value(seconds, 0));
    while (remaining > 0 && this.phase === "active") {
      const step = Math.min(remaining, 1 / 30);
      remaining -= step;
      this.elapsed += step;
      this.events.tick(step);
      for (const ai of this.ais) if (!ai.unit.removed) ai.tick();
      this.drainAI();
      this.checkEnd();
      if (this.phase !== "active") break;
      if (this.events.paused) continue;
      for (const unit of [...this.players, ...this.enemies]) {
        if (
          !this.alive(unit) ||
          unit.hidden ||
          (unit.side === "enemy" && this.events.enemySleeping)
        )
          continue;
        if (unit.stopUntil > this.elapsed) continue;
        if (unit.stopConditionId) {
          unit.conditions = (unit.conditions ?? []).filter(
            (id) => id !== unit.stopConditionId,
          );
          unit.stopConditionId = null;
          this.addLog(`${unit.name}恢复了行动。`);
        }
        unit.atb = Math.min(
          100,
          unit.atb + atbRate(unit, this.data.battleSpeed ?? 3) * step,
        );
        unit.ready = unit.atb >= 100;
        if (!unit.ready) continue;
        if (unit.side === "enemy") this.enemyTurn(unit);
        else if (auto && this.events.interactive) this.autoTurn(unit);
        if (this.phase !== "active") break;
      }
    }
    this.events.advance();
    this.drainAI();
    this.checkEnd();
    return this.phase;
  }

  autoTurn(unit) {
    const index = this.players.indexOf(unit);
    const command = this.events?.autoCommand(unit);
    if (command && this.choose(index, command.abilityId, command.targetIndex))
      return;
    if (this.ymirHead?.hidden) {
      this.choose(index, 2);
      return;
    }
    const weak = this.players.reduce(
      (best, actor) =>
        actor.hp > 0 &&
        actor.hp / actor.maxHp < (best?.hp / best?.maxHp ?? Infinity)
          ? actor
          : best,
      null,
    );
    if (unit.magitek && weak && weak.hp < weak.maxHp * 0.55) {
      this.choose(index, 222, this.players.indexOf(weak));
      return;
    }
    if (weak && weak.hp < weak.maxHp * 0.45) {
      const cure = this.commandsFor(index).find(
        (ability) => ability.kind === "heal" && !ability.disabled,
      );
      if (cure && this.choose(index, cure.id, this.players.indexOf(weak)))
        return;
      const potion = this.itemsFor(index).find(
        (item) =>
          !item.revive &&
          [1, 4].includes(
            this.data.items[item.itemId].battle_function_group_id,
          ),
      );
      if (
        potion &&
        this.useItem(index, potion.contentId, this.players.indexOf(weak))
      )
        return;
    }
    const target =
      this.enemies.find(
        (enemy) => this.targetable(enemy) && enemy.role !== "ymir-shell",
      ) ?? this.enemies.find((enemy) => this.targetable(enemy));
    if (target)
      this.choose(index, unit.magitek ? 218 : 1, this.enemies.indexOf(target));
    else this.choose(index, 2);
  }

  choose(actorIndex, abilityId = 0, targetIndex = 0) {
    if (typeof abilityId === "string" && abilityId.startsWith("item:"))
      return this.useItem(actorIndex, Number(abilityId.slice(5)), targetIndex);
    const actor = this.players[actorIndex];
    if (
      this.phase !== "active" ||
      !actor ||
      !this.targetable(actor) ||
      !this.events.interactive ||
      !actor.ready ||
      actor.stopUntil > this.elapsed
    )
      return false;
    const id = Number(abilityId) || 1;
    const ability = this.commandsFor(actorIndex).find(
      (command) => command.id === id,
    );
    if (!ability) {
      this.warning(`Unavailable ability ${id}; using Fight.`);
      return this.choose(actorIndex, 1, targetIndex);
    }
    if (ability.mp > actor.mp) {
      this.addLog(`${actor.name}的魔力不足。`);
      return false;
    }
    actor.mp -= ability.mp ?? 0;
    actor.defending = false;
    if (ability.kind === "defend") {
      actor.defending = true;
      this.addLog(`${actor.name}防御。`);
    } else {
      const pool = ability.target === "ally" ? this.players : this.enemies;
      const target = this.targetable(pool[targetIndex] || {})
        ? pool[targetIndex]
        : pool.find((unit) => this.targetable(unit));
      if (!target) {
        this.addLog("目标暂时离开了战场。");
        this.consumeTurn(actor);
        return true;
      }
      const targets = ability.all
        ? pool.filter((unit) => this.targetable(unit))
        : [target];
      targets.forEach((unit, index) =>
        this.perform(actor, unit, ability, targets.length, { updateVariables: index === 0 }),
      );
    }
    this.consumeTurn(actor);
    this.checkEnd();
    return true;
  }

  consumeTurn(actor) {
    actor.atb = 0;
    actor.ready = false;
    this.turns += 1;
  }

  enemyTurn(actor) {
    actor.aiState?.wake("normal");
    this.drainAI();
    this.consumeTurn(actor);
    this.checkEnd();
  }

  perform(actor, target, ability, targetCount = 1, { updateVariables = true } = {}) {
    if (!actor || !target || !ability) return;
    let original = ability;
    if (!this.supported(ability)) {
      this.warning(
        `Ability ${ability.id} effect is not implemented; using Fight.`,
      );
      ability = this.data.abilities?.[1] || {
        id: 1,
        kind: "physical",
        power: 0,
        systemId: 3,
        typeId: 4,
      };
    }
    let amount = 0,
      hit = true,
      critical = false,
      damage =
        (ability.functions || []).some((f) => [1, 2, 3].includes(f.id)) ||
        !ability.functions;
    if (updateVariables && ["ADD_VARIABLE_CALC", "SET_VARIABLE_CALC"].includes(ability.process)) {
      // PR dataB selects the attacker's fifteen-cell variable bank; dataC is
      // the operand. This companion effect runs once for the entire action,
      // including an all-target action, without suppressing its primary damage.
      const variable = ability.dataB, vars = actor.aiState?.vars;
      if (vars) vars[variable] = (ability.process === "SET_VARIABLE_CALC" ? ability.dataC :
        (vars[variable] ?? 0) + ability.dataC) | 0;
    }
    if (ability.process === "SM_ERASER") {
      target.hp = 0;
      target.ready = false;
      target.removed = true;
      damage = false;
    }
    for (const fn of ability.functions || []) {
      const id = fn.values?.[0];
      switch (fn.id) {
        case 9:
        case 11: {
          const add = fn.id === 9;
          target.conditions ??= [];
          target.conditions = add
            ? [...new Set([...target.conditions, id])]
            : target.conditions.filter((x) => x !== id);
          const row = this.data.conditions?.[id],
            type = row?.condition_type;
          if (id === 5) {
            target.hp = add ? 0 : Math.max(1, target.hp);
            target.ready = false;
          }
          if (id === 67 || type === 625) target.hidden = add;
          if (id === 76 || type === 667) target.untargetable = add;
          if (id === 79 || id === 80)
            target.disguise = add ? (id === 79 ? 2 : 1) : 0;
          if (type === 17) {
            target.stopUntil = add
              ? this.elapsed + Math.max(1, row.until_value || 30)
              : 0;
            target.ready = false;
          }
          break;
        }
        case 38:
          target.conditions = (target.conditions || []).filter((x) => x !== id);
          break;
        case 15:
          target.defending = true;
          break;
        case 16:
          target.escaped = true;
          target.hidden = true;
          target.ready = false;
          break;
        case 52: {
          const chance = Math.min(
            100,
            Math.max(5, 50 + (actor.level - target.level) * 2),
          );
          hit = this.random() * 100 < chance;
          if (hit && !target.stolen) {
            const item = target.steal?.find((x) => x.id > 0);
            if (item)
              this.inventory[item.id] =
                (this.inventory[item.id] || 0) + (item.count || 1);
            target.stolen = true;
          }
          break;
        }
      }
    }
    if (damage) {
      const result = calculateDamage(
        actor,
        target,
        ability,
        this.random,
        targetCount,
      );
      hit = !result.missed;
      critical = result.critical;
      if (hit) {
        amount = ability.kind === "heal" ? -result.amount : result.amount;
        amount =
          this.events?.beforeDamage(actor, target, ability, amount) ?? amount;
        target.hp = clamp(target.hp - amount, 0, target.maxHp);
      }
    }
    if (target.hp <= 0) {
      target.ready = false;
      target.atb = 0;
    }
    const action = {
      actor,
      target,
      ability,
      depth: this.actionDepth || 0,
      selectedAbilityId: original.id,
      amount,
      critical,
      hit,
      time: this.elapsed,
    };
    this.addLog(
      `${actor.name} → ${target.name}：${ability.name || "战斗"}${hit ? (amount ? " " + (amount < 0 ? "回复 " : "") + Math.abs(amount) : "") : " 未命中"}`,
    );
    this.notifyAction(action);
  }

  checkEnd() {
    if (this.phase !== "active") return;
    const outcome =
      this.events?.forcedOutcome?.outcome ||
      (!this.players.some((unit) => this.alive(unit))
        ? "defeat"
        : !this.enemies.some((unit) => this.alive(unit))
          ? "victory"
          : null);
    if (!outcome) return;
    if (
      this.aiQueue.length ||
      this.ais.some(
        (ai) =>
          !ai.unit.removed &&
          !ai.unit.escaped &&
          (ai.running || ai.pending.length),
      )
    )
      return;
    if (this.events && !this.events.beforeEnd(outcome)) return;
    this.phase = outcome;
    this.outcome = outcome;
    this.result = {
      outcome,
      code:
        this.events?.forcedOutcome?.code ??
        this.events?.resultCode?.(outcome) ??
        (outcome === "victory" ? 0 : outcome === "escape" ? 1 : 2),
      exp: 0,
      gil: 0,
      ap: 0,
      drops: [],
    };
    if (outcome === "victory") {
      const rewardEnemies = [...(this.events?.state.veldtDefeated ?? []), ...this.enemies];
      for (const enemy of rewardEnemies) {
        if (!this.isVeldt) this.result.exp += enemy.exp ?? 0;
        this.result.gil += enemy.gil ?? 0;
        if (enemy.drops?.length && this.random() * 100 < (enemy.dropRate ?? 0))
          this.result.drops.push({
            ...enemy.drops[Math.floor(this.random() * enemy.drops.length)],
          });
      }
      this.result.ap = this.formation.ap ?? 0;
      const survivors = this.players.filter((unit) => this.alive(unit));
      const share = Math.floor(this.result.exp / Math.max(1, survivors.length));
      survivors.forEach((unit) => {
        unit.exp = (unit.exp ?? 0) + share;
        for (const row of this.data.expTable ?? []) {
          if (
            row.group_id !== 1 ||
            row.lv <= unit.level ||
            row.total_exp > unit.exp
          )
            continue;
          unit.level = row.lv;
          const growth = this.data.growth?.find(
            (g) => g.group_id === 1 && g.lv === row.lv,
          );
          unit.maxHp = Math.min(9999, unit.maxHp + (growth?.hp_value1 ?? 0));
          unit.maxMp = Math.min(999, unit.maxMp + (growth?.mp_value1 ?? 0));
          for (const spell of unit.naturalLearning ?? [])
            if (spell.level <= unit.level) {
              unit.abilities ??= [1, 2];
              if (!unit.abilities.includes(spell.abilityId))
                unit.abilities.push(spell.abilityId);
            }
          this.addLog(`${unit.name}升到了 ${unit.level} 级！`);
        }
      });
    }
    this.addLog(
      outcome === "victory"
        ? `胜利！经验 ${this.result.exp}，金币 ${this.result.gil}。`
        : "队伍倒下了。",
    );
    if (!this.yielded) {
      this.yielded = true;
      this.onEnd(this.result);
    }
  }
}
