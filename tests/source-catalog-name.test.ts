import { compileCharacterGrowth } from "../src/compiler/character-growth.js";
import { newGameFixture } from "./fixtures/new-game.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createSourceCatalogNameResolver } from "../src/compiler/source-catalog-name.js";
import { bindBattleEventMessageInput } from "../src/compiler/battle-event-message-bindings.js";
import { battleMessageDictionariesFixture } from "./fixtures/battle-message-dictionaries.js";
import { sourceNativeStateFixture } from "./fixtures/source-native-state.js";
import { parseSourceCatalogName, prepareSourceCatalogName } from "../src/core/source-catalog-name.js";
import { BattleGame } from "../src/core/battle.js";
import { fixture } from "./fixtures/battle-content.js";
import { participantFixture, participantSessionFixture } from "./fixtures/battle-participant-game.js";
import { enemyBattleDefinition } from "../src/core/battle-participants.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { CheckpointStorage } from "../src/core/saved-game.js";

function input(text = "Enemy (OWNER_TAG)") {
  const f = battleMessageDictionariesFixture();
  const row = f.corpus.tables["character_default_name.csv"][0]!;
  row.tag_name = "OWNER_TAG"; row.character_id = "2";
  f.field.messages.story_mes_zhc.KEY = text; f.corpus.messages.story_mes_zhc.KEY = text;
  f.field.messages.story_cha_zhc.KEY = ""; f.corpus.messages.story_cha_zhc.KEY = "";
  return bindBattleEventMessageInput(f.field, f.corpus, f.rows);
}
const label = () => createSourceCatalogNameResolver(input()).sourceCatalogName!("KEY");
function owner() { const f = sourceNativeStateFixture(); return { ...f, state: f.development() }; }
function rename(state: ReturnType<typeof owner>["state"], value: string) {
  const saved = state.snapshot(); saved.roster[0]!.name = value; saved.characterNames.OWNER_TAG = value; state.restore(saved);
}
function namesBattle(content = fixture(), names = owner().state.fieldMessageNames) {
  return new BattleGame(content, 73, undefined, undefined, undefined, undefined, undefined, undefined, { names });
}

