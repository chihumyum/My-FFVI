# 纳尔谢 Web 场景运行时

2026-10-10，用户要求先跑起来、用实际操作判断基本可玩性，一致性对照后置。本里程碑是独立 Web 场景入口，不是完整纳尔谢迁移，也不是整部游戏已可通关。

## 当前可操作范围

`npm run game:check` 编译并检查真实来源片段；`npm run dev` 后打开 `/game/`。进入开场行军结束后的显式开发检查点 `(38,49)`，方向键/WASD 移动，空格/Enter 确认，Esc 暂停。向上 11 格触发守卫出场、对白与靠近，随后由 GameSession 进入首场守卫战斗，胜利后执行 `sc_e_0002_1` 并继续移动。战斗需 `npm run battle:build`，详见 [可玩开发规则](battle-playability.md)。连续街道遭遇已有内核回归；通用地图加载和切图请求见 [地图生命周期](map-lifecycle.md)，完整相连地图流程及存读档仍未完成。向后触发尚未支持的事件也会停止，不能当作完整地图自由探索入口。

浏览器已实际验证：地图与骑乘角色可见；起点左右受阻；短按及按住前进；暂停时不能移动；恢复后继续；守卫分两阶段移动；对白锁定玩家输入；确认后进入首战、取胜、结算并返回地图。控制台未见警告/错误。只检查了 Codex 内置浏览器，尚未完成 Chrome/Safari/Firefox 与性能验收。截图位于忽略的 `build/runtime/web-narshe-dialogue.png`。

音频、雪/烟等环境粒子、原版精确镜头/字体/时序、开场影片和完整地图初始化未接入。角色动画与骑乘组合来自源资源和静态程序分析；当前浏览器画面看起来可用，但不宣称像素或时序等价。

## 模块边界和重建

- `tools/source_adapter/export_field.py`：校验已有 import 与安装源，提取五个角色包的动作和所需 Sprite，以及分命名空间的中文文本。PNG 用内容摘要命名，保留 Unity 对象字符串 ID 与序列化文件。前后校验来源，临时目录构建后替换导出。
- `src/compiler/field.ts`：验证父/扩展来源和所有导出字节，解析原表引用、实体组、场景和指令；未迁移操作与参数形态编译为有来源位置的停止指令。
- `src/field/types.ts`：浏览器可消费的内容契约。
- `src/core/field.ts`：整数 10 ms 逻辑步、逐格移动、方向碰撞、实体阻挡、脚本 Call/Return、角色子任务、等待、对白和明确的战斗边界；不依赖 DOM。
- `apps/game/`：Canvas2D 图层/动画/角色与键盘、暂停界面；读取编译内容。与 `apps/workbench/` 检查台分离。

```sh
.venv/bin/python tools/source_adapter/export_field.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
npm run game:check
npm run dev
```

基础来源集 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`。扩展来源集 `4e4f77b10afe8d2273d4acb1876cf87b015088450513941cdae5b575952db8e3`。五个角色导出共 49 个命名 Sprite 引用；物理 PNG 按摘要去重。编译输出与收据在 `build/game/`，不提交原图、对白或游戏数据。

## 来源定位和解释边界

### 开场检查点和实体

`Map_20010/sc_e_0001_5.json`：指令 29 `SetPos(38,58)`，47/63/116 分别向上移动 2/6/1 格，得到 `(38,49)`。开发入口直接声明这个检查点，没有声称完整执行开场脚本。入口的世界/剧情 flags 不被推广为其他地图的默认状态。

`sc_map_20010` 的开场分支及包内引用用于选择 `entity_default`、`ev_e_0609`、`ev_e_0002` 至 `ev_e_0006`。完整条件求值、后续重访和世界变化仍未迁移。`ev_e_0003` 有 119 个动态碰撞对象中的一部分，阻挡骑乘路线；不能只用地形碰撞网格。当前编译只支持该开场组中无条件的动态碰撞，其他条件形态必须拒绝。

实体 177 在 `(38,38)`，`script.csv` 的 7 号记录指向 `sc_e_0002`。脚本操纵实体 164、165，先到 `(37,35)` / `(39,35)`，对白后到 `(37,38)` / `(39,38)`，面朝主角，再执行敌方队伍 3 的战斗入口。这些具体坐标用于本地源集集成检查；该检查不构成独立原版对照。

Tiled 有 gid 的对象以底部为锚，转换为逻辑格坐标要减去对象高度；普通矩形不减。源 JSON pointer 记录数组索引而非 Tiled id。若 entity_id 为 0 或缺失，使用组/层/对象路径作唯一身份，不能误把多个环境效果合并。

### 碰撞静态证据

所绑定的 `GameAssembly.dll` SHA256：`1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`；`global-metadata.dat` SHA256：`9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。编译拒绝其他 native profile；开场检查点还锁定上述基础来源集，源集合变化时必须重新审核入口和组选择。

IL2CPP `MapConstants` 静态构造 RVA `0x43B490`，在 `0x43BD88` 写入 CollisionFilter。关联 PrivateImplementationDetails 字段 SHA1 `8C4FA5D2E9C81CD19F19DA7FE51DB94B4413C3C8`，metadata 偏移 `0x4DF192` 的 14 个 int32 为 `[15,0,14,11,7,13,6,9,0,0,0,0,0,0]`。`MapUtility.ParseCollisionMappingData` RVA `0xB25C40` 使用该表，并为对角碰撞另作处理。

共用碰撞模块现已解释静态 0–13：8–13 根据来源规则建立相邻格之间的对角边，再由碰撞体转向规则接入键盘移动。动态对象与角色仍会阻挡；动态斜角对象尚未支持。详见 [共用地图碰撞](collision.md)。方向碰撞位和面向枚举不同；半格边界与连续物理的精确等价仍等待正式对照复核。

### 角色与骑乘

主角 `field_character_asset.csv` 1 → `mo_ff6_p001`。魔导装甲 38 → `mo_ff6_v006_c00`，这不是 `mapobject.csv` 的 38，也不是战斗角色外形相近的其他资源。守卫 `mapobject.csv` 51 → `mo_ff6_n043_c00`，犬 57 → `mo_ff6_n049_c00`，魏吉/比格斯 31/32 → `mo_ff6_p021`。

FF6 TransportationEvent 构造 RVA `0x40ACC0`，`0x40B23A` 至 `0x40B4C7` 为 transportation 6 的骑乘映射：Default/WalkB 保留，WalkL/WalkR → RideL/RideR，bodyActive=false，构造参数 hideFeetUnitNum=8、floatingUnitNum=14。运行画面使用装甲与上半身合成；精确裁剪、基准脚底偏移和帧停止位置暂为实现解释，不能标为已验证原版规则。

动画从 `anim_info.json` 的 frames、is_reverse、next_anim_name 等读取。原版 LinkToMovement 的完整调用链尚未恢复，当前按格内进度播放并按步交替后继动作；不由此关闭时序验收项。

## 当前战斗交接

从 `sc_e_0002` 指令 5 的敌方队伍 3 解析敌人、位置、战场与后继脚本 `sc_e_0002_1`。恢复开场三人队伍、魔导指令和必要战斗规则，先完成可选择招式/目标、行动、伤害、胜负与返回地图的闭环。不要用按钮假结算或按演示结果硬编码 96 EXP/Gil。奖励、剧情标记、随机行为和状态恢复必须由本来源数据/规则驱动。正式对照暂时后置，未知规则留证；当前 profile 的临时实现见 [首战规则](battle-playability.md)，不会放行正式验收。
