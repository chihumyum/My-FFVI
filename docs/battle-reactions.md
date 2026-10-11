# 普通反击与优先队列

2026-10-11，`narshe-playability-v13` / `battle-ai-v4`。敌人现在可由本次动作的结算结果唤醒来源 AI，生成优先于普通动作的反击。反击使用独立队列，保留原有普通行动和行动条；效果、敌人变量、AI 进度、反击决策和随机流一起提交。该增量没有增加地区或剧情解锁，系统闭环仍未完成。

## 来源与适用范围

完整来源集 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`，战斗子集 `42705316cd47f43c9b91d6cab6469a632c967716420c559b409b9dbfad8a3503`。DLL SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`；metadata SHA-256 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。

| 方法与 RVA | 静态恢复与当前实现 |
| --- | --- |
| `InitCounterAI 0x1591640` / `IsLocalSerialCounter 0x85e0e0` | 普通反击排除反击动作本身和行动者对自己的动作，避免递归触发。原生还收集临死、恢复等独立反应，本批没有实现这些通道。 |
| `GetICalcResult 0x8f3030` / `IsCounter 0x15918e0` | 分类来自第一个函数的计算结果，而非最终 HP 差值。原生排除 Non/Miss；成功的零伤害、吸收和状态结果不能一概当作未命中。当前仅映射已准入 provider 的 `missed`，没有声称恢复全部 HitType。缺少首函数结果时明确失败。 |
| `SetCounter 0x1591ba0` / `SetRecevieAbility 0x1591ee0` | 成功反击过滤 misc 的排除能力；未命中走收到能力的唤醒路径。来源 `not_counter_ability_id` 为 696、1140、1262；未命中不套用成功反击的排除表。 |
| `CounterAct 0x81fd50` | 仅在 counter-ready、HP > 0 且收到技能的 system ID 不为 2/5 时抽样。这里是 system ID，不是 ability ID。反击不推进普通行动表的行计数。 |
| `SetActAbilityCounter 0x15b8550` / `SetActData 0x15b9d80` | 生成 `ActType.Interrupt = 1`，保留 isCounter 标记，并显式指向本次攻击者。当前只准入存活单体范围 3/7；对自己和其他范围仍受限。友军攻击的反击目标也保持原攻击者身份。 |
| `SetBattleActData 0x15ace70` / `InitPrepareState 0x15aa590` | interrupt 队列先于普通队列取出。宿主以独立 FIFO 保存反击；已有普通动作不会被替换。 |
| `ActExectionEndDelegate 0x6773f0` | interrupt 不使用普通行动的行动条完成回调。反击完成或失效均不清掉普通行动条，也不释放已有普通回合。 |

来源 `serial_misc_assets.json` 的对象 ID 为 `1008449607683934086`，容器摘要 `52174441db37c07ad415c949279d2f613822c4e9dabbcffffbfbf25ff610448a`。编译包保留完整来源定位。此资产没有 `counter_misc_info`。原生 `CounterMiscInfo` 构造器 `0xb1ee50` 写入默认计数 1；当前单函数组、逐目标一个首结果的开发宿主采用此默认值，遇到未来配置覆盖会阻塞。**未通过原版运行确认缺失字段的 Unity 嵌套反序列化最终值**；不能把构造器默认值当作独立实测配置。

本批核对 36 份原生方法导出和两个原始字节范围。`build/reports/ai-counter-native-check.json` SHA-256 为 `4e2a8dfd0612f91f13fb30c3c13b4ddb8687de940b1f0b11ea0a710aeb5ba27e`。包含恢复、临死和反击类型查询等尚未实现的研究；文件/字节身份验证不等于语义动态验收，`semanticsVerified:false` 保持不变。共享 RVA 使用原始字节与接口槽核对，不以首个别名推断行为。

## 状态与失败边界

`battle-reactions.ts` 只判定本次结果是否提供普通反击或未命中唤醒；`battle-ai.ts` 运行同一份来源控制流，以显式 readiness 区分初始化、普通回合和反应。普通 Act/LoopAct 在反应唤醒时不抽样、不出招；变量、阶段和资源条件仍按来源程序执行。未知指令保留 PC 和原因，不作为空操作跳过。

