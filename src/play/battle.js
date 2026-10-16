const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const value = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;

// SNES CalcDmg/CalcMagicDmg and CalcDmgMod. PR power and participant stats take precedence.
export function calculateDamage(actor, target, ability, random = Math.random, targetCount = 1) {
  const physical = ability.kind === 'physical';
  const power = value(ability.power, 0);
  const level = value(actor.level, 1);
  const healing = ability.kind === 'heal';
  const accuracy = ability.flags?.includes(1) ? 255 : value(ability.accuracy, actor.accuracy ?? 100);
  const evade = clamp(value(physical ? target.evasion : target.magicEvasion, 0), 0, 128);
  if (!healing && accuracy < 255 && random() * 100 >= Math.floor((256 - evade * 2) * accuracy / 256)) {
    return { amount: 0, missed: true, critical: false };
  }
  let base;
  if (physical) {
    const attack = value(actor.attack, 20) + power;
    base = actor.side === 'enemy'
      ? Math.floor((56 + Math.floor(random() * 8) + 4 * attack) * level * level / 256)
      : attack + Math.floor(level * level * (Math.min(255, value(actor.strength, 30) * 2) + attack) / 256 * 1.5);
    base = Math.floor(base * value(ability.multiplier, 1));
    if (actor.row === 'back') base = Math.floor(base / 2);
  } else {
    const magic = value(actor.magic, 30);
    base = power * 4 + Math.floor(level * magic * power * (actor.side === 'enemy' ? 1.5 : 1) / 32);
  }
  let amount = Math.floor(base * (224 + Math.floor(random() * 32)) / 256) + 1;
  if (!healing && !ability.flags?.includes(5)) {
    const defense = clamp(value(physical ? target.defense : target.magicDefense, 0), 0, 255);
    amount = Math.floor(amount * (255 - defense) / 256) + 1;
    if ((physical && target.protect) || (!physical && target.shell)) amount = Math.floor(amount * 170 / 256) + 1;
    if (physical && target.row === 'back') amount = Math.floor(amount / 2);
    if (physical && target.defending) amount = Math.floor(amount / 2);
  }
  const critical = physical && random() * 100 < value(actor.criticalRate, 0);
  if (critical) amount *= 2;
  const affinities = (ability.elements ?? []).map(id => target.elementResistances?.[id]);
  if (affinities.includes(4)) amount = -amount;
  else if (affinities.includes(3)) amount = 0;
  else if (affinities.includes(2)) amount = Math.floor(amount / 2);
  else if (affinities.includes(1)) amount *= 2;
  if (targetCount > 1 && !ability.flags?.includes(2)) amount = Math.trunc(amount / 2);
  return { amount: clamp(Math.trunc(amount), -9999, 9999), missed: false, critical };
}

export function atbRate(unit, battleSpeed = 3) {
  // UpdateBattleTime runs once per two SNES frames; CalcSpeed gives 6*(speed+20).
  const enemyFactor = unit.side === 'enemy' ? (255 - clamp(battleSpeed, 0, 7) * 24) / 256 : 1;
  return (value(unit.speed, 30) + 20) * 6 * enemyFactor * 30 * 100 / 65536;
}

export class Battle {
  constructor({ data = {}, party = [], encounterId, inventory = {}, random = Math.random, warn = () => {}, onEnd = () => {} }) {
    this.data = data;
    this.inventory = inventory;
    this.random = random;
    this.warn = warn;
    this.onEnd = onEnd;
    this.encounterId = encounterId;
    this.formation = data.parties?.[encounterId] ?? { members: [] };
    this.players = party;
    this.enemies = [];
    this.phase = 'active';
    this.log = [];
    this.elapsed = 0;
    this.turns = 0;
    this.outcome = null;
    this.result = null;
    this.warnings = new Set();
    this.ymirClock = 0;
    this.yielded = false;
    this.players.forEach((unit, index) => this.completeUnit(unit, data.characters?.[unit.id] ?? {}, 'player', index));
    for (const [index, member] of (this.formation.members ?? []).entries()) {
      const base = data.monsters?.[member.monsterId];
      if (!base) { this.warning(`Missing monster ${member.monsterId}; skipped.`); continue; }
      const enemy = { ...base, ...member, monsterId: base.id };
      this.completeUnit(enemy, base, 'enemy', index);
      this.enemies.push(enemy);
    }
    if (!data.parties?.[encounterId]) this.warning(`Missing formation ${encounterId}; empty battle returns victory.`);
    this.ymirHead = this.enemies.find(unit => unit.role === 'ymir-head');
    this.ymirShell = this.enemies.find(unit => unit.role === 'ymir-shell');
    if (this.ymirHead && this.ymirShell) this.addLog('尤弥尔的壳会吸收雷电。趁头部出现时攻击！');
    this.addLog(`遭遇：${this.enemies.map(unit => unit.name).join('、') || '无敌人'}`);
    this.checkEnd();
  }

