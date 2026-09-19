/** Replayed against pinned alpha.5 client source, never against live installed files. */
export function createImageReadScheduler({ concurrency = 3, timeoutMs = 30000, maxQueued = 128 } = {}) {
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < concurrency && queue.length) {
      const ticket = queue.shift();
      if (ticket.signal.aborted) { ticket.cancel(); continue; }
      ticket.started = true;
      active++;
      // Attachment Remote has no cancellation parameter. Keep this slot until
      // the actual carrier settles, even after the consumer times out: retries
      // must not create unbounded orphan reads when the connection is stalled.
      Promise.resolve().then(() => {
        if (ticket.signal.aborted) throw ticket.signal.reason;
        return ticket.work(ticket.signal);
      }).then(ticket.resolve, ticket.reject).finally(() => {
        active--;
        ticket.cleanup();
        pump();
      });
    }
  };
  return {
    run(work, signal) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (queue.length >= maxQueued) return Promise.reject(new Error("Image read queue is full; retry when other images finish."));
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const ticket = { work, signal: controller.signal, started: false, resolve, reject };
        let timer;
        const cancel = () => {
          const reason = controller.signal.reason ?? new Error("Image read cancelled");
          const index = queue.indexOf(ticket);
          if (index >= 0) queue.splice(index, 1);
          reject(reason);
          if (!ticket.started) ticket.cleanup();
        };
        const relay = () => controller.abort(signal.reason);
        ticket.cancel = cancel;
        ticket.cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", relay);
          controller.signal.removeEventListener("abort", cancel);
        };
        controller.signal.addEventListener("abort", cancel, { once: true });
        signal?.addEventListener("abort", relay, { once: true });
        timer = setTimeout(() => controller.abort(new Error("Image loading timed out; retry.")), timeoutMs);
        queue.push(ticket);
        pump();
      });
    }
  };
}

/** One decode per cache entry, cancellable; consumers reuse the same decoded object URL. */
export function decodeImageUrl(url, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const image = new Image();
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", abort);
      image.onload = image.onerror = null;
      if (error) { image.src = ""; reject(error); }
      else resolve();
    };
    const abort = () => finish(signal.reason ?? new Error("Image decode cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    image.decoding = "async";
    image.onerror = () => finish(new Error("Image decode failed; retry."));
    image.onload = () => { if (typeof image.decode !== "function") finish(); };
    image.src = url;
    if (typeof image.decode === "function") image.decode().then(() => finish(), (error) => finish(error));
  });
}

function apply(source, replacements, name) {
  const present = replacements.filter(([, to]) => source.includes(to)).length;
  if (present === replacements.length) return { source, changed: false };
  if (present !== 0) throw new Error(`Pinned DSH ${name} patch is incomplete; refusing unsafe repair.`);
  let output = source;
  for (const [from, to] of replacements) {
    const at = output.indexOf(from);
    if (at < 0 || output.indexOf(from, at + from.length) >= 0) throw new Error(`Pinned DSH ${name} anchor changed; refusing unsafe patch.`);
    output = output.slice(0, at) + to + output.slice(at + from.length);
  }
  return { source: output, changed: true };
}

const READ_ORIGINAL = `\t\t\tasync readAttachment(attachmentId) {
\t\t\t\tconst result = await this.remote.session.attachment({
\t\t\t\t\tsessionId: this.sessionId,
\t\t\t\t\tattachmentId
\t\t\t\t});
\t\t\t\tif (!result.ok) return result;
\t\t\t\tconst binary = atob(result.value.data);
\t\t\t\tconst data = Uint8Array.from(binary, (char) => char.charCodeAt(0));`;
const READ_PATCHED = `\t\t\tasync readAttachment(attachmentId, signal) {
\t\t\t\t// @harness-desktop/image-read-signal-v1: local lifetime check; Remote accepts one argument only.
\t\t\t\tif (signal?.aborted) throw signal.reason;
\t\t\t\tconst result = await this.remote.session.attachment({
\t\t\t\t\tsessionId: this.sessionId,
\t\t\t\t\tattachmentId
\t\t\t\t});
\t\t\t\tif (!result.ok) return result;
\t\t\t\tif (signal?.aborted) throw signal.reason;
\t\t\t\tif (typeof result.value.data !== "string" || result.value.data.length > 27962028) throw new Error("Image exceeds the display byte budget");
\t\t\t\tlet data;
\t\t\t\tif (typeof Uint8Array.fromBase64 === "function") data = Uint8Array.fromBase64(result.value.data);
\t\t\t\telse {
\t\t\t\t\tconst binary = atob(result.value.data);
\t\t\t\t\tdata = new Uint8Array(binary.length);
\t\t\t\t\tfor (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
\t\t\t\t}`;

