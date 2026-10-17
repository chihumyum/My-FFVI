import { fixtureEquipmentGrants } from "./fixtures/equipment.js";
import test from "node:test";
import assert from "node:assert/strict";
import { initialEquipmentStock } from "../src/core/equipment.js";
import { emptyPartyState } from "../src/core/party.js";
import {
  executeRosterLifecycleEvent,
  prepareRosterLifecycle,
  rosterJoinLevel,
  validateRosterLifecycle,
  type RosterCommand,
  type RosterLifecycleCatalog,
  type RosterLifecycleProviders,
  type RosterLifecycleState,
  type RosterMember,
} from "../src/core/roster.js";
import { equipmentCatalog, equipmentRoster } from "./fixtures/equipment.js";

type Owner = RosterMember & { hp: number; learned: number[] };
function setup() {
  const equipment = equipmentCatalog();
  const roster: Owner[] = equipmentRoster(equipment).map((r, i) => ({
    ...r,
    ownedId: i + 1,
    enabled: true,
    jobId: i + 1,
    additionalLevel: 5 + i,
    magicStoneId: 0,
    ownedJobs: [{ id: i + 1, level: 7, proficiency: 12 }],
    hp: 40,
    learned: [500 + i],
  }));
  const state: RosterLifecycleState<Owner> = {
    roster,
    party: emptyPartyState(),
    equipmentStock: initialEquipmentStock(equipment, roster, fixtureEquipmentGrants(equipment)),
    releasedJobIds: [1, 2],
  };
  state.party.selectedSlot = 1;
  state.party.slots[1][0] = { id: roster[0]!.id, row: "back" };
  state.party.slots[1][2] = { id: roster[1]!.id, row: "front" };
  state.party.slots[2][3] = { id: roster[0]!.id, row: "back" };
  const catalog: RosterLifecycleCatalog = {
    equipment,
    jobIds: [1, 2],
    firstJoinLevelAdjustments: { 1: 0, 2: 0 },
  };
  const providers: RosterLifecycleProviders<Owner> = {
    validateMember: (r) => {
      assert.ok(r.hp >= 0);
      assert.ok(Array.isArray(r.learned));
    },
    projectEquipment: (r) => ({ ...r, hp: Math.min(r.hp, 35) }),
  };
  return { state, catalog, providers };
}
const join = (sourceId: number): RosterCommand => ({
  kind: "join",
  sourceId,
  position: null,
  row: "front",
  refreshActors: true,
  recovery: false,
  refitEquipment: false,
});
const secede = (sourceId: number, removeEquipment = false): RosterCommand => ({
  kind: "secede",
  sourceId,
  removeEquipment,
  refreshActors: true,
});

test("ordinary secede returns loadout copies, keeps other party banks and learned state", () => {
  const { state, catalog, providers } = setup(),
    before = structuredClone(state);
  state.roster[0]!.magicStoneId = 88;
  before.roster[0]!.magicStoneId = 88;
  const next = prepareRosterLifecycle(state, secede(1), catalog, providers);
  assert.equal(next.state.roster[0]!.enabled, false);
  assert.deepEqual(next.state.roster[0]!.equipment, [1, 1, 3, 4, 5, 5]);
  assert.equal(next.state.roster[0]!.magicStoneId, 0);
  assert.equal(next.state.roster[0]!.hp, 35);
  assert.deepEqual(next.state.roster[0]!.learned, [500]);
  assert.deepEqual(next.state.equipmentStock, state.equipmentStock);
  assert.deepEqual(next.state.party.slots[1][0], { id: null, row: "back" });
  assert.deepEqual(next.state.party.slots[2], state.party.slots[2]);
  assert.deepEqual(next.state.releasedJobIds, [2]);
  assert.deepEqual(next.state.roster[0]!.ownedJobs, state.roster[0]!.ownedJobs);
  assert.deepEqual(state, before);
});

test("soldier-style secede retains loadout but removes each physical copy and enabled occupancy", () => {
  const { state, catalog, providers } = setup();
  const next = prepareRosterLifecycle(
    state,
    secede(1, true),
    catalog,
    providers,
  );
  assert.deepEqual(next.state.roster[0]!.equipment, state.roster[0]!.equipment);
  assert.equal(next.state.roster[0]!.hp, 40);
  assert.equal(next.state.equipmentStock.find((s) => s.id === 101)!.count, 0);
  assert.equal(next.state.equipmentStock.find((s) => s.id === 201)!.count, 1);
  validateRosterLifecycle(next.state, catalog, providers.validateMember);
  assert.throws(
    () =>
      prepareRosterLifecycle(next.state, secede(1, true), catalog, providers),
    /exceeds owned count/,
  );
});

test("secede removes released job even if another enabled owner shares it, not its job history", () => {
  const { state, catalog, providers } = setup();
  state.roster[1]!.jobId = 1;
  state.roster[1]!.ownedJobs.push({ id: 1, level: 9, proficiency: 81 });
  const next = prepareRosterLifecycle(
    state,
    secede(1, true),
    catalog,
    providers,
  );
  assert.equal(next.state.roster[1]!.enabled, true);
  assert.deepEqual(next.state.releasedJobIds, [2]);
  assert.deepEqual(next.state.roster[1]!.ownedJobs, state.roster[1]!.ownedJobs);
});

