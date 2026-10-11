import test from "node:test";
import assert from "node:assert/strict";
import { EventState } from "../src/core/event-state.js";
import {
  cloneSourcePresentationContext,
  createSourcePresentationContext,
  executeSourcePresentation,
  projectSourcePresentation,
  sourcePresentationCheckpoint,
  type SourcePresentationContext,
  type SourcePresentationEntry,
} from "../src/core/source-presentation.js";
import {
  compileSourcePresentationInstruction,
  sourcePresentationSelectors,
} from "../src/compiler/source-presentation.js";

const normal = () =>
  createSourcePresentationContext({
    kind: "title-new-game",
    titleCleanupComplete: true,
    openingCallbackStarted: false,
  });
const advertisement = () =>
  createSourcePresentationContext({
    kind: "advertisement-opening",
    faderSetupComplete: true,
  });
const instruction = (selector: string) => ({
  type: 1,
  mnemonic: "SysCall",
  operands: {
    iValues: Array<number>(8).fill(0),
    rValues: Array<number>(8).fill(0),
    sValues: [selector, ...Array<string>(7).fill("")],
  },
});
const mapFlag = { category: "MapLocalVariable" as const, index: 7 };
const probe = { kind: "advertisement-probe" as const };

test("ordinary title selection proves absence only after cleanup and without the attract callback", () => {
  assert.equal(normal().advertisementOpeningFader, "absent");
  for (const entry of [
    {
      kind: "title-new-game",
      titleCleanupComplete: false,
      openingCallbackStarted: false,
    },
    {
      kind: "title-new-game",
      titleCleanupComplete: true,
      openingCallbackStarted: true,
    },
    { kind: "title-new-game", titleCleanupComplete: true },
    { kind: "advertisement-opening", faderSetupComplete: false },
  ])
    assert.throws(() =>
      createSourcePresentationContext(entry as SourcePresentationEntry),
    );
});

test("absence is a synchronous probe that preserves existing and unknown map-local values", () => {
  for (const value of [null, 0, 1, -7]) {
    const state = new EventState();
    if (value !== null) state.write(mapFlag, value);
    const before = state.snapshot(),
      plan = projectSourcePresentation(probe, normal());
    for (const write of plan.eventWrites) state.write(write.ref, write.value);
    assert.deepEqual(plan, { flow: "next", eventWrites: [], effects: [] });
    assert.deepEqual(state.snapshot(), before);
    if (value === null)
      assert.throws(() => state.read(mapFlag), /未知事件状态/);
  }
});

test("a present fader writes map local 7 and does not change scenario or script-local state", () => {
  const state = EventState.initialized();
  state.write({ category: "ScenarioVariable", index: 7 }, 9);
  const before = state.snapshot(),
    context = advertisement(),
    copy = structuredClone(context);
  const plan = projectSourcePresentation(probe, context);
  assert.deepEqual(plan, {
    flow: "next",
    eventWrites: [{ ref: mapFlag, value: 1 }],
    effects: [],
  });
  for (const write of plan.eventWrites) state.write(write.ref, write.value);
  const after = state.snapshot();
  before.map[7] = 1;
  assert.deepEqual(after, before);
  assert.deepEqual(context, copy);
});

test("missing context and development-origin unknown cannot become ordinary new game", () => {
  for (const context of [
    null,
    createSourcePresentationContext({ kind: "unresolved" }),
  ])
    assert.throws(
      () => projectSourcePresentation(probe, context),
      /Unknown advertisement/,
    );
  const contradictory = {
    ...normal(),
    origin: "unresolved",
  } as SourcePresentationContext;
  assert.throws(
    () => projectSourcePresentation(probe, contradictory),
    /Invalid source presentation/,
  );
});

test("title-return plans retain native effect order and End without a synthetic interpreter wait", () => {
  const expected = {
    flow: "end",
    eventWrites: [],
    effects: [
      { kind: "fade-out", seconds: 2, color: null },
      { kind: "goto-title" },
      { kind: "stop-script-input" },
    ],
  };
  // The selector itself does not inspect the fader. Admission of these effects
  // is the host transaction's responsibility, not a guessed local-flag test.
  for (const context of [null, normal(), advertisement()])
    assert.deepEqual(
      projectSourcePresentation(
        { kind: "advertisement-return-to-title" },
        context,
      ),
      expected,
    );
});

