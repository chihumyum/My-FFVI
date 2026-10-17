# 来源载具生命周期与世界动作

本族保留完整 3304 程序 / 186003 指令分母：30 条 LoseVehicle / OnTheVehicle / SwitchVehicleActive、25 个完整指令正文、30 个 kind21 来源对象、6 个原始回调正文 / 82 指令。相关范围仍是 274 根正文 / 26243 指令及 283 闭包正文 / 26937 指令。静态解码和受控 Session 机制验证不代表原剧情完整执行。

明确 Web 策略 `web-source-vehicle-lifecycle-v1` 需要内容与实际运行时同时声明，并依赖原有 walking/Magitek framework 策略。公共 source producer、framework entry/world/map、initialized entry、GameSession、WorldSession、实际 App 和共同 replay helper 都传递同一标记。严格来源入口不获得此权限，save 只存状态，不能添加权限。

## 同一状态所有者

GameState 的原 `ownedTransportations` 保存地图、停车坐标、方向和时间；EventState 的原 TreasureFlag bank 决定 enable。两者没有另建副本。短暂生命周期票据仅保护准备、提交、取消、退休和迟到调用。

实际车体存于原 `Field.actors` 集合，使用 `web:source-transportation:<source id>`，经同一 Field factory、源 field asset / Character / Sprite、view、纹理和 native actor projection 创建。与使用相同 asset 的 resident 身份分开。新增车体是明确的 Web2D 表达，不宣称它等于原生 MapObject 实例或其构造已经得到证明；没有第二个可写 position / enable 表。未知媒体、方向、layer、flag、source identity 仍拒绝。

SetVehicle 在本策略下先准备实际 record、flag 和车体创建/重新初始化；LoseVehicle 精确传 enable=false、map=-1 与 nullable position/layer/direction/timestamp 缺省，保留原坐标、方向、时间。Switch 依源码 `operand0 == 0`，只操作当前图启用且实际存在的 Web 车体显示，保留 enable、parking 和 current identity。OnTheVehicle 是命令：将实际车体位置复制到 Integrator 首成员、player 与唯一 camera dummy；不换 current transportation、不登船，也不调用交通回调。首成员按已验证 getter 使用 keepBadStatusVisual→-1010，否则真实 leaderId，不能用 selector0 / camera 替代。

停车 X/Y 经原 IMapAccessor 的 cell→world 公共单位转换；不作 SetPos sentinel 或 mapRange 原点扣减。stored Z 的 int32 投影按 349/249/149/49→Unity layer9/10/11/12；未知仍拒绝。

发布前完成所有媒体、身份、record、flag、actor、camera 与 collection 可写性验证。准备失败不提交任何状态。原同步 VM 指令提交后发生的后续 source failure 保留已经提交的事实，不能伪称整段回滚。新地图候选保留旧所有者；取消不替换旧车体，成功切图退休旧票据。Storage 按真实 owned parking 重建可信车体集合，拒绝缺失政策、身份或伪造 body position；退休 Field 不允许再保存或执行本族。

## 世界动作

strict `compileEntityGroup` 给已知 kind21 附加完整 raw object、十项原属性、原 action / script / transportation 表行描述，同时保留原 `Unsupported entity kind 21`。未知属性、目标列表、RunScript 以外 action、transform、geometry 或绑定仍有具体诊断。

只有 v12 framework 策略可移除描述完整的这一个 class blocker。实体、geometry、脚本正文、参数、目标交通列表与其它 blocker 不变。source recipe 比较逐图、逐 group 与整个 world index 验证这一精确投影，不允许新增 flag、parking、脚本或删除其它诊断。早期 v1–v11 profile shape 不变且拒绝新标记。

本 Web 输入策略在实际同格、同层的 kind21 上确认，核对实际 current transportation 与原 target 列表，调用原 VM `beginRoot`。开始脚本不等于完成回调；实际 Wait / Exit / blocked 都通过原 VM。不能在进入对象时自动执行、空 ACK 或以其它交通脚本代替。原 30 个对象均保留 source targets4/5 的事实；type8 实际控制、飞行、登船和降落仍未闭，不能据解析成功宣称这些原正文已运行。

实际 parked Web 车体参与同集合的接触检查；手动接触到未闭 collider / boarding 阶段会给具体 gate，不假定可穿过或已经登船。手动驾驶、terrain/landing-group 判定、起降/停车完整阶段、脚步/骑乘动画、encounter-table、交通 BGM、condition 清理等旧差异继续保留。6 条 start_takeoff / start_landing / transition_inboard 原回调完整保留；不是 UpScript / DownScript，也不因其存在就授权执行次序。原 master 的 UpScript / DownScript 全0，不填造其它回调。

## 生产与证据

v12 是精确 framework profile 扩展；新本族没有新增资源文件或锁明文字段。既有 input-lock v4 仍锁完整 raw snapshot、源表、source/编译模块和输出依赖，v12 recipe 与实际内容/运行时另行双授权；旧 lock、save 或 marker 不能补权。没有形式上升 input-lock 版本，也不删除旧 parser shape。

原生证据为有限完整范围与 PE/metadata 复核，不是动态原版一致性：首6方法3104B、后6方法2384B、router8×80B、停车2方法400B；早先后6的2784B为加总错误，范围未扩大。另32B首成员 getter 是后续独立授权 PE-only 证据。任何 C tail-followed body、shared generic alias 不能越过真实方法范围授予语义，尤其 BoardingTransportationAction 仍具体 gate。

检查器 `scripts/check-source-vehicle-lifecycle.mjs` 对原始3304正文、30新opcode、30对象与6回调保全比较，不生产649图、不启动原剧情或发布。Session / Storage / renderer / App 是明确受控输入与媒体宿主机制验证，分别报告。完整新游戏到结局与原生动态对照仍未完成，HD-2D 仍后置。
