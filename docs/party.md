# 剧情编队与角色身份

当前接续为 v19：持有快照 v6 支持动态来源名册与成长，同图来源演员刷新已在纳尔谢开发上下文接入，完整边界见 [系统集成](systems-v19.md)、[队伍演员](party-actors.md)。跨图初始化、未知媒体及其他表现提供器仍阻塞。下方 v16 的统计与执行范围保留为历史记录，不代表当前全部准入。

2026-10-11。本轮把编队做成独立、可序列化的纯模型，并接入共享 `GameState`、字段指令和地图候选事务。来源中的 `OrganizePartySlot`、`ChangePartySlot` 可以批量编译；当前真实字段执行器仅执行不要求角色外观刷新的切换。要求刷新外观、加入、离队及编队 UI 的来源指令继续明确阻塞，不能用修改数组代替未恢复的行为。

这一步不扩张开场名册，也不创建任何测试装备或新增地图。核心模型不保存 HP、等级、装备或地图精灵；这些值仍由各自唯一所有者管理。

## 状态和身份

`PartyState` 保存当前选中的零基队伍槽和三组独立的四位置列表。每格是 `{id: ownedIdentity | null, row: 'front' | 'back'}`；空位保留原位置和排位。当前队伍由选中槽投影得到，没有第二份可独立变更的成员数组。

| 概念 | 来源含义 | Web 边界 |
| --- | --- | --- |
| `CharacterStatus.Id` | 原始角色参数行 ID | 编译指令中的 `sourceId`，不能当作拥有实例 ID |
| `OwnedCharacterData.Id` | 原生已拥有角色身份；`AddFromMaster` 用已拥有数量加一分配 | v17 单独保存原生数值 `ownedId`；字符串 `id`（当前 `player:<sourceId>`）仍是 Web 稳定身份 |
| `IsEnableCorps` | 已拥有角色的独立可用标志 | 纯模型保留 `enabled`，组织队伍不隐式设置它 |
| `CorpsSlot` | 三个已保存队伍，0/1/2 | 来源脚本使用 1/2/3，编译时转换一次 |
| `Corps.CharacterId` | 一个固定位置引用的 owned 身份，0 表示空 | 使用 `null`；与装备的内容占位记录完全无关 |
| `Corps.Id` | `Front=1`、`Back=2` | 每格保留前/后排；不能误当队伍编号 |

`activePartyMembers` 返回 `{id,index,row}`。它只略去空位置，保留原 `index`，不压缩原快照，不自动过滤 disabled，不挑选其他非空队伍。同一角色可以被多个已保存队伍引用；同一队伍重复引用同一角色在当前运行期明确阻塞。这一重复限制是 Web 对现有战斗/字段能力的准入限制，不是原生 `SetSlot` 的去重规则。

v17 的 `GameState` 已拥有定义仍只有开场三人；现在校验并保存 enabled，只有 enabled 名册登记装备副本。快照 v4 保留原生持有身份、职业历史和已释放职业；离队与重加入由独立生命周期事务处理。新角色完整初始化和真实演员刷新仍阻塞，见 [角色生命周期](roster-lifecycle.md)。本文以下计数属于 v16 编队批次；v17 最新集成结果见 [系统批次](systems-v17.md)。

## 来源指令

| 指令 | 已恢复行为 |
| --- | --- |
| `OrganizePartySlot` | `i0` 指定三组队伍之一，`i1..4` 完整覆写四个位置。正数按 `CharacterStatus.Id` 从全部已拥有角色中查找，含 disabled；不存在则失败。所有非正数都清空，包括源常用的 `-2`，没有“保留原成员”含义。新成员的排位设为 front，清空格保留原排位。编辑未选中队伍不自动选中它。总是请求外观刷新。 |
| `ChangePartySlot` | `i0` 选择队伍，复制该队伍的完整四格。`i1!=0` 请求外观刷新，`i1==0` 不刷新。不存在自动补员、自动选择其他队伍或装备/参数初始化。 |

编译同时保留原脚本身份、指令索引、源指针以及引用的 `character_status.csv` 行。未知角色表引用、歧义引用、非法槽号、非整数和未审查操作数均拒绝。角色参数行存在不代表角色已经拥有；编译依赖检查和运行时所有权检查是两道不同边界。

所有成员预检成功后才形成下一份状态。最后一个引用缺失时，不会先清除或放入前面几个成员。原生逐格写入的中间过程不暴露成 Web 可存档状态。

## 初始化和所有权边界

