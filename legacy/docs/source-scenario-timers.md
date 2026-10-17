# 共同剧情计时器

本族来自全源 3304 程序、186003 指令的共同缺口，覆盖 Cid 四种调用 5 站点、Shadow 设置/解除 8 站点和 ShowTimer 1 站点，共 8 个完整正文 1280 指令。来源下标与每个原始使用点保留；静态编译、机制验证和实际剧情贯通分别验收，不把它计为通关进度。

`FieldGame.timerState` 仍是唯一计时所有者。原回调全局计时与 Cid 无回调计时互斥，采用一个版本化快照，继续由已有 Field/Session 逻辑时钟推进。`FieldTimerSnapshot` v1 原样可读；v2 另存 Cid counter、唯一命名 ShadowTimer、延迟解除和已采样的回调队列。原 Finish/Set 替换全局计时不擅自删除命名计时。没有第二份 GameState、全局时钟或新通用 scheduler。

Cid HP 检查把活动且未结束的全局剩余秒数截断写入 ScenarioVariable2，否则写 0。暂停在活动时先写入再移除全局计时；结束的对象保留。TimerCheck 仅在变量为 30..255 时启动，其他值移除；Resume 的 0 不变，正数启动。两者都保留原 f32 转换、Player3 时钟、无回调和隐藏 UI。负 Resume 的原 Timer 构造行为尚未恢复，到达时明确阻塞。快照不伪造 callback；恢复必须重新验证原调用地址、命令和捕获值的有效范围。

Shadow 设置在全局剩余大于 5 秒时，以剩余减 5 建立非循环命名计时。更新状态为 Player3、Battle13、Event12 和 Gimmick11。同名项已存在时返回旧计时而不重置。解除请求延迟至计时更新末尾；同一 VM 帧解除后再次设置仍命中旧对象，不能变成删除后重建。到期在同一次共享时钟中读取 flag1:40；值为 1 时才读取当前实际玩家原生 transform，并用当前地图的既有 ConvertWorldPositionToCellPosition 投影。缺实际提供器保留明确 gate。

回调使用静态 int[7,2] 原常量，绑定链为 Current.cctor 的 static_fields+0xc0、确切 FieldInfo 和 metadata 字段 A5764BFD0108F32AECEDD11C5E3FEE997A5868AA。原 56 字节的 SHA1 与字段名相同，不按画面或剧情常识推测位置。只有相符的 cell 才产生 sc_secede_shadow 请求。不命中就消费本次回调，未来旗标或位置改变不能使它重试。

原生调用为 RunScript(name,true,true)。本 Web 策略沿普通计时器的安全 Field 根边界发布，不抢占战斗、对话或未完成字段任务；到期时的条件已经采样，发布时不再读取。命中后只有成功建立现有 VM 根任务才确认一次，缺当前可信脚本或准备失败保留同一请求。该策略不授予 native Unity float 时序或抢占一致性。

切图复制相同计时快照和仍被引用的来源元数据，取消、过期或失败不替换有效 owner。`storyTimerOrigins` 是集中 typed local port；旧 single-origin API 保留。存档仅标识所需来源；Repository 必须通过当前可信目录或独立初始包装重新读取所有来源。全局计时和命名项来自不同地图时同样逐个重绑，旧存档不能自报脚本或获得能力。

ShowTimer 沿 `FieldUi.view` 的 v2 timer 视图消费，保持 MainGame 状态。Field 的计时 UI 投影传给现有 Canvas overlay，地图导航按钮消费相同视图。旧 v1 UI 快照不自动补 timer 状态。布局是明确 Web 表现，原 MapUIView 全表与原版视觉一致性仍独立。

`check-source-scenario-timers.mjs` 比较完整原始源和每条 Field 投影，仅允许这 14 条变化，并重新检查 Battle、AI、ability IR。每个编译器各自建立完整消息字典 lookup，使用生产 system_zhc。原未知指令与诊断保留。`check_source_scenario_timers.py` 仅重核有限缓存、原字节、常量和来源绑定，不再导出或执行 native。合成 Session 验证使用真实初始化/演员、World、Battle 往返和 Storage；它们不冒充这 8 个来源正文已执行。
