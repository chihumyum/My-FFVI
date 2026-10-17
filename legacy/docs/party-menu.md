# 通用队伍与能力菜单

这个菜单是 Web 系统框架的增量，复用当前持有名册、四格编队、前后排、角色成长和字段外观提供器。它不是原版菜单布局或剧情编队权限的复刻。当前只允许交换本队中的位置和调整已在队内成员的前后排；备用角色、切换另外两组队伍、加入角色及手动学习能力没有被开放。

`PartyState` 仍是唯一持久编队。`previewPartyMenu` 接收完整的旧编队基线，以及 `swap` 或 `set-row` 操作。交换携带成员当前的前后排；空位置保留独立格子。它不修改其他保存队伍、名册、装备、库存或成员数量。基线过期、重复身份、未知角色、不可编组成员、修改空位排位或额外指令字段都会拒绝。

`GameState.preparePartyMenu` 准备同一持有状态所有者的草稿，保存 revision 并返回 `validate/commit`。`GameSession.changeParty` 只在 `menuReady` 时运行，先经 `FieldGame.prepareMenuPartyAppearance` 准备现有 `FieldPartyActors` 与 renderer 的外观发布，再验证两侧状态，最后同步提交。菜单不会提供替代角色、缺失图片或摄像机能力。媒体失败、外观准备拒绝和过期事务在 owned 发布前终止；现有 renderer 的 commit 仍须遵守已准备、同步且不失败的宿主契约。

实际字段外观拥有者不读取新的 owned revision 作为陈旧判断：它检查自己的演员/外观输入。回归明确在 owned 更新后再调用真实 appearance publication，确认不会因此拒绝，且队长交换和队长移入空位都同步更新玩家身体/骑乘者以及当前 leader index。保存沿用已有 owned/field/session codec，不新增第二份编队或版本。

`projectCharacterMenu` 只读当前 `OwnedCharacter`。等级和经验来自持有状态，下一级门槛来自对应 `CharacterGrowthPlan`；仅明确的合成开发内容可使用现有 development 曲线。追加成长值保留原始未截断值。已拥有能力逐条保留 `SkillLevel`、来源身份和装备提供的重复副本，不从全局 `learnedAbilityIds` 或初始化模板授予技能。SkillLevel 0 仍是持有但未学会的记录，已确认的装备能力则标记为装备赋予。

静态效果计划是否存在只作为说明；实际战斗可选性继续由 `BattleGame.commandQualification/commandMenu/canUse` 根据条件、库存、目标和费用决定。菜单没有施法或学习按钮，未支持或缺失的效果不会变为可执行。字段战斗和成长计算没有因为这个信息面板改变。

`PartyView` 仅保存所选角色和提示文案，每次从当前会话取得模型。按钮携带它显示时的完整编队基线，并在执行前重新核对当前会话、宿主 disabled 状态和 `menuReady`。I/O 期间由 `GameFlow` 驱动的暂停菜单禁用；旧按钮不能修改替换后的会话。普通失败显示简短提示，详细拒绝不会占据玩家操作界面。

验证命令：

```sh
npx tsc --outDir build/v38-party-menu-dist --pretty false
node --test build/v38-party-menu-dist/tests/party-menu.test.js
node scripts/check-party-menu-ui.mjs --dist build/v38-party-menu-dist
```

15 项 TypeScript 回归覆盖当前队内编辑、保存恢复、后排入战、队长/空位外观同步、缺宿主/媒体、过期与准备失败、战斗/事件/移动门禁以及来源学习投影。独立 checker 使用实际视图组件、受控 DOM 和摘要校验后的本地开发内容包，验证 10 个场景；结果位于 `build/reports/party-menu-ui-check.json`。它包含真实开发包的骑乘队长调整、后排与空位保存恢复和受控入战，但不证明浏览器像素、原版动态一致性或剧情已授权备用入队。
