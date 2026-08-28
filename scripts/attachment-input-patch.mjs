const DRAFT_HELPERS_ANCHOR = `		function AttachmentRail({ items, labels, onOpen, onRemove }) {`

const DRAFT_HELPERS_PATCHED = `		const draftImageActionStyleId = "@harness-desktop/draft-image-actions-v1";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(draftImageActionStyleId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@harness-desktop/draft-image-actions";
			tag.dataset.pluginCss = draftImageActionStyleId;
			tag.textContent = ".hd-draft-image-actions{z-index:2;display:flex;gap:3px;position:absolute;left:4px;bottom:4px;opacity:0;transition:opacity .16s ease}.JVDQca_item:hover .hd-draft-image-actions,.JVDQca_item:focus-within .hd-draft-image-actions{opacity:1}.hd-draft-image-action{display:grid;place-items:center;box-sizing:border-box;width:20px;height:20px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 78%,transparent);border-radius:6px;padding:0;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-specific-input-major) 92%,transparent);box-shadow:0 2px 8px rgba(0,0,0,.18);cursor:pointer}.hd-draft-image-action:hover,.hd-draft-image-action:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 66%,transparent);outline-offset:1px;background:var(--dsw-alias-interactive-bg-hover-solid)}@media(pointer:coarse){.hd-draft-image-actions{opacity:1}}@media(prefers-reduced-motion:reduce){.hd-draft-image-actions{transition:none}}";
			document.head.appendChild(tag);
		}
		let draftImageClipboard = null;
		function cloneDraftImageFile(file) {
			return new File([file], file.name || "image", {
				type: file.type,
				lastModified: file.lastModified
			});
		}
		async function systemClipboardImage(file) {
			if (typeof ClipboardItem !== "function" || typeof navigator.clipboard?.write !== "function") return;
			let blob = file;
			let type = file.type || "image/png";
			if (typeof ClipboardItem.supports === "function" && !ClipboardItem.supports(type)) {
				if (!ClipboardItem.supports("image/png") || typeof createImageBitmap !== "function") return;
				const bitmap = await createImageBitmap(file);
				try {
					const canvas = document.createElement("canvas");
					canvas.width = bitmap.width;
					canvas.height = bitmap.height;
					const context = canvas.getContext("2d");
					if (context === null) return;
					context.drawImage(bitmap, 0, 0);
					const encoded = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
					if (encoded === null) return;
					blob = encoded;
					type = "image/png";
				} finally {
					bitmap.close?.();
				}
			}
			await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
		}
		function rememberDraftImage(file) {
			draftImageClipboard = cloneDraftImageFile(file);
			void systemClipboardImage(file).catch(() => {});
		}
		function DraftCutIcon() {
			return (0, react_jsx_runtime.jsxs)("svg", {
				width: "12",
				height: "12",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [(0, react_jsx_runtime.jsx)("path", { d: "M5.1 5.8 12.8 1.8M5.1 10.2l7.7 4M6.4 8h2.2", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" }), (0, react_jsx_runtime.jsx)("circle", { cx: "3.5", cy: "4.5", r: "2", stroke: "currentColor", strokeWidth: "1.3" }), (0, react_jsx_runtime.jsx)("circle", { cx: "3.5", cy: "11.5", r: "2", stroke: "currentColor", strokeWidth: "1.3" })]
			});
		}
		function AttachmentRail({ items, labels, onOpen, onRemove, onCopy, onCut }) {`

const THUMBNAIL_ACTIONS_ORIGINAL = `								title: labels.open,
								onClick: () => {
									onOpen(item);
								},`

const THUMBNAIL_ACTIONS_PATCHED = `								title: labels.open,
								"aria-keyshortcuts": "Control+C Meta+C Control+X Meta+X",
								onKeyDown: (event) => {
									if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
									const key = event.key.toLowerCase();
									if (key !== "c" && key !== "x") return;
									event.preventDefault();
									event.stopPropagation();
									if (key === "x") onCut(item);
									else onCopy(item);
								},
								onCopy: (event) => {
									event.preventDefault();
									event.stopPropagation();
									onCopy(item);
								},
								onCut: (event) => {
									event.preventDefault();
									event.stopPropagation();
									onCut(item);
								},
								onClick: () => {
									onOpen(item);
								},`

