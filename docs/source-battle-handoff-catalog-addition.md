# 来源 Battle handoff 目录增量合同

后续共同实现见[持有能力目录封闭增量合同](source-owned-capability-catalog-additions.md)。Handoff 与 SpecialOwned 已共用登记、纯编译基线和 resolver 审计；本文单目录参数保留为历史兼容适配，不单独维护另一套审核逻辑。

`gameState.sourceBattleHandoffs` 是从完整 Condition master 编译的不可变能力目录，不是实际持有角色、HP/MP、队伍、库存或存档状态。正常目录编译总是包含它；旧 raw seed 和 recipe pins 保持原字节与原身份。

旧目录重编经过 `compileSourceBattlePrerequisites`，它只执行 Battle 来源与目录阶段，不运行 `compileWorld`。新编译器遇到旧 seed 尚无该字段时，额外使用精确 `sourceBattleHandoffAdditionBaseline: omit-source-battle-handoffs-for-addition-audit-v1` 从同一原始来源纯编译无该目录的 baseline。这个 baseline 包含当前编译器的完整正文与诊断，没有从候选删字段伪造。旧 seed 的整个 `gameState` 必须与 baseline 相等；baseline 到最终候选除这一目录字段外的整个内容也必须相等。其他来源、初始化或未知字段变化仍拒绝。

Recipe rebinding 要求原 pin、当前候选 proof、独立 baseline proof、当前 compiler digest 与 `compiled-source-battle-handoff-addition-v1` 声明。目录内容重新从真实 Battle 来源表、已验证完整 corpus 的来源身份和精确编译模块读取；Condition ID、Type、UntilType 不能替换或遗漏。原目录已经含有该字段时，只允许其保持原样，不能借增量合同更新或移除它。

历史 Battle lowering 与 `sourceMessageFees` 仍使用已有合同。组合顺序为：旧 pin → 当前无 handoff 的完整目录，再审唯一 handoff 目录增量；旧 fee 缺失时，第一段另用同源无 fee／无 handoff 的纯编译 baseline。两份 baseline 各自绑定真实 old/new hash，不用一个剥离对象替代另一份证明。普通 Battle 批次也从对应 baseline 通过原 `compileBattleContentBatch` 编译，然后沿既有 linker 和 recipe resolver 传递。

`check-source-catalog-additions.mjs` 对实际 source/opening 两目录执行上述纯上游阶段和真实 recipe rebinding，保留完整旧目录、新目录、两种 baseline、证明与来源行，最后确认原 seed 与 runtime 未变。它不执行世界 producer、发布、剧情或原生程序；目录增量不授予剧情准入，也不迁移存档。旧 recipe pin 与当前 seed 不一致时继续拒绝，必须由各自既有身份合同独立处理。
