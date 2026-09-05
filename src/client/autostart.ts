/** Client-side status reader for the autostart feature. */
export interface AutostartStatus {
  installed: boolean
  method: string | null
  command: string | null
  error: string | null
  at: string
  enabled: boolean
  profile: string
  platform: string
}

const AUTOSTART_URL = '/plugins/dsh-autostart/autostart'

/**
 * Read the current autostart state from the host. Returns null when the host is
 * unreachable (e.g. accessed through a reverse proxy / non-loopback origin).
 */
export async function fetchAutostartStatus(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<AutostartStatus | null> {
  try {
    const response = await fetchImpl(AUTOSTART_URL, { method: 'GET', cache: 'no-store', signal })
    if (!response.ok) return null
    return (await response.json()) as AutostartStatus
  } catch {
    return null
  }
}