  completeUnit(unit, base, side, index) {
    for (const [key, entry] of Object.entries(base)) if (unit[key] === undefined) unit[key] = entry;
    unit.id ??= index + 1;
    unit.name ??= side === 'player' ? `角色 ${unit.id}` : `怪物 ${unit.id}`;
    unit.maxHp = Math.max(1, value(unit.maxHp, value(unit.hp, 100)));
    unit.hp = clamp(value(unit.hp, unit.maxHp), 0, unit.maxHp);
    unit.maxMp = Math.max(0, value(unit.maxMp, value(unit.mp, 20)));
    unit.mp = clamp(value(unit.mp, unit.maxMp), 0, unit.maxMp);
    for (const [key, fallback] of Object.entries({ level: 3, strength: 30, magic: 30, defense: 40, magicDefense: 30, speed: 30, attack: 30, accuracy: 100 }))
      unit[key] = value(unit[key], fallback);
    unit.side = side;
    unit.index = index;
    if (Array.isArray(unit.abilities)) unit.abilities = [...unit.abilities];
    unit.atb = clamp((unit.speed + this.random() * unit.speed + this.random() * 72 + Math.max(0, 10 - this.players.length - (this.formation.members?.length ?? 0)) * 16) / 256 * 100, 0, 95);
    unit.ready = false;
    unit.hidden = false;
    unit.defending = false;
    unit.stopUntil = 0;
    if (unit.stopConditionId) unit.conditions = (unit.conditions ?? []).filter(id => id !== unit.stopConditionId);
    unit.stopConditionId = null;
    unit.normalSprite ??= base.sprite ?? unit.sprite;
    unit.sprite = unit.magitek ? unit.magitekSprite ?? unit.sprite : unit.normalSprite ?? unit.sprite;
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
    const ids = unit.magitek ? [1, 218, 219, 220, 222, ...(Number(unit.id) === 1 ? [221, 223, 224, 225] : []), 2]
      : [...new Set([1, ...(unit.abilities ?? []).map(a => typeof a === 'object' ? a.id : a), 2])];
    return ids.map(id => this.data.abilities?.[id] ?? { id, name: id === 1 ? '战斗' : id === 2 ? '防御' : `技能 ${id}`, mp: 0,
      kind: id === 2 ? 'defend' : 'physical', target: 'enemy' }).map(a => ({ ...a, disabled: a.mp > unit.mp }))
      .concat(this.itemsFor(actorIndex));
  }

  itemsFor(actorIndex) {
    if (!this.players[actorIndex]) return [];
    const names = { 1: '恢复剂', 2: '高级恢复剂', 3: '全恢复剂', 4: '以太', 5: '高级以太',
      6: '超级以太', 7: '万能药', 8: '全体万能药', 9: '凤凰之尾' };
    return Object.entries(this.inventory).flatMap(([contentId, count]) => {
      const content = this.data.contents?.[contentId];
      const item = content?.type_id === 1 ? this.data.items?.[content.type_value] : null;
      if (!(count > 0) || !item || ![1, 2, 3, 4].includes(item.battle_function_group_id)) return [];
      return [{ id: `item:${contentId}`, contentId: Number(contentId), itemId: item.id,
        name: names[item.id] ?? `道具 ${item.id}`, kind: 'item', target: 'ally', mp: 0, count,
        revive: item.battle_function_group_id === 2, amount: item.standard_value,
        all: item.battle_renge_id === 2, disabled: false }];
    });
  }

