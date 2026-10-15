# 共用状态清理与显隐生命周期

v98 按全量来源家族接入状态清理、领队交接和普通演员计时显隐。仍使用 FieldGame 的任务、时钟和演员、FieldPartyActors 的编队外观、GameState 的持有状态及原发布锁。完整程序、参数、地图依赖和真实剧情可达性分别验收。

## 清理、刷新与发布

RemoveCondition(type=0) 使用固定来源 Current 钩子保留的主表行 **53、79、80**，不是保留所有同类型行。按原条件列表快照顺序写同一 MainCore 的 i0，再删除实际拥有列表中的相同行；每条原死亡记录各执行一次 HP 恢复和 Dying 更新。每个目标后依次 Refresh(false)、AffectLeader，不把刷新合并到最后。

每个目标改变前捕获旧领队，刷新后读取旧实例活动资格。明确 false 的 KeepBadStatusVisual 返回；true 路径在旧实例不活动时返回，否则 Hide旧、Show新、复制世界位置和直接层，再按旧实例刷新后的动画 Cue(-1)。同实例也执行这组操作，不跳过后继动画。

app 和整批执行器共用 createWebFlatConditionLeaderActivityPort()。这是明确的平面 Web 策略：该表示中的组件启用和祖先活动固定成立，activeSelf 仍读取实际候选演员。scope 绑定审核过的来源工厂、当前演员/原生实例及完整绑定，变化即过期，未知表示仍拒绝。它不是任意 Unity 层级的活动事实，保存不能授予该端口。

HP/条件、逐目标演员效果、编队外观、镜头偏移和 i0 共同准备。最后一次可能失败的读取仍看见旧 owned state，之后只安装已准备的数据。失败、重入、过期 owner、旧票据和战斗借用不得留下半提交。稳定恢复不重播清理或发奖；665/666显式移除、MP-count及未知活动条件继续保留缺口。

## 同任务银行与保存

Task.generalRegisters 是该 Core 的 i[8]、r[4]、s[4]，不是 operands 或 EventState.ScriptLocal。默认/Reset 数字0、字符串null。Call/Return 保留银行；ChangeScript ResetAll 清零，hook 返回保留被调用脚本最终银行。消息仍由唯一窗口 owner 和原任务游标计时，只在明确边界投影 Msg 的 i0/i1/i2、r1/r2；ticket 不是原生槽。

包含该消费者的可信内容使用嵌套 field-event-continuation-v2 保存主任务银行，旧内容保留v1。外层持有/世界版本不因该银行增加，来源绑定、PC、调用栈、局部银行及演员检查仍有效。没有因为地图里的其他程序含type0而增加全局切图拒绝；尚无可观察消费者的 scratch 不扩大旧流程前置条件。这不是全部原生寄存器写入或原生时钟位值的完整模拟。

## 计时显隐

普通 childless 原生演员 Show/Hide 保留 float32 时长和原 double 延迟。非零负延迟也排到后续更新；相同到期时刻按原加入顺序执行。计时器捕获实际演员、原生实体、程序和 Web PC，来源 Site.index 只用于定位。新根/事件结束不清旧回调；立即 Show/Hide 可中断当前 fade，不能删除旧延迟回调。

Fade 使用同一逻辑时间及实体更新mask，保留对旧 rate>1 的完成检测。普通原生材质保留双重 material alpha、head RT 混合顺序及动态深度写入；Canvas 平面表示仍是明确的 Web 策略。受控 draw 不证明 GPU 或原版像素一致。

活动 fade/回调阻止稳定保存及未闭合的战斗/跨图交接，不偷偷推进被冻结地图的时间。未知子层级、活动骑乘显隐、tile animation、特殊材质、相机计时，以及 HideMob/RestoreMob 静态列表跨场景寿命仍保留缺口。

## 复现与范围

```sh
npm run check
npm run source-remove-all:check
npm run field-visibility:check
```

清理工具绑定新鲜 IR、构建回执、完整源输入及运行时，保留全部149站点/147程序和未选原因。显隐工具重新生成全家族、脚本闭包和地图初始化/提供器诊断，使用同一入口、Session、Flow、菜单及保存。合法受控持有状态和通过既有 join 创建的名册研究变体单列，不改剧情旗标或冒充原主线。

原生工具只核对固定来源原字节、完整 C 回执和已绑定 shader 输入，未动态运行 Unity。公共结果必须重新生成于最终根运行时；私有候选报告不能代替发布验收。浏览器实玩、真实新游戏到结局和完整迁移仍单列，goal 保持 active。
