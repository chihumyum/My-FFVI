import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inspectImageIndex,
  PresentationAudit,
  writePresentationInventory,
} from "./audit-presentation.mjs";
import { RenderDiagnostics } from "../../apps/play/render-diagnostics.js";
import { PlayGame } from "../../src/play/game.js";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKZ8AAAAASUVORK5CYII=",
  "base64",
);
test("the headless audit finds missing files, directories and invalid image bytes on the actual filesystem", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ffvi-assets-"));
  try {
    await mkdir(path.join(root, "directory.png"));
    await writeFile(path.join(root, "invalid.png"), "not a PNG");
    await writeFile(path.join(root, "valid.png"), pixel);
    const frame = { x: 0, y: 0, w: 1, h: 1 };
    const { images } = await inspectImageIndex(
      {
        assets: {
          images: {
            missing: { file: "missing.png", frame },
            directory: { file: "directory.png", frame },
            invalid: { file: "invalid.png", frame },
            valid: { file: "valid.png", frame },
          },
        },
      },
      root,
    );
    assert.equal(images.get("missing").reason, "file-missing");
    assert.equal(images.get("directory").reason, "file-not-regular");
    assert.equal(images.get("invalid").reason, "image-header-invalid");
    assert.equal(images.get("valid").reason, undefined);
    assert.deepEqual([images.get("valid").width, images.get("valid").height], [1, 1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("atlas bounds are checked against the PNG's actual dimensions, not the declared frame", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ffvi-atlas-"));
  try {
    await writeFile(path.join(root, "page.png"), pixel);
    const { images, pages } = await inspectImageIndex(
      {
        assets: {
          images: {
            clipped: { file: "page.png", frame: { x: 1, y: 0, w: 1, h: 1 } },
            fractional: { file: "page.png", frame: { x: 0.5, y: 0, w: 1, h: 1 } },
            valid: { file: "page.png", frame: { x: 0, y: 0, w: 1, h: 1 } },
          },
        },
      },
      root,
    );
    assert.equal(images.get("clipped").reason, "atlas-frame-out-of-bounds");
    assert.equal(images.get("fractional").reason, "atlas-frame-invalid");
    assert.equal(images.get("valid").reason, undefined);
    assert.equal(pages, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a frozen static audit and its source inventory never borrow mutable raw metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ffvi-frozen-audit-"));
  try {
    const writeJSON = (file, value) => writeFile(path.join(root, file), JSON.stringify(value));
    await mkdir(path.join(root, "data"));
    await writeFile(path.join(root, "pixel.png"), pixel);
    await writeJSON("data/core.json", { characters: {}, maps: { 1: {} }, marker: "frozen" });
    await writeJSON("data/battle.json", {});
    await writeJSON("data/empty.json", {});
    await writeJSON("data/field.json", { maps: {} });
    await writeJSON("data/effects.json", { files: {} });
    await writeJSON("data/map.json", {
      name: "frozen-map",
      textures: { image: "/pixel.png" },
      groups: {
        source: {
          entities: [
            {
              id: "5",
              kind: 14,
              polyline: [
                [0, 0],
                [1, 1],
              ],
            },
          ],
        },
      },
    });
    await writeJSON("data/index.json", {
      core: "data/core.json",
      battle: "data/battle.json",
      presentation: "data/empty.json",
      battlePresentation: "data/empty.json",
      fieldPresentation: "data/field.json",
      effects: "data/effects.json",
      shaders: "data/empty.json",
      opera: "data/empty.json",
      extras: "data/empty.json",
      maps: { 1: "data/map.json" },
      assets: {
        images: { "/pixel.png": { file: "pixel.png", frame: { x: 0, y: 0, w: 1, h: 1 } } },
      },
    });
    const missingRaw = path.join(root, "raw-directory-does-not-exist");
    const audit = await PresentationAudit.open({ dataRoot: missingRaw, assetRoot: root });
    assert.equal(audit.shared.data.marker, "frozen");
    assert.deepEqual(audit.shared.staticLog.summary(), []);
    await writeJSON("report.json", {
      issues: [{ category: "field-asset-missing", mapId: 1, entityId: "5", count: 7 }],
    });
    const inventory = await writePresentationInventory(path.join(root, "report.json"), {
      dataRoot: missingRaw,
      staticRoot: root,
    });
    assert.equal(inventory.sourceMetadataRoot, root);
    assert.equal(inventory.bodiesWithoutSprite[0].definitions[0].kind, 14);
    assert.match(inventory.bodiesWithoutSprite[0].sourceCause, /authored path\/polyline/);
    assert.equal(inventory.bodiesWithoutSprite[0].count, 7);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("auditing executed cues and visible actors never creates selector actors or changes a game snapshot", () => {
  const game = new PlayGame({
    data: {},
    random: () => {
      throw Error("An audit cannot consume game randomness");
    },
  });
  game.mapId = 3;
  game.map = {
    name: "source-map",
    width: 4,
    height: 4,
    entities: [{ id: "999", kind: 6, x: 1, y: 1, asset: "hero" }],
  };
  game.entities = game.map.entities;
  Object.assign(game.player, { asset: "hero", x: 2, y: 2 });
  game.actors.set("-31", {
    id: -31,
    x: 1,
    y: 1,
    visible: true,
    asset: "hero",
    animation: "Default",
  });
  game.actor = () => {
    throw Error("Auditing must not call the mutating game.actor selector");
  };
  const audit = new PresentationAudit({
    data: {
      characters: {
        hero: {
          animation: {
            data: {
              animation: [
                {
                  name: "Default",
                  frames: [{ sprite_name: "Default_00" }],
                  play_mode: 1,
                  play_speed: 1,
                },
              ],
            },
          },
          sprites: { Default_00: { file: "/pixel.png" } },
        },
      },
    },
    battleData: {},
    catalogs: { presentation: {}, "battle-presentation": {}, "field-presentation": { maps: {} } },
    inspected: { images: new Map([["/pixel.png", {}]]) },
    staticLog: new RenderDiagnostics({ onIssue: () => {} }),
  });
  const state = () =>
    structuredClone({
      snapshot: game.snapshot(),
      camera: game.camera,
      tasks: game.tasks,
      warnings: game.warnings,
    });
  const before = state();
  for (const selector of [
    null,
    -1001,
    -1010,
    0,
    -1030,
    -1031,
    -1032,
    -1002,
    -1003,
    -1004,
    -1005,
    -200,
    -201,
    999,
  ])
    audit.instruction(game, {
      name: "CueAnim",
      actor: selector,
      r: [1],
      script: "source-cue",
      index: 3,
    });
  audit.observe(game);
  assert.deepEqual(state(), before);
  assert.equal(game.actors.has("-200"), false);
  assert.equal(
    game.actors.has("999"),
    false,
    "a source entity row is not materialized by observation",
  );
  assert.equal(audit.coverage.actors.size > 0, true);
});

test("headless observation resolves the source script's custom pose on every animation assignment without mutating gameplay", () => {
  // Actual PR sc_map_30410.Animations: the authored tent pose is Default_00
  // shifted by 16 pixels, not an alias to a missing character anim_info clip.
  const tent = {
    name: "Tent_Yoffset",
    frames: [{ sprite_name: "Default_00", offsetx: 0, offsety: 16 }],
    play_speed: 0,
    play_mode: 0,
    is_reverse: false,
    next_anim_name: "",
  };
  for (const name of [
    "CueAnim",
    "PlayAnim",
    "SetPos",
    "Move",
    "MoveBirdView",
    "MoveTo",
    "Lerp",
    "Route",
  ]) {
    const game = new PlayGame({ data: {} });
    game.mapId = 410;
    Object.assign(game.player, { asset: "tent", animation: tent.name });
    game.actor = () => {
      throw Error("A presentation audit cannot materialize actors");
    };
    const audit = new PresentationAudit({
      data: {
        characters: {
          tent: {
            animation: {
              data: { animation: [{ name: "Default", frames: [{ sprite_name: "Default_00" }] }] },
            },
            sprites: { Default_00: { file: "/tent.png" } },
          },
        },
      },
      battleData: {},
      catalogs: { presentation: {}, "battle-presentation": {}, "field-presentation": { maps: {} } },
      inspected: { images: new Map([["/tent.png", {}]]) },
      staticLog: new RenderDiagnostics({ onIssue: () => {} }),
    });
    const before = structuredClone(game.snapshot());
    audit.instruction(game, {
      name,
      s: [tent.name],
      actor: -1001,
      script: "sc_map_30410",
      index: 4,
      program: { animations: [tent] },
    });
    audit.observe(game);
    const sample = audit.field.sample(game.player, audit.shared.data.characters.tent, game.time);
    assert.equal(sample.clip, tent.name, name);
    assert.equal(sample.offsety, 16, name);
    assert.equal(
      audit.runtime.summary().some((row) => row.category === "animation-missing"),
      false,
      name,
    );
    // A subsequent move with no authored animation must not discard the binding.
    audit.instruction(game, {
      name: "Move",
      s: [],
      actor: -1001,
      script: "other-source",
      index: 0,
      program: { animations: [] },
    });
    assert.equal(
      audit.field.sample(game.player, audit.shared.data.characters.tent, game.time).offsety,
      16,
      name,
    );
    assert.deepEqual(game.snapshot(), before, name);
  }
});
