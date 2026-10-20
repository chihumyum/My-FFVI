import { mountGameZoom } from "./game-zoom.js";

const preferenceKey = "ffvi-touch-controls";
const directions = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function isTextEntry(target) {
  return !!target?.closest?.(
    "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
  );
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
  onZoom,
  canvas = document.getElementById("screen"),
}) {
  const root = document.createElement("div");
  root.id = "touch-controls";
  root.setAttribute("aria-label", "虚拟游戏手柄");
  root.innerHTML = `
    <div class="touch-toolbar">
      <button type="button" data-game-fullscreen hidden aria-pressed="false">全屏</button>
      <button type="button" data-touch-toggle>触控</button>
      <button type="button" data-touch-tools aria-expanded="false">工具</button>
      <button type="button" data-touch-zoom hidden aria-label="重置游戏画面缩放">100%</button>
      <output data-fullscreen-status role="status" hidden></output>
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
        <button type="button" data-game-key="Escape" class="touch-cancel" aria-label="返回或打开菜单" title="返回、取消；地图上打开菜单">返回 B</button>
        <button type="button" data-game-key="Enter" class="touch-confirm" aria-label="确认或交互">确认</button>
      </div>
    </div>`;
  document.body.append(root);
  const pad = root.querySelector(".touch-pad");
  const toggle = root.querySelector("[data-touch-toggle]");
  const toolsToggle = root.querySelector("[data-touch-tools]");
  const zoomReset = root.querySelector("[data-touch-zoom]");
  const fullscreenToggle = root.querySelector("[data-game-fullscreen]");
  const fullscreenStatus = root.querySelector("[data-fullscreen-status]");
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
  function positionPad() {
    const screen = canvas?.getBoundingClientRect();
    // Controls stay at the screen corners. Their overlap with the game only
    // changes transparency; it never changes the game viewport or placement.
    const overlaps = (element) => {
      const rect = element.getBoundingClientRect();
      return (
        screen &&
        screen.bottom > rect.top &&
        screen.top < rect.bottom &&
        screen.right > rect.left &&
        screen.left < rect.right
      );
    };
    root.dataset.layout = enabled && [...pad.children].some(overlaps) ? "floating" : "separate";
  }
  function layout() {
    release();
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    document.body.style.setProperty("--touch-viewport-height", `${height}px`);
    const main = document.querySelector("main");
    const adaptiveViewport =
      coarse.matches || navigator.maxTouchPoints > 0 || !!document.fullscreenElement;
    document.body.classList.toggle("touch-viewport", adaptiveViewport);
    if (adaptiveViewport) {
      const style = getComputedStyle(root);
      const safeTop = parseFloat(style.getPropertyValue("--safe-top")) || 0;
      const safeBottom = parseFloat(style.getPropertyValue("--safe-bottom")) || 0;
      main?.style.setProperty(
        "--game-available-height",
        String(Math.max(1, height - safeTop - safeBottom)),
      );
    } else main?.style.removeProperty("--game-available-height");
    onLayout?.();
    positionPad();
  }
  function update() {
    enabled =
      preference === "on" ||
      (preference === "auto" && (coarse.matches || navigator.maxTouchPoints > 0));
    document.body.classList.toggle("touch-enabled", enabled);
    pad.hidden = !enabled;
    toggle.textContent = `触控：${enabled ? "开" : "关"}`;
    toggle.setAttribute("aria-pressed", String(enabled));
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
  toolsToggle.onclick = () => {
    release();
    const show = document.body.classList.toggle("touch-tools-open");
    toolsToggle.setAttribute("aria-expanded", String(show));
  };
  function fullscreenChanged() {
    const active = !!document.fullscreenElement;
    fullscreenToggle.hidden = !document.fullscreenEnabled;
    fullscreenToggle.textContent = active ? "退出全屏" : "全屏";
    fullscreenToggle.setAttribute("aria-pressed", String(active));
    layout();
  }
  fullscreenToggle.onclick = async () => {
    release();
    fullscreenStatus.hidden = true;
    fullscreenToggle.disabled = true;
    try {
      // Fullscreen the whole page so the gamepad, menus and save dialogs stay
      // visible together. Keep the request in the button's user activation.
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      fullscreenStatus.textContent = "无法进入或退出全屏，请重试或检查浏览器权限。";
      fullscreenStatus.hidden = false;
    } finally {
      fullscreenToggle.disabled = false;
      fullscreenChanged();
    }
  };
  const zoom = canvas
    ? mountGameZoom({
        element: canvas,
        isSurface: (event) =>
          event.target === canvas || !!event.target?.closest?.(".pixi-accessibility"),
        onGesture: release,
        onChange: (view) => {
          zoomReset.hidden = Math.abs(view.scale - 1) <= 0.001;
          zoomReset.textContent = `${Math.round(view.scale * 100)}% ↺`;
          onZoom?.(view);
        },
      })
    : null;
  zoomReset.onclick = () => zoom?.reset();
  for (const button of root.querySelectorAll("[data-game-key]")) {
    button.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !enabled || isTextEntry(document.activeElement)) return;
      e.preventDefault();
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
  const visibility = () => {
    if (document.hidden) release();
  };
  window.addEventListener("blur", release);
  window.addEventListener("orientationchange", layout);
  window.addEventListener("resize", layout);
  window.visualViewport?.addEventListener("resize", layout);
  const screenObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(positionPad);
  if (canvas) screenObserver?.observe(canvas);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("fullscreenchange", fullscreenChanged);
  coarse.addEventListener("change", update);
  update();
  fullscreenChanged();
  return {
    release,
    resetZoom: () => zoom?.reset(),
    destroy() {
      release();
      window.removeEventListener("blur", release);
      window.removeEventListener("orientationchange", layout);
      window.removeEventListener("resize", layout);
      window.visualViewport?.removeEventListener("resize", layout);
      screenObserver?.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      coarse.removeEventListener("change", update);
      zoom?.destroy();
      root.remove();
    },
  };
}
