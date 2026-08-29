const LEGACY_MARKER = '@harness-desktop/model-settings-key-override-v1'
const DIRECT_MARKER = '@harness-desktop/model-settings-key-override-direct-v2'
const MARKER = '@harness-desktop/model-settings-key-override-gated-v3'

/** Pure UI state transition shared by the generated runtime and behavior tests. */
export function transitionModelCredentialOverride(state, event) {
  if (event.type === 'describe') {
    return { ...state, gate: event.writable === true || event.writable === false ? 'ready' : 'unavailable', writable: event.writable }
  }
  if (event.type === 'restore') return state.usingOverride ? { ...state, mode: 'restore', draft: '' } : state
  if (event.type === 'keep') return { ...state, mode: 'configured', draft: '' }
  if (event.type !== 'input' || state.gate !== 'ready' || state.mode === 'restore') return state
  const draft = event.value
  const mode = state.mode === 'configured' && state.writable === false && draft.length > 0
    ? 'override'
    : state.mode === 'override' && !state.usingOverride && draft.length === 0
      ? 'configured'
      : state.mode
  return { ...state, mode, draft }
}

/** Plan profile-reference and credential-store writes without mixing secret material into settings. */
export function planModelCredentialOverride({ mode, keyValue, configuredKeyRef, overrideKeyRef, layout, hasDraftRef, hasFallbackRef }) {
  if (mode === 'override') {
    if (keyValue.length === 0) return { error: 'override-key-required' }
    return { profile: { op: 'set', ref: overrideKeyRef }, credential: { op: 'set', ref: overrideKeyRef, value: keyValue } }
  }
  if (mode === 'restore') return { profile: { op: 'unset' }, credential: { op: 'unset', ref: overrideKeyRef } }
  const profile = layout === 'pi-ai' && !hasDraftRef && !hasFallbackRef && keyValue.length > 0
    ? { op: 'set', ref: configuredKeyRef }
    : { op: 'keep' }
  return { profile, credential: keyValue.length > 0 ? { op: 'set', ref: configuredKeyRef, value: keyValue } : { op: 'keep' } }
}

/** Identify only page-managed credential refs; environment refs are never returned for deletion. */
export function managedProviderCredentialRef(provider, apiKeyEnv, credential) {
  const stem = provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const refs = [`${stem}_API_KEY`, `HARNESS_DESKTOP_${stem}_API_KEY`]
  return refs.includes(apiKeyEnv) && credential?.configured === true && credential.writable === true ? apiKeyEnv : undefined
}

const RUNTIME_TRANSITION_SOURCE = transitionModelCredentialOverride.toString().replace('transitionModelCredentialOverride', 'modelSettingsCredentialTransition')
const RUNTIME_PLAN_SOURCE = planModelCredentialOverride.toString().replace('planModelCredentialOverride', 'modelSettingsCredentialPlan')
const RUNTIME_MANAGED_REF_SOURCE = managedProviderCredentialRef.toString().replace('managedProviderCredentialRef', 'modelSettingsManagedCredentialRef')

