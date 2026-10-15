# 来源字段内容许可

本族只接入 `InvalidateTelepo` 的字段内容排除效果，不实现传送动作或缓存。完整来源为 3,304 个物理程序、186,003 条指令和 649 份地图绑定；提名保留四个相关指令族的全部 24 个物理站点。`CastTelepo` 只有一份 Resident 正文，但安装在全部 649 个地图命名空间，不能把它计成 649 个已实现动作。

`InvalidateTelepo` 有 8 个物理站点、8 个逻辑根，分布在 6 张图。来源参数均为 MainCore type 1、八整数 `[1,0,0,0,0,0,0,0]`、八零实数和八空字符串。其余三个指令族共 16 个物理站点继续阻塞；本轮完整程序提名不按这些未知项过滤。

原生 wrapper `2c9a30` 并不把 `i0` 直接传作枚举。完整 PE 的 `neg / sbb / and 2` 将零转为 InvalidAll 0、非零转为 InvalidTelepo 2，从不传 EnableAll 1。IMapAccessor slot 96 经 FieldController `2dfc10` 调用 ContentInvalidController `9e3d50`。后者只向普通列表与存档点列表追加正 Value1，先 Contains 再 Add；InvalidTelepo 分支另要求实际 GameConstantInt.Value2 为零。它不删 ID，也不修改交通列表。当前完整来源常量派生为内容 23 和 412；六图的原 `movingAvailability` 都为 1，指令对这些原本可用的内容产生实际禁用效果。

状态归当前 FieldGame。不可变地图许可与常量仍来自原目录；Field 仅持有已执行指令的精确绑定，当前查询按同一来源列表规则投影。菜单、编队的入战依赖、完整 Encount 概率池预检以及实际入战都读取同一 Field 状态。单独的战斗使用提供器仍按原规则过滤 23 和 412，不能拿它覆盖命令级当前列表。

同图菜单与战斗返场保留该状态。新地图创建空的许可寄存器，地图候选成功发布才替换旧 Field；媒体失败、取消和过期候选不会清除旧状态。原生 MapInitialize `2e39a0` 调用 `UpdateInvalidTarget` 清空并重建三份列表；Web 切图沿既有候选/提交边界执行这项生命周期，不新增 World、Session、库存、旗标或随机状态所有者。

执行过指令的字段使用 `idle-field-v15` 或 `event-field-v6`，其中 `contentInvalidations` 保存当前目录身份、实际安装脚本的 Web PC 和完整原指令绑定。恢复必须从可信内容重新验证，存档不能提供常量、程序或能力。未执行该指令的内容保持原 v10–v14 / event v1–v5 形状。稳定 Web 保存继续保留当前 Field 的效果且不重跑初始化；这不是已证实的原版存档序列化规则。

来源物理程序、locals、原操作数、所有安装别名和完整依赖单独保留。原图初始化与作者地图上的完整正文观察是两个 lane；合法的初始 owned 状态来自相同 DataInitialize，不补剧情旗标、HP、队伍或战斗结果。提供器失败、选择和切图边界仍写入报告。测试与静态编译不代表完整剧情可达、浏览器或原版一致性通过。

可重复工具为 `inspect-field-content-invalidations-native.py`、`inspect-source-field-content-invalidations.mjs` 与 `check-source-field-content-invalidations.mjs`。原生工具只核既有完整 PE/C、符号、header 和 metadata，不导出新方法或运行游戏。来源候选在私有输入域从原始导出重新编译，不读取正在替换的公共集合。

私有验收包含 9 项语义测试与 3,974 项核心回归。实际 Session 测试覆盖菜单排除、稳定与事件保存、旧命令失效、地图媒体失败和取消、过期候选、入战媒体失败后重试、一次胜利返场。完整来源队列对 8 个根都分别请求原图入口与作者图上的原正文观察。来源正文的实体组及其他初始化提供器仍可能先阻塞；许可效果曾执行不代表完整程序、传送动作或剧情验收通过。
