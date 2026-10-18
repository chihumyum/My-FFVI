// Keep a usable loading/error screen even when the renderer's module or its
// initialization fails before the Pixi UI exists. No game state lives here.
const panel = document.getElementById("boot-status");
const message = document.getElementById("boot-message");
const slow = setTimeout(() => {
  message.textContent = "加载较慢，请稍候。也可以检查网络后重新加载。";
}, 10000);
try {
  await import("./app.js");
  panel.hidden = true;
} catch (error) {
  panel.dataset.state = "failed";
  message.textContent = "游戏加载失败，请重新加载。";
  console.error("[startup] Game initialization failed", error);
} finally {
  clearTimeout(slow);
}
