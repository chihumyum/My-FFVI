// Static acceptance manifests, not alternate events or automatic-player policy.
// Every step must enter its named source through ordinary navigation/interaction.
// `notes`, `sourceRefs` and `unresolved` are inspection metadata, not instructions
// to write banks, invoke scripts, relocate actors or force battle outcomes.
import { optionalCases } from "./optional-cases.mjs";
const flag = (index, bank = "ScenarioFlag2", value = 1) => ({ flag: [bank, index, value] });
const all = (...conditions) => ({ all: conditions });
const item = (id) => ({ item: [id, 1] });
const scene = (value) =>
  typeof value === "number" ? `sc_e_${String(value).padStart(4, "0")}` : value;
const step = (id, scripts, complete, extra = {}) => ({
  id,
  scripts: scripts.map(scene),
  complete,
  ...extra,
});
const source = (script, mapId, entityId, position, extra = {}) => ({
  script: scene(script),
  mapId,
  ...(entityId ? { entityId, position } : {}),
  ...extra,
});

// Reuse the source-derived and actually exercised Lola/Zozo chain. In
// particular, leaving Lola's house between726 and727 is necessary; simply
// asking for729 would bypass that acceptance boundary. Recruiting Cyan is
// unnecessary for Storm Dragon, so that case omits only the final join step.
const cyanRecruitment = structuredClone(
  optionalCases.find((entry) => entry.id === "cyan").objectives,
);
const zozoAccess = cyanRecruitment.filter((objective) => objective.id !== "cyan");
const phoenixEntry = [
  step("phoenix-landing", [792], all({ map: 497 }, flag(45, "ScenarioFlag3")), {
    navigation: "airship",
    cooperative: true,
    partyCount: 2,
    after: ["sc_e_0792_1", "sc_e_0792_2"],
    sourceRefs: [source(792, 2, "158", [117, 157, 0], { kind: 21, transportationIds: [4, 5] })],
    notes: [
      "World2 vehicle trigger0792 leads through map268 and the original two-party formation menu.",
      "0792_2 places both parties in map497 and sets ScenarioFlag3[45] op16. Do not enter map497 directly.",
    ],
  }),
  step("phoenix-first-switch", [799], flag(143), {
    maps: [498],
    cooperative: true,
    sourceRefs: [source(799, 498, "56", [19, 9, 1], { group: "ev_e_0799" })],
  }),
];
const phoenixPlates = step("phoenix-double-plate", [804, 805], flag(146), {
  maps: [498],
  cooperative: true,
  hold: true,
  parts: [
    { scripts: [scene(804)], complete: flag(144) },
    { scripts: [scene(805)], complete: flag(145) },
  ],
  sourceRefs: [source(804, 498, "41", [10, 32, 1]), source(805, 498, "40", [12, 32, 1])],
  notes: [
    "804/805 set144/145; only when both are occupied does their source branch call806 and set146.",
    "804_1/805_1 reset the occupancy flags on leaving. Never satisfy these two flags by walking one party across both plates.",
  ],
});
const phoenixRoute = [
  ...phoenixEntry,
  phoenixPlates,
  step("phoenix-lava-switch", [808], flag(147), {
    maps: [498],
    cooperative: true,
    sourceRefs: [source(808, 498, "98", [23, 49, 1])],
  }),
  step("phoenix-water-switch", [811], flag(149), {
    maps: [499],
    cooperative: true,
    sourceRefs: [source(811, 499, "66", [40, 38, 1])],
  }),
];
const phoenixNotes = [
  "Use source0794..0803 and0812..0827 plate/jump passages through ordinary movement as the live geometry requires; event-number adjacency is not a route.",
  "Map499 switches0816@(41,27,L1) and0817@(46,16,L1) set150/reset151 and set151/reset150 respectively. They are mutually exclusive, not a simultaneous two-flag condition.",
  "Finish0828 is enabled by flag146=1 and152!=1; actual trigger map499 entity50@(6,53,L1). Its source chain returns via584→267→266→262.",
];
const phoenixUnresolved = [
  "The required live sequence of the mutually exclusive map499 bridge orientations has not been route-verified. A missing route is a blocker, not permission to set150/151 or invoke0828.",
];

