import { isVeldt } from './encounters.js';
import { equipmentDefinition, emptyEquipment, recalculateEquipment } from './progression.js';
import { optimizeEquipment } from './resources.js';
const bank = (game, name) => game.banks[name] ??= {};
const systems = game => bank(game, 'PlaySystems');
const pose = actor => ({ x: actor.x, y: actor.y, layer: actor.layer, direction: actor.direction, vehicle: actor.vehicle });
const rows = (game, name) => game.data.systemTables?.[name] ?? [];
const replaceTask = (game, task, name) => {
  const program = game.resolve(name);
  if (program === undefined) { game.warn(task, `Missing timed callback ${name}; skipped.`); return; }
  task.program = program; task.pc = 0; task.stack = [];
  task.locals = [...(game.data.programs[program].locals ?? [])]; task.done = false; task.waitFor = null;
};

function timerCanAdvance(game, timer) {
  const inEvent = (game.tasks ?? []).some(task => !task.done && !task.background && task.actor === null);
  return !timer.paused && !game.loading && (game.battle ? timer.battle : game.dialogue ? timer.message : inEvent ? timer.event : true);
}
const cidCanAdvance = (game, cid) => !game.busy && timerCanAdvance(game,
  { ...cid, battle: false, message: false, event: false });
const timerSource = (game, task) => ({ script: game.data.programs[task?.program]?.name,
  index: task ? task.pc - 1 : -1, mapId: game.mapId });

// Waiting is an ordinary input. A source SetTimer is the authorization for its
// eventual callback; a story objective, a flag or an absent route is not.
// Both manual UI and the auto driver can display this state. Reading it never
// advances time, dispatches a callback, changes a flag or selects a battle.
export function pendingEventInput(game) {
  const state = game.banks?.PlaySystems, cid = state?.cid;
  // The source Cid restart is a callback-free counter. Waiting until it runs
  // out is legitimate input, but only the next ordinary talk/check determines
  // the outcome; the host must not launch a death/recovery script here.
  if (cid && !cid.paused && cid.remaining > 0) return { status: 'wait-event', counter: 'cid', callback: null,
    remaining: cid.remaining, timer: { duration: cid.duration, visible: false, expired: false,
      advancing: Boolean(cidCanAdvance(game, cid)), source: cid.source } };
  const timer = state?.timer;
  if (!timer || timer.dispatched || timer.paused) return null;
  const callback = (timer.callbacks ?? []).find(name => game.resolve?.(name, game.mapId) !== undefined);
  if (!callback) return null;
  return { status: 'wait-event', callback, remaining: Math.max(0, Number(timer.remaining) || 0),
    timer: { duration: timer.duration, visible: timer.visible, expired: Boolean(timer.expired),
      advancing: !timer.expired && Boolean(timerCanAdvance(game, timer)), source: timer.source } };
}

export function configureSyscallTimer(game, task, i = [], r = [], s = []) {
  const duration = Math.max(0, Number(r[0] || 0));
  systems(game).cid = null;
  systems(game).timer = { remaining: duration, duration, visible: i[0] === 0, battle: i[1] === 0,
    message: i[2] === 1, event: i[3] === 1, callbacks: s.filter(Boolean), paused: false, expired: false, dispatched: false,
    source: timerSource(game, task) };
  game.timer = game.time + duration;
  game.event('timer', { duration, visible: i[0] === 0 });
}
export function finishSyscallTimer(game) { systems(game).timer = null; systems(game).cid = null; game.timer = null; }

export function updateSyscallSystems(game, seconds) {
  const state = systems(game), dt = Math.max(0, Number(seconds) || 0), timer = state.timer;
  if (timer && !timer.expired) {
    if (timerCanAdvance(game, timer)) timer.remaining = Math.max(0, timer.remaining - dt);
    game.timer = game.time + timer.remaining;
    if (timer.remaining === 0) { timer.expired = true; game.event('timer-expired'); }
  }
  if (timer?.expired && !timer.dispatched && !game.battle && !game.loading && !game.dialogue &&
      !game.partySelection && !game.shop && !game.vehicleMenu &&
      !game.tasks.some(task => !task.done && !task.background)) {
    const callback = timer.callbacks.find(name => game.resolve(name) !== undefined);
    timer.dispatched = true;
    if (callback) game.startScript(callback);
  }
  if (state.cid && cidCanAdvance(game, state.cid)) {
    const before = state.cid.remaining;
    state.cid.remaining = Math.max(0, before - dt);
    if (before > 0 && state.cid.remaining === 0) game.event('cid-timer-expired');
  }
  if (state.shadow && !state.shadow.expired) {
    state.shadow.remaining = Math.max(0, state.shadow.remaining - dt);
    if (!state.shadow.remaining) { state.shadow.expired = true; game.event('shadow-timer'); }
  }
  if (state.messageUntil !== undefined && game.time >= state.messageUntil) {
    if (game.dialogue?.auto) game.confirm();
    delete state.messageUntil;
  }
  if (state.lightPath?.active && !game.busy) {
    const point = [Math.floor(game.player.x), Math.floor(game.player.y)];
    const previous = state.lightPath.trail.at(-1);
    if (!previous || point[0] !== previous[0] || point[1] !== previous[1]) state.lightPath.trail.push(point);
  }
}

