# 来源新游戏的共享状态保存

v31 将 `NewGamePlan.nativeInitialization` 与载图前的完整入口种子纳入 `GameState`，同时提供供来源演员系统读取的完整名册端口。此处交付的是共享所有者、候选事务和 codec；正式 fresh 会话、原生演员装配和浏览器入口由集成线单独验收。没有运行原版，也没有把静态初始化正确性当作完整序章可玩性。

## 单一所有者

`owned-game-state` 升至版本 8，必需保存两个字段：

- `initialization` 为 `development-checkpoint` 或 `source-new-game`，它记录创建身份，不代表当前地图或进度。
- `nativeState` 在开发检查点中为 `null`；source fresh 必须含 `SourceNativeState`。两个字段不匹配、缺字段及旧版 owned v7 均拒绝，不自动补零或迁移。

`SourceNativeState` 位于 `src/core/source-native-state.ts`，结构为 `kind: source-native-state-v1`、`entrySeed` 和原计划 `nativeInitialization` 的所有字段。交通持有 ID 及停靠地图、四个 crystal flags、仓库、关键字、全局魔法与魔石、七个计数器均由这一共享快照保留。本版真实初始化有 8 个交通持有，停靠地图均为 -1；其他集合为空、flags 为 false、计数器为零。

`entrySeed` 保留原始的 map、entrance、预约脚本、viewType、交通身份、保存位置种子、moveCount、subtractSteps、400 个 beast exchange flags、beast seek group 及 `entrySynchronized=false`。它明确是 `after-data-create-before-field-load` 的不可变种子，不是当前地图状态。FieldGame / WorldSession 继续独占实时位置、交通选择和地图同步；source 初值的 layer 10 和 direction 4 不能直接当作 Web 逻辑层或当前朝向。

交通是否开放仍读取 EventState 的 TreasureFlag。`ownedTransportationIds` 不等于全部已开放，不能把列表存在当作 release=true。字段入口可以用共享 owner 的 `parkedTransportationMapIds` 和独立事件旗标调用现有 `Transportations.projectMapEntry`，不再依赖一个被丢弃的临时计划。

## 初始化、保存与边界

`GameState.createNewGame` 先验证内容绑定的 `sourceNewGame` 与角色、装备、初始 Count、物品、Gil、队伍及参数上下文，再一次创建 roster / inventory / nativeState。普通构造器仍建立开发检查点并保留 `nativeState=null`。

`GameState.initialization` 返回来源身份，`GameState.nativeState` 返回深拷贝。修改读取结果、输入计划或另一个会话不会改变当前 owner。`prepareFieldState` 的同一草稿携带这些字段，库存、角色、编队或条件提交不会遗漏它们；过期候选仍不能覆盖当前状态。

恢复按存档中的初始化身份检查完整内容绑定，允许在独立开发候选中重建 source save。它只验证来源基线，不把基线发放、条件或 Count 覆盖回存档。开发存档也不会因内容包含 `sourceNewGame` 就获得这些已知源初值。

本 schema 尚无停车位置、计数器、crystal、仓库、关键字、全局魔法及魔石的后续写入提供器。它们保留已证明的初始化值；改变这些值的存档明确拒绝，不能把任意合法整数当作已实现的进度。Web 时间、战斗 receipt、角色技能、行走步点分别不被擅自换算成这些原生字段。后续系统接入时必须恢复对应写入链，再扩展状态与 codec，不能从此文推断这些增长规则已经迁移。

这一区分也意味着 `entrySeed` 不能用于重新初始化已恢复字段：跨图和读档必须读取各自当前的 FieldGame / WorldSession owner。

## 完整来源演员名册

`src/core/field-puppet-roster.ts` 导出以下端口：

```ts
type FieldPuppetRosterRead = {
  owned: {
    ownedId: number;
    sourceId: number;
    enabled: boolean;
    conditionTypes: number[];
  }[];
  party: [number, number, number, number];
};
type FieldPuppetRosterPort = { current(): FieldPuppetRosterRead };
```

当前读取为 `GameState.fieldPuppetRoster.current()`，切图候选读取为 `prepareFieldState().ports.puppetRoster.current()`。后者在发布前只读取草稿，发布后转向当前共享 owner；不保存另一份名单。调用方把它与真实演员实例、相机、居民、companion、交通及回调上下文组合，不能从这个端口捏造那些缺失的宿主能力。

`owned` 按共享名册顺序保留全部持有人，包括 disabled 和当前队外成员；不按 activeParty 过滤。`party` 精确保留当前 `selectedSlot` 的四格，用 ownedId 代替 Web 字符串 ID，空格为 0；不压紧空位、不按 enabled 删除成员。

每个保存的 condition ID 通过完整 `ownedConditionDefinitions` 逐项映射成来源 type。该目录有 100 行，包括 row110/type0 的 None 定义；未使用的目录项不需要活动行为。读取不得将 ID 直接当作 type，也不得只用已准入的行为列表。缺行、重复行身份、重复 ownedId 或错误格子引用都在返回前拒绝；活动状态是否可执行仍由原有 GameState / BattleConditions 校验决定。

这些身份直接服务既有 `fieldPuppetResidentIndex`：按来源居民定义找最新 enabled 的同 CharacterStatus owner，再查当前 Corps；不能从当前队伍图片、名称或源 ID 推测实例身份。

## 来源与验收

初始化来源继续复用 [新游戏初始化](new-game.md) 的 `UserDataManager.Initialize`、`CreateMapData`、`CreateTransportationData` 和 `OwnedTransportationData` 构造链。完整名册读取使用 [puppet 演员](field-puppet-actors.md) 已恢复的 `GetOwnedCharactersClone 0x871840`、`GetResidentPartyEntityId 0x2db630`、owned/source ID getters 与 Corps cell getter。没有新增 Ghidra 导出，也没有将旧报告当作本次重验。

```sh
npx tsc --outDir build/v31-owned-dist
node --test build/v31-owned-dist/tests/field-puppet-roster.test.js build/v31-owned-dist/tests/source-native-state.test.js
node scripts/check-source-native-state.mjs --compiled-dir build/v31-owned-dist
```

- 13 项专用 TypeScript 测试涵盖完整/disabled/队外名册、四格空位、ID→type、对象隔离、候选发布前后、过期草稿、origin 配对、严格 schema、所有初始化域和不重放 Count。
- 与既有 GameState、名册、装备、新游戏、checkpoint 和 world/session 存取测试一起运行，共 105 项通过；旧 owned v7 断言已改为 v8，专门拒绝 v7 的负例保留。日志为 ignored `build/reports/v31-owned-save-regression.log`。
- 来源 checker 重新编译实际新游戏定义并绑定已发布目录，执行 11 个受控检查；核对 3 个 owner、100 条条件定义、8 个交通持有和 400 个 beast 标记，拒绝 23 组非法或未准入 native 写入。
- 同一 checker 重新执行 `check-new-game-native.mjs`（24 方法、26 个原始区间）和 `check-field-puppet-actors-native.mjs`（24 方法、14 个原始区间）。两组有复用依赖，不能相加宣称新增覆盖。
- 报告为 ignored `build/reports/source-native-state-check.json`，包含实际构建 hash、实现摘要、独立 native 报告 hash 与 `semanticsVerified=false`。来源角色/编队变更探针只直接发布共享状态，不宣称来源演员刷新已执行或新游戏会话已发布。
