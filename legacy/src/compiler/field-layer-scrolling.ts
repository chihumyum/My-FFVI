import { z } from "zod";
import { record } from "./content.js";
import { int32 } from "../core/script-integer.js";
import { parseFieldLayerCommand, type FieldLayerCommand, type FieldLayerOp } from "../core/field-layer-scrolling.js";
/** Exact registered facade arguments. Native callbacks/static sequences that
 * have not been recovered stay blocked in this same whole-source family. */
const selectors: Record<string, FieldLayerCommand | string> = {
  "全レイヤーのスクロールリセット": {"kind": "reset"},
  "レイヤースクロール：フィガロ城": {"kind": "apply", "mask": 1, "actions": [{"kind": "velocity", "layer": 0, "x": 0, "y": -32}]},
  "レイヤースクロール：砂漠": {"kind": "apply", "mask": 1, "actions": [{"kind": "velocity", "layer": 0, "x": 48, "y": 0}]},
  "レイヤースクロール：砂漠停止": {"kind": "apply", "mask": 1, "actions": [{"kind": "velocity", "layer": 0, "x": 0, "y": 0}]},
  "レイヤースクロール：EV": {"kind": "apply", "mask": 7, "actions": [{"kind": "velocity", "layer": 0, "x": 0, "y": -48}, {"kind": "velocity", "layer": 1, "x": 0, "y": -48}, {"kind": "velocity", "layer": 2, "x": 0, "y": -48}]},
  "レイヤースクロール：切り離し": {"kind": "tween", "mask": 9, "layers": [0, 3], "axis": "x", "from": 0, "to": -170, "seconds": 6, "easing": "in-cubic", "end": -320},
  "レイヤースクロール：中断30440_1": {"kind": "apply", "mask": 9, "actions": [{"kind": "offset", "layer": 0, "x": -300, "y": 0}, {"kind": "offset", "layer": 3, "x": -300, "y": 0}]},
  "レイヤースクロール：停車準備": {"kind": "apply", "mask": 3, "actions": [{"kind": "offset", "layer": 0, "x": -400, "y": 0}, {"kind": "offset", "layer": 1, "x": -400, "y": 0}]},
  "レイヤースクロール：停車": {"kind": "tween", "mask": 3, "layers": [0, 1], "axis": "x", "from": -450, "to": 224, "seconds": 12.8, "easing": "out-cubic"},
  "レイヤースクロール：停車中": {"kind": "apply", "mask": 3, "actions": [{"kind": "offset", "layer": 0, "x": 224, "y": 0}, {"kind": "offset", "layer": 1, "x": 224, "y": 0}]},
  "レイヤースクロール：発車": "Source train static phase/easing sequence is unresolved",
  "レイヤースクロール：中断30450": {"kind": "apply", "mask": 3, "actions": [{"kind": "velocity", "layer": 0, "x": 0, "y": 0}, {"kind": "velocity", "layer": 1, "x": 0, "y": 0}, {"kind": "offset", "layer": 0, "x": 2000, "y": 0}, {"kind": "offset", "layer": 1, "x": 2000, "y": 0}]},
  "レイヤースクロール：バレンの滝１": {"kind": "apply", "mask": 6, "actions": [{"kind": "velocity", "layer": 1, "x": 0, "y": 25}, {"kind": "velocity", "layer": 2, "x": 0, "y": 25}]},
  "レイヤースクロール：バレンの滝２": {"kind": "apply", "actions": [{"kind": "velocity", "layer": 1, "x": 0, "y": 60}, {"kind": "velocity", "layer": 2, "x": 0, "y": 60}]},
  "レイヤースクロール：バレンの滝停止": {"kind": "apply", "actions": [{"kind": "velocity", "layer": 1, "x": 0, "y": 0}, {"kind": "velocity", "layer": 2, "x": 0, "y": 0}]},
  "レイヤースクロール：ブラックジャック１": {"kind": "apply", "mask": 1, "actions": [{"kind": "velocity", "layer": 0, "x": 8, "y": 32}]},
  "レイヤースクロール：ブラックジャック２": {"kind": "apply", "mask": 1, "actions": [{"kind": "velocity", "layer": 0, "x": 8, "y": 60}]},
  "レイヤースクロール：ゾーンイータ―（落とす）": {"kind": "tween", "mask": 4, "layers": [2], "axis": "y", "from": -128, "to": 0, "seconds": 0.35, "easing": "linear"},
  "レイヤースクロール：ゾーンイータ―（上げる）": {"kind": "tween", "mask": 4, "layers": [2], "axis": "y", "from": 0, "to": -128, "seconds": 1.4, "easing": "linear"},
  "レイヤースクロール：ゾーンイータ―（初期化）": {"kind": "apply", "mask": 4, "actions": [{"kind": "offset", "layer": 2, "x": 0, "y": -128}]},
  "レイヤースクロール：モブリズの村崩落": "Source scenery timer callbacks are unresolved",
  "レイヤースクロール：魔大陸出現": "Source scenery timer callbacks are unresolved",
  "レイヤースクロール：魔大陸脱出地割れ": "Source scenery timer callbacks are unresolved",
  "レイヤースクロール：魔大陸脱出コルツ山": {"kind": "apply", "actions": [{"kind": "offset", "layer": 0, "x": 0, "y": -100}, {"kind": "velocity", "layer": 0, "x": 0, "y": -28}]},
  "レイヤースクロール：魔大陸脱出レテ川": "Source scenery timer callback is unresolved",
  "近景１：表示": {"kind": "apply", "actions": [{"kind": "show", "id": 1, "scenery": 3, "seconds": 0}]},
  "背景変更：飛空艇（通常）": {"kind": "apply", "actions": [{"kind": "show", "id": 1, "scenery": 1, "seconds": 0}, {"kind": "hide", "id": 2, "scenery": 1, "seconds": 0}, {"kind": "hide", "id": 3, "scenery": 1, "seconds": 0}]},
  "背景変更：飛空艇（特殊）": {"kind": "apply", "actions": [{"kind": "show", "id": 2, "scenery": 1, "seconds": 0}, {"kind": "hide", "id": 1, "scenery": 1, "seconds": 0}, {"kind": "hide", "id": 3, "scenery": 1, "seconds": 0}]},
  "背景変更：飛空艇（黒）": {"kind": "apply", "actions": [{"kind": "show", "id": 3, "scenery": 1, "seconds": 0}, {"kind": "hide", "id": 1, "scenery": 1, "seconds": 0}, {"kind": "hide", "id": 2, "scenery": 1, "seconds": 0}]},
  "背景変更：北の崖FO": {"kind": "apply", "actions": [{"kind": "hide", "id": 1, "scenery": 1, "seconds": 0.699999988079071}]},
  "瓦礫の塔頂上背景変更：すべて消去": {"kind": "apply", "actions": [{"kind": "hide", "id": 1, "scenery": 1, "seconds": 0}, {"kind": "hide", "id": 2, "scenery": 1, "seconds": 0}, {"kind": "hide", "id": 3, "scenery": 1, "seconds": 0}, {"kind": "hide", "id": 4, "scenery": 1, "seconds": 0}]},
  "瓦礫の塔頂上背景変更：通常を表示": {"kind": "apply", "actions": [{"kind": "show", "id": 1, "scenery": 1, "seconds": 0}]},
  "瓦礫の塔頂上背景変更：通常をフェードアウト": {"kind": "apply", "actions": [{"kind": "hide", "id": 1, "scenery": 1, "seconds": 1}]},
  "瓦礫の塔頂上背景変更：黒+青をフェードイン": {"kind": "apply", "actions": [{"kind": "show", "id": 2, "scenery": 1, "seconds": 2}]},
  "瓦礫の塔頂上背景変更：明るい1に変更": {"kind": "apply", "actions": [{"kind": "hide", "id": 2, "scenery": 1, "seconds": 0}, {"kind": "show", "id": 3, "scenery": 1, "seconds": 0}]},
  "瓦礫の塔頂上背景変更：明るい2を表示": {"kind": "apply", "actions": [{"kind": "show", "id": 4, "scenery": 1, "seconds": 0}]},
  "瓦礫の塔頂上背景変更：明るい2をフェードアウト": {"kind": "apply", "actions": [{"kind": "hide", "id": 4, "scenery": 1, "seconds": 1}, {"kind": "hide", "id": 1, "scenery": 3, "seconds": 1}]},
  "瓦礫の塔頂上背景変更：明るい2をフェードイン": {"kind": "apply", "actions": [{"kind": "show", "id": 4, "scenery": 1, "seconds": 1}, {"kind": "show", "id": 1, "scenery": 3, "seconds": 1}]},
  "瓦礫の塔頂上近景変更：雲表示": {"kind": "apply", "actions": [{"kind": "show", "id": 1, "scenery": 3, "seconds": 0}]},
  "瓦礫の塔頂上近景変更：雲消去": {"kind": "apply", "actions": [{"kind": "hide", "id": 1, "scenery": 3, "seconds": 0}]},
  "魔大陸遠景１のみ表示": {"kind": "apply", "actions": [{"kind": "show", "id": 1, "scenery": 1, "seconds": 0}, {"kind": "hide", "id": 2, "scenery": 1, "seconds": 0}]},
  "魔大陸遠景２のみ表示": {"kind": "apply", "actions": [{"kind": "show", "id": 2, "scenery": 1, "seconds": 0}, {"kind": "hide", "id": 1, "scenery": 1, "seconds": 0}]},
  "魔大陸遠景１フェードアウト": {"kind": "apply", "actions": [{"kind": "hide", "id": 1, "scenery": 1, "seconds": 1}]},
  "ファルコン号遠景４スクロール": {"kind": "apply", "actions": [{"kind": "scenery-velocity", "id": 4, "scenery": 1, "enabled": true, "x": 192, "y": 0}]},
  "瓦礫の塔近景１スクロール": {"kind": "apply", "actions": [{"kind": "scenery-velocity", "id": 1, "scenery": 3, "enabled": true, "x": 0, "y": 192}]},
};
export const sourceFieldLayerSelectors = Object.freeze(Object.keys(selectors));
export function compileFieldLayerInstruction(raw: unknown): FieldLayerOp {
  const i=record(raw),o=record(i.operands);
  if(i.type!==1||i.mnemonic!=="SysCall")throw new Error("Source layer wrapper requires MainCore SysCall");
  const ints=z.array(z.unknown()).length(8).parse(o.iValues).map(int32),reals=z.array(z.number().finite()).length(8).parse(o.rValues),strings=z.array(z.string()).length(8).parse(o.sValues);
  if(ints.some(n=>n!==0)||reals.some(n=>n!==0)||strings.slice(1).some(s=>s!==""))throw new Error("Unsupported source layer wrapper operands");
  const command=selectors[strings[0]!];if(!command)throw new Error("Unknown source Field layer selector");if(typeof command==="string")throw new Error(command);
  return {kind:"field-layer-scrolling",command:parseFieldLayerCommand(command)};
}
