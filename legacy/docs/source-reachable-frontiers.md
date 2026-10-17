# 真实新游戏的有界可达前沿探索

`explore-source-frontiers.mjs` 复用实际来源新游戏入口、Session、Flow、Repository、MapLoader、Commands、BattleHandoff 和 CheckpointStorage。搜索器只持有输入队列和证据；游戏状态仍由已有 owner 持有。没有直接执行事件、注入旗标、修改 HP/名册或传送的接口。移动、接触、开门、交谈与出口由实际 `GameFlow.move/confirm` 触发。

搜索从真实初始化开始自动处理已接受的消息确认、切图和既有战斗交接。在稳定状态按四方向广度优先提出输入，当前真实交互目标存在时才提出 confirm；选择枚举所有显示选项。战斗读取实际 commandMenu/targetChoices，仅通过 GameCommands 提交已准入行动。默认每个战斗决策只探索一个合法输入，其余选项逐一保留为分支预算前沿；失败、未知命令、败北重试和逻辑时钟预算都不伪装为完成。

稳定状态使用实际 `GameSession.checkpoint`，通过 CheckpointStorage 编码、写入、读取，再交给可信内容依赖的 `GameSession.restore`。来源事件保存使用现有 `prepareEventSave().commitWith(storageCommit)`；不会重跑初始化或篡改待执行 PC。无法合法保存的选择或战斗分支，通过上一个真实存档和实际输入前缀重放。恢复任务文件时重新从真实新游戏重放所有待探索前缀，不将历史文件中的游戏状态直接当作已达事实。

精确去重使用完整 checkpointHash。另有明确的有界几何观察预算，防止空地循环耗尽原型：它保留完整持有/事件状态、当前位置/朝向、可见演员/运动、碰撞和 route 投影，但省略某些绝对时钟/动画相位。因此这种抑制不是已证明的语义等价；每个被抑制状态都留下独立前沿，`exhaustive` 与 `sourceCampaignComplete` 始终为 false。未执行队列、合法行动和所有原始 SourceRef 仍保留，不能以探索预算替代完整通关验收。

```sh
node scripts/explore-source-frontiers.mjs --compiled dist --max-runs 48 --max-ticks 24000
# 仅在明确测试旧内容与新运行时组合时加 --allow-compatibility。
# 继续任务将从真实新游戏重放原待执行输入，拒绝错误 runtime/source/refs。
node scripts/explore-source-frontiers.mjs --resume build/reports/source-reachable-frontiers/report.json
```

默认输入为已完成公共发布的 framework 引用及 publication receipt。工具用公共 receipt 中 framework 的 indexHash/releaseId 核对已验证 release index、完整 release body 与当前 refs；每次读取再核对该 release 的 URL→contentHash 绑定和 CAS 中保留的原始 JSON 字节。单独的发布 runtime 标签不能授予任意输入身份。可用 `--release-root` 指定同一已完成集合的归档根。工具先冻结完整 raw corpus 和实际消费的 JSON 原字节至 ignored `inputs/<sha>.json`，核对 raw source-set/parent、内容完整性、运行时与发布代次。末尾重新验证所有原输入未变化。发布仍在进行时，不得启动这个公共 consumer；应使用固定的私有集合。runtime 与内容发布代次不同默认拒绝，显式 compatibility lane 也不授同代内容准入。

输出包含每个源前沿的实际输入前缀、现场、所有权边界、SourceRef、合法保存点及按共用消费者/错误归并的工作单。当前错误归并是保守的公共 API 级别和原始错误消息；不能把无法定位的提供器错误猜成具体原生指令。媒体和消息采用明确的 headless Web ACK/10ms 策略，不代表浏览器像素或原版行为一致性。

`tests/reachable-frontiers.test.ts` 用启动前声明的三图夹具验证真正接触→选择→切图→合法战斗→返场→事件保存→交谈和循环、失败旧 owner 不变、入口准备失败保留现场、预算保留队列与重放拒绝。`frontier-input-binding.test.ts` 还验证错误发布代次、当前引用漂移、被重封但 release ID 错配、缺失/重复/未完成归档证据均拒绝。它验证控制器，不计作原版故事可达。
