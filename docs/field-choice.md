# 来源剧情选择

v39 将 `Select` 接到共用字段编译器、任务调度器和 Web 选项视图。选择结果由 `FieldGame` 写入已有 `EventState.MessageSelection`，后续普通 `Branch` 读取同一个零基寄存器。编译器不按地图、脚本名或消息 ID 选择实现，也不预选一个答案来绕过剧情。

当前来源语料共 `293` 处 Select，分布于 `244` 个脚本资产：`187` 处默认 Yes/No、`106` 处显式选项。显式选项分别有 `86 / 16 / 1 / 2 / 1` 处使用 `2 / 3 / 4 / 5 / 6` 个选项。这些调用都能通过本次普通指令解码；数量不代表脚本、场景或世界流程已可玩。

## 来源合同

| 来源                                                         | 已确认行为                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `External.Message.Select` `0xb4d7c0`                         | 先检查 `CommonCamera.MessageReady`。首次 clock 建立窗口后 Wait；后续等待 `IsSelecting` 结束，不会自动使用初始高亮。                                    |
| Message 静态构造 `0xb4e0b0`                                  | 默认 anchor 为 `UnderRight=4`。`i0>0` 时才索引来源 `[0,1,2,3,4]` 数组；非正值保留默认。`i1` 在本版 Select 中未读取。                                   |
| `MessageSelectClient.Play` `0x31ec80 / 0x31ed10`             | `s0` 为空时使用普通消息的 Yes/No 子窗口，`i2` 为初始高亮；显式标签进入独立的多项窗口，anchor 固定为 `5`，不传入 `i2`。                                 |
| `MessageSelectController` `0x7ef570 / 0x7ee5e0`              | 默认标签来自 `SPEECH_IN_OPTION_YES / SPEECH_IN_OPTION_NO`，经 `message_conclusion.csv` 绑定到实际系统本地化。没有硬编码“是/否”、消息表行号或文字回退。 |
| `MessageMultipleController` `0x7ecfc0 / 0x7eceb0 / 0x7ed710` | 最多读取前六个来源标签，保留原 slot index；空文本会禁用对应项，不压缩 slot。显示时高亮 index `0`。                                                     |
| PC 控制器 `0x7ef200 / 0x7edd30`                              | 读取 Action 和四个方向输入，没有读取 Cancel。当前普通能力的 `cancelIndex` 固定为 `null`。                                                              |
| 两个 Fixed 回调 `0x987fb0 / 0x31c000`                        | 将原始 index 直接写入 `DataStorage.selected`，播放系统确认音并转入关闭状态。结果是零基值。                                                             |

选择完成时，Select 检查**紧邻的原始下一条 mnemonic**：恰为 `Msg` 才保留消息窗口；否则调用 `MessageWindowClient.Stop`，再切换 entity update group `12`，`invokeCallback=false`。因此解码入口必须传入 `nextMnemonic`；不能从下一条已解码 op 的 kind 猜测，因为一条尚未支持的 Msg 仍然是来源 Msg。现有 `293` 处的紧邻后继都不是 Msg，该保留分支仍有合成运行回归。

`src/compiler/field-choice.ts` 只接收完整 `type=1`、三个长度为八的参数数组。普通 Yes/No 只接受高亮 `0 / 1`；显式选项只接收连续的 `2..6` 个非空标签，稀疏位置、缺失本地化、未知内联标签和未证明的其它参数形态继续阻塞。显式选项当前从已验证 `story_mes_zhc` 读取，默认选项通过与 corpus 同来源绑定的 `system_zhc` 读取。

## 任务、窗口与保存

`FieldChoiceOp` 包含 `options`、`initialIndex`、`cancelIndex`、`anchor`、`presentation` 与 `retainMessage`。运行时 `FieldGame.choice` 仅暴露分离且只读的选项投影，并附上本实例唯一的请求 ID 和发起任务 ID。视图不持有剧情状态。

- 普通 Msg 确认后，如果紧邻 choice，保留原消息供 Yes/No 作为父窗口。缺父窗口的 Yes/No 不准入。
- `choose(id, index)` 只接受当前尚未回答的请求；越界、小数、旧请求、重复请求和 Cancel 都不写状态。初始高亮不是答案。
- 成功回答立即按来源回调写入 `MessageSelection`；下一次正常逻辑 clock 才由原任务完成留框或关闭、组 `12` 更新及后续指令。UI 回调不会额外推进其它 puppet 时钟。
- 等待时同一任务停住，独立任务仍遵循各自调度。并发选择、占用窗口的消息、地图或战斗交接、未完成宝箱冲突明确阻塞；主任务结束时也不能遗弃 puppet 发起的选择。
- 活动选择及已回答但尚未完成下一 clock 的选择不能保存、打开菜单或切图。稳定检查点只保存选择结果，不序列化输入请求，也不重放选择指令。
- 当前 windowless `SourceMessage` 的 `AUTO_P` 窗口与普通选择组合仍阻塞。未知控制器不会借此获得普通窗口资格。
- 如果完成时外部关闭/更新组宿主失败，已接受的选择值按来源回调保留，后续任务停止；这不是整个交互回滚事务。

Web 视图立即呈现已准备的选项，按确定的 Web 逻辑步完成任务等待。原版 Canvas alpha、MessageReady 与 UI 状态机的逐帧一致性、输入重复频率、像素布局和确认系统音尚未由此闭合。这些呈现限制不改变结果寄存器、取消规则和剧情分支；原生动态语义回执仍保持 `semanticsVerified=false`。

## 检查

```sh
./node_modules/.bin/tsc --outDir build/v39-choice-dist --pretty false
node --test build/v39-choice-dist/tests/field-choice-compiler.test.js
node scripts/check-field-choice-native.mjs
node scripts/check-field-choice.mjs --compiled-dir build/v39-choice-dist
```

编译器的 `9` 项合成测试检查参数形态、符号化默认绑定、四角默认、显式固定高亮与位置、未使用 `i1`、原始后继保留、缺失依赖和输入隔离。运行时等待、并发、主任务退出、宿主失败与视图/会话交互由独立 `field-choice.test.ts`、`game-flow-choice.test.ts` 及主线 UI 检查负责。

原生检查从当前 DLL、symbols、header、metadata 重新验证三个批次的 `17` 份方法回执、原始方法区间及反编译摘要，并验证 anchor 的二十字节 metadata 数组。报告为 `build/reports/field-choice-native-check.json`；它是静态来源绑定，未运行原版游戏。

来源检查通过校验过的 corpus 与系统消息入口遍历全部 `293` 处指令，并验证共享 decoder 输出一致。另将 `sc_e_0023 / sc_e_0256 / sc_e_0219 / sc_e_0676` 的完整源指令保持不变，放入显式受控几何与已初始化事件状态，执行 `9` 条实际选择分支：`4` 条稳定退出后检查点保存/恢复、`2` 条正确产生跨图请求、`3` 条在来源未知 Msg/SysCall 处继续明确阻塞。它同时验证 `MessageSelection` 的 index operand 被忽略、等待不改值、重复回答拒绝和恢复后旧请求失效。

报告 `build/reports/field-choice-check.json` 只记录来源定位、消息 key 与摘要，不保存原版正文。受控脚本入口不证明正常剧情可达；两个跨图请求没有发布目标地图；三个阻塞分支不会因 Select 已解码而计作已迁移场景。
