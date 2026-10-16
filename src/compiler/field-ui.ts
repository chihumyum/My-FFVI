import { z } from "zod";
import { record } from "./content.js";
import { int32 } from "../core/script-integer.js";
import { parseFieldUiCommand, type FieldUiOp } from "../core/field-ui.js";
export const sourceFieldUiSelectors = ["UI非表示", "マップUI全て表示", "ミニマップ表示"] as const;
/** Exact facade operands; no title strings or parameter IDs are authored here. */
export function compileFieldUiInstruction(raw: unknown, messages: Record<string, unknown>): FieldUiOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1) throw new Error("Source Field UI requires MainCore type1");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (ints.some(value => value !== 0) || reals.some(value => value !== 0)) throw new Error("Unsupported source Field UI numeric operands");
  if (instruction.mnemonic === "ShowMapTitle") {
    if (strings.slice(2).some(value => value !== "")) throw new Error("Unsupported source map title trailing operands");
    const table = record(messages.system_zhc ?? {}), text = (id: string): string => {
      if (id === "") return "";
      const value = table[id]; if (typeof value !== "string") throw new Error("Missing localized map title " + id); return value;
    };
    return { kind: "source-field-ui", command: parseFieldUiCommand({ kind: "title",
      location: { areaId: strings[0]!, locationId: strings[1]! }, area: text(strings[0]!), title: text(strings[1]!) }) };
  }
  if (instruction.mnemonic !== "SysCall" || strings.slice(1).some(value => value !== "")) throw new Error("Unsupported source Field UI selector operands");
  const kind = ({ "UI非表示": "event", "マップUI全て表示": "all", "ミニマップ表示": "minimap" } as const)[strings[0] as typeof sourceFieldUiSelectors[number]];
  if (!kind) throw new Error("Unknown source Field UI selector");
  return { kind: "source-field-ui", command: { kind } };
}
