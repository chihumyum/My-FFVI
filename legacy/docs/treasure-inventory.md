# 宝箱库存查询与字段指令

2026-10-12，v20 系统批次。库存读操作从当前来源中真实存在的宝箱容量检查接入，没有发明通用 `GetItemCount` 字段指令。`GameState` 仍是库存唯一所有者；宝箱纯模块读取候选库存、返回有顺序的效果计划，字段 VM 只执行已闭合的无消息指令路径。

当前来源有 320 个 `PropertyTresureBox` 实例，25 处显式 `TreasureBox` 指令。其中 22 处 `message=false` 已编译为可执行操作，3 处消息指令保持停止。**这 22 处恰好全是零数量奖励：17 处 Gil 0、5 处重要物品 content 47 数量 0。** 它们不能计作 22 个完整可领取的剧情宝箱。通用正数量、封顶、重复调用和事务回滚由受控测试覆盖；普通调查开箱及消息演出仍阻塞。

## 实際来源入口

`External.Item.TreasureBox 0xb4cf20` 从 `iValues[0]` 找到原生实体；`iValues[1]` 没有被读取。调用 `EventOpenTresureBox(entity, after=true, message=iValues[2]!=1)`，之后等待该任务结束。编译器要求真实八项整数/实数/字符串数组、正实体 ID，以及其余未恢复参数为空。消息路径保留来源 site 和具体阻塞原因。

奖励来自地图实体属性 `content_id/content_num/flag_id/script_id`，不是 `treasure_box.csv`；后者是另一个完成度记录表，不能代替实体属性。来源共有 30 个 `entity_id=0` 的匿名实例，编译时保留该值；Web 的唯一实体键不会伪装成原生 ID。显式指令不准入匿名 ID。

`EventActionTreasure.CheckItemCountOver 0x7adba0` 的规则为：

| 输入 | 来源查询 |
| --- | --- |
| 内容类型 5，Gil | `ownedGil + contentNum > MAX_GIL` |
| 其他类型 | 在 **NormalOwnedItemList** 克隆中找相同 ContentId；找不到返回 false，找到则比较 `Count + contentNum > MAX_ITEM` |

`GetOwnedItemsClone 0x8719b0` 读取用户数据 `+0x28` 的普通列表；重要物品列表是 `+0x38`，没有合入这条查询。`OwnedItemData.Count` 是总数，包含已穿戴副本；宝箱不读取单独的 `EquipCount`，因此也不会根据 enabled 穿戴占用扣减数量。普通物品、重要物品、武器、防具及 Gil 的奖励身份复用已有库存编译规则；魔石和未知类型仍拒绝。

容量检查只决定消息，**超限仍调用 AddOwnedItem**。授予由共享所有者按来源上限封顶，当前常量为 `MAX_ITEM=99`、`MAX_GIL=9999999`。零数量也保留为授予操作：非 Gil 可创建或合并数量为零的记录，不能直接跳过。Gil 的 `totalGil` 继续按请求收入累计。

原生删除可移除耗尽记录，本工程持有状态保留规范化零记录；在奖励数量大于 99 时，缺记录和零记录会令这条容量查询产生差异。因此源编译与字段运行都拒绝非 Gil 奖励大于 `MAX_ITEM`，没有把当前样本只有 0/1 当作通用正确性的证明。纯查询保留两种输入区别用于来源回归；整数溢出仍明确阻塞，不模拟未准入的溢出结果。

## 任务顺序及声音归属

`EventActionTreasure.EventOpenTresureBox.MoveNext 0x7b46f0` 的顺序是：

1. 当 **EventAction.SoundId > 0 且宝箱标记未开** 时，准备并播放音效。可以等待资源加载，不等待播放结束。
2. 调用宝箱 `Open`；按来源 `pick_up` 隐藏该宝箱对象。
3. 查找已登记实体中首个 `ObjectId==link_object_id` 的 tile animation region，开始动画。没有匹配时允许继续；不等待动画结束。ID 0 没有特殊跳过规则。
4. `message=true` 且标记已开时执行空箱消息并结束，无授予和标记写入。
5. `after=false` 且 `script_id>0` 时运行属性脚本并结束，无直接奖励和标记写入。
6. 查询是否超限，然后无条件授予完整请求数量。
7. 若启用消息，先设置名称/数量替换值，运行奖励消息和可选超限消息，等待消息任务完成。
8. 写入宝箱标记 1，再让出一帧后完成。

显式指令的 `EventProcedure.EventOpenTresureBox 0x2cc2b0` 创建新 `EventActionTreasure`；构造器与 `CreateTask` 没有将实体的 `se_id` 复制到 `SoundId`，其值为新对象初始 0。因此显式指令不会借用宝箱属性音效。普通交互属于另一调用方，本批不把其声音生命周期推定为相同。

`message=false` 不执行已经开箱的条件分支，重复显式调用仍会授予并写标记。字段不能用“已开”自行去重奖励；存档恢复不重放已完成任务，才是避免重复授予的边界。

消息静态依赖已保留，但尚未开放运行：构造器按 `message_conclusion.csv.key_name` 读取 `NO_TREASURE_BOX_CONTENT` 和 `MAX_POSSESSION_TREASURE_BOX_CONTENT`；物品名称来自内容行的名称 key，替换 token 为 `ITEM_N`，Gil 为 `NUM`，显示原请求数量而非封顶后增量。普通 `after=false` 奖励消息切换场景 Message→Player；空箱消息即使 `after=true` 也这样切换。原始文案只在 ignored 来源产物中，不写入工具或合成 fixture。

## 初始化、碰撞与保存

