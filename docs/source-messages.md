# 来源字段消息与自动字幕

本文保留 v31 的 `source-message-document-v1` 短字幕子集，并在后半部记录 v97 的普通窗口/时序序列族。两个文档协议使用同一个消息所有者。

v31 将普通字段消息管理器的一个共用子集接入 Web：无边框、无说话人、单页自动消息，以及显式 `MsgClose`。它服务于真实来源 `Msg` 参数和本地化资源；运行时没有按开场脚本名、消息 ID 或地图 ID 分支。普通确认对白仍由既有路线处理，滚动、渐入、歌剧和战斗消息管理器不借用本模块的时序。

原生证据来自当前提供的 PR 构建静态分析。所有原生回执保持 `semanticsVerified=false`，没有原版动态运行、字体像素或完整新游戏可玩性证明。

## 原生行为

| 来源 | 已恢复的职责 |
| --- | --- |
| `Msg` `0x2bdca0`、`PlayMessageCommon` `0x2be900` | 等待 `MessageReady`，读取窗口类型、位置、时长和消息 key。负时长发起消息后返回 Next，不是文本显示时长。 |
| `WindowParams` `0x2bd1c0`、`MessageWindowClient.Play` `0x31f3d0` | 窗口类型 `3` 仍使用普通字段控制器，只隐藏窗框；位置 `0 / 1 / 2` 对应上、中、下。 |
| `SetContent` `0x98c360`、`Play` `0x98b520`、`PlayInit` `0x98b2a0` | 建立消息内容、控制标签和播放状态；新的消息替换同一个全局窗口。 |
| `PlayingInit` `0x98b5e0`、`ToNextMessage` `0x98dd40` | 首次 Update 进入 Playing 时直接显示至当前页的下一个等待点。`PlayingInit` 尾跳在原始机器码中确认为 `0x98dd40`，不能误读成默认逐字播放。 |
| `WaitContent.Parse` `0x4f0f00`、`TimeWaitUpdate` `0x98dc80`、`TimeFunction.Function` `0xb16930` | WAIT 后缀使用明确的字符串 switch；等待以 float32 累加，达到时间后丢弃多余时间，不连续追赶后续状态。 |
| `InputWaitInit` `0x98a460`、协程 `0x997450`、`EndWaitInit` `0x989e70` | `AUTO_P` 使用自动输入分支。末端自动等待为 `0.3` 秒；完成后文字仍留在窗口，不自动关闭。 |
| `MsgClose` `0x2bd270`、`Stop` `0x320210`、`Close` `0x989180` | 取消活动消息并恢复字段事件更新组，与文本自己的等待是否完成无关。 |
| `InputTypeMessageData` `0x850630 / 0x8506b0` | 本版该 FF6 实现的映射字典初始为空；查不到映射时沿用输入消息 key。 |

WAIT 的已支持后缀保留原版大小写比较：标签匹配不区分大小写，但捕获的后缀经过普通 C# 字符串比较。因此 `WAITff` 对应 `63.75` 秒，不能将 `WAITFF` 也解释为该值。源方法对未知后缀有回退，本模块在这些形态处保留门禁，没有把全部十六进制字符串当作四分之一秒计数。

实际开场第一条消息在 `sc_e_0001` index `13`：无边框，负时长，四行自动消息，尾端 WAIT 为 `63.75` 秒；后继脚本 `Wait` 是独立的 `10.3` 秒，之后淡出并显式关闭消息。这条源调用用于回归，不能把 `10.3` 秒写成消息播放规则或等待文字自行结束。

## 消息期间的更新集合

`SubSceneManagerMainGame` 静态构造 `0x7126a0` 的 C 输出在 PIC 调用附近截断。检查器直接重验原始 DLL 和 metadata 中 68 字节数组，字段 SHA-1 为 `BF3CD46B7965B900CE188AF1BDA4F3A57ADB0646`；`StateEntityAttribute[8] = 9`，`[12] = 3`。它们分别是消息组和事件组的实体属性掩码，而不是全局暂停开关。

`EntityManager.SwitchCurrentUpdateTargetEntities` `0xab00d0` 按 `(mask & entityAttribute) > 0` 选择实体。消息开始和关闭都传 `invokeCallback=false`，不应凭空调用实体选中/移除回调。

