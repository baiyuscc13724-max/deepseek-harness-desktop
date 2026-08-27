const SESSION_NODE_START = '\t\tfunction SessionNodeItem('
const SESSION_NODE_END = '\n\t\t//#endregion'
const PATCH_MARKER = 'const HD_SESSION_MENU_STATE_KEY = "harness.desktop.session-menu.v1";'

const SESSION_MENU_IMPLEMENTATION = `\t\tconst HD_SESSION_MENU_STATE_KEY = "harness.desktop.session-menu.v1";
		const HD_SESSION_MENU_EVENT = "harness-desktop-session-menu-change";
		const HD_SESSION_HISTORY_RECEIPT_EVENT = "harness-mobile-session-history-receipt";
		let hdSessionMenuDesktopState = null;
		let hdSessionMenuDesktopRevision = 0;
		let hdSessionMenuDesktopHydrated = false;
		let hdSessionMenuDesktopSyncPromise = null;
		function normalizeSessionMenuState(value) {
			const input = value && typeof value === "object" ? value : {};
			const normalizeIds = (ids) => {
				const seen = new Set();
				return (Array.isArray(ids) ? ids : []).filter((id) => {
					if (typeof id !== "string" || !id || id.length > 256 || id.trim() !== id || seen.has(id)) return false;
					seen.add(id);
					return true;
				}).slice(0, 1000);
			};
			return { pinned: normalizeIds(input.pinned), unread: normalizeIds(input.unread) };
		}
		function readSessionMenuState() {
			if (hdSessionMenuDesktopState) return { pinned: [...hdSessionMenuDesktopState.pinned], unread: [...hdSessionMenuDesktopState.unread] };
			try {
				return normalizeSessionMenuState(JSON.parse(localStorage.getItem(HD_SESSION_MENU_STATE_KEY) ?? "{}"));
			} catch {
				return { pinned: [], unread: [] };
			}
		}
		function persistSessionMenuState(value) {
			const state = normalizeSessionMenuState(value);
			hdSessionMenuDesktopState = state;
			try { localStorage.setItem(HD_SESSION_MENU_STATE_KEY, JSON.stringify(state)); } catch {}
			return state;
		}
		function dispatchSessionMenuChange(detail) {
			window.dispatchEvent(new CustomEvent(HD_SESSION_MENU_EVENT, { detail }));
		}
		function syncDesktopSessionMenuState() {
			if (hdSessionMenuDesktopHydrated) return Promise.resolve(readSessionMenuState());
			if (hdSessionMenuDesktopSyncPromise) return hdSessionMenuDesktopSyncPromise;
			const bridge = window.harnessDesktopGuest;
			if (!bridge || typeof bridge.syncSessionMenuState !== "function") return Promise.resolve(readSessionMenuState());
			const revision = hdSessionMenuDesktopRevision;
			hdSessionMenuDesktopSyncPromise = Promise.resolve(bridge.syncSessionMenuState(readSessionMenuState())).then((value) => {
				if (revision !== hdSessionMenuDesktopRevision || !value || !Array.isArray(value.pinned) || !Array.isArray(value.unread)) return readSessionMenuState();
				hdSessionMenuDesktopHydrated = true;
				const state = persistSessionMenuState(value);
				dispatchSessionMenuChange({ hydrated: true });
				return state;
			}).catch(() => readSessionMenuState()).finally(() => { hdSessionMenuDesktopSyncPromise = null; });
			return hdSessionMenuDesktopSyncPromise;
		}
		function sessionMenuFlag(sessionId, flag) {
			return readSessionMenuState()[flag].includes(sessionId);
		}
		function setSessionMenuFlag(sessionId, flag, enabled) {
			const state = readSessionMenuState();
			state[flag] = enabled ? [sessionId, ...state[flag].filter((id) => id !== sessionId)] : state[flag].filter((id) => id !== sessionId);
			const revision = ++hdSessionMenuDesktopRevision;
			persistSessionMenuState(state);
			dispatchSessionMenuChange({ sessionId, flag, enabled });
			const bridge = window.harnessDesktopGuest;
			if (!bridge || typeof bridge.setSessionMenuFlag !== "function") return;
			Promise.resolve(bridge.setSessionMenuFlag({ sessionId, flag, enabled })).then((value) => {
				if (revision !== hdSessionMenuDesktopRevision || !value || !Array.isArray(value.pinned) || !Array.isArray(value.unread)) return;
				hdSessionMenuDesktopHydrated = true;
				persistSessionMenuState(value);
				dispatchSessionMenuChange({ sessionId, flag, enabled, persisted: true });
			}).catch(() => {});
		}
		function sessionHistoryReceiptSessionId(event) {
			if (event?.type !== HD_SESSION_HISTORY_RECEIPT_EVENT) return null;
			const detail = event.detail;
			if (!detail || typeof detail !== "object") return null;
			const keys = Object.keys(detail);
			if (keys.length !== 3 || !keys.includes("sessionId") || !keys.includes("authoritative") || !keys.includes("latestLoaded")) return null;
			const sessionId = Object.getOwnPropertyDescriptor(detail, "sessionId");
			const authoritative = Object.getOwnPropertyDescriptor(detail, "authoritative");
			const latestLoaded = Object.getOwnPropertyDescriptor(detail, "latestLoaded");
			if (!sessionId || !authoritative || !latestLoaded || sessionId.get || authoritative.get || latestLoaded.get) return null;
			return typeof sessionId.value === "string" && sessionId.value.length > 0 && sessionId.value.length <= 256 && authoritative.value === true && latestLoaded.value === true ? sessionId.value : null;
		}
		function useSessionMenuRevision(sessionId) {
			const [revision, setRevision] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const refresh = () => setRevision((value) => value + 1);
				const acknowledgeLoadedHistory = (event) => {
					const loadedSessionId = sessionHistoryReceiptSessionId(event);
					if (loadedSessionId !== sessionId || !sessionMenuFlag(sessionId, "unread")) return;
					setSessionMenuFlag(sessionId, "unread", false);
				};
				const refreshStorage = (event) => {
					if (event.key !== HD_SESSION_MENU_STATE_KEY) return;
					hdSessionMenuDesktopState = null;
					hdSessionMenuDesktopRevision += 1;
					refresh();
				};
				window.addEventListener(HD_SESSION_MENU_EVENT, refresh);
				window.addEventListener(HD_SESSION_HISTORY_RECEIPT_EVENT, acknowledgeLoadedHistory);
				window.addEventListener("storage", refreshStorage);
				void syncDesktopSessionMenuState();
				return () => {
					window.removeEventListener(HD_SESSION_MENU_EVENT, refresh);
					window.removeEventListener(HD_SESSION_HISTORY_RECEIPT_EVENT, acknowledgeLoadedHistory);
					window.removeEventListener("storage", refreshStorage);
				};
			}, [sessionId]);
			return revision;
		}
		function sessionMenuOrder(rows) {
			const pinned = new Set(readSessionMenuState().pinned);
			return [...rows].sort((left, right) => Number(pinned.has(right.id)) - Number(pinned.has(left.id)));
		}
		function sessionMenuGroupRows(rows, expanded, collapsedLimit) {
			const ordered = sessionMenuOrder(rows);
			return expanded ? ordered : ordered.slice(0, collapsedLimit);
		}
		function desktopSessionMenuNavigate(action, values) {
			const query = new URLSearchParams(values).toString();
			window.location.href = \`harness-desktop://\${action}?\${query}\`;
		}
		function sessionMenuLabels() {
			const zh = (document.documentElement.lang || navigator.language || "").toLowerCase().startsWith("zh");
			return zh ? {
				pin: "置顶", unpin: "取消置顶", rename: "重命名", unread: "标记为未读", archive: "归档",
				project: "项目", copy: "复制", copyId: "复制会话 ID", copyTitle: "复制名称", newWindow: "在新窗口中打开", noProjects: "暂无其他项目", dismiss: "关闭会话菜单"
			} : {
				pin: "Pin", unpin: "Unpin", rename: "Rename", unread: "Mark as unread", archive: "Archive",
				project: "Project", copy: "Copy", copyId: "Copy session ID", copyTitle: "Copy name", newWindow: "Open in new window", noProjects: "No other projects", dismiss: "Close session menu"
			};
		}
		const HD_SESSION_MENU_ICONS = {
			pin: [["path", { d: "M5.25 2.25h5.5M6.15 2.25l.45 3.1-2.2 2.2v1.2h7.2v-1.2l-2.2-2.2.45-3.1M8 8.75v4.75" }]],
			unpin: [["path", { d: "M5.25 2.25h5.5M6.15 2.25l.45 3.1-1.35 1.35M8 8.75v4.75M10.35 6.3l1.25 1.25v1.2H8.8" }], ["path", { d: "M2.5 2.5l11 11" }]],
			rename: [["path", { d: "M3 12.75l.5-2.35 6.7-6.7a1.2 1.2 0 0 1 1.7 0l.4.4a1.2 1.2 0 0 1 0 1.7l-6.7 6.7-2.6.25Z" }], ["path", { d: "M9.35 4.55l2.1 2.1" }]],
			unread: [["rect", { x: "2.25", y: "4.25", width: "10.25", height: "8", rx: "1.35" }], ["path", { d: "m2.8 5.25 4.55 3.4 4.55-3.4" }], ["circle", { cx: "12.45", cy: "3.55", r: "1.55", fill: "currentColor", stroke: "var(--dsw-specific-menu)" }]],
			archive: [["path", { d: "M2.25 3h11.5v2.5H2.25zM3 5.5v7.25h10V5.5" }], ["path", { d: "M6.15 8.25h3.7" }]],
			project: [["path", { d: "M2 4.25h3.75l1.3 1.5H14v6.1a1.15 1.15 0 0 1-1.15 1.15h-9.7A1.15 1.15 0 0 1 2 11.85v-7.6Z" }], ["path", { d: "M2 5.75h12" }]],
			copy: [["rect", { x: "5", y: "2.25", width: "8.25", height: "8.75", rx: "1.25" }], ["rect", { x: "2.25", y: "5", width: "8.25", height: "8.75", rx: "1.25" }]],
			copyId: [["path", { d: "M5.75 2.5 4.5 13.5M11.5 2.5l-1.25 11M3 6h10M2.5 10h10" }]],
			copyTitle: [["path", { d: "M3 3.25h10M8 3.25v9.5M5.5 12.75h5" }]],
			newWindow: [["path", { d: "M9 2.5h4.5V7M13.5 2.5 7.25 8.75" }], ["path", { d: "M11.5 8.75v2.8a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2v-6.6a1.2 1.2 0 0 1 1.2-1.2h2.8" }]],
			chevron: [["path", { d: "m6 3.5 4.5 4.5L6 12.5" }]]
		};
		function SessionMenuIcon({ name, className = "" }) {
			const shapes = HD_SESSION_MENU_ICONS[name] ?? [];
			return (0, react_jsx_runtime.jsx)("svg", {
				className: "hd-session-menu-icon" + (className ? " " + className : ""),
				viewBox: "0 0 16 16",
				width: "16",
				height: "16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.35",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				focusable: "false",
				"aria-hidden": "true",
				children: shapes.map(([tag, attributes], index) => (0, react_jsx_runtime.jsx)(tag, attributes, name + "-" + index))
			});
		}
		function SessionMenuAction({ icon, label, onSelect, onHover, disabled = false, submenu = false }) {
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				role: "menuitem",
				className: "hd-session-menu-action",
				disabled,
				onPointerEnter: onHover,
				onClick: (event) => {
					event.stopPropagation();
					if (!disabled) onSelect?.();
				},
				children: [(0, react_jsx_runtime.jsx)("span", { className: "hd-session-menu-icon-slot", "aria-hidden": "true", children: icon ? (0, react_jsx_runtime.jsx)(SessionMenuIcon, { name: icon }) : null }), (0, react_jsx_runtime.jsx)("span", { className: "hd-session-menu-label", children: label }), submenu && (0, react_jsx_runtime.jsx)(SessionMenuIcon, { name: "chevron", className: "hd-session-menu-chevron" })]
			});
		}
		function SessionNodeMenu({ node, title, pinned, onRename, onArchive, onMove, workspaces }) {
			const labels = sessionMenuLabels();
			const [open, setOpen] = (0, react.useState)(false);
			const [submenu, setSubmenu] = (0, react.useState)(null);
			const [position, setPosition] = (0, react.useState)({ top: 0, left: 0 });
			const anchorRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const close = () => { setOpen(false); setSubmenu(null); };
			(0, react.useEffect)(() => {
				if (!open) return;
				const dismiss = (event) => {
					if (anchorRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
					close();
				};
				const escape = (event) => { if (event.key === "Escape") close(); };
				document.addEventListener("pointerdown", dismiss, true);
				document.addEventListener("keydown", escape, true);
				window.addEventListener("resize", close);
				document.addEventListener("scroll", close, true);
				return () => {
					document.removeEventListener("pointerdown", dismiss, true);
					document.removeEventListener("keydown", escape, true);
					window.removeEventListener("resize", close);
					document.removeEventListener("scroll", close, true);
				};
			}, [open]);
			const show = (event) => {
				event.stopPropagation();
				if (open) { close(); return; }
				const rect = event.currentTarget.getBoundingClientRect();
				setPosition({ top: Math.max(8, Math.min(window.innerHeight - 310, rect.bottom + 4)), left: Math.max(8, Math.min(window.innerWidth - 228, rect.right - 40)) });
				setOpen(true);
			};
			const currentWorkspaceId = workspaces.find((workspace) => workspace.sessionIds.includes(node.id))?.workspaceId;
			const projectItems = workspaces.filter((workspace) => workspace.workspaceId !== currentWorkspaceId);
			const finish = (action) => { close(); action?.(); };
			const panel = !open ? null : (0, react_jsx_runtime.jsxs)("div", {
				ref: panelRef,
				className: "hd-session-menu-panel",
				role: "menu",
				style: position,
				onClick: (event) => event.stopPropagation(),
				children: [
					(0, react_jsx_runtime.jsx)(SessionMenuAction, { icon: pinned ? "unpin" : "pin", label: pinned ? labels.unpin : labels.pin, onHover: () => setSubmenu(null), onSelect: () => finish(() => setSessionMenuFlag(node.id, "pinned", !pinned)) }),
					(0, react_jsx_runtime.jsx)(SessionMenuAction, { icon: "rename", label: labels.rename, onHover: () => setSubmenu(null), onSelect: () => finish(() => onRename(node.id, node.title)) }),
					(0, react_jsx_runtime.jsx)(SessionMenuAction, { icon: "unread", label: labels.unread, onHover: () => setSubmenu(null), onSelect: () => finish(() => setSessionMenuFlag(node.id, "unread", true)) }),
					(0, react_jsx_runtime.jsx)(SessionMenuAction, { icon: "archive", label: labels.archive, onHover: () => setSubmenu(null), onSelect: () => finish(() => onArchive(node.id)) }),
					(0, react_jsx_runtime.jsx)("span", { className: "hd-session-menu-separator", role: "separator" }),
					(0, react_jsx_runtime.jsxs)("div", { className: "hd-session-menu-submenu-owner", children: [
						(0, react_jsx_runtime.jsx)(SessionMenuAction, { icon: "project", label: labels.project, submenu: true, onHover: () => setSubmenu("project"), onSelect: () => setSubmenu(submenu === "project" ? null : "project") }),
						submenu === "project" && (0, react_jsx_runtime.jsx)("div", { className: "hd-session-menu-submenu", role: "menu", children: projectItems.length === 0 ? (0, react_jsx_runtime.jsx)(SessionMenuAction, { label: labels.noProjects, disabled: true }) : projectItems.map((workspace) => (0, react_jsx_runtime.jsx)(SessionMenuAction, { icon: "project", label: workspace.title, onSelect: () => finish(() => onMove(node.id, workspace.workspaceId)) }, workspace.workspaceId)) })
					] }),
					(0, react_jsx_runtime.jsxs)("div", { className: "hd-session-menu-submenu-owner", children: [
						(0, react_jsx_runtime.jsx)(SessionMenuAction, { icon: "copy", label: labels.copy, submenu: true, onHover: () => setSubmenu("copy"), onSelect: () => setSubmenu(submenu === "copy" ? null : "copy") }),
						submenu === "copy" && (0, react_jsx_runtime.jsxs)("div", { className: "hd-session-menu-submenu", role: "menu", children: [(0, react_jsx_runtime.jsx)(SessionMenuAction, { icon: "copyId", label: labels.copyId, onSelect: () => finish(() => desktopSessionMenuNavigate("copy-session-id", { value: node.id })) }), (0, react_jsx_runtime.jsx)(SessionMenuAction, { icon: "copyTitle", label: labels.copyTitle, onSelect: () => finish(() => desktopSessionMenuNavigate("copy-session-id", { value: title })) })] })
					] }),
					(0, react_jsx_runtime.jsx)(SessionMenuAction, { icon: "newWindow", label: labels.newWindow, onHover: () => setSubmenu(null), onSelect: () => finish(() => desktopSessionMenuNavigate("open-session-window", { sessionId: node.id })) })
				]
			});
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("button", {
				ref: anchorRef,
				type: "button",
				className: Rows_module_css_default.iconButton,
				"aria-label": title,
				"aria-haspopup": "menu",
				"aria-expanded": open,
				onClick: show,
				children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutline16, {})
			}), open && react_dom.createPortal((0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("button", { type: "button", tabIndex: -1, className: "hd-session-menu-dismiss", "aria-label": labels.dismiss, onClick: close }), panel] }), document.body)] });
		}
		function SessionNodeItem({ node, currentId, now, onOpen, onRename, onArchive, onMove, workspaces, drag, flat = false, t }) {
			useSessionMenuRevision(node.id);
			const row = node;
			const title = displayTitle(node, t);
			const selected = node.id === currentId;
			const pinned = sessionMenuFlag(node.id, "pinned");
			const unread = sessionMenuFlag(node.id, "unread");
			const statuses = sessionStatuses(node, t);
			const showStatus = statuses[0].state !== "done" || row.completed;
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
				anchor: (0, react_jsx_runtime.jsxs)("div", {
					className: clsx(Rows_module_css_default.sessionRow, selected && Rows_module_css_default.selected, unread && "hd-session-row-unread", flat && !showStatus && Rows_module_css_default.flatSessionRowWithoutStatus, drag?.marker === "before" && Rows_module_css_default.dropBefore, drag?.marker === "after" && Rows_module_css_default.dropAfter),
					role: "treeitem",
					"aria-selected": selected,
					onClick: () => {
						onOpen(node.id);
					},
					draggable: drag !== void 0,
					onDragStart: drag === void 0 ? void 0 : (e) => {
						e.dataTransfer.effectAllowed = "move";
						e.dataTransfer.setData("text/plain", node.id);
						drag.start();
					},
					onDragEnd: drag?.end,
					onDragOver: drag === void 0 ? void 0 : (e) => {
						if (!drag.active) return;
						e.preventDefault();
						e.dataTransfer.dropEffect = "move";
						drag.hover(rowHalf(e));
					},
					onDrop: drag === void 0 ? void 0 : (e) => {
						if (!drag.active) return;
						e.preventDefault();
						drag.drop(rowHalf(e));
					},
					children: [
						(!flat || showStatus) && (0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.slot, children: showStatus && (0, react_jsx_runtime.jsx)(SessionStatusDots, { statuses }) }),
						unread && (0, react_jsx_runtime.jsx)("span", { className: "hd-session-unread-mark", "aria-label": sessionMenuLabels().unread }),
						(0, react_jsx_runtime.jsxs)("span", { className: Rows_module_css_default.title, children: [pinned && (0, react_jsx_runtime.jsx)("span", { className: "hd-session-pinned-mark", "aria-hidden": "true", children: (0, react_jsx_runtime.jsx)(SessionMenuIcon, { name: "pin" }) }), title] }),
						!row.blank && (0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.time, children: timeLabel(row.updatedAt, now, t) }),
						!row.blank && (0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.rowActions, onClick: (event) => event.stopPropagation(), children: (0, react_jsx_runtime.jsx)(SessionNodeMenu, { node, title, pinned, onRename, onArchive, onMove, workspaces }) })
					]
				}),
				content: (0, react_jsx_runtime.jsx)(SessionHoverContent, { node, now, t }),
				disabled: drag?.active === true,
				copyText: row.blank ? void 0 : row.title,
				copyLabel: t("copy"),
				copiedLabel: t("hover.copied")
			});
		}
`

