import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compileLocalization } from "./localization.mjs";
import { languages } from "../../src/play/languages.js";

test("incremental text export retains every PR language, stable IDs and speaker tables", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "ffvi-locales-"));
  try {
    await mkdir(path.join(out, "raw"));
    const messages = {};
    for (const { source } of languages)
      for (const kind of ["system", "story_mes", "story_cha", "etc_text"])
        messages[`${kind}_${source}`] = {
          values:
            kind === "story_cha"
              ? { line: `${source} speaker` }
              : {
                  line: `${source} dialogue`,
                  name: `${source} item`,
                  MSG_CHAR_NAME_01: `${source} hero`,
                },
        };
    const files = {
      "raw/messages.json": messages,
      "raw/tables.json": {
        "character_status.csv": [{ id: "1", mes_id_name: "masked" }],
        "content.csv": [{ id: "4", type_id: "1", type_value: "7", mes_id_name: "name" }],
      },
      "battle.json": { characters: { 1: { name: "Original hero" } } },
      "extras.json": { bestiary: [], thumbnails: [] },
    };
    for (const [file, value] of Object.entries(files))
      await writeFile(path.join(out, file), JSON.stringify(value));
    const manifest = await compileLocalization(out);
    assert.equal(Object.keys(manifest).length, 12);
    for (const { id, source } of languages) {
      const catalog = JSON.parse(await readFile(path.join(out, manifest[id])));
      assert.equal(catalog.messages.line, `${source} dialogue`);
      assert.equal(catalog.speakers.line, `${source} speaker`);
      assert.equal(catalog.battleNames.itemNames[7], `${source} item`);
      assert.equal(catalog.battleNames.characters[1], `${source} hero`);
      assert.ok(catalog.characterAliases[1].includes("Original hero"));
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
