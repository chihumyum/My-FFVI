# FFVI Reweb

将 FF6 Pixel Remaster 迁移到浏览器。PR 提供地图、剧情、中文文本、图像、音乐和表数据；行为以 `~/ff6-snes-disasm` 的 `8130132` 为参考，PR 显式参数优先。不确定处记录警告并继续执行。

本机已提取的数据位于 `build/`。运行：

```sh
npm run play:build
npm run dev
```

打开 http://127.0.0.1:4173/game/ 。方向键 / WASD 移动，Enter / 空格确认，Esc 打开队伍与道具，Q 切换防卫战队伍。战斗选择指令后选择目标；「自动推进」同时加速对白和自动战斗。「剧情测试」使用 99 级、9999 HP 和高攻防队伍；与普通模式分开存档。自动游玩默认强化，`PLAY_TEST_BOOST=0 npm run play:through` 使用普通属性。

「自动行走」按 M1 的预设正常输入演示路线，到世界地图停止，可随时关闭手动操作。存档保存在此浏览器中。

```sh
npm run play:through
PLAY_THROUGH=M1 PLAY_TEST_BOOST=0 npm run play:through
npm run play:ai-smoke
npm run play:events-smoke
node --test src/play/*.test.mjs
```

自动游玩从正常新游戏开始，结果写入 `build/play/playthrough.json`。它使用和浏览器相同的运行时、战斗与按键路线，只操作移动、对话、普通换队和战斗指令。地图按需生成。

怪物 AI 直接解释 PR 的 430 个程序和 69 种指令，所有遭遇共用。`play:ai-smoke` 给每个程序执行六回合及受击、计时、临死通知；`play:events-smoke` 检查 42 个有遭遇绑定的 PR 战斗事件，并断言瓦尔加斯真实爆裂拳、偷衣及最终战阶段切换。独立强化战斗测试不代表主线通关或战斗平衡验收。未实现的技能效果会记录来源后使用普通攻击。

`src/play/` 为精简脚本、战斗与输入运行时；`apps/play/` 为 Canvas 画面和操作界面；`scripts/build-play*.mjs` 复用已有提取数据。原始游戏资产及生成数据不进入 Git。旧 `src/core` 和旧检查脚本仅供查阅，不再作为迁移门禁。

当前只验收 M1：新游戏 → 纳尔谢 → 尤弥尔 → 冰封幻兽 → 蒂娜苏醒 → 矿洞 → 洛克与莫古战 → 世界地图。各里程碑由 Agent 自行验收后继续，目标为全部主线至结局。真实进度、推测实现与已知问题记录在 [STATUS.md](STATUS.md)。
