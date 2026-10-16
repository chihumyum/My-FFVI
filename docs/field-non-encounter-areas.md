# 来源非遇敌区域

本族把 `ObjectType.NonEncountArea=23` 接到已有 Field／World 生命周期。它是地图属性，不是角色、触发器、碰撞体或被忽略的演出。原始源版本仍由 DLL `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`、符号和头文件固定；没有运行原生游戏作对照。

## 全源范围

全量检查 6,951 个物理资产、3,304 个程序／186,003 条操作、649 张地图及 15,860 个 Tiled 对象。共有 13 个物理区域、11 个物理实体组资产；它们在 11 张地图中对应 13 个组别名、15 次对象绑定。不能把复用同一物理对象的地图绑定当成额外源对象。

38 次地图上下文解析对应 36 个物理 SetEntities 站点、32 个完整直接正文／2,467 条操作。完整地图脚本闭包有 184 个正文／11,787 条操作；293 个依赖 ID 与全部 293 个原始物理对象在提名包单列保全。另 74 个同名别名站点不是这些地图里的同一对象。全 53 个战斗正文和 490 个请求队伍依赖不删减。以上都是静态范围，不是剧情到达数。

三块区域没有 entity_id；十块有。八块原始 visible=false，五块 true。十一块在 GroundObject、两块在 UpperObject。原始来源、Tiled ID、可选实体 ID、矩形和层仍保留；查询不从编辑器可见性或层推断是否允许遇敌。

## 原生合同与两层集合

`MapManager.CreateEntityOnlyProperty 0x305260` 的完整 448B 方法专门创建 kind23 的 PropertyNonEncountArea；普通 CreateEntity 工厂没有这一分支。本族没有顺便授予另外的 property-only 工厂 18／20。

构造方法 `0x9f1df0` 的完整共享 64B／14 个别名先调用基类，再派发虚槽 4。NonEncountArea 没有额外字段或转换覆盖。已有 `PropertyAreaObject.ConvertPropertyToData 0x9f1cd0` 和 `MapUtility.ParseMapObjectGroupData 0xb27340` 证明：先按地图 crop 减整数像素 origin，再将 Float32 像素除以 16，按 Mathf.Round 的半格取偶规则转换 Rect。它不是 floor，也不能把全局 Tiled 坐标与原生 local cell 混用。这里复用 MoveArea 已有纯坐标函数；没有伪造 kind13 身份。

`MapModel.SetupCurrentPropertyList 0x353370` 每次组成 default + 最新事件组属性。`SetEventEntityGroup 0x2ed6f0` 随后将其中的 NonEncountArea 提供给 EncounterLot。两者的集合语义不同：`SetNonEncountPropertyList 0x7abb60` 的完整 own96B 尾调共享 `List<NonEncountArea>.AddRange`，由 metadata `0x201e400` 精确绑定；不能按 Set 名称猜清空替换。共享 AddRange 的 own48B／139 个别名保留，实际用当前 size 作插入索引。没有把尾跳后越界的反编译 C 当成 caller 证据，也没有递归恢复 BCL 泛型树。

`EncounterLot.Preset 0x7ab710` 的 own96B 只写三个 provider 指针；GC barrier 后还有写入，反编译的早退不成立。`Clear 0x7ab3e0` own112B 清当前遇敌信息／预备数据，并在 +0x50 非空时尾调精确 typed List.Clear。现有地图清理调用它。本族以新 Field 的空列表和成功发布后的旧 Field 退休对应地图边界。

完整 `StandingInExclusionArea 0x7abd10` 是矩形成员存在性查询：X/Y 两侧都含边界，不读 Z、层或 visible。对已准入的完整矩形列表，重复与顺序不影响这个布尔结果。这里不宣称保存后的列表对象与原生 List 具有相同身份。

## 同一状态所有者与授权

可信编译输出使用两个明确数据声明：实体的 `nonEncounterArea.kind="source-non-encounter-area-v1"` 以及地图的 `sourceNonEncounterAreas.kind="source-non-encounter-areas-v1"`。正式 Session／Field runtime 必须显式提供同值 `sourceNonEncounterAreas`。App 与共用 replay port 使用相同常量值。没有扩展旧 profile／input-lock 版本，保存数据不能授予宿主能力。

FieldGame 私有列表从初始 currentProperties 建立。合法 SetEntities 准备当前 default + 新组的全部区域，与 NPC、FX、宝箱、动画等既有准备在同一成功发布边界追加；失败不改变实体、当前属性或区域列表。旧累计 activeGroups 与 latest currentProperties 继续各自原有用途。重复 SetEntities 仍硬拒，未授予 A→B→A 的重复组生命周期。

保存不另存一套可变矩形或新名册。恢复以当前可信内容和已有有序、唯一的已准入组历史重建布尔成员关系；初始组前缀和其他旧 codec 检查不变。每次查询、实际步行和保存都会重新校验唯一当前 carrier，包括几何、身份、来源及不能附带其他 provider。legacy 可变内容的晚改不能继续使用旧区域；显式 immutable source snapshot 保持其原有调用者副本隔离。

World 候选透传同一 runtime，区域数据参与旧／新候选验证。失败和取消只退休对应候选；成功发布才退休旧 Field。退休仅禁止本族查询、激活和保存，不提前返回整个 Field.advance，也不吞其他 owner 的旧实例错误。

## 实际消费者与明确 Web 差异

来源 Encount 保留原有 pre-sync native player pose 捕获和 `default-or-excluded-unprojected`／BG0 不变量；准备与重验仍检查同一个实际区域属性 owner。没有把某次区域查询升级成精确 nullable FootInfo=null 结论：实际 GetEncountInfo 还经过未闭合的 CorrectionMapAreaRangePos，不能跳过它冒称恢复原生投影。区域内脚本原 Encount 仍照常选择、准备和进入战斗，不能因此避战。资格用的旧 foot v1 形状未扩；这 11 张源地图全属已有 uniform-zero 子集，排除／默认两种来源的资格结果都是 0。其他 terrain、overwrite、master 和资源门槛继续保留。

已有 framework walk scheduler 本来就是明确的 Web 步数／RNG 规则。本族将实际合法 free step 的目标格排除状态加入其 eligibility：区域内不调用 scheduler，不消耗它的 countdown／RNG；移动、原 field condition step 和已有事件优先级继续执行。这个顺序是明确 Web 行为，不能冒称恢复 native required_steps 或 CheckEncount 的精确时序。没有 walk policy 的源地图不会新造随机遇敌。

## 验收与限制

专项验证覆盖不可见／匿名区域、inclusive 边缘、非零 crop 和半格取偶、累计列表与 latest 属性、重复组拒绝、双授权、晚改 carrier／歧义、immutable source、可信恢复。实际 Session 验证合法步行进入／离开 → 真实战斗与唯一返场 → Storage、脚本指定战斗内的真实 pose 捕获及媒体失败／取消／重试，以及 map 失败／取消／迟到结果／重试与退休后新 Field 激活。没有向 live state 注入 held、HP、剧情旗标或伪造 source reachability。

全源检查比较全部操作前后 IR 与异常，保留既有未知；所有实体组的其他 blocker 逐项守恒。kind23 之外的 NPC 路由、接触遇敌、粒子、条件和媒体未获授予。原参数在受控实际 Session 的验证与完整原正文动态回放是两条证据线；后者由统一候选回放验收。
