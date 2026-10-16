# 来源剧情的成组卸装

本族面向完整来源中四个selector的8处调用、5份完整正文与5个地图依赖闭包。`全員の装備を外す`与`控えメンバーの装備を外す`各3处接入共同机制；Tina和Edgar的最强装备各1处沿相同的非饰品自动选择协议处理。静态解码与受控生命周期不等于这些完整正文或剧情批次贯通。

## 来源合同

原生Current注册字典将两种卸装绑定到`28dde0`和`28e120`。其完整范围内的尾跳分别传`(true,true)`与`(false,false)`到`RemoveEquipmentFromMembers 28de80`。共享体调用`GetOwnedCharactersClone(false)`，沿enabled持有名册顺序处理，并跳过`CharacterStatus.Id=14`。reserve排除当前Corps的owned ID，其他保存队列中的成员仍可能是当前后备；不能以enabled等同当前编队，也不能用source ID代替owned ID。

`RemoveAllEquip 3309a0`沿反向槽顺序处理，查询实际拥有的空装备，调用`SetEquip(false,false)`。共同机制因此沿6→1逐槽移除被动、重算参数、clamp HP/MP并更新濒死。总持有Count保持不变，只有真实穿戴登记变化；找不到已有空件则拒绝整个候选，不从静态默认槽发放物品。不能把六槽一次性清空后仅重算最终参数，因为中间的资源clamp可能影响最终HP。

这条调用链没有请求`ChangeAssetPartyCharacter`或`AffectLeader`。Field不会因此要求或伪造演员刷新、条件领队宿主或额外Ready信号。`FieldRosterPort.prepareEquipment`扩展同一个持有者接口，Session、初始入口、跨图和恢复继续转发原roster对象。`rosterEquipment`只读能力检查该实际方法是否存在；没有方法仍阻塞。

`GameState`仍是唯一装备/库存/参数/条件所有者。live发布和地图私有draft共用现有同步锁、revision/generation与battle lease；失败不泄漏、重入/异步发布/旧候选拒绝，成功消费一次。地图发布后同一draft端口转向live owner。未新增持久字段或存档版本。

## 共用非饰品最强选择

Tina/Edgar包装器分别传source status 1/5到`Current.SetStrongestEquipCommon 297840`。该包装取得已有持有者的实际owned ID，调用`SetStrongestEquipNonAccessories(int) 334c20`，再进入同名ref重载`334d40`。Field IR只保存`strongest-non-accessories`和sourceId；运行时没有角色名称或地图分支，也不创建持有者。

原生先按装备字典的正常槽顺序1→2→3→4卸掉非饰品，使用实际持有的空件。然后按惯用手调整前两槽顺序，以`dominant,other,3,4`逐槽选取，每次重新取得库存克隆和已装备登记。`GetDominantArmItems 32df70`在普通、非双刀配置中把非惯用手限制为Armor，再由`GetEquipItems ab5530`核对PartsGroup、职业与实际可用副本，过滤空件。当前和后备的enabled持有者共同占用库存，不能只看出战成员。

`GetEquipItems`按`OwnedItemData.SortId`降序，取首项。共享callback `33ae60`直接读对象+0x18，结构及既有构造器证实它来自Weapon/Armor的`sort_id`。这不是确认后的攻击值或防御值。编译器给全部223件来源装备保留该独立身份；本源的223个排序值全局唯一，weapon为201..291、armor为1..134。同排序的其他输入仍明确阻塞，因为Web库存没有原始持有列表的并列顺序。

`GameState.projectSourceEquipment`复用同一`prepareEquipment`、完整名册库存和`previewEquipmentChange`；每次SetEquip都执行原被动能力登记、参数重算、HP/MP clamp和濒死更新。饰品保持原身份与被动。Count不变，只有实际穿戴登记变化；任何后续失败回滚整笔候选，不能留下先前卸装。新的选择不会过滤掉效果未实现的高排序装备后改选弱装备，选中未知效果即拒绝。

保留的运行时边界包括缺少排序身份、最高排序并列、未绑定效果、双刀/两手/跨职业提供器、弓箭与双手武器校正，以及disabled持有者的穿戴登记生命周期。`GetOwnedCharacterByStatusId b45d40`确实读取include-disabled克隆；当前Web不能因此把disabled登记补成enabled。此源全部Weapon的`two_handed_flag=0`，且没有类别12/13的弓箭；这只是同版本表事实，不能为其他内容推断能力false。`GetStrongestEquipSlotPriority 32e5e0`属于同族全装备排序，返回饰品5/6优先；非饰品路径已经排除5/6，不套用这个兄弟方法作为槽排序。

最强选择仍沿现有live/draft revision、generation和battle lease。取消后可重试一次，成功后不可重复消费；旧候选、重入、异步发布和活动战斗中的Field写入拒绝。未新增库存、持有者或存档版本。

## 复核

`scripts/check-source-owned-equipment-native.mjs`核验同源DLL、symbols和header三摘要，4个实际字典注册、7个有界方法（1152字节）、既有RemoveAllEquip/Corps方法及已复核clone/getter范围。C包装器沿尾跳显示共享体，不能把显示出来的扩大正文当作额外已读取机器范围；原始范围逐一核验。静态证据继续标为`semanticsVerified=false`，原版动态对照未完成。

卸装增量的历史完整来源回执保留8处调用、5份正文及地图依赖；该轮仅6处变为卸装、2处最强仍阻塞。当前轮以末尾的`check-source-strongest-equipment.mjs`重新比较v129全源基线，新增2处最强共用IR。53个实际Battle程序与全部430个AI原对象继续由各自编译器独立比较；不完整AI编码保留原诊断，不能算编译支持。

`tests/source-owned-equipment.test.ts`用明确的合成内容运行真实Field、Session、Flow和Storage，覆盖reserve域、逆槽中间clamp、库存守恒、空件缺失、取消/重试/旧候选、重入和地图draft发布及恢复后继续。它不指定原始故事的中间PC，不计来源正文已贯通。实际来源根入口和其他共用缺口继续由完整剧情批次合同验收。

`tools/native/check_source_strongest_equipment.py`额外核验同源10个有限自有体（5552字节）、9个完整缓存体和7段共享PE（320字节）的全部别名、next-symbol边界、原PE/C/receipt及三输入摘要。共享地址不伪装为唯一方法C，未递归导出callee。`semanticsVerified=false`与原版动态对照缺失保持可见。

`tests/source-strongest-equipment.test.ts`使用合成内容，通过真实Field/Session/Flow、战斗失败重试/胜利返场和Storage验证同一持有者、库存守恒、惯用手顺序、前向卸装的中间clamp、被动移除/重加不重复、取消/过期/地图私有draft以及未知最高候选回滚。测试不设置原始故事的中间PC或flags来跳正文。

`scripts/check-source-strongest-equipment.mjs --input-root <same-generation-input> --before-compiled-dir <v129-before/dist>`复核全部3304/186003，仅两处最强调用从blocked变为共用IR；另外六处卸装投影不变。五份完整正文423条与五地图依赖闭包均保留。53个Battle、430个AI、1530个能力、490个请求/483个descriptor及7条原诊断不变。完整目录差分只允许新增装备选择身份。它不执行这些来源正文，也不计剧情批次完成。
