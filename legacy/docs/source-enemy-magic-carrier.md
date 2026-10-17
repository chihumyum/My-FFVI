# 敌方单 Function3 魔法载体

本族选择完整33条来源 Type13、system3、唯一Function3(series0,values1/0/0)、None/零process、AbilityLv0的载体，按来源形状统一编译，不按能力或敌队ID分派。14条解除自身类型门槛；3条原ReactionType1行为未闭，保留专门provider门槛；其余16条保留原完整flags3、range16和元素枚举等门槛。其它72条Type13及全1530中其它1497条能力保持原合同。

Type13原值继续进入动作、条件、Chanting与received-type反应查询，没有改成普通Black/White/Magitek/Lore。真实同源Chanting唯一行是for_ai_type2；它是来源分类，不能作为角色资格。新载体严格要求这一来源绑定与现有ConditionRecoveryHit投影，实际普通敌人owner才能执行。玩家、特殊学习、Sketch或其它owned使用提供器未恢复，普通菜单／目标选择不给权限，脚本入口明确拒绝。现有Type13控制与吸收族不受此单一魔法载体的guard影响。

数值继续使用同一MagicFunction→GetMagicStatus→MagicExecution已闭算术；费用仍从原UseValue、实际actor及原装备费用owner投影，一次付款随整次效果提交。所有原条件、内容旗标、元素、目标、命中、AI与反应门槛保留；flag3没有借用普通White/Black的Runic许可。ReactionType只保留原事实，未把Web counter规则解释为原生字段副作用。

共同纯判定服务编译器与BattleGame；实际AI准入在目标和权重随机抽样前检查未知provider，scripted/createAction/resolve复用同一guard。未知玩家不伪装敌人以跳过owned费用。动作仍由同一战斗owner持有，失败帧还原付款、目标、AI、队列与随机流；已经提交的前帧、动作费用或manager时间不声称回滚。返场继续唯一GameSession prepared事务与原GameState lease，不建立第二持久状态。

来源审计覆盖1530、430完整AI/10093操作、53正文/2312操作、全3304/186003与原490(483+7)，保存全部前后能力与目录诊断，并单列14/3/16完整AI和敌队依赖。静态计划与依赖不算正文执行、战斗实玩或通关。检查命令：`node scripts/inspect-source-enemy-magic.mjs <candidate-dist> <before-dist>`。受控原参数机制、实际Session/Storage、App和真实来源执行分开留证。

本族仅重核10个既有完整native缓存与PE身份，无新导出或游戏运行；原生表现和时序一致性未验。没有649生产、发布或HD-2D工作。
