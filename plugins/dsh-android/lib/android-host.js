/**
 * Host-side lifecycle manager for the one live Android device stream.
 *
 * The dsh-ios twin (sim-host.ts) manages an EXTERNAL serve-sim child with
 * orphan adoption, port ranges and handshake reconciliation; none of that
 * exists here because the stream is in-process (frame-source.ts): one
 * AdbFrameLoop per streamed serial, a consumer refcount with an idle
 * timeout, and a keep-alive that restarts a crashed loop. Emulators and
 * physical devices share this path — the serial is the only identity
 * (docs/architecture.zh.md, decision 0).
 *
 * The control surface mirrors dsh-ios's `StreamControl` contract: normalized
 * 0..1 coordinates of the streamed frame, mapped onto `adb shell input`
 * pixels using the latest frame's own size (the frame and the input space
 * are both the live display space, so one mapping serves every rotation).
 * @module @zseven-w/dsh-android/android-host
 */
import { AdbError, AdbToolchain } from './adb.js';
import { AdbFrameLoop } from './frame-source.js';
// A live PNG screencap loop is expensive. Keep it only long enough to bridge
// android_boot → panel grant; an open browser stream holds an acquire lease.
// Background AI tools use one-shot adb calls and do not need this loop alive.
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_RESTART_DELAY_MS = 5_000;
const KEEP_ALIVE_TICK_MS = 1_000;
const FIRST_FRAME_TIMEOUT_MS = 15_000;
const CONTROL_TIMEOUT_MS = 30_000;
/** Longest `input swipe` duration accepted (ms). */
const MAX_SWIPE_MS = 5_000;
/** Navigation/hardware buttons the panel and tools may press. */
export const ANDROID_BUTTONS = {
    home: 'KEYCODE_HOME',
    back: 'KEYCODE_BACK',
    recents: 'KEYCODE_APP_SWITCH',
    power: 'KEYCODE_POWER',
    volume_up: 'KEYCODE_VOLUME_UP',
    volume_down: 'KEYCODE_VOLUME_DOWN',
    menu: 'KEYCODE_MENU',
    enter: 'KEYCODE_ENTER',
    delete: 'KEYCODE_DEL',
};
/**
 * Device-level actions beyond plain touches. Everything here is a plain adb
 * verb, so unlike dsh-ios there is no per-backend delivery table — the only
 * split is that `shake` needs the emulator console and is refused elsewhere.
 */
export const ANDROID_DEVICE_ACTIONS = [
    'notifications',
    'quick-settings',
    'lock',
    'wake',
    'assistant',
];
export function isAndroidDeviceAction(value) {
    return typeof value === 'string' && ANDROID_DEVICE_ACTIONS.includes(value);
}
/** Clockwise user_rotation cycle (Surface.ROTATION_0..270). */
export const ROTATION_CYCLE = [0, 1, 2, 3];
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function requireNormalized(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        throw new RangeError('dsh-android: tap/drag coordinates must be normalized 0..1 of the streamed frame');
    }
}
/**
 * Escape one text argument for `input text`: the device-side parser expands
 * `%s` to a space and chokes on shell metacharacters, so everything unsafe
 * is escaped and spaces become `%s`. Callers gate non-ASCII beforehand.
 */
