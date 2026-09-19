/** Keep observed admission settlement independent of a hidden/minimized frame clock. */
export function desktopScheduleSubmissionFrame(fn) {
  let settled = false;
  let frame;
  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (frame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    fn();
  };
  const timer = setTimeout(finish, 100);
  if (typeof requestAnimationFrame === "function" && (typeof document === "undefined" || document.visibilityState !== "hidden")) frame = requestAnimationFrame(finish);
  else { clearTimeout(timer); setTimeout(finish, 0); }
}

/** Bound native file reads and honour cancellation before any prompt is admitted. */
export function desktopBase64Of(file, signal, timeoutMs = 30000) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let done = false;
    let timer;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) { if (reader.readyState === 1) reader.abort(); reject(error); }
      else resolve(value);
    };
    const abort = () => finish(signal.reason ?? new Error("Image preparation cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(new Error("Image preparation timed out; draft retained.")), timeoutMs);
    reader.onload = () => {
      const url = reader.result;
      if (typeof url !== "string" || !url.includes(",")) return finish(new Error("Invalid image file read"));
      finish(null, url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => finish(reader.error ?? new Error("Image read failed"));
    reader.onabort = () => finish(new Error("Image preparation cancelled"));
    try { reader.readAsDataURL(file); } catch (error) { finish(error); }
  });
}

/** Preserve input order with at most two FileReaders, not N full-size buffers. */
export async function desktopSerializeImages(images, encode, signal) {
  if (signal?.aborted) throw signal.reason;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const output = new Array(images.length);
  let next = 0;
  const lane = async () => {
    while (next < images.length) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const index = next++;
      output[index] = { type: "image", ...await encode(images[index], controller.signal) };
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(2, images.length) }, lane)); return output; }
  catch (error) { controller.abort(error); throw error; }
  finally { signal?.removeEventListener("abort", abort); }
}

function apply(source, replacements, name) {
  const present = replacements.filter(([, to]) => source.includes(to)).length;
  if (present === replacements.length) return { source, changed: false };
  if (present !== 0) throw new Error(`Pinned DSH ${name} patch is incomplete; refusing unsafe repair.`);
  let output = source;
  for (const [from, to] of replacements) {
    const at = output.indexOf(from);
    if (at < 0 || output.indexOf(from, at + from.length) >= 0) throw new Error(`Pinned DSH ${name} anchor changed; refusing unsafe patch: ${from.slice(0, 100)}`);
    output = output.slice(0, at) + to + output.slice(at + from.length);
  }
  return { source: output, changed: true };
}

const FRAME_ORIGINAL = `\t\tfunction scheduleFrame(fn) {
\t\t\tif (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
\t\t\t\tfn();
\t\t\t});
\t\t\telse setTimeout(fn, 0);
\t\t}`;
export function patchComposerQueueSessionSource(source) {
  return apply(source, [[FRAME_ORIGINAL, `\t\t// @harness-desktop/submission-frame-fallback-v1\n${desktopScheduleSubmissionFrame.toString()}\n\t\tfunction scheduleFrame(fn) { desktopScheduleSubmissionFrame(fn); }`]], 'submission retirement frame');
}

