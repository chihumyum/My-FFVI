# 来源敌方 MP 参数与生命结算

`source-enemy-mp-parameter-v1` 是可信来源编译器对实际 EnemyCharacterParameter 构造器的精确投影。它独立于旧 undead 元数据，缺失时为 unknown。不能由玩家 side、外观、存档或缺省 false 获得。初始、late、子敌队复用 `compileEnemyBattleDefinition`；同槽替换使用新的实际实例绑定，退休、失败回滚与战斗结束复用 Battle owner。

原生静态证据绑定本地 DLL SHA `1a7e12c9…`、symbols `5067386c…`、header `71e6ec20…`。`EnemyCharacterParameter.ctor4afb70` 通过 GetMonsterFlagList4dad80、group predicate4efbb0 从完整 MonsterFlagGroup 主表投影旗标。精确 ctor MethodMetadata2004de8 将共享谓词4b4d20绑定为 `v==4`，不是选择第一个共享签名。继承getter4ac6b0读取实际对象+0x151，消费者使用实际 Parameter 虚表slot38；Player535300 override及Rampage另界。

共享 Monster.get_MonsterFlagGroupId53e8a0的完整范围是64B，读取MasterBase.valueIntList（+0x18）的index38；全部4别名与原64B记录保留。MonsterFlagGroup两个getter按原index1/2返回GroupId/MonsterFlagId。真正的实例构造链是BattleStatusControl.CreateBattleEnemyData684a20分配EnemyParameter、调用ctor并写入unit-info.Parameter，不按角色/怪物ID推断class。数据行和完整group SourceRefs归编译追踪；core只校验严格投影及当前内容信任边界，摘要不是签名。

BattleGame把参数绑定到实际对象，和Final票据、资源、AI、队列、随机、消息与效果一起回滚。已知false的MP0不生成type5；已知true在自动死亡登记时复用原条件owner。现成完整UnableFight.Start5282a0先写CurrentHP=0，因此MP致死登记后也置HP0。真实type5移除/敌方复活/AI重启仍保留原具体门槛。

完整IsUnableFight4ac670的64B控制流为 `HP<=0 || (actual virtual IsUnableMP() && MP<=0)`。它只扩充原有targeted parent计算的Final资格：同实际instance/epoch、IsCounter首结果、非miss、原type6/排除types及目标/能力/消息门槛不变。AI接收的finalMpDeath来自该Battle事务；成本、fresh构造和独立条件clock不会自行生成Final票据。原HP-only缺口合同和缓存否定记录保留历史，新64B闭包单独留证。

自动HP/MP生命结算使用同一Battle helper。实际Final票据存在时延后自动登记，poison clock继续；票据耗尽后读取当前资源，不能恢复旧MP快照。普通费用导致的施法者变化与目标变化联合投影、同一次提交。受击 Final 资格使用扣除原生 Finishing 费用之前的 MP；自目标行动只支付费用到零不能制造受击票据。已知 MP-death 施法者的正费用与自 MP/吸收写入不能证明可交换，实际到达时拒绝，目录保留 enemy-mp-fee-phase 活跃依赖。吸收/多目标后续失败会回滚已准备的费用、资源、条件、AI和RNG。旧synthetic/legacy无参数的普通路径保持原边界；它们到达新Final MP0查询仍明确拒绝。正费用加自MP/吸收/user-condition顺序、Loop8、非空Final消息、range16及其它未恢复依赖不会因为参数可查询而放开。

可信compiler导入与内容hash携带元数据；Storage只保稳定持久状态，不保存临时参数权限或Final票据。Session入战/返场失败、取消和重试保持原lease与一次提交，成功返场退休旧实例；恢复后新战斗重新绑定当前内容。

`scripts/check-source-enemy-mp-parameter.mjs --before <固定作者目录>` 保存全3304/186003、430AI/10093、1530ability、508monster、53/2312及原490/union492同输入前后。允许的目录差异只有严格MP构造元数据、由此派生的contentHash，以及上述精确新增费用阶段诊断，所有原诊断逐项、按原顺序保留。静态bit分布87true/421false不是实例准入或剧情覆盖；参数/系统测试、完整来源正文、原版动态一致性与649生产分别验收。