  useItem(actorIndex, contentId, targetIndex = actorIndex) {
    const actor = this.players[actorIndex], command = this.itemsFor(actorIndex).find(item => item.contentId === Number(contentId));
    if (this.phase !== 'active' || !actor || actor.hp <= 0 || !actor.ready || !command || actor.stopUntil > this.elapsed) return false;
    const target = this.players[targetIndex];
    if (!target || (command.revive ? target.hp > 0 : target.hp <= 0)) return false;
    const item = this.data.items[command.itemId], group = item.battle_function_group_id;
    const targets = command.all ? this.players.filter(unit => command.revive ? unit.hp <= 0 : unit.hp > 0) : [target];
    this.inventory[contentId] -= 1;
    for (const unit of targets) {
      const hpBefore = unit.hp, mpBefore = unit.mp;
      if (group === 2) {
        unit.hp = Math.max(1, Math.floor(unit.maxHp / 8));
        unit.conditions = (unit.conditions ?? []).filter(condition => condition !== 5);
        unit.atb = 0; unit.ready = false;
      } else {
        if (group === 1 || group === 4) unit.hp = Math.min(unit.maxHp, unit.hp + item.standard_value);
        if (group === 3 || group === 4) unit.mp = Math.min(unit.maxMp, unit.mp + item.standard_value);
      }
      this.lastAction = { actor, target: unit, item: command, amount: hpBefore - unit.hp, mp: mpBefore - unit.mp, time: this.elapsed };
      this.addLog(`${actor.name} → ${unit.name}：${command.name}，${group === 2 ? '复活，' : ''}HP +${unit.hp - hpBefore}，MP +${unit.mp - mpBefore}`);
    }
    actor.defending = false;
    this.consumeTurn(actor);
    this.checkEnd();
    return true;
  }

  get commands() { return this.players.map((_, index) => this.commandsFor(index)); }
  get readyPlayers() { return this.players.filter(unit => unit.hp > 0 && unit.ready); }

  tick(seconds, auto = false) {
    let remaining = Math.max(0, value(seconds, 0));
    while (remaining > 0 && this.phase === 'active') {
      const step = Math.min(remaining, 1 / 30);
      remaining -= step;
      this.elapsed += step;
      if (this.ymirHead?.hp > 0 && this.ymirShell?.hp > 0) {
        this.ymirClock += step;
        if (this.ymirClock >= 10) {
          this.ymirClock -= 10;
          this.ymirHead.hidden = !this.ymirHead.hidden;
          this.addLog(this.ymirHead.hidden ? '尤弥尔缩进了壳里！等待它再次出现。' : '尤弥尔探出了头！');
        }
      }
      for (const unit of [...this.players, ...this.enemies]) {
        if (unit.hp <= 0 || unit.hidden || unit.role === 'ymir-shell') continue;
        if (unit.stopUntil > this.elapsed) continue;
        if (unit.stopConditionId) {
          unit.conditions = (unit.conditions ?? []).filter(id => id !== unit.stopConditionId);
          unit.stopConditionId = null;
          this.addLog(`${unit.name}恢复了行动。`);
        }
        unit.atb = Math.min(100, unit.atb + atbRate(unit, this.data.battleSpeed ?? 3) * step);
        unit.ready = unit.atb >= 100;
        if (!unit.ready) continue;
        if (unit.side === 'enemy') this.enemyTurn(unit);
        else if (auto) this.autoTurn(unit);
        if (this.phase !== 'active') break;
      }
    }
    return this.phase;
  }

