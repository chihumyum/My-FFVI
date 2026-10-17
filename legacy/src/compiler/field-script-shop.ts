import { z } from "zod";
import { record } from "./content.js";
import { int32 } from "../core/script-integer.js";
import type { FieldScriptShopOp } from "../core/field-script-shop.js";

// Exact callback bindings of this source build; raw registration and wrapper
// constants are rechecked by check-source-shop-native.mjs. No map-ID dispatch.
const bindings = [
  {
    "selector": "ショップを開く:サウスフィガロの町(崩壊後)アクセサリー屋",
    "groupId": 66
  },
  {
    "selector": "ショップを開く:サウスフィガロの町(崩壊後_エドガー先頭)アクセサリー屋",
    "groupId": 91
  },
  {
    "selector": "ショップを開く:サウスフィガロの町(崩壊後)武器屋",
    "groupId": 64
  },
  {
    "selector": "ショップを開く:サウスフィガロの町(崩壊後_エドガー先頭)武器屋",
    "groupId": 89
  },
  {
    "selector": "ショップを開く:サウスフィガロの町(崩壊後)防具屋",
    "groupId": 65
  },
  {
    "selector": "ショップを開く:サウスフィガロの町(崩壊後_エドガー先頭)防具屋",
    "groupId": 90
  },
  {
    "selector": "ショップを開く:サウスフィガロの町(崩壊後)道具屋",
    "groupId": 67
  },
  {
    "selector": "ショップを開く:サウスフィガロの町(崩壊後_エドガー先頭)道具屋",
    "groupId": 92
  },
  {
    "selector": "ショップを開く:フィガロ城(初期)道具屋_右",
    "groupId": 1
  },
  {
    "selector": "ショップを開く:フィガロ城(初期)道具屋_左",
    "groupId": 2
  },
  {
    "selector": "ショップを開く:フィガロ城(城移動可能後)道具屋_右",
    "groupId": 22
  },
  {
    "selector": "ショップを開く:フィガロ城(城移動可能後)道具屋_左",
    "groupId": 23
  },
  {
    "selector": "ショップを開く:フィガロ城(崩壊後)道具屋_右",
    "groupId": 68
  },
  {
    "selector": "ショップを開く:フィガロ城(崩壊後)道具屋_左",
    "groupId": 69
  },
  {
    "selector": "ショップを開く:フィガロ城(初期_エドガー先頭)道具屋_右",
    "groupId": 83
  },
  {
    "selector": "ショップを開く:フィガロ城(初期_エドガー先頭)道具屋_左",
    "groupId": 84
  },
  {
    "selector": "ショップを開く:フィガロ城(城移動可能後_エドガー先頭)道具屋_右",
    "groupId": 85
  },
  {
    "selector": "ショップを開く:フィガロ城(城移動可能後_エドガー先頭)道具屋_左",
    "groupId": 86
  },
  {
    "selector": "ショップを開く:フィガロ城(崩壊後_エドガー先頭)道具屋_右",
    "groupId": 87
  },
  {
    "selector": "ショップを開く:フィガロ城(崩壊後_エドガー先頭)道具屋_左",
    "groupId": 88
  },
  {
    "selector": "ショップを開く:モブリズの村(武器屋)",
    "groupId": 10
  },
  {
    "selector": "ショップを開く:モブリズの村(防具屋)",
    "groupId": 11
  },
  {
    "selector": "ショップを開く:モブリズの村(アクセサリー屋)",
    "groupId": 12
  },
  {
    "selector": "ショップを開く:モブリズの村(道具屋)",
    "groupId": 13
  },
  {
    "selector": "ショップを開く:一軒家_行商",
    "groupId": 8
  }
] as const;
export const fieldScriptShopSelectors: readonly string[] = Object.freeze(bindings.map(row => row.selector));

export function compileFieldScriptShopInstruction(raw: unknown): FieldScriptShopOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1 || instruction.mnemonic !== "SysCall")
    throw new Error("Unsupported source script shop instruction");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (ints.some(value => value !== 0) || reals.some(value => value !== 0) ||
      strings.slice(1).some(value => value !== ""))
    throw new Error("Unsupported source script shop reserved operands");
  const binding = bindings.find(row => row.selector === strings[0]);
  if (!binding) throw new Error("Unbound source script shop callback");
  return { kind: "field-script-shop", selector: binding.selector, groupId: binding.groupId };
}
