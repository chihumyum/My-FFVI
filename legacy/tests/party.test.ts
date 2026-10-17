import test from "node:test";
import assert from "node:assert/strict";
import {
  activePartyMembers,
  emptyPartyState,
  executePartyEvent,
  previewPartyCommand,
  validatePartyState,
  type FieldPartyPort,
  type PartyCommand,
  type PartyEventOp,
  type PartyRosterEntry,
  type PartyState,
} from "../src/core/party.js";

const roster: PartyRosterEntry[] = [
  { id: "owned:13", sourceId: 21, enabled: true },
  { id: "owned:7", sourceId: 19, enabled: false },
  { id: "owned:42", sourceId: 4, enabled: true },
];
const organize = (
  members: [number | null, number | null, number | null, number | null],
  slot: 0 | 1 | 2 = 0,
): PartyCommand => ({
  kind: "organize-slot",
  slot,
  members,
  refreshActors: true,
});
const select = (slot: 0 | 1 | 2, refreshActors = false): PartyCommand => ({
  kind: "select-slot",
  slot,
  refreshActors,
});
const op = (command: PartyCommand): PartyEventOp => ({
  kind: "party",
  command,
  dependencies: [],
});
function populated(): PartyState {
  return previewPartyCommand(
    emptyPartyState(),
    roster,
    organize([21, null, 4, null]),
  ).state;
}

test("native party initialization has independent cells, three slots and four positions", () => {
  const state = emptyPartyState();
  assert.equal(state.selectedSlot, 0);
  assert.equal(state.slots.length, 3);
  assert.ok(state.slots.every((slot) => slot.length === 4));
  state.slots[0][0].row = "back";
  assert.equal(state.slots[0][1].row, "front");
  assert.equal(state.slots[1][0].row, "front");
  assert.deepEqual(activePartyMembers(state), []);
});

test("organize resolves source identities, accepts owned disabled members, and keeps holes", () => {
  const state = emptyPartyState(),
    beforeRoster = structuredClone(roster);
  const preview = previewPartyCommand(
    state,
    roster,
    organize([null, 19, null, 21]),
  );
  assert.deepEqual(preview.activeMembers, [
    { id: "owned:7", index: 1, row: "front" },
    { id: "owned:13", index: 3, row: "front" },
  ]);
  assert.deepEqual(state, emptyPartyState());
  assert.deepEqual(roster, beforeRoster);
  assert.equal(preview.refreshActors, true);
});

test("organize resets filled rows to front but cleared positions retain their rows", () => {
  const current = populated();
  current.slots[0][0].row = "back";
  current.slots[0][2].row = "back";
  const preview = previewPartyCommand(
    current,
    roster,
    organize([null, null, 21, null]),
  );
  assert.deepEqual(preview.state.slots[0], [
    { id: null, row: "back" },
    { id: null, row: "front" },
    { id: "owned:13", row: "front" },
    { id: null, row: "front" },
  ]);
  assert.equal(current.slots[0][2].row, "back");
});

test("editing an inactive saved slot does not select it; selecting retains source positions", () => {
  const original = populated();
  const inactive = previewPartyCommand(
    original,
    roster,
    organize([null, 4, null, 19], 2),
  );
  assert.equal(inactive.state.selectedSlot, 0);
  assert.deepEqual(inactive.activeMembers, activePartyMembers(original));
  inactive.state.slots[2][3].row = "back";
  const switched = previewPartyCommand(inactive.state, roster, select(2));
  assert.deepEqual(switched.activeMembers, [
    { id: "owned:42", index: 1, row: "front" },
    { id: "owned:7", index: 3, row: "back" },
  ]);
  assert.deepEqual(switched.state.slots[0], original.slots[0]);
  assert.equal(switched.refreshActors, false);
});

test("an empty selected party is retained for explicit host admission, never replaced by a fallback", () => {
  const preview = previewPartyCommand(populated(), roster, select(1));
  assert.deepEqual(preview.activeMembers, []);
  assert.equal(preview.state.selectedSlot, 1);
  assert.equal(preview.state.slots[0][0].id, "owned:13");
});

test("unknown late member fails the whole pure operation without mutating any input", () => {
  const state = populated(),
    before = structuredClone(state),
    beforeRoster = structuredClone(roster);
  const command = organize([4, null, 19, 999]),
    beforeCommand = structuredClone(command);
  assert.throws(
    () => previewPartyCommand(state, roster, command),
    /unowned source character 999/,
  );
  assert.deepEqual(state, before);
  assert.deepEqual(roster, beforeRoster);
  assert.deepEqual(command, beforeCommand);
});

test("snapshot validation rejects malformed, ambiguous and missing identities", () => {
  const state = populated();
  const changed = (edit: (copy: any) => void) => {
    const copy = structuredClone(state);
    edit(copy);
    return copy;
  };
  for (const invalid of [
    changed((s) => (s.selectedSlot = -1)),
    changed((s) => (s.selectedSlot = 3)),
    changed((s) => (s.extra = true)),
    changed((s) => s.slots.pop()),
    changed((s) => s.slots[0].pop()),
    changed((s) => (s.slots[0][1].id = "unowned")),
    changed((s) => (s.slots[0][0].row = 1)),
    changed((s) => (s.slots[0][0].more = true)),
    changed((s) => (s.slots[0][1].id = "owned:13")),
  ])
    assert.throws(() => validatePartyState(invalid, roster));
  assert.throws(() =>
    validatePartyState(state, [...roster, { ...roster[0]!, sourceId: 100 }]),
  );
  assert.throws(() =>
    validatePartyState(state, [...roster, { ...roster[0]!, id: "other" }]),
  );
  assert.throws(() =>
    validatePartyState(state, [{ ...roster[0]!, enabled: undefined } as any]),
  );
});

