// Source acceptance inputs only. The real checkpoint already owns62,66..73;
// those nine stones are excluded. Its uncollected63..65 remain optional pickups.
// Existing cases own82/83/84/87/88 (Alexander/Phoenix/Odin/eight dragons/Raiden).
// This leaves thirteen distinct content rewards in eleven cases. The inventory's
// 38 GetItem sites include duplicated world variants and eight dragon callbacks,
// not38 different espers. No case writes a bank, grants Gil, or starts a script.
import { optionalCases } from "./optional-cases.mjs";

const scene = (n) => (typeof n === "number" ? `sc_e_${String(n).padStart(4, "0")}` : n);
const flag = (index, bank = "ScenarioFlag2") => ({ flag: [bank, index, 1] });
const item = (id) => ({ item: [id, 1] });
const all = (...conditions) => ({ all: conditions });
const step = (id, scripts, complete, extra = {}) => ({
  id,
  scripts: scripts.map(scene),
  complete,
  ...extra,
});
const source = (script, mapId, entityId, position, extra = {}) => ({
  script: scene(script),
  mapId,
  entityId,
  position,
  ...extra,
});
const valigarmanda = step("esper-valigarmanda", [780], all(flag(139), item(79)), {
  maps: [20],
  require: flag(97),
  after: [scene("sc_e_0780_1")],
  sourceRefs: [
    source(780, 20, "1", [19, 14, 1], {
      kind: 2,
      group: "ev_e_0780",
      encounterId: 488,
      rewardOp: 25,
      rewardScript: "sc_e_0780_1",
      rewardContent: 79,
    }),
  ],
  notes: [
    "Map20 initializer publishes0780 only in WoR while139 is clear;0780_1 gives79 and sets139. Mog is required for Umaro recruitment, not for these two magicite rewards.",
  ],
});
const relm = structuredClone(optionalCases.find((test) => test.id === "relm").objectives);
relm[relm.length - 1] = {
  ...relm.at(-1),
  id: "esper-lakshmi-reward",
  complete: all(flag(135), item(81)),
  sourceRefs: [
    source(775, 446, "8", [80, 13, 1], {
      kind: 5,
      group: "ev_e_0774",
      rewardOp: 17,
      rewardContent: 81,
    }),
  ],
};

