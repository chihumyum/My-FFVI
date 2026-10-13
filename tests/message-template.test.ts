import assert from "node:assert/strict";
import test from "node:test";
import { compileMessage, compileManualMessageInstruction } from "../src/compiler/message.js";
import { compileFieldMessageTemplate } from "../src/compiler/message-template.js";
import { fieldMessageNameReferences, fieldMessageTemplateSource, parseFieldMessageTemplate,
  resolveFieldMessageTemplate } from "../src/core/field-message-template.js";

/** Authored table records deliberately separate table rows and character IDs. */
const bindings = () => [
  { id: "901", character_id: "101", tag_name: "ALICE" },
  { id: "902", character_id: "205", tag_name: "BOB" },
  { id: "903", character_id: "409", tag_name: "RESERVE" },
];
const messages = (text = "Static\\ntext", speaker = "Guide") => ({ story_mes_zhc: { TEST: text }, story_cha_zhc: { TEST: speaker } });
const raw = () => ({ type: 1, mnemonic: "Msg", operands: { iValues: [0, 2, 0, 0, 0, 0, 0, 0],
  rValues: Array(8).fill(0), sValues: ["TEST", "", "", "", "", "", "", ""] } });
const manual = (text: string, speaker: string, names: unknown = bindings()) =>
  compileManualMessageInstruction(raw(), messages(text, speaker), { nextMnemonic: "Exit" }, names);

test("plain messages retain their entire old shape and do not require a name source table", () => {
  assert.deepEqual(compileMessage("TEST", messages()), { key: "TEST", text: "Static\ntext", speaker: "Guide" });
  assert.deepEqual(manual("First<P>Second", "Guide", undefined), {
    kind: "message", key: "TEST", text: "First", speaker: "Guide",
    manual: { pages: ["First", "Second"], window: "frame", anchor: "bottom", after: "close" },
  });
  assert.equal(compileFieldMessageTemplate(["Ordinary (two words)."], "", undefined), undefined);
});

test("body, explicit pages and speaker bind exact source tags without held-roster or row-index guesses", () => {
  const source = bindings(), before = structuredClone(source), op = manual("Hello (ALICE)<P>(RESERVE) and (BOB).", "(ALICE)", source);
  const refs = fieldMessageNameReferences(op.template!);
  assert.deepEqual(refs, [{ tag: "ALICE", sourceId: 101, rowId: 901 }, { tag: "RESERVE", sourceId: 409, rowId: 903 },
    { tag: "BOB", sourceId: 205, rowId: 902 }, { tag: "ALICE", sourceId: 101, rowId: 901 }]);
  assert.deepEqual(fieldMessageTemplateSource(op.template!), { pages: op.manual.pages, speaker: op.speaker });
  assert.deepEqual(resolveFieldMessageTemplate(op.template!, ["Renamed ally", "Held reserve", "Partner", "Renamed ally"]),
    { pages: ["Hello Renamed ally", "Held reserve and Partner."], speaker: "Renamed ally" });
  assert.deepEqual(source, before);
  refs[0]!.sourceId = 999;
  assert.equal(fieldMessageNameReferences(op.template!)[0]!.sourceId, 101);
  assert.deepEqual(parseFieldMessageTemplate(JSON.parse(JSON.stringify(op.template))), op.template);
});

test("the ordinary shared compiler also templates speaker-only and name-only messages", () => {
  const speaker = compileMessage("TEST", messages("Static body", "(BOB)"), bindings());
  assert.deepEqual(fieldMessageNameReferences(speaker.template!), [{ tag: "BOB", sourceId: 205, rowId: 902 }]);
  assert.deepEqual(resolveFieldMessageTemplate(speaker.template!, ["Partner"]), { pages: ["Static body"], speaker: "Partner" });
  const nameOnly = manual("(ALICE)", "");
  assert.deepEqual(resolveFieldMessageTemplate(nameOnly.template!, ["Ally"]), { pages: ["Ally"], speaker: "" });
});

