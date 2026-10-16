import { executeEventSystem, updateSyscallSystems, configureSyscallTimer, finishSyscallTimer } from './event-systems.js';
export { updateSyscallSystems, configureSyscallTimer, finishSyscallTimer };
// PR SysCall labels carry the selector; their eight numeric operands are normally zero.
// These are source character IDs, including temporary characters, rather than party indices.
export const characterSelectors = Object.freeze({
  'ティナ': 1, 'ロック': 2, 'カイエン': 3, 'シャドウ': 4, 'エドガー': 5, 'マッシュ': 6,
  'セリス': 7, 'ストラゴス': 8, 'リルム': 9, 'セッツァー': 10, 'モグ': 11, 'ガウ': 12,
  'ゴゴ': 13, 'ウーマロ': 14, 'バナン': 15, 'レオ': 16, 'ゆうれい-１': 17, 'ゆうれい-２': 18,
  'モグ（ナルシェSIM）': 29, 'マディン': 30, 'ウェッジ': 31, 'ビックス': 32, 'ケフカ': 33, 'ガストラ': 34,
});
const moogles = [19, 20, 21, 11, 22, 23, 24, 25, 26, 27, 28];
const names = { 1: '蒂娜', 2: '洛克', 3: '加源', 4: '影忍', 5: '埃德加', 6: '马修', 7: '莎莉丝',
  8: '斯特拉格斯', 9: '莉姆', 10: '西捷亚', 11: '莫古', 12: '嘎', 13: '格格', 14: '乌玛罗',
  15: '巴南', 16: '雷欧', 17: '幽灵', 18: '幽灵', 29: '莫古', 30: '马丁', 31: '魏吉', 32: '比格斯' };
const deployments = {
  'ティナ防衛戦': { mapId: 318, count: 3, points: [[12, 13], [14, 13]], protectedId: 1 },
  '幻獣防衛戦': { mapId: 19, count: 3, points: [[18, 9], [22, 9]], protectedId: 15 },
  '瓦礫の塔': { mapId: 542, count: 3, points: [[43, 21], [56, 22]] },
  'フェニックスの洞窟': { mapId: 497, count: 2, points: [[12, 6]] },
};
const suffix = name => name.split(/[：:]/).slice(1).join('：');
const bank = (game, name) => (game.banks[name] ??= {});
const pose = actor => ({ x: actor.x, y: actor.y, layer: actor.layer, direction: actor.direction });
const activeRoster = game => Object.values(game.roster).filter(unit => unit.enabled === true ||
  game.partySlots.some(slot => slot.includes(unit.id)));
