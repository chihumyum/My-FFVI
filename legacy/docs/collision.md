# 共用地图碰撞

Web 优先；此模块恢复原游戏通行能力，不是 HD-2D 几何。2026-10-10 用户再次确认只推进 Web。正式原版运行对照仍后置。

`src/core/collision.ts` 将原始碰撞 ID 转成方向图。`FieldGame` 保留原始网格，首次需要斜坡时按层建立静态方向图；实体激活、隐藏和角色位置在移动时独立检查。地图 ID、坐标、地区名称不参与规则分派。

## 来源与解释

绑定 DLL SHA256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`、metadata SHA256 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。两份指纹均由世界编译器检查。

| 来源 | 本次采用的语义 |
| --- | --- |
| `MapConstants..cctor`，RVA `0x43B490` | CollisionFilter、DirectCollision、四组 DiagonalBinaryInfo 常量 |
| metadata `0x4DF192`，56 字节，SHA1 `8c4fa5d2e9c81cd19f19da7fe51db94b4413c3c8` | CollisionFilter 为 `[15,0,14,11,7,13,6,9,0,0,0,0,0,0]` |
| metadata `0x4DEBBA`，56 字节，SHA1 `313f7a37a0d731df68f640f81946e99cbba07b2b` | DirectCollision 为 `[0,0,0,0,0,0,0,0,11,22,208,104,219,126]` |
| `ParseCollisionMappingData`，RVA `0xB25C40` | 先填基础掩码，再按来源顺序为斜角两侧的相邻格增加对角边；斜角格自身保持不通 |
| `FieldColliderEntity.Init`，RVA `0x87C7D0` | 碰撞体的 direct 来自 DirectCollision |
| `GetDirectHorizontal` / `GetDirectVertical`，RVA `0x87C6E0` / `0x87C750` | 按撞入侧决定沿斜角转向的另一分量 |
| `FieldCharaEntity.UpdateRaycast`，RVA `0x87B2B0` | 以输入的负分量调用上述转向函数；原程序还执行 Physics2D BoxCast |
| `ParseMapRange`，RVA `0xB277C0` | 读取对象类型 27 的 x/y/width/height，除以 16；不检查对象 visible、不使用图块底部锚点 |
| `GetIsLoop`，RVA `0xB253E0` | loop_type 0/1/2/3 分别为不循环/横向/纵向/双向 |

本地反编译收据位于 `build/native/collision-grid/complete.json`、`collision-movement/complete.json`、`collision-init/complete.json`；这些目录不提交。收据确认导出完整及字节指纹，不确认原版行为等价。

方向图使用上 1、左 2、右 4、下 8、左上 16、右上 32、左下 64、右下 128。ID 8–11 是四个方向的三角碰撞，12/13 是两种斜坡。它们不能被当成普通墙或无碰撞地板。

保留两处源程序细节：垂直邻格检查的是 V 与 V-reverse；对面格不能普通通行时，只有裁切后局部索引 **大于零** 才检查其反向斜坡。二者均有边界用例，不以看起来更对称的规则替换。

## Web 移动适配及边界

先尝试原来的水平/垂直移动。撞入斜坡时，依据碰撞体转向函数得到对角目标，要求方向图中出发与返回边都存在。目的地及经过的两个拐角继续检查动态碰撞和 NPC。只有整步提交后才执行目标格触发器；不可在插值中途触发。静态来源内容在 FieldGame 生命周期中不变，动态状态由实体与角色持有。

MapRange 作为默认实体组中的元数据保留，隐藏的范围对象也有效。相机使用这个范围定位，小于视口的范围居中；这是 Web 相机适配，未完成原版镜头对照。范围外不允许手动移动；非法、多重或非整数格的范围拒绝装载。来源程序多重范围取第一项，Web 对歧义范围明确拒绝。事件组中的范围变更尚未恢复。

这是一层格子运动适配：沿用当前每步 240 ms 和四方向面向，动态斜向扫过范围采用保守阻挡；没有复刻 Unity 连续 BoxCast 的精确运动和接触体积。动态碰撞对象类型 19 的 8–13 形状仍明确阻塞。方向图函数支持循环边界测试，但循环地图的相机与画面接缝尚未实现，因此世界编译器仍阻塞 `loop_type != 0` 的地图。不能由该模块关闭原版时序、物理或世界地图验收项。

## 批量检查

`npm run collision:check` 验证当前全量世界包指纹，提取原地图范围与各层碰撞，使用同一个 FieldGame 实际执行方向图中的斜向步进。该测试隔离 NPC、剧情与触发器，单独验证共用几何；输出 `build/reports/collision-check.json`，不计作可玩地图数量。

`world:check` 继续用完整默认实体与初始化脚本检查入口，`playable:check` 保留开场战斗回归。合成测试另覆盖四种三角、两种斜坡、阻挡角、反向通行、来源边界细节、动态障碍、NPC、触发时机和未知值拒绝。