const ITEM_ACTIONS_ORIGINAL = `							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: AttachmentRail_module_css_default.remove,`

const ITEM_ACTIONS_PATCHED = `							}), (0, react_jsx_runtime.jsxs)("div", {
								className: "hd-draft-image-actions",
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "hd-draft-image-action",
									title: labels.copy(item.alt),
									"aria-label": labels.copy(item.alt),
									onClick: (event) => {
										event.stopPropagation();
										onCopy(item);
									},
									children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutline16, { size: 12 })
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "hd-draft-image-action",
									title: labels.cut(item.alt),
									"aria-label": labels.cut(item.alt),
									onClick: (event) => {
										event.stopPropagation();
										onCut(item);
									},
									children: (0, react_jsx_runtime.jsx)(DraftCutIcon, {})
								})]
							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: AttachmentRail_module_css_default.remove,`

const RAIL_LABELS_ORIGINAL = `				scrollLeft: t("image.scrollLeft"),
				scrollRight: t("image.scrollRight")`

const RAIL_LABELS_PATCHED = `				scrollLeft: t("image.scrollLeft"),
				scrollRight: t("image.scrollRight"),
				copy: (name) => t("image.copy", { name }),
				cut: (name) => t("image.cut", { name })`

const TRANSFER_HELPER_ANCHOR = `			const closePreview = (0, react.useCallback)(() => {
				setPreview(null);
			}, []);`

const TRANSFER_HELPER_PATCHED = `${TRANSFER_HELPER_ANCHOR}
			const transferImage = (0, react.useCallback)((attachment, cut) => {
				rememberDraftImage(attachment.file);
				if (cut) onRemoveImage(attachment.id);
			}, [onRemoveImage]);`

const DRAG_EFFECT_ORIGINAL = `			(0, react.useEffect)(() => {
				const fileTransfer = (event) => {
					const dataTransfer = event.dataTransfer;
					if (dataTransfer === null || !dataTransfer.types.includes("Files")) return null;
					return dataTransfer;
				};
				const reset = () => {
					dragDepth.current = 0;
					setDragActive(false);
				};
				const onDragEnter = (event) => {
					if (fileTransfer(event) === null) return;
					event.preventDefault();
					dragDepth.current += 1;
					setDragActive(true);
				};
				const onDragOver = (event) => {
					const dataTransfer = fileTransfer(event);
					if (dataTransfer === null) return;
					event.preventDefault();
					dataTransfer.dropEffect = canAcceptDrop ? "copy" : "none";
				};
				const onDragLeave = (event) => {
					if (fileTransfer(event) === null) return;
					dragDepth.current = Math.max(0, dragDepth.current - 1);
					if (dragDepth.current === 0) setDragActive(false);
					const leftViewport = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
					if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset();
				};
				const onDrop = (event) => {
					const dataTransfer = fileTransfer(event);
					if (dataTransfer === null) return;
					event.preventDefault();
					reset();
					if (canAcceptDrop) onAddImages([...dataTransfer.files]);
				};
				document.addEventListener("dragenter", onDragEnter);
				document.addEventListener("dragover", onDragOver);
				document.addEventListener("dragleave", onDragLeave);
				document.addEventListener("drop", onDrop);
				window.addEventListener("dragend", reset);
				return () => {
					document.removeEventListener("dragenter", onDragEnter);
					document.removeEventListener("dragover", onDragOver);
					document.removeEventListener("dragleave", onDragLeave);
					document.removeEventListener("drop", onDrop);
					window.removeEventListener("dragend", reset);
				};
			}, [canAcceptDrop, onAddImages]);`

