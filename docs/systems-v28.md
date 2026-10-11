# 系统集成 v28

本批接入共用 BGM 等待和玩家显隐宿主，继续推进 Web 系统。完整新游戏、演出调度和全游戏迁移均未完成；没有开始 HD-2D 或区域填充。

## 运行系统

- `ReadyBGM` 读取曲目的资源就绪状态，不播放声音。浏览器独立加载、校验摘要并解码待用资源，字段任务通过只读端口观察结果；没有端口或资源校验失败时停止。等待期间不能生成稳定存档。切图候选与恢复会话使用宿主重新绑定的端口，不从存档恢复缓存状态。
- `SyncBGM` 等待当前通道结束，继续使用 `StaticAudioState` 的唯一播放状态。换曲后等待新曲，停止后不等待已脱离通道的淡出尾音；循环曲不会凭任意超时结束等待。见 [音频等待](audio-readiness.md)。
- `HidePlayer` / `ShowPlayer` 通过实际玩家实例更新现有 `hiddenEntities`，不以当前 puppet 或源角色编号代替玩家。人物、头部和骑乘外层共同显隐。来源 `ChildEntityObject` 子实体链必须明确；未证明时阻塞，不能从没有 Web 子节点推断原版为空。见 [玩家显隐](player-visibility.md)。

玩家子实体能力是不可变的宿主输入，不增加第二份可见性状态。音频准备不创建虚假播放实例，资源缓存和解码不进入确定性存档。

## 调度研究与发布边界

`field-task-control` 提供来源绑定的纯投影和严格解码，但没有替换现有开发任务执行器。`Call` 只读取目标参数；源码中的第二参数 1 不是异步，`ExecPuppet` 才启动并行任务。来源全局 32 槽、等待所有活动槽、主任务结束后的清理，与旧开发执行器的每任务 pending/children 有差异。

正式接入还需恢复负实体编号的角色替换、编队分配、开始及结束时的 `InitializePlayerPuppetEntities`、实际碰撞开关、世界地图脚本身份以及外部 callback。它们包含位置、层、方向、动画、骑乘及 companion 副作用，不能用空回调代替。新异步路径与 `FinishPuppet` 继续明确阻塞。见 [来源任务控制](field-task-control.md)。

完整序章仍需要玩家子实体来源、相机演员 0、负时长淡入淡出、叙述消息、完整 puppet 宿主及切图媒体。严格解码和受控宿主验证不代表主线可达或可玩地图覆盖。

## 版本与验证

运行配置为 `narshe-playability-v28`，owned v7、field/world v6、session v3。内容摘要改变时旧内容存档仍按既有规则拒绝；未加入活动任务保存或版本迁移。

本地验证回执在 `build/reports/systems-v28-validation.json`。原生静态回执保持 `semanticsVerified=false`；原版动态一致性和完整 Web 迁移门禁保持未完成。GitHub 仅保存源码、说明和合成夹具，原生导出及游戏内容留在本地。


2026-10-12 验证：970 项 TypeScript 测试及注册表契约、22 项 Python 测试通过；74 条来源、原生、宿主与受控适配器命令最终全部通过。存档、BGM 和环境音检查的首次失败来自仍绑定上一目录的 `world-check` 回执；重建回执后只复验受影响项，初次失败记录保留，没有放松摘要或准入规则。

独立审查发现音频缓存未保护 pending 依赖：三条待用资源会被两份闲置缓存预算轮流驱逐。实际模块的修复前测试复现了持续 `ready=false` 与重复下载；现在表现层同样接收待用依赖，保持到字段任务完成后才允许淘汰。9 项受控 Web Audio 适配器检查覆盖资源保留与释放，它们不替代浏览器解码或听感验收。

浏览器本轮从开发入口走完守卫对白、两次火炎射线、首战胜利和返回地图；获得 96 EXP / 96 Gil，队伍等级 3/2/2、HP 63/54/35、3096 Gil。返回 `(38,38)` 后移动到 `(38,37)` 并暂停。控制台无 warning/error，没有写入或覆盖本地进度。截图为本地 `build/reports/systems-v28-browser.jpg`。

- narshe.json：`f9c77112e5d986e2934cd7b25a46d6b59eb615e78ea96cef4ab308df4b4d60be`。
- opening-playable.json：`bbd4b1cf5c1519692bfdf7c6acc500e2f548242f281467cee7188797e3c48794`。
- opening-battle.json：`a0065f0468106b045c092d47779bf6e9da7495fe14f38dddb8ddd79620db1672`。
