import { z } from "zod";
import type {
  EventScriptTransitionMetadata,
  EventScriptTransitionOp,
} from "../core/event-script-transition.js";
import { int32 } from "../core/script-integer.js";
import { hash, canonical, record } from "./content.js";
import type { SourceScriptAnimationCatalog } from "../core/source-script-animations.js";

/** Only the complete source Format.type=1 form is admitted. Resolution belongs
 * to the current map's script aliases, not a global name search in this decoder. */
export function compileEventScriptTransitionInstruction(
  raw: unknown,
): EventScriptTransitionOp {
  const instruction = record(raw);
  if (instruction.mnemonic !== "ChangeScript" || instruction.type !== 1)
    throw new Error("Unsupported ChangeScript instruction type or mnemonic");
  const operands = record(instruction.operands),
    ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (
    ints.slice(1).some((value) => value !== 0) ||
    reals.some((value) => value !== 0) ||
    strings.slice(1).some((value) => value !== "")
  )
    throw new Error("Unsupported ChangeScript reserved operands");
  if (strings[0] === "") throw new Error("ChangeScript requires a target script name");
  return {
    kind: "script-transition",
    targetScript: strings[0]!,
    // External.Misc.ChangeScript passes i0 != 0, not i0 == 1.
    returnToCaller: ints[0] !== 0,
  };
}

/** ChangeScript replaces the CustomAnimAsset wrapper even though it retains
 * root SystemFlags and field hosts. Only an explicitly empty source asset list
 * is currently supported; missing metadata cannot stand in for an empty list. */
export function compileEventScriptTransitionMetadata(
  rawScript: unknown,
  imported?: { catalog: SourceScriptAnimationCatalog; assetId: string },
): EventScriptTransitionMetadata {
  const script = record(rawScript);
  if (!Array.isArray(script.Animations))
    throw new Error("Missing or invalid ChangeScript custom animation metadata");
  if (script.Animations.length !== 0) {
    const asset=imported?.catalog.assets[imported.assetId];
    if(!asset||asset.rawScriptHash!==hash(rawScript)||canonical(asset.animations)!==canonical(script.Animations))
      throw new Error("ChangeScript custom animation assets require a source provider");
    return {customAnimations:"source-script-custom-animations-v1",assetId:asset.id,
      catalogHash:imported!.catalog.contentHash,rawScriptHash:asset.rawScriptHash};
  }
  return { customAnimations: "none" };
}