export function escapeInputText(text) {
    return text
        .replace(/[\\()<>|;&*~"'`$#!{}\[\]]/g, char => `\\${char}`)
        .replace(/ /g, '%s');
}
/** True when `input text` can deliver the string (it is ASCII-only). */
export function isInputTextSafe(text) {
    // eslint-disable-next-line no-control-regex
    return /^[\x20-\x7e]*$/.test(text) && text.length > 0;
}
export const NON_ASCII_TYPE_HINT = 'the text contains non-ASCII characters, which `adb shell input text` cannot deliver; '
    + 'install the ADBKeyboard IME on the device (github.com/senzhk/ADBKeyBoard) and select it, '
    + 'or type via the focused app\'s own UI';
/** Lifecycle manager for the (single) in-process Android device stream. */
export class AndroidHostController {
    toolchain;
    #options;
    #loop;
    #starting;
    #launchQueue = Promise.resolve();
    #consumers = 0;
    #keepAliveTimer;
    #idleTimer;
    #restarts = 0;
    #startedAt;
    #exitAt;
    #lastError;
    #lastSerial;
    #intentionalStop = false;
    #disposed = false;
    #frameSubscribers = new Set();
    constructor(toolchain, options = {}) {
        this.toolchain = toolchain ?? new AdbToolchain();
        this.#options = {
            restartDelayMs: options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS,
            idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
            firstFrameTimeoutMs: options.firstFrameTimeoutMs ?? FIRST_FRAME_TIMEOUT_MS,
        };
    }
    get available() {
        return this.toolchain.available;
    }
    get running() {
        return this.#loop?.running === true;
    }
    /** The streamed serial, when a loop is live. */
    get streamedSerial() {
        return this.running ? this.#loop?.serial : undefined;
    }
    get latestFrame() {
        return this.#loop?.latestFrame;
    }
    /** Observe every decoded frame; the returned function unsubscribes. */
    subscribeFrames(subscriber) {
        this.#frameSubscribers.add(subscriber);
        return () => {
            this.#frameSubscribers.delete(subscriber);
        };
    }
    /**
     * Make sure the frame loop is live for `serial`. Concurrent callers share
     * one launch; a call for a different serial retires the current loop first
     * (one streamed device at a time, same slot semantics as dsh-ios).
     */
    async ensureStreaming({ serial }) {
        if (this.#disposed)
            throw new Error('dsh-android: the host is disposed');
        if (typeof serial !== 'string' || serial === '')
            throw new TypeError('dsh-android: ensureStreaming requires a non-empty serial');
        const startFor = async () => {
            const current = this.#loop;
            if (current !== undefined && current.running && current.serial === serial) {
                return this.#infoOf(current);
            }
            if (current !== undefined && current.serial !== serial) {
                current.stop();
                this.#loop = undefined;
            }
            return this.#startFor(serial);
        };
        let starting = this.#starting;
        if (starting !== undefined) {
            try {
                await starting;
            }
            catch {
                // A failed shared launch is settled; retry below.
            }
            if (this.running && this.#loop?.serial === serial) {
                this.#armIdle();
                return this.#infoOf(this.#loop);
            }
            starting = undefined;
        }
        starting = this.#serializeLaunch(startFor);
        this.#starting = starting;
        try {
            const info = await starting;
            this.#lastError = undefined;
            this.#armIdle();
            return info;
        }
        catch (error) {
            this.#lastError = errorMessage(error);
            throw error;
        }
        finally {
            if (this.#starting === starting)
                this.#starting = undefined;
        }
    }
    /** Start the crash keep-alive loop (restarts an unintentionally dead loop). */
    startKeepAlive() {
        if (this.#keepAliveTimer !== undefined || this.#disposed)
            return;
        this.#keepAliveTimer = setInterval(() => {
            void this.#keepAliveTick().catch(() => { });
        }, KEEP_ALIVE_TICK_MS);
        this.#keepAliveTimer.unref?.();
    }
    stopKeepAlive() {
        if (this.#keepAliveTimer !== undefined)
            clearInterval(this.#keepAliveTimer);
        this.#keepAliveTimer = undefined;
    }
    /** Stop the stream intentionally (keep-alive will not fight it). */
    async stop() {
        this.#clearIdle();
        this.#intentionalStop = true;
        this.#exitAt = undefined;
        const loop = this.#loop;
        this.#loop = undefined;
        this.#startedAt = undefined;
        loop?.stop();
        await this.#starting?.catch(() => { });
        const landed = this.#loop;
        if (landed !== undefined) {
            this.#loop = undefined;
            landed.stop();
        }
    }
    /** Hold the stream alive for one consumer; release exactly once. */
    acquire() {
        this.#consumers += 1;
        this.#armIdle();
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            this.#consumers = Math.max(0, this.#consumers - 1);
            this.#armIdle();
        };
    }
    status() {
        const loop = this.#loop;
        const frame = loop?.latestFrame;
        return {
            available: this.available,
            running: this.running,
            ...(loop === undefined ? {} : { serial: loop.serial }),
            ...(this.#startedAt === undefined ? {} : { startedAt: this.#startedAt }),
            restarts: this.#restarts,
            ...(this.#lastError === undefined ? {} : { lastError: this.#lastError }),
            adbSource: this.toolchain.binary.source,
            ...(this.toolchain.binary.command === undefined ? {} : { adbCommand: this.toolchain.binary.command }),
            consumers: this.#consumers,
            ...(frame === undefined ? {} : {
                frameSequence: frame.sequence,
                lastFrameAt: frame.at,
                width: frame.width,
                height: frame.height,
            }),
            stderr: loop?.stderrLines ?? [],
        };
    }
    dispose() {
        this.#disposed = true;
        this.stopKeepAlive();
        this.#frameSubscribers.clear();
        return this.stop();
    }
    // ── control surface (normalized 0..1 of the streamed frame) ───────────────
    /** Tap at normalized coordinates of the streamed frame. */
    async tap(serial, x, y) {
        requireNormalized(x, y);
        const point = await this.#pixels(serial, x, y);
        await this.toolchain.shell(serial, ['input', 'tap', String(point.x), String(point.y)], { timeoutMs: CONTROL_TIMEOUT_MS });
    }
    /** Drag between normalized coordinates (`input swipe` with duration). */
    async drag(serial, drag) {
        requireNormalized(drag.fromX, drag.fromY);
        requireNormalized(drag.toX, drag.toY);
        const from = await this.#pixels(serial, drag.fromX, drag.fromY);
        const to = await this.#pixels(serial, drag.toX, drag.toY);
        const durationMs = Math.min(MAX_SWIPE_MS, Math.max(20, Math.round((drag.duration ?? 0.3) * 1000)));
        await this.toolchain.shell(serial, [
            'input', 'swipe',
            String(from.x), String(from.y), String(to.x), String(to.y), String(durationMs),
        ], { timeoutMs: CONTROL_TIMEOUT_MS + durationMs });
    }
    /** Press a navigation/hardware button by panel name or raw KEYCODE_*. */
    async button(serial, name = 'home') {
        const keycode = ANDROID_BUTTONS[name]
            ?? (/^KEYCODE_[A-Z0-9_]+$/.test(name) ? name : undefined);
        if (keycode === undefined) {
            throw new AdbError(`dsh-android: unknown button ${JSON.stringify(name)}; expected one of ${Object.keys(ANDROID_BUTTONS).join(', ')} or a KEYCODE_* name`, []);
        }
        await this.toolchain.shell(serial, ['input', 'keyevent', keycode], { timeoutMs: CONTROL_TIMEOUT_MS });
    }
    /**
     * Type text into the focused element. ASCII goes through `input text`;
     * non-ASCII (CJK, emoji) is attempted through the ADBKeyboard IME when it
     * is installed, otherwise refused with the install hint — never silently
     * mistyped.
     */
    async type(serial, text) {
        if (typeof text !== 'string' || text === '')
            throw new TypeError('dsh-android: type requires a non-empty text');
        if (isInputTextSafe(text)) {
            await this.toolchain.shell(serial, ['input', 'text', escapeInputText(text)], { timeoutMs: CONTROL_TIMEOUT_MS });
            return;
        }
        const imes = await this.toolchain.shell(serial, ['ime', 'list', '-s'], { timeoutMs: CONTROL_TIMEOUT_MS }).catch(() => '');
        if (!imes.includes('com.android.adbkeyboard')) {
            throw new AdbError(`dsh-android: ${NON_ASCII_TYPE_HINT}`, []);
        }
        // ADBKeyboard base64 mode survives quoting for every unicode payload.
        const encoded = Buffer.from(text, 'utf8').toString('base64');
        await this.toolchain.shell(serial, [
            'am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', encoded,
        ], { timeoutMs: CONTROL_TIMEOUT_MS });
    }
    /** Force the display rotation (Surface.ROTATION_0..3). */
    async rotate(serial, rotation) {
        if (!ROTATION_CYCLE.some(known => known === rotation)) {
            throw new RangeError('dsh-android: rotation must be 0, 1, 2 or 3');
        }
        // Auto-rotate would fight the explicit value; pin it first.
        await this.toolchain.shell(serial, ['settings', 'put', 'system', 'accelerometer_rotation', '0'], { timeoutMs: CONTROL_TIMEOUT_MS });
        await this.toolchain.shell(serial, ['settings', 'put', 'system', 'user_rotation', String(rotation)], { timeoutMs: CONTROL_TIMEOUT_MS });
    }
    /** The current user_rotation (0..3), defaulting to 0 when unreadable. */
    async getRotation(serial) {
        try {
            const value = Number((await this.toolchain.shell(serial, ['settings', 'get', 'system', 'user_rotation'], { timeoutMs: CONTROL_TIMEOUT_MS })).trim());
            return ROTATION_CYCLE.some(known => known === value) ? value : 0;
        }
        catch {
            return 0;
        }
    }
    /** Run one device-level action (notification shade, lock, wake, …). */
    async deviceAction(serial, action) {
        switch (action) {
            case 'notifications':
                await this.toolchain.shell(serial, ['cmd', 'statusbar', 'expand-notifications'], { timeoutMs: CONTROL_TIMEOUT_MS });
                return;
            case 'quick-settings':
                await this.toolchain.shell(serial, ['cmd', 'statusbar', 'expand-settings'], { timeoutMs: CONTROL_TIMEOUT_MS });
                return;
            case 'lock':
                await this.toolchain.shell(serial, ['input', 'keyevent', 'KEYCODE_SLEEP'], { timeoutMs: CONTROL_TIMEOUT_MS });
                return;
            case 'wake':
                await this.toolchain.shell(serial, ['input', 'keyevent', 'KEYCODE_WAKEUP'], { timeoutMs: CONTROL_TIMEOUT_MS });
                // Dismissing a non-secure keyguard is best-effort; a PIN-locked
                // device stays on its lock screen (which the stream then shows).
                await this.toolchain.shell(serial, ['wm', 'dismiss-keyguard'], { timeoutMs: CONTROL_TIMEOUT_MS }).catch(() => { });
                return;
            case 'assistant':
                await this.toolchain.shell(serial, ['input', 'keyevent', 'KEYCODE_ASSIST'], { timeoutMs: CONTROL_TIMEOUT_MS });
                return;
        }
    }
    /** Capture a fresh PNG of the device (independent of the stream loop). */
    async screenshot(serial) {
        const png = await this.toolchain.execOut(serial, ['screencap', '-p'], { timeoutMs: CONTROL_TIMEOUT_MS });
        if (png.length === 0)
            throw new AdbError('dsh-android: screencap produced no output', ['screencap', '-p']);
        const { pngDimensions } = await import('./frame-source.js');
        const size = pngDimensions(png);
        return { png, ...(size === undefined ? {} : size) };
    }
    /** Resolve one online device: explicit serial, streamed, or the only one. */
    async resolveTarget(serial) {
        const online = await this.toolchain.onlineDevices();
        if (serial !== undefined && serial !== '') {
            const match = online.find(device => device.serial === serial);
            if (match === undefined) {
                const all = await this.toolchain.listDevices();
                const known = all.find(device => device.serial === serial);
                if (known !== undefined) {
                    throw new AdbError(`dsh-android: device ${serial} is ${known.state}${known.state === 'unauthorized' ? ' — accept the USB debugging prompt on the device' : ''}`, []);
                }
                throw new AdbError(`dsh-android: no connected device has the serial ${serial} (run android_devices)`, []);
            }
            return match;
        }
        const streamed = this.streamedSerial;
        if (streamed !== undefined) {
            const match = online.find(device => device.serial === streamed);
            if (match !== undefined)
                return match;
        }
        if (online.length === 1)
            return online[0];
        if (online.length === 0) {
            throw new AdbError('dsh-android: no device is connected — start an emulator or plug in a phone with USB debugging enabled, then run android_devices', []);
        }
        throw new AdbError(`dsh-android: ${online.length} devices are connected (${online.map(device => device.serial).join(', ')}); pass the serial explicitly`, []);
    }
    async #keepAliveTick() {
        if (this.#disposed || this.#intentionalStop)
            return;
        const exitAt = this.#exitAt;
        const serial = this.#lastSerial;
        if (exitAt === undefined || serial === undefined)
            return;
        if (Date.now() - exitAt < this.#options.restartDelayMs)
            return;
        if (!this.toolchain.available)
            return;
        this.#exitAt = undefined;
        this.#restarts += 1;
        try {
            await this.ensureStreaming({ serial });
        }
        catch (error) {
            this.#lastError = errorMessage(error);
            if (this.#exitAt === undefined)
                this.#exitAt = Date.now();
        }
    }
    async #startFor(serial) {
        if (this.#disposed)
            throw new Error('dsh-android: the host is disposed');
        const online = await this.toolchain.onlineDevices();
        if (!online.some(device => device.serial === serial)) {
            const all = await this.toolchain.listDevices().catch(() => []);
            const known = all.find(device => device.serial === serial);
            throw new AdbError(known === undefined
                ? `dsh-android: no connected device has the serial ${serial}`
                : `dsh-android: device ${serial} is ${known.state}, not ready to stream`, []);
        }
        const loop = new AdbFrameLoop(serial, this.toolchain, {
            onFrame: frame => {
                for (const subscriber of this.#frameSubscribers) {
                    try {
                        subscriber(frame);
                    }
                    catch {
                        // One broken consumer must not stall the fan-out.
                    }
                }
            },
            onExit: detail => {
                if (this.#loop !== loop)
                    return;
                this.#loop = undefined;
                this.#startedAt = undefined;
                this.#lastError = `the screencap loop for ${serial} died (${detail})`;
                this.#exitAt = Date.now();
            },
        });
        this.#loop = loop;
        this.#lastSerial = serial;
        this.#intentionalStop = false;
        loop.reset();
        loop.start();
        const frame = await loop.waitForFrame(this.#options.firstFrameTimeoutMs);
        if (frame === undefined) {
            const stderr = loop.stderrLines.join('\n');
            loop.stop();
            if (this.#loop === loop)
                this.#loop = undefined;
            throw new AdbError(`dsh-android: no frame arrived from ${serial} within ${this.#options.firstFrameTimeoutMs} ms${stderr === '' ? '' : `: ${stderr}`}`, []);
        }
        this.#startedAt = Date.now();
        this.#exitAt = undefined;
        return this.#infoOf(loop);
    }
    #infoOf(loop) {
        const frame = loop.latestFrame;
        return {
            serial: loop.serial,
            ...(frame === undefined ? {} : { width: frame.width, height: frame.height }),
        };
    }
    /** Normalized frame coordinates → `input` pixels via the live frame size. */
    async #pixels(serial, x, y) {
        const frame = this.streamedSerial === serial ? this.latestFrame : undefined;
        if (frame !== undefined) {
            return { x: Math.round(x * frame.width), y: Math.round(y * frame.height) };
        }
        const size = await this.toolchain.screenSize(serial);
        return { x: Math.round(x * size.width), y: Math.round(y * size.height) };
    }
    #armIdle() {
        this.#clearIdle();
        const idleMs = this.#options.idleTimeoutMs;
        if (idleMs <= 0)
            return;
        this.#idleTimer = setTimeout(() => {
            this.#idleTimer = undefined;
            if (this.#consumers > 0) {
                this.#armIdle();
                return;
            }
            void this.stop();
        }, idleMs);
        this.#idleTimer.unref?.();
    }
    #clearIdle() {
        if (this.#idleTimer !== undefined)
            clearTimeout(this.#idleTimer);
        this.#idleTimer = undefined;
    }
    #serializeLaunch(task) {
        const run = this.#launchQueue.then(task, task);
        this.#launchQueue = run.then(() => undefined, () => undefined);
        return run;
    }
}
/** Stable fallback used by routes and legacy calls that have no agent session. */
export const DEFAULT_ANDROID_STREAM_SCOPE = 'default';
function normalizeAndroidStreamScope(scope) {
    const trimmed = scope?.trim();
    return trimmed === undefined || trimmed === '' ? DEFAULT_ANDROID_STREAM_SCOPE : trimmed;
}
/**
 * Session-aware collection of independent Android stream controllers.
 *
 * A controller still owns exactly one serial and one frame loop, preserving the
 * well-tested single-stream lifecycle above. The registry supplies one such
 * controller per Harness session, so two conversations can keep two emulators
 * alive concurrently without sharing panel state or switching each other.
 */
export class AndroidHostRegistry {
    toolchain;
    #options;
    #hosts = new Map();
    #disposed = false;
    constructor(toolchain, options = {}) {
        this.toolchain = toolchain ?? new AdbToolchain();
        this.#options = options;
    }
    hostFor(scope) {
        if (this.#disposed)
            throw new Error('dsh-android: the host registry is disposed');
        const key = normalizeAndroidStreamScope(scope);
        let host = this.#hosts.get(key);
        if (host === undefined) {
            host = new AndroidHostController(this.toolchain, this.#options);
            host.startKeepAlive();
            this.#hosts.set(key, host);
        }
        return host;
    }
    /** Existing controller for a scope without creating a new idle entry. */
    existing(scope) {
        return this.#hosts.get(normalizeAndroidStreamScope(scope));
    }
    /** The first live controller for a serial (used by signed stream URLs). */
    streamingHostForSerial(serial) {
        for (const host of this.#hosts.values()) {
            if (host.streamedSerial === serial)
                return host;
        }
        return undefined;
    }
    /** Serials currently streamed in any conversation. */
    streamedSerials() {
        const serials = new Set();
        for (const host of this.#hosts.values()) {
            if (host.streamedSerial !== undefined)
                serials.add(host.streamedSerial);
        }
        return serials;
    }
    /** Stop every session currently bound to a serial. */
    async stopSerial(serial) {
        await Promise.all([...this.#hosts.values()]
            .filter(host => host.streamedSerial === serial)
            .map(async (host) => { await host.stop(); }));
    }
    status(scope) {
        const host = this.existing(scope);
        if (host !== undefined)
            return host.status();
        return this.hostFor(DEFAULT_ANDROID_STREAM_SCOPE).status();
    }
    async dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        const hosts = [...this.#hosts.values()];
        this.#hosts.clear();
        await Promise.all(hosts.map(async (host) => { await host.dispose(); }));
    }
}
