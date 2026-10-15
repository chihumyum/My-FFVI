# 剧情战斗状态列表

`BattleCondition` 通过独立运行时策略 `web-source-battle-condition-lists-v1` 接入已有 `BattleGame`、`BattleConditions` 和 Session 借用／返回事务。它不增加任何活动状态行为、目录版本或存档形状；缺少策略时，到达该请求仍拒绝执行。实际 App 与来源 Web 回放显式选择此策略。

完整来源3304程序／186003操作中共有15个此指令，全部位于 Battle 命名空间，15种完整参数、9个原体／533操作。完整53战斗体／2312操作及490请求（483描述和7诊断）全部保留；52份真实 Battle 导出绑定和 Common1 未绑定的区别不变。

原始包装器 `External.Battle.Condition`0xb42580 使用 i0=1／2 区分玩家与敌人，i1 是来源角色身份／敌方 uniqueId，i2 是状态主表**行ID**，i3=0恢复、1施加。四分派在 cctor0xb434b0 中依次绑定 IBattleAccessor 槽30／31／28／29。Ghidra 在首个 GC barrier 后误判提前返回；分派以完整1248字节 PE、原始接口元数据和写入位置核对，不能采用截断 C 推断后三个分派。共享 `GetData` 的 MethodInfo 明确绑定 `GetData<Condition>`，不能沿反编译显示的 Ability 别名解释。

四个实际 EventCommand owner 只直接向 `CurrentConditionList` 追加主表记录或移除一份匹配记录。它们不运行技能命中、抗性、`IsAddable`、去重、Conflict 或 InterruptAdd／Remove。Web 运行时保留这个有序列表含义：不调用技能施加结果代替剧情请求，也不为重复添加悄悄消除记录。现有 owner 未闭合的重复 Start／Remove、会改变原始追加列表的冲突阶段保持具体门槛。

新 Web 策略以当前实际实例匹配角色 sourceId／敌方 uniqueId；正值必须唯一匹配，非正值使用当前已准入的该方实例。缺席或歧义不是空目标成功。该策略使用既有 active／状态资格，明确保留与原生 `PlayerIsNotTarget` 全部特殊分支的差异。未知当前状态、未知主表、未实现的新增状态、未知 side applicability 和 life／control／实例创建阶段继续拒绝。

恢复调用可以证明某个**已知主表**当前不存在，因此没有列表变化；这建立在真实目标、完整当前状态和主表均已验证的基础上。它不把缺 provider 或未知当前状态视为空。恢复原本不在列表中的未知活动行为引用，不等于准入该行为。施加未知状态仍停止。

原生 enemy 行5（无论恢复或施加）还暂存并设置 enemy no-act，等待 `IsEndDownAnimation`，最后恢复此前 boolean。此专门阶段保留为到达即拒绝的具体门槛，发生在任何列表写入之前；不以同步状态修改、HP判断或虚构一次 callback 替代。

支持的状态列表变更在当前 Battle 的固定10ms帧中立即同步已实现状态生命周期。全体目标先准备列表、life、poison／speed／control 时钟和队列派生，再一起提交；已有 appearance owner 在同一帧末更新。该时机是显式 Web 调度方案，未取得原生 Unity 各组件先后顺序或像素一致性证明。

同帧稍后消息、共享剧情银行或效果失败会丢弃这次未发布状态及执行日志；前面已提交的状态、时钟、资源费用和实际命中不倒转。Session 在 Battle 帧外推进的故事计时器／音频保持既有边界。媒体交接取消、战败重试、旧实例退休和存档复用现有共同 owner，不创造第二份角色状态或字段写入者。

目录生产器和批次消费者共同使用 `battleEventConditionDependencies`：即使旧 unknown opcode 被成功解码，host、当前目标、未知活动行为及专门 phase 仍列为运行依赖。缺主表硬拒绝。剥掉目录诊断后，批次消费者也会重新保留这些已类型化操作的依赖；它们不会自动变成 ready 或可发布的走图池。

```sh
node --test /absolute/private/dist/tests/battle-event-condition.test.js
.venv/bin/python tools/native/check_battle_condition_ops.py --root /readonly/repo --evidence /absolute/condition-wip --report /absolute/private/build/reports/battle-condition-op-native.json
node scripts/check-source-battle-condition-ops.mjs --input-root /readonly/repo --compiled-dir /absolute/private/dist --baseline-script-root /absolute/baseline --baseline-compiled-dir /absolute/baseline-dist
```

来源检查保留完整原体、原参数、主表、组行和 party 闭包。每条原始参数的实际 Session 调用包络使用明确编写的调用者、当前实例和强制返场末尾，分别计完成或具体阻塞；不计为原体执行、实际来源初始队伍、剧情可达性或全游戏完成。原版执行、浏览器像素、整个649图生产和公开发布均未进行。