const REPLACEMENTS = [
  {
    label: 'override credential reference helper',
    original: `		function deriveKeyRef(provider) {
			return \`${'${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY'}\`;
		}`,
    patched: `		function deriveKeyRef(provider) {
			return \`${'${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY'}\`;
		}
		const modelSettingsKeyOverrideMarker = "${MARKER}";
		/** Use a separate writable reference without exposing or mutating a launch-environment secret. */
		function deriveOverrideKeyRef(provider) {
			return \`HARNESS_DESKTOP_${'${deriveKeyRef(provider)}'}\`;
		}
		${RUNTIME_TRANSITION_SOURCE.split("\n").join("\n\t\t")}
		${RUNTIME_PLAN_SOURCE.split("\n").join("\n\t\t")}
		${RUNTIME_MANAGED_REF_SOURCE.split("\n").join("\n\t\t")}`
  },
  {
    label: 'credential mode state',
    original: `			const [keyDraft, setKeyDraft] = (0, react.useState)("");
			const [keyState, setKeyState] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(false);`,
    patched: `			const [keyDraft, setKeyDraft] = (0, react.useState)("");
			const [keyState, setKeyState] = (0, react.useState)(void 0);
			const [credentialGate, setCredentialGate] = (0, react.useState)("loading");
			const [credentialMode, setCredentialMode] = (0, react.useState)("configured");
			const [busy, setBusy] = (0, react.useState)(false);`
  },
  {
    label: 'effective credential reference',
    original: `			const keyRef = refFor(schema, namespace, settingsPath, props.provider);
			const protocols = (0, react.useMemo)(() => layout === "pi-ai" ? protocolChoices(namespace, schema) : [], [`,
    patched: `			const configuredKeyRef = refFor(schema, namespace, settingsPath, props.provider);
			const overrideKeyRef = deriveOverrideKeyRef(props.provider);
			const usingOverride = configuredKeyRef === overrideKeyRef;
			const keyRef = credentialMode === "override" ? overrideKeyRef : configuredKeyRef;
			const protocols = (0, react.useMemo)(() => layout === "pi-ai" ? protocolChoices(namespace, schema) : [], [`
  },
  {
    label: 'credential describe gate',
    original: `			(0, react.useEffect)(() => {
				let stale = false;
				setKeyState(void 0);
				api.credentials.describe({ refs: [keyRef] }).then((response) => {
					if (stale || !response.result.ok) return;
					setKeyState(response.result.value.credentials[keyRef]);
				}, () => void 0);
				return () => {
					stale = true;
				};
			}, [api.credentials, keyRef]);`,
    patched: `			(0, react.useEffect)(() => {
				let stale = false;
				setKeyState(void 0);
				setCredentialGate("loading");
				api.credentials.describe({ refs: [keyRef] }).then((response) => {
					if (stale) return;
					const described = response.result.ok ? response.result.value.credentials[keyRef] : void 0;
					setKeyState(described);
					setCredentialGate(described?.writable === true || described?.writable === false ? "ready" : "unavailable");
				}, () => {
					if (!stale) setCredentialGate("unavailable");
				});
				return () => {
					stale = true;
				};
			}, [api.credentials, keyRef]);`
  },
  {
    label: 'override profile selection',
    original: `				const ns = namespace.ns;
				const next = layout === "pi-ai" && stringAt(draft, "apiKeyEnv") === void 0 && stringAt(fallback, "apiKeyEnv") === void 0 && keyValue.length > 0 ? schema.setPath(draft, ["apiKeyEnv"], keyRef) : draft;`,
    patched: `				const ns = namespace.ns;
				const credentialPlan = modelSettingsCredentialPlan({
					mode: credentialMode,
					keyValue,
					configuredKeyRef,
					overrideKeyRef,
					layout,
					hasDraftRef: stringAt(draft, "apiKeyEnv") !== void 0,
					hasFallbackRef: stringAt(fallback, "apiKeyEnv") !== void 0
				});
				if (credentialPlan.error !== void 0) return t("keyRequired");
				let next = credentialPlan.profile.op === "set" ? schema.setPath(draft, ["apiKeyEnv"], credentialPlan.profile.ref) : credentialPlan.profile.op === "unset" ? schema.deletePath(draft, ["apiKeyEnv"]) : draft;`
  },
  {
    label: 'credential-only reference write',
    original: `				const ops = props.credentialOnly === true ? [] : materializesNativeProfile ? [{
					op: "set",
					path: [...settingsPath],
					value: {}
				}] : pathOps(settingsPath, committedOriginal, next);`,
    patched: `				const plannedOps = materializesNativeProfile ? [{
					op: "set",
					path: [...settingsPath],
					value: {}
				}] : pathOps(settingsPath, committedOriginal, next);
				const ops = props.credentialOnly === true ? plannedOps.filter((op) => op.path[op.path.length - 1] === "apiKeyEnv") : plannedOps;`
  },
  {
    label: 'credential mutation revision tracking',
    original: `				if (ops.length > 0) {
					const response = await api.settings.mutate({
						ns,
						ops,
						expectedRevision
					});
					if (!response.result.ok) return response.result.error.code === "settings-conflict" ? t("conflict") : response.result.error.message;
					setCommittedOriginal(schema.getPath(response.result.value.user, settingsPath));
					setExpectedRevision(response.result.value.revision);
					setDraft(next);
				}`,
    patched: `				let appliedRevision = expectedRevision;
				if (ops.length > 0) {
					const response = await api.settings.mutate({
						ns,
						ops,
						expectedRevision
					});
					if (!response.result.ok) return response.result.error.code === "settings-conflict" ? t("conflict") : response.result.error.message;
					appliedRevision = response.result.value.revision;
					setCommittedOriginal(schema.getPath(response.result.value.user, settingsPath));
					setExpectedRevision(appliedRevision);
					setDraft(next);
				}`
  },
  {
    label: 'credential store plan',
    original: `				if (keyValue.length > 0) {
					const stored = await api.credentials.set({
						ref: keyRef,
						value: keyValue
					});
					if (!stored.result.ok) return stored.result.error.message;
				}
				setKeyDraft("");`,
    patched: `				if (credentialPlan.credential.op === "set") {
					const stored = await api.credentials.set({
						ref: credentialPlan.credential.ref,
						value: credentialPlan.credential.value
					});
					if (!stored.result.ok) return stored.result.error.message;
				} else if (credentialPlan.credential.op === "unset") {
					const removed = await api.credentials.unset({ ref: credentialPlan.credential.ref });
					if (!removed.result.ok) {
						const rebound = await api.settings.mutate({
							ns,
							ops: [{ op: "set", path: [...settingsPath, "apiKeyEnv"], value: overrideKeyRef }],
							expectedRevision: appliedRevision
						});
						if (!rebound.result.ok) return \`${'${removed.result.error.message} ${t("keyRestoreCompensationFailed")}'}\`;
						next = schema.setPath(next, ["apiKeyEnv"], overrideKeyRef);
						setCommittedOriginal(schema.getPath(rebound.result.value.user, settingsPath));
						setExpectedRevision(rebound.result.value.revision);
						setDraft(next);
						setCredentialMode("configured");
						return \`${'${removed.result.error.message} ${t("keyRestoreCompensated")}'}\`;
					}
				}
				setKeyDraft("");`
  },
  {
    label: 'credential mode controls',
    original: `			const keyLocked = keyState?.writable === false;
			/**
			* The catalog beneath the user layer: what the composition entry pinned, or`,
    patched: `			const keyLocked = credentialMode === "configured" && keyState?.writable === false;
			const keyGateClosed = credentialGate !== "ready";
			const keyOverrideRequired = credentialMode === "override" && keyValue.length === 0;
			const credentialIdStem = props.provider.replace(/[^a-zA-Z0-9_-]/g, "-");
			const credentialInputId = \`model-credential-input-${'${credentialIdStem}'}\`;
			const credentialHintId = \`model-credential-hint-${'${credentialIdStem}'}\`;
			const credentialAction = () => {
				const event = credentialMode === "restore" ? { type: "keep" } : credentialMode === "configured" && usingOverride ? { type: "restore" } : void 0;
				if (event === void 0) return null;
				const label = event.type === "restore" ? "keyRestoreEnvironment" : "keyKeepCustom";
				return (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: ModelsSection_module_css_default["secondaryButton"],
					disabled,
					style: { alignSelf: "flex-start", minHeight: 44 },
					onClick: () => {
						const transition = modelSettingsCredentialTransition({ gate: credentialGate, writable: keyState?.writable, mode: credentialMode, usingOverride, draft: keyDraft }, event);
						setKeyDraft(transition.draft);
						setFailure(void 0);
						setCredentialMode(transition.mode);
					},
					children: t(label)
				});
			};
			/**
			* The catalog beneath the user layer: what the composition entry pinned, or`
  },
  {
    label: 'credential placeholder',
    original: `				const keyPlaceholder = keyLocked ? t("keyEnvLocked") : keyState?.configured === true && props.credentialRequired !== true ? t("keyStored") : family === "pi-ai" ? t("keyPlaceholderNative") : t("keyPlaceholder");`,
    patched: `				const keyPlaceholder = credentialMode === "restore" ? t("keyRestorePending") : keyLocked ? t("keyOverridePlaceholder") : keyState?.configured === true && props.credentialRequired !== true && credentialMode !== "override" ? t("keyStored") : family === "pi-ai" ? t("keyPlaceholderNative") : t("keyPlaceholder");`
  },
  {
    label: 'credential label and input semantics',
    original: `						(0, react_jsx_runtime.jsx)("span", {
							className: ModelsSection_module_css_default["fieldLabel"],
							children: t("keyInput")
						}),
						(0, react_jsx_runtime.jsx)("input", {
							className: ModelsSection_module_css_default["input"],
							type: "password",
							autoComplete: "off",
							value: keyDraft,
							placeholder: keyPlaceholder,
							"aria-label": t("keyInput"),`,
    patched: `						(0, react_jsx_runtime.jsx)("label", {
							htmlFor: credentialInputId,
							className: ModelsSection_module_css_default["fieldLabel"],
							children: t("keyInput")
						}),
						(0, react_jsx_runtime.jsx)("input", {
							id: credentialInputId,
							className: ModelsSection_module_css_default["input"],
							type: "password",
							autoComplete: "new-password",
							style: { minHeight: 44 },
							value: keyDraft,
							placeholder: keyPlaceholder,
							"aria-label": t("keyInput"),`
  },
  {
    label: 'credential input lock',
    original: `							disabled: disabled || keyLocked,
							onChange: (event) => {
								setKeyDraft(event.target.value);
							}`,
    patched: `							"aria-describedby": credentialMode === "override" || credentialMode === "restore" || keyGateClosed || keyLocked || usingOverride ? credentialHintId : void 0,
							disabled: disabled || credentialMode === "restore" || keyGateClosed,
							onChange: (event) => {
								const transition = modelSettingsCredentialTransition({ gate: credentialGate, writable: keyState?.writable, mode: credentialMode, usingOverride, draft: keyDraft }, { type: "input", value: event.target.value });
								setCredentialMode(transition.mode);
								setKeyDraft(transition.draft);
							}`
  },
  {
    label: 'credential action rendering',
    original: `						}),
						shownKeyFailure === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {`,
    patched: `						}),
						credentialAction(),
						credentialMode === "override" || credentialMode === "restore" || keyGateClosed || keyLocked || usingOverride ? (0, react_jsx_runtime.jsx)("p", {
							id: credentialHintId,
							className: ModelsSection_module_css_default["advancedHint"],
							children: t(credentialMode === "override" ? "keyOverrideHint" : credentialMode === "restore" ? "keyRestoreHint" : keyGateClosed ? "keyUnavailable" : "keyEnvironmentHint")
						}) : null,
						shownKeyFailure === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {`
  },
  {
    label: 'override submit guard',
    original: `						submitDisabled: disabled || layout === "unknown" || props.credentialOnly !== true && modelFailure !== void 0 || shownKeyFailure !== void 0 || props.credentialRequired === true && keyValue.length === 0,`,
    patched: `						submitDisabled: disabled || keyGateClosed || layout === "unknown" || props.credentialOnly !== true && modelFailure !== void 0 || shownKeyFailure !== void 0 || keyOverrideRequired || props.credentialRequired === true && credentialMode !== "restore" && keyValue.length === 0,`
  },
  {
    label: 'provider deletion override cleanup',
    original: `			const managedRef = deriveKeyRef(row.entry.provider);
			const credentialRef = row.apiKeyEnv === managedRef && row.credential?.configured === true && row.credential.writable ? managedRef : void 0;`,
    patched: `			const credentialRef = modelSettingsManagedCredentialRef(row.entry.provider, row.apiKeyEnv, row.credential);`
  },
  {
    label: 'provider delete touch target',
    original: `											className: ModelsSection_module_css_default["dangerButton"],
											"aria-label": providerCopy(t("removeProvider"), target),
											disabled: !state.writable,`,
    patched: `											className: ModelsSection_module_css_default["dangerButton"],
											"aria-label": providerCopy(t("removeProvider"), target),
											style: { minHeight: 44, minWidth: 44 },
											disabled: !state.writable,`
  },
  {
    label: 'provider delete confirm touch target',
    original: `							variant: "outline",
							className: ModelsSection_module_css_default["deleteConfirm"],
							disabled: deleting,`,
    patched: `							variant: "outline",
							className: ModelsSection_module_css_default["deleteConfirm"],
							style: { minHeight: 44, minWidth: 44 },
							disabled: deleting,`
  },
  {
    label: 'English credential override copy',
    original: `			keyEnvLocked: "Provided by the launch environment (read-only)",
			customized: "Customized settings",`,
    patched: `			keyEnvLocked: "Provided by the launch environment (read-only)",
			keyOverridePlaceholder: "Paste or enter an API key to replace the launch environment",
			keyRestoreEnvironment: "Restore launch environment",
			keyKeepCustom: "Keep custom API key",
			keyRestorePending: "Save to restore launch-environment authentication",
			keyUnavailable: "Credential status is unavailable. Editing is blocked so an environment credential cannot be overwritten.",
			keyEnvironmentHint: "Authentication currently comes from the launch environment. Direct typing or paste creates a separate local override; the environment secret is never read or changed.",
			keyOverrideHint: "The new key is stored as a separate local override. The launch-environment key is never shown or changed.",
			keyRestoreHint: "Saving removes the local override from this provider and restores launch-environment authentication.",
			keyRestoreCompensated: "The local override could not be deleted, so this provider was rebound to it. Retry Restore launch environment.",
			keyRestoreCompensationFailed: "The local override could not be deleted or rebound automatically. Keep this editor open and retry Restore launch environment.",
			customized: "Customized settings",`
  },
  {
    label: 'Chinese credential override copy',
    original: `			keyEnvLocked: "由启动环境提供（只读）",
			customized: "自定义设置",`,
    patched: `			keyEnvLocked: "由启动环境提供（只读）",
			keyOverridePlaceholder: "直接粘贴或输入 API 密钥以替换启动环境",
			keyRestoreEnvironment: "恢复启动环境",
			keyKeepCustom: "继续使用自定义密钥",
			keyRestorePending: "保存后恢复启动环境认证",
			keyUnavailable: "暂时无法确认凭据状态。为避免覆盖环境凭据，当前禁止编辑。",
			keyEnvironmentHint: "当前认证来自启动环境。直接输入或粘贴会建立独立的本机覆盖；环境密钥不会被读取或修改。",
			keyOverrideHint: "新密钥将作为独立的本机覆盖值保存；启动环境密钥不会被显示或修改。",
			keyRestoreHint: "保存后将移除此提供方的本机覆盖值，并恢复使用启动环境认证。",
			keyRestoreCompensated: "本机覆盖删除失败，已将提供方重新绑定到该覆盖。请重试“恢复启动环境”。",
			keyRestoreCompensationFailed: "本机覆盖删除及自动重新绑定均失败。请保持此编辑器打开并重试“恢复启动环境”。",
			customized: "自定义设置",`
  }
]