const ancientAccess = [
  step(
    "figaro-current-gate",
    [],
    { map: 247 },
    {
      action: "fixed-field-route",
      maps: [2],
      walkBetween: [
        [57, 58],
        [53, 58],
      ],
      finalEntityId: "155",
      sourceRefs: [
        source("sc_map_10020", 2, "155", [53, 58, 0], {
          gate: "ScenarioFlag2[80]=1, [81]=1, [169]=0",
        }),
      ],
      notes: [
        "The baseline source flags place the actual castle gate at53,58; sc_map_10020 ops89/90 move entity155 there.",
        "Use fixed ordinary inputs: land at57,58 on PR legal grass, then walk left four cells to the live gate. Frozen route policy still has its old region for this moved portal.",
      ],
    },
  ),
  step(
    "figaro-ancient-stop",
    [674, 675, "sc_e_0882_2", "sc_e_1067_2"],
    all({ map: 249 }, flag(169)),
    {
      maps: [249],
      choices: [
        { script: scene(674), index: 0 },
        { script: scene(675), index: 0 },
        { script: "sc_e_0882_2", index: 1 },
        { script: "sc_e_1067_2", index: 1 },
      ],
      sourceRefs: [source(674, 249, "5", [9, 33, 2])],
      notes: [
        "Travel with the engine operator, then choose 在此停下 in0882_2/1067_2. Choice1 sets169 at op14; choice0 continues and clears169.",
        "The WoR engine source chooses0675/0882_1 or1067_1 from its actual travel state; both stop continuations are accepted.",
      ],
    },
  ),
  step(
    "ancient-cave",
    [],
    { map: 508 },
    {
      action: "visit-map",
      maps: [508],
      require: flag(169),
      sourceRefs: [source(883, 250, "6", [35, 35, 2], { group: "ev_e_0883", kind: 3 })],
      notes: [
        "Map250 initializer only publishes the ancient-cave exit group after169. Use the real basement portal.",
      ],
    },
  ),
  step("ancient-history", [885, "sc_e_0885_5"], flag(171), {
    maps: [512],
    sourceRefs: [source(885, 512, "1", [15, 33, 1], { group: "ev_e_0885" })],
    notes: ["The authored castle-history chain returns to512 and sets171 in0885_5 op11."],
  }),
];
const odin = step("odin", [886], all(flag(172), item(84)), {
  maps: [517],
  sourceRefs: [source(886, 517, "2", [33, 11, 1]), source(886, 517, "30", [34, 11, 1])],
  notes: ["0886 op14 sets172 and op15 awards actual content84 奥丁."],
});
const ancientHiddenRoom = [
  ...ancientAccess,
  step("ancient-hidden-stair", [887], flag(173), {
    maps: [517],
    sourceRefs: [source(887, 517, "12", [34, 14, 1], { kind: 5 })],
    notes: [
      "Ordinary interaction at(34,14,L1) calls887. Its source cutscene visits518 to show the stairs, then returns control in517; this is not a playable entry into518.",
    ],
  }),
  step("ancient-secret-room", [], { map: 518 }, { action: "visit-map", maps: [518] }),
];
const towerEntry = step("optional-tower-landing", [966], flag(217), {
  navigation: "airship",
  cooperative: true,
  partyCount: 3,
  after: ["sc_e_0966_4"],
  notes: [
    "Use the real three-party Kefka's Tower landing/formation sequence; do not restore a party to a dragon room.",
  ],
});
const dragon = (id, title, script, mapId, flagIndex, encounterId, entityId, position, extra = {}) =>
  step(id, [script], flag(flagIndex), {
    title,
    maps: [mapId],
    sourceRefs: [source(script, mapId, entityId, position, { encounterId })],
    notes: [
      `Victory continuation sets ScenarioFlag2[${flagIndex}] and invokes the original0975 dragon counter.`,
    ],
    ...extra,
  });
const ice = dragon("ice-dragon", "冰龙", 779, 19, 138, 367, "1", [17, 20, 1]);
const storm = dragon("storm-dragon", "风龙", 734, 472, 108, 368, "2", [47, 9, 1], {
  require: flag(107),
});
const earth = dragon("earth-dragon", "地龙", 893, 293, 178, 369, "3", [118, 26, 1], {
  sourceRefs: [
    source(893, 293, "3", [118, 26, 1], { kind: 5 }),
    source("sc_e_0893_1", 292, null, null, { encounterId: 369 }),
  ],
  notes: [
    "Interact with the opera switch293/entity3. Source893→292/893_1 fight→290/893_3 sets178; do not target the battle continuation as an NPC.",
  ],
});
const holy = dragon("holy-dragon", "圣龙", 879, 483, 166, 482, "5", [6, 12, 1]);
const red = dragon("red-dragon", "红龙", 809, 498, 148, 373, "47", [21, 46, 1], {
  cooperative: true,
  require: flag(143),
});
const blue = dragon("blue-dragon", "蓝龙", 889, 519, 175, 372, "9", [53, 49, 1]);
const skull = dragon("skull-dragon", "骸龙", 974, 552, 220, 371, "1", [82, 33, 1], {
  cooperative: true,
});
const gold = dragon("gold-dragon", "金龙", 981, 551, 225, 370, "1", [82, 33, 1], {
  cooperative: true,
});
const dragonReward = all(
  ...[108, 138, 148, 166, 175, 178, 220, 225, 221].map((index) => flag(index)),
  item(87),
);