| 对象 | 来源属性 | 消息组 `9` | 关闭后事件组 `3` |
| --- | --- | --- | --- |
| 普通字段演员，包括本版源工厂创建的 resident、party 和 player | `2` | 暂停 | 继续 |
| 设置了 `IsMoveWhileDisplayMessage` 的来源 NPC | `10` | 继续 | 继续 |
| scroll dummy / 摄像机跟随对象 | `10` | 继续 | 继续 |
| 地图 renderer、tile animation、field effect particle | `42` | 继续 | 继续 |
| 交互图标 | `64` | 不在集合 | 不在集合 |

`FieldNonPlayer` / `FieldPartyEntity` 构造器 `0xe18410` 将属性初始化为 `2`；`SetProperty` `0xe17c80` 仅在实际来源 `IsMoveWhileDisplayMessage` 为 true 时改为 `10`。本轮新游戏工厂的 55 个演员没有执行该 NPC property 更新，均保留属性 `2`。一般地图 NPC 不能因为缺属性数据而套用这个结论。

`FieldNonPlayer.UpdateEntity` `0xaec930` 与 `FieldCharaEntity` `0x87af60` 将移动和精灵动画推进放在实体 Update 内。暂停普通演员时两者都暂停；脚本 VM、全局 fade 和消息自身时钟继续。摄像机与 tile animation 分别按实际属性保持更新。只有显式关闭才发出组 `12`；自动文本播放结束不能偷偷恢复角色移动。

## 所有者、事务与保存

`src/core/source-message.ts` 只有一个 `SourceMessageState` 所有者：

- `prepare(op)` 验证并复制候选，返回 `flow:"next"`、来源更新组 effects 和一次性 `commit()`；准备不写入当前消息。
- 父宿主先准备演员更新集合，再一次提交消息和外部集合。缺少更新宿主、旧对白占用或未知对象资格时拒绝，不能只显示字幕而漏掉暂停效果。
- 消息时钟推进、替换或关闭都会使旧事务过期；重复提交同样拒绝。输入、投影、快照与候选分叉均不共享可变文档。
- `advance(seconds)` 是一次消息 manager Update，使用 float32 计时；宿主采用确定的 Web 逻辑步调度。Unity 协程与浏览器帧边界的动态一致性没有被这套受控测试证明。
- `projection` 只含可呈现内容和阶段，renderer 不决定何时完成等待。自动消息的 `confirm()` 返回 false。
- `fork()` 能复制活动候选。稳定恢复只接受空窗口快照；正在播放、等待或已完成但仍保留文字的窗口都不可保存。活动消息不会被保存成一个可重播的源指令。

主线程将 effects 接到 `FieldGame` 同一个实体更新 mask，消息与旧对白互斥。该接线和正式新游戏装配的宿主测试独立于这里的纯消息测试。

## 字体与单页边界

`ConvertLineTextList` `0x320700 / 0x320320` 通过 Unity `TextGenerator`、实际 RectTransform 和字体设置计算自动换行。普通字段 prefab 明确 `newLineCount=4`、字号 `40`、基准文本宽 `1000`、FontSelector 类型 `Font03`；`FontManager.CreateFontParameter` `0xab2360` 和 `FontSelector.SetFontParameter` `0x373fb0` 会替换运行时字体。不能用 prefab 内的日文字体证明中文最终排版。

旧 `source-message-document-v1` Web 能力显式限制为最多四个手工换行后的短行，每行最多 `20` 个已支持 BMP 字符；组合符、补充平面字符、控制符及其它待恢复字形布局不准入。**20 是当前 Web 能力上限，不是从原版提取的换行列数，也不能证明这些文本在原版字体中绝不换行。** 本轮 11 处候选源消息的最长一行为 19 字。Canvas 字体、定位和阴影保持 Web 近似；原版字形、字距、自动换行和像素一致性仍未验收，不能把该近似收据用于迁移发布准入。

v31 旧协议将超出该上限、超过四行、页中等待、多页、手动确认、名字替换、同步或正时长 `Msg` 留在门禁处；不能通过扩大旧字符上限冒充恢复原生分页。v97 的独立序列协议和 DOM 可读策略见下节。颜色/金额/变量及其它未知控制、fade/scroll/opera/battle 窗口仍不借用普通字段时序。

## v31 历史检查入口

```sh
./node_modules/.bin/tsc --outDir build/v31-field-dist --pretty false
node --test build/v31-field-dist/tests/source-message.test.js
node scripts/check-source-message-native.mjs
node scripts/check-source-message.mjs --compiled-dir build/v31-field-dist
```

