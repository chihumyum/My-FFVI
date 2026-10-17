import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PlayGame } from "./game.js";
import { partyFieldAsset, setPartyAppearance, refreshCostume } from "./appearance.js";

const tables = JSON.parse(
  await readFile(new URL("../../build/web-data/raw/tables.json", import.meta.url)),
);
const appearanceData = {
  programs: {},
  fieldAssets: Object.fromEntries(tables["field_character_asset.csv"].map((row) => [row.id, row])),
  systemTables: {
    characterStatus: tables["character_status.csv"],
    characterAsset: tables["character_asset.csv"],
  },
  appearanceConditions: [
    { characterId: 2, conditionId: 79, form: 2, asset: "mo_ff6_p021_c01" },
    { characterId: 2, conditionId: 80, form: 1, asset: "mo_ff6_p025" },
  ],
};

test("all PR party appearances join status, job, character asset group and field row", () => {
  for (const status of tables["character_status.csv"]) {
    const rows = tables["character_asset.csv"].filter(
      (row) =>
        row.character_id === status.character_asset_id &&
        row.job_id === status.job_id &&
        row.asset_type === "1",
    );
    assert.ok(rows.length);
    const expected = tables["field_character_asset.csv"].find(
      (row) => row.id === rows[0].field_character_asset_id,
    ).asset_name;
    assert.equal(
      partyFieldAsset(appearanceData, { id: Number(status.id), jobId: Number(status.job_id) }),
      expected,
    );
  }
});

test("costume changes update party, puppets and mounted rider without replacing the vehicle", () => {
  const unit = { id: 2, conditions: [80], disguise: 0, hp: 44 },
    game = {
      data: appearanceData,
      player: { asset: "mo_ff6_v006_c00", vehicle: 6 },
      actors: new Map([["-2", { asset: "mo_ff6_p002" }]]),
    };
  setPartyAppearance(game, game.player, unit);
  refreshCostume(game, unit);
  assert.equal(game.player.asset, "mo_ff6_v006_c00");
  assert.equal(game.player.walkAsset, "mo_ff6_p025");
  assert.equal(game.actors.get("-2").asset, "mo_ff6_p025");
  unit.conditions = [79];
  refreshCostume(game, unit);
  assert.equal(game.player.walkAsset, "mo_ff6_p021_c01");
  unit.conditions = [];
  refreshCostume(game, unit);
  assert.equal(unit.disguise, 0);
  assert.equal(game.player.walkAsset, "mo_ff6_p002");
  assert.equal(unit.hp, 44);
});

test("source party-slot changes refresh the leader without constructing units or moving actors", () => {
  const game = new PlayGame({
    data: {
      ...appearanceData,
      programs: {
        0: {
          name: "test-party",
          ops: [
            ["OrganizePartySlot", [2, 2, 5], [], []],
            ["ChangePartySlot", [2], [], []],
            ["OrganizePartySlot", [2, 6, 2], [], []],
          ],
        },
      },
    },
  });
  const task = { program: 0, pc: 0, actor: null, locals: [] },
    before = { x: game.player.x, y: game.player.y, hp: game.roster[1]?.hp },
    roster = structuredClone(game.roster);
  game.player.asset = "mo_ff6_p007";
  game.step(task);
  assert.equal(
    game.player.asset,
    "mo_ff6_p007",
    "Organizing an inactive slot must retain an authored puppet substitution",
  );
  game.step(task);
  assert.equal(game.player.asset, "mo_ff6_p002");
  game.player.vehicle = 6;
  game.player.asset = "mo_ff6_v006_c00";
  game.step(task);
  assert.equal(game.player.walkAsset, "mo_ff6_p006");
  assert.equal(game.player.asset, "mo_ff6_v006_c00");
  assert.equal(game.player.characterId, 6);
  assert.deepEqual({ x: game.player.x, y: game.player.y, hp: game.roster[1]?.hp }, before);
  assert.deepEqual(game.roster, roster);
});

