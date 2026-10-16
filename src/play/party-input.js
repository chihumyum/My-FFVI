// Source party menus pause their calling task. This module handles the same
// player input for manual UI and auto play; it never recruits a character,
// writes plot flags, changes HP, moves a party, or dispatches a story script.
export const partyInputSelectors = Object.freeze({
  'パーティ編成：１パーティ': 'one',
  'パーティ編成：オペラ入場': 'opera',
  'パーティ編成：２パーティ': 'two',
  'パーティ編成：３パーティ': 'three',
  'パーティ編成：ラストバトル': 'final',
});
const ids = values => [...new Set((values ?? []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
const flag = (game, index) => Number(game.banks?.ScenarioFlag1?.[index] ?? 0);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const emit = (game, kind, payload) => game.event?.(kind, payload);

// An inspected/named character can already have a roster object without ever
// joining. Initial party members have no enabled property until their first
// source roster operation; their existing slot is the only fallback authority.
export function partyInputMembers(game, mode = 'one') {
  const assigned = new Set((game.partySlots ?? []).flat());
  return Object.values(game.roster ?? {}).filter(unit => {
    const id = Number(unit.id), inSlot = assigned.has(id);
    return id > 0 && unit.enabled !== false && unit.available !== false && unit.selectable !== false &&
      (unit.enabled === true || inSlot) && (mode !== 'final' || inSlot) &&
      // Regular formation menus do not recruit reserve NPC/guest records.
      // An existing temporary party member can still be kept in their party.
      (id <= 14 || inSlot);
  });
}

function countAfterMenu(game, task) {
  const ops = game.data?.programs?.[task?.program]?.ops ?? [];
  const start = Math.max(0, Number(task?.pc) || 0);
  for (let pc = start; pc < Math.min(ops.length, start + 16); pc++) {
    const [name, i = [], , s = []] = ops[pc];
    if (['Exit', 'Return', 'ChangeScript', 'ChangeMap', 'Encount', 'EncountBoss', 'SysCall', 'Select'].includes(name)) break;
    // The authored post-menu checks either jump on ==size to continue, or
    // jump on !=size to ask again. Both constrain the active party's size.
    if (name === 'BranchByNumOfMember' && i[0] === 0 && i[1] > 0 && i[1] <= 4 &&
      ['＝', '=', '==', '≠', '!='].includes(s[0])) return i[1];
  }
  return null;
}

function modelFor(game, mode, task, requirements = {}) {
  const slotCount = mode === 'two' ? 2 : ['three', 'final'].includes(mode) ? 3 : 1;
  const members = partyInputMembers(game, mode), available = new Set(members.map(unit => Number(unit.id)));
  // These are formation defaults, not plot actions. Opera locks Celes/Locke;
  // ordinary menus retain Locke/Celes during the Imperial infiltration period.
  const forced = mode === 'final' ? [] : mode === 'opera' ? [7, 2] :
    flag(game, 155) === 1 && flag(game, 203) === 0 ? [2, 7] : [];
  const include = ids([...forced, ...(requirements.include ?? [])]);
  const exclude = new Set(ids(requirements.exclude));
  const sourceCount = slotCount === 1 ? countAfterMenu(game, task) : null;
  const requestedCount = requirements.count === undefined ? null : Number(requirements.count);
  const exact = sourceCount ?? requestedCount;
  const minimum = Math.max(mode === 'final' ? 1 : 1, Number(requirements.minimum) || 1, include.length);
  const limits = Array.from({ length: 3 }, (_, index) => index >= slotCount ? { minimum: 0, maximum: 0 } :
    { minimum: index === 0 ? minimum : mode === 'final' ? 0 : 1, maximum: index === 0 && exact !== null ? exact : 4 });
  if (exact !== null) limits[0].minimum = Math.max(limits[0].minimum, exact);
  const problems = [];
  for (const id of include) {
    if (!available.has(id)) problems.push(`Required character ${id} has not joined or is unavailable.`);
    if (exclude.has(id)) problems.push(`Required character ${id} is also excluded.`);
  }
  if (requestedCount !== null && (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 4))
    problems.push('The active party must contain between one and four members.');
  if (sourceCount !== null && requestedCount !== null && sourceCount !== requestedCount)
    problems.push(`The source menu requires ${sourceCount} members, while the requested input asks for ${requestedCount}.`);
  if (limits[0].minimum > limits[0].maximum) problems.push('Required members do not fit the requested party size.');
  if (members.filter(unit => !exclude.has(Number(unit.id))).length < limits.reduce((sum, limit) => sum + limit.minimum, 0))
    problems.push('There are not enough available recruited members for these parties.');
  return { mode, slotCount, members: members.map(unit => ({ id: Number(unit.id), name: unit.name,
    hp: unit.hp, maxHp: unit.maxHp, reserve: Boolean(unit.reserve) })),
  forced, include, exclude: [...exclude], limits, requirements: { ...requirements }, sourceCount, problems };
}

function suggest(game, model) {
  const available = new Set(model.members.map(member => member.id).filter(id => !model.exclude.includes(id)));
  const current = (game.partySlots ?? [[], [], []]).map(slot => ids(slot));
  const order = ids([...current.flat(), ...model.members.map(member => member.id)]).filter(id => available.has(id));
  const slots = [[], [], []], used = new Set();
  const add = (slot, id) => {
    if (!available.has(id) || used.has(id) || slots[slot].length >= model.limits[slot].maximum) return false;
    slots[slot].push(id); used.add(id); return true;
  };
  for (const id of model.include) add(0, id);
  // Give every requested party its own member before filling any party to four.
  for (let slot = 0; slot < model.slotCount; slot++) {
    for (const id of [...current[slot], ...order]) {
      if (slots[slot].length >= model.limits[slot].minimum) break;
      add(slot, id);
    }
  }
  for (let slot = 0; slot < model.slotCount; slot++) {
    for (const id of current[slot]) add(slot, id);
  }
  for (const id of order) for (let slot = 0; slot < model.slotCount; slot++) if (add(slot, id)) break;
  return slots;
}

function menuPayload(menu) {
  const { task, ...payload } = menu;
  return payload;
}

export function openPartyInput(game, { mode = 'one', requirements = {}, name = 'party-menu' } = {}, task = null) {
  if (!['one', 'opera', 'two', 'three', 'final'].includes(mode)) return false;
  if (game.partySelection) return false;
  // A field UI must only offer formation where the source exposes it. This
  // low-level menu entry does not turn ordinary walking/battle into an airship
  // formation affordance; source-triggered menus pass their paused task.
  if (!task && (game.busy || game.battle || game.loading || game.dialogue)) return false;
  const model = modelFor(game, mode, task, requirements);
  game.partySelection = { ...model, name, task, slots: suggest(game, model) };
  if (task) task.waitFor = 'party';
  emit(game, 'party-menu', menuPayload(game.partySelection));
  return true;
}

// Intercept exactly these five source SysCalls BEFORE the older automatic
// formation handler. Caller task.pc already points just after the SysCall.
export function executePartyInput(game, task, name, requirements = {}) {
  if (!Object.hasOwn(partyInputSelectors, name)) return false;
  const mode = partyInputSelectors[name];
  if (game.partySelection) {
    if (game.partySelection.task !== task && task) { task.pc--; task.wait = 0.05; }
    return true;
  }
  openPartyInput(game, { mode, name, requirements: requirements ?? {} }, task);
  return true;
}

export function validatePartyInput(game, slots, requirements) {
  const menu = game.partySelection;
  if (!menu) return { ok: false, reasons: ['No party menu is open.'] };
  const model = modelFor(game, menu.mode, menu.task, requirements ?? menu.requirements);
  const reasons = [...model.problems], result = [[], [], []], used = new Set();
  if (!Array.isArray(slots) || slots.length > 3) reasons.push('Supply up to three arrays of character IDs.');
  else for (let index = 0; index < 3; index++) {
    const input = slots[index] ?? [];
    if (!Array.isArray(input) || input.length > 4) { reasons.push(`Party ${index + 1} has more than four positions.`); continue; }
    for (const raw of input) {
      if (raw === null || raw === undefined || raw === 0) continue;
      const id = Number(raw);
      if (!Number.isInteger(id) || id < 1 || !model.members.some(member => member.id === id) || model.exclude.includes(id))
        reasons.push(`Character ${raw} is unavailable for this menu.`);
      else if (used.has(id)) reasons.push(`Character ${id} cannot be in two positions.`);
      else { used.add(id); result[index].push(id); }
    }
    const limit = model.limits[index];
    if (result[index].length < limit.minimum || result[index].length > limit.maximum)
      reasons.push(`Party ${index + 1} needs ${limit.minimum === limit.maximum ? limit.minimum : `${limit.minimum}–${limit.maximum}`} members.`);
  }
  for (let index = 0; index < model.forced.length; index++) if (result[0][index] !== model.forced[index])
    reasons.push(`Source member ${model.forced[index]} must remain in position ${index + 1} of the first party.`);
  for (const id of model.include) if (!result[0].includes(id)) reasons.push(`Character ${id} must be in the first party.`);
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], slots: result, model };
}

function leaderAppearance(game) {
  const id = game.partySlots[0]?.[0], unit = game.roster?.[id];
  if (!game.player || !unit) return;
  const asset = game.data?.fieldAssets?.[id];
  game.player.characterId = id;
  game.player.asset = typeof asset === 'string' ? asset : asset?.asset_name ?? `mo_ff6_p${String(id).padStart(3, '0')}`;
}

function finish(game, accepted) {
  const menu = game.partySelection;
  if (menu.task) {
    menu.task.locals ??= [];
    menu.task.locals[0] = accepted ? 1 : 0;
    menu.task.result = accepted ? 1 : 0;
    if (menu.task.waitFor === 'party') menu.task.waitFor = null;
  }
  game.partySelection = null;
  emit(game, 'party-menu-close', { accepted, mode: menu.mode });
}

export function submitPartyInput(game, slots = game.partySelection?.slots, requirements) {
  const outcome = validatePartyInput(game, slots, requirements);
  if (!outcome.ok) {
    if (game.partySelection) game.partySelection.problems = outcome.reasons;
    return outcome;
  }
  const menu = game.partySelection;
  const finalOrder = menu.mode === 'final' ? outcome.slots.flat() : null;
  // The final menu orders combatants, rather than retaining the tower's three
  // walking teams. The first four fight together; later rows are substitutes.
  game.partySlots = finalOrder ? [finalOrder.slice(0, 4), finalOrder.slice(4, 8), finalOrder.slice(8, 12)] : outcome.slots;
  game.partyIndex = 0;
  if ((menu.slotCount === 1 || finalOrder) && game.rts) game.rts.active = false;
  // The existing RTS host reads the number of configured groups here. It is
  // a derived formation result, not story advancement: a later one-party
  // menu must replace the three-party count left by the Narshe defense.
  game.banks ??= {};
  (game.banks.ScenarioVariable ??= {})[5] = outcome.model.slotCount;
  const selected = new Set(outcome.slots.flat());
  for (const member of outcome.model.members) {
    const unit = game.roster[member.id];
    unit.reserve = !selected.has(member.id);
    if (selected.has(member.id)) unit.row = 'front';
  }
  if (finalOrder) game.finalBattleOrder = finalOrder;
  leaderAppearance(game);
  finish(game, true);
  emit(game, 'party', { partyIndex: 0, members: [...game.partySlots[0]], slots: game.partySlots.map(slot => [...slot]) });
  return { ok: true, slots: game.partySlots.map(slot => [...slot]), mode: menu.mode };
}

export function autoPartyInput(game, requirements) {
  const menu = game.partySelection;
  if (!menu) return { ok: false, reasons: ['No party menu is open.'] };
  const model = modelFor(game, menu.mode, menu.task, requirements ?? menu.requirements);
  const previousProblems = [...menu.problems];
  const slots = suggest(game, model), outcome = submitPartyInput(game, slots, model.requirements);
  if (!outcome.ok && !same(previousProblems, outcome.reasons)) game.warn?.(menu.task, outcome.reasons.join(' '));
  return outcome;
}

export function cancelPartyInput(game) {
  if (!game.partySelection) return false;
  // Cancel keeps the existing composition and returns control to the source.
  // The source formation menu selects the first saved party when it closes.
  game.partyIndex = 0;
  leaderAppearance(game);
  finish(game, false);
  return true;
}
