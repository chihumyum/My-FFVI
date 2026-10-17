# Web 世界交通身份交接

`GameSessionRuntime.retainedWorldTransportation` 可显式选择 `web-retained-walking-magitek-world-entry-v1`。生产 app 与共同 source-route checker 使用相同值。这是 Web 平面地图策略；不声称恢复原生 Bird/FlatBird、飞船、Search/raycast 或逐浮点一致性。

这项策略只授予已有交通 owner 的两种确切来源身份：步行 `id=1,type=1,asset=0` 和魔导装甲 `id=6,type=12,asset=38`。目的地图必须同时提供已有的 `walking-magitek-framework-v1` 与 `framework-world-map-flat-v1` 内容声明。可选 runtime 策略不改变旧 walking-only 包的准入；缺这些声明时不提供新能力，已有装甲门槛仍会阻塞。

真实切图仍由 `Transportations.projectMapEntry` 读取当前 release flag 和停车所有权。当前与选中身份必须相同；准备候选不会将交通改成 walking，不会将停车图或时间戳改成目的图。`MapPartyEntry` 复用既有队伍演员刷新、装甲外层/角色内层、位置/层/朝向、碰撞、摄像机偏移与隐藏演员规则。WorldSession 将这些变化和持有状态、原始初始化、媒体准备纳入同一次发布；失败、取消、过期候选不会留下部分变化。

恢复路径显式区分于实时切图：先从可信原始演员库存和当前来源地图重建静态输入，再由既有 Field 保存 codec 核对保存的交通、owned 记录、release flag、实际演员内外层和来源内容。不会重放 SetVehicle、RideOn、MapSetup 或来源初始化。策略由外部宿主重新提供，不在存档中授权，也不增加交通状态 owner 或保存版本。

世界地形与普通碰撞仍是独立输入。地图具有已编译的 world terrain 时使用现有交通类型 1/12 的来源碰撞规则；没有它时保留已验证 ordinary source collision 与现有 Foot 协议。没有世界 terrain 不代表没有碰撞，更不会将未知 FootInfo 或 uniform-zero 的适用域放宽。PointIn、linked opener、当前旗标、多队伍、伙伴、几何和媒体缺口保持原门槛。

完整来源分母由 Map → Area.map_type 定义：16 张 world-area 地图（其中 14 张 loop3、578/586 为 loop0）与 8 种来源交通身份。`check-source-world-transport.mjs` 消费同 runtime 的纯 public prerequisite candidate，复用 `compile-source-assigned-routes.mjs` 输出，生成 128 参数矩阵、全部 190 个交通/词法相关物理程序、全部进入世界的原始 ChangeMap 点及世界原 namespace/依赖闭包。277 个明确交通点与 497 个词法相关点分开；后者不会因名称相近而获得能力。原程序、源 PC、raw hash、未解析依赖和所有失败都保留。

```sh
node scripts/compile-source-assigned-routes.mjs --root "$PWD" --compiled "$PWD/dist" --output build/reports/source-assigned-route-candidate
node scripts/check-source-world-transport.mjs --root "$PWD" --compiled "$PWD/dist" --candidate-dir build/reports/source-assigned-route-candidate --report build/reports/source-world-transport-check.json
```

编译器命令复用已有全649图共同 producer 和输入锁，不读取 content-packages 当前集合，也不发布资源。旧 battle/opening 比较输入若可能被 publisher 更新，应先固定到私有同源输入快照；不能在公共发布中途消费可变旧包。

`tests/world-transportation-entry.test.ts` 验证精确身份、原始/呈现视图、恢复与实时模式、未知策略和来源入口拒绝。`tests/world-transport-session.test.ts` 使用真实 Session/Flow/Repository/MapLoader/Handoff，覆盖两身份周期和非周期切图、停车不改、媒体失败/取消/重试、战斗返场、稳定和事件存档及继续。内容为可再分发的受控夹具；其 synthetic source-style 初始化在启动前声明全部资源，不能计作原剧情到达。
