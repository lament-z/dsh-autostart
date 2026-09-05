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

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

export const name = 'dsh-autostart'
export const inject = ['tools', 'commands', 'agents', 'shell', 'sandboxPolicy']

/** Plugin configuration (editable via settings.yaml and the UI card). */
interface RestartConfig {
  legacyRestart: boolean
  continuePrompt: string
  watchdogEnabled: boolean
  watchdogCooldownMs: number
  watchdogPollMs: number
  /** 开机自启动：true = 在 OS 登录/开机时启动 DSH（「选择」）；false = 取消（「取消」）。 */
  autostartEnabled: boolean
  /** 开机自启动时使用的 profile；留空则沿用当前进程的 profile。 */
  autostartProfile: string
}

const RestartConfigSchema: z<RestartConfig> = z.object({
  legacyRestart: z.boolean().default(false),
  continuePrompt: z.string().default('（系统已重启完成）请继续之前未完成的工作。'),
  watchdogEnabled: z.boolean().default(false),
  watchdogCooldownMs: z.number().default(60000),
  watchdogPollMs: z.number().default(1000),
  autostartEnabled: z.boolean().default(false),
  autostartProfile: z.string().default(''),
})

const DEFAULT_CONFIG: RestartConfig = {
  legacyRestart: false,
  continuePrompt: '（系统已重启完成）请继续之前未完成的工作。',
  watchdogEnabled: false,
  watchdogCooldownMs: 60000,
  watchdogPollMs: 1000,
  autostartEnabled: false,
  autostartProfile: '',
}

/** The "process file index": boot facts for external inspection. */
const INDEX_FILENAME = 'dsh-autostart-process.json'

/** The "resume marker": the in-progress session to restore after a restart. */
const RESUME_FILENAME = 'dsh-autostart-resume.json'

/** Watchdog artifact filenames (supervisor script + its pid lock). */
const WATCHDOG_FILENAME = 'dsh-autostart-watchdog.cjs'
const WATCHDOG_PID_FILENAME = 'dsh-autostart-watchdog.pid'
const WATCHDOG_STOP_FILENAME = 'dsh-autostart-stop.flag'

/** Restart-in-progress flag: stops the watchdog from racing a deliberate restart. */
const RESTARTING_FLAG_FILENAME = 'dsh-autostart-restarting.flag'

/** Autostart state file: records whether the OS entry is currently installed. */
const AUTOSTART_STATE_FILENAME = 'dsh-autostart.json'

/** Stable identity for this loaded DSH process. */
const PROCESS_STARTED_AT = new Date(performance.timeOrigin).toISOString()

function homeDir(): string {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function indexFilePath(): string {
  return path.join(homeDir(), INDEX_FILENAME)
}

function resumeFilePath(): string {
  return path.join(homeDir(), RESUME_FILENAME)
}

function watchdogFilePath(): string {
  return path.join(homeDir(), WATCHDOG_FILENAME)
}

function watchdogPidFilePath(): string {
  return path.join(homeDir(), WATCHDOG_PID_FILENAME)
}

function watchdogStopFilePath(): string {
  return path.join(homeDir(), WATCHDOG_STOP_FILENAME)
}

function restartingFlagFilePath(): string {
  return path.join(homeDir(), RESTARTING_FLAG_FILENAME)
}

function autostartStateFilePath(): string {
  return path.join(homeDir(), AUTOSTART_STATE_FILENAME)
}

function writeRestartingFlag(): void {
  try { fs.writeFileSync(restartingFlagFilePath(), String(Date.now()), 'utf8') } catch { /* best-effort */ }
}

function clearRestartingFlag(): void {
  try { fs.unlinkSync(restartingFlagFilePath()) } catch { /* already gone */ }
}

/** Record the in-progress sessions before restart (for auto-resume after reboot). */
function writeResumeMarker(sessionIds: string[]): void {
  try {
    fs.writeFileSync(resumeFilePath(), JSON.stringify({
      sessionIds,
      restartAt: new Date().toISOString(),
      pid: process.pid,
    }, null, 2) + '\n', 'utf8')
  } catch (error) {
    console.error('[dsh-autostart] failed to write resume marker:', error)
  }
}

/** Read a session id defensively from an agent-shaped object. */
function sessionIdOf(agent: unknown): string | undefined {
  const session = (agent as { session?: { id?: unknown; header?: { id?: unknown } } } | undefined)?.session
  const id = session?.id ?? session?.header?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/** Read the resume marker recorded before the last restart (list or legacy single form). */
function readResumeMarker(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(resumeFilePath(), 'utf8'))
    const record = parsed as { sessionIds?: unknown; sessionId?: unknown }
    if (Array.isArray(record.sessionIds)) {
      return record.sessionIds.filter((id): id is string => typeof id === 'string' && id !== '')
    }
    if (typeof record.sessionId === 'string' && record.sessionId !== '') {
      return [record.sessionId]
    }
    return []
  } catch {
    return []
  }
}