export const esperOptionalCases = [
  {
    id: "esper-zozo-pickups",
    title: "佐佐遗留的凯特·西斯、塞壬与麒麟魔石",
    objectives: [
      step("esper-cait-sith", [304], all(flag(151, "ScenarioFlag1"), item(65)), {
        maps: [395],
        require: flag(149, "ScenarioFlag1"),
        sourceRefs: [
          source(304, 395, "22", [83, 12, 1], {
            kind: 10,
            group: "ev_e_0304",
            rewardOp: 4,
            rewardContent: 65,
          }),
        ],
      }),
      step("esper-siren", [305], all(flag(152, "ScenarioFlag1"), item(64)), {
        maps: [395],
        sourceRefs: [
          source(305, 395, "23", [82, 11, 1], {
            kind: 10,
            group: "ev_e_0305",
            rewardOp: 4,
            rewardContent: 64,
          }),
        ],
      }),
      step("esper-kirin", [306], all(flag(153, "ScenarioFlag1"), item(63)), {
        maps: [395],
        sourceRefs: [
          source(306, 395, "24", [81, 12, 1], {
            kind: 10,
            group: "ev_e_0306",
            rewardOp: 4,
            rewardContent: 63,
          }),
        ],
      }),
    ],
    complete: all(item(65), item(64), item(63)),
    notes: [
      "Unlike Ramuh62, these three contents are absent from the actual kefka-tower checkpoint. Map395 initializer gates each remaining pickup by149 and its own151/152/153; it has no WoR97 exclusion.",
    ],
    unresolved: [
      "Late-world ordinary access back to map395 has not been exercised by this manifest; use the current source graph, never a direct room restore.",
    ],
  },
  ...[
    {
      id: "esper-golem-auction",
      title: "吉多尔拍卖巨像兵",
      content: 74,
      flagId: 204,
      rewardScript: 422,
      rewardOp: 89,
      feeGroup: 206,
      fee: 20000,
    },
    {
      id: "esper-zone-seeker-auction",
      title: "吉多尔拍卖虚无探索者",
      content: 75,
      flagId: 205,
      rewardScript: 423,
      rewardOp: 82,
      feeGroup: 205,
      fee: 10000,
    },
  ].map((reward) => ({
    id: reward.id,
    title: reward.title,
    objectives: [
      step(reward.id, [422], all(flag(reward.flagId, "ScenarioFlag1"), item(reward.content)), {
        maps: [288],
        require: flag(203, "ScenarioFlag1"),
        after: [scene(reward.rewardScript)],
        choices: [422, 423].map((script) => ({ script: scene(script), index: 0 })),
        sourceRefs: [
          source(422, 288, "5", [16, 22, 2], {
            kind: 6,
            rewardScript: scene(reward.rewardScript),
            rewardOp: reward.rewardOp,
            rewardContent: reward.content,
            feeGroup: reward.feeGroup,
            fee: reward.fee,
          }),
        ],
        repeat: {
          leaveMap: 288,
          when: { flag: ["MapLocalVariable", 1, 1] },
          viaMap: 282,
          reenterMap: 288,
          reason:
            "Source0422/0423 sets MapLocalVariable[1]; a new visit clears the auction-session latch and permits another original random lot.",
        },
      }),
    ],
    complete: all(flag(reward.flagId, "ScenarioFlag1"), item(reward.content)),
    notes: [
      "Use the ordinary auctioneer0422. Source SetRandomValue chooses the lot and may call0423; selecting the later reward script directly would bypass that draw.",
      `PR product group${reward.feeGroup} charges${reward.fee} actual Gil. Do not generate money; the supplied checkpoint currently has59774 Gil, and each case restores it independently.`,
    ],
    unresolved: [
      "The runner needs an ordinary leave/reenter retry for non-winning/random non-esper lots; repeat is source input metadata, not permission to reset MapLocalVariable or force RNG. Existing default Select0 can buy an unrelated lot, so lack of the required funds must remain a real stop.",
    ],
  })),
  {
    id: "esper-seraph",
    title: "慈恩镇购买炽天使魔石",
    objectives: [
      step("esper-seraph", [640], all({ any: [flag(57), flag(206, "ScenarioFlag1")] }, item(76)), {
        maps: [201],
        choices: [{ script: scene(640), index: 0 }],
        sourceRefs: [
          source(640, 201, "1", [34, 3, 1], {
            kind: 6,
            feeGroup: 209,
            fee: 10,
            rewardOp: 9,
            rewardContent: 76,
          }),
        ],
      }),
    ],
    complete: all({ any: [flag(57), flag(206, "ScenarioFlag1")] }, item(76)),
    notes: [
      "WoR source0640 charges PR product group209=10 Gil and sets57. WoB0427/map132 is the alternate purchase site (flag1[206]), not a second stone.",
    ],
  },
  {
    id: "esper-quetzalli",
    title: "孤岛海岸绿咬鹃魔石",
    objectives: [
      step("esper-quetzalli", [963], all(flag(215), item(77)), {
        maps: [192],
        require: flag(97),
        sourceRefs: [
          source(963, 192, "12", [19, 6, 0], {
            kind: 10,
            group: "ev_e_0963",
            rewardOp: 3,
            rewardContent: 77,
          }),
        ],
      }),
    ],
    complete: all(flag(215), item(77)),
    notes: [
      "Map192 beach initializer publishes0963 after WoR97 while215 is clear. Return to the real Solitary Island shore by Falcon and its ordinary world entrance; Cid's health is not a prerequisite.",
    ],
  },
  {
    id: "esper-fenrir",
    title: "莫布利兹初次袭击与芬里尔魔石",
    objectives: [
      step("fenrir-terra-children", [648], flag(61), {
        maps: [212],
        sourceRefs: [source(648, 212, "46", [52, 57, 1], { kind: 2, group: "ev_e_0648" })],
      }),
      step("fenrir-terra-memory", [649], flag(62), {
        maps: [212],
        after: ["sc_e_0649_1", "sc_e_0649_2"],
        sourceRefs: [source(649, 212, "66", [50, 44, 1], { kind: 6, group: "ev_e_0649" })],
      }),
      step("fenrir-humbaba", [650], flag(63), {
        maps: [212],
        after: ["sc_e_0650_1", "sc_e_0650_2", "sc_e_0650_2_1", "sc_e_0650_3"],
        sourceRefs: [
          source(650, 212, "44", [52, 58, 1], { kind: 2, group: "ev_e_0650", encounterId: 422 }),
        ],
      }),
      step("esper-fenrir", [651], all(flag(64), item(78)), {
        maps: [212],
        require: flag(63),
        sourceRefs: [
          source(651, 212, "43", [50, 53, 1], {
            kind: 2,
            group: "ev_e_0651",
            rewardOp: 6,
            rewardContent: 78,
          }),
        ],
      }),
    ],
    complete: all(flag(64), item(78)),
    notes: [
      "Checkpoint flags61..64 are all clear: late Terra recruitment0703 did not collect this first-visit reward. Source map212 independently publishes0648/0649/0650/0651 under those exact flags; the memory transfers through583 and the fight through207 before returning to212.",
    ],
    unresolved: [
      "The source first-visit Terra/Humbaba event includes authored temporary membership and battle returns; this late-checkpoint ordering has not yet been actually run. Do not skip the three prerequisite source scenes simply because Terra is already recruited.",
    ],
  },
  {
    id: "esper-valigarmanda",
    title: "纳尔谢冻结幻兽与艳翼蛇鸟魔石",
    objectives: [structuredClone(valigarmanda)],
    complete: all(flag(139), item(79)),
  },
  {
    id: "esper-midgardsormr",
    title: "雪人洞窟骨雕与尘世巨蟒魔石",
    objectives: [
      structuredClone(valigarmanda),
      step("esper-midgardsormr", [789], all(flag(141), item(80)), {
        maps: [496],
        require: flag(139),
        choices: [{ script: scene(789), index: 0 }],
        after: ["sc_e_0789_1"],
        sourceRefs: [
          source(789, 496, "6", [57, 15, 1], {
            kind: 5,
            group: "ev_e_0789",
            encounterId: 444,
            rewardScript: "sc_e_0789_1",
            rewardOp: 3,
            rewardContent: 80,
          }),
        ],
      }),
    ],
    complete: all(flag(141), item(80)),
    notes: [
      "Valigarmanda139 exposes the original post-battle cliff/hole route; source0789 is the skull interaction and actual Umaro battle444. Stop at the magicite reward141; only the separate0790 recruitment needs Mog.",
    ],
  },
  {
    id: "esper-lakshmi",
    title: "欧泽公馆吉祥天女魔石",
    objectives: relm,
    complete: all(flag(135), item(81)),
    notes: [
      "Reuse the already sourced Relm/Owzer input chain, but assert GetItem81 as well as135. The final reward is the real map446 bookshelf interaction after Chadarnook134, not the boss fight alone.",
    ],
  },
  {
    id: "esper-bahamut-deathgaze",
    title: "死亡凝视飞行遭遇与巴哈姆特魔石",
    objectives: [
      step("esper-bahamut", [], all(flag(216), item(85)), {
        action: "await-source",
        maps: [2],
        navigation: "airship",
        flightEncounter: {
          vehicleId: 5,
          departureScript: "sc_e_FAoutboard",
          sourceScript: "sc_e_0964",
          encounterId: 464,
          monsterId: 286,
          group: "ev_e_0964",
          entityIds: ["157", "171", "172", "173", "174", "175", "176", "177", "178", "179"],
        },
        sourceRefs: [
          source(964, 2, "157", [260, -3, 0], {
            kind: 2,
            placement: "デスゲイズ配置",
            placeholderOnly: true,
          }),
          source("sc_e_0964_2", 268, null, null, { rewardOp: 17, rewardContent: 85 }),
        ],
        notes: [
          "Deathgaze/DoomGaze is PR monster286, formation464, AI sc_ai_11D_Deathgaze and event sc_b_2023. World initializer publishes ten off-map source trigger bodies then asks the placement host to locate them. The listed260,-3 position is an authored placeholder, never a destination to fly to.",
          "Only real flight contact may run0964. Its source0964_1 tests ScenarioVariable[3]>0: surviving HP re-places the encounter; zero HP goes through map268/0964_2, sets216 and gives85, then resumes Falcon flight.",
        ],
      }),
    ],
    complete: all(flag(216), item(85)),
    unresolved: [
      "The regression fixture reads the actual hidden contact-body location only to choose cardinal flight inputs. Discovery difficulty is not assessed. An old unplaced world save must go through the real deck/pilot/world initializer, never enter a map or start0964/464 directly.",
    ],
  },
  {
    id: "esper-ragnarok",
    title: "纳尔谢武器屋选择诸神之黄昏魔石",
    requiresCases: ["phoenix-locke"],
    objectives: [
      step("ragnarok-unlock-door", [868], flag(156), {
        maps: [3],
        party: { include: [2] },
        sourceRefs: [source(868, 3, "116", [32, 31, 1], { kind: 5, group: "ev_e_0703" })],
      }),
      step("esper-ragnarok", [873], all(flag(161), item(86)), {
        maps: [10],
        require: flag(156),
        choices: [{ script: scene(873), index: 0 }],
        sourceRefs: [
          source(873, 10, "8", [5, 12, 2], {
            kind: 6,
            group: "ev_e_0873",
            rewardOp: 24,
            rewardContent: 86,
          }),
          source(873, 10, "ev_e_0873:0:0", [5, 12, 1], { kind: 5 }),
        ],
      }),
    ],
    complete: all(flag(161), item(86)),
    notes: [
      "Use an actual Phoenix/Locke result save, or run that existing prerequisite case first. Source0868 checks Locke really present before setting156; map10 then publishes0873. Select0 keeps magicite86, Select1 instead gives sword121 and irreversibly shares161.",
      "Duncan0954 is not an esper: it learns Sabin's Phantom Rush and sets208. Master Scroll content310 is armor114/type3, dropped by Samurai Soul293; neither belongs in this27-magicite list.",
    ],
    unresolved: [
      "Independent batch cases normally restore the same checkpoint; requiresCases must chain the real Phoenix save or visibly report Locke unavailable. Do not fabricate member2 or flag156.",
    ],
  },
];
