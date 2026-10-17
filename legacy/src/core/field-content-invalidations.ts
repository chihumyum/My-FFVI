import type { FieldContent, Site } from "../field/types.js";
import type { BattleEntryCatalog } from "./battle-entry.js";
import { canonical } from "./canonical.js";
import { checkpointInteger } from "./checkpoint-validation.js";

/** External.Telepo.InvalidateTelepo normalizes i0==0 to InvalidAll(0),
 * every other signed value to InvalidTelepo(2). It never passes EnableAll(1).
 * Both branches only ADD to normal/savepoint lists; transportation is unchanged. */
export type FieldContentInvalidationCommand = { kind: "add-moving"; invalidType: 0 | 2 };
export type FieldContentInvalidationOp = { kind: "field-content-invalidation"; command: FieldContentInvalidationCommand };
export type FieldContentInvalidationCatalog = { catalogHash: string; catalog: BattleEntryCatalog };
type Binding = { script: string; webPc: number; instruction: FieldContentInvalidationOp & Site };
export type FieldContentInvalidationsCheckpoint = {
  kind: "field-content-invalidations-v1";
  catalogHash: string;
  commands: Binding[];
};
type Content = Pick<FieldContent, "contentHash" | "scripts">;

function record(raw: unknown, fields: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error("Invalid field content-invalidation data");
  const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(raw);
  if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key)) ||
      Object.values(descriptors).some(d => !d.enumerable || !("value" in d)))
    throw new Error("Invalid field content-invalidation fields");
  return Object.fromEntries(fields.map(key => [key, descriptors[key]!.value]));
}
function dense(raw: unknown): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || Reflect.ownKeys(raw).length !== raw.length + 1)
    throw new Error("Invalid field content-invalidation array");
  const values: unknown[] = [];
  for (let i = 0; i < raw.length; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!d?.enumerable || !("value" in d)) throw new Error("Invalid field content-invalidation array element");
    values.push(d.value);
  }
  return values;
}
function text(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw.trim() !== raw) throw new Error("Invalid field content-invalidation identity");
  return raw;
}
function jsonData(raw: unknown, seen = new Set<object>()): void {
  if (raw === null || typeof raw === "string" || typeof raw === "boolean" || typeof raw === "number" && Number.isFinite(raw)) return;
  if (!raw || typeof raw !== "object" || seen.has(raw)) throw new Error("Invalid field content-invalidation JSON");
  seen.add(raw);
  if (Array.isArray(raw)) for (const value of dense(raw)) jsonData(value, seen);
  else {
    const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(raw);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(raw)) || keys.some(key => typeof key !== "string") ||
        Object.values(descriptors).some(d => !d.enumerable || !("value" in d)))
      throw new Error("Invalid field content-invalidation JSON data fields");
    for (const d of Object.values(descriptors)) jsonData(d.value, seen);
  }
  seen.delete(raw);
}
export function parseFieldContentInvalidationCommand(raw: unknown): FieldContentInvalidationCommand {
  const value = record(raw, ["kind", "invalidType"]);
  if (value.kind !== "add-moving" || value.invalidType !== 0 && value.invalidType !== 2)
    throw new Error("Unsupported field moving-content invalidation");
  return { kind: "add-moving", invalidType: value.invalidType };
}

/** Only script additions are mutable. The immutable map availability and
 * source constants remain owned by their catalog. This source build's beast
 * list is disjoint; an overlapping catalog needs its ordered update lifecycle. */
export function movingContentInvalidationIds(catalog: BattleEntryCatalog, invalidType: 0 | 2): number[] {
  parseFieldContentInvalidationCommand({ kind: "add-moving", invalidType });
  if (catalog.kind !== "battle-entry-v1") throw new Error("Missing field content-invalidation catalog");
  const rows = dense(catalog.movingContents), ids: number[] = [];
  for (const raw of rows) {
    const row = record(raw, ["id", "value2"]);
    checkpointInteger(row.id as number, 1, 0x7fffffff); checkpointInteger(row.value2 as number, 0, 0x7fffffff);
    const id = row.id as number;
    if (ids.includes(id)) throw new Error("Duplicate field moving-content identity");
    ids.push(id);
  }
  if (!Array.isArray(catalog.beastFieldContents) || ids.some(id => catalog.beastFieldContents.includes(id)))
    throw new Error("Overlapping moving/beast field-content update order is unresolved");
  return rows.filter(raw => invalidType === 0 || (raw as { value2: number }).value2 === 0)
    .map(raw => (raw as { id: number }).id);
}

