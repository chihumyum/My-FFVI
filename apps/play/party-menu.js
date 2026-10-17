import { configureGogo, effectiveCommandIds, blitzInputs } from "../../src/play/battle-commands.js";
import { canEquip } from "../../src/play/resources.js";
import { abilityMpCost } from "../../src/play/progression.js";

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
  const name = (id) =>
    data.contentNames?.[id] || game.text(data.contents?.[id]?.mes_id_name || "") || `物品 ${id}`;
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
    if (ok === false) text(elements.items, "当前不能使用：请检查目标、装备限制和所需资源。");
  };
  const target = (label, action) => {
    elements.items.replaceChildren(node("h2", label));
    for (const u of game.party)
      elements.items.append(button(`${u.name}  HP ${u.hp}/${u.maxHp}`, () => run(() => action(u))));
    elements.items.append(button("返回", refresh));
  };
  elements.navigation?.replaceChildren();
  elements.party.replaceChildren();
  elements.items.replaceChildren();
  for (const page of pages)
    elements.navigation?.append(
      button(
        page,
        () => {
          state.page = page;
          refresh();
        },
        state.page === page,
      ),
    );
  elements.navigation?.append(button("存档", () => callbacks.save?.()));
  text(
    elements.party,
    `${callbacks.location || "当前地点"}     Gil ${game.gil}     ${Math.floor(game.time / 3600)}:${String(Math.floor(game.time / 60) % 60).padStart(2, "0")}`,
  );
  if (state.page !== "队伍" && state.page !== "道具" && state.page !== "设置")
    for (const u of game.party)
      elements.party.append(
        button(
          u.name,
          () => {
            state.member = u.id;
            refresh();
          },
          u === unit,
        ),
      );
  elements.items.append(node("h2", state.page));
  const portrait = (u, parent) => {
    const image = node("img");
    image.dataset.actorId = String(u.id);
    image.setAttribute("aria-label", u.name);
    parent.append(image);
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
        node("legend", `${u.name}  Lv ${u.level}  ${u.row === "back" ? "后排" : "前排"}`),
      );
      text(card, `HP ${u.hp} / ${u.maxHp}     MP ${u.mp} / ${u.maxMp}`);
      text(
        card,
        `经验值 ${u.exp || 0}     魔石：${data.magicStones?.[u.magicite]?.name || "未装备"}`,
      );
      card.append(
        button("查看状态", () => {
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
        "整理道具",
        [
          ["source", "原始顺序"],
          ["type", "按种类整理"],
          ["name", "按名称整理"],
          ["count", "按数量整理"],
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
        ? name(a.id).localeCompare(name(b.id), "zh-CN")
        : state.sort === "count"
          ? b.count - a.count || a.id - b.id
          : state.sort === "type"
            ? (data.contents[a.id]?.type_id || 0) - (data.contents[b.id]?.type_id || 0) ||
              a.id - b.id
            : a.id - b.id,
    );
    if (!entries.length) text(elements.items, "没有持有道具。");
    for (const { id, count } of entries) {
      const content = data.contents[id],
        item = content?.type_id === 1 && data.items[content.type_value];
      const row = node("fieldset");
      const label = node("legend", `${name(id)} ×${count}`);
      label.dataset.contentId = String(id);
      row.append(label);
      text(row, description(id));
      if (item?.menu_function_group_id > 0)
        row.append(button("使用", () => target(name(id), (u) => game.useItem(id, u.id))));
      elements.items.append(row);
    }
  } else if (state.page === "设置") {
    for (const [key, label, choices] of [
      [
        "atbMode",
        "ATB 模式",
        [
          ["wait", "等待"],
          ["active", "主动"],
        ],
      ],
      ["battleSpeed", "战斗速度", Array.from({ length: 6 }, (_, i) => [i, String(i + 1)])],
      ["textSpeed", "文字速度", Array.from({ length: 6 }, (_, i) => [i, String(i + 1)])],
      ["volume", "音量", Array.from({ length: 11 }, (_, i) => [i / 10, `${i * 10}%`])],
    ])
      elements.items.append(
        select(label, choices, game.settings[key], (value) => {
          game.settings[key] = key === "atbMode" ? value : Number(value);
          callbacks.settings?.(game.settings);
          refresh();
        }),
      );
  } else if (!unit) text(elements.items, "当前没有可操作的角色。");
  else if (state.page === "魔法") {
    const list = spells(unit);
    if (!list.length) text(elements.items, "尚未学会魔法。");
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
      text(elements.items, `${data.abilities[id]?.name || id}  学习进度 ${value}%`);
  } else if (state.page === "魔石") {
    elements.items.append(
      select(
        `${unit.name} 魔石`,
        [
          [0, "未装备"],
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
      text(elements.items, `召唤：${data.abilities[stone.summonAbilityId]?.name || ""}`);
      for (const learn of stone.learning || [])
        text(
          elements.items,
          `${data.abilities[learn.abilityId]?.name || learn.abilityId}  ×${learn.rate}  ${unit.magicLearning?.[learn.abilityId] || 0}%`,
        );
      if (stone.bonus)
        text(
          elements.items,
          `升级奖励：${{ 2: "HP", 3: "MP", 4: "力量", 5: "体力", 6: "速度", 14: "魔力" }[stone.bonus.parameter] || "能力"} +${stone.bonus.value}${[2, 3].includes(stone.bonus.parameter) ? "%" : ""}`,
        );
    }
  } else if (state.page === "装备" || state.page === "饰品") {
    const slots = state.page === "饰品" ? [4, 5] : [0, 1, 2, 3],
      labels = ["右手", "左手", "身体", "头部", "饰品 1", "饰品 2"];
    if (state.page === "装备")
      elements.items.append(button("最强装备", () => run(() => game.optimizeEquipment(unit.id))));
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
      elements.items.append(
        select(
          `${unit.name} ${labels[slot]}`,
          ids.map((id) => [id, id ? name(id) : "卸下"]),
          unit.equipment?.[slot] || 0,
          (value) => run(() => game.equip(unit.id, slot, Number(value))),
        ),
      );
      text(elements.items, description(unit.equipment?.[slot]));
    }
    text(
      elements.items,
      `攻击 ${unit.attack}     防御 ${unit.defense}     魔防 ${unit.magicDefense}     回避 ${unit.evasion}     魔回 ${unit.magicEvasion}`,
    );
  } else if (state.page === "状态") {
    portrait(unit, elements.items);
    text(
      elements.items,
      `${unit.name}   等级 ${unit.level}   ${unit.row === "back" ? "后排" : "前排"}`,
    );
    for (const [label, value] of [
      ["HP", `${unit.hp}/${unit.maxHp}`],
      ["MP", `${unit.mp}/${unit.maxMp}`],
      ["经验", unit.exp || 0],
      ["力量", unit.strength],
      ["速度", unit.speed],
      ["体力", unit.vitality],
      ["魔力", unit.magic],
      ["攻击", unit.attack],
      ["防御", unit.defense],
      ["魔防", unit.magicDefense],
      ["回避", unit.evasion],
      ["魔回", unit.magicEvasion],
    ])
      text(elements.items, `${label}    ${value ?? 0}`);
    text(
      elements.items,
      `状态：${
        (unit.conditions || [])
          .map((id) => {
            const row = data.conditions?.[id],
              key = row?.mes_id_name;
            return row?.name || (key && key !== "None" ? game.text(key) : "异常状态");
          })
          .join("、") || "正常"
      }`,
    );
  } else if (state.page === "队列") {
    text(elements.items, "选择两名角色交换位置；前后排可分别切换。");
    for (const [pos, u] of game.party.entries()) {
      elements.items.append(
        button(`${state.swap === pos ? "▶ " : ""}${pos + 1}. ${u.name}`, () => {
          if (state.swap === undefined) state.swap = pos;
          else {
            const slots = game.partySlots[game.partyIndex];
            [slots[state.swap], slots[pos]] = [slots[pos], slots[state.swap]];
            delete state.swap;
          }
          refresh();
        }),
      );
      elements.items.append(
        button(u.row === "back" ? "改为前排" : "改为后排", () => {
          u.row = u.row === "back" ? "front" : "back";
          refresh();
        }),
      );
    }
  } else if (state.page === "技能") {
    const commands = effectiveCommandIds(data, unit)
      .map((id) => data.commands[id])
      .filter(Boolean);
    text(elements.items, commands.map((c) => c.name).join(" / "));
    if (unit.id === 14) text(elements.items, "乌玛罗自动行动，无法选择战斗指令。");
    if (commands.some((c) => c.id === 14))
      for (const [id, count] of Object.entries(game.inventory)) {
        const c = data.contents[id],
          item = c?.type_id === 1 && data.items[c.type_value];
        if (count > 0 && item?.machine_flag) text(elements.items, `机械：${name(id)}`);
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
      text(elements.items, `狂怒：${data.monsters[id]?.name || id}`);
    if (unit.id === 13)
      for (let slot = 0; slot < 3; slot++)
        elements.items.append(
          select(
            `戈戈自选指令 ${slot + 1}`,
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
      text(elements.items, "角色特技按剧情、等级和实战学习；本页只显示已掌握内容。");
  }
}
