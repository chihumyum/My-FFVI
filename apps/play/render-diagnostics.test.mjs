import test from "node:test";
import assert from "node:assert/strict";
import { RenderDiagnostics } from "./render-diagnostics.js";
import { GameRenderer } from "./renderer.js";
import { BattlePresentation } from "./battle-presentation.js";

test("normal rendering emits a resource problem once without dropping its diagnostic context", () => {
  const output = [];
  const log = new RenderDiagnostics({ onIssue: (row) => output.push(row) });
  log.begin({
    mapId: 21,
    map: { name: "Map_20050" },
    lastInstruction: { script: "sc_e_0024", index: 8 },
  });
  const details = { entityId: 31, resource: "missing.png", animation: "WalkL" };
  log.record("texture-load-failed", details);
  log.record("texture-load-failed", details);
  assert.equal(output.length, 1);
  assert.equal(output[0].mapId, 21);
  assert.equal(output[0].script, "sc_e_0024");
  assert.equal(output[0].instructionIndex, 8);
  assert.equal(output[0].entityId, 31);
});

test("acceptance retains every occurrence count and separates maps, script positions and entities", () => {
  const log = new RenderDiagnostics({ acceptance: true, onIssue: () => {} });
  const game = {
    mapId: 3,
    map: { name: "Map_20010" },
    time: 1,
    lastInstruction: { script: "sc_e_0001", index: 4 },
  };
  log.begin(game);
  for (let n = 0; n < 4; n++)
    log.record("animation-missing", { entityId: 31, resource: "armor", animation: "WalkR" });
  log.record("animation-missing", { entityId: 32, resource: "armor", animation: "WalkR" });
  game.mapId = 21;
  game.lastInstruction.index = 5;
  log.begin(game);
  log.record("animation-missing", { entityId: 31, resource: "armor", animation: "WalkR" });
  const rows = log.summary();
  assert.deepEqual(
    rows.map((row) => row.count),
    [4, 1, 1],
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.count, 0),
    6,
  );
  assert.equal(rows[0].instructionIndex, 4);
});

test("failed texture reads retain each requesting entity and required missing references are reported", () => {
  const diagnostics = new RenderDiagnostics({ acceptance: true, onIssue: () => {} });
  diagnostics.begin({ mapId: 329, lastInstruction: { script: "sc_e_0044", index: 12 } });
  const host = {
    diagnostics,
    _assetGeneration: 1,
    _assetImages: { "broken.png": {} },
    _textures: new Map([
      ["broken.png", { failed: true, error: "HTTP 404", errorCategory: "texture-load-failed" }],
    ]),
    _textureSources: new Map(),
  };
  for (const entityId of [1, 2]) {
    assert.equal(GameRenderer.prototype._texture.call(host, "broken.png", { entityId }), undefined);
  }
  assert.equal(
    GameRenderer.prototype._texture.call(host, null, {
      required: true,
      entityId: "ui",
      resource: "digit:3",
    }),
    null,
  );
  const issues = diagnostics.summary();
  assert.equal(issues.length, 3);
  assert.deepEqual(
    issues
      .filter((r) => r.category === "texture-load-failed")
      .map((r) => r.entityId)
      .sort(),
    [1, 2],
  );
  assert.equal(issues.find((r) => r.category === "texture-reference-missing").resource, "digit:3");
  assert.ok(
    issues.every((r) => r.mapId === 329 && r.script === "sc_e_0044" && r.instructionIndex === 12),
  );
});

test("battle pose selection reports missing groups and fallback poses without changing the unit", () => {
  const diagnostics = new RenderDiagnostics({ acceptance: true, onIssue: () => {} });
  const view = new BattlePresentation({ diagnostics });
  view.data = { characters: {}, abilities: {}, conditions: {} };
  view.catalog = { groups: { bc_ff6_test: { Default_00: { url: "default.png" } } } };
  view.battle = {};
  const unit = {
    id: 5,
    side: "player",
    hp: 0,
    maxHp: 100,
    sprite: { url: "/media/bc_ff6_test_assets_all_123/Default_00.png" },
  };
  const before = structuredClone(unit);
  const pose = view.pose(unit, { hurtAt: -100 }, 10, false);
  assert.equal(pose.info.url, "default.png");
  assert.equal(diagnostics.summary()[0].category, "battle-pose-fallback");
  assert.equal(diagnostics.summary()[0].animation, "Down");
  assert.deepEqual(unit, before);
  view.catalog.groups = {};
  assert.equal(view.pose(unit, { hurtAt: -100 }, 10, false), null);
  assert.ok(
    diagnostics
      .summary()
      .some((r) => r.category === "battle-animation-group-missing" && r.entityId === 5),
  );
});
