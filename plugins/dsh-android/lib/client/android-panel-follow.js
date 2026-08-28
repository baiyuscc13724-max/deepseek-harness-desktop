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
import { resolveAndroidMeta } from './android-meta-hydrate.js';
import { androidDeviceOnline, } from './protocol.js';
/**
 * The debounce window a NEWEST target must stay stable for before the panel
 * re-targets (~1.5–2 s). An agent alternating between two devices re-arms the
 * window on every result, so the panel never ping-pongs.
 */
export const ANDROID_PANEL_FOLLOW_DEBOUNCE_MS = 1600;
/**
 * The newest settled source of the given session whose meta resolves to a
 * device serial, or undefined. Error results and results without a device are
 * skipped — the engine only follows results the panel can actually address.
 */
export function androidFollowNewestCandidateOf(sources, sessionId) {
    if (sessionId === '')
        return undefined;
    let best;
    for (const source of sources) {
        if ('kind' in source.block && source.block.kind === 'tool-result' && source.block.isError)
            continue;
        if (source.sessionId !== sessionId)
            continue;
        const meta = resolveAndroidMeta(source.toolName, source.block)?.meta;
        const serial = meta?.device?.serial;
        if (typeof serial !== 'string' || serial === '')
            continue;
        const time = typeof source.block.time === 'number' && Number.isFinite(source.block.time)
            ? source.block.time
            : 0;
        if (best === undefined || time > best.time)
            best = { serial, time };
    }
    return best;
}
/**
 * Classify a follow decision's serial against the host's listing: an ONLINE
 * device re-targets the stream through the switch/grant path. Anything else —
 * an unknown serial, an offline or unauthorized device — resolves undefined
 * and the follow stays put.
 */
export function androidFollowTargetOf(serial, listing) {
    if (serial === '')
        return undefined;
    for (const device of listing.devices) {
        if (device.serial !== serial)
            continue;
        return androidDeviceOnline(device) ? { serial, entry: device } : undefined;
    }
    return undefined;
}
export function androidFollowStateInitial(currentSerial) {
    return {
        currentSerial,
        userOverrode: false,
        pending: undefined,
        inflight: false,
        nextSeq: 1,
        decisions: [],
    };
}
function emitDecision(state, serial) {
    return {
        ...state,
        pending: undefined,
        decisions: [...state.decisions, { seq: state.nextSeq, serial }],
        nextSeq: state.nextSeq + 1,
    };
}
/**
 * The pure follow/override state machine. `now` is injected (Date.now in the
 * panel, explicit values in the smoke) so the debounce is fully
 * deterministic. A `result` never re-targets by itself — only an aged `tick`
 * (or a `switch-settled` that releases an already-aged pending) emits a
 * decision, and only while following is active and no switch is in flight.
 */
export function androidFollowStateNext(state, action) {
    switch (action.kind) {
        case 'result': {
            // The user's manual pick wins: later results never re-target.
            if (state.userOverrode)
                return state;
            // The panel already shows this device (or the serial is empty): nothing
            // to follow — an equal result also cancels any armed window.
            if (action.serial === '' || action.serial === state.currentSerial) {
                return state.pending === undefined ? state : { ...state, pending: undefined };
            }
            // Only NEWER results re-arm: an out-of-order or repeated candidate must
            // not push the window out.
            if (state.pending !== undefined && action.version <= state.pending.version)
                return state;
            return {
                ...state,
                pending: {
                    serial: action.serial,
                    version: action.version,
                    deadline: action.now + ANDROID_PANEL_FOLLOW_DEBOUNCE_MS,
                },
            };
        }
        case 'tick': {
            if (state.userOverrode || state.inflight || state.pending === undefined)
                return state;
            if (action.now < state.pending.deadline)
                return state;
            return emitDecision(state, state.pending.serial);
        }
        case 'manual-pick': {
            // The user acted: auto-follow stands down for the rest of the panel
            // session. The pick also re-bases the current device and drops any
            // not-yet-applied decision — the explicit choice supersedes it.
            return {
                ...state,
                currentSerial: action.serial === '' ? state.currentSerial : action.serial,
                userOverrode: true,
                pending: undefined,
                decisions: [],
            };
        }
        case 'resume-follow': {
            // The header's one-click resume: following is active again from the
            // NEXT new result (a stale armed window was dropped by the pick).
            return { ...state, userOverrode: false };
        }
        case 'switch-start': {
            return { ...state, inflight: true };
        }
        case 'switch-settled': {
            const base = {
                ...state,
                inflight: false,
                ...(typeof action.serial === 'string' && action.serial !== ''
                    ? { currentSerial: action.serial }
                    : {}),
            };
            // A target that aged through the whole switch stint is still the newest
            // stable result — release it now that the flight is over.
            if (base.userOverrode || base.pending === undefined || base.pending.deadline > action.now) {
                return base;
            }
            return emitDecision(base, base.pending.serial);
        }
        case 'consume': {
            return { ...state, decisions: state.decisions.filter(decision => decision.seq !== action.seq) };
        }
    }
}
