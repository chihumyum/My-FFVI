# 共用调查点与隐形碰撞物

2026-10-11：来源 `object_type=5` 的无贴图 `FieldMapObjectDefault` 接入 Web 地图运行时。它可以有实体碰撞、直接 Talk 或 RunScript，不需要角色媒体。带贴图的变体仍需独立资源适配，不能替换成 NPC 图片。

## 来源依据

GameAssembly SHA256 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，metadata SHA256 为 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。`build/native/map-object/` 和 `map-object-action/` 的十条方法记录已核对 PE 字节、反编译文本、符号表和头文件摘要，工具收据的 `semanticsVerified:false` 保持不变。

| 来源位置 | 采用的语义 |
| --- | --- |
| MapManager.CreateEntity `0x305420` case 5 | 从通用地图物体预制体创建；assetId 小于 1 调用无参数 Init，正值走带 Sprite 的另一条 Init |
| PropertyDefaultEntity.ConvertPropertyToData `0x9F22D0` | 继承 PropertyTalk；collision 缺省 false，与 NPC 的 true 不同 |
| FieldMapObjectDefault.Init `0xE13960` | 无资产时移除影子；collision=false 将 collider 改为 trigger；碰撞尺寸为来源 Size 减 (2,2)；设置交互方位与图标；动作 0/9 不能确认交互 |
| 构造器 `0xE15C00`、GetEntityPosition `0xE13790` | 默认 CanAction=true；交互位置是根位置加 Offset 对象局部位置 |
| IsAcceptActionDirection `0xE148A0` | up/right/down/left 为 1/2/4/8，方向为目标到玩家；共享已恢复的相邻格选择 |
| Hide `0xE138D0`、Show `0xE15AB0` | 零持续时间通过 active 状态禁用/启用物体；当前接入即时隐藏，动态移动/定位及其他生命周期仍保持阻塞 |
| EventAction.CraeteTask `0x7AE9A0`、RequestActionTask `0x2CE760` | NPC 与此类物体共享 Talk/RunScript；RunScript 使用来源 SE，普通 Talk 的动作 SE 为 0；实际音效仍记入静音开发表现通道 |

已读取 `chara_field` 来源包中的 `Assets/GameAssets/Common/Res/Map/Field/FieldMapObjectDefault.prefab`。组件 ID `-1942711263248382661`，SpriteRenderer 的 `m_Sprite` 为空，BoxCollider2D 开启且默认非 trigger，14×14，偏移为零；Offset、visualParent 和根的局部位置均为零。对象 ID 在研究收据中保留十进制字符串，未通过 JavaScript number。

无参数 Init 不执行带 Sprite 的 `0xE13D40` 分支中 affected/front 的材质修改，因此无贴图物体不会因为 `affected=true` 被误当作待适配的 NPC stencil。完整预制体证据位于忽略目录 `build/reports/map-object-prefab.json`，摘要 `5806673ded1888a2675b9a56bdc42424e888501cd02237a705ef75c9038586a1`。原生批次收据摘要分别为 `f070d250bc2e31b9cee5b6c0a72a078e8d517a5be77210abbe8ba3a1fcb1ce25`、`dfcd0b6153dd1701dc576ad8fdf3baf897f5a121bd88dcf6c57699ac7f9040a3`。

## 实现与边界

`src/compiler/interaction.ts` 拥有共享的来源动作、消息、方位与运输身份适配。NPC 仍由 `npc.ts` 附加移动控制器、碰撞缺省与转头规则；MapObject 由实体编译器附加自身碰撞缺省。两类目标使用同一个确认键分派与 VM，脚本根仍为玩家，不能把调查物体自动绑定成主演员。

MapObject 留在逻辑实体集合，不创建 Actor，不需要伪造角色贴图或站立动画。移动与斜坡路径检查均考虑它的碰撞；隐藏后不再阻挡或接受交互。NPC 与物体同时成为候选时仍报歧义，不按列表顺序选一个。

本批仅支持格子对齐的 16×16 gid 矩形，采用现有 Web 格子移动模型。原版 14×14 连续碰撞接触、同格或远距选择/柜台 Relay、交互提示图标仍未复现。非零 asset、特殊尺寸/偏移、鸟瞰、未恢复条件/文字控制符和其他动作继续阻塞。不会以无图像为理由丢掉逻辑对象；也不会将它们的移动/定位指令静默当成成功。

## 验证

125 项 TypeScript、18 项 Python 及登记契约检查通过。新增回归覆盖两类实体的不同碰撞缺省、无角色媒体的交互、隐藏后通行、方位/层/载具、脚本玩家根、声音请求、空脚本、NPC/物体歧义，以及未知几何/动作保持阻塞。

