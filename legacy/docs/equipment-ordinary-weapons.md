# 普通武器与远程行位

2026-10-12，v26。目标是让装备持有、真实六槽、参数、动作资格和行位使用同一个来源闭包。该批没有新增地图、正式测试装备或 HD-2D 工作，也没有运行原版。原生静态证据、受控 Web 执行与原版一致性仍分别记录。

## 当前范围

223 个装备身份保留完整库存身份；129 个在当前效果模型中准入，94 个有明确 blocker。相对 v25 的 121/102，10 个 `back_flag=1` 身份确认普通动作，另有两个原先漏检的专属数值武器被收紧。这个净增数量不等于新增可获得或可装备数量。

| content | weapon | 来源名称 | 结论 |
| --- | --- | --- | --- |
| 162 | 70 | 链枷 | 普通远程，可按来源职业/六槽资格装备 |
| 163 | 71 | 圆月轮 | 同上 |
| 164 | 72 | 晨星锤 | 同上 |
| 165 | 73 | 回旋镖 | 同上 |
| 166 | 74 | 旭日 | 同上 |
| 171 | 79 | 卡牌 | 同上 |
| 172 | 80 | 飞镖 | 同上 |
| 159–161 | 67–69 | 手里剑、风魔手里剑、风车 | 普通描述符可确认，但 `job_group` 没有任何 accept，不能换装；未授予投掷动作 |
| 103、122 | 11、30 | 勇士匕首、究极神兵 | `process_prog=None` 仍命中原生专属伤害分支，继续阻塞 |

另外 8 个远程身份仍有 process、穿戴或追加状态等缺口。所有 19 条 `add_ability_weapon` 引用的武器仍阻塞其追加动作；空列表必须由来源资产确认，不能从未找到 CSV trigger 推断。

来源开场角色 31/32 的 job 18 可装备上述 7 种，角色 1 的 job 19 仅能装备链枷和晨星锤。因此本轮可验证 16 个来源角色/武器组合。正式库存仍仅为 95×1、104×2、201×3、216×3、244×3，没有把检查用副本写进开场。

## 来源路径

| 方法 / 地址 | 本轮使用的语义 |
| --- | --- |
| `GetFightStatus` `0x3d6990` | 选中手的 Weapon.Id 11/30 分别进入专属数值标志；普通表值不足以排除该分支 |
| 玩家武器参数 `0x534d90`、`0x534f30` | 保留两手来源参数，动作取实际选中手，不由固定右手推断 |
| 普通选手 `0x15a6b50` | 实际武器/空位与惯用手选择；未开放双持或特殊 `UseArmType` |
| 行位提供器 `0x4de0a0`、`0x4de0e0`、`0x4de110` | 实际两只手筛出非空武器；至少一个且全部 `BackFlag` 时，忽略攻击者及目标的后排减半 |
| `BattleStatusControl.GetUniqueFightAttackWeaponId` `0x685510` | 先查 Rampage type 616，再查 Sketch/Throw 武器覆盖；本轮普通动作依赖这些覆盖不活动，不能从背包猜出覆盖武器 |
| `FightActFunctionFF6.InitPrepareState` `0x4ff360` | 普通动作准备经实际 arm 进入追加能力检查；特殊乱击等分支不并入普通闭包 |
| `FightActFunctionFF6.ExecHitEffect` `0x4ff070` | 命中表现读取已选择的武器和既有计算结果；不构成新增普通伤害公式依据 |
| `FightActFunctionToAddAbility.AddtionAbilty` `0x500200` | 按选中手 Weapon.Id 遍历独立 `BattleExtraDesc.add_ability_weapon`，匹配后抽取随机数，可能追加能力 |

`0x350ba0` 和 `0x350f70` 是共享地址，没有伪称唯一函数反编译。前者按条件实例字段 `+0x64` 比较 `0x268`（616）；后者按 capture 的 monsterId 与 `LikeMonsterFightAttackParam.monster_id` 比较。校验器保留全部符号候选，结合头文件布局和原始 PE 字节绑定解释。

追加能力目录来自唯一的 `Assets/GameAssets/Serial/Data/BattleExtraData/battle_extra_data.json`，Unity 对象 `844792129800189524`，容器 `battleextradata_assets_all_1295049eaf8a1a34aca99fdc338e0a02.bundle`，容器 SHA-256 `88e795d2894c3c8c7faffe4613226191e34d5e73903cc5428d11220b4d2c0578`。19 条记录均保留来源顺序与对应 weapon/ability 行。即使未来某条概率为 0，匹配仍会抽随机数，因此不能当作不存在，也不能去重后改变原生遍历。

