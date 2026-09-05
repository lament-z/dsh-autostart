import { useEffect, useRef, useState } from 'react'
import type { SettingsCardProps } from './index'
import { restartAndWait } from './restart-monitor'
import { fetchAutostartStatus, type AutostartStatus } from './autostart'
import { styles as css } from './styles'

const RESTART_SUCCEEDED_KEY = 'dsh-autostart:completed'

function consumeRestartSucceeded(): boolean {
  try {
    const succeeded = sessionStorage.getItem(RESTART_SUCCEEDED_KEY) === '1'
    if (succeeded) sessionStorage.removeItem(RESTART_SUCCEEDED_KEY)
    return succeeded
  } catch {
    return false
  }
}

function rememberRestartSucceeded(): void {
  try { sessionStorage.setItem(RESTART_SUCCEEDED_KEY, '1') } catch { /* reload still works */ }
}

/** The dsh-autostart configuration card, styled with the host plugin-card tokens. */
export function SettingsCard(props: SettingsCardProps) {
  const { t, set, clear } = props
  const state = props.useDshRestart(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartFailed, setRestartFailed] = useState(false)
  const [restartStale, setRestartStale] = useState(false)
  const [restartSucceeded, setRestartSucceeded] = useState(consumeRestartSucceeded)
  const restartController = useRef<AbortController | null>(null)

  // Autostart live status (read from the host; null when unreachable).
  const [autostartStatus, setAutostartStatus] = useState<AutostartStatus | null>(null)
  const [autostartBusy, setAutostartBusy] = useState(false)

  useEffect(() => () => { restartController.current?.abort() }, [])
  useEffect(() => {
    if (!restartSucceeded) return
    const timer = window.setTimeout(() => { setRestartSucceeded(false) }, 5000)
    return () => { window.clearTimeout(timer) }
  }, [restartSucceeded])

  // Refresh autostart status when the card is expanded (loopback-only on the host).
  useEffect(() => {
    if (!open || !state.available) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void fetchAutostartStatus().then(s => { if (!cancelled) setAutostartStatus(s) })
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, state.available])

  const refreshAutostart = (delay = 0): void => {
    const timer = window.setTimeout(() => {
      void fetchAutostartStatus().then(s => setAutostartStatus(s))
    }, delay)
    // Best-effort cleanup not strictly required; the timer is short-lived.
    void timer
  }

  if (!state.available) return null
  const disabled = !state.writable

  const toggle = (field: string, value: boolean): void => {
    set(field, value)
    if (field === 'autostartEnabled') {
      setAutostartBusy(true)
      window.setTimeout(() => setAutostartBusy(false), 1200)
      refreshAutostart(900)
    }
  }
  const text = (field: string, value: string): void => {
    if (value.trim() === '') clear(field)
    else set(field, value.trim())
  }
  const number = (field: string, value: string): void => {
    if (value.trim() === '') { clear(field); return }
    const parsed = Number(value)
    if (Number.isFinite(parsed)) set(field, parsed)
  }

  const enableAutostart = (): void => { setAutostartBusy(true); set('autostartEnabled', true); window.setTimeout(() => setAutostartBusy(false), 1200); refreshAutostart(900) }
  const cancelAutostart = (): void => { setAutostartBusy(true); set('autostartEnabled', false); window.setTimeout(() => setAutostartBusy(false), 1200); refreshAutostart(900) }

  const restartNow = async (): Promise<void> => {
    if (restarting) return
    setRestarting(true)
    setRestartFailed(false)
    setRestartStale(false)
    setRestartSucceeded(false)
    const controller = new AbortController()
    restartController.current = controller
    try {
      const result = await restartAndWait({
        signal: controller.signal,
        isVisible: () => document.visibilityState === 'visible',
      })
      if (result === 'stale') {
        setRestartStale(true)
        setRestarting(false)
        return
      }
      rememberRestartSucceeded()
      window.location.reload()
    } catch {
      if (controller.signal.aborted) return
      setRestartFailed(true)
      setRestarting(false)
    } finally {
      if (restartController.current === controller) restartController.current = null
    }
  }

  return (
    <li className={`${css.card} ${open ? css.cardOpen : ''}`}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{t('title')}</span>
          <span className={css.description}>{t('description')}</span>
        </span>
        <svg className={`${css.chevron} ${open ? css.chevronOpen : ''}`} viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <path d="M3.5 5.5 7 9l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className={css.body}>
          {!state.writable ? <p className={css.readOnly} role="status">{t('readOnly')}</p> : null}

          {/* ---- 开机自启动（核心新增） ---- */}
          <label className={css.toggleField}>
            <input className={css.checkbox} type="checkbox" checked={state.autostartEnabled} disabled={disabled || autostartBusy} onChange={event => { toggle('autostartEnabled', event.currentTarget.checked) }} />
            <span className={css.toggleCopy}>
              <span className={css.label}>{t('autostartEnabled')}</span>
              <span className={css.hint}>{t('autostartEnabledHint')}</span>
            </span>
          </label>

          <label className={css.field} htmlFor="dsh-autostart-profile">
            <span className={css.label}>{t('autostartProfile')}</span>
            <input id="dsh-autostart-profile" className={css.input} type="text" value={state.autostartProfile} disabled={disabled} placeholder="web" onChange={event => { text('autostartProfile', event.currentTarget.value) }} />
            <span className={css.hint}>{t('autostartProfileHint')}</span>
          </label>

          <div className={css.status} role="status" aria-live="polite">
            {autostartStatus === null ? (
              <p className={css.hint}>{t('autostartStatusError')}</p>
            ) : autostartStatus.installed ? (
              <>
                <p className={css.label}>{t('autostartStatusInstalled')}（{autostartStatus.method ?? '?'}{autostartStatus.platform ? ` · ${autostartStatus.platform}` : ''}）</p>
                {autostartStatus.command ? <p className={css.statusCode}>{autostartStatus.command}</p> : null}
              </>
            ) : (
              <p className={css.hint}>{t('autostartStatusNotInstalled')}</p>
            )}
          </div>

          <div className={css.footer}>
            <span className={css.actionHint} />
            <button type="button" className={css.restart} disabled={disabled || autostartBusy || state.autostartEnabled} onClick={() => { enableAutostart() }}>
              {t('autostartEnable')}
            </button>
            <button type="button" className={`${css.restart} secondary`} disabled={disabled || autostartBusy || !state.autostartEnabled} onClick={() => { cancelAutostart() }}>
              {t('autostartCancel')}
            </button>
          </div>

          {/* ---- dsh-restart 沿用项 ---- */}
          <label className={css.toggleField}>
            <input className={css.checkbox} type="checkbox" checked={state.legacyRestart} disabled={disabled} onChange={event => { toggle('legacyRestart', event.currentTarget.checked) }} />
            <span className={css.toggleCopy}>
              <span className={css.label}>{t('legacyRestart')}</span>
              <span className={css.hint}>{t('legacyRestartHint')}</span>
            </span>
          </label>

          <label className={css.field} htmlFor="dsh-autostart-continue-prompt">
            <span className={css.label}>{t('continuePrompt')}</span>
            <input id="dsh-autostart-continue-prompt" className={css.input} type="text" value={state.continuePrompt} disabled={disabled} onChange={event => { text('continuePrompt', event.currentTarget.value) }} />
            <span className={css.hint}>{t('continuePromptHint')}</span>
          </label>

          <label className={css.toggleField}>
            <input className={css.checkbox} type="checkbox" checked={state.watchdogEnabled} disabled={disabled} onChange={event => { toggle('watchdogEnabled', event.currentTarget.checked) }} />
            <span className={css.toggleCopy}>
              <span className={css.label}>{t('watchdogEnabled')}</span>
              <span className={css.hint}>{t('watchdogEnabledHint')}</span>
            </span>
          </label>

          <label className={css.field} htmlFor="dsh-autostart-watchdog-cooldown">
            <span className={css.label}>{t('watchdogCooldownMs')}</span>
            <input id="dsh-autostart-watchdog-cooldown" className={css.input} type="number" inputMode="numeric" value={state.watchdogCooldownMs || ''} disabled={disabled} onChange={event => { number('watchdogCooldownMs', event.currentTarget.value) }} />
            <span className={css.hint}>{t('watchdogCooldownMsHint')}</span>
          </label>

          <label className={css.field} htmlFor="dsh-autostart-watchdog-poll">
            <span className={css.label}>{t('watchdogPollMs')}</span>
            <input id="dsh-autostart-watchdog-poll" className={css.input} type="number" inputMode="numeric" value={state.watchdogPollMs || ''} disabled={disabled} onChange={event => { number('watchdogPollMs', event.currentTarget.value) }} />
            <span className={css.hint}>{t('watchdogPollMsHint')}</span>
          </label>

          <div className={css.footer}>
            <p className={restartFailed || restartStale ? css.failed : css.actionHint} role="status" aria-live="polite">
              {restartStale ? t('restartStale') : restartFailed ? t('restartFailed') : restartSucceeded ? t('restartSucceeded') : t('restartHint')}
            </p>
            <button type="button" className={css.restart} disabled={restarting} onClick={() => { void restartNow() }}>
              {t(restarting ? 'restarting' : 'restartNow')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
