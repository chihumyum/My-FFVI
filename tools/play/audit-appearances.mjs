import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const project = path.resolve(import.meta.dirname, "../..");
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const rowsById = (rows = []) => new Map(rows.map((row) => [Number(row.id), row]));
const clean = (value) => (typeof value === "string" ? value.trim() : value);
const assetName = (value) => (typeof value === "string" ? value.trim().toLowerCase() : null);
const identity = (source) => `${source.file}::${source.assetPath}`.toLowerCase();
const props = (object) =>
  Object.fromEntries((object.properties || []).map(({ name, value }) => [name, value]));
const snapshotOf = (input) => input.snapshot || input;
const mapIdOf = (snapshot) => Number(snapshot.mapId ?? snapshot.map?.id);
const slotsOf = (snapshot) =>
  snapshot.partySlots || [
    (snapshot.party || []).map((member) => (typeof member === "object" ? member.id : member)),
  ];
const activeParty = (snapshot) => slotsOf(snapshot)[Number(snapshot.partyIndex) || 0] || [];
const actorKey = (selector, snapshot) => {
  const id = Number(selector);
  if (!Number.isFinite(id)) return String(selector);
  if ([-1001, -1010].includes(id)) return "player";
  if (id <= -1002 && id >= -1005) {
    const member = activeParty(snapshot)[-id - 1001];
    return member ? String(-Number(member)) : null;
  }
  return String(id);
};
const logicalActors = (snapshot) => {
  const raw = snapshot.actors;
  const actors =
    raw instanceof Map
      ? [...raw]
      : Array.isArray(raw) && raw.every((row) => Array.isArray(row))
        ? raw
        : [];
  return new Map([
    ...actors.map(([id, actor]) => [String(id), actor]),
    ...(snapshot.player ? [["player", snapshot.player]] : []),
  ]);
};

function walkObjects(data, visit, layer = "", pointer = "") {
  for (const [index, child] of (data.layers || []).entries()) {
    const location = `${pointer}/layers/${index}`;
    if (child.layers) walkObjects(child, visit, child.name || layer, location);
    else
      for (const [at, object] of (child.objects || []).entries())
        visit(object, child.name || layer, location, at);
  }
}

