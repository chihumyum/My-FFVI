const compare = (a, op, b) => ({ '＝': a === b, '=': a === b, '≠': a !== b, '＞': a > b, '＜': a < b,
  '≧': a >= b, '≦': a <= b, '＆': Boolean(a & b) })[op] ?? a === b;
const calculate = (a, op, b) => {
  switch (op) {
    case '＋': return a + b; case '－': return a - b; case '×': return a * b;
    case '÷': return b ? Math.trunc(a / b) : 0; case '％': return b ? a % b : 0;
    case '＆': return a & b; case '｜': return a | b; default: return b;
  }
};
const normalize = program => program?.ops ? program : program?.Mnemonics ? {
  name: program.Name, locals: program.ScriptLocalValue ?? program.ScriptLocal.map(() => 0),
  segments: program.Segments, ops: program.Mnemonics.map(op => [op.mnemonic,
    op.operands.iValues, op.operands.rValues, op.operands.sValues, op.type, op.label]),
} : null;
const sourceIds = { ティナ: 1, ロック: 2, カイエン: 3, シャドウ: 4, エドガー: 5, マッシュ: 6,
  セリス: 7, ストラゴス: 8, リルム: 9, セッツァー: 10, モグ: 11, ガウ: 12, ガストラ: 34, ケフカ: 33 };

// Executes the PR battle-event program separately from each monster's AI. The
// source program owns scene branches, condition changes and forced returns.
export class BattleEvents {
  constructor(battle) {
    this.battle = battle;
    const source = battle.data.scriptNames?.[battle.formation.script] ?? battle.data.scriptIds?.[battle.formation.script] ?? battle.formation.script;
    const programs = battle.data.eventPrograms ?? {};
    const program = programs[source] ?? Object.values(programs).find(program => program.name === source || program.Name === source);
    this.program = normalize(program ?? programs.sc_b_none ?? Object.values(programs).find(program => program.name === 'sc_b_none'));
    this.pc = this.program?.segments?.find(segment => (segment.Label ?? segment.label) === 'Main')?.EntryPoint ?? 0;
    this.locals = [...(this.program?.locals ?? [])]; this.stack = []; this.wait = 0;
    this.done = !this.program; this.paused = false; this.interactive = true; this.enemySleeping = false;
    this.endEnabled = true; this.uiVisible = true; this.forcedOutcome = null;
    this.running = false; this.lastAction = null; this.state = {}; this.warnings = new Set();
    this.vargas = this.program?.ops.some(op => op[0] === 'SysCall' && op[3][0] === 'バルガスチェック');
    this.entryPlayers = battle.players.slice();
    this.entryState = battle.players.map(unit => ({ unit, hp: unit.hp, mp: unit.mp, conditions: [...(unit.conditions ?? [])] }));
  }

  warning(message) {
    if (this.warnings.has(message)) return;
    this.warnings.add(message); this.battle.warning?.(`Battle event: ${message}`);
  }
  event(kind, payload = {}) { this.battle.event?.(kind, { script: this.program?.name, ...payload }); }
  bank(name) { return name === 'ScriptLocalVariable' ? this.locals : ((this.battle.banks ??= {})[name] ??= {}); }
  read(name, index) { return Number(this.bank(name)[index] ?? 0); }
  enemy(id) { return this.battle.enemies.find(unit => (unit.uniqueId ?? (unit.slot ?? unit.index) + 1) === id); }
  units(side, id) {
    const pool = side === 1 ? this.battle.players : this.battle.enemies;
    return id <= 0 ? pool : pool.filter(unit => side === 1 ? Number(unit.id) === id :
      (unit.uniqueId ?? (unit.slot ?? unit.index) + 1) === id);
  }
  mode(unit) { return unit?.aiState?.mode ?? unit?.mode ?? 0; }
  alive(unit) { return unit.hp > 0 && !unit.escaped && !unit.removed; }
  aiEnded() { return !this.battle.enemies.some(unit => this.alive(unit)); }

  tick(seconds = 0) {
    this.wait = Math.max(0, this.wait - Math.max(0, seconds));
    this.advance();
  }
  advance() {
    if (this.done || this.running || this.wait > 0) return;
    this.running = true;
    try {
      for (let steps = 0; steps < 300 && !this.done && this.wait <= 0; steps++) {
        const operation = this.program.ops[this.pc++];
        if (!operation) { this.done = true; break; }
        if (this.execute(operation)) break;
        if (steps === 299) this.warning('Instruction loop yielded; execution resumes next frame.');
      }
    } finally { this.running = false; }
  }