const SESSION_MENU_CSS = `
.hd-session-row-unread{font-weight:600}
.hd-session-unread-mark{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1)}
.hd-session-pinned-mark{display:inline-grid;width:12px;height:12px;margin-right:4px;place-items:center;color:var(--dsw-alias-label-tertiary);vertical-align:-1px}
.hd-session-pinned-mark .hd-session-menu-icon{width:11px;height:11px}
.hd-session-menu-dismiss{position:fixed;z-index:2147482400;inset:0;width:100vw;height:100vh;border:0;padding:0;background:transparent;cursor:default}
.hd-session-menu-panel,.hd-session-menu-submenu{box-sizing:border-box;width:220px;min-width:220px;padding:6px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 82%,transparent);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 96%,var(--dsw-alias-label-primary) 4%);box-shadow:0 14px 40px rgba(0,0,0,.22),0 2px 8px rgba(0,0,0,.1);backdrop-filter:blur(22px) saturate(1.08);color:var(--dsw-alias-label-primary);z-index:2147482500}
.hd-session-menu-panel{position:fixed}
.hd-session-menu-submenu-owner{position:relative}
.hd-session-menu-submenu{position:absolute;left:calc(100% + 7px);top:-5px;max-height:min(360px,70vh);overflow:auto}
.hd-session-menu-action{display:grid;grid-template-columns:22px minmax(0,1fr) 16px;column-gap:2px;align-items:center;width:100%;min-height:36px;padding:5px 8px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.hd-session-menu-action:hover:not(:disabled),.hd-session-menu-action:focus-visible:not(:disabled){outline:none;background:var(--dsw-alias-interactive-bg-hover)}
.hd-session-menu-action:disabled{opacity:.5;cursor:default}
.hd-session-menu-icon-slot{display:grid;width:18px;height:18px;place-items:center;color:var(--dsw-alias-label-secondary);transition:color .12s ease,transform .12s ease}
.hd-session-menu-icon{display:block;width:16px;height:16px;overflow:visible;shape-rendering:geometricPrecision}
.hd-session-menu-action:hover:not(:disabled) .hd-session-menu-icon-slot,.hd-session-menu-action:focus-visible:not(:disabled) .hd-session-menu-icon-slot{color:var(--dsw-alias-brand-primary);transform:translateX(1px)}
.hd-session-menu-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hd-session-menu-chevron{justify-self:end;width:13px;height:13px;color:var(--dsw-alias-label-tertiary)}
.hd-session-menu-separator{display:block;height:1px;margin:5px 3px;background:var(--dsw-alias-border-l2)}
@media(prefers-reduced-motion:reduce){.hd-session-menu-icon-slot{transition:none}}
`