test("CT selects one message alignment across all P pages without consuming other controls", () => {
  const op = manual("<CT>First<CT><P>\\n<ct>Second (ALICE)", "");
  assert.equal(op.alignment, "center"); assert.deepEqual(op.manual.pages, ["First", "\nSecond (ALICE)"]);
  assert.deepEqual(resolveFieldMessageTemplate(op.template!, ["Ally"]), { pages: ["First", "\nSecond Ally"], speaker: "" });
  assert.deepEqual(compileMessage("TEST", messages("<cT>Centered", "")),
    { key: "TEST", text: "Centered", speaker: "", alignment: "center" });
  for (const body of ["<CT><WAIT00>Text", "<CT><AUTO_P>Text", "<CT>Text<PRESS>", "<CT><NAME_A>", "<CT>"])
    assert.throws(() => manual(body, ""));
});

test("missing, partial or ambiguous complete bindings cannot turn macros into printable text", () => {
  assert.throws(() => compileMessage("TEST", messages("(ALICE)")), /source table/);
  assert.throws(() => manual("(RESERVE)", "", bindings().slice(0, 2)), /value binding/);
  for (const token of ["UNKNOWN", "KINGAKU", "FULL_SPACE", "ITEM_N", "alice", "名字"])
    assert.throws(() => manual("(" + token + ")", ""), /value binding/);
  for (const change of [
    (rows: ReturnType<typeof bindings>) => rows.push({ ...rows[0]! }),
    (rows: ReturnType<typeof bindings>) => { rows[2]!.tag_name = rows[0]!.tag_name; },
    (rows: ReturnType<typeof bindings>) => { rows[2]!.character_id = rows[0]!.character_id; },
    (rows: ReturnType<typeof bindings>) => { rows[2]!.id = "0"; },
    (rows: ReturnType<typeof bindings>) => { rows[2]!.character_id = "2147483648"; },
    (rows: ReturnType<typeof bindings>) => { rows[2]!.tag_name = " ALICE "; },
  ]) { const rows = bindings(); change(rows); assert.throws(() => manual("(ALICE)", "", rows)); }
  let reads = 0; const rows = bindings();
  Object.defineProperty(rows[1], "tag_name", { get() { reads++; return "BOB"; }, enumerable: true });
  assert.throws(() => manual("(ALICE)", "", rows), /source fields/); assert.equal(reads, 0);
});

test("loaded templates reject identity changes, hidden fields, unresolved text and invalid prepared name views", () => {
  const template = manual("(ALICE)<P>(ALICE)", "(BOB)").template!;
  const conflicting = structuredClone(template);
  conflicting.pages[1] = [{ kind: "character-name", ref: { tag: "ALICE", sourceId: 205, rowId: 902 } }];
  assert.throws(() => parseFieldMessageTemplate(conflicting), /Conflicting/);
  const literal = structuredClone(template); literal.pages[0] = [{ kind: "text", text: "(ALICE)" }];
  assert.throws(() => parseFieldMessageTemplate(literal), /unresolved/);
  const extra = { ...template, names: ["fallback"] }; assert.throws(() => parseFieldMessageTemplate(extra), /fields/);
  const rounded = structuredClone(template); rounded.pages[0] = [{ kind: "character-name", ref: { tag: "ALICE", sourceId: 9007199254740992, rowId: 901 } }];
  assert.throws(() => parseFieldMessageTemplate(rounded), /identity/);
  const sparse = structuredClone(template); delete sparse.pages[0]; assert.throws(() => parseFieldMessageTemplate(sparse), /array/);
  assert.throws(() => resolveFieldMessageTemplate(template, ["Ally", "Other", "Guide"]), /Conflicting/);
  assert.throws(() => resolveFieldMessageTemplate(template, ["Ally", "Ally"]), /text/);
  assert.throws(() => resolveFieldMessageTemplate(template, ["Ally", "Ally", "Guide", "Extra"]), /cardinality/);
  for (const name of ["", "<CT>Injected", "(BOB)", "Bad\\nname"])
    assert.throws(() => resolveFieldMessageTemplate(template, [name, name, "Guide"]), /text|unresolved/);
});
