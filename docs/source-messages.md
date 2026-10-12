# 来源字段消息与自动字幕

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

当前 Web 能力显式限制为最多四个手工换行后的短行，每行最多 `20` 个已支持 BMP 字符；组合符、补充平面字符、控制符及其它待恢复字形布局不准入。**20 是当前 Web 能力上限，不是从原版提取的换行列数，也不能证明这些文本在原版字体中绝不换行。** 本轮 11 处候选源消息的最长一行为 19 字。Canvas 字体、定位和阴影保持 Web 近似；原版字形、字距、自动换行和像素一致性仍未验收，不能把该近似收据用于迁移发布准入。

超出该上限、超过四行、页中等待、多页、手动确认、说话人媒体/名字替换、颜色/变量等控制标签、同步或正时长 `Msg`，以及 fade/scroll/opera/battle 窗口，继续在编译或宿主处明确阻塞。后续应以独立字体/排版提供器恢复真正分页，不能通过不断扩大字符上限取得假覆盖。

## 检查入口

```sh
./node_modules/.bin/tsc --outDir build/v31-field-dist --pretty false
node --test build/v31-field-dist/tests/source-message.test.js
node scripts/check-source-message-native.mjs
node scripts/check-source-message.mjs --compiled-dir build/v31-field-dist
```

13 项独立测试覆盖异步开始、页末等待、float32、替换/取消、外部组效果、过期事务、保存限制、严格控制标签和 Web 页幅门禁。原生检查从 DLL、symbols、header、metadata 重新验证 44 份完整方法回执和 10 个原始机器码范围，输出 `build/reports/source-message-native-check.json`。

来源检查遍历全部 `4838` 处 `Msg` 与 `55` 处 `MsgClose`，当前本模块接收 `11 + 55` 处，剩余 `4827` 处记录具体阻塞原因。66 个受控探针经过同一个共享 decoder 和消息所有者，另核开场独立 Wait/Close、控制后缀、prefab 来源身份与外部更新组。输出 `build/reports/source-message-check.json`；报告不复制来源正文，只记录来源定位、摘要和页幅统计。静态调用点数、受控时钟通过数、实际浏览器演出和原版动态一致性是不同证据，均不代表剧情覆盖率。
