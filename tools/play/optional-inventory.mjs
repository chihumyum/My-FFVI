import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    data: { type: "string", default: "build/web-data" },
    report: { type: "string", default: "build/play/optional-main-regression.json" },
    checkpoints: { type: "string", default: "build/play/stage1-checkpoints" },
    coverage: { type: "string", default: "build/play/main-script-coverage.json" },
    out: { type: "string", default: "build/play/optional-inventory.json" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "node tools/play/optional-inventory.mjs [--data DIR] [--report REGRESSION.json] " +
      "[--checkpoints DIR] [--coverage VM-COVERAGE.json] [--out INVENTORY.json]\n" +
      "Reads existing PR exports and recorded runs only. Also writes a sibling CSV.\n" +
      "Coverage records observations, never quest completion or runtime availability.",
  );
  process.exit(0);
}

const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const optionalRead = async (file) =>
  read(file).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
const unique = (items) => [...new Set(items)];
const numeric = (items) => unique(items).sort((a, b) => Number(a) - Number(b));
const identity = (asset) => `${asset.source.file}::${asset.source.assetPath}`.toLowerCase();
const sortText = (a, b) => String(a).localeCompare(String(b));
const relative = (file) => path.relative(process.cwd(), path.resolve(file));
const trimRows = (rows = []) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.trim(),
        typeof value === "string" ? value.trim() : value,
      ]),
    ),
  );
const worldFlag = { bank: "ScenarioFlag2", index: 41 };
const phaseName = (bits) => {
  const phases = unique(bits);
  return phases.length === 2
    ? "both-worlds"
    : phases[0] === 1
      ? "world-of-ruin"
      : phases[0] === 0
        ? "world-of-balance"
        : "unknown";
};
const [data, rawTables, rawIndex, battle] = await Promise.all(
  ["data.json", "raw/tables.json", "raw/index.json", "battle.json"].map((file) =>
    read(path.join(values.data, file)),
  ),
);
const tables = Object.fromEntries(
  Object.entries(rawTables).map(([name, rows]) => [name, trimRows(rows)]),
);
const mapRows = tables["map.csv"] || [];
const areaRows = tables["area.csv"] || [];
const areaById = new Map(
  areaRows.map((row) => [
    Number(row.id),
    {
      id: Number(row.id),
      name: data.messages[row.area_name] || null,
      messageKey: row.area_name,
      mapType: Number(row.map_type),
    },
  ]),
);
const warnings = [];

// The same stable source identity order is used by the independent PR compiler.
// No recompilation or extraction is performed here.
const rawPrograms = [],
  packages = [];
for (const file of rawIndex.files.filter((file) => file.jsonAssets && file.bundleOutput)) {
  const assets = await read(path.join(values.data, file.bundleOutput));
  for (const asset of assets) {
    if (Array.isArray(asset.data?.Mnemonics)) rawPrograms.push(asset);
    if (asset.source.assetPath?.endsWith("/package.json") && Array.isArray(asset.data?.map)) {
      packages.push(asset);
    }
  }
}
rawPrograms.sort((a, b) => identity(a).localeCompare(identity(b)));
if (rawPrograms.length !== Object.keys(data.programs).length) {
  throw Error(
    `PR raw/runtime program count differs: ${rawPrograms.length}/${Object.keys(data.programs).length}`,
  );
}
const sourceByProgram = new Map(),
  idBySource = new Map();
for (const [index, asset] of rawPrograms.entries()) {
  const id = String(index),
    name = path.posix.basename(asset.source.assetPath, ".json");
  if (data.programs[id]?.name !== name)
    throw Error(`PR source identity mismatch at program ${id}: ${name}`);
  sourceByProgram.set(id, asset.source);
  idBySource.set(identity(asset), id);
}
const declarationMaps = new Map();
for (const row of mapRows) {
  const pack = packages.find(
    (asset) =>
      asset.data.asset_group_name === row.asset_name &&
      asset.data.map.some((map) => map.name === row.map_name),
  );
  const declaration = pack?.data.map.find((map) => map.name === row.map_name);
  if (!declaration) throw Error(`No original PR package declaration for map ${row.id}`);
  const prefix = path.posix.dirname(pack.source.assetPath);
  for (const script of declaration.script || []) {
    const assetPath = path.posix
      .normalize(script.asset.startsWith("Assets/") ? script.asset : `${prefix}/${script.asset}`)
      .replace(/(?:\.json)?$/, ".json");
    const id = idBySource.get(`${pack.source.file}::${assetPath}`.toLowerCase());
    if (id === undefined) throw Error(`No original PR script ${row.id}/${script.name}`);
    if (!declarationMaps.has(id)) declarationMaps.set(id, []);
    declarationMaps.get(id).push(Number(row.id));
  }
}
const maps = new Map();
for (const row of mapRows) {
  const map = await read(path.join(values.data, "maps", `${row.id}.json`));
  maps.set(map.id, {
    id: map.id,
    name: map.name,
    areaId: Number(row.area_id),
    area: areaById.get(Number(row.area_id)) || { id: Number(row.area_id), name: null },
    initializer: map.initializer,
    entities: map.entities,
    groups: map.groups,
    geographyPhases: [],
  });
}
const resolve = (name, mapId) => {
  const id = data.byMap[mapId]?.[name] ?? data.global[name];
  return id === undefined ? null : String(id);
};
const mapEntities = (map) => [
  ["entity_default", map.entities],
  ...Object.entries(map.groups)
    .filter(([name]) => name !== "entity_default")
    .map(([name, group]) => [name, group.entities || []]),
];