const DRAG_EFFECT_PATCHED = `			(0, react.useEffect)(() => {
				let watchdog = null;
				const fileTransfer = (event) => {
					const dataTransfer = event.dataTransfer;
					if (dataTransfer === null || !dataTransfer.types.includes("Files")) return null;
					return dataTransfer;
				};
				const reset = () => {
					if (watchdog !== null) window.clearTimeout(watchdog);
					watchdog = null;
					dragDepth.current = 0;
					setDragActive(false);
				};
				const armWatchdog = () => {
					if (watchdog !== null) window.clearTimeout(watchdog);
					watchdog = window.setTimeout(reset, 1200);
				};
				const onDragEnter = (event) => {
					if (fileTransfer(event) === null) return;
					event.preventDefault();
					dragDepth.current += 1;
					setDragActive(true);
					armWatchdog();
				};
				const onDragOver = (event) => {
					const dataTransfer = fileTransfer(event);
					if (dataTransfer === null) return;
					event.preventDefault();
					dataTransfer.dropEffect = canAcceptDrop ? "copy" : "none";
					armWatchdog();
				};
				const onDragLeave = (event) => {
					if (fileTransfer(event) === null) return;
					dragDepth.current = Math.max(0, dragDepth.current - 1);
					if (dragDepth.current === 0) reset();
					const leftViewport = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
					if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset();
				};
				const onDrop = (event) => {
					const dataTransfer = fileTransfer(event);
					reset();
					if (dataTransfer === null) return;
					event.preventDefault();
					if (canAcceptDrop) onAddImages([...dataTransfer.files]);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") reset();
				};
				const onVisibilityChange = () => {
					if (document.hidden) reset();
				};
				document.addEventListener("dragenter", onDragEnter);
				document.addEventListener("dragover", onDragOver);
				document.addEventListener("dragleave", onDragLeave);
				document.addEventListener("drop", onDrop);
				document.addEventListener("dragend", reset);
				document.addEventListener("pointerdown", reset, true);
				document.addEventListener("keydown", onKeyDown);
				document.addEventListener("visibilitychange", onVisibilityChange);
				window.addEventListener("dragend", reset);
				window.addEventListener("blur", reset);
				window.addEventListener("pagehide", reset);
				return () => {
					if (watchdog !== null) window.clearTimeout(watchdog);
					document.removeEventListener("dragenter", onDragEnter);
					document.removeEventListener("dragover", onDragOver);
					document.removeEventListener("dragleave", onDragLeave);
					document.removeEventListener("drop", onDrop);
					document.removeEventListener("dragend", reset);
					document.removeEventListener("pointerdown", reset, true);
					document.removeEventListener("keydown", onKeyDown);
					document.removeEventListener("visibilitychange", onVisibilityChange);
					window.removeEventListener("dragend", reset);
					window.removeEventListener("blur", reset);
					window.removeEventListener("pagehide", reset);
				};
			}, [canAcceptDrop, onAddImages]);
			(0, react.useEffect)(() => {
				const clearClipboard = () => {
					draftImageClipboard = null;
				};
				const onClipboardPaste = (event) => {
					if (draftImageClipboard === null || !canAcceptDrop) return;
					const target = event.target;
					if (!(target instanceof HTMLTextAreaElement) || !target.matches("textarea[data-phase]")) return;
					const nativeFile = Array.from(event.clipboardData?.items ?? []).some((item) => item.kind === "file");
					if (nativeFile) return;
					event.preventDefault();
					event.stopPropagation();
					onAddImages([cloneDraftImageFile(draftImageClipboard)]);
				};
				document.addEventListener("paste", onClipboardPaste, true);
				document.addEventListener("copy", clearClipboard);
				document.addEventListener("cut", clearClipboard);
				window.addEventListener("blur", clearClipboard);
				return () => {
					document.removeEventListener("paste", onClipboardPaste, true);
					document.removeEventListener("copy", clearClipboard);
					document.removeEventListener("cut", clearClipboard);
					window.removeEventListener("blur", clearClipboard);
				};
			}, [canAcceptDrop, onAddImages]);`

const RAIL_CALLBACKS_ORIGINAL = `						onRemove: (item) => {
							onRemoveImage(item.attachment.id);
						}`

const RAIL_CALLBACKS_PATCHED = `						onRemove: (item) => {
							onRemoveImage(item.attachment.id);
						},
						onCopy: (item) => {
							transferImage(item.attachment, false);
						},
						onCut: (item) => {
							transferImage(item.attachment, true);
						}`