const shopGroups = {
  'フィガロ城(初期)道具屋_右': 1, 'フィガロ城(初期)道具屋_左': 2,
  'フィガロ城(城移動可能後)道具屋_右': 22, 'フィガロ城(城移動可能後)道具屋_左': 23,
  'フィガロ城(崩壊後)道具屋_右': 68, 'フィガロ城(崩壊後)道具屋_左': 69,
  'フィガロ城(初期_エドガー先頭)道具屋_右': 83, 'フィガロ城(初期_エドガー先頭)道具屋_左': 84,
  'フィガロ城(城移動可能後_エドガー先頭)道具屋_右': 85, 'フィガロ城(城移動可能後_エドガー先頭)道具屋_左': 86,
  'フィガロ城(崩壊後_エドガー先頭)道具屋_右': 87, 'フィガロ城(崩壊後_エドガー先頭)道具屋_左': 88,
  '一軒家_行商': 8, 'モブリズの村(武器屋)': 10, 'モブリズの村(防具屋)': 11,
  'モブリズの村(アクセサリー屋)': 12, 'モブリズの村(道具屋)': 13,
  'サウスフィガロの町(崩壊後)武器屋': 64, 'サウスフィガロの町(崩壊後)防具屋': 65,
  'サウスフィガロの町(崩壊後)アクセサリー屋': 66, 'サウスフィガロの町(崩壊後)道具屋': 67,
  'サウスフィガロの町(崩壊後_エドガー先頭)武器屋': 89, 'サウスフィガロの町(崩壊後_エドガー先頭)防具屋': 90,
  'サウスフィガロの町(崩壊後_エドガー先頭)アクセサリー屋': 91, 'サウスフィガロの町(崩壊後_エドガー先頭)道具屋': 92,
};
export function shopStock(game, groupId) {
  return rows(game, 'product').filter(row => Number(row.group_id) === groupId && Number(row.content_id) > 0).map(row => {
    const contentId = Number(row.content_id), content = game.battleData.contents?.[contentId];
    const item = content?.type_id === 1 ? game.battleData.items?.[content.type_value] : content?.type_id === 2 ?
      game.battleData.weapons?.[content.type_value] : game.battleData.armors?.[content?.type_value];
    return { id: contentId, name: game.battleData.contentNames?.[contentId] || game.text(content?.mes_id_name), price: Math.max(0, (item?.buy ?? 0) + Number(row.coefficient || 0)),
      limit: Number(row.purchase_limit) || 0, productId: Number(row.id) };
  }).filter(product => product.price > 0);
}
export function openShop(game, groupId, task = null) {
  game.shop = { groupId, stock: shopStock(game, groupId), task };
  systems(game).shop = { groupId, stock: game.shop.stock };
  if (task) task.waitFor = 'shop';
  game.event('shop', systems(game).shop);
  return true;
}
export function buyFromShop(game, contentId, count = 1) {
  const product = game.shop?.stock?.find(item => item.id === contentId);
  if (!Number.isInteger(count) || count <= 0) return false;
  const worn = Object.values(game.roster ?? {}).reduce((total, unit) => total + (unit.equipment ?? []).filter(id => id === contentId).length, 0);
  const held = Number(game.inventory[contentId] ?? 0) + worn;
  const bought = Number(systems(game).purchases?.[product?.productId] ?? 0);
  if (!product || game.gil < product.price * count || held + count > (game.battleData?.limits?.MAX_ITEM ?? 99) ||
      product.limit > 0 && bought + count > product.limit) return false;
  game.gil -= product.price * count;
  game.inventory[contentId] = (game.inventory[contentId] ?? 0) + count;
  systems(game).purchases ??= {};
  systems(game).purchases[product.productId] = bought + count;
  game.event('shop-buy', { contentId, count, price: product.price * count });
  return true;
}
export function sellToShop(game, contentId, count = 1) {
  if (!game.shop || !Number.isInteger(count) || count <= 0 || (game.inventory[contentId] ?? 0) < count) return false;
  const content = game.battleData.contents?.[contentId];
  const item = content?.type_id === 1 ? game.battleData.items?.[content.type_value] : equipmentDefinition(game.battleData, contentId);
  if (!item || item.type_id === 2 || item.sales_not_possible || !(item.sell > 0)) return false;
  game.inventory[contentId] -= count;
  game.gil = Math.min(game.battleData?.limits?.MAX_GIL ?? 9999999, game.gil + item.sell * count);
  game.event('shop-sell', { contentId, count, price: item.sell * count });
  return true;
}

