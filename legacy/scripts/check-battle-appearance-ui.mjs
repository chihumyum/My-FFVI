// Controlled DOM/Canvas + real BattleGame. These are renderer-contract probes,
// not original-game orientation scheduling or browser raster parity.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { BattleView } from '../apps/game/battle-view.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--runtime',
  'Usage: check-battle-appearance-ui.mjs [--runtime build/test-output]');
const runtime = resolve(root, args[1] ?? 'dist');
const load = (file) => import(pathToFileURL(resolve(runtime, file)));
const [{ BattleGame }, { battleAppearanceQuads }, { battleEntryAppearanceFixture }, { projectDevelopmentBattleLayout }] = await Promise.all([
  load('src/core/battle.js'), load('src/core/battle-appearance.js'), load('tests/fixtures/battle-entry-runtime.js'),
  load('src/core/battle-layout.js'),
]);
class Element {
  constructor() {
    this.children = []; this.parentElement = null; this.textContent = ''; this.disabled = false;
    this.classList = { toggle() {} };
  }
  setAttribute() {}
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, before) {
    node.remove();
    const index = before === null ? this.children.length : this.children.indexOf(before);
    assert.ok(index >= 0); this.children.splice(index, 0, node); node.parentElement = this; return node;
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null;
  }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  querySelectorAll() { return []; }
}
const elements = new Map(['battle-return', 'battle-retry', 'party', 'battle-ui', 'battle-result',
  'battle-result-title', 'battle-result-text', 'battle-levels', 'battle-menu', 'battle-action'].map((id) => [id, new Element()]));
globalThis.document = { getElementById(id) { assert.ok(elements.has(id)); return elements.get(id); },
  createElement() { return new Element(); }, activeElement: null };
const draws = [], transforms = [];
const ctx = new Proxy({ drawImage(...args) { draws.push(args); },
  scale(...args) { transforms.push(args); } }, { get(target, key) { return target[key] ?? (() => {}); } });