const ATTACHMENT_MARKERS = [
  'draftImageActionStyleId = "@harness-desktop/draft-image-actions-v1"',
  'function systemClipboardImage(file)',
  'function AttachmentRail({ items, labels, onOpen, onRemove, onCopy, onCut })',
  'className: "hd-draft-image-actions"',
  'window.setTimeout(reset, 1200)',
  'window.addEventListener("blur", reset)',
  'document.addEventListener("paste", onClipboardPaste, true)',
  'transferImage(item.attachment, true)'
]

const ZH_IMAGE_REMOVE = `			"image.remove": "移除图片 {name}",`
const ZH_IMAGE_TRANSFER = `${ZH_IMAGE_REMOVE}
			"image.copy": "复制图片 {name}",
			"image.cut": "剪切图片 {name}",`
const EN_IMAGE_REMOVE = `			"image.remove": "Remove image {name}",`
const EN_IMAGE_TRANSFER = `${EN_IMAGE_REMOVE}
			"image.copy": "Copy image {name}",
			"image.cut": "Cut image {name}",`
const CONVERSATION_MARKERS = ['"image.copy": "复制图片 {name}"', '"image.cut": "Cut image {name}"']

function replaceExactlyOnce(source, original, patched, label) {
  if (source.includes(patched)) return source
  const first = source.indexOf(original)
  if (first < 0 || source.indexOf(original, first + original.length) >= 0) {
    throw new Error(`Pinned DSH ${label} changed; refusing an unsafe attachment-input patch.`)
  }
  return source.slice(0, first) + patched + source.slice(first + original.length)
}

/** Patch the pinned attachment UI with recoverable dragging and draft image transfer. */
export function patchAttachmentInputSource(source) {
  const present = ATTACHMENT_MARKERS.filter(marker => source.includes(marker))
  if (present.length === ATTACHMENT_MARKERS.length) return { source, changed: false }
  if (present.length > 0) throw new Error('Pinned DSH attachment-input patch is incomplete; refusing an unsafe repair.')
  let output = replaceExactlyOnce(source, DRAFT_HELPERS_ANCHOR, DRAFT_HELPERS_PATCHED, 'attachment rail helpers')
  output = replaceExactlyOnce(output, THUMBNAIL_ACTIONS_ORIGINAL, THUMBNAIL_ACTIONS_PATCHED, 'thumbnail clipboard actions')
  output = replaceExactlyOnce(output, ITEM_ACTIONS_ORIGINAL, ITEM_ACTIONS_PATCHED, 'thumbnail action buttons')
  output = replaceExactlyOnce(output, RAIL_LABELS_ORIGINAL, RAIL_LABELS_PATCHED, 'attachment rail labels')
  output = replaceExactlyOnce(output, TRANSFER_HELPER_ANCHOR, TRANSFER_HELPER_PATCHED, 'draft image transfer helper')
  output = replaceExactlyOnce(output, DRAG_EFFECT_ORIGINAL, DRAG_EFFECT_PATCHED, 'document drag recovery')
  output = replaceExactlyOnce(output, RAIL_CALLBACKS_ORIGINAL, RAIL_CALLBACKS_PATCHED, 'draft image transfer callbacks')
  return { source: output, changed: true }
}

/** Add localized copy/cut labels to the pinned conversation namespace. */
export function patchAttachmentInputConversationSource(source) {
  const present = CONVERSATION_MARKERS.filter(marker => source.includes(marker))
  if (present.length === CONVERSATION_MARKERS.length) return { source, changed: false }
  if (present.length > 0) throw new Error('Pinned DSH attachment-input locale patch is incomplete; refusing an unsafe repair.')
  let output = replaceExactlyOnce(source, ZH_IMAGE_REMOVE, ZH_IMAGE_TRANSFER, 'Chinese attachment labels')
  output = replaceExactlyOnce(output, EN_IMAGE_REMOVE, EN_IMAGE_TRANSFER, 'English attachment labels')
  return { source: output, changed: true }
}
