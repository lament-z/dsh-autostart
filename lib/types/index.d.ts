/**
 * dsh-autostart — 在 dsh-restart 基础上新增「开机自启动」能力的 DSH 插件。
 *
 * 继承 dsh-restart 的全部能力：
 *   - 模型工具 `restart_harness` 与 `/restart` 命令（重载插件与配置）。
 *   - 可配置重启方式（Node 原生 / 旧 PowerShell 适配）、重启后自动继续提示词。
 *   - 可选看门狗：崩溃 / 关闭时自动拉起 DSH。
 *   - 设置卡片「立即重启」按钮（先读进程身份，安排重启后等待新进程恢复并刷新页面）。
 *
 * 新增能力（本插件核心）：
 *   - 设置项 `autostartEnabled`：在 OS 登录 / 开机时自动启动 DSH（即「选择」启用 / 「取消」禁用）。
 *   - 设置项 `autostartProfile`：指定开机时启动的 profile（留空则沿用当前进程）。
 *   - 跨平台落地：macOS launchd（~/Library/LaunchAgents）、Windows 注册表 Run、Linux systemd --user。
 *   - 状态路由 GET /plugins/dsh-autostart/autostart：返回当前自启动安装状态（仅环回地址可读）。
 *
 * 重启机制（Node 原生）：本插件运行在 DSH node 进程内，`process.pid / cwd /
 * execPath / execArgv / argv` 直接可得；派生一个 detached helper，在旧进程退出并
 * 释放端口后以原命令行在原目录重新拉起，旧进程随后退出。
 *
 * @module dsh-autostart
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-autostart";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
