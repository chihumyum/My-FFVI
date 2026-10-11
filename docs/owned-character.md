# 来源角色初始化

`src/compiler/owned-character.ts` 和 `src/core/owned-character.ts` 实现本版本普通新持有角色的初始化提供器。它们生成独立候选，保留命令、拥有能力、学习值、命令能力映射、职业、来源基础值和装备参数上下文；全局习得记录与名称标签作为待提交结果返回。正式游戏目前只把这个提供器接到开场三人的持久能力状态。新角色的故事加入、成长、可执行技能和演员表现仍需各自的完整提供器。

## 操作顺序和不同身份

`OwnedCharacterClient.AddFromMaster`（`328110`）先构造持有数据，再设来源角色、命令和能力。持有编号由完整名册数量加一产生，不能复用 `character_status.id`。生命周期宿主传入稳定 Web ID 和持有编号；初始化器不自行发布名册、编队或库存。

| 初始化内容 | 此版本规则 |
| --- | --- |
| 基础资源 | `SetCharacterStatus` / `SetBaseParameter` 先把当前 HP/MP 设为尚未装备时的确认上限；装备完成后重算最终上限，不自动补满其新增部分 |
| 等级 | 从当前角色与职业的 `intermediate_growth_curve` 选经验组，`exp_table.type_id=1` 且 `total_exp <= CurrentExp` 的最大等级写入 `additionalLevel`；不拿基础 `lv` 替代 |
| 六个角色命令槽 | 按 `command_id1..6` 顺序保留有效身份。通用 `command_type=2/5/6` 随后追加；FF6 不启用历史魔法分支，存在 `sub_command` 时只有 type 1/2 追加 |
| 拥有能力 | 按 `ability_random_group` 行顺序建立 `{abilityId, contentId, skillLevel:0}`，不使用该表的调用概率进行抽选。无 Content 时原生保存 0；需要授予学习值的能力必须有 Content |
| 初始已学能力 | FF6 提供器 `84f8a0` 内的角色列表按顺序查找已有能力并设为 100；不存在的配置项跳过，不新建能力 |
| 能力取得顺序 | `additionOrder` 是 Content ID；按初始授予配置顺序追加且去重。`sortOrder` 初始为空 |
| 全局习得历史 | 所有初始拥有能力都参与，包括学习值 0；按源拥有顺序，仅追加全局记录未含有的 Ability ID。它不是“已学会列表” |
| 命令可用能力 | 按命令的 group 找 `ability_group`，其 `type_id` 引用 `chanting`，再以 `chanting.ability_type_id` 匹配能力的 `type_id`。FF6 只保留学习值至少 100，再排除能力 `ability_group_id=0` |
| 职业 | 本职先记录为等级 1 / 熟练度 0，再按全局已发布职业顺序补齐；保留不重复身份 |
| 空能力槽 | 原生构造器建立 8 个等级，每级 3 个 null 槽；不是未知能力，也不是装备的来源空位 |
| 其他初始能力容器 | FF6 没有 SkillLevelTarget 类别，构造器的 learning 为空。本版五个职业替换列均为 0，`AddJobCommand` 最后实际写入 equipment 列表 `[0,0,0]` 哨兵，不可擅自改成空数组 |
| 名称 | `character_status.mes_id_name` 仅提供本地化初始名字。`UpdateNameTag` 另外按 `character_default_name.character_id` 找 `tag_name`；没有该行时无绑定。开场只有 `TINA` 标签；31/32 不创建标签 |

初始拥有能力的集合和顺序不会被 FF6 初始学习提供器更改。当前准入分支也没有装备添加能力和职业命令替换，所以 `learnedAbilityIdsToAppend` 可直接按最终 `abilities.owned` 顺序计算。以后开放会改能力集合的提供器时，必须重新审查历史的记录时点。

## 接口和事务

```ts
compileOwnedCharacterInitialization(reader, tables, sourceId, name)
  -> { template, sources }

createOwnedCharacter(template, {
  id, ownedId, releasedJobIds, learnedAbilityIds
}) -> {
  member,
  learnedAbilityIdsToAppend,
  nameBinding: { key, value } | null
}
```

