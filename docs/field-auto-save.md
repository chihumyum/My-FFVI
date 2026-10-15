# 来源 AutoSave 的 Web 保存屏障

全量来源 AutoSave 已解码为带 `sourceAutoSave: source-auto-save-v1` 的既有 `event-save` 指令。只有可信内容声明 `developmentProfile.autoSave = web-field-autosave-barrier-v1` 才可执行和恢复。它是显式 Web 保存扩展，**原版 AutoSave 指令尚未完整迁移**；严格来源内容缺少这个标记时保持阻塞。

来源全集有 95 个站点，均为 type1、完整三组八槽全零／空值。其中 94 个站点关联 58 条来源地图，另一个 Resident `sc_sht_corps_after:5` 尚未关联地图，仍保留在全量库存。649 图展开的旧 worklist 中有 746 次 AutoSave 使用；这是重复引用数量，不能视为 746 个可玩剧情。新检查器保留每份完整来源程序的正文摘要、逐指令 decode 诊断、所有 provider 需求、原始参数、后继和精确来源身份。

## 原生观察与明确差异

本批只导出 `External.Misc.AutoSave 0xb4e860` 与 `FieldMap.AutoSave 0x38da10`，重新绑定 DLL、符号、头文件、方法原字节及导出正文摘要。缓存位于忽略的 `build/native/story-autosave/`。原始字节观察与未定项见 [来源调查](event-save-source.md)。

脚本指令首 clock 根据 KeepBadStatusVisual 选择角色，同步 leader puppet 到玩家的位置、层、方向、动画，再同步 camera dummy，返回 Blank。下次 clock 调用原 AutoSlot 的 `Save(slotId, null, false)` 后直接 Next，不检查成功。FieldMap 的同名方法直接调用保存，不代表脚本首 clock 的同步步骤。

Web 变体保留首 clock yield，但序列化现有 Web owner；**不实现或宣称原生玩家／puppet／camera 同步**。`sourceAutoSaveSync` 始终保留为 deferred、unassessed 来源需求，不因为 Web 保存成功而变为 Available。原 AutoSlot 身份、全部同步虚调用副作用、存储耐久性和失败语义、原版 PC／Call 栈及载图重入仍未知。

Web 使用原 `GameEventSaveCoordinator`、`CheckpointStorage`、`GameSession` 和同一个 `FieldGame` 的屏障：持久化成功才 ACK，失败可重试，恢复从 ACK 后的 Web 续行点开始。它与原指令不等价，报告明确标记 `sourceOpcodeFullyMigrated:false`、`nativeParity:false`。新字段不会由存档授予 profile，不建立第二个保存或游戏状态 owner。

## 生命周期和门禁

首 clock 先核对完整 typed op 与可信程序，再验证既有稳定主任务／演员／窗口／效果门禁；没有请求、没有同步或后继执行。第二 clock 再次验证，以同一主任务发布普通保存请求。首 clock 的 transient wait 不进稳定存档，第二 clock checkpoint 复用当前事件格式，没有新 save schema。

活跃并行 puppet、未完成宝箱、运动或插值、消息／选项／商店、渐变、粒子历史、opaque Replay、切图及战斗维持原阻塞规则，不能提前完成它们来凑一个可保存时刻。请求未 ACK 时丢弃时间；取消或编码／存储失败保留原 request、owner 和旧存档。写后 ACK 异常仍遵守既有不可重试规则。恢复直接绑定可信 barrier 与独立 profile，跳过已经保存的奖励和保存指令，正常下一 clock 才执行后继。

## 本批验证

隔离编译后执行：

```sh
node scripts/check-field-auto-save.mjs --compiled-dir build/wip/autosave-batch
```

该检查重新加载并验证完整 corpus、所有 95 份受影响程序和 95 个精确站点。95 个站点分别进入同一个合成游戏程序，经过首 clock、请求、原事件 checkpoint、恢复、ACK 和后继；这是来源站点的受控 Web 运行，完整来源程序实际执行数仍为 0。报告另列真实 Coordinator／Storage 的取消、配额失败、重试、读取和后继，以及尚未闭合的完整程序诊断。此次 95 程序仍有 373 条 decode 诊断和 1374 条 provider 需求，不能因保存站点通过而移除。

六项新语义测试覆盖完整八槽、64 位来源 ID、首 clock、旧作者 barrier 兼容、未编码并行 owner、严格 profile 拒绝、伪造来源拒绝、取消、配额失败、重试及恢复不重放。与原保存、故事 VM、跨图／战斗计时回归合跑共 40 项通过。浏览器、原版运行、完整来源故事可达与全游戏迁移均不是这组结果的证据。

回执绑定指定 compiled 目录的 src／tests 与实际 apps/game／scripts 的开始、结束运行时摘要；不同目录或中途变化不能共用回执。decoder 输入合并同源 `system_zhc` 消息；结束时再次核对 corpus／field 的相同 snapshot header 和全部列出的有效字节，以及 native receipt、正文、DLL、符号、头文件，拒绝运行期间的来源或执行文件变化。