/** Append a line to the plugin's own debug log for diagnosing auto-continue / autostart. */
function debugLog(message: string): void {
  try {
    fs.appendFileSync(path.join(homeDir(), 'dsh-autostart-auto.log'), `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch { /* best-effort */ }
}

/** Remove the resume marker once it has been consumed. */
function clearResumeMarker(): void {
  try { fs.unlinkSync(resumeFilePath()) } catch { /* already gone */ }
}

/**
 * After a restart, wait for the recorded session to be resumed (the client
 * re-opens it) and then inject one "continue" follow-up so the agent picks up
 * the interrupted work without a manual prompt. Polls the live agent registry;
 * gives up after ~60s and clears the marker.
 */
function tryAutoContinue(ctx: Context, dynamic: () => RestartConfig): void {
  const sessionIds = readResumeMarker()
  debugLog(`auto-continue: marker has ${sessionIds.length} session(s) ${JSON.stringify(sessionIds)}`)
  if (sessionIds.length === 0) return
  const pending = new Set(sessionIds)
  let attempts = 0
  const interval = setInterval(() => {
    attempts += 1
    for (const sessionId of [...pending]) {
      const agent = ctx.agents.get(sessionId as never)
      if (agent === undefined) continue
      debugLog(`auto-continue: agent for ${sessionId} is live, following up`)
      try {
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: dynamic().continuePrompt }],
          source: { kind: 'plugin', plugin: name, form: 'instructions' },
        }))
      } catch (error) {
        console.error('[dsh-autostart] auto-continue failed:', error)
        debugLog(`auto-continue: followup error for ${sessionId}: ${String(error)}`)
      }
      pending.delete(sessionId)
    }
    if (pending.size === 0) {
      debugLog('auto-continue: all sessions continued')
      clearInterval(interval)
      clearResumeMarker()
    } else if (attempts >= 120) {
      debugLog(`auto-continue: timed out after 60s, ${pending.size} session(s) never resumed: ${JSON.stringify([...pending])}`)
      clearInterval(interval)
      clearResumeMarker()
    }
  }, 500)
  ctx.effect(() => () => clearInterval(interval))
}

/**
 * The supervisor script (written to $DSH_HOME/dsh-autostart-watchdog.cjs and run detached):
 * polls whether the DSH web server answers on its port, and relaunches it when
 * the port goes down. Liveness is PORT-based (not pid-based), so a stale process
 * index can never cause a double spawn. A `dsh-autostart-restarting.flag` (written by both
 * the restart tool and the watchdog's own relaunch) suppresses relaunch while a
 * restart is already in flight. A `dsh-autostart-stop.flag` file stops the watchdog.
 */
function watchdogScript(cooldownMs: number, pollMs: number): string {
  return String.raw`// dsh-autostart watchdog: monitors the DSH web port and relaunches it on death.
const { spawn } = require('node:child_process')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const indexFile = path.join(home, 'dsh-autostart-process.json')
const stopFile = path.join(home, 'dsh-autostart-stop.flag')
const restartFlag = path.join(home, 'dsh-autostart-restarting.flag')
const pidFile = path.join(home, 'dsh-autostart-watchdog.pid')
const logFile = path.join(home, 'dsh-autostart-watchdog.log')
const PORT = (function () {
  const m = String(process.env.DSH_WEB_URL || '').match(/:(\d+)/)
  return m ? Number(m[1]) : 3080
})()

function log(msg) {
  try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n', 'utf8') } catch {}
}

try { fs.writeFileSync(pidFile, String(process.pid), 'utf8') } catch {}

function readIndex() {
  try { return JSON.parse(fs.readFileSync(indexFile, 'utf8')) } catch { return null }
}

function portUp(cb) {
  const s = net.connect({ port: PORT, host: '127.0.0.1', timeout: 400 })
  s.once('connect', function () { s.destroy(); cb(true) })
  s.once('timeout', function () { s.destroy(); cb(false) })
  s.once('error', function () { cb(false) })
}

function restartInProgress() {
  try {
    const t = Number(fs.readFileSync(restartFlag, 'utf8'))
    return Number.isFinite(t) && (Date.now() - t) < ${cooldownMs}
  } catch { return false }
}

function relaunch() {
  const idx = readIndex()
  if (!idx || !idx.execPath) { log('relaunch: no usable index'); return }
  try { fs.writeFileSync(restartFlag, String(Date.now()), 'utf8') } catch {}
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const out = path.join(os.tmpdir(), 'dsh-autostart-watchdog-' + stamp + '.out.log')
  const err = path.join(os.tmpdir(), 'dsh-autostart-watchdog-' + stamp + '.err.log')
  try {
    const o = fs.openSync(out, 'a')
    const e = fs.openSync(err, 'a')
    const argv = [].concat(idx.execArgv || [], idx.argv || [])
    const child = spawn(idx.execPath, argv, { cwd: idx.cwd, detached: true, stdio: ['ignore', o, e], env: process.env })
    child.once('error', function (er) { log('relaunch spawn error: ' + String(er)) })
    child.unref()
    log('relaunch: spawned pid ' + child.pid + ' cwd=' + idx.cwd)
  } catch (er) {
    log('relaunch failed: ' + String(er))
  }
}

let checking = false
setInterval(function () {
  if (fs.existsSync(stopFile)) {
    log('stop flag present, exiting')
    try { fs.unlinkSync(pidFile) } catch {}
    process.exit(0)
  }
  if (checking) return
  checking = true
  portUp(function (up) {
    if (up) { checking = false; return }
    if (restartInProgress()) { checking = false; return }
    log('port ' + PORT + ' down, relaunching')
    relaunch()
    checking = false
  })
}, ${pollMs})

log('watchdog started, pid ' + process.pid)
`
}

/** Spawn the supervisor once (guarded by its pid lock) so DSH comes back on death. */
function ensureWatchdog(dynamic: () => RestartConfig): void {
  if (!dynamic().watchdogEnabled) return
  try {
    const pid = Number.parseInt(fs.readFileSync(watchdogPidFilePath(), 'utf8'), 10)
    if (!Number.isNaN(pid) && pid > 0) {
      try { process.kill(pid, 0); return } catch { /* stale pid file — spawn a fresh one */ }
    }
  } catch { /* no pid file yet */ }
  try {
    fs.writeFileSync(watchdogFilePath(), watchdogScript(dynamic().watchdogCooldownMs, dynamic().watchdogPollMs), 'utf8')
    const child = spawn(process.execPath, [watchdogFilePath()], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    })
    child.once('error', () => {})
    child.unref()
    debugLog('watchdog spawned pid ' + child.pid)
  } catch (error) {
    console.error('[dsh-autostart] failed to spawn watchdog:', error)
  }
}

/** Quote one argv element for a cmd-runnable command line. */
function quoteArg(value: string): string {
  return /[\s"]/.test(value) ? '"' + value.replace(/"/g, '\\"') + '"' : value
}

/** Reconstruct the launch command line from the running node process. */
function launchCommandLine(): string {
  return [process.execPath, ...process.execArgv, ...process.argv.slice(1)]
    .map(quoteArg)
    .join(' ')
}

/**
 * Build the argv array used to relaunch / autostart DSH.
 * `profile` optionally injects `--profile <p>` (only if not already present in argv).
 */
function buildLaunchArgs(profile: string): string[] {
  const args: string[] = [process.execPath, ...process.execArgv]
  const rest = process.argv.slice(1)
  const hasProfile = rest.includes('--profile') || rest.some(a => a.startsWith('--profile='))
  const trimmed = profile.trim()
  if (trimmed !== '' && !hasProfile) args.push('--profile', trimmed)
  args.push(...rest)
  return args
}

/** Run a command synchronously, logging failures to the debug log. Returns exit status. */
function runSync(cmd: string, args: string[]): number {
  try {
    const result = spawnSync(cmd, args, { stdio: 'ignore' })
    if (result.error) {
      debugLog(`autostart: ${cmd} failed: ${String(result.error)}`)
      return -1
    }
    return result.status ?? 0
  } catch (error) {
    debugLog(`autostart: ${cmd} threw: ${String(error)}`)
    return -1
  }
}

/** Persist the autostart state so the status route and the card can report it. */
interface AutostartState {
  installed: boolean
  method: string | null
  command: string | null
  error: string | null
  at: string
}
function writeAutostartState(state: Omit<AutostartState, 'at'>): void {
  try {
    fs.mkdirSync(homeDir(), { recursive: true })
    fs.writeFileSync(autostartStateFilePath(), JSON.stringify({ ...state, at: new Date().toISOString() }, null, 2) + '\n', 'utf8')
  } catch { /* best-effort */ }
}
function readAutostartState(): AutostartState {
  const fallback: AutostartState = { installed: false, method: null, command: null, error: null, at: '' }
  try {
    const parsed = JSON.parse(fs.readFileSync(autostartStateFilePath(), 'utf8'))
    return { ...fallback, ...(parsed as Partial<AutostartState>) }
  } catch {
    return fallback
  }
}

/** Build a macOS launchd plist document (RunAtLoad, no KeepAlive — that's the watchdog's job). */
function buildLaunchdPlist(label: string, args: string[], cwd: string): string {
  const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const programArgs = args.map(a => `    <string>${escape(a)}</string>`).join('\n')
  const env = process.env.DSH_HOME
    ? `  <key>EnvironmentVariables</key>
  <dict>
    <key>DSH_HOME</key>
    <string>${escape(process.env.DSH_HOME)}</string>
  </dict>
`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>WorkingDirectory</key>
  <string>${escape(cwd)}</string>
${env}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${escape(path.join(os.tmpdir(), 'dsh-autostart.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escape(path.join(os.tmpdir(), 'dsh-autostart.err.log'))}</string>
</dict>
</plist>
`
}

/** Build a Linux systemd --user unit. */
function buildSystemdUnit(command: string): string {
  return `[Unit]
Description=DeepSeek Harness (dsh-autostart)
After=network.target

[Service]
Type=simple
ExecStart=${command}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
}

/** Install the OS autostart entry for the current platform (best-effort, logged). */
function installAutostart(dynamic: () => RestartConfig): void {
  const profile = dynamic().autostartProfile || ''
  const args = buildLaunchArgs(profile)
  const command = args.map(quoteArg).join(' ')
  const platform = process.platform
  try {
    if (platform === 'darwin') {
      const label = 'ai.deepseek.dsh.autostart'
      const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
      fs.mkdirSync(path.dirname(plistPath), { recursive: true })
      fs.writeFileSync(plistPath, buildLaunchdPlist(label, args, process.cwd()), 'utf8')
      // Try both modern (bootout/bootstrap) and legacy (unload/load) loaders.
      runSync('launchctl', ['unload', plistPath])
      runSync('launchctl', ['load', plistPath])
      const uid = typeof process.getuid === 'function' ? String(process.getuid()) : ''
      if (uid) runSync('launchctl', ['bootout', `gui/${uid}/${label}`])
      if (uid) runSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath])
      writeAutostartState({ installed: true, method: 'launchd', command, error: null })
      debugLog(`autostart installed (launchd): ${plistPath}`)
    } else if (platform === 'win32') {
      const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
      runSync('reg', ['add', key, '/v', 'DSH Autostart', '/t', 'REG_SZ', '/d', command, '/f'])
      writeAutostartState({ installed: true, method: 'registry', command, error: null })
      debugLog('autostart installed (registry Run)')
    } else if (platform === 'linux') {
      const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', 'dsh-autostart.service')
      fs.mkdirSync(path.dirname(unitPath), { recursive: true })
      fs.writeFileSync(unitPath, buildSystemdUnit(command), 'utf8')
      runSync('systemctl', ['--user', 'daemon-reload'])
      runSync('systemctl', ['--user', 'enable', '--now', 'dsh-autostart'])
      writeAutostartState({ installed: true, method: 'systemd', command, error: null })
      debugLog(`autostart installed (systemd): ${unitPath}`)
    } else {
      writeAutostartState({ installed: false, method: platform, command, error: `unsupported platform: ${platform}` })
      debugLog(`autostart unsupported platform: ${platform}`)
    }
  } catch (error) {
    writeAutostartState({ installed: false, method: null, command, error: String(error) })
    debugLog(`autostart install error: ${String(error)}`)
  }
}

/** Remove the OS autostart entry for the current platform (best-effort, logged). */
function uninstallAutostart(): void {
  const platform = process.platform
  try {
    if (platform === 'darwin') {
      const label = 'ai.deepseek.dsh.autostart'
      const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
      const uid = typeof process.getuid === 'function' ? String(process.getuid()) : ''
      if (uid) runSync('launchctl', ['bootout', `gui/${uid}/${label}`])
      runSync('launchctl', ['unload', plistPath])
      try { fs.unlinkSync(plistPath) } catch { /* already gone */ }
    } else if (platform === 'win32') {
      const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
      runSync('reg', ['delete', key, '/v', 'DSH Autostart', '/f'])
    } else if (platform === 'linux') {
      runSync('systemctl', ['--user', 'disable', '--now', 'dsh-autostart'])
      try { fs.unlinkSync(path.join(os.homedir(), '.config', 'systemd', 'user', 'dsh-autostart.service')) } catch { /* already gone */ }
    }
  } catch (error) {
    debugLog(`autostart uninstall error: ${String(error)}`)
  }
  writeAutostartState({ installed: false, method: null, command: null, error: null })
}

/** Reconcile the OS autostart entry with the current setting (idempotent). */
function syncAutostart(dynamic: () => RestartConfig): void {
  try {
    if (dynamic().autostartEnabled) installAutostart(dynamic)
    else uninstallAutostart()
  } catch (error) {
    debugLog(`syncAutostart error: ${String(error)}`)
  }
}

/** Write pid + cwd + command line at boot (kept for external inspection + watchdog relaunch). */
function writeProcessIndex(): void {
  try {
    const file = indexFilePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({
      pid: process.pid,
      cwd: process.cwd(),
      commandLine: launchCommandLine(),
      execPath: process.execPath,
      execArgv: process.execArgv,
      argv: process.argv.slice(1),
      startedAt: PROCESS_STARTED_AT,
    }, null, 2) + '\n', 'utf8')
  } catch (error) {
    console.error('[dsh-autostart] failed to write process index:', error)
  }
}

interface RestartInfo {
  ok: boolean
  pid: number
  cwd: string
  commandLine: string
  delayMs: number
  logOut: string
  logErr: string
}

/**
 * Node-native self-restart. Spawns a detached helper that relaunches DSH after
 * the current process has exited and released its port, then schedules the
 * current process's own exit.
 */
function restart(delayMs: number): RestartInfo {
  writeRestartingFlag()
  const argv = [...process.execArgv, ...process.argv.slice(1)]
  const cwd = process.cwd()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logOut = path.join(os.tmpdir(), `dsh-autostart-${stamp}.out.log`)
  const logErr = path.join(os.tmpdir(), `dsh-autostart-${stamp}.err.log`)

  // Detached helper: waits for the old process to release its port, then spawns
  // the new DSH with the same argv + cwd, output appended to the log files.
  const helperCode = [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    `const argv = ${JSON.stringify(argv)}`,
    `const cwd = ${JSON.stringify(cwd)}`,
    `const logOut = ${JSON.stringify(logOut)}`,
    `const logErr = ${JSON.stringify(logErr)}`,
    `const delay = ${delayMs + 800}`,
    'setTimeout(() => {',
    '  try {',
    '    const out = fs.openSync(logOut, "a")',
    '    const err = fs.openSync(logErr, "a")',
    '    const child = spawn(process.execPath, argv, { cwd: cwd, detached: true, stdio: ["ignore", out, err], env: process.env })',
    '    child.once("error", () => process.exit(0))',
    '    child.unref()',
    '  } catch (e) { process.exit(0) }',
    '}, delay)',
  ].join('\n')

  const helper = spawn(process.execPath, ['-e', helperCode], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  helper.once('error', () => {})
  helper.unref()

  // Exit the old process after the tool/command result has had time to flush.
  setTimeout(() => process.exit(0), delayMs)

  return {
    ok: true,
    pid: process.pid,
    cwd,
    commandLine: launchCommandLine(),
    delayMs,
    logOut,
    logErr,
  }
}

interface WebRestartRequest {
  socket: { remoteAddress?: string }
  headers: { origin?: string; host?: string }
}

function isLoopbackWebRequest(req: WebRestartRequest): boolean {
  const address = req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Accept the privileged restart action only from this Web host on loopback. */
function isTrustedWebRestart(req: WebRestartRequest): boolean {
  if (!isLoopbackWebRequest(req)) return false
  const { origin, host } = req.headers
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

/** Session ids that should resume after a deliberate restart. */
function runningSessionIds(ctx: Context): string[] {
  return [...new Set(
    ctx.agents.roots()
      .filter(agent => agent.status === 'running')
      .map(agent => String(agent.id)),
  )]
}

/**
 * Legacy restart (PowerShell + WMI + taskkill), kept for compatibility: reads
 * the process index, writes a helper .ps1, launches it detached via WMI, and
 * lets it taskkill the tree before relaunching via cmd /c.
 */
function buildLegacyScript(indexPath: string, delayMs: number): string {
  const indexPathLiteral = indexPath.replace(/'/g, "''")
  return `$ErrorActionPreference = 'Stop'
$indexPath = '${indexPathLiteral}'
if (-not (Test-Path -LiteralPath $indexPath)) { throw "process index not found: $indexPath" }
$idx = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
$pid0 = [int]$idx.pid
$cwd = [string]$idx.cwd
$cmdline = [string]$idx.commandLine
if (-not (Get-Process -Id $pid0 -ErrorAction SilentlyContinue)) { throw "recorded pid $pid0 is not alive" }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logOut = Join-Path $env:TEMP ("dsh-autostart-" + $stamp + ".out.log")
$logErr = Join-Path $env:TEMP ("dsh-autostart-" + $stamp + ".err.log")
$cwdB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cwd))
$cmdB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cmdline))
$logOutB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($logOut))
$logErrB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($logErr))
$helperTemplate = @'
$ErrorActionPreference = 'Continue'
$nodePid = __PID__
$cwdB64 = '__CWDB64__'
$cmdB64 = '__CMDB64__'
$logOutB64 = '__LOGOUTB64__'
$logErrB64 = '__LOGERRB64__'
$delayMs = __DELAY__
$cwd = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($cwdB64))
$cmdline = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($cmdB64))
$logOut = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($logOutB64))
$logErr = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($logErrB64))
Start-Sleep -Milliseconds $delayMs
taskkill /F /T /PID $nodePid 2>&1 | Out-Null
Start-Sleep -Milliseconds 500
try {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c', $cmdline -WorkingDirectory $cwd -WindowStyle Hidden -RedirectStandardOutput $logOut -RedirectStandardError $logErr
} catch {
  Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdline; CurrentDirectory = $cwd } | Out-Null
}
'@
$helper = $helperTemplate.Replace('__PID__', [string]$pid0).Replace('__CWDB64__', $cwdB64).Replace('__CMDB64__', $cmdB64).Replace('__LOGOUTB64__', $logOutB64).Replace('__LOGERRB64__', $logErrB64).Replace('__DELAY__', [string]${delayMs})
$helperPath = Join-Path $env:TEMP 'dsh-autostart-helper.ps1'
Set-Content -LiteralPath $helperPath -Value $helper -Encoding UTF8
$launch = 'pwsh.exe -NoProfile -NonInteractive -File "' + $helperPath + '"'
$r = Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{ CommandLine = $launch }
$result = [ordered]@{ pid = $pid0; cwd = $cwd; commandLine = $cmdline; delayMs = ${delayMs}; helperReturnValue = [int]$r.ReturnValue; helperPid = [int]$r.ProcessId; logOut = $logOut; logErr = $logErr }
$result | ConvertTo-Json -Compress`
}

/** Run the legacy PowerShell/WMI restart through the shell service. */
async function restartLegacy(ctx: Context, delayMs: number, policy: unknown): Promise<unknown> {
  writeRestartingFlag()
  const request: Record<string, unknown> = {
    command: buildLegacyScript(indexFilePath(), delayMs),
    timeoutMs: 30000,
  }
  if (policy !== undefined) request.sandboxPolicy = policy
  const spec = ctx.shell.resolve(request as never)
  const result = await ctx.shell.run(spec)
  const stdout = result.stdout && typeof result.stdout.text === 'string' ? result.stdout.text : ''
  const stderr = result.stderr && typeof result.stderr.text === 'string' ? result.stderr.text : ''
  if (result.exitCode !== 0) {
    return { ok: false, error: 'legacy restart failed', exitCode: result.exitCode, stdout, stderr }
  }
  try {
    return { ok: true, ...JSON.parse(stdout.trim()) }
  } catch {
    return { ok: false, error: 'failed to parse legacy restart output', stdout, stderr }
  }
}

export function apply(ctx: Context): void {
  debugLog(`apply: start pid=${process.pid}`)
  try {
    writeProcessIndex()
    debugLog('apply: index written')
  } catch (error) {
    debugLog('apply: writeProcessIndex THREW: ' + String(error))
  }
  clearRestartingFlag()

  let resolveConfig: () => RestartConfig = () => DEFAULT_CONFIG
  const dynamic = (): RestartConfig => resolveConfig()
  try {
    installSettingsSection(ctx, settingsNamespace('dsh-autostart'), RestartConfigSchema, DEFAULT_CONFIG, {
      setSource: (get) => { resolveConfig = get },
      onChange: () => { syncAutostart(dynamic) },
    })
    debugLog('apply: settings installed')
  } catch (error) {
    debugLog('apply: installSettingsSection THREW: ' + String(error))
  }

  // Reconcile the OS autostart entry with the persisted setting on every boot
  // (catches a plist/registry deleted while DSH was off).
  try {
    syncAutostart(dynamic)
    debugLog('apply: autostart synced')
  } catch (error) {
    debugLog('apply: syncAutostart THREW: ' + String(error))
  }

  try {
    tryAutoContinue(ctx, dynamic)
    debugLog('apply: auto-continue scheduled')
  } catch (error) {
    debugLog('apply: tryAutoContinue THREW: ' + String(error))
  }
  try {
    ensureWatchdog(dynamic)
    debugLog('apply: watchdog ensured')
  } catch (error) {
    debugLog('apply: ensureWatchdog THREW: ' + String(error))
  }

  // The restart bundle may mount before the Web host. A one-shot ctx.get()
  // therefore makes the Settings button permanently unavailable on that boot.
  // Inject the optional service so the route follows the Web server lifetime.
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer as { register: (route: WebRoute) => () => void }
    webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-autostart/restart',
      handler: (req, res) => {
        if (req.method === 'GET') {
          if (!isLoopbackWebRequest(req)) {
            res.writeHead(403)
            res.end('forbidden')
            return
          }
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify({ pid: process.pid, startedAt: PROCESS_STARTED_AT }))
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'GET, POST' })
          res.end('method not allowed')
          return
        }
        if (!isTrustedWebRestart(req)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        const sessionIds = runningSessionIds(ctx)
        if (sessionIds.length > 0) writeResumeMarker(sessionIds)
        const result = restart(2000)
        res.writeHead(202, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify({ ...result, sessionIds }))
      },
    })

    // Autostart status route (read-only, loopback-only, no privileged action).
    webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-autostart/autostart',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end('method not allowed')
          return
        }
        if (!isLoopbackWebRequest(req)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        const state = readAutostartState()
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify({
          ...state,
          enabled: dynamic().autostartEnabled,
          profile: dynamic().autostartProfile || '',
          platform: process.platform,
        }))
      },
    })
  })

  try {
    ctx.tools.register(defineTool({
    name: 'restart_harness',
    description:
      '重启整个 DeepSeek Harness 进程，用于重新加载插件与配置（profile 的 cordis 组合、settings 等）。'
      + '直接读取当前 node 进程的 pid/工作目录/启动命令行，派生一个 detach 的 helper，'
      + '在旧进程退出并释放端口后以原命令行在原目录重新拉起，然后旧进程退出。'
      + '触发后当前会话连接会短暂中断，网页随后自动重连到新进程。'
      + '返回旧进程 pid、cwd、命令行与日志文件路径。',
    parameters: {
      delayMs: { type: 'number', description: '旧进程退出前等待的毫秒数（给当前结果留出回传时间），默认 2000。' },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    async execute(args, exec) {
      const a = (args ?? {}) as { delayMs?: number }
      const delayMs = Number(a.delayMs) > 0 ? Math.floor(Number(a.delayMs)) : 2000
      // Only resume sessions that were mid-turn (running) at restart time. Idle
      // (already-ended) conversations are left alone — the client re-opens them.
      const sessionIds = runningSessionIds(ctx)
      if (sessionIds.length > 0) writeResumeMarker(sessionIds)
      if (dynamic().legacyRestart) {
        let policy: unknown
        if (exec?.agent?.session) {
          try { policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session }) } catch { policy = undefined }
        }
        const result = await restartLegacy(ctx, delayMs, policy)
        return { ...(result as object), sessionIds }
      }
      return { ...restart(delayMs), sessionIds }
    },
  }))
    debugLog('apply: restart_harness tool registered')
  } catch (error) {
    debugLog('apply: tools.register THREW: ' + String(error))
  }

  try {
    ctx.commands.register({
    name: 'restart',
    description: '重启 DeepSeek Harness（重载插件与配置）',
    recordInput: false,
    async handler(invocation) {
      // Only resume sessions that were mid-turn (running); idle conversations stay put.
      const sessionIds = runningSessionIds(ctx)
      if (sessionIds.length > 0) writeResumeMarker(sessionIds)
      let result: unknown
      if (dynamic().legacyRestart) {
        let policy: unknown
        if (invocation?.agent?.session) {
          try { policy = ctx.sandboxPolicy.resolve({ session: invocation.agent.session }) } catch { policy = undefined }
        }
        result = await restartLegacy(ctx, 2000, policy)
      } else {
        result = restart(2000)
      }
      const r = result as { ok?: boolean; pid?: number; delayMs?: number; logOut?: string; error?: string }
      if (r.ok === false) {
        return { kind: 'error', text: r.error ?? '重启失败' }
      }
      return {
        kind: 'success',
        text: `重启已安排：DSH 进程 PID ${r.pid} 将在约 ${r.delayMs}ms 后重启，将恢复 ${sessionIds.length} 个会话，新进程日志见 ${r.logOut}`,
      }
    },
  })
    debugLog('apply: restart command registered')
  } catch (error) {
    debugLog('apply: commands.register THREW: ' + String(error))
  }

  debugLog('apply: complete')
}
