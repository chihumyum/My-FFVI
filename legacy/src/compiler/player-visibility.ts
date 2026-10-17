import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import type { PlayerVisibilityFactory, PlayerVisibilityOp } from "../core/player-visibility.js";
export type { PlayerVisibilityFactory } from "../core/player-visibility.js";
import { record } from "./content.js";

export const playerVisibilityMnemonics = ["HidePlayer", "ShowPlayer"] as const;

/** Complete version-bound factory chain, not a heuristic based on missing JSON
 * fields. check-player-visibility-native verifies prefab hierarchy/serialization,
 * all managed constructors, Awake, virtual InitInstance and the actual controller
 * assignment. Unknown binaries or prefab contents need independent recovery. */
export function compilePlayerVisibilityFactory(sources: readonly { file: string; sha256: string }[]): PlayerVisibilityFactory {
  const required = [
    { file: "GameAssembly.dll", sha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc" },
    { file: "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle",
      sha256: "82befd5fd3adeed5c8055c90a9aa3b8a09837be9094f9677d33ead3cbf3a0daa" },
  ];
  if (!Array.isArray(sources)) throw new Error("Missing player factory source manifest");
  for (const expected of required) {
    const found = sources.filter((source) => source.file === expected.file);
    if (found.length !== 1 || found[0]!.sha256 !== expected.sha256)
      throw new Error(`Unreviewed player factory source: ${expected.file}`);
  }
  return { factory: "native-field-player-v1", capability: { childEntityObject: "absent" },
    sources: required.map((source) => ({ ...source })) };
}

/** Both native wrappers ignore MainCore and have no actor/operand selection.
 * Admit the exact observed instruction shape; an extra operand is not granted
 * an invented duration, target, party scope or conditional visibility meaning. */
export function compilePlayerVisibilityInstruction(raw: unknown): PlayerVisibilityOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1 ||
      (instruction.mnemonic !== "HidePlayer" && instruction.mnemonic !== "ShowPlayer"))
    throw new Error("Expected source player visibility instruction");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (ints.some((value) => value !== 0) || reals.some((value) => value !== 0) ||
      strings.some((value) => value !== ""))
    throw new Error("Unsupported source player visibility operand shape");
  return {
    kind: "player-visibility",
    command: { kind: instruction.mnemonic === "HidePlayer" ? "hide-player" : "show-player" },
  };
}