test("one bound dictionary preserves literal system names and separates empty speakers from body labels", () => {
  const resolver = createSourceCatalogNameResolver(input("Story label"));
  assert.equal(resolver("SYSTEM"), "System text"); assert.equal(resolver("KEY"), "Story label");
  assert.equal(resolver("OTHER"), "Other table text"); assert.equal(resolver("SHARED_SPEAKER"), "System body");
  const controlled = input("Text<WAIT>later"), withControls = createSourceCatalogNameResolver(controlled);
  assert.throws(() => withControls("KEY"), /presentation/);
  assert.equal(withControls.literalBody("KEY"), "Text<WAIT>later", "existing ability consumer retains its own diagnostics");
  assert.throws(() => createSourceCatalogNameResolver(input()).literalBody("KEY"), /live owned-name/);
  assert.throws(() => resolver("absent"), /Missing/);
  assert.throws(() => createSourceCatalogNameResolver({ messages: input().messages }), /complete source/);
  const data = input("Original label"), copy = createSourceCatalogNameResolver(data);
  (data.messages.story_mes_zhc as Record<string, string>).KEY = "mutated";
  assert.equal(copy("KEY"), "Original label");
});
test("source changes, conflicting/equal body keys and legacy binding cannot grant catalog names", () => {
  for (const alter of [
    (v: ReturnType<typeof input>) => { (v.messages.story_mes_zhc as Record<string, string>).KEY = "changed"; },
    (v: ReturnType<typeof input>) => { (v.characterNames as { tag_name: string }[])[0]!.tag_name = "changed"; },
    (v: ReturnType<typeof input>) => { v.binding!.sources[0]!.source.objectId = "9223372036854775808"; },
  ]) { const data = input(); alter(data); assert.throws(() => createSourceCatalogNameResolver(data)); }
  for (const text of ["Full text", "different"]) {
    const f = battleMessageDictionariesFixture(); (f.field.messages.system_zhc as Record<string, string>).KEY = text;
    assert.throws(() => bindBattleEventMessageInput(f.field, f.corpus, f.rows), /Duplicate/);
  }
});
test("generic static callers reject dynamic names; unknown controls, tags and fee substitutions retain gates", () => {
  assert.throws(() => createSourceCatalogNameResolver(input())("KEY"), /live owned-name/);
  for (const text of ["(UNKNOWN)", "(KINGAKU)", "<WAIT>name", "line\nbreak", "", " spaced "])
    assert.throws(() => createSourceCatalogNameResolver(input(text)).sourceCatalogName!("KEY"));
  const value = label(); assert.equal(value.nameSource!.dictionary, "story_mes_zhc");
  assert.equal(value.nameSource!.template.pages[0]!.filter(part => part.kind === "character-name")[0]!.ref.sourceId, 2);
  assert.throws(() => prepareSourceCatalogName(value.name, undefined), /compiled template/);
  assert.throws(() => prepareSourceCatalogName(value.name, value.nameSource), /held-name owner/);
  assert.throws(() => parseSourceCatalogName(value.nameSource, "tampered"), /template\/binding/);
  assert.throws(() => parseSourceCatalogName({ ...value.nameSource, dictionary: "story_cha_zhc" }, value.name));
});
test("dynamic names use the actual held, off-party, disabled owner; unheld and stale names do not fall back", () => {
  const { state } = owner(), value = label(); rename(state, "Chosen name");
  const saved = state.snapshot(); saved.roster[0]!.enabled = false;
  for (const slot of saved.party.slots) for (const cell of slot) cell.id = null;
  state.restore(saved);
  assert.equal(prepareSourceCatalogName(value.name, value.nameSource, state.fieldMessageNames).name, "Enemy Chosen name");
  const prepared = prepareSourceCatalogName(value.name, value.nameSource, state.fieldMessageNames);
  rename(state, "Later name"); assert.throws(prepared.validate, /Stale/);
  const unheld = structuredClone(value.nameSource!); const ref = unheld.template.pages[0]!.find(part => part.kind === "character-name")!;
  ref.ref.sourceId = 3; assert.throws(() => prepareSourceCatalogName(value.name, unheld, state.fieldMessageNames), /Missing owned/);
});
test("initial enemy labels resolve before publication and immutable content retains the original bound template", () => {
  const c = fixture(), value = label(), { state } = owner(); Object.assign(c.enemies[0]!, value);
  const before = structuredClone(c), battle = namesBattle(c, state.fieldMessageNames);
  assert.equal(battle.enemies[0]!.name, "Enemy SYNTHETIC_OWNER"); assert.deepEqual(c, before);
  assert.throws(() => new BattleGame(c, 73), /held-name owner/);
  c.players[0]!.nameSource = value.nameSource!; assert.throws(() => namesBattle(c), /Owned player names/);
});
test("a constructor-started legacy source root validates late labels before its candidate can publish", () => {
  const c = participantFixture([]); Object.assign(c.participants!.enemyDefinitions[341]!, label());
  c.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 1,
    program: { kind: "battle-event-v1", source: null, entry: 0, end: 2, localNames: [], initialLocals: [], blockers: [], instructions: [
      { mnemonic: "AddEnemy", op: { kind: "add-enemy", monsterId: 341, uniqueId: 2 } }, { mnemonic: "Exit", op: { kind: "exit" } }] } };
  const state = owner().state;
  assert.throws(() => namesBattle(c, { prepare(refs) { const view = state.fieldMessageNames.prepare(refs); let n = 0;
    return { names: view.names, validate() { view.validate(); if (++n > 1) throw new Error("stale constructor label"); } }; } }), /stale constructor label/);
});
test("late replacement and whole-party replacement use the same held-name consumer and instance fences", () => {
  const c = participantFixture([{ kind: "add-enemy", monsterId: 341, uniqueId: 2 }]), value = label();
  Object.assign(c.participants!.enemyDefinitions[341]!, value);
  c.participants!.enemyParties = { 700: { members: [{ sourceId: 341, uniqueId: 4 }], slots: { 2: { x: 0, y: 0, group: 1 }, 4: { x: 0, y: 0, group: 1 } } } };
  c.lifecycle!.mode === "script" && c.lifecycle!.program.instructions.splice(3, 0,
    { mnemonic: "wait", op: { kind: "wait", seconds: .02 } }, { mnemonic: "change-party", op: { kind: "change-enemy-party", partyId: 700, hidden: false } });
  if (c.lifecycle!.mode === "script") c.lifecycle!.program.end += 2;
  const battle = namesBattle(c), old = battle.enemies[0]!.id;
  battle.advance(10); assert.equal(battle.enemies.find(unit => unit.sourceId === 341)!.name, "Enemy SYNTHETIC_OWNER");
  const joined = battle.enemies.find(unit => unit.sourceId === 341)!.id;
  battle.advance(50); assert.equal(battle.enemies.length, 1); assert.equal(battle.enemies[0]!.name, "Enemy SYNTHETIC_OWNER");
  assert.notEqual(battle.enemies[0]!.id, joined); assert.notEqual(battle.enemies[0]!.id, old);
});
test("a late stale-name validation rolls back the same frame's instance, AI, RNG, clocks and log; retry reuses the same step", () => {
  const c = participantFixture([{ kind: "add-enemy", monsterId: 341, uniqueId: 2 }]); Object.assign(c.participants!.enemyDefinitions[341]!, label());
  const state = owner().state; let fail = true;
  const battle = namesBattle(c, { prepare(refs) { const view = state.fieldMessageNames.prepare(refs); let n = 0;
    return { names: view.names, validate() { view.validate(); if (++n > 1 && fail) throw new Error("controlled stale label"); } }; } });
  const before = { units: structuredClone(battle.combatants), event: battle.eventExecution, time: battle.time, log: [...battle.events] };
  assert.throws(() => battle.advance(10), /controlled stale label/);
  assert.deepEqual({ units: battle.combatants, event: battle.eventExecution, time: battle.time, log: battle.events }, before);
  fail = false; battle.advance(0); const control = namesBattle(c); control.advance(10);
  assert.deepEqual(battle.combatants, control.combatants); assert.deepEqual(battle.eventExecution, control.eventExecution);
});
function session(alter?: (f: ReturnType<typeof participantSessionFixture>) => void) {
  const f = participantSessionFixture([]), o = owner();
  const lifecycle = f.battle.encounters[1000]!.lifecycle!;
  if (lifecycle.mode === "script") lifecycle.program.source = { sourceSetHash: "a".repeat(64), battleSourceSetHash: "b".repeat(64),
    file: "synthetic.bundle", sha256: "c".repeat(64), assetPath: "synthetic-name-session", serializedFile: "synthetic", objectId: "9007199254740993" };
  f.battle.encounters[1000]!.rewardPolicy = { kind: "battle-reward-policy-v1", ap: 0, magicPoints: 0 };
  // An authored ordinary-condition lifecycle, not the original riding scene.
  o.player.conditionIds = []; o.content.initialOwnedConditions = [{ id: o.player.id, conditionIds: [] }];
  const growth = newGameFixture();
  growth.tables["learning.csv"] = [];
  growth.tables["game_constant_int.csv"]!.find(row => row.key_name === "MAX_LV")!.value1 = "3";
  growth.tables["intermediate_growth_curve.csv"]![0]!.growth_curve_group_id = "1";
  growth.tables["growth_curve.csv"] = [1, 2, 3].map(level => ({ id: String(level), group_id: "1", lv: String(level),
    hp_value1: "0", hp_value2: "0", mp_value1: "0", mp_value2: "0", insert_type_1: "1", insert_type_2: "1", insert_type_3: "1" }));
  o.content.characterGrowth = { [o.player.id]: compileCharacterGrowth(growth.reader(), growth.tables, o.definition.characters[0]!.template).plan };
  f.battle.common.players = [o.player]; f.battle.common.conditions = o.conditions; f.battle.gameState = o.content;
  Object.assign(f.battle.encounters[1000]!.enemies[0]!, label());
  f.battle.encounters[1000]!.participants!.enemyDefinitions[2000] = enemyBattleDefinition(f.battle.encounters[1000]!.enemies[0]!);
  alter?.(f);
  const game = new GameSession(f.field, f.battle, 73, { battleHandoff: "prepared" }), flow = new GameFlow(game);
  rename(game.state, "Session owner"); flow.start(); flow.advance(0, { visible: true, mediaReady: true, overlayOpen: false });
  game.field.startEvent("fight"); game.advance(10); return { ...f, game, flow };
}
function finish(game: GameSession) {
  for (let n = 0; n < 30000 && game.battle?.phase === "active"; n++) {
    for (const unit of game.battle.ready) { const target = game.battle.targets(unit.id, 10)[0]; if (target) game.battle.command(unit.id, 10, target.id); }
    game.advance(10);
  }
  assert.equal(game.battle?.phase, "victory");
}
test("actual Session name owner survives media failure/cancel/retry, battle return, Storage and the next encounter", async () => {
  const f = session(), { game, flow } = f, owned = game.state.snapshot(), request = game.field.stop;
  const failure = new GameBattleHandoff(flow, { async prepareStart() { throw new Error("controlled media failure"); }, async prepareReturn() { return null; }, discard() {} });
  assert.equal((await failure.start()).status, "failed"); assert.deepEqual(game.state.snapshot(), owned); assert.equal(game.field.stop, request);
  const cancelled = game.prepareBattleStart()!; cancelled.discard(); assert.equal(game.battle, null); assert.deepEqual(game.state.snapshot(), owned);
  assert.equal(game.prepareBattleStart()!.commit(), true); assert.equal(game.battle!.enemies[0]!.name, "Enemy Session owner");
  const retrySeed = structuredClone(game.battle!.combatants);
  for (const player of game.battle!.players) { player.hp = 0; player.conditionIds = [305]; }
  game.advance(10); assert.equal(game.battle!.phase, "defeat");
  game.prepareBattleRetry()!.discard(); assert.deepEqual(game.state.snapshot(), owned);
  assert.equal(game.prepareBattleRetry()!.commit(), true); assert.deepEqual(game.battle!.combatants, retrySeed);
  finish(game); assert.equal(game.prepareBattleReturn()!.commit(), true); game.advance(10);
  const data = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } });
  assert.equal(JSON.stringify(game.checkpoint()).includes("source-catalog-name-v1"), false, "saved state cannot install label definitions");
  await storage.save(game.checkpoint(), 1000); const saved = (await storage.load())!;
  const restored = GameSession.restore(saved.checkpoint, f.field, f.battle, undefined, { battleHandoff: "prepared" }); assert.deepEqual(restored.checkpoint(), saved.checkpoint);
  assert.equal(restored.state.snapshot().characterNames.OWNER_TAG, "Session owner");
  restored.field.startEvent("fight"); restored.advance(10); assert.equal(restored.prepareBattleStart()!.commit(), true);
  assert.equal(restored.battle!.enemies[0]!.name, "Enemy Session owner"); finish(restored);
  assert.equal(restored.prepareBattleReturn()!.commit(), true); restored.advance(10);
  assert.equal(restored.state.snapshot().completedBattles.length, 2);
});

test("a real Session refuses an unheld name and releases its candidate lease without altering field/owned state", () => {
  const { game } = session(f => {
    const unit = f.battle.encounters[1000]!.enemies[0]!;
    const ref = unit.nameSource!.template.pages[0]!.find(part => part.kind === "character-name")!;
    ref.ref.sourceId = 3;
    f.battle.encounters[1000]!.participants!.enemyDefinitions[2000] = enemyBattleDefinition(unit);
  });
  const before = game.state.snapshot(), request = game.field.stop;
  const candidate = game.prepareBattleStart()!;
  assert.throws(() => candidate.commit(), /Missing owned message character/);
  assert.equal(game.battle, null); assert.equal(game.state.inBattle, false);
  assert.deepEqual(game.state.snapshot(), before); assert.equal(game.field.stop, request);
});