function warnOnce(game, task, message) {
  game.syscallWarnings ??= new Set();
  if (game.syscallWarnings.has(message)) return;
  game.syscallWarnings.add(message);
  game.warn(task, message);
}
function refreshLeader(game) {
  const leader = game.party[0];
  if (leader) {
    const asset = game.data.fieldAssets?.[leader.id];
    game.player.characterId = leader.id;
    if (typeof asset === 'string') game.player.asset = asset;
    else if (asset?.asset_name) game.player.asset = asset.asset_name;
    else game.player.asset = `mo_ff6_p${String(leader.id).padStart(3, '0')}`;
  }
  game.camera.manual = false;
  game.event('party', { partyIndex: game.partyIndex, members: game.party.map(member => member.id) });
}
function correctLevel(game, unit, task) {
  const eligible = Object.values(game.roster).filter(other => other.id !== unit.id && other.id < 15 &&
    (other.enabled || game.partySlots.some(slot => slot.includes(other.id))));
  const target = eligible.length ? Math.trunc(eligible.reduce((sum, other) => sum + other.level, 0) / eligible.length) : 1;
  // First-join bonuses vary by character. Retain the PR initial level and use the party average as a floor.
  const level = Math.max(unit.level, Math.min(99, target));
  if (level > unit.level) {
    for (const growth of game.battleData.growth ?? []) if (growth.group_id === 1 && growth.lv > unit.level && growth.lv <= level) {
      unit.maxHp += growth.hp_value1;
      unit.maxMp += growth.mp_value1;
    }
    unit.level = level;
    unit.exp = Math.max(unit.exp ?? 0, game.battleData.expTable?.find(row => row.group_id === 1 && row.lv === level)?.total_exp ?? 0);
    warnOnce(game, task, 'First joins use the existing party average without character-specific level bonuses.');
  }
}
function join(game, id, task, recover = false) {
  const existed = Boolean(game.roster[id]?.enabled);
  const unit = game.unit(id);
  unit.name = /^角色\s*\d+$/.test(unit.name) ? names[id] ?? unit.name : unit.name;
  unit.enabled = true;
  unit.reserve = false;
  unit.row ??= 'front';
  if (!existed) correctLevel(game, unit, task);
  if (recover) { unit.hp = unit.maxHp; unit.mp = unit.maxMp; unit.conditions = []; }
  if (!game.partySlots.some(slot => slot.includes(id)) && game.partySlots[game.partyIndex].length < 4)
    game.partySlots[game.partyIndex].push(id);
  return unit;
}
function remove(game, id, reserve) {
  const unit = game.unit(id);
  unit.enabled = reserve;
  unit.reserve = reserve;
  for (let index = 0; index < game.partySlots.length; index++)
    game.partySlots[index] = game.partySlots[index].filter(member => member !== id);
}
function formParties(game, count, preferred = []) {
  const available = [...new Set([...preferred, ...game.partySlots.flat(), ...activeRoster(game).filter(unit => unit.id < 15).map(unit => unit.id)])]
    .filter(id => game.roster[id]?.enabled !== false && id > 0);
  const slots = [[], [], []], used = new Set();
  // Keep each existing leader when possible, then fill each active group to four.
  for (let index = 0; index < count; index++) {
    const leader = preferred[index] ?? game.partySlots[index]?.find(id => available.includes(id) && !used.has(id))
      ?? available.find(id => !used.has(id));
    if (leader) { slots[index].push(leader); used.add(leader); }
  }
  for (const id of available) if (!used.has(id)) {
    const target = slots.slice(0, count).find(slot => slot.length < 4);
    if (target) { target.push(id); used.add(id); }
  }
  game.partySlots = slots;
  game.partyIndex = Math.min(game.partyIndex, count - 1);
  for (const unit of activeRoster(game)) unit.reserve = !used.has(unit.id);
}
function selectParty(game, slot) {
  game.partyPositions ??= [];
  game.partyPositions[game.partyIndex] = { ...pose(game.player), mapId: game.mapId };
  game.partyIndex = Math.max(0, Math.min(2, slot));
  const next = game.partyPositions[game.partyIndex];
  if (next && (!next.mapId || next.mapId === game.mapId)) Object.assign(game.player, next);
  game.player.visible = true;
  game.player.motion = null;
  refreshLeader(game);
}