// Indoor physical portals provide a phase hint, not a proof of current availability.
// Narrative ChangeMap jumps are deliberately excluded from geographical inference.
for (const [worldId, phase] of [
  [1, 0],
  [2, 1],
]) {
  const queue = [worldId],
    visited = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const map = maps.get(id);
    if (!map) continue;
    map.geographyPhases.push(phase);
    for (const [, entities] of mapEntities(map)) {
      for (const entity of entities) {
        const target = entity.destination?.mapId;
        if (target && target !== 1 && target !== 2 && !visited.has(target)) queue.push(target);
      }
    }
  }
}

// A small control-flow analysis evaluates only the proven world-change bit.
// All other branch operands remain unknown and fork; this overapproximates gates.
// Internal calls follow both the subroutine and return site, avoiding invented flags.
const phaseOpsCache = new Map();
const gateCache = new Map();
function edges(program, pc) {
  const op = program.ops[pc];
  if (!op) return [];
  const [name, i] = op;
  if (["Exit", "Return", "ChangeMap"].includes(name) || (name === "ChangeScript" && !i[0]))
    return [];
  if (name === "Branch") return [i[2], pc + 1];
  if (["Jump", "JumpBattleAI"].includes(name)) return [i[0]];
  if (name === "Call") return [i[0], pc + 1];
  return [pc + 1];
}
function requiredBranches(id, target) {
  const key = `${id}:${target}`;
  if (gateCache.has(key)) return gateCache.get(key);
  const program = data.programs[id];
  const reaches = (start, skip = -1) => {
    const queue = [start],
      seen = new Set();
    while (queue.length) {
      const pc = queue.pop();
      if (pc === skip || seen.has(pc) || !program.ops[pc]) continue;
      if (pc === target) return true;
      seen.add(pc);
      queue.push(...edges(program, pc));
    }
    return false;
  };
  const gates = [];
  if (reaches(0)) {
    for (const [index, op] of program.ops.entries()) {
      if (op[0] !== "Branch" || !/Flag|Variable/.test(op[3][0]) || reaches(0, index)) continue;
      const taken = reaches(op[1][2]),
        notTaken = reaches(index + 1);
      if (taken === notTaken) continue;
      gates.push({
        opIndex: index,
        bank: op[3][0],
        index: op[1][0],
        operator: op[3][1],
        compareBank: op[3][2],
        value: op[1][1],
        taken,
        basis:
          "dominating branch with only one CFG successor reaching this selector; internal-call returns overapproximated",
      });
    }
  }
  gateCache.set(key, gates);
  return gates;
}
function phaseOps(id, initialPhase) {
  const key = `${id}:${initialPhase}`;
  if (phaseOpsCache.has(key)) return phaseOpsCache.get(key);
  const program = data.programs[id],
    reached = new Map(),
    queue = [[0, initialPhase]],
    seen = new Set();
  while (queue.length) {
    let [pc, phase] = queue.pop();
    const state = `${pc}:${phase}`;
    if (seen.has(state) || !program?.ops[pc]) continue;
    seen.add(state);
    if (!reached.has(pc)) reached.set(pc, new Set());
    reached.get(pc).add(phase);
    const [name, i, , s] = program.ops[pc];
    if (["Exit", "Return"].includes(name)) continue;
    if (
      ["SetFlag", "ResetFlag", "FlipFlag"].includes(name) &&
      s[0] === worldFlag.bank &&
      i[0] === worldFlag.index
    ) {
      phase = name === "SetFlag" ? 1 : name === "ResetFlag" ? 0 : 1 - phase;
    }
    if (name === "Branch") {
      if (s[0] === worldFlag.bank && i[0] === worldFlag.index && s[2] === "imm") {
        const compare = s[1];
        const result = ["＝", "=", "=="].includes(compare)
          ? phase === i[1]
          : ["≠", "!=", "<>"].includes(compare)
            ? phase !== i[1]
            : compare === "＜"
              ? phase < i[1]
              : compare === "＞"
                ? phase > i[1]
                : null;
        if (result !== false) queue.push([i[2], phase]);
        if (result !== true) queue.push([pc + 1, phase]);
      } else queue.push([i[2], phase], [pc + 1, phase]);
    } else if (["Jump", "JumpBattleAI"].includes(name)) queue.push([i[0], phase]);
    else if (name === "Call") queue.push([i[0], phase], [pc + 1, phase]);
    else if (name !== "ChangeMap" && !(name === "ChangeScript" && !i[0]))
      queue.push([pc + 1, phase]);
  }
  phaseOpsCache.set(key, reached);
  return reached;
}
const sourceWorldFlagProof = {
  flag: worldFlag,
  labels: Object.entries(data.programs).flatMap(([id, program]) =>
    program.name === "sc_map_20010"
      ? program.ops.flatMap((op, index) =>
          op[0] === "Nop" && /崩壊[前後]BGM/.test(op[5])
            ? [{ programId: id, script: program.name, opIndex: index, label: op[5] }]
            : [],
        )
      : [],
  ),
  setters: Object.entries(data.programs).flatMap(([id, program]) =>
    program.ops.flatMap((op, index) =>
      op[0] === "SetFlag" && op[3][0] === worldFlag.bank && op[1][0] === worldFlag.index
        ? [{ programId: id, script: program.name, opIndex: index }]
        : [],
    ),
  ),
};
if (!sourceWorldFlagProof.labels.length || !sourceWorldFlagProof.setters.length) {
  throw Error("Source world-change flag proof is missing; phase classification must be reviewed.");
}