test("old save decorations migrate out of character space and missing source assets are repaired", async () => {
  const game = new PlayGame({ data: appearanceData }),
    saved = structuredClone(game.snapshot());
  saved.groups = ["entity_default"];
  saved.actors = [
    ["-1", { id: -1, kind: 10, asset: "save-point", x: 2, y: 3 }],
    ["167", { id: 167, kind: 10, visible: false, x: 7, y: 8 }],
  ];
  const before = structuredClone(saved);
  game.enter = async () => {
    const entities = [
      { id: "entity_default:0:0", kind: 10, asset: "save-point", x: 2, y: 3 },
      { id: "167", kind: 10, asset: "sparkle", x: 1, y: 1 },
    ];
    game.map = {
      entities,
      groups: {
        entity_default: {
          entities,
        },
      },
    };
  };
  await game.restore(saved);
  assert.equal(game.actor(-1).asset, "mo_ff6_p001");
  assert.equal(game.actors.get("entity_default:0:0").asset, "save-point");
  assert.deepEqual(
    [game.actors.get("167").asset, game.actors.get("167").visible, game.actors.get("167").x],
    ["sparkle", false, 7],
  );
  assert.deepEqual(saved, before);
});

test("all PR character selectors resolve character_id, including transformed Terra, doubles and vehicles", () => {
  const rows = tables["field_character_asset.csv"];
  const game = new PlayGame({
    data: { programs: {}, fieldAssets: Object.fromEntries(rows.map((row) => [row.id, row])) },
  });
  for (const row of rows) {
    const selector = -Number(row.character_id);
    assert.equal(
      game.actor(selector).asset,
      row.asset_name,
      `PR character ${row.character_id}, table row ${row.id}`,
    );
  }
  assert.equal(game.actor(-200).asset, "mo_ff6_p016");
  assert.equal(game.actor(-201).asset, "mo_ff6_p015");
  assert.equal(game.actor(-202).asset, "mo_ff6_p021_c01");
  assert.equal(game.actor(-103).asset, "mo_ff6_v004_c00");
});

test("every literal PR SetPuppet character binding resolves an existing character catalog", async () => {
  const data = JSON.parse(
    await readFile(new URL("../../build/web-data/data.json", import.meta.url)),
  );
  const game = new PlayGame({ data });
  const rows = new Map(
    tables["field_character_asset.csv"].map((row) => [Number(row.character_id), row]),
  );
  for (const program of Object.values(data.programs))
    for (const [pc, [name, integers]] of program.ops.entries()) {
      const selector = integers[1];
      if (name !== "SetPuppet" || selector >= 0 || selector <= -1000) continue;
      const row = rows.get(-selector);
      assert(row, `${program.name}:${pc} must resolve its literal character selector ${selector}`);
      const asset = game.actor(selector).asset;
      assert.equal(asset, row.asset_name);
      assert(
        data.characters[asset]?.sprites,
        `${program.name}:${pc} must not resolve a nonexistent sprite catalog`,
      );
    }
});

test("older saves repair nonexistent numeric puppet sprites while retaining authored overrides", async () => {
  const rows = tables["field_character_asset.csv"];
  const game = new PlayGame({
    data: { programs: {}, fieldAssets: Object.fromEntries(rows.map((row) => [row.id, row])) },
  });
  const saved = structuredClone(game.snapshot());
  saved.actors = [
    ["-200", { id: -200, asset: "mo_ff6_p200" }],
    ["-201", { id: -201, asset: "mo_ff6_p021" }],
  ];
  const before = structuredClone(saved);
  game.enter = async () => {
    game.map = { entities: [], groups: {} };
  };
  await game.restore(saved);
  assert.equal(game.actor(-200).asset, "mo_ff6_p016");
  assert.equal(game.actor(-201).asset, "mo_ff6_p021");
  assert.deepEqual(saved, before);
});