function replaceOnce(source, original, patched, label) {
  if (source.includes(patched)) return source
  if (!source.includes(original)) throw new Error(`Pinned DSH workspace ${label} changed; refusing an unsafe session-menu patch.`)
  return source.replace(original, patched)
}

export function patchWorkspaceSessionMenuSource(source) {
  if (source.includes(PATCH_MARKER)) {
    const start = source.indexOf('\t\tconst HD_SESSION_MENU_STATE_KEY')
    const end = source.indexOf(SESSION_NODE_END, start)
    if (start < 0 || end < 0) throw new Error('Pinned DSH installed session menu boundary changed; refusing an unsafe migration.')
    let migrated = source.slice(0, start) + SESSION_MENU_IMPLEMENTATION + source.slice(end)
    migrated = migrated.replace('\n\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tforkSession,\n\t\t\t\t\t\t\tworkspaces,', '\n\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tmoveSession,\n\t\t\t\t\t\t\tworkspaces,')
    migrated = replaceOnce(migrated, 'sessionMenuOrder(expandedSessionGroups.includes(group.key) ? group.sessions : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)).map((node) => {', 'sessionMenuGroupRows(group.sessions, expandedSessionGroups.includes(group.key), COLLAPSED_SESSION_LIMIT).map((node) => {', 'tree pinned order before collapsed limit')
    const cssPrefix = '\t\t\tsessionMenuStyle.textContent = '
    const cssStart = migrated.indexOf(cssPrefix)
    const cssEnd = migrated.indexOf(';\n', cssStart)
    if (cssStart < 0 || cssEnd < 0) throw new Error('Pinned DSH installed session menu style boundary changed; refusing an unsafe migration.')
    migrated = migrated.slice(0, cssStart) + `${cssPrefix}${JSON.stringify(SESSION_MENU_CSS)}` + migrated.slice(cssEnd)
    return { source: migrated, changed: migrated !== source }
  }
  const start = source.indexOf(SESSION_NODE_START)
  const end = source.indexOf(SESSION_NODE_END, start)
  if (start < 0 || end < 0) throw new Error('Pinned DSH session row changed; refusing an unsafe session-menu patch.')
  const legacy = source.slice(start, end)
  for (const marker of ['onFork', 'sessionMenuItems', '_deepseek_ai_dsh_client_ui_primitives.Menu']) {
    if (!legacy.includes(marker)) throw new Error(`Pinned DSH legacy session row marker missing: ${marker}`)
  }
  let output = source.slice(0, start) + SESSION_MENU_IMPLEMENTATION + source.slice(end)
  output = replaceOnce(output, 'let react = require("react");', 'let react = require("react");\n\t\tlet react_dom = require("react-dom");', 'React DOM import')
  output = replaceOnce(output, '\t\tfunction SessionTree({ useSessions, startSession, open, forkSession, workspaces,', '\t\tfunction SessionTree({ useSessions, startSession, open, workspaces, moveSession,', 'tree properties')
  output = replaceOnce(output, '\t\t\tconst [expandedSessionGroups, setExpandedSessionGroups] = (0, react.useState)([]);', '\t\t\tconst [expandedSessionGroups, setExpandedSessionGroups] = (0, react.useState)([]);\n\t\t\tconst sessionMenuRevision = useSessionMenuRevision();', 'tree menu subscription')
  output = replaceOnce(output, '(expandedSessionGroups.includes(group.key) ? group.sessions : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)).map((node) => {', 'sessionMenuGroupRows(group.sessions, expandedSessionGroups.includes(group.key), COLLAPSED_SESSION_LIMIT).map((node) => {', 'tree pinned order')
  output = replaceOnce(output, '\t\t\t\t\t\t\t\t\t\t\tonFork: forkSession,\n\t\t\t\t\t\t\t\t\t\t\tonArchive: onSessionArchive,', '\t\t\t\t\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\t\t\t\t\tonMove: moveSession,\n\t\t\t\t\t\t\t\t\t\t\tworkspaces,', 'tree row actions')
  output = replaceOnce(output, '\t\tfunction FlatList({ useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds,', '\t\tfunction FlatList({ useSessions, open, onSessionRename, onSessionArchive, moveSession, workspaces, archivedSessionIds,', 'flat properties')
  output = replaceOnce(output, '\t\t\tconst baseRows = (0, react.useMemo)(() => deriveFlat(list, archivedSessionIds), [list, archivedSessionIds]);', '\t\t\tconst sessionMenuRevision = useSessionMenuRevision();\n\t\t\tconst baseRows = (0, react.useMemo)(() => deriveFlat(list, archivedSessionIds), [list, archivedSessionIds]);', 'flat menu subscription')
  output = replaceOnce(output, 'return reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]).flatMap((id) => {', 'return sessionMenuOrder(reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]).flatMap((id) => {', 'flat pinned order start')
  output = replaceOnce(output, '\t\t\t\t\treturn row === void 0 ? [] : [row];\n\t\t\t\t});\n\t\t\t}, [\n\t\t\t\tbaseRows,', '\t\t\t\t\treturn row === void 0 ? [] : [row];\n\t\t\t\t}));\n\t\t\t}, [\n\t\t\t\tbaseRows,\n\t\t\t\tsessionMenuRevision,', 'flat pinned order end')
  output = replaceOnce(output, '\t\t\t\t\t\t\tonFork: forkSession,\n\t\t\t\t\t\t\tonArchive: onSessionArchive,', '\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\tonMove: moveSession,\n\t\t\t\t\t\t\tworkspaces,', 'flat row actions')
  output = replaceOnce(output, 'function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession,', 'function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, moveSession,', 'browser properties')
  output = output.replace(/\n\t\t\t\t\t\t\tforkSession,\n\t\t\t\t\t\t\tonSessionRename,/g, '\n\t\t\t\t\t\t\tmoveSession,\n\t\t\t\t\t\t\tworkspaces,\n\t\t\t\t\t\t\tonSessionRename,')
  output = replaceOnce(output, '\n\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tforkSession,\n\t\t\t\t\t\t\tworkspaces,', '\n\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tmoveSession,\n\t\t\t\t\t\t\tworkspaces,', 'tree browser call')
  output = replaceOnce(output, '\t\t\t\tarchiveSession: async (sessionId) => {\n\t\t\t\t\tawait ctx.workspaces.archiveSession(sessionId);\n\t\t\t\t},', '\t\t\t\tarchiveSession: async (sessionId) => {\n\t\t\t\t\tawait ctx.workspaces.archiveSession(sessionId);\n\t\t\t\t},\n\t\t\t\tmoveSession: async (sessionId, workspaceId) => {\n\t\t\t\t\tawait ctx.workspaces.insertSessionBefore(workspaceId, sessionId);\n\t\t\t\t},', 'move action')
  const cssAnchor = '\t\tconst tagId$2 = "@deepseek-ai/dsh-client-ui-workspace/Rows.module.css";'
  output = replaceOnce(output, cssAnchor, `\t\tif (typeof document !== "undefined" && document.querySelector("style[data-hd-session-menu]") === null) {\n\t\t\tconst sessionMenuStyle = document.createElement("style");\n\t\t\tsessionMenuStyle.dataset.hdSessionMenu = "true";\n\t\t\tsessionMenuStyle.textContent = ${JSON.stringify(SESSION_MENU_CSS)};\n\t\t\tdocument.head.appendChild(sessionMenuStyle);\n\t\t}\n${cssAnchor}`, 'menu styles')
  if (!output.includes('moveSession,\n\t\t\t\t\t\t\tworkspaces,')) throw new Error('Pinned DSH browser call sites changed; refusing an incomplete session-menu patch.')
  return { source: output, changed: true }
}