const starts = [],
  startsByProgram = new Map(),
  npcInteractions = [];
function addStart(candidate) {
  candidate.id = `start:${starts.length}`;
  starts.push(candidate);
  if (!startsByProgram.has(candidate.programId)) startsByProgram.set(candidate.programId, []);
  startsByProgram.get(candidate.programId).push(candidate.id);
}
for (const map of maps.values()) {
  const initializer = resolve(map.initializer, map.id),
    selectors = new Map();
  if (initializer) {
    addStart({
      type: "map-initializer",
      mapId: map.id,
      areaId: map.areaId,
      script: map.initializer,
      programId: initializer,
      sourcePhases: map.geographyPhases,
      phaseBasis: "physical portal geography; conditional doors not evaluated",
    });
    for (const phase of [0, 1]) {
      for (const [index, phases] of phaseOps(initializer, phase)) {
        const op = data.programs[initializer].ops[index];
        if (op[0] !== "SetEntities") continue;
        if (!selectors.has(op[3][0])) selectors.set(op[3][0], []);
        const existing = selectors.get(op[3][0]).find((row) => row.opIndex === index);
        if (existing) existing.phases = unique([...existing.phases, ...phases]);
        else
          selectors.get(op[3][0]).push({
            programId: initializer,
            opIndex: index,
            phases: [...phases],
            requiredBranches: requiredBranches(initializer, index),
          });
      }
    }
  }
  for (const [group, entities] of mapEntities(map)) {
    const grouped = new Map();
    for (const entity of entities) {
      const name = entity.script || entity.npc?.interaction?.script;
      const id = name && resolve(name, map.id);
      const selector = selectors.get(group) || [];
      const selectedPhases =
        group === "entity_default" ? [0, 1] : unique(selector.flatMap((row) => row.phases));
      const sourcePhases = map.geographyPhases.length
        ? selectedPhases.filter((phase) => map.geographyPhases.includes(phase))
        : selectedPhases.length === 1
          ? selectedPhases
          : [];
      if ([6, 17].includes(entity.kind)) {
        npcInteractions.push({
          id: `npc:${npcInteractions.length}`,
          mapId: map.id,
          areaId: map.areaId,
          group,
          entityId: entity.id,
          actorId: entity.objectId,
          position: [entity.x, entity.y, entity.layer],
          script: name || null,
          programId: id || null,
          interaction: entity.npc?.interaction || { kind: "none" },
          sourcePhases,
          groupSelectors: selector,
          availability:
            "source declaration; runtime visibility, movement and quest gates not evaluated",
        });
      }
      if (!id) continue;
      const key = `${id}:${entity.kind}`;
      if (!grouped.has(key))
        grouped.set(key, {
          type: [6, 17].includes(entity.kind)
            ? "npc"
            : [5, 10].includes(entity.kind)
              ? "treasure"
              : "map-trigger",
          mapId: map.id,
          areaId: map.areaId,
          group,
          script: name,
          programId: id,
          kind: entity.kind,
          entities: [],
          sourcePhases,
          groupSelectors: selector,
          availability:
            "source declaration; conditional group/presence/transport/quest gates not evaluated",
        });
      grouped.get(key).entities.push({
        id: entity.id,
        actorId: entity.objectId,
        position: [entity.x, entity.y, entity.layer],
        transportationIds: entity.transportationIds,
      });
    }
    for (const candidate of grouped.values()) addStart(candidate);
  }
}

const incoming = new Map(),
  outgoing = new Map();