/** Source-only oracle. This module intentionally imports no game, exporter or render selectors. */
export function createAppearanceAudit({ tables, rawAssets = [] }) {
  tables = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [
      name,
      rows.map((row) =>
        Object.fromEntries(Object.entries(row).map(([key, value]) => [key, clean(value)])),
      ),
    ]),
  );
  const fields = rowsById(tables["field_character_asset.csv"]),
    characters = new Map(
      (tables["field_character_asset.csv"] || []).map((row) => [Number(row.character_id), row]),
    ),
    mapObjects = rowsById(tables["mapobject.csv"]),
    transport = rowsById(tables["transportation.csv"]),
    status = rowsById(tables["character_status.csv"]),
    characterAssets = new Map(),
    scriptRows = rowsById(tables["script.csv"]),
    formations = rowsById(tables["monster_party.csv"]),
    conditions = rowsById(tables["condition.csv"]),
    indexed = new Map(rawAssets.map((asset) => [identity(asset.source), asset])),
    programs = new Map(),
    maps = new Map(),
    warnings = [];
  const conditionChanges = rawAssets.flatMap((asset) =>
    (asset.data.change_character_condition_list || []).map((row) => ({
      ...row,
      source: asset.source,
    })),
  );
  for (const row of tables["character_asset.csv"] || []) {
    const key = `${row.character_id}:${row.job_id}:${row.asset_type}`;
    if (!characterAssets.has(key)) characterAssets.set(key, []);
    characterAssets.get(key).push(row);
  }
  for (const raw of rawAssets)
    if (Array.isArray(raw.data.Mnemonics)) {
      const name = path.posix.basename(raw.source.assetPath, ".json");
      if (!programs.has(name)) programs.set(name, []);
      programs.get(name).push(raw);
    }
  const packages = rawAssets.filter(
    (asset) => /\/package\.json$/i.test(asset.source.assetPath) && Array.isArray(asset.data.map),
  );
  for (const row of tables["map.csv"] || []) {
    const pack = packages.find(
      (p) =>
        p.data.asset_group_name === row.asset_name &&
        p.data.map.some((m) => m.name === row.map_name),
    );
    if (!pack) {
      warnings.push(`Map ${row.id}: raw source package unavailable.`);
      continue;
    }
    const declaration = pack.data.map.find((m) => m.name === row.map_name),
      prefix = path.posix.dirname(pack.source.assetPath),
      at = (relative) =>
        relative
          ? indexed.get(
              identity({
                file: pack.source.file,
                assetPath: path.posix
                  .normalize(relative.startsWith("Assets/") ? relative : `${prefix}/${relative}`)
                  .replace(/(?:\.json)?$/, ".json"),
              }),
            )
          : null;
    const entities = [],
      routeGeometry = [],
      scripts = new Map();
    for (const item of declaration.script || []) {
      const raw = at(item.asset);
      if (raw) scripts.set(item.name, raw);
    }
    for (const group of [
      { name: "entity_default", asset: declaration.entity_default },
      ...(declaration.entity || []),
    ]) {
      const raw = at(group.asset);
      if (!raw) continue;
      walkObjects(raw.data, (object, layer, pointer, index) => {
        const p = props(object),
          kind = Number(p.object_type);
        if (kind === 14)
          routeGeometry.push({
            id: String(p.entity_id),
            group: group.name,
            source: { ...raw.source, objectId: object.id },
          });
        if (![6, 10, 17].includes(kind)) return;
        const assetId = Number(p.asset_id),
          definition = mapObjects.get(assetId);
        entities.push({
          id:
            Number(p.entity_id) > 0
              ? String(p.entity_id)
              : `${group.name}:${pointer
                  .split("/")
                  .filter((part) => /^\d+$/.test(part))
                  .join(":")}:${index}`,
          mapId: Number(row.id),
          group: group.name,
          kind,
          layer,
          assetId,
          asset: assetName(definition?.asset_name),
          script: scriptRows.get(Number(p.script_id))?.script_name || null,
          source: { ...raw.source, objectId: object.id, table: "mapobject.csv", rowId: assetId },
        });
      });
    }
    maps.set(Number(row.id), { name: row.map_name, entities, routeGeometry, scripts });
  }
  const resolvedPrograms = new Map();
  function program(name, mapId) {
    const key = `${mapId}:${name}`;
    if (resolvedPrograms.has(key)) return resolvedPrograms.get(key);
    const found = resolveProgram(name, mapId);
    resolvedPrograms.set(key, found);
    return found;
  }
  function resolveProgram(name, mapId) {
    const local = maps.get(Number(mapId))?.scripts.get(name);
    if (local) return local;
    const candidates = programs.get(name) || [];
    if (candidates.length === 1) return candidates[0];
    if (
      candidates.length &&
      candidates.every(
        (item) =>
          JSON.stringify(item.data.Mnemonics) === JSON.stringify(candidates[0].data.Mnemonics),
      )
    )
      return candidates[0];
    return null;
  }
  const encounterCache = new Map();
  function encounters(name, mapId, visited = new Set()) {
    const key = `${mapId}:${name}`;
    if (encounterCache.has(key)) return encounterCache.get(key);
    if (visited.has(key) || visited.size > 64) return [];
    const raw = program(name, mapId);
    if (!raw) return [];
    visited = new Set([...visited, key]);
    const ids = new Set();
    for (const op of raw.data.Mnemonics) {
      if (["Encount", "EncountBoss"].includes(op.mnemonic))
        ids.add(Number(op.operands?.iValues?.[0]));
      // Only named script calls: do not infer a donor from adjacent event numbers.
      if (["ChangeScript", "CallScript"].includes(op.mnemonic))
        for (const id of encounters(op.operands?.sValues?.[0], mapId, visited)) ids.add(id);
    }
    const result = [...ids];
    encounterCache.set(key, result);
    return result;
  }
  const disguiseCandidates = new Map();
  for (const map of maps.values())
    for (const entity of map.entities)
      if (entity.script && entity.asset) {
        for (const encounter of encounters(entity.script, entity.mapId)) {
          const formation = formations.get(encounter),
            script = scriptRows.get(Number(formation?.script_name))?.script_name,
            raw = script && program(script, entity.mapId);
          if (
            !raw ||
            !raw.data.Mnemonics.some(
              (op) => op.mnemonic === "SysCall" && op.operands?.sValues?.[0] === "ロック変装",
            )
          )
            continue;
          for (const [pc, op] of raw.data.Mnemonics.entries()) {
            const i = op.operands?.iValues || [],
              condition = conditions.get(Number(i[2]));
            if (
              op.mnemonic !== "BattleCondition" ||
              Number(i[1]) !== 2 ||
              Number(i[3]) !== 1 ||
              ![665, 666].includes(Number(condition?.condition_type))
            )
              continue;
            const id = Number(condition.id);
            if (!disguiseCandidates.has(id)) disguiseCandidates.set(id, []);
            disguiseCandidates.get(id).push({
              asset: entity.asset,
              source: {
                spawn: entity.source,
                script: entity.script,
                encounter,
                battleScript: script,
                battleSource: raw.source,
                pc,
                conditionId: id,
                conditionType: Number(condition.condition_type),
              },
            });
          }
        }
      }
  const disguises = new Map();
  for (const [id, rows] of disguiseCandidates) {
    if (new Set(rows.map((row) => row.asset)).size === 1) disguises.set(id, rows[0]);
    else
      warnings.push(
        `Disguise condition ${id}: source NPC donor assets are ambiguous (${[...new Set(rows.map((row) => row.asset))].join(", ")}).`,
      );
  }
  const overrides = new Map(),
    sourceHistory = [],
    sourceUnknown = [],
    savedOverrides = [],
    observedDisguises = new Map();
  let currentMap = null;
  function field(id, reason = "field_character_asset.character_id") {
    const row = characters.get(Number(id));
    return row
      ? {
          asset: assetName(row.asset_name),
          characterId: Number(id),
          sources: [
            {
              table: "field_character_asset.csv",
              rowId: Number(row.id),
              characterId: Number(row.character_id),
              reason,
            },
          ],
        }
      : { unknown: `No raw field_character_asset.character_id=${id}.` };
  }
  function partyField(id, reason, snapshot) {
    const row = status.get(Number(id)),
      jobId = snapshot?.roster?.[id]?.jobId ?? row?.job_id,
      choices = characterAssets.get(`${row?.character_asset_id}:${jobId}:1`) || [],
      asset = choices[0],
      fieldRow = fields.get(Number(asset?.field_character_asset_id));
    if (
      !row ||
      !asset ||
      !fieldRow ||
      new Set(
        choices.map((choice) =>
          assetName(fields.get(Number(choice.field_character_asset_id))?.asset_name),
        ),
      ).size !== 1
    )
      return {
        unknown: `No unique character_status → character_asset(character_id/job_id/type1) → field asset for party member ${id}.`,
      };
    return {
      asset: assetName(fieldRow.asset_name),
      characterId: Number(id),
      sources: [
        {
          table: "character_status.csv",
          rowId: Number(row.id),
          assetGroupId: Number(row.character_asset_id),
          jobId: Number(jobId),
          reason,
        },
        {
          table: "character_asset.csv",
          rowId: Number(asset.id),
          characterId: Number(asset.character_id),
          fieldAssetId: Number(asset.field_character_asset_id),
          equivalentRowIds: choices.map((choice) => Number(choice.id)),
        },
        {
          table: "field_character_asset.csv",
          rowId: Number(fieldRow.id),
          characterId: Number(fieldRow.character_id),
        },
      ],
    };
  }
  function base(selector, snapshot) {
    const key = actorKey(selector, snapshot),
      index = Number(selector);
    if (key === "player") {
      const id = activeParty(snapshot)[0];
      return id
        ? partyField(id, "active party → source character_status/job asset", snapshot)
        : { unknown: "Active party leader is absent from this snapshot/F9 report." };
    }
    if (index <= -1030 && index >= -1032) {
      const id = slotsOf(snapshot)[-1030 - index]?.[0];
      return id
        ? partyField(id, "source party-slot leader selector", snapshot)
        : { unknown: `Party slot ${-1030 - index} is unavailable.` };
    }
    if (index <= -1002 && index >= -1005)
      return key
        ? partyField(-Number(key), "source relative party member selector", snapshot)
        : { unknown: `Party member selector ${selector} is empty.` };
    if (Number(key) < 0 && Number(key) > -1000) return field(-Number(key));
    if (index > 0 || !Number.isFinite(index)) {
      const groups = new Set(["entity_default", ...(snapshot.groups || [])]),
        candidates = (maps.get(mapIdOf(snapshot))?.entities || []).filter(
          (entity) => entity.id === key && groups.has(entity.group),
        );
      if (!candidates.length)
        return {
          unknown: `No raw sprite spawn for map ${mapIdOf(snapshot)}, active groups, entity ${index}.`,
        };
      if (new Set(candidates.map((candidate) => candidate.asset)).size > 1)
        return {
          unknown: `Entity ${index} has conflicting raw assets in active groups.`,
          sources: candidates.map((row) => row.source),
        };
      const row = candidates[0];
      return row.asset
        ? { asset: row.asset, sources: [row.source] }
        : { unknown: `Mapobject ${row.assetId} has no source asset.`, sources: [row.source] };
    }
    return { unknown: `Selector ${selector} is not a source field-character selector.` };
  }
  function disguiseFor(characterId, snapshot) {
    const logical =
      snapshot.roster?.[characterId] ||
      snapshot.party?.find((unit) => Number(unit?.id) === Number(characterId));
    const direct = (logical?.conditions || []).flatMap((id) => {
      const condition = conditions.get(Number(id)),
        change = conditionChanges.find(
          (row) => Number(row.condition_type) === Number(condition?.condition_type),
        );
      if (!change) return [];
      const resolved = field(
        change.field_character_asset_cid,
        "PR misc condition type changes the field character ID",
      );
      return [
        {
          ...resolved,
          sources: [
            {
              table: "condition.csv",
              rowId: Number(id),
              conditionType: Number(condition.condition_type),
            },
            {
              ...change.source,
              property: "change_character_condition_list",
              characterId: Number(change.field_character_asset_cid),
            },
            ...(resolved.sources || []),
            ...(disguises.has(Number(id)) ? [disguises.get(Number(id)).source] : []),
          ],
        },
      ];
    });
    if (direct.length)
      return new Set(direct.map((row) => row.asset)).size === 1
        ? direct[0]
        : { unknown: "Active PR appearance conditions request multiple different field bodies." };
    if (Number(characterId) !== 2) return null;
    const observed = observedDisguises.get(2);
    if (observed?.unknown) return observed;
    const unit = snapshot.roster?.[2] || snapshot.party?.find((unit) => Number(unit?.id) === 2),
      ids = observed
        ? []
        : (unit?.conditions || []).filter((id) => disguiseCandidates.has(Number(id))),
      // A populated condition list is current logical state. The legacy form
      // flag may survive a RemoveCondition and must not change the expectation.
      form = Number(
        observed?.form ??
          (Array.isArray(unit?.conditions)
            ? 0
            : (unit?.disguise ?? snapshot.banks?.PlaySystems?.lockeDisguise ?? 0)),
      );
    if (!ids.length && form > 0) {
      const type = form === 1 ? 666 : form === 2 ? 665 : null,
        condition = [...conditions.values()].find((row) => Number(row.condition_type) === type);
      if (condition) ids.push(Number(condition.id));
      const warning =
        "Disguise form1/form2 uses the runtime semantic convention condition_type666/665; actual costume assets still come only from unique PR NPC donor chains.";
      if (!warnings.includes(warning)) warnings.push(warning);
    }
    if (!ids.length)
      return form > 0
        ? { unknown: `Locke disguise form ${form} has no PR condition mapping.` }
        : null;
    const candidates = ids.map((id) => disguises.get(Number(id))).filter(Boolean);
    if (candidates.length !== 1)
      return {
        unknown: `Locke disguise has no unique raw field NPC donor for condition(s) ${ids.join(",")}.`,
      };
    return {
      asset: candidates[0].asset,
      sources: [
        {
          ...candidates[0].source,
          ...(observed ? { caller: observed.source } : {}),
          reason:
            "PR field NPC → source encounter → battle script adds Locke disguise condition; form1/2 uses runtime condition666/665 convention",
        },
      ],
    };
  }
  function expectedFor(selector, input) {
    const snapshot = snapshotOf(input),
      key = actorKey(selector, snapshot),
      actor = logicalActors(snapshot).get(key),
      override = overrides.get(key) || overrides.get("*");
    if (override?.unknown) return { ...override, key };
    if (snapshot.banks?.PlaySystems?.puppetBackup && !override)
      return {
        key,
        unknown:
          "Snapshot contains a live puppet substitution but its executed source SysCall/parameters were not observed.",
      };
    let expectation = override?.characterId
      ? partyField(override.characterId, "observed source SysCall puppet substitution", snapshot)
      : base(selector, snapshot);
    if (expectation.unknown) return { ...expectation, key };
    const disguise = disguiseFor(expectation.characterId, snapshot);
    if (disguise)
      expectation = disguise.unknown
        ? disguise
        : { ...expectation, ...disguise, sources: [...expectation.sources, ...disguise.sources] };
    if (expectation.unknown) return { ...expectation, key };
    const vehicleId =
      Number(
        override?.vehicleId ?? actor?.vehicle ?? (key === "player" ? snapshot.player?.vehicle : 0),
      ) || 1;
    let parts = [{ asset: expectation.asset, role: "character" }];
    if (vehicleId > 1) {
      const row = transport.get(vehicleId),
        asset = fields.get(Number(row?.asset_id));
      if (!asset?.asset_name)
        return { key, unknown: `Transportation ${vehicleId} has no raw field asset row.` };
      const body = { asset: assetName(asset.asset_name), role: "vehicle" };
      parts =
        Number(row.type_id) === 12 ? [{ asset: expectation.asset, role: "rider" }, body] : [body];
      expectation.sources.push(
        { table: "transportation.csv", rowId: vehicleId, assetId: Number(row.asset_id) },
        {
          table: "field_character_asset.csv",
          rowId: Number(asset.id),
          characterId: Number(asset.character_id),
        },
      );
    }
    return {
      key,
      characterId: expectation.characterId,
      vehicleId,
      parts,
      sources: [...expectation.sources, ...(override?.sources || [])],
    };
  }
  function enterMap(mapId) {
    if (currentMap === Number(mapId)) return;
    overrides.clear();
    savedOverrides.length = 0;
    currentMap = Number(mapId);
  }
  function sourceInstruction(context) {
    const { mapId, programName, pc } = context,
      raw = program(programName, mapId),
      op = raw?.data.Mnemonics?.[pc];
    if (!op) {
      const row = {
        mapId,
        programName,
        pc,
        reason: "Source instruction does not resolve uniquely in raw PR package.",
      };
      sourceUnknown.push(row);
      return { unknown: row };
    }
    enterMap(mapId);
    const source = { mapId, programName, pc, ...raw.source },
      name = op.mnemonic,
      i = op.operands?.iValues || [],
      s = op.operands?.sValues || [],
      snapshot = context.snapshot || context;
    const record = {
      name,
      i: [...i],
      s: [...s],
      source,
      ...(context.locals ? { locals: [...context.locals] } : {}),
    };
    if (
      name === "SetPuppet" ||
      name === "RideVehicleNPC" ||
      (name === "SysCall" && /パペット|変装|乗り物/.test(s[0] || ""))
    )
      sourceHistory.push(record);
    if (name === "SetPuppet") record.expectedSelector = { selector: i[1], ...base(i[1], snapshot) };
    if (name === "SysCall" && s[0] === "ロック変装" && !programName.startsWith("sc_b_")) {
      if (context.locals && Number.isFinite(Number(context.locals[2])))
        observedDisguises.set(2, {
          form: Number(context.locals[2]),
          source: { ...source, locals: [...context.locals] },
        });
      else
        observedDisguises.set(2, {
          unknown:
            "Observed Locke disguise SysCall lacks source caller local[2]; appearance cannot be inferred from the current actor asset.",
          sources: [source],
        });
    }
    if (name === "RideVehicleNPC") {
      const key = actorKey(i[1], snapshot);
      if (key)
        overrides.set(key, { ...overrides.get(key), vehicleId: Number(i[0]), sources: [source] });
    }
    if (name === "SysCall" && s[0]?.startsWith("パペット入れ替え：")) {
      const subject = s[0].split("：")[1];
      if (subject === "解除") {
        overrides.clear();
        for (const [key, value] of savedOverrides.pop() || []) overrides.set(key, value);
      } else {
        savedOverrides.push([...overrides]);
        const members =
          subject === "バトルパーティ"
            ? activeParty(snapshot)
            : subject === "スロット２先頭"
              ? slotsOf(snapshot)[1]?.slice(0, 1)
              : subject === "スロット３先頭"
                ? slotsOf(snapshot)[2]?.slice(0, 1)
                : null;
        if (members)
          members.forEach((id, index) => {
            const key = actorKey(-1001 - index, snapshot);
            if (key)
              overrides.set(key, {
                characterId: Number(id),
                sources: [
                  {
                    ...source,
                    syscall: s[0],
                    partySlots: slotsOf(snapshot).map((slot) => [...slot]),
                    partyIndex: Number(snapshot.partyIndex) || 0,
                  },
                ],
              });
          });
        else {
          const reason = `Source SysCall ${s[0]} requires unresolved NPC/compound slot bindings.`;
          for (const selector of [-1001, -1002, -1003, -1004]) {
            const key = actorKey(selector, snapshot);
            if (key) overrides.set(key, { unknown: reason, sources: [source] });
          }
          overrides.set("*", { unknown: reason, sources: [source] });
          sourceUnknown.push({ source, reason });
        }
      }
    }
    return record;
  }
  const partAssets = (parts) =>
    parts
      .map((part) => assetName(typeof part === "string" ? part : part.asset))
      .filter(Boolean)
      .sort();
  function compareOne(selector, snapshot, parts, layer) {
    const expected = expectedFor(selector, snapshot),
      actual = partAssets(parts);
    if (expected.unknown)
      return { status: "unknown", layer, entityId: selector, ...expected, actual };
    const wanted = partAssets(expected.parts);
    return {
      status: JSON.stringify(actual) === JSON.stringify(wanted) ? "match" : "mismatch",
      layer,
      entityId: selector,
      expected: wanted,
      actual,
      sources: expected.sources,
    };
  }
  function report(checks) {
    return {
      checks,
      mismatches: checks.filter((row) => row.status === "mismatch"),
      unknown: checks.filter((row) => row.status === "unknown"),
      summary: {
        checked: checks.length,
        matches: checks.filter((row) => row.status === "match").length,
        mismatches: checks.filter((row) => row.status === "mismatch").length,
        unknown: checks.filter((row) => row.status === "unknown").length,
      },
      sourceUnknown: [...sourceUnknown],
      scope:
        "Field actor identity and composition; animation pose/pixels and battle sprites are not accepted by this audit.",
      warnings: [...warnings],
    };
  }
  function compareRendered(frameActors, input) {
    const snapshot = snapshotOf(input),
      grouped = new Map(),
      checks = [],
      nonSpriteFrames = [];
    for (const frame of frameActors || []) {
      if (frame.side && frame.side !== "field") continue;
      const key = String(frame.entityId ?? frame.id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(frame);
    }
    const actors = logicalActors(snapshot);
    for (const [key, frames] of grouped) {
      const geometry = maps
        .get(mapIdOf(snapshot))
        ?.routeGeometry.find(
          (row) =>
            row.id === key && ["entity_default", ...(snapshot.groups || [])].includes(row.group),
        );
      if (geometry && frames.every((frame) => !frame.asset)) {
        nonSpriteFrames.push({
          entityId: key,
          reason: "Raw PR kind14 route geometry has no sprite body",
          source: geometry.source,
        });
        continue;
      }
      // F9 omits the complete logical actor dictionary. Its vehicle field is a
      // logical role, not the selected asset; resolve that role through PR CSV.
      const canonical = actorKey(key, snapshot),
        role = frames.find((frame) => Number(frame.vehicle) > 1);
      let state = snapshot;
      if (!actors.has(canonical) && role)
        state = {
          ...snapshot,
          actors: [...actors]
            .filter(([key]) => key !== "player")
            .concat([[canonical, { id: key, vehicle: Number(role.vehicle) }]]),
        };
      const check = compareOne(key, state, frames, "render-selection");
      const missing = frames.filter(
        (frame) => frame.drawn === false && frame.reason !== "outside-viewport",
      );
      if (missing.length) {
        check.status = "mismatch";
        check.renderFailures = missing.map(({ asset, reason, resource }) => ({
          asset,
          reason,
          resource,
        }));
      }
      if (state !== snapshot && check.sources)
        check.sources.push({
          logicalInput: "F9 frameActors.vehicle",
          value: Number(role.vehicle),
          reason: "Logical transport role; no actual asset is used to derive the expectation.",
        });
      checks.push(check);
    }
    return { ...report(checks), nonSpriteFrames };
  }
  function compare(input, { frameActors, actorParts, sourceOps = [] } = {}) {
    const snapshot = snapshotOf(input);
    for (const context of sourceOps) sourceInstruction(context);
    const checks = [];
    for (const [key, actor] of logicalActors(snapshot)) {
      if (actor.visible === false) continue;
      const selector = key === "player" ? -1001 : Number.isFinite(Number(key)) ? Number(key) : key,
        supplied =
          actorParts instanceof Map
            ? actorParts.get(key) || actorParts.get(String(selector))
            : actorParts?.[key] || actorParts?.[selector];
      // Trigger/path/collision entities have no sprite by design. Sprite
      // entities lacking their asset must still be checked, even with [] parts.
      if (!actor.asset && ![6, 10, 17].includes(actor.kind) && !(selector < 0)) continue;
      if (supplied) checks.push(compareOne(selector, snapshot, supplied, "actor-parts"));
      else {
        if (!actor.asset && ![6, 10, 17].includes(actor.kind) && !(selector < 0)) continue;
        const parts =
          Number(actor.vehicle) === 6
            ? [{ asset: actor.walkAsset }, { asset: actor.asset }]
            : [{ asset: actor.asset }];
        checks.push(compareOne(selector, snapshot, parts, "actor-state"));
      }
    }
    const rendered = frameActors || (input.schema === "ffvi-bug-report" ? input.actors : null);
    if (rendered) checks.push(...compareRendered(rendered, snapshot).checks);
    return report(checks);
  }
  return {
    enterMap,
    compareMap(map) {
      const checks = (maps.get(Number(map.id))?.entities || []).map((expected) => {
        const actual = map.groups?.[expected.group]?.entities?.find(
          (row) => String(row.id) === expected.id,
        );
        return {
          mapId: Number(map.id),
          group: expected.group,
          entityId: expected.id,
          expected: expected.asset,
          actual: assetName(actual?.asset),
          source: expected.source,
          status: actual && assetName(actual.asset) === expected.asset ? "match" : "mismatch",
        };
      });
      return report(checks);
    },
    expectedFor,
    sourceInstruction,
    compare,
    compareRendered,
    inventory: () => ({
      characters: [...characters.values()].map((row) => ({
        characterId: Number(row.character_id),
        rowId: Number(row.id),
        asset: assetName(row.asset_name),
      })),
      maps: maps.size,
      spawnEntities: [...maps.values()].reduce((n, map) => n + map.entities.length, 0),
      disguises: [...disguises].map(([conditionId, row]) => ({ conditionId, ...row })),
      sourceUnknown: [...sourceUnknown],
      observedSourceInstructions: sourceHistory.length,
      warnings: [...warnings],
    }),
    characterStatus: (id) => partyField(id, "source character-status default appearance"),
    reset: () => {
      overrides.clear();
      savedOverrides.length = 0;
      sourceHistory.length = 0;
      sourceUnknown.length = 0;
      observedDisguises.clear();
      currentMap = null;
    },
  };
}