/** Exact upstream anchor fixture used to prove the fresh-install patch path independently of installed v2. */
export function createModelSettingsKeyOverrideUpstreamFixture() {
  return REPLACEMENTS.map((replacement) => replacement.original).join('\n/* upstream anchor */\n')
}

const DIRECT_MIGRATIONS = [
  [LEGACY_MARKER, DIRECT_MARKER],
  [`			const keyLocked = credentialMode === "configured" && keyState?.writable === false;
			const keyOverrideRequired = credentialMode === "override" && keyValue.length === 0;
			const credentialAction = () => {
				let label;
				let nextMode;
				if (credentialMode === "override") {
					label = "keyUseEnvironment";
					nextMode = "configured";
				} else if (credentialMode === "restore") {
					label = "keyKeepCustom";
					nextMode = "configured";
				} else if (keyLocked) {
					label = "keyUseCustom";
					nextMode = "override";
				} else if (usingOverride) {
					label = "keyRestoreEnvironment";
					nextMode = "restore";
				} else return null;`, `			const keyLocked = credentialMode === "configured" && keyState?.writable === false;
			const keyOverrideRequired = credentialMode === "override" && keyValue.length === 0;
			const credentialAction = () => {
				let label;
				let nextMode;
				if (credentialMode === "restore") {
					label = "keyKeepCustom";
					nextMode = "configured";
				} else if (credentialMode === "configured" && usingOverride) {
					label = "keyRestoreEnvironment";
					nextMode = "restore";
				} else return null;`],
  [`				const keyPlaceholder = credentialMode === "restore" ? t("keyRestorePending") : keyLocked ? t("keyEnvLocked") : keyState?.configured === true && props.credentialRequired !== true && credentialMode !== "override" ? t("keyStored") : family === "pi-ai" ? t("keyPlaceholderNative") : t("keyPlaceholder");`, `				const keyPlaceholder = credentialMode === "restore" ? t("keyRestorePending") : keyLocked ? t("keyOverridePlaceholder") : keyState?.configured === true && props.credentialRequired !== true && credentialMode !== "override" ? t("keyStored") : family === "pi-ai" ? t("keyPlaceholderNative") : t("keyPlaceholder");`],
  [`							disabled: disabled || keyLocked || credentialMode === "restore",
							onChange: (event) => {
								setKeyDraft(event.target.value);
							}`, `							disabled: disabled || credentialMode === "restore",
							onChange: (event) => {
								const value = event.target.value;
								if (keyLocked && value.length > 0) setCredentialMode("override");
								else if (credentialMode === "override" && !usingOverride && value.length === 0) setCredentialMode("configured");
								setKeyDraft(value);
							}`],
  [`			keyEnvLocked: "Provided by the launch environment (read-only)",
			keyUseCustom: "Use a custom API key",
			keyUseEnvironment: "Keep using the launch environment",
			keyRestoreEnvironment: "Restore launch environment",`, `			keyEnvLocked: "Provided by the launch environment (read-only)",
			keyOverridePlaceholder: "Paste or enter an API key to replace the launch environment",
			keyRestoreEnvironment: "Restore launch environment",`],
  [`			keyEnvLocked: "由启动环境提供（只读）",
			keyUseCustom: "改用自定义密钥",
			keyUseEnvironment: "继续使用启动环境",
			keyRestoreEnvironment: "恢复启动环境",`, `			keyEnvLocked: "由启动环境提供（只读）",
			keyOverridePlaceholder: "直接粘贴或输入 API 密钥以替换启动环境",
			keyRestoreEnvironment: "恢复启动环境",`]
]

