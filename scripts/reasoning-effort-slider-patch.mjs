const LEGACY_MARKER = 'dataPluginCss = "@harness-desktop/reasoning-effort-slider"'
const MARKER = 'dataPluginCss = "@harness-desktop/reasoning-effort-slider-v2"'

export function reasoningEffortChoices(reasoning, t) {
  if (reasoning === undefined) return []
  const defaultLevel = reasoning.defaultEffort === undefined
    ? undefined
    : reasoning.efforts.find(level => level.id === reasoning.defaultEffort)?.name ?? reasoning.defaultEffort
  return [{
    key: 'provider-default',
    effort: undefined,
    label: t('effort.providerDefault'),
    description: defaultLevel === undefined
      ? t('effort.providerDefaultDescription')
      : t('effort.providerDefaultLevelDescription', { effort: defaultLevel })
  }, ...reasoning.efforts.map(effort => ({
    key: `effort:${effort.id}`,
    effort: effort.id,
    label: effort.name,
    ...(effort.description === undefined ? {} : { description: effort.description })
  }))]
}

const STYLE_ANCHOR = '\t\tconst tagId = "@deepseek-ai/dsh-client-ui-model-selection/ModelSelect.module.css";'
const STYLE_PATCH = `\t\tconst effortSliderCss = ".hd-effort-slider{box-sizing:border-box;width:min(390px,calc(100vw - 42px));padding:10px 12px 12px}.hd-effort-slider-head{align-items:center;justify-content:space-between;gap:12px;display:flex}.hd-effort-slider-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}.hd-effort-slider-value{color:var(--dsw-alias-state-info-primary,var(--dsw-alias-label-primary));background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;max-width:60%;padding:2px 8px;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hd-effort-slider-description{color:var(--dsw-alias-label-tertiary);min-height:36px;margin:6px 0 8px;font-size:12px;line-height:18px}.hd-effort-slider-control{position:relative;padding:8px 3px 0}.hd-effort-slider-input{--hd-effort-progress:0%;appearance:none;width:100%;height:22px;cursor:pointer;background:transparent;margin:0;position:relative;z-index:2}.hd-effort-slider-input::-webkit-slider-runnable-track{height:4px;background:linear-gradient(90deg,var(--dsw-alias-state-info-primary,#4f7cff) 0 var(--hd-effort-progress),var(--dsw-alias-border-l2) var(--hd-effort-progress) 100%);border-radius:999px}.hd-effort-slider-input::-webkit-slider-thumb{appearance:none;width:16px;height:16px;background:var(--dsw-specific-menu);border:3px solid var(--dsw-alias-state-info-primary,#4f7cff);border-radius:50%;box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-state-info-primary,#4f7cff) 16%,transparent),0 2px 8px color-mix(in srgb,var(--dsw-alias-state-info-primary,#4f7cff) 32%,transparent);margin-top:-6px;transition:box-shadow .16s ease,transform .16s ease}.hd-effort-slider-input:hover::-webkit-slider-thumb{transform:scale(1.08)}.hd-effort-slider-input:focus-visible{outline:none}.hd-effort-slider-input:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 5px color-mix(in srgb,var(--dsw-alias-state-info-primary,#4f7cff) 24%,transparent),0 0 14px color-mix(in srgb,var(--dsw-alias-state-info-primary,#4f7cff) 42%,transparent)}.hd-effort-slider-input:disabled{cursor:wait;opacity:.55}.hd-effort-slider-ticks{height:20px;margin:0 8px;position:relative}.hd-effort-slider-tick{width:14px;height:14px;cursor:pointer;background:transparent;border:0;padding:0;position:absolute;top:-18px;left:var(--hd-effort-position);z-index:3;transform:translateX(-50%)}.hd-effort-slider-tick:before{content:'';width:6px;height:6px;background:var(--dsw-alias-border-l2);border:2px solid var(--dsw-specific-menu);border-radius:50%;position:absolute;inset:4px}.hd-effort-slider-tick-past:before{background:var(--dsw-alias-state-info-primary,#4f7cff)}.hd-effort-slider-tick-active:before{background:var(--dsw-specific-menu);border-color:var(--dsw-alias-state-info-primary,#4f7cff);box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-state-info-primary,#4f7cff) 18%,transparent);animation:hd-effort-pulse 1.8s ease-in-out infinite}.hd-effort-slider-tick:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:2px;border-radius:50%}.hd-effort-slider-labels{grid-template-columns:repeat(var(--hd-effort-count),minmax(0,1fr));gap:4px;display:grid}.hd-effort-slider-label{color:var(--dsw-alias-label-caption);text-align:center;min-width:0;font-size:10px;line-height:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hd-effort-slider-label-active{color:var(--dsw-alias-label-primary);font-weight:600}.hd-effort-slider-visually-hidden{width:1px;height:1px;white-space:nowrap;border:0;margin:-1px;padding:0;position:absolute;overflow:hidden;clip:rect(0,0,0,0)}@keyframes hd-effort-pulse{0%,100%{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-info-primary,#4f7cff) 12%,transparent)}50%{box-shadow:0 0 0 6px color-mix(in srgb,var(--dsw-alias-state-info-primary,#4f7cff) 24%,transparent)}}@media(prefers-reduced-motion:reduce){.hd-effort-slider-input::-webkit-slider-thumb{transition:none}.hd-effort-slider-tick-active:before{animation:none}}";
\t\tconst dataPluginCss = "@harness-desktop/reasoning-effort-slider-v2";
\t\tif (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(dataPluginCss) + "]") === null) {
\t\t\tconst effortSliderTag = document.createElement("style");
\t\t\teffortSliderTag.dataset.plugin = "harness-desktop";
\t\t\teffortSliderTag.dataset.pluginCss = dataPluginCss;
\t\t\teffortSliderTag.textContent = effortSliderCss;
\t\t\tdocument.head.appendChild(effortSliderTag);
\t\t}
`