test("existing enabled join preserves position and row, releases its job to every owned member", () => {
  const { state, catalog, providers } = setup();
  const next = prepareRosterLifecycle(state, join(1), catalog, providers);
  assert.deepEqual(next.state.party, state.party);
  assert.deepEqual(next.state.roster[1]!.ownedJobs, [
    { id: 2, level: 7, proficiency: 12 },
    { id: 1, level: 1, proficiency: 0 },
  ]);
  assert.deepEqual(next.state.equipmentStock, state.equipmentStock);
  assert.deepEqual(
    prepareRosterLifecycle(next.state, join(1), catalog, providers).state,
    next.state,
  );
});

test("level-one existing join deliberately re-adds its gear even when already enabled", () => {
  const { state, catalog, providers } = setup();
  state.roster[0]!.additionalLevel = 1;
  const next = prepareRosterLifecycle(state, join(1), catalog, providers);
  assert.equal(next.state.equipmentStock.find((s) => s.id === 101)!.count, 2);
  assert.ok(
    next.receipts.some(
      (r) => r.kind === "equipment-projection" && r.reason === "refit",
    ),
  );
});

test("join chooses first current empty cell and forces front; a full party keeps enabled reserve", () => {
  const { state, catalog, providers } = setup();
  state.party.slots[1][0].id = null;
  const next = prepareRosterLifecycle(
    state,
    { ...join(1), row: "back" } as RosterCommand,
    catalog,
    providers,
  );
  assert.deepEqual(next.state.party.slots[1][0], {
    id: "owner:1",
    row: "front",
  });
  const explicit = prepareRosterLifecycle(
    state,
    { ...join(1), position: 3, row: "back" } as RosterCommand,
    catalog,
    providers,
  );
  assert.deepEqual(explicit.state.party.slots[1][3], {
    id: "owner:1",
    row: "back",
  });
  // Use empty equipment reserve owners to fill the source's four cells.
  for (let sourceId = 3; sourceId <= 5; sourceId++) {
    catalog.equipment.characters[sourceId] = {
      ...catalog.equipment.characters[1]!,
      sourceId,
    };
    state.roster.push({
      ...structuredClone(state.roster[0]!),
      id: `owner:${sourceId}`,
      sourceId,
      ownedId: state.roster.length + 1,
      equipment: [1, 1, 3, 4, 5, 5],
    });
  }
  for (let i = 0; i < 4; i++)
    state.party.slots[1][i] = { id: state.roster[i + 1]!.id, row: "front" };
  const full = prepareRosterLifecycle(state, join(1), catalog, providers);
  assert.equal(full.state.roster[0]!.enabled, true);
  assert.deepEqual(full.state.party, state.party);
});

test("correct join level excludes disabled, guest IDs and self and never lowers current level", () => {
  const { state, catalog } = setup();
  assert.equal(rosterJoinLevel(state, state.roster[0]!, false, catalog), 6);
  state.roster[1]!.enabled = false;
  assert.equal(rosterJoinLevel(state, state.roster[0]!, false, catalog), 1);
  state.roster[1]!.enabled = true;
  state.roster[1]!.sourceId = 31;
  assert.equal(rosterJoinLevel(state, state.roster[0]!, false, catalog), 1);
  catalog.firstJoinLevelAdjustments![1] = -9;
  assert.equal(rosterJoinLevel(state, state.roster[0]!, true, catalog), 1);
  delete catalog.firstJoinLevelAdjustments;
  assert.throws(
    () => rosterJoinLevel(state, state.roster[0]!, true, catalog),
    /Unimplemented first-join/,
  );
});

test("rejoining a disabled experienced owner does not fabricate gear, growth or recovery", () => {
  const { state, catalog, providers } = setup();
  const left = prepareRosterLifecycle(
    state,
    secede(2),
    catalog,
    providers,
  ).state;
  const next = prepareRosterLifecycle(left, join(2), catalog, providers);
  assert.equal(next.state.roster[1]!.enabled, true);
  assert.deepEqual(next.state.equipmentStock, left.equipmentStock);
  assert.deepEqual(next.state.roster[1]!.equipment, [1, 1, 3, 4, 5, 5]);
  assert.equal(next.state.roster[1]!.additionalLevel, 6);
  const levelNeeded = structuredClone(left);
  levelNeeded.roster[0]!.additionalLevel = 20;
  const before = structuredClone(levelNeeded);
  assert.throws(
    () => prepareRosterLifecycle(levelNeeded, join(2), catalog, providers),
    /growth provider/,
  );
  assert.deepEqual(levelNeeded, before);
  assert.throws(
    () =>
      prepareRosterLifecycle(
        left,
        { ...join(2), recovery: true } as RosterCommand,
        catalog,
        providers,
      ),
    /full recovery/,
  );
});

