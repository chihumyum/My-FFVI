# FFVI Reweb

将 FF6 Pixel Remaster 迁移到浏览器。PR 提供地图、剧情、中文文本、图像、音乐和表数据；行为以 `~/ff6-snes-disasm` 的 `8130132` 为参考，PR 显式参数优先。不确定处记录警告并继续执行。

本机已提取的数据位于 `build/`。运行：

```sh
npm run play:build
npm run dev
```

打开 http://127.0.0.1:4173/game/ 。方向键 / WASD 移动，Enter / 空格确认，Esc 打开队伍与道具，Q 切换防卫战队伍。世界地图上的「载具操作」可起飞、着陆、返回甲板及乘降。战斗选择指令后选择目标；「自动推进」同时加速对白和自动战斗。「剧情测试」使用 99 级、999999 HP 和高攻防队伍；与普通模式分开存档。自动游玩默认普通属性；`PLAY_TEST_BOOST=1 npm run play:through` 显式启用强化剧情测试。

「自动行走」按主线目标输入移动、交谈、选项和战斗指令，可随时关闭手动操作。普通自动推进为 4 倍速，强化剧情测试为 16 倍速；存档保存在此浏览器中。测试地址加 `?through=M2` 可在三分线选择处停止。队伍编成和商店有实际菜单；自动行走按当前目标选择已招募角色。野外行走按 PR 地形和步数遇敌，兽原可用真实干肉喂食嘎。自动跑法只做回归：强化模式从新游戏到结局；普通属性到三分线结束左右。旧补给、购物和训练策略已冻结，回归入口不再调用它们；经验、魔法学习点、金币与道具仍由游戏实际结算。Esc 菜单支持装备、魔石、学习进度、场外魔法和道具；战斗可选择背包中的投掷物，逃跑遵守原始阵型限制。

```sh
PLAY_TEST_BOOST=1 npm run play:through
PLAY_THROUGH=M1 PLAY_TEST_BOOST=0 npm run play:through
PLAY_THROUGH=M2 PLAY_TEST_BOOST=1 npm run play:through
npm run play:ai-smoke
npm run play:events-smoke
node --test src/play/*.test.mjs
node scripts/audit-play-abilities.mjs
```

自动游玩默认普通属性、目标为 M3-sabin；强化模式默认目标为结局。结果写入 `build/play/playthrough.json`。它使用和浏览器相同的运行时、战斗与按键路线。地图按需生成。随机序列默认种子1，`PLAY_SEED` 可指定其他种子；`PLAY_REPORT` 可指定独立报告路径。`PLAY_CHECKPOINT=build/play/checkpoint.json` 会在可操作边界保存实际游玩的状态；`PLAY_CHECKPOINT_DIR=build/play/checkpoints` 可保留各目标进入时的真实存档。`PLAY_RESUME=build/play/checkpoint.json npm run play:through` 从该存档继续，结果会标记为 resume，不计作一次新的完整新游戏验收。

自动跑法败北时，先检查公式、技能、怪物AI和战斗事件。游戏bug必须修复；确认属于跑法策略不足时，不再增加购物、练级或MP预算策略，直接从真实战前存档进入强化剧情测试：

```sh
PLAY_TEST_BOOST=1 PLAY_RESUME=build/play/checkpoint.json \
PLAY_BOOST_REASON='已核对源数据，本次为跑法策略不足' \
PLAY_REPORT=build/play/boosted-continuation.json npm run play:through
```

显式强化会复制读取的普通存档并使用已有测试属性，不改写原存档或剧情旗标；战斗仍实际执行。报告记录原存档模式、强化模式和原因，强化结果只证明剧情可继续。
浏览器败北界面的「强化重试（剧情测试）」使用同一入口，读取普通存档副本，后续保存在独立的剧情测试槽。

怪物 AI 直接解释 PR 的 430 个程序和 69 种指令，所有遭遇共用。`play:ai-smoke` 给每个程序执行六回合及受击、计时、临死通知；`play:events-smoke` 检查 42 个有遭遇绑定的 PR 战斗事件，并断言瓦尔加斯真实爆裂拳、偷衣及最终战阶段切换。独立强化战斗测试不代表主线通关或战斗平衡验收。未实现的技能效果会记录来源后使用普通攻击。

`src/play/` 为精简脚本、战斗与输入运行时；`apps/play/` 为 Canvas 画面和操作界面；`scripts/build-play*.mjs` 复用已有提取数据。原始游戏资产及生成数据不进入 Git。旧 `src/core` 和旧检查脚本仅供查阅，不再作为迁移门禁。

战斗按 PR 指令显示正式菜单；魔法、道具、投掷、机械、青魔法、舞蹈和狂怒各有子菜单。Tab 或「操作角色」切换就绪成员；菜单支持前后排、ATB 模式和战斗速度。必杀技支持方向键及 X/Y/L/R 输入，Enter 确认；剑技按蓄力等级选择，老虎机逐轮停止。戈戈可在队伍菜单自选三项指令。

独立指令测试页为 `/game/battle-lab.html`，使用 PR 阵型和明确强化的测试队伍，不修改剧情存档。`node scripts/check-play-commands.mjs` 检查角色学习、指令替换、幻化消耗、状态清理和真实资源消耗。最近完整强化回归见 `build/play/stage1-accepted.json`，普通回归在洛克线隧道装甲战败北，未继续调整跑法。已知问题与猜测实现见 [STATUS.md](STATUS.md)。

下一阶段先做地基调整：纯格式化、独立 PR 数据导出、Opus/Web Audio、Pixi WebGL、Vite 静态打包，之后再制作 PR 界面。音频迁到地基阶段，HD-2D 暂不处理。
