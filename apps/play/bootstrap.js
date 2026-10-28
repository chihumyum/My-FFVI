import { tr } from "../../src/play/i18n.js";
// Keep a usable loading/error screen even when the renderer's module or its
// initialization fails before the Pixi UI exists. No game state lives here.
import { prepareIdentity } from "./identity.js";
import { loading } from "./loading.js";
import { initializeLanguage } from "./language.js";
await initializeLanguage();
loading.begin(tr("bootstrap.preparing_save_identity_and_game_modules"), { boot: true });
window.ffviLoading = () => loading.snapshot();
try {
  await prepareIdentity();
  await import("./app.js");
  loading.finish();
} catch (error) {
  loading.fail(error);
  console.error("[startup] Game initialization failed", error);
}
