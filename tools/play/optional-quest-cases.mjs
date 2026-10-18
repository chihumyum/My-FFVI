// Optional routes omitted by the first recruitment/magicite batch. These are
// ordinary inputs from completed real cases, never alternate plot scripts.
const scene = (n) => (typeof n === "number" ? `sc_e_${String(n).padStart(4, "0")}` : n);
const flag = (index, bank = "ScenarioFlag2", value = 1) => ({ flag: [bank, index, value] });
const all = (...conditions) => ({ all: conditions });
const item = (id) => ({ item: [id, 1] });
const step = (id, scripts, complete, extra = {}) => ({
  id,
  scripts: scripts.map(scene),
  complete,
  ...extra,
});
const ref = (mapId, entityId, script, position, extra = {}) => ({
  mapId,
  entityId,
  script: scene(script),
  position,
  ...extra,
});
const coralReady = { variableAtLeast: ["ScenarioVariable", 7, 22] };
const ancientExit = [
  { mapId: 519, entityId: "4" },
  { mapId: 518, entityId: "2" },
];
const coralChests = [
  { script: "sc_e_0948", flag: 224, rooms: [1] },
  // AreaLocalVariable3 is the random branch value, not the entrance ID:
  // source0947 branches7→entrance9 (right-bottom),9→entrance7 (left-bottom).
  { script: "sc_e_0948_1", flag: 223, rooms: [4, 9] },
  { script: "sc_e_0948_2", flag: 222, rooms: [6, 8, 7] },
  { script: "sc_e_0948_3", flag: 225, rooms: [2, 5] },
  { script: "sc_e_0948_4", flag: 221, rooms: [3] },
];