  autoTurn(unit) {
    const index = this.players.indexOf(unit);
    if (this.ymirHead?.hidden) {
      this.choose(index, 2);
      return;
    }
    const weak = this.players.reduce((best, actor) => actor.hp > 0 && actor.hp / actor.maxHp < (best?.hp / best?.maxHp ?? Infinity) ? actor : best, null);
    if (unit.magitek && weak && weak.hp < weak.maxHp * 0.55) {
      this.choose(index, 222, this.players.indexOf(weak));
      return;
    }
    if (weak && weak.hp < weak.maxHp * 0.45) {
      const cure = this.commandsFor(index).find(ability => ability.kind === 'heal' && !ability.disabled);
      if (cure && this.choose(index, cure.id, this.players.indexOf(weak))) return;
      const potion = this.itemsFor(index).find(item => !item.revive && [1, 4].includes(this.data.items[item.itemId].battle_function_group_id));
      if (potion && this.useItem(index, potion.contentId, this.players.indexOf(weak))) return;
    }
    const target = this.enemies.find(enemy => enemy.hp > 0 && !enemy.hidden && enemy.role !== 'ymir-shell')
      ?? this.enemies.find(enemy => enemy.hp > 0 && !enemy.hidden);
    if (target) this.choose(index, unit.magitek ? 218 : 1, this.enemies.indexOf(target));
    else this.choose(index, 2);
  }

  choose(actorIndex, abilityId = 0, targetIndex = 0) {
    if (typeof abilityId === 'string' && abilityId.startsWith('item:')) return this.useItem(actorIndex, Number(abilityId.slice(5)), targetIndex);
    const actor = this.players[actorIndex];
    if (this.phase !== 'active' || !actor || actor.hp <= 0 || !actor.ready || actor.stopUntil > this.elapsed) return false;
    const id = Number(abilityId) || 1;
    const ability = this.commandsFor(actorIndex).find(command => command.id === id);
    if (!ability) { this.warning(`Unavailable ability ${id}; using Fight.`); return this.choose(actorIndex, 1, targetIndex); }
    if (ability.mp > actor.mp) { this.addLog(`${actor.name}的魔力不足。`); return false; }
    actor.mp -= ability.mp ?? 0;
    actor.defending = false;
    if (ability.kind === 'defend') {
      actor.defending = true;
      this.addLog(`${actor.name}防御。`);
    } else {
      const pool = ability.target === 'ally' ? this.players : this.enemies;
      const target = pool[targetIndex]?.hp > 0 && !pool[targetIndex].hidden ? pool[targetIndex] : pool.find(unit => unit.hp > 0 && !unit.hidden);
      if (!target) { this.addLog('目标暂时离开了战场。'); this.consumeTurn(actor); return true; }
      const targets = ability.all ? pool.filter(unit => unit.hp > 0 && !unit.hidden) : [target];
      targets.forEach(unit => this.perform(actor, unit, ability, targets.length));
    }
    this.consumeTurn(actor);
    this.checkEnd();
    return true;
  }

  consumeTurn(actor) { actor.atb = 0; actor.ready = false; this.turns += 1; }

  enemyTurn(actor) {
    const choices = actor.ai ?? [{ id: 1, weight: 100 }];
    let roll = this.random() * choices.reduce((sum, choice) => sum + choice.weight, 0);
    const choice = choices.find(choice => (roll -= choice.weight) < 0) ?? choices[0];
    const ability = this.data.abilities?.[choice?.id] ?? this.data.abilities?.[1] ?? { id: 1, name: '战斗', kind: 'physical', power: 0 };
    const targets = this.players.filter(unit => unit.hp > 0);
    const target = targets[Math.floor(this.random() * targets.length)];
    if (target) this.perform(actor, target, ability);
    this.consumeTurn(actor);
    this.checkEnd();
  }

