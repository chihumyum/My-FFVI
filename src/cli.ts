import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  CapabilityRegistry,
  Conditions,
  ImportedProject,
  Hash,
  Registry,
  type TargetReport,
} from "./contracts.js";
import { canonical, compileNarshe, acceptance } from "./compiler/content.js";
import { inspectOpera, OperaGraph } from "./compiler/opera.js";
import {
  knowledgeContext,
  sourceBindingFacts,
  validateRegistry,
} from "./knowledge/context.js";
import { Recipe } from "./remaster/recipes.js";
import { readSnapshot, snapshotFile } from "./compiler/integrity.js";

import { compileField } from "./compiler/field.js";
import { compileOpeningBattle, compileSharedBattleSource } from "./compiler/battle.js";
import { compileOpeningPlayable } from "./compiler/opening-playable.js";
import { compileSharedGameCatalog } from "./compiler/game-catalog.js";
import { compileCorpus, corpusMarkdown, loadCorpus } from "./compiler/corpus.js";
import { loadSystemMessages } from "./compiler/system-messages.js";
import { compileFieldNpcRoutes } from "./compiler/field-npc-route.js";

const root = resolve(import.meta.dirname, "../..");
const repo = root.endsWith(`${sep}dist`) ? dirname(root) : root;
const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(resolve(repo, path), "utf8"));
const sha = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
async function loadRegistries() {
  const world = Registry.parse(await readJson("registry/world.json"));
  validateRegistry(world);
  const capabilities = CapabilityRegistry.parse(
    await readJson("registry/capabilities.json"),
  );
  if (
    new Set(capabilities.capabilities.map((c) => c.id)).size !==
    capabilities.capabilities.length
  )
    throw new Error("Duplicate capability owner");
  for (const target of ["narshe", "opera"])
    Recipe.parse(await readJson(`recipes/${target}.json`));
  return { world, capabilities };
}
async function loadImport() {
  const files = await readSnapshot(resolve(repo, "build/import"));
  const project = ImportedProject.parse(
    JSON.parse(snapshotFile(files, "project.json").toString("utf8")),
  );
  if (sha(canonical(project.sources)) !== project.sourceSetHash)
    throw new Error("Source manifest fingerprint mismatch");
  for (const texture of project.narshe.textures) {
    if (sha(snapshotFile(files, texture.file)) !== texture.sha256)
      throw new Error(`Texture changed: ${texture.name}`);
  }
  return { project, files };
}
async function compile() {
  const { world, capabilities } = await loadRegistries();
  const { project, files } = await loadImport();
  const narshe = compileNarshe(project, capabilities.capabilities);
  const graphs = [];
  for (const item of project.opera) {
    graphs.push({
      sourceFile: item.sourceFile,
      graph: OperaGraph.parse(
        JSON.parse(snapshotFile(files, item.graphFile).toString("utf8")),
      ),
    });
  }
  const opera = inspectOpera(graphs, project.sourceSetHash);
  const enriched = {
    ...world,
    facts: [
      ...world.facts,
      ...project.regions.flatMap((r) =>
        sourceBindingFacts(project.sourceSetHash, r.id, r.areaId, r.nameKey),
      ),
    ],
  };
  validateRegistry(enriched);
  const contexts = Object.fromEntries(
    project.regions.map((r) => [
      r.id,
      {
        ...knowledgeContext(enriched, r.id, project.sourceSetHash, {}),
        sourceBinding: r,
      },
    ]),
  );
  const result = {
    formatVersion: 1,
    activePhase: "web-migration",
    deferredWorkstreams: ["hd2d-investigation", "hd2d-production"],
    sourceSetHash: project.sourceSetHash,
    corpus: project.corpus,
    targets: { narshe, opera },
    contexts,
  };
  const out = resolve(repo, "build/reports");
  await mkdir(out, { recursive: true });
  const temp = resolve(out, "status.json.tmp");
  await writeFile(temp, canonical(result) + "\n");
  await rename(temp, resolve(out, "status.json"));
  console.log(
    JSON.stringify(
      {
        sourceSetHash: project.sourceSetHash,
        narshe: {
          scripts: narshe.artifact.scriptCount,
          capabilityForms: narshe.artifact.requiredCapabilities.length,
          accepted: narshe.report.accepted,
        },
        opera: {
          tracks: opera.artifact.tracks.length,
          cameras: opera.artifact.cameras.length,
          accepted: opera.report.accepted,
        },
        output: "build/reports/status.json",
      },
      null,
      2,
    ),
  );
  return result;
}
async function main() {
  const [command = "validate", target = "narshe", ...extra] =
    process.argv.slice(2);
  if (
    extra.length &&
    !(command === "knowledge" && extra.length === 2 && extra[0] === "--state")
  )
    throw new Error("Unexpected arguments");
  if (command === "validate") {
    await loadRegistries();
    console.log("Registry identities and contracts valid");
    return;
  }
  if (command === "npc-routes") {
    const selector = process.argv[3] ?? "all";
    if (selector !== "all" && !/^[1-9][0-9]*$/.test(selector))
      throw new Error("NPC route plan expects all or a positive map ID");
    const corpus = await loadCorpus(repo);
    const parentSourceSetHash = Hash.parse(corpus.manifest.parentSourceSetHash);
    const routeCorpus = { ...corpus, manifest: { ...corpus.manifest, parentSourceSetHash } };
    const ids = (corpus.tables["map.csv"] ?? []).map(row => row.id!);
    if (ids.some(id => !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647))
      throw new Error("Invalid source map identity");
    if (new Set(ids).size !== ids.length)
      throw new Error("Duplicate source map identity");
    if (selector !== "all" && !ids.includes(selector))
      throw new Error(`Unknown source map: ${selector}`);
    const selected = selector === "all" ? ids : [selector];
    const maps = selected.sort((a, b) => Number(a) - Number(b))
      .map(id => compileFieldNpcRoutes(routeCorpus, Number(id)));
    const summary = {
      mapsAnalyzed: maps.length,
      mapsWithDeclaredRoutes: maps.filter(map => map.report.parse.declared > 0).length,
      declaredRoutes: maps.reduce((sum, map) => sum + map.report.parse.declared, 0),
      parsedRoutes: maps.reduce((sum, map) => sum + map.report.parse.parsed, 0),
      invalidRoutes: maps.reduce((sum, map) => sum + map.report.parse.invalid, 0),
      unresolvedBindings: maps.reduce((sum, map) => sum + map.report.binding.blocked, 0),
    };
    const report = {
      kind: "field-npc-route-batch-plan-v1",
      sourceSetHash: corpus.sourceSetHash,
      parentSourceSetHash,
      selector, summary, maps,
      evidence: "source-structure-and-package-local-binding",
      executionConsumer: "not-implemented",
      playableMapCoverage: "not-assessed",
      fullGameMigration: false,
    };
    const out = resolve(repo, "build/reports", selector === "all"
      ? "npc-routes-plan.json" : `npc-routes-map-${selector}.json`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out + ".tmp", canonical(report) + "\n");
    await rename(out + ".tmp", out);
    console.log(JSON.stringify({ ...summary,
      executionConsumer: report.executionConsumer,
      output: selector === "all" ? "build/reports/npc-routes-plan.json"
        : `build/reports/npc-routes-map-${selector}.json` }, null, 2));
    return;
  }
  if (command === "corpus") {
    const { report, manifest } = await compileCorpus(repo);
    const out = resolve(repo, "build/reports");
    await mkdir(out, { recursive: true });
    await writeFile(
      resolve(out, "corpus-plan.json.tmp"),
      canonical(report) + "\n",
    );
    await rename(
      resolve(out, "corpus-plan.json.tmp"),
      resolve(out, "corpus-plan.json"),
    );
    await writeFile(resolve(out, "corpus-plan.md"), corpusMarkdown(report));
    console.log(
      JSON.stringify(
        {
          ...report.counts,
          contentHash: report.contentHash,
          unaddressedTextAssets: Array.isArray(manifest.unaddressedTextAssets)
            ? manifest.unaddressedTextAssets.length
            : null,
          topBlockers: report.priorities
            .filter((p) => p.blockedSites)
            .slice(0, 12)
            .map((p) => ({
              capability: p.id,
              maps: p.blockedMaps.length,
              sites: p.blockedSites,
            })),
          output: "build/reports/corpus-plan.md",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "catalog") {
    const source = await compileSharedBattleSource(repo);
    const out = resolve(repo, "build/game");
    await mkdir(out, { recursive: true });
    // The source artifact is independent of any development entry composer.
    await writeFile(resolve(out, "source-battle.json.tmp"), canonical(source) + "\n");
    await rename(resolve(out, "source-battle.json.tmp"), resolve(out, "source-battle.json"));
    const catalog = await compileSharedGameCatalog(repo, source);
    await writeFile(resolve(out, "source-catalog.json.tmp"), canonical(catalog) + "\n");
    await rename(resolve(out, "source-catalog.json.tmp"), resolve(out, "source-catalog.json"));
    const report = { kind: "shared-source-catalog-compilation-v1", sourceContentHash: source.contentHash,
      catalogContentHash: catalog.contentHash, report: catalog.encounterReport,
      diagnostics: catalog.encounterDiagnostics, originalGameExecuted: false, fullGameMigration: false };
    await mkdir(resolve(repo, "build/reports"), { recursive: true });
    await writeFile(resolve(repo, "build/reports/shared-source-catalog.json"), canonical(report) + "\n");
    console.log(JSON.stringify({ output: "build/game/source-catalog.json", contentHash: catalog.contentHash,
      report: catalog.encounterReport, initialParty: catalog.common.players.length }));
    return;
  }
  if (command === "battle") {
    const result = await compileOpeningBattle(repo);
    const playable = await compileOpeningPlayable(repo, result);
    const out = resolve(repo, "build/game");
    await mkdir(out, { recursive: true });
    await writeFile(
      resolve(out, "opening-battle.json.tmp"),
      canonical(result) + "\n",
    );
    await rename(
      resolve(out, "opening-battle.json.tmp"),
      resolve(out, "opening-battle.json"),
    );
    await writeFile(
      resolve(out, "opening-playable.json.tmp"),
      canonical(playable) + "\n",
    );
    await rename(
      resolve(out, "opening-playable.json.tmp"),
      resolve(out, "opening-playable.json"),
    );
    const reportPath = resolve(repo, "build/reports/battle-catalog.json");
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath + ".tmp", canonical({
      kind: "battle-catalog-compilation-v1",
      sourceContentHash: result.contentHash,
      catalogContentHash: playable.contentHash,
      report: playable.encounterReport,
      diagnostics: playable.encounterDiagnostics,
    }) + "\n");
    await rename(reportPath + ".tmp", reportPath);
    console.log(
      JSON.stringify({
        output: "build/game/opening-battle.json",
        contentHash: result.contentHash,
        encounters: result.encounters.length,
        initialParty: result.initialParty.length,
        developmentOutput: "build/game/opening-playable.json",
        profile: playable.common.profile,
        encounterReport: playable.encounterReport,
        diagnosticsOutput: "build/reports/battle-catalog.json",
      }),
    );
    return;
  }
  if (command === "field") {
    const result = await compileField(repo);
    const out = resolve(repo, "build/game");
    await mkdir(out, { recursive: true });
    await writeFile(resolve(out, "narshe.json.tmp"), canonical(result) + "\n");
    await rename(resolve(out, "narshe.json.tmp"), resolve(out, "narshe.json"));
    console.log(
      JSON.stringify({
        output: "build/game/narshe.json",
        contentHash: result.contentHash,
        entities: result.map.entities.length,
        scripts: Object.keys(result.scripts).length,
      }),
    );
    return;
  }
  if (command === "compile") {
    await compile();
    return;
  }
  if (command === "knowledge") {
    const { world } = await loadRegistries();
    const { project } = await loadImport();
    const context = Conditions.parse(extra.length ? JSON.parse(extra[1]!) : {});
    let binding = project.regions.find((r) => r.id === target);
    if (!binding && world.regions.some((r) => r.id === target)) {
      // Authored regions nominate a source area; the verified full tables and
      // messages establish its binding without rewriting an imported project.
      const facts = world.facts.filter((f) => f.subject === target && f.sourceSetHash === project.sourceSetHash &&
        (f.status === "observed" || f.status === "verified") && Object.keys(f.when).length === 0);
      const areas = facts.filter((f) => f.predicate === "source.areaId");
      const names = facts.filter((f) => f.predicate === "source.nameKey");
      if (areas.length !== 1 || names.length !== 1 || typeof areas[0]!.value !== "string" ||
          !/^[1-9]\d*$/.test(areas[0]!.value) || typeof names[0]!.value !== "string")
        throw new Error("Missing or ambiguous registry source area binding");
      const corpus = await loadCorpus(repo);
      if (corpus.manifest.parentSourceSetHash !== project.sourceSetHash)
        throw new Error("Knowledge corpus/project source mismatch");
      const rows = (corpus.tables["area.csv"] ?? []).filter((row) => row.id === areas[0]!.value);
      if (rows.length !== 1 || rows[0]!.area_name !== names[0]!.value)
        throw new Error("Registry area/message source binding mismatch");
      const system = await loadSystemMessages(repo, project.sourceSetHash,
        ImportedProject.shape.sources.parse(corpus.manifest.sources));
      const localized = system.messages[rows[0]!.area_name!];
      if (typeof localized !== "string" || !localized.length) throw new Error("Missing source area name");
      binding = ImportedProject.shape.regions.element.parse({ id: target, areaId: rows[0]!.id,
        nameKey: rows[0]!.area_name, names: { system_zhc: localized },
        maps: (corpus.tables["map.csv"] ?? []).filter((row) => row.area_id === rows[0]!.id),
        worldPhase: "unknown", evidence: [
          { table: "area.csv", row: rows[0]!.id, sourceSetHash: corpus.sourceSetHash },
          { table: "map.csv", filter: { area_id: rows[0]!.id }, sourceSetHash: corpus.sourceSetHash },
          system.source,
        ] });
    }
    if (!binding) throw new Error(`Unknown target: ${target}`);
    const enriched = {
      ...world,
      facts: [
        ...world.facts,
        ...sourceBindingFacts(
          project.sourceSetHash,
          target,
          binding.areaId,
          binding.nameKey,
        ),
      ],
    };
    validateRegistry(enriched);
    console.log(
      JSON.stringify(
        {
          ...knowledgeContext(enriched, target, project.sourceSetHash, context),
          sourceBinding: binding,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "accept") {
    const result = await compile();
    if (target !== "narshe" && target !== "opera")
      throw new Error(`Unknown target: ${target}`);
    const report: TargetReport = result.targets[target].report;
    console.log(
      JSON.stringify(
        {
          target,
          accepted: acceptance(report),
          lanes: report.lanes,
          blockers: report.blockers.length,
        },
        null,
        2,
      ),
    );
    if (!acceptance(report)) process.exitCode = 2;
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
