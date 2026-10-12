import { GameSession } from "/runtime/core/game-session.js";
import {
  verifyContent,
  contentDigest,
} from "/runtime/core/content-integrity.js";
import { encodeSavedGame, decodeSavedGame } from "/runtime/core/saved-game.js";
import { EquipmentView } from "/game/equipment-view.js";
import { BattleView } from "/game/battle-view.js";
import { battleAppearanceQuads } from "/runtime/core/battle-appearance.js";
import { projectDevelopmentBattleLayout } from "/runtime/core/battle-layout.js";

const $ = (id) => document.getElementById(id);
const controlIds = [
  "reset-fixture",
  "start-battle",
  "step-battle",
  "finish-battle",
  "win-fixture",
  "save-fixture",
  "load-fixture",
  "grant-equipment",
];

async function initialize() {
  const [field, catalog] = await Promise.all(
    ["/game/content.json", "/game/battle.json"].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${url}`);
      return verifyContent(await response.json());
    }),
  );
  if (!catalog.gameState.equipmentSystem)
    throw new Error("Equipment catalog is unavailable");
  for (const definition of Object.values(
    catalog.gameState.equipmentSystem.catalog.definitions,
  )) {
    if (definition.empty || definition.blockers.length) continue;
    const option = document.createElement("option");
    option.value = String(definition.id);
    option.textContent = definition.name.replace(/<IC_[A-Z0-9_]+>/g, "");
    $("grant-equipment-id").append(option);
  }
  const fixtureField = structuredClone(field);
  const site = {
    script: "__equipment_probe",
    index: 0,
    source: {
      file: "controlled-browser-input",
      assetPath: "equipment-handoff",
    },
  };
  fixtureField.scripts.__equipment_probe = [
    {
      ...site,
      kind: "encounter",
      party: 3,
      continuation: "__equipment_return",
    },
  ];
  fixtureField.scripts.__equipment_return = [
    { ...site, script: "__equipment_return", kind: "exit" },
  ];
  const { contentHash: originalFieldHash, ...fixturePayload } = fixtureField;
  fixtureField.contentHash = await contentDigest(fixturePayload);
  const images = new Map();
  await Promise.all(
    [
      ...new Set(
        Object.values(catalog.common.sprites).map((sprite) => sprite.file),
      ),
    ].map(async (file) => {
      const image = new Image();
      image.src = file;
      await image.decode();
      images.set(file, image);
    }),
  );
  let game,
    saved,
    busy = false;
  const view = new EquipmentView($("equipment-panel"), () =>
    sync("装备已应用；库存、菜单参数与下次参战参数使用同一份状态。"),
  );
  const battleView = new BattleView(
    $("game"),
    catalog.common,
    images,
    () => run(leave),
    () => run(retry),
    battleAppearanceQuads,
    projectDevelopmentBattleLayout,
  );

  function sync(message) {
    $("equipment-panel").inert = busy;
    view.render(game);
    if (game.battle) {
      battleView.sync(game.battle, false);
      battleView.draw(game.battle);
      $("battle-projection").textContent = game.battle.players
        .map(
          (p) =>
            `${p.name} · 攻击力 ${p.physical.attack} · 耐力 ${p.vitality} · 防御力 ${p.defense} · 魔法防御 ${p.magicDefense} · 最大 HP ${p.maxHp} / MP ${p.maxMp}`,
        )
        .join("\n");
    } else {
      battleView.hide();
      $("game")
        .getContext("2d")
        .clearRect(0, 0, $("game").width, $("game").height);
      $("battle-projection").textContent = "进入战斗后显示实际参战队员参数。";
    }
    if (message) $("receipt").textContent = message;
    $("reset-fixture").disabled = busy;
    $("start-battle").disabled = busy || !game.checkpointReady;
    $("save-fixture").disabled = busy || !game.checkpointReady;
    $("load-fixture").disabled = busy || !saved || !!game.battle;
    $("grant-equipment").disabled = busy || !game.checkpointReady;
    $("grant-equipment-id").disabled = busy || !game.checkpointReady;
    for (const id of ["step-battle", "finish-battle", "win-fixture"])
      $(id).disabled = busy || game.battle?.phase !== "active";
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    sync();
    try {
      await action();
    } catch (error) {
      console.error(error);
      $("receipt").textContent = "本次检查未完成，请重置后重试。";
    } finally {
      busy = false;
      sync();
    }
  }
  function reset() {
    game = new GameSession(fixtureField, catalog);
    saved = null;
    view.reset();
    sync(
      "开场装备已就绪。可先卸下一件装备，确认空闲数量增加后再给其他队员选装。",
    );
  }
  function start() {
    game.field.startEvent("__equipment_probe");
    game.advance(10);
    if (!game.battle) throw new Error("Controlled encounter did not start");
    game.battle.players.forEach((p) => {
      p.atb = p.hp > 0 ? 100 : 0;
    });
    game.battle.enemies.forEach((p) => {
      p.atb = 0;
    });
    sync(
      "已进入来源战斗。行动条为受控输入；右侧显示换装后实际参战参数，战斗期间无法换装。",
    );
  }
  function leave() {
    if (!game.continueVictory()) return;
    game.advance(10);
    sync("胜利已提交并返回空闲地图。装备保留，库存与角色参数可继续检查。");
  }
  function retry() {
    game.retryBattle();
    sync("已恢复战前队伍与装备。下一次攻击使用恢复后的参数。");
  }
  const actions = {
    "reset-fixture": reset,
    "start-battle": start,
    "grant-equipment": () => {
      if (!game.checkpointReady) return;
      const id = Number($("grant-equipment-id").value);
      game.state.fieldInventory
        .prepare({ kind: "grant-equipment", id, count: 1 })
        .commit();
      sync(
        "共享库存已取得一件检查装备。可换装、记录检查点并进入战斗比较；正式开场和存档未写入。",
      );
    },
    "step-battle": () => {
      game.advance(410);
      sync("已推进 410 毫秒。");
    },
    "finish-battle": () => {
      game.advance(500);
      sync("已推进 500 毫秒。");
    },
    "win-fixture": () => {
      game.battle.enemies.forEach((p) => {
        p.hp = 0;
      });
      game.advance(1000);
      sync("受控敌人 HP 置零，用于检查战后交接；这不表示自然完成战斗。");
    },
    "save-fixture": async () => {
      saved = await encodeSavedGame(game.checkpoint(), 0);
      sync(
        "装备与库存检查点已记录在页面内存中。可继续换装后恢复，正式存档未写入。",
      );
    },
    "load-fixture": async () => {
      game = GameSession.restore(
        (await decodeSavedGame(saved)).checkpoint,
        fixtureField,
        catalog,
      );
      view.reset();
      sync("检查点已恢复。请比较六个部位、总持有、空闲数量与角色参数。");
    },
  };
  for (const id of controlIds) $(id).onclick = () => run(actions[id]);
  $("game").addEventListener("keydown", (event) => {
    if (game.battle) battleView.keyboard(event);
  });
  reset();
}

initialize().catch((error) => {
  console.error(error);
  $("receipt").textContent = "装备工作台未能载入，请检查本地游戏资源后重试。";
});