// Dream-train chest states are taken from0929's rejection branches, not from
// the six chest/lever event numbers: success requires [0,0,1,1,1,0].
const dreamChestStates = [0, 0, 1, 1, 1, 0].map((value, index) =>
  step(
    `dream-train-chest-${index + 1}`,
    [923 + index],
    all({ map: 525 }, flag(index + 1, "MapLocalVariable", value)),
    {
      maps: [525],
      notes: [
        `Use this chest's ordinary toggle only if MapLocalVariable[${index + 1}] differs from${value}; do not assign the variable.`,
      ],
    },
  ),
);

export const extraOptionalCases = [
  {
    id: "dragon-ice",
    title: "八龙：冰龙",
    objectives: [ice],
    notes: ["WoR source Narshe group ev_e_0779; flag97 is also required by its map initializer."],
  },
  { id: "dragon-storm", title: "八龙：风龙与真正的佐佐山入口", objectives: [...zozoAccess, storm] },
  { id: "dragon-earth", title: "八龙：歌剧院地龙", objectives: [earth] },
  { id: "dragon-holy", title: "八龙：狂信者之塔圣龙", objectives: [holy] },
  {
    id: "dragon-red",
    title: "八龙：不死鸟洞窟红龙",
    objectives: [...phoenixEntry, red],
    notes: phoenixNotes,
    unresolved: ["Live two-party access to the dragon's ledge has not yet been runner-verified."],
  },
  { id: "dragon-blue", title: "八龙：古代城蓝龙", objectives: [...ancientHiddenRoom, blue] },
  {
    id: "dragon-skull",
    title: "八龙：瓦砾之塔骸龙",
    objectives: [towerEntry, skull],
    notes: [
      "Source physical entries to552 are from548 and550. Use ordinary three-party navigation; no dragon-room checkpoint injection.",
    ],
    unresolved: [
      "Which live tower party can reach552 before additional tower mechanisms is not yet route-verified.",
    ],
  },
  {
    id: "dragon-gold",
    title: "八龙：瓦砾之塔金龙",
    objectives: [towerEntry, gold],
    notes: [
      "Source physical entries to551 are from550 and558. Use ordinary three-party navigation.",
    ],
    unresolved: [
      "Which live tower party can reach551 before additional tower mechanisms is not yet route-verified.",
    ],
  },
  {
    id: "eight-dragons",
    title: "八龙全部讨伐与末日魔石",
    objectives: [
      ...zozoAccess,
      storm,
      ice,
      earth,
      holy,
      ...phoenixEntry,
      red,
      ...ancientHiddenRoom,
      blue,
      towerEntry,
      skull,
      gold,
      step("eight-dragons-source-reward", [], dragonReward, {
        action: "await-source",
        notes: [
          "Only the last dragon's native0975 continuation may award content87 and set221. Never call0975 directly.",
        ],
      }),
    ],
    complete: dragonReward,
    notes: [
      "Independent dragon cases do not compose persistent saves automatically. This case must acquire all eight native victory flags and content87 in one actual run.",
    ],
    unresolved: [
      "Shares the unresolved live access of the Red/Skull/Gold cases; all eight endpoints and the actual final reward are source-resolved.",
    ],
  },
  {
    id: "phoenix-locke",
    title: "不死鸟洞窟双队机关、洛克再加入与不死鸟魔石",
    members: [2],
    objectives: [
      ...phoenixRoute,
      step("phoenix-locke-return", [828, "sc_e_0828_4"], all(flag(152), item(83), { map: 262 }), {
        maps: [499],
        cooperative: true,
        require: flag(146),
        after: ["sc_e_0828_1", "sc_e_0828_2", "sc_e_0828_3", "sc_e_0828_4"],
        sourceRefs: [
          source(828, 499, "50", [6, 53, 1]),
          source("sc_e_0828_4", 262, null, null, { rewardContent: 83, memberId: 2 }),
        ],
        notes: [
          "0828_4 awards83 at op27, joins Locke at28 and sets152 at32. Cave entry or a call to0828 alone is not completion.",
        ],
      }),
    ],
    complete: all(flag(152), item(83)),
    notes: phoenixNotes,
    unresolved: phoenixUnresolved,
  },
  {
    id: "ancient-odin-raiden",
    title: "古代城停泊、奥丁与莱丁转化",
    objectives: [
      ...ancientAccess,
      odin,
      ...ancientHiddenRoom.slice(ancientAccess.length),
      step("ancient-diary", [888], flag(174), {
        maps: [518],
        sourceRefs: [source(888, 518, "6", [28, 43, 1])],
        notes: [
          "Read the source diary through its real interactable. Terra only changes the authored reaction; she is not required to set174.",
        ],
      }),
      step("raiden", [890], all(flag(176), item(88), { not: item(84) }), {
        maps: [519],
        require: flag(172),
        sourceRefs: [source(890, 519, "10", [52, 41, 1], { kind: 5 })],
        notes: [
          "Source0890 sets176, gives88 莱丁 and removes84 奥丁 at ops18..20. Keep the earlier Odin objective's observation before conversion.",
        ],
      }),
    ],
    complete: all(flag(176), item(88), { not: item(84) }),
    notes: [
      "Source stop169 unlocks250's basement exit; hidden interactable887 opens518; statue890 requires Odin172. None of these are inferred from adjacent event numbers.",
    ],
  },
  {
    id: "cyan-dream-alexander",
    title: "多玛梦境迷宫、加源必杀剑与亚历山大",
    objectives: [
      ...cyanRecruitment,
      step("dream-sleep", [895], all(flag(179), { map: 520 }), {
        maps: [300],
        party: { include: [3], minimum: 4 },
        choices: [{ script: scene(895), index: 0 }],
        sourceRefs: [source(895, 300, "8", [7, 15, 1])],
        notes: [
          "Use the sleep trigger with Cyan in the actual party. Source removes Cyan to reserve and splits the remaining members; preserve the original four-person party, not a fabricated dream roster.",
        ],
      }),
      step("dream-first-guard", [896], flag(180), { maps: [520] }),
      step("dream-first-friend", [897], flag(181), { maps: [520] }),
      step("dream-second-guard", [898], flag(182), { maps: [520] }),
      step("dream-second-friend", [899], flag(183), { maps: [520] }),
      step("dream-stooges", [901], flag(184), { maps: [521] }),
      step("dream-train-entry", [902], all(flag(185), { map: 522 }), { maps: [521] }),
      step("dream-train-cyan", [903], flag(186), { maps: [522] }),
      step("dream-train-weight", [916], flag(188), { maps: [524] }),
      step("dream-train-chest-passage", [907], flag(187), {
        maps: [524],
        require: flag(188),
        notes: [
          "0907 op2 rejects the interaction until188; its source callback then sets187. 0916 therefore precedes0907 despite their numbers.",
        ],
      }),
      ...dreamChestStates,
      step("dream-train-six-chest-check", [929], flag(192), {
        maps: [525],
        notes: [
          "0929 ops3..8 reject [1,1,0,0,0,1] respectively; successful live chest configuration is [0,0,1,1,1,0].",
        ],
      }),
      step("dream-magic-armor", [933], flag(193), { maps: [527] }),
      step("dream-cave-memory", [934], flag(194), { maps: [528] }),
      step("dream-doma-entry", [935], flag(195), { maps: [529] }),
      step("dream-family-one", [936], flag(196), { maps: [534] }),
      step("dream-family-two", [937], flag(197), { maps: [534] }),
      step("dream-family-farewell", [938], flag(198), { maps: [532] }),
      step("dream-wrexsoul", [939], all(flag(199), { map: 300 }), {
        maps: [537],
        after: ["sc_e_0939_1", "sc_e_0939_2"],
        notes: [
          "Source463 Wrexsoul→0939_1→map300/0939_2 learns Bushido and sets199 at op22. A dream-boss scene start is insufficient.",
        ],
      }),
      step("alexander", [940], all(flag(200), item(82), { map: 304 }), {
        maps: [304],
        require: flag(199),
        sourceRefs: [source(940, 304, "1", [25, 7, 2])],
        notes: [
          "Return to the actual throne-room reward. Source0940 gives82 亚历山大; map304 only publishes its group after199 and before200.",
        ],
      }),
    ],
    complete: all(flag(199), flag(200), item(82)),
    notes: [
      "The persistent stage flags follow source ChangeMap continuations and source guards, not a numerical sweep of0895..0940.",
    ],
    unresolved: [
      "The live map524 sliding-box/lever route uses0904/0906 AreaLocalVariable state; only its required188→187 source guard has been resolved here. No runner attempt has verified that route.",
      "Map525 chest-state objectives require live re-reading after each ordinary toggle and staying in that map; resetting local banks or assuming every chest begins closed is prohibited.",
      "Full portal traversal of the dream caves and all eight learned Bushido abilities still require runtime acceptance; source completion flags do not independently prove that ability-learning implementation.",
    ],
  },
];