const mapAccess = new Map();
function addMapAccess(mapId, reference) {
  if (!maps.has(Number(mapId))) return;
  if (!mapAccess.has(Number(mapId))) mapAccess.set(Number(mapId), []);
  mapAccess.get(Number(mapId)).push(reference);
}
for (const map of maps.values()) {
  for (const [group, entities] of mapEntities(map)) {
    for (const entity of entities)
      if (entity.destination?.mapId)
        addMapAccess(entity.destination.mapId, {
          type: "physical-portal",
          sourceMap: map.id,
          group,
          entityId: entity.id,
          position: [entity.x, entity.y, entity.layer],
          entrance: entity.destination.entrance,
          availability:
            "source-declared; conditional group and runtime destination changes not evaluated",
        });
  }
}
for (const [id, program] of Object.entries(data.programs)) {
  const scopes = declarationMaps.get(id)?.length ? declarationMaps.get(id) : [null];
  for (const [index, op] of program.ops.entries()) {
    if (op[0] === "ChangeMap")
      for (const mapId of scopes)
        addMapAccess(op[1][0], {
          type: "script-map-transition",
          programId: id,
          script: program.name,
          sourceMap: mapId,
          opIndex: index,
          entrance: op[1][1],
          continuation: op[3][0] || null,
          availability: "source-declared branch; not a freely traversable portal",
        });
    const names = unique(
      op[3].filter((name) => /^sc_/.test(name) && Object.hasOwn(data.global, name)),
    );
    for (const name of names) {
      for (const mapId of scopes) {
        const targetMap = op[0] === "ChangeMap" ? op[1][0] : mapId;
        const target = resolve(name, targetMap);
        if (!target) continue;
        const reference = {
          from: id,
          fromScript: program.name,
          sourceMap: mapId,
          opIndex: index,
          op: op[0],
          target,
          script: name,
          targetMap,
          scopeBasis:
            mapId === null && op[0] !== "ChangeMap"
              ? "global fallback; resident current-map resolution may differ"
              : "PR declaration/runtime resolver",
        };
        if (!incoming.has(target)) incoming.set(target, []);
        if (!outgoing.has(id)) outgoing.set(id, []);
        incoming.get(target).push(reference);
        outgoing.get(id).push(reference);
      }
    }
  }
}
function entryCandidates(id) {
  const direct = startsByProgram.get(id) || [];
  if (direct.length)
    return { ids: direct, paths: direct.map((start) => ({ start, programs: [id] })), depth: 0 };
  const queue = [{ id, programs: [id] }],
    seen = new Set([id]);
  for (let depth = 1; depth <= 24; depth++) {
    const layer = queue.splice(0),
      paths = [];
    for (const node of layer) {
      for (const reference of incoming.get(node.id) || []) {
        if (seen.has(reference.from)) continue;
        seen.add(reference.from);
        const programs = [reference.from, ...node.programs];
        for (const start of startsByProgram.get(reference.from) || [])
          paths.push({ start, programs });
        queue.push({ id: reference.from, programs });
      }
    }
    if (paths.length) return { ids: unique(paths.map((item) => item.start)), paths, depth };
    if (!queue.length) break;
  }
  return {
    ids: [],
    paths: [],
    depth: null,
    limitation:
      "No statically linked entry within 24 script edges; dynamic SysCall/engine dispatch not expanded",
  };
}

const evidenceFiles = [],
  historyCoverage = new Map(),
  nameCoverage = new Map(),
  mapCoverage = new Map();
const encounterCoverage = new Map();
function observe(index, entry, itemIndex, kind) {
  const name = entry.script,
    mapId = Number(entry.mapId);
  const id = name && resolve(name, mapId);
  if (id) {
    if (!historyCoverage.has(id)) historyCoverage.set(id, []);
    historyCoverage
      .get(id)
      .push({ evidence: index, index: itemIndex, kind, mapId, time: entry.time });
  }
  if (name) {
    if (!nameCoverage.has(name)) nameCoverage.set(name, new Set());
    nameCoverage.get(name).add(index);
  }
  if (maps.has(mapId)) {
    if (!mapCoverage.has(mapId)) mapCoverage.set(mapId, new Set());
    mapCoverage.get(mapId).add(index);
  }
}
async function addEvidence(file, type) {
  const doc = await optionalRead(file);
  if (!doc) {
    warnings.push(`Optional evidence absent: ${relative(file)}`);
    return;
  }
  const snapshot = doc.snapshot || doc,
    history = doc.history || snapshot.history || [];
  const evidence = evidenceFiles.length;
  evidenceFiles.push({
    id: evidence,
    file: relative(file),
    type,
    historyEntries: history.length,
    mode: doc.mode || null,
    start: doc.start || null,
    testBoost: Boolean(snapshot.testBoost || doc.boostReason || doc.mode === "story-test"),
    terminalMap: snapshot.mapId || doc.mapId,
    terminalTime: snapshot.time || doc.time,
  });
  history.forEach((entry, index) => observe(evidence, entry, index, "history"));
  (doc.events || []).forEach((entry, index) => {
    if (entry.kind === "script" || entry.kind === "map") observe(evidence, entry, index, "event");
  });
  for (const id of snapshot.visited || []) {
    if (!maps.has(Number(id))) continue;
    if (!mapCoverage.has(Number(id))) mapCoverage.set(Number(id), new Set());
    mapCoverage.get(Number(id)).add(evidence);
  }
  if (maps.has(Number(snapshot.mapId))) {
    if (!mapCoverage.has(Number(snapshot.mapId)))
      mapCoverage.set(Number(snapshot.mapId), new Set());
    mapCoverage.get(Number(snapshot.mapId)).add(evidence);
  }
  for (const detail of doc.battleDetails || snapshot.battles || []) {
    const id = Number(detail.encounterId ?? detail.partyId ?? detail.id);
    if (!id) continue;
    if (!encounterCoverage.has(id)) encounterCoverage.set(id, []);
    encounterCoverage.get(id).push({ evidence, outcome: detail.outcome || detail.result || null });
  }
}
await addEvidence(values.report, "regression-report");
const checkpointFiles = (await readdir(values.checkpoints))
  .filter((name) => name.endsWith(".json"))
  .sort();
