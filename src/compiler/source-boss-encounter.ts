import { z } from "zod";
import { record } from "./content.js";
import { int32 } from "../core/script-integer.js";
import { parseSourceBossEncounterCommand, type SourceBossEncounterOp } from "../core/source-boss-encounter.js";

export function compileSourceBattleResultInstruction(raw: unknown): { kind: 'source-battle-result' } {
  const op=record(raw),args=record(op.operands);
  if(op.mnemonic!=='SysCall'||op.type!==1)throw new Error('Expected MainCore battle-result query');
  const i=z.array(z.unknown()).length(8).parse(args.iValues).map(int32),r=z.array(z.number().finite()).length(8).parse(args.rValues),s=z.array(z.string()).length(8).parse(args.sValues);
  if(i.some(v=>v!==0)||r.some(v=>v!==0)||s[0]!=='戦闘結果取得'||s.slice(1).some(v=>v!==''))throw new Error('Unassessed source battle-result operands');
  return {kind:'source-battle-result'};
}

/** Misc.EncountBoss b50ae0 -> CallEncount b4ebe0 -> b55750 ->
 * IEventAccessor.EventEncountBoss. Every original parameter stays in the IR;
 * this compiler does not grant an intro, a battle flag, or a battle result. */
export function compileSourceBossEncounterInstruction(raw: unknown): SourceBossEncounterOp {
  const op = record(raw), args = record(op.operands);
  if (op.mnemonic !== "EncountBoss" || op.type !== 1) throw new Error("Expected source MainCore EncountBoss");
  const i = z.array(z.unknown()).length(8).parse(args.iValues).map(int32),
    r = z.array(z.number().finite()).length(8).parse(args.rValues),
    s = z.array(z.string()).length(8).parse(args.sValues);
  if (i.slice(3).some(v => v !== 0) || r.some(v => v !== 0) || s.slice(1).some(v => v !== ""))
    throw new Error("Unassessed source Boss reserved operands");
  return { kind: "source-boss-encounter", command: parseSourceBossEncounterCommand({ kind: "source-boss-encounter",
    partyId: i[0], focusCell: { x: i[1], y: i[2] }, continuation: s[0] }) };
}
