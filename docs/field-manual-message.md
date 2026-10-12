# 共用同步字段对话（v43）

普通 `Msg` 现在使用同一套编译、任务等待、实体更新掩码和 Web 对话投影。支持静态正文与说话人、有框／无框窗口、上中下位置，以及来源显式 `<P>` 分页；没有按脚本名、地图或消息 key 分支。原版动态对照、字体排版和完整剧情可达性仍未验证。

## 编译输入与能力范围

`compileManualMessageInstruction(raw, messages, { nextMnemonic })` 位于 `src/compiler/message.ts`。输入必须是来源 `type=1` 的 `Msg`，包含完整的八项整数、实数和字符串操作数。

| 参数 | 当前准入 |
| --- | --- |
| `iValues[0]` | `0` 有框、`3` 无框；两者都使用普通字段消息控制器 |
| `iValues[1]` | `0/1/2` 对应上／中／下 |
| 其余整数、全部实数 | 必须为零；只准入同步手动完成路径 |
| `sValues[0]` | 正文与说话人的精确本地化 key，分别来自 `story_mes_zhc`、`story_cha_zhc` |
| 其余字符串 | 必须为空 |
| 后继上下文 | 必须提供同一来源脚本的下一条 mnemonic，缺失不猜测 |

`<P>` 大小写不敏感，每段为一个明确页面；`\\n` 转为换行。未知标签、`NAME` 动态替换、`WAIT`、`PRESS`、`AUTO_P`、其他控制符、缺本地化和空页面都阻塞。正时长、负时长、窗口 1/2 与其他消息管理器不由这个编译器处理；既有负时长自动字幕继续走独立的 [来源消息模块](source-messages.md)。

编译结果仍是 `kind: "message"`，仅增加 `manual: { pages, window, anchor, after }`。`after` 由原始后继决定：下一条为 `Msg` 时留窗交接，为 `Select` 时保留提示，否则关闭。`compileField`、`compileWorld`、corpus planner 及逐脚本来源检查都传入真实后继，不依靠地图名字推断。原有 NPC `Talk`、宝箱与商店的 `FieldMessage` 合同不变。

## 同一个消息所有者

`FieldGame` 沿用现有 `dialogue` 与 `retainedMessage`，页面序号、可接受确认的时刻及来源位置附在同一个对话上。没有另建可独立存取的窗口状态。

开始时先准备实体更新组 `8`，即掩码 `9`，验证原窗口仍相同后一起发布窗口与掩码。关闭时同样先准备组 `12`，即掩码 `3`，再释放窗口。原生演员必须有已绑定的 `sourceMessageEffects` 事务；缺少端口会在显示或关闭前阻塞。旧字段宿主使用它已有的掩码所有者，不给原生演员使用回退。

确认规则是明确的 Web 输入约定：消息开始及每次翻页后，至少经过一个 10ms 逻辑步才能再次确认。一次确认只推进一个显式页面，末页确认才恢复所属任务。相同逻辑时刻的重复输入不会消费下一页或下一条消息。暂停、页面隐藏、媒体未就绪的输入仍由共用 `GameFlow` 门控。

末页转入 `Select` 时只打开选择请求，确认本身不代选答案。选择继续使用已有 request token；完成后若来源要求留窗，窗口可以交给同一任务的后续普通或自动 `Msg`。普通 `Msg → AUTO Msg → MsgClose` 与 `Msg → Select → AUTO Msg → MsgClose` 均有回归；另一个任务占有窗口时不能接管。

未完成对话期间禁止队伍菜单、稳定保存、手动切图及并发任务入战／切图。主任务结束也必须在取消子任务前拒绝仍被持有的普通消息，不能留下失去任务所有者的窗口。开始准备失败会保留原窗口和事件值，并将当前任务 PC 留在失败指令；失败被显式报告，没有增加自动重试或跳过规则。关闭或异步交接失败时保留原窗口。

## 来源证据与表现边界

本批复用已有完整导出，未新增底层调查：

| 来源方法或数据 | 支撑的规则 |
| --- | --- |
| `Msg 0x2bdca0`、`PlayMessageCommon 0x2be900` | 同步／异步分支、后继 Msg／Select 检查、消息实体更新组 |
| `WindowParams 0x2bd1c0` | 窗口 0/3 共享普通控制器，窗框与位置独立 |
| `NewPageTagRegex`、`NewPageContent.get_Type 0x3759d0` | `<P>` 标记及类型 3；检查器重新核原始机器码 |
| `SetContent 0x98c360`、`ToNextMessage 0x98dd40` | 记录显式分页位置，并在消息推进时于分页处停下 |
| `StateEntityAttribute`、`SwitchCurrentUpdateTargetEntities 0xab00d0` | 组 8/12 对应掩码 9/3；调用不触发选择／移除回调 |

原生 `Msg → Select` 有独立的消息完成检测。当前 Web 以末页确认进入选项作为框架约定，不宣称复现该 getter 的逐帧行为。显式分页与浏览器文本换行也分开：本文能力不恢复 Unity TextGenerator、字体、自动分页、逐字揭示或像素几何。`app.js` 只投影当前页、说话人、窗框和位置；自动字幕原有短行限制没有被放宽。

## 可重复验证

```sh
./node_modules/.bin/tsc --outDir build/v43-dialogue-dist --pretty false
node --test build/v43-dialogue-dist/tests/field-manual-message.test.js \
  build/v43-dialogue-dist/tests/field-choice.test.js \
  build/v43-dialogue-dist/tests/npc.test.js
node scripts/check-field-manual-message.mjs --compiled-dir build/v43-dialogue-dist
```

专项新增 13 项语义测试；与选择、NPC 合计 36 项通过。消息、选择、商店、宝箱、NPC 相关测试合计 138 项通过，日志为 `build/reports/v43-dialogue-family-regression.log`。主线全仓结果另见 [v43 集成记录](systems-v43.md)。

来源检查输出 `build/reports/field-manual-message-check.json`，绑定当前 corpus/source 指纹、每个调用点及页面摘要，不提交来源正文。它重验既有 44 份原生方法和 10 个原始字节区段的回执，并额外验证分页类型 getter。统计仅取现有 corpus 分类中的字段脚本：

| 指标 | 数量 |
| --- | ---: |
| 字段 `Msg` 调用 | 4615 |
| 本普通手动能力准入 | 3510 |
| 有框／无框准入 | 3391 / 119 |
| 准入中的显式多页调用 | 533 |
| 未被本能力准入 | 1105 |

1105 项包含属于既有异步模块的调用，不能全部称为未实现。此前 2870 条普通明文调用在独立对比中仍准入；新增数量不代表新地图可玩数。

同一检查器取真实 `sc_e_0019:1` 的多页消息和 `sc_e_0437:10` 的无框消息，放入明确标注的受控 `GameSession → GameFlow` 连续流程，完成暂停／输入门控、分页、yes/no、事件标记、保存、恢复六阶段；外围事件、几何和选项为合成样本，不声称执行了这两个剧情。另有 4 项实际 `app.js` 投影块的受控 DOM 检查，不是浏览器像素验收。所有静态回执继续保留 `originalGameExecuted=false`、`semanticsVerified=false`。
