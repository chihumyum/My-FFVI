# Puppet.Route 整族迁移

`Puppet.Route`（type 2）使用独立 typed opcode `field-puppet-route`，保留两个目标 cell、层请求、nullable 速度、动画名和完整 Site。它与 External.AssignMoveRoute、NPC 自主巡逻分别准入，不借同名字段互相授权。

来源首次 clock 拒绝已在移动的实体；完整 cell 相等时直接继续，否则调用 `MapRouteSearcher.Search(start, target, true)` 并将路径交给既有 `FieldEntity.MoveTo(List)`。后续 clock 观察同一实体的 IsMoving。已有完整 C/PE、GetChangeLayerValue 和速度 helper 的静态绑定通过 `inspect-puppet-route-native.py` 重核；原版动态和 Search/raycast 一致性未验收。

Web 宿主明确选择 `GameSessionRuntime.puppetRoutes = "web-source-puppet-route-grid-v1"`。应用和整族回放器使用同一声明。网格搜索是有界、确定性的四向 BFS，保留源地图 range 原点，沿既有地图/实体碰撞开关检查双方方向位和占位。它没有无路传送、跨层捷径、自动绕过未知碰撞或新增 RNG。首次无路明确阻塞；已开始路径在后续 waypoint 遇已知动态占位时等待，未知碰撞在发布下一段之前阻塞。

普通非玩家演员的路径、段索引、elapsed 和动画仍在同一 Actor.motion；Task 只等待其完成。相机使用既有 FieldCameraHost dummy transform、Task.cameraPath 和路径游标，转弯不创建 FieldGame 演员副本。相机 Main 收尾可能重置 dummy 至实际玩家，参数观察器在声明的完成消息窗口记录端点，之后再验正常 Main 收尾与存档，不把收尾位置误当路径失败。来源 Main、Puppet、标签、索引、未知正文不为观察器修改。

下列边界继续明确阻塞：循环/跨层寻路、非普通/bird presentation、非规范 Z、缺动画、骑乘、实际玩家的移动状态 magnification/专用回调、已有 NPC controller 的控制权和未知调用者。已有相机 Lerp 的来源 clock 顺序保持；活动 Route 与竞争移动、SetPos 或会重置 dummy 的相机选择之间不推断取消语义。

活动 Puppet.Route 沿现有 script Move/相机插值存档屏障，不能从存档获得策略或活动 Task。稳定边界使用现有 Storage/恢复流程，宿主重新提供策略；恢复不执行 Route 或初始化器。它不复用可独立持久化的 assigned-NPC-route cursor。`puppetRouteExecutions` 是不存档的执行证据，不是路径或状态 owner。

## 完整来源与验收

固定源语料有 3304 个物理程序、186003 条指令。Route 全族为 172 个源点、84 个物理程序、87 个 map alias roots、53 图、82 种参数组合。原数据、SourceRef（包括十进制字符串 objectId）、完整后继、未知依赖均保留；新编译后只有 44 个完整命名空间闭包在 operand 层闭合，不能据此称剧情可玩。

```sh
python scripts/inspect-puppet-route-native.py --report build/reports/source-puppet-route-native.json
node scripts/compile-source-candidates.mjs --compiled-dir dist --output build/source-candidate
node scripts/check-source-puppet-route.mjs --compiled-dir dist --candidate-dir build/source-candidate --output build/reports/source-puppet-route
```

共同候选的完整 runtime、输入锁、两个 world 的全部 649 地图和 object bytes 在消费前后都验证。该 checker 不重复编译共同 producer、不读取旧公共集合来满足缺依赖；source/runtime 变化会使回执失效。

输出分别记录原地图初始化后执行完整原正文、受控系统宿主执行完整原正文，以及原始 Route 参数在显式声明演员/相机夹具中的执行。公共 startEvent 仅是正文观察入口，不是 contact 剧情可达性。选择分支、时钟预算、原入口缺失、脚本/媒体/资格阻塞保留。受控参数夹具的空白地图和位置不是原游戏地图、调用者或 owned 名册。

私有初次参数验证覆盖全部 172 点：170 点完成并经 Storage 恢复，另 2 点因受控宿主缺 `Damage`/`stop` 动画保持 unready；其中 79 个相机参数完成。这个数字不替代完整正文、原初始化、故事连续性或真实浏览器验收。正式同代结果以 `check.json`、完整语料/依赖 artifacts 和父级发布回执为准。