  execute([name, i = [], r = [], s = []]) {
    const b = this.battle;
    switch (name) {
      case 'Nop': case 'Blank': case 'WaitToBattleStart': case 'ExecBattleAI': case 'BattleSyncAction': return false;
      case 'Exit': this.done = true; return true;
      case 'Return': if (this.stack.length) this.pc = this.stack.pop(); else this.done = true; return this.done;
      case 'Call': this.stack.push(this.pc); this.pc = i[0]; return false;
      case 'Jump': this.pc = i[0]; return false;
      case 'Wait': this.wait = Math.max(0, Number(r[0]) || 0); return this.wait > 0;
      case 'SyncBattleAI': this.locals[0] = Number(this.aiEnded() || !b.players.some(unit => this.alive(unit))); return true;
      case 'Branch': if (compare(this.read(s[0], i[0]), s[1], s[2] === 'imm' ? i[1] : this.read(s[2], i[1]))) this.pc = i[2]; return false;
      case 'Calc': this.bank(s[0])[i[0]] = calculate(this.read(s[0], i[0]), s[1], s[2] === 'imm' ? i[1] : this.read(s[2], i[1])) | 0; return false;
      case 'SetFlag': case 'ResetFlag': case 'FlipFlag':
        this.bank(s[0])[i[0]] = name === 'SetFlag' ? 1 : name === 'ResetFlag' ? 0 : 1 - this.read(s[0], i[0]); return false;
      case 'GetEnemyMode':
        if (Number(this.locals[1] ?? 0) === i[1]) this.locals[1] = this.mode(this.enemy(i[0])); return false;
      case 'BattleInteractive': this.interactive = Boolean(i[0]); return false;
      case 'BattlePause': this.paused = Boolean(i[0]); return false;
      case 'BattleSleepEnemy': this.enemySleeping = Boolean(i[0]); return false;
      case 'BattleEndEnabled': this.endEnabled = Boolean(i[0]); return false;
      case 'BattleCondition': this.condition(i[0], i[1], i[2], i[3] !== 0); return false;
      case 'BattleAction': this.action(i); return false;
      case 'BattleAddFellow': this.addPlayer(i[0]); return false;
      case 'BattleAddEnemy': this.addEnemy(i[0], i[1]); return false;
      case 'BattleForceExit': case 'BattleForceExitOnSave':
        this.forcedOutcome = { outcome: 'victory', code: 4, saved: name === 'BattleForceExitOnSave' };
        this.paused = false; return false;
      case 'Msg': {
        const key = s[0] ?? '', text = b.text?.(key) ?? b.data.messages?.[key] ?? key;
        b.addLog(text); this.event('battle-message', { key, text });
        // PR key waits auto-confirm at a short readable interval in this host.
        this.wait = r[0] > 0 ? r[0] : 0.15; return true;
      }
      case 'MsgClose': this.event('battle-message-close'); return false;
      case 'PlayBGM': case 'PlaySE': this.event(name === 'PlayBGM' ? 'bgm' : 'se', { id: i[0] }); return false;
      case 'StopBGM': this.event('bgm', { id: 0 }); return false;
      case 'BattleAnim': case 'PlayBattleEffect': case 'SyncBattleEffect': case 'FadeOut': case 'FadeIn':
      case 'StopSE': case 'StopEnvSe': case 'SyncBGM': case 'LoadSE':
        this.event('battle-effect', { name, i, r, s });
        this.warning('Battle animations and effect synchronization are presented as events; source Wait timing remains active.'); return false;
      case 'SysCall': this.syscall(s[0] ?? '', i, r); return false;
      default: this.warning(`${name} is currently skipped.`); return false;
    }
  }

