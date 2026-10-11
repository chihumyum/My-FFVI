# 普通角色战斗定义

本模块属于 v21 的系统工作，不扩充剧情范围。来源角色初始化已经允许动态持有角色，旧战斗目录却只有开场三份 `CombatantDefinition`，使来源加入成功的角色仍在入战前被定义列表阻断。`src/compiler/player-battle.ts` 为已支持的初始化模板编译共用战斗定义；名册和当前编队继续由 `GameState` 独占。

## 所有权与入口边界

编译一份定义不会取得角色，不会改变正式初始队伍，不会授予装备、等级或技能。定义保存来源初始身份、确认后的参数、物理攻击参数、装备元素和普通静态媒体；`abilities`、`commands` 始终为空。当前等级、经验、HP/MP、名称、装备和能力必须在战斗入口从现有持有状态投影。`ownedAbilities` 由当前 owner 提供，不能从初始化随机能力组重建。

返回的 `requiredContext` 明确要求 `qualification="source"`、`appearance="ordinary"`、`magitek=false`。它是调用方必须满足的集成契约，不是编译器已经恢复了入口条件。普通模板不能因缺少资格提供器而退回静态菜单，也不能因为角色持有魔导能力就添加坐骑。607 类型状态、变身、状态替身、自动控制和其他特殊媒体仍由各自提供器准入；角色定义存在也不等于所有指令或能力都可执行。

v21 已将普通模板接入潜在定义目录，并将 `battleRequirements` 随定义保留。GameSession 在借用战斗状态之前、BattleGame 在初始化之前共同检查来源资格、当前状态上下文和 607 类型外观限制；检查 condition 表行的 `type`，不将 row53 与 type607 混同。开场三人的开发定义仍保留，其他角色不会借此获得开场魔导菜单。完整来源入口与特殊表现尚未接通。

角色当前在前排或后排属于运行时编队状态。编译器不根据初始 `character_status.corps` 删除一个以后可调到前排的角色；后排战斗仍由当前编队入口检查阻塞。当前职业变化和魔石、特殊学习、被动效果也不能靠一份普通初始化模板绕过各自检查。

## 来源与共用投影

`compilePlayerBattleDefinitions(reader, input)` 输入完整表数组、已编译初始化、`characterMedia`、来源 Sprite 目录和名称解析器，返回：

- `definitions`：按 source ID 排序的普通 `CombatantDefinition`。
- `blockers`：source ID、失败阶段及具体原因；一个候选失败不隐藏其他候选的结果。
- `dependencies`：每个候选读取的表行来源，以及选中的 Sprite 路径、Unity 对象身份和图像 SHA-256。
- `requiredContext` 和 `limitations`：模板准入前提与独立验收边界。

每份输入模板先通过 `compileOwnedCharacterInitialization` 从同一来源表重编，并逐字段核对。源检查包保留名称 key、可玩包解析同一 key，这两种表示都可核对；任意更改等级、HP、技能熟练度或被动输入都阻塞。初始条件、职业替换、双持/双手、特殊装备等继续沿用初始化编译器已有阻塞，不补零值。

装备编译只使用该初始化的六槽和来源空位，复用 `compileEquipmentCatalog`、`projectEquipmentParameters`、`equipmentAttackArm`。因此真正的武器在第二只手时，定义也使用第二只手的物理与元素值，不复制固定右手公式。十一项参数、来源分阶段上限、普通装备资格和元素合并仍分别归已有模块。

定义中的 `hp/mp` 是确认后的最大值，符合 `CombatantDefinition` 的目录语义；当前 HP/MP 不属于该字段的所有权。原始初始化的 current HP 在穿戴加成前计算，运行时必须保留这一差别。加入时等级校正也在持有状态执行：source 2 的静态定义为 Lv1、HP48、MP7，真实加入校正后的受控 owner 是 Lv5、EXP400、HP48/max102。

## 媒体

普通媒体使用 `character_status.character_asset_id → character_asset.asset_name → 唯一 Idle_00.png`，并核对 `characterMedia` 的同一表行来源。仅支持已导出的完整来源画布、底部中央 pivot `(0.5,0)`、正整数宽高和摘要绑定文件。缺失或重复路径、别的角色目录、Atlas/mesh 表示、错误 pivot、数字化的 Unity path ID 都拒绝；不会退选 RideL、坐骑或外观相近图片。

原始角色图包提供 Sprite/Texture2D。所用 `Idle_00` 是精确来源静态帧，这不证明原生 Animator 的状态选择、过渡、动作时序或全套动画已迁移。普通定义的 `mount=null`。开场魔导骑乘的来源条件及表现由单独入口契约控制，不能套用普通媒体模板。

## 检查

`tests/player-battle.test.ts` 覆盖定义不产生所有权、初始当前 HP 与最大 HP 区分、真实武器手、来源模板篡改、上游新增阻塞、媒体身份/几何损坏、候选失败隔离和重复身份。

独立来源检查：

```sh
npx tsc -p tsconfig.json --outDir build/check-player-battle-v21
node --test build/check-player-battle-v21/tests/player-battle.test.js
node tests/check-player-battle.mjs --dist build/check-player-battle-v21
```

默认检查器读取 `dist` 和 `build/game/opening-playable.json`，可用 `--catalog` 指定另一份已编译目录；它不重编公共产物。输出 `build/reports/player-battle-check.json`，删除旧结果后从当前来源重新生成。已有 owned-character、equipment、parameter、physical 原生回执作为独立依赖保留文件摘要，并核对实际 DLL 身份；本检查不会把那些静态回执改称原版执行验证。

当前隔离来源检查得到 18 份普通模板与 18 份精确媒体，另外 16 条初始化仍有上游阻塞；8 个损坏/缺失依赖被拒绝。受控 source 2 检查使用来源加入指令参数，仅将外观刷新设为 false，随后验证共用 owner、保存恢复、战斗 lease、明确普通上下文的来源指令资格和现有装备卸装重投影。正式 bootstrap 没有加入该角色或增加库存。真实 `GameSession` 入口条件、浏览器表现与原版一致性属于其他验收线；模板数量不是可玩角色或完整能力覆盖。
