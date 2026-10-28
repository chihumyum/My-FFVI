import { tr, language } from "../../src/play/i18n.js";
import { configureGogo, effectiveCommandIds, blitzInputs } from "../../src/play/battle-commands.js";
import { canEquip } from "../../src/play/resources.js";
import { abilityMpCost } from "../../src/play/progression.js";
import { partyFieldAsset } from "../../src/play/appearance.js";

const pageKeys = [
  "common.party",
  "common.items",
  "common.magic",
  "common.magicite",
  "common.skills",
  "common.equipment",
  "common.relics",
  "common.status",
  "common.formation",
  "common.settings",
];
const pages = ["队伍", "道具", "魔法", "魔石", "技能", "装备", "饰品", "状态", "队列", "设置"];
export function renderPartyMenu(
  game,
  elements,
  refresh,
  createElement = document.createElement.bind(document),
  state = {},
  callbacks = {},
) {
  const data = game.battleData;
  state.page ||= "队伍";
  const unit = game.party.find((u) => u.id === state.member) || game.party[0];
  state.member = unit?.id;
  const node = (tag, text) => {
    const n = createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (label, action, disabled = false) => {
    const n = node("button", label);
    n.onclick = action;
    n.disabled = disabled;
    return n;
  };
  const text = (parent, value) => parent.append(node("p", value));
  const columns = (weights, children) => {
    const row = node("columns");
    row.dataset.weights = weights.join(",");
    row.append(...children);
    return row;
  };
  const stat = (label, value) => {
    const row = node("stat", label);
    row.value = String(value ?? 0);
    return row;
  };
  const group = (...children) => {
    const box = node("div");
    box.append(...children);
    return box;
  };
  const name = (id) =>
    data.contentNames?.[id] ||
    game.text(data.contents?.[id]?.mes_id_name || "") ||
    tr("party_menu.item_value", { v0: id });
  const description = (id) => {
    const key = data.contents?.[id]?.mes_id_description;
    return key && key !== "None" ? game.text(key) : "";
  };
  const select = (label, values, value, change) => {
    const n = node("select");
    n.setAttribute("aria-label", label);
    for (const [id, label] of values) {
      const option = node("option", label);
      option.value = id;
      n.append(option);
    }
    n.value = value;
    n.onchange = () => change(n.value);
    return n;
  };
  const run = (action) => {
    const ok = action();
    refresh();
    if (ok === false)
      text(
        elements.items,
        tr("party_menu.cannot_use_this_now_check_the_target_equipment_restrict"),
      );
  };
  const target = (label, action) => {
    elements.items.replaceChildren(node("h2", label));
    for (const u of game.party)
      elements.items.append(button(`${u.name}  HP ${u.hp}/${u.maxHp}`, () => run(() => action(u))));
    elements.items.append(button(tr("party_menu.back"), refresh));
  };
  elements.navigation?.replaceChildren();
  elements.party.replaceChildren();
  elements.items.replaceChildren();
  for (const page of pages)
    elements.navigation?.append(
      button(
        tr(pageKeys[pages.indexOf(page)]),
        () => {
          state.page = page;
          delete state.notice;
          refresh();
        },
        state.page === page,
      ),
    );
  elements.navigation?.append(button(tr("app.save"), () => callbacks.save?.()));
  text(
    elements.party,
    `${callbacks.location || tr("app.current_location")}     Gil ${game.gil}     ${Math.floor(game.time / 3600)}:${String(Math.floor(game.time / 60) % 60).padStart(2, "0")}`,
  );
  if (!["队伍", "道具", "设置", "队列"].includes(state.page))
    for (const u of game.party)
      elements.party.append(
        button(
          u.name,
          () => {
            state.member = u.id;
            delete state.notice;
            refresh();
          },
          u === unit,
        ),
      );
  elements.items.append(node("h2", state.page));
  if (state.notice) {
    const notice = node("p", state.notice);
    notice.dataset.notice = "equipment";
    elements.items.append(notice);
  }
  const portrait = (u, parent) => {
    const image = node("img");
    image.dataset.actorId = String(u.id);
    image.setAttribute("aria-label", u.name);
    parent.append(image);
  };
  const figure = (u, selected = false) => {
    const image = node("formation-lane");
    const asset = partyFieldAsset(game.data, u).toLowerCase();
    image.figure = {
      asset,
      character: game.data.characters?.[asset],
      animation: "WalkL",
      active: selected,
      row: u.row === "back" ? "back" : "front",
    };
    image.setAttribute(
      "aria-label",
      `${u.name} · ${u.row === "back" ? tr("battle_menu.back_row") : tr("battle_menu.front_row")}`,
    );
    return image;
  };
  const spells = (u) =>
    [...new Set((u.abilities || []).map((x) => (typeof x === "object" ? x.id : x)))]
      .map((id) => data.abilities[id])
      .filter(
        (a) =>
          a && (data.commands[7]?.abilityTypes?.includes(a.typeId) || (a.id >= 31 && a.id <= 84)),
      );
  if (state.page === "队伍") {
    for (const u of game.party) {
      const card = node("fieldset");
      portrait(u, card);
      card.append(
        node(
          "legend",
          `${u.name}  Lv ${u.level}  ${u.row === "back" ? tr("battle_menu.back_row") : tr("battle_menu.front_row")}`,
        ),
      );
      text(card, `HP ${u.hp} / ${u.maxHp}     MP ${u.mp} / ${u.maxMp}`);
      text(
        card,
        tr("party_menu.exp_value_magicite_value", {
          v0: u.exp || 0,
          v1: data.magicStones?.[u.magicite]?.name || tr("party_menu.unequipped"),
        }),
      );
      card.append(
        button(tr("party_menu.view_status"), () => {
          state.page = "状态";
          state.member = u.id;
          refresh();
        }),
      );
      elements.items.append(card);
    }
  } else if (state.page === "道具") {
    elements.items.append(
      select(
        tr("party_menu.sort_items"),
        [
          ["source", tr("party_menu.original_order")],
          ["type", tr("party_menu.sort_by_type")],
          ["name", tr("party_menu.sort_by_name")],
          ["count", tr("party_menu.sort_by_quantity")],
        ],
        state.sort || "source",
        (value) => {
          state.sort = value;
          refresh();
        },
      ),
    );
    const entries = Object.entries(game.inventory)
      .filter(([, count]) => count > 0)
      .map(([id, count]) => ({ id: Number(id), count }));
    entries.sort((a, b) =>
      state.sort === "name"
        ? name(a.id).localeCompare(name(b.id), language())
        : state.sort === "count"
          ? b.count - a.count || a.id - b.id
          : state.sort === "type"
            ? (data.contents[a.id]?.type_id || 0) - (data.contents[b.id]?.type_id || 0) ||
              a.id - b.id
            : a.id - b.id,
    );
    if (!entries.length) text(elements.items, tr("party_menu.no_items_held"));
    for (const { id, count } of entries) {
      const content = data.contents[id],
        item = content?.type_id === 1 && data.items[content.type_value];
      const row = node("fieldset");
      const label = node("legend", `${name(id)} ×${count}`);
      label.dataset.contentId = String(id);
      row.append(label);
      text(row, description(id));
      if (item?.menu_function_group_id > 0)
        row.append(
          button(tr("party_menu.use"), () => target(name(id), (u) => game.useItem(id, u.id))),
        );
      elements.items.append(row);
    }
  } else if (state.page === "设置") {
    for (const [key, label, choices] of [
      [
        "atbMode",
        tr("party_menu.atb_mode"),
        [
          ["wait", tr("party_menu.wait")],
          ["active", tr("party_menu.active")],
        ],
      ],
      [
        "battleSpeed",
        tr("party_menu.battle_speed"),
        Array.from({ length: 6 }, (_, i) => [i, String(i + 1)]),
      ],
      [
        "textSpeed",
        tr("party_menu.text_speed"),
        Array.from({ length: 6 }, (_, i) => [i, String(i + 1)]),
      ],
      [
        "volume",
        tr("party_menu.volume"),
        Array.from({ length: 11 }, (_, i) => [i / 10, `${i * 10}%`]),
      ],
    ])
      elements.items.append(
        select(label, choices, game.settings[key], (value) => {
          game.settings[key] = key === "atbMode" ? value : Number(value);
          callbacks.settings?.(game.settings);
          refresh();
        }),
      );
  } else if (!unit) text(elements.items, tr("party_menu.no_controllable_character_available"));
  else if (state.page === "魔法") {
    const list = spells(unit);
    if (!list.length) text(elements.items, tr("party_menu.no_magic_learned_yet"));
    for (const a of list) {
      const cost = abilityMpCost(unit, a);
      const usable =
        a.menuFunctionGroup || a.kind === "heal" || [34, 35, 36, 37, 38, 39].includes(a.id);
      elements.items.append(
        button(
          `${a.name}  ${cost} MP`,
          () => target(a.name, (u) => game.useAbility(a.id, unit.id, u.id)),
          !usable || unit.hp <= 0 || unit.mp < cost,
        ),
      );
    }
    const learning = Object.entries(unit.magicLearning || {}).filter(
      ([, value]) => value > 0 && value < 100,
    );
    for (const [id, value] of learning)
      text(
        elements.items,
        tr("party_menu.value_learning_value", { v0: data.abilities[id]?.name || id, v1: value }),
      );
  } else if (state.page === "魔石") {
    elements.items.append(
      select(
        tr("party_menu.value_s_magicite", { v0: unit.name }),
        [
          [0, tr("party_menu.unequipped")],
          ...Object.keys(data.magicStones || {})
            .map(Number)
            .filter((id) => game.inventory[id] > 0 || unit.magicite === id)
            .map((id) => [id, data.magicStones[id].name || name(id)]),
        ],
        unit.magicite || 0,
        (value) => run(() => game.equipMagicite(unit.id, Number(value))),
      ),
    );
    const stone = data.magicStones?.[unit.magicite];
    if (stone) {
      text(
        elements.items,
        tr("party_menu.summon_value", { v0: data.abilities[stone.summonAbilityId]?.name || "" }),
      );
      for (const learn of stone.learning || [])
        text(
          elements.items,
          `${data.abilities[learn.abilityId]?.name || learn.abilityId}  ×${learn.rate}  ${unit.magicLearning?.[learn.abilityId] || 0}%`,
        );
      if (stone.bonus)
        text(
          elements.items,
          tr("party_menu.level_up_bonus_value_valuevalue", {
            v0:
              {
                2: "HP",
                3: "MP",
                4: tr("party_menu.strength"),
                5: tr("party_menu.stamina"),
                6: tr("party_menu.speed"),
                14: tr("party_menu.magic"),
              }[stone.bonus.parameter] || tr("party_menu.stat"),
            v1: stone.bonus.value,
            v2: [2, 3].includes(stone.bonus.parameter) ? "%" : "",
          }),
        );
    }
  } else if (state.page === "装备" || state.page === "饰品") {
    const slots = state.page === "饰品" ? [4, 5] : [0, 1, 2, 3],
      labels = [
        tr("battle_menu.right_hand"),
        tr("battle_menu.left_hand"),
        tr("party_menu.body"),
        tr("party_menu.head"),
        tr("party_menu.relic_1"),
        tr("party_menu.relic_2"),
      ];
    if (state.page === "装备")
      elements.items.append(
        button(tr("party_menu.optimize_equipment"), () => {
          const blocked = game.busy || unit.enabled === false;
          const changed = game.optimizeEquipment(unit.id);
          state.notice = blocked
            ? tr("party_menu.cannot_change_equipment_now")
            : changed
              ? tr("party_menu.equipped_the_strongest_items_currently_held")
              : tr("party_menu.already_using_the_strongest_equipment");
          refresh();
        }),
      );
    for (const slot of slots) {
      const ids = [
        ...new Set([
          0,
          unit.equipment?.[slot] || 0,
          ...Object.entries(game.inventory)
            .filter(([id, count]) => count > 0 && [2, 3].includes(data.contents[id]?.type_id))
            .map(([id]) => Number(id)),
        ]),
      ].filter((id) => !id || canEquip(data, unit, id, slot));
      const control = select(
        labels[slot],
        ids.map((id) => [id, id ? name(id) : tr("party_menu.remove")]),
        unit.equipment?.[slot] || 0,
        (value) => run(() => game.equip(unit.id, slot, Number(value))),
      );
      control.dataset.contentId = String(unit.equipment?.[slot] || 0);
      for (const option of control.children)
        if (data.contents?.[option.value]) option.dataset.contentId = String(option.value);
      control.dataset.block = "1";
      elements.items.append(control);
      text(elements.items, description(unit.equipment?.[slot]));
    }
    text(
      elements.items,
      tr("party_menu.attack_value_defense_value_magic_defense_value_evasion_", {
        v0: unit.attack,
        v1: unit.defense,
        v2: unit.magicDefense,
        v3: unit.evasion,
        v4: unit.magicEvasion,
      }),
    );
  } else if (state.page === "状态") {
    const identity = group();
    portrait(unit, identity);
    identity.append(node("h2", unit.name));
    text(
      identity,
      tr("party_menu.level_value_value", {
        v0: unit.level,
        v1: unit.row === "back" ? tr("battle_menu.back_row") : tr("battle_menu.front_row"),
      }),
    );
    const left = group(
      ...[
        ["HP", `${unit.hp} / ${unit.maxHp}`],
        ["MP", `${unit.mp} / ${unit.maxMp}`],
        [tr("party_menu.exp"), unit.exp || 0],
        [tr("party_menu.strength"), unit.strength],
        [tr("party_menu.speed"), unit.speed],
        [tr("party_menu.stamina"), unit.vitality ?? unit.baseStats?.vitality],
        [tr("party_menu.magic"), unit.magic],
      ].map(([label, value]) => stat(label, value)),
    );
    const right = group(
      ...[
        [tr("party_menu.attack"), unit.attack],
        [tr("party_menu.defense"), unit.defense],
        [tr("party_menu.magic_defense"), unit.magicDefense],
        [tr("party_menu.evasion"), unit.evasion],
        [tr("party_menu.magic_evasion"), unit.magicEvasion],
        [tr("party_menu.accuracy"), unit.accuracy],
        [tr("party_menu.critical"), unit.criticalRate],
      ].map(([label, value]) => stat(label, value)),
    );
    elements.items.append(columns([0.26, 0.39, 0.35], [identity, left, right]));
    text(
      elements.items,
      tr("party_menu.status_value", {
        v0:
          (unit.conditions || [])
            .map((id) => {
              const row = data.conditions?.[id],
                key = row?.mes_id_name;
              return (
                row?.name ||
                (key && key !== "None" ? game.text(key) : tr("party_menu.status_ailment"))
              );
            })
            .join("、") || tr("party_menu.normal"),
      }),
    );
  } else if (state.page === "队列") {
    text(elements.items, tr("party_menu.select_two_characters_to_swap_positions_toggle_each_cha"));
    elements.items.append(
      columns(
        [0.34, 0.36, 0.3],
        [
          group(node("legend", tr("party_menu.party_order"))),
          group(node("formation-heading")),
          group(node("legend", tr("party_menu.formation"))),
        ],
      ),
    );
    for (const [pos, u] of game.party.entries()) {
      const choice = button(`${pos + 1}. ${u.name}`, () => {
        if (state.swap === undefined) state.swap = pos;
        else {
          const slots = game.partySlots[game.partyIndex];
          [slots[state.swap], slots[pos]] = [slots[pos], slots[state.swap]];
          delete state.swap;
        }
        refresh();
      });
      choice.dataset.selected = state.swap === pos ? "1" : "";
      choice.dataset.block = "1";
      const row = button(
        u.row === "back" ? tr("party_menu.move_to_front_row") : tr("party_menu.move_to_back_row"),
        () => {
          u.row = u.row === "back" ? "front" : "back";
          refresh();
        },
      );
      row.dataset.block = "1";
      elements.items.append(
        columns(
          [0.34, 0.36, 0.3],
          [
            group(
              choice,
              node(
                "p",
                `Lv ${u.level}　${u.row === "back" ? tr("battle_menu.back_row") : tr("battle_menu.front_row")}`,
              ),
            ),
            group(figure(u, state.swap === pos)),
            group(row),
          ],
        ),
      );
    }
  } else if (state.page === "技能") {
    const commands = effectiveCommandIds(data, unit)
      .map((id) => data.commands[id])
      .filter(Boolean);
    text(elements.items, commands.map((c) => c.name).join(" / "));
    if (unit.id === 14)
      text(
        elements.items,
        tr("party_menu.umaro_acts_automatically_battle_commands_cannot_be_sele"),
      );
    if (commands.some((c) => c.id === 14))
      for (const [id, count] of Object.entries(game.inventory)) {
        const c = data.contents[id],
          item = c?.type_id === 1 && data.items[c.type_value];
        if (count > 0 && item?.machine_flag)
          text(elements.items, tr("party_menu.tools_value", { v0: name(id) }));
      }
    const known = [
      ...new Set([
        ...(unit.abilities || []),
        ...(unit.loreAbilities || []),
        ...(unit.danceAbilities || []),
      ]),
    ]
      .map((x) => (typeof x === "object" ? x.id : x))
      .map((id) => data.abilities[id])
      .filter((a) => a && a.id > 2 && !spells(unit).some((s) => s.id === a.id));
    for (const a of known)
      text(
        elements.items,
        `${a.name}${blitzInputs[a.id] ? "  " + blitzInputs[a.id].join(" ") : ""}`,
      );
    for (const id of unit.rages || [])
      text(elements.items, tr("party_menu.rage_value", { v0: data.monsters[id]?.name || id }));
    if (unit.id === 13)
      for (let slot = 0; slot < 3; slot++)
        elements.items.append(
          select(
            tr("party_menu.gogo_command_value", { v0: slot + 1 }),
            [1, 3, 7, 10, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23].map((id) => [
              id,
              data.commands[id]?.name || id,
            ]),
            (unit.customCommands || [1, 7, 3])[slot],
            (value) => {
              const ids = [...(unit.customCommands || [1, 7, 3])];
              ids[slot] = Number(value);
              configureGogo(data, unit, ids);
              refresh();
            },
          ),
        );
    if (!known.length && !unit.rages?.length)
      text(
        elements.items,
        tr("party_menu.special_skills_are_learned_through_story_levels_and_bat"),
      );
  }
}
