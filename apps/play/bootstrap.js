// Keep a usable loading/error screen even when the renderer's module or its
// initialization fails before the Pixi UI exists. No game state lives here.
import { prepareIdentity } from "./identity.js";
import { loading } from "./loading.js";
loading.begin("准备存档身份与游戏模块…", { boot: true });
window.ffviLoading = () => loading.snapshot();
try {
  await prepareIdentity();
  await import("./app.js");
  loading.finish();
} catch (error) {
  loading.fail(error);
  console.error("[startup] Game initialization failed", error);
}
