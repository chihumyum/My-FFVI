import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import {
  validateFieldChoice,
  type FieldChoiceAnchor,
  type FieldChoiceOp,
} from "../core/field-choice.js";
import { record } from "./content.js";

export type FieldChoiceCompileContext = {
  /** Immediate source instruction, before capability decoding. A blocked Msg
   * still retains the preceding window; an omitted context cannot prove that. */
  nextMnemonic: string | null;
};

const sourceAnchors: readonly FieldChoiceAnchor[] = [
  "bottom-right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];
const defaultKeys = ["SPEECH_IN_OPTION_YES", "SPEECH_IN_OPTION_NO"] as const;

function optionText(key: string, table: Record<string, unknown>): string {
  const text = table[key];
  if (!key || typeof text !== "string" || !text.length)
    throw new Error(`Missing localized field choice: ${key}`);
  if (/<|\\(?!n)|[\u0000-\u0009\u000b-\u001f\u007f]/.test(text))
    throw new Error(
      `Field choice contains an unsupported inline control: ${key}`,
    );
  return text.replaceAll("\\n", "\n");
}

/** External.Message.Select, RVA b4d7c0. This compiler binds options and ordinary
 * input behavior, not native UI geometry or keyboard-repeat frame timing. */
export function compileFieldChoiceInstruction(
  raw: unknown,
  messages: Record<string, unknown>,
  tables: Record<string, unknown>,
  context?: FieldChoiceCompileContext,
): FieldChoiceOp {
  const instruction = record(raw),
    operands = record(instruction.operands);
  if (instruction.mnemonic !== "Select" || instruction.type !== 1)
    throw new Error("Expected ordinary field Select instruction");
  const ints = z
      .array(z.unknown())
      .length(8)
      .parse(operands.iValues)
      .map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (
    ints.slice(3).some((value) => value !== 0) ||
    reals.some((value) => value !== 0) ||
    strings.slice(6).some((value) => value !== "")
  )
    throw new Error("Unsupported ordinary field Select operand shape");
  if (
    !context ||
    typeof context.nextMnemonic !== "string" ||
    !context.nextMnemonic
  )
    throw new Error("Select requires the following source mnemonic");
  // The native static default is UnderRight (4). Only positive i0 indexes its
  // [0,1,2,3,4] anchor array. i1 is not read by this version's Select method.
  const anchor = ints[0]! <= 0 ? sourceAnchors[0]! : sourceAnchors[ints[0]!];
  if (!anchor) throw new Error("Unsupported field choice anchor");
  let result: FieldChoiceOp;
  if (strings[0] === "") {
    if (strings.slice(1).some((value) => value !== ""))
      throw new Error(
        "Unsupported field choice labels after an empty first key",
      );
    if (ints[2] !== 0 && ints[2] !== 1)
      throw new Error("Invalid yes/no field choice initial index");
    const rows = z
        .array(z.unknown())
        .parse(tables["message_conclusion.csv"])
        .map(record),
      system = record(messages.system_zhc ?? {});
    const options = defaultKeys.map((name) => {
      const matches = rows.filter((row) => row.key_name === name);
      if (matches.length !== 1 || typeof matches[0]!.message_id !== "string")
        throw new Error(
          `Missing or ambiguous field choice message binding: ${name}`,
        );
      const key = matches[0]!.message_id as string;
      return { key, text: optionText(key, system) };
    });
    result = {
      kind: "choice",
      options,
      initialIndex: ints[2]!,
      cancelIndex: null,
      anchor,
      presentation: "yes-no",
      retainMessage: context.nextMnemonic === "Msg",
    };
  } else {
    const firstEmpty = strings.slice(0, 6).findIndex((value) => value === ""),
      length = firstEmpty < 0 ? 6 : firstEmpty;
    if (length < 2 || strings.slice(length, 6).some((value) => value !== ""))
      throw new Error(
        "Ordinary field choice requires two to six consecutive source options",
      );
    const story = record(messages.story_mes_zhc ?? {});
    result = {
      kind: "choice",
      options: strings
        .slice(0, length)
        .map((key) => ({ key, text: optionText(key, story) })),
      // Explicit labels always use MessageChoiceWindowManager and its initial
      // first option. The native call does not pass i0 or i2 to that manager.
      initialIndex: 0,
      cancelIndex: null,
      anchor: "bottom-center",
      presentation: "multiple",
      retainMessage: context.nextMnemonic === "Msg",
    };
  }
  validateFieldChoice(result);
  return result;
}
