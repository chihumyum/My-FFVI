# 来源鸟瞰字段特效的 Web 显示后置

本能力只为已有全循环、无 Animator／脚本及未知副作用的媒体证明增加显式 Web 平面显示后置，不实现原生 Birdview 缩放、粒子、材质或像素一致性。原生严格编译与旧逻辑 FX 声明不会自动获得这项能力。

## 全族来源和准入

完整 649 图原始清点包括 872 个物理 kind11 对象、914 个地图／组使用。历史 866 是旧类型化集合的分母，不能替代原始使用数。鸟瞰族共 10 个物理对象／10 个使用，分布于地图 1、2、572、575、599；完整 installed namespace（含 Resident）包含 154 个 root 使用、121 个物理程序，原正文和依赖全部保留。

纯 `assessFrameworkFieldEffectFlatWorld` 从完整 raw corpus、649 个严格地图 pin 与同一次 lossless 逻辑媒体编译派生完整族，包括失败行。当前只有 map1 的 `ev_e_0461`／254／`ef_ff6_e_013` 与 map572 的 `entity_default`／5／`ef_ff6_e_014` 满足静态媒体与 board 条件。map1 仍受原事件组创建顺序合同限制，静态适用不代表实际初始化成功。其余 8 个保留非循环、Animator、未知组件、透视摄像机或 screen-space 等原门槛，不以同 assetGroup、同地图或 saved ref 扩大权限。

`fieldEffectFlat` 是公共与私有 producer 共用 `webSourceFrameworkInputs` 的独立显式输入。基础逻辑声明不能夹带 `boardProjection`。新投影附于同一 `FieldEffectCatalog.webPolicy`，由 `fieldEffectProjection: web-source-field-effect-flat-v1` 声明，保留全部 10 行 raw 对象、2 个精确 binding 及 8 个未就绪原因。

`sourceMapSetHash` 绑定来源/父来源和全部 649 个严格地图内容 pin。它不是 world 对象内容 hash：URL 链接会改变 world 序列化，而原始地图 pin 不变。实际 producer 的 world/entry 身份、编译器与原始输入锁另行保留。投影目录 hash 包含完整声明；来源 refs、定义、位置、层、碰撞及所有未知 blockers 不变。

## 唯一 owner 与生命周期

复用现有 `FieldEffects`、World map lease、地图事务与逻辑 FX host，没有第二粒子管理器、时钟、显示 owner 或保存器。新 source ref 只在匹配原始 map/group/entity/layer、完整实体与 effect definition、来源 map hash 和真实放置坐标时传入既有 create 操作。脚本不能凭 assetGroup 新建任意 board。

创建、prepare、restore 使用同一 matcher；FieldGame 在修改 owners 前验证当前可信内容与组成员身份。保存仅附带源 ref，不能授予投影权限。恢复必须从当前可信 catalog 选出同一定义／坐标／层，拒绝删 ref、换源、换定义、改坐标或伪造 catalog。旧目录没有投影时，原行为与 board 保存键不变；复用 `idle-world-v11`／`event-world-v2` 的既有 catalog hash 绑定，不另发保存版本。

公共 producer 使用独立 `compiled-framework-field-effect-flat-addition-v1` 审计。reader 从固定原始 corpus、完整严格地图、lossless object bytes 与原始游戏文件重建证明；比较只在临时副本移除该项新增 marker/catalog 投影。新逻辑目录同时初次增加时，仍由原独立 versioned logical-catalog 审计处理，不假装旧目录已有 owner；旧 pins 不重写。

## 验收边界

合成实际 Session/Flow/MapLoader/CheckpointStorage 验收涵盖保持 board 时钟／注册／正数播放、候选 cancel/stale/retry、地图媒体失败／取消／重试／返回、战斗媒体失败／重试／结算返回、配额失败重试和 event continuation 一次执行。实际 app 使用生产 host 与 owner，控制 DOM、媒体、传输和时钟；Renderer 回归单列，不授原版像素一致性。

整族 source checker 必须逐一尝试全部 5 图原初始化与 154 个完整原 root，保留完整 namespace、外部依赖、源导入失败和初始化前未执行记录。受控 helper 只提供通用合法入口脚手架，不注入剧情 flags、名册或位置以提高通过率。初始化、全文完成、当前有投影 board、成功存读分别计数；没有 VM instruction trace 时，实际 FX 来源指令执行次数明确为 unassessed。真实 newgame frontier 是另一条不改状态的观察，不能替代整族验收或声称剧情迁移完成。