export function patchImagePreviewSessionSource(source) {
  return apply(source, [[READ_ORIGINAL, READ_PATCHED]], 'image session read');
}

const LOAD_ORIGINAL = `\t\t\tloadCanonical(key, entry, attachment) {
\t\t\t\tconst binding = this.sessions.binding(entry.sessionId);
\t\t\t\tif (binding === void 0) return Promise.reject(/* @__PURE__ */ new Error(\`ui-conversation: unknown session "\${entry.sessionId}"\`));
\t\t\t\treturn binding.session.readAttachment(attachment.attachmentId).then((result) => {
\t\t\t\t\tif (!result.ok) throw new Error(\`\${result.error.code}: \${result.error.message}\`);
\t\t\t\t\tthis.assertLive(key, entry);
\t\t\t\t\tlet url;
\t\t\t\t\tif (typeof URL.createObjectURL !== "function") url = \`data:\${result.value.attachment.mediaType};base64,\${bytesToBase64(result.value.data)}\`;
\t\t\t\t\telse {
\t\t\t\t\t\tconst bytes = Uint8Array.from(result.value.data);
\t\t\t\t\t\turl = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }));
\t\t\t\t\t}
\t\t\t\t\tthis.assertLive(key, entry);
\t\t\t\t\tthis.urls.add(url);
\t\t\t\t\tconst previous = entry.current;
\t\t\t\t\tentry.current = url;
\t\t\t\t\tif (previous !== void 0 && previous !== url) this.releaseUrl(previous);
\t\t\t\t\treturn url;
\t\t\t\t}).catch((error) => {
\t\t\t\t\tif (this.entries.get(key) === entry && entry.current === void 0) this.entries.delete(key);
\t\t\t\t\tthrow error;
\t\t\t\t});
\t\t\t}`;
const LOAD_PATCHED = `\t\t\tloadCanonical(key, entry, attachment) {
\t\t\t\tentry.controller = new AbortController();
\t\t\t\treturn this.desktopImageReads.run(async (signal) => {
\t\t\t\t\tthis.assertLive(key, entry);
\t\t\t\t\tconst binding = this.sessions.binding(entry.sessionId);
\t\t\t\t\tif (binding === void 0) throw new Error("Image session scope is unavailable");
\t\t\t\t\tconst result = await binding.session.readAttachment(attachment.attachmentId, signal);
\t\t\t\t\tif (signal.aborted) throw signal.reason;
\t\t\t\t\tif (!result.ok) throw new Error(\`\${result.error.code}: \${result.error.message}\`);
\t\t\t\t\tthis.assertLive(key, entry);
\t\t\t\t\tconst bytes = result.value.data;
\t\t\t\t\tif (bytes.byteLength > 20971520) throw new Error("Image exceeds the display byte budget");
\t\t\t\t\tconst url = typeof URL.createObjectURL === "function"
\t\t\t\t\t\t? URL.createObjectURL(new Blob([bytes], { type: result.value.attachment.mediaType }))
\t\t\t\t\t\t: \`data:\${result.value.attachment.mediaType};base64,\${bytesToBase64(bytes)}\`;
\t\t\t\t\tthis.urls.add(url);
\t\t\t\t\ttry {
\t\t\t\t\t\tawait decodeImageUrl(url, signal);
\t\t\t\t\t\tif (signal.aborted) throw signal.reason;
\t\t\t\t\t\tthis.assertLive(key, entry);
\t\t\t\t\t} catch (error) { this.releaseUrl(url); throw error; }
\t\t\t\t\tconst previous = entry.current;
\t\t\t\t\tentry.current = url;
\t\t\t\t\tif (previous !== void 0 && previous !== url) this.releaseUrl(previous);
\t\t\t\t\treturn url;
\t\t\t\t}, entry.controller.signal).catch((error) => {
\t\t\t\t\tif (this.entries.get(key) === entry && entry.current === void 0) this.entries.delete(key);
\t\t\t\t\tthrow error;
\t\t\t\t});
\t\t\t}`;

