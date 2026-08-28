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
import type { CSSProperties } from 'react';
import { type AndroidLocale } from './copy.js';
import { type AndroidSelectGroup } from './android-select.js';
import { type AndroidDeviceEntry, type AndroidDeviceInfo, type AndroidFetcher, type AndroidStreamMeta, type AndroidSwitchResponse } from './protocol.js';
/** Picker chrome over the DSH theme tokens. Exported for the smoke. */
export declare const ANDROID_DEVICE_PICKER_STYLES: Record<string, CSSProperties>;
/** The plugin-owned spinner keyframes (injected once by the panel host). */
export declare const ANDROID_DEVICE_PICKER_KEYFRAMES = "@keyframes dsh-android-switch-spin{to{transform:rotate(360deg)}}";
/** Group-heading glyphs: a desktop monitor for emulators, a phone for real
 * hardware, a disc for the not-yet-booted AVD images. */
export declare const ANDROID_DEVICE_KIND_ICON_PATHS: Record<'emulator' | 'physical' | 'avd', readonly string[]>;
/** One inline group glyph (14px, currentColor — the heading's token color). */
export declare function AndroidDeviceKindIcon({ kind }: {
    kind: 'emulator' | 'physical' | 'avd';
}): React.JSX.Element;
/** One kind group for the picker (emulators first, then physical devices). */
export interface AndroidDeviceGroup {
    kind: 'emulator' | 'physical';
    devices: AndroidDeviceEntry[];
}
/** The human label of one device row: the model, falling back to the serial. */
export declare function androidDeviceLabelOf(device: {
    serial: string;
    model?: string;
}): string;
/**
 * Group the listing by device kind, preserving the host's order inside each
 * group (online first, then serial — the client never re-sorts). When the
 * current device is missing from the listing (stale list, fetch failure,
 * fresh switch) it is injected so the select's value always has a matching
 * option and the picker keeps showing the device.
 */
export declare function androidDeviceGroupsOf(devices: readonly AndroidDeviceEntry[], current?: AndroidDeviceInfo): AndroidDeviceGroup[];
/**
 * Build the AndroidSelect groups: one group per device kind (with its glyph,
 * the streamed device marked ● and the other online ones with a hollow ring)
 * plus the DISABLED AVD hint group at the bottom. Exported so the smoke can
 * render `AndroidSelectMenu` with the exact groups.
 */
export declare function androidDeviceSelectGroupsOf(devices: readonly AndroidDeviceEntry[], avds: readonly string[], currentDevice: AndroidDeviceInfo | undefined, locale: AndroidLocale): AndroidSelectGroup[];
export interface AndroidDevicePickerBodyProps {
    /** Devices from the host listing (may be empty). */
    devices: readonly AndroidDeviceEntry[];
    /** AVD names from the host listing (rendered as an inert hint group). */
    avds?: readonly string[];
    /** The current streamed device (select value + fallback option). */
    currentDevice?: AndroidDeviceInfo;
    /** Transitional state: switch POST in flight or the new grant not yet live. */
    switching: boolean;
    /** Inline switch-failure message (empty → hidden). */
    error: string;
    locale: AndroidLocale;
    onSelect: (serial: string) => void;
    /** Fires when the picker opens/focuses — the list-refresh hook. */
    onOpen?: () => void;
}
/**
 * Pure picker presentation: the token-styled select with one group per device
 * kind, the inert AVD hint group, the transitional 切换中… readout and the
 * inline switch error. SSR-safe — no effects, no fetch.
 */
export declare function AndroidDevicePickerBody({ devices, avds, currentDevice, switching, error, locale, onSelect, onOpen, }: AndroidDevicePickerBodyProps): React.JSX.Element;
export interface AndroidDevicePickerProps {
    fetcher?: AndroidFetcher;
    sessionId?: string;
    /** The current streamed device (select value + fallback option). */
    currentDevice?: AndroidDeviceInfo;
    /** Transitional state owned by the panel (switch in flight / grant pending). */
    switching: boolean;
    /** Inline switch-failure message owned by the panel. */
    error: string;
    locale: AndroidLocale;
    onSelect: (serial: string) => void;
}
/**
 * Connected picker: refreshes the device list from the host on every open
 * (focus precedes open — no polling, no fetch during render/SSR). A failed
 * listing keeps the previous/current-device-only state and is retried on the
 * next open.
 */
export declare function AndroidDevicePicker({ fetcher, sessionId, currentDevice, switching, error, locale, onSelect, }: AndroidDevicePickerProps): React.JSX.Element;
/** Synthetic stream meta for the switched device — the meta the panel adopts
 * after a switch (the same capsule-style synthetic source
 * `androidSwitchedPanelRequestOf` wraps for the store/registry). */
export declare function androidSwitchedStreamMetaOf(result: AndroidSwitchResponse): AndroidStreamMeta;
export interface AndroidDeviceSwitchControllerOptions {
    /** Fetcher to POST the switch-device endpoint with (defaults to fetch). */
    fetcher?: AndroidFetcher;
    sessionId?: string;
    /** Locale table used to localize the route's failure code (androidCopy). */
    copy?: Record<string, string>;
    /** Observes the transitional flag (true on pick, false on failure; on
     * success the panel clears it once the new stream draws a frame). */
    onSwitchingChange?: (switching: boolean) => void;
    /** The parsed capability + device identity of a successful switch. */
    onSwitched: (result: AndroidSwitchResponse) => void;
    /** The failure message of a rejected switch (409/5xx/parse failure). */
    onError: (message: string) => void;
}
export interface AndroidDeviceSwitchController {
    /** POST the switch-device route for `serial`; false while one is in flight
     * (the client-side half of the no-concurrent-switches contract). */
    switchTo: (serial: string) => boolean;
    dispose: () => void;
}
/**
 * The pure device-switch state machine: POSTs `/switch-device` `{device}`,
 * guards against concurrent switches, and reports the parsed result or the
 * failure. The dev-panel-smoke script drives it with a mocked fetcher; the
 * panel binds it to its seeded-grant flow.
 */
export declare function createAndroidDeviceSwitchController(options: AndroidDeviceSwitchControllerOptions): AndroidDeviceSwitchController;
