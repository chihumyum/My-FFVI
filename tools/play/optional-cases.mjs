// Acceptance objectives name original PR events and their source completion
// flags. They are inputs/assertions, never alternate event implementations.
const flag = (index, bank = "ScenarioFlag2") => ({ flag: [bank, index, 1] });
const step = (id, scripts, complete, extra = {}) => ({
  id,
  scripts: scripts.map((n) => (typeof n === "number" ? `sc_e_${String(n).padStart(4, "0")}` : n)),
  complete,
  ...extra,
});
const mog = step("mog", [778], flag(137));
export const optionalCases = [
  { id: "mog", title: "莫古再加入", members: [11], objectives: [mog] },
  {
    id: "umaro",
    title: "乌玛洛加入",
    members: [14],
    objectives: [
      mog,
      step("valigarmanda", [780], flag(139)),
      step("umaro-battle", [789], flag(141)),
      step("umaro", [790], flag(142), { party: { include: [11] } }),
    ],
  },
  {
    id: "cyan",
    title: "佐佐山与加源再加入",
    members: [3],
    objectives: [
      step("lola-introduction", [726], flag(101)),
      step("leave-lola-house", [], { map: 274 }, { action: "visit-map", maps: [274] }),
      step("lola-letter", [727], flag(102)),
      step("carrier-pigeon", [725, 729, "sc_e_0729_2"], flag(103)),
      step("visit-zozo", [], { map: 383 }, { action: "visit-map", maps: [383] }),
      step("rust-rid", [731], flag(105)),
      step("rusted-door", [732], flag(106)),
      step("zozo-door", [733], flag(107)),
      step("cyan", [735, "sc_e_0735_2"], flag(109)),
    ],
  },
  {
    id: "relm",
    title: "欧泽公馆与莉姆再加入",
    members: [9],
    notes: "The baseline source run left Shadow behind; the Veldt cave therefore contains Relm.",
    objectives: [
      step("veldt-interceptor", [741], flag(115)),
      step("veldt-rescue-relm", [744, "sc_e_0745_1"], flag(117)),
      // The rescue keeps AreaLocalVariable[1] set until leaving Thamasa;
      // sc_e_0755 must see the next visit rather than the recovery visit.
      step("leave-thamasa", [], { map: 2 }, { action: "visit-map", maps: [2] }),
      step("thamasa-relm-departure", [755], flag(122)),
      step("owzer-entry", [756], flag(123)),
      step("owzer-diary", [757], flag(65, "ScenarioFlag3")),
      step("owzer-light", [758], flag(124)),
      step("owzer-painting-one", [761], flag(125)),
      step("owzer-painting-two", [762], flag(126)),
      step("owzer-painting-three", [763], flag(128)),
      step("owzer-flowers", [767], flag(129)),
      step("owzer-chair", [768], flag(130)),
      step("owzer-chest", [769], flag(131)),
      step("owzer-chest-two", [770], flag(132)),
      step("owzer-boss-door", [771], flag(133)),
      step("chadarnook", [773], flag(134)),
      step("relm", [775], flag(135)),
    ],
  },
  {
    id: "gogo",
    title: "吞空巨虫与格格加入",
    members: [13],
    objectives: [
      step(
        "zone-eater-entry",
        [],
        { map: 500 },
        {
          action: "fixed-field-route",
          maps: [2],
          walkBetween: [
            [236, 42],
            [237, 42],
          ],
          battleInput: { monsterId: 370, abilityId: 2 },
          notes:
            "PR world2 encount_grid cells area267, foot28, set454: every weighted slot is formation336. Defend is a fixed quest input to allow Engulf.",
        },
      ),
      step("gogo", [865], flag(154)),
    ],
  },
  {
    id: "sabin",
    title: "慈恩镇救人与马修再加入",
    members: [6],
    objectives: [
      step("tzen-collapse", [634], flag(53)),
      step("tzen-rescue-start", [636], flag(54)),
      step("tzen-child", [637], flag(55)),
      step("sabin", [639], flag(56)),
    ],
  },
];
