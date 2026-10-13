# 内容版本与旧进度

批量迁移会改变 entry、world、map 和 battle 摘要。当前保存继续保留原身份；本系统保存对应内容闭包，再用原 Repository 与 GameSession 严格恢复，不把旧进度改成新初始化。

## 可信发布与保留

`content-releases/packages/<packageId>.json` 是宿主为同一包和 profile 发布的历史索引。每个 release 包含原 refs、父来源身份、全部逻辑 JSON URL 到原 contentHash 的绑定，以及 PNG/FLAC URL 到实际字节 SHA 的绑定。JSON 与媒体分别存放在 `objects/<hash>.json`、`media/<sha>.<extension>`，原正文、URL 和哈希不改写。

归档必须保留 world 的全部地图索引，不因某个地图尚未准入而删掉它，也不补 development marker。实体、脚本、分支和来源诊断保持原样；存下来不授予运行能力。媒体归档只收集运行时图像和音频字段，不把来源 Evidence 的文件路径当成资源。

公共包构建与来源地点构建在覆盖前保留旧闭包，完成后记录新闭包；索引在全部对象写完并验证后发布。独立批次继续共存。直接调用 world/catalog/framework 编译器或 Python 导出器时，必须先运行 `npm run content-history:archive`；导出器可能整目录替换并删除旧媒体，事后无法保证补回已丢失版本。不要修改生成产物作为内容版本工作流。

## 恢复与会话

`GameContentHistory` 读取保存中既有 origin、entry/battle/world 和来源身份；保存不能给出 URL、包命名空间或 profile。已确定匹配当前版本时，仍走当前 Repository，当前 I/O 或能力失败不搜索另一个定义。版本不同或已声明包的旧保存缺 world 身份时，从可信索引唯一选择完整匹配的 release；缺失和歧义明确停止，原档保留。

历史 Repository 仅将 JSON 读取重定向至绑定对象，照旧核验完整原正文和各层关系。恢复后的会话一直使用该版本进行切图和入战；重新开始使用标题配置的当前版本。当前保存 envelope、GameSession v4/v5/v6 和 owned/field/world codec 均保持原格式，不进行隐式升级。旧数据与当前运行时不兼容时继续拒绝，需要单独、明确的升级协议。

`GameContentSessions` 用 WeakMap 预先登记私有候选的不可变 I/O 上下文。有效上下文从单一 `GameFlow.currentSession` 投影，因此 Flow 发布会话时同时改变内容选择，没有另一个可漂移的 active-repository 提交。失败、取消和迟到回调不改变旧会话的绑定，旧菜单命令仍由 GameCommands 拒绝。

图片使用每个 repository 独立的逻辑 URL 缓存；历史 PNG 验字节 SHA 后从 Blob 解码，再交给实际 Renderer。音频准备接受候选自身的 resolver，FLAC 保留字节和解码长度校验，缓冲按 SHA 共享。媒体完成只能填充缓存，不能发表游戏状态或推进旧任务。

## 操作与验收

    npm run content-history:archive
    npm run skeleton:build
    npm run source-content:build
    npm run content-history:check
    npm run skeleton:check

日常两个构建入口负责保留版本；手工归档用于共享导出之前。归档、系统连续验收、具体来源批次准入和浏览器实玩分别留证。本地原始资源和所有 CAS 产物保持 ignored，不进入 Git。

代表连续流程使用实际 History、Repository、EntryLoader、Flow、MapLoader、BattleGame、Commands 与 Storage：更新后恢复旧版 → 旧地图与事件 → 旧战斗和一次结算 → 菜单 → 再保存恢复 → 新输入。实际 app 验收也运行当前 handler；DOM、PNG 解码、Blob、WebAudio 和绘制宿主仍受控。原版对照、浏览器像素及声音、完整故事和完整 Web goal 均不由此放行。HD-2D 后置。
