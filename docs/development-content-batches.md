# 独立开发内容批次

`development-content-batch-recipe-v1` 保留原合同：把未派生的 raw development field baseline 重定位到同代框架世界的真实 PointIn。入口、世界与地图仍必须拥有一致的策略；缺少逻辑效果目录的 raw field 不能仅靠复制全局逻辑效果标记取得能力，也不能删除世界标记绕过该检查。

`development-content-batch-recipe-v2` 显式声明 `frameworkPolicy: {kind: "independent-source-framework-v1", sourceEntry: "game/source-new-game.json"}`，并以 `world: "world/catalog.json"` 选择严格来源。共用 producer 从同一候选 reader 读取严格世界、来源入口和全部索引地图，验证摘要及入口依赖后，调用既有 `compileFrameworkContent` 的固定基础策略。它不传全局框架的逻辑效果或循环呈现选项，不读取全局框架目录，也不把已派生输入清理后冒充严格来源。

所有来源地图与索引都保留，并重基址到该开发包自己的地图命名空间；manifest 选择的路线仍是验收子集。匿名省略、交通、剧情时钟和保存 barrier 来自既有共同派生器。全局框架、严格来源包、raw field 及其脚本、资源与稀疏事件初值都保持原样。入口的 baseline 还原须与原始 `baseFieldHash` 完整一致。

构建报告记录固定声明、严格世界/入口哈希、每张来源地图哈希、独立派生报告和目标目录哈希。未知诊断不消失，来源故事可达性仍未授予。旧 v1 内容不会自动转换为 v2；只有明确修改后的作者配方采用独立策略。
