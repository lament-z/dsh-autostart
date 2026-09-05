/** Stable local class names; the plugin ships as one self-contained client.js. */
export declare const styles: {
    readonly card: "dsh-autostart-card";
    readonly cardOpen: "dsh-autostart-card-open";
    readonly header: "dsh-autostart-header";
    readonly headText: "dsh-autostart-head-text";
    readonly name: "dsh-autostart-name";
    readonly description: "dsh-autostart-description";
    readonly chevron: "dsh-autostart-chevron";
    readonly chevronOpen: "dsh-autostart-chevron-open";
    readonly body: "dsh-autostart-body";
    readonly readOnly: "dsh-autostart-read-only";
    readonly field: "dsh-autostart-field";
    readonly toggleField: "dsh-autostart-toggle-field";
    readonly toggleCopy: "dsh-autostart-toggle-copy";
    readonly label: "dsh-autostart-label";
    readonly hint: "dsh-autostart-hint";
    readonly checkbox: "dsh-autostart-checkbox";
    readonly input: "dsh-autostart-input";
    readonly footer: "dsh-autostart-footer";
    readonly actionHint: "dsh-autostart-action-hint";
    readonly failed: "dsh-autostart-failed";
    readonly restart: "dsh-autostart-button";
    readonly status: "dsh-autostart-status";
    readonly statusCode: "dsh-autostart-status-code";
};
/** Install card styles once without creating a second dynamically loaded asset. */
export declare function ensureStyles(): void;
