import { z } from "zod";
import type { NpcProperties, NpcInteraction } from "../field/types.js";
import { record } from "./content.js";
import { tableId } from "./table-id.js";
import { compileMessage } from "./message.js";

const integer = (value: unknown) => z.number().int().parse(value);
const bool = (value: unknown) => z.boolean().parse(value ?? false);
// MapConstants.SymbolTable, RVA 0x43B490. PropertyTalk excludes these types by default.
const symbolTypes = new Set([2, 3, 4, 6, 7, 8, 9, 10]);

/** Native Wait controller + RunScript/Talk subset; other controllers stay explicit blockers. */
export function compileNpc(
  p: Record<string, unknown>,
  script: string | null,
  tables: Record<string, unknown>,
  messages: Record<string, unknown>,
): { npc: NpcProperties; blockers: string[] } {
  const blockers: string[] = [];
  const rows = (name: string) =>
    z.array(z.unknown()).parse(tables[name]).map(record);
  const row = (name: string, id: number) => {
    const found = rows(name).filter((r) => tableId(r.id) === id);
    if (found.length !== 1)
      throw new Error(`Ambiguous or missing ${name}:${id}`);
    return found[0]!;
  };
  const moveType = integer(p.move_type ?? 0);
  if (moveType !== 0)
    blockers.push("Unsupported NPC movement controller " + moveType);
  if (bool(p.all_layers) || bool(p.birdview_puppet))
    blockers.push("Unsupported cross-layer or birdview NPC");
  if (bool(p.affected)) blockers.push("Unsupported NPC screen-effect stencil");
  const npc: NpcProperties = {
    moveType,
    collision: z.boolean().parse(p.collision ?? true),
    pushed: bool(p.pushed),
    eyeContact: bool(p.eye_contact),
    turnAround: bool(p.turn_around),
    acceptDirection: z
      .number()
      .int()
      .min(0)
      .max(15)
      .parse(p.accept_action_direction ?? 0),
    talkMounts: [],
    interaction: { kind: "none" },
  };
  try {
    const actionId = integer(p.action_id ?? 0);
    if (actionId !== 0) {
      const action = row("action.csv", actionId).action_name;
      // EventActionDefine.InvalidTalkIdTable is {0, 9}; contact encounters use another observer.
      if (actionId === 9 && action === "Encount") {
        blockers.push("Unsupported NPC contact encounter");
        return { npc, blockers };
      }
      let interaction: NpcInteraction;
      if (action === "RunScript") {
        // EventRunScript ends without invoking Integrator when the source ScriptId is zero.
        // A missing nonzero script row was already rejected by the entity adapter.
        interaction = { kind: "script", script };
      } else if (action === "Talk") {
        if (integer(p.target_character_status_id ?? 0) !== 0)
          throw new Error("Unsupported NPC talk character change");
        interaction = {
          kind: "talk",
          message: compileMessage(z.string().parse(p.message_key), messages),
        };
      } else throw new Error("Unsupported NPC action " + action);
      if (bool(p.gimmick) || String(p.target_transportation_ids ?? "") !== "")
        throw new Error("Unsupported NPC event condition");
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
          throw new Error("Ambiguous NPC talk transportation asset");
        npc.talkMounts.push(mount.asset);
      }
      npc.talkMounts = [...new Set(npc.talkMounts)];
      npc.interaction = interaction;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    npc.interaction = { kind: "blocked", reason };
    blockers.push("Unsupported actor interaction: " + reason);
  }
  // Wait.HitPlayer is an empty native method. Pushed/route/idling properties do not make it wander.
  // Area/Route controllers (and their obstacle pushing) are blocked above, never emulated as Wait.
  return { npc, blockers };
}