const canvas = { getContext: () => ctx };
const { content, inventory } = battleEntryAppearanceFixture();
content.conditions.rules.definitions.push({ id: 701, type: 1, overlapped: false, eraseGroupId: 4 });
content.conditions.behaviors.push({ id: 701, kind: 'defend', name: '', untilType: 1 });
content.battleAppearance.conditions.push({ id: 701, type: 1 });
content.formation = 'opposed';
content.background = 'background';
content.sprites.background = { file: 'synthetic-background.png', width: 512, height: 288 };
for (const enemy of content.enemies) {
  enemy.placement = { ...enemy.placement, group: 2 };
  enemy.sprites.idle = 'enemy:' + enemy.id;
  content.sprites[enemy.sprites.idle] = { file: 'synthetic-' + enemy.id + '.png', width: 32, height: 32 };
}
const battle = new BattleGame(content, 61, undefined, inventory);
const images = new Map(Object.values(content.sprites).map((sprite) => [sprite.file, { file: sprite.file }]));
const view = new BattleView(canvas, content, images, () => {}, () => {}, battleAppearanceQuads, projectDevelopmentBattleLayout);
view.sync(battle, false);
assert.equal(view.rows.get('a').name.textContent, battle.players[0].name + ' · 前排', 'hidden 607 must not leave a separator');
assert.equal(battle.command('a', 10, { kind: 'single', id: 'e1' }, 7), true);
battle.advance(10);
assert.equal(battle.action.actor, 'a'); assert.equal(battle.action.elapsed, 0);
const requests = [], original = battle.appearanceFrame.bind(battle);
battle.appearanceFrame = (actorId, frame) => { requests.push({ actorId, ...frame }); return original(actorId, frame); };
function draw() { draws.length = 0; requests.length = 0; transforms.length = 0; view.draw(battle); }
function expectedFile(name) { return content.sprites[battle.players[0].appearance.bodySprites[name]].file; }
function bodyDraws(name) { return draws.filter((args) => args[0]?.file === expectedFile(name)); }
const checked = [];
const unbound = new BattleView(canvas, content, images, () => {}, () => {}, battleAppearanceQuads);
assert.throws(() => unbound.position(battle.players[0], battle), /layout provider/);
assert.throws(() => unbound.draw(battle), /layout provider/);
checked.push('draw and position explicitly reject a missing shared layout provider');
draw();
assert.equal(requests.find((request) => request.actorId === 'a').key, 'IdleR00');
assert.equal(requests.find((request) => request.actorId === 'b').key, 'default');
assert.equal(transforms.length, battle.enemies.length, 'only the legacy right-side enemies are mirrored');
const armorIndex = draws.findIndex((args) => args[0]?.file === 'synthetic-armor-right.png');
const bodyIndex = draws.findIndex((args) => args[0]?.file === expectedFile('IdleR_00'));
assert.ok(armorIndex >= 0 && bodyIndex > armorIndex, 'armor draws before its body layer');
const origin = view.position(battle.players[0], battle);
assert.deepEqual(draws[armorIndex].slice(1), [0, 0, 40, 40, origin.x - 20, origin.y - 40, 40, 40]);
assert.deepEqual(bodyDraws('IdleR_00').map((args) => args.slice(1)), [
  [0, 0, 20, 1, origin.x - 10, origin.y - 42, 20, 7.5],
  [0, 0, 20, 22.5, origin.x - 10, origin.y - 34.5, 20, 22.5],
]);
checked.push('opposed target-right selects exact right aliases; armor/body order and UV destination rectangles');
// Deliberately inject HP/current conditions to exercise the render branches;
// battle status settlement and native provenance are verified by separate suites.
const actor = battle.players[0];
actor.hp = 1; actor.conditionIds.push(content.conditions.dying.conditionId);
view.sync(battle, false);
assert.equal(view.rows.get('a').name.textContent, actor.name + ' · 前排 · ' + battle.conditions.name(content.conditions.dying.conditionId));
draw();
assert.equal(requests.find((request) => request.actorId === 'a').key, 'dyingR00');
assert.equal(bodyDraws('DyingR_00').length, 2);
checked.push('dying right alias; hidden status does not create empty separators');
actor.conditionIds.push(701);
draw();
assert.equal(requests.find((request) => request.actorId === 'a').key, 'ready');
assert.equal(bodyDraws('Ready_00').length, 2);
assert.equal(transforms.length, battle.enemies.length, 'source Ready does not invent a right mirror');
checked.push('Defend uses source Ready before dying; body and armor retain the exact source orientation');
actor.hp = 0; actor.conditionIds = [53, content.conditions.hpZeroConditionId];
draw();
assert.equal(requests.find((request) => request.actorId === 'a').key, 'down');
assert.equal(bodyDraws('Down_00').length, 2);
assert.ok(actor.appearanceState.magitek); assert.equal(actor.appearanceState.nowCharaSize, 11);
checked.push('death retains armor and Magitek effect posture');
actor.hp = 20; actor.conditionIds = [];
draw();
assert.equal(actor.appearanceState.magitek, null); assert.equal(actor.appearanceState.nowCharaSize, 1);
assert.equal(draws.some((args) => args[0]?.file === 'synthetic-armor-right.png'), false);
assert.deepEqual(bodyDraws('IdleR_00').map((args) => args.slice(1)), [[0, 0, 20, 30, origin.x - 10, origin.y - 30, 20, 30]]);
checked.push('condition removal clears cached UV/position, hides armor and restores ordinary posture');
for (const [formation, groups] of [
  ['normal', Array(9).fill(2)],
  ['opposed', Array(9).fill(2)],
  ['opposed', [1, 2, 1, 2, 1, 2, 1, 2, 1]],
]) {
  const many = structuredClone(content), base = structuredClone(content.enemies[0]);
  many.formation = formation;
  many.enemies = groups.map((group, index) => {
    const key = `layout-enemy:${index}`;
    many.sprites[key] = { file: `synthetic-layout-enemy-${index}.png`, width: 32, height: 48 };
    return { ...structuredClone(base), id: key, placement: { x: 999, y: -999, group },
      sprites: { idle: key, mount: null } };
  });
  const full = new BattleGame(many, 83, undefined, inventory);
  const media = new Map(Object.values(many.sprites).map(sprite => [sprite.file, { file: sprite.file }]));
  const fullView = new BattleView(canvas, many, media, () => {}, () => {}, battleAppearanceQuads,
    projectDevelopmentBattleLayout);
  draws.length = 0; transforms.length = 0;
  const before = JSON.stringify(full.combatants.map(unit => [unit.id, unit.placement, unit.row, unit.hp, unit.atb]));
  fullView.draw(full);
  const anchors = [];
  for (const enemy of full.enemies) {
    const sprite = many.sprites[enemy.sprites.idle], position = fullView.position(enemy, full);
    const painted = draws.find(args => args[0]?.file === sprite.file);
    assert.ok(painted, `Missing draw for ${enemy.id}`);
    assert.deepEqual(painted.slice(5), [position.x - 16, position.y - 48, 32, 48]);
    assert.ok(painted[5] >= 0 && painted[5] + painted[7] <= 512);
    assert.ok(painted[6] >= 0 && painted[6] + painted[8] <= 155,
      'Enemy sprite stays above the desktop four-member battle-menu overlay, not merely inside the canvas');
    anchors.push(`${position.x},${position.y}`);
  }
  assert.equal(new Set(anchors).size, 9);
  assert.equal(transforms.length, formation === 'normal' ? 0 : groups.filter(group => group === 2).length);
  assert.equal(JSON.stringify(full.combatants.map(unit => [unit.id, unit.placement, unit.row, unit.hp, unit.atb])), before);
  checked.push(`${formation}, groups ${groups.join(',')}: all nine ordinary sprites have distinct visible anchors; renderer uses shared facing and preserves battle state`);
}
const report = { kind: 'controlled-dom-canvas-and-real-battle-runtime', nativeSemanticsVerified: false,
  browserRasterVerified: false, layoutScope: '512x288 desktop development layout; ground anchors at or above y=155 reserve the four-member menu area, not a guarantee for every viewport size',
  injectedState: 'HP and condition list only for render branch selection', checked, passed: true };
await mkdir(resolve(root, 'build/reports'), { recursive: true });
await writeFile(resolve(root, 'build/reports/battle-appearance-ui-check.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ checked: checked.length, passed: true }));