const CHOICES_ORIGINAL = `\t\t\tconst reasoning = currentChoice?.model.reasoning;
\t\t\tconst effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
\t\t\tconst effortLabel = reasoning === void 0 ? void 0 : effectiveEffort === void 0 ? t("effort.providerDefault") : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;
\t\t\tconst effortChoices = (0, react.useMemo)(() => reasoning === void 0 ? [] : [...reasoning.defaultEffort === void 0 ? [{
\t\t\t\tkey: "provider-default",
\t\t\t\teffort: void 0,
\t\t\t\tlabel: t("effort.providerDefault")
\t\t\t}] : [], ...reasoning.efforts.map((effort) => ({
\t\t\t\tkey: \`effort:\${effort.id}\`,
\t\t\t\teffort: effort.id,
\t\t\t\tlabel: effort.name,
\t\t\t\t...effort.description === void 0 ? {} : { description: effort.description }
\t\t\t}))], [reasoning, t]);
\t\t\tconst busy = state.status === "selecting";`

const CHOICES_PATCHED = `\t\t\tconst reasoning = currentChoice?.model.reasoning;
\t\t\tconst effectiveEffort = state.current?.reasoningEffort;
\t\t\tconst effortLabel = reasoning === void 0 ? void 0 : effectiveEffort === void 0 ? t("effort.providerDefault") : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;
\t\t\tconst effortChoices = (0, react.useMemo)(() => reasoning === void 0 ? [] : [{
\t\t\t\tkey: "provider-default",
\t\t\t\teffort: void 0,
\t\t\t\tlabel: t("effort.providerDefault"),
\t\t\t\tdescription: reasoning.defaultEffort === void 0 ? t("effort.providerDefaultDescription") : t("effort.providerDefaultLevelDescription", { effort: reasoning.efforts.find((level) => level.id === reasoning.defaultEffort)?.name ?? reasoning.defaultEffort })
\t\t\t}, ...reasoning.efforts.map((effort) => ({
\t\t\t\tkey: "effort:" + effort.id,
\t\t\t\teffort: effort.id,
\t\t\t\tlabel: effort.name,
\t\t\t\t...effort.description === void 0 ? {} : { description: effort.description }
\t\t\t}))], [reasoning, t]);
\t\t\tconst [effortIndex, setEffortIndex] = (0, react.useState)(0);
\t\t\tconst effortInputRef = (0, react.useRef)(null);
\t\t\tconst resetEffortPreview = () => {
\t\t\t\tconst selectedIndex = effortChoices.findIndex((level) => level.effort === effectiveEffort);
\t\t\t\tsetEffortIndex(selectedIndex < 0 ? 0 : selectedIndex);
\t\t\t};
\t\t\t(0, react.useEffect)(resetEffortPreview, [effortChoices, effectiveEffort, pane]);
\t\t\tconst currentEffortChoice = effortChoices[effortIndex] ?? effortChoices[0];
\t\t\tconst busy = state.status === "selecting";`

