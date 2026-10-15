// Source opcode coverage and controlled owned-state contracts are separate
// evidence. Executing a call with a supplied precondition does not play its map.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const module = path => import(pathToFileURL(resolve(root, "dist/src", path + ".js")));
const { loadCorpus } = await module("compiler/corpus");
const { compileFieldRecoveryInstruction } = await module("compiler/field-recovery");
const { hash } = await module("compiler/content");
const { GameState } = await module("core/game-state");
const { executeFieldRecoveryEvent } = await module("core/field-recovery");
const corpus = await loadCorpus(root);
const nativeBytes = await readFile(resolve(root, "build/reports/field-recovery-native-check.json"));
const native = JSON.parse(nativeBytes);
assert.equal(native.result, "passed"); assert.equal(native.semanticsVerified, false);
assert.equal(native.sourceSetHash, corpus.manifest.sourceSetHash);
assert.ok(corpus.manifest.sources.some(source => source.file === "GameAssembly.dll" && source.sha256 === native.nativeSha256));
const bindings = new Map(native.sourceSites.map(site => [site.asset + ":" + site.pc, site]));
const published = JSON.parse(await readFile(resolve(root, "build/game/opening-playable.json"), "utf8"));
const { contentHash, ...body } = published;
assert.equal(hash(body), contentHash);
const make = () => new GameState(published.gameState, published.common.players, contentHash, published.common.conditions);
const report = { kind: "field-recovery-system-check-v1", result: "running", stages: [],
  sourceSetHash: corpus.manifest.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  contentHash, sites: [], blocked: [], controlled: [], originalGameExecuted: false,
  nativeReportSha256: createHash("sha256").update(nativeBytes).digest("hex"),
  nativeSemanticsVerified: false, fullGameMigration: false, playableMapCoverage: null,
  limitations: ["Controlled scalar recovery uses source-owned resource contexts; it does not execute complete source scripts.",
    "MP-count resources, unknown active condition providers and true/unknown KeepBadStatusVisual remain blocked.",
    "An absent positive source selector is a runtime context error; recovery never creates or enables a character."] };
const output = resolve(root, "build/reports/field-recovery-check.json");
await mkdir(resolve(output, ".."), { recursive: true });
try {
  const plan = JSON.parse(await readFile(resolve(root, "build/reports/corpus-plan.json"), "utf8"));
  assert.equal(plan.sourceSetHash, corpus.manifest.sourceSetHash);
  const scripts = new Map(plan.scripts.map(script => [script.id, script]));
  for (const asset of corpus.assets.filter(asset => asset.kind === "script")) {
    for (const [index, raw] of asset.data.Mnemonics.entries()) {
      if (!["RecoveryHP", "RecoveryMP"].includes(raw.mnemonic)) continue;
      const site = { asset: asset.id, index, mnemonic: raw.mnemonic, source: asset.source,
        domain: scripts.get(asset.id)?.domain, maps: scripts.get(asset.id)?.maps ?? [] };
      const binding = bindings.get(asset.id + ":" + index);
      assert.ok(binding); assert.deepEqual(binding.rawOperands, raw.operands);
      assert.equal(binding.provenance.objectId, asset.source.objectId);
      let op;
      try { op = compileFieldRecoveryInstruction(raw, corpus.tables); report.sites.push({ ...site, op }); }
      catch (error) { report.blocked.push({ ...site, reason: error.message }); continue; }
      const state = make(), before = state.snapshot();
      // Deliberately supplied stable injury state, separate from story reachability.
      for (const owner of before.roster) { owner.hp = Math.max(1, Math.floor(owner.maxHp / 2));
        owner.mp = Math.floor(owner.maxMp / 2); owner.conditionIds = []; }
      state.restore(before);
      const targets = op.command.target === 0 ? before.party.slots[before.party.selectedSlot].flatMap(cell => cell.id ? [cell.id] : [])
        : before.roster.filter(owner => op.command.target === -1 ? owner.enabled : owner.sourceId === op.command.target).map(owner => owner.id);
      if (op.command.target > 0 && !targets.length) {
        assert.throws(() => state.fieldRecovery.prepare(op.command), /Unknown owned character status/);
        assert.deepEqual(state.snapshot(), before);
        report.controlled.push({ asset: asset.id, index, result: "absent-owner-rejected", target: op.command.target });
        continue;
      }
      const expected = structuredClone(before), key = op.command.kind === "recover-hp" ? "hp" : "mp";
      for (const id of targets) {
        const owner = expected.roster.find(member => member.id === id), max = key === "hp" ? owner.maxHp : owner.maxMp;
        owner[key] = Math.min(max, owner[key] + (op.command.amount === 0 ? max : Math.abs(op.command.amount)));
      }
      let publications = 0;
      executeFieldRecoveryEvent(op, state.fieldRecovery, steps => {
        assert.deepEqual(state.snapshot(), before);
        assert.deepEqual(steps.map(step => step.targetId), targets);
        assert.ok(steps.every(step => step.setDummy === false && step.affectLeader === true));
        return () => { publications++; assert.deepEqual(state.snapshot(), before); };
      });
      assert.equal(publications, op.command.kind === "recover-hp" && op.command.allowUnableFight && targets.length ? 1 : 0);
      assert.deepEqual(state.snapshot(), expected);
      const restored = make(); restored.restore(JSON.parse(JSON.stringify(expected)));
      const lease = restored.openBattle(1, published.encounters[1].rewardPolicy);
      for (const player of restored.battlePlayers(lease)) {
        const owner = expected.roster.find(member => member.id === player.id);
        assert.equal(player.hp, owner.hp); assert.equal(player.mp, owner.mp);
      }
      restored.cancelBattle(lease); assert.deepEqual(restored.snapshot(), expected);
      report.controlled.push({ asset: asset.id, index, result: "executed-and-save-battle-projected", targets, publications });
    }
  }
  const all = [...report.sites, ...report.blocked], field = all.filter(site => site.domain === "field");
  assert.equal(all.filter(site => site.mnemonic === "RecoveryHP").length, 194);
  assert.equal(all.filter(site => site.mnemonic === "RecoveryMP").length, 146);
  assert.equal(field.filter(site => site.mnemonic === "RecoveryHP").length, 193);
  assert.equal(field.filter(site => site.mnemonic === "RecoveryMP").length, 145);
  assert.equal(report.blocked.length, 7);
  assert.ok(report.blocked.every(site => site.mnemonic === "RecoveryMP" && /MP count/.test(site.reason)));
  report.stages.push({ id: "source-all-operand-sites-classified", total: all.length, admittedScalar: report.sites.length, blockedCount: 7 });
  report.stages.push({ id: "shared-owned-scalar-state-and-ordered-presentation", calls: report.controlled.filter(call => call.result.startsWith("executed")).length });
  report.stages.push({ id: "absent-positive-owner-never-created", calls: report.controlled.filter(call => call.result === "absent-owner-rejected").length });
  report.stages.push({ id: "saved-state-and-next-battle-reuse-owned-resources" });
  report.result = "passed";
} catch (error) { report.result = "failed"; report.error = error.stack ?? String(error); throw error; }
finally { const bytes = JSON.stringify(report, null, 2) + "\n"; await writeFile(output, bytes);
  console.log(JSON.stringify({ result: report.result, scalar: report.sites.length, blocked: report.blocked.length,
    stages: report.stages.length, sha256: createHash("sha256").update(bytes).digest("hex") })); }
