window.__ModuleLoader__.load({
	id: "dsh-autostart",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/restart-monitor.ts
		const RESTART_URL = "/plugins/dsh-autostart/restart";
		var RestartProbeUnavailableError = class extends Error {
			constructor(message, options) {
				super(message, options);
				this.name = "RestartProbeUnavailableError";
			}
		};
		function abortError(signal) {
			return signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
		}
		function defaultSleep(delayMs, signal) {
			if (signal?.aborted) return Promise.reject(abortError(signal));
			return new Promise((resolve, reject) => {
				const onAbort = () => {
					window.clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
					reject(abortError(signal));
				};
				const timer = window.setTimeout(() => {
					signal?.removeEventListener("abort", onAbort);
					resolve();
				}, delayMs);
				signal?.addEventListener("abort", onAbort, { once: true });
			});
		}
		function parseRestartIdentity(value) {
			const candidate = value;
			if (candidate === null || !Number.isInteger(candidate.pid) || Number(candidate.pid) <= 0 || typeof candidate.startedAt !== "string" || candidate.startedAt === "") throw new Error("invalid restart identity");
			return {
				pid: Number(candidate.pid),
				startedAt: candidate.startedAt
			};
		}
		async function fetchRestartIdentity(fetchImpl, signal) {
			let response;
			try {
				response = await fetchImpl(RESTART_URL, {
					method: "GET",
					cache: "no-store",
					signal
				});
			} catch (error) {
				if (signal?.aborted) throw error;
				throw new RestartProbeUnavailableError("identity probe unavailable", { cause: error });
			}
			if (!response.ok) throw new RestartProbeUnavailableError(`identity probe failed: HTTP ${response.status}`);
			return parseRestartIdentity(await response.json());
		}
		function identityChanged(before, after) {
			return before.pid !== after.pid || before.startedAt !== after.startedAt;
		}
		/** Restart DSH and wait until the process identity changes. */
		async function restartAndWait(options = {}) {
			const fetchImpl = options.fetchImpl ?? fetch;
			const isVisible = options.isVisible ?? (() => document.visibilityState === "visible");
			const maxVisibleStableProbes = options.maxVisibleStableProbes ?? 90;
			const pollIntervalMs = options.pollIntervalMs ?? 1e3;
			const sleep = options.sleep ?? defaultSleep;
			const { signal } = options;
			const baseline = await fetchRestartIdentity(fetchImpl, signal);
			const response = await fetchImpl(RESTART_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
				signal
			});
			if (!response.ok) throw new Error(`restart request failed: HTTP ${response.status}`);
			let visibleStableProbes = 0;
			while (visibleStableProbes < maxVisibleStableProbes) {
				await sleep(pollIntervalMs, signal);
				let current;
				try {
					current = await fetchRestartIdentity(fetchImpl, signal);
				} catch (error) {
					if (!(error instanceof RestartProbeUnavailableError)) throw error;
					continue;
				}
				if (identityChanged(baseline, current)) return "restarted";
				if (isVisible()) visibleStableProbes += 1;
			}
			return "stale";
		}
		//#endregion
		//#region src/client/autostart.ts
		const AUTOSTART_URL = "/plugins/dsh-autostart/autostart";
		/**
		* Read the current autostart state from the host. Returns null when the host is
		* unreachable (e.g. accessed through a reverse proxy / non-loopback origin).
		*/
		async function fetchAutostartStatus(fetchImpl = fetch, signal) {
			try {
				const response = await fetchImpl(AUTOSTART_URL, {
					method: "GET",
					cache: "no-store",
					signal
				});
				if (!response.ok) return null;
				return await response.json();
			} catch {
				return null;
			}
		}
		//#endregion
		//#region src/client/styles.ts
		/** Stable local class names; the plugin ships as one self-contained client.js. */
		const styles = {
			card: "dsh-autostart-card",
			cardOpen: "dsh-autostart-card-open",
			header: "dsh-autostart-header",
			headText: "dsh-autostart-head-text",
			name: "dsh-autostart-name",
			description: "dsh-autostart-description",
			chevron: "dsh-autostart-chevron",
			chevronOpen: "dsh-autostart-chevron-open",
			body: "dsh-autostart-body",
			readOnly: "dsh-autostart-read-only",
			field: "dsh-autostart-field",
			toggleField: "dsh-autostart-toggle-field",
			toggleCopy: "dsh-autostart-toggle-copy",
			label: "dsh-autostart-label",
			hint: "dsh-autostart-hint",
			checkbox: "dsh-autostart-checkbox",
			input: "dsh-autostart-input",
			footer: "dsh-autostart-footer",
			actionHint: "dsh-autostart-action-hint",
			failed: "dsh-autostart-failed",
			restart: "dsh-autostart-button",
			status: "dsh-autostart-status",
			statusCode: "dsh-autostart-status-code"
		};
		const STYLE_ID = "dsh-autostart-settings-card-styles";
		/** Install card styles once without creating a second dynamically loaded asset. */
		function ensureStyles() {
			if (document.getElementById(STYLE_ID) !== null) return;
			const style = document.createElement("style");
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
		//#endregion
		//#region src/client/SettingsCard.tsx
		const RESTART_SUCCEEDED_KEY = "dsh-autostart:completed";
		function consumeRestartSucceeded() {
			try {
				const succeeded = sessionStorage.getItem(RESTART_SUCCEEDED_KEY) === "1";
				if (succeeded) sessionStorage.removeItem(RESTART_SUCCEEDED_KEY);
				return succeeded;
			} catch {
				return false;
			}
		}
		function rememberRestartSucceeded() {
			try {
				sessionStorage.setItem(RESTART_SUCCEEDED_KEY, "1");
			} catch {}
		}
		/** The dsh-autostart configuration card, styled with the host plugin-card tokens. */
		function SettingsCard(props) {
			const { t, set, clear } = props;
			const state = props.useDshRestart((snapshot) => snapshot);
			const [open, setOpen] = (0, react.useState)(false);
			const [restarting, setRestarting] = (0, react.useState)(false);
			const [restartFailed, setRestartFailed] = (0, react.useState)(false);
			const [restartStale, setRestartStale] = (0, react.useState)(false);
			const [restartSucceeded, setRestartSucceeded] = (0, react.useState)(consumeRestartSucceeded);
			const restartController = (0, react.useRef)(null);
			const [autostartStatus, setAutostartStatus] = (0, react.useState)(null);
			const [autostartBusy, setAutostartBusy] = (0, react.useState)(false);
			(0, react.useEffect)(() => () => {
				restartController.current?.abort();
			}, []);
			(0, react.useEffect)(() => {
				if (!restartSucceeded) return;
				const timer = window.setTimeout(() => {
					setRestartSucceeded(false);
				}, 5e3);
				return () => {
					window.clearTimeout(timer);
				};
			}, [restartSucceeded]);
			(0, react.useEffect)(() => {
				if (!open || !state.available) return;
				let cancelled = false;
				const timer = window.setTimeout(() => {
					fetchAutostartStatus().then((s) => {
						if (!cancelled) setAutostartStatus(s);
					});
				}, 300);
				return () => {
					cancelled = true;
					window.clearTimeout(timer);
				};
			}, [open, state.available]);
			const refreshAutostart = (delay = 0) => {
				window.setTimeout(() => {
					fetchAutostartStatus().then((s) => setAutostartStatus(s));
				}, delay);
			};
			if (!state.available) return null;
			const disabled = !state.writable;
			const toggle = (field, value) => {
				set(field, value);
				if (field === "autostartEnabled") {
					setAutostartBusy(true);
					window.setTimeout(() => setAutostartBusy(false), 1200);
					refreshAutostart(900);
				}
			};
			const text = (field, value) => {
				if (value.trim() === "") clear(field);
				else set(field, value.trim());
			};
			const number = (field, value) => {
				if (value.trim() === "") {
					clear(field);
					return;
				}
				const parsed = Number(value);
				if (Number.isFinite(parsed)) set(field, parsed);
			};
			const enableAutostart = () => {
				setAutostartBusy(true);
				set("autostartEnabled", true);
				window.setTimeout(() => setAutostartBusy(false), 1200);
				refreshAutostart(900);
			};
			const cancelAutostart = () => {
				setAutostartBusy(true);
				set("autostartEnabled", false);
				window.setTimeout(() => setAutostartBusy(false), 1200);
				refreshAutostart(900);
			};
			const restartNow = async () => {
				if (restarting) return;
				setRestarting(true);
				setRestartFailed(false);
				setRestartStale(false);
				setRestartSucceeded(false);
				const controller = new AbortController();
				restartController.current = controller;
				try {
					if (await restartAndWait({
						signal: controller.signal,
						isVisible: () => document.visibilityState === "visible"
					}) === "stale") {
						setRestartStale(true);
						setRestarting(false);
						return;
					}
					rememberRestartSucceeded();
					window.location.reload();
				} catch {
					if (controller.signal.aborted) return;
					setRestartFailed(true);
					setRestarting(false);
				} finally {
					if (restartController.current === controller) restartController.current = null;
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: `${styles.card} ${open ? styles.cardOpen : ""}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: styles.header,
					"aria-expanded": open,
					"aria-label": `${t(open ? "collapse" : "expand")}: ${t("title")}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: styles.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: styles.name,
							children: t("title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: styles.description,
							children: t("description")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						className: `${styles.chevron} ${open ? styles.chevronOpen : ""}`,
						viewBox: "0 0 14 14",
						width: "14",
						height: "14",
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M3.5 5.5 7 9l3.5-3.5",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.5",
							strokeLinecap: "round",
							strokeLinejoin: "round"
						})
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.body,
					children: [
						!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: styles.readOnly,
							role: "status",
							children: t("readOnly")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: styles.toggleField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: styles.checkbox,
								type: "checkbox",
								checked: state.autostartEnabled,
								disabled: disabled || autostartBusy,
								onChange: (event) => {
									toggle("autostartEnabled", event.currentTarget.checked);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: styles.toggleCopy,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.label,
									children: t("autostartEnabled")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.hint,
									children: t("autostartEnabledHint")
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: styles.field,
							htmlFor: "dsh-autostart-profile",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.label,
									children: t("autostartProfile")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: "dsh-autostart-profile",
									className: styles.input,
									type: "text",
									value: state.autostartProfile,
									disabled,
									placeholder: "web",
									onChange: (event) => {
										text("autostartProfile", event.currentTarget.value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.hint,
									children: t("autostartProfileHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: styles.status,
							role: "status",
							"aria-live": "polite",
							children: autostartStatus === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: styles.hint,
								children: t("autostartStatusError")
							}) : autostartStatus.installed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: styles.label,
								children: [
									t("autostartStatusInstalled"),
									"（",
									autostartStatus.method ?? "?",
									autostartStatus.platform ? ` · ${autostartStatus.platform}` : "",
									"）"
								]
							}), autostartStatus.command ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: styles.statusCode,
								children: autostartStatus.command
							}) : null] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: styles.hint,
								children: t("autostartStatusNotInstalled")
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.footer,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: styles.actionHint }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: styles.restart,
									disabled: disabled || autostartBusy || state.autostartEnabled,
									onClick: () => {
										enableAutostart();
									},
									children: t("autostartEnable")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${styles.restart} secondary`,
									disabled: disabled || autostartBusy || !state.autostartEnabled,
									onClick: () => {
										cancelAutostart();
									},
									children: t("autostartCancel")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: styles.toggleField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: styles.checkbox,
								type: "checkbox",
								checked: state.legacyRestart,
								disabled,
								onChange: (event) => {
									toggle("legacyRestart", event.currentTarget.checked);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: styles.toggleCopy,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.label,
									children: t("legacyRestart")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.hint,
									children: t("legacyRestartHint")
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: styles.field,
							htmlFor: "dsh-autostart-continue-prompt",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.label,
									children: t("continuePrompt")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: "dsh-autostart-continue-prompt",
									className: styles.input,
									type: "text",
									value: state.continuePrompt,
									disabled,
									onChange: (event) => {
										text("continuePrompt", event.currentTarget.value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.hint,
									children: t("continuePromptHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: styles.toggleField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: styles.checkbox,
								type: "checkbox",
								checked: state.watchdogEnabled,
								disabled,
								onChange: (event) => {
									toggle("watchdogEnabled", event.currentTarget.checked);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: styles.toggleCopy,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.label,
									children: t("watchdogEnabled")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.hint,
									children: t("watchdogEnabledHint")
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: styles.field,
							htmlFor: "dsh-autostart-watchdog-cooldown",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.label,
									children: t("watchdogCooldownMs")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: "dsh-autostart-watchdog-cooldown",
									className: styles.input,
									type: "number",
									inputMode: "numeric",
									value: state.watchdogCooldownMs || "",
									disabled,
									onChange: (event) => {
										number("watchdogCooldownMs", event.currentTarget.value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.hint,
									children: t("watchdogCooldownMsHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: styles.field,
							htmlFor: "dsh-autostart-watchdog-poll",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.label,
									children: t("watchdogPollMs")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: "dsh-autostart-watchdog-poll",
									className: styles.input,
									type: "number",
									inputMode: "numeric",
									value: state.watchdogPollMs || "",
									disabled,
									onChange: (event) => {
										number("watchdogPollMs", event.currentTarget.value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: styles.hint,
									children: t("watchdogPollMsHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.footer,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: restartFailed || restartStale ? styles.failed : styles.actionHint,
								role: "status",
								"aria-live": "polite",
								children: restartStale ? t("restartStale") : restartFailed ? t("restartFailed") : restartSucceeded ? t("restartSucceeded") : t("restartHint")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: styles.restart,
								disabled: restarting,
								onClick: () => {
									restartNow();
								},
								children: t(restarting ? "restarting" : "restartNow")
							})]
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			title: "DSH 自启动 / 重启",
			description: "开机自启动（跨平台）、重启方式、自动继续提示词与看门狗设置（写入 settings.yaml，host 读取）",
			legacyRestart: "旧重启方式",
			legacyRestartHint: "true = 用 PowerShell/WMI/taskkill 旧方式重启（适配）；false = Node 原生重启",
			continuePrompt: "重启后注入的提示词",
			continuePromptHint: "重启后自动继续时注入给 agent 的文本（空则用默认）",
			watchdogEnabled: "看门狗",
			watchdogEnabledHint: "true = 崩溃/关闭时自动拉起 DSH（默认关闭，需谨慎）",
			watchdogCooldownMs: "看门狗冷却（毫秒）",
			watchdogCooldownMsHint: "两次拉起之间的最小间隔",
			watchdogPollMs: "看门狗轮询（毫秒）",
			watchdogPollMsHint: "探测端口存活的间隔",
			autostartEnabled: "开机自启动",
			autostartEnabledHint: "「选择」勾选后，在操作系统登录/开机时自动启动 DSH；取消勾选即停用自启动",
			autostartProfile: "自启动 Profile",
			autostartProfileHint: "开机时启动的 profile（如 web）；留空则沿用当前进程的 profile",
			autostartStatusInstalled: "已启用自启动",
			autostartStatusNotInstalled: "未启用自启动（勾选上方开关即可在登录时启动 DSH）",
			autostartStatusError: "自启动状态未知（读取失败）",
			autostartEnable: "启用自启动",
			autostartCancel: "取消自启动",
			expand: "展开",
			collapse: "收起",
			readOnly: "当前配置为只读",
			restartNow: "立即重启",
			restarting: "正在重启…",
			restartHint: "配置修改会自动保存；立即重启会短暂断开当前页面。",
			restartFailed: "未能安排重启，请检查服务日志后重试。",
			restartStale: "已发送重启请求，但进程身份始终未变化。请检查服务日志。",
			restartSucceeded: "DSH 已重启并恢复连接。"
		};
		const en = {
			title: "DSH Autostart / Restart",
			description: "Boot autostart (cross-platform), restart method, auto-continue prompt, and watchdog settings (stored in settings.yaml)",
			legacyRestart: "Legacy restart",
			legacyRestartHint: "true = old PowerShell/WMI/taskkill restart; false = Node-native restart",
			continuePrompt: "Continue prompt",
			continuePromptHint: "Text injected to the agent after restart (empty = default)",
			watchdogEnabled: "Watchdog",
			watchdogEnabledHint: "true = auto-relaunch DSH on crash/close (off by default)",
			watchdogCooldownMs: "Watchdog cooldown (ms)",
			watchdogCooldownMsHint: "Minimum interval between relaunches",
			watchdogPollMs: "Watchdog poll (ms)",
			watchdogPollMsHint: "Interval for probing port liveness",
			autostartEnabled: "Boot autostart",
			autostartEnabledHint: "Select to launch DSH at OS login/boot; clear to cancel autostart",
			autostartProfile: "Autostart profile",
			autostartProfileHint: "Profile to launch on boot (e.g. web); empty = current process profile",
			autostartStatusInstalled: "Autostart enabled",
			autostartStatusNotInstalled: "Autostart disabled (check the switch above to launch DSH at login)",
			autostartStatusError: "Autostart status unknown (failed to read)",
			autostartEnable: "Enable autostart",
			autostartCancel: "Cancel autostart",
			expand: "Expand",
			collapse: "Collapse",
			readOnly: "This configuration is read-only",
			restartNow: "Restart now",
			restarting: "Restarting…",
			restartHint: "Configuration changes save automatically; restarting briefly disconnects this page.",
			restartFailed: "Could not schedule the restart. Check the service logs and try again.",
			restartStale: "The restart was requested, but the process identity never changed. Check the service logs.",
			restartSucceeded: "DSH restarted and reconnected."
		};
		//#endregion
		//#region src/client/index.ts
		const name = "dsh-autostart-client";
		const inject = [
			"slots",
			"locale",
			"settingsScope"
		];
		const NS = "autostart.card";
		function apply(ctx) {
			ensureStyles();
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-autostart: dictionaries");
			const scope = ctx.settingsScope.bind({ namespace: "dsh-autostart" });
			const project = () => {
				const snap = scope.getSnapshot();
				const value = snap.value ?? {};
				return {
					available: snap.status === "ready",
					writable: snap.writable,
					legacyRestart: value.legacyRestart === true,
					continuePrompt: typeof value.continuePrompt === "string" ? value.continuePrompt : "",
					watchdogEnabled: value.watchdogEnabled === true,
					watchdogCooldownMs: typeof value.watchdogCooldownMs === "number" ? value.watchdogCooldownMs : 0,
					watchdogPollMs: typeof value.watchdogPollMs === "number" ? value.watchdogPollMs : 0,
					autostartEnabled: value.autostartEnabled === true,
					autostartProfile: typeof value.autostartProfile === "string" ? value.autostartProfile : ""
				};
			};
			const store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(project());
			scope.subscribe(() => {
				store.set(project());
			});
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "dsh-autostart",
				locale: NS,
				inject: () => ({
					hooks: { dshRestart: store },
					set: (field, value) => {
						scope.set(field, value);
					},
					clear: (field) => {
						scope.unset(field);
					}
				})
			}, SettingsCard));
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map