`npm run objects:check` 与 `npc:check` 使用同一个 `scripts/check-interactions.mjs`，扫描全部编译地图并按来源去重。隔离检查使用原始对象和完整原始脚本，玩家放到受控相邻格，其他对象/地图初始化不注入，剧情 flags 仍未知。完整地图的入口载入、调查点实际可走到、浏览器表现和剧情可达性分别报告。批量结果见 [当前进度](progress.md) 与 `build/reports/map-object-check.json`。

本批收尾后按 [核心机制盘点](core-mechanics.md) 优先推进共用战斗和角色系统。

## 本批结果与实玩

全量原始 kind 5 为 848 个，其中 841 个进入有已识别图层的编译实体清单。隔离检查中 447 个为受支持非交互对象、107 个排除、287 个动作：30 个 Talk 完成，257 个脚本因其他依赖/未知状态停止。另对保留实际默认实体和初始化的 16 个交互上下文进行受控相邻放置，1 个完成、15 个停止；它们不证明玩家从入口可走到对象。

`check-object-flow.mjs` 另保存一次可重复的来源组合回归。正常载入地图 293 入口 1，玩家从 (114,36) 走过原始斜坡到 (117,29)，与阻挡通道的 NPC 9 交互。原始 `sc_e_0892` 把 NPC 移至 (119,29)，设置 MapLocalVariable[2]=1 并显示对白；通过后走到 (116,27) 调查物体 4，`sc_e_0335` 操作区域 14 的帧，并正常返回，玩家最终走到 (115,27)。测试路径是来源参数，游戏运行时没有新增地图/实体 ID 专用分支。

同一路径在 Codex 内置浏览器实走，检查到 NPC 让路、来源对白、通道可通过、确认调查后恢复移动；没有捕获警告或错误。截图 `build/reports/map-object-browser-dialogue.jpg`、`map-object-browser.jpg`。浏览器未核对瞬时图块帧或音效；SE 102 与 SyncSE 的静音省略使两次 CueAnim 几乎连续完成，这个演出缺口仍保留。开发预览沿用开场队伍/装甲，剧情时期及主线可达性未知。

来源 master 把地图 293 归到歌剧院 area 39；知识登记只加入默认实体/脚本绑定与局部变量分支的 observed 事实。该资源包也在父来源清单内，并核对了同一 SHA256，因此事实绑定父来源指纹，而不把后续语义自动跨版本传播。没有把这间房的交互当作歌剧演出已迁移。

重编后 649 个地图包中，524 条几何/包引用就绪、194 条默认实体就绪、150 条同时满足。314 个尝试入口中 131 个到达空闲，分布于 63 条地图记录；183 个入口阻塞、499 条地图排除。无逻辑阻塞组绑定为 758，16 份脚本 / 17 个地图上下文 / 42 组受控输入完成；相邻地图往返为 6 组，原有五次开场遭遇回归通过。

共享交互检查器现在也排除层级/组范围的来源阻塞。NPC 旧孤立计数相应少 13 个候选，属于修正统计范围；最新 589 个非交互、863 个排除、659 个动作（180 Talk、107 空脚本、10 有内容脚本完成，362 脚本停止）。没有修改 NPC 的可执行控制器范围。

| 当前产物 | 内容摘要 |
| --- | --- |
| 世界目录 | `4e91a99f4dad36a0f2b77872166fd9b10e9874e39ffc607d647c389c7a607c14` |
| 开场包 | `b1295160bbb544c6ad8a753c992ec66e425f9260e890ec6a6c25f8c6dcddf4b5` |
| world-check.json | `e20e55dd182007248a212f93702cf6e5ee900b1a4d225b1759042b06d937d7cc` |
| map-object-check.json | `2430f72c74132fa58f085e6db65f2f33d396b05cbfc5d5db60dd0afdd07494c2` |
| map-object-approach-check.json | `b24fbc8f41aa48bd1cd19cee871fb4dc538ae7a22ea90dff94d169c376fedfab` |
| map-object-browser-check.json | `a8fdf029fdfd6eeac2c014a2e9d85a85ef7e4141d0f79ed8cbf4a3a359a619f8` |
| npc-check.json | `90d4682fb25f529244b5ce973a7d29cd93300c253c37d0883963fbc5bcf43cb4` |
| minimap-check.json | `1f4d3eff2221eb498a671ed4a250afab8634e9db5985595c3f9b371942af319d` |
| entity-group-check.json | `e9a6d5e9ad99f78280773a21586dd3ce9aa13d1e2a4a2b6a39b1621940951dc4` |
