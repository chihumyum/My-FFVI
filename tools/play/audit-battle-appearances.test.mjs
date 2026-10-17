import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BattleAppearanceAudit, runBattleAppearanceFixtures } from "./audit-battle-appearances.mjs";
import { compileBattle } from "../export/battle.mjs";

const root = new URL("../../build/web-data/", import.meta.url);
const [tables, media] = await Promise.all(
  ["raw/tables.json", "raw/media.json"].map(async (file) =>
    JSON.parse(await readFile(new URL(file, root))),
  ),
);
const makeAudit = () => new BattleAppearanceAudit({ tables, sprites: media.sprites });
const resource = (asset) => {
  const sprite = media.sprites.find((row) =>
    row.source.assetPath?.toLowerCase().includes(`/${asset.toLowerCase()}/`),
  );
  assert.ok(sprite, `source sprite group ${asset}`);
  return `/web-data/${sprite.url}`;
};
const battle = (players = [], enemies = [], encounterId = 433) => ({
  players,
  enemies,
  encounterId,
});

test("battle exporter resolves every raw character status to the independent composite-key oracle", async () => {
  const extra = JSON.parse(
    await readFile(
      new URL("raw/bundles/battleextradata_assets_all_1295049eaf8a1a34aca99fdc338e0a02.json", root),
    ),
  );
  const stones = JSON.parse(await readFile(new URL("raw/magic-stones.json", root)));
  const compiled = compileBattle(
    tables,
    extra,
    media,
    { programs: {}, messages: {}, scriptIds: {} },
    stones,
  );
  const state = battle(tables["character_status.csv"].map((row) => ({ id: Number(row.id) })));
  const before = structuredClone(state);
  const frameActors = state.players.map((unit, index) => ({
    side: "player",
    index,
    resource: compiled.characters[unit.id]?.sprite?.url,
  }));
  const result = makeAudit().observe(state, { frameActors });
  assert.equal(state.players.length, 34);
  assert.equal(result.checked, tables["character_status.csv"].length);
  assert.equal(result.matches, tables["character_status.csv"].length);
  assert.equal(result.mismatches, 0);
  assert.equal(result.unknown, 0);
  assert.deepEqual(state, before);
});

test("PR character asset is a character/job/type combination, never a row-id or observed sprite", () => {
  const audit = makeAudit();
  const state = battle(
    tables["character_status.csv"].map((row) => ({
      id: Number(row.id),
      sprite: { url: resource("bc_ff6_p019") },
    })),
  );
  const before = structuredClone(state);
  const expected = audit.expected(state);
  assert.equal(expected.length, 34);
  assert.ok(expected.every((row) => row.assets.length === 1 && !row.unknown));
  assert.deepEqual(expected.find((row) => row.entityId === 33).assets, ["bc_ff6_p018"]);
  assert.deepEqual(expected.find((row) => row.entityId === 34).assets, ["bc_ff6_p026"]);
  assert.deepEqual(expected.find((row) => row.entityId === 30).assets, ["mo_ff6_n050_c00"]);
  assert.deepEqual(
    expected.filter((row) => [31, 32].includes(row.entityId)).map((row) => row.assets),
    [["bc_ff6_p021"], ["bc_ff6_p021"]],
  );
  assert.ok(
    expected
      .find((row) => row.entityId === 33)
      .sources.some((source) => source.table === "character_asset.csv" && source.rowId !== 33),
  );
  const result = audit.observe(battle([{ id: 33 }, { id: 34 }]), {
    frameActors: ["bc_ff6_p001", "bc_ff6_p018"].map((asset, index) => ({
      side: "player",
      index,
      resource: resource(asset),
    })),
  });
  assert.equal(result.mismatches, 2);
  assert.ok(result.records.every((row) => row.reason === "source-asset-selection-mismatch"));
  assert.deepEqual(state, before);
});

