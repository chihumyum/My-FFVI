# 歌剧首批目标

选择一段有明确开始/结束和原版对照的短镜头，先将已有演出忠实迁移到 Web。扩大表现能力、提炼 HD-2D 规则与重制调查都等待全游戏 Web 迁移放行。

源地图区域通过 `MSG_MAP_NAME_43` 关联，area 39，15 条地图记录。演出资源包含 `ff6_opera_dance_stage`、`ff6_opera_opera_event` 和 `ff6_opera_stage_event`。其所属关系仍需通过实际事件调用验证。

已观察到 AnimationTrack、AudioTrack、ActivationTrack、TimelineAsset、摄像机、精灵、网格、粒子及 OperaPostProcess。首批实现读取原始 Timeline 图、局部引用和镜头参数，保留跨文件引用，绝不把解码成功写成完整可播放。

待恢复：具体片段根与激活条件、完整绑定、外部动画/模型/音频、时钟和音画同步、材质/透明混合、自定义后处理、跳过与结束的状态回写。

完成条件：源引用闭包完整，原版时间点和播放行为对照通过；新场景可以通过数据使用相同表现能力。固定舞台布景用于自由探索前还需几何和可见性验收。
