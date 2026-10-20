// Original workshop sample, independent of the original campaign and city trial.
export function createStoryProject(id = "my-story") {
  return {
    version: 1,
    id,
    title: "新的剧情项目",
    variables: [],
    bindings: [],
    preview: { world: "akto", mapId: 9102, entrance: 1 },
    scenes: [
      {
        id: "first-scene",
        title: "新的演出",
        entry: "hello",
        nodes: [
          { id: "hello", type: "dialogue", speaker: "居民", text: "你好，旅行者。", next: "end" },
          { id: "end", type: "end" },
        ],
      },
    ],
  };
}
export function createAktoStoryDemo() {
  const condition = (id, variable, value, yes, no, operator = "=") => ({
    id,
    type: "condition",
    variable,
    value,
    operator,
    yes,
    no,
  });
  const dialogue = (id, speaker, text, next = "end") => ({
    id,
    type: "dialogue",
    speaker,
    text,
    next,
  });
  const set = (id, variable, value, next) => ({ id, type: "set", variable, value, next });
  const scene = (id, title, nodes) => ({
    id,
    title,
    entry: nodes[0].id,
    nodes: [...nodes, { id: "end", type: "end" }],
  });
  return {
    version: 1,
    id: "akto-delivery",
    title: "阿克托 · 一封信的去处",
    preview: { world: "akto", mapId: 9102, entrance: 1 },
    variables: [
      { key: "delivery.route", label: "送信去向（0 未接 / 1 水庭 / 2 工区）", slot: 0, initial: 0 },
      { key: "delivery.done", label: "信件已交付", slot: 1, initial: 0 },
      { key: "water.restored", label: "水庭已获得检修许可", slot: 2, initial: 0 },
      { key: "forge.repaired", label: "工区已获得检修许可", slot: 3, initial: 0 },
    ],
    scenes: [
      scene("courier", "送信人：选择信件去处", [
        condition("completed", "delivery.done", 1, "thanks", "accepted"),
        condition("accepted", "delivery.route", 0, "offer", "reminder"),
        dialogue(
          "offer",
          "送信人",
          "这份检修许可只能先送到一处。水庭和工区都在等，你愿意替我走一趟吗？",
          "choose",
        ),
        {
          id: "choose",
          type: "choice",
          options: [
            { text: "先送到水庭的护水人手中", target: "water" },
            { text: "先送到工区的炉工手中", target: "forge" },
            { text: "我再考虑一下", target: "decline" },
          ],
        },
        set("water", "delivery.route", 1, "water-route"),
        dialogue("water-route", "送信人", "水庭在旧城北边。从两侧的楼梯上去，护水人就在庭中。"),
        set("forge", "delivery.route", 2, "forge-route"),
        dialogue(
          "forge-route",
          "送信人",
          "炉工在城东南的炉脊工区。把许可交给他，工人就能开始检修。",
        ),
        dialogue("decline", "送信人", "没关系，我会在桥南等你。"),
        dialogue("reminder", "送信人", "许可已经交给你了。到你选定的地方，和收信人谈谈吧。"),
        dialogue("thanks", "送信人", "信已经送到了。走进城里看看，那里的人会记得你的帮忙。"),
      ]),
      scene("water", "水庭：交付许可", [
        condition("done", "water.restored", 1, "after", "route"),
        condition("route", "delivery.route", 1, "deliver", "before"),
        dialogue(
          "deliver",
          "护水人",
          "检修许可终于到了！我这就让开水道口。往后，你随时都能来。",
          "open",
        ),
        set("open", "water.restored", 1, "complete"),
        set("complete", "delivery.done", 1, "end"),
        dialogue("before", "护水人", "没有检修许可，水道口还得由我守着。送信人在桥南。"),
        dialogue("after", "护水人", "水道已经开始检修。你送来的许可，我一直收着。"),
      ]),
      scene("forge", "工区：交付许可", [
        condition("done", "forge.repaired", 1, "after", "route"),
        condition("route", "delivery.route", 2, "deliver", "before"),
        dialogue(
          "deliver",
          "炉工",
          "许可到了！上城的守卫会让开检修通道，我们终于可以开工了。",
          "open",
        ),
        set("open", "forge.repaired", 1, "complete"),
        set("complete", "delivery.done", 1, "end"),
        dialogue("before", "炉工", "工人都准备好了，还差一份检修许可。"),
        dialogue("after", "炉工", "检修正在进行。等机器平稳下来，工人们就能轮休了。"),
      ]),
      scene("resident", "旧城居民：回应水庭变化", [
        condition("state", "water.restored", 1, "after", "before"),
        dialogue("before", "旧城住民", "水庭的检修还没有消息。"),
        dialogue("after", "旧城住民", "护水人终于让开了水道口。是你把许可送上去的吧？"),
      ]),
      scene("guard", "上城守卫：回应工区变化", [
        condition("state", "forge.repaired", 1, "after", "before"),
        dialogue("before", "双子城防团", "检修通道暂时关闭。"),
        dialogue("after", "双子城防团", "许可已经登记，检修通道开放。我在旁边值守。"),
      ]),
    ],
    bindings: [
      { id: "courier", kind: "npc", mapId: 9102, entityId: "517", scene: "courier" },
      {
        id: "water",
        kind: "npc",
        mapId: 9102,
        entityId: "512",
        scene: "water",
        variants: [
          { when: [{ variable: "water.restored", value: 1 }], properties: { x: 34, y: 29 } },
        ],
      },
      { id: "forge", kind: "npc", mapId: 9102, entityId: "514", scene: "forge" },
      { id: "resident", kind: "npc", mapId: 9102, entityId: "511", scene: "resident" },
      {
        id: "guard",
        kind: "npc",
        mapId: 9102,
        entityId: "516",
        scene: "guard",
        variants: [
          { when: [{ variable: "forge.repaired", value: 1 }], properties: { x: 84, y: 40 } },
        ],
      },
    ],
  };
}
