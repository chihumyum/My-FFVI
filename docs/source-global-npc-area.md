# 全来源 Area NPC 的共同派生

这项管线把已有的 `framework-npc-area-v1` 机制应用到完整来源世界，不再为每张地图另写控制器。`assessFrameworkNpcAreaWorld` 必须接收匹配的严格来源目录和全部地图；每张地图、原始对象和失败对象都进入评估。固定来源有649张地图、121张受影响地图、356个原始Area对象；338个能按已声明策略派生，18个未就绪。它们是静态对象分母，不是可玩剧情地图数。

`frameworkNpcAreaTemplate` 显式选择来源构造默认首次间隔、Web xorshift32、现有演员网格预约、固定步长来源顺序以及事件接管时暂停自主移动。模板、每图assessment和host都绑定原始map hash、source set及parent source set。随机流、移动、Actor.motion、动画、交互、组事务、暂停、切图和存取继续由现有Field/World/Session持有，不新增游戏状态或时钟。原生随机、Guid顺序及实际原版运行仍未验收。

严格编译的默认选项保持不授予能力。公共生产者在 `compileSourcePrerequisites` 明确传入npcAreas，取得完整649图assessment，再由既有框架派生器安装host。初始化配方v4/v5复用同一assessment/helper，保留其既有host字节。`compiled-framework-npc-area-addition-v1` 只允许由锁定原始source world/maps重新计算的元数据及标记增加；动画、指定路线、几何、来源脚本和其他profile仍由各自完整身份检查。未被配方引用的来源地图也要重新核对，不能仅检查成功地图。

公共生产者与完整来源候选工具使用 `webSourceFrameworkInputs()` 返回的同一组显式参数和原因。它只集中调用方的选择，不改变严格编译器的默认值。NPC、地图动画、循环地图和逻辑特效因此在同一共同能力集合中验证。每次取得独立参数对象，不能通过修改一个候选的声明影响下一次构建。

`inspect-source-global-npc-area.mjs` 重新使用共同前置生产者生成严格世界、框架世界、入口与战斗目录，并保留完整原始程序、Resident命名空间、地图根和中央依赖。执行读取的是这次生成的 `fresh-battle.json`；命令行旧battle输入仅用来比较owned初始化域，另以 `priorBattleInput` 留证，不得作为新鲜来源战斗验收。输入锁在结束前重新核对。`check-source-global-npc-area.mjs` 消费这套原字节产物，通过与app相同的Session/Flow/Storage及显式Web宿主尝试全部原初始化，再观察已有NPC的运动与恢复。

```sh
node scripts/inspect-source-global-npc-area.mjs --compiled dist --battle build/game/source-catalog.json --output build/reports/source-global-npc-area
node scripts/check-source-global-npc-area.mjs --compiled dist --inventory build/reports/source-global-npc-area --report build/reports/source-global-npc-area-check.json
```

工具不发布公共集合。单图PointIn入口、媒体确认、初始名册和完整原程序结果分别记录；提供器错误、缺失地图几何、失败原初始化、未支持的控制器和后继操作完整保留。受控机制覆盖自主移动、指定路线、地图动画和震动并存，以及暂停、存取、战斗返场和取消重试；它们不授予原主线可达、浏览器呈现或原版动态一致性。