export function closeShop(game) {
  if (!game.shop) return false;
  if (game.shop.task?.waitFor === 'shop') game.shop.task.waitFor = null;
  game.shop = null;
  systems(game).shop = null;
  game.event('shop-close');
  return true;
}

export function autoShopInput(game, purchase) {
  if (!game.shop) return false;
  for (const request of [purchase, ...(game.autoPurchase?.(game) ?? [])].filter(Boolean)) {
    const needed = Math.max(0, (request.count || 1) - (game.inventory[request.contentId] || 0));
    const price = game.shop.stock.find(item => item.id === request.contentId)?.price;
    const count = Math.min(needed, Math.floor(game.gil / (price || Infinity)));
    if (count && !buyFromShop(game, request.contentId, count))
      game.warn(game.shop.task, `Cannot buy content ${request.contentId}: unavailable stock, inventory cap or insufficient gil.`);
    else if (request === purchase && count < needed)
      game.warn(game.shop.task, `Cannot fully buy required content ${request.contentId}: insufficient gil.`);
  }
  return closeShop(game);
}

export function shopScriptsForContent(game, contentId) {
  const names = new Set(Object.entries(shopGroups).filter(([, id]) => shopStock(game, id).some(product => product.id === contentId)).map(([name]) => name));
  return Object.values(game.data.programs).filter(program => program.ops.some(op =>
    op[0] === 'SysCall' && names.has(op[3]?.[0]?.replace(/^ショップを開く:/, '')))).map(program => program.name);
}

