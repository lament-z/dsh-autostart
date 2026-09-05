# dsh-autostart

在 [dsh-restart](https://github.com/anweat/dsh-restart) 基础上扩展的 DeepSeek Harness（DSH）插件：在保留「重启 / 看门狗」能力的同时，**新增开机自启动**能力，支持在设置卡片中「选择」启用与「取消」禁用，并跨平台落地（macOS / Windows / Linux）。host + client 双半，装进 profile 的 bundle 后即可用。

> 截图展示设置 → 插件 → 「DSH 自启动 / 重启」卡片中的开机自启动分区（开关 + profile + 状态 + 启用/取消按钮）。

## 功能

- **开机自启动（核心新增）**
  - 设置项 `autostartEnabled`：勾选即「选择」在操作系统登录 / 开机时自动启动 DSH；取消勾选即「取消」停用。
  - 设置项 `autostartProfile`：指定开机时启动的 profile（如 `web`）；留空则沿用当前进程的 profile。
  - 跨平台落地：
    - **macOS**：写入 `~/Library/LaunchAgents/ai.deepseek.dsh.autostart.plist`（`RunAtLoad`，不启用 KeepAlive），并 `launchctl load` / `bootstrap`。
    - **Windows**：写入注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\DSH Autostart`。
    - **Linux**：写入 `~/.config/systemd/user/dsh-autostart.service` 并 `systemctl --user enable --now`。
  - 卡片内实时显示自启动安装状态（已启用 / 未启用 / 安装命令），「启用自启动」「取消自启动」按钮与开关同步。
  - 状态路由 `GET /plugins/dsh-autostart/autostart`（仅环回地址可读）。
- **模型工具 `restart_harness`**：让 agent 直接安排一次进程重启（可选 `delayMs`）。
- **`/restart` 斜杠命令**：在 UI 里手动触发重启。
- **配置卡片**（设置 → 插件 → 插件配置 → 「DSH 自启动 / 重启」）：可视化编辑 `autostartEnabled` / `autostartProfile` / `legacyRestart` / `continuePrompt` / `watchdogEnabled` / `watchdogCooldownMs` / `watchdogPollMs`，改动即时写入 `settings.yaml`。
- **「立即重启」按钮**：先读取当前进程身份，安排重启后等待新进程恢复并自动刷新页面。只读 GET 返回 `{ pid, startedAt }`；重启 POST 仅接受来自环回地址的同源请求，经反向代理 / 远程访问时会被拒绝（403）。

## 安装

```sh
# 从 npm 安装
dsh plugin --profile web add npm:@lament-z/dsh-autostart

# 从 GitHub 安装（lib 预构建产物随仓库发布）
dsh plugin --profile web add github:lament-z/dsh-autostart

# 从本地目录安装
dsh plugin --profile web add link:<本目录>
```

重启 DSH（`/restart` 或 `restart_harness`），刷新页面后即可看到卡片。

## 启用开机自启动

1. 打开设置 → 插件 → 「DSH 自启动 / 重启」，展开卡片。
2. 勾选「开机自启动」（或点「启用自启动」按钮）= **选择**启用；取消勾选（或点「取消自启动」）= **取消**禁用。
3. 如需指定 profile，在「自启动 Profile」填入（如 `web`）。
4. 卡片下方状态区会显示安装结果与实际启动命令。启用后，下次登录 / 开机即会自动拉起 DSH。

> 注：自启动条目由 host 半在 DSH 运行时根据设置安装 / 移除；进程重启或设置变更都会重新对齐，确保 OS 条目与 `settings.yaml` 一致。

## 跨平台实现说明

| 平台 | 机制 | 落地位置 | 卸载 |
| --- | --- | --- | --- |
| macOS | launchd `RunAtLoad` | `~/Library/LaunchAgents/ai.deepseek.dsh.autostart.plist` | `launchctl bootout/unload` + 删除 plist |
| Windows | 注册表 Run | `HKCU\...\CurrentVersion\Run\DSH Autostart` | `reg delete` |
| Linux | systemd `--user` | `~/.config/systemd/user/dsh-autostart.service` | `systemctl --user disable` + 删除 unit |

- 启动命令取自当前 DSH 进程（`process.execPath` + `execArgv` + `argv`），并可选注入 `--profile <p>`。
- macOS 的 plist 写入 `DSH_HOME` 环境变量与 `WorkingDirectory`，提高启动可靠性。
- 所有安装 / 卸载操作 best-effort，失败会写入 `dsh-autostart.json` 状态文件与 `dsh-autostart-auto.log`，不会中断 DSH 进程。

## 开发与构建

```bash
pnpm install
node scripts/link-dsh-workspace.mjs --source <path-to-deepseek-harness>
pnpm run build
```

host 半由 `tsc` 输出到 `lib/index.js`（`@deepseek-ai/*` 保持外部依赖）；client 半由 `tsdown` 打成单文件 `lib/client.js`。

## 发布（git + npm）

本仓库已配置 `.github/workflows/publish.yml`：

```sh
git remote add origin git@github.com:lament-z/dsh-autostart.git
git push -u origin main
npm version patch
git tag v$(node -p "require('./package.json').version")
git push origin --tags
```

其他 deepseek-harness 实例可通过 `dsh plugin --profile web add npm:@lament-z/dsh-autostart` 或 `github:lament-z/dsh-autostart` 拉取本插件。

## 许可

MIT
