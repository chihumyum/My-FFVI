# 完整来源多队伍部署、拆队与合流共用族

本族基于固定 v127 作者树（2156 作者文件、2340 编译文件），不修改原候选、保存格式、随机流或时钟。实现沿用 `GameState` 的原三组四格、完整持有名册与地图 draft，`FieldPartyActors` 和实际 factory 角色仍是唯一表现所有者。现有 `rtsParty` 端口新增可选 `prepareCorps`；缺失端口、来源或提供器仍阻塞，不默认 Ready。

全来源保留 3304 程序、186003 指令，其中 Field 2804/173026、AI 430/10093、Battle 53/2312。7 个确切 SysCall 分布于 7 份原正文（1006 指令）、6 图；整地图闭包为 99 正文、6056 指令。差分仅这 7 点由 blocked 转为 multi-corps，其余操作、AI/Battle 正文及原未知诊断保持。这里的转换数不代表剧情批次完成。

## 来源合同

根的一次 7 wrapper 导出为 6432 原生字节，三项共同 provider 为 2272 字节。静态检查重新核对 DLL、symbols、header 三 pin、每个唯一全名与 next-symbol bound、PE range SHA 和 C SHA；没有执行 DLL 或递归导出。另复用 Init、LookAt、GetMovingAnimName 与 PointIn 查询缓存。

| 命令 | 实际原生参数 |
| --- | --- |
| ティナ防衛戦 | map318，bank1 cell(12,13)，bank2 cell(14,13)，3 组 |
| 幻獣防衛戦 | map19，bank1 cell(18,9)，bank2 cell(22,9)，3 组 |
| 瓦礫の塔 | map542，bank1 cell(43,21)，bank2 cell(56,22)，3 组 |
| フェニックスの洞窟 | map497，bank1 cell(12,6)，2 组，末尾对 bank1 cue Dying(-1) |

坐标是 wrapper 的来源参数，由一个部署提供器消费，不按当前地图名、技能或 PC 分支。IMapAccessor slot3 转格子至 world；IEntityAccessor slot1 部署既有 party actor。fresh placement 的层来自来源 PointIn(1)，严格要求唯一、无 link、已知层；不能借旧玩家层代替。所有 preset 另将 bank0 置于 world(0,-1000)，保留实际层 Z、零方向，再 Hide(0)。零方向经原 LookAt 选择 Default 动画，不转为向下。Phoenix 不部署 bank2，保持其已有状态。

IEntityAccessor slot0 的 GetFieldEntity(-1030) 指向 bank0 actor。class vtable 起点 0x130，+0x2a0 是 slot23 Hide，+0x460 是 slot51 CueAnimation；这些操作不移动玩家或改变 camera。ScenarioVariable4 写 0、5 写组数、已证的 [11,12,13] 全写留图 mapId。wrapper 本身没有切换 `GameState.selectedSlot`，实现也不额外切换。

梦境分离先克隆当前 Corps，按原四格索引逐格清 bank1/2；将前两位 CharacterId 非零的成员保留原格子与实际 Corps.Id，分别放 bank1/2，从当前组删除，最后执行原 Refresh(true)。不按 enabled 过滤，不压缩洞。491610 在该 caller 域为 `Last.Data.User.Corps.get_CharacterId`（数字持有身份），491670 为 `get_Id`（Front=1/Back=2），与反编译选中的 Audio alias 名无关。二者直接投影到现有格子的 owned 字符串身份和 row，不能经 CharacterStatus/sourceId 重建。

两次合流共用同一个算法，参数分别为 bank1/2：取来源组第一位非空，当前组同索引为空则放回该格，否则找当前组第一空格；即使当前组已满，仍清除原来源格。没有自动 Refresh。设置格子保留传入的 Corps.Id 排位，删除也保留原 row；不能复用普通 OrganizePartySlot 的固定前排写入。重复动作和原生允许但当前内核不支持的重复成员仍受既有资格检查；不创建第二份名册。

`Core.get_Next` 在 409ff0 的共享别名不改变调用域。分离/合流返回的 0 和部署的 Next 都由现有 Field 任务继续，不建立另一套 VM。

## 所有权及验证边界

所有成员/格子更新在原 live 或候选 draft 投影，只有 Field 的事件、实例及来源检查全部通过才联合提交。部署不刷新外观或镜头；分离调用现有顺序 appearance batch；合流只更新原队伍 owner。来源 `WorldMapContent.partyEntry` 同一静态定义显式传入 Field，存档不保存它，也不能授予运行能力。

126 项相关验证通过，含 8 项新族测试：全部四 preset 的真实实例与事件写入、身份不替换、保留孔洞/禁用成员/满组删除，拆队后实际 battle borrow/返场，真实 Storage 存读与后续合流，候选取消、媒体失败、原入口拆队后晚失败回滚、重试一次发布、旧 Field 不能写新 owner；缺 PointIn、缺 Dying 媒体和旧 draft 都明确拒绝。

完整原正文、依赖与来源诊断保留在 ignored 差分报告中。来源相机、场景隐藏标记、其他指令和条件提供器未因此解除；实际本代 7 份来源正文尚未贯通执行，没有 world producer、浏览器或全游戏放行证据。

复现：`npm run build`，运行 `field-multi-corps`、RTS/group、Party/World/Storage 等相关测试；静态差分用 `scripts/check-source-multi-corps-placement.mjs --source-root … --baseline-compiled … --planner-input …`；有界 native 静态核验用 `scripts/inspect-source-multi-corps-placement.py --source-root … --packet … --output …`。
