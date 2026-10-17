import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const project = path.resolve(import.meta.dirname, "../..");
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const name = (value) => (typeof value === "string" ? value.trim().toLowerCase() : null);
const byId = (rows = []) => new Map(rows.map((row) => [Number(row.id), row]));
const unique = (values) => [...new Set(values.filter(Boolean))];
const mediaKey = (url) => {
  if (!url) return null;
  const clean = String(url).split(/[?#]/)[0].replaceAll("\\", "/");
  const index = clean.indexOf("media/");
  return index < 0 ? null : clean.slice(index).toLowerCase();
};
const tableSource = (table, row) => ({ table: `${table}.csv`, rowId: Number(row.id) });
const visible = (unit) => !unit.hidden && !unit.removed && !unit.escaped && !unit.engulfed;

// This expectation oracle imports no exporter, battle engine or renderer. In
// particular, unit.sprite/normalSprite and the exported characters dictionary
// never participate in its expected asset lookup.
export class BattleAppearanceAudit {
  constructor({
    tables,
    sprites = [],
    mountSource = null,
    conditionChanges = [],
    specialBindings = {},
  }) {
    this.characters = byId(tables["character_status.csv"]);
    this.monsters = byId(tables["monster.csv"]);
    this.monsterAssets = byId(tables["monster_asset.csv"]);
    this.formations = byId(tables["monster_party.csv"]);
    this.conditions = byId(tables["condition.csv"]);
    this.fields = new Map(
      (tables["field_character_asset.csv"] || []).map((row) => [Number(row.character_id), row]),
    );
    this.conditionChanges = new Map(
      conditionChanges.map((row) => [Number(row.condition_type), row]),
    );
    this.characterAssets = new Map();
    for (const row of tables["character_asset.csv"] || []) {
      const key = `${Number(row.character_id)}:${Number(row.job_id)}:${Number(row.asset_type)}`;
      if (!this.characterAssets.has(key)) this.characterAssets.set(key, []);
      this.characterAssets.get(key).push(row);
    }
    this.inventory = new Map();
    this.resources = new Map();
    for (const sprite of sprites) {
      const sourcePath = sprite.source?.assetPath;
      const match = sourcePath?.match(/\/(BC_FF6_[^/]+|MO_FF6_[^/]+|MN_FF6_[^/]+)\/([^/]+)\.png$/i);
      if (!match) continue;
      const group = name(match[1]);
      // Monster palettes share a directory; the filename selects the variant.
      const asset = group.startsWith("mn_") ? name(match[2]) : group;
      const record = { asset, group, resource: sprite.url, source: sprite.source };
      if (!this.inventory.has(asset)) this.inventory.set(asset, record);
      this.resources.set(mediaKey(sprite.url), record);
    }
    this.mountSource = mountSource;
    this.specialBindings = specialBindings;
    this.reset();
  }

  static async open({ dataRoot = path.join(project, "build/web-data"), specialBindings } = {}) {
    const [tables, media] = await Promise.all(
      ["raw/tables.json", "raw/media.json"].map((file) => read(path.join(dataRoot, file))),
    );
    const [files, bundles] = await Promise.all([
      readdir(path.join(dataRoot, "raw/objects")),
      readdir(path.join(dataRoot, "raw/bundles")),
    ]);
    const miscFile = bundles.find((file) => file.startsWith("misc_assets_all_"));
    const misc =
      miscFile &&
      (await read(path.join(dataRoot, "raw/bundles", miscFile))).find((row) =>
        Array.isArray(row.data.change_character_condition_list),
      );
    const conditionChanges = (misc?.data.change_character_condition_list || []).map(
      (row, index) => ({
        ...row,
        source: { ...misc.source, property: "change_character_condition_list", index },
      }),
    );
    const prefabFile = files.find((file) => file.startsWith("chara_battle_assets_all_"));
    let mountSource = null;
    if (prefabFile) {
      const prefab = await read(path.join(dataRoot, "raw/objects", prefabFile));
      const player = prefab.objects.find(
        (object) =>
          object.class === "BattlePlayerEntity" &&
          object.data.battleMagicArmor?.m_PathID &&
          object.data.battleMagicArmor.m_PathID !== "0",
      );
      if (player)
        mountSource = {
          ...player.source,
          component: "BattlePlayerEntity",
          property: "battleMagicArmor",
          target: player.data.battleMagicArmor,
        };
    }
    return new BattleAppearanceAudit({
      tables,
      sprites: media.sprites,
      mountSource,
      conditionChanges,
      specialBindings,
    });
  }

  reset() {
    this.observations = 0;
    this.records = new Map();
  }

  character(unit) {
    const status = this.characters.get(Number(unit.id));
    if (!status) return { assets: [], sources: [], unknown: "character-status-row-missing" };
    // jobId is mutable game state (Terra's first naming restores job 1). The
    // status row remains authoritative when no explicit current job is supplied.
    const jobId = Number(unit.jobId ?? status.job_id);
    const rows = this.characterAssets.get(`${Number(status.character_asset_id)}:${jobId}:1`) || [];
    const assets = unique(rows.map((row) => name(row.asset_name)));
    return {
      assets,
      jobId,
      characterAssetId: Number(status.character_asset_id),
      sources: [
        tableSource("character_status", status),
        ...rows.map((row) => tableSource("character_asset", row)),
      ],
      ...(assets.length !== 1
        ? {
            unknown: assets.length
              ? "character-asset-combination-ambiguous"
              : "character-asset-combination-missing",
          }
        : {}),
    };
  }

  monster(unit, formationId) {
    const formation = this.formations.get(Number(formationId));
    const slot = Number.isInteger(unit.slot)
      ? unit.slot
      : Number.isInteger(unit.uniqueId)
        ? unit.uniqueId - 1
        : null;
    const sourceMonsterId = slot === null ? null : Number(formation?.[`monster${slot + 1}`] || 0);
    const monsterId = Number(unit.monsterId ?? unit.id ?? sourceMonsterId);
    const row = this.monsters.get(monsterId);
    const asset = row && this.monsterAssets.get(Number(row.monster_asset_id));
    const sources = [
      ...(formation
        ? [{ ...tableSource("monster_party", formation), slot, monsterId: sourceMonsterId }]
        : []),
      ...(row ? [tableSource("monster", row)] : []),
      ...(asset ? [tableSource("monster_asset", asset)] : []),
    ];
    return {
      monsterId,
      slot,
      assets: asset ? [`${name(asset.group_name)}_${name(asset.asset_name)}`] : [],
      sources,
      // Runtime battle scripts can replace members or the whole formation. We
      // can still check the monster's own table asset, but cannot certify its
      // initial slot association without the caller's current source formation.
      formationAssociation: {
        formationId: Number(formationId) || null,
        sourceMonsterId,
        status: sourceMonsterId === monsterId ? "match" : "unknown",
      },
      ...(!asset ? { unknown: "monster-asset-row-missing" } : {}),
    };
  }

  expected(battle, { sourceFormationId = battle.formation?.id ?? battle.encounterId } = {}) {
    const result = [];
    for (const side of ["player", "enemy"]) {
      for (const [index, unit] of (side === "player"
        ? battle.players || []
        : battle.enemies || []
      ).entries()) {
        // Fallen enemies may already have completed their renderer-owned
        // disappearance. Their absence is not a missing living actor asset.
        if (!visible(unit) || (side === "enemy" && unit.hp <= 0)) continue;
        const base =
          side === "player" ? this.character(unit) : this.monster(unit, sourceFormationId);
        const types = unique(
          (unit.conditions || []).map((id) =>
            Number(this.conditions.get(Number(id))?.condition_type),
          ),
        );
        const common = { side, index, entityId: unit.id, ...base };
        let body = { ...common, layer: unit.magitek && side === "player" ? "rider" : "body" };
        const conditionType = [621, 601, 665, 666].find((type) => types.includes(type));
        const special = {
          621: "trance",
          601: "imp",
          665: "disguise-soldier",
          666: "disguise-merchant",
        }[conditionType];
        if (special) {
          const binding = this.specialBindings[special]?.[base.assets[0]];
          const change = this.conditionChanges.get(conditionType);
          const field = this.fields.get(Number(change?.field_character_asset_cid));
          // Candidate identities are not expectations: raw misc only links the
          // field costume. Matching BC names and the visually identified green
          // P016 Imp remain explicit unknowns, even if a renderer chooses them.
          const candidateAsset =
            special === "trance"
              ? base.assets[0] + "_tr"
              : special === "imp"
                ? "bc_ff6_p016"
                : name(field?.asset_name)?.replace(/^mo_/, "bc_");
          const candidate = this.inventory.get(candidateAsset);
          body = {
            ...body,
            baseAssets: base.assets,
            assets: binding ? [name(binding.asset)] : [],
            sources: [
              ...base.sources,
              ...(binding?.sources || []),
              ...(change?.source ? [change.source] : []),
              ...(field ? [tableSource("field_character_asset", field)] : []),
              ...(unit.conditions || [])
                .filter(
                  (id) => Number(this.conditions.get(Number(id))?.condition_type) === conditionType,
                )
                .map((id) => tableSource("condition", this.conditions.get(Number(id)))),
            ],
            special,
            conditionType,
            ...(field ? { sourceFieldAsset: name(field.asset_name) } : {}),
            candidates: candidate ? [{ asset: candidate.asset, source: candidate.source }] : [],
            ...(!binding
              ? { unknown: `${special}-source-asset-binding-unresolved` }
              : { unknown: null }),
          };
        }
        result.push(body);
        if (unit.magitek && side === "player") {
          const binding = this.specialBindings.magitek;
          result.push({
            side,
            index,
            entityId: unit.id,
            layer: "armor",
            assets: binding ? [name(binding.asset)] : [],
            sources: [...(this.mountSource ? [this.mountSource] : []), ...(binding?.sources || [])],
            requiredSeparateLayer: true,
            ...(!binding ? { unknown: "magitek-source-asset-binding-unresolved" } : {}),
          });
        }
      }
    }
    return result;
  }

  actual(resource, asset) {
    if (resource) {
      const source = this.resources.get(mediaKey(resource));
      return source
        ? { asset: source.asset, resource, source: source.source }
        : { asset: null, resource, unknown: "actual-resource-not-in-raw-sprite-inventory" };
    }
    return asset ? { asset: name(asset), resource: null } : { asset: null, resource: null };
  }

  observe(battle, { frameActors, renderInfo, context = {}, sourceFormationId } = {}) {
    const actualRows = new Map();
    const rawRows = renderInfo instanceof Map ? [...renderInfo] : Object.entries(renderInfo || {});
    for (const [key, row] of rawRows)
      actualRows.set(key, {
        drawn: row.container?.visible ?? row.drawn,
        ...(row.renderInfo || row),
      });
    for (const row of frameActors || [])
      if (["player", "enemy"].includes(row.side)) actualRows.set(`${row.side}:${row.index}`, row);
    const records = [];
    for (const expected of this.expected(battle, { sourceFormationId })) {
      const row = actualRows.get(`${expected.side}:${expected.index}`);
      const armor = expected.layer === "armor";
      const actual = this.actual(
        armor ? row?.armorResource : row?.resource,
        armor ? row?.armorAsset : row?.asset,
      );
      let status = "match",
        reason = null;
      if (!row || row.drawn === false || (!actual.asset && !actual.resource)) {
        status = "mismatch";
        reason = armor
          ? "magitek-independent-armor-layer-missing"
          : "visible-unit-body-layer-missing";
      } else if (actual.unknown || expected.unknown) {
        status = "unknown";
        reason = actual.unknown || expected.unknown;
      } else if (!expected.assets.includes(actual.asset)) {
        status = "mismatch";
        reason = "source-asset-selection-mismatch";
      } else if (!this.inventory.has(actual.asset)) {
        status = "unknown";
        reason = "expected-asset-not-in-raw-sprite-inventory";
      }
      if (armor && actual.asset) {
        const body = this.actual(row?.resource, row?.asset);
        if (body.asset === actual.asset) {
          status = "mismatch";
          reason = "magitek-rider-and-armor-use-same-asset";
        }
      }
      const record = {
        ...context,
        encounterId: battle.encounterId,
        ...expected,
        actual,
        status,
        reason,
      };
      records.push(record);
      const key = JSON.stringify(record);
      const previous = this.records.get(key);
      if (previous) previous.count++;
      else this.records.set(key, { ...record, count: 1 });
      if (expected.formationAssociation?.status === "unknown") {
        const association = {
          ...record,
          status: "unknown",
          reason: "source-formation-slot-association-unresolved",
        };
        records.push(association);
        const key = JSON.stringify(association),
          previous = this.records.get(key);
        if (previous) previous.count++;
        else this.records.set(key, { ...association, count: 1 });
      }
    }
    this.observations++;
    return { records, ...counts(records) };
  }

  summary() {
    const records = [...this.records.values()].sort(
      (a, b) => b.count - a.count || String(a.reason).localeCompare(String(b.reason)),
    );
    return {
      schema: "ffvi-battle-appearance-audit",
      version: 1,
      scope:
        "Source table asset identity versus observed selection; no pixel, layout or GPU validation.",
      observations: this.observations,
      ...counts(records),
      calls: records.reduce((total, row) => total + row.count, 0),
      records,
    };
  }
}

function counts(records) {
  return {
    checked: records.length,
    matches: records.filter((row) => row.status === "match").length,
    mismatches: records.filter((row) => row.status === "mismatch").length,
    unknown: records.filter((row) => row.status === "unknown").length,
  };
}

// Standalone selector fixtures are explicitly separate from a story run. The
// dynamic imports below provide ACTUAL selections only, never expectations.
export async function runBattleAppearanceFixtures({
  dataRoot = path.join(project, "build/web-data"),
  includeSpecial = false,
} = {}) {
  const [{ Battle }, { BattlePresentation }, data, catalog, audit] = await Promise.all([
    import("../../src/play/battle.js"),
    import("../../apps/play/battle-presentation.js"),
    read(path.join(dataRoot, "battle.json")),
    read(path.join(dataRoot, "battle-presentation.json")),
    BattleAppearanceAudit.open({ dataRoot }),
  ]);
  const cases = [
    {
      id: "opening-magitek",
      encounterId: 433,
      party: [1, 31, 32].map((id) => ({ id, magitek: true })),
    },
    { id: "moogle-defense", encounterId: 18, party: [2, 19, 20, 21].map((id) => ({ id })) },
    { id: "temporary-members", encounterId: 3, party: [15, 16, 17, 18].map((id) => ({ id })) },
    { id: "terra-trance", encounterId: 3, party: [{ id: 1, conditions: [56] }] },
    { id: "late-source-characters", encounterId: 3, party: [30, 33, 34].map((id) => ({ id })) },
    ...(includeSpecial
      ? [
          { id: "locke-soldier-costume", encounterId: 3, party: [{ id: 2, conditions: [79] }] },
          { id: "locke-merchant-costume", encounterId: 3, party: [{ id: 2, conditions: [80] }] },
          {
            id: "imp-player-and-enemy",
            encounterId: 3,
            party: [{ id: 2, conditions: [13] }],
            enemyConditions: [13],
          },
        ]
      : []),
  ];
  const results = [];
  for (const fixture of cases) {
    const battle = new Battle({
      data,
      party: fixture.party,
      encounterId: fixture.encounterId,
      random: () => 0.5,
    });
    const presentation = Object.assign(Object.create(BattlePresentation.prototype), {
      data,
      catalog,
      battle,
    });
    if (fixture.enemyConditions && battle.enemies[0])
      battle.enemies[0].conditions = [...fixture.enemyConditions];
    const frameActors = [];
    for (const side of ["player", "enemy"])
      for (const [index, unit] of (side === "player" ? battle.players : battle.enemies).entries()) {
        if (!visible(unit)) continue;
        const pose =
          side === "player" ||
          (unit.conditions || []).some((id) => Number(data.conditions[id]?.condition_type) === 601)
            ? presentation.pose(unit, { action: null, hurtAt: -100 }, 0, false)
            : null;
        frameActors.push({
          side,
          index,
          resource: (pose?.info || unit.sprite)?.url,
          armorResource: pose?.armor?.url,
          drawn: true,
        });
      }
    results.push({
      id: fixture.id,
      ...audit.observe(battle, { frameActors, context: { fixture: fixture.id } }),
    });
  }
  return {
    ...audit.summary(),
    fixtureScope:
      "Independent real-PR Battle instances with controlled entry condition state. Current pose selector supplies actual references; no story completion, image or GPU claim.",
    cases: results,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const output = path.resolve(
    process.argv[2] ||
      path.join(project, "build/play/acceptance/step-3/battle-appearance-fixtures.json"),
  );
  const report = await runBattleAppearanceFixtures({
    includeSpecial: process.argv.includes("--special"),
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      output,
      observations: report.observations,
      checked: report.checked,
      mismatches: report.mismatches,
      unknown: report.unknown,
    }),
  );
}
