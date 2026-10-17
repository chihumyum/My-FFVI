import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async (file) =>
  JSON.parse(await readFile(new URL(`../../build/web-data/${file}`, import.meta.url)));

test("all declared PR map initializers retain the VM's local or global script entry", async () => {
  const [tables, data, index] = await Promise.all([
    read("raw/tables.json"),
    read("data.json"),
    read("web/data/index.json"),
  ]);
  const scripts = new Map(
    tables["map_script.csv"].map((row) => [String(row.id).trim(), row.script_name.trim()]),
  );
  for (const source of tables["map.csv"]) {
    const map = await read(`maps/${source.id}.json`),
      name = scripts.get(String(source.script_id).trim());
    const program = data.byMap[source.id]?.[name] ?? data.global[name];
    if (name && program !== undefined) {
      assert.equal(map.initializer, name, `Map ${source.id} must retain declared script ${name}`);
      assert(
        index.mapPrograms[source.id].includes(String(program)),
        `Map ${source.id} must load its initializer before entry`,
      );
    } else
      assert.equal(
        map.initializer,
        null,
        `Map ${source.id} cannot execute an undeclared/unavailable initializer`,
      );
  }
  // This real PR declaration used to be dropped because it is global-only.
  assert.equal(data.byMap[575].sc_map_10010, undefined);
  assert.equal((await read("maps/575.json")).initializer, "sc_map_10010");
});
