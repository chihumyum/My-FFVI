import { canEquip, equip as equipResource } from "./resources.js";
import {
  commandMenu,
  actionFor,
  blitzInputs,
  validBlitz,
  effectiveCommandIds,
} from "./battle-commands.js";
import {
  initRole,
  observeLore,
  beginRoleAction,
  forcedRoleTurn,
  tickRole,
  finishRoles,
} from "./role-commands.js";
import { abilityMpCost, applyBattleRewards } from "./progression.js";
import { MonsterAI } from "./monster-ai.js";
import { BattleEvents } from "./battle-events.js";
import { autoBattleInput } from "./battle-input.js";
import { weaponDamagePlan, finalizeWeaponDamage } from "./weapon-damage.js";
import { requestEscape as requestBattleEscape, tickEscape, canEscape } from "./escape.js";
import {
  FUNCTION_EFFECTS,
  PROCESS_EFFECTS,
  abilityFromItem,
  isRevival,
  executeAbilityEffects,
  setCondition,
  hasConditionType,
  actionBlocked,
  conditionSpeed,
  tickConditions,
  forcedConditionAction,
  throwableCommands,
  applyWeaponEffects,
} from "./ability-effects.js";
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const value = (n, fallback) => (Number.isFinite(Number(n)) ? Number(n) : fallback);

// SNES CalcDmg/CalcMagicDmg and CalcDmgMod. PR power and participant stats take precedence.
export function calculateDamage(
  actor,
  target,
  ability,
  random = Math.random,
  targetCount = 1,
  data = {},
) {
  const weaponPlan = ability.weaponPlanResolved
    ? ability.weaponPlan
    : weaponDamagePlan(data, actor, target, ability, random);
  if (weaponPlan) ability = weaponPlan.ability;
  if (weaponPlan?.fixedAmount !== undefined)
    return finalizeWeaponDamage(weaponPlan, { amount: 0, missed: false, critical: false });
  const physical = ability.kind === "physical";
  const power = value(ability.power, 0);
  const conditions = actor.conditions || [];
  const berserk = actor.berserk || conditions.includes(18);
  const level = value(actor.level, 1);
  const healing = ability.kind === "heal";
  const accuracy = ability.flags?.includes(1)
    ? 255
    : value(ability.accuracy, actor.accuracy ?? 100);
  const evade = clamp(value(physical ? target.evasion : target.magicEvasion, 0), 0, 128);
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
        ? Math.floor(((56 + Math.floor(random() * 8) + 4 * attack) * level * level) / 256)
        : attack +
          Math.floor(
            ((level * level * (Math.min(255, value(actor.strength, 30) * 2) + attack)) / 256) * 1.5,
          );
    base = Math.floor(base * value(ability.multiplier, 1));
    if (
      actor.row === "back" &&
      !actor.ignoreRow &&
      !ability.backRow &&
      !(ability.id === 1 && actor.weaponBackRow)
    )
      base = Math.floor(base / 2);
  } else {
    const magic = value(actor.magic, 30);
    base =
      power * 4 + Math.floor((level * magic * power * (actor.side === "enemy" ? 1.5 : 1)) / 32);
  }
  base *= value(ability.multiplier, 1) === 1 || physical ? 1 : value(ability.multiplier, 1);
  if (actor.trance) base *= 2;
  if (physical && berserk) base *= 1.5;
  if (!physical && !healing && target.trance) base /= 2;
  if (conditions.includes(13) && physical) base = Math.min(base, value(actor.level, 1));
  base *= value(physical ? actor.physicalDamageMultiplier : actor.magicDamageMultiplier, 1);
  base += weaponPlan?.baseBonus || 0;
  if (physical && target.rearAttacked) base *= 1.5;
  let amount = Math.floor((base * (224 + Math.floor(random() * 32))) / 256) + 1;
  if (!healing && !ability.flags?.includes(5)) {
    const defense = clamp(value(physical ? target.defense : target.magicDefense, 0), 0, 255);
    amount = Math.floor((amount * (255 - defense)) / 256) + 1;
    if ((physical && target.protect) || (!physical && target.shell))
      amount = Math.floor((amount * 170) / 256) + 1;
    if (
      physical &&
      target.row === "back" &&
      !target.ignoreRow &&
      !ability.backRow &&
      !(ability.id === 1 && actor.weaponBackRow)
    )
      amount = Math.floor(amount / 2);
    if (physical && target.defending) amount = Math.floor(amount / 2);
  }
  const critical =
    physical && !weaponPlan?.noCritical && random() * 100 < value(actor.criticalRate, 0);
  if (critical) amount *= 2;
  const resistances = { ...(target.affinities ?? target.elementResistances ?? {}) };
  for (const id of target.conditions || []) {
    const group = data.conditions?.[id]?.attribute_group_id;
    if (group)
      for (const row of data.attributeGroups || [])
        if (row.group_id === group)
          resistances[row.attribute_id] = Math.max(resistances[row.attribute_id] || 0, row.type_id);
  }
  const affinities = (
    ability.id === 1 ? (actor.weaponElements ?? ability.elements ?? []) : (ability.elements ?? [])
  ).map((id) => resistances[id]);
  // PR PhysicalExecution uses strongest affinity; MagicExecution applies
  // authored elements in order and stops when an immunity is encountered.
  if (physical) {
    if (affinities.includes(4)) amount = -amount;
    else if (affinities.includes(3)) amount = 0;
    else if (affinities.includes(2)) amount = Math.floor(amount / 2);
    else if (affinities.includes(1)) amount *= 2;
  } else
    for (const affinity of affinities) {
      if (affinity === 3) {
        amount = 0;
        break;
      }
      if (affinity === 4) amount = -amount;
      if (affinity === 2) amount = Math.trunc(amount / 2);
      if (affinity === 1) amount *= 2;
    }
  if (targetCount > 1 && !ability.flags?.includes(2)) amount = Math.trunc(amount / 2);
  const resource = ability.functions?.some(
    (fn) => [3, 69, 77].includes(fn.id) && fn.values?.[0] === 2,
  )
    ? "mp"
    : "hp";
  const drain = ability.functions?.find((fn) => fn.id === 13),
    drainHit = ability.functions?.some((fn) => fn.id === 69);
  if (drain && drainHit) {
    const maximum = resource === "mp" ? "maxMp" : "maxHp",
      percent = Math.max(0, drain.values?.[1] ?? 100);
    const undead = target.undead || hasConditionType(data, target, 34);
    // Drain transfers only the target's supply and the recipient's capacity.
    // Undead reverse the actual transfer, rather than creating MP/HP.
    const supply = undead ? value(actor[resource], 0) : value(target[resource], 0);
    const room = undead
      ? value(target[maximum], 0) - value(target[resource], 0)
      : value(actor[maximum], 0) - value(actor[resource], 0);
    amount =
      (undead ? -1 : 1) *
      Math.min(
        Math.abs(amount),
        supply,
        percent > 0 ? Math.floor((Math.max(0, room) * 100) / percent) : 0,
      );
  }
  return finalizeWeaponDamage(weaponPlan, {
    amount: clamp(Math.trunc(amount), -9999, 9999),
    missed: false,
    critical,
    ...(resource === "mp" ? { resource } : {}),
  });
}