test("opening soldiers require their own rider group and a separate armor layer", () => {
  const audit = makeAudit();
  const state = battle([
    { id: 31, magitek: true },
    { id: 32, magitek: true },
  ]);
  const frameActors = [31, 32].map((_, index) => ({
    side: "player",
    index,
    resource: resource("bc_ff6_p021"),
    armorResource: resource("bc_ff6_p022"),
    drawn: true,
  }));
  const before = structuredClone({ state, frameActors });
  const correct = audit.observe(state, { frameActors });
  assert.equal(correct.mismatches, 0);
  assert.equal(correct.matches, 2);
  // p022 is an observed asset, not an independently proven source binding.
  assert.equal(correct.unknown, 2);
  assert.ok(
    correct.records
      .filter((row) => row.layer === "armor")
      .every((row) => row.reason === "magitek-source-asset-binding-unresolved"),
  );
  const missing = audit.observe(state, {
    frameActors: [{ ...frameActors[0], armorResource: null }, frameActors[1]],
  });
  assert.equal(
    missing.records.find((row) => row.index === 0 && row.layer === "armor").reason,
    "magitek-independent-armor-layer-missing",
  );
  const ghost = audit.observe(state, {
    frameActors: frameActors.map((row) => ({ ...row, resource: resource("bc_ff6_p019") })),
  });
  assert.equal(ghost.mismatches, 2);
  const replacement = audit.observe(state, {
    frameActors: frameActors.map((row) => ({ ...row, armorResource: row.resource })),
  });
  assert.equal(replacement.mismatches, 2);
  assert.deepEqual({ state, frameActors }, before);
});

test("multipart formation slots and exact monster palette are checked independently of enemy sprites", () => {
  const audit = makeAudit();
  const rawFormation = tables["monster_party.csv"].find((row) => Number(row.id) === 433);
  const state = battle(
    [],
    [
      { id: 309, monsterId: 309, slot: 1, sprite: { url: "poisoned-actual.png" } },
      { id: 257, monsterId: 257, slot: 4 },
    ],
  );
  const expected = audit.expected(state);
  assert.equal(Number(rawFormation.monster2), 309);
  assert.equal(Number(rawFormation.monster5), 257);
  assert.ok(expected.every((row) => row.formationAssociation.status === "match"));
  assert.deepEqual(
    expected.map((row) => row.assets),
    [["mn_ff6_103_c00"], ["mn_ff6_102_c00"]],
  );
  const head = media.sprites.find((row) => row.name.toLowerCase() === "mn_ff6_103_c00");
  const shell = media.sprites.find((row) => row.name.toLowerCase() === "mn_ff6_102_c00");
  const renderInfo = new Map([
    [
      "enemy:0",
      { renderInfo: { resource: `/web-data/${shell.url}` }, container: { visible: true } },
    ],
    [
      "enemy:1",
      { renderInfo: { resource: `/web-data/${head.url}` }, container: { visible: true } },
    ],
  ]);
  const before = structuredClone(state);
  const result = audit.observe(state, { renderInfo });
  assert.equal(result.mismatches, 2);
  assert.deepEqual(
    result.records.map((row) => row.actual.asset),
    ["mn_ff6_102_c00", "mn_ff6_103_c00"],
  );
  assert.deepEqual(state, before);
  state.enemies[0].hidden = true;
  assert.equal(audit.expected(state).length, 1);
  state.enemies[1].hp = 0;
  assert.equal(audit.observe(state, { frameActors: [] }).checked, 0);
  const replaced = audit.observe(battle([], [{ id: 1, monsterId: 1, slot: 1 }]), {
    frameActors: [{ side: "enemy", index: 0, asset: "mn_ff6_001_c00" }],
  });
  assert.equal(replaced.mismatches, 0);
  assert.equal(replaced.unknown, 1);
  assert.equal(
    replaced.records.find((row) => row.status === "unknown").reason,
    "source-formation-slot-association-unresolved",
  );
  const palette = media.sprites.find((row) => row.name.toLowerCase() === "mn_ff6_001_c01");
  const wrongPalette = audit.observe(battle([], [{ id: 1, monsterId: 1, slot: 4 }], 3), {
    frameActors: [{ side: "enemy", index: 0, resource: `/web-data/${palette.url}` }],
  });
  assert.equal(wrongPalette.records[0].reason, "source-asset-selection-mismatch");
  assert.deepEqual(wrongPalette.records[0].assets, ["mn_ff6_001_c00"]);
});

test("Trance source candidate is explicit unknown, never certified by the renderer's own selection", () => {
  const audit = makeAudit();
  const state = battle([{ id: 1, conditions: [56], trance: false }]);
  const before = structuredClone(state);
  const result = audit.observe(state, {
    frameActors: [{ side: "player", index: 0, resource: resource("bc_ff6_p001_tr") }],
  });
  assert.equal(result.matches, 0);
  assert.equal(result.mismatches, 0);
  assert.equal(result.unknown, 1);
  assert.equal(result.records[0].reason, "trance-source-asset-binding-unresolved");
  assert.deepEqual(result.records[0].baseAssets, ["bc_ff6_p001"]);
  assert.deepEqual(
    result.records[0].candidates.map((row) => row.asset),
    ["bc_ff6_p001_tr"],
  );
  assert.ok(
    result.records[0].sources.some(
      (source) => source.table === "condition.csv" && source.rowId === 56,
    ),
  );
  assert.deepEqual(state, before);
  const missingUrl = audit.observe(battle([{ id: 1 }]), {
    frameActors: [
      { side: "player", index: 0, resource: "media/nonexistent.png", asset: "bc_ff6_p001" },
    ],
  });
  assert.equal(missingUrl.matches, 0);
  assert.equal(missingUrl.records[0].reason, "actual-resource-not-in-raw-sprite-inventory");
});