export async function loadAppearanceAudit({
  dataRoot = path.join(project, "build/web-data"),
} = {}) {
  const [tables, index] = await Promise.all([
    read(path.join(dataRoot, "raw/tables.json")),
    read(path.join(dataRoot, "raw/index.json")),
  ]);
  const files = index.files.filter(
    (file) => file.bundleOutput && /\/(?:map_|map_script_|battle_script_|misc_)/.test(file.file),
  );
  const rawAssets = (
    await Promise.all(files.map((file) => read(path.join(dataRoot, file.bundleOutput))))
  ).flat();
  return createAppearanceAudit({ tables, rawAssets });
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2),
    option = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback),
    audit = await loadAppearanceAudit({
      dataRoot: option("--data", path.join(project, "build/web-data")),
    }),
    file = option("--snapshot"),
    input = file ? await read(file) : null,
    frames = option("--frames"),
    sourceOps = option("--source-ops"),
    result = input
      ? audit.compare(input, {
          frameActors: frames ? await read(frames) : undefined,
          sourceOps: sourceOps ? await read(sourceOps) : [],
        })
      : { inventory: audit.inventory() },
    target = option("--report", path.join(project, "build/play/acceptance/appearances.json"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ report: target, summary: result.summary || result.inventory }));
  if (result.mismatches?.length) process.exitCode = 1;
}
