# AGENTS.md — dsh-autostart

Package-local guidance for AI agents.

- Standalone plugin package (not part of the dsh-web monorepo workspace); install via `dsh plugin --profile web add link:<dir>` (or `npm:` / `github:`) and restart `dsh web` to mount a rebuilt bundle.
- Forked from `anweat/dsh-restart`: carries over the `restart_harness` tool, `/restart` command, watchdog supervisor, and the closure-factory client bundle shape (`window.__ModuleLoader__.load`) configured in `tsdown.config.ts`. The NEW capability is boot autostart (cross-platform), driven by `autostartEnabled` / `autostartProfile` settings.
- The client bundle must keep the closure-factory artifact shape; only `react`/`react-dom`/module-table entries may stay external.
- All `@deepseek-ai/*` usage in `src/client` must stay type-only; runtime services are reached through the cordis context. A value import from dsh packages would either throw in the frozen module table or duplicate runtime state.
- The settings card binds to the `dsh-autostart` namespace via `ctx.settingsScope.bind` on the client and `installSettingsSection(ctx, settingsNamespace('dsh-autostart'), ...)` on the host. On every setting change (`onChange`) the host calls `syncAutostart`, which installs/uninstalls the OS entry — this is the single source of truth for "选择"(enable)/"取消"(disable).
- Autostart install/uninstall is best-effort and platform-guarded (`process.platform`): macOS launchd, Windows registry Run, Linux systemd --user. Failures are written to `dsh-autostart.json` + `dsh-autostart-auto.log`; they never interrupt the DSH process.
- State filenames are namespaced `dsh-autostart-*` (process index, resume marker, watchdog, restarting flag) so this plugin never collides with a co-installed `dsh-restart`.
- No emoji in code, comments, docs, or commit messages.
