// Complete source-family comparison plus existing native receipts. No package
// writer, source-AI rewrite, native export or original-game execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
let compiled = "dist", output = resolve(root, "build/reports/source-received-command-check.json");
const args = process.argv.slice(2), seen = new Set();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index], value = args[index + 1];
  assert.ok((key === "--compiled-dir" || key === "--report") && value && !seen.has(key),
    "Usage: check-source-received-command.mjs [--compiled-dir directory] [--report file]");
  seen.add(key);
  if (key === "--compiled-dir") compiled = value; else output = resolve(root, value);
}
const load = file => import(pathToFileURL(resolve(root, compiled, file)));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await readFile(resolve(root, file), "utf8"));
const tests = [], nativeMethods = [], sites = [], sourceRoutes = [];
const result = { kind: "source-received-command-check-v1", result: "failed", tests, nativeMethods, sites, sourceRoutes,
  evidence: "Complete source operands, pinned existing native methods and pure AI execution",
  originalGameExecuted: false, nativeDynamicVerified: false, browserVerified: false,
  sourcePoolAdmission: false, sourceCampaignComplete: false };
const check = async (name, run) => { await run(); tests.push({ name, passed: true }); };
async function fileHash(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(resolve(root, file))) hash.update(bytes);
  return hash.digest("hex");
}

