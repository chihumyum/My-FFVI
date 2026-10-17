# 来源剧情随机分支

`SetRandomValue` 由同一 FieldGame、EventState 和 GameState 执行。来源完整正文、原地址、全部参数与 SourceRef 保留；它不是 NPC 自动移动随机数或战斗抽样的别名。严格默认宿主继续拒绝，正式 Web 应用显式提供 `web-source-script-random-field-stream-v1`。

原始 Misc wrapper `0xb52970` 的原字节在调用整数 Random.Range 前设置 min=1、max=i1+1；随后把结果写到 s0 精确字典所指的银行、i0 索引。[Unity 整数 Range 的公开合同](https://docs.unity.cn/Documentation/ScriptReference/Random.Range.html)是下界包含、上界不包含。当前准入来源中出现的 MapLocalVariable / AreaLocalVariable、有效索引、正且不溢出的上界；其余银行别名、保留参数、非正或溢出范围保持明确阻塞。源中的 i1 是包含上界，不能改成0起点或固定数。

Web 使用 GameState 已有的 `fieldRandom`，与菜单字段能力共用一份持久流。没有新增随机 owner、存档字段或隐藏全局 seed。地图候选在现有 owned draft 内抽样，候选取消或失败不会影响 live；发布后同一端口转读 live。每次指令将既有随机候选和 EventState 目标银行作为一次提交，最后复验任务、来源 opcode、事件银行和 owned revision。活动事件保存、稳定恢复、战斗往返继续使用现有 Session/Storage/lease，恢复不重复抽样。

这项 Web 策略与原 Unity 全局生成器不同。原 wrapper 是先抽样再查目标银行，原生异常可能已经消费随机数；Web 先验证、提交失败不消费。原生序列、浮点分布及原异常路径一致性没有验收，不以确定性重放代替原生对照。

全族工具：

```sh
node scripts/inspect-source-script-random.mjs --compiled dist
node scripts/check-source-script-random.mjs --compiled dist
.venv/bin/python tools/native/check_source_script_random.py --evidence-dir build/native/source-script-random --report build/reports/source-script-random-native.json
```

原生一体导出复用 `tools/native/ExportMethods.java`，RVA 为 `0xb52970`；工具验证 fresh complete receipt、完整 PE 范围、C、已有 DataStorage.Set 和重叠 Random 别名，不追加导出或执行 DLL。原 C/字节及来源游戏文本只能留在 ignored build。

提名工具从同一 pure prerequisites 构建全部649图，重编完整3304程序，保留所有字段/非字段、全部参数点、同图命名空间/后继、全世界脚本与 PointIn 依赖、未知诊断。旧 pins 不刷新，公共集合不读取或发布。检查器分别记录原图初始化后观察完整原程序、明确作者宿主中的完整原程序，以及实际源指令参数信封；后二者不能计为主线可达性。所有失败、选择、切图和战斗边界及未执行后继均保留。来源程序执行数字与解码数量、单参数用例分别报告。
