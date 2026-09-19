import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { writePatchedRuntimeFile } from './deep-audit-runtime-patch.mjs'

export const QUESTION_PACKAGE = '@deepseek-ai/dsh-client-ui-user-questions'
export const QUESTION_VERSION = '0.1.2-alpha.5'
export const QUESTION_BASE_SHA256 = '232a66c60ab295db19336fbe37ab3b0c326b38a17c9d1d0cf23371b8b4664df6'
export const QUESTION_PATCHED_SHA256 = '6f382a535cb182b062365773c57b23579e8195c0096901c1864c0b1ae0079457'
const digest = source => createHash('sha256').update(source).digest('hex')
function once(source, oldText, newText) {
  if (source.split(oldText).length !== 2) throw new Error('Question card patch anchor is not unique')
  return source.replace(oldText, newText)
}

// No labels/checkboxes or native touch handlers are synthesized: the original
// button onClick remains the sole activation path, and native pan cancels clicks.
// This patch hardens independently reproduced batched update/submit races; it
// does NOT claim to diagnose all native Android lost-touch or transport faults.
export function patchQuestionCardSource(source) {
  const before = digest(source)
  if (before === QUESTION_PATCHED_SHA256) return source
  if (before !== QUESTION_BASE_SHA256) throw new Error(`Unsupported question bundle SHA-256: ${before}`)
  let result = once(source, '\t\tfunction QuestionFlow({ pending, t, useStore, actions }) {', `		// Harness question-card repair: state belongs to the pending carrier, not a
		// render incarnation. A strict slot remount cannot submit an in-flight card twice.
		const questionActionStates = new WeakMap();
		function questionActionState(pending) {
			let state = questionActionStates.get(pending);
			if (state) return state;
			let snapshot = { busy: null, error: null };
			const listeners = new Set();
			state = {
				getSnapshot: () => snapshot,
				subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
				set: (patch) => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); }
			};
			questionActionStates.set(pending, state);
			return state;
		}
		function QuestionFlow({ pending, t, useStore, actions }) {`)
  result = once(result, `			const [busy, setBusy] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);`, `			const actionState = (0, react.useMemo)(() => questionActionState(pending), [pending]);
			const { busy, error } = (0, react.useSyncExternalStore)(actionState.subscribe, actionState.getSnapshot);
			const setBusy = (busy) => actionState.set({ busy });
			const setError = (error) => actionState.set({ error });
			const progressRef = (0, react.useRef)({ index, drafts });
			progressRef.current = { index, drafts };`)
  result = once(result, `			const replaceProgress = (nextIndex, nextDrafts) => {
				actions.replace(pending.key, {
					index: nextIndex,
					drafts: nextDrafts
				});
			};`, `			const replaceProgress = (nextIndex, nextDrafts) => {
				const next = { index: nextIndex, drafts: nextDrafts };
				progressRef.current = next;
				actions.replace(pending.key, next);
			};`)
  result = once(result, '\t\t\tconst cancelFlow = () => {', `			const movePage = (delta) => {
				const current = progressRef.current;
				if (actionState.getSnapshot().busy !== null || current.index !== index) return;
				const nextIndex = current.index + delta;
				if (nextIndex < 0 || nextIndex >= questions.length) return;
				replaceProgress(nextIndex, current.drafts);
				setError(null);
			};
			const cancelFlow = () => {`)
  for (const delta of [-1, 1]) {
    const indent = '\t'.repeat(11)
    result = once(result, `${indent}replaceProgress(index ${delta < 0 ? '-' : '+'} 1, drafts);\n${indent}setError(null);`, `${indent}movePage(${delta});`)
  }
  result = once(result, `			const cancelFlow = () => {
				setBusy("cancel");`, `			const cancelFlow = () => {
				if (actionState.getSnapshot().busy !== null) return;
				setBusy("cancel");`)
  result = once(result, '\t\t\t\tpending.cancel().then(() => {', '\t\t\t\tPromise.resolve().then(() => pending.cancel()).then(() => {')
  result = once(result, `			const updateDraft = (update, nextIndex = index) => {
				replaceProgress(nextIndex, drafts.map((item, itemIndex) => itemIndex === index ? update(item) : item));`, `			const updateDraft = (update, nextIndex = index) => {
				const current = progressRef.current;
				if (actionState.getSnapshot().busy !== null || current.index !== index) return;
				replaceProgress(nextIndex, current.drafts.map((item, itemIndex) => itemIndex === index ? update(item) : item));`)
  result = once(result, '\t\t\tconst submitDrafts = (values) => {', '\t\t\tconst submitDrafts = (values) => {\n\t\t\t\tif (actionState.getSnapshot().busy !== null) return;')
  result = once(result, '\t\t\t\tpending.answer(answer).then(() => {', '\t\t\t\tPromise.resolve().then(() => pending.answer(answer)).then(() => {')
  result = once(result, `			const continueFlow = () => {
				if (!answered(draft)) {`, `			const continueFlow = () => {
				const current = progressRef.current;
				if (actionState.getSnapshot().busy !== null || current.index !== index) return;
				if (!answered(current.drafts[index])) {`)
  result = once(result, '\n\t\t\t\t\treplaceProgress(index + 1, drafts);', '\n\t\t\t\t\treplaceProgress(index + 1, current.drafts);')
  result = once(result, '\n\t\t\t\tsubmitDrafts(drafts);', '\n\t\t\t\tsubmitDrafts(current.drafts);')
  result = once(result, `			const skipQuestion = () => {
				const nextDrafts = drafts.map`, `			const skipQuestion = () => {
				const current = progressRef.current;
				if (actionState.getSnapshot().busy !== null || current.index !== index) return;
				const nextDrafts = current.drafts.map`)
  result = once(result, 'if (event.key !== "Enter" || !drafts.every(completed)) return;', 'if (event.key !== "Enter" || event.repeat || isComposing(event) || !progressRef.current.drafts.every(completed)) return;')
  // The indented option-keyboard path is distinct from the continueFlow path.
  result = once(result, '\t\t\t\t\t\t\t\t\t\tsubmitDrafts(drafts);', '\t\t\t\t\t\t\t\t\t\tsubmitDrafts(progressRef.current.drafts);')
  result = once(result, 'if (event.key !== "Enter" || event.shiftKey || isComposing(event)) return;', 'if (event.key !== "Enter" || event.shiftKey || event.repeat || isComposing(event)) return;')
  result = once(result, 'selected && question.multiSelect !== true && QuestionComposer_module_css_default.optionSelected', 'selected && QuestionComposer_module_css_default.optionSelected')
  // Narrow to this exact component; do not alter global mobile sheets or the chat editor.
  result = once(result, '\t\t\ttag.textContent = css;', '\t\t\ttag.textContent = css + "@media(pointer:coarse){.Mbwy4a_option{min-height:48px;touch-action:manipulation}.Mbwy4a_iconButton{width:44px;height:44px}.Mbwy4a_footer{flex-wrap:wrap}.Mbwy4a_footerActions{margin-left:auto}.Mbwy4a_footerActions>button{min-height:44px}.Mbwy4a_customRow{min-height:48px}}";')
  if (digest(result) !== QUESTION_PATCHED_SHA256) throw new Error('Question card output hash mismatch')
  return result
}

// Called by the repository installer only; tests pass an isolated runtime tree.
// This module has no CLI side effect and importing it never touches node_modules.
export async function patchQuestionCardRuntime(runtimeRoot) {
  const packageRoot = path.join(runtimeRoot, 'node_modules', QUESTION_PACKAGE)
  const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  if (metadata.name !== QUESTION_PACKAGE || metadata.version !== QUESTION_VERSION) throw new Error('Unsupported question package identity')
  const file = path.join(packageRoot, 'lib/client.js')
  const source = await fs.readFile(file, 'utf8')
  const patched = patchQuestionCardSource(source)
  const changed = await writePatchedRuntimeFile(file, source, patched)
  return { package: QUESTION_PACKAGE, file, changed, sha256: digest(patched) }
}