原生输出位于 `build/native/v26-weapon-speed-entry` 和 `build/native/v26-weapon-additional`，并复用既有装备、参数与行位导出。`check-ordinary-weapon-native.mjs` 共核对 14 个方法和 6 个原始汇编区间，绑定 GameAssembly SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。回执保持 `semanticsVerified=false`、`originalGameExecuted=false`。

## 共用契约

`OrdinaryWeapon` 明确保留 `contentId` 与 `weaponId` 两种身份，以及来源 `typeId`、`backFlag`。每个武器装备定义必须有对应描述符；防具为 `null`，未恢复武器也为 `null` 并带 blocker。运行时不能为缺失描述符补普通值。

`compileOrdinaryWeaponEffects(reader, rawBattleExtraDesc)` 要求原始 `add_ability_weapon` 数组，返回目录与 weapon/ability 依赖。`compileEquipment`、`compileEquipmentCatalog`、角色初始化和玩家战斗定义均显式传入该目录。最终来源包保存 `ordinaryWeaponEffects:{catalog,sources,source}`，包含 source set、容器摘要和 Unity 身份；字段与战斗编译使用同一来源提供器。

`validateEquipmentBattleRows(catalog, frozenLoadout, rows)` 先验证完整六槽、职业、特殊手能力与装备效果，再将每件武器的 content/type/backFlag 与行位目录对齐。`BattleGame` 从 GameState lease 取冻结的真实六槽，在选择和执行物理动作时重新派生当前行位；装备变更禁止穿过活动 lease。没有新增持久化的“忽略后排”布尔字段。

远程仍使用 [原前后排物理顺序](battle-row.md)：普通攻击者后排减半在基础伤害后、随机之前，目标后排减半在防御减算加一之后。符合来源武器谓词时跳过两处减半，不额外抽随机数；伤害、命中、元素和友军修正继续走相同计算器。无需替每件武器创建场景或战斗分支。

未知手能力只阻塞依赖它的物理投影。已确认的装备被动持有记录不会丢弃；零费用非物理行动和独立物品仍可查询并执行。两份 MP 饰品持有、未知双持资格、魔法和物品实际执行的回归共同约束这个边界。

## 验收

```sh
npx tsc -p tsconfig.json --outDir build/v26-equipment-dist
node --test build/v26-equipment-dist/tests/ordinary-weapon*.test.js build/v26-equipment-dist/tests/battle-enemy-cost.test.js
node scripts/check-ordinary-weapon-native.mjs
node scripts/check-ordinary-weapon.mjs --dist build/v26-equipment-dist
node scripts/check-equipment.mjs --dist build/v26-equipment-dist
node scripts/check-battle-row.mjs --dist build/v26-equipment-dist
```

新增 7 项编译/纯语义测试、3 项实际 GameState/BattleGame 回归；原有敌方费用 6 项回归中强化了未知手能力与独立物品的分离。覆盖范围包括来源必填字段、process/特殊武器/追加能力阻塞、概率零仍需提供器、两手换装守恒、最后副本竞争、目录不一致拒绝、存档篡改原子失败和执行帧失败后确定性重试。

`check-ordinary-weapon.mjs` 独立从受 snapshot/manifest 约束的原始表和额外资产重新编译，比较正式来源包与 equipment/row 两份目录。结果为 244 组身份/追加能力检查、28 组行位提供器、28 组纯数值、32 组来源角色/武器/手槽换装存档、128 场四行位组合的实际战斗，以及 13 组无职业或专属效果拒绝。受控战斗只移除参与者的魔导状态以进入普通攻击，在进程内临时授予单份待测装备；每场取消 lease 后持有状态不变，末尾再次核验正式初始库存。

旧来源装备检查更新为 493 个受控 preview，18 个开场卸装/复装槽位；行位检查仍覆盖 1,530 能力、223 装备、235 提供器、12 纯数值和 45 个实际宿主断言。来源初始化 18/34、成长、费用和 18 角色战斗模板检查随必填提供器签名重新通过。最终报告存于 `build/reports/ordinary-weapon-{native-,}check.json`、`equipment-check.json` 和 `battle-row-check.json`；本轮最终摘要由根集成统一重绑定。

剧情库存检查保留实际 17 个来源装备授予站点：6 次防具换装成功，11 次效果未准入的换装原子拒绝，然后都执行存档、读取及租约借用。其中三个武器站点只有 content 103/121/127；103 命中专属公式，121/127 命中追加能力。检查器不再错误要求这些来源站点必有普通武器成功换装，也没有为了测试添加新的授予指令。

尚未完成投掷、双持、双手、Rampage/Sketch/Throw 动作覆盖、专属武器公式、武器追加能力、完整武器动画/音效以及原版运行对照。角色拥有资格与商店出现该身份不证明当前剧情已经可达该获取点。
