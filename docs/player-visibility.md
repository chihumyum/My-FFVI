# 玩家显隐

本模块恢复本版 `HidePlayer` / `ShowPlayer` 的目标与即时效果，并让字段宿主复用唯一的 `hiddenEntities` 所有者。它不把脚本 actor `-1001`、队伍第一格或 puppet 0 当作真实玩家。原版未执行；以下为绑定本地 DLL、元数据和脚本的静态证据及受控测试。

## 来源链

| 方法 / 绑定 | 已核实的作用 |
| --- | --- |
| `External.Entity.HidePlayer` `0xb48ac0` | 不读取 MainCore 的 actor 或 operands；取 Integrator `entityAccessor +0x90`，调用 `IEntityAccessor` slot 7，然后调用返回实体的虚表 slot 23 `Hide(0)`；返回 `Core.Next` |
| `External.Entity.ShowPlayer` `0xb490b0` | 同一个 accessor 和 slot 7；虚表 slot 22 `Show(0)`；返回 `Core.Next` |
| `FieldController.GetPlayerEntity` `0x2db610` | 原字节读取 `[this+0xa0]`；准确 receiver 的字段是 `FieldPlayer player`。该 RVA 有 41 个 getter 别名，检查不选用首个符号。slot 8 `GetPlayerPuppetEntity` 是另一接口方法 |
| `FieldSpriteEntity.Hide` `0xaeb020` | `duration=0` 设置 alpha 0、fade status None、`gameObject.SetActive(false)`，更新淡化 renderer，再对非空 `ChildEntityObject` 调用 `Hide(0)` |
| `FieldSpriteEntity.Show` `0xaec870` | `duration=0` 设置 alpha 1、fade status None、更新 renderer、`SetActive(true)`，再对非空 child 调用 `Show(0)` |
| `FieldEntity.Hide/Show` `0xe0dee0/0xe0fe40` | 同一即时状态与 child 转发规则；非零时长是不同的淡化分支，本模块不准入 |
| `FieldCharaEntity.UpdateFadeRenderer` `0x87b180` | 相同 alpha 传给身体、头部和 `rideOnEntity`；魔导人物与装甲共同显隐 |
| `Player.Init → Chara.Init → Entity.Init` `0xe194c0 → 0x879870 → 0xe0dfd0` | 设置位置、层、朝向、移动等入口状态，不调用 Show/Hide、不改 fade alpha/status；普通地图入口沿用玩家显隐 |

`FieldPlayer` 与 `FieldCharaEntity` 没有覆盖 Show/Hide，因此玩家执行的是上面的 Sprite 实现。显隐不修改逻辑坐标、朝向、队伍组成、装备、移动目标或碰撞配置。原生操作的是 GameObject 激活状态，宿主应共同处理其绘制与实体激活；不能只隐藏人物贴图而继续显示坐骑。当前模块不额外发出停止移动、禁止操作或修改全局碰撞的指令。

Show 的语义是激活，而不是还原 Hide 之前记录的可见值。重复 Hide、重复 Show 都有效；没有隐式栈、引用计数或延时自动恢复。即时操作把正在执行的 fade status 覆盖为 None，但不调用原生非零 fade 完成回调。脚本切换本身也不是本模块清除显隐的触发器。

## 状态与宿主接口

```ts
compilePlayerVisibilityInstruction(raw): PlayerVisibilityOp
projectPlayerVisibility(command, binding, hiddenEntities): PlayerVisibilityPlan
```

`binding` 必须传入实际字段玩家实例 `playerId`。若安装了 party appearance 宿主，`partyPlayerId` 必须是它当前 `context.player.id`，且必须与字段玩家相同；没有该宿主时显式传 `null`。该 null 不表示没有真实玩家。

`childEntityObject` 目前只准入有证据的 `"absent"`；`"unresolved"` 在任何发布之前拒绝。ChildEntityObject 是 `FieldEntity +0x100` 的接口引用，与 `FieldCharaEntity +0x198` 的骑乘 renderer 不同。继承树、预制件缺少某个 JSON 字段，或者发现 shared setter 没有直接调用，都不能单独证明实际玩家的 child 为空。具有独立 child 的宿主必须先恢复完整传播，再扩大准入。

投影返回新的 `Set`、目标 identity、可见值、alpha、fade status 0 和 `flow:"next"`，不写输入。字段层先完成身份、子对象和表现能力验证，再把候选 Set 发布到已有 `hiddenEntities`。alpha 等是此次操作的效果描述，不建立第二份持久显隐状态。存档和换图仍从现有字段 owner 读取玩家可见性；地图创建不应默认将先前隐藏的同一玩家显示。

`FieldGameOptions.playerVisibility` 是不可变宿主能力，只含 `childEntityObject`。构造时验证并复制枚举，外部修改原 options 不会改变准入；缺省为 unresolved。每次操作读取 `this.player.id` 与当前 party checkpoint 的真实 player identity，全部准备成功后修改原来的同一个 hidden Set。任务 actor 不参与目标选择，包括已有 puppet task 的受控调用。该能力不写存档，恢复保存的隐藏状态也不会获得 child absence；后续显隐仍需宿主重新提供证明。

原生 child 的工厂来源尚未形成通用入口能力，正式来源入口应保留 `unresolved` gate，不能为推进前导而宣称 absent。受控测试中的 absent 是显式夹具条件。独立模块和 decoder 完成不等于完整开场流程已经通过。

## 解码与验收

全语料恰有 112 个来源位置：107 个 HidePlayer、5 个 ShowPlayer。当前观察到的类型均为 1，整数、实数、字符串三组 operands 各 8 项，全为 0 / 空字符串。编译器只准入该完整形状，不给额外字段发明目标、时长或范围；未知输入仍阻塞。

命令：

```sh
npx tsc --outDir build/v28-visibility-dist
node --test build/v28-visibility-dist/tests/player-visibility.test.js
node --test build/v28-visibility-dist/tests/player-visibility-field.test.js
node scripts/check-player-visibility-native.mjs
node scripts/check-player-visibility.mjs --compiled-dir build/v28-visibility-dist
```

- 8 项语义测试：真实玩家与 puppet 区分、重复显隐、Show 的激活规则、实例失配、child 未知、候选所有权、地图宿主传递、严格解码。
- 7 项 FieldGame 集成测试：缺能力/未知拒绝、即时骑乘显隐、puppet 调用目标、party 实例失配、隐藏状态读档与能力分离、宿主能力不可变、防止存档注入。
- native checker 验证 10 个已导出方法、9 个原始机器码绑定、继承/接口/字段身份及完整字节摘要；保留 `semanticsVerified:false`。
- source checker 校验 112 个真实来源指令与共用 decoder 的一致性，在显式受控 owner 上运行 224 次双初态纯投影和 224 次真实 FieldGame 执行/存档恢复；另检查 4 个纯依赖拒绝、4 个字段宿主拒绝及真实 Hide→保存→恢复→Show 链。来源文件、SHA、十进制字符串 object ID、JSON pointer 均保留到 ignored 报告。受控字段没有冒充完整前导或浏览器渲染。
- 报告位于 `build/reports/player-visibility-{native-,}check.json`。这些不是可玩地图数量，也不证明脚本可达性、浏览器效果、完整前导或原版动态一致性。
