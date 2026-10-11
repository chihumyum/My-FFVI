# 普通战斗掉落（v24）

本模块恢复当前 Pixel Remaster 来源版本的普通怪物掉落：倒下登记、总掉率、槽位权重、内容身份、合并数量，以及持有上限与战斗消耗的先后关系。它不等于这些怪物的 AI、技能、剧情或战斗场景都已可玩，也不包含偷盗、特殊变化技能、特殊结算旗标和原版动态一致性。

## 来源链

- `UnableFightConditionFunction.Start`（`0x5282a0`）只在敌人分支把实际 `Monster` 传给 `BattleItemDropPlug.SetLotMonster`（`0x1587300`）。后者直接追加列表，没有按敌人实例或怪物来源 ID 去重。复活后再次进入死亡状态、两个实例使用同一怪物 ID，都保留新的登记。
- `BattleController.StartWinResult`（`0x463f00`）先调用 `LotGilIndividualDropItem`（`0x1586d20`），按登记顺序执行 `Lot`（`0x1586e30`）。结果不是胜利时重新遍历全部敌人产生的。
- `CommonUtility.GetBoolRand`（`0x3897e0`）总是调用 `Random.Range(0,100)`，再比较随机值 `< monster.drop_rate`。`drop_rate=0` 与 `100` 也各消耗一次抽取。失败时不进行第二次抽取。
- 成功后读取 `MONSTER_DROP_RATE_1..8`，调用整数 `GetRandWeight`（`0x389880`）：范围为 `[0,sum)`，按顺序减去权重，第一次变负的槽位获选。当前来源权重为 `88,12,0,0,0,0,0,0`；槽位结构仍完整保留八项。
- 每次登记只选一个槽位。空内容 ID 不给奖励，也不重抽。`SetLotData`（`0x15871b0`）按内容 ID 合并第一条匹配记录，保持首次出现顺序；`DropItemData.AddDropValue`（`0x4ae510`）直接累计数量。内容 ID `1` 是独立 Gil 行的特殊路径，本次普通道具/装备模块不把它冒充道具。
- `StartWinResult → SaveParameter → FixedStatusInfo.SaveItem`（`0x501e20`）负责实际入库。来源顺序是偷盗物品入库、扣战斗使用量、掉落入库。`NoSaveItem=9` 只跳过使用量扣除，不跳过掉落。当前普通入口未准入该特殊旗标，也未准入偷盗奖励。
- 掉落最终调用现有 `OwnedItemClient.AddOwnedItem`（`0x7f7900/0x7f79a0`）：先将入库数量限制到 `MAX_ITEM`，合并总持有数后再次限制。装备总持有包括穿戴的副本；获得装备不自动穿戴。显示用 `BattleResultData.ItemList` 仍保留抽中的数量，因此显示数量与满容量时实际增加量可以不同。

Guard 来源怪物 `1` 的 `drop_rate=12`，前两个槽位都是内容 `2 × 1`。这代表总掉率 12%，成功时得到一个恢复药；不是两个槽位分别抽取，也不是必定获得恢复药。

以上使用本地原 DLL、符号/类型布局和完成的 Ghidra 导出复核。三个共享地址 `0x47bbd0/0x4ae510/0x4ae520` 直接绑定机器字节、`DropItemData` 布局及精确符号，不采用任意第一个反编译别名。静态回执始终保留 `semanticsVerified=false`。

## 状态与事务

`src/compiler/battle-rewards.ts` 的 `compileBattleDropCatalog(reader, monsterIds)` 输出完整来源依赖、可用定义和逐怪物 blocker。任何有正概率被选中的缺失内容都在战斗开始前阻塞，不能因某个种子碰巧未掉落而通过。权重为零或总掉率为零的槽位不额外创造运行时内容依赖。

`src/core/battle-rewards.ts` 的 `projectBattleDrops(catalog, orderedMonsterIds, random)` 是纯投影，返回可序列化 `registrations/rolls/drops/grants`。它不持有库存，不执行入库，也不改变玩家或敌人；完整请求先验证，再使用宿主提供的随机流。正数量整数溢出与未知奖励种类保持明确阻塞。

战斗宿主持有真实死亡登记顺序，并在胜利准备时生成一次 `reward.dropPlan`。动作失败时，登记、死亡边界和随机状态必须随整个动作回滚。结果预览、重复确认和返回字段重试都消费同一份计划，不重新抽取。正式来源配置必须提供目录；`drops=null` 只用于明确受控的旧机制样例，不能作为正式入口的默认空奖励。

`previewVictory().dropGrants` 交给 `GameState.prepareVictory`，在单一 owned 候选中先扣使用量，再通过共享库存项目器处理掉落、成长、Gil 和完成回执，验证后一次发布。失败、过期和重复提交不能留下半份奖励；保存/恢复保存的是已发布持有状态及完成回执，恢复不会重放掉落。战斗本身仍不支持中途存档。

当前 Web 在结算确认并返回字段的事务边界发布 owned 状态；原生在显示结果前已写入。战斗期间的共享状态写入仍由租约锁定，这一可见时点差异没有当作原版一致性通过。随机取值范围与调用顺序已恢复，但 Web 的确定性随机生成器并未与 Unity 的随机序列作动态对照。

## 验证入口与范围

```sh
npx tsc -p tsconfig.json --outDir build/v24-rewards-dist
node --test build/v24-rewards-dist/tests/battle-rewards.test.js
node scripts/check-battle-rewards-native.mjs
node scripts/check-battle-rewards.mjs --build-dir build/v24-rewards-dist --source-only
# 主线程完成当前目录编译后，增加真实宿主与持有状态检查：
node scripts/check-battle-rewards.mjs --build-dir build/v24-rewards-dist
```

当前纯模块 12 项测试已通过，覆盖两层概率边界、零/满掉率的随机调用、重复登记、稳定合并顺序、八槽与空槽、所有身份先验检查、容量与选择分离、未知引用、装备别名和整数边界。

来源表 508 个怪物中，499 个具备可用的普通掉落定义，涉及 126 个内容身份；9 个怪物的正概率槽位引用缺失 `content.csv` 行，保留 blocker。来源检查枚举 49,900 个总掉率取值和 28,200 个条件槽位取值，并单列重复登记样例。这个计数只说明掉落提供器的来源覆盖。

原生检查从零生成 `build/reports/battle-rewards-native-check.json`：16 个方法、23 段机器字节、11 项语义绑定检查。来源单独检查写 `battle-rewards-source-check.json`；完整检查另外写 `battle-rewards-check.json`，逐身份检查近满/全满容量、准备不发布、过期/重复拒绝、保存恢复，并通过真实纳尔谢字段触发与战斗菜单分别验证掉落/未掉落结果。完整回执的当前目录哈希和实际通过数量应以最终生成的回执为准，不能由单独来源检查替代。

本次完整来源检查已通过 254 个持有事务样例和 9 次真实字段触发的 Web 战斗：确定性种子 `1..8` 未掉落，`9` 得到内容 `2 × 1`。每次都验证死亡登记、计划重放、预览隔离、一次领取及检查点恢复。这是 Web 实现检查，原游戏仍未执行；回执记录实际绑定的目录哈希，主线程若再次重编目录须重新生成。
