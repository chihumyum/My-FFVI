# 字段持有状态指令

## 非零濒死/死亡解除

`RemoveCondition` type4/type5 共33个来源调用（8/25），保留33份完整正文、1,844条原操作、16图及233个完整依赖原对象。它们共用既有 `GameState.fieldOwnedConditions`、地图私有 draft 和逐目标 Field 外观事务；其余13个未实现 RemoveCondition、AddCondition 和 MP-count 的门槛不变。静态33处解码不代表正文或剧情已执行。

这条非零路径先记录当前列表是否含死亡type5，按匹配主表行删除所有同ID项，全部删除后仅在请求type5且先前死亡时恢复一次1HP，并沿既有HP setter维护濒死。type4只删除当前濒死行，不改HP，也不提前重建濒死。每个目标最后仍执行一次 `Refresh(false)` 和 `AffectLeader`，包括没有可删状态的目标；非零路径不写Core寄存器。它不复用type0的原列表循环、hook或逐记录HP恢复。

可信来源的完整100行条件目录是该 Web 投影的既有 authority。源type5有row5与row100，全部保为身份依赖；未知活动100仍拒绝，不能以“即将删除”为由清洗非法状态。原生 `GetList<Condition>` 的两个rgctx实际provider尚未恢复，不声称知道字典插入次序。这里可以忽略枚举顺序，仅因为每行删除是保序过滤、缺行不写状态、不同ID删除可交换、HP和外观都在全部行删除后发生；该证明不授权 first-row AddCondition、未知状态行为、type0 hook或任意提供器。

完整来源比较使用 `scripts/check-owned-condition-remove-life-source.mjs`，要求显式基线compiled、物理loader捕获和其SHA；逐条对照全部3,304/186,003，仅允许这33处投影改变。机制测试用预先声明的受控战斗让实际BattleGame伤害造成死亡，唯一返场后执行原type4/5 target0参数，覆盖原生演员刷新、地图候选失败/取消/重试、stale发布和Storage继续。受控战斗与参数探针不计来源剧情可达性，正式原版动态对照仍未进行。

当前 v98 的 type0、逐目标领队交接、同任务银行及明确 Web 活动策略见 [共用生命周期](story-shared-lifecycles.md)。下述 v22 数量是历史范围；665/666显式移除、MP-count及未知活动状态没有随本批放行。

v22 将来源 `AddCondition` / `RemoveCondition` 的 type 607 接入唯一 `GameState`，并把每个目标对应的队伍外观刷新纳入同一准备阶段。它不是完整状态指令集：真实语料共 210 个调用点，本批 8 个 607 调用点可进入该实现，其余 202 个保留 blocker。是否能执行完整脚本，还取决于旗标、队伍、演员、媒体和其余指令。

## 来源语义

`i0` 是 `ConditionType`，`i1` 是角色选择器；存储的是 `condition.csv` 的主表行 ID。本版 607 对应 row 53，纯模块及测试不把二者当作同一个数。来源 DLL 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。

| 选择器 | 来源含义 |
| --- | --- |
| 0 | 按当前 Corps 位置访问持有人，跳过空位；不筛掉 disabled 持有人 |
| −1 | 按持有名册顺序访问 enabled 持有人，包括不在当前队的角色 |
| 正数 | 按 `CharacterStatus.Id` 查完整持有名册，包含 disabled；未持有则失败，不创建角色 |

`Misc.ActionOnCharacter (0xb4e130)` 定义前两种枚举方式，`Corps.GetCharacterIdFromStatusId (0xb477c0)` 定义正数查找。`GetOwnedCharactersClone (0x871840)` 的 true 路径不检查 `IsEnableCorps`，false 路径跳过 disabled；`GetMemberData (0x870230)` 按当前 Corps 的 owned ID 返回副本。

`Misc.AddCondition (0xb4e500)` → `Character.AddCondition (0xb44fb0)` 按类型取主表条件，再调用 `OwnedCharacterClient.AddCondition (0x326060)`。已有同一主表行不重复追加。这条字段路径不运行战斗的命中、耐性、冲突消解或行为计时器。607 没有 HP/MP 数值变化。

`Misc.RemoveCondition (0xb517e0)` → `Character.RemoveCondition (0xb46410)` 对非零类型取对应主表行，再以 `duplicationRemove=true` 调用 `OwnedCharacterClient.RemoveCondition (0x330ef0)`。本版 607 恰有一个来源行，删除它的全部同 ID 项，保留其他条件及顺序。纯投影保留来源处理重复项的能力；正式持有存档仍拒绝重复条件。

type 0 不等于无条件清空：它会调用脚本的 `NotRemoveConditionWhenAll` 钩子。type 5 还有死亡 HP 与恢复 HP 副作用。v22 未随607准入这些行为；v98 按固定 Current 钩子另行实现 type0，保留行身份和完整顺序。多个同类型行不能由通用表遍历猜顺序；607 decoder 仍要求来源行唯一且符合完整已知行为。