export function atbRate(unit, battleSpeed = 3) {
  // UpdateBattleTime runs once per two SNES frames; CalcSpeed gives 6*(speed+20).
  const enemyFactor = unit.side === "enemy" ? (255 - clamp(battleSpeed, 0, 7) * 24) / 256 : 1;
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
      this.completeUnit(unit, data.characters?.[unit.id] ?? {}, "player", index),
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
    this.initializePattern();
    if (!data.parties?.[encounterId])
      this.warning(`Missing formation ${encounterId}; empty battle returns victory.`);
    this.ymirHead = this.enemies.find((unit) => unit.role === "ymir-head");
    this.ymirShell = this.enemies.find((unit) => unit.role === "ymir-shell");
    if (this.ymirHead && this.ymirShell) this.addLog("尤弥尔的壳会吸收雷电。趁头部出现时攻击！");
    this.addLog(`遭遇：${this.enemies.map((unit) => unit.name).join("、") || "无敌人"}`);
    const veldtEvent = this.isVeldt
      ? (context.worldOfRuin ?? Number(banks.ScenarioFlag2?.[44] ?? 0) === 1)
        ? "sc_b_0738"
        : "sc_b_0239"
      : null;
    this.events = new BattleEvents(this, context.eventProgram ?? veldtEvent);
    for (const enemy of this.enemies) this.setupAI(enemy);
    this.events.tick(0);
    this.drainAI();
    this.checkEnd();
  }

  completeUnit(unit, base, side, index) {
    for (const [key, entry] of Object.entries(base)) if (unit[key] === undefined) unit[key] = entry;
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
    unit.escaped = false;
    unit.removed = false;
    unit.untargetable = false;
    if (Array.isArray(unit.abilities)) unit.abilities = [...unit.abilities];
    unit.atb = clamp(
      ((unit.speed +
        this.random() * unit.speed +
        this.random() * 72 +
        Math.max(0, 10 - this.players.length - (this.formation.members?.length ?? 0)) * 16) /
        256) *
        100,
      0,
      95,
    );
    unit.ready = false;
    unit.hidden = false;
    unit.runic = false;
    unit.magiciteUsed = false;
    unit.conditions = (unit.conditions || []).filter(
      (id) => this.data.conditions?.[id]?.condition_type !== 612,
    );
    unit.chargedAbility = null;
    unit.chargedTarget = null;
    unit.defending = false;
    unit.stopUntil = 0;
    if (unit.stopConditionId)
      unit.conditions = (unit.conditions ?? []).filter((id) => id !== unit.stopConditionId);
    unit.stopConditionId = null;
    if (side === "enemy")
      for (const id of unit.initialConditions || [])
        setCondition(this, unit, id, true, { force: true });
    for (const id of unit.permanentConditions || [])
      setCondition(this, unit, id, true, { force: true });
    unit.berserk = hasConditionType(this.data, unit, 410);
    unit.protect = hasConditionType(this.data, unit, 19);
    unit.shell = hasConditionType(this.data, unit, 412);
    unit.trance = hasConditionType(this.data, unit, 621);
    initRole(this, unit);
    unit.normalSprite ??= base.sprite ?? unit.sprite;
    unit.sprite = unit.magitek
      ? (unit.magitekSprite ?? unit.sprite)
      : (unit.normalSprite ?? unit.sprite);
  }

  initializePattern() {
    const bits = this.formation.battlePatterns ?? [1, 0, 0, 0, 0, 0];
    const choices = bits.flatMap((enabled, n) => (enabled ? [n] : []));
    this.pattern = choices.includes(this.context.pattern)
      ? this.context.pattern
      : choices.length === 1
        ? choices[0]
        : 0;
    if (choices.length > 1 && this.context.pattern === undefined) {
      const weights = [224, 32, 32, 16, 16, 16],
        total = choices.reduce((n, i) => n + weights[i], 0);
      let roll = this.random() * total;
      this.pattern = choices.find((i) => (roll -= weights[i]) < 0) ?? choices[0];
      this.warning(
        "PR battle_pattern1–6 are eligibility flags. Web selection uses SNES-inspired normal/ambush weights; exact PR probability modifiers are approximated.",
      );
    }
    const label = ["普通阵型", "先制攻击", "背袭", "敌方先制", "敌方夹击", "我方夹击"][
      this.pattern
    ];
    if (this.pattern) this.addLog(label);
    for (const u of this.players) {
      u.ignoreRow = [4, 5].includes(this.pattern);
      u.rearAttacked = this.pattern === 2 || this.pattern === 4;
    }
    for (const u of this.enemies) {
      u.ignoreRow = [4, 5].includes(this.pattern);
      u.rearAttacked = this.pattern === 5;
    }
    if ([1, 2, 3].includes(this.pattern))
      for (const u of [...this.players, ...this.enemies]) {
        u.atb = (this.pattern === 1 ? u.side === "player" : u.side === "enemy") ? 100 : 0;
        u.ready = u.atb >= 100;
      }
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
    this.completeUnit(unit, this.data.characters?.[id] || {}, "player", this.players.length);
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
    const old = this.enemies.find((u) => (u.uniqueId ?? u.slot + 1) === uniqueId);
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
      this.warning(`AI ${action.script}:${action.index}: reaction chain stopped at depth 8.`);
      return;
    }
    if (this.aiQueue.length < 256) this.aiQueue.push(action);
    else this.warning(`AI ${action.script}:${action.index}: action queue limit reached.`);
  }
  alive(unit) {
    return unit.hp > 0 && !unit.removed && !unit.escaped && !hasConditionType(this.data, unit, 11);
  }
  targetable(unit) {
    return this.alive(unit) && !unit.hidden && !unit.untargetable;
  }
  supported(ability) {
    if (
      ["ADD_VARIABLE_CALC", "SET_VARIABLE_CALC"].includes(ability?.process) &&
      (!Number.isInteger(ability.dataB) ||
        ability.dataB < 0 ||
        ability.dataB >= 15 ||
        !Number.isFinite(ability.dataC))
    )
      return false;
    if (
      ability?.functions?.length &&
      ability.functions.every((f) => FUNCTION_EFFECTS[f.id]?.[1] === "deferred") &&
      ["None", "deferred"].includes(ability.process || "None")
    )
      return false;
    return Boolean(
      ability &&
      (ability.functions || []).every((f) => FUNCTION_EFFECTS[f.id]) &&
      PROCESS_EFFECTS[ability.process || "None"],
    );
  }
  eligibleTarget(unit, ability) {
    if (!unit || unit.removed || unit.escaped || unit.hidden || unit.untargetable) return false;
    return isRevival(this.data, ability) ? unit.hp <= 0 : unit.hp > 0;
  }
  selectAITargets(actor, ability, forced, all = false) {
    if (ability.range === 5) return [actor];
    const allies = actor.side === "enemy" ? this.enemies : this.players,
      opponents = actor.side === "enemy" ? this.players : this.enemies;
    const control = (ability.functions || []).some((f) =>
        [9, 10, 11, 12, 19, 20, 23, 38, 70].includes(f.id),
      ),
      eligible = (units) =>
        units.filter(
          (u) =>
            !u.removed &&
            !u.escaped &&
            (isRevival(this.data, ability) ? u.hp <= 0 : control ? u.hp > 0 : this.targetable(u)),
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
    if (all || [2, 4, 8, 9, 16, 20, 21].includes(ability.range)) return pool;
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
        if (!ability || !this.supported(ability) || ability.functions?.some((fn) => fn.id === 51)) {
          this.warning(
            `AI ${action.script}:${action.index}: ability ${action.abilityId} effect is not implemented; using Fight.`,
          );
          ability = this.data.abilities?.[1] || {
            id: 1,
            kind: "physical",
            power: 0,
            range: 3,
            systemId: 3,
            typeId: 4,
            functions: [{ id: 2, values: [0, 0, 0] }],
          };
          forced = null;
        }
        if (ability.mp > action.actor.mp) {
          this.warning(
            `AI ${action.script}:${action.index}: ability ${action.abilityId} has insufficient MP; action fails.`,
          );
          continue;
        }
        if (
          (ability.forbiddenConditions || []).some((id) =>
            (action.actor.conditions || []).includes(id),
          )
        ) {
          this.warning(
            `AI ${action.script}:${action.index}: ability ${action.abilityId} is blocked by a PR condition; action fails.`,
          );
          continue;
        }
        for (const key of action.messages || [])
          if (key) this.addLog(this.data.messages?.[key]?.replaceAll("\\n", "\n") || key);
        action.actor.mp = Math.max(0, action.actor.mp - (ability.mp || 0));
        const targets = this.selectAITargets(action.actor, ability, forced, action.all);
        const previousDepth = this.actionDepth;
        this.actionDepth = action.depth;
        const sequence = {};
        for (const [index, target] of targets.entries())
          this.perform(action.actor, target, ability, targets.length, {
            updateVariables: index === 0,
            sequence,
          });
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
      } else if (action.actor?.side === "player" && ai.unit.hp > 0) ai.wake("observer", action);
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

  legacyActionsFor(actorIndex) {
    const unit = this.players[actorIndex];
    if (!unit) return [];
    const summonId = !unit.magiciteUsed && this.data.magicStones?.[unit.magicite]?.summonAbilityId;
    const commandAbilities = (unit.commands || []).flatMap((id) => {
      const row = this.data.commands?.[id],
        ability = this.data.abilities?.[row?.ability_id];
      if (
        !ability ||
        !(ability.functions?.length || (ability.process && ability.process !== "None"))
      )
        return [];
      if (
        row.release_type === 3 &&
        ![row.release_value1, row.release_value2]
          .filter(Boolean)
          .some((condition) => (unit.conditions || []).includes(condition))
      )
        return [];
      return [ability.id];
    });
    const ids = unit.magitek
      ? [1, 218, 219, 220, 222, ...(Number(unit.id) === 1 ? [221, 223, 224, 225] : []), 2]
      : [
          ...new Set([
            1,
            ...commandAbilities,
            ...(summonId ? [summonId] : []),
            ...(unit.abilities ?? [])
              .concat(unit.equipmentAbilities ?? [])
              .map((a) => (typeof a === "object" ? a.id : a)),
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
      .map((a) => ({
        ...a,
        magiciteSummon: a.id === summonId,
        revive: isRevival(this.data, a),
        mp: abilityMpCost(unit, a),
        selectableAll: [6, 14, 20, 21].includes(a.range),
        targetSides: [6, 7, 8, 9, 20].includes(a.range)
          ? ["player", "enemy"]
          : [1, 2, 5, 12].includes(a.range) || a.target === "ally"
            ? ["player"]
            : ["enemy"],
        disabled:
          abilityMpCost(unit, a) > unit.mp ||
          (a.forbiddenConditions || []).some((id) => (unit.conditions || []).includes(id)),
      }))
      .flatMap((command) =>
        command.functions?.some((fn) => fn.id === 51)
          ? throwableCommands(this.data, this.inventory, unit).map((choice) => ({
              ...command,
              ...choice,
              name: `投掷 · ${choice.name}`,
              disabled: command.disabled,
            }))
          : [command],
      )
      .concat(this.itemsFor(actorIndex));
  }

  commandsFor(actorIndex) {
    return commandMenu(this, actorIndex);
  }
  actionsFor(actorIndex) {
    // Small independent formula fixtures do not contain a PR command table.
    if (!Object.keys(this.data.commands ?? {}).length) return this.legacyActionsFor(actorIndex);
    return this.commandsFor(actorIndex)
      .filter((menu) => !menu.disabled)
      .flatMap((menu) => menu.actions);
  }
  setInput(mode = null) {
    this.inputMode = mode;
  }
  requestEquipment(actor) {
    this.equipmentInput = { index: this.players.indexOf(actor) };
    this.setInput("equipment");
  }
  equipmentChoices(index, slot) {
    const unit = this.players[index];
    if (!unit || slot > 1) return [];
    return [
      ...new Set([
        unit.equipment?.[slot] ?? 0,
        ...Object.entries(this.inventory)
          .filter(([, n]) => n > 0)
          .map(([id]) => Number(id)),
      ]),
    ]
      .filter((id) => canEquip(this.data, unit, id, slot))
      .map((id) => ({ id, name: this.data.contentNames?.[id] ?? `装备 ${id}` }));
  }
  equipInBattle(index, slot, id) {
    if (this.equipmentInput?.index !== index || slot > 1) return false;
    const actor = this.players[index];
    const host = {
      battleData: this.data,
      inventory: this.inventory,
      roster: Object.fromEntries(this.players.map((u) => [u.id, u])),
      unit: (id) => this.players.find((u) => u.id === id),
      event: this.event,
      warn: (_, message) => this.warning(message),
    };
    return equipResource(host, actor.id, slot, id, { duringEvent: true });
  }
  beginSlots(index) {
    if (!this.players[index]?.ready || !this.commandsFor(index).some((c) => c.commandId === 20))
      return false;
    this.slots = { index, start: this.elapsed, stopped: [] };
    this.warning(
      "Slots use six PR outcome symbols with uniformly spaced web reels; native PR reel strips, forced-stop bias and timing are not exported.",
    );
    return true;
  }
  slotSymbols() {
    return [0, 1, 2].map(
      (n) =>
        this.slots?.stopped[n] ??
        Math.floor((this.elapsed - (this.slots?.start ?? 0)) * (9 + n * 2) + n * 2) % 6,
    );
  }
  stopSlot(index) {
    if (!this.slots || this.slots.index !== index) return false;
    this.slots.stopped.push(this.slotSymbols()[this.slots.stopped.length]);
    if (this.slots.stopped.length < 3) return true;
    const reels = this.slots.stopped;
    this.slots = null;
    const equal = reels[0] === reels[1] && reels[1] === reels[2];
    const bahamut = Object.values(this.data.magicStones ?? {}).find((s) =>
      /巴哈姆特|Bahamut/i.test(s.name),
    )?.summonAbilityId;
    const id = equal
      ? [215, bahamut ?? 214, 214, 212, 211, 213][reels[0]]
      : reels[0] === 0 && reels[1] === 0 && reels[2] === 2
        ? 216
        : 210;
    const actor = this.players[index],
      ability = this.data.abilities[id];
    if (!ability) return false;
    const pool =
      id === 216
        ? this.players
        : id === 215
          ? this.enemies
          : ability.target === "ally"
            ? this.players
            : this.enemies;
    const targets = pool.filter((u) => this.eligibleTarget(u, ability)),
      sequence = {};
    for (const target of targets)
      this.perform(actor, target, ability, targets.length, { sequence });
    this.addLog(
      `转轮 ${reels.map((n) => ["7", "龙", "BAR", "飞空艇", "陆行鸟", "钻石"][n]).join(" / ")}：${ability.name}`,
    );
    this.consumeTurn(actor);
    this.checkEnd();
    return true;
  }
  submitBlitz(index, id, inputs, target) {
    const actor = this.players[index];
    if (
      !actor?.ready ||
      !this.commandsFor(index).some((c) => c.commandId === 15 && c.actions.some((a) => a.id === id))
    )
      return false;
    if (!validBlitz(id, inputs)) {
      this.addLog(`${actor.name}必杀技输入失败！`);
      this.consumeTurn(actor);
      return true;
    }
    return this.choose(index, id, target, { validated: true });
  }
  beginBushido(index) {
    if (!this.players[index]?.ready || !this.commandsFor(index).some((c) => c.commandId === 12))
      return false;
    this.bushido = { index, start: this.elapsed };
    this.warning(
      "Bushido charges one level per 0.6 seconds, capped by learned PR skills; PR native charge timing is approximated.",
    );
    return true;
  }
  bushidoLevel(index) {
    return this.bushido?.index === index
      ? Math.min(8, 1 + Math.floor((this.elapsed - this.bushido.start) / 0.6))
      : 0;
  }
  releaseBushido(index, id, target) {
    const skills = this.commandsFor(index).find((c) => c.commandId === 12)?.actions ?? [];
    if (skills.findIndex((a) => a.id === id) >= this.bushidoLevel(index)) return false;
    this.bushido = null;
    return this.choose(index, id, target, { validated: true });
  }
  chooseDualcast(index, selections) {
    const actor = this.players[index],
      menu = this.commandsFor(index).find((c) => c.commandId === 31);
    if (!actor?.ready || !menu || selections.length !== 2) return false;
    const actions = selections.map((s) =>
      menu.actions.find((a) => a.id === s.id && !a.magiciteSummon),
    );
    if (actions.some((a) => !a || a.disabled) || actions.reduce((n, a) => n + a.mp, 0) > actor.mp)
      return false;
    let executed = false;
    for (let n = 0; n < 2 && this.phase === "active" && this.targetable(actor); n++) {
      if (
        !this.choose(index, selections[n].id, selections[n].target, {
          validated: true,
          dualcast: true,
          deferTurn: true,
        })
      )
        break;
      executed = true;
    }
    if (executed) {
      this.consumeTurn(actor);
      this.checkEnd();
    }
    return executed;
  }

  itemsFor(actorIndex) {
    const actor = this.players[actorIndex];
    if (!actor) return [];
    return Object.entries(this.inventory).flatMap(([contentId, count]) => {
      const content = this.data.contents?.[contentId];
      const item = content?.type_id === 1 ? this.data.items?.[content.type_value] : null;
      if (!(count > 0) || !item?.battle_function_group_id) return [];
      if (item.machine_flag && !effectiveCommandIds(this.data, actor).includes(14)) return [];
      const source = abilityFromItem(this.data, item, Number(contentId));
      source.name = this.data.itemNames?.[item.id] || source.name;
      if (
        item.id === 23 &&
        this.enemies.some((enemy) => [549, 550].includes(enemy.monsterId) && this.targetable(enemy))
      )
        source.target = "enemy";
      return [
        {
          ...source,
          id: `${item.machine_flag ? "tool" : "item"}:${contentId}`,
          kind: item.machine_flag ? source.kind : "item",
          count,
          amount: item.standard_value,
          disabled: false,
        },
      ];
    });
  }

  useItem(actorIndex, contentId, targetIndex = actorIndex) {
    const actor = this.players[actorIndex],
      command = this.itemsFor(actorIndex).find((item) => item.contentId === Number(contentId));
    if (
      Object.keys(this.data.commands ?? {}).length &&
      !this.actionsFor(actorIndex).some((a) => a.id === command?.id && !a.disabled)
    )
      return false;
    if (
      this.phase !== "active" ||
      !actor ||
      !this.targetable(actor) ||
      !this.events.interactive ||
      this.events.paused ||
      !actor.ready ||
      !command ||
      actionBlocked(this.data, actor) ||
      actor.stopUntil > this.elapsed
    )
      return false;
    const sideRequest =
      typeof targetIndex === "object" && targetIndex !== null
        ? targetIndex.side
        : command.target === "enemy"
          ? "enemy"
          : "player";
    const side = sideRequest === 2 || sideRequest === "enemy" ? "enemy" : "player";
    if (!command.targetSides.includes(side)) return false;
    const pool = side === "enemy" ? this.enemies : this.players;
    const index =
      typeof targetIndex === "object" && targetIndex !== null ? targetIndex.index : targetIndex;
    const target = pool[index];
    if (!this.eligibleTarget(target, command)) return false;
    const item = this.data.items[command.itemId],
      ability = { ...abilityFromItem(this.data, item, Number(contentId)), name: command.name };
    const targets = command.all
      ? pool.filter((unit) => this.eligibleTarget(unit, command))
      : [target];
    // PR machine items are reusable; consumables retain their destroy_rate.
    if (!item.machine_flag && this.random() * 100 < (item.destroy_rate ?? 100))
      this.inventory[contentId] -= 1;
    this.clearRunic(actor);
    const sequence = {};
    for (const [n, unit] of targets.entries())
      this.perform(actor, unit, ability, targets.length, {
        updateVariables: n === 0,
        item: command,
        sequence,
      });
    actor.defending = false;
    this.consumeTurn(actor);
    this.checkEnd();
    return true;
  }

  get commands() {
    return this.players.map((_, index) => this.commandsFor(index));
  }
  get readyPlayers() {
    return this.players.filter(
      (unit) =>
        unit.hp > 0 && unit.ready && !unit.rageMonster && !unit.danceAbility && unit.id !== 14,
    );
  }

  tick(seconds, auto = false) {
    let remaining = Math.max(0, value(seconds, 0));
    while (remaining > 0 && this.phase === "active") {
      const step = Math.min(remaining, 1 / 30);
      remaining -= step;
      if (
        !auto &&
        this.context.settings?.atbMode === "wait" &&
        ["list", "target", "dualcast", "equipment"].includes(this.inputMode)
      )
        continue;
      this.elapsed += step;
      this.events.tick(step);
      for (const ai of this.ais) if (!ai.unit.removed) ai.tick();
      this.drainAI();
      this.checkEnd();
      if (this.phase !== "active") break;
      if (this.events.paused) continue;
      if (tickEscape(this, step)) {
        this.checkEnd();
        if (this.phase !== "active") break;
      }
      for (const unit of [...this.players, ...this.enemies]) {
        tickConditions(this, unit, step);
        tickRole(this, unit, step);
        if (
          !this.alive(unit) ||
          (unit.hidden && !unit.chargedAbility) ||
          (unit.side === "enemy" && this.events.enemySleeping)
        )
          continue;
        if (unit.stopUntil > this.elapsed || actionBlocked(this.data, unit)) continue;
        if (unit.stopConditionId) {
          unit.conditions = (unit.conditions ?? []).filter((id) => id !== unit.stopConditionId);
          unit.stopConditionId = null;
          this.addLog(`${unit.name}恢复了行动。`);
        }
        unit.atb = Math.min(
          100,
          unit.atb +
            atbRate(unit, this.context.settings?.battleSpeed ?? this.data.battleSpeed ?? 3) *
              conditionSpeed(this.data, unit) *
              step,
        );
        unit.ready = unit.atb >= 100;
        if (!unit.ready) continue;
        if (unit.chargedAbility) this.releaseCharged(unit);
        else if (this.events.interactive && (forcedRoleTurn(this, unit) || this.forcedTurn(unit))) {
          /* source condition owns this turn */
        } else if (unit.side === "enemy") this.enemyTurn(unit);
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
    const index = this.players.indexOf(unit),
      rage = this.actionsFor(index).find((a) => a.kind === "rage");
    if (unit.id === 12 && rage) return this.choose(index, rage.id, { side: "player", index });
    // Interface adapter only: the existing regression policy stays frozen.
    const view = this.automaticInputView();
    return autoBattleInput(view, unit, (...args) => calculateDamage(...args, this.data));
  }

  automaticInputView() {
    return new Proxy(this, {
      get: (battle, key) =>
        key === "commandsFor"
          ? battle.actionsFor.bind(battle)
          : key === "choose"
            ? (i, id, target) => {
                const command = battle.actionsFor(i).find((a) => a.id === id);
                if (command?.commandId === 15)
                  return battle.submitBlitz(i, id, blitzInputs[id] ?? [], target);
                if (command?.commandId === 20) {
                  battle.beginSlots(i);
                  for (let n = 0; n < 3; n++) battle.stopSlot(i);
                  return true;
                }
                return battle.choose(i, id, target, { validated: true });
              }
            : typeof battle[key] === "function"
              ? battle[key].bind(battle)
              : battle[key],
    });
  }

  forcedTurn(unit) {
    const input = forcedConditionAction(this, unit);
    if (!input) return false;
    const target = (input.target.side === "enemy" ? this.enemies : this.players)[
      input.target.index
    ];
    const ability = this.data.abilities?.[1] || {
      id: 1,
      kind: "physical",
      power: 0,
      range: 3,
      functions: [{ id: 2, values: [0, 0, 0] }],
    };
    this.clearRunic(unit);
    unit.defending = false;
    this.perform(unit, target, ability, 1, { sequence: {} });
    this.consumeTurn(unit);
    this.checkEnd();
    return true;
  }

  requestEscape() {
    return requestBattleEscape(this);
  }
  get canEscape() {
    return canEscape(this);
  }

  choose(actorIndex, abilityId = 0, targetIndex = 0, input = {}) {
    if (typeof abilityId === "string" && abilityId.startsWith("control:"))
      return this.chooseControlled(actorIndex, abilityId, targetIndex);
    if (typeof abilityId === "string" && /^(item|tool):/.test(abilityId))
      return this.useItem(actorIndex, Number(abilityId.split(":")[1]), targetIndex);
    const actor = this.players[actorIndex];
    if (
      this.phase !== "active" ||
      !actor ||
      !this.targetable(actor) ||
      !this.events.interactive ||
      this.events.paused ||
      actionBlocked(this.data, actor) ||
      !actor.ready ||
      actor.stopUntil > this.elapsed
    )
      return false;
    const id =
      typeof abilityId === "string" && /^(throw|rage):/.test(abilityId)
        ? abilityId
        : Number(abilityId) || 1;
    const command = this.actionsFor(actorIndex).find((command) => command.id === id);
    if (!command || command.disabled) {
      this.warning(`Unavailable ability ${id}; command rejected.`);
      return false;
    }
    if (command.commandId === 31 && !input.dualcast)
      return this.chooseDualcast(actorIndex, [
        { id, target: targetIndex },
        { id, target: targetIndex },
      ]);
    if ([12, 15, 20].includes(command.commandId) && !input.validated) return false;
    if (id === 4) {
      actor.row = actor.row === "back" ? "front" : "back";
      this.addLog(`${actor.name}移到${actor.row === "back" ? "后" : "前"}排。`);
      this.consumeTurn(actor);
      return true;
    }
    if (beginRoleAction(this, actor, command)) {
      this.clearRunic(actor);
      this.consumeTurn(actor);
      this.checkEnd();
      return true;
    }
    const ability = command.throwContentId
      ? { ...command, id: 10, kind: command.effect.kind }
      : command;
    const requested = typeof targetIndex === "object" && targetIndex !== null ? targetIndex : null;
    const side = requested
      ? requested.side === 2 || requested.side === "enemy"
        ? "enemy"
        : "player"
      : ability.target === "ally" ||
          [1, 2, 5, 12].includes(ability.range) ||
          isRevival(this.data, ability)
        ? "player"
        : "enemy";
    if (
      !command.targetSides.includes(side) ||
      (requested?.all && !command.selectableAll && !ability.all)
    )
      return false;
    if (ability.mp > actor.mp) {
      this.addLog(`${actor.name}的魔力不足。`);
      return false;
    }
    this.clearRunic(actor);
    actor.mp -= ability.mp ?? 0;
    actor.defending = false;
    if (ability.kind === "defend") {
      actor.defending = true;
      this.addLog(`${actor.name}防御。`);
    } else {
      const pool = ability.range === 5 ? [actor] : side === "player" ? this.players : this.enemies;
      const target = ability.range === 5 ? actor : pool[requested?.index ?? targetIndex];
      const selected = this.eligibleTarget(target, ability)
        ? target
        : pool.find((unit) => this.eligibleTarget(unit, ability));
      if (!selected) {
        actor.mp += ability.mp ?? 0;
        this.addLog("目标暂时离开了战场。");
        return false;
      }
      const targets =
        ability.range === 9
          ? [...this.players, ...this.enemies].filter((unit) => this.eligibleTarget(unit, ability))
          : (
                command.selectableAll && typeof requested?.all === "boolean"
                  ? requested.all
                  : ability.all
              )
            ? pool.filter((unit) => this.eligibleTarget(unit, ability))
            : [selected];
      const sequence = {};
      targets.forEach((unit, index) =>
        this.perform(actor, unit, ability, targets.length, {
          updateVariables: index === 0,
          sequence,
          throwContentId: command.throwContentId,
        }),
      );
    }
    if (command.magiciteSummon) actor.magiciteUsed = true;
    if (!input.deferTurn) this.consumeTurn(actor);
    this.checkEnd();
    return true;
  }

  chooseControlled(index, id, request) {
    const actor = this.players[index],
      controlled = this.enemies[actor?.controlledEnemyIndex];
    if (
      this.phase !== "active" ||
      !actor?.ready ||
      !controlled ||
      actionBlocked(this.data, actor) ||
      !this.events.interactive ||
      this.events.paused
    )
      return false;
    if (!this.actionsFor(index).some((a) => a.id === id && !a.disabled)) return false;
    if (id === "control:cancel") {
      setCondition(this, controlled, 85, false);
      setCondition(this, actor, 66, false);
      actor.controlledEnemyIndex = null;
      this.consumeTurn(actor);
      return true;
    }
    const ability = this.data.abilities[Number(id.split(":")[1])];
    const pool = request?.side === "enemy" ? this.enemies : this.players,
      target = pool[request?.index ?? 0];
    if (!ability || !this.eligibleTarget(target, ability) || controlled.mp < (ability.mp ?? 0))
      return false;
    controlled.mp -= ability.mp ?? 0;
    const targets = ability.all ? pool.filter((u) => this.eligibleTarget(u, ability)) : [target],
      sequence = {};
    for (const u of targets) this.perform(controlled, u, ability, targets.length, { sequence });
    this.consumeTurn(actor);
    this.checkEnd();
    return true;
  }

  consumeTurn(actor) {
    actor.rearAttacked = false;
    actor.atb = 0;
    actor.ready = false;
    this.turns += 1;
  }

  clearRunic(actor) {
    if (!actor.runic) return;
    for (const id of [...(actor.conditions || [])])
      if (this.data.conditions?.[id]?.condition_type === 612) setCondition(this, actor, id, false);
    actor.runic = false;
  }

  enemyTurn(actor) {
    if ((actor.conditions ?? []).includes(85)) {
      this.consumeTurn(actor);
      return;
    }
    actor.aiState?.wake("normal");
    this.drainAI();
    this.consumeTurn(actor);
    this.checkEnd();
  }

  releaseCharged(actor) {
    const ability = this.data.abilities?.[actor.chargedAbility],
      previous = actor.chargedTarget;
    actor.chargedAbility = null;
    actor.chargedTarget = null;
    if (ability) {
      const targets = this.selectAITargets(actor, ability, previous, ability.all),
        sequence = {};
      for (const target of targets)
        this.perform(actor, target, ability, targets.length, { sequence });
    }
    this.consumeTurn(actor);
    this.checkEnd();
  }

  perform(actor, target, ability, targetCount = 1, options = {}) {
    if (!actor || !target || !ability) return;
    const weaponPlan = weaponDamagePlan(this.data, actor, target, ability, this.random, {
      weaponContentId: options.weaponContentId,
      warn: (message) => this.warning(message),
    });
    if (ability.id === 1 && ability.kind === "physical")
      ability = { ...(weaponPlan?.ability ?? ability), weaponPlan, weaponPlanResolved: true };
    if (options.sequence?.absorbed) return;
    // Runic consumes a compatible magic action and restores its source MP cost.
    if (ability.flags?.includes(3) && ability.mp > 0 && !options.runic) {
      const runic = [...this.players, ...this.enemies].find(
        (u) => u.runic && this.alive(u) && u !== actor,
      );
      if (runic) {
        for (const id of [...(runic.conditions || [])])
          if (this.data.conditions?.[id]?.condition_type === 612)
            setCondition(this, runic, id, false);
        runic.runic = false;
        runic.mp = Math.min(runic.maxMp, runic.mp + ability.mp);
        if (options.sequence) options.sequence.absorbed = true;
        this.addLog(`${runic.name}魔封剑吸收了${ability.name}。`);
        return;
      }
    }
    if (
      !ability.invalidReflection &&
      ability.kind === "magic" &&
      hasConditionType(this.data, target, 413) &&
      !options.reflected
    ) {
      const pool = (target.side === "player" ? this.enemies : this.players).filter((u) =>
        this.targetable(u),
      );
      if (pool.length)
        return this.perform(
          actor,
          pool[Math.floor(this.random() * pool.length)],
          ability,
          targetCount,
          { ...options, reflected: true },
        );
    }
    observeLore(this, ability);
    if (
      ability.id === 13 &&
      (this.data.notManipulateMonsters ?? []).some((row) => row.monster_id === target.monsterId)
    ) {
      this.addLog(`${target.name}无法被操纵。`);
      return;
    }
    const result = executeAbilityEffects(
      this,
      actor,
      target,
      ability,
      targetCount,
      options,
      (...args) => calculateDamage(...args, this.data),
    );
    if (result.delegated) return;
    if (ability.id === 13 && result.hit && (target.conditions ?? []).includes(85))
      actor.controlledEnemyIndex = this.enemies.indexOf(target);
    if (
      target.side === "enemy" &&
      ability.kind === "physical" &&
      result.amount > 0 &&
      (target.conditions ?? []).includes(85)
    ) {
      setCondition(this, target, 85, false);
      for (const controller of this.players)
        if (controller.controlledEnemyIndex === this.enemies.indexOf(target)) {
          setCondition(this, controller, 66, false);
          controller.controlledEnemyIndex = null;
        }
    }
    // PR monster flag4 is the EnemyCharacterParameter zero-MP death rule.
    // It applies to MP damage/drain too; ordinary enemies can remain at 0 MP.
    if (target.diesAtZeroMp && target.mp === 0 && target.hp > 0 && result.mp > 0) target.hp = 0;
    if (target.hp <= 0) {
      target.ready = false;
      target.atb = 0;
    }
    const action = {
      actor,
      target,
      ability,
      ...result,
      depth: this.actionDepth || 0,
      selectedAbilityId: ability.id,
      time: this.elapsed,
      ...(options.item ? { item: options.item } : {}),
    };
    if (actor.side === "player" && !options.mimic && ability.id !== 17)
      this.lastMimicAction = { ...action, throwCommand: options.sequence?.throwCommand };
    this.addLog(
      `${actor.name} → ${target.name}：${ability.name || "战斗"}${result.hit ? (result.amount ? " " + (result.amount < 0 ? "回复 " : "") + Math.abs(result.amount) : result.mp ? " MP " + result.mp : "") : " 未命中"}`,
    );
    this.event("battle-action", {
      actorSide: actor.side,
      actorIndex: actor.index,
      targetSide: target.side,
      targetIndex: target.index,
      abilityId: ability.id,
      time: this.elapsed,
      result: { amount: result.amount, mp: result.mp, hit: result.hit, critical: result.critical },
    });
    this.notifyAction(action);
    applyWeaponEffects(this, actor, target, ability, result, options);
  }

  checkEnd() {
    if (this.phase !== "active") return;
    for (const enemy of this.enemies)
      if (
        enemy.diesAtZeroMp &&
        enemy.mp === 0 &&
        enemy.hp > 0 &&
        !enemy.removed &&
        !enemy.escaped
      ) {
        enemy.hp = 0;
        enemy.ready = false;
        enemy.atb = 0;
        enemy.aiState?.wake("final", this.lastAction);
      }
    this.drainAI();
    const terminalOutcome = () =>
      this.events?.forcedOutcome?.outcome ||
      (this.escapeState?.complete
        ? "escape"
        : !this.players.some((unit) => this.alive(unit))
          ? this.players.some((unit) => unit.escaped && unit.hp > 0)
            ? "escape"
            : "defeat"
          : !this.enemies.some((unit) => this.alive(unit))
            ? "victory"
            : null);
    let outcome = terminalOutcome();
    if (!outcome) return;
    if (
      this.aiQueue.length ||
      this.ais.some(
        (ai) => !ai.unit.removed && !ai.unit.escaped && (ai.running || ai.pending.length),
      )
    )
      return;
    if (this.events && !this.events.beforeEnd(outcome)) return;
    // Source events can replace a fallen party or spawn the next enemy stage
    // while accepting this check. Never settle the stale pre-callback result.
    outcome = terminalOutcome();
    if (!outcome) return;
    if (
      outcome === "escape" &&
      !this.escapeState?.complete &&
      this.players.some((unit) => unit.escaped && unit.hp > 0)
    )
      this.warning(
        "All remaining players left through PR effects; interpreting the return as escape/code1 without victory rewards.",
      );
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
      applyBattleRewards(this.data, this.players, this.result, {
        log: (message) => this.addLog(message),
      });
    }
    finishRoles(this, outcome);
    for (const unit of this.players) {
      unit.conditions = (unit.conditions || []).filter(
        (id) => !this.data.conditions?.[id] || this.data.conditions[id].until_type === 3,
      );
      unit.berserk = hasConditionType(this.data, unit, 410);
      unit.protect = hasConditionType(this.data, unit, 19);
      unit.shell = hasConditionType(this.data, unit, 412);
      unit.trance = hasConditionType(this.data, unit, 621);
      unit.runic = false;
      unit.conditionUntil = {};
      unit.periodicClocks = {};
    }
    this.addLog(
      outcome === "victory"
        ? `胜利！经验 ${this.result.exp}，金币 ${this.result.gil}。`
        : outcome === "escape"
          ? "队伍成功逃离。"
          : "队伍倒下了。",
    );
    if (!this.yielded) {
      this.yielded = true;
      this.onEnd(this.result);
    }
  }
}