`CorpsClient.Initialize` 建立三组四格的空队伍，初始排位为 front，选择槽 0。`CreatePlayerCharacters` 查 `INIT_PARTY_1..5` 创建已拥有角色，再按位置读取 `INIT_CORPS_1..4` 投影当前四格。原生创建最多第五个已拥有对象的配置不等于五人编队；当前初始化编译器遇到第五个创建配置会明确拒绝。

本版 `initialize_data.csv` 的前三个来源角色是 1/31/32，第四个配置缺失；四个 `INIT_CORPS` 均为 1。开场结果是槽 0 的前三格依次为这三人，第四格为空，其余两个队伍为空，所有格均 front。`compileInitialPartyState` 只把已创建名册放进这些位置，不创建角色、学习能力或发放装备。它复现初始化使用 `GetOwnedCharactersClone(false)` 的过滤；剧情 `OrganizePartySlot` 明确使用 `true`，两者不能混同。

单纯编队和切换不改变名册、HP/MP、等级、状态、装备六槽或总持有数。以后实现真正加入/离队时，需要分别恢复以下链条，不能复用普通 slot 编辑冒充：

- `UnlockCharacter` 先查全部已拥有对象是否已有相同来源 ID，已存在即返回；新对象才进入 `AddFromMaster`。后者还创建命令/能力、参数、初始装备并恢复 HP/MP。它会添加来源装备持有记录，重复入队不应再次调用完整创建。
- `JoinCharacter` 除解锁和入队，还根据是否已拥有、`AddtionalLevel`、是否已 enabled 决定 `CorrectLevel`、装备登记与重新装备；还可能完全恢复资源、清状态、刷新地图外观。这些提供器未完整恢复，整个 selector 不开放。
- `RemoveMemberFromCorps` 禁用 owned 对象、处理职业可用状态，清除当前队伍的匹配位置；不是删除名册，也不是清除所有已保存队伍。
- `SecedeCharacter` 的参数决定先卸全部装备再离队，或先离队再执行 `RemoveEquippedItem`；随后还处理魔石和外观刷新。装备路径调用 `RemoveEquipmentsItems` 并按 enabled 名册重建登记。当前完整名册占用算法不能直接推广到这里。

## 外观刷新事务

`refreshActors=true` 对应 `IMapAccessor.ChangeAssetPartyCharacter(true)`，不是可省略的提示。它依次更新可操作角色、已有 party puppet、状态变形、跟随者、条件碰撞体，还更新多队地图角色。原生只更新已有 puppet 实例，并不在这个方法中随意新增四个队伍精灵。空位置使用 dummy 素材的分支也必须单独恢复。

队长选择会保留地图存档的 `playableCharacterCorpsId` 位置；仅当该格没有有效成员时从 0 开始寻找。角色素材由 `character_asset.csv` 的来源角色 ID 与当前职业 ID 找到 `field_character_asset_id`，不通过角色名字猜测。坐骑、交通工具缓存、清理/重设精灵、特殊视点偏移、变形和同伴均是独立依赖。开场蒂娜两条对应素材行指向同一 field ID；士兵多条行虽然媒体名相同，field ID 存在 31/32 差异，不能只因名字相同就忽略来源身份。

字段端口采用两阶段流程：

1. `GameState.fieldParty.prepare(command)` 计算私有 owned-state 草稿，返回待提交的 activeMembers 和 refresh 请求。
2. 请求刷新时，`executePartyEvent` 必须调用宿主提供的 `preparePresentation`。缺失能力或媒体准备失败直接抛错，owned state 不变。
3. 准备成功后先发布 owned transaction，再调用已经完成验证、同步且不可失败的 presentation publication。旧的 owned transaction 被拒绝时，不发布精灵。

当前实际 `FieldGame` 没有完整的队伍刷新上下文，因此不传 `preparePresentation`，所有 true 路径都明确阻塞。测试里的回调只验证提交顺序、资源准备失败和隔离，不能作为外观刷新已完成的证据。不刷新路径不会私自修改玩家精灵，这是源 `i1==0` 的语义。

地图候选加载由 root 集成的共享草稿同时准备库存和编队；候选成功后发布同一份 `GameState`，失败丢弃两者，不能让库存和编队端口各自恢复过期快照。快照版本 3 保存完整队伍槽与 roster enabled 字段；后排和空当前队伍在战斗入口由尚不具备的能力明确拒绝，数据本身不丢失。

## 代码契约

```ts
emptyPartyState(): PartyState
validatePartyState(state, roster): void
activePartyMembers(state): { id, index, row }[]
previewPartyCommand(state, roster, command): { state, activeMembers, refreshActors }
executePartyEvent(op, partyPort, preparePresentation?): void
compilePartyEvent(mnemonic, values, tables): PartyEventOp
compileInitialPartyState(tables, roster): { state, dependencies }
```

