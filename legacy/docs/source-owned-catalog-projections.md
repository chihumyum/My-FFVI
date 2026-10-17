# 封闭来源目录增量审计投影

统一 registry 只有三个已审核标识：`sourceBattleHandoffs`、`sourceSpecialOwnedMembers` 和 `equipmentStrongestMetadata`。前两个是顶层只读能力目录，第三个是虚拟投影标识，不生成新的 `gameState` 字段或状态 owner。旧 Handoff wrapper 仍委托同一审核器。

第三投影只覆盖 `equipmentSystem.catalog.definitions/*/strongest` 与 `sourceNewGame.equipment.definitions/*/strongest`。真实源域分别为完整 223 件定义和新游戏初始子集 10 件，共 233 处纯新增。已有 strongest 不能改变或删除；任何部分填充、混合历史形态、旧定义属性改变、库存或初始装备槽变化都拒绝。初始子集不是第二份全 223 目录。

审核器重新编译完整 `content.csv → weapon.csv / armor.csv` 关系，保留原行、物理 bundle/serialized file/十进制 object ID/row ID、完整表摘要与实际 compiler 模块 pin。武器读取原 sort_id/category_type/two_handed_flag；防具读取 sort_id，类别 null、双手 false。实际初始子集每个副本都必须与完整原域一致，完整原定义身份集合不能由 candidate 自报。

比较投影仅删除已证明本次增加的 strongest 字段来核对全部既存正文。它绝不充当 baseline。旧形 baseline 由相同原始输入经原 `compileEquipment` leaf 的明确 audited omit 策略独立生成，并同时传给原全装备目录和原 `compileNewGame` 初始目录。正常编译默认不变；该选项不授予运行时权限、存档迁移或装备库存。

`compileSourceBattlePrerequisites`、实际 reference/recipe resolver、ordinary 派生共用同一 registry、同一参数 bag 和同一个 lazy 纯编译函数。ordinary 根据自己的旧形选择 omission 集合，不能借用父 seed 的历史形态。原 H0F0 消息费用比较继续独立，无旧 recipe pin 或 raw seed 改写。

验证分别记录全部八种三投影历史形态、partial/mixed、旧 strongest 改变、raw/物理来源/compiler 伪造、真实库存/装备槽/参数改变、未知字段、旧 pin 与晚失败重试。真实全 223/初始 10 的纯编译、实际入口计划守恒和旧 baseline 独立证明另留原始 artifact。静态 preflight 不代表剧情、浏览器或原版一致性通过。
