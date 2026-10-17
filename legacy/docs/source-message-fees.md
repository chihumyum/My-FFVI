# 来源服务费与消息金额

`SetGilTag` 读取来源 `Product.GroupId == i0` 的唯一普通服务商品，将 `Coefficient` 传入字符串格式化helper（`0xcc4050`，符号未标名）后写入 `MessageManager` 的 `KINGAKU` 替换值。它不读取或扣除持有 Gil。`RemoveGil` 继续使用已有经济 owner；付款、恢复和交通不会由消息文字驱动。

全源比较保留3304程序、186003指令及姓名/金额两族完整正文。姓名模板已有 `GameState.fieldMessageNames` 和实际持有名册投影；旧消息检查器因缺持有上下文排除的用例不是新的解析能力缺口。未持有角色、未知标签和默认姓名回退仍阻塞。本批选择42个 `SetGilTag` 来源点及33个 `(KINGAKU)` 文本点，以完整程序及其后继作为验证单位。

`common.sourceMessageFees` 是同一已验证源表 reader 编译的只读目录。每项保留商品组、Product身份、金额及完整源行引用；模糊/缺失/不支持组保留诊断。它不修改源新游戏初始化、名册或 `GameState` 字节。Session 绑定其不可变副本，源指令的金额必须与目录精确一致。

公共配方重绑定通过独立的 `compiled-source-message-fee-addition-v1` 声明核对原始商品表重编结果，只准许新增这一个 common 字段。若旧 pin 早于其它已交付的编译器能力，同一输入锁下的纯生产器另行构造“不加入金额目录”的完整编译基线，先用原有编译重绑定合同验证旧 pin 到基线，再严格验证基线到候选只增加该字段。基线由编译器的明确审计选项产生，不能从候选删除字段伪造；普通战斗派生也由同一生产器从无金额基线独立生成。报告保留完整基线、旧/基线/新目录与 common 哈希和分离的历史能力重绑定；整个 GameState、源身份与媒体仍核对。无基线证明的直接比较继续要求新增字段以外的 common 完全相等。已有目录不得变更或移除；价格、来源、其它能力、owned state 和旧 pins 都不能随金额声明改写。已相同的既有目录沿原比较流程，不需要重复授予增量。

唯一可变替换值仍由既有 `SourceMessageState` 持有。普通消息、明确分页、speaker 和序列 text runs 共用模板解析。仅新增精确 `(KINGAKU)`，含金额的模板使用v2；姓名模板保留v1。打开窗口时一次读取持有姓名和金额，后续翻页保持该快照，下个窗口重新读取。缺少SetGilTag产生的值时拒绝，不能打印宏或猜默认价格。`FULL_SPACE`、`ITEM_N` 等其它宏保持未知。

跨图准备复制同一消息 owner 的替换值至私有候选，失败/取消不影响live；发布前复核旧与候选金额状态。保存仅在非空替换值时使用 `idle-field-v16` / `event-field-v7`，恢复按可信当前目录核对完整来源身份及金额，不重放SetGilTag、地图初始化或付款。旧空状态保留原codec。Telepo的v15/event6由集成层与本扩展组合，不能通过存档授予其能力。

原生只读审计复用两个短方法 `0xb527f0` / `0x2cad10` 和已有 `MessageManager.SetValue`，核对完整PE范围、fresh C回执、Product泛型、getter别名和KINGAKU字符串。该helper的文化相关数字格式、原生存档行为和动态一致性未验收；Web明确采用非负普通服务费、无分组的十进制以及来源绑定的持久替换快照。

```sh
node scripts/inspect-source-message-fees.mjs --compiled dist
node scripts/check-source-message-fees.mjs --compiled dist
.venv/bin/python tools/native/check_source_message_fees.py --evidence-dir build/native/source-message-fees --report build/reports/source-message-fees-native.json
```

inventory 默认比较已锁定的 `build/game/source-catalog.json`。若固定输入早于其它已交付能力，精确增量检查会拒绝；可用 `--comparison-battle <目录文件>` 指定从同一原始来源、已捕获旧编译器独立重建的对照，报告保留其绝对路径和完整文件 SHA，并在结束时复核。该选项不放宽整个 common、GameState 或来源目录比较。旧代拒绝回执不能改称同代兼容成功。

原始C/来源文本只留ignored build。两方法可按 `tools/native/README.md` 用既有 `ExportMethods.java` 重生；必须核对complete回执及原DLL/header/symbols哈希。实际源程序观察、受控完整正文、源参数信封、受控连续Session、应用DOM和原生对照分别记录，不能以解码数量或信封成功授剧情可达性。