for (const file of checkpointFiles)
  await addEvidence(path.join(values.checkpoints, file), "checkpoint");

// Host-only instruction observers can strengthen coverage without changing core VM.
const vmCoverageDocument = await optionalRead(values.coverage),
  vmCoverage = new Map();
if (vmCoverageDocument) {
  const rows = vmCoverageDocument.programs || vmCoverageDocument.programIds || [];
  for (const [key, value] of Object.entries(rows)) {
    const id = String(
      typeof value === "string" || typeof value === "number"
        ? value
        : (value.programId ?? value.id ?? key),
    );
    if (!data.programs[id]) continue;
    if (typeof value === "object" && value.name && value.name !== data.programs[id].name) {
      warnings.push(`VM evidence program ${id} name differs from current PR export: ${value.name}`);
      continue;
    }
    vmCoverage.set(id, typeof value === "object" ? value : { programId: id });
  }
  for (const operation of vmCoverageDocument.operations || []) {
    const [id, pc] = String(operation).split(":");
    const entry = vmCoverage.get(id);
    if (entry && Number.isInteger(Number(pc))) {
      entry.opIndices ??= [];
      entry.opIndices.push(Number(pc));
    }
  }
}
const coverageFor = (id) => {
  const observations = historyCoverage.get(id) || [];
  return {
    executed: vmCoverage.has(id) || observations.length > 0,
    status: vmCoverage.has(id)
      ? "vm-instruction-observed"
      : observations.length
        ? "scene-start-observed"
        : "not-observed",
    vm: vmCoverage.get(id) || null,
    historyEvidence: numeric(observations.map((entry) => entry.evidence)),
    historyObservationCount: observations.length,
    firstHistoryObservation: observations[0] || null,
    observedMaps: numeric(observations.map((entry) => entry.mapId)),
  };
};

const eventRecords = [],
  eventById = new Map();
for (const [id, program] of Object.entries(data.programs)) {
  if (!program.name.startsWith("sc_e_")) continue;
  const sourceMaps = numeric(declarationMaps.get(id) || []),
    entries = entryCandidates(id);
  const entryMaps = numeric(entries.ids.map((entry) => starts[Number(entry.split(":")[1])].mapId));
  const associationMaps = sourceMaps.length ? sourceMaps : entryMaps;
  const sourcePhases = unique(
    entries.ids.flatMap((entry) => starts[Number(entry.split(":")[1])].sourcePhases),
  );
  const record = {
    id,
    script: program.name,
    title: program.title,
    source: sourceByProgram.get(id),
    sourceMaps,
    areaIds: numeric(associationMaps.map((map) => maps.get(map)?.areaId).filter(Boolean)),
    areas: unique(associationMaps.map((map) => maps.get(map)?.area.name).filter(Boolean)),
    areaAssociation: sourceMaps.length
      ? "explicit PR map package script declaration"
      : entryMaps.length
        ? "nearest declared initializer/NPC/trigger via static script-reference graph"
        : "unknown/resident utility",
    phase: phaseName(sourcePhases),
    sourcePhases,
    phaseBasis:
      "nearest declared entry group reachability under source world bit plus physical portal geography; other source gates remain unknown",
    coverage: coverageFor(id),
    questVerification: "not-assessed",
    starts: entries,
    references: { incoming: incoming.get(id) || [], outgoing: outgoing.get(id) || [] },
    flagReads: [],
    flagWrites: [],
    encounters: [],
    rewards: [],
    recruits: [],
    sourceLabels: [],
    messageKeys: [],
  };
  for (const [index, op] of program.ops.entries()) {
    const [name, i, , s] = op;
    if (name === "Branch" && /Flag|Variable/.test(s[0]))
      record.flagReads.push({
        opIndex: index,
        bank: s[0],
        index: i[0],
        operator: s[1],
        compareBank: s[2],
        value: i[1],
        branch: i[2],
      });
    if (["SetFlag", "ResetFlag", "FlipFlag"].includes(name))
      record.flagWrites.push({
        opIndex: index,
        op: name,
        bank: s[0],
        index: i[0],
      });
    if (["Encount", "EncountBoss"].includes(name))
      record.encounters.push({
        opIndex: index,
        encounterId: i[0],
        continuation: s[0] || null,
        enemies: (battle.parties[i[0]]?.members || []).map((member) => ({
          id: member.monsterId,
          name: battle.monsters[member.monsterId]?.name || null,
        })),
        observedBattles: encounterCoverage.get(i[0]) || [],
      });
    if (name === "GetItem")
      record.rewards.push({
        opIndex: index,
        contentId: i[0],
        count: i[1] || 1,
        name: battle.contentNames[i[0]] || null,
        magicite: Boolean(battle.magicStones[i[0]]),
      });
    if (name === "SysCall" && s[0].startsWith("メンバー加入："))
      record.recruits.push({ opIndex: index, sourceCall: s[0] });
    if (name === "Nop" && op[5] && op[5] !== "Main" && !/^(?:\d|puppet|[a-z]+_\d)/i.test(op[5]))
      record.sourceLabels.push(op[5]);
    for (const key of s) if (key && Object.hasOwn(data.messages, key)) record.messageKeys.push(key);
  }
  record.sourceLabels = unique(record.sourceLabels);
  record.messageKeys = unique(record.messageKeys);
  eventRecords.push(record);
  eventById.set(id, record);
}

