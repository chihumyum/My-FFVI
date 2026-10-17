import {
  emptyPartyState,
  validatePartyCommand,
  validatePartyState,
  type PartyEventOp,
  type PartyRosterEntry,
  type PartyState,
  type PartySlotIndex,
} from "../core/party.js";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";
import { tableId } from "./table-id.js";

function rows(tables: Record<string, unknown>, name: string) {
  const data = tables[name];
  if (!Array.isArray(data)) throw new Error(`Missing party table ${name}`);
  return data.map(record);
}
function reference(tables: Record<string, unknown>, id: number) {
  const found = rows(tables, "character_status.csv").filter(
    (r) => tableId(r.id) === id,
  );
  if (found.length !== 1)
    throw new Error(`Missing or ambiguous party character_status.csv:${id}`);
  return { table: "character_status.csv", id };
}
function sourceSlot(value: number | undefined): PartySlotIndex {
  const index = int32(value) - 1;
  if (index < 0 || index > 2) throw new Error("Invalid source party slot");
  return index as PartySlotIndex;
}

/** Caller validates type=1, eight operands, and unused numeric/string operands. */
export function compilePartyEvent(
  mnemonic: "OrganizePartySlot" | "ChangePartySlot",
  values: readonly number[],
  tables: Record<string, unknown>,
): PartyEventOp {
  const slot = sourceSlot(values[0]);
  if (mnemonic === "ChangePartySlot") {
    return {
      kind: "party",
      command: {
        kind: "select-slot",
        slot,
        refreshActors: int32(values[1]) !== 0,
      },
      dependencies: [],
    };
  }
  if (mnemonic !== "OrganizePartySlot")
    throw new Error("Unknown party instruction");
  if (values.length < 5)
    throw new Error("Missing party organization positions");
  const members = values.slice(1, 5).map((v) => (int32(v) < 1 ? null : v)) as [
    number | null,
    number | null,
    number | null,
    number | null,
  ];
  const command = {
    kind: "organize-slot" as const,
    slot,
    members,
    refreshActors: true as const,
  };
  validatePartyCommand(command);
  return {
    kind: "party",
    command,
    dependencies: members
      .filter((id) => id !== null)
      .map((id) => reference(tables, id)),
  };
}

/**
 * Projects already-created owned characters into the source initial four slots.
 * This does not implement AddFromMaster, learn abilities, or grant initial gear.
 */
export function compileInitialPartyState(
  tables: Record<string, unknown>,
  roster: readonly PartyRosterEntry[],
): { state: PartyState; dependencies: { table: string; id: number }[] } {
  const state = emptyPartyState();
  validatePartyState(state, roster);
  const initial = rows(tables, "initialize_data.csv");
  const dependencies: { table: string; id: number }[] = [];
  const setting = (key: string) => {
    const found = initial.filter((r) => r.key_name === key);
    if (found.length > 1)
      throw new Error(`Ambiguous party initialization ${key}`);
    if (!found[0]) return null;
    const id = tableId(found[0].id);
    if (id <= 0) throw new Error("Invalid party initialization identity");
    dependencies.push({ table: "initialize_data.csv", id });
    return tableId(found[0].value1);
  };
  // Native creates a fifth owned character when configured, although this FFVI
  // party has only four positions. A broader initializer must own that creation.
  if (setting("INIT_PARTY_5") !== null)
    throw new Error("Fifth owned-character initialization is not implemented");
  for (let position = 0; position < 4; position++) {
    const source = setting(`INIT_PARTY_${position + 1}`);
    const row = setting(`INIT_CORPS_${position + 1}`) ?? 1;
    if (row !== 1 && row !== 2) throw new Error("Invalid initial party row");
    state.slots[0][position]!.row = row === 1 ? "front" : "back";
    if (source === null) continue;
    if (source <= 0) throw new Error("Invalid initial party source character");
    dependencies.push(reference(tables, source));
    const member = roster.find((r) => r.sourceId === source);
    if (!member)
      throw new Error(`Initial party character is not owned: ${source}`);
    // CreatePlayerCharacters queries GetOwnedCharactersClone(false); this filter
    // is deliberately different from OrganizePartySlot's include-disabled=true.
    state.slots[0][position]!.id = member.enabled ? member.id : null;
  }
  validatePartyState(state, roster);
  return { state, dependencies };
}
