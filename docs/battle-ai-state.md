# 敌方行为参数与阶段条件

2026-10-11，`narshe-playability-v11` / `battle-ai-normal-v2`。在 v10 普通行动 VM 上接入逐敌变量、阶段编号和当前 HP/MP 条件。参数由战斗角色拥有，VM 每次返回暂存结果；初始化、就绪决策、预检查和失败回滚各自有明确边界。当前继续搭建共用系统，未填充新地区，未开展 HD-2D。

## 来源语义

完整来源集 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`，战斗子集 `42705316cd47f43c9b91d6cab6469a632c967716420c559b409b9dbfad8a3503`。DLL SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，metadata SHA-256 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。每份 AI 保留原始对象身份、文件摘要和来源指令 PC。

| 方法与 RVA | 本批恢复的行为 |
| --- | --- |
| `EnemyCharacterParameter..ctor 0x4afb70` | `CurrentMode` 初始化为 0；分配 15 个零初始化的 int32 变量。字段偏移分别为 `0x164`、`0x168`，属于每个敌人的参数对象。 |
| `VariableAssign 0x82a260` | 把立即数写入指定变量；负索引与 0 一样访问首格，索引 15 及以上越界。 |
| `VariableCalc 0x82a400`，源 mnemonic `ValueCalc` | 读取变量，调用 `Internal.Main.OperationMain` 后写回。复用与字段脚本相同的 int32 算术，但不共享字段变量存储。 |
| `IsVariableComparison 0x827ca0` | 对变量与立即数运算，结果恰好为 1 才跳转。不是把任意非零结果当真。 |
| `IsCheckHp 0x8222b0` / `IsCheckMp 0x822580` | 比较当前 HP/MP 整数，不是最大值或百分比；保留严格与非严格边界。 |
| `ModeCount 0x828900` / `ModeSet 0x828990` | 增加或设置独立阶段编号；计数按 int32 回绕，不与变量 0 别名。 |
| `IsModeSelecting 0x825180` / `IsNotModeSelecting 0x825640` | 阶段编号相等或不相等时跳转。 |

这些参数操作没有普通行动就绪判断，因此初始化遇到它们也执行。分支沿用已核对的“写入标签地址后 ForwardStep 一次”的 PC 语义。

本次同时检查了 `LoopAct 0x828410`、`SetActAbilityLoopAttack 0x15b8740`、`AddAdvancedActCounter 0x15b7830/0x15b8ff0`。该路径把 rValues 转为重复次数，提交独立的行动类型 8，再更新 advancedActCount；后者还涉及 FF6 专用状态分支。尚未恢复其完整队列顺序、行动计数消费和反应生命周期，**LoopAct 仍不执行**，不能用普通攻击重复排队代替。

以上 14 个方法的源 DLL 字节范围、C 输出、符号和 header 摘要复核通过，收据 `build/reports/ai-state-native-check.json`，SHA-256 `a5dabc7e6098aed146486aa900f2e3a16216be3da90606feb6c447284f61be50`。收据保留 `semanticsVerified:false`、原版动态对照未知；静态完整性不构成原版运行验收。

## 状态所有权与事务

- `enemy-behavior.ts` 定义独立的 15 格变量与阶段参数。`Combatant.behavior` 由战斗拥有，玩家为 null；两名敌人复用同一程序时仍各自初始化。以后能力效果与战斗事件应修改这个共同所有者，而不是私藏另一套变量。
- `script-integer.ts` 承载共用来源算术。字段的 `EventState` 继续拥有其原有变量银行；AI 不能读写这些银行。AI 头部的 `ScriptLocal` 与本批敌人参数是不同概念，非空 ScriptLocal 仍明确阻塞。
- `startBattleAI` 返回初始 PC 和暂存参数。BattleGame 提交真实初始化结果；第一次普通回合的能力预检查只检查，不推进变量或阶段。
- `planBattleAITurn` 复制行为参数，执行赋值、运算、条件和行动表，不改活跃对象或抽取随机数。路径与能力依赖通过后，宿主按原有顺序选动作和目标，再一起提交 AI 进度、参数与排队动作。失败时保留原参数、AI 状态和随机流。
- 有限变量循环可以多次经过同一个 PC。循环检测比较 PC、表进度、阶段和全部变量；完整状态重现即报错。另有每次路径 10,000 条指令的宿主防挂起上限，超出明确停止；这不是原版指令预算。

`VariableAssign`、`ValueCalc`、变量比较、HP/MP 条件和阶段条件共新增九种来源 mnemonic；普通 VM 共解码 18 种。错误仍定位原始对象与 Mnemonics PC。没有引入敌人名称、敌人 ID 或地图名称特例。

## 来源与实现检查

`npm run battle-ai:check` 生成 `build/reports/battle-ai-check.json`，contentHash `f57b9d8604843530353ac3cc06c101bbe3823993ae4709aea8991045b08efb36`，对应目录 hash `f1b62ecdc6f0194d59cce46fdcd4b782a82eede9f8b9baf6a75e7b61f2b98c8e`。

- 430 份来源 AI 重新诊断，165 份全部指令可解码，较 v10 增加 9 份。这是指令覆盖，不是可玩敌人数。
- Flan 原脚本逐回合把阶段编号推进为 1、2、3、4，行动行在 PC 5/6 轮换。Missile Bay 当前 HP 为 1535 时按 PC 10/11/12 轮换，HP 为 1536 时停留普通表 PC 5；这些控制流检查不执行未实现的能力。
- Lesser Lopros 变量 0 为 2 时走普通表；达到 3 后准确停在 PC 12 的未实现 ActForTarget。没有跳过未知阶段。
- Soul Saver 使用**明确构造的控制流检查点**：PC 20 的 SyncAI、变量 0 为 1；原脚本转到 PC 45 的 SyncAI。MP 为 2048 时选到 PC 62 并在 PC 63 将变量清零，MP 为 2049 时停在未实现的 PC 47。保留整份源程序与原 PC，没有执行能力 686，没有声称这个检查点是可达剧情存档；无动作的中间阶段尚不由普通战斗宿主接纳。
- Siegfried、Soldier、Brachiosaur 三份原有受控宿主检查保留，增加 thina 的阶段设置和 Short Arm 在当前 HP 10000 下的正常分支。五份程序各自通过 60 秒与 6,000 × 10 ms 的同种子重放。Short Arm HP 提到 10113 后仍在 CounterAct 明确阻塞。宿主使用开场参数/图片，这些敌人的完整技能、反击与死亡事件未迁移。
- `npm run check`：239 项 TypeScript 与登记契约通过；18 项 Python 通过。新增检查覆盖初始化提交、预检查不推进、共享程序的敌人隔离、状态驱动的物理/魔法切换、失败回滚、有限/无限循环、边界和非法参数。
- 共用算术抽离后，87 份字段来源脚本的 258 组输入全部执行完成；既有物理、魔法、元素、状态、死亡/复活、目标、来源战斗及 3 → 1 → 2 → 3 → 42 连续遭遇检查通过。

浏览器只验收新版内核与已有开场的集成：重载构建、移动、事件交接、敌人自动行动、玩家两次射线、96 EXP / 96 Gil 胜利及返回地图。返回后移动至 `(38,40)`，Gil 为 3096，无控制台 warning/error。收据 `build/reports/ai-state-browser-check.json`，SHA-256 `4cd164752fd07ec9bcccf49ca876729602d4dbe243a9b938a7065d40c4e734b5`；截图 `ai-state-browser-victory.jpg` / `ai-state-browser-return.jpg`。新参数机制的证据来自上述纯控制流与受控战斗，不以开场画面代替这些机制检查。

## 后续边界

本批没有恢复技能/系统调用对敌人变量的全部修改者，没有实现反击、插队、LoopAct、完整目标规则、无动作普通回合或完整 Boss 事件。能力 696 的函数 38 继续阻塞，未将其认定为空动作。

下一步先接入共享的反应触发与行动调度，再接角色名册、编队、库存、装备、成长和保存。系统闭环门禁保持未通过；系统完成后再按来源依赖批量填充内容。