/** This object is a register of the existing Field owner, not a World/owned
 * permission. A new map starts empty. The save contains exact executed source
 * bindings, never new IDs, a map override, a program or a capability. */
export class FieldContentInvalidations {
  private readonly catalogIdentity: string | null;
  private readonly catalogHash: string | null;
  private readonly sourceCommands = new Map<string, Binding>();
  private readonly commands: Binding[] = [];
  constructor(private readonly content: Content, private readonly context?: FieldContentInvalidationCatalog) {
    this.catalogIdentity = context === undefined ? null : canonical(context.catalog);
    this.catalogHash = context?.catalogHash ?? null;
    for (const [script, program] of Object.entries(content.scripts)) for (const [webPc, op] of program.entries())
      if (op.kind === "field-content-invalidation") {
        parseFieldContentInvalidationCommand(op.command);
        this.sourceCommands.set(canonical([script, webPc]), { script, webPc, instruction: structuredClone(op) });
      }
  }
  private validateCatalog(catalog?: BattleEntryCatalog): void {
    if (!this.context || !this.catalogIdentity || this.context.catalogHash !== this.catalogHash ||
        !/^[a-f0-9]{64}$/.test(this.context.catalogHash) ||
        canonical(this.context.catalog) !== this.catalogIdentity || catalog && canonical(catalog) !== this.catalogIdentity)
      throw new Error("Field content-invalidation requires its bound battle catalog");
  }
  private bind(script: string, webPc: number): Binding {
    text(script); checkpointInteger(webPc, 0, 0x7fffffff);
    const expected = this.sourceCommands.get(canonical([script, webPc]));
    const op = Object.hasOwn(this.content.scripts, script) ? this.content.scripts[script]?.[webPc] : undefined;
    if (op?.kind !== "field-content-invalidation" || !expected || canonical(op) !== canonical(expected.instruction))
      throw new Error("Field content-invalidation source instruction changed");
    parseFieldContentInvalidationCommand(op.command);
    return { script, webPc, instruction: structuredClone(op) };
  }
  execute(script: string, webPc: number): void {
    this.validateCatalog();
    const binding = this.bind(script, webPc);
    movingContentInvalidationIds(this.context!.catalog, binding.instruction.command.invalidType);
    if (!this.commands.some(old => old.script === script && old.webPc === webPc)) this.commands.push(binding);
  }
  invalidTypes(catalog: BattleEntryCatalog): (0 | 2)[] {
    if (!this.commands.length) return [];
    this.validateCatalog(catalog);
    return this.commands.map(binding => {
      if (canonical(this.bind(binding.script, binding.webPc)) !== canonical(binding))
        throw new Error("Field content-invalidation source instruction changed");
      return binding.instruction.command.invalidType;
    });
  }
  snapshot(): FieldContentInvalidationsCheckpoint | null {
    if (!this.commands.length) return null;
    this.invalidTypes(this.context!.catalog);
    return { kind: "field-content-invalidations-v1", catalogHash: this.context!.catalogHash,
      commands: structuredClone(this.commands) };
  }
  restore(raw: unknown): void {
    this.validateCatalog();
    if (this.commands.length) throw new Error("Field content-invalidation restore requires a fresh field");
    const saved = record(raw, ["kind", "catalogHash", "commands"]);
    if (saved.kind !== "field-content-invalidations-v1" || saved.catalogHash !== this.context!.catalogHash)
      throw new Error("Field content-invalidation catalog changed");
    const rows = dense(saved.commands);
    if (!rows.length) throw new Error("Empty field content-invalidation save must retain the legacy field shape");
    const bindings: Binding[] = [], keys = new Set<string>();
    for (const row of rows) {
      const value = record(row, ["script", "webPc", "instruction"]), script = text(value.script), webPc = value.webPc as number;
      const expected = this.bind(script, webPc), key = canonical([script, webPc]);
      jsonData(value.instruction);
      if (keys.has(key) || canonical(value.instruction) !== canonical(expected.instruction))
        throw new Error("Saved field content-invalidation differs from trusted source");
      movingContentInvalidationIds(this.context!.catalog, expected.instruction.command.invalidType);
      keys.add(key); bindings.push(expected);
    }
    this.commands.push(...bindings);
  }
}
