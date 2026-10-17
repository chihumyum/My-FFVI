function button(label, action) {
  const element = document.createElement("button");
  element.textContent = label;
  element.onclick = action;
  return element;
}

export function renderPartyMenu(game, elements, refresh) {
  const data = game.battleData,
    name = (id) => {
      if (data.contentNames?.[id]) return data.contentNames[id];
      const content = data.contents?.[id];
      const text = game.text(content?.mes_id_name || "");
      return text && text !== content?.mes_id_name ? text : `物品 ${id}`;
    };
  elements.party.replaceChildren();
  elements.items.replaceChildren();
  const gil = document.createElement("p");
  gil.textContent = `Gil ${game.gil}`;
  elements.party.append(gil);
  const run = (action) => {
    const success = action();
    refresh();
    if (success === false) {
      const status = document.createElement("p");
      status.textContent = "当前不能使用：请检查目标、装备限制和所需资源。";
      status.setAttribute("role", "status");
      elements.items.prepend(status);
    }
  };
  const targetInput = (label, action, units = game.party) => {
    elements.items.replaceChildren();
    const title = document.createElement("p");
    title.textContent = label;
    elements.items.append(title);
    for (const target of units)
      elements.items.append(
        button(`${target.name}  HP ${target.hp}/${target.maxHp}`, () => run(() => action(target))),
      );
    elements.items.append(button("返回菜单", refresh));
  };
  const settings = document.createElement("fieldset"),
    title = document.createElement("legend");
  title.textContent = "设置";
  settings.append(title);
  for (const [key, label, choices] of [
    [
      "atbMode",
      "ATB 模式",
      [
        ["wait", "等待"],
        ["active", "主动"],
      ],
    ],
    ["battleSpeed", "战斗速度", Array.from({ length: 6 }, (_, i) => [i, `${i + 1}`])],
  ]) {
    const labelNode = document.createElement("label"),
      select = document.createElement("select");
    labelNode.textContent = label;
    select.setAttribute("aria-label", label);
    for (const [value, text] of choices) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.value = game.settings[key];
    select.onchange = () =>
      (game.settings[key] = key === "atbMode" ? select.value : Number(select.value));
    labelNode.append(select);
    settings.append(labelNode);
  }
  elements.party.append(settings);
  for (const unit of game.party) {
    const section = document.createElement("fieldset"),
      title = document.createElement("legend");
    title.textContent = `${unit.name}  Lv ${unit.level}  HP ${unit.hp}/${unit.maxHp}  MP ${unit.mp}/${unit.maxMp}`;
    section.append(title);
    section.append(
      button(unit.row === "back" ? "改为前排" : "改为后排", () => {
        unit.row = unit.row === "back" ? "front" : "back";
        refresh();
      }),
    );
    if (unit.id === 13)
      for (let n = 0; n < 3; n++) {
        const select = document.createElement("select");
        select.setAttribute("aria-label", `戈戈自选指令 ${n + 1}`);
        for (const id of [1, 3, 7, 10, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23]) {
          const option = document.createElement("option");
          option.value = id;
          option.textContent = data.commands[id]?.name ?? `指令 ${id}`;
          select.append(option);
        }
        select.value = (unit.customCommands ?? [1, 7, 3])[n];
        select.onchange = () => {
          const ids = [...(unit.customCommands ?? [1, 7, 3])];
          ids[n] = Number(select.value);
          configureGogo(data, unit, ids);
          refresh();
        };
        section.append(select);
      }
    section.append(button("最强装备", () => run(() => game.optimizeEquipment(unit.id))));
    const slots = ["右手", "左手", "身体", "头部", "饰品 1", "饰品 2"];
    for (let slot = 0; slot < 6; slot++) {
      const label = document.createElement("label"),
        select = document.createElement("select");
      label.textContent = slots[slot];
      select.setAttribute("aria-label", `${unit.name} ${slots[slot]}`);
      const ids = [
        ...new Set([
          0,
          unit.equipment?.[slot] || 0,
          ...Object.entries(game.inventory)
            .filter(
              ([id, count]) => count > 0 && [2, 3].includes(Number(data.contents?.[id]?.type_id)),
            )
            .map(([id]) => Number(id)),
        ]),
      ].filter((id) => !id || canEquip(data, unit, id, slot));
      for (const id of ids) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = id ? name(id) : "卸下";
        select.append(option);
      }
      select.value = unit.equipment?.[slot] || 0;
      select.onchange = () => run(() => game.equip(unit.id, slot, Number(select.value)));
      label.append(select);
      section.append(label);
    }
    const stoneLabel = document.createElement("label"),
      stoneSelect = document.createElement("select");
    stoneLabel.textContent = "魔石";
    stoneSelect.setAttribute("aria-label", `${unit.name} 魔石`);
    for (const id of [
      0,
      ...Object.keys(data.magicStones || {})
        .map(Number)
        .filter((id) => game.inventory[id] > 0),
    ]) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id ? data.magicStones[id].name || name(id) : "未装备";
      stoneSelect.append(option);
    }
    stoneSelect.value = unit.magicite || 0;
    stoneSelect.onchange = () => run(() => game.equipMagicite(unit.id, Number(stoneSelect.value)));
    stoneLabel.append(stoneSelect);
    section.append(stoneLabel);
    const learning = Object.entries(unit.magicLearning || {})
      .filter(([, value]) => value > 0 && value < 100)
      .map(([id, value]) => `${data.abilities?.[id]?.name || `魔法 ${id}`} ${value}%`);
    if (learning.length) {
      const info = document.createElement("p");
      info.textContent = learning.join(" · ");
      section.append(info);
    }
    for (const abilityId of [
      ...new Set([...(unit.abilities || []), ...(unit.equipmentAbilities || [])]),
    ]) {
      const ability = data.abilities?.[abilityId];
      if (
        !ability ||
        !(
          ability.menuFunctionGroup ||
          ability.kind === "heal" ||
          [34, 35, 36, 37, 38, 39].includes(ability.id)
        )
      )
        continue;
      const spell = button(`${ability.name} · ${ability.mp || 0} MP`, () =>
        targetInput(`${unit.name}：${ability.name}`, (target) =>
          game.useAbility(ability.id, unit.id, target.id),
        ),
      );
      spell.disabled = unit.hp <= 0 || unit.mp < ability.mp;
      section.append(spell);
    }
    elements.party.append(section);
  }
  for (const [id, count] of Object.entries(game.inventory)) {
    const content = data.contents?.[id],
      item = content?.type_id === 1 && data.items?.[content.type_value];
    if (!(count > 0) || !item || !(item.menu_function_group_id > 0)) continue;
    elements.items.append(
      button(`${name(id)} ×${count}`, () =>
        targetInput(name(id), (target) => game.useItem(Number(id), target.id)),
      ),
    );
  }
}
import { configureGogo } from "/play-runtime/battle-commands.js";
import { canEquip } from "/play-runtime/resources.js";
