import { tr } from "../../src/play/i18n.js";
import { validBlitz } from "../../src/play/battle-commands.js";
// Manual controls submit ordinary Battle inputs; no regression policy lives here.
export function createBattleMenu({
  commands,
  targets,
  status,
  createElement = document.createElement.bind(document),
  isBlocked = () => false,
}) {
  let battle = null,
    index = -1,
    menu = null,
    selection = null,
    targetAll = false,
    selectionMarker = "",
    marker = "",
    blitz = [],
    dual = [];
  const button = (label, run, disabled = false) => {
    const b = createElement("button");
    b.textContent = label;
    b.disabled = disabled;
    b.onclick = () => {
      if (!isBlocked()) run();
    };
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
  const cancelTarget = () => {
    selection = null;
    targets.replaceChildren();
    battle?.setInput(menu ? "list" : null);
    invalidate();
  };
  const canSelectTarget = (side, n) => {
    if (isBlocked() || !selection || battle?.phase !== "active") return false;
    const sides = selection.targetSides ?? [selection.target === "ally" ? "player" : "enemy"];
    const unit = (side === "player" ? battle.players : battle.enemies)[n];
    return sides.includes(side) && !!unit && battle.eligibleTarget(unit, selection);
  };
  const chooseTarget = (action) => {
    if (selection !== action) targetAll = !!action.all;
    selectionMarker = targetState(action);
    selection = action;
    targets.replaceChildren();
    battle.setInput(menu?.input === "dualcast" ? "dualcast" : "target");
    if (action.kind === "defend" || action.range === 5) {
      send(action, { side: "player", index });
      return;
    }
    const hint = createElement("strong");
    hint.textContent = `${action.name} · ${targetAll ? tr("battle_menu.all") : tr("battle_menu.single")}`;
    targets.append(hint);
    const sides = action.targetSides ?? [action.target === "ally" ? "player" : "enemy"];
    // Keep both group choices before individual names: the shallow battle
    // window otherwise hides "enemy all" behind the entire allied roster.
    for (const side of sides) {
      const pool = side === "player" ? battle.players : battle.enemies;
      if (action.all || action.selectableAll) {
        targets.append(
          button(
            action.range === 9
              ? tr("battle_menu.everyone")
              : side === "player"
                ? tr("battle_menu.all_allies")
                : tr("battle_menu.all_enemies"),
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
    }
    for (const side of sides) {
      const pool = side === "player" ? battle.players : battle.enemies;
      if (action.all && !action.selectableAll) continue;
      for (const [n, u] of pool.entries())
        targets.append(
          button(
            u.name + (side === "player" ? ` HP ${u.hp}/${u.maxHp}` : ""),
            () => send(action, { side, index: n, all: targetAll }),
            !battle.eligibleTarget(u, action),
          ),
        );
    }
    if (action.selectableAll) {
      const scope = button(
        tr("battle_menu.target_value_shift_to_toggle", {
          v0: targetAll ? tr("battle_menu.all") : tr("battle_menu.single"),
        }),
        toggleTargetAll,
      );
      scope.dataset.targetScope = "1";
      targets.append(scope);
    }
    const cancel = button(tr("battle_menu.cancel"), cancelTarget);
    cancel.dataset.targetCancel = "1";
    targets.append(cancel);
  };
  function toggleTargetAll() {
    if (!selection?.selectableAll) return false;
    targetAll = !targetAll;
    chooseTarget(selection);
    return true;
  }
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
      battle.phase === "active" &&
      battle.events.interactive &&
      !battle.events.paused &&
      u.ready &&
      battle.alive(u) &&
      battle.commandsFor(battle.players.indexOf(u)).length;
    if (!eligible(battle.players[index] ?? {})) {
      index = battle.players.findIndex(eligible);
      close();
    }
    const actor = battle.players[index],
      ready = battle.players.map((u, i) => (eligible(u) ? i : -1)).filter((i) => i >= 0);
    status.battleModel = battle;
    commands.dataset.submenu = menu ? String(menu.commandId) : "";
    status.activeActor = index;
    status.selectActor = (i) => {
      if (!isBlocked() && eligible(battle.players[i] ?? {})) {
        index = i;
        close();
      }
    };
    status.textContent =
      battle.players
        .map(
          (u, i) =>
            `${i === index ? "▶" : " "} ${u.name} ${u.row === "back" ? tr("battle_menu.back_row") : tr("battle_menu.front_row")}  HP ${u.hp}/${u.maxHp}  MP ${u.mp}/${u.maxMp}  ATB ${Math.floor(u.atb ?? 0)}${u.trance ? tr("battle_menu.trance") : ""}${u.rageMonster ? tr("battle_menu.rage") : ""}${u.danceAbility ? tr("battle_menu.dance") : ""}`,
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
        .map(
          (n) =>
            [
              "7",
              tr("battle_menu.dragon"),
              "BAR",
              tr("battle_menu.airship"),
              tr("battle_menu.chocobo"),
              tr("battle_menu.diamond"),
            ][n],
        )
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
    for (const i of ready) {
      const choice = button(
        tr("battle_menu.control_value", { v0: battle.players[i].name }),
        () => {
          index = i;
          close();
        },
        i === index,
      );
      choice.dataset.actorSwitch = "1";
      commands.append(choice);
    }
    if (!actor) return;
    if (menu) {
      commands.append(button(tr("battle_menu.commands"), close));
      if (menu.input === "equipment") {
        for (const slot of [0, 1]) {
          const label = createElement("label"),
            select = createElement("select");
          label.textContent = slot ? tr("battle_menu.left_hand") : tr("battle_menu.right_hand");
          select.setAttribute(
            "aria-label",
            slot
              ? tr("battle_menu.battle_left_hand_equipment")
              : tr("battle_menu.battle_right_hand_equipment"),
          );
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
        info.textContent = tr("battle_menu.enter_blitz") + blitz.join(" ");
        commands.append(info);
        for (const key of ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖", "X", "Y", "L", "R"])
          commands.append(
            button(key, () => {
              blitz.push(key);
              invalidate();
            }),
          );
        commands.append(
          button(tr("battle_menu.clear"), () => {
            blitz = [];
            invalidate();
          }),
        );
      }
      if (menu.input === "bushido") {
        const bar = createElement("progress");
        bar.max = 8;
        bar.value = level;
        bar.setAttribute("aria-label", tr("battle_menu.bushido_charge"));
        commands.append(bar);
      }
      if (menu.input === "slots") {
        const text = createElement("strong");
        text.dataset.reels = "";
        text.textContent = reels
          .map(
            (n) =>
              [
                "7",
                tr("battle_menu.dragon"),
                "BAR",
                tr("battle_menu.airship"),
                tr("battle_menu.chocobo"),
                tr("battle_menu.diamond"),
              ][n],
          )
          .join(" | ");
        commands.append(text);
        commands.append(
          button(
            tr("battle_menu.stop_reel_value", { v0: (battle.slots?.stopped.length ?? 0) + 1 }),
            () => {
              battle.stopSlot(index);
              if (!battle.slots) close();
              else invalidate();
            },
          ),
        );
        return;
      }
      if (menu.input === "dualcast") {
        const info = createElement("strong");
        info.textContent = tr("battle_menu.dualcast_spell_value", { v0: dual.length + 1 });
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
    canSelectTarget,
    selectTarget(side, n) {
      if (!canSelectTarget(side, n)) return false;
      send(selection, { side, index: n, all: targetAll });
      return true;
    },
    handleKey(event) {
      if (selection && event.key === "Shift" && !event.repeat) return toggleTargetAll();
      if (selection && event.key === "Escape") {
        cancelTarget();
        return true;
      }
      if (!selection && menu && event.key === "Escape") {
        close();
        return true;
      }
      if (selection) return false;
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
