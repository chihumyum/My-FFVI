# v61：入战、重试与返场的阶段合同

本批补齐战斗与宿主之间的准备、媒体就绪、发布和返场阶段，继续按系统骨架优先推进。字段、菜单、战斗、成长和存档仍使用原会话与持久状态；媒体准备不创建第二份游戏状态。完整来源交接、浏览器实玩和批量内容放行分别验收，HD-2D 继续后置。

## 所有权与公共接口

`GameState` 持有角色、库存、成长和结算记录；`GameSession` 持有原 battle lease、固定入场合同与一次发布候选。`WorldSession / FieldGame` 持有原地图、剧情任务及遭遇请求，`BattleGame` 只在提交入战后持有战斗副本。`GameFlow` 的操作票据门控输入、时间和会话替换。

`GameBattleHandoff` 协调同一票据与宿主媒体准备，提供 `start / retry / return`，不另持角色、剧情或奖励。宿主只得到分离的请求和内容数据；core 的 `validate / commit / discard` 方法留在协调器内。迟到完成必须同时匹配会话、字段、战斗、原请求和有效票据。

会话公共候选为 `prepareBattleStart / prepareBattleRetry / prepareBattleReturn`：

| 阶段 | 准备时保留 | 提交时发布 | 失败或取消 |
| --- | --- | --- | --- |
| 入战 | 原字段请求；新 lease 与私有内容、seed、共享剧情入口 | 构造并发布唯一活动战斗；遭遇序号增加一次 | 取消自己的新 lease；原请求可重试 |
| 败北重试 | 原战斗、原 lease、固定池、seed 和共享入口 | 新战斗替换败北副本；不增加遭遇序号 | 原败北战斗及 lease 保留 |
| 胜利或撤退返场 | 原终局战斗；候选持有资源与原地图后继准备 | 复用 owned 结果和字段 `commitWith`，一次回写、结算并调度后继 | 发布前保留终局结果，可重新准备 |

候选的请求和内容每次读取都是独立副本，宿主不能改写私有入场基线。旧候选重复提交返回 false，重复丢弃不影响新候选。多轮敌队、玩家加入与重入仍在同一 lease 内，返场时每个持有者只结算一次。普通撤退提交实际消耗与排位，不授予胜利奖励；逃跑准入继续由原独立合同决定。

## 时间、取消与发布边界

浏览器使用 `battleHandoff: "prepared"`。遭遇停止后，提交之前不创建或推进活动 `BattleGame`；候选准备期间直接会话时钟也丢弃 elapsed，不在媒体就绪后补跑。标题、暂停、后台及其他 I/O 门控继续归 `GameFlow`。

默认同步开发兼容入口也使用同一候选立即提交；prepared 模式下旧同步继续、重试方法返回 false，不能绕过宿主准备。地图、保存和战斗交接共用票据；返回标题、取消或替换会话先撤销私有候选，旧媒体完成不能发布或解锁后续操作。

内容、媒体、构造或最后验证在发布前失败，保留可重试请求或终局战斗。返场的演员和共享状态验证可以重复执行，取消在实际 owned 写入之前仍有效。`publicationStarted` 从实际战斗发布或 owned 写入开始保持为 true；此后拒绝取消，异常按不可重试的发布错误报告，不能再发一次奖励。清理错误不能掩盖原始错误。

## 来源声明与明确开发策略

可选 `battle-handoff-content-v1` 保留敌队行定位、背景、BGM、入场演出与逃跑 metadata，以及独立依赖。来源对象 ID 保持十进制字符串，party/background 必须绑定正确来源。BGM 可明确标记 unresolved，不从其他音乐表猜测替代。

`framework-battle-handoff-v1` 仅声明 `audio: "retain-field"`、`introduction: "omit"`：字段音频继续使用原所有者，本批省略入战 intro。framework 新游戏必须在内容中明确声明策略。可信旧 development-checkpoint 在内容没有 handoff 字段时可使用固定兼容声明；目录名称或开场 profile 字面量不授予策略。

该开发策略不恢复来源战斗 BGM、intro 时序或逃跑规则。严格 source origin 当前仍因缺少已验证 native handoff 合同阻塞；提供器存在、音频已就绪或带开发 policy 都不能授予来源语义。来源目录六个战斗请求仍全部 blocked，不表示迁移了六场战斗。

## 验证与接续

验证入口为 `npm run check`、`npm run battle-handoff:check` 和 `npm run framework:verify`。交接受控连续线覆盖准备取消、媒体失败、重试、败北、返场失败与一次结算，随后保存、恢复和进入另一战；默认同步线保留回归。报告位于 ignored `build/reports/battle-handoff-framework-check.json` 和 `build/reports/framework-systems-check.json`。

最终回归通过 2,578 项 TypeScript 测试、39+16 项 Python 测试和 35 组集成检查。其中 34 组受控系统合同全部通过，来源路线另记录为 incomplete；实际 app 的受控 DOM 检查通过 18 项，prepared 两战连续线通过 16 阶段。同步兼容入口的整帧/分帧计时一致；异步准备不补跑等待时间。默认四份目录的完整内容和摘要保持不变。

已支持通用内容的共同系统合同已通过，来源内容批次尚未放行。来源开场仍停在 `sc_e_0001_3` PC154 的镜头移动边界（80,550ms），保留为独立来源缺口。本批浏览器交接未验收；受控连续线、DOM 检查和静态来源回执不替代浏览器音画、原版动态一致性或完整迁移验收。最终汇总见 ignored `build/reports/v61-validation-summary.json`。

下一主线按 [共同系统门禁](core-mechanics.md) 的放行范围组织来源内容批次：按能力闭包选择代表性组合与留出路线，使用同一内容仓库和会话运行。未被批次使用的特殊公式或视觉未知不阻塞通用骨架，实际缺口归并为公共系统任务。批量内容放行与全游戏迁移放行继续分别记录，HD-2D 等待迁移放行。
