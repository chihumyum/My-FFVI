// Source operands in a deterministic message owner. These are call-site and
// controlled-clock probes, not scene reachability or original runtime evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"),
  module = name => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href),
  sha = bytes => createHash("sha256").update(bytes).digest("hex");
const { loadCorpus } = await module("compiler/corpus"),
  { hash } = await module("compiler/content"),
  { compileSourceMessageInstruction, compileSourceMessageDocument } = await module("compiler/source-message"),
  { decodeFieldOp } = await module("compiler/field"),
  { SourceMessageState, sourceMessageUpdateMask, SOURCE_MESSAGE_WEB_LINE_LIMIT } = await module("core/source-message");
const output = root + "build/reports/source-message-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-source-message-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/source-message-native-check.json"),
  native = JSON.parse(nativeBytes), corpus = await loadCorpus(root);
assert.equal(corpus.manifest.sources.find(s => s.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
assert.equal(native.semanticsVerified, false);
const calls = [], blocked = [], probes = [];
let msgs = 0, closes = 0;
for (const asset of corpus.assets.filter(a => a.kind === "script")) {
  for (const [index, raw] of (asset.data.Mnemonics ?? []).entries()) {
    if (!["Msg", "MsgClose"].includes(raw.mnemonic)) continue;
    raw.mnemonic === "Msg" ? msgs++ : closes++;
    const site = { script: asset.data.Name, index, source: { ...asset.source, pointer: `/Mnemonics/${index}` } };
    let op;
    try { op = compileSourceMessageInstruction(raw, corpus.messages); }
    catch (error) { blocked.push({ ...site, mnemonic: raw.mnemonic, reason: error.message }); continue; }
    assert.deepEqual(decodeFieldOp(raw, site, corpus.messages, corpus.tables), { ...site, ...op }, "shared field dispatch");
    const owner = new SourceMessageState(), tx = owner.prepare(op);
    assert.equal(tx.flow, "next"); assert.equal(owner.active, false);
    assert.equal(tx.effects[0].invokeCallback, false);
    assert.equal(sourceMessageUpdateMask(tx.effects[0].group), op.command.kind === "play" ? 9 : 3);
    tx.commit(); assert.throws(() => tx.commit(), /Stale/);
    if (op.command.kind === "play") {
      assert.equal(owner.projection.text, ""); owner.advance(.01);
      assert.equal(owner.projection.text, op.command.document.text);
      assert.equal(owner.confirm(), false);
      assert.throws(() => SourceMessageState.restore(owner.snapshot()), /Active/);
      owner.advance(.01);
      if (op.command.document.tailWaitSeconds !== null) {
        assert.equal(owner.projection.phase, "time-wait");
        owner.advance(op.command.document.tailWaitSeconds);
        assert.equal(owner.projection.phase, "playing"); owner.advance(0);
      }
      assert.equal(owner.projection.phase, "input-wait"); owner.advance(.3);
      assert.equal(owner.projection.phase, "finished"); assert.equal(owner.active, true);
      const close = owner.prepare({ kind: "source-message", command: { kind: "close" } });
      assert.equal(sourceMessageUpdateMask(close.effects[0].group), 3); close.commit();
      assert.equal(owner.active, false); owner.advance(100); assert.equal(owner.projection, null);
      assert.deepEqual(SourceMessageState.restore(owner.snapshot()).snapshot(), owner.snapshot());
      probes.push({ site, kind: "source-document-through-owned-clock-and-explicit-close", pass: true });
    } else { assert.equal(owner.active, false); probes.push({ site, kind: "source-close-empty-window", pass: true }); }
    calls.push({ ...site, mnemonic: raw.mnemonic, instructionHash: hash(raw), opHash: hash(op),
      command: op.command.kind, ...(op.command.kind === "play" ? {
        key: op.command.key, layout: op.command.layout, textHash: hash(op.command.document.text),
        explicitLineLengths: op.command.document.text.split("\n").map(s => s.length),
        tailWaitSeconds: op.command.document.tailWaitSeconds,
      } : {}) });
  }
}
assert.equal(msgs, 4838); assert.equal(closes, 55);
assert.ok(calls.some(c => c.script === "sc_e_0001" && c.index === 13 && c.command === "play"));
const opening = corpus.assets.find(a => a.kind === "script" && a.data.Name === "sc_e_0001");
assert.ok(opening);
const openingPlay = compileSourceMessageInstruction(opening.data.Mnemonics[13], corpus.messages),
  openingClose = compileSourceMessageInstruction(opening.data.Mnemonics[16], corpus.messages);
assert.equal(openingPlay.command.seconds, -1); assert.equal(openingPlay.command.document.tailWaitSeconds, 63.75);
assert.equal(opening.data.Mnemonics[14].mnemonic, "Wait"); assert.equal(opening.data.Mnemonics[14].operands.rValues[0], 10.3);
assert.equal(opening.data.Mnemonics[15].mnemonic, "FadeOut");
const interrupted = new SourceMessageState(); interrupted.prepare(openingPlay).commit();
interrupted.advance(.01); interrupted.advance(.01); interrupted.advance(11);
assert.equal(interrupted.projection.phase, "time-wait"); interrupted.prepare(openingClose).commit();
assert.equal(interrupted.active, false);
const controls = [];
for (const [suffix, seconds] of [["", 1], ["00", 1], ["01", .25], ["0a", 2.5], ["2a", 10.5], ["ff", 63.75]]) {
  assert.equal(compileSourceMessageDocument(`Controlled<WAIT${suffix}><AUTO_P>`).tailWaitSeconds, seconds);
  controls.push({ suffix, seconds, pass: true });
}
for (const text of ["Controlled<WAITFF><AUTO_P>", "Controlled<WAIT17><AUTO_P>", "a<WAIT01>b<AUTO_P>",
  "a<P>b<AUTO_P>", "a<PRESS><AUTO_P>", "<NAME_A><AUTO_P>", "a\\nb\\nc\\nd\\ne<AUTO_P>"])
  assert.throws(() => compileSourceMessageDocument(text));
assert.equal(SOURCE_MESSAGE_WEB_LINE_LIMIT, 20);
assert.throws(() => compileSourceMessageDocument("a".repeat(21) + "<AUTO_P>"));
assert.throws(() => compileSourceMessageDocument("e\u0301<AUTO_P>"));
const bundle = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/key_common_assets_all_c47dc8306c9361968829d13bc5e038ce.bundle";
const bundleRow = corpus.manifest.sources.find(s => s.file === bundle); assert.ok(bundleRow);
assert.equal(sha(await readFile(root + "build/runtime/game/" + bundle)), bundleRow.sha256);
const prefab = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", String.raw`import sys,json,UnityPy
from pathlib import Path
p=Path(sys.argv[1]);e=UnityPy.load(str(p));os={str(o.path_id):o for o in e.objects}
def tree(id):return os[id].read_typetree()
def script(t):return tree(str(t['m_Script']['m_PathID']))['m_ClassName']
c=tree('2863099638072562845');v=tree(str(c['view']['m_PathID']))
assert script(c)=='MessageWindowController' and script(v)=='MessageWindowView'
actual=tree(str(v['messageText']['m_PathID']));dummy=tree(str(v['dummyMessageText']['m_PathID']))
assert actual['m_FontData']['m_FontSize']==40 and dummy['m_FontData']['m_FontSize']==40
assert tree('3732488645919057688')['m_SizeDelta']['x']==1144
assert tree('-834915155740084059')['m_SizeDelta']['x']==-144
print(json.dumps(dict(controllerObjectId='2863099638072562845',viewObjectId=str(c['view']['m_PathID']),
 newLineCount=c['newLineCount'],fontSize=40,baseTextWidth=1000,fontSelectorType=tree('1127470746122131110')['type'],
 dummyHorizontalOverflow=dummy['m_FontData']['m_HorizontalOverflow'],isCenterFit=c['isCenterFit'])))`,
  root + "build/runtime/game/" + bundle], { encoding: "utf8" }));
assert.equal(prefab.newLineCount, 4); assert.equal(prefab.isCenterFit, 0); assert.equal(prefab.fontSelectorType, 2);
const report = { lane: "source-message-controlled-owner", sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash, nativeReportSha256: sha(nativeBytes),
  nativeSha256: native.nativeSha256, corpus: { Msg: msgs, MsgClose: closes },
  admitted: { Msg: calls.filter(c => c.command === "play").length, MsgClose: calls.filter(c => c.command === "close").length },
  calls, blocked, probes, controls, openingIndependentWaitAndClose: true,
  layoutAdmission: { kind: "web-capability-limit", maximumExplicitLines: 4, maximumBmpCharactersPerLine: 20,
    nativeWrapRule: false, runtimeFontMetricsVerified: false },
  uiPrefab: { file: bundle, sha256: bundleRow.sha256, ...prefab },
  semanticsVerified: false, originalGameExecuted: false, browserPixelVerified: false,
  doesNotEstablish: ["native dynamic parity", "original font or pixel parity", "formal story reachability", "all message families"] };
const bytes = JSON.stringify(report, null, 2) + "\n"; await writeFile(output, bytes);
console.log(JSON.stringify({ admitted: report.admitted, blocked: blocked.length, controlledProbes: probes.length,
  reportSha256: sha(bytes), semanticsVerified: false }));
