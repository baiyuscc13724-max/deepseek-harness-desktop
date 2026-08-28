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
import { type AndroidDeviceEntry, type AndroidDeviceListing } from './protocol.js';
import type { AndroidPanelSource } from './android-panel-trigger.js';
/**
 * The debounce window a NEWEST target must stay stable for before the panel
 * re-targets (~1.5–2 s). An agent alternating between two devices re-arms the
 * window on every result, so the panel never ping-pongs.
 */
export declare const ANDROID_PANEL_FOLLOW_DEBOUNCE_MS = 1600;
/** One settled, in-session result the follow engine may follow. */
export interface AndroidFollowCandidate {
    serial: string;
    /** The result's own timestamp (`ToolCallBlock.time`), for newest-wins. */
    time: number;
}
/**
 * The newest settled source of the given session whose meta resolves to a
 * device serial, or undefined. Error results and results without a device are
 * skipped — the engine only follows results the panel can actually address.
 */
export declare function androidFollowNewestCandidateOf(sources: readonly AndroidPanelSource[], sessionId: string): AndroidFollowCandidate | undefined;
/** A decided serial classified against the host's device listing. */
export interface AndroidFollowTarget {
    serial: string;
    entry: AndroidDeviceEntry;
}
/**
 * Classify a follow decision's serial against the host's listing: an ONLINE
 * device re-targets the stream through the switch/grant path. Anything else —
 * an unknown serial, an offline or unauthorized device — resolves undefined
 * and the follow stays put.
 */
export declare function androidFollowTargetOf(serial: string, listing: AndroidDeviceListing): AndroidFollowTarget | undefined;
/** One emitted re-target request (consumed by the panel's commit path). */
export interface AndroidFollowDecision {
    /** Monotonic per-machine sequence (the consumer removes by it). */
    seq: number;
    /** The decided device serial (validated at commit via the listing). */
    serial: string;
}
/** The armed debounce window for the newest differing target. */
export interface AndroidFollowPending {
    serial: string;
    /** The candidate result's timestamp — only newer results re-arm. */
    version: number;
    /** `now + ANDROID_PANEL_FOLLOW_DEBOUNCE_MS` — the earliest decision time. */
    deadline: number;
}
export interface AndroidFollowState {
    /** The device the panel currently shows (auto-follow ignores it). */
    currentSerial: string | undefined;
    /** True once the user picked from the picker — auto-follow stands down. */
    userOverrode: boolean;
    /** The armed debounce window, if any. */
    pending: AndroidFollowPending | undefined;
    /** True while a follow-triggered switch is in flight (no decisions). */
    inflight: boolean;
    /** Monotonic decision sequence counter. */
    nextSeq: number;
    /** Emitted, not-yet-consumed decisions (oldest first). */
    decisions: AndroidFollowDecision[];
}
export type AndroidFollowAction =
/** A newer settled result for the current session (serial + timestamp). */
{
    kind: 'result';
    serial: string;
    version: number;
    now: number;
}
/** The debounce timer fired. */
 | {
    kind: 'tick';
    now: number;
}
/** The user picked a device from the panel's picker (override on). */
 | {
    kind: 'manual-pick';
    serial: string;
}
/** The header's resume affordance re-enables following. */
 | {
    kind: 'resume-follow';
}
/** A follow-triggered stream switch started (decisions pause). */
 | {
    kind: 'switch-start';
}
/** The switch settled; `serial` names the applied device (absent = failed). */
 | {
    kind: 'switch-settled';
    serial?: string;
    now: number;
}
/** The commit path consumed one decision. */
 | {
    kind: 'consume';
    seq: number;
};
export declare function androidFollowStateInitial(currentSerial: string | undefined): AndroidFollowState;
/**
 * The pure follow/override state machine. `now` is injected (Date.now in the
 * panel, explicit values in the smoke) so the debounce is fully
 * deterministic. A `result` never re-targets by itself — only an aged `tick`
 * (or a `switch-settled` that releases an already-aged pending) emits a
 * decision, and only while following is active and no switch is in flight.
 */
export declare function androidFollowStateNext(state: AndroidFollowState, action: AndroidFollowAction): AndroidFollowState;
