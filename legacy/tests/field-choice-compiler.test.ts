import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldChoiceInstruction } from "../src/compiler/field-choice.js";

const instruction = (ints: number[] = [], keys: string[] = []) => ({
  type: 1,
  mnemonic: "Select",
  operands: {
    iValues: [...ints, ...Array<number>(8 - ints.length).fill(0)],
    rValues: Array<number>(8).fill(0),
    sValues: [...keys, ...Array<string>(8 - keys.length).fill("")],
  },
});
function fixture() {
  const tables = {
    "message_conclusion.csv": [
      {
        id: "17",
        key_name: "SPEECH_IN_OPTION_YES",
        message_id: "synthetic_accept",
      },
      {
        id: "9",
        key_name: "SPEECH_IN_OPTION_NO",
        message_id: "synthetic_decline",
      },
    ],
  };
  const messages: Record<string, Record<string, string>> = {
    system_zhc: { synthetic_accept: "Accept", synthetic_decline: "Decline" },
    story_mes_zhc: Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => ["option_" + i, "Choice " + i]),
    ),
  };
  return {
    tables,
    messages,
    compile: (raw: unknown, nextMnemonic: string | null = "Branch") =>
      compileFieldChoiceInstruction(raw, messages, tables, { nextMnemonic }),
  };
}

test("default choice binds symbolic message-conclusion keys and keeps initial highlight separate from an answer", () => {
  const f = fixture();
  assert.deepEqual(f.compile(instruction([0, 0, 1])), {
    kind: "choice",
    options: [
      { key: "synthetic_accept", text: "Accept" },
      { key: "synthetic_decline", text: "Decline" },
    ],
    initialIndex: 1,
    cancelIndex: null,
    anchor: "bottom-right",
    presentation: "yes-no",
    retainMessage: false,
  });
  assert.equal(f.compile(instruction()).initialIndex, 0);
});

test("source anchor array and nonpositive default are retained without choosing an option", () => {
  const f = fixture();
  assert.deepEqual(
    [0, 1, 2, 3, 4, -1].map(
      (anchor) => f.compile(instruction([anchor])).anchor,
    ),
    [
      "bottom-right",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "bottom-right",
    ],
  );
  for (const anchor of [5, 99])
    assert.throws(() => f.compile(instruction([anchor])), /anchor/);
});

test("two through six explicit options preserve source order, duplicate labels and the fixed multiple anchor", () => {
  const f = fixture();
  for (let count = 2; count <= 6; count++) {
    const keys = Array.from({ length: count }, (_, i) => "option_" + i),
      result = f.compile(instruction([1, 1, 4], keys));
    assert.deepEqual(
      result.options,
      keys.map((key) => ({ key, text: f.messages.story_mes_zhc![key] })),
    );
    assert.equal(result.initialIndex, 0);
    assert.equal(result.cancelIndex, null);
    assert.equal(result.anchor, "bottom-center");
    assert.equal(result.presentation, "multiple");
  }
  assert.deepEqual(
    f
      .compile(instruction([], ["option_1", "option_1"]))
      .options.map((option) => option.key),
    ["option_1", "option_1"],
  );
});

test("the unused source type operand does not invent an alternate selection mode", () => {
  const f = fixture();
  assert.deepEqual(
    f.compile(instruction([0, 1, 1])),
    f.compile(instruction([0, 0, 1])),
  );
});

test("window retention uses the immediate raw Msg mnemonic and rejects absent continuation context", () => {
  const f = fixture();
  assert.equal(f.compile(instruction(), "Msg").retainMessage, true);
  for (const next of ["Branch", "MsgClose", "Nop", "Select", "Unknown"])
    assert.equal(f.compile(instruction(), next).retainMessage, false);
  for (const next of [null, ""])
    assert.throws(
      () => f.compile(instruction(), next),
      /following source mnemonic/,
    );
  assert.throws(
    () => compileFieldChoiceInstruction(instruction(), f.messages, f.tables),
    /following source mnemonic/,
  );
});

test("missing or duplicate default key bindings never fall back to hardcoded language or row identities", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.tables["message_conclusion.csv"].pop();
    },
    (f: ReturnType<typeof fixture>) => {
      f.tables["message_conclusion.csv"].push({
        ...f.tables["message_conclusion.csv"][0]!,
      });
    },
    (f: ReturnType<typeof fixture>) => {
      delete f.messages.system_zhc!.synthetic_accept;
    },
    (f: ReturnType<typeof fixture>) => {
      f.messages.system_zhc!.synthetic_accept = "";
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => f.compile(instruction()), /choice/);
  }
  const f = fixture();
  assert.throws(() =>
    compileFieldChoiceInstruction(
      instruction(),
      f.messages,
      {},
      { nextMnemonic: "Exit" },
    ),
  );
});

test("ordinary options reject missing captions, sparse source positions and unknown inline controls", () => {
  for (const keys of [
    ["option_0"],
    ["", "option_1"],
    ["option_0", "", "option_1"],
    ["option_0", "missing"],
  ])
    assert.throws(() => fixture().compile(instruction([], keys)), /choice/);
  for (const caption of ["", "<NAME>", "a\\q", "a\r", "a\u0000"]) {
    const f = fixture();
    f.messages.story_mes_zhc!.option_0 = caption;
    assert.throws(
      () => f.compile(instruction([], ["option_0", "option_1"])),
      /choice/,
    );
  }
  const f = fixture();
  f.messages.story_mes_zhc!.option_0 = "First\\nsecond";
  assert.equal(
    f.compile(instruction([], ["option_0", "option_1"])).options[0]!.text,
    "First\nsecond",
  );
});

test("malformed arrays, nonintegers, spare values and invalid yes/no initial indexes remain blocked", () => {
  const f = fixture();
  for (const index of [-1, 2, 6])
    assert.throws(() => f.compile(instruction([0, 0, index])), /initial index/);
  for (const raw of [
    { ...instruction(), type: 2 },
    { ...instruction(), mnemonic: "Msg" },
    instruction([0, 0, 0, 1]),
    instruction([0.5]),
    instruction([2147483648]),
    instruction([], ["option_0", "option_1", "", "", "", "", "extra"]),
    {
      ...instruction(),
      operands: { ...instruction().operands, iValues: [0, 0, 0] },
    },
    {
      ...instruction(),
      operands: {
        ...instruction().operands,
        rValues: [NaN, 0, 0, 0, 0, 0, 0, 0],
      },
    },
    {
      ...instruction(),
      operands: {
        ...instruction().operands,
        rValues: [1, 0, 0, 0, 0, 0, 0, 0],
      },
    },
    {
      ...instruction(),
      operands: {
        ...instruction().operands,
        sValues: [0, "", "", "", "", "", "", ""],
      },
    },
  ])
    assert.throws(() => f.compile(raw));
});

test("compiled options are detached from mutable localization and source operands", () => {
  const f = fixture(),
    raw = instruction([], ["option_0", "option_1"]),
    result = f.compile(raw),
    before = structuredClone({ raw, messages: f.messages, tables: f.tables });
  result.options[0]!.text = "Changed";
  result.options.push({ key: "new", text: "New" });
  assert.deepEqual({ raw, messages: f.messages, tables: f.tables }, before);
});
