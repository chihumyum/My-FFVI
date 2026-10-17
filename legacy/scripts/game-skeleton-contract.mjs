// Shared evidence contract. This is the same representative scope used by
// both its executing producer and content-batch admission; adding a lane must
// update this one manifest rather than silently widening either consumer.
const checks = [
  {
    id: "entry-session", script: "check-game-entry-ui.mjs", kind: "controlled-game-entry-ui-check",
    countKey: "tests", marker: "pass", artifact: "game-entry-ui-check.json",
    args: ["--compiled-dir", "{compiled}"],
    publicAPIs: ["actual apps/game/app.js", "GameContentRepository", "GameEntryLoader", "GameFlow", "CheckpointStorage"],
    scope: "Actual app with controlled DOM/media: explicit entries, failures, cancellation and restored-owner binding",
  },
  {
    id: "default-entry-app", script: "check-initialized-systems-ui.mjs", kind: "controlled-initialized-systems-ui-check-v1",
    countKey: "cases", marker: "pass", artifact: "initialized-systems-ui-check.json",
    args: ["--compiled-dir", "{compiled}"],
    publicAPIs: ["actual apps/game/app.js default /game/", "GameContentRepository", "GameSession.prepareFrameworkNewGame", "GameEntryLoader", "GameCommands", "CheckpointStorage"],
    scope: "Current default entry and actual menu/restore handlers; DOM, media decode, Renderer and BattleView drawing are controlled",
  },
  {
    id: "continuous-playground", script: "check-systems-playground.mjs", kind: "systems-playground-check-v1",
    countKey: "tests", marker: "passed", artifact: "game-skeleton/continuous-playground.json",
    args: ["--compiled-dir", "{compiled}", "--package-root", "{content}", "--report", "{report}"],
    publicAPIs: ["GameContentRepository", "GameEntryLoader", "GameFlow", "GameMapLoader", "GameBattleHandoff", "GameCommands", "CheckpointStorage"],
    scope: "Actual page package: movement/event, two battles, item/equipment/party/field-magic menus, restore and continuing across maps",
  },
  {
    id: "battle-roundtrip", script: "check-game-framework.mjs", kind: "continuous-game-framework-check-v1",
    countKey: "stages", marker: null, artifact: "game-skeleton/battle-roundtrip.json",
    args: ["--dist", "{compiled}", "--battle-handoff", "prepared", "--report", "{report}"],
    publicAPIs: ["GameSession", "GameFlow", "GameEntryLoader", "GameBattleHandoff", "GameCommands", "CheckpointStorage"],
    scope: "Prepared entry/return cancellation and failure, defeat/fixed retry, one reward, restore and another battle",
  },
  {
    id: "owned-economy-growth", script: "check-initialized-systems.mjs", kind: "initialized-systems-check-v1",
    countKey: "tests", marker: "passed", artifact: "game-skeleton/owned-economy-growth.json",
    args: ["--compiled-dir", "{compiled}", "--content-dir", "{content}", "--report", "{report}"],
    publicAPIs: ["GameContentRepository", "GameSession.prepareFrameworkNewGame", "GameEntryLoader", "GameCommands", "GameBattleHandoff", "CheckpointStorage"],
    scope: "Source initializer on an authored map: native held domain, shop, magic stone, battle growth and durable restore",
  },
  {
    id: "map-world-travel", script: "check-world-travel.mjs", kind: "framework-world-travel-check-v1",
    countKey: "stages", marker: "passed", artifact: "game-skeleton/map-world-travel.json",
    args: ["--compiled-dir", "{compiled}", "--content-dir", "{content}", "--report", "{report}"],
    publicAPIs: ["GameContentRepository", "GameEntryLoader", "GameFlow", "GameMapLoader", "GameBattleHandoff", "GameCommands", "CheckpointStorage"],
    scope: "Source world geometry/terrain and exit, authored return, world encounter/one reward, menu/restore and next input",
  },
  {
    id: "declared-content-batch", script: "check-content-batch-program.mjs", kind: "controlled-content-batch-program-v1",
    countKey: "tests", marker: "passed", artifact: "content-batch-program-check.json",
    args: ["--compiled-dir", "{compiled}"],
    publicAPIs: ["runContentBatchRoute", "GameContentRepository", "GameEntryLoader", "GameCommands", "GameBattleHandoff", "CheckpointStorage"],
    scope: "Common runner: declared menus/intermediate restore, continuing inputs, second battle and rejected-program admission",
  },
];
const groups = [
  { id: "entry-and-session", label: "入口与会话", required: ["entry-session", "default-entry-app", "continuous-playground"] },
  { id: "map-event-and-travel", label: "地图、事件与切图", required: ["continuous-playground", "map-world-travel"] },
  { id: "battle-and-return", label: "战斗、重试与返场", required: ["battle-roundtrip", "continuous-playground"] },
  { id: "owned-menus-economy-and-growth", label: "持有菜单、经济与成长", required: ["continuous-playground", "owned-economy-growth"] },
  { id: "save-restore-and-continuation", label: "存读档与续行", required: ["entry-session", "default-entry-app", "battle-roundtrip", "declared-content-batch"] },
  { id: "content-batch-interface", label: "批量内容接口", required: ["declared-content-batch", "map-world-travel"] },
];

const freeze = value => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
};
export const GAME_SKELETON_CHECKS = freeze(checks);
export const GAME_SKELETON_GROUPS = freeze(groups);
