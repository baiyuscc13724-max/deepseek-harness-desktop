window.__ModuleLoader__.load({ id: "@zseven-w/dsh-android", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
let react_jsx_runtime = require("react/jsx-runtime");
let react_dom = require("react-dom");
let react_dom_client = require("react-dom/client");
//#region src/client/card-styles.ts
const BORDER = "var(--ui-border, rgba(128,128,128,0.35))";
const MUTED = "var(--ui-text-muted, #888)";
const ACCENT = "var(--ui-accent, #0ea5e9)";
const CARD_STYLES = {
	card: {
		border: `1px solid ${BORDER}`,
		borderRadius: 8,
		overflow: "hidden",
		background: "var(--ui-card-bg, transparent)",
		fontFamily: "inherit",
		color: "var(--ui-text, inherit)"
	},
	head: {
		display: "flex",
		alignItems: "center",
		gap: 8,
		padding: "6px 10px",
		fontSize: 12,
		fontWeight: 600,
		borderBottom: "1px solid var(--ui-border, rgba(128,128,128,0.2))"
	},
	title: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	/** Small secondary action sub-label right after the title (启动/截图/交互/
	* 构建运行 · Boot/Screenshot/Interact/Build & Run) — distinguishes which
	* action a card belongs to under the unified "Android 设备" title. */
	action: {
		flex: "none",
		fontSize: 11,
		fontWeight: 400,
		color: MUTED,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	headDevice: {
		fontSize: 12,
		fontWeight: 400,
		color: MUTED,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	/** Non-interactive "opens the sidebar" cue — the row click itself opens
	* the panel, so this must NOT swallow the click (no button/link roles). */
	openInPanel: {
		marginLeft: "auto",
		flex: "none",
		display: "inline-flex",
		alignItems: "center",
		gap: 4,
		fontSize: 11,
		color: ACCENT,
		whiteSpace: "nowrap"
	},
	badge: {
		fontSize: 11,
		padding: "1px 8px",
		borderRadius: 99,
		textTransform: "uppercase",
		letterSpacing: .4
	},
	badgeOk: {
		background: "rgba(34,197,94,0.15)",
		color: "#16a34a"
	},
	badgeError: {
		background: "rgba(239,68,68,0.15)",
		color: "#dc2626"
	},
	badgeRunning: {
		background: "rgba(100,116,139,0.15)",
		color: "#64748b"
	},
	body: { padding: "4px 10px 8px" },
	meta: {
		display: "flex",
		alignItems: "center",
		flexWrap: "wrap",
		gap: 10,
		marginTop: 6,
		fontSize: 12,
		color: MUTED
	},
	muted: {
		fontSize: 12,
		color: MUTED
	},
	pre: {
		whiteSpace: "pre-wrap",
		wordBreak: "break-all",
		fontSize: 12,
		margin: 0,
		maxHeight: "24em",
		overflow: "auto"
	},
	button: {
		color: ACCENT,
		background: "none",
		border: "none",
		cursor: "pointer",
		padding: 0,
		font: "inherit",
		fontSize: 12
	},
	primaryButton: {
		border: `1px solid ${ACCENT}`,
		borderRadius: 6,
		color: ACCENT,
		background: "transparent",
		padding: "4px 9px",
		cursor: "pointer",
		font: "inherit",
		fontSize: 12
	},
	loading: {
		display: "flex",
		alignItems: "center",
		gap: 8,
		padding: "4px 0"
	},
	fallback: {
		display: "flex",
		flexDirection: "column",
		alignItems: "flex-start",
		gap: 6,
		padding: "12px",
		borderRadius: 6,
		border: "1px solid var(--ui-border, rgba(128,128,128,0.25))",
		background: "rgba(128,128,128,0.06)",
		fontSize: 12
	},
	fallbackTitle: {
		fontSize: 13,
		fontWeight: 600
	},
	keyValue: {
		display: "flex",
		alignItems: "baseline",
		gap: 6,
		fontSize: 12
	},
	key: { color: MUTED },
	value: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	}
};
/**
* Panel-variant styles for the shared live frame: the stream fills the phone
* screen provided by the panel (no card chrome), so the frame is a full-bleed
* column. The panel's actions live in the panel chrome's own top toolbar
* (see android-panel.tsx), not inside the frame.
*
* The stage carries NO background of its own: the phone screen div provides
* the backdrop (black in bezel/device, transparent in frameless — see
* androidPhoneScreenStyles in android-panel-frame.tsx), so frameless mode
* never leaks a dark layer between the frame wrapper and the stream img.
*/
const PANEL_STREAM_STAGE_STYLES = {
	display: "flex",
	flexDirection: "column",
	width: "100%",
	height: "100%",
	minHeight: 0,
	overflow: "hidden"
};
/**
* The pointer box inside the panel's phone screen: sized to the frame's own
* aspect ratio (the frame is already display-rotated, so the aspect IS the
* natural one). Pointer events land here and its bounds ARE the normalized
* 0..1 coordinate space `/control` expects — no inverse mapping anywhere.
*/
const PANEL_STREAM_BOX_STYLES = {
	position: "relative",
	width: "100%",
	flex: "none",
	touchAction: "none",
	cursor: "crosshair"
};
/**
* The stream img inside the pointer box: absolutely positioned and `fill`
* (NOT `contain`). The box's `aspectRatio` IS the frame's aspect, so `fill`
* and `contain` draw the same picture — except that `contain` resolves any
* sub-pixel box/device-pixel mismatch by leaving the slack on ONE side, which
* at 2× DPR paints the adjacent bezel rim a physical pixel thicker there.
* `fill` stretches edge-to-edge so residual slack distributes symmetrically.
*
* No background of its own: the screen's backdrop (black under a shell,
* transparent in frameless) shows through wherever a letterbox could appear.
*/
const PANEL_STREAM_IMG_STYLES = {
	position: "absolute",
	inset: 0,
	width: "100%",
	height: "100%",
	objectFit: "fill",
	userSelect: "none",
	touchAction: "none"
};
/**
* The panel's screenshot img: fills the phone screen. `contain` STAYS here
* (unlike the stream img above): screenshot mode never reports a natural
* HEIGHT, so the phone screen's aspect derives from the 412:915 fallback
* shape and matches the PNG only for 412:915-ratio devices. `fill` would
* stretch any other device's screenshot; `contain` preserves it, and the
* snapped integer frame width keeps the horizontal slack symmetric anyway.
*/
const PANEL_SCREENSHOT_IMAGE_STYLES = {
	display: "block",
	width: "100%",
	height: "100%",
	objectFit: "contain"
};
/** Centered loading / fallback bodies inside the phone screen. */
const PANEL_LOADING_STYLES = {
	flex: 1,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	gap: 8,
	padding: 16,
	textAlign: "center"
};
const PANEL_FALLBACK_STYLES = {
	flex: 1,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	gap: 8,
	padding: 16,
	textAlign: "center",
	fontSize: 12
};
//#endregion
//#region src/client/card-boundary.tsx
/**
* Last-resort guard around every dsh-android conversation card. A throwing
* slot component must never take down the conversation, so each registered
* view is wrapped in this boundary and renders a static fallback card instead.
*/
var AndroidCardBoundary = class extends react.Component {
	constructor(props) {
		super(props);
		this.state = { failed: false };
	}
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch(error, info) {
		console.error("dsh-android: device card render failed", error, info.componentStack);
	}
	render() {
		if (!this.state.failed) return this.props.children;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
			style: CARD_STYLES.card,
			"data-tool": "dsh-android",
			"data-state": "unavailable",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: CARD_STYLES.head,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Android" })
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: CARD_STYLES.body,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: CARD_STYLES.fallback,
					role: "alert",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
						style: CARD_STYLES.fallbackTitle,
						children: "stream not available"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: CARD_STYLES.muted,
						children: "The Android card failed to render."
					})]
				})
			})]
		});
	}
};
//#endregion
//#region src/client/protocol.ts
/**
* Browser-side wire contract for the dsh-android device cards and panel.
*
* Pure helpers only — nothing touches the DOM at module scope, and every
* function exported here is safe to call from Node, so the dev-panel-smoke
* script drives the exact bytes the panel sends in a browser.
*
* Contract summary (host side, see src/stream-routes.ts):
* - `output.presentationMeta` rides into `ToolResultNode.meta` verbatim with
*   kinds `android-stream` | `android-screenshot` | `android-build-run`.
* - `POST /_dsh/dsh-android/grant` re-mints origin-relative capability URLs
*   at render time; tokens expire within 10 minutes. `{kind:'stream'}` →
*   `{streamUrl, expiresAt, device}` — there is **no wsUrl**: this plugin has
*   NO WebSocket at all. `{kind:'screenshot', path}` → `{screenshotUrl,
*   expiresAt}`.
* - `POST /_dsh/dsh-android/switch-device {device}` → the grant shape plus
*   `{device, deviceName}`; only ONLINE serials are accepted (an AVD boot
*   takes minutes and belongs to the `android_boot` tool).
* - `POST /_dsh/dsh-android/devices {}` → `{devices:[{serial,state,kind,
*   model?,streaming?}], avds:[string]}` — ONE array (emulators and phones
*   stream through the same code path), plus the machine's AVD names.
* - `POST /_dsh/dsh-android/capture {device?}` → `{screenshotUrl, path,
*   bytes, expiresAt}`.
* - `POST /_dsh/dsh-android/status {device?}` → `{running, serial?,
*   deviceName?}`.
* - `POST /_dsh/dsh-android/control {device, action}` — the ONE control
*   channel: tap / drag (NORMALIZED 0..1 of the streamed frame) / button /
*   type / rotate. A rotate answers `{rotation: 0..3}`.
* - `POST /_dsh/dsh-android/device-action {device?, action}` → `{action}`.
* - Every failure is `{ok:false, code, error}`; the UI localizes off the
*   CODE and keeps the host's English `error` as the fallback.
*
* COORDINATE SPACE: an Android `screencap` frame follows the DISPLAY
* rotation (a landscape app streams 2400×1080) and `input tap` addresses the
* same space, so normalized pointer coordinates over the displayed box go
* STRAIGHT to `/control` — there is no framebuffer/display mismatch and no
* inverse rotation anywhere in this client.
* @module @zseven-w/dsh-android/client/protocol
*/
/** Wire tool names the client registers conversation cards for. */
const ANDROID_CARD_TOOLS = {
	boot: "android_boot",
	screenshot: "android_screenshot",
	interact: "android_interact",
	buildRun: "android_build_run"
};
/** HTTP prefix owned by the dsh-android web routes. */
const PLUGIN_ROUTE_PREFIX = "/_dsh/dsh-android";
/** The grant endpoint the cards/panel POST to at render time. */
const GRANT_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/grant`;
/** The read-only stream-status endpoint the input-dock capsule polls. */
const STATUS_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/status`;
/** The fresh-screenshot endpoint the panel toolbar's 截图 button POSTs to. */
const CAPTURE_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/capture`;
/** The device-switch endpoint the panel header's device picker POSTs to. */
const SWITCH_DEVICE_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/switch-device`;
/** The pickable-device listing endpoint the picker refreshes on open. */
const DEVICES_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/devices`;
/** The single control endpoint (tap/drag/button/type/rotate). */
const CONTROL_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/control`;
/** The device-level action endpoint (notification shade, lock, …). */
const DEVICE_ACTION_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/device-action`;
/** Only a fully online device can stream or take control ops. */
function androidDeviceOnline(device) {
	return device.state === "device";
}
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function optionalString$1(record, key) {
	const value = record[key];
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function optionalFiniteNumber(record, key) {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function parseDevice$1(value) {
	if (!isRecord$2(value)) return {};
	return {
		...typeof value.serial === "string" ? { serial: value.serial } : {},
		...typeof value.name === "string" ? { name: value.name } : {},
		...typeof value.androidVersion === "string" ? { androidVersion: value.androidVersion } : {},
		...typeof value.state === "string" ? { state: value.state } : {}
	};
}
/**
* Defensively parse the presentationMeta the host projected into
* `ToolResultNode.meta`. Unknown or malformed shapes return `undefined` and
* the card falls back to its plain fallback UI — never a throw.
*/
function parseAndroidMeta(meta) {
	if (!isRecord$2(meta)) return void 0;
	const device = parseDevice$1(meta.device);
	if (meta.kind === "android-stream") {
		const streamRouteId = optionalString$1(meta, "streamRouteId");
		return {
			kind: "android-stream",
			device,
			...streamRouteId === void 0 ? {} : { streamRouteId }
		};
	}
	if (meta.kind === "android-screenshot") {
		const path = optionalString$1(meta, "path") ?? optionalString$1(meta, "screenshotPath");
		if (path === void 0) return void 0;
		const screenshotPath = optionalString$1(meta, "screenshotPath");
		return {
			kind: "android-screenshot",
			path,
			...screenshotPath === void 0 ? {} : { screenshotPath },
			device
		};
	}
	if (meta.kind === "android-build-run") {
		const packageName = optionalString$1(meta, "packageName");
		const apkPath = optionalString$1(meta, "apkPath");
		return {
			kind: "android-build-run",
			device,
			...packageName === void 0 ? {} : { packageName },
			...apkPath === void 0 ? {} : { apkPath }
		};
	}
}
const ROUTE_ERROR_COPY_KEYS = {
	forbidden: "errForbidden",
	bad_method: "errBadMethod",
	bad_content_type: "errBadContentType",
	bad_request: "errBadRequest",
	device_unknown: "errDeviceUnknown",
	device_offline: "errDeviceOffline",
	device_unauthorized: "errDeviceUnauthorized",
	device_busy: "errDeviceBusy",
	stream_not_running: "errStreamNotRunning",
	stream_failed: "errStreamFailed",
	token_invalid: "errTokenInvalid",
	screenshot_missing: "errScreenshotMissing",
	adb_unavailable: "errAdbUnavailable",
	unavailable: "errUnavailable"
};
/**
* Localized text for a route failure: the code wins, the host's English
* detail is the fallback. `copy` is the locale table (androidCopy(locale)) —
* passed in rather than imported so this module stays copy-agnostic.
*/
function androidRouteErrorTextOf(failure, copy) {
	const key = failure.code === void 0 ? void 0 : ROUTE_ERROR_COPY_KEYS[failure.code];
	return (key === void 0 ? void 0 : copy[key]) ?? failure.error;
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* POST one JSON body and defensively read the answer. NEVER throws: a
* transport failure, a non-2xx status and a malformed body all resolve to the
* shared `GrantFailure` shape so every call site has exactly one branch.
*/
async function postJson(fetcher, path, body, routeLabel) {
	let response;
	try {
		response = await fetcher(path, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				accept: "application/json",
				"content-type": "application/json"
			},
			body: JSON.stringify(body)
		});
	} catch (error) {
		return {
			ok: false,
			error: `${routeLabel} request failed: ${errorMessage(error)}`
		};
	}
	let value;
	try {
		value = await response.json();
	} catch {
		value = void 0;
	}
	if (!response.ok || !isRecord$2(value)) {
		const message = isRecord$2(value) && typeof value.error === "string" ? value.error : `${routeLabel} endpoint returned HTTP ${response.status}`;
		const code = isRecord$2(value) && typeof value.code === "string" ? value.code : void 0;
		return {
			ok: false,
			status: response.status,
			error: message,
			...code === void 0 ? {} : { code }
		};
	}
	return {
		ok: true,
		body: value
	};
}
function postGrant(fetcher, body) {
	return postJson(fetcher, GRANT_ROUTE_PATH, body, "grant");
}
/**
* The exact grant request body the stream surface sends. With a serial the
* route starts (or reuses) the stream for that device; without one it falls
* back to the device the session is already streaming.
*/
function streamGrantBodyOf(input) {
	const serial = input.device?.serial;
	const session = typeof input.sessionId === "string" && input.sessionId !== "" ? { sessionId: input.sessionId } : {};
	return typeof serial === "string" && serial.trim() !== "" ? {
		kind: "stream",
		device: serial,
		...session
	} : {
		kind: "stream",
		...session
	};
}
/** POST the grant endpoint and read back the minted capability URL. */
async function requestStreamGrant(fetcher, input) {
	const result = await postGrant(fetcher, streamGrantBodyOf(input));
	if (!result.ok) return result;
	const streamUrl = optionalString$1(result.body, "streamUrl");
	if (streamUrl === void 0) return {
		ok: false,
		error: "grant response is missing streamUrl"
	};
	const expiresAt = optionalFiniteNumber(result.body, "expiresAt");
	const device = optionalString$1(result.body, "device");
	return {
		ok: true,
		grant: {
			streamUrl,
			...expiresAt === void 0 ? {} : { expiresAt },
			...device === void 0 ? {} : { device }
		}
	};
}
/** The exact grant request body the screenshot surface sends. */
function screenshotGrantBodyOf(path) {
	return {
		kind: "screenshot",
		path
	};
}
/** POST the grant endpoint for one screenshot path in the plugin cache. */
async function requestScreenshotGrant(fetcher, path) {
	const result = await postGrant(fetcher, screenshotGrantBodyOf(path));
	if (!result.ok) return result;
	const screenshotUrl = optionalString$1(result.body, "screenshotUrl");
	if (screenshotUrl === void 0) return {
		ok: false,
		error: "grant response is missing screenshotUrl"
	};
	const expiresAt = optionalFiniteNumber(result.body, "expiresAt");
	return {
		ok: true,
		grant: {
			screenshotUrl,
			...expiresAt === void 0 ? {} : { expiresAt }
		}
	};
}
/**
* POST the read-only status endpoint and defensively parse the snapshot.
* The endpoint never starts a stream and never mints capability tokens.
*/
async function requestAndroidStatus(fetcher, input = {}) {
	const session = typeof input.sessionId === "string" && input.sessionId !== "" ? { sessionId: input.sessionId } : {};
	const body = typeof input.device === "string" && input.device !== "" ? {
		device: input.device,
		...session
	} : { ...session };
	const result = await postJson(fetcher, STATUS_ROUTE_PATH, body, "status");
	if (!result.ok) return { running: false };
	return {
		running: result.body.running === true,
		...typeof result.body.serial === "string" && result.body.serial !== "" ? { serial: result.body.serial } : {},
		...typeof result.body.deviceName === "string" && result.body.deviceName !== "" ? { deviceName: result.body.deviceName } : {}
	};
}
/** The exact capture request body the toolbar sends (device optional). */
function captureBodyOf(input) {
	const session = typeof input.sessionId === "string" && input.sessionId !== "" ? { sessionId: input.sessionId } : {};
	return typeof input.device === "string" && input.device.trim() !== "" ? {
		device: input.device,
		...session
	} : { ...session };
}
/**
* POST the capture endpoint and read back a freshly minted screenshot URL.
* The route captures a NEW PNG of the current streamed (or explicitly named,
* online) device — no prior presentationMeta path is involved.
*/
async function requestAndroidCapture(fetcher, input = {}) {
	const result = await postJson(fetcher, CAPTURE_ROUTE_PATH, captureBodyOf(input), "capture");
	if (!result.ok) return result;
	const screenshotUrl = optionalString$1(result.body, "screenshotUrl");
	const path = optionalString$1(result.body, "path");
	const bytes = optionalFiniteNumber(result.body, "bytes");
	if (screenshotUrl === void 0 || path === void 0 || bytes === void 0) return {
		ok: false,
		error: "capture response is missing screenshotUrl, path or bytes"
	};
	const expiresAt = optionalFiniteNumber(result.body, "expiresAt");
	return {
		ok: true,
		capture: {
			screenshotUrl,
			path,
			bytes,
			...expiresAt === void 0 ? {} : { expiresAt }
		}
	};
}
/** The exact switch-device request body the panel picker sends. */
function switchDeviceBodyOf(serial, sessionId) {
	return {
		device: serial,
		...typeof sessionId === "string" && sessionId !== "" ? { sessionId } : {}
	};
}
/**
* POST the switch-device endpoint: the explicit user gesture that takes over
* the stream slot for another ONLINE device and mints fresh relative
* capability URLs for it. An offline/unauthorized target answers a coded 409
* (this route never boots an AVD — that is `android_boot`).
*/
async function requestSwitchDevice(fetcher, serial, sessionId) {
	const result = await postJson(fetcher, SWITCH_DEVICE_ROUTE_PATH, switchDeviceBodyOf(serial, sessionId), "switch-device");
	if (!result.ok) return result;
	const streamUrl = optionalString$1(result.body, "streamUrl");
	const device = optionalString$1(result.body, "device");
	if (streamUrl === void 0 || device === void 0) return {
		ok: false,
		error: "switch-device response is missing streamUrl or device"
	};
	const expiresAt = optionalFiniteNumber(result.body, "expiresAt");
	const deviceName = optionalString$1(result.body, "deviceName");
	return {
		ok: true,
		switched: {
			streamUrl,
			...expiresAt === void 0 ? {} : { expiresAt },
			device,
			...deviceName === void 0 ? {} : { deviceName }
		}
	};
}
/**
* POST the pickable-device listing endpoint and defensively parse the ONE
* `devices` array plus the `avds` names. Always resolves (empty on failure) —
* the picker degrades to the current device and retries on the next open.
* Host-side ordering (online first, then serial) is preserved as-is.
*/
async function requestAndroidDevices(fetcher, sessionId) {
	const result = await postJson(fetcher, DEVICES_ROUTE_PATH, typeof sessionId === "string" && sessionId !== "" ? { sessionId } : {}, "devices");
	if (!result.ok || !Array.isArray(result.body.devices)) return {
		devices: [],
		avds: []
	};
	const devices = [];
	for (const entry of result.body.devices) {
		if (!isRecord$2(entry)) continue;
		const serial = optionalString$1(entry, "serial");
		const state = optionalString$1(entry, "state");
		if (serial === void 0 || state === void 0) continue;
		const model = optionalString$1(entry, "model");
		devices.push({
			serial,
			state,
			kind: entry.kind === "emulator" ? "emulator" : "physical",
			...model === void 0 ? {} : { model },
			...entry.streaming === true ? { streaming: true } : {}
		});
	}
	const avds = [];
	if (Array.isArray(result.body.avds)) {
		for (const entry of result.body.avds) if (typeof entry === "string" && entry !== "") avds.push(entry);
	}
	return {
		devices,
		avds
	};
}
/** Hardware/navigation buttons `/control` accepts (host: ANDROID_BUTTONS). */
const ANDROID_BUTTONS = [
	"home",
	"back",
	"recents",
	"power",
	"volume_up",
	"volume_down",
	"menu",
	"enter",
	"delete"
];
/** The exact control request body the panel sends. */
function controlBodyOf(device, action, sessionId) {
	return {
		device,
		action,
		...typeof sessionId === "string" && sessionId !== "" ? { sessionId } : {}
	};
}
/**
* POST the control endpoint. Fails fast with the route's coded error; the
* panel treats control failures as non-fatal (a refused tap stays silent).
*/
async function postAndroidControl(fetcher, device, action, sessionId) {
	const result = await postJson(fetcher, CONTROL_ROUTE_PATH, controlBodyOf(device, action, sessionId), "control");
	if (!result.ok) return result;
	const rotation = optionalFiniteNumber(result.body, "rotation");
	return {
		ok: true,
		result: { ...rotation === void 0 ? {} : { rotation } }
	};
}
/** The device-level actions the host exposes (host: ANDROID_DEVICE_ACTIONS). */
const ANDROID_DEVICE_ACTIONS = [
	"notifications",
	"quick-settings",
	"lock",
	"wake",
	"assistant"
];
/**
* Run one device-level action. A coded failure comes back through the shared
* failure shape and the menu keeps itself open for a retry.
*/
async function postDeviceAction(fetcher, device, action, sessionId) {
	const body = {
		action,
		...device === void 0 || device === "" ? {} : { device },
		...typeof sessionId === "string" && sessionId !== "" ? { sessionId } : {}
	};
	const result = await postJson(fetcher, DEVICE_ACTION_ROUTE_PATH, body, "device-action");
	if (!result.ok) return result;
	return {
		ok: true,
		action: optionalString$1(result.body, "action") ?? action
	};
}
/**
* `/control` exposes COMPLETE gestures only (`input tap`, `input swipe`) —
* there is no touch begin/move/end streaming channel — so the panel
* COALESCES each pointer gesture into ONE action on pointer-up: a still
* click → `tap`; a moved pointer → one `drag` from the pointer-down anchor
* to the FINAL release point with the gesture's own duration (clamped), which
* `input swipe` animates linearly from→to. That reproduces a faithful slow
* drag or a quick flick without a chain of separate down-up swipes.
*/
/** Movement below this fraction of the frame still counts as a tap. */
const ANDROID_TAP_SLOP = .02;
/** Minimum/maximum drag duration sent to the host (seconds). */
const ANDROID_DRAG_DURATION_MIN_S = .05;
const ANDROID_DRAG_DURATION_MAX_S = 2;
/** Trailing-edge sampling cadence for drag move bookkeeping (ms). */
const ANDROID_DRAG_MOVE_SAMPLE_MS = 50;
/**
* One gesture → one control action: tap when the pointer barely moved,
* otherwise a single drag from anchor to release point over the (clamped)
* gesture duration.
*/
function androidGestureActionOf(start, end, durationMs) {
	if (Math.hypot(end.x - start.x, end.y - start.y) < .02) return {
		kind: "tap",
		x: end.x,
		y: end.y
	};
	const duration = Math.min(2, Math.max(ANDROID_DRAG_DURATION_MIN_S, durationMs / 1e3));
	return {
		kind: "drag",
		fromX: start.x,
		fromY: start.y,
		toX: end.x,
		toY: end.y,
		durationMs: Math.round(duration * 1e3)
	};
}
function clamp01(value) {
	return Math.min(1, Math.max(0, value));
}
/** Map a pointer event on an element to normalized 0..1 stream coordinates. */
function normalizePointerPoint(event, bounds) {
	const width = bounds.width > 0 ? bounds.width : 1;
	const height = bounds.height > 0 ? bounds.height : 1;
	return {
		x: clamp01((event.clientX - bounds.left) / width),
		y: clamp01((event.clientY - bounds.top) / height)
	};
}
//#endregion
//#region src/client/android-meta-hydrate.ts
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** The screenshot/apk paths the host emits are always POSIX absolute. */
function isPosixAbsolutePath(value) {
	return typeof value === "string" && value.startsWith("/");
}
/** Non-negative finite byte count (required by every screenshot result). */
function isByteCount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
/** Interact actions the tool schema allows (distinguishes interact results). */
const INTERACT_ACTIONS = /* @__PURE__ */ new Set([
	"tap",
	"type",
	"button",
	"gesture",
	"scroll"
]);
/**
* Parse the durable result's device record. The serial is mandatory: every
* grant/control flow addresses the device by serial and `streamRouteId`
* derives from it.
*/
function parseDevice(value) {
	if (!isRecord$1(value)) return void 0;
	const serial = nonEmptyString(value.serial);
	if (serial === void 0) return void 0;
	const device = { serial };
	const name = nonEmptyString(value.name) ?? nonEmptyString(value.model);
	const androidVersion = nonEmptyString(value.androidVersion);
	const state = nonEmptyString(value.state);
	if (name !== void 0) device.name = name;
	if (androidVersion !== void 0) device.androidVersion = androidVersion;
	if (state !== void 0) device.state = state;
	return device;
}
/** `android_boot` → the exact `android-stream` envelope the host projects. */
function hydrateStreamMeta(value) {
	if (!isRecord$1(value) || value.streaming !== true) return null;
	if (value.state !== "streaming" && value.state !== "booted") return null;
	const device = parseDevice(value.device);
	if (device === void 0) return null;
	return {
		kind: "android-stream",
		device,
		streamRouteId: `dsh-android/stream/${device.serial}`
	};
}
/** `android_screenshot` / `android_interact` → the screenshot envelope. */
function hydrateScreenshotMeta(value, interact) {
	if (!isRecord$1(value)) return null;
	if (interact) {
		const action = value.action;
		if (typeof action !== "string" || !INTERACT_ACTIONS.has(action)) return null;
	}
	const path = isPosixAbsolutePath(value.path) ? value.path : void 0;
	if (path === void 0 || !isByteCount(value.bytes)) return null;
	const device = parseDevice(value.device);
	if (device === void 0) return null;
	return {
		kind: "android-screenshot",
		screenshotPath: path,
		path,
		device
	};
}
/** `android_build_run` → the exact `android-build-run` envelope. */
function hydrateBuildRunMeta(value) {
	if (!isRecord$1(value) || value.state !== "launched") return null;
	const packageName = nonEmptyString(value.packageName);
	if (packageName === void 0) return null;
	const device = parseDevice(value.device);
	if (device === void 0) return null;
	const apkPath = isPosixAbsolutePath(value.apkPath) ? value.apkPath : void 0;
	return {
		kind: "android-build-run",
		device,
		packageName,
		...apkPath === void 0 ? {} : { apkPath }
	};
}
/** Rebuild the meta for one settled, non-error tool result (or null). */
function hydrateAndroidMetaValue(toolName, value) {
	if (toolName === ANDROID_CARD_TOOLS.boot) return hydrateStreamMeta(value);
	if (toolName === ANDROID_CARD_TOOLS.screenshot || toolName === ANDROID_CARD_TOOLS.interact) return hydrateScreenshotMeta(value, toolName === ANDROID_CARD_TOOLS.interact);
	if (toolName === ANDROID_CARD_TOOLS.buildRun) return hydrateBuildRunMeta(value);
	return null;
}
/**
* Rebuild the exact presentationMeta from a settled tool result's durable
* JSON text (the first text content block that parses as a JSON object).
* Resolves `null` — never throws — when the result cannot be validated, in
* which case the cards keep today's plain fallback UI.
*/
function hydrateAndroidMeta(toolName, block) {
	if (!("kind" in block) || block.kind !== "tool-result" || block.isError) return null;
	for (const item of block.content) {
		if (item.type !== "text") continue;
		let value;
		try {
			value = JSON.parse(item.text);
		} catch {
			continue;
		}
		if (!isRecord$1(value)) continue;
		const hydrated = hydrateAndroidMetaValue(toolName, value);
		if (hydrated !== null) return hydrated;
	}
	return null;
}
/**
* The single meta resolution every card and the panel share: the
* host-projected `presentationMeta` always wins (standard-mode sessions are
* untouched), and a nested Code Mode result reconstructs the same meta from
* its durable JSON text. Unsettled/error results resolve `undefined`.
*/
function resolveAndroidMeta(toolName, block) {
	if (!("kind" in block) || block.kind !== "tool-result" || block.isError) return void 0;
	const projected = parseAndroidMeta(block.meta);
	if (projected !== void 0) return {
		meta: projected,
		source: "meta"
	};
	const hydrated = hydrateAndroidMeta(toolName, block);
	return hydrated === null ? void 0 : {
		meta: hydrated,
		source: "hydrated"
	};
}
//#endregion
//#region src/client/copy.ts
const COPY = {
	en: {
		android: "Android",
		actionBoot: "Start",
		actionScreenshot: "Screenshot",
		actionInteract: "Interact",
		actionBuildRun: "Build & Run",
		booting: "Starting the device stream…",
		connecting: "Connecting to the live stream…",
		connectingScreenshot: "Loading screenshot…",
		live: "live",
		unavailable: "unavailable",
		done: "done",
		streamUnavailable: "stream not available",
		screenshotUnavailable: "screenshot not available",
		retry: "Retry",
		refresh: "Refresh",
		back: "Back",
		home: "Home",
		recents: "Recents",
		deviceMenu: "Device actions",
		deviceNotifications: "Notifications",
		deviceQuickSettings: "Quick Settings",
		deviceLock: "Lock screen",
		deviceWake: "Wake",
		deviceAssistant: "Assistant",
		deviceActionFailed: "the device action failed",
		screenshot: "Screenshot",
		captured: "Captured",
		capturing: "Capturing…",
		rotate: "Rotate",
		toolbar: "Device toolbar",
		sizeMode: "Device display size",
		frameStyle: "Device frame style",
		frameStyleNone: "Frameless",
		frameStyleBezel: "Bezel",
		frameStyleDevice: "Phone frame",
		sizeQuickFit: "Fit to panel width",
		sizeQuickPercent100: "Display at 100%",
		sizeQuickS: "Small size (S, 240px)",
		sizeQuickM: "Medium size (M, 320px)",
		streamAlt: "Live Android device — click to tap, drag to gesture",
		screenshotAlt: "Android device screenshot",
		captureScreenshot: "Capturing screenshot…",
		interacting: "Interacting with the device…",
		building: "Building and installing the app…",
		noPreview: "No live view is available for this result.",
		toolFailed: "The tool call failed.",
		openApk: "Open APK",
		openScreenshot: "Open screenshot",
		packageName: "Package",
		device: "device",
		offline: "Offline",
		panelLive: "Live",
		closePanel: "Close device panel",
		backgroundMode: "AI background",
		backgroundModeHint: "Keep AI control available without opening the live panel",
		resizePanel: "Drag to resize the device panel",
		openInPanel: "Open in sidebar",
		openAndroidPanel: "Open device panel",
		devicePicker: "Android device",
		deviceSwitching: "Switching…",
		deviceStreaming: "live",
		deviceOnline: "online",
		deviceEmulators: "Emulators",
		devicePhysical: "Phones",
		deviceAvds: "Available AVDs",
		deviceAvdHint: "start it with android_boot",
		deviceNone: "No device connected",
		followActive: "Auto-follow",
		followHint: "The panel follows the agent’s newest target device",
		followResume: "Resume following",
		switchFailed: "Switch failed",
		errForbidden: "the request was refused (loopback-trusted browsers only)",
		errBadMethod: "the route refused this request method",
		errBadContentType: "the route expects a JSON request",
		errBadRequest: "the request was malformed",
		errDeviceUnknown: "the device is not connected — run android_devices, or start an emulator with android_boot",
		errDeviceOffline: "the device is not ready (adb reports it offline)",
		errDeviceUnauthorized: "the device has not authorized this computer — allow USB debugging on the phone, then retry",
		errDeviceBusy: "another device is streaming; pick it in the device list to switch",
		errStreamNotRunning: "no stream is running for this device",
		errStreamFailed: "the device stream failed to start",
		errTokenInvalid: "the access link expired; refresh to get a new one",
		errScreenshotMissing: "the screenshot file is gone",
		errAdbUnavailable: "adb is unavailable on this host — install the Android platform tools",
		errUnavailable: "the device is unavailable"
	},
	zh: {
		android: "Android 设备",
		actionBoot: "启动",
		actionScreenshot: "截图",
		actionInteract: "交互",
		actionBuildRun: "构建运行",
		booting: "正在启动设备画面…",
		connecting: "正在连接实时画面…",
		connectingScreenshot: "正在加载截图…",
		live: "实时",
		unavailable: "不可用",
		done: "完成",
		streamUnavailable: "画面不可用",
		screenshotUnavailable: "截图不可用",
		retry: "重试",
		refresh: "刷新",
		back: "返回",
		home: "主屏幕",
		recents: "最近任务",
		deviceMenu: "设备操作",
		deviceNotifications: "通知栏",
		deviceQuickSettings: "快捷设置",
		deviceLock: "锁屏",
		deviceWake: "唤醒",
		deviceAssistant: "语音助手",
		deviceActionFailed: "设备操作失败",
		screenshot: "截图",
		captured: "已截图",
		capturing: "正在截图…",
		rotate: "旋转",
		toolbar: "设备工具栏",
		sizeMode: "设备显示大小",
		frameStyle: "设备边框样式",
		frameStyleNone: "无框",
		frameStyleBezel: "边框",
		frameStyleDevice: "手机框",
		sizeQuickFit: "适应面板宽度",
		sizeQuickPercent100: "以 100% 显示",
		sizeQuickS: "小尺寸（S，240px）",
		sizeQuickM: "中尺寸（M，320px）",
		streamAlt: "实时 Android 画面 — 点击轻触，拖动手势",
		screenshotAlt: "Android 设备截图",
		captureScreenshot: "正在截取屏幕…",
		interacting: "正在与设备交互…",
		building: "正在构建并安装应用…",
		noPreview: "此结果没有可用的实时视图。",
		toolFailed: "工具调用失败。",
		openApk: "打开 APK",
		openScreenshot: "打开截图",
		packageName: "包名",
		device: "设备",
		offline: "离线",
		panelLive: "实时",
		closePanel: "关闭设备面板",
		backgroundMode: "AI 后台",
		backgroundModeHint: "不打开实时面板，AI 仍可在后台控制设备",
		resizePanel: "拖动调整设备面板宽度",
		openInPanel: "在侧边栏打开",
		openAndroidPanel: "打开设备面板",
		devicePicker: "Android 设备",
		deviceSwitching: "切换中…",
		deviceStreaming: "实时",
		deviceOnline: "在线",
		deviceEmulators: "模拟器",
		devicePhysical: "实体设备",
		deviceAvds: "可用 AVD",
		deviceAvdHint: "用 android_boot 启动",
		deviceNone: "未连接设备",
		followActive: "自动跟随",
		followHint: "面板自动跟随 agent 的最新目标设备",
		followResume: "恢复跟随",
		switchFailed: "切换失败",
		errForbidden: "请求被拒绝（仅限本机可信浏览器）",
		errBadMethod: "该路由不接受此请求方法",
		errBadContentType: "该路由需要 JSON 请求",
		errBadRequest: "请求格式不正确",
		errDeviceUnknown: "设备未连接——运行 android_devices，或用 android_boot 启动模拟器",
		errDeviceOffline: "设备尚未就绪（adb 报告为 offline）",
		errDeviceUnauthorized: "设备未授权这台电脑——请在手机上允许 USB 调试，然后重试",
		errDeviceBusy: "另一台设备正在推流；在设备列表里选择它即可切换",
		errStreamNotRunning: "该设备没有正在运行的画面流",
		errStreamFailed: "设备画面流启动失败",
		errTokenInvalid: "访问链接已过期，刷新即可重新获取",
		errScreenshotMissing: "截图文件已不存在",
		errAdbUnavailable: "此主机没有可用的 adb——请安装 Android platform-tools",
		errUnavailable: "设备不可用"
	}
};
function androidCopy(locale) {
	return locale === "zh" ? COPY.zh : COPY.en;
}
/** Human-readable byte size for the screenshot caption. */
function formatBytes(bytes) {
	if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return void 0;
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}
//#endregion
//#region src/client/android-result.ts
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function optionalString(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
/** Parse the first JSON text content block of a settled result, if any. */
function androidResultSummaryOf(block) {
	if (!("kind" in block) || block.kind !== "tool-result" || block.isError) return void 0;
	for (const item of block.content) {
		if (item.type !== "text") continue;
		let value;
		try {
			value = JSON.parse(item.text);
		} catch {
			continue;
		}
		if (!isRecord(value)) continue;
		const summary = {};
		const bytes = finiteNumber(value.bytes);
		const width = finiteNumber(value.width);
		const height = finiteNumber(value.height);
		const action = optionalString(value.action);
		const path = optionalString(value.path);
		if (bytes === void 0 && width === void 0 && height === void 0 && action === void 0 && path === void 0) continue;
		if (bytes !== void 0) summary.bytes = bytes;
		if (width !== void 0) summary.width = width;
		if (height !== void 0) summary.height = height;
		if (action !== void 0) summary.action = action;
		if (path !== void 0) summary.path = path;
		return summary;
	}
}
/** Join the durable result text for the fallback disclosure. */
function androidResultTextOf(block) {
	if (!("kind" in block)) return null;
	const parts = [];
	for (const item of block.content) parts.push(item.type === "text" ? item.text : JSON.stringify(item, null, 2));
	if (parts.length === 0 && block.error !== void 0) parts.push(`${block.error.name}: ${block.error.code}`);
	return parts.join("\n") || null;
}
//#endregion
//#region src/client/android-panel-trigger.ts
/**
* Row-click trigger for the plugin-owned device panel (the rc.6 fallback
* surface — the per-tool `tool.details.toolview` seat is not declared by the
* installed runtime, so this package opens its own right-side panel).
*
* Cards register their settled, meta-carrying results in the source registry
* as they mount. A document-level capture listener turns a click on that
* call's tool row (`[data-chat-call-id]` wrapper around the card) into an
* open request — the same gesture DSH uses to open 详情 for a tool. Clicks on
* interactive elements (buttons/links), on the live frame itself (which is
* tap/drag surface for the device), and inside the panel never trigger. The
* listener is installed only while the per-tool details seat is absent and is
* disposed if a runtime later declares it.
*
* Every source carries the framework-supplied `sessionId` of the card that
* registered it, and cards unregister on unmount — so after a session switch
* the registry reflects only the CURRENT session's mounted results. The
* stream-status capsule uses exactly that: it renders (and polls) only while
* the current session has at least one source.
*/
const sources = /* @__PURE__ */ new Map();
const sourceListeners = /* @__PURE__ */ new Set();
/**
* Monotonic registry change counter. The status capsule reads it through
* `useSyncExternalStore` so it re-renders (and starts/stops its status poll)
* whenever sources land or leave — including a session switch, where the old
* session's cards unmount and unregister their sources.
*/
let sourceVersion = 0;
function emitSourceChange() {
	sourceVersion += 1;
	for (const listener of sourceListeners) listener();
}
/** Remember one openable result; returns the unregister disposer. */
function registerAndroidPanelSource(source) {
	sources.set(source.callId, source);
	emitSourceChange();
	return () => {
		if (sources.get(source.callId) === source) {
			sources.delete(source.callId);
			emitSourceChange();
		}
	};
}
/** Subscribe to panel-source registry changes (tool results landing/leaving). */
function subscribeAndroidPanelSources(listener) {
	sourceListeners.add(listener);
	return () => {
		sourceListeners.delete(listener);
	};
}
/** The registry change counter (stable between changes, for `useSyncExternalStore`). */
function androidPanelSourcesVersion() {
	return sourceVersion;
}
/**
* A point-in-time snapshot of every registered source. The panel's
* auto-follow engine scans it for the newest settled result of the current
* session and re-targets to that result's device.
*/
function androidPanelSourcesSnapshot() {
	return Array.from(sources.values());
}
/**
* True while at least one registered source belongs to the given session.
* This is the capsule's session gate: a new empty session has no sources, so
* the capsule stays hidden there even while the global stream runs.
*/
function hasAndroidPanelSourceForSession(sessionId) {
	if (sessionId === "") return false;
	for (const source of sources.values()) if (source.sessionId === sessionId) return true;
	return false;
}
function resolveAndroidPanelSource(callId) {
	return sources.get(callId);
}
/** Register a card's settled result while it is mounted. */
function useAndroidPanelSource(enabled, source) {
	(0, react.useEffect)(() => {
		if (!enabled || source === void 0) return;
		return registerAndroidPanelSource(source);
	}, [enabled, source]);
}
/** Elements whose clicks never open the panel. */
const ANDROID_PANEL_INTERACTIVE_SELECTOR = [
	"button",
	"a",
	"input",
	"select",
	"textarea",
	"summary",
	"[role=\"button\"]",
	"[data-android-live-frame][data-android-frame-state=\"live\"]",
	"[data-android-panel]"
].join(",");
/** True when the click lands on a control or on a device surface itself. */
function androidPanelClickIsInteractive(target) {
	return target.closest(ANDROID_PANEL_INTERACTIVE_SELECTOR) !== null;
}
/** The tool-row call id the click addressed, if any. */
function androidPanelClickRowCallIdOf(target) {
	const callId = target.closest("[data-chat-call-id]")?.dataset?.chatCallId;
	return typeof callId === "string" && callId !== "" ? callId : void 0;
}
/**
* Install the document-level row-click listener. Fires on the capture phase
* so it observes the gesture before any inner handler; it never stops
* propagation, so the host's own row behavior is untouched.
*/
function installAndroidPanelRowTrigger(doc, open) {
	const onClick = (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (androidPanelClickIsInteractive(target)) return;
		const callId = androidPanelClickRowCallIdOf(target);
		if (callId === void 0) return;
		const source = resolveAndroidPanelSource(callId);
		if (source === void 0) return;
		open(source);
	};
	doc.addEventListener("click", onClick, true);
	return () => {
		doc.removeEventListener("click", onClick, true);
	};
}
//#endregion
//#region src/client/android-panel-auto-open.ts
/**
* Auto-open for the device panel when a device is explicitly STARTED.
*
* The panel is normally opened by a user gesture (a row click, the input-dock
* capsule, a device pick). When the AGENT runs the explicit start verb —
* `android_boot` — the user asked for a device to come up, so the panel
* should open by itself the moment the settled result lands, exactly like
* dsh-openpencil auto-opens its editor after `openpencil_render`.
*
* This module is PURE (no React, no DOM, no network) so the dev-panel-smoke
* script can drive the decision and the one-shot registry directly. The
* guards mirror openpencil's `liveAutoOpen*` helpers and all three matter:
*
* - settled-and-not-error: the caller short-circuits on `running`/`error`
*   BEFORE consulting the decision, so a still-running call never opens and
*   a failed start never opens;
* - one-shot: `takeAndroidPanelAutoOpenCall` consumes the key exactly once,
*   so a re-render of the settled card never reopens the panel, and a user
*   CLOSE is never fought (that call already consumed its open);
* - activation timestamp: only blocks whose own `block.time` is at least the
*   activation time count, so scrolling back through an old session replays
*   the cards WITHOUT re-opening the panel.
*/
/** The ONE start verb that auto-opens the panel; nothing else does. */
const ANDROID_PANEL_AUTO_OPEN_TOOLS = [ANDROID_CARD_TOOLS.boot];
/** One-shot entries expire after this (mirrors openpencil's TTL). */
const ANDROID_PANEL_AUTO_OPEN_TTL_MS = 9e5;
/** Ceiling on remembered calls so an idle session cannot grow unbounded. */
const ANDROID_PANEL_AUTO_OPEN_MAX = 256;
/**
* Client activation timestamp. The bundle module is evaluated once per page
* load, so a call only auto-opens when its block is NEWER than this — a
* history replay (which re-mounts old cards with old `block.time`) stays
* silent.
*/
const androidPanelAutoOpenActivatedAt = Date.now();
const autoOpenCalls = /* @__PURE__ */ new Map();
/** The one-shot registry key: session + call identity, like openpencil. */
function androidPanelAutoOpenKey(sessionId, callId) {
	return `${sessionId.length}:${sessionId}${callId}`;
}
function pruneAutoOpenCalls(now = Date.now()) {
	for (const [key, expiresAt] of autoOpenCalls) if (expiresAt <= now) autoOpenCalls.delete(key);
	while (autoOpenCalls.size > ANDROID_PANEL_AUTO_OPEN_MAX) {
		const oldest = autoOpenCalls.keys().next().value;
		if (oldest === void 0) break;
		autoOpenCalls.delete(oldest);
	}
}
/** Arm the key while the call runs, so its settle can take it exactly once. */
function rememberAndroidPanelAutoOpenCall(key) {
	autoOpenCalls.delete(key);
	autoOpenCalls.set(key, Date.now() + ANDROID_PANEL_AUTO_OPEN_TTL_MS);
	pruneAutoOpenCalls();
}
/** Consume the key exactly once; false after the first take (or when absent). */
function takeAndroidPanelAutoOpenCall(key) {
	pruneAutoOpenCalls();
	if (!autoOpenCalls.has(key)) return false;
	autoOpenCalls.delete(key);
	return true;
}
/** Forget the key after an error so a later successful result may take it. */
function forgetAndroidPanelAutoOpenCall(key) {
	autoOpenCalls.delete(key);
}
/**
* Pure auto-open decision: true only for a settled, non-error START verb in
* the CURRENT session whose block is at least as new as activation. Every
* guard is explicit so the smoke can assert each one independently.
*/
function androidPanelAutoOpenShouldOpen(input) {
	if (input.isError) return false;
	if (!ANDROID_PANEL_AUTO_OPEN_TOOLS.includes(input.toolName)) return false;
	if (input.sessionId === "" || input.sessionId !== input.currentSessionId) return false;
	if (typeof input.blockTime !== "number" || !Number.isFinite(input.blockTime)) return false;
	if (input.blockTime < input.activatedAt) return false;
	return true;
}
//#endregion
//#region src/client/android-stream-card.tsx
/**
* Live device stream card (`android_boot`).
*
* The device display lives in the persistent right-side panel, so this card
* renders NO imagery: the conversation stream shows a compact one-line summary
* (tool title, device name, status badge, "open in sidebar" affordance) and
* clicking the row opens the panel via the row-click trigger.
*
* While settled with a parseable `android-stream` meta, the card registers its
* result as an openable source for the device panel and — because `android_boot`
* is the explicit START verb — auto-opens the panel exactly once.
*/
/**
* Shared compact card chrome: a one-line-ish head with the tool title, the
* device name, a status badge and the non-interactive "open in sidebar"
* affordance (the row click itself opens the panel, so the cue never swallows
* the gesture), plus an optional slim body for state copy/meta.
*/
function androidCardChrome({ title, actionLabel, actionId, deviceLabel, badge, dataState, toolName, locale, openable, children, metaSource }) {
	const copy = androidCopy(locale);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		style: CARD_STYLES.card,
		"data-tool": toolName,
		"data-state": dataState,
		"data-android-card-kind": "compact",
		...metaSource === void 0 ? {} : { "data-android-meta-source": metaSource },
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: CARD_STYLES.head,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: CARD_STYLES.title,
					children: title
				}),
				actionLabel !== void 0 && actionLabel !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: CARD_STYLES.action,
					"data-android-card-action": actionId ?? "action",
					children: actionLabel
				}) : null,
				deviceLabel !== void 0 && deviceLabel !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: CARD_STYLES.headDevice,
					children: deviceLabel
				}) : null,
				badge,
				openable ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: CARD_STYLES.openInPanel,
					"aria-hidden": "true",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						children: "⤢"
					}), copy.openInPanel]
				}) : null
			]
		}), children !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: CARD_STYLES.body,
			children
		}) : null]
	});
}
/** Compact device label: the human name, falling back to the serial. */
function androidCardDeviceLabelOf(device) {
	if (device?.name !== void 0 && device.name !== "") return device.name;
	if (device?.serial !== void 0 && device.serial !== "") return device.serial;
	return "";
}
/**
* Conversation card for `android_boot`. Running → "starting" state; settled
* with the `android-stream` meta → the compact live summary; anything else →
* a defensive fallback that never throws.
*/
function AndroidStreamCard(props) {
	const { block, toolName, callId, sessionId, autoOpen } = props;
	const copy = androidCopy(props.locale);
	const locale = props.locale === "zh" ? "zh" : "en";
	const settled = "kind" in block;
	const running = !settled;
	const error = settled && block.isError;
	const resolved = settled && !error ? resolveAndroidMeta(toolName, block) : void 0;
	const streamMeta = resolved?.meta.kind === "android-stream" ? resolved.meta : void 0;
	const metaSource = streamMeta === void 0 || resolved?.source !== "hydrated" ? void 0 : "hydrated";
	const text = androidResultTextOf(block);
	const panelSource = (0, react.useMemo)(() => streamMeta === void 0 ? void 0 : {
		sessionId: String(sessionId ?? ""),
		callId,
		toolName,
		block
	}, [
		block,
		callId,
		sessionId,
		streamMeta,
		toolName
	]);
	useAndroidPanelSource(streamMeta !== void 0, panelSource);
	const autoOpenSessionId = String(sessionId ?? "");
	const autoOpenKey = androidPanelAutoOpenKey(autoOpenSessionId, callId);
	const autoOpenBlockTime = typeof block.time === "number" && Number.isFinite(block.time) ? block.time : 0;
	(0, react.useEffect)(() => {
		if (running && autoOpenBlockTime >= androidPanelAutoOpenActivatedAt) rememberAndroidPanelAutoOpenCall(autoOpenKey);
		else if (error) forgetAndroidPanelAutoOpenCall(autoOpenKey);
	}, [
		autoOpenBlockTime,
		autoOpenKey,
		error,
		running
	]);
	(0, react.useEffect)(() => {
		if (running || panelSource === void 0 || autoOpen === void 0) return;
		if (!androidPanelAutoOpenShouldOpen({
			toolName,
			isError: error,
			blockTime: autoOpenBlockTime,
			sessionId: autoOpenSessionId,
			activatedAt: androidPanelAutoOpenActivatedAt,
			currentSessionId: autoOpenSessionId
		})) return;
		if (!takeAndroidPanelAutoOpenCall(autoOpenKey)) return;
		autoOpen(panelSource);
	}, [
		autoOpen,
		autoOpenBlockTime,
		autoOpenKey,
		autoOpenSessionId,
		error,
		panelSource,
		running,
		toolName
	]);
	if (!settled) return androidCardChrome({
		title: copy.android,
		actionLabel: copy.actionBoot,
		actionId: "boot",
		dataState: "running",
		toolName,
		locale,
		openable: false,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeRunning
			},
			children: copy.booting
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: CARD_STYLES.loading,
			role: "status",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: CARD_STYLES.muted,
				children: copy.booting
			})
		})
	});
	if (error) return androidCardChrome({
		title: copy.android,
		actionLabel: copy.actionBoot,
		actionId: "boot",
		dataState: "error",
		toolName,
		locale,
		openable: false,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeError
			},
			children: copy.unavailable
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: CARD_STYLES.muted,
			children: text ?? copy.toolFailed
		})
	});
	if (streamMeta === void 0) return androidCardChrome({
		title: copy.android,
		actionLabel: copy.actionBoot,
		actionId: "boot",
		dataState: "fallback",
		toolName,
		locale,
		openable: false,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeError
			},
			children: copy.unavailable
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: CARD_STYLES.muted,
			children: copy.noPreview
		}), text !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
			style: {
				...CARD_STYLES.pre,
				marginTop: 8
			},
			children: text
		}) : null] })
	});
	return androidCardChrome({
		title: copy.android,
		actionLabel: copy.actionBoot,
		actionId: "boot",
		deviceLabel: androidCardDeviceLabelOf(streamMeta.device),
		dataState: "live",
		toolName,
		locale,
		openable: true,
		metaSource,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeOk
			},
			children: copy.live
		})
	});
}
//#endregion
//#region src/client/android-screenshot-card.tsx
/**
* Screenshot card (`android_screenshot` and `android_interact`).
*
* The device display lives in the persistent right-side panel, so the card
* never grants/renders the PNG inline: it renders the shared compact one-line
* summary (tool title, device name, 完成 badge, "open in sidebar" affordance)
* plus the durable caption's byte size/dimensions and the 打开截图 link.
* Clicking the row opens the panel via the row-click trigger; settled
* meta-carrying results register as openable sources for the panel.
*/
/** Compact caption: byte size + pixel dimensions (the head carries the device). */
function screenshotCaption(bytes, width, height) {
	const parts = [];
	const size = formatBytes(bytes);
	if (size !== void 0) parts.push(size);
	if (width !== void 0 && height !== void 0) parts.push(`${width}×${height}`);
	if (parts.length === 0) return null;
	return parts.map((part, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: part }, index));
}
/**
* Conversation card for `android_screenshot` / `android_interact`. Compact
* summary row with the openFile (打开截图) link; never renders an `<img>` and
* never throws.
*/
function AndroidScreenshotCard(props) {
	const { block, toolName, openFile, callId, sessionId } = props;
	const copy = androidCopy(props.locale);
	const locale = props.locale === "zh" ? "zh" : "en";
	const isInteract = toolName === ANDROID_CARD_TOOLS.interact;
	const actionLabel = isInteract ? copy.actionInteract : copy.actionScreenshot;
	const actionId = isInteract ? "interact" : "screenshot";
	const settled = "kind" in block;
	const error = settled && block.isError;
	const resolved = settled && !error ? resolveAndroidMeta(toolName, block) : void 0;
	const screenshotMeta = resolved?.meta.kind === "android-screenshot" ? resolved.meta : void 0;
	const metaSource = screenshotMeta === void 0 || resolved?.source !== "hydrated" ? void 0 : "hydrated";
	const summary = androidResultSummaryOf(block);
	const text = androidResultTextOf(block);
	const panelSource = (0, react.useMemo)(() => screenshotMeta === void 0 ? void 0 : {
		sessionId: String(sessionId ?? ""),
		callId,
		toolName,
		block
	}, [
		block,
		callId,
		sessionId,
		screenshotMeta,
		toolName
	]);
	useAndroidPanelSource(screenshotMeta !== void 0, panelSource);
	if (!settled) return androidCardChrome({
		title: copy.android,
		actionLabel,
		actionId,
		dataState: "running",
		toolName,
		locale,
		openable: false,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeRunning
			},
			children: copy.done
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: CARD_STYLES.loading,
			role: "status",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: CARD_STYLES.muted,
				children: isInteract ? copy.interacting : copy.captureScreenshot
			})
		})
	});
	if (error) return androidCardChrome({
		title: copy.android,
		actionLabel,
		actionId,
		dataState: "error",
		toolName,
		locale,
		openable: false,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeError
			},
			children: copy.unavailable
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: CARD_STYLES.muted,
			children: text ?? copy.toolFailed
		})
	});
	if (screenshotMeta === void 0) return androidCardChrome({
		title: copy.android,
		actionLabel,
		actionId,
		dataState: "fallback",
		toolName,
		locale,
		openable: false,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeError
			},
			children: copy.unavailable
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: CARD_STYLES.muted,
			children: copy.noPreview
		}), text !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
			style: {
				...CARD_STYLES.pre,
				marginTop: 8
			},
			children: text
		}) : null] })
	});
	const caption = screenshotCaption(summary?.bytes, summary?.width, summary?.height);
	return androidCardChrome({
		title: copy.android,
		actionLabel,
		actionId,
		deviceLabel: androidCardDeviceLabelOf(screenshotMeta.device),
		dataState: "live",
		toolName,
		locale,
		openable: true,
		metaSource,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeOk
			},
			children: copy.done
		}),
		children: caption !== null || openFile !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: CARD_STYLES.meta,
			children: [caption, openFile !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: CARD_STYLES.button,
				onClick: () => {
					openFile(screenshotMeta.path);
				},
				children: copy.openScreenshot
			}) : null]
		}) : void 0
	});
}
//#endregion
//#region src/client/android-build-run-card.tsx
/**
* Build & run card (`android_build_run`).
*
* The device display lives in the persistent right-side panel, so the card
* renders the shared compact summary (tool title, device name, 完成 badge,
* "open in sidebar" affordance) with a slim meta line carrying the launched
* package name and the open-APK link; the panel's stream mode renders the
* live view for the device. Running calls show a building state; errors and
* meta-less results fall back to the defensive plain card. Settled results
* register as openable panel sources.
*/
function AndroidBuildRunCard(props) {
	const { block, toolName, openFile, callId, sessionId } = props;
	const copy = androidCopy(props.locale);
	const locale = props.locale === "zh" ? "zh" : "en";
	const settled = "kind" in block;
	const error = settled && block.isError;
	const resolved = settled && !error ? resolveAndroidMeta(toolName, block) : void 0;
	const buildMeta = resolved?.meta.kind === "android-build-run" ? resolved.meta : void 0;
	const metaSource = buildMeta === void 0 || resolved?.source !== "hydrated" ? void 0 : "hydrated";
	const text = androidResultTextOf(block);
	const panelSource = (0, react.useMemo)(() => buildMeta === void 0 ? void 0 : {
		sessionId: String(sessionId ?? ""),
		callId,
		toolName,
		block
	}, [
		block,
		callId,
		sessionId,
		buildMeta,
		toolName
	]);
	useAndroidPanelSource(buildMeta !== void 0, panelSource);
	if (!settled) return androidCardChrome({
		title: copy.android,
		actionLabel: copy.actionBuildRun,
		actionId: "build-run",
		dataState: "running",
		toolName,
		locale,
		openable: false,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeRunning
			},
			children: copy.building
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: CARD_STYLES.loading,
			role: "status",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: CARD_STYLES.muted,
				children: copy.building
			})
		})
	});
	if (error) return androidCardChrome({
		title: copy.android,
		actionLabel: copy.actionBuildRun,
		actionId: "build-run",
		dataState: "error",
		toolName,
		locale,
		openable: false,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeError
			},
			children: copy.unavailable
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: CARD_STYLES.muted,
			children: text ?? copy.toolFailed
		})
	});
	if (buildMeta === void 0) return androidCardChrome({
		title: copy.android,
		actionLabel: copy.actionBuildRun,
		actionId: "build-run",
		dataState: "fallback",
		toolName,
		locale,
		openable: false,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeError
			},
			children: copy.unavailable
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: CARD_STYLES.muted,
			children: copy.noPreview
		}), text !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
			style: {
				...CARD_STYLES.pre,
				marginTop: 8
			},
			children: text
		}) : null] })
	});
	const hasMeta = buildMeta.packageName !== void 0 || buildMeta.apkPath !== void 0 && openFile !== void 0;
	return androidCardChrome({
		title: copy.android,
		actionLabel: copy.actionBuildRun,
		actionId: "build-run",
		deviceLabel: androidCardDeviceLabelOf(buildMeta.device),
		dataState: "live",
		toolName,
		locale,
		openable: true,
		metaSource,
		badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...CARD_STYLES.badge,
				...CARD_STYLES.badgeOk
			},
			children: copy.done
		}),
		children: hasMeta ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [buildMeta.packageName !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: CARD_STYLES.keyValue,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: CARD_STYLES.key,
				children: copy.packageName
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: CARD_STYLES.value,
				children: buildMeta.packageName
			})]
		}) : null, buildMeta.apkPath !== void 0 && openFile !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			style: CARD_STYLES.button,
			onClick: () => {
				openFile(buildMeta.apkPath ?? "");
			},
			children: copy.openApk
		}) }) : null] }) : void 0
	});
}
//#endregion
//#region src/client/android-stream-session.ts
/**
* The one live-stream/control engine behind the dsh-android panel.
*
* A hybrid of the two dsh-ios sessions, because Android needs exactly half of
* each: the GRANT lifecycle of the simulator stream session (generation
* numbering, one-shot auto re-grant, seeded grant + settle watchdog) with the
* REST control plane of the real-device session (coalesced pointer gestures
* POSTed to `/control`). There is NO WebSocket anywhere in this plugin.
*
* - `POST /grant {kind:'stream', device}` → `<img src={streamUrl}>`, the
*   in-process `multipart/x-mixed-replace` PNG stream. No `wsUrl` exists.
* - LIVENESS is the FRAME itself: the img's `load` event with
*   `naturalWidth > 0` is the only "the stream is up" signal there is (the
*   ws `open` event dsh-ios used has no counterpart). `onFrameLoad` is
*   therefore part of the session contract and the live-frame body calls it.
* - Pointer gestures are coalesced (see `androidGestureActionOf`): one tap or
*   one drag per gesture, POSTed to `/control` on pointer-up. Move events are
*   sampled on a ~50 ms trailing edge for the gesture bookkeeping only.
* - Buttons (◁ ○ □ and the hardware keys) and rotate are single POSTs too.
*
* Failure policy: an initial grant failure falls back with a retry; a stream
* that dies after a successful grant (img error — e.g. the ~10-minute token
* expiry) re-grants once automatically before falling back. Refresh re-grants,
* which restarts an idle device's frame loop server-side per `/grant`.
* Unmount drops the img src and reports offline.
*
* Device switch: a `seededGrant` (the switch-device response's fresh
* capability URL) is applied exactly once, on the grant cycle whose serial
* matches the seed, so the swap lands without a second round trip. Every
* later re-grant goes through `/grant` normally.
*/
/**
* Post-switch settle watchdog tuning: after a device switch seeds the stream,
* re-grant every 4 s while no frame has drawn, up to 10 attempts (~40 s —
* covers an emulator that is still coming up), then fall back with the retry
* affordance. Exported for the smoke's assertions.
*/
const ANDROID_SWITCH_SETTLE_INTERVAL_MS = 4e3;
const ANDROID_SWITCH_SETTLE_ATTEMPTS = 10;
/**
* The one live-stream engine the panel binds. Every field is derived state —
* no rendering lives here, so any surface can frame it however it likes.
*/
function useAndroidStream(options) {
	const { meta, fetcher, sessionId, unavailableCopy, onLiveChange, enabled = true, seededGrant, copy } = options;
	const serial = meta?.device?.serial;
	const [phase, setPhase] = (0, react.useState)("granting");
	const [grant, setGrant] = (0, react.useState)();
	const [failure, setFailure] = (0, react.useState)("");
	const [attempt, setAttempt] = (0, react.useState)(0);
	const [live, setLive] = (0, react.useState)(false);
	const [rotation, setRotation] = (0, react.useState)();
	const autoRetriedRef = (0, react.useRef)(false);
	const generationRef = (0, react.useRef)(0);
	const imgRef = (0, react.useRef)(null);
	const pointerRef = (0, react.useRef)();
	const liveRef = (0, react.useRef)(onLiveChange);
	liveRef.current = onLiveChange;
	const copyRef = (0, react.useRef)(copy ?? {});
	copyRef.current = copy ?? {};
	/** The seeded grant object already applied (one-shot consumption). */
	const consumedSeedRef = (0, react.useRef)();
	/** Post-switch settle budget. It must SURVIVE the re-grant cycles it
	* triggers: each re-grant re-runs the connect effect, whose cleanup clears
	* only the TIMER — the attempt budget lives here and is cleared when a
	* frame arrives, when the budget is exhausted, or when a switch reseeds. */
	const switchSettleRef = (0, react.useRef)();
	const settleTimerRef = (0, react.useRef)();
	const clearSettleTimer = (0, react.useCallback)(() => {
		if (settleTimerRef.current !== void 0) {
			clearInterval(settleTimerRef.current);
			settleTimerRef.current = void 0;
		}
	}, []);
	const reportLive = (0, react.useCallback)((next) => {
		setLive(next);
		liveRef.current?.(next);
		if (next && switchSettleRef.current !== void 0) {
			switchSettleRef.current = void 0;
			clearSettleTimer();
		}
	}, [clearSettleTimer]);
	/** One automatic re-grant, then the static fallback. */
	const autoReGrant = (0, react.useCallback)(() => {
		if (switchSettleRef.current !== void 0) return;
		if (autoRetriedRef.current) {
			setFailure(unavailableCopy);
			setPhase("fallback");
		} else {
			autoRetriedRef.current = true;
			setAttempt((current) => current + 1);
		}
	}, [unavailableCopy]);
	/** Arm the settle timer for the current connect cycle. No-ops unless a
	* switch budget is active. Each tick: a drawn frame → retire; budget left →
	* spend one attempt and re-grant (the effect re-run restarts this timer);
	* exhausted → explicit fallback so the user sees 重试 instead of a stale
	* black frame. */
	const startSettleTimer = (0, react.useCallback)(() => {
		if (switchSettleRef.current === void 0) return;
		clearSettleTimer();
		const tick = () => {
			const settle = switchSettleRef.current;
			if (settle === void 0) {
				clearSettleTimer();
				return;
			}
			const img = imgRef.current;
			if (img !== null && img.naturalWidth > 0) {
				switchSettleRef.current = void 0;
				clearSettleTimer();
				return;
			}
			if (settle.attemptsLeft > 0) {
				settle.attemptsLeft -= 1;
				autoRetriedRef.current = false;
				setAttempt((current) => current + 1);
			} else {
				switchSettleRef.current = void 0;
				clearSettleTimer();
				setFailure(unavailableCopy);
				setPhase("fallback");
			}
		};
		settleTimerRef.current = setInterval(tick, ANDROID_SWITCH_SETTLE_INTERVAL_MS);
	}, [clearSettleTimer, unavailableCopy]);
	/** Manual refresh: clear the auto-retry budget and re-grant. */
	const refresh = (0, react.useCallback)(() => {
		autoRetriedRef.current = false;
		setFailure("");
		setAttempt((current) => current + 1);
	}, []);
	/** A decoded frame is the ONE liveness signal this transport has. */
	const onFrameLoad = (0, react.useCallback)((naturalWidth) => {
		if (!(naturalWidth > 0)) return;
		autoRetriedRef.current = false;
		reportLive(true);
	}, [reportLive]);
	(0, react.useEffect)(() => {
		if (!enabled) return;
		const generation = generationRef.current + 1;
		generationRef.current = generation;
		let disposed = false;
		setPhase("granting");
		setGrant(void 0);
		setFailure("");
		reportLive(false);
		const cleanup = () => {
			disposed = true;
			generationRef.current += 1;
			imgRef.current?.removeAttribute("src");
			clearSettleTimer();
			reportLive(false);
		};
		const seed = seededGrant;
		if (seed !== void 0 && seed !== consumedSeedRef.current && seed.serial === serial) {
			consumedSeedRef.current = seed;
			switchSettleRef.current = { attemptsLeft: 10 };
			setGrant({ streamUrl: seed.streamUrl });
			setPhase("live");
			startSettleTimer();
			return cleanup;
		}
		requestStreamGrant(fetcher ?? fetch, {
			device: serial === void 0 ? {} : { serial },
			...sessionId === void 0 ? {} : { sessionId }
		}).then((result) => {
			if (disposed || generation !== generationRef.current) return;
			if (!result.ok) {
				setFailure(androidRouteErrorTextOf(result, copyRef.current));
				setPhase("fallback");
				return;
			}
			setGrant(result.grant);
			setPhase("live");
			startSettleTimer();
		});
		return cleanup;
	}, [
		attempt,
		serial,
		sessionId,
		enabled,
		fetcher,
		reportLive,
		seededGrant,
		startSettleTimer,
		clearSettleTimer
	]);
	/** One control POST; failures are non-fatal (the img error path re-grants). */
	const control = (0, react.useCallback)((action) => {
		if (serial === void 0 || serial === "") return;
		postAndroidControl(fetcher ?? fetch, serial, action, sessionId).then((result) => {
			if (result.ok && result.result.rotation !== void 0) setRotation(result.result.rotation);
		});
	}, [
		serial,
		sessionId,
		fetcher
	]);
	const sendButton = (0, react.useCallback)((name) => {
		control({
			kind: "button",
			name
		});
	}, [control]);
	const sendRotate = (0, react.useCallback)(() => {
		control({ kind: "rotate" });
	}, [control]);
	/**
	* One pointer event → normalized coordinates of the DISPLAYED box. No
	* orientation mapping: the streamed frame follows the display rotation and
	* `input tap` addresses that same space (see protocol.ts).
	*/
	const pointOf = (event) => {
		return normalizePointerPoint(event, event.currentTarget.getBoundingClientRect());
	};
	const onPointerDown = (event) => {
		const point = pointOf(event);
		pointerRef.current = {
			id: event.pointerId,
			start: point,
			latest: point,
			startAt: Date.now(),
			sampledAt: Date.now()
		};
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}
	};
	const onPointerMove = (event) => {
		const active = pointerRef.current;
		if (active === void 0 || active.id !== event.pointerId) return;
		const now = Date.now();
		if (now - active.sampledAt < 50) return;
		active.sampledAt = now;
		active.latest = pointOf(event);
	};
	const onPointerUp = (event) => {
		const active = pointerRef.current;
		if (active === void 0 || active.id !== event.pointerId) return;
		pointerRef.current = void 0;
		const final = pointOf(event);
		const end = Number.isFinite(final.x) && Number.isFinite(final.y) ? final : active.latest;
		control(androidGestureActionOf(active.start, end, Date.now() - active.startAt));
	};
	return {
		phase,
		streamUrl: grant?.streamUrl,
		failure,
		live,
		rotation,
		imgRef,
		refresh,
		retryOnce: autoReGrant,
		onFrameLoad,
		sendButton,
		sendRotate,
		onPointerDown,
		onPointerMove,
		onPointerUp
	};
}
//#endregion
//#region src/client/android-panel-size.ts
/**
* Device display size modes for the panel stage.
*
* The stream/screenshot display inside the panel's phone frame is sized by
* one of three modes, chosen with a compact dropdown in the panel header:
*
* - `fit`    (DEFAULT): the frame fills the panel's content width, so
*   dragging the panel's resize handle scales the device with it;
* - `percent`: 50% / 75% / 100% / 125% of the device's LOGICAL (dp) width;
* - `preset`: quick fixed sizes — S (240px), M (320px), L (420px). The preset
*   value is the device's SHORT-side display size, so a landscape frame
*   scales it by the frame's width/height ratio and the device keeps its
*   physical size across a rotation.
*
* NO ROTATION MATH LIVES HERE. An Android `screencap` frame already follows
* the display rotation (a landscape app streams 2400×1080), so the "displayed"
* box IS the natural frame box — `androidPanelFrameLayoutOf` is a plain
* fallback-aware read of `naturalWidth/naturalHeight`, and the dsh-ios
* `sim-orientation.ts` counter-rotation machinery has no counterpart.
*
* The device scale (px per dp) is DERIVED from the frame instead of being a
* constant: Android densities vary wildly (2.0 … 3.5+) where iOS simulators
* are always ~3×. It is taken off the frame's SHORT side (`min(w, h) / 412`)
* because that side is the device's portrait width in either orientation —
* using the raw width would report a 5.8× scale for a landscape frame.
*
* Everything here is pure (no DOM, no React state), so the dev-panel-smoke
* script exercises the mode transitions and the width computation directly.
*/
/** Reference logical width (dp) of a mainstream phone — the scale basis. */
const ANDROID_PANEL_FALLBACK_LOGICAL_WIDTH = 412;
/** Reference logical height (dp) for the frame's base 412×915 shape. */
const ANDROID_PANEL_FALLBACK_LOGICAL_HEIGHT = 915;
/** Density used until a frame reports its natural size (412dp → 1080px). */
const ANDROID_PANEL_DEVICE_SCALE_FALLBACK = 2.625;
/** Shared default (stable identity — the store and panels all use it). */
const ANDROID_PANEL_SIZE_MODE_FIT = { kind: "fit" };
/** The zoom percentages offered by the percent mode. */
const ANDROID_PANEL_PERCENT_OPTIONS = [
	50,
	75,
	100,
	125
];
/**
* The quick fixed widths of the preset mode. Each preset is the device's
* SHORT-side display size — the labels keep the raw px because the number
* refers to that short side, not the frame width in every orientation.
*/
const ANDROID_PANEL_PRESET_OPTIONS = [
	{
		id: "S",
		width: 240,
		labelEn: "S · 240px",
		labelZh: "S（240px）"
	},
	{
		id: "M",
		width: 320,
		labelEn: "M · 320px",
		labelZh: "M（320px）"
	},
	{
		id: "L",
		width: 420,
		labelEn: "L · 420px",
		labelZh: "L（420px）"
	}
];
/** The dropdown's option roster (fit first, then percent, then presets). */
const ANDROID_PANEL_SIZE_OPTIONS = [
	{
		id: "fit",
		mode: ANDROID_PANEL_SIZE_MODE_FIT,
		labelEn: "Fit to width",
		labelZh: "适应宽度"
	},
	...ANDROID_PANEL_PERCENT_OPTIONS.map((value) => ({
		id: `percent-${value}`,
		mode: {
			kind: "percent",
			value
		},
		labelEn: `${value}%`,
		labelZh: `${value}%`
	})),
	...ANDROID_PANEL_PRESET_OPTIONS.map((preset) => ({
		id: `preset-${preset.id}`,
		mode: {
			kind: "preset",
			width: preset.width
		},
		labelEn: preset.labelEn,
		labelZh: preset.labelZh
	}))
];
function positiveOr(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
function androidPanelFrameLayoutOf(naturalWidth, naturalHeight) {
	const displayW = positiveOr(naturalWidth, 412 * ANDROID_PANEL_DEVICE_SCALE_FALLBACK);
	return {
		displayW,
		displayH: positiveOr(naturalHeight, Math.round(displayW * 915 / 412))
	};
}
/**
* The device's pixel density derived from the frame's SHORT side (px per dp).
* Falls back to 2.625 while no natural size is known. Clamped to a sane
* 1…6 range so a garbage frame can never collapse the percent basis.
*/
function androidDeviceScaleOf(naturalWidth, naturalHeight) {
	if (naturalWidth === void 0 && naturalHeight === void 0) return ANDROID_PANEL_DEVICE_SCALE_FALLBACK;
	const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight);
	const scale = Math.min(layout.displayW, layout.displayH) / 412;
	if (!Number.isFinite(scale) || scale <= 0) return ANDROID_PANEL_DEVICE_SCALE_FALLBACK;
	return Math.min(6, Math.max(1, scale));
}
/**
* The device's logical (dp) width of the DISPLAYED frame — the percent-mode
* basis: displayW / density. A landscape frame therefore uses its landscape
* dp width (≈915dp for a 412×915 phone) as its 100%.
*/
function androidPanelDisplayLogicalWidthOf(naturalWidth, naturalHeight) {
	return androidPanelFrameLayoutOf(naturalWidth, naturalHeight).displayW / androidDeviceScaleOf(naturalWidth, naturalHeight);
}
/**
* Snaps a measured/computed CSS px value to a whole pixel (Math.round).
*
* The frame and screen boxes split their border/padding evenly between the
* left and right rims, so a FRACTIONAL width rounds differently at each
* device-pixel edge at 2× DPR — one side of the bezel ends up a physical
* pixel thicker. Round the width BEFORE deriving radius/box values (and
* before applying the fit-mode frame width itself) so both rims rasterize
* symmetrically; the ≤0.5px remainder then splits evenly under
* `margin: 0 auto`. Non-positive/garbage input snaps to 0.
*/
function androidPanelSnapPxOf(value) {
	return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}
/**
* The phone-frame CSS width one size mode applies: `100%` for fit (the
* panel's drag-resize therefore scales the device), `dpWidth × value%` for
* percent, and the aspect-aware preset width. Presets are SHORT-side sizes:
* a landscape frame (aspect > 1) scales the preset by the width/height ratio
* so the device keeps its physical size across a rotation.
*/
function androidPanelFrameWidthOf(mode, naturalWidth, naturalHeight) {
	switch (mode.kind) {
		case "fit": return "100%";
		case "percent": {
			const base = androidPanelDisplayLogicalWidthOf(naturalWidth, naturalHeight);
			return `${Math.round(base * mode.value / 100)}px`;
		}
		case "preset": {
			const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight);
			const aspect = layout.displayW / layout.displayH;
			return aspect > 1 ? `${androidPanelSnapPxOf(mode.width * aspect)}px` : `${mode.width}px`;
		}
	}
}
/** Stable option id for one size mode (the dropdown's `value`). */
function androidPanelSizeModeIdOf(mode) {
	switch (mode.kind) {
		case "fit": return "fit";
		case "percent": return `percent-${mode.value}`;
		case "preset": {
			const preset = ANDROID_PANEL_PRESET_OPTIONS.find((option) => option.width === mode.width);
			return preset !== void 0 ? `preset-${preset.id}` : `preset-${mode.width}`;
		}
	}
}
/** Defensive parse of a dropdown id; unknown ids fall back to fit. */
function androidPanelSizeModeOf(id) {
	return ANDROID_PANEL_SIZE_OPTIONS.find((candidate) => candidate.id === id)?.mode ?? ANDROID_PANEL_SIZE_MODE_FIT;
}
function androidPanelQuickLabel(id) {
	switch (id) {
		case "fit": return {
			en: "Fit",
			zh: "适应"
		};
		case "percent-100": return {
			en: "100%",
			zh: "100%"
		};
		case "preset-S": return {
			en: "S",
			zh: "S"
		};
		case "preset-M": return {
			en: "M",
			zh: "M"
		};
	}
	throw new RangeError(`dsh-android: unknown quick size option ${id}`);
}
/**
* The toolbar's one-tap quick sizes: the most-used modes promoted out of the
* dropdown as segmented buttons — [Fit/适应] [100%] [S] [M]. Each entry is
* derived from the DROPDOWN roster, so pressing a quick button dispatches the
* exact mode the dropdown selects and both stay in sync against the store's
* single `sizeMode` truth.
*/
const ANDROID_PANEL_QUICK_SIZE_OPTIONS = [
	"fit",
	"percent-100",
	"preset-S",
	"preset-M"
].map((id) => {
	const option = ANDROID_PANEL_SIZE_OPTIONS.find((candidate) => candidate.id === id);
	if (option === void 0) throw new RangeError(`dsh-android: quick size ${id} is missing from the dropdown roster`);
	const label = androidPanelQuickLabel(id);
	return {
		id,
		mode: option.mode,
		quickEn: label.en,
		quickZh: label.zh
	};
});
//#endregion
//#region src/client/android-live-frame.tsx
/**
* Pure presentation of the live frame over an explicit session snapshot.
* Exported for the static smoke: `phase: 'live' | 'fallback'` render without
* any network or browser surface.
*/
function AndroidLiveFrameBody({ meta, locale, session, naturalWidth, naturalHeight, onNaturalSize }) {
	const copy = androidCopy(locale);
	const serial = meta.device.serial;
	const { phase, streamUrl, failure, imgRef, refresh, retryOnce, onFrameLoad, onPointerDown, onPointerMove, onPointerUp } = session;
	const reportFrame = (event) => {
		const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
		onFrameLoad(width, height);
		onNaturalSize?.(width, height);
	};
	const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		"data-android-live-frame": "panel",
		"data-android-frame-state": phase,
		children: [
			phase === "granting" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: PANEL_LOADING_STYLES,
				role: "status",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: CARD_STYLES.muted,
					children: copy.connecting
				}), serial !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: CARD_STYLES.muted,
					children: serial
				}) : null]
			}) : null,
			phase === "live" && streamUrl !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: PANEL_STREAM_STAGE_STYLES,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						...PANEL_STREAM_BOX_STYLES,
						aspectRatio: `${layout.displayW} / ${layout.displayH}`
					},
					"data-android-live-pointer-box": "true",
					"data-android-display-width": layout.displayW,
					"data-android-display-height": layout.displayH,
					onPointerDown,
					onPointerMove,
					onPointerUp,
					onPointerCancel: onPointerUp,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
						ref: imgRef,
						src: streamUrl,
						alt: copy.streamAlt,
						draggable: false,
						style: PANEL_STREAM_IMG_STYLES,
						onLoad: reportFrame,
						onError: () => {
							retryOnce();
						}
					})
				})
			}) : null,
			phase === "fallback" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: PANEL_FALLBACK_STYLES,
				role: "alert",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
						style: CARD_STYLES.fallbackTitle,
						children: copy.streamUnavailable
					}),
					serial !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: CARD_STYLES.muted,
						children: serial
					}) : null,
					failure !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: CARD_STYLES.muted,
						children: failure
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: CARD_STYLES.primaryButton,
						onClick: refresh,
						children: copy.retry
					})
				]
			}) : null
		]
	});
}
/**
* Hook-connected live frame: grant → stream img with the panel's exact
* fallback/retry behavior. The panel binds the session itself (its toolbar
* needs the button/rotate/refresh handles), so this wrapper exists for
* standalone embeds and for the smoke's shared-engine identity assertion.
*/
function AndroidLiveFrame({ meta, fetcher, locale, onLiveChange, onNaturalSize }) {
	const session = useAndroidStream({
		meta,
		fetcher,
		unavailableCopy: androidCopy(locale).streamUnavailable,
		...onLiveChange === void 0 ? {} : { onLiveChange }
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidLiveFrameBody, {
		meta,
		locale,
		session,
		...onNaturalSize === void 0 ? {} : { onNaturalSize }
	});
}
Object.assign(AndroidLiveFrame, { sharedStreamHook: useAndroidStream });
//#endregion
//#region src/client/android-panel-capture.ts
/**
* The panel toolbar's 截图 (Screenshot) flow: POST `/_dsh/dsh-android/capture`
* (the host captures a FRESH PNG of the current streamed device and signs a
* relative screenshot URL), then `window.open(screenshotUrl, '_blank')` and a
* transient "已截图 / Captured" inline confirmation in the toolbar that
* auto-hides after ~2 s.
*
* The state machine lives in `createAndroidCaptureController` — a pure,
* timer-injectable controller the dev-panel-smoke script drives with fake
* timers and a mocked fetcher (no browser, no device). `useAndroidCapture`
* binds it to React for the panel; it performs no network during render
* (capture only ever runs from a click).
*/
/** How long the "captured" confirmation stays visible (~2 s). */
const ANDROID_CAPTURE_CONFIRM_MS = 2e3;
const DEFAULT_CAPTURE_TIMERS = {
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (handle) => clearTimeout(handle)
};
/**
* The pure capture state machine, bound to an options ref so the React hook
* can pass fresh fetcher/openWindow values without recreating the store.
*/
function createAndroidCaptureController(optionsRef) {
	let phase = "idle";
	let busy = false;
	let hideTimer;
	let disposed = false;
	const listeners = /* @__PURE__ */ new Set();
	const emit = () => {
		for (const listener of listeners) listener();
	};
	const setPhase = (next) => {
		if (phase === next) return;
		phase = next;
		emit();
	};
	const timersOf = () => optionsRef.current.timers ?? DEFAULT_CAPTURE_TIMERS;
	const clearHide = () => {
		if (hideTimer === void 0) return;
		timersOf().clearTimeout(hideTimer);
		hideTimer = void 0;
	};
	const openWindowOf = () => {
		const provided = optionsRef.current.openWindow;
		if (provided !== void 0) return provided;
		if (typeof window === "undefined") return void 0;
		return (url, target) => {
			window.open(url, target);
		};
	};
	return {
		getPhase: () => phase,
		async capture(device) {
			if (busy || disposed) return false;
			busy = true;
			setPhase("busy");
			const result = await requestAndroidCapture(optionsRef.current.fetcher ?? fetch, {
				device,
				sessionId: optionsRef.current.sessionId
			});
			busy = false;
			if (disposed) return false;
			if (!result.ok) {
				setPhase("idle");
				return false;
			}
			try {
				openWindowOf()?.(result.capture.screenshotUrl, "_blank");
			} catch {}
			setPhase("done");
			clearHide();
			hideTimer = timersOf().setTimeout(() => {
				hideTimer = void 0;
				if (!disposed) setPhase("idle");
			}, optionsRef.current.autoHideMs ?? 2e3);
			return true;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispose() {
			disposed = true;
			clearHide();
			listeners.clear();
		}
	};
}
/** React binding: capture on click → open minted URL + transient toast. */
function useAndroidCapture(options) {
	const optionsRef = (0, react.useRef)(options);
	optionsRef.current = options;
	const [controller] = (0, react.useState)(() => createAndroidCaptureController(optionsRef));
	const phase = (0, react.useSyncExternalStore)(controller.subscribe, controller.getPhase, controller.getPhase);
	(0, react.useEffect)(() => () => controller.dispose(), [controller]);
	return {
		phase,
		capture: (0, react.useCallback)((device) => {
			controller.capture(device);
		}, [controller])
	};
}
//#endregion
//#region src/client/android-select.tsx
/**
* DSH-styled dropdown for the device panel header, replacing the native
* `<select>`s (whose popup ignores the app theme). Modeled on dsh-crew's
* CustomSelect (trigger button + portal-mounted fixed menu that flips up near
* the viewport bottom, outside-click / Escape close, ✓ on the selected row)
* but restyled onto the `--dsw-alias-*` tokens and extended with the grouped
* options the device picker needs (kind groups with a heading icon, a
* disabled AVD hint group, ● markers).
*
* Split for the static smoke like the panel's other pieces:
* `AndroidSelectMenu` is pure presentation (SSR-able — `createPortal` renders
* nothing under `renderToString`, so the smoke renders the menu directly),
* `AndroidSelect` binds trigger + portal + dismissal behavior.
* @module @zseven-w/dsh-android/client/android-select
*/
/** The dot palette — literal state colors, exactly like the live indicator. */
const ANDROID_SELECT_MARKER_COLORS = {
	active: "#22c55e",
	idle: "#22c55e"
};
/** Token recipe shared by both dropdowns. Exported for the smoke. */
const ANDROID_SELECT_STYLES = {
	trigger: {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 6,
		minHeight: 22,
		padding: "1px 8px",
		borderRadius: 99,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "var(--dsw-alias-bg-layer-1)",
		color: "var(--dsw-alias-label-primary)",
		cursor: "pointer",
		font: "inherit",
		fontSize: 12,
		lineHeight: "16px",
		minWidth: 0,
		maxWidth: "100%",
		boxSizing: "border-box"
	},
	triggerLabel: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	triggerCaret: {
		flex: "none",
		display: "block",
		opacity: .6
	},
	menu: {
		position: "fixed",
		zIndex: 1e4,
		background: "var(--dsw-alias-bg-base)",
		color: "var(--dsw-alias-label-primary)",
		border: "1px solid var(--dsw-alias-border-l2)",
		borderRadius: 10,
		boxShadow: "0 8px 28px rgba(0, 0, 0, 0.28)",
		padding: 4,
		maxHeight: 280,
		overflowY: "auto",
		minWidth: 130
	},
	groupLabel: {
		display: "flex",
		alignItems: "center",
		gap: 5,
		padding: "5px 10px 3px",
		fontSize: 11,
		lineHeight: "14px",
		color: "var(--dsw-alias-label-secondary)",
		whiteSpace: "nowrap"
	},
	option: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		padding: "5px 10px",
		borderRadius: 6,
		cursor: "pointer",
		fontSize: 12,
		lineHeight: "16px",
		whiteSpace: "nowrap"
	},
	optionDisabled: {
		cursor: "default",
		color: "var(--dsw-alias-label-secondary)",
		opacity: .65
	},
	check: {
		flex: "none",
		opacity: .7,
		fontSize: 11
	},
	markerRow: {
		minWidth: 0,
		display: "flex",
		alignItems: "center",
		gap: 6,
		overflow: "hidden"
	},
	marker: {
		flex: "none",
		width: 8,
		height: 8,
		boxSizing: "border-box",
		borderRadius: "50%"
	}
};
/** The label cell: an optional state dot plus the (ellipsizing) text. */
function AndroidSelectLabel({ option }) {
	if (option.markerTone === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		style: ANDROID_SELECT_STYLES.triggerLabel,
		children: option.label
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		style: ANDROID_SELECT_STYLES.markerRow,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				...ANDROID_SELECT_STYLES.marker,
				...option.markerTone === "active" ? {
					background: ANDROID_SELECT_MARKER_COLORS.active,
					boxShadow: "0 0 6px rgba(34,197,94,0.75)"
				} : {
					background: "transparent",
					border: `1.5px solid ${ANDROID_SELECT_MARKER_COLORS.idle}`
				}
			},
			"aria-hidden": "true",
			"data-android-select-marker": option.markerTone
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: ANDROID_SELECT_STYLES.triggerLabel,
			children: option.label
		})]
	});
}
/** The selected/hover row fills (the light-theme layer ramp is invisible, so
* the semantic interactive tokens are the only fills that read in BOTH). */
const ANDROID_SELECT_ACTIVE_BG = "var(--dsw-alias-interactive-bg-active)";
const ANDROID_SELECT_HOVER_BG = "var(--dsw-alias-interactive-bg-hover)";
/** Pure menu rendering (listbox pattern); hover state is presentational. */
function AndroidSelectMenu({ groups, value, onPick, placement, ariaLabel }) {
	const [hovered, setHovered] = (0, react.useState)("");
	const placementStyle = placement === void 0 ? {} : {
		left: placement.left,
		minWidth: placement.minWidth,
		...placement.bottom !== void 0 ? { bottom: placement.bottom } : { top: placement.top }
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		style: {
			...ANDROID_SELECT_STYLES.menu,
			...placementStyle
		},
		role: "listbox",
		"aria-label": ariaLabel,
		"data-android-select-menu": "true",
		onMouseDown: (event) => {
			event.stopPropagation();
		},
		children: groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			role: "group",
			"aria-label": group.label,
			...group.dataAttrs,
			children: [group.label !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: ANDROID_SELECT_STYLES.groupLabel,
				"data-android-select-group-label": "true",
				children: [group.icon, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: group.label })]
			}) : null, group.options.map((option) => {
				const disabled = group.disabled === true || option.disabled === true;
				const selected = option.value === value;
				const background = selected ? ANDROID_SELECT_ACTIVE_BG : !disabled && hovered === option.value ? ANDROID_SELECT_HOVER_BG : "transparent";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					role: "option",
					"aria-selected": selected,
					"aria-disabled": disabled || void 0,
					"aria-label": option.ariaLabel,
					title: option.title,
					style: {
						...ANDROID_SELECT_STYLES.option,
						...disabled ? ANDROID_SELECT_STYLES.optionDisabled : void 0,
						background
					},
					"data-android-select-option": option.value,
					...option.dataAttrs,
					onClick: disabled ? void 0 : () => {
						onPick(option.value);
					},
					onMouseEnter: disabled ? void 0 : () => {
						setHovered(option.value);
					},
					onMouseLeave: disabled ? void 0 : () => {
						setHovered("");
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidSelectLabel, { option }), selected ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: ANDROID_SELECT_STYLES.check,
						"aria-hidden": "true",
						children: "✓"
					}) : null]
				}, option.value === "" ? `${group.id}:${option.label}` : option.value);
			})]
		}, group.id))
	});
}
function AndroidSelect({ value, groups, onChange, ariaLabel, disabled = false, onOpen, triggerStyle, dataAttrs }) {
	const [placement, setPlacement] = (0, react.useState)(null);
	(0, react.useEffect)(() => {
		if (placement === null) return;
		const close = () => {
			setPlacement(null);
		};
		const onKey = (event) => {
			if (event.key === "Escape") close();
		};
		const timer = setTimeout(() => {
			document.addEventListener("mousedown", close);
		}, 0);
		document.addEventListener("keydown", onKey);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("mousedown", close);
			document.removeEventListener("keydown", onKey);
		};
	}, [placement]);
	const open = (0, react.useCallback)((trigger) => {
		const rect = trigger.getBoundingClientRect();
		const up = window.innerHeight - rect.bottom < 300;
		setPlacement({
			left: rect.left,
			minWidth: Math.max(rect.width, 130),
			...up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }
		});
		onOpen?.();
	}, [onOpen]);
	const current = groups.flatMap((group) => group.options).find((option) => option.value === value);
	const pick = (0, react.useCallback)((picked) => {
		setPlacement(null);
		if (picked !== value) onChange(picked);
	}, [onChange, value]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
		type: "button",
		style: {
			...ANDROID_SELECT_STYLES.trigger,
			...triggerStyle
		},
		disabled,
		"aria-label": ariaLabel,
		title: ariaLabel,
		"aria-haspopup": "listbox",
		"aria-expanded": placement !== null,
		"data-android-select-trigger": "true",
		...dataAttrs,
		onClick: (event) => {
			if (placement !== null) setPlacement(null);
			else open(event.currentTarget);
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidSelectLabel, { option: current ?? { label: value } }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
			style: ANDROID_SELECT_STYLES.triggerCaret,
			width: "12",
			height: "12",
			viewBox: "0 0 16 16",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: "1.6",
			strokeLinecap: "round",
			strokeLinejoin: "round",
			"aria-hidden": "true",
			"data-android-select-caret": "true",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 6.5 L8 10.5 L12 6.5" })
		})]
	}), placement !== null && typeof document !== "undefined" ? (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidSelectMenu, {
		groups,
		value,
		onPick: pick,
		placement,
		ariaLabel
	}), document.body) : null] });
}
//#endregion
//#region src/client/android-device-picker.tsx
/**
* Compact token-styled device picker for the panel header.
*
* Replaces the static device-name subtitle: the picker shows the CURRENT
* streamed device and, when opened, lists what `POST /_dsh/dsh-android/devices`
* reports. That is ONE array — adb does not distinguish emulators from phones
* and neither does the stream path — so the picker groups it by `kind`
* (emulator / physical) purely for readability, each group headed by its own
* glyph. The list is fetched on every open (focus precedes open) — no polling.
*
* AVDs are listed too, but as an UNCLICKABLE hint group: an AVD is not a
* device until it boots (minutes), and booting belongs to the `android_boot`
* tool, so each row reads "<avd> · start it with android_boot" and refuses
* the click. This is the deliberate asymmetry with dsh-ios, where picking a
* shut-down simulator could boot it in seconds.
*
* Picking another device POSTs `/switch-device` (`{device: serial}`); while
* the request is in flight AND until the new stream (seeded from the returned
* capability URL) draws its first frame, the picker shows the transitional
* 切换中… / Switching… state. A failed switch shows the error inline and the
* selection reverts automatically (the panel meta never changed).
*
* Split like the other panel pieces for the static smoke:
* `AndroidDevicePickerBody` is pure presentation (SSR-able with explicit
* device lists and switching/error states), `AndroidDevicePicker` binds it to
* the list-fetch-on-open behavior, and `createAndroidDeviceSwitchController`
* is a pure, fetcher-injectable state machine.
* @module @zseven-w/dsh-android/client/android-device-picker
*/
/** Picker chrome over the DSH theme tokens. Exported for the smoke. */
const ANDROID_DEVICE_PICKER_STYLES = {
	root: {
		minWidth: 120,
		flex: "1 1 140px",
		display: "flex",
		alignItems: "center",
		gap: 6
	},
	/** Width/flex tuning merged onto the shared AndroidSelect trigger recipe. */
	trigger: {
		maxWidth: 220,
		minWidth: 100,
		flex: 1
	},
	switching: {
		flex: "none",
		display: "inline-flex",
		alignItems: "center",
		gap: 4,
		fontSize: 12,
		lineHeight: "16px",
		color: "var(--dsw-alias-label-secondary)",
		whiteSpace: "nowrap"
	},
	spinner: {
		flex: "none",
		width: 11,
		height: 11,
		display: "inline-block",
		boxSizing: "border-box",
		borderRadius: "50%",
		border: "2px solid var(--dsw-alias-border-l2)",
		borderTopColor: "var(--dsw-alias-label-primary)",
		animation: "dsh-android-switch-spin 0.9s linear infinite"
	},
	error: {
		flex: "none",
		maxWidth: 180,
		fontSize: 12,
		lineHeight: "16px",
		color: "var(--dsw-alias-label-secondary)",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	groupIcon: {
		flex: "none",
		display: "block",
		opacity: .7
	}
};
/** The plugin-owned spinner keyframes (injected once by the panel host). */
const ANDROID_DEVICE_PICKER_KEYFRAMES = "@keyframes dsh-android-switch-spin{to{transform:rotate(360deg)}}";
/** Group-heading glyphs: a desktop monitor for emulators, a phone for real
* hardware, a disc for the not-yet-booted AVD images. */
const ANDROID_DEVICE_KIND_ICON_PATHS = {
	emulator: ["M1.75 2.75 H12.25 V9.75 H1.75 Z", "M5 12.25 H9"],
	physical: ["M4.25 1.75 H9.75 V12.25 H4.25 Z", "M6.5 10.4 H7.5"],
	avd: ["M7 2.5a4.5 4.5 0 1 0 .01 0", "M7 6a1 1 0 1 0 .01 0"]
};
/** One inline group glyph (14px, currentColor — the heading's token color). */
function AndroidDeviceKindIcon({ kind }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
		width: 12,
		height: 12,
		viewBox: "0 0 14 14",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.2,
		strokeLinecap: "round",
		strokeLinejoin: "round",
		style: ANDROID_DEVICE_PICKER_STYLES.groupIcon,
		"aria-hidden": "true",
		focusable: false,
		"data-android-device-kind-icon": kind,
		children: ANDROID_DEVICE_KIND_ICON_PATHS[kind].map((d, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d }, index))
	});
}
/** The human label of one device row: the model, falling back to the serial. */
function androidDeviceLabelOf(device) {
	return device.model !== void 0 && device.model !== "" ? device.model : device.serial;
}
/**
* Group the listing by device kind, preserving the host's order inside each
* group (online first, then serial — the client never re-sorts). When the
* current device is missing from the listing (stale list, fetch failure,
* fresh switch) it is injected so the select's value always has a matching
* option and the picker keeps showing the device.
*/
function androidDeviceGroupsOf(devices, current) {
	const byKind = /* @__PURE__ */ new Map();
	for (const device of devices) {
		const list = byKind.get(device.kind);
		if (list === void 0) byKind.set(device.kind, [device]);
		else list.push(device);
	}
	const serial = current?.serial;
	if (typeof serial === "string" && serial !== "" && !devices.some((device) => device.serial === serial)) {
		const kind = serial.startsWith("emulator-") ? "emulator" : "physical";
		const entry = {
			serial,
			state: typeof current?.state === "string" && current.state !== "" ? current.state : "device",
			kind,
			...typeof current?.name === "string" && current.name !== "" ? { model: current.name } : {}
		};
		const list = byKind.get(kind);
		if (list === void 0) byKind.set(kind, [entry]);
		else list.unshift(entry);
	}
	const groups = [];
	for (const kind of ["emulator", "physical"]) {
		const list = byKind.get(kind);
		if (list !== void 0 && list.length > 0) groups.push({
			kind,
			devices: list
		});
	}
	return groups;
}
/**
* Build the AndroidSelect groups: one group per device kind (with its glyph,
* the streamed device marked ● and the other online ones with a hollow ring)
* plus the DISABLED AVD hint group at the bottom. Exported so the smoke can
* render `AndroidSelectMenu` with the exact groups.
*/
function androidDeviceSelectGroupsOf(devices, avds, currentDevice, locale) {
	const copy = androidCopy(locale);
	const groups = androidDeviceGroupsOf(devices, currentDevice).map((group) => ({
		id: `kind-${group.kind}`,
		label: group.kind === "emulator" ? copy.deviceEmulators : copy.devicePhysical,
		icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidDeviceKindIcon, { kind: group.kind }),
		dataAttrs: { "data-android-device-kind-group": group.kind },
		options: group.devices.map((device) => {
			const online = androidDeviceOnline(device);
			const streaming = device.serial === currentDevice?.serial;
			const markerTone = streaming ? "active" : online ? "idle" : void 0;
			const state = streaming ? copy.deviceStreaming : online ? copy.deviceOnline : device.state;
			const label = androidDeviceLabelOf(device);
			return {
				value: device.serial,
				label,
				...markerTone === void 0 ? {} : { markerTone },
				disabled: !online,
				ariaLabel: `${label}, ${state}`,
				title: `${label} · ${device.serial} · ${state}`,
				dataAttrs: {
					"data-android-device-serial": device.serial,
					"data-android-device-online": online ? "true" : "false",
					"data-android-device-streaming": streaming ? "true" : "false"
				}
			};
		})
	}));
	if (groups.length === 0) groups.push({
		id: "devices-empty",
		disabled: true,
		dataAttrs: { "data-android-devices-empty": "true" },
		options: [{
			value: "",
			label: copy.deviceNone,
			disabled: true
		}]
	});
	if (avds.length > 0) groups.push({
		id: "avds",
		label: copy.deviceAvds,
		icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidDeviceKindIcon, { kind: "avd" }),
		disabled: true,
		dataAttrs: { "data-android-avds-group": "true" },
		options: avds.map((avd) => ({
			value: "",
			label: `${avd} · ${copy.deviceAvdHint}`,
			disabled: true,
			title: `${avd} · ${copy.deviceAvdHint}`,
			dataAttrs: { "data-android-avd": avd }
		}))
	});
	return groups;
}
/**
* Pure picker presentation: the token-styled select with one group per device
* kind, the inert AVD hint group, the transitional 切换中… readout and the
* inline switch error. SSR-safe — no effects, no fetch.
*/
function AndroidDevicePickerBody({ devices, avds = [], currentDevice, switching, error, locale, onSelect, onOpen }) {
	const copy = androidCopy(locale);
	const currentSerial = typeof currentDevice?.serial === "string" ? currentDevice.serial : "";
	const selectGroups = androidDeviceSelectGroupsOf(devices, avds, currentDevice, locale);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: ANDROID_DEVICE_PICKER_STYLES.root,
		"data-android-device-picker": "true",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidSelect, {
				value: currentSerial,
				groups: selectGroups,
				onChange: onSelect,
				onOpen,
				disabled: switching,
				ariaLabel: copy.devicePicker,
				triggerStyle: ANDROID_DEVICE_PICKER_STYLES.trigger,
				dataAttrs: {
					"data-android-device-picker-select": "true",
					"data-android-device-current": currentSerial,
					"data-android-device-switching": switching ? "true" : "false"
				}
			}),
			switching ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: ANDROID_DEVICE_PICKER_STYLES.switching,
				role: "status",
				"data-android-device-switching-state": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: ANDROID_DEVICE_PICKER_STYLES.spinner,
					"aria-hidden": "true",
					"data-android-device-spinner": "true"
				}), copy.deviceSwitching]
			}) : null,
			!switching && error !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: ANDROID_DEVICE_PICKER_STYLES.error,
				role: "alert",
				"data-android-device-error": "true",
				children: `${copy.switchFailed}: ${error}`
			}) : null
		]
	});
}
/**
* Connected picker: refreshes the device list from the host on every open
* (focus precedes open — no polling, no fetch during render/SSR). A failed
* listing keeps the previous/current-device-only state and is retried on the
* next open.
*/
function AndroidDevicePicker({ fetcher, sessionId, currentDevice, switching, error, locale, onSelect }) {
	const [devices, setDevices] = (0, react.useState)([]);
	const [avds, setAvds] = (0, react.useState)([]);
	const inflightRef = (0, react.useRef)(false);
	const fetcherRef = (0, react.useRef)(fetcher);
	fetcherRef.current = fetcher;
	const onOpen = (0, react.useCallback)(() => {
		if (inflightRef.current) return;
		inflightRef.current = true;
		requestAndroidDevices(fetcherRef.current ?? fetch, sessionId).then((listing) => {
			inflightRef.current = false;
			setDevices(listing.devices);
			setAvds(listing.avds);
		});
	}, [sessionId]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidDevicePickerBody, {
		devices,
		avds,
		currentDevice,
		switching,
		error,
		locale,
		onSelect,
		onOpen
	});
}
/** Synthetic stream meta for the switched device — the meta the panel adopts
* after a switch (the same capsule-style synthetic source
* `androidSwitchedPanelRequestOf` wraps for the store/registry). */
function androidSwitchedStreamMetaOf(result) {
	return {
		kind: "android-stream",
		device: {
			serial: result.device,
			...typeof result.deviceName === "string" && result.deviceName !== "" ? { name: result.deviceName } : {}
		}
	};
}
/**
* The pure device-switch state machine: POSTs `/switch-device` `{device}`,
* guards against concurrent switches, and reports the parsed result or the
* failure. The dev-panel-smoke script drives it with a mocked fetcher; the
* panel binds it to its seeded-grant flow.
*/
function createAndroidDeviceSwitchController(options) {
	const fetcher = options.fetcher ?? fetch;
	let inflight = false;
	let disposed = false;
	return {
		switchTo(serial) {
			if (disposed || inflight || serial === "") return false;
			inflight = true;
			options.onSwitchingChange?.(true);
			requestSwitchDevice(fetcher, serial, options.sessionId).then((result) => {
				inflight = false;
				if (disposed) return;
				if (result.ok) options.onSwitched(result.switched);
				else {
					options.onError(androidRouteErrorTextOf(result, options.copy ?? {}));
					options.onSwitchingChange?.(false);
				}
			});
			return true;
		},
		dispose() {
			disposed = true;
		}
	};
}
//#endregion
//#region src/client/android-frame-style.ts
/** Shared default (stable identity — the store and panels all use it). */
const ANDROID_FRAME_STYLE_BEZEL = "bezel";
/** The control's option roster (无框 / 边框 / 手机框 order). */
const ANDROID_FRAME_STYLE_OPTIONS = [
	"none",
	"bezel",
	"device"
];
/** Defensive parse of a frame-style id; unknown ids fall back to bezel. */
function androidFrameStyleOf(id) {
	return ANDROID_FRAME_STYLE_OPTIONS.find((candidate) => candidate === id) ?? "bezel";
}
/** User-facing label for one frame style (copy lives in copy.ts). */
function androidFrameStyleLabelOf(style, copy) {
	switch (style) {
		case "none": return copy.frameStyleNone;
		case "bezel": return copy.frameStyleBezel;
		case "device": return copy.frameStyleDevice;
	}
}
/** Slim bezel shell thickness on every side. */
const ANDROID_FRAME_BEZEL_SHELL = 6;
/** Device shell thickness on every side. */
const ANDROID_FRAME_DEVICE_SHELL = 16;
/**
* Shell border thickness per side for the bordered modes (bezel + device);
* frameless has none. The border is part of the rim, so the screen-width
* derivation subtracts it together with the padding.
*/
const ANDROID_FRAME_SHELL_BORDER_PX = 1;
/**
* The Android display-corner ratio: ≈30dp on a 412dp-wide screen (≈7.3% of
* the displayed logical width — noticeably flatter than an iPhone's). The
* panel's screen radius is proportional to the DISPLAYED screen box, so it
* scales with the panel's drag-resize and every size mode.
*/
const ANDROID_FRAME_SCREEN_RADIUS_RATIO = 30 / 412;
/**
* The radius the SSR/first render uses before the frame is measured: the
* 412dp fallback display's rounded corner (412 × 30/412 = 30). Only the fit
* mode needs it (its 100% width is unknown without the DOM);
* percent/preset renders derive their radius exactly from props.
*/
const ANDROID_FRAME_RADIUS_FALLBACK_PX = 30;
/** Shell padding per mode: none → 0, bezel → 6, device → 16. */
function androidPanelShellPadOf(style) {
	switch (style) {
		case "none": return 0;
		case "device": return 16;
		default: return 6;
	}
}
/** Shell border thickness per mode: none → 0, bezel → 1, device → 1. */
function androidPanelFrameBorderPxOf(style) {
	return style === "none" ? 0 : 1;
}
/**
* The shell's total per-side inset (padding + border) — the distance from the
* frame's border-box edge to the screen box on every side: none → 0,
* bezel → 7, device → 17.
*/
function androidPanelFrameInsetOf(style) {
	return androidPanelShellPadOf(style) + androidPanelFrameBorderPxOf(style);
}
/**
* The rendered screen width for a frame whose border-box width is known (CSS
* px): frame width − 2×(padding + border) per mode, snapped to a whole px
* BEFORE the subtraction (both operands stay on the device-pixel grid). THE
* single source of truth for every screen-width derivation, so the visible
* screen box and its corner radius can never drift apart.
*/
function androidPanelScreenWidthOf(frameWidthCss, frameStyle) {
	return androidPanelSnapPxOf(frameWidthCss) - 2 * androidPanelFrameInsetOf(frameStyle);
}
function radiusSideOf(value) {
	return Number.isFinite(value) && value > 0 ? value : 0;
}
/**
* The screen's corner radius for a known displayed screen box (CSS px,
* rounded to 0.1): the device's physical corner follows the SHORT side —
* radius = min(displayedW, displayedH) × 30/412. 412 → 30; 240 → 17.5.
*/
function androidPanelScreenRadiusOf(displayedW, displayedH) {
	const side = Math.min(radiusSideOf(displayedW), radiusSideOf(displayedH));
	return Math.round(side * ANDROID_FRAME_SCREEN_RADIUS_RATIO * 10) / 10;
}
/**
* Concentric shell outer radius: screen radius + shell pad (none → +0, so the
* frameless "shell" radius IS the screen's clip radius).
*/
function androidPanelShellRadiusOf(style, screenRadius) {
	return Math.round((radiusSideOf(screenRadius) + androidPanelShellPadOf(style)) * 10) / 10;
}
/**
* The displayed screen box for the deterministic size modes (percent and
* preset give exact px widths): frame width − 2×(shell padding + border)
* wide, with the frame's aspect. Returns undefined for fit, whose 100% width
* only the DOM knows — AndroidPhoneFrame measures it via a ResizeObserver.
*/
function androidPanelScreenBoxOf(mode, naturalWidth, naturalHeight, frameStyle) {
	const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight);
	const widthCss = androidPanelFrameWidthOf(mode, naturalWidth, naturalHeight);
	if (widthCss === "100%") return void 0;
	const width = androidPanelScreenWidthOf(Number.parseFloat(widthCss), frameStyle);
	if (!Number.isFinite(width) || width <= 0) return void 0;
	return {
		width,
		height: width * layout.displayH / layout.displayW
	};
}
/**
* The measured-radius fallback: the device's natural display corner at
* logical scale (displayW/scale × displayH/scale → min side × ratio).
*/
function androidPanelFrameRadiusFallbackOf(naturalWidth, naturalHeight) {
	const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight);
	const scale = androidDeviceScaleOf(naturalWidth, naturalHeight);
	return androidPanelScreenRadiusOf(layout.displayW / scale, layout.displayH / scale);
}
//#endregion
//#region src/client/android-screenshot-session.ts
/**
* Shared screenshot grant session for the dsh-android surfaces.
*
* POST `/_dsh/dsh-android/grant` `{kind:'screenshot', path}` → render the
* minted origin-relative PNG. Same failure policy as the stream session:
* an initial grant failure falls back with a retry; an img error after a
* successful grant re-grants once automatically before falling back. Unmount
* drops the img src.
*/
/** Grant → PNG session shared by the screenshot card and the panel. */
function useAndroidScreenshot(options) {
	const { meta, fetcher, unavailableCopy } = options;
	const [phase, setPhase] = (0, react.useState)("granting");
	const [grant, setGrant] = (0, react.useState)();
	const [failure, setFailure] = (0, react.useState)("");
	const [attempt, setAttempt] = (0, react.useState)(0);
	const autoRetriedRef = (0, react.useRef)(false);
	const generationRef = (0, react.useRef)(0);
	const imgRef = (0, react.useRef)(null);
	const autoReGrant = (0, react.useCallback)(() => {
		if (autoRetriedRef.current) {
			setFailure(unavailableCopy);
			setPhase("fallback");
		} else {
			autoRetriedRef.current = true;
			setAttempt((current) => current + 1);
		}
	}, [unavailableCopy]);
	const refresh = (0, react.useCallback)(() => {
		autoRetriedRef.current = false;
		setFailure("");
		setAttempt((current) => current + 1);
	}, []);
	(0, react.useEffect)(() => {
		const generation = generationRef.current + 1;
		generationRef.current = generation;
		let disposed = false;
		setPhase("granting");
		setGrant(void 0);
		setFailure("");
		requestScreenshotGrant(fetcher ?? fetch, meta.path).then((result) => {
			if (disposed || generation !== generationRef.current) return;
			if (!result.ok) {
				setFailure(result.error);
				setPhase("fallback");
				return;
			}
			setGrant(result.grant);
			setPhase("live");
		});
		return () => {
			disposed = true;
			generationRef.current += 1;
			imgRef.current?.removeAttribute("src");
		};
	}, [
		attempt,
		meta.path,
		autoReGrant,
		fetcher
	]);
	return {
		phase,
		screenshotUrl: grant?.screenshotUrl,
		failure,
		imgRef,
		refresh,
		retryOnce: autoReGrant
	};
}
//#endregion
//#region src/client/android-panel-frame.tsx
/**
* The panel's phone frame: the shell around the device screen, in the three
* user-selectable frame styles (frameless / bezel / phone frame).
*
* Sized by the active `sizeMode`: fit fills the stage width (so the panel's
* drag-resize scales the device), percent/preset use the computed pixel width
* from `androidPanelFrameWidthOf`. The width, aspect ratio, stream fill and
* pointer mapping are IDENTICAL across all three styles — only the shell
* around the screen changes.
*
* Corner radii follow the Android display proportion (30/412 of the displayed
* screen's short side). Percent/preset widths are deterministic px values, so
* their radius derives from props exactly on every render (SSR included);
* fit mode's `100%` is only known to the DOM, so a mount-time measure plus a
* ResizeObserver keeps two things live: (a) the measured screen radius, and
* (b) the fit frame's SNAPPED integer width — a fractional border-box would
* round differently at each device-pixel edge at 2× DPR and one bezel rim
* would gain a physical pixel. Radius updates are style-only: the children
* (stream/screenshot img) are never remounted, so the stream never
* reconnects on resize.
*/
/**
* The phone bezel — the one deliberately dark device surface (a bezel is a
* device frame, not a panel surround), exported so the smoke can allow-list
* it. The screen inside stays black: it is the device display. The outer
* corner radius is applied per render (screen radius + the 6px rim) so the
* inset screen stays concentric at every displayed size. The 1px border is
* part of the rim: the screen-width derivation subtracts it together with the
* padding, so left/right rims measure pad+border.
*/
const PHONE_BEZEL_STYLES = {
	width: "100%",
	maxWidth: 300,
	margin: "0 auto",
	boxSizing: "border-box",
	padding: 6,
	background: "#0b0b0e",
	border: `1px solid rgba(255,255,255,0.08)`,
	boxShadow: "0 18px 50px rgba(0,0,0,0.5)"
};
/**
* Frameless mode (无框): no shell at all. The wrapper is a bare sizing
* element ONLY — no padding, no background, no border, no shadow, no clip:
* the screen div below IS the content box and carries the proportional corner
* clip directly, so no black layer can ever peek out around the stream.
*/
const FRAMELESS_FRAME_STYLES = {
	width: "100%",
	maxWidth: 300,
	margin: "0 auto",
	boxSizing: "border-box",
	padding: 0
};
/**
* Phone frame mode (手机框): a realistic CSS-only device shell — a thicker
* 16px shell with a subtle dark metallic gradient, a 1px lighter inner edge
* highlight where the shell meets the screen, and the slim bezel's soft drop
* shadow. The outer corner radius is applied per render (screen radius + the
* 16px shell), and the side-button nubs anchor to this wrapper.
*/
const DEVICE_FRAME_STYLES = {
	width: "100%",
	maxWidth: 300,
	margin: "0 auto",
	boxSizing: "border-box",
	position: "relative",
	padding: 16,
	background: "linear-gradient(145deg, #2b2e35 0%, #101116 45%, #1c1e25 100%)",
	border: `1px solid rgba(0,0,0,0.6)`,
	boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12), 0 18px 50px rgba(0,0,0,0.55)"
};
/** One side-button nub shared by all buttons (the shell's lighter metallic
* mid-tone, like a real frame's hardware accents). */
const DEVICE_SIDE_BUTTON_BASE = {
	position: "absolute",
	width: 3,
	borderRadius: 2,
	background: "#3a3d44",
	boxShadow: "0 1px 2px rgba(0,0,0,0.5)"
};
/**
* The phone frame's side-button nubs, positioned proportionally along the
* frame's height. Android hardware overwhelmingly puts the volume rocker
* ABOVE the power key on the RIGHT edge, so that is what is drawn. Buttons
* render only in portrait: in landscape the wide frame's edges correspond to
* the device's top/bottom and rotating the nubs would need a second
* coordinate system for a purely decorative detail.
*/
const DEVICE_SIDE_BUTTONS = [
	{
		id: "volume-up",
		side: "right",
		style: {
			...DEVICE_SIDE_BUTTON_BASE,
			right: -2,
			top: "22%",
			height: 30
		}
	},
	{
		id: "volume-down",
		side: "right",
		style: {
			...DEVICE_SIDE_BUTTON_BASE,
			right: -2,
			top: "32%",
			height: 30
		}
	},
	{
		id: "power",
		side: "right",
		style: {
			...DEVICE_SIDE_BUTTON_BASE,
			right: -2,
			top: "45%",
			height: 46
		}
	}
];
/**
* The frame with one size mode applied: the width comes from the pure
* `androidPanelFrameWidthOf` helper and the base max-width clamp is removed
* so fit/percent/preset widths are exact (overflow scrolls the panel stage).
* `frameStyle` picks the shell; `screenRadius` drives its outer radius.
*
* Fit mode resolves `100%` against the stage's content box, which can be
* FRACTIONAL after a panel drag-resize. `measuredFitWidth` (snapped to a
* whole CSS px by AndroidPhoneFrame's ResizeObserver) replaces the `100%`
* once measured, so the frame's border-box lands on the device-pixel grid and
* its rims rasterize symmetrically; the ≤0.5px remainder splits evenly under
* `margin: 0 auto`.
*/
function androidPanelFrameStyles(mode, naturalWidth, naturalHeight, frameStyle = ANDROID_FRAME_STYLE_BEZEL, screenRadius = 30, measuredFitWidth) {
	return {
		...frameStyle === "none" ? FRAMELESS_FRAME_STYLES : frameStyle === "device" ? {
			...DEVICE_FRAME_STYLES,
			borderRadius: androidPanelShellRadiusOf(frameStyle, screenRadius)
		} : {
			...PHONE_BEZEL_STYLES,
			borderRadius: androidPanelShellRadiusOf(frameStyle, screenRadius)
		},
		width: mode.kind === "fit" && measuredFitWidth !== void 0 && measuredFitWidth > 0 ? `${measuredFitWidth}px` : androidPanelFrameWidthOf(mode, naturalWidth, naturalHeight),
		maxWidth: "none"
	};
}
const PHONE_SCREEN_STYLES = {
	position: "relative",
	boxSizing: "border-box",
	width: "100%",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	background: "#000",
	border: "1px solid rgba(255,255,255,0.06)"
};
/**
* The inset screen for one frame style. Bezel and phone-frame keep the
* classic screen (black device display, hairline edge highlight, proportional
* radius concentric with the shell's outer radius). Frameless has NO black
* layers at all: the background goes transparent and the border drops, so the
* screen IS the bare content box and its radius IS the only rounding.
*/
function androidPhoneScreenStyles(frameStyle, screenRadius) {
	return frameStyle === "none" ? {
		...PHONE_SCREEN_STYLES,
		background: "transparent",
		border: "none",
		borderRadius: screenRadius
	} : {
		...PHONE_SCREEN_STYLES,
		borderRadius: screenRadius
	};
}
/** Minimal CSS phone frame: shell + inset screen, sized by the active mode. */
function AndroidPhoneFrame({ children, sizeMode = ANDROID_PANEL_SIZE_MODE_FIT, naturalWidth, naturalHeight, frameStyle = ANDROID_FRAME_STYLE_BEZEL }) {
	const layout = androidPanelFrameLayoutOf(naturalWidth, naturalHeight);
	const width = androidPanelFrameWidthOf(sizeMode, naturalWidth, naturalHeight);
	const landscape = layout.displayW > layout.displayH;
	const frameRef = (0, react.useRef)(null);
	const [fitWidth, setFitWidth] = (0, react.useState)();
	const [measuredRadius, setMeasuredRadius] = (0, react.useState)(() => androidPanelFrameRadiusFallbackOf(naturalWidth, naturalHeight));
	(0, react.useEffect)(() => {
		const node = frameRef.current;
		if (node === null) return;
		const stage = node.parentElement;
		const measure = () => {
			const rect = node.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) setMeasuredRadius(androidPanelScreenRadiusOf(androidPanelScreenWidthOf(rect.width, frameStyle), androidPanelScreenWidthOf(rect.height, frameStyle)));
			if (stage !== null) {
				const stageComputed = getComputedStyle(stage);
				const stagePadX = Number.parseFloat(stageComputed.paddingLeft) + Number.parseFloat(stageComputed.paddingRight);
				const stageBorderX = Number.parseFloat(stageComputed.borderLeftWidth) + Number.parseFloat(stageComputed.borderRightWidth);
				const stageContentW = stage.clientWidth - stagePadX - stageBorderX;
				if (stageContentW > 0) setFitWidth(androidPanelSnapPxOf(stageContentW));
			}
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		if (stage !== null) observer.observe(stage);
		return () => {
			observer.disconnect();
		};
	}, [frameStyle]);
	const screenBox = androidPanelScreenBoxOf(sizeMode, naturalWidth, naturalHeight, frameStyle);
	const screenRadius = screenBox !== void 0 ? androidPanelScreenRadiusOf(screenBox.width, screenBox.height) : measuredRadius;
	const shellRadius = androidPanelShellRadiusOf(frameStyle, screenRadius);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		ref: frameRef,
		style: androidPanelFrameStyles(sizeMode, naturalWidth, naturalHeight, frameStyle, screenRadius, fitWidth),
		"data-android-phone-frame": "true",
		"data-android-phone-frame-style": frameStyle,
		"data-android-phone-width": width,
		"data-android-shell-radius": shellRadius,
		children: [frameStyle === "device" && !landscape ? DEVICE_SIDE_BUTTONS.map((button) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: button.style,
			"aria-hidden": "true",
			"data-android-device-button": button.id,
			"data-android-device-side": button.side
		}, button.id)) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: {
				...androidPhoneScreenStyles(frameStyle, screenRadius),
				aspectRatio: `${layout.displayW} / ${layout.displayH}`
			},
			"data-android-phone-screen": "true",
			"data-android-phone-aspect": `${layout.displayW} / ${layout.displayH}`,
			"data-android-screen-radius": screenRadius,
			children
		})]
	});
}
//#endregion
//#region src/client/android-device-menu.tsx
/**
* The panel's device-actions menu: the five device-level gestures the host
* exposes (`ANDROID_DEVICE_ACTIONS`), reachable from the toolbar.
*
* Shape: one icon button (sliders) in the same pill language as the other
* toolbar icons, opening a small command list BELOW it. Unlike the device
* picker this is not a value selector — nothing stays "selected" — so it is a
* plain popover of buttons rather than an `AndroidSelect`.
*
* Every action works on every device: adb does not distinguish emulators from
* phones, so there is no per-backend availability table (the dsh-ios
* simulator-only rows have no counterpart here) and no row is ever disabled
* for the device kind.
*
* @module @zseven-w/dsh-android/client/android-device-menu
*/
/** Actions the menu offers, in render order (mirrors the host's table). */
const ANDROID_DEVICE_MENU_ACTIONS = ANDROID_DEVICE_ACTIONS;
/** Localized label for one action. */
function androidDeviceActionLabelOf(action, copy) {
	switch (action) {
		case "notifications": return copy.deviceNotifications;
		case "quick-settings": return copy.deviceQuickSettings;
		case "lock": return copy.deviceLock;
		case "wake": return copy.deviceWake;
		case "assistant": return copy.deviceAssistant;
	}
}
/** The sliders glyph, in the toolbar's 16×16 stroke-icon language. */
const ANDROID_DEVICE_MENU_ICON_PATHS = [
	"M2.75 4.5 H13.25",
	"M2.75 11.5 H13.25",
	"M6 2.9 V6.1",
	"M10.5 9.9 V13.1"
];
const ANDROID_DEVICE_MENU_STYLES = {
	root: {
		position: "relative",
		display: "inline-flex"
	},
	menu: {
		position: "absolute",
		top: "calc(100% + 6px)",
		right: 0,
		zIndex: 30,
		minWidth: 168,
		padding: 4,
		display: "flex",
		flexDirection: "column",
		gap: 1,
		borderRadius: 10,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "var(--dsw-alias-bg-layer-1)",
		boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)"
	},
	item: {
		appearance: "none",
		border: "none",
		borderRadius: 7,
		padding: "6px 10px",
		background: "transparent",
		color: "var(--dsw-alias-label-primary)",
		font: "inherit",
		fontSize: 12,
		lineHeight: "18px",
		textAlign: "left",
		cursor: "pointer",
		whiteSpace: "nowrap"
	},
	itemHover: { background: "var(--dsw-alias-interactive-bg-hover)" },
	busy: {
		opacity: .6,
		cursor: "progress"
	}
};
/**
* The menu. Closes on outside pointerdown, on Escape, and after a successful
* action — a failed one keeps it open so the next attempt is one click away.
*/
function AndroidDeviceMenu({ copy, onAction, onError, open: openOverride }) {
	const [internalOpen, setInternalOpen] = (0, react.useState)(false);
	const [hovered, setHovered] = (0, react.useState)();
	const [busy, setBusy] = (0, react.useState)();
	const rootRef = (0, react.useRef)(null);
	const open = openOverride ?? internalOpen;
	(0, react.useEffect)(() => {
		if (!open || openOverride !== void 0) return;
		const onPointerDown = (event) => {
			if (rootRef.current?.contains(event.target) === true) return;
			setInternalOpen(false);
		};
		const onKeyDown = (event) => {
			if (event.key === "Escape") setInternalOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [open, openOverride]);
	const run = (0, react.useCallback)(async (action) => {
		setBusy(action);
		try {
			await onAction(action);
			setInternalOpen(false);
		} catch (error) {
			onError?.(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(void 0);
		}
	}, [onAction, onError]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: ANDROID_DEVICE_MENU_STYLES.root,
		ref: rootRef,
		"data-android-device-menu": "true",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			style: ANDROID_TOOLBAR_TRIGGER_STYLE,
			"aria-label": copy.deviceMenu,
			title: copy.deviceMenu,
			"aria-haspopup": "menu",
			"aria-expanded": open ? "true" : "false",
			"data-android-device-menu-trigger": "true",
			onClick: () => {
				setInternalOpen((current) => !current);
			},
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				focusable: "false",
				children: ANDROID_DEVICE_MENU_ICON_PATHS.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: path,
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}, path))
			})
		}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: ANDROID_DEVICE_MENU_STYLES.menu,
			role: "menu",
			"aria-label": copy.deviceMenu,
			"data-android-device-menu-list": "true",
			children: ANDROID_DEVICE_MENU_ACTIONS.map((action) => {
				const label = androidDeviceActionLabelOf(action, copy);
				let style = ANDROID_DEVICE_MENU_STYLES.item;
				if (hovered === action) style = {
					...style,
					...ANDROID_DEVICE_MENU_STYLES.itemHover
				};
				if (busy === action) style = {
					...style,
					...ANDROID_DEVICE_MENU_STYLES.busy
				};
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					role: "menuitem",
					style,
					disabled: busy !== void 0,
					title: label,
					"data-android-device-action": action,
					onMouseEnter: () => setHovered(action),
					onMouseLeave: () => setHovered(void 0),
					onClick: () => {
						run(action);
					},
					children: label
				}, action);
			})
		}) : null]
	});
}
/** Same 28px square as the other toolbar icons (kept local to avoid a cycle). */
const ANDROID_TOOLBAR_TRIGGER_STYLE = {
	appearance: "none",
	width: 28,
	height: 28,
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: 0,
	border: "none",
	borderRadius: 8,
	background: "transparent",
	color: "var(--dsw-alias-label-secondary)",
	cursor: "pointer"
};
//#endregion
//#region src/client/android-toolbar.tsx
/**
* The panel toolbar's icon cluster + segmented quick sizes.
*
* The stream actions are ICON buttons grouped in ONE rounded pill container.
* The first three are the ANDROID NAVIGATION TRIAD — ◁ Back · ○ Home ·
* □ Recents — three PEERS in the same pill as rotate/screenshot/refresh:
* unlike dsh-ios (one Home button whose double-click opened the app
* switcher), Android has a real Recents key, so there is NO double-click
* gesture anywhere in this toolbar.
*
* The icons are inline stroke SVGs in a 16×16 viewBox (stroke `currentColor`,
* width 1.5, round caps/joins), so the DSH theme tokens color them through
* the button's `color` — no icon fonts, no assets, no dependencies.
*
* Each icon button shows a small token-styled tooltip BELOW the button on
* hover or keyboard focus (150ms show delay, instant hide). The codebase
* styles via inline objects (no CSS pseudo-elements), so the hover/focus
* state is explicit React state and the tooltip is an absolutely-positioned
* label rendered off that state. The label is the same localized string as
* the button's `aria-label` — the tooltip is visual sugar only.
*
* The size quick buttons (Fit/适应 · 100% · S · M) share the same visual
* language as ONE borderless segmented pill group: a single outer border on
* the container, borderless text segments with a subtle hover highlight, and
* the ACTIVE segment marked by a stronger background FILL.
*
* Style tokens: the hover highlight uses `--dsw-alias-interactive-bg-hover`
* and the active fill uses `--dsw-alias-interactive-bg-active` rather than
* the raw layer ramp — in the LIGHT theme `bg-layer-1`/`bg-layer-2` resolve
* to the same white, so the semantic interactive tokens are the only
* layer-ish fills that read clearly in BOTH themes.
*/
/** The action roster in the pill's render order. */
const ANDROID_TOOLBAR_ACTION_IDS = [
	"back",
	"home",
	"recents",
	"screenshot",
	"rotate",
	"refresh"
];
/** The three actions that map to `/control` `{kind:'button'}` key events. */
const ANDROID_TOOLBAR_NAV_ACTIONS = [
	"back",
	"home",
	"recents"
];
/** Localized label for one action — the button aria-label AND the tooltip. */
function androidToolbarActionLabelOf(action, copy) {
	switch (action) {
		case "back": return copy.back;
		case "home": return copy.home;
		case "recents": return copy.recents;
		case "screenshot": return copy.screenshot;
		case "rotate": return copy.rotate;
		case "refresh": return copy.refresh;
	}
}
/**
* The icon set: minimal stroke paths in a 16×16 viewBox, drawn with
* `stroke="currentColor"` / `fill="none"` / strokeWidth 1.5 / round caps —
* exported so the static smoke can assert the set directly.
*
* - back: the Android ◁ triangle;
* - home: the Android ○ circle;
* - recents: the Android □ square;
* - screenshot: a camera — body outline + lens circle;
* - rotate: rotate-cw — one 270° arc with the top-right arrowhead;
* - refresh: refresh-cw — two mirrored 180° arcs with both arrowheads.
*/
const ANDROID_TOOLBAR_ICON_PATHS = {
	back: ["M10.5 3.25 L4.5 8 L10.5 12.75 Z"],
	home: ["M8 2.75a5.25 5.25 0 1 0 .01 0"],
	recents: ["M3.75 3.75 H12.25 V12.25 H3.75 Z"],
	screenshot: ["M2.75 5.25 H5.1 L6.4 3.5 H9.6 L10.9 5.25 H13.25 V12.25 H2.75 Z", "M8 6.25a2.5 2.5 0 1 0 .01 0"],
	rotate: ["M14 8a6 6 0 1 1-6-6c1.68 0 3.29.67 4.49 1.83L14 5.33", "M14 2v3.33h-3.33"],
	refresh: [
		"M2 8a6 6 0 0 1 6-6c1.68 0 3.29.67 4.49 1.83L14 5.33",
		"M14 2v3.33h-3.33",
		"M14 8a6 6 0 0 1-6 6c-1.68 0-3.29-.67-4.49-1.83L2 10.67",
		"M5.33 10.67H2V14"
	]
};
/** One inline stroke icon (16px, currentColor — the button's color token). */
function AndroidToolbarIcon({ action }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
		width: 16,
		height: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.5,
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": "true",
		focusable: false,
		"data-android-toolbar-icon": action,
		children: ANDROID_TOOLBAR_ICON_PATHS[action].map((d, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d }, index))
	});
}
/**
* Toolbar pill + button + tooltip + size-segment styles over the DSH theme
* tokens (no literal colors — the vars resolve per light/dark theme).
* Exported so the static smoke can assert the token usage directly.
*/
const ANDROID_TOOLBAR_STYLES = {
	/** The rounded pill container the icon buttons sit in. */
	actionPill: {
		flex: "none",
		display: "inline-flex",
		alignItems: "center",
		gap: 2,
		padding: 2,
		borderRadius: 999,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "var(--dsw-alias-bg-layer-1)"
	},
	/** Borderless 28px icon square; `position: relative` anchors the tooltip. */
	iconButton: {
		position: "relative",
		flex: "none",
		width: 28,
		height: 28,
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		padding: 0,
		border: "none",
		borderRadius: 7,
		background: "transparent",
		color: "var(--dsw-alias-label-secondary)",
		cursor: "pointer"
	},
	/** Hover/focus highlight: subtle layer fill + primary label color. */
	iconButtonHover: {
		background: "var(--dsw-alias-interactive-bg-hover)",
		color: "var(--dsw-alias-label-primary)"
	},
	/** The small tooltip bubble below the button (host Tooltip recipe). */
	tooltip: {
		position: "absolute",
		top: "calc(100% + 4px)",
		left: "50%",
		transform: "translateX(-50%)",
		zIndex: 20,
		padding: "3px 7px",
		borderRadius: 8,
		background: "var(--dsw-alias-tooltip-bg)",
		color: "var(--dsw-static-neutral-bluish-00)",
		fontSize: 12,
		lineHeight: "16px",
		whiteSpace: "nowrap",
		pointerEvents: "none"
	},
	/** The segmented pill the size quick buttons sit in — the SAME pill
	* treatment as the icon cluster (one outer border, no per-button border). */
	sizeQuickGroup: {
		flex: "none",
		display: "inline-flex",
		alignItems: "center",
		gap: 2,
		padding: 2,
		borderRadius: 999,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "var(--dsw-alias-bg-layer-1)"
	},
	/** Borderless text segment (~28px tall with the pill's 2px padding). */
	sizeQuickSegment: {
		flex: "none",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		minHeight: 24,
		padding: "0 10px",
		border: "none",
		borderRadius: 999,
		background: "transparent",
		color: "var(--dsw-alias-label-secondary)",
		cursor: "pointer",
		font: "inherit",
		fontSize: 12,
		lineHeight: 1.4,
		whiteSpace: "nowrap"
	},
	/** Segment hover: the same subtle highlight the icon buttons use. */
	sizeQuickSegmentHover: {
		background: "var(--dsw-alias-interactive-bg-hover)",
		color: "var(--dsw-alias-label-primary)"
	},
	/** ACTIVE segment: stronger background FILL, no border. */
	sizeQuickSegmentActive: {
		background: "var(--dsw-alias-interactive-bg-active)",
		color: "var(--dsw-alias-label-primary)",
		fontWeight: 600
	}
};
/** Tooltip show delay (nice-to-have ~150ms). */
const ANDROID_TOOLBAR_TOOLTIP_DELAY_MS = 150;
/** The pure tooltip bubble (exported for the static smoke). */
function AndroidToolbarTooltip({ label }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		style: ANDROID_TOOLBAR_STYLES.tooltip,
		role: "tooltip",
		"aria-hidden": "true",
		"data-android-toolbar-tooltip": "true",
		children: label
	});
}
/**
* One toolbar action as an icon button: borderless 28px square inside the
* pill, hover/focus highlight, and the tooltip below it. The tooltip opens
* after the 150ms delay on mouseenter/focus and closes immediately on
* mouseleave/blur; the button keeps its `aria-label` regardless. There is no
* double-click affordance — every Android navigation key is its own button.
*/
function AndroidToolbarIconButton({ action, label, onClick, tooltipOpen }) {
	const [internalOpen, setInternalOpen] = (0, react.useState)(false);
	const [hovered, setHovered] = (0, react.useState)(false);
	const openTimerRef = (0, react.useRef)(void 0);
	const cancelOpenTimer = (0, react.useCallback)(() => {
		if (openTimerRef.current !== void 0) {
			clearTimeout(openTimerRef.current);
			openTimerRef.current = void 0;
		}
	}, []);
	const scheduleOpen = (0, react.useCallback)(() => {
		cancelOpenTimer();
		openTimerRef.current = setTimeout(() => {
			setInternalOpen(true);
		}, 150);
	}, [cancelOpenTimer]);
	const close = (0, react.useCallback)(() => {
		cancelOpenTimer();
		setInternalOpen(false);
		setHovered(false);
	}, [cancelOpenTimer]);
	(0, react.useEffect)(() => () => {
		cancelOpenTimer();
	}, [cancelOpenTimer]);
	const open = tooltipOpen ?? internalOpen;
	const buttonStyle = hovered ? {
		...ANDROID_TOOLBAR_STYLES.iconButton,
		...ANDROID_TOOLBAR_STYLES.iconButtonHover
	} : ANDROID_TOOLBAR_STYLES.iconButton;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
		type: "button",
		style: buttonStyle,
		onClick,
		onMouseEnter: () => {
			setHovered(true);
			scheduleOpen();
		},
		onMouseLeave: close,
		onFocus: () => {
			setHovered(true);
			scheduleOpen();
		},
		onBlur: close,
		"aria-label": label,
		"data-android-toolbar-action": action,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidToolbarIcon, { action }), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidToolbarTooltip, { label }) : null]
	});
}
/**
* One size quick button as a borderless text segment of the segmented pill
* group: hover = subtle highlight, ACTIVE = stronger background fill. The
* active fill wins over the hover highlight so the pressed segment never
* lightens under the cursor.
*/
function AndroidSizeQuickSegment({ id, label, ariaLabel, title, active, onClick }) {
	const [hovered, setHovered] = (0, react.useState)(false);
	let style = ANDROID_TOOLBAR_STYLES.sizeQuickSegment;
	if (hovered) style = {
		...style,
		...ANDROID_TOOLBAR_STYLES.sizeQuickSegmentHover
	};
	if (active) style = {
		...style,
		...ANDROID_TOOLBAR_STYLES.sizeQuickSegmentActive
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		style,
		"aria-pressed": active,
		"aria-label": ariaLabel,
		title,
		"data-android-size-quick": id,
		"data-android-size-quick-active": active ? "true" : "false",
		onClick,
		onMouseEnter: () => setHovered(true),
		onMouseLeave: () => setHovered(false),
		onFocus: () => setHovered(true),
		onBlur: () => setHovered(false),
		children: label
	});
}
//#endregion
//#region src/client/android-panel.tsx
/**
* Panel chrome styles over the DSH theme tokens (no literal colors — the
* host's `--dsw-alias-*` variables resolve per theme; the phone bezel is the
* one deliberate dark device surface). Exported so the static smoke can
* assert the token usage directly.
*/
const PANEL_STYLES = {
	root: {
		height: "100%",
		minHeight: 0,
		display: "flex",
		flexDirection: "column",
		color: "var(--dsw-alias-label-primary)",
		background: "var(--dsw-alias-bg-base)",
		fontFamily: "inherit"
	},
	header: {
		display: "flex",
		flexDirection: "column",
		gap: 6,
		minWidth: 0,
		flex: "none",
		padding: "8px 10px",
		borderBottom: "1px solid var(--dsw-alias-border-l2)"
	},
	headerPrimary: {
		display: "flex",
		alignItems: "center",
		gap: 8,
		minWidth: 0
	},
	headerSecondary: {
		display: "flex",
		alignItems: "center",
		justifyContent: "flex-end",
		gap: 6,
		minWidth: 0
	},
	titleCluster: {
		minWidth: 0,
		flex: "none",
		display: "flex",
		alignItems: "center",
		gap: 8,
		overflow: "hidden"
	},
	title: {
		fontSize: 14,
		lineHeight: "18px",
		fontWeight: 600,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	subtitle: {
		fontSize: 12,
		lineHeight: "16px",
		color: "var(--dsw-alias-label-secondary)",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	frameStyleControl: {
		flex: "none",
		marginLeft: "auto",
		display: "inline-flex",
		alignItems: "center",
		overflow: "hidden",
		borderRadius: 6,
		border: "1px solid var(--dsw-alias-border-l2)",
		minWidth: 90
	},
	frameStyleButton: {
		flex: "none",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		minHeight: 24,
		padding: "2px 7px",
		border: "none",
		borderRadius: 0,
		background: "transparent",
		color: "var(--dsw-alias-label-secondary)",
		cursor: "pointer",
		font: "inherit",
		fontSize: 12,
		lineHeight: 1.4,
		whiteSpace: "nowrap"
	},
	frameStyleButtonActive: {
		background: "var(--dsw-alias-bg-layer-1)",
		color: "var(--dsw-alias-label-primary)",
		fontWeight: 600
	},
	backgroundButton: {
		flex: "none",
		minHeight: 26,
		padding: "2px 8px",
		borderRadius: 6,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "var(--dsw-alias-bg-layer-1)",
		color: "var(--dsw-alias-label-primary)",
		cursor: "pointer",
		font: "inherit",
		fontSize: 12,
		whiteSpace: "nowrap"
	},
	closeButton: {
		flex: "none",
		width: 26,
		height: 26,
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		border: "1px solid var(--dsw-alias-border-l2)",
		borderRadius: 6,
		color: "var(--dsw-alias-label-primary)",
		background: "var(--dsw-alias-bg-layer-1)",
		cursor: "pointer",
		font: "inherit",
		lineHeight: 0,
		padding: 0
	},
	stage: {
		flex: 1,
		minHeight: 0,
		overflow: "auto",
		padding: 16,
		display: "flex",
		flexDirection: "column",
		background: "var(--dsw-alias-bg-base)"
	},
	toolbar: {
		flex: "none",
		display: "flex",
		alignItems: "center",
		flexWrap: "wrap",
		gap: 6,
		padding: "4px 12px",
		borderBottom: "1px solid var(--dsw-alias-border-l2)"
	},
	toolbarDivider: {
		flex: "none",
		alignSelf: "stretch",
		width: 1,
		margin: "0 2px",
		background: "var(--dsw-alias-border-l2)"
	},
	captureToast: {
		flex: "none",
		display: "inline-flex",
		alignItems: "center",
		minHeight: 24,
		padding: "2px 8px",
		borderRadius: 99,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "var(--dsw-alias-bg-layer-1)",
		color: "var(--dsw-alias-label-secondary)",
		fontSize: 12,
		lineHeight: 1.4
	},
	unavailable: {
		flex: 1,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		padding: 16,
		textAlign: "center"
	}
};
/**
* "● Live" / gray "Offline" readout under the frame. The text color follows
* the theme token; only the dot keeps its literal green/gray state colors.
*/
const PANEL_LIVE_INDICATOR_STYLES = {
	flex: "none",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: 8,
	padding: "4px 12px 12px",
	fontSize: 12,
	color: "var(--dsw-alias-label-secondary)"
};
function AndroidLiveIndicator({ open, locale }) {
	const copy = androidCopy(locale);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: PANEL_LIVE_INDICATOR_STYLES,
		role: "status",
		"data-android-live-indicator": open ? "live" : "offline",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			"aria-hidden": "true",
			style: {
				width: 9,
				height: 9,
				borderRadius: "50%",
				background: open ? "#22c55e" : "#9ca3af",
				...open ? { boxShadow: "0 0 8px rgba(34,197,94,0.8)" } : {}
			}
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: open ? copy.panelLive : copy.offline })]
	});
}
/**
* Auto-follow header styles — the same compact token pill language as the
* picker's switching/error readouts. Only the live-green dot keeps a literal
* state color (the panel-wide live-dot convention).
*/
const ANDROID_FOLLOW_INDICATOR_STYLES = {
	root: {
		flex: "none",
		display: "inline-flex",
		alignItems: "center",
		gap: 5,
		minHeight: 22,
		padding: "1px 8px",
		borderRadius: 99,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "var(--dsw-alias-bg-layer-1)",
		color: "var(--dsw-alias-label-secondary)",
		font: "inherit",
		fontSize: 12,
		lineHeight: "16px",
		whiteSpace: "nowrap",
		cursor: "default"
	},
	/** The live-green dot only — auto-follow is on (same state color as Live). */
	dot: {
		flex: "none",
		width: 7,
		height: 7,
		borderRadius: "50%",
		background: "#22c55e",
		boxShadow: "0 0 6px rgba(34,197,94,0.7)"
	},
	/** The overridden pill is the one-click resume button. */
	resume: {
		cursor: "pointer",
		color: "var(--dsw-alias-label-primary)",
		fontWeight: 600
	}
};
/**
* The small auto-follow header indicator: while following is active a muted
* 自动跟随/Auto-follow pill with the live-green dot; after a manual pick it
* becomes the one-click 恢复跟随/Resume following button — visible AND
* reversible. Pure presentation, SSR-safe.
*/
function AndroidFollowIndicator({ overridden, locale, onResume }) {
	const copy = androidCopy(locale);
	if (!overridden) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		style: ANDROID_FOLLOW_INDICATOR_STYLES.root,
		role: "status",
		title: copy.followHint,
		"data-android-follow-indicator": "true",
		"data-android-follow-state": "active",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: ANDROID_FOLLOW_INDICATOR_STYLES.dot,
			"aria-hidden": "true",
			"data-android-follow-dot": "true"
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.followActive })]
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		style: {
			...ANDROID_FOLLOW_INDICATOR_STYLES.root,
			...ANDROID_FOLLOW_INDICATOR_STYLES.resume
		},
		title: copy.followHint,
		"aria-label": copy.followResume,
		onClick: onResume,
		"data-android-follow-indicator": "true",
		"data-android-follow-state": "overridden",
		"data-android-follow-resume": "true",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.followResume })
	});
}
/** aria-label for one quick-size button (full copy per size, both locales). */
function androidQuickSizeAriaLabel(id, copy) {
	switch (id) {
		case "fit": return copy.sizeQuickFit;
		case "percent-100": return copy.sizeQuickPercent100;
		case "preset-S": return copy.sizeQuickS;
		case "preset-M": return copy.sizeQuickM;
	}
	return copy.sizeMode;
}
/** Pure panel chrome: header, toolbar, size-aware phone frame, Live dot. */
function AndroidPanelBody({ title, device, devicePicker, mode, liveOpen, colorScheme, locale, onClose, backgroundMode = false, onBackgroundModeChange, children, followIndicator, sizeMode = ANDROID_PANEL_SIZE_MODE_FIT, naturalWidth, naturalHeight, onSizeModeChange, frameStyle = ANDROID_FRAME_STYLE_BEZEL, onFrameStyleChange, onNavButton, onDeviceAction, onRotate, onScreenshot, onRefresh, captureState = "idle" }) {
	const copy = androidCopy(locale);
	const deviceLabel = [device?.name, device?.serial].filter((part) => part !== void 0 && part !== "").join(" · ");
	const activeSizeModeId = androidPanelSizeModeIdOf(sizeMode);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		style: PANEL_STYLES.root,
		"data-android-panel": "true",
		"data-android-mode": mode,
		"data-android-color-scheme": colorScheme,
		role: "complementary",
		"aria-label": copy.android,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: PANEL_STYLES.header,
				"data-android-panel-header": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: PANEL_STYLES.headerPrimary,
					"data-android-panel-header-primary": "true",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: PANEL_STYLES.titleCluster,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: PANEL_STYLES.title,
								children: title
							})
						}),
						devicePicker !== void 0 ? devicePicker : deviceLabel !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: PANEL_STYLES.subtitle,
							children: deviceLabel
						}) : null,
						onClose !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: PANEL_STYLES.closeButton,
							onClick: onClose,
							"aria-label": copy.closePanel,
							"data-android-panel-close": "true",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
								width: "12",
								height: "12",
								viewBox: "0 0 16 16",
								fill: "none",
								stroke: "currentColor",
								strokeWidth: "1.6",
								strokeLinecap: "round",
								"aria-hidden": "true",
								"data-android-panel-close-icon": "true",
								style: { display: "block" },
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 4 L12 12 M12 4 L4 12" })
							})
						}) : null
					]
				}), followIndicator !== void 0 || onBackgroundModeChange !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: PANEL_STYLES.headerSecondary,
					"data-android-panel-header-secondary": "true",
					children: [followIndicator, onBackgroundModeChange !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: backgroundMode ? {
							...PANEL_STYLES.backgroundButton,
							...PANEL_STYLES.frameStyleButtonActive
						} : PANEL_STYLES.backgroundButton,
						"aria-pressed": backgroundMode,
						title: copy.backgroundModeHint,
						"data-android-background-mode": backgroundMode ? "true" : "false",
						onClick: () => {
							onBackgroundModeChange(!backgroundMode);
						},
						children: copy.backgroundMode
					}) : null]
				}) : null]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: PANEL_STYLES.toolbar,
				"data-android-panel-toolbar": "true",
				role: "toolbar",
				"aria-label": copy.toolbar,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: ANDROID_TOOLBAR_STYLES.sizeQuickGroup,
						role: "group",
						"aria-label": copy.sizeMode,
						"data-android-size-quick-group": "true",
						children: ANDROID_PANEL_QUICK_SIZE_OPTIONS.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidSizeQuickSegment, {
							id: option.id,
							label: locale === "zh" ? option.quickZh : option.quickEn,
							ariaLabel: androidQuickSizeAriaLabel(option.id, copy),
							title: copy.sizeMode,
							active: activeSizeModeId === option.id,
							onClick: () => {
								onSizeModeChange?.(option.mode);
							}
						}, option.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: PANEL_STYLES.toolbarDivider,
						"aria-hidden": "true",
						"data-android-toolbar-divider": "true"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: ANDROID_TOOLBAR_STYLES.actionPill,
						"data-android-toolbar-actions": "true",
						children: [
							onNavButton !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidToolbarIconButton, {
									action: "back",
									label: copy.back,
									onClick: () => {
										onNavButton("back");
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidToolbarIconButton, {
									action: "home",
									label: copy.home,
									onClick: () => {
										onNavButton("home");
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidToolbarIconButton, {
									action: "recents",
									label: copy.recents,
									onClick: () => {
										onNavButton("recents");
									}
								})
							] }) : null,
							onScreenshot !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidToolbarIconButton, {
								action: "screenshot",
								label: copy.screenshot,
								onClick: onScreenshot
							}) : null,
							captureState !== "idle" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: PANEL_STYLES.captureToast,
								role: "status",
								"data-android-capture-state": captureState,
								children: captureState === "done" ? copy.captured : copy.capturing
							}) : null,
							onRotate !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidToolbarIconButton, {
								action: "rotate",
								label: copy.rotate,
								onClick: onRotate
							}) : null,
							onRefresh !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidToolbarIconButton, {
								action: "refresh",
								label: copy.refresh,
								onClick: onRefresh
							}) : null,
							onDeviceAction !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidDeviceMenu, {
								copy,
								onAction: onDeviceAction
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: PANEL_STYLES.frameStyleControl,
						role: "group",
						"aria-label": copy.frameStyle,
						title: copy.frameStyle,
						"data-android-frame-style-control": "true",
						children: ANDROID_FRAME_STYLE_OPTIONS.map((id) => {
							const active = frameStyle === id;
							const label = androidFrameStyleLabelOf(id, copy);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: active ? {
									...PANEL_STYLES.frameStyleButton,
									...PANEL_STYLES.frameStyleButtonActive
								} : PANEL_STYLES.frameStyleButton,
								"aria-pressed": active,
								"aria-label": `${copy.frameStyle}: ${label}`,
								title: `${copy.frameStyle}: ${label}`,
								"data-android-frame-style": id,
								"data-android-frame-style-active": active ? "true" : "false",
								onClick: () => {
									onFrameStyleChange?.(id);
								},
								children: label
							}, id);
						})
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: PANEL_STYLES.stage,
				"data-android-panel-stage": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidPhoneFrame, {
					sizeMode,
					naturalWidth,
					naturalHeight,
					frameStyle,
					children
				})
			}),
			mode === "stream" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidLiveIndicator, {
				open: liveOpen,
				locale
			}) : null
		]
	});
}
/** Pure screenshot-mode body (static PNG inside the phone screen). */
function AndroidScreenshotFrameBody({ meta, locale, phase, screenshotUrl, failure, refresh, imgRef, onNaturalSize }) {
	const copy = androidCopy(locale);
	const serial = meta.device.serial;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			width: "100%",
			height: "100%",
			minHeight: 0,
			overflow: "hidden"
		},
		"data-android-screenshot-frame": "panel",
		"data-android-frame-state": phase,
		children: [
			phase === "granting" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: PANEL_LOADING_STYLES,
				role: "status",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: CARD_STYLES.muted,
					children: copy.connectingScreenshot
				}), serial !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: CARD_STYLES.muted,
					children: serial
				}) : null]
			}) : null,
			phase === "live" && screenshotUrl !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				ref: imgRef,
				src: screenshotUrl,
				alt: copy.screenshotAlt,
				draggable: false,
				style: PANEL_SCREENSHOT_IMAGE_STYLES,
				onLoad: (event) => {
					onNaturalSize?.(event.currentTarget.naturalWidth);
				}
			}) : null,
			phase === "fallback" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: PANEL_FALLBACK_STYLES,
				role: "alert",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
						style: CARD_STYLES.fallbackTitle,
						children: copy.screenshotUnavailable
					}),
					serial !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: CARD_STYLES.muted,
						children: serial
					}) : null,
					failure !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: CARD_STYLES.muted,
						children: failure
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: CARD_STYLES.primaryButton,
						onClick: refresh,
						children: copy.retry
					})
				]
			}) : null
		]
	});
}
/** Connected screenshot-mode frame: grant → static PNG in the phone screen. */
function AndroidScreenshotFrame({ meta, fetcher, locale, onNaturalSize }) {
	const session = useAndroidScreenshot({
		meta,
		fetcher,
		unavailableCopy: androidCopy(locale).screenshotUnavailable
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidScreenshotFrameBody, {
		meta,
		locale,
		phase: session.phase,
		screenshotUrl: session.screenshotUrl,
		failure: session.failure,
		refresh: session.refresh,
		imgRef: session.imgRef,
		...onNaturalSize === void 0 ? {} : { onNaturalSize }
	});
}
/** Tool name the panel modes derive from (defensive over both block forms). */
function androidToolNameOf(block) {
	return "kind" in block ? block.call?.name ?? "" : block.name;
}
//#endregion
//#region src/client/android-panel-follow.ts
/**
* Auto-follow: the open device panel re-targets to the agent's NEWEST settled
* tool result instead of staying on the device it happened to be opened for.
*
* The panel source registry (`android-panel-trigger.ts`) already carries every
* settled result of the visual tools (boot / screenshot / interact /
* build_run) with its sessionId and device, so the follow engine is a pure
* state machine driven off that registry:
*
* - `androidFollowNewestCandidateOf` scans a source snapshot for the newest
*   settled result of the CURRENT session with a device serial.
* - `androidFollowStateNext` runs the follow/override lifecycle: a candidate
*   whose device differs from the panel's current device arms a debounce
*   window (`ANDROID_PANEL_FOLLOW_DEBOUNCE_MS`); when the target stays the
*   newest for the whole window a decision is emitted; a manual pick from the
*   panel's device picker sets the user-override flag (decisions stand down
*   for the rest of the panel session); the header's resume affordance clears
*   it. No decision is emitted while a switch is already in flight — the
*   settle event releases an aged pending target.
* - `androidFollowTargetOf` classifies a decided serial against the host's
*   listing. Unlike dsh-ios there is only ONE device class here (emulators
*   and phones stream through the same adb path), so the answer is simply
*   "this serial is online and streamable" or `undefined` — a serial the host
*   cannot address (unknown, offline, unauthorized) is never followed: the
*   panel must not yank the user's live view for a dead device.
*
* Pure — no React, no DOM, no network. The dev-panel-smoke script drives
* `androidFollowStateNext` action by action.
*/
/**
* The debounce window a NEWEST target must stay stable for before the panel
* re-targets (~1.5–2 s). An agent alternating between two devices re-arms the
* window on every result, so the panel never ping-pongs.
*/
const ANDROID_PANEL_FOLLOW_DEBOUNCE_MS = 1600;
/**
* The newest settled source of the given session whose meta resolves to a
* device serial, or undefined. Error results and results without a device are
* skipped — the engine only follows results the panel can actually address.
*/
function androidFollowNewestCandidateOf(sources, sessionId) {
	if (sessionId === "") return void 0;
	let best;
	for (const source of sources) {
		if ("kind" in source.block && source.block.kind === "tool-result" && source.block.isError) continue;
		if (source.sessionId !== sessionId) continue;
		const serial = (resolveAndroidMeta(source.toolName, source.block)?.meta)?.device?.serial;
		if (typeof serial !== "string" || serial === "") continue;
		const time = typeof source.block.time === "number" && Number.isFinite(source.block.time) ? source.block.time : 0;
		if (best === void 0 || time > best.time) best = {
			serial,
			time
		};
	}
	return best;
}
/**
* Classify a follow decision's serial against the host's listing: an ONLINE
* device re-targets the stream through the switch/grant path. Anything else —
* an unknown serial, an offline or unauthorized device — resolves undefined
* and the follow stays put.
*/
function androidFollowTargetOf(serial, listing) {
	if (serial === "") return void 0;
	for (const device of listing.devices) {
		if (device.serial !== serial) continue;
		return androidDeviceOnline(device) ? {
			serial,
			entry: device
		} : void 0;
	}
}
function androidFollowStateInitial(currentSerial) {
	return {
		currentSerial,
		userOverrode: false,
		pending: void 0,
		inflight: false,
		nextSeq: 1,
		decisions: []
	};
}
function emitDecision(state, serial) {
	return {
		...state,
		pending: void 0,
		decisions: [...state.decisions, {
			seq: state.nextSeq,
			serial
		}],
		nextSeq: state.nextSeq + 1
	};
}
/**
* The pure follow/override state machine. `now` is injected (Date.now in the
* panel, explicit values in the smoke) so the debounce is fully
* deterministic. A `result` never re-targets by itself — only an aged `tick`
* (or a `switch-settled` that releases an already-aged pending) emits a
* decision, and only while following is active and no switch is in flight.
*/
function androidFollowStateNext(state, action) {
	switch (action.kind) {
		case "result":
			if (state.userOverrode) return state;
			if (action.serial === "" || action.serial === state.currentSerial) return state.pending === void 0 ? state : {
				...state,
				pending: void 0
			};
			if (state.pending !== void 0 && action.version <= state.pending.version) return state;
			return {
				...state,
				pending: {
					serial: action.serial,
					version: action.version,
					deadline: action.now + ANDROID_PANEL_FOLLOW_DEBOUNCE_MS
				}
			};
		case "tick":
			if (state.userOverrode || state.inflight || state.pending === void 0) return state;
			if (action.now < state.pending.deadline) return state;
			return emitDecision(state, state.pending.serial);
		case "manual-pick": return {
			...state,
			currentSerial: action.serial === "" ? state.currentSerial : action.serial,
			userOverrode: true,
			pending: void 0,
			decisions: []
		};
		case "resume-follow": return {
			...state,
			userOverrode: false
		};
		case "switch-start": return {
			...state,
			inflight: true
		};
		case "switch-settled": {
			const base = {
				...state,
				inflight: false,
				...typeof action.serial === "string" && action.serial !== "" ? { currentSerial: action.serial } : {}
			};
			if (base.userOverrode || base.pending === void 0 || base.pending.deadline > action.now) return base;
			return emitDecision(base, base.pending.serial);
		}
		case "consume": return {
			...state,
			decisions: state.decisions.filter((decision) => decision.seq !== action.seq)
		};
	}
}
//#endregion
//#region src/client/android-panel-connected.tsx
/**
* The connected device panel: resolves the tool result's presentationMeta (or,
* for nested Code Mode calls, reconstructs it from the durable result text)
* and renders the live stream (boot / build-run) or the static screenshot
* (screenshot / interact) inside the phone frame.
*
* It owns everything the pure chrome (android-panel.tsx) must not know about:
*
* - the stream session (grant → img, control POSTs), so the top toolbar can
*   reach the ◁ ○ □ nav keys, rotate, refresh;
* - the header device picker + the switch/seeded-grant handshake: picking a
*   device POSTs `/switch-device`, shows 切换中… while the old stream closes,
*   seeds the returned capability into the session and swaps the panel meta
*   to the new device; the panel host replaces the open request/source in
*   place so store and registry follow. Size and frame state are untouched;
* - the server-truth resync: when a grant falls back, `/status` is asked what
*   is ACTUALLY streaming and the panel adopts it, so the panel and the host
*   can never disagree about the streamed device;
* - auto-follow: while the panel is open (and the host passed its sessionId)
*   it re-targets to the session's NEWEST settled result — a stable target
*   for `ANDROID_PANEL_FOLLOW_DEBOUNCE_MS`, never during a switch, and never
*   after a manual pick until 恢复跟随 is clicked;
* - the capture controller behind the toolbar's 截图 button and the device
*   menu's five actions.
*
* Unlike dsh-ios there is exactly ONE device class: an emulator and a USB
* phone are the same adb serial on the same stream path, so there is no
* real-device session, no WDA progress surface and no device-kind branching.
*/
function AndroidPanel({ toolName, block, fetcher, colorScheme, locale, onClose, backgroundMode, onBackgroundModeChange, sizeMode, onSizeModeChange, frameStyle, onFrameStyleChange, onDisplayChange, onDeviceSwitched, sessionId }) {
	const copy = androidCopy(locale);
	const [liveOpen, setLiveOpen] = (0, react.useState)(false);
	const [naturalWidth, setNaturalWidth] = (0, react.useState)();
	const [naturalHeight, setNaturalHeight] = (0, react.useState)();
	const [internalSizeMode, setInternalSizeMode] = (0, react.useState)(ANDROID_PANEL_SIZE_MODE_FIT);
	const activeSizeMode = sizeMode ?? internalSizeMode;
	const handleSizeModeChange = onSizeModeChange ?? setInternalSizeMode;
	const [internalFrameStyle, setInternalFrameStyle] = (0, react.useState)(ANDROID_FRAME_STYLE_BEZEL);
	const activeFrameStyle = frameStyle ?? internalFrameStyle;
	const handleFrameStyleChange = onFrameStyleChange ?? setInternalFrameStyle;
	const resolved = "kind" in block && !block.isError ? resolveAndroidMeta(toolName, block) : void 0;
	const meta = resolved?.meta;
	const baseStreamMeta = meta?.kind === "android-stream" ? meta : meta?.kind === "android-build-run" ? {
		kind: "android-stream",
		device: meta.device
	} : void 0;
	const screenshotMeta = meta?.kind === "android-screenshot" ? meta : void 0;
	const sourcesVersion = (0, react.useSyncExternalStore)(subscribeAndroidPanelSources, androidPanelSourcesVersion, androidPanelSourcesVersion);
	const followEnabled = sessionId !== void 0 && sessionId !== "";
	const [followState, dispatchFollow] = (0, react.useReducer)(androidFollowStateNext, void 0, () => androidFollowStateInitial(resolved?.meta.device?.serial));
	const followStateRef = (0, react.useRef)(followState);
	followStateRef.current = followState;
	/** True while a follow-triggered switch is in flight — its settle (stream
	* live / fallback / switch error) reports back into the machine. */
	const followSwitchRef = (0, react.useRef)(false);
	/** One commit at a time (queued decisions are consumed sequentially). */
	const followCommitBusyRef = (0, react.useRef)(false);
	const [switchedMeta, setSwitchedMeta] = (0, react.useState)();
	const [seededGrant, setSeededGrant] = (0, react.useState)();
	const [switching, setSwitching] = (0, react.useState)(false);
	const [switchError, setSwitchError] = (0, react.useState)("");
	const switchTargetRef = (0, react.useRef)();
	const seedStreamUrlRef = (0, react.useRef)();
	const switchControllerRef = (0, react.useRef)();
	const onDeviceSwitchedRef = (0, react.useRef)(onDeviceSwitched);
	onDeviceSwitchedRef.current = onDeviceSwitched;
	const streamMeta = switchedMeta ?? baseStreamMeta;
	const mode = streamMeta !== void 0 ? "stream" : screenshotMeta !== void 0 ? "screenshot" : "unavailable";
	const title = copy.android;
	const streamSession = useAndroidStream({
		...streamMeta === void 0 ? {} : { meta: streamMeta },
		sessionId,
		copy,
		...fetcher === void 0 ? {} : { fetcher },
		unavailableCopy: copy.streamUnavailable,
		onLiveChange: setLiveOpen,
		enabled: streamMeta !== void 0,
		...seededGrant === void 0 ? {} : { seededGrant }
	});
	(0, react.useEffect)(() => {
		const controller = createAndroidDeviceSwitchController({
			fetcher: fetcher ?? fetch,
			sessionId,
			copy,
			onSwitchingChange: setSwitching,
			onSwitched: (result) => {
				setSwitchError("");
				switchTargetRef.current = result.device;
				seedStreamUrlRef.current = result.streamUrl;
				setSwitchedMeta(androidSwitchedStreamMetaOf(result));
				setSeededGrant({
					serial: result.device,
					streamUrl: result.streamUrl,
					...result.expiresAt === void 0 ? {} : { expiresAt: result.expiresAt }
				});
				onDeviceSwitchedRef.current?.(result);
			},
			onError: (message) => {
				switchTargetRef.current = void 0;
				setSwitchError(message);
				if (followSwitchRef.current) {
					followSwitchRef.current = false;
					dispatchFollow({
						kind: "switch-settled",
						now: Date.now()
					});
				}
			}
		});
		switchControllerRef.current = controller;
		return () => controller.dispose();
	}, [fetcher, sessionId]);
	(0, react.useEffect)(() => {
		if (!switching) return;
		const seedUrl = seedStreamUrlRef.current;
		if (seedUrl !== void 0 && streamSession.phase === "live" && streamSession.streamUrl === seedUrl) {
			seedStreamUrlRef.current = void 0;
			setSwitching(false);
			if (followSwitchRef.current) {
				followSwitchRef.current = false;
				dispatchFollow({
					kind: "switch-settled",
					serial: switchTargetRef.current,
					now: Date.now()
				});
			}
			return;
		}
		if (streamSession.phase === "fallback" && switchTargetRef.current !== void 0 && streamMeta?.device?.serial === switchTargetRef.current) {
			switchTargetRef.current = void 0;
			setSwitching(false);
			if (followSwitchRef.current) {
				followSwitchRef.current = false;
				dispatchFollow({
					kind: "switch-settled",
					now: Date.now()
				});
			}
		}
	}, [
		switching,
		streamSession.phase,
		streamSession.streamUrl,
		streamMeta
	]);
	(0, react.useEffect)(() => {
		if (streamSession.phase !== "fallback" || streamMeta === void 0) return;
		let cancelled = false;
		requestAndroidStatus(fetcher ?? fetch, { sessionId }).then((status) => {
			if (cancelled || !status.running || status.serial === void 0) return;
			if (status.serial === streamMeta.device?.serial) return;
			setSwitchedMeta(androidSwitchedStreamMetaOf({
				device: status.serial,
				...status.deviceName === void 0 ? {} : { deviceName: status.deviceName },
				streamUrl: ""
			}));
			setSeededGrant(void 0);
		});
		return () => {
			cancelled = true;
		};
	}, [
		streamSession.phase,
		streamMeta,
		sessionId,
		fetcher
	]);
	/** The stream branch of a device pick, shared with the auto-follow commit
	* path: POST switch-device for the serial (the controller seeds the new
	* grant and the existing onDeviceSwitched bookkeeping keeps the store and
	* registry in sync). */
	const switchStreamTo = (0, react.useCallback)((serial) => {
		if (serial === streamMeta?.device?.serial) return;
		switchTargetRef.current = serial;
		switchControllerRef.current?.switchTo(serial);
	}, [streamMeta]);
	const handleSelectDevice = (0, react.useCallback)((value) => {
		if (value === "") return;
		dispatchFollow({
			kind: "manual-pick",
			serial: value
		});
		switchStreamTo(value);
	}, [switchStreamTo]);
	const commitFollowQueue = (0, react.useCallback)(async () => {
		if (!followEnabled || followCommitBusyRef.current || followStateRef.current.inflight) return;
		const decision = followStateRef.current.decisions[0];
		if (decision === void 0) return;
		followCommitBusyRef.current = true;
		try {
			dispatchFollow({
				kind: "consume",
				seq: decision.seq
			});
			const listing = await requestAndroidDevices(fetcher ?? fetch, sessionId);
			if (androidFollowTargetOf(decision.serial, listing) === void 0) return;
			if (followStateRef.current.userOverrode || followStateRef.current.inflight) return;
			followSwitchRef.current = true;
			dispatchFollow({ kind: "switch-start" });
			if (decision.serial === streamMeta?.device?.serial) {
				followSwitchRef.current = false;
				dispatchFollow({
					kind: "switch-settled",
					serial: decision.serial,
					now: Date.now()
				});
				return;
			}
			switchTargetRef.current = decision.serial;
			if (switchControllerRef.current?.switchTo(decision.serial) !== true) {
				followSwitchRef.current = false;
				dispatchFollow({
					kind: "switch-settled",
					now: Date.now()
				});
			}
		} finally {
			followCommitBusyRef.current = false;
		}
	}, [
		followEnabled,
		fetcher,
		streamMeta,
		sessionId
	]);
	(0, react.useEffect)(() => {
		if (!followEnabled) return;
		const candidate = androidFollowNewestCandidateOf(androidPanelSourcesSnapshot(), sessionId ?? "");
		if (candidate === void 0) return;
		dispatchFollow({
			kind: "result",
			serial: candidate.serial,
			version: candidate.time,
			now: Date.now()
		});
	}, [
		sourcesVersion,
		sessionId,
		followEnabled
	]);
	(0, react.useEffect)(() => {
		const pending = followState.pending;
		if (pending === void 0) return;
		const delay = Math.max(0, pending.deadline - Date.now());
		const timer = setTimeout(() => {
			dispatchFollow({
				kind: "tick",
				now: Date.now()
			});
		}, delay);
		return () => {
			clearTimeout(timer);
		};
	}, [followState.pending]);
	(0, react.useEffect)(() => {
		if (followState.decisions.length > 0) commitFollowQueue();
	}, [
		followState.decisions.length,
		followState.inflight,
		commitFollowQueue
	]);
	const deviceActionDevice = streamMeta?.device?.serial ?? screenshotMeta?.device?.serial;
	const runDeviceAction = (0, react.useCallback)(async (action) => {
		setSwitchError("");
		const result = await postDeviceAction(fetcher ?? fetch, deviceActionDevice, action, sessionId);
		if (!result.ok) {
			const localized = androidRouteErrorTextOf(result, copy);
			const message = localized === "" ? copy.deviceActionFailed : localized;
			setSwitchError(message);
			throw new Error(message);
		}
	}, [
		fetcher,
		deviceActionDevice,
		sessionId,
		copy
	]);
	const capture = useAndroidCapture({
		...fetcher === void 0 ? {} : { fetcher },
		sessionId
	});
	const captureDevice = (streamMeta ?? screenshotMeta)?.device?.serial;
	const onScreenshot = (0, react.useCallback)(() => {
		capture.capture(captureDevice);
	}, [capture, captureDevice]);
	const onNavButton = (0, react.useCallback)((name) => {
		streamSession.sendButton(name);
	}, [streamSession]);
	(0, react.useEffect)(() => {
		if (onDisplayChange === void 0) return;
		if (mode === "stream") {
			onDisplayChange({
				naturalWidth,
				naturalHeight
			});
			return;
		}
		onDisplayChange({
			naturalWidth: void 0,
			naturalHeight: void 0
		});
	}, [
		mode,
		naturalWidth,
		naturalHeight,
		onDisplayChange
	]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidPanelBody, {
		title,
		device: streamMeta?.device ?? meta?.device,
		devicePicker: streamMeta !== void 0 || screenshotMeta !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidDevicePicker, {
			...fetcher === void 0 ? {} : { fetcher },
			sessionId,
			currentDevice: streamMeta?.device ?? screenshotMeta?.device,
			switching,
			error: switchError,
			locale,
			onSelect: handleSelectDevice
		}) : void 0,
		followIndicator: followEnabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidFollowIndicator, {
			overridden: followState.userOverrode,
			locale,
			onResume: () => {
				dispatchFollow({ kind: "resume-follow" });
			}
		}) : void 0,
		mode,
		liveOpen,
		colorScheme,
		locale,
		...onClose === void 0 ? {} : { onClose },
		...backgroundMode === void 0 ? {} : { backgroundMode },
		...onBackgroundModeChange === void 0 ? {} : { onBackgroundModeChange },
		sizeMode: activeSizeMode,
		...naturalWidth === void 0 ? {} : { naturalWidth },
		...naturalHeight === void 0 ? {} : { naturalHeight },
		onSizeModeChange: handleSizeModeChange,
		frameStyle: activeFrameStyle,
		onFrameStyleChange: handleFrameStyleChange,
		...mode === "stream" ? {
			onNavButton,
			onRotate: streamSession.sendRotate,
			onRefresh: streamSession.refresh
		} : {},
		...meta === void 0 ? {} : { onScreenshot },
		...mode === "stream" ? { onDeviceAction: runDeviceAction } : {},
		captureState: capture.phase,
		children: streamMeta !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidLiveFrameBody, {
			meta: streamMeta,
			locale,
			session: streamSession,
			...naturalWidth === void 0 ? {} : { naturalWidth },
			...naturalHeight === void 0 ? {} : { naturalHeight },
			onNaturalSize: (width, height) => {
				setNaturalWidth(width);
				setNaturalHeight(height);
			}
		}) : screenshotMeta !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidScreenshotFrame, {
			meta: screenshotMeta,
			...fetcher === void 0 ? {} : { fetcher },
			locale,
			onNaturalSize: setNaturalWidth
		}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: PANEL_STYLES.unavailable,
			role: "status",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: CARD_STYLES.muted,
				children: copy.noPreview
			})
		})
	});
}
/**
* Per-tool details-seat renderer for DSH runtimes that declare
* `tool.details.toolview` (absent in rc.6 — registration is guarded by
* `ctx.slots.inject`). The native details column supplies its own header and
* close control, so the panel body renders without `onClose`.
*/
function AndroidDetailsPanel({ block, colorScheme, locale }) {
	const toolName = androidToolNameOf(block) || ANDROID_CARD_TOOLS.boot;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidPanel, {
		toolName,
		block,
		colorScheme,
		locale: locale === "zh" ? "zh" : "en"
	});
}
//#endregion
//#region src/client/android-panel-host.tsx
/**
* Page-stable owner for the plugin-owned device panel.
*
* Mirrors dsh-openpencil's `mountEditorWorkbenchHost`: the rc.6 runtime has
* no per-tool details seat, so the plugin mounts its own imperative React
* root on `document.body` and shows the panel as a temporary floating right-
* hand surface below Harness's own top workspace bar. It deliberately does
* not mutate the DSH root margin: reserving a permanent column compressed the
* native header and hid existing controls. Narrow viewports still use a
* centered modal overlay. The left-edge handle drags the panel wider/narrower
* (double-click resets to the default width), and while the streamed frame is
* LANDSCAPE the panel auto-widens to a comfortable device-sized width —
* restoring the user's portrait width when the device rotates back, and never
* fighting a manual drag made during the landscape stint.
*
* "Landscape" is read straight off the frame's natural dimensions
* (`naturalWidth > naturalHeight`): an Android frame follows the display
* rotation, so there is no orientation vocabulary to track like dsh-ios had.
*
* Device switch: the panel's picker calls back through `onDeviceSwitched`;
* the surface replaces the open request with a capsule-style synthetic
* stream source (`androidSwitchedPanelRequestOf`, SAME request identity so
* the mounted panel — and its size/frame state — survives the swap) via
* `store.replaceOpen`, and keeps the panel-source registry entry in sync so
* reopening stays on the new device.
*/
/** Stable identity of one request — reopening the same call is a no-op. */
function androidPanelRequestKey(request) {
	return `${request.sessionId}\n${request.callId}\n${request.toolName}`;
}
/**
* Synthetic panel request for a switched device — the capsule-style source:
* SAME session/call/tool identity (so the panel's request key — and the
* mounted panel itself — never change: size/frame state and the in-flight
* seeded grant survive the swap), but the block carries the new device's
* `android-stream` meta, so panel meta follows the switch. The panel host
* replaces the open store request AND the source-registry entry with this, so
* closing/reopening (or a row click) stays on the new device.
*/
function androidSwitchedPanelRequestOf(request, result) {
	const block = {
		kind: "tool-result",
		seq: 1,
		time: Date.now(),
		callId: request.callId,
		call: {
			name: request.toolName,
			argsRaw: "{}"
		},
		callTime: Date.now(),
		content: [],
		isError: false,
		callView: null,
		resultView: null,
		subCalls: [],
		meta: androidSwitchedStreamMetaOf(result)
	};
	return {
		...request,
		block
	};
}
const ANDROID_BACKGROUND_STORAGE_PREFIX = "dsh-android:background:";
function storedBackgroundMode(sessionId) {
	if (typeof window === "undefined") return true;
	try {
		const value = window.localStorage.getItem(`${ANDROID_BACKGROUND_STORAGE_PREFIX}${sessionId}`);
		return value === null ? true : value === "true";
	} catch {
		return true;
	}
}
function persistBackgroundMode(sessionId, enabled) {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(`${ANDROID_BACKGROUND_STORAGE_PREFIX}${sessionId}`, String(enabled));
	} catch {}
}
/** Session-indexed external store deliberately not owned by any Tool card. */
function createAndroidPanelStore() {
	let activeSessionId = "";
	const requests = /* @__PURE__ */ new Map();
	const sizeModes = /* @__PURE__ */ new Map();
	const frameStyles = /* @__PURE__ */ new Map();
	const backgroundModes = /* @__PURE__ */ new Map();
	const listeners = /* @__PURE__ */ new Set();
	const emit = () => {
		for (const listener of listeners) listener();
	};
	const backgroundOf = (sessionId) => {
		let enabled = backgroundModes.get(sessionId);
		if (enabled === void 0) {
			enabled = storedBackgroundMode(sessionId);
			backgroundModes.set(sessionId, enabled);
		}
		return enabled;
	};
	return {
		getSnapshot: () => requests.get(activeSessionId),
		getActiveSessionId: () => activeSessionId,
		setActiveSession(sessionId) {
			if (activeSessionId === sessionId) return;
			activeSessionId = sessionId;
			backgroundOf(sessionId);
			emit();
		},
		getBackgroundMode: () => backgroundOf(activeSessionId),
		isBackgroundMode: (sessionId) => backgroundOf(sessionId),
		setBackgroundMode(enabled, sessionId = activeSessionId) {
			if (backgroundOf(sessionId) === enabled) return;
			backgroundModes.set(sessionId, enabled);
			persistBackgroundMode(sessionId, enabled);
			emit();
		},
		getSizeMode: () => sizeModes.get(activeSessionId) ?? ANDROID_PANEL_SIZE_MODE_FIT,
		setSizeMode(mode) {
			if ((sizeModes.get(activeSessionId) ?? ANDROID_PANEL_SIZE_MODE_FIT) === mode) return;
			sizeModes.set(activeSessionId, mode);
			emit();
		},
		getFrameStyle: () => frameStyles.get(activeSessionId) ?? "bezel",
		setFrameStyle(style) {
			if ((frameStyles.get(activeSessionId) ?? "bezel") === style) return;
			frameStyles.set(activeSessionId, style);
			emit();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		open(request) {
			if (activeSessionId === "") activeSessionId = request.sessionId;
			if (request.sessionId !== activeSessionId) return false;
			requests.set(request.sessionId, request);
			emit();
			return true;
		},
		replaceOpen(request) {
			if (request.sessionId !== activeSessionId || requests.get(request.sessionId) === void 0) return false;
			requests.set(request.sessionId, request);
			emit();
			return true;
		},
		close() {
			if (!requests.delete(activeSessionId)) return;
			emit();
		},
		reset() {
			requests.clear();
			sizeModes.clear();
			frameStyles.clear();
			emit();
		}
	};
}
let sharedPanelStore;
/**
* The one plugin-wide panel store instance. The page-owned panel host and the
* input-dock status capsule subscribe to the SAME instance, so the capsule
* can read the panel's open/closed state and open the panel itself. Created
* lazily so headless renders never touch it; `createAndroidPanelStore` stays
* exported for standalone tests.
*/
function androidPanelStore() {
	sharedPanelStore ??= createAndroidPanelStore();
	return sharedPanelStore;
}
const ANDROID_PANEL_FULLSCREEN_BREAKPOINT = 760;
/** Preserve Harness's two-tier workspace header (title/status + tabs). */
const ANDROID_PANEL_TOP_CLEARANCE = 84;
const ANDROID_PANEL_EDGE_GAP = 8;
const ANDROID_PANEL_MIN_WIDTH = 320;
const ANDROID_PANEL_MAX_WIDTH = 960;
const ANDROID_PANEL_LEFT_CLEARANCE = 640;
const ANDROID_PANEL_DEFAULT_WIDTH = 380;
/** Keep useful DSH conversation space while allowing a large landscape canvas. */
function androidPanelWidthBounds(viewportWidth) {
	const available = Math.max(0, (Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0) - 640);
	const max = Math.min(960, Math.max(320, available));
	const min = Math.min(320, max);
	return {
		min,
		max,
		initial: Math.min(max, Math.max(min, 380))
	};
}
function clampAndroidPanelWidth(width, viewportWidth) {
	const bounds = androidPanelWidthBounds(viewportWidth);
	const safeWidth = Number.isFinite(width) ? width : bounds.initial;
	return Math.min(bounds.max, Math.max(bounds.min, safeWidth));
}
/** A left-edge drag grows the docked panel as the pointer moves left. */
function resizedAndroidPanelWidth(startWidth, startClientX, clientX, viewportWidth) {
	return clampAndroidPanelWidth(startWidth + startClientX - clientX, viewportWidth);
}
/** Comfortable landscape display height the auto-widen target fits (px). */
const ANDROID_PANEL_LANDSCAPE_HEIGHT_PX = 420;
/** True while the streamed frame is wider than tall (a landscape stint). */
function androidPanelDisplayIsLandscape(naturalWidth, naturalHeight) {
	return typeof naturalWidth === "number" && typeof naturalHeight === "number" && Number.isFinite(naturalWidth) && Number.isFinite(naturalHeight) && naturalWidth > 0 && naturalHeight > 0 && naturalWidth > naturalHeight;
}
/**
* The comfortable landscape panel width: the width a landscape frame needs at
* ~420px of displayed height, falling back to the 412×915 phone aspect while
* no natural size is known, clamped into the live bounds and snapped to a
* whole CSS px.
*/
function androidPanelLandscapeTargetWidthOf(bounds, naturalWidth, naturalHeight) {
	const needed = 420 * (typeof naturalWidth === "number" && typeof naturalHeight === "number" && Number.isFinite(naturalWidth) && Number.isFinite(naturalHeight) && naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 915 / 412);
	return androidPanelSnapPxOf(Math.min(bounds.max, Math.max(bounds.min, needed)));
}
function androidPanelWidthStateInitial(preferred) {
	return {
		preferred,
		portraitWidth: void 0,
		landscape: void 0,
		naturalWidth: void 0,
		naturalHeight: void 0,
		userOverrode: false
	};
}
function androidPanelWidthStateNext(state, action) {
	switch (action.kind) {
		case "display": {
			const isLandscape = androidPanelDisplayIsLandscape(action.naturalWidth, action.naturalHeight);
			const next = {
				...state,
				landscape: isLandscape,
				naturalWidth: action.naturalWidth,
				naturalHeight: action.naturalHeight
			};
			if (state.landscape === isLandscape) return next;
			if (isLandscape) return {
				...next,
				portraitWidth: state.preferred,
				userOverrode: false
			};
			if (state.landscape === true) return {
				...next,
				preferred: state.portraitWidth ?? state.preferred,
				userOverrode: false
			};
			return next;
		}
		case "manual-width": return {
			...state,
			preferred: action.width,
			userOverrode: state.landscape === true ? true : state.userOverrode
		};
	}
}
/**
* The live panel width: the user's preference, auto-widened to the
* comfortable landscape target while the frame is landscape and the user has
* not manually sized the panel during this stint, then clamped into the
* current viewport bounds.
*/
function androidPanelEffectiveWidth(state, viewportWidth) {
	if (state.landscape !== true || state.userOverrode) return clampAndroidPanelWidth(state.preferred, viewportWidth);
	const target = androidPanelLandscapeTargetWidthOf(androidPanelWidthBounds(viewportWidth), state.naturalWidth, state.naturalHeight);
	return clampAndroidPanelWidth(Math.max(state.preferred, target), viewportWidth);
}
/**
* Surface chrome over the DSH theme tokens openpencil's editor panel uses
* (`--dsw-alias-*`). Only the overlay scrim keeps a literal color (a dim over
* the page in both themes).
*/
const surfaceStyles = {
	surface: {
		position: "fixed",
		top: 84,
		right: 8,
		bottom: 8,
		zIndex: 1200,
		display: "flex",
		flexDirection: "column",
		overflow: "hidden",
		color: "var(--dsw-alias-label-primary)",
		background: "var(--dsw-alias-bg-base)",
		border: "1px solid var(--dsw-alias-border-l2)",
		borderRadius: 12,
		boxShadow: "0 16px 48px rgba(0,0,0,0.32)"
	},
	handle: {
		position: "absolute",
		top: 0,
		bottom: 0,
		left: -6,
		width: 12,
		cursor: "ew-resize",
		zIndex: 2,
		display: "flex",
		alignItems: "center",
		justifyContent: "center"
	},
	handleBar: {
		width: 3,
		height: 32,
		borderRadius: 99,
		background: "var(--dsw-alias-border-l2)"
	},
	backdrop: {
		position: "fixed",
		inset: 0,
		zIndex: 1200,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		padding: 16,
		background: "rgba(0,0,0,0.55)"
	},
	overlayCard: {
		maxWidth: "100%",
		maxHeight: "100%",
		display: "flex",
		flexDirection: "column",
		overflow: "hidden",
		borderRadius: 12,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "var(--dsw-alias-bg-base)",
		boxShadow: "0 24px 80px rgba(0,0,0,0.45)"
	}
};
/**
* The fixed right-hand surface floats below Harness's workspace header; a
* centered modal is reserved for genuinely narrow viewports. Resize drags the
* left edge without mutating Harness layout; Escape closes.
*/
function AndroidPanelSurface({ request, store, colorScheme, locale, sizeMode, onSizeModeChange, frameStyle, onFrameStyleChange, onClose }) {
	const copy = androidCopy(locale === "zh" ? "zh" : "en");
	const surfaceRef = (0, react.useRef)(null);
	const [viewportWidth, setViewportWidth] = (0, react.useState)(() => window.innerWidth);
	const backgroundMode = (0, react.useSyncExternalStore)(store.subscribe, store.getBackgroundMode, store.getBackgroundMode);
	const [widthState, dispatchWidth] = (0, react.useReducer)(androidPanelWidthStateNext, androidPanelWidthBounds(window.innerWidth).initial, androidPanelWidthStateInitial);
	const fullscreen = viewportWidth < 760;
	const bounds = androidPanelWidthBounds(viewportWidth);
	const width = androidPanelEffectiveWidth(widthState, viewportWidth);
	const handleDisplayChange = (0, react.useCallback)((display) => {
		dispatchWidth({
			kind: "display",
			...display.naturalWidth === void 0 ? {} : { naturalWidth: display.naturalWidth },
			...display.naturalHeight === void 0 ? {} : { naturalHeight: display.naturalHeight }
		});
	}, []);
	const handleDeviceSwitched = (0, react.useCallback)((result) => {
		const next = androidSwitchedPanelRequestOf(request, result);
		store.replaceOpen(next);
		registerAndroidPanelSource({
			sessionId: next.sessionId,
			callId: next.callId,
			toolName: next.toolName,
			block: next.block
		});
	}, [request, store]);
	(0, react.useEffect)(() => {
		const onResize = () => {
			setViewportWidth(window.innerWidth);
		};
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
		};
	}, []);
	(0, react.useEffect)(() => {
		const onKeyDown = (event) => {
			if (event.key !== "Escape") return;
			const surface = surfaceRef.current;
			if (!(event.target instanceof Node && surface?.contains(event.target) === true) && !fullscreen) return;
			onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [fullscreen, onClose]);
	const startResize = (0, react.useCallback)((event) => {
		if (fullscreen) return;
		event.preventDefault();
		const handle = event.currentTarget;
		const pointerId = event.pointerId;
		let liveWidth = width;
		let appliedClientX = event.clientX;
		const previousCursor = document.body.style.cursor;
		const previousUserSelect = document.body.style.userSelect;
		document.body.style.cursor = "ew-resize";
		document.body.style.userSelect = "none";
		try {
			handle.setPointerCapture(pointerId);
		} catch {}
		let stopped = false;
		const applyWidth = (clientX) => {
			liveWidth = resizedAndroidPanelWidth(liveWidth, appliedClientX, clientX, window.innerWidth);
			appliedClientX = clientX;
			if (surfaceRef.current !== null) surfaceRef.current.style.width = `${liveWidth}px`;
		};
		const cleanup = () => {
			if (stopped) return;
			stopped = true;
			window.removeEventListener("pointermove", onMove, true);
			window.removeEventListener("pointerup", onEnd, true);
			window.removeEventListener("pointercancel", onCancel, true);
			window.removeEventListener("blur", onBlur);
			try {
				if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
			} catch {}
			document.body.style.cursor = previousCursor;
			document.body.style.userSelect = previousUserSelect;
		};
		const finish = () => {
			if (stopped) return;
			cleanup();
			dispatchWidth({
				kind: "manual-width",
				width: liveWidth
			});
		};
		const onMove = (moveEvent) => {
			if (moveEvent.pointerId !== pointerId) return;
			applyWidth(moveEvent.clientX);
		};
		const onEnd = (endEvent) => {
			if (endEvent.pointerId === pointerId) finish();
		};
		const onCancel = (cancelEvent) => {
			if (cancelEvent.pointerId === pointerId) finish();
		};
		const onBlur = () => {
			finish();
		};
		window.addEventListener("pointermove", onMove, true);
		window.addEventListener("pointerup", onEnd, true);
		window.addEventListener("pointercancel", onCancel, true);
		window.addEventListener("blur", onBlur);
	}, [fullscreen, width]);
	const handleBackgroundModeChange = (0, react.useCallback)((enabled) => {
		store.setBackgroundMode(enabled, request.sessionId);
		if (enabled) onClose();
	}, [
		store,
		request.sessionId,
		onClose
	]);
	const panel = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidPanel, {
		toolName: request.toolName,
		block: request.block,
		sessionId: request.sessionId,
		colorScheme,
		locale: locale === "zh" ? "zh" : "en",
		onClose,
		backgroundMode,
		onBackgroundModeChange: handleBackgroundModeChange,
		sizeMode,
		onSizeModeChange,
		frameStyle,
		onFrameStyleChange,
		onDisplayChange: handleDisplayChange,
		onDeviceSwitched: handleDeviceSwitched
	}, androidPanelRequestKey(request));
	if (fullscreen) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		style: surfaceStyles.backdrop,
		role: "presentation",
		"data-android-panel-surface": "overlay",
		onMouseDown: (event) => {
			if (event.target === event.currentTarget) onClose();
		},
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: {
				...surfaceStyles.overlayCard,
				width
			},
			role: "dialog",
			"aria-modal": "true",
			"aria-label": copy.android,
			children: panel
		})
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		ref: surfaceRef,
		style: {
			...surfaceStyles.surface,
			width
		},
		"data-android-panel-surface": "floating",
		"data-android-panel-top-clearance": String(84),
		role: "complementary",
		"aria-label": copy.android,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: surfaceStyles.handle,
			role: "separator",
			"aria-orientation": "vertical",
			"aria-label": copy.resizePanel,
			"aria-valuemin": bounds.min,
			"aria-valuemax": bounds.max,
			"aria-valuenow": Math.round(width),
			onPointerDown: startResize,
			onDoubleClick: () => {
				dispatchWidth({
					kind: "manual-width",
					width: androidPanelWidthBounds(window.innerWidth).initial
				});
			},
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: surfaceStyles.handleBar,
				"aria-hidden": "true"
			})
		}), panel]
	});
}
function AndroidPanelHostView({ store, subscribeTheme, getColorScheme, subscribeLocale, getLocale, close }) {
	const request = (0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
	const sizeMode = (0, react.useSyncExternalStore)(store.subscribe, store.getSizeMode, store.getSizeMode);
	const frameStyle = (0, react.useSyncExternalStore)(store.subscribe, store.getFrameStyle, store.getFrameStyle);
	const colorScheme = (0, react.useSyncExternalStore)(subscribeTheme, getColorScheme, getColorScheme);
	const locale = (0, react.useSyncExternalStore)(subscribeLocale, getLocale, getLocale);
	if (request === void 0) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidPanelSurface, {
		request,
		store,
		colorScheme,
		locale,
		sizeMode,
		onSizeModeChange: store.setSizeMode,
		frameStyle,
		onFrameStyleChange: store.setFrameStyle,
		onClose: close
	});
}
let nextHostId = 0;
/**
* Mount one imperative React root for the whole plugin panel (mirrors
* openpencil's `mountEditorWorkbenchHost`). Safe to call only in a browser;
* the options surface lets a headless embed pass its own document.
*/
function mountAndroidPanelHost(options) {
	const ownerDocument = options.document ?? document;
	const hostId = `dsh-android-panel-${++nextHostId}`;
	const container = ownerDocument.createElement("div");
	container.dataset.androidPanelHost = hostId;
	ownerDocument.body.append(container);
	const style = ownerDocument.createElement("style");
	style.dataset.dshAndroidPanelKeyframes = "true";
	style.textContent = ANDROID_DEVICE_PICKER_KEYFRAMES;
	ownerDocument.head.append(style);
	let root = (0, react_dom_client.createRoot)(container);
	let destroyed = false;
	const store = androidPanelStore();
	const close = () => {
		store.close();
	};
	const destroy = () => {
		if (destroyed) return;
		destroyed = true;
		store.reset();
		root?.unmount();
		root = void 0;
		container.remove();
		style.remove();
	};
	root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidPanelHostView, {
		store,
		subscribeTheme: options.subscribeTheme,
		getColorScheme: options.getColorScheme,
		subscribeLocale: options.subscribeLocale,
		getLocale: options.getLocale,
		close
	}));
	return {
		open(request) {
			if (destroyed) return false;
			return store.open(request);
		},
		openIfIdle(request) {
			if (destroyed || store.getActiveSessionId() !== request.sessionId || store.isBackgroundMode(request.sessionId) || store.getSnapshot() !== void 0) return false;
			return store.open(request);
		},
		close() {
			if (destroyed) return;
			close();
		},
		dispose() {
			destroy();
		}
	};
}
//#endregion
//#region src/client/android-status-capsule.tsx
/**
* Stream-status capsule for the composer input dock
* (`conversation.input.dock`, the same seat openpencil's selection chip uses).
*
* While the device panel is CLOSED and a device stream is online, the capsule
* renders a small pill above the message input box: green dot + device name +
* "实时". (A gray idle variant is deliberately NOT rendered — the capsule only
* appears while a stream is actually running.) Clicking the pill opens the
* sidebar panel for the streamed device via the SAME panel store the panel
* host uses; the panel's existing grant flow does the rest.
*
* SESSION GATE: the dock seat is session-scoped, so the framework hands this
* component the current `sessionId`. The capsule renders AND polls only while
* that session has at least one registered panel source (a settled Android
* result whose card is mounted in THIS session). A brand-new empty session has
* no sources, so the pill never shows there even though the global stream
* keeps running; the status poll likewise never starts. Sources unregister on
* card unmount, so switching to an unrelated session hides the capsule and
* stops the poll.
*
* Stream knowledge comes from the read-only host route
* `POST /_dsh/dsh-android/status` (`{running, serial?, deviceName?}`), polled
* every ~5 s while gated on and the panel is closed. Polling stops while the
* panel is open, refreshes immediately (debounced) when a tool result lands in
* the panel-source registry, and fully cleans up on unmount. The poll loop
* lives in `createAndroidStatusPoller` — a timer-injectable controller the
* static smoke drives with a fake clock to prove the fetcher is never called
* while the session has no sources.
*/
/** Capsule polling cadence while the panel is closed. */
const ANDROID_STATUS_POLL_MS = 5e3;
/** Debounce for the panel-source-registry refresh (registration bursts). */
const ANDROID_STATUS_REFRESH_DEBOUNCE_MS = 150;
/** The browser default: POST the read-only host status route. */
function fetchAndroidStreamStatus(sessionId) {
	return requestAndroidStatus(fetch, { sessionId });
}
/**
* Build the synthetic `android-stream` panel request for a streamed device: a
* settled `android_boot`-shaped block whose presentationMeta carries the
* device, so the panel's stream mode + grant flow take over from there. The
* request is tagged with the session the capsule was clicked in.
*/
function androidStreamStatusRequestOf(status, sessionId = "") {
	const device = {
		...status.serial === void 0 ? {} : { serial: status.serial },
		...status.deviceName === void 0 ? {} : { name: status.deviceName }
	};
	const callId = `dsh-android:status:${status.serial ?? "stream"}`;
	const block = {
		kind: "tool-result",
		seq: 1,
		time: Date.now(),
		callId,
		call: {
			name: ANDROID_CARD_TOOLS.boot,
			argsRaw: "{}"
		},
		callTime: Date.now(),
		content: [],
		isError: false,
		callView: null,
		resultView: null,
		subCalls: [],
		meta: {
			kind: "android-stream",
			device
		}
	};
	return {
		sessionId,
		callId,
		toolName: ANDROID_CARD_TOOLS.boot,
		block
	};
}
function defaultPollTimers() {
	return {
		setInterval: (fn, ms) => setInterval(fn, ms),
		clearInterval: (handle) => {
			clearInterval(handle);
		},
		setTimeout: (fn, ms) => setTimeout(fn, ms),
		clearTimeout: (handle) => {
			clearTimeout(handle);
		}
	};
}
/**
* The capsule's poll loop as a small stateful controller: `setEnabled(true)`
* starts an immediate poll + an interval; `setEnabled(false)` stops both and
* drops any in-flight result; `refreshSoon()` schedules one debounced poll
* (registry changes) and no-ops while disabled. Fully deterministic under an
* injected timer for the static smoke — the fetcher is never called until the
* capsule is actually gated on.
*/
function createAndroidStatusPoller(options) {
	const { fetchStatus, pollIntervalMs, onStatus } = options;
	const refreshDebounceMs = options.refreshDebounceMs ?? 150;
	const timers = options.timers ?? defaultPollTimers();
	let enabled = false;
	let disposed = false;
	let inflight = false;
	let intervalHandle;
	let debounceHandle;
	const poll = async () => {
		if (!enabled || disposed || inflight) return;
		inflight = true;
		try {
			const next = await fetchStatus();
			if (enabled && !disposed) onStatus(next);
		} catch {} finally {
			inflight = false;
		}
	};
	return {
		setEnabled(next) {
			if (disposed || next === enabled) return;
			enabled = next;
			if (enabled) {
				poll();
				intervalHandle = timers.setInterval(() => {
					poll();
				}, pollIntervalMs);
			} else {
				if (intervalHandle !== void 0) {
					timers.clearInterval(intervalHandle);
					intervalHandle = void 0;
				}
				if (debounceHandle !== void 0) {
					timers.clearTimeout(debounceHandle);
					debounceHandle = void 0;
				}
			}
		},
		refreshSoon() {
			if (!enabled || disposed) return;
			if (debounceHandle !== void 0) timers.clearTimeout(debounceHandle);
			debounceHandle = timers.setTimeout(() => {
				debounceHandle = void 0;
				poll();
			}, refreshDebounceMs);
		},
		dispose() {
			disposed = true;
			if (intervalHandle !== void 0) timers.clearInterval(intervalHandle);
			if (debounceHandle !== void 0) timers.clearTimeout(debounceHandle);
			intervalHandle = void 0;
			debounceHandle = void 0;
		}
	};
}
const CAPSULE_DOCK_LAYOUT = {
	boxSizing: "border-box",
	display: "flex",
	width: "calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))",
	maxWidth: "calc(var(--dsh-composer-card-max-width, 780px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))",
	margin: "0 auto"
};
/**
* The pill tracks the DSH theme with the same tokens openpencil's selection
* chip uses in this exact seat (`--dsw-alias-*`), so it is legible in both
* light and dark themes — only the green dot keeps a literal color.
*/
const CAPSULE_PILL_STYLES = {
	display: "inline-flex",
	alignItems: "center",
	gap: 7,
	maxWidth: "100%",
	padding: "4px 12px",
	borderRadius: 999,
	border: "1px solid var(--dsw-alias-border-l2)",
	background: "var(--dsw-alias-bg-layer-1)",
	color: "var(--dsw-alias-label-primary)",
	cursor: "pointer",
	font: "inherit",
	fontSize: 12,
	lineHeight: "18px",
	textAlign: "left"
};
const CAPSULE_DOT_STYLES = {
	width: 8,
	height: 8,
	flex: "none",
	borderRadius: "50%",
	background: "#22c55e",
	boxShadow: "0 0 8px rgba(34,197,94,0.8)"
};
/**
* Pure capsule presentation: null when the panel is open, the current session
* has no Android sources, or the stream is not running; otherwise a green-dot
* pill with the device name + 实时 that opens the panel on click. Exported for
* static (SSR) smoke tests.
*/
function AndroidStatusCapsuleBody({ status, panelOpen, hasAndroidSources, locale, onOpen }) {
	const copy = androidCopy(locale);
	if (panelOpen || !hasAndroidSources || status === void 0 || status.running !== true) return null;
	const deviceLabel = status.deviceName ?? status.serial ?? copy.android;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		style: CAPSULE_DOCK_LAYOUT,
		"data-android-status-capsule-slot": "true",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			style: CAPSULE_PILL_STYLES,
			onClick: onOpen,
			"aria-label": copy.openAndroidPanel,
			"data-android-status-capsule": "live",
			...status.serial === void 0 ? {} : { "data-android-status-device": status.serial },
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: CAPSULE_DOT_STYLES,
				"aria-hidden": "true"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: {
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap"
				},
				children: `${deviceLabel} · ${copy.live}`
			})]
		})
	});
}
/**
* Connected capsule: subscribes to the shared panel store (panel open/close)
* and to the panel-source registry (session gate), polls the status fetcher
* only while the panel is closed AND the current session has Android sources,
* and opens the panel on click.
*/
function AndroidStatusCapsule({ store = androidPanelStore(), fetchStatus = fetchAndroidStreamStatus, pollIntervalMs = ANDROID_STATUS_POLL_MS, locale, sessionId = "" }) {
	(0, react.useLayoutEffect)(() => {
		store.setActiveSession(sessionId);
	}, [store, sessionId]);
	const request = (0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
	const backgroundMode = (0, react.useSyncExternalStore)(store.subscribe, store.getBackgroundMode, store.getBackgroundMode);
	const panelOpen = request !== void 0;
	const hasSources = (0, react.useSyncExternalStore)(subscribeAndroidPanelSources, androidPanelSourcesVersion, androidPanelSourcesVersion) >= 0 && hasAndroidPanelSourceForSession(sessionId);
	const [status, setStatus] = (0, react.useState)();
	const fetchRef = (0, react.useRef)(fetchStatus);
	fetchRef.current = fetchStatus;
	const sessionIdRef = (0, react.useRef)(sessionId);
	sessionIdRef.current = sessionId;
	const statusRef = (0, react.useRef)(status);
	statusRef.current = status;
	const pollingEnabled = !backgroundMode && !panelOpen && hasSources;
	(0, react.useEffect)(() => {
		const poller = createAndroidStatusPoller({
			fetchStatus: () => fetchRef.current(sessionIdRef.current),
			pollIntervalMs,
			onStatus: setStatus
		});
		poller.setEnabled(pollingEnabled);
		const unsubscribeSources = subscribeAndroidPanelSources(() => {
			poller.refreshSoon();
		});
		return () => {
			unsubscribeSources();
			poller.dispose();
		};
	}, [pollingEnabled, pollIntervalMs]);
	const onOpen = (0, react.useCallback)(() => {
		const current = statusRef.current;
		if (current === void 0 || current.running !== true) return;
		store.open(androidStreamStatusRequestOf(current, sessionIdRef.current));
	}, [store]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidStatusCapsuleBody, {
		status: backgroundMode ? void 0 : status,
		panelOpen,
		hasAndroidSources: !backgroundMode && hasSources,
		locale,
		onOpen
	});
}
//#endregion
//#region src/client/android-panel-dock.ts
/**
* Self-contained DSH layout push used by the dsh-android device panel host.
*
* Mirrors dsh-openpencil's `claimEditorWorkbenchDock` exactly: DSH's root is
* an auto-width block, so a right margin shrinks its AppFrame grid instead of
* covering the conversation. Ownership is recorded through a dedicated data
* attribute and the exact inline-style values are restored on release, which
* keeps this compatible with HMR and fail-closed around another plugin that
* already owns the root margin (including openpencil's own workbench dock).
*/
const ANDROID_PANEL_DOCK_ATTRIBUTE = "dshAndroidPanelDockOwner";
/**
* How much of the viewport a foreign sidebar may occupy before stacking
* beside it stops making sense and the overlay fallback takes over.
*/
const ANDROID_DOCK_MAX_FOREIGN_FRACTION = .6;
/**
* Reserve real layout space for the fixed right-hand device panel.
*
* A pre-existing root margin used to fail the claim outright, which turned
* every third-party sidebar (dsh-better-sidebar was the report, #2) into a
* modal-overlay experience. A foreign margin is now COEXISTED with instead:
* the lease treats it as a fixed right-edge offset, reserves
* `offset + width` through the root margin, and the surface docks at
* `right: offset` — the device panel sits immediately left of the other
* sidebar. The offset is a claim-time snapshot; a foreign sidebar that
* resizes itself afterwards is out of scope for this lease (close/reopen
* the panel to re-measure).
*
* @param root - the app root element (`#root`) the panel pushes over.
* @param owner - stable lease owner id; a different owner of OUR attribute
*   makes the claim fail (the surface falls back to its overlay variant).
* @param initialWidth - panel width in px reserved through the root margin.
* @param computedMarginRight - current computed margin-right (0 = unclaimed).
* @param viewportWidth - used to refuse coexistence when the foreign sidebar
*   already occupies most of the screen.
* @returns the lease, or undefined when the claim cannot be satisfied.
*/
function claimAndroidPanelDock(root, owner, initialWidth, computedMarginRight = 0, viewportWidth = Number.POSITIVE_INFINITY) {
	const existingOwner = root.dataset[ANDROID_PANEL_DOCK_ATTRIBUTE];
	if (existingOwner !== void 0 && existingOwner !== owner) return void 0;
	const foreign = existingOwner === void 0 && Number.isFinite(computedMarginRight) && computedMarginRight > .5 ? Math.round(computedMarginRight) : 0;
	if (foreign > 0 || foreign > viewportWidth * .6) return void 0;
	root.dataset[ANDROID_PANEL_DOCK_ATTRIBUTE] = owner;
	let released = false;
	const update = (_width) => {
		if (released || root.dataset["dshAndroidPanelDockOwner"] !== owner) return;
	};
	const release = () => {
		if (released) return;
		released = true;
		if (root.dataset["dshAndroidPanelDockOwner"] !== owner) return;
		delete root.dataset[ANDROID_PANEL_DOCK_ATTRIBUTE];
	};
	update(initialWidth);
	return {
		update,
		release,
		offset: foreign
	};
}
//#endregion
//#region src/client/index.tsx
/**
* Browser presentation for the dsh-android device tools.
*
* Registers `tool.call.toolview` slots for the four tools that emit visual
* presentationMeta (`android_boot`, `android_screenshot`, `android_interact`,
* `android_build_run`); every other tool keeps the default generic card. Each
* registered view is wrapped in an error boundary so a throwing slot component
* never takes down the conversation, and theme/locale are synced through the
* host services exactly like dsh-openpencil/dsh-ios.
*
* The device display lives ONLY in the persistent right-side panel
* (Codex-style): the per-tool `tool.details.toolview` details seat is
* registered through the same `ctx.slots.inject` guard dsh-openpencil uses, so
* a future DSH runtime that declares it gets the native details surface for
* free. The installed rc.6 runtime does NOT declare that seat, so on rc.6 the
* plugin mounts its own page-owned right panel host and opens it when the user
* clicks a device tool row. The row-click trigger steps aside if the details
* seat ever gets declared. Inline tool cards are compact one-line summaries
* (title, device, badge, "open in sidebar" cue) with NO imagery.
*
* A stream-status capsule is registered in the `conversation.input.dock` slot:
* while the panel is closed and a device stream is online it renders a small
* pill above the input box that opens the panel for the streamed device.
*
* Nested Code Mode (PTC) calls never carry `presentationMeta` (the harness
* projects it only for top-level calls). The cards and the panel instead
* reconstruct the identical meta from the settled result's durable JSON text
* via `android-meta-hydrate.ts`; standard-mode sessions are untouched.
*/
/** Required client services. */
const inject = [
	"slots",
	"theme",
	"locale"
];
function subscribeThemeOf(ctx) {
	return (notify) => ctx.on("theme/change", notify);
}
function getColorSchemeOf(ctx) {
	return () => ctx.theme.getTheme().active.colorScheme;
}
function subscribeLocaleOf(ctx) {
	return (notify) => ctx.on("locale/change", notify);
}
function getLocaleOf(ctx) {
	return () => ctx.locale.getLocale().active;
}
function hostSyncedCard(ctx, Card, autoOpen) {
	const subscribeTheme = subscribeThemeOf(ctx);
	const getColorScheme = getColorSchemeOf(ctx);
	const subscribeLocale = subscribeLocaleOf(ctx);
	const getLocale = getLocaleOf(ctx);
	const HostSyncedCard = (props) => {
		const colorScheme = (0, react.useSyncExternalStore)(subscribeTheme, getColorScheme, getColorScheme);
		const locale = (0, react.useSyncExternalStore)(subscribeLocale, getLocale, getLocale);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidCardBoundary, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, {
			...props,
			colorScheme,
			locale,
			autoOpen
		}) });
	};
	return HostSyncedCard;
}
/** Register one `tool.call.toolview` slot per tool name (openpencil shape). */
function registerCard(ctx, toolName, Card, autoOpen) {
	ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
		name: "tool.call.toolview",
		key: toolName
	}, hostSyncedCard(ctx, Card, autoOpen)));
}
function hostSyncedDetailsPanel(ctx) {
	const subscribeTheme = subscribeThemeOf(ctx);
	const getColorScheme = getColorSchemeOf(ctx);
	const subscribeLocale = subscribeLocaleOf(ctx);
	const getLocale = getLocaleOf(ctx);
	const HostSyncedDetailsPanel = (props) => {
		const colorScheme = (0, react.useSyncExternalStore)(subscribeTheme, getColorScheme, getColorScheme);
		const locale = (0, react.useSyncExternalStore)(subscribeLocale, getLocale, getLocale);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidCardBoundary, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidDetailsPanel, {
			...props,
			colorScheme,
			locale
		}) });
	};
	return HostSyncedDetailsPanel;
}
/** Register one per-tool `tool.details.toolview` slot (openpencil shape). */
function registerDetailsPanel(ctx, toolName, onDetailsSlotDeclared) {
	ctx.slots.inject("tool.details.toolview", () => {
		return [ctx.slots.register({
			name: "tool.details.toolview",
			key: toolName
		}, hostSyncedDetailsPanel(ctx)), onDetailsSlotDeclared()];
	});
}
function hostSyncedStatusCapsule(ctx) {
	const subscribeLocale = subscribeLocaleOf(ctx);
	const getLocale = getLocaleOf(ctx);
	const HostSyncedStatusCapsule = (props) => {
		const locale = (0, react.useSyncExternalStore)(subscribeLocale, getLocale, getLocale);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AndroidStatusCapsule, {
			locale: locale === "zh" ? "zh" : "en",
			sessionId: String(props.sessionId)
		});
	};
	return HostSyncedStatusCapsule;
}
const PANEL_TOOLS = [
	ANDROID_CARD_TOOLS.boot,
	ANDROID_CARD_TOOLS.buildRun,
	ANDROID_CARD_TOOLS.interact,
	ANDROID_CARD_TOOLS.screenshot
];
/** Register canonical views plus the resident device panel surfaces. */
function apply(ctx) {
	let panelHost;
	let rowTriggerDispose;
	const detailsSlotDeclared = () => ctx.slots.spec("tool.details.toolview") !== void 0;
	const autoOpenSource = (source) => {
		panelHost?.openIfIdle(source);
	};
	registerCard(ctx, ANDROID_CARD_TOOLS.boot, AndroidStreamCard, autoOpenSource);
	registerCard(ctx, ANDROID_CARD_TOOLS.screenshot, AndroidScreenshotCard);
	registerCard(ctx, ANDROID_CARD_TOOLS.interact, AndroidScreenshotCard);
	registerCard(ctx, ANDROID_CARD_TOOLS.buildRun, AndroidBuildRunCard);
	const stepFallbackAside = () => {
		rowTriggerDispose?.();
		rowTriggerDispose = void 0;
		panelHost?.close();
		return () => {};
	};
	for (const toolName of PANEL_TOOLS) registerDetailsPanel(ctx, toolName, stepFallbackAside);
	ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
		name: "conversation.input.dock",
		id: "dsh-android-status",
		order: 40
	}, hostSyncedStatusCapsule(ctx)));
	if (typeof document !== "undefined") ctx.effect(() => {
		panelHost = mountAndroidPanelHost({
			subscribeTheme: subscribeThemeOf(ctx),
			getColorScheme: getColorSchemeOf(ctx),
			subscribeLocale: subscribeLocaleOf(ctx),
			getLocale: getLocaleOf(ctx)
		});
		if (!detailsSlotDeclared()) rowTriggerDispose = installAndroidPanelRowTrigger(document, (source) => panelHost?.open(source) ?? false);
		let disposeDeviceCenter;
		const openNewestAndroidSource = () => {
			const sources = androidPanelSourcesSnapshot();
			const source = sources[sources.length - 1];
			if (source !== void 0) panelHost?.open(source);
		};
		const syncDeviceCenter = () => {
			const api = window.__HARNESS_DESKTOP_DEVICE_CENTER__;
			if (api === void 0) return;
			const connected = androidPanelSourcesSnapshot().length > 0;
			const statusPatch = {
				status: connected ? "connected" : "idle",
				statusLabel: connected ? { zh: "已连接", en: "Connected" } : { zh: "未连接", en: "Disconnected" }
			};
			if (disposeDeviceCenter === void 0) disposeDeviceCenter = api.registerProvider({
				id: "android",
				kind: "android",
				order: 20,
				surface: "external",
				label: { zh: "Android 设备", en: "Android device" },
				detail: { zh: "ADB 真机与用户已有模拟器", en: "ADB phones and user-installed emulators" },
				...statusPatch,
				activate: openNewestAndroidSource
			});
			else api.updateProvider("android", statusPatch);
		};
		const unsubscribeSources = subscribeAndroidPanelSources(syncDeviceCenter);
		window.addEventListener("harness-desktop:device-center-ready", syncDeviceCenter);
		window.addEventListener("harness-desktop:android-panel-open-request", openNewestAndroidSource);
		syncDeviceCenter();
		return () => {
			window.removeEventListener("harness-desktop:device-center-ready", syncDeviceCenter);
			window.removeEventListener("harness-desktop:android-panel-open-request", openNewestAndroidSource);
			unsubscribeSources();
			disposeDeviceCenter?.();
			rowTriggerDispose?.();
			rowTriggerDispose = void 0;
			panelHost?.dispose();
			panelHost = void 0;
		};
	}, "dsh-android: device panel host");
}
//#endregion
exports.ANDROID_BUTTONS = ANDROID_BUTTONS;
exports.ANDROID_CAPTURE_CONFIRM_MS = ANDROID_CAPTURE_CONFIRM_MS;
exports.ANDROID_CARD_TOOLS = ANDROID_CARD_TOOLS;
exports.ANDROID_DEVICE_ACTIONS = ANDROID_DEVICE_ACTIONS;
exports.ANDROID_DEVICE_KIND_ICON_PATHS = ANDROID_DEVICE_KIND_ICON_PATHS;
exports.ANDROID_DEVICE_MENU_ACTIONS = ANDROID_DEVICE_MENU_ACTIONS;
exports.ANDROID_DEVICE_MENU_ICON_PATHS = ANDROID_DEVICE_MENU_ICON_PATHS;
exports.ANDROID_DEVICE_MENU_STYLES = ANDROID_DEVICE_MENU_STYLES;
exports.ANDROID_DEVICE_PICKER_KEYFRAMES = ANDROID_DEVICE_PICKER_KEYFRAMES;
exports.ANDROID_DEVICE_PICKER_STYLES = ANDROID_DEVICE_PICKER_STYLES;
exports.ANDROID_DOCK_MAX_FOREIGN_FRACTION = ANDROID_DOCK_MAX_FOREIGN_FRACTION;
exports.ANDROID_DRAG_DURATION_MAX_S = ANDROID_DRAG_DURATION_MAX_S;
exports.ANDROID_DRAG_DURATION_MIN_S = ANDROID_DRAG_DURATION_MIN_S;
exports.ANDROID_DRAG_MOVE_SAMPLE_MS = ANDROID_DRAG_MOVE_SAMPLE_MS;
exports.ANDROID_FOLLOW_INDICATOR_STYLES = ANDROID_FOLLOW_INDICATOR_STYLES;
exports.ANDROID_FRAME_BEZEL_SHELL = ANDROID_FRAME_BEZEL_SHELL;
exports.ANDROID_FRAME_DEVICE_SHELL = ANDROID_FRAME_DEVICE_SHELL;
exports.ANDROID_FRAME_RADIUS_FALLBACK_PX = ANDROID_FRAME_RADIUS_FALLBACK_PX;
exports.ANDROID_FRAME_SCREEN_RADIUS_RATIO = ANDROID_FRAME_SCREEN_RADIUS_RATIO;
exports.ANDROID_FRAME_SHELL_BORDER_PX = ANDROID_FRAME_SHELL_BORDER_PX;
exports.ANDROID_FRAME_STYLE_BEZEL = ANDROID_FRAME_STYLE_BEZEL;
exports.ANDROID_FRAME_STYLE_OPTIONS = ANDROID_FRAME_STYLE_OPTIONS;
exports.ANDROID_PANEL_AUTO_OPEN_TOOLS = ANDROID_PANEL_AUTO_OPEN_TOOLS;
exports.ANDROID_PANEL_DEFAULT_WIDTH = ANDROID_PANEL_DEFAULT_WIDTH;
exports.ANDROID_PANEL_DEVICE_SCALE_FALLBACK = ANDROID_PANEL_DEVICE_SCALE_FALLBACK;
exports.ANDROID_PANEL_DOCK_ATTRIBUTE = ANDROID_PANEL_DOCK_ATTRIBUTE;
exports.ANDROID_PANEL_EDGE_GAP = ANDROID_PANEL_EDGE_GAP;
exports.ANDROID_PANEL_FALLBACK_LOGICAL_HEIGHT = ANDROID_PANEL_FALLBACK_LOGICAL_HEIGHT;
exports.ANDROID_PANEL_FALLBACK_LOGICAL_WIDTH = ANDROID_PANEL_FALLBACK_LOGICAL_WIDTH;
exports.ANDROID_PANEL_FOLLOW_DEBOUNCE_MS = ANDROID_PANEL_FOLLOW_DEBOUNCE_MS;
exports.ANDROID_PANEL_FULLSCREEN_BREAKPOINT = ANDROID_PANEL_FULLSCREEN_BREAKPOINT;
exports.ANDROID_PANEL_INTERACTIVE_SELECTOR = ANDROID_PANEL_INTERACTIVE_SELECTOR;
exports.ANDROID_PANEL_LANDSCAPE_HEIGHT_PX = ANDROID_PANEL_LANDSCAPE_HEIGHT_PX;
exports.ANDROID_PANEL_LEFT_CLEARANCE = ANDROID_PANEL_LEFT_CLEARANCE;
exports.ANDROID_PANEL_MAX_WIDTH = ANDROID_PANEL_MAX_WIDTH;
exports.ANDROID_PANEL_MIN_WIDTH = ANDROID_PANEL_MIN_WIDTH;
exports.ANDROID_PANEL_PERCENT_OPTIONS = ANDROID_PANEL_PERCENT_OPTIONS;
exports.ANDROID_PANEL_PRESET_OPTIONS = ANDROID_PANEL_PRESET_OPTIONS;
exports.ANDROID_PANEL_QUICK_SIZE_OPTIONS = ANDROID_PANEL_QUICK_SIZE_OPTIONS;
exports.ANDROID_PANEL_SIZE_MODE_FIT = ANDROID_PANEL_SIZE_MODE_FIT;
exports.ANDROID_PANEL_SIZE_OPTIONS = ANDROID_PANEL_SIZE_OPTIONS;
exports.ANDROID_PANEL_TOP_CLEARANCE = ANDROID_PANEL_TOP_CLEARANCE;
exports.ANDROID_SELECT_ACTIVE_BG = ANDROID_SELECT_ACTIVE_BG;
exports.ANDROID_SELECT_HOVER_BG = ANDROID_SELECT_HOVER_BG;
exports.ANDROID_SELECT_MARKER_COLORS = ANDROID_SELECT_MARKER_COLORS;
exports.ANDROID_SELECT_STYLES = ANDROID_SELECT_STYLES;
exports.ANDROID_STATUS_POLL_MS = ANDROID_STATUS_POLL_MS;
exports.ANDROID_STATUS_REFRESH_DEBOUNCE_MS = ANDROID_STATUS_REFRESH_DEBOUNCE_MS;
exports.ANDROID_SWITCH_SETTLE_ATTEMPTS = ANDROID_SWITCH_SETTLE_ATTEMPTS;
exports.ANDROID_SWITCH_SETTLE_INTERVAL_MS = ANDROID_SWITCH_SETTLE_INTERVAL_MS;
exports.ANDROID_TAP_SLOP = ANDROID_TAP_SLOP;
exports.ANDROID_TOOLBAR_ACTION_IDS = ANDROID_TOOLBAR_ACTION_IDS;
exports.ANDROID_TOOLBAR_ICON_PATHS = ANDROID_TOOLBAR_ICON_PATHS;
exports.ANDROID_TOOLBAR_NAV_ACTIONS = ANDROID_TOOLBAR_NAV_ACTIONS;
exports.ANDROID_TOOLBAR_STYLES = ANDROID_TOOLBAR_STYLES;
exports.ANDROID_TOOLBAR_TOOLTIP_DELAY_MS = ANDROID_TOOLBAR_TOOLTIP_DELAY_MS;
exports.AndroidBuildRunCard = AndroidBuildRunCard;
exports.AndroidCardBoundary = AndroidCardBoundary;
exports.AndroidDetailsPanel = AndroidDetailsPanel;
exports.AndroidDeviceKindIcon = AndroidDeviceKindIcon;
exports.AndroidDeviceMenu = AndroidDeviceMenu;
exports.AndroidDevicePicker = AndroidDevicePicker;
exports.AndroidDevicePickerBody = AndroidDevicePickerBody;
exports.AndroidFollowIndicator = AndroidFollowIndicator;
exports.AndroidLiveFrame = AndroidLiveFrame;
exports.AndroidLiveFrameBody = AndroidLiveFrameBody;
exports.AndroidLiveIndicator = AndroidLiveIndicator;
exports.AndroidPanel = AndroidPanel;
exports.AndroidPanelBody = AndroidPanelBody;
exports.AndroidPhoneFrame = AndroidPhoneFrame;
exports.AndroidScreenshotCard = AndroidScreenshotCard;
exports.AndroidScreenshotFrame = AndroidScreenshotFrame;
exports.AndroidScreenshotFrameBody = AndroidScreenshotFrameBody;
exports.AndroidSelect = AndroidSelect;
exports.AndroidSelectMenu = AndroidSelectMenu;
exports.AndroidSizeQuickSegment = AndroidSizeQuickSegment;
exports.AndroidStatusCapsule = AndroidStatusCapsule;
exports.AndroidStatusCapsuleBody = AndroidStatusCapsuleBody;
exports.AndroidStreamCard = AndroidStreamCard;
exports.AndroidToolbarIcon = AndroidToolbarIcon;
exports.AndroidToolbarIconButton = AndroidToolbarIconButton;
exports.AndroidToolbarTooltip = AndroidToolbarTooltip;
exports.CAPTURE_ROUTE_PATH = CAPTURE_ROUTE_PATH;
exports.CONTROL_ROUTE_PATH = CONTROL_ROUTE_PATH;
exports.DEVICES_ROUTE_PATH = DEVICES_ROUTE_PATH;
exports.DEVICE_ACTION_ROUTE_PATH = DEVICE_ACTION_ROUTE_PATH;
exports.DEVICE_FRAME_STYLES = DEVICE_FRAME_STYLES;
exports.DEVICE_SIDE_BUTTONS = DEVICE_SIDE_BUTTONS;
exports.FRAMELESS_FRAME_STYLES = FRAMELESS_FRAME_STYLES;
exports.GRANT_ROUTE_PATH = GRANT_ROUTE_PATH;
exports.PANEL_LIVE_INDICATOR_STYLES = PANEL_LIVE_INDICATOR_STYLES;
exports.PANEL_STYLES = PANEL_STYLES;
exports.PHONE_BEZEL_STYLES = PHONE_BEZEL_STYLES;
exports.PLUGIN_ROUTE_PREFIX = PLUGIN_ROUTE_PREFIX;
exports.STATUS_ROUTE_PATH = STATUS_ROUTE_PATH;
exports.SWITCH_DEVICE_ROUTE_PATH = SWITCH_DEVICE_ROUTE_PATH;
exports.androidCardChrome = androidCardChrome;
exports.androidCardDeviceLabelOf = androidCardDeviceLabelOf;
exports.androidCopy = androidCopy;
exports.androidDeviceActionLabelOf = androidDeviceActionLabelOf;
exports.androidDeviceGroupsOf = androidDeviceGroupsOf;
exports.androidDeviceLabelOf = androidDeviceLabelOf;
exports.androidDeviceOnline = androidDeviceOnline;
exports.androidDeviceScaleOf = androidDeviceScaleOf;
exports.androidDeviceSelectGroupsOf = androidDeviceSelectGroupsOf;
exports.androidFollowNewestCandidateOf = androidFollowNewestCandidateOf;
exports.androidFollowStateInitial = androidFollowStateInitial;
exports.androidFollowStateNext = androidFollowStateNext;
exports.androidFollowTargetOf = androidFollowTargetOf;
exports.androidFrameStyleLabelOf = androidFrameStyleLabelOf;
exports.androidFrameStyleOf = androidFrameStyleOf;
exports.androidGestureActionOf = androidGestureActionOf;
exports.androidPanelAutoOpenActivatedAt = androidPanelAutoOpenActivatedAt;
exports.androidPanelAutoOpenKey = androidPanelAutoOpenKey;
exports.androidPanelAutoOpenShouldOpen = androidPanelAutoOpenShouldOpen;
exports.androidPanelClickIsInteractive = androidPanelClickIsInteractive;
exports.androidPanelClickRowCallIdOf = androidPanelClickRowCallIdOf;
exports.androidPanelDisplayIsLandscape = androidPanelDisplayIsLandscape;
exports.androidPanelDisplayLogicalWidthOf = androidPanelDisplayLogicalWidthOf;
exports.androidPanelEffectiveWidth = androidPanelEffectiveWidth;
exports.androidPanelFrameBorderPxOf = androidPanelFrameBorderPxOf;
exports.androidPanelFrameInsetOf = androidPanelFrameInsetOf;
exports.androidPanelFrameLayoutOf = androidPanelFrameLayoutOf;
exports.androidPanelFrameRadiusFallbackOf = androidPanelFrameRadiusFallbackOf;
exports.androidPanelFrameStyles = androidPanelFrameStyles;
exports.androidPanelFrameWidthOf = androidPanelFrameWidthOf;
exports.androidPanelLandscapeTargetWidthOf = androidPanelLandscapeTargetWidthOf;
exports.androidPanelRequestKey = androidPanelRequestKey;
exports.androidPanelScreenBoxOf = androidPanelScreenBoxOf;
exports.androidPanelScreenRadiusOf = androidPanelScreenRadiusOf;
exports.androidPanelScreenWidthOf = androidPanelScreenWidthOf;
exports.androidPanelShellPadOf = androidPanelShellPadOf;
exports.androidPanelShellRadiusOf = androidPanelShellRadiusOf;
exports.androidPanelSizeModeIdOf = androidPanelSizeModeIdOf;
exports.androidPanelSizeModeOf = androidPanelSizeModeOf;
exports.androidPanelSnapPxOf = androidPanelSnapPxOf;
exports.androidPanelSourcesSnapshot = androidPanelSourcesSnapshot;
exports.androidPanelSourcesVersion = androidPanelSourcesVersion;
exports.androidPanelStore = androidPanelStore;
exports.androidPanelWidthBounds = androidPanelWidthBounds;
exports.androidPanelWidthStateInitial = androidPanelWidthStateInitial;
exports.androidPanelWidthStateNext = androidPanelWidthStateNext;
exports.androidPhoneScreenStyles = androidPhoneScreenStyles;
exports.androidResultSummaryOf = androidResultSummaryOf;
exports.androidResultTextOf = androidResultTextOf;
exports.androidRouteErrorTextOf = androidRouteErrorTextOf;
exports.androidStreamStatusRequestOf = androidStreamStatusRequestOf;
exports.androidSwitchedPanelRequestOf = androidSwitchedPanelRequestOf;
exports.androidSwitchedStreamMetaOf = androidSwitchedStreamMetaOf;
exports.androidToolNameOf = androidToolNameOf;
exports.androidToolbarActionLabelOf = androidToolbarActionLabelOf;
exports.apply = apply;
exports.captureBodyOf = captureBodyOf;
exports.claimAndroidPanelDock = claimAndroidPanelDock;
exports.clampAndroidPanelWidth = clampAndroidPanelWidth;
exports.controlBodyOf = controlBodyOf;
exports.createAndroidCaptureController = createAndroidCaptureController;
exports.createAndroidDeviceSwitchController = createAndroidDeviceSwitchController;
exports.createAndroidPanelStore = createAndroidPanelStore;
exports.createAndroidStatusPoller = createAndroidStatusPoller;
exports.fetchAndroidStreamStatus = fetchAndroidStreamStatus;
exports.forgetAndroidPanelAutoOpenCall = forgetAndroidPanelAutoOpenCall;
exports.formatBytes = formatBytes;
exports.hasAndroidPanelSourceForSession = hasAndroidPanelSourceForSession;
exports.hydrateAndroidMeta = hydrateAndroidMeta;
exports.inject = inject;
exports.installAndroidPanelRowTrigger = installAndroidPanelRowTrigger;
exports.mountAndroidPanelHost = mountAndroidPanelHost;
exports.normalizePointerPoint = normalizePointerPoint;
exports.parseAndroidMeta = parseAndroidMeta;
exports.postAndroidControl = postAndroidControl;
exports.postDeviceAction = postDeviceAction;
exports.registerAndroidPanelSource = registerAndroidPanelSource;
exports.rememberAndroidPanelAutoOpenCall = rememberAndroidPanelAutoOpenCall;
exports.requestAndroidCapture = requestAndroidCapture;
exports.requestAndroidDevices = requestAndroidDevices;
exports.requestAndroidStatus = requestAndroidStatus;
exports.requestScreenshotGrant = requestScreenshotGrant;
exports.requestStreamGrant = requestStreamGrant;
exports.requestSwitchDevice = requestSwitchDevice;
exports.resizedAndroidPanelWidth = resizedAndroidPanelWidth;
exports.resolveAndroidMeta = resolveAndroidMeta;
exports.resolveAndroidPanelSource = resolveAndroidPanelSource;
exports.screenshotGrantBodyOf = screenshotGrantBodyOf;
exports.streamGrantBodyOf = streamGrantBodyOf;
exports.subscribeAndroidPanelSources = subscribeAndroidPanelSources;
exports.switchDeviceBodyOf = switchDeviceBodyOf;
exports.takeAndroidPanelAutoOpenCall = takeAndroidPanelAutoOpenCall;
exports.useAndroidCapture = useAndroidCapture;
exports.useAndroidPanelSource = useAndroidPanelSource;
exports.useAndroidScreenshot = useAndroidScreenshot;
exports.useAndroidStream = useAndroidStream;

return module.exports; } });
