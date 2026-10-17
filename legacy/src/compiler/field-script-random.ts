import { z } from "zod";
import { record } from "./content.js";
import { int32 } from "../core/script-integer.js";
import { validateScriptRandomCommand, type FieldScriptRandomOp, type FieldScriptRandomCommand } from "../core/field-script-random.js";
/** Misc.SetRandomValue reads s0 through the exact DataStorage tag dictionary,
 * i0 as destination index and Range(1, int32(i1+1)). Only observed banks and
 * non-overflowing positive bounds are admitted. Reserved fields stay gated. */
export function compileFieldScriptRandomInstruction(raw: unknown): FieldScriptRandomOp {
  const op=record(raw),o=record(op.operands);
  if(op.mnemonic!=="SetRandomValue"||op.type!==1)throw new Error("Unsupported source script random instruction");
  const i=z.array(z.unknown()).length(8).parse(o.iValues).map(int32),
    r=z.array(z.number().finite()).length(8).parse(o.rValues),s=z.array(z.string()).length(8).parse(o.sValues);
  if(i.slice(2).some(x=>x!==0)||r.some(x=>x!==0)||s.slice(1).some(x=>x!==""))
    throw new Error("Unsupported source script random reserved operands");
  if(s[0]!=="MapLocalVariable"&&s[0]!=="AreaLocalVariable")throw new Error("Unsupported source script random destination bank");
  const command: FieldScriptRandomCommand={target:{category:s[0],index:i[0]!},upperInclusive:i[1]!};validateScriptRandomCommand(command);
  return{kind:"script-random",command};
}
