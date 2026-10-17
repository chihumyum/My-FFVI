# 战斗换列

v43 将来源普通“换列”接入既有战斗行动队列：确认目标后蓄力，效果成功时更改当前参战者的前后排，胜利返回地图时与奖励、资源、成长一起写回共享编队。没有新增独立行位所有者，也没有授予新角色或能力。公开 profile 沿用 `narshe-playability-v35`，共享 owned v9 的 `party.slots[].row` 已能保存结果，不增加快照字段。

## 本构建来源

`command.csv` 5 → `ability.csv` 4 → `function_group.csv` 403 → `function.csv` 17。能力的 type=7、system=2、range=5（自身）、wait=3、MP=0、power=0；只有一个 function17 槽，三个参数均为零，无元素、内容旗标或特殊 process。

复用 `build/native/ability-providers/342080.c` 的已完成收据，FF6 provider 的 `case 0x11` 实际建立 `BattleFunction17`。其余证据直接读取当前 `GameAssembly.dll` 原始指令并用同一份 IL2CPP 元数据绑定；本批没有新建 Ghidra 导出。

- `HitCalc 0x979f20` 使用固定结果提供器 `GetFixedStatus(0)`，不进行普通攻击伤害或命中抽样。
- `UpdateParameter 0x97a3a0` 读取 `BattleActData.CurrentTargetType`。1=SingleMember、6=Self 走单一目标；读取 `BattlePlayerData.corps` 的 Id，调用 `GetChangeCorpsId 0x764400` 再写回 Corps。该 helper 将来源 Front=1 改为 Back=2，Back 改为 Front；Web 只接受已验证的两种行位。其他 target type 的分支还会访问未选中的 Corps，本批没有把它简化成逐目标翻转，也不准入该分支。
- `ViewEntity 0x97a790` 在参数变更后按新 Corps Id 设置 `CorpsFront=5` 或 `CorpsBack=6`；`IsFunctionEnd 0x97a1d0` 经 `0x92f8f0` 等待站位动画恢复 Idle。
- `FixedStatusInfo.SaveCorpList 0x501c70` 从战斗 Corps 列表逐位置取 Id，调用 `CorpsClient.SwitchByIndex 0xaabbb0`。因此战后行位属于共享编队，而不是战斗画面临时偏移。

`scripts/check-battle-row-change-native.mjs` 核验 DLL、符号和头文件三摘要，10 个原始方法范围、字段/枚举与关键调用，以及复用的 provider 反编译收据。输出为 `build/reports/battle-row-change-native-check.json`。这是本构建静态来源核验；没有运行 Windows 原版，也不宣称原版动态一致性。

## 共用执行与所有权

`compiler/battle-row-change.ts` 仅编译上述普通单槽、自身、零消耗的完整规则。全队换列、敌方、物品载体、复制动作及未准入阵型没有因此开放。准入按函数和规则组合判断，不用显示名称识别行为。

`core/battle-row-change.ts` 的 `changeBattleRow` 是无随机、无写入的目标投影，返回 `{resource:"row",before,after,slot,missed:false}`。结果没有伪造 HP 伤害、恢复数值或状态条件。

`projectActionTarget` 在单个玩家自身目标和零费用下使用它。`BattleGame` 仍经过既有资格、目标、来源 wait/ATB 和动作队列；入队本身不改 row。效果阶段将 row 与本次动作其他候选状态一起发布，整个逻辑帧异常时由既有快照回滚。正常换列消耗本次行动，后续物理计算直接读取当前 `Combatant.row`；魔导等来源明确忽略行位的攻击继续使用原有提供器规则。

`GameState.prepareVictory` 校验参战顺序、持有身份、租约起始 row 和当前编队格，再把结果 row 写入同一个候选 PartyState。其他保存编队与空格不跟随变动。返回地图准备失败不提交行位或奖励；失败战斗重试仍读入场租约原态。此提交边界沿用 Web 的胜利事务，未开放逃跑、败退结算或战斗中保存。

画面使用现有开发行动时长和当前行位标识/位置投影，不复刻原生换列运动动画精度。换列结果不显示伤害数字或射线。UI 与战斗展示由集成线验收。

## 验收

隔离构建及本线测试：

```sh
npx tsc --outDir build/v43-row-change-dist
node --test build/v43-row-change-dist/tests/battle-row-change*.test.js
node scripts/check-battle-row-change-native.mjs
node scripts/check-battle-row-change.mjs --compiled-dir build/v43-row-change-dist
```

新测试覆盖来源形态拒绝、单一目标与零费用、入队/蓄力/效果时点、二次换回、晚失败整帧回滚、胜利同一 session 返回、保存/恢复/下一次入战、败北重试、返场准备失败、错误身份/行位与过期提交。原有 Defend 和编队回归一起运行；没有修改原始资产。

本线专用 10 项语义测试通过；连同既有 Defend/编队回归共 23 项通过。静态来源检查核验 10 个原始方法区间与 1 份复用导出，独立来源表编译检查 12 项通过。完整发布目录的运行链另由下述 checker 记录，不能用这些静态计数替代。

来源 checker 先独立编译真实表并核对发布目录的 plan，再沿已发布开发字段入口进入真实首战，逐角色使用 command5、以既有魔导能力获胜，验证返场失败与成功、共享队伍和 JSON 检查点。该路径属于来源数据驱动的受控 Web 验收，不是完整新游戏或原版运行对照。报告为 `build/reports/battle-row-change-check.json`；`--source-only` 仅检查来源编译，不计作运行链通过。
