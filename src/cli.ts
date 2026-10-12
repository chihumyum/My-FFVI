import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  CapabilityRegistry,
  Conditions,
  ImportedProject,
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
import { compileOpeningBattle } from "./compiler/battle.js";
import { compileOpeningPlayable } from "./compiler/opening-playable.js";
import { compileCorpus, corpusMarkdown } from "./compiler/corpus.js";

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
    const binding = project.regions.find((r) => r.id === target);
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
