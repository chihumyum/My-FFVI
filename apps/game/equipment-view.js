const slots = ["右手", "左手", "身体", "头部", "饰品一", "饰品二"];
const equipmentName = (item) =>
  item.empty ? "未装备" : item.name.replace(/<IC_[A-Z0-9_]+>/g, "");
const stats = [
  ["最大 HP", (p) => p.maxHp],
  ["最大 MP", (p) => p.maxMp],
  ["力量", (p) => p.physical?.strength],
  ["耐力", (p) => p.vitality],
  ["攻击力", (p) => p.physical?.attack ?? p.attack],
  ["防御力", (p) => p.defense],
  ["魔力", (p) => p.magic],
  ["魔法防御", (p) => p.magicDefense],
  ["速度", (p) => p.agility],
  ["回避率", (p) => p.evasion],
  ["魔法回避率", (p) => p.magicEvasion],
];
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const button = (label, handler, disabled = false) => {
  const element = node("button", label);
  element.type = "button";
  element.disabled = disabled;
  element.onclick = handler;
  return element;
};

/** Selection is presentation state. Every preview and change uses the shared owner. */
export class EquipmentView {
  constructor(root, onChange = () => {}, { commands, owner } = {}) {
    if (commands !== undefined && (!owner || commands.owner !== owner || typeof commands.menu !== "function"))
      throw new Error("Invalid equipment command owner");
    this.root = root;
    this.onChange = onChange;
    this.commands = commands;
    this.owner = owner;
    this.root.classList.add("equipment-view");
    this.reset();
  }
  reset() {
    this.session = null;
    this.playerId = null;
    this.slot = 1;
    this.contentId = null;
    this.message = "";
    this.key = "";
  }
  render(session) {
    if (this.session !== session) this.reset();
    this.session = session;
    const commands = this.commands;
    const isCurrent = () => this.session === session && this.commands === commands &&
      (!commands || this.owner === session && commands.menuReady);
    const menuReady = session.menuReady && isCurrent();
    const state = session.state.snapshot();
    const catalog = session.battleCatalog.gameState.equipmentSystem?.catalog;
    const players = session.battle?.players ?? session.players;
    const owned =
      state.roster.find((p) => p.id === this.playerId) ??
      state.roster.find((p) => p.id === session.state.activeParty[0]?.id) ??
      state.roster[0];
    this.playerId = owned?.id ?? null;
    const key = JSON.stringify([
      state.roster,
      state.party,
      state.equipmentStock,
      players.map((p) => [
        p.id,
        p.hp,
        p.mp,
        ...stats.map(([, value]) => value(p)),
      ]),
      menuReady,
      this.playerId,
      this.slot,
      this.contentId,
      this.message,
    ]);
    if (key === this.key) return;
    this.key = key;
    const focused = this.root.contains(document.activeElement)
      ? document.activeElement.dataset.equipmentFocus
      : null;
    const stockOpen =
      this.root.querySelector(".equipment-stock")?.open ?? false;
    this.root.replaceChildren(node("h3", "装备"));
    if (!catalog || !owned) {
      this.root.append(node("p", "当前没有可调整的装备。"));
      return;
    }
    const inventory = session.state.equipmentInventory;
    const stock = new Map(inventory.map((entry) => [entry.id, entry]));
    const choices = menuReady
      ? session.state.equipmentChoices(owned.id, this.slot)
      : [];
    const currentId = owned.equipment[this.slot - 1];
    const current =
      choices.find((choice) => choice.id === currentId)?.projection ??
      players.find((p) => p.id === owned.id) ??
      owned;
    const candidate = choices.find((choice) => choice.id === this.contentId);
    if (!candidate) this.contentId = null;
    const party = node("div", undefined, "equipment-party");
    party.setAttribute("aria-label", "选择队员");
    for (const p of state.roster) {
      const select = button(`${p.name} · Lv ${p.level}`, () => {
        if (!isCurrent()) return;
        this.playerId = p.id;
        this.contentId = null;
        this.message = "";
        this.render(session);
      });
      select.setAttribute("aria-pressed", String(p.id === owned.id));
      select.dataset.equipmentFocus = `player-${p.id}`;
      party.append(select);
    }
    this.root.append(party);
    const resources = players.find((p) => p.id === owned.id) ?? owned;
    this.root.append(
      node(
        "p",
        `${owned.name} · HP ${resources.hp} / ${resources.maxHp}　MP ${resources.mp} / ${resources.maxMp}`,
        "equipment-resources",
      ),
    );
    const body = node("div", undefined, "equipment-body");
    const loadout = node("div", undefined, "equipment-slots");
    loadout.setAttribute("aria-label", `${owned.name}的装备部位`);
    owned.equipment.forEach((id, index) => {
      const select = button("", () => {
        if (!isCurrent()) return;
        this.slot = index + 1;
        this.contentId = null;
        this.message = "";
        this.render(session);
      });
      select.className = "equipment-slot";
      select.setAttribute("aria-pressed", String(this.slot === index + 1));
      select.dataset.equipmentFocus = `slot-${index + 1}`;
      select.append(
        node("span", slots[index]),
        node("strong", equipmentName(catalog.definitions[id])),
      );
      loadout.append(select);
    });
    body.append(loadout);
    const comparison = node("table", undefined, "equipment-stats");
    comparison.append(node("caption", candidate ? "换装预览" : "当前参数"));
    const headings = node("tr");
    for (const label of ["参数", "当前", "换后"]) {
      const heading = node("th", label);
      heading.scope = "col";
      headings.append(heading);
    }
    const thead = node("thead");
    thead.append(headings);
    const tbody = node("tbody");
    for (const [label, value] of stats) {
      const row = node("tr");
      const heading = node("th", label);
      heading.scope = "row";
      const before = value(current);
      const after = candidate ? value(candidate.projection) : undefined;
      const result = node("td", after ?? "—");
      if (after !== undefined && before !== undefined && after !== before) {
        result.className = after > before ? "equipment-up" : "equipment-down";
        result.textContent = `${after} (${after > before ? "+" : ""}${after - before})`;
      }
      row.append(heading, node("td", before ?? "—"), result);
      tbody.append(row);
    }
    comparison.append(thead, tbody);
    body.append(comparison);
    this.root.append(body);

    const options = node("div", undefined, "equipment-options");
    options.append(node("h4", `${slots[this.slot - 1]} · 选择装备`));
    if (!menuReady) {
      options.append(node("p", "请回到地图空闲时调整装备。"));
    } else if (!choices.some((choice) => choice.changes.length)) {
      options.append(node("p", "当前没有可更换的装备。"));
    }
    const list = node("div", undefined, "equipment-choices");
    for (const choice of choices) {
      const item = catalog.definitions[choice.id];
      const counts = stock.get(choice.id);
      const label = item.empty
        ? "卸下"
        : `${equipmentName(item)} · 持有 ${counts.count} / 空闲 ${counts.available}`;
      const select = button(
        choice.changes.length
          ? label
          : item.empty
            ? "未装备"
            : `${equipmentName(item)} · 已装备`,
        () => {
          if (!isCurrent()) return;
          this.contentId = choice.id;
          this.message = "";
          this.render(session);
        },
        !choice.changes.length,
      );
      select.setAttribute("aria-pressed", String(choice.id === this.contentId));
      select.dataset.equipmentFocus = `choice-${choice.id}`;
      list.append(select);
    }
    options.append(list);
    if (candidate?.changes.length) {
      const slot = this.slot;
      const changes = candidate.changes.map(
        (change) =>
          `${slots[change.slot - 1]}：${equipmentName(catalog.definitions[change.from])} → ${equipmentName(catalog.definitions[change.to])}`,
      );
      options.append(node("p", changes.join("\n"), "equipment-changes"));
      const apply = button("应用换装", () => {
        if (!isCurrent() || !session.menuReady) return;
        let changed = false;
        try {
          changed = commands
            ? commands.menu({ kind: "change-equipment", playerId: owned.id, slot, contentId: candidate.id })
            : session.changeEquipment(owned.id, slot, candidate.id);
          this.message = changed
            ? `${owned.name}已调整装备。`
            : "当前无法换装，请重新选择。";
        } catch (error) {
          this.message = "换装未完成，请重新选择。";
          console.error(error);
        }
        this.contentId = null;
        this.render(session);
        if (changed) this.onChange();
        this.root
          .querySelector(`[data-equipment-focus="slot-${this.slot}"]`)
          ?.focus();
      });
      apply.dataset.equipmentFocus = "apply";
      const cancel = button("取消", () => {
        if (!isCurrent()) return;
        this.contentId = null;
        this.render(session);
        this.root
          .querySelector(`[data-equipment-focus="slot-${this.slot}"]`)
          ?.focus();
      });
      options.append(apply, cancel);
    }
    this.root.append(options);
    const message = node("p", this.message, "equipment-status");
    message.setAttribute("role", "status");
    this.root.append(message);

    const stockDetails = node("details", undefined, "equipment-stock");
    stockDetails.open = stockOpen;
    const stockSummary = node("summary", "装备库存 · 总持有包含已穿戴");
    stockSummary.dataset.equipmentFocus = "stock";
    stockDetails.append(stockSummary);
    const stockTable = node("table");
    const stockHead = node("thead");
    const stockLabels = node("tr");
    for (const label of ["装备", "总持有", "已穿戴", "空闲"]) {
      const heading = node("th", label);
      heading.scope = "col";
      stockLabels.append(heading);
    }
    stockHead.append(stockLabels);
    const stockBody = node("tbody");
    for (const entry of inventory.filter((entry) => entry.count > 0)) {
      const row = node("tr");
      const heading = node("th", equipmentName(catalog.definitions[entry.id]));
      heading.scope = "row";
      row.append(
        heading,
        node("td", entry.count),
        node("td", entry.equipped),
        node("td", entry.available),
      );
      stockBody.append(row);
    }
    stockTable.append(stockHead, stockBody);
    stockDetails.append(stockTable);
    this.root.append(stockDetails);
    if (focused)
      [...this.root.querySelectorAll("[data-equipment-focus]")]
        .find((element) => element.dataset.equipmentFocus === focused)
        ?.focus();
  }
}
