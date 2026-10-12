import type { FieldContent, Op } from "../../src/field/types.js";

export const interactionScript = "controlled_framework_choice";
/** Authored framework exercise layered over a caller's field. It is never a
 * replacement for a source script or evidence of story reachability. */
export function eventInteractionField(sourceField: FieldContent): FieldContent {
  const field = structuredClone(sourceField);
  if (field.scripts[interactionScript]) throw new Error("Interaction fixture already installed");
  const source = { file: "controlled-event-interaction", assetPath: "Fixtures/EventInteraction/main.json" };
  const site = (index: number) => ({ script: interactionScript, index, source });
  const selected = { category: "MessageSelection", index: 0 } as const;
  // The explicit type on the final array keeps each discriminated instruction
  // checked without coercing runtime content through an untyped fixture cast.
  const script: Op[] = [
    { ...site(0), kind: "message", key: "FRAMEWORK_SUPPLIES", speaker: "", text: "是否领取补给？" },
    { ...site(1), kind: "choice", options: [{ key: "FRAMEWORK_YES", text: "领取补给" }, { key: "FRAMEWORK_NO", text: "暂不领取" }],
      initialIndex: 1, cancelIndex: null, anchor: "bottom-right", presentation: "yes-no", retainMessage: false },
    { ...site(2), kind: "branch", left: selected, operator: "＝", right: { kind: "immediate", value: 0 }, target: 5 },
    { ...site(3), kind: "message", key: "FRAMEWORK_DECLINED", speaker: "", text: "本次暂不领取，可以继续探索。" },
    { ...site(4), kind: "exit" },
    { ...site(5), kind: "nop" },
    { ...site(6), kind: "inventory", command: { kind: "grant-item", id: 2, count: 2 }, result: null,
      dependencies: [{ table: "content.csv", id: 2 }, { table: "item.csv", id: 1 }] },
    { ...site(7), kind: "message", key: "FRAMEWORK_GRANTED", speaker: "", text: "补给已领取。请选择接下来的计划。" },
    { ...site(8), kind: "choice", options: [{ key: "FRAMEWORK_EXPLORE", text: "继续探索" },
      { key: "FRAMEWORK_PARTY", text: "整顿队伍" }, { key: "FRAMEWORK_WAIT", text: "原地等候" }],
      initialIndex: 0, cancelIndex: null, anchor: "bottom-center", presentation: "multiple", retainMessage: false },
    { ...site(9), kind: "calc", left: { category: "ScenarioVariable", index: 15 }, operator: "←",
      right: { kind: "variable", ref: selected } },
    { ...site(10), kind: "message", key: "FRAMEWORK_RECORDED", speaker: "", text: "选择已记录，可以继续移动与保存。" },
    { ...site(11), kind: "exit" },
  ];
  field.scripts[interactionScript] = script;
  return field;
}
