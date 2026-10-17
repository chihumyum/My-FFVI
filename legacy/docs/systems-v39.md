# 游戏框架 v39：共用剧情交互

在已有标题、探索、战斗、奖励、菜单和存档主循环上，加入共用选择请求与队伍/朝向条件分支。三条开发线分别负责来源编译、运行状态与流程门控、条件分支；浏览器、真实内容重编和连续验收集中集成。没有增加地图名或剧情脚本名的运行时特判。

## 系统交付

`FieldGame` 唯一持有当前选择及其任务身份。浏览器只显示选项、维护焦点，通过 `GameFlow.choose` 提交当前请求；被接受的答案写入已有 `MessageSelection`，原任务在下一个正常时钟继续。选择期间保留对白，普通确认不代替选择，暂停、后台、异步装载和旧回调不能误推进事件。已回答但尚未消费的请求继续阻止移动和保存。完成后的变量使用现有检查点保存，没有新增第二份剧情状态。

来源 `Select` 支持默认是/否与显式 2–6 项；默认标签由 `message_conclusion.csv` 的语义键关联系统文本，显式标签按源顺序解析。后一条原始指令决定是否保留消息窗口；未知上下文、缺失文本或异常形态保留阻塞。两类选择都没有来源取消行为，Escape 沿用宿主暂停，不映射成“否”。选择音效与精确布局未恢复，不影响本批逻辑验收。详见 [选择契约](field-choice.md)。

`BranchByCharacter` 读取当前状态所有者，分别区分当前四格队伍与已启用完整名册；`BranchByPlayerDirection` 读取实际玩家朝向。它们共用来源标签跳转规则，不复制名册、不推断剧情可达性，也不新增持久缓存。详见 [条件分支](event-context-branch.md)。

## 验证结果

| 层次 | 结果 |
| --- | --- |
| 源码与契约 | 1,614 项 TypeScript 测试、registry 检查与 34 项 Python 测试通过 |
| 选择来源 | 244 份来源资产中的 293 处选择全部解码：187 默认是/否、106 显式多项 |
| 真实选择脚本 | 4 份未改写源脚本的 9 条受控路径：4 稳定退出并恢复检查点、2 产生切图请求、3 保留原有未知指令阻塞 |
| 条件分支 | 441 处角色分支、129 处朝向分支；1,527 组独立预期检查与 14 条受控字段路径通过 |
| 视图与会话 | 实际 ChoiceView、GameFlow、GameSession 的 11 项受控 DOM 检查通过，包含旧按钮、会话替换、暂停、重复提交和持久恢复 |
| 连续框架 | 既有 12 阶段主循环、18 项系统集成、5 次遭遇及 40 次稳定存取回归通过 |
| 浏览器 | 受控事件完成选择→获得两份来源 Potion→二次选择→写剧情变量→继续移动→内存保存→更换会话→恢复；无控制台警告或错误 |

浏览器受控事件复用实际纳尔谢开发内容、会话和渲染器，但事件文案与奖励路线是明确的合成夹具。最终恢复值为选择 2、剧情变量 15 为 2、Potion 2 份、位置 `(38,48)`，可继续保存。主游戏页面另验启动、暂停菜单和返回标题。没有改写用户浏览器进度。

整批静态分析中，全部指令可解码的字段脚本由 760 增至 799。这个数只表示当前参数解码能力，不能当作已完成或可玩故事的数量。原生回执仍为 `semanticsVerified=false`；原版运行对照按用户要求后置。

## 复验与接续

```sh
npm run check
.venv/bin/python -m unittest discover -s tools/tests
npm run event-interactions:check
npm run framework:check
node scripts/check-system-integration.mjs
node scripts/check-playable.mjs
node scripts/check-world.mjs
node scripts/check-saves.mjs
```

实际来源检查依赖本地已导出的 corpus、field 系统文本和原生证据；不存在时显式失败。`npm run corpus:plan` 现从已验证的 field 导出读取系统文本，不再把默认是/否误报为缺标签。世界和开发入口编译同样传入下条原始指令及合并消息表。

浏览器复验：先执行 `node scripts/serve.mjs` 启动常规服务器，执行 `node scripts/check-event-interactions-ui.mjs` 生成忽略目录中的受控内容，再执行 `node scripts/serve-event-interactions.mjs`，访问 `http://127.0.0.1:4174/`。该页面只使用测试内存保存，独立于正式游戏存档。

本地证据位于 `build/reports/field-choice-check.json`、`event-context-branch-check.json`、`event-interaction-ui-check.json`、`v39-browser-interactions.json` 和 `v39-choice-browser.png`。原始资源、提取文本和生成内容不进入 Git。

公开 profile 仍为 `narshe-playability-v35`，owned v8、field/world v9、session v4 不变。来源完整开场、世界/交通、多队伍、完整技能/学习与主线仍需系统增量。接下来按连续旅程所需的共用事件、世界状态和内容依赖闭包推进，再扩大批量内容；粒子精修和 HD-2D 继续后置。

真实字段、649 条世界地图内容和正式新游戏包已重编；开发入口摘要为 `e2123f2fd718884c0118d60ff88da75d81aeffc5d618cad95708e99d6c8fa0f7`，世界目录为 `6ae39772dda3c3f33d86f63c36799c21b3c6a523f71c38e6036872addf4ec372`。摘要变化的旧存档继续按现有规则拒绝，不隐式转换。检查保存前应先重建与当前内容摘要绑定的 `world-check` 报告。
