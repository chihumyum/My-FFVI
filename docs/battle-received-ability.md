# 收到能力的 AI 上下文

2026-10-11，v16 将 `IsRecevieAbility` 与 `IsRecevieAbilitySystem` 接入共用来源 AI。两个条件读取本次唤醒收到的能力 ID / system ID，不借用属性编号，也不把一次受击永久保留成敌人的状态。普通反击调度仍沿用 [普通反击](battle-reactions.md) 的有界实现。

## 本版本来源证据

原始 `GameAssembly.dll` SHA-256 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。新增导出保存在忽略目录 `build/native/ai-received-context/`；来源指纹、符号、方法边界、DLL 范围字节和导出文本由独立脚本重验。导出工具的 `semanticsVerified` 保持 `false`，本节是对具体静态链的解释，不是原版动态一致性验收。

| 原生方法 RVA | 本批采用的规则 |
| --- | --- |
| `0x826490` / `0x826390` | 两个条件分别调用 `IActSelectEnemy` 槽 28 / 29；将返回值与 `iValues[0]` 比较，相同则跳到 `iValues[1]`，随后执行器前进一步。条件本身没有普通行动 readiness、反击 readiness 或存活 HP 门槛。 |
| `0x15b7e80` / `0x15b7ea0` | controller 从 `recevieAbility` 读取 ID / system ID；引用为空时两个查询均返回 0。 |
| `0x15b7730` | 成功结果的受击回调保存收到的能力引用；普通反击 readiness 仍是另一字段。 |
| `0x15b7520` | received 回调保存能力引用，不能因为未命中而丢失身份。现有首函数 `Miss` 对应本通道；`Non` 的额外 provider 仍未接入。 |
| `0x15b7460` | 恢复回调也保存能力引用，但走独立的 recovery readiness；不能因此把完整恢复反应宣称为已实现。 |
| `0x828fe0` → `0x15b8460` → `0x15b9d50` | 首次进入 `SyncAI` 时重置 readiness，并清空收到的能力引用。因此下一次普通唤醒不能读取上一次的能力。 |

`0x1591170`、`0x1591ba0`、`0x1591ee0` 与 `0x1590190` 继续提供首函数结果的收集/回调依据。本批没有修改成功、未命中、排除能力、自身行动或递归反击的准入规则。

早期调查曾考虑将收到的能力一直保留到下一普通回合；新取得的 `ResetReadyFlag` 证据否定了这个解释，运行时按 `SyncAI` 清空。

## 所有权与提交

`BattleAIState.receivedAbility` 显式保存 `{ id, systemId } | null`。反应路由在暂存状态中注入本次身份，达到 `SyncAI` 后清空。初始化和普通唤醒的空引用查询返回 0；未知/缺失的反应身份不能冒充空引用。等待状态若仍携带上次能力会被拒绝。

两个条件只决定来源脚本的路由。`CounterAct` 自己仍检查 counter readiness、存活和排除 system；`Act` 自己仍要求普通 readiness。因此“能查询收到的能力”不等于“可以发出普通技能或反击”。未知操作数继续编译为明确阻塞。

能力效果、全部目标的反应 AI、敌人变量、队列、费用和随机流仍一次性提交。第二个目标的依赖失败不会留下第一个目标的结果。用于检查的 AI 状态返回独立副本；战斗失败重试重新从入场副本和原种子初始化上下文。

现有检查点契约没有扩大：稳定地图状态可以保存，战斗中仍不可保存。测试覆盖入场前检查点恢复、相同指令与随机种子的重放，以及失败后重试。

## 来源验证与限制

`scripts/check-battle-received-ability.mjs` 直接读取已验证的原始导出，不重写候选游戏包：

```sh
npm run build
node --test dist/tests/battle-received-ability.test.js
node scripts/check-battle-received-ability.mjs --native build/runtime/game/GameAssembly.dll
```

本批结果为 9 项合成语义/集成测试、25 处 `IsRecevieAbility` 与 1 处 `IsRecevieAbilitySystem` 原始操作数对照、5 条直接来源 AI 路由、2 组未改写来源 AI 宿主及分帧重放、15 个方法的原生导出完整性重验。报告分别写入 `build/reports/battle-received-ability-check.json` 和 `battle-received-ability-native-check.json`，绑定当次候选、来源和脚本身份。

宿主使用 Templar 原始 21 条指令，object ID `7235875817597455095`，没有抽取其中一条放进合成行动表。命中普通能力 1 时走原 PC 5 的反击 379，未命中时不发反击；已有普通队列保持。宿主的战斗位置、统计值、HP、命中率及等待时间是明确的受控输入，不是原始 Templar 遭遇的完整复刻。

仍需保留这些边界：

- 原始能力 3 和 40 尚不可执行。能力 3 的分支只通过直接 AI 输入验证：原条件命中后跳过普通反击，不能把该输入称作能力 3 的动作已迁移。
- 原始 monster 3 还引用初始状态 903。当前宿主借用已支持敌人的参数，不能因此把该敌人标记可玩。原脚本的状态 12 查询也不代表混乱行为已支持。
- 其余收到物品、命令、属性、命中分类等条件仍明确阻塞。临死反应、恢复 readiness 的完整消费、多个 readiness 同时存在的原版时序仍待恢复。
- 临死调查显示 `IsUnableFight` 的 HP 判断与死亡状态资格是两个来源条件；其时序尚未闭合，本批没有开放临死技能。
- 指令解码数量、受控宿主和原版动态一致性是不同验收层，不增加可玩地区或正式迁移覆盖声明。