export function patchImagePreviewConversationSource(source) {
  return apply(source, [
    ['\t\tvar HistoricalImageCache = class {', `\t\t// @harness-desktop/image-preview-performance-v1\n${createImageReadScheduler.toString()}\n${decodeImageUrl.toString()}\n\t\tvar HistoricalImageCache = class {\n\t\t\tdesktopImageReads = createImageReadScheduler();`],
    [LOAD_ORIGINAL, LOAD_PATCHED],
    ['\t\t\t\t\tif (entry.sessionId !== sessionId) continue;\n\t\t\t\t\tthis.entries.delete(key);', '\t\t\t\t\tif (entry.sessionId !== sessionId) continue;\n\t\t\t\t\tentry.controller?.abort(new Error("Image session scope released"));\n\t\t\t\t\tthis.entries.delete(key);'],
    ['\t\t\t\tfor (const url of this.urls) revokeUrl(url);', '\t\t\t\tfor (const entry of this.entries.values()) entry.controller?.abort(new Error("Image cache disposed"));\n\t\t\t\tfor (const url of this.urls) revokeUrl(url);']
  ], 'image preview cache');
}

/** Keep decode failures retryable rather than presenting a broken image forever. */
export function patchImagePreviewAttachmentSource(source) {
  return apply(source, [
    ['\t\t\tconst [attempt, setAttempt] = (0, react.useState)(0);', `\t\t\tconst [attempt, setAttempt] = (0, react.useState)(0);
\t\t\tconst frameRef = (0, react.useRef)(null);
\t\t\tconst [visible, setVisible] = (0, react.useState)(() => typeof IntersectionObserver !== "function");
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (visible || frameRef.current === null) return;
\t\t\t\tconst observer = new IntersectionObserver((entries) => {
\t\t\t\t\tif (!entries.some((entry) => entry.isIntersecting)) return;
\t\t\t\t\tsetVisible(true);
\t\t\t\t\tobserver.disconnect();
\t\t\t\t}, { rootMargin: "256px" });
\t\t\t\tobserver.observe(frameRef.current);
\t\t\t\treturn () => observer.disconnect();
\t\t\t}, [visible]);`],
    ['\t\t\t\tif (attachment === void 0) return;\n\t\t\t\tlet live = true;', '\t\t\t\tif (attachment === void 0 || !visible) return;\n\t\t\t\tlet live = true;'],
    ['\t\t\t\tattachment,\n\t\t\t\tload,\n\t\t\t\tattempt', '\t\t\t\tattachment,\n\t\t\t\tload,\n\t\t\t\tattempt,\n\t\t\t\tvisible'],
    ['\t\t\t\tclassName: MessageImage_module_css_default.frame,\n\t\t\t\t"data-variant": variant,', '\t\t\t\tclassName: MessageImage_module_css_default.frame,\n\t\t\t\tref: frameRef,\n\t\t\t\t"data-variant": variant,'],
    ['\t\t\t\t\tsrc,\n\t\t\t\t\talt: label,\n\t\t\t\t\tstyle: fit', '\t\t\t\t\tsrc,\n\t\t\t\t\talt: label,\n\t\t\t\t\tdecoding: "async",\n\t\t\t\t\tonError: () => setError(true),\n\t\t\t\t\tstyle: fit'],
    ['\t\t\t\t\tclassName: MessageImage_module_css_default.loading,\n\t\t\t\t\tchildren: labels.loading', '\t\t\t\t\tclassName: MessageImage_module_css_default.loading,\n\t\t\t\t\trole: "status",\n\t\t\t\t\t"aria-busy": true,\n\t\t\t\t\tchildren: labels.loading']
  ], 'image preview presentation');
}
