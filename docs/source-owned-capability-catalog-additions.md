# 持有能力目录的封闭增量合同

本合同仅登记 `gameState.sourceBattleHandoffs` 和 `gameState.sourceSpecialOwnedMembers` 两个来源能力目录。它们描述可用协议及原始依赖，不是名册、HP／MP、编队、库存、经验或存档状态。未知目录没有通用放行分支；已有目录不得修改或删除。历史 message-fee 增量继续使用自己的合同。

`src/compiler/source-owned-capability-catalogs.ts` 是两个字段的共同编译入口。`GameCatalogCompileOptions.ownedCapabilityAdditionAudit` 只接受 `omit-source-owned-capability-catalogs-for-addition-audit-v1` 及这个登记集合内非空、无重复的 omit 列表。正常编译包含两目录；审计基线重新调用同源纯编译器，由选项决定是否编译对应目录。不能从候选删字段生成基线，也不能同时提供旧单目录选项和新选项。

`source-owned-capability-additions.mjs` 对一个严格 bag 统一处理声明、来源 reader 和按 URL 绑定的基线。声明带当前 compiler digest、corpus／system 来源身份及登记目录名。resolver 验证实际 old pin、最终 proof、基线 proof、准确 omitted 集合，以及整个旧 `gameState` 与同源基线一致；只有登记的缺失目录可在基线到候选阶段增加。实际初始化及其它所有字段必须逐字相同，两个目录以外的正文也必须相同。即使两个字段同时新增，也不能掩盖已有目录或其它持有能力的变化。

## 来源证明

共同 reader 独立读取 `loadCorpus`、`loadSystemSource` 和 Battle 原表，并明确核对 system 与 corpus 的 sourceSetHash。Handoff expected 从完整100条 Condition master 纯编译，保留 Condition ID、Type 和 UntilType 各自的域。Special expected 从 CharacterStatus 12／17／18、各角色实际 job 引用及 ExpTable 1 的 `total_exp=0` 编译；ghost2 的职业不能凭角色 ID 推断。

审计重新从原表编译 expected，不使用 candidate 自报目录作为证明。证据保留相关原表完整数据及 hash、逐依赖原始行、文件／资产／serializedFile／十进制 objectId／rowId、原物理文件 hash 和精确 compiler／Special core-native-fact 模块 pin。Special 目录本身没有 sourceSetHash，不能因此省略外部来源绑定。固定 nativeSha256 是已审核的能力事实，不授权执行 DLL，也不把静态来源证明当动态原版验收。

## 共用 DAG 与历史 fee

`compileSourceBattlePrerequisites` 只做来源 Battle／目录编译。对旧 source、opening 的每个目录，按实际缺失的登记字段纯编译当前无增量基线；另纯编译相同目录形态、无 message-fee 的历史基线。因此 H0F0 与当前拥有目录的比较始终分开，已有持久初始化完全不变。

普通战斗目录的历史 H／S 形态可能与它的父 seed 不同。stage 返回仅支持两个已知根 URL 及登记 omit 集合的 `compileBattleAuditBaseline`，缓存同一捕获原始来源的纯编译结果；异常不留下可发布半成品。`compileDerivedOwnedCapabilityBaselines` 读取实际旧 ordinary 目录自身的缺失集合，向该编译器请求对应父变体，再经原 `compileBattleContentBatch` 派生 ordinary 基线与独立 fee 基线。不能按父 seed 的缺失形态替代 ordinary 的形态。

生产者、普通目录引用和 recipe resolver 只传一份 `sourceOwnedCapabilityAdditions` bag；以后未登记字段不会因为增加参数或默认 fallback 而放行。旧 Handoff API 保留必要形状适配，所有审核委托同一个封闭实现，没有第二套审核算法。原 raw seed、recipe 字节和历史 pins 不改。原 pin 与当前种子不符仍拒绝，这不是本目录增量合同可以修补的来源差异。

## 验收边界

受控测试覆盖 H0S0／H1S0／H0S1／H1S1 与独立 fee 历史、source／opening／ordinary 实际 resolver、普通目录与父 seed 不同的旧形态、晚来源／派生失败重试、raw 行及来源篡改、已有目录删除／修改、其它初始化变化、未知字段、旧 pin 和准确 omission 集合。

`check-source-catalog-additions.mjs` 执行实际来源的两个纯目录 preflight，再经过同一实际引用和 recipe resolver，保存完整原目录、候选、纯编译基线及每 key 来源证明，并复核原始 seed、recipe 和 runtime 未变。它停在 `compileWorld` 前；不运行世界 producer、浏览器、原 DLL 或剧情。真实旧 ordinary pin 若不匹配，报告其明确拒绝，不能用合成案例替代真实普通目录发布证据。