test("source growth provider owns the resulting level and learning instead of receiving a forced level write", () => {
  const { state, catalog, providers } = setup();
  const left = prepareRosterLifecycle(
    state,
    secede(2),
    catalog,
    providers,
  ).state;
  left.roster[0]!.additionalLevel = 20;
  const next = prepareRosterLifecycle(left, join(2), catalog, {
    ...providers,
    correctLevel: (member, expRowLevel) => ({
      ...member,
      additionalLevel: expRowLevel + 1,
      learned: [...member.learned, 900],
    }),
  });
  assert.equal(next.state.roster[1]!.additionalLevel, 21);
  assert.deepEqual(next.state.roster[1]!.learned, [501, 900]);
  assert.equal(left.roster[1]!.additionalLevel, 6);
});

test("invalid native identities and unproven disabled equipment are rejected before preparation", () => {
  const { state, catalog, providers } = setup();
  const invalid = structuredClone(state);
  invalid.roster[1]!.ownedId = 31;
  assert.throws(
    () => prepareRosterLifecycle(invalid, join(1), catalog, providers),
    /native owned identity/,
  );
  const disabled = structuredClone(state);
  disabled.roster[1]!.enabled = false;
  disabled.roster[1]!.equipment[0] = 9999;
  assert.throws(
    () => prepareRosterLifecycle(disabled, join(1), catalog, providers),
    /Unknown equipment/,
  );
});

test("failed or malicious providers cannot publish partially changed jobs, slots, gear or identities", () => {
  const { state, catalog, providers } = setup(),
    before = structuredClone(state);
  const failing = {
    ...providers,
    projectEquipment: (m: Owner) => {
      m.hp = 0;
      throw new Error("projection failed");
    },
  };
  assert.throws(
    () => prepareRosterLifecycle(state, secede(1), catalog, failing),
    /projection failed/,
  );
  const changing = {
    ...providers,
    projectEquipment: (m: Owner) => ({ ...m, ownedId: 7 }),
  };
  assert.throws(
    () => prepareRosterLifecycle(state, secede(1), catalog, changing),
    /changed lifecycle identity/,
  );
  assert.deepEqual(state, before);
});

test("unlock is idempotent for disabled owned identities and requires complete initializer for new owners", () => {
  const { state, catalog, providers } = setup();
  state.roster[0]!.enabled = false;
  const op: RosterCommand = {
    kind: "unlock",
    sourceId: 1,
    refreshActors: false,
  };
  assert.deepEqual(
    prepareRosterLifecycle(state, op, catalog, providers).state,
    state,
  );
  assert.throws(
    () =>
      prepareRosterLifecycle(state, { ...op, sourceId: 3 }, catalog, providers),
    /complete owned-character initialization/,
  );
  catalog.equipment.characters[3] = {
    ...catalog.equipment.characters[1]!,
    sourceId: 3,
  };
  const next = prepareRosterLifecycle(state, { ...op, sourceId: 3 }, catalog, {
    ...providers,
    initialize: ({ sourceId, ownedId }) => ({
      ...structuredClone(state.roster[0]!),
      id: "new-owner",
      sourceId,
      ownedId,
      enabled: true,
      learned: [911],
    }),
  });
  assert.equal(next.state.roster[2]!.ownedId, 3);
  assert.equal(next.state.roster[2]!.sourceId, 3);
  assert.deepEqual(next.state.roster[2]!.learned, [911]);
  assert.equal(next.state.equipmentStock.find((s) => s.id === 101)!.count, 2);
  assert.deepEqual(next.state.party, state.party);
});

test("native whole-character unequip bypasses player accessory-only locks", () => {
  const { state, catalog, providers } = setup();
  catalog.equipment.characters[1]!.accessoriesOnly = true;
  const next = prepareRosterLifecycle(state, secede(1), catalog, providers);
  assert.deepEqual(next.state.roster[0]!.equipment, [1, 1, 3, 4, 5, 5]);
  assert.equal(catalog.equipment.characters[1]!.accessoriesOnly, true);
});

test("field lifecycle prepares presentation before owned publication and refuses missing refresh", () => {
  const op = { kind: "roster" as const, command: secede(1), dependencies: [] };
  const calls: string[] = [];
  const port = {
    prepare: () => ({
      activeMembers: [],
      refreshActors: true,
      commit: () => {
        calls.push("owned");
      },
      commitWith(publish: () => void) {
        publish();
        this.commit();
      },
    }),
  };
  assert.throws(
    () => executeRosterLifecycleEvent(op, port),
    /refresh is unavailable/,
  );
  assert.equal(calls.length, 0);
  assert.throws(
    () =>
      executeRosterLifecycleEvent(op, port, () => {
        throw new Error("asset missing");
      }),
    /asset missing/,
  );
  assert.equal(calls.length, 0);
  executeRosterLifecycleEvent(op, port, () => {
    calls.push("prepare");
    return () => {
      calls.push("presentation");
    };
  });
  assert.deepEqual(calls, ["prepare", "presentation", "owned"]);
});