  addPlayer(id) {
    const b = this.battle, existing = b.players.find(unit => unit.id === id);
    if (existing) return existing;
    if (b.addPlayer) return b.addPlayer(id);
    const unit = b.character?.(id) ?? { ...b.data.characters?.[id], id };
    b.completeUnit(unit, b.data.characters?.[id] ?? {}, 'player', b.players.length);
    b.players.push(unit); return unit;
  }
  addEnemy(monsterId, uniqueId) {
    const b = this.battle;
    if (b.addEnemy) return b.addEnemy(monsterId, uniqueId);
    const base = b.data.monsters?.[monsterId];
    if (!base) { this.warning(`Missing reinforcement monster ${monsterId}; skipped.`); return null; }
    const unit = { ...base, monsterId, slot: uniqueId - 1, uniqueId };
    b.completeUnit(unit, base, 'enemy', b.enemies.length);
    const old = this.enemy(uniqueId);
    if (old) b.enemies.splice(b.enemies.indexOf(old), 1, unit); else b.enemies.push(unit);
    return unit;
  }
  condition(side, id, conditionId, add) {
    const row = this.battle.data.conditions?.[conditionId], type = Number(row?.condition_type ?? row?.type ?? conditionId);
    for (const unit of this.units(side, id)) {
      unit.conditions ??= [];
      unit.conditions = add ? [...new Set([...unit.conditions, conditionId])] : unit.conditions.filter(value => value !== conditionId);
      if (type === 5) { if (add) { unit.hp = 0; unit.ready = false; unit.atb = 0; } else if (unit.hp <= 0) unit.hp = 1; }
      if (type === 667) unit.untargetable = add;
      if (type === 665 || type === 666) unit.disguise = add ? type === 665 ? 2 : 1 : 0;
      if (type === 13 || conditionId === 98) { unit.escaped = add; unit.hidden = add; }
      this.event('battle-condition', { side, id: unit.id, uniqueId: unit.uniqueId, conditionId, add });
    }
  }
  action(i) {
    const b = this.battle, actors = this.units(i[0], i[1]);
    const side = i[3] === 0 ? i[0] : i[0] === 1 ? i[3] === 2 ? 2 : 1 : i[3] === 1 ? 1 : 2;
    const targets = this.units(side, i[4]);
    const ability = b.data.abilities?.[i[2]];
    if (!ability) { this.warning(`Missing scripted ability ${i[2]}; skipped.`); return; }
    // Function 19 is the event-only change-animation routine (e.g. Locke's
    // change-of-clothes poses). It must not become the AI's Fight fallback.
    if (ability.functionId !== 19)
      for (const actor of actors) for (const target of targets) b.perform(actor, target, ability, targets.length);
    this.event('battle-action', { actorSide: i[0], actorId: i[1], abilityId: i[2], targetSide: side, targetId: i[4] });
  }

  beforeDamage(actor, target, ability, amount) {
    if (amount <= 0) return amount;
    // A source story guard has an explicit AI/scene defeat condition. Preserve
    // its last HP until that condition applies death through BattleCondition.
    if (this.vargas && target === this.enemy(9)) {
      if (target.untargetable) return 0;
      return Math.min(amount, Math.max(0, target.hp - 1));
    }
    return amount;
  }
  onAction(action) {
    this.lastAction = action;
    if (action?.actor?.id === 1 && action.actor.side === 'player' && action.ability &&
        (action.ability.typeId === 1 || action.ability.kind === 'magic' || action.ability.kind === 'heal')) this.state.terraMagic = true;
    this.advance();
  }
  beforeEnd(outcome) {
    this.advance();
    if (this.forcedOutcome) return this.endEnabled;
    if (!this.endEnabled || this.paused || this.wait > 0) return false;
    return this.done || !this.program;
  }
  resultCode(outcome) {
    if (this.forcedOutcome) return this.forcedOutcome.code;
    if (outcome === 'defeat' && /sc_b_00(?:67|71)$/.test(this.program?.name ?? '')) return 4;
    return outcome === 'victory' ? 0 : outcome === 'escape' ? 1 : 2;
  }
  autoCommand(unit) {
    if (this.state.magicOnly) {
      const ability = this.battle.commandsFor(this.battle.players.indexOf(unit)).find(ability =>
        !ability.disabled && ability.kind === 'magic' && ability.power > 0);
      const target = this.battle.enemies.find(enemy => this.alive(enemy) && !enemy.hidden && !enemy.untargetable);
      if (ability && target) return { abilityId: ability.id, targetIndex: this.battle.enemies.indexOf(target) };
    }
    if (unit.id === 6 && this.vargas &&
        !this.battle.players.some(player => player.id !== 6 && this.alive(player) && !player.hidden))
      return { abilityId: 132, targetIndex: this.battle.enemies.indexOf(this.enemy(9)) };
    if (unit.id === 2 && /sc_b_00(?:67|71)$/.test(this.program?.name ?? '') && !this.state.clothesStolen)
      return { abilityId: 8, targetIndex: this.battle.enemies.indexOf(this.enemy(5)) };
    return null;
  }

