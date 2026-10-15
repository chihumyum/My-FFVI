import { record } from "./content.js";
import { int32 } from "../core/script-integer.js";
import type { FieldPuppetRouteOp } from "../core/field-puppet-route.js";

function data(value: unknown): Record<string, unknown> {
  const result = record(value);
  if (![Object.prototype, null].includes(Object.getPrototypeOf(result)) ||
      Reflect.ownKeys(result).some(key => typeof key !== "string") ||
      Object.values(Object.getOwnPropertyDescriptors(result)).some(d => !d.enumerable || !("value" in d)))
    throw new Error("Puppet Route requires plain operand data");
  return result;
}
function tuple(raw: unknown): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype ||
      raw.length !== 8 || Reflect.ownKeys(raw).length !== 9)
    throw new Error("Puppet Route requires complete dense operand arrays");
  return Array.from({ length: 8 }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new Error("Puppet Route requires data operand arrays");
    return descriptor.value;
  });
}
/** Coordinate/path-search Puppet.Route is distinct from External.AssignMoveRoute. */
export function compileFieldPuppetRouteInstruction(raw: unknown): FieldPuppetRouteOp {
  const instruction = data(raw);
  if (instruction.type !== 2 || instruction.mnemonic !== "Route")
    throw new Error("Expected source Puppet Route instruction");
  const operands = data(instruction.operands);
  if (Object.keys(operands).sort().join(",") !== "iValues,rValues,sValues")
    throw new Error("Unsupported Puppet Route operand fields");
  const ints = tuple(operands.iValues).map(int32), reals = tuple(operands.rValues), strings = tuple(operands.sValues);
  if (ints.slice(4).some(value => value !== 0) || reals.some(value => value !== 0) ||
      strings.some(value => typeof value !== "string") || strings.slice(1).some(value => value !== ""))
    throw new Error("Unsupported Puppet Route reserved operands");
  if (ints[2]! < 0 || ints[2]! > 3 || ints[3]! > 6)
    throw new Error("Unsupported Puppet Route layer or speed selector");
  return { kind: "field-puppet-route", command: { x: ints[0]!, y: ints[1]!,
    layer: ints[2] as 0 | 1 | 2 | 3, speedId: ints[3]! < 0 ? null : ints[3]!, animation: strings[0] as string } };
}
