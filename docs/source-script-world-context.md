# 脚本与世界地图上下文

本批解决跨脚本接力与 native Puppet 控制之间的公共上下文缺口。当前地图的世界属性和当前脚本是否以 `sc_map_` 开头是两个独立事实。它们只在实际查询 `worldMapScript` 时相与，不能从一个 false 的合取推断其中任何一项。

`FieldGame` 在安装实际 native actor owner 时捕获本地图已校验的 `entry.viewPlan` 与 map identity 绑定。`sourceCurrentWorldMap` 每次查询都重新解析并核对这份小型绑定；缺失来源保持 unknown，变更实际输入立即拒绝。native actor port 从同一个 Field 的实际 Main 任务读取当前脚本名。因此普通替换、hook 内替换和返回不需要额外状态目录，不重新运行演员初始化，也不把 root SystemFlags 替换为目标的 flags。地图候选各自绑定目的地，取消不改变现图；发布、战斗返回和 Storage 恢复仍使用原有 Session、World、Field、演员与碰撞所有者。存档没有增加权限字段。

旧自定义 port 仍只有 `worldMapScript` 时，跨名称分类的 ChangeScript 保留原拒绝规则。这里不加入“所有地图默认 false”、场景名分支或跳过目标指令的规则。缺失 alias、自定义动画、活动交互所有者、悬挂 hook 的地图/战斗交接、未知 callback 及所有原有门槛保持有效。

完整来源提名固定 3,304 份原始脚本、186,003 条指令和 649 张地图。358 个 ChangeScript 使用点来自 302 份物理程序；保留调用方和已解析目标共 498 份完整正文、37,680 条指令，以及 1,010 个地图 alias 使用、134 个名称分类变化使用和全部外部依赖。136 张受影响图与 2,203 项依赖是静态工作范围，不表示这些图已经可玩。53 份战斗程序的 2,312 条原操作、490 项原敌队请求及 7 项来源诊断均保留。

静态原生检查重新绑定完整 DLL、symbols、header、三个完整命名方法及缓存 MapModel 构造器。`IMapAccessor.CheckCurrentWorldMap` slot 27 读取当前 MapModel 的 `isAreaTypeWorld`，后者来自 Map.area_id → Area.map_type == 0。Integrator 以当前 SetScriptName 的大小写无关前缀构成合取。直接 reached Nullable<bool> shared leaf 仅记录确切七字节的 value/hasValue/ret，不以它的别名推断其他方法。没有新 native 导出或原游戏动态一致性结论。

真实 Session 机制检查覆盖世界/普通地图上的双向 hook、直接接力、同一 actor 身份、实际 Puppet 碰撞控制、候选取消与重试、Storage 恢复及 mutable 来源变化拒绝。合成程序只用于机制验证，不算原剧情到达。此前 v40 controlled source 检查器在旧父本与本批均于同一 Msg/choice 期望失败（line 138, 0 != 1）；两次失败原字节保留，未放宽检查器或改写剧情。新的全来源提名和同代联合编译分别留证。

第二 goal 仍需同代全世界生产、真实新游戏连续回放与浏览器可玩验收；本批不代表新游戏已经越过此处，更不代表到达结局。
