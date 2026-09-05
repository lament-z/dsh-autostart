/**
 * dsh-autostart — client half: a plugin-config card (设置 → 插件 → 可配置) bound
 * to the `dsh-autostart` settings namespace, so edits persist to settings.yaml and
 * the Host reads them back through installSettingsSection. Adds a boot-autostart
 * section (enable/cancel + profile) on top of the dsh-restart restart controls.
 */
import type { Context } from './context-types.ts';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
export declare const name = "dsh-autostart-client";
export declare const inject: string[];
export declare const NS = "autostart.card";
export interface RestartCardState {
    available: boolean;
    writable: boolean;
    legacyRestart: boolean;
    continuePrompt: string;
    watchdogEnabled: boolean;
    watchdogCooldownMs: number;
    watchdogPollMs: number;
    /** 开机自启动是否已选择（启用）。 */
    autostartEnabled: boolean;
    /** 开机自启动使用的 profile（可能为空）。 */
    autostartProfile: string;
}
export type SettingsCardProps = PropsLocale<typeof NS> & {
    useDshRestart: <R>(selector: (snapshot: RestartCardState) => R) => R;
    set: (field: string, value: unknown) => void;
    clear: (field: string) => void;
};
export declare function apply(ctx: Context): void;