`BattleGame.resolve` 先暂存所有目标的 HP/MP/状态，含本次费用，再让反应 AI 读取这份暂存状态。所有目标的反应和能力依赖均成功后，才发布伤害、日志、AI 进度、敌人变量与队列；任意后续目标失败会回滚本次随机流，并保留原有队列和角色状态。反击也在实际执行前检查费用、状态与目标。

普通回合与反击分别拥有队列。已有普通动作、部分填充的行动条和普通表进度不因反击结束而重置。行动者死亡会取消两类待执行动作；致死受击不能执行 CounterAct。临死行动及其胜负延迟尚未实现，不能用本条死亡规则替代 FinalAttackAct。攻击者在反击前死亡时，当前沿用开发宿主的同阵营重选规则，此时序没有原版动态对照。

当前仍使用自有 PRNG、10 ms 固定步进、400/900 ms 表现时点和演出期间冻结行动条。成功但被排除的 system 2 恢复可能依赖独立恢复反应，宿主明确报错；其余未支持的恢复/临死触发、IsRecevieAbility、反击类型条件、完整 HitType、玩家反击及动态技能分派均未因此完成。

## 检查结果

`npm run battle-reactions:check` 生成 `build/reports/battle-reactions-check.json`，contentHash `511c5bacb86fa660238123a06162158d5f9c37c1858379ec91b8788ba185ad7d`；当前目录 hash `f8d27af7701b5d80d97e0aa3cbe5f6262fb0ee36d4ddce5913486bf7dd30d107`。

- 233 处来源 CounterAct 完成独立解码与抽样边界检查。模板中缺少完整程序结构的记录单列为阻塞，没有计为完整通过。
- Templar 的 PC 5 / 能力 379 和 Tonberry 的 PC 5 / 能力 459 放入**明确构造的普通行动表**，通过实际动作、反击优先、原普通动作保留与 60 秒 / 6,000 × 10 ms 重放。试验增加合成命令 900001，并将输入攻击 1 的 wait 显式覆盖为 0，便于稳定制造队列重叠；正式目录和剧情解锁没有变更。
- 两个敌人的完整原始程序仍分别阻塞在 `IsRecevieAbility` 和能力 154 的未实现函数/类型处。受控反击测试不等于这两个敌人已经迁移。
- 430 份来源 AI 重新诊断，其中 207 份所有指令可解码，**不是可玩敌人数**。报告 `battle-ai-check.json` contentHash `ec0667905787e7195a8da5e2155197e3bbc286a7dfe5df04476365bab66fbe99`。既有五份普通 AI 宿主与 97 处 LoopAct 检查保留。
- `npm run check` 通过 262 项 TypeScript 与登记契约；18 项 Python 通过。新增语义检查覆盖未命中/零伤害/恢复/致死、友军攻击、费用不足、目标变化、部分行动条、后续目标反应失败的整体回滚，以及帧切分重放。来源物理、魔法、元素、状态、复活、目标与战斗数据检查通过；既有编组 3 → 1 → 2 → 3 → 42 回归通过。

浏览器受控验证完成玩家攻击 1 → 敌人反击 379 → 敌人原有普通攻击 1：反击造成 15 点伤害后 gauge 仍为 100，原有普通动作完成后才为 0。截图 `build/reports/counter-priority-browser.jpg` 与 `counter-browser.jpg`；收据 `counter-browser-check.json` SHA-256 `e9919d478b9e4581638bbc10bd556f785a630a2e5210ef51cc8c504b126f50b9`。控制台无 warning/error。

正式开场页面通过来源守卫对白、敌人普通攻击、玩家两次火炎射线、96 EXP / 96 Gil 胜利和地图返回；本次长时间等待后两名队员倒下，唯一存活队员获得 96 EXP。返回后移动至 `(38,36)`，余额 3096 Gil，已暂停。收据 `counter-opening-browser-check.json` SHA-256 `12a6525d06a5624b36a6c5bbce752f0174f7bff8da484ec84e87fdde29b55c91`，截图 `counter-opening-victory.jpg` / `counter-opening-field.jpg`；无控制台 warning/error。这是 Web 组合流程证据，原版一致性仍未知。

## 后续系统工作

保留反应、状态与动态能力的缺口，按完整可玩流程的依赖推进。下一阶段建立角色名册、队伍、库存、装备、成长与奖励的单一状态所有者，让字段、菜单和战斗读写同一份数据，再完成浏览器检查点保存与恢复。机制解码数量不作为继续铺场景的依据；[系统闭环检查](core-mechanics.md) 全部保持未完成。
