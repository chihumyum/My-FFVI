import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { languages } from "../../src/play/languages.js";

const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const clean = (value) =>
  String(value || "")
    .replace(/<[^>]+>/g, "")
    .trim();

// Incremental locale export: never compiles maps or writes authored content.
export async function compileLocalization(out) {
  const [tables, raw, battle, extras] = await Promise.all(
    ["raw/tables.json", "raw/messages.json", "battle.json", "extras.json"].map((file) =>
      read(path.join(out, file)),
    ),
  );
  const rows = (name) => tables[`${name}.csv`] || [];
  const byId = (name) => Object.fromEntries(rows(name).map((row) => [row.id, row]));
  const characters = byId("character_status"),
    areas = byId("area"),
    monsters = byId("monster");
  const names = (messages, objects, key = "mes_id_name") =>
    Object.fromEntries(Object.values(objects).map((row) => [row.id, clean(messages[row[key]])]));
  const catalogs = {};
  for (const { id, source } of languages) {
    if (
      !["system", "story_mes", "story_cha", "etc_text"].every((kind) => raw[`${kind}_${source}`])
    ) {
      console.warn(`[localization] PR tables for ${id} are incomplete; locale omitted.`);
      continue;
    }
    const messages = Object.assign(
      {},
      ...Object.entries(raw)
        .filter(([key]) => key.endsWith(`_${source}`))
        .map(([, table]) => table.values),
      raw[`story_mes_${source}`].values,
    );
    const characterNames = Object.fromEntries(
      Object.values(characters).map((row) => {
        // Main cast uses the naming-screen default, rather than Terra's masked introduction.
        const key =
          Number(row.id) <= 16
            ? `MSG_CHAR_NAME_${String(row.id).padStart(2, "0")}`
            : row.mes_id_name;
        return [row.id, clean(messages[key]) || battle.characters[row.id]?.name];
      }),
    );
    const contentNames = names(messages, byId("content"));
    const contentByType = (type) =>
      Object.fromEntries(
        rows("content")
          .filter((row) => Number(row.type_id) === type)
          .map((row) => [row.type_value, contentNames[row.id]]),
      );
    const mapNames = {};
    for (const row of rows("map")) {
      const value = [row.map_title, areas[row.area_id]?.area_name]
        .map((key) => clean(messages[key]))
        .find((value) => value && value !== "None");
      if (value) mapNames[row.id] = value;
    }
    const extraNames = (name) =>
      Object.fromEntries(rows(name).map((row) => [row.id, clean(messages[row.message_id])]));
    catalogs[id] = {
      language: id,
      messages,
      speakers: raw[`story_cha_${source}`].values,
      mapNames,
      battleNames: {
        characters: characterNames,
        monsters: names(messages, monsters),
        abilities: contentByType(4),
        commands: names(messages, byId("command")),
        itemNames: contentByType(1),
        contentNames,
        magicStones: Object.fromEntries(
          Object.entries(battle.magicStones || {}).map(([key, stone]) => [
            key,
            contentNames[stone.id || key],
          ]),
        ),
      },
      extras: {
        gallery: extraNames("gallery_list"),
        music: extraNames("sound_player_list"),
        bestiary: Object.fromEntries(
          extras.bestiary.map((entry) => [
            entry.id,
            {
              name: clean(messages[monsters[entry.monsterId]?.mes_id_name]),
              habitats: Object.fromEntries(
                entry.habitats.map((habitat) => [
                  habitat.id,
                  clean(messages[areas[habitat.areaId]?.area_name]),
                ]),
              ),
            },
          ]),
        ),
        thumbnails: Object.fromEntries(
          extras.thumbnails.map((entry) => [
            entry.id,
            [
              ...new Set(
                (entry.monsterIds || [entry.monsterId])
                  .filter(Boolean)
                  .map((id) => clean(messages[monsters[id]?.mes_id_name]))
                  .filter(Boolean),
              ),
            ].join(" / "),
          ]),
        ),
      },
    };
  }
  const characterAliases = Object.fromEntries(
    Object.values(characters).map((row) => [
      row.id,
      [
        ...new Set(
          [
            battle.characters[row.id]?.name,
            ...Object.values(catalogs).map((catalog) => catalog.battleNames.characters[row.id]),
          ].filter(Boolean),
        ),
      ],
    ]),
  );
  const presentation = await read(path.join(out, "presentation.json")).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (presentation) {
    const media = await read(path.join(out, "raw/media.json"));
    presentation.titleLogos = {};
    for (const { id } of languages) {
      const name =
        id === "zh-CN"
          ? "TitleLogoImage_ZH-CH"
          : id === "ja"
            ? "TitleLogoImage"
            : "TitleLogoImage_EN";
      const row = media.sprites.find(
        (row) => row.name === name && row.source.file.includes("/common_title_assets_all_"),
      );
      if (row)
        presentation.titleLogos[id] = {
          name,
          url: `/web-data/${row.url}`,
          width: row.width,
          height: row.height,
          pivot: row.pivot,
        };
    }
    await writeFile(path.join(out, "presentation.json"), JSON.stringify(presentation) + "\n");
  }
  await mkdir(path.join(out, "locales"), { recursive: true });
  const manifest = {};
  for (const [id, catalog] of Object.entries(catalogs)) {
    manifest[id] = `locales/${id}.json`;
    await writeFile(path.join(out, manifest[id]), JSON.stringify({ ...catalog, characterAliases }));
  }
  await writeFile(path.join(out, "locales.json"), JSON.stringify(manifest));
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  console.log(await compileLocalization(path.resolve(process.argv[2] || "build/web-data")));
