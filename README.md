# FFVI Reweb

将 FF6 Pixel Remaster 迁移到浏览器。PR 提供地图、剧情、中文文本、图像、音乐和表数据；行为以 `~/ff6-snes-disasm` 的 `8130132` 为参考，PR 显式参数优先。不确定处记录警告并继续执行。

本机已提取的数据位于 `build/`。运行：

```sh
npm run play:build
npm run dev
```

打开 http://127.0.0.1:4173/game/ 。方向键 / WASD 移动，Enter / 空格确认，Esc 打开队伍与道具，Q 切换防卫战队伍。世界地图上的「载具操作」可起飞、着陆、返回甲板及乘降。战斗选择指令后选择目标；「自动推进」同时加速对白和自动战斗。「剧情测试」使用 99 级、9999 HP 和高攻防队伍；与普通模式分开存档。自动游玩默认普通属性；`PLAY_TEST_BOOST=1 npm run play:through` 显式启用强化剧情测试。

「自动行走」按主线目标输入移动、交谈、选项和战斗指令，可随时关闭手动操作。普通自动推进为 4 倍速，强化剧情测试为 16 倍速；存档保存在此浏览器中。测试地址加 `?through=M2` 可在三分线选择处停止。队伍编成和商店有实际菜单；自动行走按当前目标选择已招募角色并购买所需道具。野外行走按 PR 地形和步数遇敌，兽原可用真实干肉喂食嘎。普通自动游玩会通过正常输入开箱、装备、购买、恢复和行走练级；经验、魔法学习点、金币与道具均实际结算。Esc 菜单支持装备、魔石、学习进度、场外魔法和道具；战斗可选择背包中的投掷物，逃跑遵守原始阵型限制。

```sh
npm run play:through
PLAY_THROUGH=M1 PLAY_TEST_BOOST=0 npm run play:through
PLAY_THROUGH=M2 PLAY_TEST_BOOST=1 npm run play:through
npm run play:ai-smoke
npm run play:events-smoke
node --test src/play/*.test.mjs
node scripts/audit-play-abilities.mjs
```

自动游玩从正常新游戏开始，结果写入 `build/play/playthrough.json`。它使用和浏览器相同的运行时、战斗与按键路线，只操作移动、对话、队伍/商店菜单和战斗指令。地图按需生成。随机序列默认种子1，`PLAY_SEED` 可指定其他种子；`PLAY_REPORT` 可指定独立报告路径。`PLAY_CHECKPOINT=build/play/checkpoint.json` 会在可操作边界保存实际游玩的状态；`PLAY_CHECKPOINT_DIR=build/play/checkpoints` 可保留各目标进入时的真实存档。`PLAY_RESUME=build/play/checkpoint.json npm run play:through` 从该存档继续，结果会标记为 resume，不计作一次新的完整新游戏验收。

怪物 AI 直接解释 PR 的 430 个程序和 69 种指令，所有遭遇共用。`play:ai-smoke` 给每个程序执行六回合及受击、计时、临死通知；`play:events-smoke` 检查 42 个有遭遇绑定的 PR 战斗事件，并断言瓦尔加斯真实爆裂拳、偷衣及最终战阶段切换。独立强化战斗测试不代表主线通关或战斗平衡验收。未实现的技能效果会记录来源后使用普通攻击。

`src/play/` 为精简脚本、战斗与输入运行时；`apps/play/` 为 Canvas 画面和操作界面；`scripts/build-play*.mjs` 复用已有提取数据。原始游戏资产及生成数据不进入 Git。旧 `src/core` 和旧检查脚本仅供查阅，不再作为迁移门禁。

修正世界海域限制后，普通属性新游戏已通过魔导研究所、封魔洞窟、帝国晚宴、萨玛莎、提丰和空军，进入浮游大陆，目前在究极神兵战败北，仍在校正正常准备和资源循环。强化剧情测试已从新游戏贯通 M1–M10，实际击败最终战并执行完片尾，结果为 `build/play/main-story.json`。全程普通属性、完整技能效果、画面一致性和所有支线仍未全部验收，详见 [STATUS.md](STATUS.md)。
