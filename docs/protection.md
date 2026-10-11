# 普通物理与魔法防护

v24 将该版本的普通物理防护与魔法防护接入共用状态、行动效果和伤害计算。状态持有者仍保存有序 condition 行 ID；数值模块只接收从当前列表派生的 condition type，没有第二份 `protected` 或 `shell` 布尔状态。正式剧情、初始能力与地区范围不因这次准入而扩大。

| 来源行 | condition type | 原生枚举 | 行为 | until |
| --- | --- | --- | --- | --- |
| 23 | 19 | Proteus | 普通物理防护 | 2 |
| 22 | 412 | Shell | 普通魔法防护 | 2 |
| 93 | 19 | Proteus | condition_group 1308、erase group 18，尚未准入 | 2 |
| 94 | 412 | Shell | condition_group 1309、erase group 19，尚未准入 | 2 |

`ConditionType.Protect=423` 是不同身份，不能按英文名称或旧版记忆与 type19 混用。普通行 22/23 的 `system_type=2`、`resistance_decision=1`、`overlapped_type=0`，参数、属性、种族、条件组与周期值均为零。编译器严格核对这些形状；同类型的 93/94 不会因为能识别名称而得到执行许可。

## 原生依据

`Serial.FF6.Calc.BattleConditionFunctionProvider.GetBattleConditionFunction 0x33d8a0` 将 type19 分派至 `ProteusConditionFunction`；type412 落入 `NonConditionFunction`。`Proteus.Start 0x92d930` 设置自身类型为 19 并初始化状态表现。`Non.Start 0x5176b0` 是多签名共享函数，机器指令从 `this+0x64` 取已由 `BattleConditionFunction.Init 0x45b450` 写入的类型，再调用虚函数 `InitConditionEffect`；不能采用共享地址的第一个名字来推断 Shell 行为。

两者 `Update 0x2c8ef0` 为共享返回指令，`Remove 0x4b71a0` 跳转到 `DestroyEffect 0x45ad60`。构造函数 `0x92d950/0x928510` 只初始化共同基类字段，没有防御参数、周期伤害、行动调度或资源修改。`InitConditionEffect 0x45b3d0` 只为玩家请求表现加载，`LoadConditionEffect 0x45bc70` 交给状态特效加载器。

普通施加沿现有 `AddConditionFunction.Calc/UpdateParameter 0x4f1d70/0x4f2630`：先检查同一主表记录是否可加，再检查抗性与命中，最后追加记录并处理来源冲突。重复普通施加不会刷新或叠加效果。`AddConditionExection 0xa91a90` 中 content flag1 将命中率设为 255；这与 Function Value2=1 的固定命中分支不同，不能因此跳过普通抗性字典键检查。flag4 才有独立忽略抗性的语义，本批没有准入它。普通白魔法的 flag3 是 Runic 转靶资格；当前 Runic 活动行为仍阻塞，不能将这一上下文扩展为完整 Runic 支持。

`UpdateCondtitonRecovery 0x45c5b0` 的自动恢复 switch 没有 until2 分支；它不会按行动数或时间清除普通防护。普通 ATB 入队只恢复 until1 的防御指令状态，所以不清除此两种防护。显式恢复沿 `RecoveryConditionMultiFunction 0x66eac0/0x66f4d0`，每个请求 ID 只移除一份记录。死亡追加来源行5后采用其解除组规则，移除普通防护但保留魔导状态53。`BattleEndRecoveryCondition 0x455de0` 只保留 until3/19，故 until2 的防护不会带回字段。字段应用与特效尚未准入，字段编译器明确排除这两类，存档不能借“无步伤”把它们当成普通持久状态。

## 数值顺序

`PhysicalExecution 0xa97b20` 对目标的 type19 使用整数商余分解：

```
q = trunc(damage / 256) * 170
r = trunc((damage % 256) * 170 / 256)
damage = q + r
damage = trunc((255 - defense) * damage / 256) + 1
```

这发生在普通物理浮动与命中之后、正常防御之前；随后才是前后排处理、Defend type1、友方伤害、暴击、元素与群体修正。当前宿主仍只准入前排及已经恢复的普通武器上下文。防护自身不加一，不使用浮点。content flag5 的无视防御路径同时绕过物理防护、Defend 与物理友方减半。原生治疗武器等其他绕过提供器仍在既有准入边界之外。

`MagicExecution 0xa94480` 对目标 type412 的检查则位于魔防及其 `+1` 之后：

```
damage = trunc((255 - magicDefense) * variedDamage / 256) + 1
if damage != 0:
    damage = trunc(damage * 170 / 256) + 1
```

此后才处理友方伤害、元素、上限与群体修正。普通恢复绕过魔防和 Shell；明确要求防御修正的恢复会经过二者，flag5 仍整体绕过。Defend 与物理防护不影响魔法算术，Shell 不影响物理。查询依据是类型是否存在，多条相同类型不会反复乘倍率。两个路径均不新增命中或浮动随机数；Unity 随机流与原版动态执行仍未对照。

## 实现与验收

- `src/core/protection.ts` 提供两种准确的整数修正及 `ProtectionBehavior` 类型；`physical.ts`、`magic.ts` 在各自来源顺序调用。
- `src/compiler/protection.ts` 提供 `hasProtectionBehavior` 与 `compileProtectionBehavior`，`compiler/conditions.ts` 和 `BattleConditions` 复用既有施加、解除、冲突、死亡与结束提交。
- `compiler/ability.ts` 将 ordinary type1/system2、明确的 type3/system2 防护效果交给同一 Function9 计划；目标范围、费用、反射、资格、抗性与状态持有仍各由原有所有者处理。纯数值模块不授予技能。
- 19 项新语义测试涵盖行身份、严格编译、共同持有、重复/抗性、flag1 与 Value2 的区别、ATB/死亡/结束、字段存档拒绝、实时行动投影、取整、无视防御、元素吸收和治疗。
- `scripts/check-protection-native.mjs` 每次重读原 DLL、IL2CPP 符号、头文件及导出收据，核对 21 个反编译方法和 5 段共享原始字节。GameAssembly SHA-256 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，新增导出位于 `build/native/v24-system-providers`。
- `scripts/check-protection.mjs --source-only` 使用完整本地表执行 21 项生命周期、28 项受控行动投影及 24 项数值检查。2 条普通状态准入，2 条特殊变体阻塞；7 条能力计划准入（68/77/534/1160/1161/1304/1432），4 条候选继续阻塞（101/242/243/1168）。默认模式另核对最终来源包与可玩目录的哈希、来源行、计划、活动行为和字段拒绝边界。

本地报告分别为 `build/reports/protection-native-check.json`、`protection-source-check.json` 与最终包模式的 `protection-check.json`。可通过 `--dist build/v24-protection-dist` 使用隔离编译产物，避免并行时覆盖公共输出。

原生持续特效327/328及 shadow-cloning 未迁移，当前使用共用文本状态显示；这与状态数值、施加和清除检查分开记录。特殊濒死自动发动、召唤、装备/永久防护、93/94 的提供器、复合能力1168、完整反射/Runic及原版动态一致性仍未完成。所有原生回执保留 `semanticsVerified=false`，上述检查不宣称全游戏或原版表现验收通过。