test("stable snapshots preserve explicit unknown and reject active demo callbacks", () => {
  const context = normal(),
    saved = sourcePresentationCheckpoint(context)!;
  assert.deepEqual(saved, context);
  assert.notEqual(saved, context);
  assert.equal(sourcePresentationCheckpoint(null), null);
  const unknown = createSourcePresentationContext({ kind: "unresolved" });
  assert.deepEqual(sourcePresentationCheckpoint(unknown), unknown);
  assert.throws(
    () => sourcePresentationCheckpoint(advertisement()),
    /cannot be checkpointed/,
  );
  assert.throws(
    () =>
      cloneSourcePresentationContext({
        ...normal(),
        extra: 1,
      } as SourcePresentationContext),
    /fields/,
  );
});

test("selector compilation accepts exactly the two source forms without runtime admission", () => {
  const compiled = sourcePresentationSelectors.map((selector) =>
    compileSourcePresentationInstruction(instruction(selector)),
  );
  assert.deepEqual(compiled, [
    { kind: "source-presentation", command: { kind: "advertisement-probe" } },
    {
      kind: "source-presentation",
      command: { kind: "advertisement-return-to-title" },
    },
  ]);
  assert.throws(
    () => projectSourcePresentation(compiled[0]!.command, null),
    /Unknown advertisement/,
  );
});

test("unknown selectors, operand changes, wrong type and incomplete arrays remain blockers", () => {
  const source = instruction(sourcePresentationSelectors[0]);
  const cases = [
    instruction("スカイボックススクロール：OP"),
    { ...source, type: 2 },
    { ...source, mnemonic: "Call" },
    {
      ...source,
      operands: {
        ...source.operands,
        iValues: [1, ...Array<number>(7).fill(0)],
      },
    },
    {
      ...source,
      operands: {
        ...source.operands,
        rValues: [NaN, ...Array<number>(7).fill(0)],
      },
    },
    {
      ...source,
      operands: {
        ...source.operands,
        sValues: [
          sourcePresentationSelectors[0],
          "unexpected",
          ...Array<string>(6).fill(""),
        ],
      },
    },
    {
      ...source,
      operands: { ...source.operands, iValues: Array<number>(7).fill(0) },
    },
  ];
  for (const value of cases)
    assert.throws(() => compileSourcePresentationInstruction(value));
});

test("host execution commits the shared event write synchronously and does not prepare nonexistent effects", () => {
  const state = new EventState(),
    op = compileSourcePresentationInstruction(
      instruction(sourcePresentationSelectors[0]),
    );
  assert.equal(
    executeSourcePresentation(op, state, {
      context: advertisement,
      prepare: () => {
        throw new Error("Probe must not prepare an asynchronous effect");
      },
    }),
    "next",
  );
  assert.equal(state.read(mapFlag), 1);
  assert.equal(
    executeSourcePresentation(op, state, { context: normal }),
    "next",
  );
  assert.equal(state.read(mapFlag), 1);
});

test("return-to-title requires an atomic effect host, fails before event mutation and returns End only after commit", () => {
  const state = EventState.initialized(),
    before = state.snapshot();
  const op = compileSourcePresentationInstruction(
    instruction(sourcePresentationSelectors[1]),
  );
  assert.throws(
    () => executeSourcePresentation(op, state, undefined),
    /host is unavailable/,
  );
  assert.throws(
    () => executeSourcePresentation(op, state, { context: normal }),
    /effect host is unavailable/,
  );
  assert.throws(
    () =>
      executeSourcePresentation(op, state, {
        context: normal,
        prepare: () => {
          throw new Error("Missing title controller");
        },
      }),
    /Missing title controller/,
  );
  assert.deepEqual(state.snapshot(), before);
  const published: string[] = [];
  assert.equal(
    executeSourcePresentation(op, state, {
      context: normal,
      prepare: (effects) => {
        assert.equal(published.length, 0);
        return {
          commit: () => published.push(...effects.map((effect) => effect.kind)),
        };
      },
    }),
    "end",
  );
  assert.deepEqual(published, ["fade-out", "goto-title", "stop-script-input"]);
  assert.deepEqual(state.snapshot(), before);
});
