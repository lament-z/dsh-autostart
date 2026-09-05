const AUTOSTART_URL = '/plugins/dsh-autostart/autostart';
/**
 * Read the current autostart state from the host. Returns null when the host is
 * unreachable (e.g. accessed through a reverse proxy / non-loopback origin).
 */
export async function fetchAutostartStatus(fetchImpl = fetch, signal) {
    try {
        const response = await fetchImpl(AUTOSTART_URL, { method: 'GET', cache: 'no-store', signal });
        if (!response.ok)
            return null;
        return (await response.json());
    }
    catch {
        return null;
    }
}