export function executeEventSystem(game, task, name, i, r, { characterSelectors, names, warn }) {
  const state = systems(game), subject = name.split(/[：:]/).slice(1).join('：');
  if (name.startsWith('ショップを開く:')) {
    const groupId = shopGroups[subject];
    if (!groupId) warn(`Shop selector ${subject} has no mapped product group; using an empty shop.`);
    openShop(game, groupId, task);
    return true;
  }
  if (name === 'リネームカード') { game.event('name', { id: game.party[0]?.id, name: game.party[0]?.name }); return true; }
  if (name === 'コロシアム回復' || name === '商人・兵士回復') {
    for (const unit of game.party) { unit.hp = unit.maxHp; unit.mp = unit.maxMp; unit.conditions = []; }
    return true;
  }
  if (name === 'コロシアム開始') {
    game.event('colosseum', { available: Object.keys(game.inventory).filter(id => game.inventory[id] > 0) });
    task.locals[0] = 0;
    warn('Colosseum currently returns without placing an automatic wager.');
    return true;
  }
  if (name === 'タイマー一時停止' || name === 'タイマー一時停止解除') {
    if (state.timer) state.timer.paused = name === 'タイマー一時停止';
    return true;
  }
  if (name === '時間切れでスクリプト変更') {
    if (state.timer?.expired && !state.timer.dispatched) {
      const callback = state.timer.callbacks.find(name => game.resolve(name) !== undefined);
      if (callback) { state.timer.dispatched = true; replaceTask(game, task, callback); }
    }
    return true;
  }
  if (name === 'タイマー表示') { if (state.timer) state.timer.visible = true; game.event('timer-display'); return true; }
  if (name === 'PC版のみミリ秒指定で待機') { task.wait = Math.max(task.wait || 0, Math.max(0, r[0] || i[0] || 0) / 1000); return true; }
  if (name === '一定時間後メッセージ消去') { state.messageUntil = game.time + (r[0] > 0 ? r[0] : 2); return true; }
  if (name.startsWith('シドタイマー：')) {
    if (subject === 'HPチェック' || subject === '一時停止') {
      bank(game, 'ScenarioVariable')[2] = Math.trunc(state.cid?.remaining ?? state.timer?.remaining ?? 0);
      if (subject === '一時停止') finishSyscallTimer(game);
    } else if (subject === 'タイマーチェック' || subject === '再開') {
      const health = Number(bank(game, 'ScenarioVariable')[2] ?? 0);
      if (subject === 'タイマーチェック' && (health < 30 || health > 255)) finishSyscallTimer(game);
      else if (health > 0) {
        // Both selectors replace the one global timer, rather than leaving
        // the initial120s callback alive beside a second health countdown.
        finishSyscallTimer(game);
        state.cid = { remaining: health, duration: health, paused: false, source: timerSource(game, task) };
      } else if (health < 0) warn('Cid resume received a negative source counter; keeping it stopped.');
    } else return false;
    return true;
  }
  if (name === 'シャドウタイマー設定') {
    if (state.timer?.remaining > 5 && !state.shadow) state.shadow = { remaining: state.timer.remaining - 5, expired: false };
    return true;
  }
  if (name === 'シャドウタイマー解除') { state.shadow = null; return true; }
  if (name === '全滅でタイマー停止') {
    if (game.party.every(unit => unit.hp <= 0) && state.timer) state.timer.paused = true;
    return true;
  }
  if (name === 'オピニンクス時間計測開始') { state.battleClock = game.time; return true; }
  if (name.startsWith('図鑑登録：')) {
    state.bestiary ??= [];
    if (!state.bestiary.includes(subject)) state.bestiary.push(subject);
    return true;
  }
  if (name === '全員の装備を外す' || name === '控えメンバーの装備を外す') {
    const current = new Set(game.partySlots[game.partyIndex]);
    for (const unit of Object.values(game.roster)) {
      if (unit.enabled === false || name.startsWith('控え') && current.has(unit.id)) continue;
      for (const contentId of unit.equipment ?? []) {
        const definition = equipmentDefinition(game.battleData, contentId);
        if (definition && definition.type_id !== 2)
          game.inventory[contentId] = (game.inventory[contentId] ?? 0) + 1;
      }
      unit.equipment = Array.from({ length: 6 }, (_, slot) => emptyEquipment(game.battleData, slot));
      recalculateEquipment(game.battleData, unit);
    }
    game.event('equipment-removed', { reserveOnly: name.startsWith('控え') });
    return true;
  }
  if (name.startsWith('最強装備：')) {
    const id = characterSelectors[subject];
    if (!id) return false;
    const unit = game.unit(id);
    optimizeEquipment(game, id, { duringEvent: true });
    game.event('equipment', { id, equipment: unit.equipment });
    return true;
  }
  if (name === 'バードビュー情報を保存') { state.worldPose = { ...pose(game.player), mapId: game.mapId }; return true; }
  if (name === 'バードビュー情報を設定') {
    if (state.worldPose && state.worldPose.mapId === game.mapId) Object.assign(game.player, state.worldPose);
    return true;
  }
  if (name === 'リーダーがチョコボに乗る') { game.player.vehicle = 3; return true; }
  if (name.startsWith('チョコボ') && /パペット/.test(name)) { game.player.visible = true; game.camera.manual = false; return true; }
  if (name.startsWith('飛空艇目的地移動：') || name.startsWith('蛇の道移動：') || name.startsWith('トロッコ移動：')) {
    // Some wrappers retain their authored movement request in the immediately preceding Nop.
    const previous = game.data.programs[task.program]?.ops[task.pc - 2];
    const request = r.some(Boolean) ? { i, r } : previous?.[0] === 'Nop' && previous[2]?.some(Boolean) ? { i: previous[1], r: previous[2] } : { i, r };
    state.travel = { name, mapId: game.mapId, elapsed: 0, duration: Math.max(0, request.r[0] || 0), request };
    game.event('travel-sequence', state.travel);
    warn('World, serpent and minecart sequences retain PR timing; camera-track geometry is simplified.');
    return true;
  }
  if (name === 'トロッコ移動終了待') { task.wait = Math.max(task.wait || 0, r[0] || state.travel?.duration || 0); return true; }
  if (name.startsWith('オペラ')) {
    state.opera ??= { active: false, playing: false };
    if (name === 'オペラシステム開始') state.opera.active = true;
    if (name === 'オペラアセット先読み') state.opera.loaded = true;
    if (name === 'オペラアセット再生開始') {
      state.opera.playing = true; game.event('opera', { stage: bank(game, 'MapLocalVariable')[7] ?? 0 });
      warn('Opera currently follows PR dialogue and scene transitions; interactive musical playback is deferred.');
    }
    if (name === 'オペラシステム終了') { state.opera.active = false; state.opera.playing = false; }
    if (name === 'オペラ用ロック戻す') game.unit(2).disguise = 0;
    return true;
  }
  if (name === '芝居のセリフ練習メッセージ表示') {
    const text = Object.entries(game.data.messages).filter(([key]) => /^E0315_/.test(key)).slice(0, 5).map(([, text]) => text).join('\n');
    game.event('opera-practice', { text });
    return true;
  }
  if (name.startsWith('光の道')) {
    if (name.endsWith('設定')) state.lightPath = { active: true, trail: [] };
    if (name.endsWith('停止') && state.lightPath) state.lightPath.active = false;
    if (name === '光の道判定') {
      // Correct trigger ordering is authored by the PR scripts in MapLocalVariable1/2.
      const variables = bank(game, 'MapLocalVariable');
      task.locals[0] = Number(Number(variables[1]) > 0 && Number(variables[1]) === Number(variables[2]));
      warn('Light-path validation uses PR trigger order; pixel-distance tolerance is simplified.');
    }
    return true;
  }
  if (/^ギミック(開始|解除)：/.test(name)) {
    state.gimmicks ??= {};
    state.gimmicks[subject] = name.startsWith('ギミック開始');
    game.event('gimmick', { name: subject, active: state.gimmicks[subject] });
    warn('Gimmicks retain active state; detailed painting and switch motion is deferred.');
    return true;
  }
  if (name === 'ダリルの墓') { game.event('puzzle', { name }); warn('Tomb text arrangement currently retains authored dialogue without a separate UI.'); return true; }
  if (name === 'Entity更新状態：メッセージ') { state.entitiesWhileMessage = true; return true; }
  if (name === 'ミニマップ表示') { game.minimapVisible = true; return true; }
  if (name === 'UI非表示') { game.uiVisible = false; return true; }
  if (name === 'マップUI全て表示') { game.uiVisible = true; return true; }
  if (name === '獣ヶ原にいる') {
    task.locals[0] = Number(isVeldt(game));
    return true;
  }
  if (name === 'ロック変装') {
    const unit = game.unit(2), form = Number(task.locals[2] ?? 0);
    unit.disguise = form; state.lockeDisguise = form;
    game.event('disguise', { id: 2, form });
    return true;
  }
  if (name === 'ティナトランス解除' || name === 'ティナトランス再開') { game.unit(1).morphed = name.endsWith('再開'); return true; }
  if (name === 'コマンド追加：トランス') { const unit = game.unit(1); unit.commands = [...new Set([...(unit.commands ?? []), 9])]; return true; }
  if (name.startsWith('アビリティ習得：')) {
    const id = subject === '夢幻闘舞' ? 6 : subject === '必殺剣' ? 3 : null;
    if (!id) return false;
    const unit = game.unit(id);
    const learned = rows(game, 'learning').filter(row => Number(row.job_id) === id).map(row => ({ row, content: game.battleData.contents?.[row.content_id] }))
      .filter(entry => entry.content?.type_id === 4);
    unit.abilities = [...new Set([...(unit.abilities ?? []), ...learned.map(entry => entry.content.type_value)])];
    game.event('learned', { id, ability: subject });
    warn('Special training currently unlocks the character PR learning rows; command-menu presentation is simplified.');
    return true;
  }
  if (name === '非同期マップマネージャーを作成する' || name === '非同期マップマネージャーの読み込み待機' || name === 'エンディング用のシーン破棄') {
    state.endingScene = true; return true;
  }
  if (name.startsWith('スタッフロール')) {
    state.credits ??= { segments: [] };
    if (name.includes('再生：')) { state.credits.segments.push(subject); game.event('credits', { segment: subject }); }
    if (name.includes('終了待ち')) task.wait = Math.max(task.wait || 0, 1);
    warn('Staff-roll segments are emitted in source order; the full credit animation is deferred.');
    return true;
  }
  if (name === 'エンディング：謝辞') { state.endingAcknowledgements = true; game.event('ending-acknowledgements'); return true; }
  if (name === 'AndYou表示') { game.event('credits', { text: 'And You' }); return true; }
  if (name === 'キー入力待ち' || name === 'キー入力、BGM再生終了待ち') {
    task.wait = Math.max(task.wait || 0, .15);
    warn('Cinematic input waits currently confirm after a short pause.');
    return true;
  }
  if (name === 'コンティニュー表示') { game.event('continue'); return true; }
  if (name === 'アドバタイズデモからタイトル遷移') { if (game.demo) game.event('title-screen'); return true; }
  return false;
}