const v3Patch = (label) => REPLACEMENTS.find((replacement) => replacement.label === label).patched
const V2_MIGRATIONS = [
  [DIRECT_MARKER, MARKER],
  [`		function deriveOverrideKeyRef(provider) {
			return \`HARNESS_DESKTOP_${'${deriveKeyRef(provider)}'}\`;
		}`, `		function deriveOverrideKeyRef(provider) {
			return \`HARNESS_DESKTOP_${'${deriveKeyRef(provider)}'}\`;
		}
		${RUNTIME_TRANSITION_SOURCE.split("\n").join("\n\t\t")}
		${RUNTIME_PLAN_SOURCE.split("\n").join("\n\t\t")}
		${RUNTIME_MANAGED_REF_SOURCE.split("\n").join("\n\t\t")}`],
  [`			const [keyDraft, setKeyDraft] = (0, react.useState)("");
			const [keyState, setKeyState] = (0, react.useState)(void 0);
			const [credentialMode, setCredentialMode] = (0, react.useState)("configured");
			const [busy, setBusy] = (0, react.useState)(false);`, v3Patch('credential mode state')],
  [REPLACEMENTS.find((replacement) => replacement.label === 'credential describe gate').original, v3Patch('credential describe gate')],
  [`				const ns = namespace.ns;
				let next = draft;
				if (credentialMode === "override" && keyValue.length > 0) next = schema.setPath(next, ["apiKeyEnv"], overrideKeyRef);
				else if (credentialMode === "restore") next = schema.deletePath(next, ["apiKeyEnv"]);
				else if (layout === "pi-ai" && stringAt(next, "apiKeyEnv") === void 0 && stringAt(fallback, "apiKeyEnv") === void 0 && keyValue.length > 0) next = schema.setPath(next, ["apiKeyEnv"], keyRef);`, v3Patch('override profile selection')],
  [REPLACEMENTS.find((replacement) => replacement.label === 'credential-only reference write').original, v3Patch('credential-only reference write')],
  [REPLACEMENTS.find((replacement) => replacement.label === 'credential mutation revision tracking').original, v3Patch('credential mutation revision tracking')],
  [REPLACEMENTS.find((replacement) => replacement.label === 'credential store plan').original, v3Patch('credential store plan')],
  [`			const keyLocked = credentialMode === "configured" && keyState?.writable === false;
			const keyOverrideRequired = credentialMode === "override" && keyValue.length === 0;
			const credentialAction = () => {
				let label;
				let nextMode;
				if (credentialMode === "restore") {
					label = "keyKeepCustom";
					nextMode = "configured";
				} else if (credentialMode === "configured" && usingOverride) {
					label = "keyRestoreEnvironment";
					nextMode = "restore";
				} else return null;
				return (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: ModelsSection_module_css_default["secondaryButton"],
					disabled,
					style: { alignSelf: "flex-start", minHeight: 36 },
					onClick: () => {
						setKeyDraft("");
						setFailure(void 0);
						setCredentialMode(nextMode);
					},
					children: t(label)
				});
			};
			/**
			* The catalog beneath the user layer: what the composition entry pinned, or`, v3Patch('credential mode controls')],
  [REPLACEMENTS.find((replacement) => replacement.label === 'credential label and input semantics').original, v3Patch('credential label and input semantics')],
  [`							disabled: disabled || credentialMode === "restore",
							onChange: (event) => {
								const value = event.target.value;
								if (keyLocked && value.length > 0) setCredentialMode("override");
								else if (credentialMode === "override" && !usingOverride && value.length === 0) setCredentialMode("configured");
								setKeyDraft(value);
							}`, v3Patch('credential input lock')],
  [`						}),
						credentialAction(),
						credentialMode === "override" ? (0, react_jsx_runtime.jsx)("p", {
							className: ModelsSection_module_css_default["advancedHint"],
							children: t("keyOverrideHint")
						}) : credentialMode === "restore" ? (0, react_jsx_runtime.jsx)("p", {
							className: ModelsSection_module_css_default["advancedHint"],
							children: t("keyRestoreHint")
						}) : null,
						shownKeyFailure === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {`, v3Patch('credential action rendering')],
  [`						submitDisabled: disabled || layout === "unknown" || props.credentialOnly !== true && modelFailure !== void 0 || shownKeyFailure !== void 0 || keyOverrideRequired || props.credentialRequired === true && credentialMode !== "restore" && keyValue.length === 0,`, v3Patch('override submit guard')],
  [REPLACEMENTS.find((replacement) => replacement.label === 'provider deletion override cleanup').original, v3Patch('provider deletion override cleanup')],
  [REPLACEMENTS.find((replacement) => replacement.label === 'provider delete touch target').original, v3Patch('provider delete touch target')],
  [REPLACEMENTS.find((replacement) => replacement.label === 'provider delete confirm touch target').original, v3Patch('provider delete confirm touch target')],
  [`			keyRestorePending: "Save to restore launch-environment authentication",
			keyOverrideHint: "The new key is stored as a separate local override. The launch-environment key is never shown or changed.",
			keyRestoreHint: "Saving removes the local override from this provider and restores launch-environment authentication.",`, `			keyRestorePending: "Save to restore launch-environment authentication",
			keyUnavailable: "Credential status is unavailable. Editing is blocked so an environment credential cannot be overwritten.",
			keyEnvironmentHint: "Authentication currently comes from the launch environment. Direct typing or paste creates a separate local override; the environment secret is never read or changed.",
			keyOverrideHint: "The new key is stored as a separate local override. The launch-environment key is never shown or changed.",
			keyRestoreHint: "Saving removes the local override from this provider and restores launch-environment authentication.",
			keyRestoreCompensated: "The local override could not be deleted, so this provider was rebound to it. Retry Restore launch environment.",
			keyRestoreCompensationFailed: "The local override could not be deleted or rebound automatically. Keep this editor open and retry Restore launch environment.",`],
  [`			keyRestorePending: "保存后恢复启动环境认证",
			keyOverrideHint: "新密钥将作为独立的本机覆盖值保存；启动环境密钥不会被显示或修改。",
			keyRestoreHint: "保存后将移除此提供方的本机覆盖值，并恢复使用启动环境认证。",`, `			keyRestorePending: "保存后恢复启动环境认证",
			keyUnavailable: "暂时无法确认凭据状态。为避免覆盖环境凭据，当前禁止编辑。",
			keyEnvironmentHint: "当前认证来自启动环境。直接输入或粘贴会建立独立的本机覆盖；环境密钥不会被读取或修改。",
			keyOverrideHint: "新密钥将作为独立的本机覆盖值保存；启动环境密钥不会被显示或修改。",
			keyRestoreHint: "保存后将移除此提供方的本机覆盖值，并恢复使用启动环境认证。",
			keyRestoreCompensated: "本机覆盖删除失败，已将提供方重新绑定到该覆盖。请重试“恢复启动环境”。",
			keyRestoreCompensationFailed: "本机覆盖删除及自动重新绑定均失败。请保持此编辑器打开并重试“恢复启动环境”。",`]
]

