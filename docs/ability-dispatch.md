# 能力函数分派与受限效果执行

2026-10-11。当前迁移恢复了 `ability → function_group → function.type_id → FF6 provider` 的引用链，并用它取代技能 ID 分类。当前为 `narshe-playability-v5`，共用中性魔法与 content flags 见 [魔法计算](magic-calculation.md)，资格/受限状态见 [状态动作](battle-conditions.md)；下文保留 v3/v4 分派批次的范围和历史收据。完整命中、状态、反射、元素、角色能力解锁和 AI 尚未完成。

## 来源依据

本批沿用来源集合 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`。GameAssembly SHA-256 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，metadata 为 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。

- `FunctionUtility.GetAbilityFunction 0x8F3CC0` 从首个 ability 建立函数列表，还会追加由函数返回的附加函数。附加装备/状态效果并未因此完成迁移。
- `ParameterActFunctionManagment.GetFunction(Ability) 0x66C890`、`GetFunction(FunctionGroup) 0x66C8E0` 按三个槽读取 function 引用、`type_id` 和三个数值参数。第二槽 ID 为零可跳过，第三槽独立读取；不能只取首槽。`BattleProvider.GetFunctionDatumByAbility 0x67F2B0` 的旧帮助方法只有两个槽，不能据此删掉第三槽。
- getter 的 IL2CPP 地址有共享别名。本批按 FunctionGroup 元数据核对：槽一 `4A4A40/4A4A80/4A4F60/4A4F20`，槽二 `4A5970/4A5930/4A5F30/4A5FB0`，槽三 `4A5EF0/4A58B0/4A5FF0/4A6030`；不使用反编译器误标出的 Ability getter 名作为语义依据。
- FF6 的 `FunctionProvider.GetFunctionClass 0x342080` 与 `GetFunctionBaseCalc 0x3419C0` 分别选择战斗包装和计算器。类型 1/2/3 的计算器为 Recovery/NormalAttack/Magic；包装并不必然使用同编号 BattleFunction 类，FF6 的恢复和魔法走共用 BattleFunction4。
- `RecoveryFunction.Calc 0x66FD90` 的 value1=1 选择固定恢复，value1=2 选择计算恢复；value2=2/3 对应 HP/MP 结果。`GetFixedRecoveryStatus 0x3D8660` 的 ability 普通分支读取 standard_value；目标状态、等级条件、Runic 和 ExchangeValueForCondition 仍有额外分支。此次只执行显式无这些修正的开发上下文。
- 类型 23 是 Unique，不能理解成“解除异常”。`BattleFunction23.GetUniqueKey 0x97C3F0` 读取 process_prog，交给 FF6 特殊 provider。其 FixedTarget/HitCalc/UpdateParameter 为 `0x755940/0x759140/0x75DEB0`。对于无 item/equipment 载体的 None/multiply，没有额外数值分支；仍存在共用目标与准备阶段。其他 key 保持阻塞。multiply 的伤害倍率顺序仍沿用已有临时实现。

本地原生输出在 `build/native/ability-{dispatch,functions,providers,recovery}/`；30 个方法范围和反编译文件摘要均重新核对。收据 `build/reports/ability-native-check.json` SHA-256 为 `ab792bd7f61da727821632d537f8c778a20de2ab3bac0dd740266bb7a18cfbd4`。这只证明来源与输出身份，不证明原版动态一致性。

## 实现边界

`src/compiler/ability.ts` 保留三个函数槽、function ID/type/series、每槽参数、process key/参数、目标范围和战斗选择器。完整来源行及对象身份保留在检查产物中；未知函数仍可检查，缺失引用直接失败。

开发规则另行生成整条动作的 plan：支持已有限定物理/魔法分支、固定或计算 HP/MP 恢复，以及多个固定恢复效果。未知的后续槽、特殊程序、范围、精度或条件组合会阻塞整条动作，不会只执行可识别的第一槽。没有复制到技能 ID 的分派分支。`presentation` 只决定画面；战斗逻辑读取效果列表。

`src/core/ability.ts` 在消耗随机数前预检完整效果列表，再计算所有结果。`BattleGame` 随后只消费一次费用，按来源顺序提交资源变化，每个效果有独立结果。角色死亡、复活和状态混合动作不在本批执行范围。玩家物理公式尚未恢复，玩家不能借用敌人物理分支。新字段契约升级为 v3，拒绝旧 v2 内容。

v3 批次要求没有活动状态、装备附加函数、反射、元素相性和不死转换；v4 放行的唯一活动行为是满足来源字段限制的沉默。费用、调度、计算恢复及物理/魔法数值仍带有明确开发假设。plan 可生成不代表对应剧情中可解锁、可选中或已具备完整效果。

## 检查结果

v3 批次扫描 1,530 条来源能力，全部函数引用可解析；当时 157 条受限 plan、1,373 条阻塞。v4 重跑 `npm run abilities:check` 为 165 条受限 plan、1,365 条阻塞，8 条增量仅属状态机制子集。报告含按函数类型和 process key 的使用点，可按共用机制扩展，不用逐技能写特例。

开场目录的原有六条可执行能力保留；402 使用与 377 相同的函数组合，现可生成相同数值计划，但其高等级狼犬 AI 分支仍被现有门禁挡住，没有扩展可玩遭遇。

另外用来源 760/761/764/765/766/1288 做受控执行：固定 HP、固定 MP、自身目标和同一动作 HP+MP 恢复，分别核对恢复值、上限和不同帧切分。它们没有被授予开场角色，也没有把物品/库存系统标为完成。收据 `build/reports/ability-check.json` 内容摘要 `567d74f11daea019aaf89c65624a8e6143c03d9c502f583cd8c030423419549b`。

141 个 TypeScript 测试、18 个 Python 测试、来源编译及五次连续遭遇回归通过。新语义检查包括第三槽、空槽间隔、未知后继函数、错误引用、未知选择器、计算前预检、复合恢复和一次性费用。浏览器实际执行了治愈原力、射线、首战胜利及返回地图（3096 Gil），无警告/错误，截图 `build/reports/ability-browser-victory.jpg`；六条新恢复能力的证据仅为隔离执行，没有对应菜单/道具/AI 实玩。

## 下一步

继续补恢复/伤害的状态与命中依赖，以及全局角色状态的输入生成。每恢复一项共用规则就重跑能力使用点清单；当前 v5 仍有 1,365 条阻塞，保留开发假设，不以增加 plan 数量作为完整战斗完成度。随后接入通用 AI、队伍/库存/成长及保存。
