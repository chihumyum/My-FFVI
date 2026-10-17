# 来源执行义务与正常输入探索

当前 1,150 个结构 cohort 不是 1,150 个人工场景任务。纯编译器从完整来源程序与地图 namespace 自动生成执行图，保留所有 3,304 份正文、186,003 条原指令、地图别名、Main 身份、局部调用、分支 successor、状态读写、timer/地图/战斗/ChangeScript 后继和所有未知。未分类 Battle/AI flow 不套用 Field 时钟规则。图是验收义务，不是剧情章节或可玩权限。

`source-story-explore.mjs` 只驱动现有 `runContentBatchRoute`，复用真实 EntryLoader、GameSession、GameFlow、map loader、prepared battle handoff、GameCommands 和 CheckpointStorage。唯一入口是真实 new-game；后继只能消费本次已提交 Storage 槽中精确 checkpoint 字节。它不开始脚本、不跳 PC、不写剧情状态，不为不可达分支构造假存档。

有界队列从实际稳定检查点尝试普通方向与确认输入，遇到真实 choice 才枚举公开选项。每条尝试独立重建并执行两次，保存各自原始证据；窗口 request ID 属于各自 Field，比较语义选项但输入仍使用该实例当前 ID。时间预算、输入深度和 choice 深度均显式保留未展开队列。缺战斗输入、命名/编队/商店输入或宿主保持 frontier。独立重放一致只证明执行可重复，不是原版行为 oracle。

探索的稳定边界会经过真实 Storage 保存与 EntryLoader 恢复，但 receipt 仍是 `blocked / exploration-stable-frontier`，不能借此通过已有完整 source-story-batch 验收。覆盖账本分别记录源根入场、自然退出、分支观察与实际 battle start/return 次数；未执行别名、未走的 successor 和未知都保留。`completeStoryBatches` 和 `sourceCampaignComplete` 固定为 0 / false。现有完整剧情合同的入口出口语义、所有分支、后继、结算和持续新游戏验收仍须独立通过。

`check-source-story-exploration.mjs` 从一份已经 complete、同代输入锁完整的私有来源候选生成全部 manifest 根并执行，不运行 producer/compileWorld、不发布内容、不回退公共缓存。实际 Core/loader 使用 sourceRoot 的固定 compiled/runtime；纯图和外部执行工具另记 hash，不给旧候选重签。

内容配置由 `--profile source|framework` 显式选择，默认 `source`。`framework` 读取该候选的 `/framework/full-content-refs.json`、`/framework/world/catalog.json`、`/framework/full-new-game.json` 和 `/framework/full-battle.json`。引用必须是同一 `framework` profile 的 v1 source role，URL 和实际正文摘要逐项匹配，且 `development:null`；缺失、混用配置或正文、不同入口种类均拒绝。Repository 和批次 manifest 使用该同一声明，完整地图集合仍须与来源图一致。

Web framework 正文仍是 `source-new-game-content-v1`，因此 route 保持 `source-new-game`，执行 receipt 保持 `source-profile`，存档 origin 仍由真实来源初始化产生。它不使用自定义放置的 `framework-new-game` 入口，不新增 initialized 权限，不改变 Storage namespace。报告继续标为 `original-source` 并另记 `profile:framework` 和 `nativeParity:false`。Web 策略不代表原版表现一致；来源图与实际 framework 类型化正文有差异时，账本仍记录 `source-root-binding-mismatch`，不吞未知或授予剧情完成。

```sh
node scripts/check-source-story-exploration.mjs \
  --source-root /absolute/frozen-source-runtime \
  --source-compiled /absolute/frozen-source-runtime/dist \
  --candidate-dir /absolute/frozen-source-runtime/build/reports/shared-source-candidate \
  --tooling-compiled /absolute/isolated-tool/dist \
  --output /absolute/private-report \
  --profile framework \
  --max-trials 16 --max-depth 4 --max-choice-depth 8 --max-ticks 30000
```

不指定战斗能力列表时，真实 battle-input 缺口明确保留。调用方可提供 `--battle-abilities` 作为玩家输入策略；仅在 live battle 当前命令、费用和目标允许时派发，不取得新能力，不构造胜利结果。完整来源剧情、浏览器与 native 一致性各自独立记录。