const mapRecords = [...maps.values()].map((map) => {
  const declared = eventRecords.filter((record) => record.sourceMaps.includes(map.id));
  return {
    id: map.id,
    name: map.name,
    areaId: map.areaId,
    area: map.area.name,
    areaMessageKey: map.area.messageKey,
    phase: phaseName(map.geographyPhases),
    phaseBasis:
      "physical PR portal reachability from world maps 1/2, conditional groups overapproximated",
    visited: mapCoverage.has(map.id) || (vmCoverageDocument?.maps || []).includes(map.id),
    vmObserved: (vmCoverageDocument?.maps || []).includes(map.id),
    evidence: [...(mapCoverage.get(map.id) || [])],
    declaredPrograms: declared.map((record) => record.id),
    unobservedPrograms: declared
      .filter((record) => !record.coverage.executed)
      .map((record) => record.id),
    starts: starts.filter((start) => start.mapId === map.id).map((start) => start.id),
    npcInteractions: npcInteractions.filter((npc) => npc.mapId === map.id).map((npc) => npc.id),
    entranceReferences: mapAccess.get(map.id) || [],
    questVerification: "not-assessed",
  };
});
for (const npc of npcInteractions) {
  npc.coverage = npc.programId
    ? coverageFor(npc.programId)
    : { executed: false, status: "not-instrumented-direct-talk" };
  npc.coverage.scope = "script program only; this particular entity interaction was not recorded";
  npc.questVerification = "not-assessed";
}
const names = unique(eventRecords.map((record) => record.script))
  .sort()
  .map((name) => {
    const records = eventRecords.filter((record) => record.script === name);
    return {
      script: name,
      programIds: records.map((record) => record.id),
      executed: records.some((record) => record.coverage.executed),
      allVariantsObserved: records.every((record) => record.coverage.executed),
      unobservedVariants: records
        .filter((record) => !record.coverage.executed)
        .map((record) => record.id),
    };
  });
