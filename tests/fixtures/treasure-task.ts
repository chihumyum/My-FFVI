import { compileTreasureInventoryDefinition, compileTreasureInteraction } from "../../src/compiler/treasure-inventory.js";
import { treasureProperties, treasureTables } from "./treasure-inventory.js";
import type { TreasureBoxRequest } from "../../src/core/treasure-inventory.js";

export const taskLimits = { item: 99, gil: 9999999 };
export const taskOwned = (count = 0, gil = 0) => ({
  gil, normalOwnedItems: [{ id: 101, count }],
});
export function taskDefinition(properties: Record<string, unknown> = {}) {
  return compileTreasureInventoryDefinition(treasureProperties(properties), treasureTables());
}
export function taskRequest(properties: Record<string, unknown> = {}, change: Partial<TreasureBoxRequest> = {}) {
  return { ...compileTreasureInteraction(taskDefinition(properties)), ...change };
}
export const taskMessages = () => ({
  story_mes_zhc: {
    SYNTHETIC_TREASURE: "<CT>Found (ITEM_N).\\nKeep it.",
    SYN_GIL_REWARD: "<CT>Found (NUM) coins.",
    SYN_EMPTY: "It is empty.",
    SYN_FULL: "No more fits.",
  },
  story_cha_zhc: {
    SYNTHETIC_TREASURE: "", SYN_GIL_REWARD: "", SYN_EMPTY: "", SYN_FULL: "",
  },
});
export const taskSystemMessages = { SYN_ITEM: "<IC_BAG>Sample medicine" };
