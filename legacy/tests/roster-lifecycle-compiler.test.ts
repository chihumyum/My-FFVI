import test from "node:test";
import assert from "node:assert/strict";
import {
  compileInitialRosterLifecycle,
  compileRosterLifecycleEvent,
} from "../src/compiler/roster.js";

function tables() {
  return {
    "initialize_data.csv": [
      { id: "1", key_name: "INIT_PARTY_1", value1: "31" },
      { id: "2", key_name: "INIT_PARTY_3", value1: "1" },
      { id: "3", key_name: "INT_JOB_1", value1: "2" },
    ],
    "character_status.csv": [
      { id: "31", job_id: "1", exp: "100", lv: "99" },
      { id: "1", job_id: "2", exp: "0", lv: "88" },
      { id: "2", job_id: "2", exp: "0", lv: "1" },
      { id: "32", job_id: "1", exp: "0", lv: "1" },
    ],
    "job.csv": [{ id: "1" }, { id: "2" }],
    "intermediate_growth_curve.csv": [
      { id: "1", character_id: "31", job_id: "1", exp_table_group_id: "7" },
      { id: "2", character_id: "1", job_id: "2", exp_table_group_id: "7" },
    ],
    "exp_table.csv": [
      { id: "1", group_id: "7", type_id: "1", total_exp: "0", lv: "1" },
      { id: "2", group_id: "7", type_id: "1", total_exp: "30", lv: "2" },
      { id: "3", group_id: "7", type_id: "1", total_exp: "90", lv: "3" },
      { id: "4", group_id: "7", type_id: "1", total_exp: "150", lv: "4" },
      { id: "5", group_id: "8", type_id: "1", total_exp: "0", lv: "98" },
      { id: "6", group_id: "7", type_id: "2", total_exp: "0", lv: "97" },
    ],
  };
}
const owners = [
  { id: "owned-a", sourceId: 1 },
  { id: "owned-b", sourceId: 31 },
];

test("initial lifecycle uses creation order, source exp and the current job's group", () => {
  const result = compileInitialRosterLifecycle(tables(), owners);
  assert.deepEqual(result.initial, {
    "owned-b": {
      ownedId: 1,
      jobId: 1,
      additionalLevel: 3,
      magicStoneId: 0,
      ownedJobs: [
        { id: 1, level: 1, proficiency: 0 },
        { id: 2, level: 1, proficiency: 0 },
      ],
    },
    "owned-a": {
      ownedId: 2,
      jobId: 2,
      additionalLevel: 1,
      magicStoneId: 0,
      ownedJobs: [{ id: 2, level: 1, proficiency: 0 }],
    },
  });
  assert.deepEqual(result.releasedJobIds, [2]);
  assert.deepEqual(result.jobIds, [1, 2]);
  assert.ok(
    result.dependencies.some(
      (d) => d.table === "intermediate_growth_curve.csv" && d.id === 1,
    ),
  );
  assert.equal("learned" in result.initial["owned-a"]!, false);
});

test("initial owners cannot include an uninitialized, duplicated or missing character", () => {
  assert.throws(
    () => compileInitialRosterLifecycle(tables(), owners.slice(0, 1)),
    /creation order/,
  );
  assert.throws(
    () =>
      compileInitialRosterLifecycle(tables(), [
        ...owners,
        { id: "owned-c", sourceId: 2 },
      ]),
    /non-initial/,
  );
  assert.throws(
    () => compileInitialRosterLifecycle(tables(), [owners[0]!, owners[0]!]),
    /Ambiguous/,
  );
});

test("missing and ambiguous initialization dependencies fail instead of manufacturing zero state", () => {
  const missing = tables();
  missing["job.csv"].pop();
  assert.throws(
    () => compileInitialRosterLifecycle(missing, owners),
    /job.csv/,
  );
  const curve = tables();
  curve["intermediate_growth_curve.csv"].push({
    ...curve["intermediate_growth_curve.csv"][0]!,
    id: "9",
  });
  assert.throws(
    () => compileInitialRosterLifecycle(curve, owners),
    /experience group/,
  );
  const exp = tables();
  exp["exp_table.csv"] = [];
  assert.throws(
    () => compileInitialRosterLifecycle(exp, owners),
    /experience level/,
  );
});

test("native wrappers keep exact source IDs and mandatory refresh", () => {
  const source = tables();
  const tina = compileRosterLifecycleEvent("メンバー加入：ティナ", source);
  assert.deepEqual(tina.command, {
    kind: "join",
    sourceId: 1,
    position: null,
    row: "front",
    refreshActors: true,
    recovery: false,
    refitEquipment: false,
  });
  assert.deepEqual(
    compileRosterLifecycleEvent("メンバー離脱：ティナ", source).command,
    {
      kind: "secede",
      sourceId: 1,
      removeEquipment: false,
      refreshActors: true,
    },
  );
  assert.deepEqual(
    compileRosterLifecycleEvent("メンバー離脱：ビックス", source).command,
    {
      kind: "secede",
      sourceId: 32,
      removeEquipment: true,
      refreshActors: true,
    },
  );
  assert.deepEqual(
    compileRosterLifecycleEvent("メンバー離脱：ウェッジ", source).command,
    {
      kind: "secede",
      sourceId: 31,
      removeEquipment: true,
      refreshActors: true,
    },
  );
  tina.command.sourceId = 31;
  assert.equal(
    compileRosterLifecycleEvent("メンバー加入：ティナ", source).command
      .sourceId,
    1,
  );
});

test("unreviewed selector names and missing source characters do not decode", () => {
  assert.throws(
    () => compileRosterLifecycleEvent("メンバー加入：ガウ", tables()),
    /Unimplemented/,
  );
  const source = tables();
  source["character_status.csv"].pop();
  assert.throws(
    () => compileRosterLifecycleEvent("メンバー離脱：ビックス", source),
    /character_status/,
  );
});
