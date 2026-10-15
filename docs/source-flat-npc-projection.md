# 来源 NPC 跨层互动与 Web 平面呈现

这一能力处理完整来源家族，不针对某张地图。649 张源图共有 2,209 个物理 NPC、2,235 次地图组使用；其中 `all_layers` 或 `birdview_puppet` 为 true 的完整家族为 67 个对象、21 张地图。两种字段分开解释：51 个只有 birdview，16 个只有 all_layers。当前显式 Web 子族准入 59 个 Wait 对象；8 个继续阻塞。

`all_layers` 不改变演员的逻辑层、Unity 层、Z 或碰撞层。缓存原生 `PropertyNpc.ConvertPropertyToData`（0x9f3240）与 `FieldNonPlayer.SetProperty`（0xe17c80）将它传给 `AllLayerTarget`。Web observer 因此允许该来源 NPC 进入跨层互动目标集合，继续使用既有方向、交通资格、当前演员位置及 relay 范围谓词。原生 raycast、目标排序等价性未授予；碰撞仍使用演员实际层。

`birdview_puppet` 选择明确的 Web 平面显示。原演员、来源动画、选择器、原坐标和层继续由既有 FieldNativeNpc/ActorAnimation/Renderer 使用；没有创建第二个 BirdViewPuppet、演员控制器、位置状态或时钟。透视缩放、飞行高度、鸟瞰专用阴影及原生视觉一致性后置。该声明不支持未知来源指令，也不省略原脚本。Foot 查询继续读现有实际 native position；不生成替代碰撞网格。

四个缓存体（另含 0xe171f0、0x3083c0）共 2,896 字节，由 `inspect-flat-npc-native.py` 重新核对原 DLL、symbols、header、metadata、完整 C 及原生区间 SHA。没有新增 native 导出。来源 DLL SHA 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。静态 C 是同源研究证据，不是原游戏动态验收。

严格编译默认值不变。只有公共调用方通过 `webSourceFrameworkInputs()` 显式给出 `npcFlat` 输入，纯编译器才评估全部 649 张严格源图，并给框架地图安装 `frameworkNpcFlat` 不可变 sidecar 及 `npcProjection: web-source-npc-flat-projection-v1` 标记。没有按成功地图筛选 assessment；失败原对象与诊断完整保留。原 `FieldEntity`、脚本、几何、互动和 blockers 不改写。运行时只对同一真实 source/entity 绑定的这一条 NPC 门槛提供能力，其余提供器继续阻塞。

`compiled-framework-npc-flat-addition-v1` 是独立精确增量审计。读取器从锁定 corpus 与完整严格 world/maps 重新计算全 649 assessment，验证实际 candidate sidecar 完全相等后，只在临时比较体中移除这一新增 sidecar/marker。实际 candidate、引用、raw、旧配方 pins 不改动。坐标、定义、成员移除/重复、来源和其他策略变化不能借此放行。旧版本 profile 审计仍可复验；标记、存档和源码计数都不能自己授予运行能力。

活动状态仍由现有 Field/World/Session/Owned/VM/Storage 持有。地图私有准备、媒体失败、取消、重试、旧命令拒绝及原子发布使用现有事务。恢复从可信当前内容重建 sidecar 与 NPC 定义，既有 native checkpoint 保存唯一演员状态；没有增加 checkpoint discriminant 或 perspective 保存状态。切图和战斗返场不重初始化旧演员，也不把旧 ID 重绑到新地图。

保留的 8 个对象是 map192 的 4 个 Area NPC，以及 map102、447、534 的 4 个 stencil NPC。它们不被降级成 Wait，不删除 source 属性，不得到本族准入。

`source-flat-npc-cohort.mjs` 保留所有物理 raw 对象、全部 649 installed namespaces、Resident、完整原程序和中央依赖。`check-source-flat-npc-programs.mjs` 尝试全部 21 张原图初始化及 450 个 installed script roots，初始化前置失败必须留下 unexecuted case。其 helper 起始种子仅从已有原生视图/PointIn 的普通源图选择，不减少这 21/450 分母。所有地图使用其原 PointIn 与初始化；没有设置剧情 flag、名册或位置来制造可达。

受控验收涵盖跨层互动、同层碰撞、不同层不碰撞、同实体动画/显示、存读档、失败与取消重试、战斗返场、旧 owner 退役，并通过真实 app 模块和生产 Renderer。受控 DOM/Canvas、媒体 ACK、日期输入和时钟不是浏览器实玩或原版动态对照。完整源脚本的可执行、实际执行、存读档、主线可达和主线完成分别报告。

真实源新游戏探针可复用同源候选，沿原 title/VM/Session/Flow/MapLoader 自动消息和切图推进。当前私有探针已完成 609→3→178→609；申请 572 时下一门槛为 `Field effect birdview scale provider is unavailable`，旧场景和请求原子保留。它不表示已进入 572，不把 FX 门槛混进本族，也不宣称开场或剧情完成。

本批私有完整原文观察器实际尝试 21 张地图初始化：4 完成、17 unready；450 个 installed script root：23 完成、427 unready，其中 375 个因初始化前置失败而未执行。初始化后共有 2 个活动投影 NPC，31 个 root case 曾持有投影演员，其中 9 个完整 root 完成；4 次稳定存读档通过。这里的完成指受控 helper 环境中原全文 VM 返回，不表示这些脚本已经沿主线可达，更不表示剧情完成。原文、所有 installed namespace（含 Resident）、中央依赖及失败诊断全部保留。

这组数字来自修正后的独立观察器，绑定私有候选完整 runtime `2a4fd1e23a34c4cd783e7f7ea9371b8d281219515bc729482de35e41989970b3`。观察器自身 SHA 为 `0033ba757ea85d1dbd615fef4601068e2d0823ab57c0f034cd7d3b8fa3f46567`；其 app 端口和普通源图起始 scaffold 补齐作为单独工具边界记录，没有改写原 25 路径冻结候选或原失败报告。正式联合工具另保留同目的 scaffold 修正、既有 Shake/retained-world 端口和固定受控日期输入；这些私有数字不能替代最终联合 runtime 的新鲜公共验收。

全源身份对照的 2,217 次“已导入 typed NPC 地图组使用”与原始 2,235 次 raw 使用不是同一分母。差额 18 条全部保留原始对象及原诊断：map149 一条 `script.csv:99999` 缺失或歧义；map180 的 `ev_e_0555_5` 三条将 `move_type` 存为字符串 `"0"`，被既有数值解码器拒绝；map440 十条位于原拼写 `UpperOject` 的未知层；map489 四条因整图 `Unsupported collision map range` 未形成 typed map。这四图均不在本族 21 张受影响图中，未减少 67/59/8 分母，也未通过补齐、强制转型、纠正拼写或删除 raw 对象获得准入。逐条 source、原对象和诊断见交付回执 `raw-typed-npc-gap-addendum.json`。
