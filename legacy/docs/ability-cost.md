# 装备与能力 MP 费用（v24）

本批恢复这份 PR 来源中两件 MP 饰品的完整穿戴依赖，以及资格、显示和执行共同使用的费用投影。没有给正式开场角色发放饰品，也没有把被动能力加入可选技能。其他穿戴函数、穿戴条件、等级次数制 MP、魔石以及能力 154 的游玩时间费用仍不在本批准入范围。

## 来源链

| 装备内容 | armor 行 | wear function group | 附加能力 / 内容 | menu group / function / 参数 | 费用 |
| --- | --- | --- | --- | --- | --- |
| 304 | 108 | 236 | 291 / 1491 | 234 / 75 / 1 | 正费用减半，正中值远离零取整 |
| 305 | 109 | 237 | 292 / 1492 | 235 / 75 / 2 | 正费用为 1 |

这两条 wear group 都仅有 function 62（AddEquipAbility）第一槽，其余函数与参数为零；wear condition group 为零。被动能力的战斗函数组、能力组、费用、等待、状态组等均为零，菜单函数为 MagicPointReduction。编译器验证整条关系、明确的 `None` 名称和所有当前相关行为字段。来源内容 ID 是原生 `GetMPDiameter` 的硬编码身份，不能把另一件使用相似函数的装备视作同一饰品。

`Ability.ConfirmUseValue`（0x4a5020）调用 FF6 `GetUseValue`（0x74bd00）；目前准入的等级零能力使用来源 use_value。仅能力 154 使用尚未准入的游玩时间替换。

`PassiveContentProvider.GetMPDiameter`（0x85b3d0）在 baseValue > 0 且 owned 装备存在时取各槽 OwnedItemData.ContentId，先查 305，再查 304。重复穿戴不叠加倍率；304 和 305 同穿时 305 优先。0 MP 保持 0。304 先把 int 转 float32、乘 0.5f，再调用 `Math.Round(double, MidpointRounding.AwayFromZero)`，因此正常正奇数费用向上取整。这里第二参数 1 是取整模式，不是小数位数。测试还覆盖大于 float32 连续整数范围的边界，避免用整数 `ceil(n / 2)` 误写完整算法。

原生三个调用点一致：

- PC `BattleAbilityInfomationContentController.UpdateView`（0x367660）显示 ConfirmUseValue 经 GetMPDiameter 后的数值。
- `BattleUtility.IsAbilityAct`（0x768410）在需要费用检查时调用 FF6 `IsUsableAbility`（0x85e980）；后者仅对 player 参数的等级零能力比较 currentMP >= 修正费用。非玩家在该提供器直接返回 true；Web 因而只对玩家要求 MP 足够，敌人仍能执行，实际付款后的 MP 下限为 0。
- `BattleActExecution.UseMp`（0x15ae7b0）从行动第一能力计算同一费用并扣一次；item、copy、rampage、weapon-added、slot 等分支跳过付款。本批没有因此准入这些其他行动。

## 角色记录与事务

`FixedEquip`（0x32cce0）先移除旧装备的能力，再 SetEquip，随后添加新装备能力。FF6 AddAbility（0x84bdb0）比较该 content 的穿戴份数与对应 ability 的 OwnedAbilityList 记录数；数量不足才追加。私有 AddAbility（0x84c1e0）创建 `skillLevel=0` 的 OwnedAbility，内容由 type 4 / type_value 找到。RemoveAbility（0x84d400 / 0x84d2c0）只删除第一条对应能力记录。

因此两件相同饰品合法占用两条相同被动记录，卸下一件后保留一条。被动不进入 command、能力排序、等级槽、全局学习历史或 `abilities.equipment`。后者是另一个提供器的数据，不能借本批把它清空或普遍解除门禁。原先“任何 owned ability ID 不得重复”的约束要由可信 catalog + 实际 loadout 做窄化；普通能力仍不可重复。

`src/core/equipment.ts` 提供：

- `equipmentAbilityCostProviders(catalog, loadout)`：验证现有装备资格并输出逐份被动描述符。
- `equipmentOwnedAbilities(catalog, loadout)`：按可信目录读取已知被动副本，独立于尚未恢复的换装资格；未知双持等依赖只阻塞相关费用，不抹掉副本或连带禁止独立道具。
- `validateEquipmentAbilityOwnership(catalog, loadout, owned)`：逐身份核对数量、contentId 和 skillLevel，拒绝缺失、凭空增加或篡改的被动。
- `applyEquipmentAbilityChange(owned, before, after, catalog)`：返回分离的候选列表，按移除、替换、追加顺序处理；调用方和装备、参数一起提交。预览、取消与失败不会改动输入。

`src/core/ability-cost.ts` 的 `projectAbilityCost({id,cost}, owner)` 返回 `{baseMp, mp, modifier, contentIds}`，不预约或支付。玩家 owner 必须包含实际 `EquipmentCatalog` 和六槽 `EquipmentLoadout`；敌人使用无装备的费用投影。BattleGame 使用入战冻结的装备身份，菜单资格、目标投影、AI 反应上下文和实际扣款均读取同一投影。道具在行动宿主使用自身的零费用分支。

普通参数编译仍保留这两件饰品的 weight=2，不改变 maxMP、其他属性或装备库存计数。job / slot / 可用份数约束沿用原装备系统。

## 验证与边界

独立测试位于 `tests/ability-cost*.test.ts`，使用合成装备身份，覆盖零与奇数、float32 边界、优先级和重复、资格失败、逐份添加/删除、候选取消、跨角色份数守恒、来源闭包被破坏以及属性投影。将 304 的 wear 函数清成零也会被拒绝，不能通过丢失依赖退化成普通装备。

```sh
npx tsc -p tsconfig.json --outDir build/v24-ability-cost-dist
node --test build/v24-ability-cost-dist/tests/ability-cost*.test.js
node scripts/check-ability-cost-native.mjs
node scripts/check-ability-cost.mjs --dist build/v24-ability-cost-dist
```

原生检查复用完整导出收据，校验 DLL、symbols、header、各 C 文件和 PE 地址区段摘要，并单独核对被泛型别名混淆的 getter、计数 predicate 和取整调用。范围为 13 个原生方法及 12 个独立 raw 区段；输出 `build/reports/ability-cost-native-check.json`。这些是静态证据，不是运行原版得到的动态一致性结果。

实际来源检查从原表重新编译完整装备目录，并要求与发布目录完全一致。其受控实例通过真实库存接口取得饰品，再换装、跨两级来源成长、存取并创建实际 owned 战斗 lease；7 种穿戴组合分别使用自然持有的 31/40，验证费用资格和一次付款。另注入非法防御参数，要求失败帧保持费用和结果原子性，修复后与同 seed 重播相同。原版存档、正式初始装备和持有技能不被这些检查修改；这些探针不表示整场战斗或完整游戏已完成迁移。

本批实际结果：隔离 TypeScript 构建通过；9 项新费用测试与相关既有装备、参数、owned、成长测试合计 61 项通过。v24 正式来源目录共有 223 件装备，121 件准入，新增两件都保留完整提供器。7 种组合的 14 次自然技能行动、升级与存取链、另一个失败帧回滚/重播探针均通过；结果在 `build/reports/ability-cost-check.json`，运行日志为 `build/reports/ability-cost-v24-source.log`。