const BASE64_ORIGINAL = `\t\tfunction base64Of(file) {
\t\t\treturn new Promise((resolve, reject) => {
\t\t\t\tconst reader = new FileReader();
\t\t\t\treader.onload = () => {
\t\t\t\t\tconst url = reader.result;
\t\t\t\t\tresolve(url.slice(url.indexOf(",") + 1));
\t\t\t\t};
\t\t\t\treader.onerror = () => {
\t\t\t\t\treject(reader.error ?? /* @__PURE__ */ new Error("conversation: image read failed"));
\t\t\t\t};
\t\t\t\treader.readAsDataURL(file);
\t\t\t});
\t\t}`;
const STAGES = `\t\t// @harness-desktop/composer-stages-v1: ephemeral status only, no content or automatic resend.
\t\tconst desktopSubmissionStages = new Map();
\t\tconst desktopSubmissionListeners = new Set();
\t\tlet desktopSubmissionRevision = 0;
\t\tfunction desktopSetSubmissionStage(requestId, stage) {
\t\t\tif (stage === void 0) desktopSubmissionStages.delete(requestId);
\t\t\telse desktopSubmissionStages.set(requestId, stage);
\t\t\tdesktopSubmissionRevision++;
\t\t\tfor (const listener of desktopSubmissionListeners) listener();
\t\t}
\t\tfunction desktopSubscribeSubmissionStage(listener) {
\t\t\tdesktopSubmissionListeners.add(listener);
\t\t\treturn () => desktopSubmissionListeners.delete(listener);
\t\t}
\t\tfunction desktopSubmissionSnapshot() { return desktopSubmissionRevision; }
`;
const SERIALIZE_ORIGINAL = `\t\t\tserializeImages(images) {
\t\t\t\treturn Promise.all(images.map(async (file) => ({
\t\t\t\t\ttype: "image",
\t\t\t\t\t...await this.encodeImage(file)
\t\t\t\t})));
\t\t\t}`;
const THUMB_ORIGINAL = `\t\tfunction QueueThumb({ attachment, loadImage, label }) {
\t\t\tconst [url, setUrl] = (0, react.useState)(null);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tlet alive = true;
\t\t\t\tloadImage(attachment).then((resolved) => {
\t\t\t\t\tif (alive) setUrl(resolved);
\t\t\t\t}, () => {});
\t\t\t\treturn () => {
\t\t\t\t\talive = false;
\t\t\t\t};
\t\t\t}, [attachment, loadImage]);
\t\t\treturn url === null ? (0, react_jsx_runtime.jsx)("span", {
\t\t\t\tclassName: QueueDock_module_css_default.thumb,
\t\t\t\t"aria-hidden": true
\t\t\t}) : (0, react_jsx_runtime.jsx)("img", {
\t\t\t\tclassName: QueueDock_module_css_default.thumb,
\t\t\t\tsrc: url,
\t\t\t\talt: label
\t\t\t});
\t\t}`;
const THUMB_PATCHED = `\t\tfunction QueueThumb({ attachment, loadImage, label, failureLabel }) {
\t\t\tconst [url, setUrl] = (0, react.useState)(() => loadImage.peek?.(attachment) ?? null);
\t\t\tconst [failed, setFailed] = (0, react.useState)(false);
\t\t\tconst [attempt, setAttempt] = (0, react.useState)(0);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tlet alive = true;
\t\t\t\tsetUrl(loadImage.peek?.(attachment) ?? null);
\t\t\t\tsetFailed(false);
\t\t\t\tloadImage(attachment).then((resolved) => {
\t\t\t\t\tif (alive) setUrl(resolved);
\t\t\t\t}, () => { if (alive) setFailed(true); });
\t\t\t\treturn () => { alive = false; };
\t\t\t}, [attachment, loadImage, attempt]);
\t\t\tif (failed) return (0, react_jsx_runtime.jsx)("button", {
\t\t\t\ttype: "button", title: failureLabel, "aria-label": failureLabel,
\t\t\t\tonClick: () => setAttempt((value) => value + 1),
\t\t\t\tstyle: { minWidth: 44, minHeight: 44 },
\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, children: (0, react_jsx_runtime.jsx)("path", { d: "M13 6a5 5 0 1 0 0 4M13 2v4H9", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }) })
\t\t\t});
\t\t\treturn url === null ? (0, react_jsx_runtime.jsx)("span", {
\t\t\t\tclassName: QueueDock_module_css_default.thumb, role: "status", "aria-label": label, "aria-busy": true
\t\t\t}) : (0, react_jsx_runtime.jsx)("img", {
\t\t\t\tclassName: QueueDock_module_css_default.thumb, src: url, alt: label,
\t\t\t\tdecoding: "async", onError: () => setFailed(true)
\t\t\t});
\t\t}`;

