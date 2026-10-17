# 菜单、战斗与共享库存

2026-10-11，`narshe-playability-v14`。普通固定 HP／MP 恢复道具已贯通菜单、战斗、共享库存和稳定检查点。当前准入菜单 8 种、战斗 9 种，包含复合恢复和我方全体恢复；其余效果保留来源函数与阻塞原因。这是受限系统增量，不是完整物品系统或全游戏验收。

## 来源与准入

来源父集为 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`，战斗导出子集为 `42705316cd47f43c9b91d6cab6469a632c967716420c559b409b9dbfad8a3503`。原生 DLL SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，metadata SHA-256 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。原始文件和生成反编译内容只保存在本地忽略目录。

| 来源位置 | 已恢复的范围 |
| --- | --- |
| `OwnedItemClient.IsUseFunction 0x7fae40` / `IsUseRecoveryParameter 0x7fb670` | 查库存和目标，使用菜单函数组，普通恢复先检查对应资源是否已满，再检查函数结果。无有效目标时菜单不执行使用。永久成长、能力学习等分支独立保留。 |
| `ItemUseController.UseConsumptionFunction 0xa6e6e0` / `OwnedItemClient.UseFunction 0x7fe5e0` | UI 至少有一个有效目标才调用使用；执行所选目标的菜单函数后，数量减一。复合效果不按函数数量扣道具。 |
| `GetIFunctionList 0x7f9d80` | 依次建立函数组的三个槽，空槽不把后续槽重编号。菜单、战斗引用可以不同。 |
| `CalcControllerProvider.GetFixedRecoveryStatus 0x3d8660` / `BattleDamageCalculation.GetFixedRecoveryStatus 0x157aed0` | 能力读取自己的 StandardValue；普通道具读取 `OwnedItemData.Item.StandardValue`。死亡类型 5 由共享谓词 `0x478ff0` 判断。当前宿主只提供存活我方目标；其他状态由现有准入限制阻塞。 |
| `Item.StandardValue 0x4a5fb0` / `Item.DestroyRate 0x4a5f30` | 共享 RVA 不能用 Ghidra 显示的首个别名认定字段。核对符号、Item.Param 顺序和机器码，分别读取 master 整数数组索引 8 与 7。 |
| `FixedItemUse 0x15a9340` / `FixedStatusInfo.UseItem 0x5029b0` | 原生在本场道具副本和已用数量中结算，包含预扣回补、destroy_rate、复制动作、机械与装备分支。当前只准入普通、销毁率 100 的恢复品；预订、取消退款和结算的精确时序尚无动态对照。 |
| `command.csv:3` / `character_status.csv.command_id1…6` | Item 命令为动态物品列表，和能力列表分开。开场三人来源槽含命令 3；本开发入口按该成员关系开放，检查普通单次使用和 command_wait=0，未扩展通用剧情解锁。 |

19 份原生导出及 3 个共享字节范围通过原始 DLL 与导出摘要核验，收据 `build/reports/items-native-check.json` SHA-256 `d575b0a67282c5c724344c0fb658831e9323a96ad1b5a1aac7498fe6a62dd14d`。导出 `semanticsVerified:false` 保持不变；静态身份检查不等于原版运行验证。

`compileItem` 保留 content ID、item 行 ID、重要物品标记、数值、资格与独立的 menu/battle 三槽程序。只准入普通物品、无元素/特殊载体、准确率和销毁率 100 的 `Recovery(1,2,0)` / `Recovery(1,3,0)` 组合。菜单仅单个队员；战斗可单体或我方全体。内容 ID 2–8、24 在两种上下文准入，9 只在战斗准入。50 个物品 × 两种上下文全部分析，不能把 100 个解码结果称作 100 个可玩动作。

缺失引用或空槽的孤立参数是编译错误；已知但未实现的函数、特殊规则或范围得到阻塞诊断。重要物品、复活、解除状态、帐篷、永久成长、武器/防具使用等没有借用同名能力实现。`source.tables` 保留每个原始表行的文件、摘要及对象定位。

## 所有权和事务

`GameState` 独占持久角色与库存。菜单点击先投影效果；确认时重新检查数量、目标和可恢复资源，把 HP／MP／状态与数量一起提交。满资源、倒地、未知目标和重要物品不消耗。`GameSession.useMenuItem` 仅允许稳定地图空闲状态，活动事件、切图及战斗期间不可使用字段菜单道具。

战斗借用战前角色和库存的独立副本。行动使用 `{kind: "ability" | "item", id}` 保持载体身份，避免物品内容 ID 恰好等于能力 ID 时串用规则。技能和道具通过同一个 `projectActionTarget` 投影数值、状态与 HP／死亡关系，再暂存全部目标并整体提交。

选择道具时预订一件，可用数量为剩余库存减去尚未结算的预订。相同角色重复确认或两名角色争用最后一件均被拒绝。目标在执行前重验；行动取消释放预订，后续目标计算失败不发布任何恢复或扣量。成功动作不论目标数、函数数只扣一件，战斗满资源目标仍消耗。数量、结果、反应和随机状态保持同一个提交边界。

胜利预检把消耗清单、角色结果、Gil 和领奖序号一起提交到 `GameState`，重复领奖无效。失败重试使用战前副本，恢复战前库存和角色状态。暂停菜单在战斗期间投影本场剩余库存；返回地图后读取已提交的共享状态。当前没有逃跑、战斗内保存或掉落分配，不能推断这些路径已处理。

战斗道具暂不开放敌方目标：收到物品的反应上下文、特殊恢复及敌方目标仍需恢复，不把物品伪装成能力传给反击模块。来源 range 保留不变，这一执行限制显式记录在宿主及验收报告。400/900 ms 表现时点、预订/退款、目标重选、浮字显示基础恢复量等仍属于开发规则。

## 检查与浏览器

```sh
npm run check
npm run items:check
npm run playable:check
npm run save:check
.venv/bin/python -m unittest discover -s tools/tests
```

286 项 TypeScript 与登记契约、18 项 Python 通过。新增检查覆盖双角色争用、重复确认、目标失效、晚出现的目标错误整体回滚、重要物品保护、战前副本隔离、一次性领奖、帧切分和完整检查点恢复。物理、魔法、元素、状态、复活、目标、反击、来源 AI 和能力分派回归通过。

来源道具检查执行 17 组菜单/战斗输入；期望恢复量独立从原始函数和 standard_value 读取，不从编译 plan 复制。初始药品和伤害均为显式受控输入。既有五次连续遭遇仍通过；40 次保存/恢复后的最终状态与连续运行一致。已有 131 个空闲入口的保存回归通过，不计为新增内容或地区覆盖。

浏览器 `/items.html` 使用正式 `InventoryView`、`BattleView` 和 `GameSession`，只增加标明来源的受控输入和事件入口。实测菜单 HP 1→51、复合 HP／MP 恢复、满资源禁用、最后一件预订、全队一次扣量、胜利返回及检查点恢复。测试保存仅在内存，不覆盖正式本地存档。页面控制台无 warning/error；截图 `build/reports/items-browser.png`，收据 `items-browser-check.json`。正式 `/game/` 不发放测试药品，初始库存仍只有来源重要物品 58 × 1。

正式 `/game/` 另以正常输入完成新开场、守卫对白、敌人攻击、两次射线、胜利、返回与移动至 `(38,36)`。暂停菜单为等级 3/2/2、HP 63/63/43、最大 HP 63/79/81、Gil 3096、普通道具无、坠饰 1；控制台无 warning/error。未覆盖正式保存槽。截图 `build/reports/items-opening-browser.png`，收据 `items-opening-browser-check.json`。

当前目录摘要 `4d672c22e5e55dba24914e62eaae5e69195ea822657e3c84b256a0c343a62d95`；来源道具检查 contentHash `4ee193882d8e5c4d5bc9c362f3375b7a8a9ca525c207019c7e8295be3f10ba12`。新目录会拒绝旧开发版本存档，浏览器明确提示版本不同并保留原存档；跨版本迁移尚未实现。

下一步继续复活/解除状态道具、装备库存与换装资格、动态属性重算、字段物品读写及完整初始化。系统门禁仍未完成，暂不成批填充地区，HD-2D 保持后置。
