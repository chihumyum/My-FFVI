# Function33 固定 HP 基值魔法

完整来源能力表的 1,530 条声明统一编译。Function33 的 19 条声明按实际 slot、series、Value1/2/3 解码；其中 10 条可生成有条件的动作计划，8 条混合函数和 1 条召唤载体继续明确阻塞。没有按技能 ID、剧情 PC、敌队或开场样本开放能力。

`BaseValueFixedHPFunction.Calc 4f4760` 的 Value1 选择施法者或目标，Value2 选择当前 HP、当前 HP 百分比、当前 HP 除数或缺失 HP。本批只接入全源实际出现的这些模式；随机和位数模式没有成为默认实现。乘法使用原生 int32、除法向零截断；尚未闭合的负值/溢出恢复域在抽随机数前拒绝。

`BaseValueFixedHPMagicFunction.Calc 4f5190` 先检查实际 Enemy 参数的 Boss 字段，再调用 `GetFixedBaseValueMagicStatus 3d78d0`；后者调用现有 `MagicExecution a94480`，设置 fixType=1。命中仍使用来源 accuracy、flags 和目标状态；固定命中不抽命中随机数。没有普通魔法的浮动、防御、Shell 和友方伤害减半。固定 HP 基值仍经过目标数修正、65535 中间上限及 9999 最终上限。零值是无效数值结果，仍保留收到能力与反击判定；Boss 是 Miss。当前来源族全部中性，额外元素载体继续阻塞。

来源 effect/SE 行被完整绑定，原生演出暂缓，既有 Web 动作阶段承担表现。所有数值进入 `projectActionTarget/Targets` 和同一个 `BattleGame.resolve`：普通命令、敌方 AI、派生能力及剧情战斗动作共用费用、HP/MP、条件、反击、生命结算和回滚。

Boss 事实来自原 Monster 整数列37，经既有 Enemy ctor 写入 bossFlag；独立于遭遇 Boss 标记、画面、名字和站位。只读 `bossParameter` 随来源模板，实际对象由已有 `#parameterOrigins` 捕获，替换、退出和帧回滚复用既有注册表，不建立另一个状态 owner，不写入存档。

实际条件 owner 必须准入施法者和目标的所有活动状态；未实现的 Trance621/684 等没有被解释为无行为。目标装备结果转换 `ExchangeValueForEquipment 3d5ac0` 仍有独立门槛：实际玩家目标需要同一 `inventoryQualification` 六槽均为已知 empty 装备；缺失、未知或非空装备明确阻塞。没有装备 owner 的来源玩家不得借用合成测试域。来源 Enemy 参数没有玩家装备 owner；catalog-less 合成战斗明确作为独立机制测试。该限制意味着 10 条计划不能计作 10 个完全可玩的原版技能。

混合 Function9、Function38、ADD_VARIABLE_CALC、召唤载体及其各自缺口均保留；原生混合自状态能力的特殊 Boss/装备路径没有通过技能 ID 特判进入运行时。Type13 的新固定基值魔法只允许已有普通敌方载体，不授予玩家技能、学习或命令资格。

静态复验（只读原字节，不启动 Ghidra 或 DLL）：

```sh
python tools/native/audit_base_hp_magic.py --source-root /path/to/source-root \
  --derived /path/to/native-derived --provider /path/to/native-provider \
  --output build/reports/base-hp-magic-native.json
```

新导出精确三方法、2336 字节，分两次独占 lease 完成。完整旧方法和有限直接 PE 范围独立复验原 DLL、symbols、header、next-symbol 边界、C 与原始范围哈希。原始 C、表、剧情与资产仅留 ignored build。静态身份通过不等于原生动态一致性。

全源复验：先构建当前作者树，使用 `scripts/check-base-hp-magic-source.mjs --source-root … --compiled dist --baseline … --output …`。报告保留所有 430 份物理 AI、474 条 AI 主表绑定、容器错误、悬空引用和完整族依赖；比较全部 1,530 条能力及 430 份 AI 的前后差分。参数测试、合成 BattleGame 成功、静态无缺口均不授予完整剧情批次贯通。没有运行 producer、浏览器或任何原版来源剧情。