export function patchComposerQueueConversationSource(source) {
  let pairs = [
    [BASE64_ORIGINAL, `${STAGES}\n${desktopBase64Of.toString()}\n${desktopSerializeImages.toString()}\n\t\tfunction base64Of(file, signal) { return desktopBase64Of(file, signal); }`],
    [SERIALIZE_ORIGINAL, '\t\t\tserializeImages(images, signal) {\n\t\t\t\treturn desktopSerializeImages(images, (file, readSignal) => this.encodeImage(file, readSignal), signal);\n\t\t\t}'],
    ['\t\t\tasync encodeImage(file) {\n\t\t\t\treturn {\n\t\t\t\t\tmediaType: imageMediaType(file.type),\n\t\t\t\t\tdata: await base64Of(file),', '\t\t\tasync encodeImage(file, signal) {\n\t\t\t\treturn {\n\t\t\t\t\tmediaType: imageMediaType(file.type),\n\t\t\t\t\tdata: await base64Of(file, signal),'],
    ['\t\t\t\t\tconst content = [...await this.serializeImages(attachments.map((attachment) => attachment.file)),', '\t\t\t\t\tconst content = [...await this.serializeImages(attachments.map((attachment) => attachment.file), signal),'],
    ['\t\t\t\t\tonRetire: (settlement) => {\n\t\t\t\t\t\tthis.settleSubmittedImages', '\t\t\t\t\tonRetire: (settlement) => {\n\t\t\t\t\t\tdesktopSetSubmissionStage(submission.requestId, void 0);\n\t\t\t\t\t\tthis.settleSubmittedImages'],
    ['\t\t\t\tlet content;\n\t\t\t\ttry {\n\t\t\t\t\tawait nextPaint();\n\t\t\t\t\tcontent = [...await this.serializeImages(attachments.map((attachment) => attachment.file)),', '\t\t\t\tlet content;\n\t\t\t\tdesktopSetSubmissionStage(submission.requestId, "preparing");\n\t\t\t\ttry {\n\t\t\t\t\tawait nextPaint();\n\t\t\t\t\tcontent = [...await this.serializeImages(attachments.map((attachment) => attachment.file), signal),'],
    ['\t\t\t\tif (!(await session.prompt(content, mode, signal, submission.requestId)).ok) return { kind: "error" };\n\t\t\t\tif (retirement !== void 0', '\t\t\t\tdesktopSetSubmissionStage(submission.requestId, "admitting");\n\t\t\t\tif (!(await session.prompt(content, mode, signal, submission.requestId)).ok) return { kind: "error" };\n\t\t\t\tif (desktopSubmissionStages.has(submission.requestId)) desktopSetSubmissionStage(submission.requestId, "observing");\n\t\t\t\tif (retirement !== void 0'],
    [THUMB_ORIGINAL, THUMB_PATCHED],
    ['\t\tfunction QueueDock({ useSession, updateQueue, notify, loadImage, t }) {', '\t\tfunction QueueDock({ useSession, updateQueue, notify, loadImage, t }) {\n\t\t\t(0, react.useSyncExternalStore)(desktopSubscribeSubmissionStage, desktopSubmissionSnapshot, desktopSubmissionSnapshot);'],
    ['\t\t\t\t\t\t\t\t\t\t\tlabel: t("queue.image")', '\t\t\t\t\t\t\t\t\t\t\tlabel: t("queue.image"),\n\t\t\t\t\t\t\t\t\t\t\tfailureLabel: t("image.loadFailed")'],
    ['\t\t\t\t\t\t\t\t\tqueueMutable && (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\t\t\t\t\tclassName: QueueDock_module_css_default.actions,', '\t\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { role: "status", style: { fontSize: 12, lineHeight: "18px", maxWidth: 180, overflowWrap: "anywhere" }, "data-queue-stage": busy === row.id ? "applying" : "queued", children: t(busy === row.id ? "queue.status.applying" : running ? "queue.status.queuedBusy" : "queue.status.queued") }),\n\t\t\t\t\t\t\t\t\tqueueMutable && (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\t\t\t\t\tclassName: QueueDock_module_css_default.actions,'],
    ['\t\t\t\t\t\t\t\t\tchildren: (0, _deepseek_ai_dsh_client_ui_primitives.projectUserText)(submission.text, [])\n\t\t\t\t\t\t\t\t})', '\t\t\t\t\t\t\t\t\tchildren: (0, _deepseek_ai_dsh_client_ui_primitives.projectUserText)(submission.text, [])\n\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { role: "status", style: { fontSize: 12, lineHeight: "18px", maxWidth: 180, overflowWrap: "anywhere" }, "data-submission-stage": desktopSubmissionStages.get(submission.requestId) ?? "admitting", children: t("queue.status." + (desktopSubmissionStages.get(submission.requestId) ?? "admitting")) })'],
    ['\t\t\t\t\t\t\tloadImage: (attachment) => ctx.uiConversation.imageUrl(sessionId, attachment)', '\t\t\t\t\t\t\tloadImage: Object.assign((attachment) => ctx.uiConversation.imageUrl(sessionId, attachment), { peek: (attachment) => ctx.uiConversation.peekImageUrl(sessionId, attachment) })'],
    ['\t\t\t"queue.steerFailed": "插话发送失败，请重试。",', '\t\t\t"queue.steerFailed": "插话发送失败，请重试。",\n\t\t\t"queue.status.preparing": "正在读取图片…",\n\t\t\t"queue.status.admitting": "正在上传并验证…",\n\t\t\t"queue.status.observing": "已接收，正在同步…",\n\t\t\t"queue.status.applying": "正在应用…",\n\t\t\t"queue.status.queuedBusy": "已排队，等待当前回复结束",\n\t\t\t"queue.status.queued": "已排队",'],
    ['\t\t\t"queue.steerFailed": "Steering failed. Try again.",', '\t\t\t"queue.steerFailed": "Steering failed. Try again.",\n\t\t\t"queue.status.preparing": "Reading images…",\n\t\t\t"queue.status.admitting": "Uploading and validating…",\n\t\t\t"queue.status.observing": "Accepted; synchronizing…",\n\t\t\t"queue.status.applying": "Applying…",\n\t\t\t"queue.status.queuedBusy": "Queued until current reply finishes",\n\t\t\t"queue.status.queued": "Queued",']
  ];
  return apply(source, pairs, 'composer queue performance');
}
