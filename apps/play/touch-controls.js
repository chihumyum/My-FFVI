const preferenceKey = "ffvi-touch-controls";
const directions = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function isTextEntry(target) {
  return !!target?.closest?.(
    "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
  );
}

// Retain the label next to a repeated action, e.g. the item legend above a
// generic "Use" button. Its real Pixi control remains the activation target.
export function touchActionLabels(ui) {
  const contexts = new Map();
  const visit = (node, context = "") => {
    if (node.tag === "fieldset")
      context = node.children.find((child) => child.tag === "legend")?.textContent || context;
    contexts.set(node, context);
    for (const child of node.children) visit(child, context);
  };
  for (const root of ui.windows) visit(root);
  return new Map(
    [...ui.views].map(([node, view]) => {
      const label = (node.tag === "button" && node.attributes["aria-label"]) || ui.label(node);
      const context = contexts.get(node);
      return [view.container, context ? `${context} · ${label}` : label];
    }),
  );
}

export function distinguishTouchActions(actions) {
  const counts = new Map(),
    seen = new Map();
  for (const { label } of actions) counts.set(label, (counts.get(label) || 0) + 1);
  return actions.map((action) => {
    const index = (seen.get(action.label) || 0) + 1;
    seen.set(action.label, index);
    return counts.get(action.label) > 1
      ? { ...action, label: `${action.label}（${index}）` }
      : action;
  });
}

// One key may be held by two fingers. Releasing either finger must not release
// the other, and an interrupted pointer must never leave a direction held.
export class TouchKeyState {
  constructor(down, up) {
    this.down = down;
    this.up = up;
    this.pointers = new Map();
  }
  press(pointer, key) {
    this.release(pointer);
    const alreadyHeld = [...this.pointers.values()].includes(key);
    this.pointers.set(pointer, key);
    if (!alreadyHeld) this.down(key, false);
  }
  release(pointer) {
    const key = this.pointers.get(pointer);
    this.pointers.delete(pointer);
    if (key && ![...this.pointers.values()].includes(key)) this.up(key);
  }
  clear() {
    for (const key of new Set(this.pointers.values())) this.up(key);
    this.pointers.clear();
  }
}