const FINAL_MARKERS = [
  MARKER,
  'function deriveOverrideKeyRef(provider)',
  'function modelSettingsCredentialTransition(',
  'function modelSettingsCredentialPlan(',
  'function modelSettingsManagedCredentialRef(',
  'const [credentialGate, setCredentialGate]',
  'const credentialPlan = modelSettingsCredentialPlan({',
  'api.credentials.unset({ ref: credentialPlan.credential.ref })',
  'expectedRevision: appliedRevision',
  'keyRestoreCompensationFailed',
  'plannedOps.filter((op) => op.path[op.path.length - 1] === "apiKeyEnv")',
  'modelSettingsManagedCredentialRef(row.entry.provider, row.apiKeyEnv, row.credential)',
  'htmlFor: credentialInputId',
  'autoComplete: "new-password"',
  'style: { minHeight: 44, minWidth: 44 }',
  'disabled: disabled || credentialMode === "restore" || keyGateClosed',
  '"aria-describedby": credentialMode === "override"',
  'keyEnvironmentHint: "当前认证来自启动环境。直接输入或粘贴会建立独立的本机覆盖；环境密钥不会被读取或修改。"',
  'keyUnavailable: "暂时无法确认凭据状态。为避免覆盖环境凭据，当前禁止编辑。"',
  'keyRestoreEnvironment: "Restore launch environment"'
]

