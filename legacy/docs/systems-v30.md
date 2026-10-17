# 系统集成 v30

本批继续补共享字段系统：来源摄像机进入事件执行器、切图候选、稳定存档和 Canvas 投影；来源演员工厂及标题到字段交接协议形成独立能力。正式 fresh `GameSession` 尚未装配，现有纳尔谢入口仍是开发检查点。完整 Web 迁移和全游戏验收未完成，HD-2D 未启动。

## 摄像机运行系统

`FieldGame` 拥有唯一 `FieldCameraHost`。实际玩家的位置通过端口实时读取；source actor 0 映射到独立的 `native:camera`，不制造可碰撞的玩家副本。SetPos 与 Lerp 由严格的来源参数解码；插值进度保存在各 puppet 任务中，并使用既有全局槽调度顺序。普通事件开始选择 dummy，普通 Exit 恢复实际玩家；切图与战斗退出不会借普通结束分支提前改回目标。

摄像机的 root 位置、实体视觉 offset、地图 scroll offset 与效果 offset 分开保留。默认玩家视觉偏移 `(0,-6)` 绑定实际 prefab；viewport、循环图与边界约束在共享宿主中计算。Canvas 使用 root 投影定位整张地图，独立保留未 clamp 的渲染跟踪输入。新的默认 shader 输入投影尚未成为完整 GPU 着色实现。

原生 dummy 没有精灵也仍有实体状态：Ready 的 Show(0) 写入 activeSelf、fadeAlpha 和 currentFadeStatus，Hide(0) 写入同一个 owner。初始化、重新选目标及移动均保留该状态。新 GameObject 的 activeSelf 在未执行显隐前保留 unknown；不凭画面不可见推断 inactive。非零时长/延迟的 Hide 保持阻塞。原生演员适配器不再收到已由摄像机 owner 接管的 Init/Show，`hiddenEntities` 也不能再保存一份 dummy 显隐。

世界包携带的是普通字段生命周期下的条件能力。几何预览不会因加载该字段自动获得来源宿主；已有来源摄像机的切图保留其状态，并在 PointIn 后重新绑定玩家及目标地图范围。来源脚本上下文随此路径传递，缺少原生演员宿主时明确停止。候选或依赖失败不会改旧地图、镜头或剧情状态。

## 独立准备能力

来源演员工厂区分实际玩家、四个 puppet、三组其他队伍和居民池；物理 Web ID 与脚本负 ID 保持分离。隐藏实例保留原生场外位置、零方向及空动画状态，不能被猜成地图左上角或默认朝下。普通地图的材质参数仍作为明确投影保留；water、自定义和 palette 分支保持门禁。详见 [来源演员工厂](field-actor-factory.md)。

标题交接协议保留实际全局 fader，按来源顺序准备标题 BGM 停止、黑幕、地图预载、场景请求/激活和字段准备。成功启动的 reserved script 优先于地图默认初始化；不能提前执行普通 FadeIn、地图 BGM、标题或 SetupEntities。每个阶段要求拥有者的完成信号，失败准备不消费启动资格。来源两指令交接探针不等于完整开场。详见 [新游戏字段交接](new-game-field-entry.md)。

这两项仍须连接正式 GameState/FieldGame actor owner、交通初始化、叙述消息及连续入战返回。原生 puppet 端口的完整状态尚无持久化编解码，接入端口的实例继续拒绝稳定保存；不能用摄像机单项保存替代整个演员系统。

## 版本与证据

运行 profile 为 `narshe-playability-v30`；owned v7、field/world v8、session v3，独立 camera 状态 v2。旧格式按来源和版本规则拒绝，不重播初始化、不重新发放库存。

验收记录写入本地 `build/reports/systems-v30-validation.json`。来源回执继续标记 `semanticsVerified=false`。测试、真实来源静态检查、受控 renderer 投影与浏览器旧流程回归各自说明范围；没有把任何一项换算为已完成地图数或原版动态一致性。

2026-10-12 最终检查：1,101 项 TypeScript 测试、注册表契约与 22 项 Python 测试通过；77 条既有命令及 4 条新增来源/渲染命令最终通过。首次 saves/BGM/environment 检查拒绝了旧 `world-check` 回执，运行当前世界检查后仅重跑这三条，保留初始失败记录；没有修改摘要约束。

新增摄像机检查包括 8 项事件/切图/保存运行时测试及 7 项真实 renderer 绘制坐标检查。演员工厂以实际来源创建 55 个候选并核对 1,109 个 sprite 文件；标题交接以实际 route 和两个受控 FieldGame 指令链检查保留渐变与启动顺序。这些是模块和接口验证，完整 fresh session 仍未发布。

浏览器从开发入口走完守卫对白，两发火炎射线获胜，结算 96 EXP / 96 Gil 后返回地图并移动至 `(38,36)`。菜单显示等级 3/2/2、HP 39/63/21、3096 Gil 和坠饰 1；此次没有掉落普通道具。稳定状态可保存，验证过程没有写入浏览器存档，原标签页保留。控制台无 warning/error，截图为本地 `build/reports/systems-v30-browser.jpg`。该次浏览器验证旧开发入口；新增摄像机绘制范围由受控 renderer 检查单独证明。