export function mountTouchControls({
  onKeyDown,
  onKeyUp,
  onRelease,
  onLayout,
  getActions,
  getReadout,
}) {
  const root = document.createElement("div");
  root.id = "touch-controls";
  root.setAttribute("aria-label", "虚拟游戏手柄");
  root.innerHTML = `
    <div class="touch-toolbar">
      <button type="button" data-touch-toggle>触控</button>
      <button type="button" data-touch-options aria-expanded="false">选项</button>
      <button type="button" data-touch-tools aria-expanded="false">工具</button>
    </div>
    <div class="touch-options" hidden>
      <div class="touch-options-heading"><strong>当前可用操作</strong><button type="button" data-touch-close>收起</button></div>
      <div class="touch-readout" aria-live="polite"></div>
      <p>与画面中的按钮相同，可在这里大字点选。更多项目请点“下页”。</p>
      <div class="touch-options-list"></div>
    </div>
    <div class="touch-pad" hidden>
      <div class="touch-dpad" aria-label="方向键">
        <button type="button" data-game-key="ArrowUp" aria-label="向上">▲</button>
        <button type="button" data-game-key="ArrowLeft" aria-label="向左">◀</button>
        <span aria-hidden="true"></span>
        <button type="button" data-game-key="ArrowRight" aria-label="向右">▶</button>
        <button type="button" data-game-key="ArrowDown" aria-label="向下">▼</button>
      </div>
      <div class="touch-actions">
        <button type="button" data-game-key="Tab" class="touch-small" aria-label="切换战斗角色">换人</button>
        <button type="button" data-game-key="q" class="touch-small" aria-label="切换队伍">换队</button>
        <button type="button" data-game-key="Escape" class="touch-cancel" aria-label="取消或打开菜单">菜单 / B</button>
        <button type="button" data-game-key="Enter" class="touch-confirm" aria-label="确认或交互">确认</button>
      </div>
    </div>`;
  document.body.append(root);
  const pad = root.querySelector(".touch-pad");
  const toggle = root.querySelector("[data-touch-toggle]");
  const optionsToggle = root.querySelector("[data-touch-options]");
  const toolsToggle = root.querySelector("[data-touch-tools]");
  const options = root.querySelector(".touch-options");
  const actions = root.querySelector(".touch-options-list");
  const readout = root.querySelector(".touch-readout");
  const coarse = matchMedia("(any-pointer: coarse)");
  let preference;
  try {
    preference = localStorage.getItem(preferenceKey) || "auto";
  } catch {
    preference = "auto";
  }
  let enabled = false;
  let repeatAt = 0;
  let repeatTimer;
  const event = (key, repeat = false) => ({
    key,
    repeat,
    target: null,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    virtual: true,
    preventDefault() {},
  });
  const held = new TouchKeyState(
    (key, repeat) => onKeyDown(event(key, repeat)),
    (key) => onKeyUp(event(key)),
  );
  function release() {
    held.clear();
    clearInterval(repeatTimer);
    repeatTimer = null;
    for (const button of root.querySelectorAll("[data-game-key]"))
      button.classList.remove("pressed");
    onRelease?.();
  }
  function layout() {
    release();
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    document.body.style.setProperty("--touch-viewport-height", `${height}px`);
    document.body.style.setProperty(
      "--touch-controls-height",
      `${pad.getBoundingClientRect().height}px`,
    );
    const main = document.querySelector("main");
    if (enabled) {
      const safeTop = parseFloat(getComputedStyle(root).getPropertyValue("--safe-top")) || 0;
      main?.style.setProperty(
        "--game-available-height",
        String(Math.max(1, height - pad.getBoundingClientRect().height - safeTop - 52)),
      );
    } else main?.style.removeProperty("--game-available-height");
    onLayout?.();
  }
  function showOptions(show) {
    release();
    options.hidden = !show;
    optionsToggle.setAttribute("aria-expanded", String(show));
    if (show) refreshActions();
  }
  function update() {
    enabled =
      preference === "on" ||
      (preference === "auto" && (coarse.matches || navigator.maxTouchPoints > 0));
    document.body.classList.toggle("touch-enabled", enabled);
    pad.hidden = !enabled;
    optionsToggle.hidden = !enabled;
    toolsToggle.hidden = !enabled;
    toggle.textContent = `触控：${enabled ? "开" : "关"}`;
    toggle.setAttribute("aria-pressed", String(enabled));
    if (!enabled) {
      if (!options.hidden) showOptions(false);
      document.body.classList.remove("touch-tools-open");
      toolsToggle.setAttribute("aria-expanded", "false");
    }
    layout();
  }
  toggle.onclick = () => {
    preference = enabled ? "off" : "on";
    try {
      localStorage.setItem(preferenceKey, preference);
    } catch {
      // Controls remain usable when browser storage is unavailable.
    }
    update();
  };
  optionsToggle.onclick = () => showOptions(options.hidden);
  root.querySelector("[data-touch-close]").onclick = () => showOptions(false);
  toolsToggle.onclick = () => {
    const show = document.body.classList.toggle("touch-tools-open");
    toolsToggle.setAttribute("aria-expanded", String(show));
  };
  for (const button of root.querySelectorAll("[data-game-key]")) {
    button.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !enabled || isTextEntry(document.activeElement)) return;
      e.preventDefault();
      if (!options.hidden) showOptions(false);
      button.setPointerCapture(e.pointerId);
      held.press(e.pointerId, button.dataset.gameKey);
      button.classList.add("pressed");
      repeatAt = performance.now() + 300;
      repeatTimer ||= setInterval(() => {
        if (performance.now() < repeatAt) return;
        for (const key of new Set(held.pointers.values()))
          if (directions.has(key)) held.down(key, true);
      }, 100);
    });
    const pointerUp = (e) => {
      e.preventDefault();
      held.release(e.pointerId);
      if (![...held.pointers.values()].includes(button.dataset.gameKey))
        button.classList.remove("pressed");
      if (!held.pointers.size) {
        clearInterval(repeatTimer);
        repeatTimer = null;
      }
    };
    button.addEventListener("pointerup", pointerUp);
    button.addEventListener("pointercancel", pointerUp);
    button.addEventListener("lostpointercapture", pointerUp);
    button.addEventListener("contextmenu", (e) => e.preventDefault());
    // Pointer input already handled this action; a generated click must not
    // confirm a second dialogue or send a second menu toggle.
    button.addEventListener("click", (e) => e.preventDefault());
  }
  let actionSignature = "";
  function refreshActions() {
    if (options.hidden) return;
    const available = getActions?.() || [];
    const text = getReadout?.() || "";
    if (readout.textContent !== text) readout.textContent = text;
    readout.hidden = !text;
    const signature = available.map((action) => `${action.id}:${action.label}`).join("\n");
    if (signature === actionSignature) return;
    actionSignature = signature;
    actions.replaceChildren();
    for (const action of available) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.onclick = () => {
        // Resolve against the latest UI again; a battle or dialogue may have
        // advanced while this readable list was open.
        (getActions?.() || [])
          .find((current) => current.id === action.id && current.label === action.label)
          ?.activate();
        actionSignature = "";
        requestAnimationFrame(refreshActions);
      };
      actions.append(button);
    }
    if (!available.length)
      actions.textContent = "当前没有可点选的菜单。使用方向键移动，或按确认交互。";
  }
  const actionTimer = setInterval(refreshActions, 250);
  const visibility = () => {
    if (document.hidden) release();
  };
  window.addEventListener("blur", release);
  window.addEventListener("orientationchange", layout);
  window.addEventListener("resize", layout);
  window.visualViewport?.addEventListener("resize", layout);
  document.addEventListener("visibilitychange", visibility);
  coarse.addEventListener("change", update);
  update();
  return {
    release,
    destroy() {
      release();
      clearInterval(actionTimer);
      window.removeEventListener("blur", release);
      window.removeEventListener("orientationchange", layout);
      window.removeEventListener("resize", layout);
      window.visualViewport?.removeEventListener("resize", layout);
      document.removeEventListener("visibilitychange", visibility);
      coarse.removeEventListener("change", update);
      root.remove();
    },
  };
}