export function executeSyscall(game, task, name, i = [], r = []) {
  const subject = suffix(name), id = characterSelectors[subject];
  if (executeEventSystem(game, task, name, i, r, { characterSelectors, names, warn: message => warnOnce(game, task, message) })) return true;
  if (/^(メンバー加入|メンバー離脱|控えに移動)[：:]/.test(name)) {
    const joining = name.startsWith('メンバー加入');
    if (subject === 'モーグリたち') {
      if (joining) {
        for (const memberId of moogles) join(game, memberId, task, true);
        const leader = game.partySlots[0][0];
        game.partySlots = [[leader, 19, 20, 21].filter(Boolean), [11, 22, 23, 24], [25, 26, 27, 28]];
      } else {
        for (const memberId of moogles) remove(game, memberId, false);
        game.partyIndex = 0;
        if (game.rts) game.rts.active = false;
      }
    } else if (id) {
      if (joining) join(game, id, task);
      else remove(game, id, name.startsWith('控え'));
    } else return false;
    refreshLeader(game);
    return true;
  }
  if (/^名前入力[：:]/.test(name) && id) {
    const unit = game.unit(id);
    unit.enabled ??= game.partySlots.some(slot => slot.includes(id));
    // PR restores Terra's original job before the first naming screen.
    if (id === 1) { unit.jobId = 1; unit.magitek = false; }
    unit.name = /^角色\s*\d+$/.test(unit.name) || unit.name === '？？？？？？' ? names[id] ?? unit.name : unit.name;
    game.event('name', { id, name: unit.name });
    warnOnce(game, task, 'Name input currently keeps the default or existing character name.');
    return true;
  }
  if (name === 'アドバタイズデモフラグを設定') {
    bank(game, 'MapLocalVariable')[7] = game.demo ? 1 : 0;
    return true;
  }
  if (/データ初期化|DataInitialize/.test(name)) {
    if (!game.playDataInitialized) {
      for (const row of game.data.init ?? []) if (row.key_name?.startsWith('INIT_ITEM_'))
        game.inventory[Number(row.value1)] = (game.inventory[Number(row.value1)] ?? 0) + Number(row.value2 || 1);
      game.playDataInitialized = true;
    }
    return true;
  }
  if (/乗り物に乗る[：:]/.test(name)) {
    const vehicles = { '船': 2, 'チョコボ': 3, 'ブラックジャック号': 4, 'ファルコン号': 5,
      '魔導アーマー': 6, 'トランスティナ': 7, '鳥': 8 };
    const vehicle = vehicles[subject.replace(/\(.*$/, '')];
    if (!vehicle) return false;
    game.player.vehicle = vehicle;
    const systems = bank(game, 'PlaySystems');
    systems.vehicles ??= {};
    systems.vehicles[vehicle] = { ...pose(game.player), mapId: game.mapId };
    systems.currentVehicle = vehicle;
    const parameters = game.data.systemTables?.transportation?.find(row => Number(row.id) === vehicle);
    if (parameters?.bgm_id > 0) game.event('bgm', { id: Number(parameters.bgm_id) });
    if (vehicle === 6) for (const member of game.party) member.magitek = true;
    game.event('vehicle', { id: vehicle });
    return true;
  }
  if (/^乗り物から降りる/.test(name)) {
    const systems = bank(game, 'PlaySystems');
    if (game.player.vehicle) {
      systems.vehicles ??= {};
      systems.vehicles[game.player.vehicle] = { ...pose(game.player), mapId: game.mapId };
    }
    systems.currentVehicle = 1;
    if (game.player.vehicle === 6) for (const member of game.party) member.magitek = false;
    game.player.vehicle = null;
    game.event('vehicle', { id: 1 });
    return true;
  }
  if (name === '戦闘結果取得') {
    const result = game.battles.at(-1);
    task.locals[0] = result?.code ?? (result?.outcome === 'defeat' ? 2 : result?.outcome === 'escape' ? 1 : 0);
    return true;
  }
  if (name === 'バトルデータ復元：sc_b_0055') {
    for (const saved of bank(game, 'PlaySystems').battle0055 ?? []) {
      const unit = game.unit(saved.id);
      unit.hp = saved.hp; unit.mp = saved.mp; unit.conditions = [...saved.conditions];
      unit.removed = false; unit.hidden = false; unit.escaped = false; unit.untargetable = false;
    }
    delete bank(game, 'PlaySystems').battle0055;
    return true;
  }
  if (name === '戦闘不能キャラを全て蘇生' || name === '全滅してたら蘇生') {
    if (name === '戦闘不能キャラを全て蘇生' || game.party.every(member => member.hp <= 0))
      for (const member of game.party) if (member.hp <= 0) {
        member.hp = 1;
        member.conditions = (member.conditions ?? []).filter(condition => condition !== 5);
      }
    return true;
  }
  if (/^パーティ配置[：:]/.test(name) && deployments[subject]) {
    const preset = deployments[subject];
    game.partyPositions = [{ ...pose(game.player), mapId: preset.mapId }, ...preset.points.map(([x, y]) =>
      ({ x, y, layer: game.player.layer, direction: 'down', mapId: preset.mapId }))];
    game.partyIndex = 0;
    const variables = bank(game, 'ScenarioVariable');
    variables[4] = 0; variables[5] = preset.count;
    for (const index of [11, 12, 13]) variables[index] = preset.mapId;
    game.rts = { active: true, protectedId: preset.protectedId, count: preset.count };
    refreshLeader(game);
    game.event('party-deployment', { count: preset.count, positions: game.partyPositions });
    warnOnce(game, task, 'Multiple parties keep source starting cells; detailed inactive-party pathing is deferred.');
    return true;
  }
  if (/^ゲームオーバー設定[：:]/.test(name) && deployments[subject]) {
    game.rts ??= {};
    game.rts.protectedId = deployments[subject].protectedId;
    game.rts.loseOnContact = true;
    return true;
  }
  if (/^パーティ編成[：:]/.test(name)) {
    const count = /３|3|ラスト/.test(subject) ? 3 : /２|2/.test(subject) ? 2 : 1;
    formParties(game, count, subject.includes('オペラ') ? [7] : []);
    bank(game, 'ScenarioVariable')[5] = count;
    task.locals[0] = 1;
    refreshLeader(game);
    warnOnce(game, task, 'Party formation currently keeps existing members and fills free cells automatically.');
    return true;
  }
  if (name === 'RTS：エンカウントパーティ切替') {
    const slot = Number(bank(game, 'MapLocalVariable')[0] ?? -1);
    if (slot >= 0 && slot < 3 && game.partySlots[slot]?.length) {
      game.rtsEncounterParty = { index: game.partyIndex, pose: pose(game.player) };
      game.partyIndex = slot;
      const p = game.partyPositions?.[slot] ?? game.player;
      task.locals[0] = Math.trunc(game.player.x); task.locals[1] = Math.trunc(game.player.y);
      task.locals[2] = Math.trunc(p.x); task.locals[3] = Math.trunc(p.y);
    }
    return true;
  }
  if (name === 'RTS：エンカウント前パーティ復元') {
    if (game.rtsEncounterParty) {
      game.partyIndex = game.rtsEncounterParty.index;
      Object.assign(game.player, game.rtsEncounterParty.pose);
      game.rtsEncounterParty = null;
      refreshLeader(game);
    }
    return true;
  }
  if (name === 'RTS：操作パーティ切替' || name === 'RTS：操作パーティ切替（後）') {
    const variables = bank(game, 'ScenarioVariable');
    const count = Math.max(1, Math.min(3, variables[5] || game.partySlots.filter(slot => slot.length).length));
    const systems = bank(game, 'PlaySystems');
    const next = systems.pendingPartySwitch ?? (game.partyIndex + 1) % count;
    const destination = variables[11 + next];
    variables[11 + game.partyIndex] = game.mapId;
    if (name === 'RTS：操作パーティ切替' && destination && destination !== game.mapId && game.enter) {
      game.partyPositions ??= [];
      game.partyPositions[game.partyIndex] = { ...pose(game.player), mapId: game.mapId };
      systems.pendingPartySwitch = next;
      task.done = true;
      game.pending = game.enter(destination, 1, 'sc_sht_corps_after');
      return true;
    }
    selectParty(game, next);
    variables[4] = next;
    delete systems.pendingPartySwitch;
    return true;
  }
  if (name === 'RTS：マップスクリプト実行') {
    if (game.map?.initializer && game.startScript) game.startScript(game.map.initializer, { background: true, init: true });
    return true;
  }
  if (name.startsWith('夢のダンジョン：')) {
    if (subject === '分離') {
      const original = [...game.partySlots[game.partyIndex]];
      bank(game, 'PlaySystems').dreamParty = original;
      const split = original.slice(0, 2);
      game.partySlots[game.partyIndex] = original.slice(2);
      game.partySlots[1] = split[0] ? [split[0]] : [];
      game.partySlots[2] = split[1] ? [split[1]] : [];
      if (!game.partySlots[game.partyIndex].length && split.length) {
        game.partySlots[game.partyIndex] = [split.pop()]; game.partySlots[2] = [];
      }
    } else {
      const source = subject.startsWith('１') ? 1 : 2;
      for (const memberId of game.partySlots[source]) if (!game.partySlots[game.partyIndex].includes(memberId) && game.partySlots[game.partyIndex].length < 4)
        game.partySlots[game.partyIndex].push(memberId);
      game.partySlots[source] = [];
    }
    refreshLeader(game);
    return true;
  }
  if (name.startsWith('パペット入れ替え：')) {
    const systems = bank(game, 'PlaySystems');
    if (subject === '解除') {
      if (systems.puppetBackup) for (const [selector, saved] of systems.puppetBackup)
        Object.assign(game.actor(selector), saved);
      delete systems.puppetBackup;
    } else {
      systems.puppetBackup ??= [-1001, -1002, -1003, -1004].map(selector => {
        const actor = game.actor(selector); return [selector, { asset: actor.asset, characterId: actor.characterId }];
      });
      const slot = subject.includes('３') ? 2 : subject.includes('２') ? 1 : game.partyIndex;
      const members = game.partySlots[slot] ?? [];
      members.forEach((memberId, index) => {
        const actor = game.actor(-1001 - index);
        actor.characterId = memberId;
        actor.asset = game.data.fieldAssets?.[memberId]?.asset_name ?? actor.asset;
      });
      warnOnce(game, task, 'Puppet substitutions update source character appearances; advanced NPC bindings are deferred.');
    }
    return true;
  }
  if (name === 'RTS：他パーティと会話') {
    const actor = game.actor?.(task.actor);
    const slot = game.partyPositions?.findIndex((position, index) => index !== game.partyIndex && actor &&
      Math.abs(position.x - actor.x) < 1 && Math.abs(position.y - actor.y) < 1);
    task.locals[0] = slot >= 0 ? game.partySlots[slot]?.[0] ?? 0 : 0;
    return true;
  }
  if (/^カメラターゲット変更[：:]/.test(name)) {
    game.camera.manual = !subject.includes('プレイヤー');
    return true;
  }
  if (name === 'CheckTimerIsUsing') { task.locals[0] = Number(game.timer !== null && game.timer !== undefined); return true; }
  if (/^ATBゲージ取得/.test(name)) { game.savedAtb = game.party.map(member => member.atb ?? 0); return true; }
  if (/^ATBゲージ設定/.test(name)) { game.party.forEach((member, index) => { member.atb = game.savedAtb?.[index] ?? 0; }); return true; }
  if (name === 'ティナが魔法を使用したか') {
    task.locals[0] = Number(game.battle?.lastAction?.actor?.id === 1 && game.battle.lastAction.ability?.kind === 'magic');
    return true;
  }
  if (name === 'ロックの変装チェック') { task.locals[0] = game.unit(2).disguise ?? 0; return true; }
  if (name === 'StopAutoBattle') { game.autoBattle = false; return true; }
  if (name === '謎の幻獣戦バトルUI初期化') { game.eventBattleUI = true; return true; }
  if (/UI表示$|ShowBattleUI/.test(name)) { game.battleUIVisible = true; return true; }
  if (/UI非表示$|HideBattleUI/.test(name)) { game.battleUIVisible = false; return true; }
  if (/カメラ.*(追従|プレイヤー)|Camera.*(Reset|Follow)/i.test(name)) { game.camera.manual = false; return true; }
  if (/エフェクト|フィルター|スクロール|近景|遠景|背景変更|顔グラ|ED名前|Z値|重なり順|マスク|セピア中|キー入力.*待ち|パペット入れ替え/.test(name)) {
    warnOnce(game, task, 'Some SysCall visual effects and puppet replacements are deferred.');
    return true;
  }
  return false;
}