const PANE_START = '\t\t\t\t\t\tpane === "effort" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [state.error !== null'
const PANE_END = '\t\t\t\t\t\t\t}, level.key))] })'
const PANE_PATCHED = `\t\t\t\t\t\tpane === "effort" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [state.error !== null && lastActionRef.current === "load" && (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\tclassName: ModelSelect_module_css_default.error,
\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("span", { children: t("error.action", { message: state.error }) }), (0, react_jsx_runtime.jsx)("button", { type: "button", className: ModelSelect_module_css_default.retry, onClick: reload, children: t("action.reload") })]
\t\t\t\t\t\t}), effortChoices.length === 0 ? (0, react_jsx_runtime.jsx)("div", { className: ModelSelect_module_css_default.empty, children: t("empty.efforts") }) : (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\tclassName: "hd-effort-slider",
\t\t\t\t\t\t\trole: "group",
\t\t\t\t\t\t\t"aria-labelledby": id + "-effort-title",
\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("div", { className: "hd-effort-slider-head", children: [(0, react_jsx_runtime.jsx)("span", { id: id + "-effort-title", className: "hd-effort-slider-title", children: t("effort.sliderTitle") }), (0, react_jsx_runtime.jsx)("span", { className: "hd-effort-slider-value", "aria-live": "polite", children: currentEffortChoice?.label })] }), (0, react_jsx_runtime.jsx)("p", {
\t\t\t\t\t\t\t\tid: id + "-effort-description",
\t\t\t\t\t\t\t\tclassName: "hd-effort-slider-description",
\t\t\t\t\t\t\t\tchildren: currentEffortChoice?.description ?? t("effort.selectionHint")
\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsxs)("div", { className: "hd-effort-slider-control", children: [(0, react_jsx_runtime.jsx)("input", {
\t\t\t\t\t\t\t\tref: effortInputRef,
\t\t\t\t\t\t\t\ttype: "range",
\t\t\t\t\t\t\t\tmin: 0,
\t\t\t\t\t\t\t\tmax: Math.max(0, effortChoices.length - 1),
\t\t\t\t\t\t\t\tstep: 1,
\t\t\t\t\t\t\t\tvalue: effortIndex,
\t\t\t\t\t\t\t\tdisabled: busy,
\t\t\t\t\t\t\t\tclassName: "hd-effort-slider-input",
\t\t\t\t\t\t\t\tstyle: { "--hd-effort-progress": (effortChoices.length < 2 ? 0 : effortIndex / (effortChoices.length - 1) * 100) + "%" },
\t\t\t\t\t\t\t\t"aria-label": t("effort.sliderAria"),
\t\t\t\t\t\t\t\t"aria-valuetext": currentEffortChoice?.label,
\t\t\t\t\t\t\t\t"aria-describedby": id + "-effort-description",
\t\t\t\t\t\t\t\tonChange: (event) => setEffortIndex(Number(event.currentTarget.value)),
\t\t\t\t\t\t\t\tonPointerUp: (event) => chooseEffort(effortChoices[Number(event.currentTarget.value)]?.effort),
\t\t\t\t\t\t\t\tonKeyDown: (event) => event.stopPropagation(),
\t\t\t\t\t\t\t\tonKeyUp: (event) => {
\t\t\t\t\t\t\t\t\tif (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) chooseEffort(effortChoices[Number(event.currentTarget.value)]?.effort);
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("div", { className: "hd-effort-slider-ticks", children: effortChoices.map((level, index) => (0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\t\t\ttype: "button",
\t\t\t\t\t\t\t\tdisabled: busy,
\t\t\t\t\t\t\t\tclassName: "hd-effort-slider-tick" + (index <= effortIndex ? " hd-effort-slider-tick-past" : "") + (index === effortIndex ? " hd-effort-slider-tick-active" : ""),
\t\t\t\t\t\t\t\tstyle: { "--hd-effort-position": (effortChoices.length < 2 ? 50 : index / (effortChoices.length - 1) * 100) + "%" },
\t\t\t\t\t\t\t\t"aria-label": t("effort.tickAria", { effort: level.label }),
\t\t\t\t\t\t\t\t"aria-pressed": index === effortIndex,
\t\t\t\t\t\t\t\ttitle: level.description ?? level.label,
\t\t\t\t\t\t\t\tonClick: () => { setEffortIndex(index); chooseEffort(level.effort); },
\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("span", { className: "hd-effort-slider-visually-hidden", children: level.label })
\t\t\t\t\t\t\t}, level.key)) }), (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\t\tclassName: "hd-effort-slider-labels",
\t\t\t\t\t\t\t\tstyle: { "--hd-effort-count": effortChoices.length },
\t\t\t\t\t\t\t\t"aria-hidden": true,
\t\t\t\t\t\t\t\tchildren: effortChoices.map((level, index) => (0, react_jsx_runtime.jsx)("span", { className: "hd-effort-slider-label" + (index === effortIndex ? " hd-effort-slider-label-active" : ""), title: level.label, children: level.label }, level.key))
\t\t\t\t\t\t\t})] })]
\t\t\t\t\t\t})] })`

