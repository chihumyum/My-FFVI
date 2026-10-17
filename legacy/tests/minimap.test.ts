import test from "node:test";
import assert from "node:assert/strict";
import { compileMinimapIcons } from "../src/compiler/map-ui.js";

test("minimap type dispatch uses its native table and prefab names, not enum numbers or similar sprites", () => {
  const source = {
    file: "fixture",
    assetPath: "Atlas",
    objectId: "9007199254740993",
  };
  const names = Array.from({ length: 10 }, (_, i) => "source-name-" + i);
  const raw = {
    sourceSetHash: "synthetic",
    config: { source, spriteNames: names, shopSignNames: [...names].reverse() },
    sprites: Object.fromEntries(
      names.map((name) => [
        name,
        {
          file: name + ".png",
          sha256: "digest",
          width: 12,
          height: 12,
          pivot: [0.5, 0.5],
          source,
        },
      ]),
    ),
  };
  const verified: string[] = [];
  const compiled = compileMinimapIcons(raw, (file) => {
    verified.push(file);
  });
  assert.equal(compiled.icons[2]!.file, "/map-ui/source-name-7.png");
  assert.equal(compiled.icons[7]!.file, "/map-ui/source-name-8.png");
  assert.equal(compiled.icons[11]!.file, "/map-ui/source-name-3.png");
  assert.equal(compiled.icons[2]!.source.objectId, "9007199254740993");
  assert.equal(compiled.icons[10], undefined);
  assert.equal(verified.length, 12);
  assert.throws(
    () =>
      compileMinimapIcons(raw, () => {
        throw new Error("changed bytes");
      }),
    /changed bytes/,
  );
  delete raw.sprites["source-name-7"];
  assert.throws(
    () => compileMinimapIcons(raw, () => {}),
    /Missing source minimap sprite/,
  );
});
