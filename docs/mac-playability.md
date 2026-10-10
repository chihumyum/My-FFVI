# Mac 本地运行

2026-10-10 当前目标是先运行游戏并检查基本可玩性。一致性对照暂时后置；本环境不是 Web 构建，也不是从源码编译的 macOS 原生版。

## 当前环境

- Apple M3 Pro，36 GB，macOS 27.0.1，Xcode 27.0。
- Apple Rosetta 2 已安装，x86_64 程序启动检查通过。
- CrossOver 26.3.0，通过 Homebrew cask 从 CodeWeavers 官方下载；安装包 SHA-256 为 `8688e0848c4e5f79f1cc351cb52d32447da00c6c00cfd3b4bb2d164d44589a26`。
- CrossOver bottle 名 `FFVI-Reweb`，Windows 10 64 位，图形后端显式选择 D3DMetal；随安装包提供的 D3DMetal 版本为 3.0。
- CrossOver 当前为 14 天试用，期限到后需要有效授权或更换运行环境。未购买或注册付费订阅。

Apple 独立评估环境下载要求 Developer 登录；用户暂时无法登录，因此采用 CrossOver 集成的 D3DMetal 路径。

## 启动与本地文件

Finder 的个人 Applications/CrossOver 目录中已有 `FINAL FANTASY VI.app` 启动器，也可在 CrossOver 的 `FFVI-Reweb` 容器中打开。它启动仓库本地 `build/runtime/game/` 下的运行副本。

来源安装目录独立保留；运行副本包含 EXE、GameAssembly、UnityPlayer、游戏 Data 目录和原有运行依赖，未复制下载包中的推广链接。原始与运行资产均未提交 Git。

CrossOver 容器由应用管理，位于用户的 `Library/Application Support/CrossOver/Bottles/FFVI-Reweb`。不要把容器当临时构建产物清理，其中可能包含存档和设置。`build/runtime/game` 也可能产生运行数据，清理前需要检查。

## 检查范围

2026-10-10 实际通过本机窗口操作检查：

- 启动标志、FFVI 标题动画、开场场景、雪地行军和英文字幕正常显示。
- 进入纳尔谢，能关闭操作说明、推进对白、移动角色并触发守卫战斗。
- 战斗中能打开 Magitek 菜单、选择 Fire Beam 和敌方目标；敌人攻击、HP 变化与自动战斗可运行。
- 击败两名 Guard，结算得到 96 Gil / 96 EXP，Wedge 与 Biggs 升至 2 级，并正常返回地图。
- Tab 能打开队伍菜单；快速存档操作显示 `Quick Save complete.`，随后关闭提示。游戏保留在菜单中，可按 Tab 返回地图继续玩。

判断：开场基本可玩，观察期间没有明显缺图或崩溃。仅覆盖上述短流程，没有检查音频实际输出、重新载入存档、后续剧情或长期稳定性，不代表全游戏通过，也不关闭 Web 迁移验收项。

截图保存在本地被忽略目录：`build/runtime/narshe-playable.jpg`、`build/runtime/narshe-victory.jpg`、`build/runtime/narshe-quicksave.jpg`。这些是基本可玩检查记录，当前没有开展一致性对照管线。

常用键位：WASD 移动/选择，Enter 确认，Backspace 返回，Tab 开关菜单，X 查看操作说明，战斗中 Q 切换自动战斗。以游戏内 Controls 提示为准。

参考：[Apple GPTK](https://developer.apple.com/games/game-porting-toolkit/)、[CrossOver 图形后端说明](https://support.codeweavers.com/en_US/advanced-settings-in-crossover-mac-26)、[试用说明](https://support.codeweavers.com/en_US/crossover-mac-user-guide)。