模板包含 `initial`、独立 `nameKey/nameTag`、`parameterContext`、参数上限、装备资格、确认参数、基础等级/智力/精神/幸运/八级 MP 次数和职业全集。`initial` 包含 HP/MP、等级/经验、六槽装备、状态和完整的当前能力容器。它没有虚构战斗动画、成长结果或可执行技能。

生命周期 `prepareRosterLifecycle` 是初装库存的唯一记账方：每个非空槽增加一份总持有数。初始化器不操作库存，避免角色创建与加入分别发放一遍。调用者必须在同一候选事务里合并名册、库存、全局能力历史和名称标签；后续成长、装备投影、演员准备或存档校验失败时整体不发布。

`validateOwnedCharacterAbilities` 拒绝悬空能力身份、未学会却进入可用命令的引用、非法顺序 Content 和缺失来源槽位。当前 GameState v5 还要求能力容器和全局历史与其来源初始模板一致；尚未迁移的技能学习不能从存档注入。战斗动作仍由现有独立开发 profile 准入，持有 63 个能力不等于可执行 63 个技能。

## 准入边界

当前普通初始化要求：来源初始状态为 0、基础 HP 大于 0、经验曲线唯一、初装通过既有装备模型、没有初始参数被动能力、没有双持/双手能力或全职业装备覆盖、当前职业五个替换命令列为 0。条件 601、临时值、成长追加与 Correction 的零值来自此构造阶段及明确排除的效果，并非把开场检查点假设复制给任意现有角色。

被动参数相关身份 244/245/256–259/286–289、双持 Ability.TypeId 12、双手 Ability ID 251、全职业装备 Content ID 317 均有来源守卫。本轮不实现这些效果。初始带状态的 source 4/14/33、效果装备、当前通用装备资格不接受的临时角色负载、缺少经验曲线的记录保持明确阻塞；不把阻塞变成忽略字段。基础智力、精神、幸运和 MP 次数保留为来源事实，当前战斗没有消费的字段不宣称已经实现其系统。

`CorrectLevel`、完整升级/学习、剧情解锁的角色战斗定义与媒体、外观刷新依然是独立缺口。普通 `Unlock` 已能在受控生命周期状态中验证新拥有实例和库存守恒，但不会向正式开场名册授予洛克，也不说明新的故事片段已可玩。

## 证据与检查

原生依据：`328110` 入口；`52de50/537ca0/4ac740/52aa10` 构造器；`52c020/52b7b0/52d220` 参数阶段；`52af50/84f5b0/84f8a0` 能力与初始学习；`3d4270/5e9cd0/5fa8e0/5faa10/74bc10/754770` 命令过滤；`329c20/331b90/32b8a0` 职业命令；`337c10/6d1110/863860/8631d0` FF6 提供器边界；`338890/8067c0/4a5d70` 名称标签。Ghidra 的共享泛型函数名称不能单独证明所读表，检查另外核对 `GetList<AbilityGroup>`、`GetData<Chanting>` 和 `GetList<CharacterDefaultName>` 元数据绑定。

```sh
npm run build
node --test dist/tests/owned-character.test.js
node scripts/check-owned-character-native.mjs
node scripts/check-owned-character.mjs
```

来源检查同时对照最终 catalog、GameState 和 JSON 恢复；覆盖开场 63/4/4 个拥有能力、63 个去重历史身份、名称标签、资源/等级/经验/参数一致性、10 种非法存档拒绝，以及受控洛克 Unlock 的单次装备登记与发布失败回滚。34 条源角色记录中当前有 18 条普通初始化可编译，16 条显式阻塞；这是初始化能力调查，不是可玩角色或地图覆盖率。

原生检查核验 39 个完整方法、18 段原始范围和 16 组初始能力绑定。9 个合成语义测试覆盖顺序与身份区别、未学会历史、资源时点、缺失/重复依赖、名称标签缺行、明确阻塞和候选不变性。本地回执为 `build/reports/owned-character-native-check.json`、`build/reports/owned-character-check.json`。`semanticsVerified=false` 和原版运行对照缺失仍明确保留。
