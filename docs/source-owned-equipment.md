# 来源剧情的成组卸装

本族面向完整来源中四个selector的8处调用、5份完整正文与5个地图依赖闭包。`全員の装備を外す`与`控えメンバーの装備を外す`各3处接入共同机制；Tina和Edgar的最强装备各1处继续保留独立的明确阻塞。静态解码与受控生命周期不等于这些完整正文或剧情批次贯通。

## 来源合同

原生Current注册字典将两种卸装绑定到`28dde0`和`28e120`。其完整范围内的尾跳分别传`(true,true)`与`(false,false)`到`RemoveEquipmentFromMembers 28de80`。共享体调用`GetOwnedCharactersClone(false)`，沿enabled持有名册顺序处理，并跳过`CharacterStatus.Id=14`。reserve排除当前Corps的owned ID，其他保存队列中的成员仍可能是当前后备；不能以enabled等同当前编队，也不能用source ID代替owned ID。

`RemoveAllEquip 3309a0`沿反向槽顺序处理，查询实际拥有的空装备，调用`SetEquip(false,false)`。共同机制因此沿6→1逐槽移除被动、重算参数、clamp HP/MP并更新濒死。总持有Count保持不变，只有真实穿戴登记变化；找不到已有空件则拒绝整个候选，不从静态默认槽发放物品。不能把六槽一次性清空后仅重算最终参数，因为中间的资源clamp可能影响最终HP。

这条调用链没有请求`ChangeAssetPartyCharacter`或`AffectLeader`。Field不会因此要求或伪造演员刷新、条件领队宿主或额外Ready信号。`FieldRosterPort.prepareEquipment`扩展同一个持有者接口，Session、初始入口、跨图和恢复继续转发原roster对象。`rosterEquipment`只读能力检查该实际方法是否存在；没有方法仍阻塞。

`GameState`仍是唯一装备/库存/参数/条件所有者。live发布和地图私有draft共用现有同步锁、revision/generation与battle lease；失败不泄漏、重入/异步发布/旧候选拒绝，成功消费一次。地图发布后同一draft端口转向live owner。未新增持久字段或存档版本。

## 保留的最强装备缺口

Tina/Edgar包装器分别传source status 1/5到`Current.SetStrongestEquipCommon 297840`，它实际调用`OwnedCharacterClient.SetStrongestEquipNonAccessories 334c20`。当前缺少该选择、可用库存、槽优先级和并列顺序的完整合同。二者保留`blocked`并指明这个callee；不以攻击值最大、静态最优装备或一次通用refit替代。

## 复核

`scripts/check-source-owned-equipment-native.mjs`核验同源DLL、symbols和header三摘要，4个实际字典注册、7个有界方法（1152字节）、既有RemoveAllEquip/Corps方法及已复核clone/getter范围。C包装器沿尾跳显示共享体，不能把显示出来的扩大正文当作额外已读取机器范围；原始范围逐一核验。静态证据继续标为`semanticsVerified=false`，原版动态对照未完成。

`scripts/check-source-owned-equipment-source.mjs --before-compiled-dir <before/dist>`遍历全部3304/186003，保留8处来源差分、5份完整正文和全部地图依赖。仅6处变为共同卸装；2处最强保留阻塞，其他Field投影不变。53个实际Battle程序与全部430个AI原对象经各自编译器独立比较；不完整AI编码保留原诊断，不能算编译支持。

`tests/source-owned-equipment.test.ts`用明确的合成内容运行真实Field、Session、Flow和Storage，覆盖reserve域、逆槽中间clamp、库存守恒、空件缺失、取消/重试/旧候选、重入和地图draft发布及恢复后继续。它不指定原始故事的中间PC，不计来源正文已贯通。实际来源根入口和其他共用缺口继续由完整剧情批次合同验收。