export const questOptionalCases = [
  {
    id: "magic-master",
    title: "狂信者之塔顶层灵魂与魔法大师",
    requiresCases: ["dragon-holy"],
    objectives: [
      step("tower-soul-of-thamasa", [880], all(flag(167), item(315)), { maps: [487] }),
      step("tower-magic-master", [881], flag(168), {
        maps: [486],
        after: [scene("sc_e_0881_1")],
        sourceRefs: [ref(486, "1", 881, [8, 8, 1], { encounterId: 355 })],
      }),
    ],
    complete: all(flag(168), item(315)),
    notes: [
      "The real487 chest gives315 and runs0880 to set167; returning to486 then publishes the actual0881 battle. Its355 AI final Ultima must resolve before source0881_1 sets168.",
    ],
  },
  ...[
    {
      id: "master-tonberry",
      title: "古代城洞窟宝箱中的冬贝利大师",
      script: 884,
      map: 509,
      entity: "15",
      position: [58, 43, 1],
      encounter: 484,
      victoryFlag: 170,
    },
    {
      id: "samurai-soul",
      title: "古代城宝箱中的侍魂与乱击之证",
      script: 891,
      map: 514,
      entity: "2",
      position: [10, 17, 1],
      encounter: 466,
      victoryFlag: 177,
      reward: 310,
    },
  ].map((boss) => ({
    id: boss.id,
    title: boss.title,
    requiresCases: ["ancient-odin-raiden"],
    objectives: [
      step(
        boss.id,
        [boss.script],
        boss.reward ? all(flag(boss.victoryFlag), item(boss.reward)) : flag(boss.victoryFlag),
        {
          maps: [boss.map],
          approach: [
            ...ancientExit,
            ...(boss.map === 514
              ? [{ mapId: 517, entityId: "6" }]
              : [
                  { mapId: 517, entityId: "3" },
                  { mapId: 515, entityId: "entity_default:0:2" },
                  { mapId: 512, entityId: "14" },
                  { mapId: 511, entityId: "1" },
                  { mapId: 510, entityId: "3" },
                ]),
          ],
          sourceRefs: [
            ref(boss.map, boss.entity, boss.script, boss.position, {
              encounterId: boss.encounter,
              kind: 7,
            }),
          ],
        },
      ),
    ],
    notes: [
      "Restore the actually completed ancient-castle route, then walk back to the real unopened monster chest. No chest flag or battle is synthesized.",
    ],
  })),
  {
    id: "ultima-buster",
    title: "瓦砾之塔牢房最终兵器与战后存档点",
    requiresCases: ["eight-dragons"],
    objectives: [
      step("ultima-buster", [977], flag(223), {
        maps: [554],
        cooperative: true,
        approach: [
          { mapId: 551, entityId: "5" },
          { mapId: 558, entityId: "entity_default:0:2" },
          { mapId: 542, entityId: "22" },
          { mapId: 553, entityId: "1" },
        ],
        sourceRefs: [ref(554, "2", 977, [76, 64, 1], { encounterId: 483 })],
      }),
    ],
    complete: flag(223),
  },
  {
    id: "duncan-phantom-rush",
    title: "邓肯传授马修梦幻斗舞",
    requiresCases: ["sabin"],
    objectives: [
      step("duncan-phantom-rush", [954], all(flag(208), { learnedAbility: [6, 139] }), {
        maps: [272],
        party: { include: [6] },
        sourceRefs: [ref(272, "18", 954, [13, 11, 1])],
      }),
    ],
    complete: all(flag(208), { learnedAbility: [6, 139] }),
    notes: [
      "Source0954 calls the Phantom Rush training host before setting208. PR content469/ability139 is the final Blitz; the field scene must not unlock intermediate level-gated Blitz abilities.",
    ],
  },
  {
    id: "hidon",
    title: "斯特拉格斯的旧友、珊瑚宝箱与希顿",
    requiresCases: ["strago"],
    objectives: [
      step("gungho-injured", [942], flag(201), {
        maps: [305],
        party: { include: [8, 9] },
        approach: [{ mapId: 268, entityId: "4" }],
        after: ["sc_e_0942_1", "sc_e_0942_2"],
        sourceRefs: [ref(305, "104", 942, [22, 39, 1])],
      }),
      step(
        "ebots-rock-arrival",
        [946],
        { map: 540 },
        {
          maps: [539],
          require: flag(201),
        },
      ),
      step("feed-source-coral-chest", [943], all({ map: 540 }, flag(1, "MapLocalVariable")), {
        party: { include: [8] },
        choices: [{ script: scene(943), index: 0 }],
        cycle: [
          { when: all({ map: 540 }, coralReady), scripts: [scene(943)] },
          ...coralChests.map((chest) => ({
            when: all(
              { map: 541 },
              { any: chest.rooms.map((n) => flag(3, "AreaLocalVariable", n)) },
            ),
            unless: flag(chest.flag, "TreasureFlag1"),
            scripts: [chest.script],
          })),
          { when: { any: [{ map: 539 }, { map: 540 }, { map: 541 }] }, scripts: [scene(947)] },
          { scripts: [scene(946)] },
        ],
        notes: [
          "Use original0947 random warps and the five PR0948 coral chests. At540 feed the real source chest once ScenarioVariable[7]>=22. Source0943 clears47/counter7 and sets MapLocalVariable[1]; remain in this room and walk past the removed chest to0949. No coral or counter is assigned by the fixture.",
          "The room list is a literal manual acceptance route through the PR warp entrances, not a new automatic-player policy; an unavailable chest remains a reported input gap.",
        ],
      }),
      step("hidon-introduction", [949], flag(204), { maps: [540] }),
      step("hidon-story-finish", [950], flag(205), {
        maps: [540],
        party: { include: [8] },
        after: [
          "sc_e_0950_1",
          "sc_e_0950_2",
          "sc_e_0950_3",
          "sc_e_0950_4",
          "sc_e_0950_5",
          "sc_e_0950_6",
        ],
        sourceRefs: [ref(540, "6", 950, [25, 9, 1], { encounterId: 465 })],
      }),
    ],
    complete: flag(205),
    notes: [
      "A boosted quest completion does not prove Grand Delta was witnessed/learned: the ordinary automated battle can defeat Hidon before it casts that Lore. Lore learning remains governed by the real battle ability witness system.",
    ],
  },
];
