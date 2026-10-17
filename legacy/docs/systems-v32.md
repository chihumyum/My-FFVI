# 系统集成 v32

本批接通普通原生角色外观刷新与跨地图的常驻演员交接。真实来源新游戏已执行 `sc_e_0001` 的 condition 607，接着发出 map609→map3、入口1、continuation=`sc_e_0001_1` 的请求。目标地图仍明确阻塞，完整开场、原生演员稳定保存和全游戏迁移尚未完成。HD-2D 未启动。

## 一次事务中的角色、外观和镜头

`FieldPartyActors.prepareSequence` 先按来源顺序投影全部目标，再交给一个 renderer 批次。owned condition、编队与名册在提交之前执行外观预检；媒体、角色或镜头状态改变时，整批拒绝。重放和已失效的候选不能发布。此前先提交 owned、后发现外观校验失败的缺陷已有失败回归和修复。

普通 walking 外观直接更新 `FieldGame.actors` 中已有的 native/entity，保留身份、坐标、方向、层、显隐和材质绑定；动画实例按来源 SetAssetStructure/OverrideOldData 刷新。时间和播放状态来自旧实例，时长、模式和翻转来自新资源；缺少旧键时才按来源方向和 Default 回退。原始动画键全集独立于可播放动画，源键存在但尚未编译时阻塞，不能伪装成键缺失。基础类尚未被准入路径消费的 isLoop/IsEnd 不冒充已迁移；其查询或更新需要后续扩展。

同一批最后一个非空镜头偏移进入现有 `FieldGame`，null 表示不写。没有增加另一个镜头或角色状态所有者。condition607 在该来源构建中没有字段替换规则；三名角色的状态更新不推导出装甲贴图。实际交通切换仍需交通系统自己的证据与宿主。详见 [外观](field-native-appearance.md)、[批次事务](field-party-actor-transactions.md)。

## 普通地图交接

MapSetup 保留已存在的居民、四个 puppet、三组其他队伍实例，实际玩家按来源外观刷新后执行 PointIn 初始化，保留来源允许继续播放的同方向动画；居民世界坐标和动画不执行保存加载专用的 ResetPositionResidentCharaEntityList。目的地图重绑已准入的材质输入，隐藏七个队伍表现实例，镜头重新选择玩家后再交给 initializer/continuation。

`WorldSession` 从当前唯一演员集合读取临时候选，在私有目的字段安装，再连同 owned 草稿、剧情变量、音频、渐变和镜头发布。准备失败不改旧字段；隐藏演员或其他状态在准备后改变也会拒绝提交。停车地图来自 `GameState.nativeState`，不再用空字典替代来源初值。玩家 CharaZOffset 修正为 PointIn.Init 的0.5。

独立集成审查复现了 HidePlayer 后切图误读旧 `hiddenEntities` 的缺陷。PointIn 现在从 `FieldGame.isEntityVisible` 读取实际演员的可见性；真实 VM 的 HidePlayer→ChangeMap 回归验证准备前、私有候选和发布后都保持隐藏。

独立 nativeFoot 描述符绑定准确的 package map 和 Attribute 缺失事实。角色水体透明所用 `GetCellAttribute` 与默认遇敌 monster set 分开；map3 虽有 monster_set129，仍有独立证据证明其无 Attribute，原生查询返回0。其他属性网格继续阻塞。详见 [常驻演员交接](source-native-map.md)、[原生脚下属性](field-native-foot.md)。

上层/顶层非空的 Canvas 合成、原生地图局部 NPC、骑乘与 retained rider、companion、多队伍定位和稳定 native save codec 仍分别阻塞。纯候选通过不能使缺依赖的地图自动可玩，也不允许在原生字段静默创建旧式 NPC。


浏览器回归发现并修复了旧入口的实际渲染错误：来源背景循环曾放在全图 overview，使用不存在的局部变量，导致 `m is not defined`；同时正常 draw 没有绘制背景。背景投影现放在正式画面的清屏之后、图块之前，全图 overview 只画其地图图层与标记。来源背景的 Canvas 调用检查与最终浏览器像素观察分别记录。

## 验证和后续

运行 profile 为 `narshe-playability-v32`，owned v8、field/world v8、session v3、camera v2。没有开放新的保存格式或改写用户存档。

真实来源会话在固定10ms更新和受控音频就绪下执行11,020ms：55个演员保留身份，3个持有人分别得到来源状态row53/type607，镜头偏移为(0,16)，下一条指令19请求map3。准备该地图准确返回 `Unsupported entity kind 11`，旧字段和已完成的状态事务保留。原生字段仍拒绝稳定保存。这一检查使用5个经摘要核验的包，包含8项断言；没有运行原版或完成全开场。

最终 `npm run check` 为1,220项通过、0失败，知识注册表有效；Python为22项通过。93条来源、运行时和UI检查命令全部成功。新增地图交接有16项单元回归、9项来源检查；Canvas检查含12项实际 Renderer 调用约束。原生静态回执保持 `semanticsVerified=false`。

浏览器实测旧入口完成守卫对白、首战、96 EXP / 96 Gil结算、战后升级与HP菜单、返回地图、继续移动和全图总览。来源入口实际显示背景、字幕、镜头移动与渐变，最后在 `sc_e_0001` 指令19显示 `Unsupported entity kind 11`。两条路径控制台无警告或错误；未读写用户浏览器存档或操作原有进度标签页。旧入口仍是开发回归片段，不能证明来源新游戏已连续贯通至首战。

验收回执在本地 `build/reports/systems-v32-validation.json`，记录命令、内容摘要和浏览器截图；来源素材、提取文字与生成文件不提交。没有原版动态、完整开场、GPU材质一致性或多浏览器结论。

下一批继续补共享地图实体生命周期、上层合成、原生 NPC 与稳定保存，将已有战斗系统连接到连续来源流程。地图记录数不计作可玩覆盖，区域填充仍等待系统闭环。