try {
  const [{ readSnapshot, snapshotFile }, { compileBattleAI, battleAIAbilities },
    { startBattleAI, planBattleAITurn, planBattleAIReaction, selectBattleAIAbilities },
    { initialEnemyBehavior }, { hash }] = await Promise.all([
    load("src/compiler/integrity.js"), load("src/compiler/battle-ai.js"),
    load("src/core/battle-ai.js"), load("src/core/enemy-behavior.js"), load("src/compiler/content.js"),
  ]);
  result.runtimeHash = await runtimeDigest(root, compiled);
  const nativePins = {
    nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
    headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  };
  await check("native files match the existing source pins", async () => {
    for (const [key, file] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
      symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
      assert.equal(await fileHash(file), nativePins[key]);
  });
  const receiptSources = [
    ["build/native/v85-counter-handlers", ["0x81f730"]],
    ["build/native/ai-selection", ["0x821bf0", "0x15b9d80", "0x15b94a0"]],
    ["build/native/ai-counter-trigger", ["0x15b8550"]],
  ];
  const methodTexts = new Map();
  await check("existing handler, lottery and NULL-target consumers retain their exact C and PE bytes", async () => {
    for (const [directory, wanted] of receiptSources) {
      const receipt = await json(`${directory}/complete.json`);
      assert.equal(receipt.status, "complete");
      for (const [key, pin] of Object.entries(nativePins)) assert.equal(receipt[key], pin);
      for (const rva of wanted) {
        const matches = receipt.methods.filter(method => method.rva === rva);
        assert.equal(matches.length, 1, "Ambiguous native method receipt");
        const method = matches[0], bytes = await readFile(resolve(root, directory, `${rva.slice(2)}.c`));
        assert.equal(sha(bytes), method.decompiledSha256);
        methodTexts.set(rva, bytes.toString("utf8"));
        nativeMethods.push({ rva, nativeBytes: parseInt(method.nextSymbolRva, 16) - parseInt(rva, 16),
          nativeRangeSha256: method.nativeRangeSha256, decompiledSha256: method.decompiledSha256 });
      }
    }
    // Read only the already exported ranges through the existing PE reader.
    const python = String.raw`import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for m in json.load(sys.stdin):
 _,_,b=p.read(int(m['rva'],16),m['nativeBytes'])
 out.append({'rva':m['rva'],'sha256':hashlib.sha256(b).hexdigest()})
print(json.dumps(out))`;
    const child = promisify(execFile)(resolve(root, ".venv/bin/python"), ["-c", python, root],
      { maxBuffer: 1024 * 1024 });
    child.child.stdin.end(JSON.stringify(nativeMethods));
    const { stdout } = await child;
    for (const actual of JSON.parse(stdout))
      assert.equal(actual.sha256, nativeMethods.find(method => method.rva === actual.rva).nativeRangeSha256);
    const handler = methodTexts.get("0x81f730");
    assert.match(handler, /FUN_18004f780\(1,/);
    assert.match(handler, /currentHP < 1/);
    assert.match(handler, /FUN_18004f780\(0x1e,/);
    assert.match(handler, /iVar7 != pSVar3->m_Items\[0\]/);
    assert.match(handler, /GetIndex\(bc,1,/);
    assert.match(handler, /pSVar3->m_Items\[\(int\)uVar8\],0\)/);
    const index = methodTexts.get("0x821bf0");
    assert.match(index, /fVar11 < 0\.0/);
    assert.match(index, /return uVar1 - 1/);
    assert.match(index, /max_length - startIndex/);
    assert.match(methodTexts.get("0x15b8550"), /plVar2,abilityId,target,1,1,/);
    assert.match(methodTexts.get("0x15b9d80"), /else if \(target == .*0x0\)/);
    assert.match(methodTexts.get("0x15b9d80"), /GetAttackTargetDecision\s*\(__this,pLVar8,/);
  });
  const [battleFiles, importFiles] = await Promise.all([
    readSnapshot(resolve(root, "build/battle")), readSnapshot(resolve(root, "build/import")),
  ]);
  const exported = JSON.parse(snapshotFile(battleFiles, "battle.json")),
    tables = JSON.parse(snapshotFile(importFiles, "tables.json")),
    manifest = JSON.parse(snapshotFile(importFiles, "project.json"));
  assert.equal(exported.parentSourceSetHash, manifest.sourceSetHash);
  result.sourceSetHash = exported.sourceSetHash; result.parentSourceSetHash = exported.parentSourceSetHash;
  const programs = new Map(), selectors = {}, shapes = {};
  let unchangedCounterPlayerSites = 0;
  await check("all 39 source sites preserve selector, zero sentinel, duplicate candidates, weights and provenance", () => {
    for (const asset of Object.values(exported.assets).filter(asset => asset.source.assetPath.includes("/MonsterAI/"))) {
      const sources = exported.sources.filter(source => source.file === asset.source.file || source.file.endsWith("/" + asset.source.file));
      assert.equal(sources.length, 1);
      const source = { ...asset.source, sha256: sources[0].sha256,
        sourceSetHash: exported.parentSourceSetHash, battleSourceSetHash: exported.sourceSetHash };
      let program;
      try { program = compileBattleAI(asset.data, source); }
      catch (error) {
        assert.ok(!asset.data.Mnemonics?.some(m => m.mnemonic === "CounterActReceiveCommand"), String(error));
        continue;
      }
      for (const [pc, raw] of asset.data.Mnemonics.entries()) {
        if (raw.mnemonic === "CounterPlayerAct") {
          unchangedCounterPlayerSites++; assert.equal(program.instructions[pc].op.kind, "blocked");
        }
        if (raw.mnemonic !== "CounterActReceiveCommand") continue;
        const { iValues: i, rValues: r, sValues: s } = raw.operands;
        assert.equal(raw.type, 1); assert.ok(i.length >= 2 && i.slice(1).every(id => Number.isInteger(id) && id > 0));
        assert.equal(r.length, i.length); assert.equal(r[0], 0); assert.deepEqual(s, []);
        const expected = { kind: "counter-received-command", receivedTypeId: i[0], targeting: "automatic",
          abilities: i.slice(1), weights: r.slice(1) };
        assert.deepEqual(program.instructions[pc].op, expected);
        for (const id of expected.abilities) assert.ok(battleAIAbilities(program).includes(id));
        const row = { source, programHash: hash(asset.data),
          pc, raw: structuredClone(raw.operands), expected };
        sites.push(row); programs.set(source.assetPath, { asset, program });
        selectors[i[0]] = (selectors[i[0]] ?? 0) + 1;
        const key = `i${i.length}/r${r.length}/s${s.length}`; shapes[key] = (shapes[key] ?? 0) + 1;
      }
    }
    assert.equal(sites.length, 39); assert.equal(programs.size, 30); assert.equal(unchangedCounterPlayerSites, 7);
    assert.deepEqual(selectors, { 2: 11, 4: 22, 601: 1, 602: 1, 607: 2, 608: 2 });
  });
  const row = (table, id) => {
    const values = tables[table].filter(row => row.id === String(id)); assert.equal(values.length, 1); return values[0];
  };
  const monster = row("monster.csv", 114), ai = row("monster_ai_script.csv", monster.script_id),
    selected = [...programs.values()].filter(value => value.asset.source.assetPath.endsWith(`/${ai.script_name}.json`));
  assert.equal(selected.length, 1);
  const { program, asset } = selected[0];
  const context = (onlySelf = false) => ({
    self: { hp: Number(monster.hp), mp: Number(monster.mp), monsterId: 114, behavior: initialEnemyBehavior() },
    conditionIds: [], players: [{ level: 1 }], enemies: [{ level: Number(monster.lv) }],
    events: { rules: { conditions: [] }, selfId: "enemy:1", finalAttackFirstTargetSide: null,
      units: [{ id: "enemy:1", side: "enemy", removed: false, conditionIds: [] },
        ...(onlySelf ? [] : [{ id: "enemy:2", side: "enemy", removed: false, conditionIds: [] }]) ] },
  });
  await check("whole source VectorHound program keeps ordinary and only-self paths and explicit automatic reaction targets", () => {
    assert.equal(program.instructions.length, 22); assert.deepEqual(program.blockers, []);
    assert.deepEqual(sites.filter(site => site.source.assetPath === asset.source.assetPath).map(site => site.pc), [5, 11]);
    for (const onlySelf of [false, true]) {
      const ctx = context(onlySelf), initial = startBattleAI(program, ctx), before = structuredClone({ ctx, initial });
      const normal = planBattleAITurn(program, initial.state, ctx);
      assert.deepEqual(normal.acts.map(act => act.abilities), [[onlySelf ? 331 : 1]]);
      for (const [typeId, counterReady, hp, expected] of [
        [4, true, Number(monster.hp), 1], [2, true, Number(monster.hp), 0],
        [4, false, Number(monster.hp), 0], [4, true, 0, 0],
      ]) {
        const turn = planBattleAIReaction(program, initial.state, { ...ctx, self: { ...ctx.self, hp } },
          { counterReady, receivedAbilityId: 1, receivedSystemId: 3, receivedAbilityTypeId: typeId });
        assert.equal(turn.acts.length, expected);
        if (expected) assert.deepEqual(turn.acts[0], { kind: "counter-act", pc: onlySelf ? 11 : 5,
          selected: true, targeting: "automatic", abilities: [487, 696], weights: [50, 50] });
        assert.equal(turn.state.receivedAbility, null); assert.equal(turn.state.actTurn, initial.state.actTurn);
        sourceRoutes.push({ onlySelf, typeId, counterReady, hp, visited: turn.visited, acts: turn.acts });
      }
      assert.throws(() => planBattleAIReaction(program, initial.state, ctx,
        { counterReady: true, receivedAbilityId: 1, receivedSystemId: 3 }), /missing received ability type identity/);
      assert.deepEqual({ ctx, initial }, before);
    }
    assert.equal(row("ability.csv", 1).type_id, "4", "Actual source Fight can trigger this type without a grant");
    for (const partyId of [374, 375]) assert.equal(Object.entries(row("monster_party.csv", partyId))
      .filter(([key, value]) => /^monster[1-9]$/.test(key) && value === "114").length, 2);
  });
  await check("original weighted first-selector slot has exact 50/50 boundary and no normal readiness draw", () => {
    const ctx = context(), initial = startBattleAI(program, ctx), turn = planBattleAIReaction(program, initial.state, ctx,
      { counterReady: true, receivedAbilityId: 1, receivedSystemId: 3, receivedAbilityTypeId: 4 });
    for (const [draw, expected] of [[0, 487], [49.999, 487], [50, 696], [100, 696]]) {
      let calls = 0;
      assert.deepEqual(selectBattleAIAbilities(turn.acts[0], {
        integer: () => { throw new Error("Unexpected integer draw"); },
        float: (min, max) => { calls++; assert.deepEqual([min, max], [0, 100]); return draw; },
      }), [expected]);
      assert.equal(calls, 1);
    }
  });
  result.counts = { sourceSites: sites.length, sourcePrograms: programs.size, selectors, shapes,
    unchangedCounterPlayerSites, nativeMethods: nativeMethods.length, tests: tests.length };
  result.targeting = "NULL source targets use ordinary automatic selection; life, special providers and empty fallback remain independently gated";
  assert.equal(await runtimeDigest(root, compiled), result.runtimeHash, "Runtime changed during source comparison");
  result.result = "passed";
} catch (error) {
  result.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ result: result.result, report: output, tests: tests.length, counts: result.counts,
    ...(result.error ? { error: result.error } : {}) }));
}
