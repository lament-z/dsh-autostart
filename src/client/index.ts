/**
 * dsh-autostart — client half: a plugin-config card (设置 → 插件 → 可配置) bound
 * to the `dsh-autostart` settings namespace, so edits persist to settings.yaml and
 * the Host reads them back through installSettingsSection. Adds a boot-autostart
 * section (enable/cancel + profile) on top of the dsh-restart restart controls.
 */
import type { Context } from './context-types.ts'
import { createSnapshotStore, type SettingsScope, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SettingsCard } from './SettingsCard.tsx'
import { en, zh } from './locales.ts'
import { ensureStyles } from './styles.ts'

export const name = 'dsh-autostart-client'
export const inject = ['slots', 'locale', 'settingsScope']
export const NS = 'autostart.card'

export interface RestartCardState {
  available: boolean
  writable: boolean
  legacyRestart: boolean
  continuePrompt: string
  watchdogEnabled: boolean
  watchdogCooldownMs: number
  watchdogPollMs: number
  /** 开机自启动是否已选择（启用）。 */
  autostartEnabled: boolean
  /** 开机自启动使用的 profile（可能为空）。 */
  autostartProfile: string
}

export type SettingsCardProps = PropsLocale<typeof NS> & {
  useDshRestart: <R>(selector: (snapshot: RestartCardState) => R) => R
  set: (field: string, value: unknown) => void
  clear: (field: string) => void
}

export function apply(ctx: Context): void {
  ensureStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-autostart: dictionaries')

  const scope = ctx.settingsScope.bind({ namespace: 'dsh-autostart' }) as SettingsScope<unknown>

  const project = (): RestartCardState => {
    const snap = scope.getSnapshot()
    const value = (snap.value ?? {}) as Record<string, unknown>
    return {
      available: snap.status === 'ready',
      writable: snap.writable,
      legacyRestart: value.legacyRestart === true,
      continuePrompt: typeof value.continuePrompt === 'string' ? value.continuePrompt : '',
      watchdogEnabled: value.watchdogEnabled === true,
      watchdogCooldownMs: typeof value.watchdogCooldownMs === 'number' ? value.watchdogCooldownMs : 0,
      watchdogPollMs: typeof value.watchdogPollMs === 'number' ? value.watchdogPollMs : 0,
      autostartEnabled: value.autostartEnabled === true,
      autostartProfile: typeof value.autostartProfile === 'string' ? value.autostartProfile : '',
    }
  }

  const store: SnapshotStore<RestartCardState> = createSnapshotStore(project())
  scope.subscribe(() => { store.set(project()) })

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'dsh-autostart',
    locale: NS,
    inject: () => ({
      hooks: { dshRestart: store },
      set: (field: string, value: unknown) => { void scope.set(field, value) },
      clear: (field: string) => { void scope.unset(field) },
    }),
  }, SettingsCard))
}
