// Read-only static binding to this supplied build. No Ghidra or game process.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
const symbolsText = await readFile(root + "build/native/il2cpp/script.json", "utf8");
const header = await readFile(root + "build/native/il2cpp/il2cpp_ghidra.h", "utf8");
assert.equal(digest(await readFile(root + "build/runtime/game/GameAssembly.dll")), identity.nativeSha256);
assert.equal(digest(symbolsText), identity.symbolsSha256);
assert.equal(digest(header), identity.headerSha256);
const symbols = JSON.parse(symbolsText), addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const methods = [
  [0x979f20, "Last.Battle.Function.BattleFunction17$$HitCalc"],
  [0x97a3a0, "Last.Battle.Function.BattleFunction17$$UpdateParameter"],
  [0x97a790, "Last.Battle.Function.BattleFunction17$$ViewEntity"],
  [0x97a1d0, "Last.Battle.Function.BattleFunction17$$IsFunctionEnd"],
  [0x764400, "Last.Battle.BattleUtility$$GetChangeCorpsId"],
  [0x986120, "Last.Battle.Function.BattleFunction17.<>c__DisplayClass2_0$$<UpdateParameter>b__0"],
  [0x92f8f0, "Last.Battle.Function.BattleFunction17.<>c$$<IsFunctionEnd>b__4_0"],
  [0x491670, "Last.Data.User.Corps$$get_Id"],
  [0x529d60, "Last.Data.User.Corps$$set_Id"],
  [0x501c70, "Last.Battle.FixedStatusInfo$$SaveCorpList"],
].map(([rva, name]) => {
  const matches = symbols.ScriptMethod.filter((m) => m.Address === rva && m.Name === name);
  assert.equal(matches.length, 1, name);
  return { rva, name, signature: matches[0].Signature, size: addresses.find((a) => a > rva) - rva };
});
const python = `import json,sys,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=Cs(CS_ARCH_X86,CS_MODE_64)
ranges=[];ins={}
for m in json.load(sys.stdin):
 section,offset,data=p.read(m['rva'],m['size'])
 decoded=list(cs.disasm(data,0x180000000+m['rva']))
 ins.update({i.address-0x180000000:(i.mnemonic,i.op_str) for i in decoded})
 ranges.append(dict(**m,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))
def require(rva,mnemonic,operands):
 assert ins[rva]==(mnemonic,operands),(hex(rva),ins[rva])
# Actual target kind drives the separate single-member/self branch.
require(0x97a422,'mov','eax, dword ptr [rcx + 0x78]')
require(0x97a425,'cmp','eax, 1')
require(0x97a42e,'cmp','eax, 6')
require(0x97a428,'je','0x18097a6ae')
require(0x97a431,'je','0x18097a6ae')
require(0x97a6ff,'mov','rbx, qword ptr [rsi + 0x60]')
require(0x97a70d,'call','0x180491670')
require(0x97a736,'call','0x180764400')
require(0x97a743,'call','0x180529d60')
# The helper maps front1 to back2, every other value to1; Web admits only1/2.
assert p.read(0x764400,15)[2].hex()=='b8010000003bc87505b802000000c3'
# ViewEntity reads the newly committed Corps and chooses standing state5/6.
require(0x97a836,'call','0x180491670')
require(0x97a83b,'cmp','eax, 1')
require(0x97a840,'lea','edx, [rax + 4]')
require(0x97a854,'cmp','eax, 2')
require(0x97a859,'lea','edx, [rax + 4]')
require(0x97a849,'call','0x1807619a0')
require(0x97a862,'call','0x1807619a0')
# Completion waits for the standing-state idle predicate.
require(0x92f901,'call','0x180760c80')
require(0x92f90b,'cmp','dword ptr [rax + 0x30], 0')
# HitCalc calls provider GetFixedStatus(0), like the separately recovered Defend.
require(0x97a109,'mov','r8d, 0xd')
require(0x97a11e,'xor','edx, edx')
# SaveCorpList copies each battle Corps row back through the current-slot owner.
require(0x501cb5,'call','0x180aa9d90')
require(0x501d72,'call','0x180491670')
require(0x501d7f,'mov','r8d, eax')
require(0x501d82,'mov','edx, ebx')
require(0x501d87,'call','0x180aabbb0')
print(json.dumps(ranges))`;
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify(methods), encoding: "utf8",
}));
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
for (const text of ["private Corps <corps>k__BackingField; // 0x60", "private CorpsSaveData saveData; // 0x10",
  "private BattleActData.TargetType <CurrentTargetType>k__BackingField; // 0x78",
  "BattleActData.TargetType SingleMember = 1", "BattleActData.TargetType Self = 6",
  "AnimStateController.StandingState CorpsFront = 5", "AnimStateController.StandingState CorpsBack = 6",
  "private AnimStateController.StandingState currentStandingState; // 0x30"])
  assert.ok(dump.includes(text), text);
const receipt = JSON.parse(await readFile(root + "build/native/ability-providers/complete.json", "utf8"));
assert.equal(receipt.status, "complete");
for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value);
const provider = receipt.methods.find((method) => method.rva === "0x342080");
const c = await readFile(root + "build/native/ability-providers/342080.c", "utf8");
assert.equal(digest(c), provider.decompiledSha256);
assert.match(c, /case 0x11:[\s\S]*?BattleFunction17_TypeInfo/);
const report = { kind: "battle-row-change-native-check-v1", ...identity, ranges,
  reusedProvider: { batch: "ability-providers", ...provider },
  source: { commandId: 5, abilityId: 4, functionType: 17, sourceSelfTargetType: 6 },
  semanticsVerified: false, originalGameExecuted: false,
  establishes: ["Function17 ordinary self path mutates Corps.Id through native getter/setter",
    "SaveCorpList transfers battle Corps rows by index to CorpsClient.SwitchByIndex", "standing5/6 uses the new row; completion waits for standing idle"],
  limitations: ["Native process was not run", "multi-target/non-target Corps branch is not admitted",
    "Web uses its existing 400/900ms action presentation, not original animation timing"] };
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/battle-row-change-native-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ rawMethods: ranges.length, reusedMethods: 1, semanticsVerified: false,
  reportSha256: digest(JSON.stringify(report)) }, null, 2));