const EFFORT_SYNC_LEGACY = `\t\t\t(0, react.useEffect)(() => {
\t\t\t\tconst selectedIndex = effortChoices.findIndex((level) => level.effort === effectiveEffort);
\t\t\t\tsetEffortIndex(selectedIndex < 0 ? 0 : selectedIndex);
\t\t\t}, [effortChoices, effectiveEffort, pane]);`
const EFFORT_SYNC_PATCHED = `\t\t\tconst resetEffortPreview = () => {
\t\t\t\tconst selectedIndex = effortChoices.findIndex((level) => level.effort === effectiveEffort);
\t\t\t\tsetEffortIndex(selectedIndex < 0 ? 0 : selectedIndex);
\t\t\t};
\t\t\t(0, react.useEffect)(resetEffortPreview, [effortChoices, effectiveEffort, pane]);`

const CHOOSE_EFFORT_ORIGINAL = `\t\t\t\tlastActionRef.current = "select";
\t\t\t\tselect(selection).then(settleSelection);
\t\t\t};
\t\t\tconst modelLabel = currentChoice?.model.name ?? t("trigger.fallback");`
const CHOOSE_EFFORT_INLINE_ROLLBACK = `\t\t\t\tlastActionRef.current = "select";
\t\t\t\tselect(selection).then((accepted) => {
\t\t\t\t\tif (!accepted) {
\t\t\t\t\t\tconst selectedIndex = effortChoices.findIndex((level) => level.effort === effectiveEffort);
\t\t\t\t\t\tsetEffortIndex(selectedIndex < 0 ? 0 : selectedIndex);
\t\t\t\t\t}
\t\t\t\t\tsettleSelection(accepted);
\t\t\t\t});
\t\t\t};
\t\t\tconst modelLabel = currentChoice?.model.name ?? t("trigger.fallback");`
const CHOOSE_EFFORT_PATCHED = `\t\t\t\tlastActionRef.current = "select";
\t\t\t\tselect(selection).then((accepted) => {
\t\t\t\t\tif (!accepted) resetEffortPreview();
\t\t\t\t\tsettleSelection(accepted);
\t\t\t\t});
\t\t\t};
\t\t\tconst modelLabel = currentChoice?.model.name ?? t("trigger.fallback");`

