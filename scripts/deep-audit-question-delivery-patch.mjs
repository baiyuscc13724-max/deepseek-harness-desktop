import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { patchQuestionCardSource, QUESTION_PACKAGE, QUESTION_VERSION, QUESTION_BASE_SHA256, QUESTION_PATCHED_SHA256 } from './deep-audit-question-card-patch.mjs'
import { writePatchedRuntimeFile } from './deep-audit-runtime-patch.mjs'
export const GATEWAY_PACKAGE = '@deepseek-ai/dsh-api-gateway'
export const GATEWAY_CLIENT_BASE_SHA256 = '55dbd591222b28e557e7d47368f7770114a88d97206e910fae940768c83950cd'
export const QUESTION_DELIVERY_SHA256 = '39f1fa00ea15159b6700e553787f6071d06974c676d4fa269c5d6a80519b0fa7'
export const GATEWAY_DELIVERY_SHA256 = '52814635f68d59587542b5d2f0fc1835ac9e6d4ecad2c50ed7085c2ba4ed63cc'
const digest = s => createHash('sha256').update(s).digest('hex')
function once(s,a,b){if(s.split(a).length!==2)throw Error('Question delivery anchor not unique: '+a.slice(0,100));return s.replace(a,b)}
const gatewayHelper = String.raw`
		// Harness local question delivery v1. No wire fields or business replay.
		const QUESTION_DELIVERY = Symbol.for("harness.question.delivery.v1");
		class QuestionDelivery {
			listeners = new Set(); snapshot = Object.freeze({ phase: "editing" }); terminal = false;
			constructor(ownerToken, target, frame, generationToken, clientId, signal) {
				this.signal = signal;
				this.abort = () => this.end(this.snapshot.phase === "editing" ? "interrupted-before-answer" : "unknown");
				this.api = Object.freeze({ version: 1, ownerToken, target, event: frame.event, eventId: frame.eventId, agentId: frame.agentId, generationToken, clientId, attemptToken: Object.freeze({}),
					getSnapshot: () => this.snapshot,
					subscribe: listener => { if (!this.terminal) this.listeners.add(listener); return () => this.listeners.delete(listener); }
				});
				signal.addEventListener("abort", this.abort, { once: true });
				if (signal.aborted) this.abort();
			}
			publish(phase) {
				this.snapshot = Object.freeze({ phase });
				for (const listener of [...this.listeners]) { try { Promise.resolve(listener()).catch(error => console.error("question delivery observer failed", error)); } catch (error) { console.error("question delivery observer failed", error); } }
			}
			begin() { if (!this.terminal) this.publish("submitting"); }
			end(phase) {
				if (this.terminal) return;
				this.terminal = true; this.signal.removeEventListener("abort", this.abort);
				this.publish(phase); this.listeners.clear();
			}
		}
`
const gatewayAnswer = String.raw`			async answer(frame, clientId, signal, generationToken) {
				const adapter = this.ownerCtx.typert.contexts.getClient("agent");
				let target, delivery;
				try { target = adapter?.resolve(frame.agentId); } catch (error) { this.reportError(frame.event, error); }
				if (target !== void 0 && frame.event === "user-questions/request") {
					delivery = new QuestionDelivery(this.questionOwnerToken, target, frame, generationToken, clientId, signal);
					this.questionDeliveries.add(delivery);
				}
				try {
					let outcome = { kind: "next" };
					if (target !== void 0) try {
						outcome = await this.dispatchWaterfall(target, frame, signal, delivery?.api);
					} catch (error) {
						if (signal.aborted) return;
						outcome = { kind: "rejected", error: projectRemoteEventRejection(error) };
					}
					if (signal.aborted) return;
					const result = { clientId, eventId: frame.eventId, outcome: outcome.kind === "result" && outcome.value === void 0 ? { kind: "result" } : outcome };
					delivery?.begin();
					const deadline = delivery ? new AbortController() : void 0;
					const timer = deadline ? setTimeout(() => { delivery.end("unknown"); deadline.abort(new Error("question delivery acknowledgement timeout")); }, 30000) : void 0;
					try {
						const response = await this.connection.rpc.call("/api", REMOTE_EVENT_RESULT_ENDPOINT, { args: result }, deadline ? AbortSignal.any([signal, deadline.signal]) : signal);
						if (!response.ok) throw new Error(response.error.message);
						if (!signal.aborted) delivery?.end("transport-acknowledged");
					} finally { if (timer !== void 0) clearTimeout(timer); }
				} catch (error) { delivery?.end("unknown"); throw error; }
				finally { delivery?.end(signal.aborted ? "unknown" : "remote-ended"); if (delivery) this.questionDeliveries.delete(delivery); }
			}
`
export function deriveGatewayDeliverySource(source) {
  if(digest(source)!==GATEWAY_CLIENT_BASE_SHA256)throw Error('Unsupported gateway delivery base')
  let s=once(source,'\t\tvar ClientRemoteEvents = class {',gatewayHelper+'\t\tvar ClientRemoteEvents = class {\n\t\t\tquestionOwnerToken = Object.freeze({});\n\t\t\tquestionDeliveries = new Set();')
  s=once(s,'\t\t\tasync dispose() {\n\t\t\t\tthis.unregisterGeneration();','\t\t\tasync dispose() {\n\t\t\t\tfor (const delivery of this.questionDeliveries) delivery.end("owner-disposed");\n\t\t\t\tthis.unregisterGeneration();')
  s=once(s,'\t\t\tasync pumpEvents(signal, ready) {','\t\t\tasync pumpEvents(signal, ready) {\n\t\t\t\tconst generationToken = Object.freeze({});')
  s=once(s,'\t\t\t\t\t\tif (frame.type === "cancel") {','\t\t\t\t\t\tif (frame.type === "cancel") {\n\t\t\t\t\t\t\tfor (const delivery of this.questionDeliveries) if (delivery.api.generationToken === generationToken && delivery.api.eventId === frame.eventId) delivery.end("remote-ended");')
  s=once(s,'\t\t\t\t\t\tconst controller = new AbortController();','\t\t\t\t\t\tif (frame.event === "user-questions/request" && active.has(frame.eventId)) throw new TypeError("duplicate active question event frame");\n\t\t\t\t\t\tconst controller = new AbortController();')
  s=once(s,'this.answer(frame, clientId, deliverySignal)','this.answer(frame, clientId, deliverySignal, generationToken)')
  s=once(s,'\t\t\t\t\t\t\tactive.delete(frame.eventId);','\t\t\t\t\t\t\tif (active.get(frame.eventId) === controller) active.delete(frame.eventId);')
  const start=s.indexOf('\t\t\tasync answer(frame, clientId, signal) {'),end=s.indexOf('\t\t\tasync dispatchWaterfall(',start);if(start<0||end<0)throw Error('gateway answer boundary')
  s=once(s,s.slice(start,end),gatewayAnswer)
  s=once(s,'async dispatchWaterfall(target, frame, signal) {','async dispatchWaterfall(target, frame, signal, delivery) {')
  s=once(s,'\t\t\t\tconst value = await abortable(Promise.resolve(privateEvents(target).waterfall', '\t\t\t\tif (delivery) Object.defineProperty(request, QUESTION_DELIVERY, { value: delivery });\n\t\t\t\tconst value = await abortable(Promise.resolve(privateEvents(target).waterfall')
  return s
}
const questionHelper = String.raw`
		// Harness question UI receipt ownership. Memory-only; no new remote calls.
		const QUESTION_DELIVERY = Symbol.for("harness.question.delivery.v1");
		const LEGACY_DELIVERY_VIEW = { getSnapshot: () => LEGACY_DELIVERY_SNAPSHOT, subscribe: () => () => {} };
		const LEGACY_DELIVERY_SNAPSHOT = Object.freeze({ phase: "legacy", readOnly: false, message: null });
		function questionCanonical(value) {
			let nodes = 0;
			const visit = (v, depth) => {
				if (++nodes > 8192 || depth > 32) throw Error("question recovery value too complex");
				if (v === null || typeof v === "boolean") return v;
				if (typeof v === "string") { if (v.length > 65536) throw Error("question recovery string too large"); return v; }
				if (typeof v === "number" && Number.isFinite(v)) return v;
				if (Array.isArray(v)) return v.map(x => visit(x, depth + 1));
				if (typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype) throw Error("question recovery needs JSON data");
				return Object.fromEntries(Object.keys(v).sort().map(k => [k, visit(v[k], depth + 1)]));
			};
			const text = JSON.stringify(visit(value, 0));
			if (new TextEncoder().encode(text).byteLength > 65536) throw Error("question recovery record too large");
			return text;
		}
		function createQuestionDeliveryRegistry(ctx) {
			const entries = new Set(), views = new Set(); let timer, disposed = false;
			const bytes = text => new TextEncoder().encode(text).byteLength;
			const schedule = () => {
				if (timer !== void 0) clearTimeout(timer); timer = void 0;
				const expiry = Math.min(...[...entries, ...views].map(r => r.expires));
				if (!disposed && Number.isFinite(expiry)) timer = setTimeout(() => { timer = void 0; purge(); }, Math.max(0, expiry - performance.now()));
			};
			const remove = (record, closeView = true) => {
				if (!entries.delete(record)) return;
				record.active = false; if (closeView) record.close?.(); record.close = void 0;
				record.release?.(); record.release = void 0;
			};
			const purge = () => { for (const r of [...entries]) if (r.expires <= performance.now()) remove(r); for (const view of [...views]) if (view.expires <= performance.now()) view.close(); schedule(); };
			const trim = record => {
				while (entries.size > 64 || [...entries].filter(r => r.owner === record.owner).length > 32 || [...entries].reduce((n,r) => n + r.bytes, 0) > 1048576) {
					const victim = [...entries].find(r => r !== record && (entries.size > 64 || [...entries].reduce((n,x)=>n+x.bytes,0)>1048576 || r.owner === record.owner)) || record;
					remove(victim, !["editing", "submitting"].includes(victim.phase));
				}
			};
			const registry = {
				open(owner, sessionId, questions, handle) {
					purge(); if (disposed) return;
					for (const view of [...views]) if (view.owner === owner && view.sessionId === sessionId && view.readOnlyUnknown()) view.close();
					let structure; try { structure = questionCanonical(questions); } catch { return; }
					const old = [...entries].find(r => r.gateway === handle.ownerToken && r.owner === owner && r.sessionId === sessionId && r.eventId === handle.eventId && r.agentId === handle.agentId);
					const recoverable = old && old.structure === structure && old.generation !== handle.generationToken && ["unknown", "interrupted-before-answer"].includes(old.phase);
					const recovered = recoverable ? old.progress : void 0, deadline = recoverable ? old.deadline : void 0;
					if (old) remove(old);
					const record = { active: true, gateway: handle.ownerToken, owner, sessionId, eventId: handle.eventId, agentId: handle.agentId, generation: handle.generationToken, attempt: handle.attemptToken, structure, progress: recovered, phase: "editing", deadline, expires: Infinity, bytes: bytes(structure) + (recovered ? bytes(JSON.stringify(recovered)) : 0) };
					entries.add(record);
					try { record.release = owner.effect(() => () => { remove(record); schedule(); }, "question recovery owner"); } catch { remove(record); return; }
					trim(record); return record.active ? record : void 0;
				},
				save(record, progress) {
					if (!record?.active || disposed) return false;
					try { const text = questionCanonical(progress), size = bytes(record.structure) + bytes(text); if (size > 65536) throw Error("record too large"); record.progress = JSON.parse(text); record.bytes = size; trim(record); return record.active; }
					catch { remove(record, false); schedule(); return false; }
				},
				finish(record, phase) {
					if (!record?.active) return;
					record.phase = phase;
					if (phase === "unknown" || phase === "interrupted-before-answer") { record.deadline ??= performance.now() + 300000; record.expires = record.deadline; }
					else if (phase !== "editing" && phase !== "submitting") remove(record);
					schedule();
				},
				view(value) { value.expires = Infinity; views.add(value); return () => { views.delete(value); schedule(); }; },
				expireView(value, record) {
					value.expires = record?.deadline ?? performance.now() + 300000;
					// Uncached/oversized drafts still own a notice; bound terminal views separately.
					let unknown = [...views].filter(view => view.readOnlyUnknown());
					while (unknown.length > 64 || unknown.filter(view => view.owner === value.owner).length > 32) {
						const victim = unknown.find(view => unknown.length > 64 || view.owner === value.owner);
						victim.close(); unknown = [...views].filter(view => view.readOnlyUnknown());
					}
					schedule();
				},
				forget(record) { remove(record); schedule(); },
				dispose() { if (disposed) return; disposed = true; for (const view of [...views]) view.close(); views.clear(); for (const record of [...entries]) remove(record); if (timer !== void 0) clearTimeout(timer); timer = void 0; },
				stats: () => ({ entries: entries.size, views: views.size, bytes: [...entries].reduce((n,r)=>n+r.bytes,0), timers: timer === void 0 ? 0 : 1 })
			};
			ctx.effect(() => () => registry.dispose(), "question delivery registry");
			return registry;
		}
		function attachQuestionDelivery(ctx, owner, request, pending, registry) {
			const h = request[QUESTION_DELIVERY];
			if (!registry || h?.version !== 1 || h.target !== owner || h.event !== "user-questions/request" || typeof h.eventId !== "string" || typeof h.agentId !== "string" || h.agentId !== pending.sessionId || !h.ownerToken || !h.generationToken || !h.attemptToken || typeof h.clientId !== "string" || typeof h.getSnapshot !== "function" || typeof h.subscribe !== "function") return;
			const record = registry.open(owner, pending.sessionId, pending.questions, h);
			let snapshot = Object.freeze({ phase: "editing", readOnly: false, message: record?.progress ? "delivery.restored" : record ? null : "delivery.uncached" }), closed = false, removeUI = () => {}, releaseOwner = () => {};
			const listeners = new Set(), completion = Promise.withResolvers(); completion.promise.catch(() => {});
			let unsubscribe = () => {}, releaseView = () => {};
			const publish = patch => { snapshot = Object.freeze({ ...snapshot, ...patch }); for (const listener of [...listeners]) listener(); };
			const close = () => { if (closed) return; closed = true; pending.abort(questionError("question presentation closed", "ASK_ABORTED")); completion.reject(questionError("question delivery status unavailable", "ASK_DELIVERY_CLOSED")); unsubscribe(); releaseView(); releaseOwner(); removeUI(); listeners.clear(); if (record) record.close = void 0; };
			const ownedView = { owner, sessionId: pending.sessionId, close, readOnlyUnknown: () => snapshot.phase === "unknown" };
			const current = () => !closed && ctx.sessions.scopeOf(owner) === pending.sessionId;
			const observe = () => {
				if (!current()) { close(); registry.forget(record); return; }
				const { phase } = h.getSnapshot();
				if (phase === "editing") return;
				publish({ phase, readOnly: true, message: phase === "submitting" ? "delivery.submitting" : phase === "unknown" || phase === "interrupted-before-answer" ? "delivery.unknown" : null });
				if (phase === "transport-acknowledged") completion.resolve();
				else if (phase !== "submitting") completion.reject(questionError("question delivery is not confirmed; no automatic resubmission", "ASK_DELIVERY_UNKNOWN"));
				registry.finish(record, phase);
				if (phase === "unknown") registry.expireView(ownedView, record);
				if (["transport-acknowledged", "remote-ended", "owner-disposed", "interrupted-before-answer"].includes(phase)) close();
			};
			pending.deliveryView = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, dismiss: close };
			pending.deliveryInitialProgress = record?.progress;
			pending.deliverySaveProgress = progress => { if (current() && !registry.save(record, progress)) publish({ message: "delivery.uncached" }); };
			pending.deliveryWait = () => completion.promise;
			pending.deliveryClaim = () => { if (!current() || snapshot.readOnly) throw questionError("question delivery already pending", "ASK_DELIVERY_BUSY"); publish({ readOnly: true, message: "delivery.submitting" }); };
			unsubscribe = h.subscribe(observe);
			releaseView = registry.view(ownedView);
			try { releaseOwner = owner.effect(() => () => { if (!closed) { close(); registry.forget(record); } },  "question delivery presentation"); } catch { close(); }
			if (record) record.close = close;
			return { mount(remove) { removeUI = remove; if (closed) remove(); else observe(); }, close, dispose: () => { close(); registry.forget(record); }, submitted: () => snapshot.readOnly, view: pending.deliveryView };
		}
		function QuestionDeliveryView({ pending, t, children }) {
			const view = pending.deliveryView ?? LEGACY_DELIVERY_VIEW;
			const state = (0, react.useSyncExternalStore)(view.subscribe, view.getSnapshot);
			return (0, react_jsx_runtime.jsxs)("div", { "data-question-delivery": state.phase, "aria-busy": state.phase === "submitting", children: [
				state.message ? (0, react_jsx_runtime.jsx)("div", { role: "status", children: t(state.message) }) : null,
				(0, react_jsx_runtime.jsx)("fieldset", { disabled: state.readOnly, style: { border: 0, padding: 0, margin: 0, minWidth: 0 }, children }),
				state.phase === "unknown" ? (0, react_jsx_runtime.jsx)("button", { type: "button", style: { minHeight: 44, padding: "8px 12px" }, onClick: () => view.dismiss(), children: t("delivery.dismiss") }) : null
			] });
		}
`
export function deriveQuestionDeliverySource(source) {
  if(![QUESTION_BASE_SHA256,QUESTION_PATCHED_SHA256].includes(digest(source)))throw Error('Unsupported question delivery base')
  let s=patchQuestionCardSource(source)
  s=once(s,'\t\tvar PendingQuestion = class {',questionHelper+'\t\tvar PendingQuestion = class {')
  s=once(s,'\t\t\tanswer(answer) {\n\t\t\t\treturn settlePendingComposer(() => {','\t\t\tanswer(answer) {\n\t\t\t\treturn settlePendingComposer(() => {\n\t\t\t\t\tthis.deliveryClaim?.();')
  s=once(s,'}, "pending question settlement failed");','}, "pending question settlement failed").then(() => this.deliveryWait?.());')
  s=once(s,'\t\t\tcancel() {\n\t\t\t\treturn settlePendingComposer(() => {','\t\t\tcancel() {\n\t\t\t\treturn settlePendingComposer(() => {\n\t\t\t\t\tthis.deliveryClaim?.();')
  s=once(s,'}, "pending question cancellation failed");','}, "pending question cancellation failed").then(() => this.deliveryWait?.());')
  s=once(s,'return review === void 0 ? (0, react_jsx_runtime.jsx)(QuestionFlow, {','const content = review === void 0 ? (0, react_jsx_runtime.jsx)(QuestionFlow, {')
  s=once(s,'\t\t\t}, question.key);\n\t\t}\n\t\t// Harness question-card repair:', '\t\t\t}, question.key);\n\t\t\treturn (0, react_jsx_runtime.jsx)(QuestionDeliveryView, { pending: question, t: props.t, children: content });\n\t\t}\n\t\t// Harness question-card repair:')
  s=once(s,'const initialProgress = (0, react.useMemo)(() => ({','const initialProgress = (0, react.useMemo)(() => pending.deliveryInitialProgress ?? ({')
  s=once(s,'\t\t\t\tprogressRef.current = next;','\t\t\t\tprogressRef.current = next;\n\t\t\t\tpending.deliverySaveProgress?.(next);')
  s=once(s,'async function answerQuestion(ctx, owner, request, next, registerPendingInteraction) {','async function answerQuestion(ctx, owner, request, next, registerPendingInteraction, deliveryRegistry) {')
  s=once(s,'\t\t\tconst completed = Promise.withResolvers();','\t\t\tconst delivery = attachQuestionDelivery(ctx, owner, request, pending, deliveryRegistry);\n\t\t\tconst completed = Promise.withResolvers();')
  s=once(s,'\t\t\t\tpending.delegate();','\t\t\t\tif (delivery?.submitted()) delivery.dispose(); else pending.delegate();')
  s=once(s,'const remove = registerPendingInteraction(pending,','const releasePending = registerPendingInteraction(pending,')
  s=once(s,'\t\t\t\tawait completed.promise;\n\t\t\t});','\t\t\t\tawait completed.promise;\n\t\t\t});\n\t\t\tlet removed = false;\n\t\t\tconst remove = () => { if (!removed) { removed = true; releasePending(); } };\n\t\t\tdelivery?.mount(remove);')
  s=once(s,'if (pending.isDelegation(error)) return await next();','if (pending.isDelegation(error)) { delivery?.dispose(); remove(); completed.resolve(); return await next(); }')
  s=once(s,'\t\t\t\tremove();\n\t\t\t\tcompleted.resolve();','\t\t\t\tif (!delivery?.submitted()) { delivery?.close(); remove(); }\n\t\t\t\tcompleted.resolve();')
  s=once(s,'\t\t\tconst questionDraftStore = createQuestionDraftStore();','\t\t\tconst deliveryRegistry = createQuestionDeliveryRegistry(ctx);\n\t\t\tconst questionDraftStore = createQuestionDraftStore();')
  s=once(s,'request, next, registerPendingInteraction);','request, next, registerPendingInteraction, deliveryRegistry);')
  s=once(s,'\t\tconst zh = {','\t\tconst zh = {\n\t\t\t"delivery.submitting": "正在提交，等待回执…",\n\t\t\t"delivery.unknown": "回执未确认；不会自动重新提交，请查看会话结果。",\n\t\t\t"delivery.restored": "问题已重新到达，已保留选择；请确认后重新提交。",\n\t\t\t"delivery.uncached": "本地恢复草稿未保留。",\n\t\t\t"delivery.dismiss": "收起提示",')
  s=once(s,'\t\tconst en = {','\t\tconst en = {\n\t\t\t"delivery.submitting": "Submitting; waiting for acknowledgement…",\n\t\t\t"delivery.unknown": "Receipt unconfirmed. No automatic resubmission; check the conversation result.",\n\t\t\t"delivery.restored": "Question re-presented. Choices retained; confirm before submitting again.",\n\t\t\t"delivery.uncached": "Recovery draft was not retained locally.",\n\t\t\t"delivery.dismiss": "Hide notice",')
  return s
}
export function patchQuestionDeliverySource(source) { const h=digest(source);if(h===QUESTION_DELIVERY_SHA256)return source;const output=deriveQuestionDeliverySource(source);if(digest(output)!==QUESTION_DELIVERY_SHA256)throw Error('Question delivery output hash mismatch');return output }
export function patchGatewayDeliverySource(source) { const h=digest(source);if(h===GATEWAY_DELIVERY_SHA256)return source;const output=deriveGatewayDeliverySource(source);if(digest(output)!==GATEWAY_DELIVERY_SHA256)throw Error('Gateway delivery output hash mismatch');return output }
export async function prepareQuestionDelivery(runtimeRoot) {
  const prepared=[]
  for(const [pkg,transform] of [[QUESTION_PACKAGE,patchQuestionDeliverySource],[GATEWAY_PACKAGE,patchGatewayDeliverySource]]) {
    const dir=path.join(runtimeRoot,'node_modules',pkg),manifest=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'))
    if(manifest.name!==pkg||manifest.version!==QUESTION_VERSION)throw Error('Question delivery companion identity/version mismatch: '+pkg)
    const file=path.join(dir,'lib/client.js'),source=await fs.readFile(file,'utf8');prepared.push({pkg,file,source,output:transform(source)})
  }
  return prepared
}
export async function publishQuestionDelivery(prepared) {
  // Internal publication phase after the installer's mandatory native gate.
  if(prepared.length!==2||prepared[0].pkg!==QUESTION_PACKAGE||prepared[1].pkg!==GATEWAY_PACKAGE)throw Error('Question delivery preparation identity mismatch')
  for(const [i,transform] of [patchQuestionDeliverySource,patchGatewayDeliverySource].entries())if(transform(prepared[i].source)!==prepared[i].output)throw Error('Question delivery prepared output mismatch')
  for(const p of prepared)if(await fs.readFile(p.file,'utf8')!==p.source)throw Error('Question delivery pair changed before first write')
  let changed=false;for(const p of prepared)if(p.source!==p.output)changed=(await writePatchedRuntimeFile(p.file,p.source,p.output))||changed
  for(const p of prepared)if(await fs.readFile(p.file,'utf8')!==p.output)throw Error('Question delivery final pair verification failed')
  return {changed,files:prepared.map(p=>({package:p.pkg,file:p.file,sha256:digest(p.output)}))}
}