13 项独立测试覆盖异步开始、页末等待、float32、替换/取消、外部组效果、过期事务、保存限制、严格控制标签和 Web 页幅门禁。原生检查从 DLL、symbols、header、metadata 重新验证 44 份完整方法回执和 10 个原始机器码范围，输出 `build/reports/source-message-native-check.json`。

v31 历史来源检查遍历全部 `4838` 处 `Msg` 与 `55` 处 `MsgClose`，当前本模块接收 `11 + 55` 处，剩余 `4827` 处记录具体阻塞原因。66 个受控探针经过同一个共享 decoder 和消息所有者，另核开场独立 Wait/Close、控制后缀、prefab 来源身份与外部更新组。输出 `build/reports/source-message-check.json`；报告不复制来源正文，只记录来源定位、摘要和页幅统计。静态调用点数、受控时钟通过数、实际浏览器演出和原版动态一致性是不同证据，均不代表剧情覆盖率。


## v97 普通窗口、分页与解释器等待

`src/compiler/source-message-sequence.ts` 编译普通字段 `Msg` / `MsgFinishWait`。共享 decoder 先保留已有旧协议和普通对白能力；新协议处理窗口 `0 / 3`、位置 `0 / 1 / 2`、明确说话人，以及负、零、正时长。保留原始整数、浮点、字符串槽和下一条来源 mnemonic；未知窗口、保留槽、缺本地化、未知标签和未绑定名字不准入。

`source-message-sequence-v1` 保留有序 `text / WAIT / PRESS / P / AUTO_P / CT` token。`CT` 决定同一窗口的居中，`AUTO_P` 在原管理器中决定整个窗口的自动输入；`P` 才参与正时长的页数除数。大小写和 WAIT 后缀遵守前述源方法，未知 WAIT 不折算成猜测时长。自动窗口同时含 `PRESS` 时需要尚未提供的外部输入回调，明确阻塞。

唯一的 `SourceMessageState` 负责消息 phase、窗口 ticket、页面和确认；任务只保存 Msg 包装器的等待游标，没有第二个消息状态所有者。负时长发起后 Next；零/正时长首先等待原管理器进度。分页等待、末端等待分别使用原包装器时钟；正时长末端重新开始计时，不能把最终确认提前当作时长结束。紧邻 `Select` 时按 complete 状态交接选择，紧邻 `Msg` 时保留同一个普通窗口。`MsgFinishWait` 读取全局 end-wait，不创建另一个窗口。

消息 effects、名字候选、时序上下文和当前任务先完成验证，再由现有 FieldGame 接线发布。票据拒绝旧窗口上的延迟回调。跨任务 `ChangeScript` / hook 恢复 / main 结束不得遗失另一个任务的活动窗口；战斗和地图交接也不能带走尚未关闭的窗口。错误保留 locals、任务与原窗口，不以强制 close 代替未知取消语义。稳定保存仍只接受空窗口，恢复和跨图从显式 runtime port 取得上下文，存档本身不授予宿主能力。

原生 Msg 包装器还使用共享 `Core.GeneralRegisters` 的 `i0 / i1 / i2` 与 `r1 / r2` 槽。v97 游标本身不是该银行。v98 为状态清理的可观察消费者增加同一 Task 的明确 bank，并在消息起止边界投影这些槽；游标仍是唯一活动消息计时进度，ticket 不充当原生槽。这不是全部 scratch 写入或原生时钟位值的完整模拟，见 [共用生命周期](story-shared-lifecycles.md)。

## 明确的 Web 策略与完整可读性

`createWebFieldMessageSequencePort()` 位于 `src/core/source-message-sequence.ts`。生产 app 和 `check-framework-route.mjs` 导入同一个纯 factory：`source-explicit-pages`、`integratorAutomatic=false`、`battleMessageSpeedFactor=1`。这是明确的 Web 策略，不是从原版配置恢复的默认值。一般 core API 缺少 factor 时，仍拒绝需要它的正时长；来源 bypass 和已有 Integrator 自动语义分别验证，不借用 factory 掩盖未知。

`GameSessionRuntime → WorldSession → FieldGame` 传递同一 port；恢复同样由调用方重新提供。新游戏路线回执记录实际 prepared context、真实 `acceptsInput` 确认前后投影、选择和跨图记录；不改来源脚本、剧情 flag 或存档。检查器的直接音频就绪、固定时间戳和 headless 展示仍是受控环境，不能称为完整生产或原版运行。