const LOCALE_ORIGINAL = '\t\t\t"effort.providerDefault": "Default",'
const ZH_LOCALE = `${LOCALE_ORIGINAL}\n\t\t\t"effort.providerDefaultDescription": "由提供方自动选择当前模型的推理强度。",\n\t\t\t"effort.providerDefaultLevelDescription": "由提供方自动选择；当前推荐档位为 {effort}。",\n\t\t\t"effort.sliderTitle": "推理强度",\n\t\t\t"effort.sliderAria": "选择推理强度",\n\t\t\t"effort.tickAria": "选择推理强度：{effort}",\n\t\t\t"effort.selectionHint": "选择此模型提供的推理强度。",`
const EN_LOCALE = `${LOCALE_ORIGINAL}\n\t\t\t"effort.providerDefaultDescription": "Let the provider choose this model's reasoning effort automatically.",\n\t\t\t"effort.providerDefaultLevelDescription": "Let the provider choose automatically; its current recommended level is {effort}.",\n\t\t\t"effort.sliderTitle": "Reasoning effort",\n\t\t\t"effort.sliderAria": "Select reasoning effort",\n\t\t\t"effort.tickAria": "Select reasoning effort: {effort}",\n\t\t\t"effort.selectionHint": "Choose a reasoning effort offered by this model.",`

function replaceExactlyOnce(source, original, patched, label) {
  const first = source.indexOf(original)
  if (first < 0 || source.indexOf(original, first + original.length) >= 0) {
    throw new Error(`Pinned DSH ${label} changed; refusing an unsafe reasoning-effort slider patch.`)
  }
  return source.slice(0, first) + patched + source.slice(first + original.length)
}

function migrateLegacySlider(source) {
  let output = replaceExactlyOnce(source, LEGACY_MARKER, MARKER, 'legacy reasoning effort marker')
  if (!output.includes(EFFORT_SYNC_PATCHED)) {
    output = replaceExactlyOnce(output, EFFORT_SYNC_LEGACY, EFFORT_SYNC_PATCHED, 'legacy reasoning effort preview sync')
  }
  if (!output.includes(CHOOSE_EFFORT_PATCHED)) {
    const legacySelection = output.includes(CHOOSE_EFFORT_INLINE_ROLLBACK) ? CHOOSE_EFFORT_INLINE_ROLLBACK : CHOOSE_EFFORT_ORIGINAL
    output = replaceExactlyOnce(output, legacySelection, CHOOSE_EFFORT_PATCHED, 'legacy reasoning effort rollback')
  }
  return { source: output, changed: true }
}

export function patchReasoningEffortSliderSource(source) {
  if (source.includes(MARKER)) return { source, changed: false }
  if (source.includes(LEGACY_MARKER)) return migrateLegacySlider(source)
  let output = replaceExactlyOnce(source, STYLE_ANCHOR, STYLE_PATCH + STYLE_ANCHOR, 'model selection styles')
  output = replaceExactlyOnce(output, CHOICES_ORIGINAL, CHOICES_PATCHED, 'reasoning effort metadata mapping')
  output = replaceExactlyOnce(output, CHOOSE_EFFORT_ORIGINAL, CHOOSE_EFFORT_PATCHED, 'reasoning effort selection settlement')

  const paneStart = output.indexOf(PANE_START)
  const paneEnd = paneStart < 0 ? -1 : output.indexOf(PANE_END, paneStart)
  if (paneStart < 0 || paneEnd < 0 || output.indexOf(PANE_START, paneStart + PANE_START.length) >= 0) {
    throw new Error('Pinned DSH effort pane changed; refusing an unsafe reasoning-effort slider patch.')
  }
  output = output.slice(0, paneStart) + PANE_PATCHED + output.slice(paneEnd + PANE_END.length)

  const firstLocale = output.indexOf(LOCALE_ORIGINAL)
  const secondLocale = firstLocale < 0 ? -1 : output.indexOf(LOCALE_ORIGINAL, firstLocale + LOCALE_ORIGINAL.length)
  const thirdLocale = secondLocale < 0 ? -1 : output.indexOf(LOCALE_ORIGINAL, secondLocale + LOCALE_ORIGINAL.length)
  if (firstLocale < 0 || secondLocale < 0 || thirdLocale >= 0) {
    throw new Error('Pinned DSH effort dictionaries changed; refusing an unsafe reasoning-effort slider patch.')
  }
  output = output.slice(0, secondLocale) + EN_LOCALE + output.slice(secondLocale + LOCALE_ORIGINAL.length)
  output = output.slice(0, firstLocale) + ZH_LOCALE + output.slice(firstLocale + LOCALE_ORIGINAL.length)
  return { source: output, changed: true }
}
