# 来源 ChangeView

ChangeView 由现有 FieldGame 执行，并把当前语义视图保存在现有 FieldCameraHost；FieldPartyActors.camera 是同次事务的派生投影，不产生另一份可独立修改的当前视图。入口的 MapEntryViewPlan 始终保持原始来源和呈现绑定。

全源提名覆盖 3,304 物理程序、186,003 条指令：54 个 ChangeView 站点、53 个完整程序、5,873 条正文、12 张图、3 种操作数形式。相邻的 68 个 PuppetCore MoveBirdView 站点与完整正文、所有地图/Resident 依赖另列保留；它们不是 MainCore ChangeView 的别名，仍不准入。站点和解码计数不代表原程序已执行。

原生 b50080 先将 r0 转为 float32：0 使用 timeScale=1，正值使用 float32 的 1/r0 并同步等待，负值使用 1/abs(r0) 并异步返回。`.016` 不是 16ms。同步分支随后轮询真正的 IsDuringTakeoffAndLanding。原生 world Normal 最终切到 FlatBird2；nonworld Bird 在任何视图 owner 写入前返回，因此只留下执行审计，不改变当前视图。

生产 App 与来源 Web 回放共同显式选择 `web-flat-field-view-change-v1`。该策略保持现有平面材质、renderer 注册、实际玩家、其他演员和普通步行控制器；提交当前 Bird1/FlatBird2 语义视图及已知相机偏移。同步 join 使用既有 Task 的下一次 10ms clock；异步直接继续。这不模拟原版 takeoff/landing、3D 鸟瞰、Unity 回调、飞空艇 puppet/shadow 或材质注册。非步行交通、骑乘、伙伴、正在执行的演员运动、未知绑定和材质仍拒绝；没有把空 AirShipFollowingEntity 回调误当其注册/注销包装器也无副作用。严格调用者不传该政策，保存不能授予它。

所有 provider、实际 Actor/entity、相机和 party revision、源内容、EventState revision 都在准备和最终提交前校验。失败与迟到 proposal 不发布 camera/party/collision 的部分结果。普通 nonworld Normal 沿原有两个碰撞 owner 恢复 map/entity collision，交互观察开关独立保留；世界 Web 平面策略保持既有碰撞而不授予原生飞行。

只有实际改变视图时才产生 `field-camera-v3`；其中 view 绑定当前 Field 内容 hash、真实 mapId/isWorld 与显式政策。旧 camera-v2 及全部旧 Field/World/Game 保存形状不变。恢复要求可信当前地图和同一宿主政策，联合核对 party 的 view 投影，恢复不重跑入口。切图重建目的图视图；候选取消/失败保留原 Field 当前视图。战斗通过同一暂停 Field 和实际结算返场 owner 保持视图。

`check-source-view-change-programs.mjs` 只读取一次统一生产的 shared candidate，不调用另一套 649 图生产器；重新提名全部原站点和完整依赖，分开尝试原图初始化与显式受控入口下的完整原正文。启动原 alias 前使用 assertSourceProgramOrigin 核对实际地图及完整 namespace。未知初始化、交互、战斗、MoveBirdView 和其他 provider 均原样记录，不跳过 PC、不改旗标、不预设胜负。原图执行、受控执行、机制测试、实际 App 的受控媒体测试、浏览器和原生对齐分别报告，整剧情迁移仍未完成。

原始静态证据由 `inspect-source-view-change-native.py` 重新核对 DLL、symbols、header、metadata、完整 C 和 PE 字节。原有三份新增 C 与缓存 Normal/ChangeView/SetMoveCallback、wait getter 各自保留原字节与摘要。该核验不执行原游戏。
