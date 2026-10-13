// Actual source dependencies test common systems. Complete-pool admission and
// independent controlled mechanism probes remain different evidence lanes.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { compileBattleContentBatch, buildBattleContentBatch } from "./build-battle-content-batch.mjs";
import { loadSystemSource } from "../dist/src/compiler/system-source.js";
import { tableInteger as int } from "../dist/src/compiler/table.js";

const root = resolve(import.meta.dirname, ".."), run = promisify(execFile);
const out = resolve(root, "build/reports/battle-system-extensions-check.json");
const declaration = JSON.parse(await readFile(resolve(root, "content-batches/narshe-battle-systems.json"), "utf8"));
const report = { kind: "battle-system-extensions-check-v1", result: "running", stages: [],
  sourceGameplayVerified: false, browserVerified: false, fullGameMigrated: false };
const stage = (name, detail = {}) => report.stages.push({ name, ...detail });
await mkdir(resolve(out, ".."), { recursive: true });
try {
  const system = await loadSystemSource(root, declaration.parentSourceSetHash);
  const pool = system.reader.row("monster_set.csv", 129);
  const selected = Array.from({ length: 16 }, (_, i) => ({
    partyId: int(pool.values["monster_set" + (i + 1)]),
    weight: int(pool.values["monster_set" + (i + 1) + "_rate"]),
  })).filter(entry => entry.partyId > 0 && entry.weight > 0);
  assert.deepEqual([...new Set(selected.map(entry => entry.partyId))].sort((a, b) => a - b), declaration.partyIds);
  stage("complete-positive-source-pool-retained", { source: pool.source, selected });

  const { entryPolicy, ...strict } = declaration;
  strict.kind = "battle-content-batch-declaration-v1";
  const source = await compileBattleContentBatch(root, strict);
  assert.equal(source.catalog, null); assert.equal(source.report.result, "blocked");
  await writeFile(resolve(root, "build/reports/v75-set129-strict-current.json"), JSON.stringify(source.report, null, 2) + "\n");
  stage("original-entry-gaps-remain-blocked", { runtime: source.report.runtime });

  const framework = await compileBattleContentBatch(root, declaration);
  await writeFile(resolve(root, "build/reports/v75-set129-framework-current.json"), JSON.stringify(framework.report, null, 2) + "\n");
  assert.equal(framework.catalog, null); assert.equal(framework.report.result, "blocked");
  const incomplete = framework.report.diagnostics.filter(d => d.kind === "blocked" || d.kind === "runtime-dependency");
  assert.ok(incomplete.length > 0);
  assert.deepEqual(incomplete.map(d => [d.partyId, d.code, d.pc]),
    [[275, "automatic-target", 6], [275, "ai-instruction", 12], [275, "ability-plan", 17]],
    "Any additional gap in the complete batch must be investigated, never filtered");
  assert.match(incomplete[0].reason, /counter target range 5/);
  assert.match(incomplete[1].reason, /CounterPlayerAct/);
  assert.match(incomplete[2].reason, /Ability 327/);
  stage("remaining-action-dependencies-deny-the-whole-declared-batch", { incomplete });

  const changed = structuredClone(declaration); changed.entryPolicy.scripts[0].sourceHash = "0".repeat(64);
  await assert.rejects(() => compileBattleContentBatch(root, changed), /changed or conflicting.*script/);
  stage("development-entry-rejects-changed-source-bindings");

  // Three deliberately selected mechanism probes are not a replacement for
  // the four-member source pool. They exercise initial status, caster results,
  // AI and immutable defeat retry through the same continuous-flow checker.
  // These source enemies are level 32; the development party is not boosted
  // to manufacture victories or source-story availability.
  const probeDir = resolve(root, "build/content-batches/battle-system-probes");
  await mkdir(probeDir, { recursive: true });
  const probeDeclaration = { ...declaration, id: "controlled-battle-system-probes", partyIds: [129, 274, 276] };
  const probePath = resolve(root, "build/reports/v75-battle-system-probes.declaration.json");
  await writeFile(probePath, JSON.stringify(probeDeclaration, null, 2) + "\n");
  const probes = await buildBattleContentBatch({ root, declarationPath: probePath, outDir: probeDir });
  assert.equal(probes.report.result, "compiled"); assert.equal(probes.report.runtime.withRuntimeDependencies, 0);
  for (const id of [129, 276]) assert.ok(probes.catalog.encounters[id].enemies
    .some(enemy => enemy.sourceId === 207 && enemy.conditionIds.length === 1 && enemy.conditionIds[0] === 93));
  assert.ok(probes.catalog.common.abilities[696].plan.effects.some(effect => effect.kind === "user-condition"));
  const replayPath = resolve(root, "build/reports/v75-battle-system-probes-check.json");
  await run(process.execPath, ["scripts/check-battle-content-batch.mjs", "--catalog", resolve(probeDir, "battle.json"),
    "--declaration", probePath, "--outcome", "defeat-retry", "--report", replayPath], { cwd: root, maxBuffer: 1024 * 1024 });
  const replay = JSON.parse(await readFile(replayPath, "utf8"));
  assert.equal(replay.result, "passed"); assert.equal(replay.sourcePoolAdmitted, false);
  stage("independent-system-probes-use-common-action-loss-and-immutable-retry", { encounters: replay.encounters,
    contentHash: probes.catalog.contentHash, declarationHash: probes.report.declarationHash });
  report.sourcePoolAdmitted = false; report.controlledProbeCount = replay.encounters.length;
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = error.stack ?? String(error); throw error;
} finally { await writeFile(out, JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify({ result: report.result, stages: report.stages.length,
  controlledProbeCount: report.controlledProbeCount, sourcePoolAdmitted: false, report: out }));