test("one owned actor can occur in different saved slots, but duplicate actors in one slot block", () => {
  const state = populated();
  const other = previewPartyCommand(
    state,
    roster,
    organize([21, null, null, null], 1),
  );
  validatePartyState(other.state, roster);
  assert.throws(
    () => previewPartyCommand(state, roster, organize([21, 21, null, null])),
    /Repeated actor/,
  );
  for (const malformed of [
    { ...select(0), slot: 0.5 },
    { ...select(0), refreshActors: 0 },
    { ...select(0), kind: "join-character" },
    { ...organize([21, null, null, null]), refreshActors: false },
    { ...organize([21, null, null, null]), members: [21, null] },
    { ...organize([21, null, null, null]), members: [0, null, null, null] },
  ])
    assert.throws(() =>
      previewPartyCommand(state, roster, malformed as PartyCommand),
    );
});

test("returned state and active member views cannot mutate prior slots or one another", () => {
  const state = populated();
  const result = previewPartyCommand(state, roster, select(0));
  result.activeMembers[0]!.id = "changed";
  result.state.slots[0][0].row = "back";
  assert.equal(result.state.slots[0][0].id, "owned:13");
  assert.equal(state.slots[0][0].row, "front");
});

test("actor refresh is prepared before publication; unavailable or failed media never commits owned state", () => {
  let state = populated(),
    commits = 0;
  const events: string[] = [];
  const port: FieldPartyPort = {
    prepare(command) {
      events.push("prepare-owned");
      const preview = previewPartyCommand(state, roster, command);
      return {
        ...preview,
        commit() {
          events.push("publish-owned");
          state = preview.state;
          commits++;
        },
        commitWith(publish: () => void) {
          publish();
          this.commit();
        },
      };
    },
  };
  const instruction = op(organize([4, null, null, null]));
  const before = structuredClone(state);
  assert.throws(
    () => executePartyEvent(instruction, port),
    /actor refresh is unavailable/,
  );
  assert.throws(
    () =>
      executePartyEvent(instruction, port, () => {
        throw new Error("missing actor media");
      }),
    /missing actor media/,
  );
  assert.equal(commits, 0);
  assert.deepEqual(state, before);
  events.length = 0;
  executePartyEvent(instruction, port, (members) => {
    events.push("prepare-actors");
    assert.deepEqual(members, [{ id: "owned:42", index: 0, row: "front" }]);
    members[0]!.id = "presentation-local";
    return () => events.push("publish-actors");
  });
  assert.deepEqual(events, [
    "prepare-owned",
    "prepare-actors",
    "publish-actors",
    "publish-owned",
  ]);
  assert.deepEqual(activePartyMembers(state), [
    { id: "owned:42", index: 0, row: "front" },
  ]);
  assert.equal(commits, 1);
});

test("false refresh never calls presentation; stale owned publication never publishes actors", () => {
  let actorCommits = 0,
    ownedCommits = 0;
  executePartyEvent(
    op(select(0)),
    {
      prepare: () => ({
        activeMembers: [],
        refreshActors: false,
        commit() {
          ownedCommits++;
        },
        commitWith(publish: () => void) {
          publish();
          this.commit();
        },
      }),
    },
    () => {
      throw new Error("unexpected refresh");
    },
  );
  assert.equal(ownedCommits, 1);
  assert.throws(
    () =>
      executePartyEvent(
        op(select(0, true)),
        {
          prepare: () => ({
            activeMembers: [],
            refreshActors: true,
            commit() {
              throw new Error("stale");
            },
            commitWith(_publish: () => void) {
              throw new Error("stale");
            },
          }),
        },
        () => () => {
          actorCommits++;
        },
      ),
    /stale/,
  );
  assert.equal(actorCommits, 0);
});

test("event dispatch rejects missing owner, wrong refresh and malformed command before commit", () => {
  let commits = 0;
  assert.throws(
    () => executePartyEvent(op(select(0)), undefined),
    /unavailable/,
  );
  assert.throws(
    () =>
      executePartyEvent(op(select(0)), {
        prepare: () => ({
          activeMembers: [],
          refreshActors: true,
          commit() {
            commits++;
          },
          commitWith(publish: () => void) {
            publish();
            this.commit();
          },
        }),
      }),
    /contract changed/,
  );
  assert.equal(commits, 0);
  const instruction = op(organize([21, null, null, null]));
  executePartyEvent(
    instruction,
    {
      prepare(command) {
        if (command.kind === "organize-slot") command.members[0] = 999;
        return {
          activeMembers: [],
          refreshActors: true,
          commit() {},
          commitWith(publish: () => void) {
            publish();
            this.commit();
          },
        };
      },
    },
    () => () => {},
  );
  assert.equal(
    instruction.command.kind === "organize-slot" &&
      instruction.command.members[0],
    21,
  );
});