test("raw PR costume field links and Imp candidates cannot certify normal or inferred battle bodies", async () => {
  const audit = await BattleAppearanceAudit.open();
  for (const [id, type, fieldAsset, candidate] of [
    [79, 665, "mo_ff6_p021_c01", "bc_ff6_p021_c01"],
    [80, 666, "mo_ff6_p025", "bc_ff6_p025"],
  ]) {
    const state = battle([{ id: 2, conditions: [id], sprite: { url: resource("bc_ff6_p002") } }]);
    const before = structuredClone(state);
    const result = audit.observe(state, {
      frameActors: [{ side: "player", index: 0, resource: resource("bc_ff6_p002") }],
    });
    assert.equal(result.matches, 0);
    assert.equal(result.unknown, 1);
    assert.equal(result.records[0].conditionType, type);
    assert.equal(result.records[0].sourceFieldAsset, fieldAsset);
    assert.deepEqual(
      result.records[0].candidates.map((row) => row.asset),
      [candidate],
    );
    assert.deepEqual(result.records[0].assets, []);
    assert.ok(
      result.records[0].sources.some((row) => row.property === "change_character_condition_list"),
    );
    assert.equal(
      audit.observe(state, {
        frameActors: [{ side: "player", index: 0, resource: resource(candidate) }],
      }).matches,
      0,
    );
    assert.deepEqual(state, before);
  }
  const transformed = battle(
    [{ id: 2, conditions: [13] }],
    [{ id: 1, monsterId: 1, slot: 4, conditions: [13] }],
    3,
  );
  const result = audit.observe(transformed, {
    frameActors: ["player", "enemy"].map((side) => ({
      side,
      index: 0,
      resource: resource("bc_ff6_p016"),
    })),
  });
  assert.equal(result.matches, 0);
  assert.equal(result.unknown, 2);
  assert.ok(result.records.every((row) => row.reason === "imp-source-asset-binding-unresolved"));
  assert.ok(result.records.every((row) => row.candidates[0].asset === "bc_ff6_p016"));
});

test("representative actual PR selector fixtures run without substituting expectations or completing a story", async () => {
  const result = await runBattleAppearanceFixtures();
  assert.equal(result.cases.length, 5);
  assert.match(result.fixtureScope, /no story completion/);
  assert.equal(result.cases.find((row) => row.id === "opening-magitek").mismatches, 0);
  assert.equal(result.cases.find((row) => row.id === "moogle-defense").mismatches, 0);
  assert.equal(result.cases.find((row) => row.id === "temporary-members").mismatches, 0);
  // A future exporter correction may remove these real mismatches. Each
  // observed mismatch must still carry the independently derived table row.
  for (const row of result.records.filter((row) => row.status === "mismatch")) {
    assert.ok([33, 34].includes(row.entityId));
    assert.ok(row.sources.some((source) => source.table === "character_asset.csv"));
  }
});

test("real-PR special-state Battle instances expose source uncertainty instead of claiming baseline Locke matches", async () => {
  const result = await runBattleAppearanceFixtures({ includeSpecial: true });
  assert.equal(result.cases.length, 8);
  assert.equal(result.mismatches, 0);
  for (const id of ["locke-soldier-costume", "locke-merchant-costume", "imp-player-and-enemy"]) {
    const fixture = result.cases.find((row) => row.id === id);
    assert.ok(fixture.unknown > 0);
    assert.ok(
      fixture.records.filter((row) => row.special).every((row) => row.status === "unknown"),
    );
  }
  assert.deepEqual(
    result.cases
      .find((row) => row.id === "imp-player-and-enemy")
      .records.filter((row) => row.special === "imp")
      .map((row) => [row.side, row.actual.asset]),
    [
      ["player", "bc_ff6_p016"],
      ["enemy", "bc_ff6_p016"],
    ],
  );
});
