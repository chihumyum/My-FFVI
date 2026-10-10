import { z } from "zod";
import type {
  InteractionProperties,
  FieldInteraction,
} from "../field/types.js";
import { record } from "./content.js";
import { tableId } from "./table-id.js";
import { compileMessage } from "./message.js";

const integer = (value: unknown) => z.number().int().parse(value);
const bool = (value: unknown) => z.boolean().parse(value ?? false);
// MapConstants.SymbolTable, RVA 0x43B490. PropertyTalk excludes these types by default.
const symbolTypes = new Set([2, 3, 4, 6, 7, 8, 9, 10]);

/** PropertyTalk and EventAction are shared by NPCs and map objects. */
export function compileInteraction(
  p: Record<string, unknown>,
  script: string | null,
  tables: Record<string, unknown>,
  messages: Record<string, unknown>,
): { properties: InteractionProperties; blockers: string[] } {
  const blockers: string[] = [];
  const rows = (name: string) =>
    z.array(z.unknown()).parse(tables[name]).map(record);
  const row = (name: string, id: number) => {
    const found = rows(name).filter((r) => tableId(r.id) === id);
    if (found.length !== 1)
      throw new Error(`Ambiguous or missing ${name}:${id}`);
    return found[0]!;
  };
  const properties: InteractionProperties = {
    acceptDirection: z
      .number()
      .int()
      .min(0)
      .max(15)
      .parse(p.accept_action_direction ?? 0),
    talkMounts: [],
    interaction: { kind: "none" },
    soundId: 0,
  };
  try {
    const actionId = integer(p.action_id ?? 0);
    if (actionId !== 0) {
      const action = row("action.csv", actionId).action_name;
      // EventActionDefine.InvalidTalkIdTable is {0, 9}; contact encounters use another observer.
      if (actionId === 9 && action === "Encount") {
        blockers.push("Unsupported contact encounter");
        return { properties, blockers };
      }
      let interaction: FieldInteraction;
      if (action === "RunScript") {
        // EventRunScript ends without invoking Integrator when the source ScriptId is zero.
        // A missing nonzero script row was already rejected by the entity adapter.
        interaction = { kind: "script", script };
        properties.soundId = integer(p.se_id ?? 0);
      } else if (action === "Talk") {
        if (integer(p.target_character_status_id ?? 0) !== 0)
          throw new Error("Unsupported talk character change");
        interaction = {
          kind: "talk",
          message: compileMessage(z.string().parse(p.message_key), messages),
        };
      } else throw new Error("Unsupported interactive action " + action);
      if (bool(p.gimmick) || String(p.target_transportation_ids ?? "") !== "")
        throw new Error("Unsupported interaction event condition");
      const transportation = rows("transportation.csv"),
        declared = z.string().parse(p.talk_target_transportation_ids ?? ""),
        ids =
          declared === ""
            ? transportation
                .filter((r) => !symbolTypes.has(tableId(r.type_id)))
                .map((r) => tableId(r.id))
            : declared.split(",").map(tableId);
      // Keep the source transportation identity separate from the NPC mapobject asset domain.
      const mounts = transportation.map((r) => ({
        id: tableId(r.id),
        asset:
          tableId(r.type_id) === 1
            ? ""
            : z
                .string()
                .parse(
                  row("field_character_asset.csv", tableId(r.asset_id))
                    .asset_name,
                ),
      }));
      for (const id of ids) {
        const found = mounts.filter((m) => m.id === id);
        if (found.length !== 1)
          throw new Error("Ambiguous or missing talk transportation " + id);
        const mount = found[0]!;
        if (mounts.some((m) => m.asset === mount.asset && !ids.includes(m.id)))
          throw new Error("Ambiguous talk transportation asset");
        properties.talkMounts.push(mount.asset);
      }
      properties.talkMounts = [...new Set(properties.talkMounts)];
      properties.interaction = interaction;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    properties.interaction = { kind: "blocked", reason };
    blockers.push("Unsupported interaction: " + reason);
  }
  return { properties, blockers };
}
