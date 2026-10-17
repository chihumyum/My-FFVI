# 战斗系统消息字典

这批处理剩余六条战斗 Msg：一个共用默认脚本和五个其它完整程序，共 557 条原指令。完整 53 个战斗程序、2,312 条指令、490 个敌队请求、483 个来源描述及 7 个原始诊断继续保留。消息文字和源程序由 ignored 导出读取，产品代码不按消息 ID、程序 ID 或 PC 写分支。

完整原生方法显示：MessageManager.LoadAsset 加载 system、story_mes、etc_text 三张正文表，Parse 将其加入同一个 messageDictionary；说话人只加载 story_cha。GetMessage 从共用正文字典查找并使用既有替换规则。GetSpeaker 与 GetSpeakerMessageId 的完整缺键分支均警告后返回 String.Empty，因此系统正文没有对应说话人时可以显示空名字。已有消息窗口仍由 MessageWindowClient/MessageWindowManager 管理，不创建另一种 System Window。GetSpeakerMessageId 对存在说话人的反查及原生头像资源不由本批重新实现；不以共享地址的首个别名猜它们的类型或行为。

`battle-event-message-binding-v2` 明确绑定四张完整消息表及完整 character_default_name 表的物理文件、SHA、路径、精确有符号 64 位对象 ID、原始 CAB（导出缺失时保持 null）、内容摘要及行数。System 表复用原有 verified bindSystemMessages，再解析到 corpus 中唯一物理记录。编译器每个完整程序验证一次并复制字典，之后按实际键归属查找；输入之后变化不能改变已准备的编译闭包。v1 的字段形状和显式剧情正文/说话人要求保留，不能凭旧绑定获得新空说话人规则。

缺正文、缺表、缺来源、冲突及重复命名空间仍拒绝。原生 Parse 遇到已有键会警告并保留先前值；Web 编译门禁对跨正文表的重复键更严格，即便值相同也拒绝，不猜测枚举顺序。当前来源三张正文表没有交集。verified field 导出已对单表冲突值拒绝，相同的重复原行按同值折叠；本批不声称 JSON 字典保留了重复行位置。

新路由复用 Field.sourceMessage、既有 Name/template/金额费用 owner 和时间策略。原 Msg 的 window、speaker anchor、位置、时长、速度及后续 mnemonic 继续决定相同操作。缺当前持有人名或金额值仍由原 owner 拒绝，系统表不能提供默认值。现有战斗行动与消息共同使用 BattleGame 和共享消息 frame 的事务边界。

`check-source-battle-system-message-cohort.mjs` 使用六个实际原参数，在明确声明的 authored caller 中运行真实 Session/Flow、共享 Field 消息 owner、并发战斗行动、合法胜利返场及 CheckpointStorage 恢复。它完整保留原程序库存，但参数夹具不是原程序全流程或剧情可达性验收。`check-source-battle-system-messages.mjs` 复用既有消息检查器，以同一个运行时的统一 candidate 检查全部 53 个原程序和 490 个敌队依赖；不启动另一个 649 图生产器。native 静态复核、参数运行、完整程序、App、浏览器和原生对齐分别报告。新增解码和机制通过不等于全部剧情或 Web 迁移完成。