  perform(actor, target, ability, targetCount = 1) {
    if (ability.condition?.type === 17) {
      const chance = ability.flags?.includes(1) ? 100 : (256 - Math.min(128, target.magicEvasion ?? 0) * 2) * (ability.accuracy ?? 100) / 256;
      if (this.random() * 100 < chance) {
        target.stopUntil = this.elapsed + Math.max(1, ability.condition.duration || 30);
        target.stopConditionId = ability.condition.id;
        target.conditions = [...new Set([...(target.conditions ?? []), ability.condition.id])];
        target.ready = false;
        this.lastAction = { actor, target, ability, amount: 0, time: this.elapsed };
        this.addLog(`${actor.name} → ${target.name}：${ability.name}，暂时无法行动！`);
      } else this.addLog(`${actor.name}的${ability.name}没有命中${target.name}。`);
      return;
    }
    if (!ability.power && ability.kind !== 'physical' && ability.kind !== 'heal') {
      this.warning(`Ability ${ability.id} effect is deferred; turn continues.`);
      this.addLog(`${actor.name}使用了${ability.name}。`);
      return;
    }
    const result = calculateDamage(actor, target, ability, this.random, targetCount);
    if (result.missed) { this.addLog(`${actor.name}的${ability.name}没有命中${target.name}。`); return; }
    const delta = ability.kind === 'heal' ? -result.amount : result.amount;
    target.hp = clamp(target.hp - delta, 0, target.maxHp);
    this.lastAction = { actor, target, ability, amount: delta, critical: result.critical, time: this.elapsed };
    this.addLog(`${actor.name} → ${target.name}：${ability.name} ${delta < 0 ? '回复 ' : ''}${Math.abs(delta)}${result.critical ? '！' : ''}`);
    if (target.hp <= 0) { target.ready = false; target.atb = 0; this.addLog(`${target.name}倒下了。`); }
    if (target.role === 'ymir-shell' && target.hp > 0 && delta > 0 && actor.side === 'player') {
      this.addLog('尤弥尔的壳释放了雷电反击！');
      const counter = this.data.abilities?.[321] ?? { id: 321, name: '百万伏特', kind: 'magic', power: 20, accuracy: 150, elements: [3] };
      this.perform(target, actor, counter);
    }
    if ((target.role === 'ymir-head' || target.role === 'ymir-shell') && target.hp <= 0) {
      this.enemies.filter(unit => unit.role?.startsWith('ymir-')).forEach(unit => { unit.hp = 0; unit.ready = false; });
    }
  }

  checkEnd() {
    if (this.phase !== 'active') return;
    const outcome = this.players.every(unit => unit.hp <= 0) ? 'defeat' : this.enemies.every(unit => unit.hp <= 0) ? 'victory' : null;
    if (!outcome) return;
    this.phase = outcome;
    this.outcome = outcome;
    this.result = { outcome, exp: 0, gil: 0, ap: 0, drops: [] };
    if (outcome === 'victory') {
      for (const enemy of this.enemies) {
        this.result.exp += enemy.exp ?? 0;
        this.result.gil += enemy.gil ?? 0;
        if (enemy.drops?.length && this.random() * 100 < (enemy.dropRate ?? 0))
          this.result.drops.push({ ...enemy.drops[Math.floor(this.random() * enemy.drops.length)] });
      }
      this.result.ap = this.formation.ap ?? 0;
      const survivors = this.players.filter(unit => unit.hp > 0);
      const share = Math.floor(this.result.exp / Math.max(1, survivors.length));
      survivors.forEach(unit => {
        unit.exp = (unit.exp ?? 0) + share;
        for (const row of this.data.expTable ?? []) {
          if (row.group_id !== 1 || row.lv <= unit.level || row.total_exp > unit.exp) continue;
          unit.level = row.lv;
          const growth = this.data.growth?.find(g => g.group_id === 1 && g.lv === row.lv);
          unit.maxHp = Math.min(9999, unit.maxHp + (growth?.hp_value1 ?? 0));
          unit.maxMp = Math.min(999, unit.maxMp + (growth?.mp_value1 ?? 0));
          for (const spell of unit.naturalLearning ?? []) if (spell.level <= unit.level) {
            unit.abilities ??= [1, 2];
            if (!unit.abilities.includes(spell.abilityId)) unit.abilities.push(spell.abilityId);
          }
          this.addLog(`${unit.name}升到了 ${unit.level} 级！`);
        }
      });
    }
    this.addLog(outcome === 'victory' ? `胜利！经验 ${this.result.exp}，金币 ${this.result.gil}。` : '队伍倒下了。');
    if (!this.yielded) { this.yielded = true; this.onEnd(this.result); }
  }
}
