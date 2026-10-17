# 系统集成 v34

本批完成三个共用系统增量：原生演员的稳定 Web 存读档、普通非空 Upper/Ceil 图层合成，以及粒子曲线与来源材质公共模块。它们服务后续批量内容导入，不增加地图或剧情例外。真实开场仍在 `sc_e_0001:19` 请求 609→3 时遇到 FX 分配门禁；完整开场、系统闭环和全游戏迁移未完成，HD-2D 后置。

## 稳定存读档

field/world 升为 v9，game checkpoint 升为 v4，owned 保持 v8。原生演员只保存一次：位置、层、方向、动画游标、显隐、身体/影子开关及材质上下文；字段另保存碰撞、更新 mask、相机偏移和已完成脚本上下文。恢复从可信来源包重建身份与媒体，不运行工厂、NPC Init、Look、Cue 或剧情，也不重新发放初始库存。

新增 origin 区分开发入口与来源新游戏。来源恢复必须提供当前 bundle、初始地图与所在地图；存档自报的 hash 仅供选择与核对，不授予能力。浏览器先验证全部依赖并准备候选，再替换会话。旧格式、缺依赖或坏状态明确拒绝，保存字节不被覆盖。活动事件、骑乘、粒子和未绑定的旧地图材质保持各自门禁。详见 [原生稳定保存](field-native-checkpoint.md)。

## 普通图层与粒子公共模块

普通 Upper/Ceil 目标由真实场景相机、PlayerSettings 和原生初始化共同绑定，使用 gamma RGBA8、24 位深度、Point 采样和 320×180 来源视口。每帧单独清屏、预渲染并供身体/头部 shader 采样，完成后一次发布，再放大至 Web 画布。旧开发演员保持原路径。其他宽高比、骑乘及未恢复材质仍拒绝，阴影仍是明确的开发偏差；这不是完整 GPU 或原版视觉一致性。详见 [普通合成](field-native-composition.md)。

粒子编译器保留真实曲线、梯度、模块和依赖；纯计算器采样初始参数、寿命颜色/大小、速度与旋转速率，不代替发射器。选中的 LastEffectMaster shader 通过独立 DXBC 指令解释器对照；外部材质引用、三张纹理、采样和 gamma 设置均绑定原文件。私有 RGBA 候选可渲染明确给定的测试粒子，但不生成原生粒子运动。5 个真实发射器仍全部阻塞，Noise、随机流、预热、锥形采样与发射积分尚缺。详见 [粒子模块与材质](field-particles.md)。

## 跨图资源寿命

原始 DLL 表明 MapManager 的复制构造共享 FieldEffectInstanceManager；它不随单张地图重建。板的最后一次 Release 与资产卸载的 ReleaseAlreadyLoadPrefabs 是两套生命周期：前者销毁无引用播放器，后者清除 prefab/shared lookup，保留仍被引用的播放器及全局分配计数。

本批增加独立 `release-prefab` 操作与宿主事务事件，验证旧共享项清理、随后分配不重置 ID/位置、活跃引用保持及失败不发布。尚未接通跨图效果资源事务。后续实现需要单一共享池、按地图管理板引用、候选准备与提交以及按来源顺序卸载；不能把每图创建一套池当作迁移完成。详见 [效果生命周期](field-effects.md#shared-manager-lifetime-v34)。

## 验收与交付

运行 profile 为 `narshe-playability-v34`。源码与合成夹具进入私有 GitHub；原游戏、提取资源、反编译、截图与生成包仍在忽略目录。来源反编译和原始字节检查保留 `semanticsVerified=false`，原版运行对照没有执行。

公共编译与验收结果记录于 `build/reports/systems-v34-validation.json`。`npm run check` 为 1,331 项通过、0 失败，知识身份与契约有效；Python 22 项通过，104 条来源、运行时和 UI 检查命令最终全部成功。首次公共回归发现两处 v33 预期：非空 Upper/Ceil 原应失败、原生方法数固定 27；现分别验证新提供器及缺失提供器拒绝、精确 39 方法回执，定向复验通过。

原生保存来源检查包含 55 个常驻实例与 6 个实际 NPC；端到端 codec/会话检查 26 项。旧开发片段的五次遭遇与 40 次存取继续通过；129 个既有几何入口的恢复只是独立机制回归。普通合成核对 2 个已发布地图和 2 处真实 PNG 像素，并通过 13 项 Renderer 测试；粒子为 204 项来源断言、225 次独立 DXBC 对照和 11 项受控栅格检查，真实发射器准入仍为 0。

浏览器从头开始到达已知 FX 分配门禁，控制台无警告或错误。旧开发入口再次走通守卫对白、两次火炎射线、96 EXP / 96 Gil 胜利结算、返回地图及移动至 `(38,36)`；暂停菜单保留 3096 Gil、等级 3/2/2、HP 53/63/37 与坠饰 1。该路径同样无控制台错误。使用独立临时标签页，没有执行浏览器保存或读取，没有操作用户原标签页。截图和检查记录保留在 `build/reports/systems-v34-browser*`。浏览器存储实测、原版动态对照及其他浏览器仍是单独验收，不能由内核存取测试代替。

可重复入口：

```sh
npm run check
.venv/bin/python -m unittest discover -s tools/tests
npm run game:build
npm run battle:build
npm run world:build
node scripts/build-source-new-game.mjs
npm run field-native-checkpoint:check
npm run field-native-composition:check
npm run field-particles:check
npm run field-effects:check
```

新工作区须先按各模块文档完成来源导入和固定版本的研究依赖提取。下一批优先补真实发射器与共享池事务，再贯通来源地图、骑乘和现有战斗系统；不会以静态地图编译数量代替可玩范围。
