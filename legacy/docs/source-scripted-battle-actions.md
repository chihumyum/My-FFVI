# 来源脚本战斗动作

`BattleAction` 通过 `web-source-scripted-battle-actions-v1` 明确 Web 策略接入唯一的 `BattleGame`。它不授予角色技能、菜单权限、HP、费用或 RNG 的第二套 owner。默认未声明策略时拒绝；存档不保存或授予该策略。`GameSessionRuntime.scriptedBattleActions` 在入口、重试和恢复时由可信应用注入。

## 来源合同

完整族为 63 个站点、13 个物理程序、1,010 条完整指令、53 种参数；完整 BattleScript 命名空间为 53 个程序、2,312 条指令，仍属于 3,304 程序、186,003 原始指令语料。所有原始正文、PC、未知指令及来源指纹保留。

固定原始 DLL 的 `External.Battle.Action` (`0xb41780`) 以 i0 区分 caster，i1 为角色 `characterStatusId` 或敌方 unique slot，i2 为 ability master id。玩家 caster 的 i3=2 选敌方，否则选我方；敌方 caster 的 i3=1 选我方，否则选敌方。i4 正值按来源身份选择，非正值选当前该方；i5=0 等待，1 异步。其他 selector/保留负载并不默认通过。现有全族的 8 元 int/real/string 数组和具体 selector 原样保留。

四个 accessor 路径进入同一 `CreateActData` (`0x15623b0`)：`ActType.Event=3`、null command、明确目标数组，再进入现有 action delegate。Event 使用 interrupt 路径，不需要角色已经学会该能力；`BattleActData` 构造器仍声明执行 MP 费用。同步动作后续 interpreter clock 轮询全局 staging（含反应），异步动作仅继续 VM。

`tools/native/check_scripted_battle_actions.py` 只读核对 12 个短体完整 C/原始 PE 范围、symbols 和 header 的 SHA；不运行原游戏或重新导出。证据 packet 中三份 `complete.json` 必须全部同源。原始 DLL、反编译正文和 source assets 保持在忽略目录。

## 唯一 owner 与明确差异

VM 只保存 continuation。请求先严格核对完整来源 op/PC，再捕获当前 caster 和目标的真实实例 ID；敌槽复用不会把旧动作重绑到新敌人。动作存入现有 `BattleGame` interrupt/reaction 队列，由原资格、费用、效果、RNG、反应和生命周期事务执行。未知能力计划、来源身份、formation、derived-action 或参数形态继续拒绝。当前死亡、睡眠、资源不足走现有队列失效路径。

Web 使用现有固定步长和公开动作阶段。原生 Unity 组件更新顺序、全部目标 predicate、`PlayerIsNotTarget` 的特殊 condition/FinalAttack 分支与原生 RNG 尚未取得动态一致性证明。显式 Web lane 对当前实例采用已有 active/life/condition 资格；它不是严格原版调度和特殊目标条件的一致性声明。费用仍由既有 ability cost/payment owner 负责。

队列、VM、HP/MP、RNG、反应和效果由同一个既有 tick rollback 保存和恢复。BattleGame 第 9 参数采用可选 `eventHosts` 对象，其 `scriptedActions` key 与消息 host 独立；父级联合时合并 key，不能让 action policy 顶替 message host 的位置参数。

## 验收边界

新增机制测试经过真实 action stage/effect/results，而非凭日志认定动作。覆盖同步/异步、费用一次、pause、effect 失败原子 rollback、counter、目标退休与同槽新实例、媒体准备失败/取消/晚完成、败北重试、一次结算、Storage quota 失败和稳定恢复。实际 app 使用真实 Repository/Session/Flow/Commands/Storage；DOM/绘图/解码受控，不授原剧情可达或像素一致性。

`check-source-scripted-battle-actions.mjs` 保留完整 53 程序命名空间、13 正文、全部参数与 source party bindings。它复用 `--candidate-dir` 的同代 shared candidate，并验证完整 world/catalog/对象/输入锁与开始/结束 runtime；不再编一套 649 图。无候选时只输出静态账本和明确未执行。候选存在时，原始程序必须与当前编译器/source/encounter lifecycle 完全相同；来源略过/缺失定义、其它未实现 opcode、未知 ability、未初始化共享域均保持阻塞。直接受控 battle probe 使用原 source new-game owner，不代表该场战斗在主线状态中可达；尚未通过真实 Session 返场的来源样本不得计为剧情迁移完成。
