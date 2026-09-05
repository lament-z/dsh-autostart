/** Stable local class names; the plugin ships as one self-contained client.js. */
export const styles = {
    card: 'dsh-autostart-card', cardOpen: 'dsh-autostart-card-open', header: 'dsh-autostart-header',
    headText: 'dsh-autostart-head-text', name: 'dsh-autostart-name', description: 'dsh-autostart-description',
    chevron: 'dsh-autostart-chevron', chevronOpen: 'dsh-autostart-chevron-open', body: 'dsh-autostart-body',
    readOnly: 'dsh-autostart-read-only', field: 'dsh-autostart-field', toggleField: 'dsh-autostart-toggle-field',
    toggleCopy: 'dsh-autostart-toggle-copy', label: 'dsh-autostart-label', hint: 'dsh-autostart-hint',
    checkbox: 'dsh-autostart-checkbox', input: 'dsh-autostart-input', footer: 'dsh-autostart-footer',
    actionHint: 'dsh-autostart-action-hint', failed: 'dsh-autostart-failed', restart: 'dsh-autostart-button',
    status: 'dsh-autostart-status', statusCode: 'dsh-autostart-status-code',
};
const STYLE_ID = 'dsh-autostart-settings-card-styles';
/** Install card styles once without creating a second dynamically loaded asset. */
export function ensureStyles() {
    if (document.getElementById(STYLE_ID) !== null)
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.dsh-autostart-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}
.dsh-autostart-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-autostart-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dsh-autostart-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-autostart-header:focus-visible,.dsh-autostart-button:focus-visible,.dsh-autostart-checkbox:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-autostart-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-autostart-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-autostart-description{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-autostart-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsh-autostart-chevron-open{transform:rotate(180deg)}
.dsh-autostart-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dsh-autostart-read-only{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-autostart-field,.dsh-autostart-toggle-field{display:flex;gap:6px;padding:12px 0}
.dsh-autostart-field{flex-direction:column}.dsh-autostart-toggle-field{align-items:flex-start;cursor:pointer}
.dsh-autostart-field+.dsh-autostart-field,.dsh-autostart-field+.dsh-autostart-toggle-field,.dsh-autostart-toggle-field+.dsh-autostart-field,.dsh-autostart-toggle-field+.dsh-autostart-toggle-field{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-autostart-toggle-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-autostart-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-autostart-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-autostart-checkbox{width:16px;height:16px;margin:2px 2px 0 0;accent-color:var(--dsw-alias-brand-primary)}
.dsh-autostart-checkbox:disabled{cursor:default;opacity:.5}
.dsh-autostart-input{height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-autostart-input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dsh-autostart-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dsh-autostart-footer{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-autostart-action-hint,.dsh-autostart-failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5}
.dsh-autostart-action-hint{color:var(--dsw-alias-label-tertiary)}.dsh-autostart-failed{color:var(--dsw-alias-label-error)}
.dsh-autostart-status{margin:10px 0 2px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsh-autostart-status-code{margin:0;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;word-break:break-all}
.dsh-autostart-button{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsh-autostart-button.secondary{background:transparent;border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dsh-autostart-button:disabled{opacity:.4;cursor:default}
@media(max-width:480px){.dsh-autostart-footer{align-items:stretch;flex-direction:column}.dsh-autostart-button{width:100%}}
`;
    document.head.append(style);
}