`apps/game/source-message-view.js` 是生产 app 实际调用的呈现 helper。新序列页以完整 `textContent`、保留空白的换行、长词换行和有界滚动区域呈现；说话人/顶部/中部/底部、居中、选择和暂停显隐均来自现有 owner。相同窗口页不重复改写文字或重置滚动，新 ticket/页面/FieldGame 才重置。Canvas 不再重复绘制新协议，旧 v1 短字幕仍走其原路径和 20 字限制。

这套可读策略不模拟 Unity TextGenerator、原生四行自动分页、字形/字距和像素位置。按键采用明确的 10ms Web 边沿保护，未声称复刻原生 held-key 重复周期。歌剧、滚动、渐入、战斗消息、`FULL_SPACE`、颜色/金额/变量宏、缺少真实命名 owner 的模板和其它未知形态继续保留具体诊断。

## 可复现的整族检查

先用当前根 runtime 生成全量 IR；新检查器验证 `story-corpus-build.json` 的 source digest、artifact hash 和 runtimeHash，拒绝旧编译产物与新工具/应用混用。不会在执行时重新 decode 一遍源指令。

```sh
npm run build
node scripts/build-story-corpus.mjs
.venv/bin/python scripts/inspect-source-message-sequence.py
node scripts/check-source-message-sequence.mjs
node scripts/check-source-message-sequence-execution.mjs
node scripts/check-source-message-view.mjs
node scripts/check-framework-route.mjs --report build/reports/v97-framework-source-route.json
```

维护探针现支持 `--max-elapsed-ms`，默认600,000逻辑毫秒；显式120,000可复演旧预算耗尽。预算只约束宿主循环，不跳过原始等待，不改任务PC或拥有状态。回执分别记录预算耗尽与真实能力边界；`passed`只表示有界边界探针成立，仍不是开场或主线完成。

两个语料工具可用 `--compiled <directory> --corpus <file> --build-receipt <file> --report <file>` 指向一个有完整回执的隔离编译；`--root` 指定来源仓库。生成报告包含原始正文和本地化，仅留在 ignored `build/`。

- `source-message-sequence-check.json` 完整保留字段/非字段调用点、原参数、typed op、未知诊断、全部 map 用点，以及含新序列的物理程序全文、locals 和全部依赖。只有无名字模板的参数探针用真实 `SourceMessageState` 执行；其余明确 excluded/unassessed。
- `source-message-sequence-execution.json` 选择其它需求已在受控 host 内闭合的完整物理程序，使用实际 FieldGame VM 和同一生产 Web policy。零初始化及单个分支邻值输入、真实确认、有限深度选择探索和确定性 replay 都留轨迹；未知宿主、命名 owner、timer callback namespace 和多 segment 程序保留完整排除原因。选择前沿、错误和预算结束都保留，不伪称全部路径已完成。
- `source-message-sequence-native.json` 从原 DLL/symbols/header/metadata 重验 47 份完整 C 回执与 14 个精确原始叶子范围。新增三个 C 与 receipt 位于 `build/native/v97-source-message-window-input`；命令支持 `--window-input-dir`。所有静态回执继续 `semanticsVerified=false`。 三个源方法为 `0x98ad10 / 0x98af30 / 0x98b930`，可按 [静态导出流程](../tools/native/README.md) 用 `ExportMethods.java` 对同一 DLL/header/symbols 重新生成该正式目录；必须取得完整 `complete.json` 并重新验 hash，不接受 shell 退出码或散落 C 文件代替成功。
- `source-message-view-check.json` 执行真实 production helper，验证长页全文/空白/滚动/重置与旧协议分流；三个 actual-app UI harness 验证实际 import 和 owner 接线。它们不是浏览器 viewport/像素证据。

整合前候选回执已记录：新 typed 480 处（474 sequence、6 finish-wait），206 个关联物理程序；223 个无名字模板参数探针，251 个真实命名依赖明确排除。闭合批次为 9 个完整程序 / 101 条指令 / 14 条依赖，25 个受控用例各 replay 两次完成。最终计数以当前生成报告为准，不能把这份候选快照、参数解码率或受控程序执行数称为 source-story reachability。剧情全局可达性、全地图可玩性、完整新游戏和原版动态一致性仍分别未评估。