const areas = areaRows.map((row) => {
  const area = areaById.get(Number(row.id)),
    areaMaps = mapRecords.filter((map) => map.areaId === area.id);
  const records = eventRecords.filter((record) => record.areaIds.includes(area.id));
  return {
    ...area,
    maps: areaMaps.map((map) => map.id),
    unvisitedMaps: areaMaps.filter((map) => !map.visited).map((map) => map.id),
    programs: records.map((record) => record.id),
    unobservedPrograms: records
      .filter((record) => !record.coverage.executed)
      .map((record) => record.id),
    phases: unique(areaMaps.map((map) => map.phase)),
    npcInteractions: npcInteractions.filter((npc) => npc.areaId === area.id).map((npc) => npc.id),
  };
});
function areaTopic(pattern) {
  const matched = areas.filter((area) => pattern.test(area.name || ""));
  return {
    areaIds: matched.map((area) => area.id),
    areas: matched.map((area) => area.name),
    maps: unique(matched.flatMap((area) => area.maps)),
    programs: unique(matched.flatMap((area) => area.programs)),
    unobservedPrograms: unique(matched.flatMap((area) => area.unobservedPrograms)),
    startCandidates: starts
      .filter((start) => matched.some((area) => area.id === start.areaId))
      .map((start) => start.id),
    questVerification: "not-assessed",
    basis: "actual PR area.csv Chinese message names",
  };
}
// Match the eight named quest species in source-scripted formations, rather
// than matching every ordinary monster whose English name contains Dragon.
const dragonEncounters = eventRecords.filter((record) =>
  record.encounters.some((encounter) =>
    encounter.enemies.some((enemy) =>
      /^(Ice|Storm|Earth|Gold|Skull|Blue|Red|Holy) Dragon$/.test(enemy.name || ""),
    ),
  ),
);
const dragons = dragonEncounters.map((record) => ({
  programId: record.id,
  script: record.script,
  maps: record.sourceMaps,
  areas: record.areas,
  phase: record.phase,
  coverage: record.coverage,
  encounters: record.encounters,
  starts: record.starts,
  flagReads: record.flagReads,
  flagWrites: record.flagWrites,
  references: record.references,
  questVerification: "not-assessed",
}));
const magicite = eventRecords.flatMap((record) =>
  record.rewards
    .filter((reward) => reward.magicite)
    .map((reward) => ({
      ...reward,
      programId: record.id,
      script: record.script,
      maps: record.sourceMaps,
      areas: record.areas,
      phase: record.phase,
      coverage: record.coverage,
      starts: record.starts,
      flagReads: record.flagReads,
      flagWrites: record.flagWrites,
      questVerification: "not-assessed",
      optionality: "not inferred from lack of coverage; inspect source quest chain",
    })),
);
const recruits = eventRecords.flatMap((record) =>
  record.recruits.map((recruit) => ({
    ...recruit,
    programId: record.id,
    script: record.script,
    maps: record.sourceMaps,
    areas: record.areas,
    phase: record.phase,
    coverage: record.coverage,
    starts: record.starts,
    flagReads: record.flagReads,
    flagWrites: record.flagWrites,
    questVerification: "not-assessed",
  })),
);
const fallback = await optionalRead(path.join(values.checkpoints, "kefka-tower.json"));
const fallbackStart = fallback
  ? {
      file: relative(path.join(values.checkpoints, "kefka-tower.json")),
      mapId: fallback.mapId,
      vehicle: fallback.player?.vehicle,
      partySlots: fallback.partySlots,
      availableMembers: Object.values(fallback.roster || {})
        .filter((unit) => unit.enabled || unit.reserve)
        .map((unit) => ({
          id: unit.id,
          name: unit.name,
          enabled: unit.enabled,
          reserve: unit.reserve,
        })),
      testBoost: Boolean(fallback.testBoost),
      kind: "actual main-regression checkpoint; not original native save",
      warning:
        "Original-save audit found no accepted original WoR save; optional recruit/quest flags must be verified through real source interactions.",
    }
  : null;
