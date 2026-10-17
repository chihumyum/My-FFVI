import { validBlitz } from "/play-runtime/battle-commands.js";
// Manual controls submit ordinary Battle inputs; no regression policy lives here.
export function createBattleMenu({
  commands,
  targets,
  status,
  createElement = document.createElement.bind(document),
}) {
  let battle = null,
    index = -1,
    menu = null,
    selection = null,
    selectionMarker = "",
    marker = "",
    blitz = [],
    dual = [];
  const button = (label, run, disabled = false) => {
    const b = createElement("button");
    b.textContent = label;
    b.disabled = disabled;
    b.onclick = run;
    return b;
  };
  const invalidate = () => {
    marker = "";
  };
  const close = () => {
    menu = null;
    selection = null;
    blitz = [];
    dual = [];
    if (battle) battle.equipmentInput = null;
    battle?.setInput();
    targets.replaceChildren();
    invalidate();
  };
  const send = (action, target) => {
    if (menu?.input === "dualcast") {
      dual.push({ id: action.id, target });
      if (dual.length === 1) {
        selection = null;
        targets.replaceChildren();
        invalidate();
        return;
      }
      battle.chooseDualcast(index, dual);
      close();
      return;
    }
    if (menu?.input === "blitz") battle.submitBlitz(index, action.id, blitz, target);
    else if (menu?.input === "bushido") battle.releaseBushido(index, action.id, target);
    else battle.choose(index, action.id, target);
    close();
  };
  const targetState = (action) =>
    JSON.stringify(
      (action.targetSides ?? [action.target === "ally" ? "player" : "enemy"]).map((side) =>
        (side === "player" ? battle.players : battle.enemies).map((u) => [
          u.name,
          side === "player" ? u.hp : null,
          side === "player" ? u.maxHp : null,
          battle.eligibleTarget(u, action),
        ]),
      ),
    );
  const chooseTarget = (action) => {
    selectionMarker = targetState(action);
    selection = action;
    targets.replaceChildren();
    battle.setInput(menu?.input === "dualcast" ? "dualcast" : "target");
    if (action.kind === "defend" || action.range === 5) {
      send(action, { side: "player", index });
      return;
    }
    for (const side of action.targetSides ?? [action.target === "ally" ? "player" : "enemy"]) {
      const pool = side === "player" ? battle.players : battle.enemies;
      if (action.all || action.selectableAll) {
        targets.append(
          button(
            action.range === 9 ? "战场全体" : side === "player" ? "我方全体" : "敌方全体",
            () =>
              send(action, {
                side,
                index: pool.findIndex((u) => battle.eligibleTarget(u, action)),
                all: true,
              }),
            !pool.some((u) => battle.eligibleTarget(u, action)),
          ),
        );
      }
      if (action.all && !action.selectableAll) continue;
      for (const [n, u] of pool.entries())
        targets.append(
          button(
            u.name + (side === "player" ? ` HP ${u.hp}/${u.maxHp}` : ""),
            () => send(action, { side, index: n, all: false }),
            !battle.eligibleTarget(u, action),
          ),
        );
    }
    targets.append(
      button("返回", () => {
        selection = null;
        targets.replaceChildren();
        battle.setInput(menu ? "list" : null);
        invalidate();
      }),
    );
  };
  function open(command) {
    menu = command;
    selection = null;
    blitz = [];
    dual = [];
    targets.replaceChildren();
    battle.setInput(command.input === "direct" ? null : command.input);
    if (command.input === "direct") {
      chooseTarget(command.actions[0]);
      return;
    }
    if (command.input === "bushido") battle.beginBushido(index);
    if (command.input === "slots") battle.beginSlots(index);
    if (command.input === "equipment") battle.requestEquipment(battle.players[index]);
    invalidate();
  }
  function update(next) {
    if (battle !== next) {
      battle = next;
      index = -1;
      close();
    }
    const eligible = (u) =>
      u.ready && battle.alive(u) && battle.commandsFor(battle.players.indexOf(u)).length;
    if (!eligible(battle.players[index] ?? {})) {
      index = battle.players.findIndex(eligible);
      close();
    }
    const actor = battle.players[index],
      ready = battle.players.map((u, i) => (eligible(u) ? i : -1)).filter((i) => i >= 0);
    status.textContent =
      battle.players
        .map(
          (u, i) =>
            `${i === index ? "▶" : " "} ${u.name} ${u.row === "back" ? "后排" : "前排"}  HP ${u.hp}/${u.maxHp}  MP ${u.mp}/${u.maxMp}  ATB ${Math.floor(u.atb ?? 0)}${u.trance ? " 幻化" : ""}${u.rageMonster ? " 狂怒" : ""}${u.danceAbility ? " 舞蹈" : ""}`,
        )
        .join("\n") +
      "\n" +
      battle.log.slice(-2).join(" · ");
    if (selection) {
      if (selectionMarker !== targetState(selection)) chooseTarget(selection);
      return;
    }
    const level = menu?.input === "bushido" ? battle.bushidoLevel(index) : 0,
      reels = menu?.input === "slots" ? battle.slotSymbols() : [];
    const charge = commands.querySelector("progress");
    if (charge) charge.value = level;
    const reel = commands.querySelector("[data-reels]");
    if (reel)
      reel.textContent = reels
        .map((n) => ["7", "龙", "BAR", "飞空艇", "陆行鸟", "钻石"][n])
        .join(" | ");
    for (const item of commands.querySelectorAll("[data-charge-level]"))
      item.disabled = Number(item.dataset.chargeLevel) >= level;
    const key = JSON.stringify([
      index,
      ready,
      actor?.mp,
      actor?.conditions,
      actor?.trance,
      battle.phase,
      menu?.commandId,
      battle.slots?.stopped.length,
      blitz,
      dual.length,
      battle.inventory,
    ]);
    if (key === marker) return;
    marker = key;
    commands.replaceChildren();
    for (const i of ready)
      commands.append(
        button(
          `操作 ${battle.players[i].name}`,
          () => {
            index = i;
            close();
          },
          i === index,
        ),
      );
    if (!actor) return;
    if (menu) {
      commands.append(button("← 指令", close));
      if (menu.input === "equipment") {
        for (const slot of [0, 1]) {
          const label = createElement("label"),
            select = createElement("select");
          label.textContent = slot ? "左手" : "右手";
          select.setAttribute("aria-label", slot ? "战斗左手装备" : "战斗右手装备");
          for (const item of battle.equipmentChoices(index, slot)) {
            const option = createElement("option");
            option.value = item.id;
            option.textContent = item.name;
            select.append(option);
          }
          select.value = actor.equipment?.[slot] ?? 0;
          select.onchange = () => {
            battle.equipInBattle(index, slot, Number(select.value));
            invalidate();
          };
          label.append(select);
          commands.append(label);
        }
        return;
      }
      if (menu.input === "blitz") {
        const info = createElement("p");
        info.textContent = "输入必杀技：" + blitz.join(" ");
        commands.append(info);
        for (const key of ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖", "X", "Y", "L", "R"])
          commands.append(
            button(key, () => {
              blitz.push(key);
              invalidate();
            }),
          );
        commands.append(
          button("清除", () => {
            blitz = [];
            invalidate();
          }),
        );
      }
      if (menu.input === "bushido") {
        const bar = createElement("progress");
        bar.max = 8;
        bar.value = level;
        bar.setAttribute("aria-label", "必杀剑蓄力");
        commands.append(bar);
      }
      if (menu.input === "slots") {
        const text = createElement("strong");
        text.dataset.reels = "";
        text.textContent = reels
          .map((n) => ["7", "龙", "BAR", "飞空艇", "陆行鸟", "钻石"][n])
          .join(" | ");
        commands.append(text);
        commands.append(
          button(`停止转轮 ${(battle.slots?.stopped.length ?? 0) + 1}`, () => {
            battle.stopSlot(index);
            if (!battle.slots) close();
            else invalidate();
          }),
        );
        return;
      }
      if (menu.input === "dualcast") {
        const info = createElement("strong");
        info.textContent = `连续魔：第 ${dual.length + 1} 次`;
        commands.append(info);
      }
      for (const [n, action] of menu.actions.entries()) {
        const item = button(
          `${action.name}${action.mp ? ` · ${action.mp} MP` : ""}${action.count ? ` ×${action.count}` : ""}`,
          () => chooseTarget(action),
          action.disabled || (menu.input === "bushido" && n >= level),
        );
        if (menu.input === "bushido") item.dataset.chargeLevel = n;
        commands.append(item);
      }
    } else
      for (const command of battle.commandsFor(index))
        commands.append(button(command.name, () => open(command), command.disabled));
  }
  return {
    update,
    handleKey(event) {
      if (menu?.input !== "blitz") return false;
      const key =
        {
          ArrowUp: "↑",
          ArrowDown: "↓",
          ArrowLeft: "←",
          ArrowRight: "→",
          x: "X",
          y: "Y",
          l: "L",
          r: "R",
        }[event.key] ?? { X: "X", Y: "Y", L: "L", R: "R" }[event.key];
      if (key) {
        blitz.push(key);
        invalidate();
        return true;
      }
      if (event.key === "Backspace") {
        blitz.pop();
        invalidate();
        return true;
      }
      if (event.key === "Enter") {
        const action = menu.actions.find((a) => validBlitz(a.id, blitz));
        if (action) chooseTarget(action);
        else {
          battle.submitBlitz(index, menu.actions[0]?.id, blitz, { side: "enemy", index: 0 });
          close();
        }
        return true;
      }
      return false;
    },
    cycle() {
      if (!battle) return;
      const n = battle.players.length;
      for (let offset = 1; offset <= n; offset++) {
        const i = (index + offset) % n;
        if (battle.players[i].ready && battle.commandsFor(i).length) {
          index = i;
          close();
          return;
        }
      }
    },
    reset: close,
  };
}
