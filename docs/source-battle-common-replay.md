# 一次完整战斗回放，多家族观察

`scripts/check-source-battle-common.mjs` 在同一冻结运行时与来源候选上，一次执行原消息、特效和分支检查器共有的53份完整战斗程序及490项原敌队请求。222处消息原参数仍独立受控执行；效果、系统消息和分支各自保留完整来源站点和物理程序范围，不筛掉未受支持的正文、缺失导出或未知依赖。

原有单家族入口继续可用。共同模式复用同一个 `run`、初始化、Session、指令正文、输入策略、完整敌队目录和返场保存路径，不通过读取历史报告替代执行，也不产生三份独立通过证据。`familyViews` 中的结果索引指向该报告实际 `programs`，各自统计受影响的完整程序和原参数；`independentEvidence` 明确为false。整体范围仍单列全部程序和原敌队尝试。

自建490请求目录同样消费当前精确目录策略与 `compileSourceBattleParticipantClosure`，保留真实九槽、增援、换轮和所有新显露门槛。当前已支持的forced终态通过真实 `GameSession.prepareBattleReturn` 返场并保存，不再被观察器误判为不可返回的终态。原始战斗程序可能由真实战斗终局提前结束；返场成功不是每条源指令均被执行，更不是主线到达该战斗的证据。

每项实际尝试开始和结束更新 ignored `execution-progress.json`，记录当前程序/敌队、输入身份和各类已收终态数量。进度文件不是完整结果；只有完整范围、运行时/候选/原始输入复验后写出的正式报告才表示本次所有尝试已收集。边界、预算与失败保持原结果，不把回放完成解释为全部剧情通过。

返场会退休战斗owner，特效统计优先读取返场前已经记录的真实终态journal；失败或尚未返场时使用最后的活动观测，不把返场后的空数组算作没有执行。缺失错误元数据明确记录null。正式摘要校验前另保存标记为unaccepted的完整尝试草稿；不支持的JavaScript值在草稿中显式标出，不能因JSON序列化丢失后冒充已验收报告。

```sh
node scripts/check-source-battle-common.mjs --compiled dist \
  --candidate-dir build/reports/shared-source-candidate \
  --report build/reports/whole-battle-common/report.json
```

新一代联合观察只启动这一个共同战斗作业，替代三次相同正文实验；其他字段、编成与真实新游戏作业继续并行消费同一候选。已启动的旧代作业和旧报告不改写、不补签；公共内容发布仍走一次完整集合生产管线。

## 实际菜单输入策略

`current-menu-qualified-ability-v1`读取实际BattleGame菜单，按来源菜单和能力顺序选择首个可用能力及实际目标，不预设能力身份。每次提交携带明确的command ID，同一能力出现在多个指令中时也不提交含糊的缺省指令。这只是能力输入观察策略，不是游戏AI，不授予能力、资源、名册或来源旗标；道具等其它合法操作没有被穷举，结果不代表玩家已无其它选择。

角色已经ready却没有合法能力输入时，记录`battle-input-boundary`及完整菜单。未知所有者或目标错误仍成为明确阻断；这些结果都不表示原程序完成。已冻结旧代观察保留原输入策略和结果，不按新策略重新签名或改分类。


联合全局 Fade 后，观察器以 `current-app-message-and-raycast-v1` 跟随当前 App 的普通输入窗口：消息或共享 Fade 的 raycast 阻挡期间只继续实际时钟，不发送普通菜单命令，也不把短暂遮挡误记成无合法能力边界。源脚本、AI 与返场操作沿既有自身合同推进；此规则仅描述当前 Web UI，不声称 Unity Image 也能阻挡原生键盘/菜单控制器。旧代输入与报告不改写。

## 观察器内部的调用定义分组

完整候选/来源读取后，`battle-observer-callers.mjs` 将该次实验的输入同步取得私有不可变数据副本。相同真实 party 操作数复用同一调用 map/world；原敌队目录只追加同一已有初始化地图资格行并 seal 一次。每条原敌队请求仍检查 encounter、原 script lifecycle、完整 program 相等和地图资格行，失败不缓存、不过滤。受控程序每次重新捕获实际 program 并派生 battle，不能凭外部对象身份或 claimed hash 复用。

这只复用静态定义。每条记录通过显式 verified 文档入口，复用此前已真实完整摘要验证的私有只读定义；每条 tuple 仍执行原领域/source/profile/initializer 绑定检查，新建 GameState/EventState/World/Field/VM/RNG/时钟/宿主端口并实际执行初始化、战斗、返场和 Storage。原 mutable compiler/Session 的逐次完整捕获和摘要行为不改，详见 `verified-framework-content.md`。既有明确共享的媒体宿主仍按原合同共享。未知 fade/provider/source/owner 及765逻辑记录（222参数、53正文、490请求）的范围不变；765不代表全部都能创建 Session。报告新增 `callerDefinitionGroups` 仅说明定义构造/命中数量，不授予来源或剧情可达性。

调用方和公开内容不被 freeze；只有观察器自己的数据副本与派生定义只读。公开 compiler/Session API、同运行时候选校验、首末完整对象/输入 fence 及旧 smoke 模式均保留。跨代选中候选对象的私有受控量测不是 same-runtime 候选或原剧情验收。

`callerDefinitionGroups.capturedDocuments` 只计去重的六文档输入 cap；`preparedRows` 每条另新建并验证一个 framework envelope cap，不缓存执行或失败。