`FieldController.EntitiesSetup 0x2d87a0` 读取每个宝箱的 TreasureFlag。标记为真则 `Open`，再对首个关联动画区域调用 `ForceUpdateAnimationLastFrame`。源标记地址映射为四个 TreasureFlag bank，每 bank 256 个格子。未知值不能当作 false；字段构造和动态组加入先要求已知标记，再发布对象状态。

`FieldTresureBox.Init 0xaedc50` 把 `isHiddenItem` 设为 `!property.collision`，然后调用 `FieldMapObjectDefault.Init 0xe13960`。`Open 0xaedd60` 设置 `isOpen=true`，**不会直接修改标记或碰撞器**。`pick_up=true` 经基类 `Hide(0)` 停用该对象，因此移除其可见性和碰撞；关联 tile 区域是独立实体，不一并隐藏。非拾取宝箱保持来源碰撞。

`get_CanAction 0xaedf10` 对普通宝箱一直返回 true；隐藏物品只在 `isOpen=false` 时可操作。因此运行中的 isOpen 和剧情标记不是同一状态：后续直接改标记不会自动重置 isOpen。字段检查点 v4 保存 `openedTreasures`，同时保存既有 hiddenEntities 和 tile state，恢复不会再次授予库存。来源 `ResetFlag` 与图标变化仍是独立能力，不能把任意标记写入当成该调用。

实体编译只放行已恢复的 assetless、16px 单格对齐 map-object 几何；320 个当前实例均满足该子集。碰撞、动作方向和交通工具资格来自属性与现有共用 PropertyTalk 规则；不默认步行或空资格。普通宝箱交互编译为实体内部明确的 blocked action，使显式脚本仍可定位它，同时不会把普通调查误判为可玩。未恢复几何、sprite、激活条件或奖励依赖仍阻塞整个实体组。

## 模块与宿主契约

`src/compiler/treasure-inventory.ts` 提供完整来源身份版 `compileTreasureInventory`、嵌入实体编译的 `compileTreasureInventoryDefinition`、常量依赖编译及指令解码。实体来源保留 bundle、asset、十进制字符串 path ID 和对象 pointer；内容包继续绑定来源集合及文件摘要。

`src/core/treasure-inventory.ts` 的 `planTreasureInventory` 不修改输入。输入是来源定义、调用方 after/message/actionSoundId、已知或未知宝箱标记、当前候选普通库存/Gil 及来源上限；输出按顺序列出 open、tile animation、grant、消息、flag、yield 等效果。一个纯 plan 不代表该分支宿主已经实现。

实际字段只准入 `after=true,message=false,actionSoundId=0`。`FieldTreasurePort` 读取当前草稿，提供 `prepare(command)`；准备完成前校验实体唯一性、标记地址、关联区域及来源上限，提交时拒绝陈旧或重复事务。奖励、开箱状态、动画起播和标记作为同一无异步间隔的字段步骤发布。地图候选端口先修改私有草稿，成功发布才转向当前所有者。无端口、消息/普通交互路径、未绑定动画以及库存准备失败都不能留下部分领取状态。

## 通用数量查询调查结论

已核对 DataStorage.Category 的 14 个枚举值、全语料实际 Calc/Branch 类别以及 512 种完整 SysCall 字符串形式，没有建立通用物品/Gil 数量查询的真实字段入口。`ItemFilters.GetItemCount 0xab5a40` 通过 ItemId 过滤后调用 `Enumerable.Count`，返回匹配记录数，并非持有数量和；`OwnedItemClient.HasItem 0x7fa580` 检查普通列表中 ContentId 相同且 Count>0。它们的名字不能构造一个不存在于观察样本的 VM 指令。

这是限定范围的静态阴性结果，不证明全游戏不存在其他查询。后续队列应从可定位的真实脚本/系统调用入口继续追踪，或推进已发现的宝箱普通交互和消息任务；不再把“实现一个通用数量指令”列为没有入口依据的工作。

## 验证与边界

```sh
npm run build
node --test dist/tests/treasure-inventory.test.js dist/tests/treasure-compiler.test.js dist/tests/treasure-field.test.js dist/tests/map-object.test.js dist/tests/npc.test.js
node scripts/check-treasure-inventory-native.mjs
node scripts/check-treasure-inventory.mjs
```

并行开发可以指定已编译的隔离目录：`node scripts/check-treasure-inventory.mjs --build-dir build/item-review-v20`。来源检查读取并校验现有 `build/game/opening-playable.json`，不写源码包或重新编译全量内容。

原生检查独立验证 DLL、符号及类型头摘要，复用六批既有 complete 回执中的 20 个完整方法，并读取 24 个原文件区间；关键普通列表偏移、Count 拷贝、隐藏物品/已开字段和首个匹配分支另有字节断言。全部保持 `semanticsVerified=false`。这不是 Windows 原版运行或动态一致性证据。

来源检查独立从原实体属性和原指令计算期望，覆盖 320 定义、640 容量边界、25 指令、30 匿名身份和 22 零奖励；另外把 22 条可执行指令送入真实 GameSession/共享库存，以两组受控初始库存及标记执行，再编码、解码并恢复稳定保存。受控 registry 没有载入原地图关联动画，动画/碰撞事务由合成宿主测试覆盖，不能把这些检查算作原地图表现验收或剧情可达性。

本批 ignored 报告为 `build/reports/treasure-inventory-native-check.json` 与 `build/reports/treasure-inventory-check.json`。来源报告记录目录摘要，集成方重新生成目录后应重跑。HD-2D、地区扩张、普通开箱 UI、完整游戏迁移及原版动态对照不属于本批完成项。
