// Source-linked ordinary-input cases only. Extra metadata describes unresolved
// host predicates or source services; it never authorizes flag/position writes.
import { optionalCases } from "./optional-cases.mjs";
import { storyChapters } from "../../src/play/story-plan.js";

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
const worStart = "build/play/stage1-checkpoints/kefka-tower.json";
const beforeShadowChoice = "build/play/stage1-checkpoints/escape-continent.json";
const relmObjectives = structuredClone(optionalCases.find((test) => test.id === "relm").objectives);
const worMainObjectives = structuredClone(
  storyChapters.find((chapter) => chapter.id === "M8").objectives,
);

export const recruitOptionalCases = [
  {
    id: "terra",
    title: "莫布里兹两次洪巴巴事件与蒂娜永久再加入",
    members: [1],
    startSave: worStart,
    objectives: [
      step("mobliz-arrival", [648], flag(61), {
        maps: [212],
        sourceRefs: [source(648, 212, "46", [52, 57, 1])],
      }),
      step("mobliz-terra-story", [649, "sc_e_0649_2"], flag(62), {
        maps: [212],
        sourceRefs: [source(649, 212, "66", [50, 44, 1])],
        notes: [
          "The child conversation's actual649→583/649_1→212/649_2 chain sets62;650 is not yet available before that.",
        ],
      }),
      step("humbaba-first-visit", [650, "sc_e_0650_3"], flag(63), {
        maps: [212],
        sourceRefs: [source(650, 212, "44", [52, 58, 1])],
        after: ["sc_e_0650_1", "sc_e_0650_2", "sc_e_0650_2_1", "sc_e_0650_3"],
        notes: [
          "650_1 temporarily joins Terra for formation421.650_2 removes her, then starts422. Do not count the temporary join as recruitment.",
        ],
      }),
      step("mobliz-fenrir", [651], all(flag(64), item(78)), {
        maps: [212],
        notes: ["651 awards actual content78 芬里尔, sets64 and AreaLocalVariable[1]=1."],
      }),
      step(
        "leave-mobliz-first-visit",
        [],
        { map: 2 },
        {
          action: "visit-map",
          maps: [2],
          notes: [
            "Actually leave the area:210 initializer requires AreaLocalVariable[1]=0 for the return-visit trigger. Do not clear the bank directly.",
          ],
        },
      ),
      step("mobliz-return-child", [706], flag(98), {
        maps: [210],
        require: all(flag(64), flag(97)),
        sourceRefs: [source(706, 210, "7", [11, 24, 2])],
      }),
      step("mobliz-katarin", [707], flag(99), {
        maps: [213],
        sourceRefs: [source(707, 213, "1", [40, 52, 1])],
        notes: [
          "This is the authored basement event; its99 enables709. It is not an inferred numerical predecessor.",
        ],
      }),
      step("terra-permanent-return", [709, "sc_e_0709_3"], flag(100), {
        maps: [213],
        sourceRefs: [source(709, 213, "9", [40, 50, 1])],
        after: ["sc_e_0709_1", "sc_e_0709_2", "sc_e_0709_3"],
        notes: [
          "709_1 starts423;709_2 joins Terra and starts424;709_3 op85 sets100 after the real event. Require actual member1 availability as well.",
        ],
      }),
    ],
    complete: all(flag(100), item(78)),
    sourcePreconditions: [
      "WoR world change41=1; Falcon97=1; initial visit64 is not set in the default checkpoint.",
    ],
    notes: [
      "Both Humababa source chains and the real area departure are included. Mere visitation or650_1's temporary roster change cannot complete this case.",
    ],
    unresolved: [
      "The current source navigation through the underground Mobliz rooms has not been exercised by this manifest yet.",
    ],
  },
  {
    id: "gau",
    title: "废墟世界兽原自然遭遇中嘎再加入",
    members: [12],
    startSave: worStart,
    objectives: [
      step(
        "gau-veldt-return",
        [],
        { memberAvailable: 12 },
        {
          action: "fixed-field-route",
          maps: [2],
          party: { maximum: 3 },
          walkBetween: [
            [228, 84],
            [229, 84],
          ],
          battleInput: { monsterId: 550, abilityId: 2 },
          sourceRefs: [
            {
              mapId: 2,
              terrainCells: [
                [228, 84],
                [229, 84],
              ],
              footType: 32,
              footCollision: 0,
            },
            { script: "sc_b_0738", opIndex: 52, sourceCall: "メンバー加入：ガウ", memberId: 12 },
            { script: "sc_ai_549_Gau", sourceMonsterId: 550, mode: 1 },
          ],
          notes: [
            "Both declared world2 cells are actual PR Veldt foot32 and walkable on foot; use ordinary airship travel/landing and walking, never encounter() or a synthesized formation.",
            "Default checkpoint has Celes/Edgar/Setzer, leaving a real fourth slot. In another save, choose at most three active members through the actual formation menu first.",
            "Source sc_b_0738 replaces a defeated Veldt formation with returning Gau. Defend only while actual monster550 is present, allowing the source time/mode1 branch to join him; ordinary encounters otherwise use the frozen battle policy.",
            "WoR Gau can return by elapsed source AI state without Dried Meat. Do not grant food, set his mode, mark the member enabled, or write a stand-in recruitment flag.",
          ],
        },
      ),
    ],
    complete: { memberAvailable: 12 },
    sourcePreconditions: [
      "Real Veldt battle history contains eligible formations; the default main checkpoint has eligible recorded encounters and Gau unavailable.",
      "WoR battle selector uses ScenarioFlag2[44]=1; party size must be less than four.",
    ],
    notes: [
      "No new field flag marks this join:0738 op52 is an actual battle roster mutation. Member availability, not source0738 scene history, is the acceptance condition.",
    ],
    unresolved: [
      "memberAvailable is a required host-only read predicate; the existing core storyCondition does not implement it. Runner integration must read actual roster availability instead of inventing a source flag.",
      "Veldt appearance probability/pool rotation are current logged runtime approximations; natural walking may need several source encounters. Do not force RNG or preselect an encounter.",
    ],
  },
  {
    id: "strago",
    title: "莉姆在队时唤回狂信者之塔的斯特拉格斯",
    members: [8],
    startSave: worStart,
    objectives: [
      ...relmObjectives,
      step("strago-return", [776], flag(136), {
        maps: [476],
        party: { include: [9] },
        sourceRefs: [source(776, 476, "25", [13, 12, 1])],
        notes: [
          "sc_map_30700 op5 BranchByCharacter9 gates ev_e_0776: Relm must be in the actual active party, not merely recruited or historically seen.",
          "776 sets136 and joins Strago at58/59; if the active party is full the other source branch joins then sends him to reserve. Both require real member8 availability.",
        ],
      }),
    ],
    complete: flag(136),
    sourcePreconditions: [
      "The default checkpoint left Shadow behind, so its real Veldt-cave rescue branch yields Relm. Reuse the current source-derived Relm case; do not borrow an alive-Shadow recovery path.",
    ],
    notes: [
      "Relm prerequisites are cloned from the root-owned case to avoid separate stale or numerically inferred Owzer event sequences.",
    ],
    unresolved: [
      "Shares any still-unresolved live Owzer route in the current Relm manifest. Do not claim Strago passed until that real chain and active-Relm entry run.",
    ],
  },
  {
    id: "shadow",
    title: "浮游大陆等待生还、兽原救援与斗技场影忍再加入",
    members: [4],
    startSave: beforeShadowChoice,
    unavailableStarts: [
      {
        file: worStart,
        reason:
          "This actual save has world-change41=1 and survival42=0. Shadow died on that route; no WoR action may revive him.",
      },
    ],
    sourceCheckpoint: {
      file: beforeShadowChoice,
      mapId: 631,
      position: [108, 23, 2],
      time: 6633.800000006602,
      flags: { worldChanged41: 0, waitIntent40: 0, shadowSurvived42: 0 },
      timer: { remaining: 346.799999999997, duration: 360, paused: true },
      notes:
        "Existing actual pre607 snapshot, last source0606_1. Positions/timer are observations only and must never be assigned to a game.",
    },
    objectives: [
      step("shadow-choose-wait", [607], flag(40), {
        maps: [631, 431],
        choices: [{ script: scene(607), index: 1 }],
        sourceRefs: [source(607, 631, "11", [115, 25, 2])],
        notes: [
          "Choose wait index1.607 op25 sets intent40 and resumes the real deadline.40 alone does not mean Shadow survived.",
        ],
      }),
      step("shadow-survives", [], flag(42), {
        action: "fixed-field-route",
        waitUntil: { script: "sc_e_0609" },
        maps: [631, 431],
        walkBetween: [
          [112, 23],
          [112, 24],
        ],
        choices: [{ script: scene(607), index: 1 }],
        after: ["sc_e_0609", "sc_e_0608"],
        sourceRefs: [
          source(608, 631, "168", [112, 23, 2]),
          source(609, 631, null, null, { opIndex: 2, entityGroup: "ev_e_0608" }),
        ],
        notes: [
          "Wait at the actual cliff until source609 publishes arrival triggers, then take ordinary nearby steps. No fast-forward or timer write.",
          "Timed609 publishes608's trigger group;608 op11 sets actual survival42 and op12 enters119. Never invoke either script from the harness.",
        ],
      }),
      // The source collapse chain runs automatically after608. Continue the
      // existing authored-input M8 plan from its actual island state, keeping
      // this replay's survival flag and roster rather than swapping in a WoR save.
      ...worMainObjectives,
      step("shadow-veldt-interceptor", [741], flag(115)),
      step("shadow-striker-treasure", [], item(135), {
        action: "fixed-field-route",
        maps: [491],
        walkBetween: [[42, 26]],
        finalEntityId: "9",
        sourceRefs: [
          {
            mapId: 491,
            entityId: "9",
            position: [42, 26, 1],
            treasureFlag: ["TreasureFlag1", 185],
            rewardContent: 135,
          },
        ],
        notes: [
          "Open the actual Veldt cave treasure:content135 一击之刃 is weapon43. Neither content102 nor ScenarioVariable10 denotes this wager item.",
        ],
      }),
      step("shadow-cave-rescue", [744, "sc_e_0744_6"], flag(116), {
        maps: [492],
        require: flag(42),
        after: [
          "sc_e_0744_1",
          "sc_e_0744_2",
          "sc_e_0744_3",
          "sc_e_0744_4",
          "sc_e_0744_5",
          "sc_e_0744_6",
        ],
        notes: [
          "Alive flag42 makes744 use the Shadow branch and real boss453; the actual transport/recovery chain ends in map311 and sets116. Dead42=0 follows Relm117 instead.",
        ],
      }),
      step("shadow-leave-thamasa", [], { map: 2 }, { action: "visit-map", maps: [2] }),
      step("shadow-colosseum", [676], flag(119), {
        maps: [279],
        choices: [{ script: scene(676), index: 0 }],
        colosseum: { wagerContentId: 135, expectedRecruitId: 4, sourceContinuation: "sc_e_0750" },
        notes: [
          "Use the actual Colosseum受付0676, wager the owned item through its real input interface, finish the battle and let native750 run. No direct750 target or reward injection.",
          "Active0750 starts Jump8;ops3..7 are dormant tally code. Source join is23 and flag119 is24, not a fabricated ScenarioVariable10 predicate.",
        ],
      }),
    ],
    complete: all(flag(42), flag(116), flag(119)),
    notes: [
      "This is one continuous replay from a real pre607 checkpoint through the existing WoR main plan. It must never switch to the dead-Shadow kefka-tower snapshot halfway through.",
    ],
    unresolved: [
      "The runner honors the real pre607 start; source609/608 now prove survival42. The continuous M8 replay and final wager/recruitment must still pass before this entire case is accepted.",
      "The PR colosseum dictionaries and actual116/119 special pairing are implemented. No test may dispatch750 or fabricate the opponent; the actual cave rescue and owned135 wager remain mandatory.",
    ],
  },
];