export function patchModelSettingsKeyOverrideSource(source) {
  let output = source
  let migrated = false
  if (output.includes(LEGACY_MARKER)) {
    for (const [legacy, direct] of DIRECT_MIGRATIONS) {
      if (!output.includes(legacy)) throw new Error('Pinned DSH model-settings key override v1 patch is incomplete; refusing an unsafe migration.')
      output = output.replace(legacy, direct)
    }
    migrated = true
  }
  if (output.includes(DIRECT_MARKER)) {
    for (const [direct, gated] of V2_MIGRATIONS) {
      if (!output.includes(direct)) throw new Error('Pinned DSH model-settings key override v2 patch is incomplete; refusing an unsafe migration.')
      output = output.replace(direct, gated)
    }
    migrated = true
  }

  const present = FINAL_MARKERS.filter(marker => output.includes(marker))
  if (present.length === FINAL_MARKERS.length) return { source: output, changed: migrated }
  if (present.length > 0) throw new Error('Pinned DSH model-settings key override patch is incomplete; refusing an unsafe repair.')

  for (const replacement of REPLACEMENTS) {
    if (!output.includes(replacement.original)) {
      throw new Error(`Pinned DSH ${replacement.label} changed; refusing an unsafe model-settings key override patch.`)
    }
    output = output.replace(replacement.original, replacement.patched)
  }
  return { source: output, changed: true }
}
