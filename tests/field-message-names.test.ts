import test from "node:test";
import assert from "node:assert/strict";
import { compileManualMessageInstruction } from "../src/compiler/message.js";
import { fieldInstructionRequirements } from "../src/core/field-content-admission.js";
import { GameSession } from "../src/core/game-session.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import type { FieldGameOptions } from "../src/core/field.js";
import { choiceFixture, choiceExit, choiceAssign, choiceVariable } from "./fixtures/field-choice.js";
import { sourceNativeStateFixture } from "./fixtures/source-native-state.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

const rows = [{ id: "1", tag_name: "OWNER_TAG", character_id: "2" },
  { id: "2", tag_name: "UNHELD_TAG", character_id: "3" }];
function message(text = "<CT>Hello (OWNER_TAG)<P><CT>Again (OWNER_TAG)", speaker = "(OWNER_TAG)") {
  return compileManualMessageInstruction({ type: 1, mnemonic: "Msg", operands: {
    iValues: [0, 2, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0),
    sValues: ["TEXT", "", "", "", "", "", "", ""],
  } }, { story_mes_zhc: { TEXT: text }, story_cha_zhc: { TEXT: speaker } }, { nextMnemonic: "Exit" }, rows);
}
function setup(op = message(), options: FieldGameOptions = {}) {
  const owner = sourceNativeStateFixture().fresh();
  return { owner, ...choiceFixture([op, choiceAssign(17), choiceExit], {
    messageNames: owner.fieldMessageNames, ...options,
  }) };
}
function rename(owner: ReturnType<typeof sourceNativeStateFixture>["fresh"] extends () => infer S ? S : never,
  name: string) {
  const saved = owner.snapshot(); saved.roster[0]!.name = name; saved.characterNames.OWNER_TAG = name;
  owner.restore(saved);
}

test("body, speaker and all explicit pages use one held name snapshot, including centered layout", () => {
  const { field, owner, state } = setup(), raw = field.content.scripts.choice![0]!;
  field.startEvent("choice");
  assert.equal(field.dialogue?.text, "Hello SYNTHETIC_OWNER");
  assert.equal(field.dialogue?.speaker, "SYNTHETIC_OWNER"); assert.equal(field.dialogue?.alignment, "center");
  assert.equal(field.updateAttributeMask, 9); assert.equal(field.menuReady, false);
  rename(owner, "Renamed held owner");
  field.advance(10); field.confirm();
  assert.equal(field.dialogue?.text, "Again SYNTHETIC_OWNER", "the open content was resolved once at Play");
  field.advance(10); field.confirm();
  assert.equal(field.messageWindow, null); assert.equal(field.updateAttributeMask, 3);
  assert.equal(state.read(choiceVariable()), 17);
  assert.equal((raw as ReturnType<typeof message>).speaker, "(OWNER_TAG)", "rendering never overwrites content");
  field.startEvent("choice");
  assert.equal(field.dialogue?.text, "Hello Renamed held owner");
});

test("a compiled name dependency is reported before publishing a window when its port is missing", () => {
  const op = message(), { field, state } = setup(op);
  delete field.options.messageNames;
  const requirements = fieldInstructionRequirements(field.content.scripts.choice![0]!);
  assert.equal(requirements[0]!.code, "FIELD_MESSAGE_NAMES_PROVIDER");
  assert.equal(field.assessInstructionAdmission(field.content.scripts.choice![0]!).status, "blocked");
  field.startEvent("choice");
  assert.match(field.stop?.message ?? "", /name owner is unavailable/);
  assert.equal(field.dialogue, null); assert.equal(field.updateAttributeMask, 3);
  assert.equal(state.read(choiceVariable()), 0);
});

test("an unheld source character cannot use a potential template or default localized name", () => {
  const { field, owner, state } = setup(message("(UNHELD_TAG)", "")), before = owner.snapshot();
  field.startEvent("choice");
  assert.match(field.stop?.message ?? "", /Missing owned message character: 3/);
  assert.equal(field.dialogue, null); assert.equal(field.updateAttributeMask, 3);
  assert.deepEqual(owner.snapshot(), before); assert.equal(state.read(choiceVariable()), 0);
});

test("tampering with decoded source pages cannot redirect a valid name template", () => {
  const op = message(); op.manual.pages[1] = "different source page";
  const { field } = setup(op);
  field.startEvent("choice");
  assert.match(field.stop?.message ?? "", /template\/text binding mismatch/);
  assert.equal(field.dialogue, null); assert.equal(field.updateAttributeMask, 3);
});

test("an owner revision changed during mask preparation invalidates the old name without publishing the mask", () => {
  const owner = sourceNativeStateFixture().fresh(); let maskPublished = 0;
  const { field } = choiceFixture([message(), choiceExit], {
    messageNames: owner.fieldMessageNames, sourceMessageEffects: { prepare: () => {
      rename(owner, "Changed during preparation"); return () => { maskPublished++; };
    } },
  });
  field.startEvent("choice");
  assert.match(field.stop?.message ?? "", /Stale field message names/);
  assert.equal(maskPublished, 0); assert.equal(field.dialogue, null); assert.equal(field.updateAttributeMask, 3);
});

test("raw legacy value tokens have no literal fallback even without a template field", () => {
  const op = message(); delete op.template;
  const { field } = setup(op);
  field.startEvent("choice");
  assert.match(field.stop?.message ?? "", /requires a compiled template/);
  assert.equal(field.dialogue, null); assert.equal(field.updateAttributeMask, 3);
});

test("an ordinary nonmanual message resolves from the same provider without leaking its source placeholders", () => {
  const op = message("Hello (OWNER_TAG)");
  const { manual: _, ...plain } = op, owner = sourceNativeStateFixture().fresh();
  const { field } = choiceFixture([plain, choiceExit], { messageNames: owner.fieldMessageNames });
  field.startEvent("choice");
  assert.equal(field.dialogue?.text, "Hello SYNTHETIC_OWNER");
  assert.equal(field.dialogue?.speaker, "SYNTHETIC_OWNER"); assert.equal(field.dialogue?.template, undefined);
});

test("the fresh session and restored session install the same sole owned name provider", () => {
  const f = sourceNewGameFixture(), op = message("Hello (OWNER_TAG)");
  f.map.scripts.named = [op, { kind: "exit" as const }].map((value, index) => ({ ...value, index, script: "named", source: f.source }));
  f.map.scriptPuppetContexts!.named = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: "c".repeat(64) };
  const entry = new NewGameFieldEntry(f.content.entry, f.presentation), start = entry.prepareStart(f.fade, {
    active: true, callbacks: "absent",
  }); start.commit(); let fade = start.fade; fade.advance(.5);
  for (let n = 0; n < 3; n++) { const next = entry.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true)); game.launchNewGame(launch.launch); launch.commit();
  game.advance(20); assert.equal(game.checkpointReady, true);
  assert.equal(game.field.startEvent("named"), true);
  assert.equal(game.field.dialogue?.speaker, game.state.snapshot().characterNames.OWNER_TAG);
  game.advance(10); game.field.confirm(); assert.equal(game.checkpointReady, true);
  const saved = game.checkpoint(), restored = GameSession.restore(saved, game.field.content, f.battle, {
    catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map },
  });
  assert.equal(restored.field.startEvent("named"), true);
  assert.equal(restored.field.dialogue?.text, "Hello SYNTHETIC_OWNER");
  assert.deepEqual(restored.state.snapshot().characterNames, game.state.snapshot().characterNames);
});