const output = {
  schemaVersion: 1,
  inputs: {
    data: relative(values.data),
    report: relative(values.report),
    checkpoints: relative(values.checkpoints),
    coverage: vmCoverageDocument ? relative(values.coverage) : null,
  },
  methodology: {
    sourceIdentity:
      "all current raw/index bundleOutput entries; source file + assetPath sorted exactly as PR runtime compiler; checked program names and count",
    areaAssociation:
      "explicit package.map.script declarations preferred; resident/global utilities use nearest declared map entry through static references and remain marked inferred",
    phases:
      "ScenarioFlag2[41] source before/after-world labels plus group-selection control flow; physical portal geography is an overapproximation, not dynamic navigation or quest availability",
    scriptCoverage:
      "VM instruction observer where available; otherwise root scene-start history/events resolved through byMap then global. Absence means not observed in these runs.",
    mapCoverage: "recorded map events, script scene mapIds, snapshot visited list and terminal map",
    starts:
      "declared map initializer / NPC / trigger, including conditionally selected groups; nearest static upstream entry paths up to 24 script edges; not runnable routes",
    questVerification:
      "not-assessed for every inventory item. No script call, battle, flag presence or visited map alone establishes end-to-end optional quest completion.",
  },
  limitations: [
    "Scene histories omit many actor/NPC VM tasks. Only host instruction coverage can prove those programs were observed.",
    "Coverage of a program does not prove all branches/opcodes ran. Check any VM op-index coverage before assessing a branch.",
    "Conditional group, NPC movement, party, timer, world vehicle and quest gates are retained as source references and are not executed or bypassed.",
    "Static references include any script-valued operand; conditional/error/timer/battle-return paths may be mutually exclusive.",
    "Resident current-map script dispatch can resolve differently from the global fallback reference; these edges are explicitly marked.",
    "Area map_type does not distinguish towns from dungeons in PR; town/NPC index therefore includes all source NPC interactions, grouped by actual area name.",
    "An NPC's script coverage is program-level only; shared script execution does not establish interaction with that particular entity.",
  ],
  sourceWorldFlagProof,
  evidenceFiles,
  vmCoverageEvidence: vmCoverageDocument
    ? {
        file: relative(values.coverage),
        source: vmCoverageDocument.source,
        mode: vmCoverageDocument.mode,
        start: vmCoverageDocument.start,
        stop: vmCoverageDocument.stop,
        programs: vmCoverageDocument.programs?.length || vmCoverage.size,
        sourcePrograms: vmCoverage.size,
        runtimeGeneratedPrograms: (vmCoverageDocument.programs || []).filter(
          (program) => !data.programs[program.id],
        ).length,
        opSites: vmCoverageDocument.operations?.length || 0,
        maps: vmCoverageDocument.maps?.length || 0,
        battleCount: vmCoverageDocument.battleCount,
        titleScreen: vmCoverageDocument.titleScreen,
      }
    : null,
  summary: {
    scriptNames: names.length,
    scriptInstances: eventRecords.length,
    observedScriptNames: names.filter((record) => record.executed).length,
    unobservedScriptNames: names.filter((record) => !record.executed).length,
    observedScriptInstances: eventRecords.filter((record) => record.coverage.executed).length,
    vmObservedInstances: eventRecords.filter((record) => record.coverage.vm).length,
    unobservedScriptInstances: eventRecords.filter((record) => !record.coverage.executed).length,
    maps: mapRecords.length,
    visitedMaps: mapRecords.filter((map) => map.visited).length,
    unvisitedMaps: mapRecords.filter((map) => !map.visited).length,
    areas: areas.length,
    startCandidates: starts.length,
    npcInteractions: npcInteractions.length,
    programsWithoutArea: eventRecords.filter((record) => !record.areaIds.length).length,
    programsWithoutStaticEntry: eventRecords.filter((record) => !record.starts.ids.length).length,
    programsUnknownPhase: eventRecords.filter((record) => record.phase === "unknown").length,
    verifiedOptionalQuests: 0,
  },
  fallbackWoRStart: fallbackStart,
  topics: {
    worRecruitment: {
      candidates: recruits.filter((record) => record.phase !== "world-of-balance"),
      allMembershipSourceCalls: recruits,
      questVerification: "not-assessed",
      limitation:
        "Unknown/shared-phase joins remain candidates, not claimed WoR recruitment quests. Source calls/flags identify exact case assertions.",
    },
    eightDragons: {
      candidates: dragons,
      questVerification: "not-assessed",
      basis:
        "PR source Encount operands and actual PR formation monster identities; excludes ordinary dragon species and extra data-only encounters",
    },
    phoenixCave: areaTopic(/不死鸟洞窟|フェニックス|Phoenix/),
    ancientCastle: areaTopic(/古代城/),
    cyanDream: areaTopic(/梦境迷宫/),
    optionalEspers: {
      magiciteAcquisitionCandidates: magicite,
      questVerification: "not-assessed",
      limitation:
        "All PR GetItem magicite rewards are indexed, including main-story rewards. Optionality is not guessed from execution coverage; NPC purchases/direct rewards may also appear in npcInteractions.",
    },
    townsNPC: {
      byArea: areas
        .filter((area) => area.npcInteractions.length)
        .map((area) => ({
          areaId: area.id,
          area: area.name,
          maps: area.maps,
          interactions: area.npcInteractions,
        })),
      questVerification: "not-assessed",
    },
  },
  areas,
  maps: mapRecords,
  scriptNames: names,
  programs: eventRecords,
  starts,
  npcInteractions,
  warnings,
};
if (
  eventRecords.length !==
    Object.values(data.programs).filter((program) => program.name.startsWith("sc_e_")).length ||
  names.length !== new Set(eventRecords.map((record) => record.script)).size ||
  mapRecords.length !== mapRows.length
) {
  throw Error("Inventory completeness invariant failed.");
}
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const rows = [
  [
    "type",
    "programId",
    "script",
    "sourceMap",
    "area",
    "phase",
    "executed",
    "coverageKind",
    "startCandidates",
    "references",
    "questVerification",
    "source",
  ],
];
for (const record of eventRecords)
  rows.push([
    "script",
    record.id,
    record.script,
    record.sourceMaps.join("|"),
    record.areas.join("|"),
    record.phase,
    record.coverage.executed,
    record.coverage.status,
    record.starts.ids.join("|"),
    record.references.incoming
      .map(
        (reference) =>
          `${reference.fromScript}@${reference.sourceMap ?? "global"}#${reference.opIndex}:${reference.op}`,
      )
      .join("|"),
    record.questVerification,
    `${record.source.file}::${record.source.assetPath}`,
  ]);
for (const record of mapRecords)
  rows.push([
    "map",
    "",
    "",
    record.id,
    record.area,
    record.phase,
    record.visited,
    "map-visited",
    record.starts.join("|"),
    record.declaredPrograms.join("|"),
    record.questVerification,
    record.name,
  ]);
for (const npc of npcInteractions)
  rows.push([
    "npc",
    npc.programId,
    npc.script,
    npc.mapId,
    areaById.get(npc.areaId)?.name,
    phaseName(npc.sourcePhases),
    npc.coverage.executed,
    npc.coverage.status,
    `${npc.group}/${npc.entityId}@${npc.position.join(",")}`,
    npc.interaction.message?.key || "",
    npc.questVerification,
    "PR map entity declaration",
  ]);
await mkdir(path.dirname(values.out), { recursive: true });
await writeFile(values.out, JSON.stringify(output, null, 2) + "\n");
const csvFile = values.out.replace(/\.json$/i, "") + ".csv";
await writeFile(
  csvFile,
  "\uFEFF" + rows.map((row) => row.map(csv).join(",")).join("\r\n") + "\r\n",
);
console.log(
  JSON.stringify(
    { ...output.summary, json: relative(values.out), csv: relative(csvFile), warnings },
    null,
    2,
  ),
);