  syscall(name, i, r) {
    const b = this.battle, state = this.state;
    const callback = b.eventCallbacks?.[name];
    if (typeof callback === 'function' && callback(this, i, r) !== false) return;
    if (name === 'HideBattleUI' || name === 'ShowBattleUI') { this.uiVisible = name === 'ShowBattleUI'; return; }
    if (name === 'StopAutoBattle') { this.event('stop-auto-battle'); return; }
    if (name === 'RemoveAllAct') { for (const unit of [...b.players, ...b.enemies]) { unit.ready = false; unit.atb = 0; } return; }
    if (name === '状態異常解除：イベントバトル') {
      state.conditions = b.players.map(unit => [unit, [...(unit.conditions ?? [])]]);
      for (const unit of b.players) unit.conditions = [];
      return;
    }
    if (name === 'イベントバトル後見た目を状態異常に') {
      for (const [unit, conditions] of state.conditions ?? []) unit.conditions = conditions;
      return;
    }
    if (name === 'バルガスチェック') {
      const vargas = this.enemy(9), exposed = !b.enemies.some(unit => unit !== vargas && this.alive(unit));
      this.locals[3] = Number(exposed);
      if (exposed && vargas?.untargetable) this.condition(2, 9, 76, false);
      return;
    }
    if (name === 'バトルデータ保存：sc_b_0055') {
      this.bank('PlaySystems').battle0055 = this.entryPlayers.map(unit => ({ id: unit.id, hp: unit.hp, mp: unit.mp, conditions: [...(unit.conditions ?? [])] })); return;
    }
    if (name.startsWith('バトル参戦：') || name.startsWith('バトル加入：')) {
      const id = sourceIds[name.split('：')[1]]; if (id) this.addPlayer(id); return;
    }
    if (name === 'バルガスで離脱') {
      for (const unit of b.players) if (unit.id !== 6) { unit.hidden = true; unit.removed = true; unit.ready = false; }
      return;
    }
    if (name === 'ロックの変装チェック') {
      const locke = b.players.find(unit => unit.id === 2);
      this.locals[2] = locke?.conditions?.includes(79) ? 2 : locke?.conditions?.includes(80) ? 1 : locke?.disguise ?? 0; return;
    }
    if (name === 'ロック変装') { state.clothesStolen = true; return; }
    if (name === '商人・兵士回復') { for (const unit of b.players) { unit.hp = unit.maxHp; unit.mp = unit.maxMp; } return; }
    if (name === 'プレイヤーの状況で戦闘終了') { if (!b.players.some(unit => this.alive(unit))) this.locals[0] = -1; return; }
    if (name.startsWith('図鑑登録：')) { const book = this.bank('PlaySystems').bestiary ??= []; const entry = name.slice(5); if (!book.includes(entry)) book.push(entry); return; }
    if (name === 'ティナが魔法を使用したか') { if (state.terraMagic && Number(this.locals[1] ?? 0) === 0) this.locals[1] = 1; return; }
    if (name === 'イベントチェック：0036') {
      const terra = b.players.find(unit => unit.id === 1);
      if (Number(this.locals[1] ?? 0) === 2 && (terra?.hp <= 0 || this.aiEnded())) this.locals[1] = 3;
      return;
    }
    if (name === 'ティナダウン0036') { this.locals[3] = Number((b.players.find(unit => unit.id === 1)?.hp ?? 0) <= 0); return; }
    if (name === 'ティナ起き上がる0036') {
      const terra = b.players.find(unit => unit.id === 1); if (terra && terra.hp <= 0) { terra.hp = 1; terra.conditions = (terra.conditions ?? []).filter(id => id !== 5); } return;
    }
    if (/^ATBゲージ(取得|設定)/.test(name)) {
      if (name.includes('取得')) state.atb = b.players.map(unit => [unit, unit.atb]);
      else for (const [unit, atb] of state.atb ?? []) { unit.atb = atb; unit.ready = atb >= 100; }
      return;
    }
    if (name === 'ATBリセット(ディッグアーマー)' || name === 'ResetATBGaugeAllEnemy') {
      for (const unit of name.startsWith('Reset') ? b.enemies : [...b.players, ...b.enemies]) { unit.atb = 0; unit.ready = false; } return;
    }
    if (name === 'ティナトランス解除' || name === 'ティナトランス再開') { const terra = b.players.find(unit => unit.id === 1); if (terra) terra.morphed = name.endsWith('再開'); return; }
    if (name === 'CheckTimerIsUsing') { this.locals[1] = Number(Boolean(this.bank('PlaySystems').timer)); return; }
    if (name === 'タイマー一時停止') { if (this.bank('PlaySystems').timer) this.bank('PlaySystems').timer.paused = true; return; }
    if (name === '全滅でタイマー停止') { if (!b.players.some(unit => this.alive(unit)) && this.bank('PlaySystems').timer) this.bank('PlaySystems').timer.paused = true; return; }
    if (name === 'FinishBattleByTimeOut') { if (this.bank('PlaySystems').timer?.expired) this.forcedOutcome = { outcome: 'escape', code: 4, saved: false }; return; }
    if (name === 'ティナ回想セットアップ') { for (const unit of b.players) if (unit.id === 1) unit.magitek = true; return; }
    if (name === 'ティナ回想終了') { for (const entry of this.entryState) { entry.unit.hp = entry.hp; entry.unit.mp = entry.mp; } return; }
    if (name === 'ケフカファイナルアタックチェック') {
      const kefka = this.enemy(5);
      if (kefka && (!this.alive(kefka) || this.mode(kefka) > 0)) this.locals[1] = 1;
      return;
    }
    if (name === 'オルトロス潜る') { state.ultrosDiving = true; this.event('battle-effect', { name }); return; }
    if (name === 'フンババブレスで離脱') {
      for (const unit of b.players) if (unit.conditions?.some(id => Number(b.data.conditions?.[id]?.condition_type) === 13)) {
        unit.hidden = true; unit.removed = true;
      }
      return;
    }
    if (/^LB:敵パーティラウンド[234]$/.test(name)) {
      const round = Number(name.at(-1)), partyId = 511 + round;
      b.changeEnemyParty?.(partyId, { hidden: round === 4 }); this.locals[0] = 0; state.finalRound = round; return;
    }
    if (name === 'LB:プレイヤー消去' || name === 'LB:プレイヤー表示') {
      for (const unit of b.players) unit.hidden = name.endsWith('消去'); return;
    }
    if (name === 'LB:ケフカ降臨') { for (const unit of b.enemies) unit.hidden = false; return; }
    if (name === 'LB:プレイヤーパーティ変更') {
      const replacements = b.finalParty ?? [];
      for (let index = 0; index < b.players.length; index++) {
        if (this.alive(b.players[index])) continue;
        const replacement = replacements.map(id => typeof id === 'object' ? id : b.character?.(id)).find(unit => unit &&
          unit.hp > 0 && !b.players.includes(unit));
        if (!replacement) continue;
        b.completeUnit(replacement, b.data.characters?.[replacement.id] ?? {}, 'player', index);
        b.players.splice(index, 1, replacement); this.locals[2] = (this.locals[2] ?? 0) + 1;
      }
      this.warning('Final-battle replacements use the supplied living reserve order; portrait selection is simplified.'); return;
    }
    if (name === 'キングベヒーモス乱入') {
      const reinforcement = Object.values(b.data.monsters ?? {}).find(unit => /Behemoth/i.test(unit.name ?? '') &&
        unit.id !== b.enemies[0]?.monsterId && (unit.undead || /Undead|Zombie/i.test(unit.name ?? '')));
      if (!state.behemothSecond && this.aiEnded() && reinforcement) {
        state.behemothSecond = true; this.addEnemy(reinforcement.id, 5); this.locals[0] = 0;
      }
      this.locals[2] = 0; return;
    }
    if (name === '夢の三兄弟バトル' || name === 'しょくしゅバトル') {
      this.locals[2] = Number(b.enemies.some(unit => unit.eventMoving)); return;
    }
    if (name === 'チェイサー消滅チェック') {
      if (!state.trappers && !b.enemies.some(unit => /Chaser/i.test(unit.name ?? '') && this.alive(unit))) {
        state.trappers = true; this.locals[1] = 1;
      }
      return;
    }
    if (name === '狂信者の塔状態異常付与') {
      state.magicOnly = true;
      for (const unit of b.players) unit.magicOnly = true;
      this.warning('Cultists Tower automatic commands choose an actually learned damaging spell; manual command restriction is simplified.'); return;
    }
    if (name === 'デスゲイズHP設定' || name === 'デスゲイズHP保存') {
      const doom = b.enemies[0], bank = this.bank('PlaySystems');
      if (doom) {
        if (name.endsWith('保存')) bank.deathgazeHp = doom.hp;
        else if (bank.deathgazeHp > 0) doom.hp = Math.min(doom.maxHp, bank.deathgazeHp);
      }
      return;
    }
    if (name === 'プレゼンター死亡チェック') {
      if (b.enemies.some(unit => !this.alive(unit))) for (const unit of b.enemies) { unit.hp = 0; unit.ready = false; }
      return;
    }
    if (name === 'プレゼンター頭非表示チェック' || name === 'プレゼンター頭表示チェック') {
      const head = this.enemy(2);
      if (head?.hidden && name.includes('非表示')) this.locals[2] = 1;
      if (head && !head.hidden && name.includes('頭表示')) this.locals[2] = 3;
      return;
    }
    if (name === 'ソウルセイバー座標保存') { state.soulSaverPositions = b.enemies.map(unit => ({ unit, x: unit.x, y: unit.y })); return; }
    if (name === 'ソウルセイバーチェック') { this.locals[1] = Number(b.enemies.some(unit => this.alive(unit) && this.mode(unit) > 0)); return; }
    if (name === '敵バトル行動：ヒューリー') {
      const ability = Object.values(b.data.abilities ?? {}).find(ability => ability.process === 'FURY');
      if (ability) this.action([2, 5, ability.id, 1, 0]); else this.warning('Alexsoul possession uses the monster AI; its separate visual move is deferred.'); return;
    }
    if (name === 'シャドウ離脱抽選') { this.locals[3] = 0; this.warning('Random Shadow departure is deferred during automatic story play.'); return; }
    if (name === 'バトルでシャドウ離脱' || name === 'とびこむで離脱' || name === 'とりつくで離脱') {
      const units = name.startsWith('バトル') ? b.players.filter(unit => unit.id === 4) :
        b.players.filter(unit => unit.conditions?.some(id => [614, 628].includes(Number(b.data.conditions?.[id]?.condition_type))));
      for (const unit of units) { unit.removed = true; unit.hidden = true; unit.enabled = false; }
      if (!b.players.some(unit => this.alive(unit))) this.locals[0] = -1;
      return;
    }
    if (name === 'ガウバトルモード設定') {
      const veldt = Boolean(b.isVeldt ?? this.bank('PlaySystems').isVeldt), gau = b.character?.(12);
      if (veldt && b.players.some(unit => unit.id === 12)) this.locals[2] = 1;
      else if (veldt && gau?.enabled === false && b.players.length < 4 && b.random() < 0.7) {
        this.locals[2] = 2; this.endEnabled = false;
      }
      return;
    }
    if (name === '敵パーティをガウに') {
      const gau = Object.values(b.data.monsters ?? {}).find(unit => /^Gau$/i.test(unit.name ?? ''));
      if (gau) { b.enemies.splice(0); this.addEnemy(gau.id, this.program.name === 'sc_b_0738' ? 5 : 3); }
      else { this.endEnabled = true; this.warning('Gau return monster is absent; retaining the original encounter.'); }
      return;
    }
    if (name === 'ガウ初回予約') {
      this.bank('ScenarioVariable')[8] = 1; this.bank('PlaySystems').reservedScript = 'sc_e_0239'; return;
    }
    if (name === '血塗られた盾') { return; }
    if (/^(参戦待ち表示|マッシュIdle00|シャドウ追いかける|空のテキストウィンドウ表示)$/.test(name) ||
        /Z値|重なり順|向き変更|エフェクト再生|ケフカ(笑う|指振り|驚く|歩く|正面)|背景|画面揺れ|ガウ登場アニメ|魔石化イベント/.test(name)) {
      this.event('battle-effect', { name, i, r });
      this.warning('Source battle staging, actor orientation and effects currently use simplified presentation.'); return;
    }
    this.event('battle-syscall', { name, i, r });
    this.warning(`${name}: detailed event behavior is deferred; the PR program continues.`);
  }
}