纯模型不引用地图、renderer、battle 或 `GameState`。编译器只解析来源，宿主负责支持范围和事务发布。相关实现为 `src/core/party.ts`、`src/compiler/party.ts`；集成由现有共享状态/字段编译执行链拥有。

## 静态来源与验收

所有原生证据来自同一版 DLL，未运行原始游戏。36 个导出方法和 12 个原始机器码范围重新核验了 DLL、符号、结构头、输出文本和文件范围摘要；导出器 `semanticsVerified=false` 保持不变。人工语义阅读与摘要一致不等于动态原版对照。

| 定位 | 依据 |
| --- | --- |
| `2bedb0` / `2bebf0` | 两个剧情指令的操作数、include-disabled 查询和刷新调用 |
| `aaa910` / `aa9e80` / `aabdf0` | 指定槽放入/清空/切换；clear 保留 row；当前与已保存队伍同步 |
| `aa9840` / `aad1c0` | 队伍容器初始化及初始 owned 创建、位置投影 |
| `aba7d0..aba950` / `abb040` | 原始机器码及符号字符串：`INIT_PARTY_1..5` 与 `INIT_CORPS_` 选择器 |
| `328110` / `b47c50` | 新 owned 身份、初始 enabled、装备注册、重复解锁路径 |
| `871840` / `52ffe0` | `GetOwnedCharactersClone` 的 include-disabled 分支与标志读取 |
| `870230` / `4a4310` | `GetMemberData` 直接匹配 owned ID，不过滤 enabled |
| `b47290` / `b478e0` / `3326d0` / `27d1b0` / `294260` | 加入、禁用与完整加入/离队边界；保持未准入 |
| `294140` / `294c30` | Biggs/Wedge 离队包装分别调用来源 ID 32/31、移除装备参数 true；不按名称猜 ID |
| `2d29b0` / `2d2810` / `2d2470` / `2d2f00` / `2d2d40` / `2d30f0` | 完整刷新入口及五条直接路径 |
| `2db200` / `2da760` / `2ee420` | 队长位置、角色/职业到素材映射、视点偏移提供器 |

```sh
npm run build
node --test dist/tests/party*.test.js
node scripts/check-party-native.mjs
node scripts/check-party.mjs
```

22 项单测覆盖 ID 分离、固定空位、前后排、disabled 的两种查询、未选中槽编辑、未知末位原子失败、非法快照、重复身份、来源操作数准入以及 presentation 事务。`check-party.mjs` 读取完整来源语料和本轮实际内容编译结果，另行检验开场编队、真实 `GameState`、字段执行器、库存/角色保持及 JSON/字段检查点恢复。

来源验证分开报告：196 个指令解码（92 组织、104 切换），392 个独立纯模型投影，45 个无刷新的实际字段宿主执行，151 个要求刷新的实际字段宿主阻塞。后者再分为 70 个可通过受控回调完成的事务和 81 个涉及未拥有角色的阻塞，二者不能混进宿主通过数；122 个来源加入/离队 selector 实例保持 blocked。具体回执位于本地忽略产物 `build/reports/party-native-check.json` 和 `build/reports/party-check.json`。

## v18 状态外观研究接续（未实现）

本地 `build/native/v18-condition-appearance/complete.json` 的八个方法导出补齐了一部分外观选择证据，没有开放刷新端口。`Search(0x9e30a0)` 不使用 currentStructure，匹配不到返回 null；调用方此前已设普通角色素材，因此不能把 null 当作清空或异常。

`serial_misc_assets.change_character_condition_list` 的 condition type 665/666/677 分别查 resident character 202/203/205，再投影 field asset 43/44/46；条件行 ID 79/80/101 与 type 身份必须区分。`SetConditionData` 只登记已定义枚举且 resident 字典中确有该角色的项。特殊偏移的真实字段为 `character_viewpoint_offset_list`：已读 40 项，field asset 1–32 为 (0,16)、34 为 (0,48)，找不到时为来源 (0,0)，随后仍要处理地图范围修正。

当前数据没有 `affected_condition_companion_list` 不能证明运行时没有跟随者；FF6 `ContainsBird(0x40a900)` 只判断 transportationId==3，不能换成场上是否有鸟演员。完整刷新还依赖当前 resident、跟随、多队伍、队长源位置与交通缓存。未提供上下文时保持未知，禁止默认空列表或 false。本段为静态研究定位，后续实现仍需可重跑来源检查和实际宿主/浏览器验收。