## 外观与发布

每个目标即使发生重复添加或无状态可删，也会执行 `Refresh(false)` 和 `AffectLeaderWithCondition (0xb45540)`。两条指令的原始代码分别在 `0xb45251`、`0xb46bab` 向 `IMapAccessor` 的槽 43 传入 false，随后调用 AffectLeader。

`AffectLeader` 在明确的 `KeepBadStatusVisual=false` 下直接返回。v22 对 true/未知拒绝；v98 的 true 路径要求明确活动资格宿主并执行逐目标完整交接，未知仍拒绝，不能当作无效果。

`projectOwnedCondition` 返回最终名册及每个目标之后的独立候选名册。`GameState.fieldOwnedConditions.prepare` 把它们投影为按来源顺序排列的 `OwnedConditionAppearanceStep`。共享接口为：

```ts
prepare(command): {
  targets: string[];
  steps: {
    targetId: string;
    appearance: PartyAppearanceCandidate;
    setDummy: false;
    affectLeader: true;
  }[];
  commit(): void;
  commitWith(publish: () => void): void;
}
```

`executeOwnedConditionEvent` 先准备所有外观步骤，再通过 `commitWith` 在同一持有者发布锁内执行演员的最后一次校验和发布，最后写入持有状态。最后一次宿主读取仍观察旧持有状态，校验失败可重试原候选；成功消费一次。`FieldPartyActors.prepareSequence` 在隔离的演员状态上依次准备，所有中间媒体、碰撞、伴随者和视角依赖都须先成立。校验后只允许同步写入已准备的数据，不能再执行可能失败的宿主工作；任意外部回调先写后抛异常不属于可回滚合同。空目标列表没有 Refresh 调用，不额外要求演员提供器。

v97 对 live owner 和地图私有草稿共用上述顺序，并拒绝重入、旧 revision/generation 和活动战斗 lease。真实 `GameSession`、原生演员实例、存读档和普通战斗往返的16项连续测试覆盖最后阶段取消、材质失配、动画实例替换及同候选重试；没有扩大 type0/665/666 状态准入。

## 共享存档、字段与战斗

`prepareFieldState().ports.ownedConditions` 与库存、宝箱、编队、角色生命周期和步伤使用同一候选状态及 generation。候选地图失败不泄漏条件；地图发布后同一端口改为访问 live owner。重复、过期与战斗借用中的写入拒绝。条件列表属于 owned v6 快照，不添加第二份字段库存或状态存储。

`GameStateContent.initialOwnedConditions` 是来源绑定的开发检查点种子，在 source `AddFromMaster` 创建初始持有人之后应用。它只接受唯一的已有初始 owner 和已准入的条件身份，不创建或启用角色。没有该字段时保留来源初始化；restore 采用保存的实际列表，不重播种子。共同 battle player 初态的投影和 owned 种子是同一检查点的两个消费者，不代表已运行完整前导脚本。

607 的 `damage_number` / `field_se_asset_id` 均为 0，字段编译器明确复核其完整行为后生成 `kind:"none"` 的步伤提供器。带有 607 的普通步行不改 HP/MP，不增加字段时钟。战斗借用从实际持有人条件产生玩家投影；607 战斗装甲与姿态提供器由独立战斗宿主验证。

`battleInventory(lease).qualification` 同时固定本场的装备资格：`members` 只含借用成员，装备占用则来自全部 enabled 持有名册。总持有 count 与已装备 equipped 保持分离，耗材继续使用战斗自己的实时副本；没有装备提供器时省略 qualification，不默认允许道具菜单。

## 检查入口

```sh
npx tsc -p tsconfig.json --outDir build/owned-condition-v22-dist
node --test build/owned-condition-v22-dist/tests/owned-condition.test.js build/owned-condition-v22-dist/tests/owned-condition-integration.test.js
node scripts/check-owned-condition-native.mjs
node scripts/check-owned-condition.mjs --dist build/owned-condition-v22-dist
node scripts/check-field-conditions.mjs --compiled-dir build/owned-condition-v22-dist
```

新增 14 个纯规则/共享事务测试；另外重跑既有 12 个字段状态测试。来源检查按原始脚本逐条编译 210 个调用点，8 个准入点各执行普通与存储无变化两次操作，共 16 次，另验证 8 次保存到战斗投影、8 次普通字段步及 4 个选择器边界。它们使用真实来源角色与规则，但状态前置条件和渲染回调是受控探针；真实 FieldGame / actor host 的集成检查单列。

`check-owned-condition-native.mjs` 重新读取原始 DLL、符号、头文件、元数据、15 个导出方法与 9 个共享原始范围；共享谓词同时绑定正确 delegate 和 getter，避免采用反编译器选择的无关别名。回执写入忽略的 `build/reports/owned-condition-native-check.json`，来源检查写入 `owned-condition-check.json`。不依靠旧报告复制生成通过结果。全部回执保留 `semanticsVerified=false`，不证明原版动态一致性或完整游戏可玩覆盖。
