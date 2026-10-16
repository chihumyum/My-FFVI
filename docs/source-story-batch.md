# 完整来源剧情批次验收

工作单位是明确声明的完整剧情批次。共用能力的静态 cohort、参数探针、独立正文执行、默认开场下一处报错和完整剧情贯通是不同证据。没有 route 合同的 cohort 返回 `unassessed / missing-contract`；不能把无静态诊断解释为剧情完成。

`source-story-batch.ts` 是现有 content-batch admission 和 story-continuity 合同之上的增量验收，不是 VM、来源初始化器或另一套游戏状态。`source-story-batch.mjs` 直接调用 `runContentBatchRoute`，沿用 GameEntryLoader、GameSession、GameFlow、GameMapLoader、prepared GameBattleHandoff、GameCommands 和 CheckpointStorage。旧 route/receipt/save 格式不变；新执行证据是显式可选的旁路字段。

## 合同和接口

`parseSourceStoryBatchContract` 读取 `source-story-batch-contract-v1`：

- `id / manifestHash / dependencyHash / lane` 绑定完整批次。
- `roots` 是完整来源根清单：map、script、source、来源文件 fingerprint key、完整 raw/typed body hash、正常 Main 来源位置、自然结束或交接以及后继根。
- `routes` 保留原 manifest route ID，声明所有根、必要战斗、每条分支实际 successor、story-route-continuity 入口/出口及状态变化合同。后继 route 只能消费先前 route 的真实最终 checkpoint。
- 原始来源 lane 要求精确入口/出口 map、roster、party、gil，不能以 null 表示已验收。其首段必须是真实 source-new-game；任意地图/中间 PC/独立正文均不能借用该 lane。

`assessSourceStoryBatch({ id, contract, binding, manifestHash, dependencyHash, diagnostics, witnesses, runs })` 返回三个状态：

- `unassessed`：未声明完整合同，包含 `missing-contract`。
- `blocked`：合同无效、未知依赖、漏根/漏分支、执行或状态不符、交接/战斗/存读档不足。
- `passed`：所有声明项闭合。只有 `coverage: complete-declared-source-batch` 可计入完整来源批次；`synthetic-contract-only` 只验收管线机制。

`sourceCampaignComplete` 与原版动态执行仍固定 false。一个来源批次通过不代替全游戏清单、其他分支、浏览器或原版一致性验收。

## 实际执行证据

Field 的 `sourceStoryExecution: source-story-execution-evidence-v1` 默认缺省。显式启用时，Field 只在现有真实执行点追加有界 journal：成功的 Main 根入场、已提交的分支 PC、实际地图/战斗交接请求、Main 通过窗口/插值/相机等结束守卫后的自然结束。没有 host callback 授予完成，没有逐指令复制，也不改变 RNG、时钟、权限和 checkpoint 字段。超出 100,000 条记录时只标记证据不完整，不改变游戏执行。

Core 不宣称其 Field 已发布；journal 的 `currentField` 固定 null。runner 只读取 `flow.session.field`，为每个实际 Field 记录来源、内容 pin 和完整 typed body；World 的私有候选准备另列 `candidateAttempts`。丢弃候选不成为到达记录。已提交目的地通过实际 World transition 绑定原地图请求；战斗交接通过真实 return 和原 continuation Main 入场绑定。普通独立正文结束或一个 requested handoff 都不足以通过。

每个根必须由正常 Main 原入口开始，完整 raw body 中的 Main 标签、typed body 和来源文件指纹均一致。分支 requirements 必须列出每个来源 Branch 的显式目标与 fall-through，执行 journal 逐项匹配。此版本不猜测不可达分支，也不把 Puppet/ChangeScript 等未闭合的根轨迹自动视为完成；它们保持缺证据的 blocked 状态。

runner 从实际 CheckpointStorage 读取保存槽原始字节，核对其中 checkpoint 与恢复后的实际 owner hash。必须有中途恢复及恢复后的正常输入，最终保存一次不能代替续玩。后段从前段真实 Storage current 字节截取实际 checkpoint payload，并复用 `assessStoryCheckpointLink`；多个 route 的 checkpoint 链也必须字节精确相等，不能把两个独立运行的末状态拼成连续流程。必要战斗要有真实 handoff/return、胜利 trace 和 owned settlement。

纯评估函数接收可信 runner 的证据；hash 相等本身不证明任意调用方 JSON 被执行。正式 CLI 不接受调用方自称 verified 的原始正文，而是从 `loadCorpus` 已核对快照重新定位唯一物理 script，核对完整 raw body、来源 bundle SHA 与实际内容包中的 typed body。它不运行内容 producer，也不发布内容。

## 调用

```sh
node scripts/source-story-batch.mjs \
  --input-root /absolute/project \
  --compiled-dir /absolute/isolated/dist \
  --manifest content-batches/declared-batch.json \
  --contract /absolute/local/complete-story-contract.json \
  --report build/reports/complete-story-batch.json
```

没有来源完整 route 合同的静态 cohort 由 planner 调用评估函数并传 `contract: null`，不能创建假 route 或拿示例合同补数。

`sourceStoryExecution` 是共享 Field runtime port。跨图转发依赖同轮 SharedRuntime4 单一注册；它只转发显式配置，不默认启用，不写存档。实施验证必须将两族合入同一个冻结 runtime，不能拿本族的单图机制测试声称跨图来源批次通过。

## 本轮验证范围

新增两条聚焦的 synthetic 来源合同测试，实际经过两个通过真实 checkpoint 相接的 route、Session、Flow、Field、四次战斗往返、中途 Storage/restore 与恢复后的输入，覆盖两种分支结果。synthetic 旧开发入口没有持久 map owner，因此其 state-continuity 的 map 断言显式为 null；实际 Field map 仍单独核对，结果只为 `synthetic-contract-only`。不能提升成原始来源批次。

同一正例附带漏根、无 journal 假完成、错误 runtime/source、中间 PC、漏分支、坏存档及删除分支 requirement 的拒绝检查。另一条在全部独立正文已经结束后制造最终恢复失败，整批仍 blocked。既有 admission、route program 和 story-continuity 的聚焦回归保持原格式。未执行全 core、649 producer、实际来源剧情、浏览器或 Ghidra。
