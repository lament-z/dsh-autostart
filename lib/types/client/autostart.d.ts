/** Client-side status reader for the autostart feature. */
export interface AutostartStatus {
    installed: boolean;
    method: string | null;
    command: string | null;
    error: string | null;
    at: string;
    enabled: boolean;
    profile: string;
    platform: string;
}
/**
 * Read the current autostart state from the host. Returns null when the host is
 * unreachable (e.g. accessed through a reverse proxy / non-loopback origin).
 */
export declare function fetchAutostartStatus(fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<AutostartStatus | null>;
