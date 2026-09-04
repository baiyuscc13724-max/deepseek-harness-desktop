/**
 * Signed web-route layer for the dsh-android live device stream.
 *
 * Everything crosses the DSH webserver origin through plugin-owned routes
 * under `/_dsh/dsh-android/`; the browser never sees an adb port because
 * there is none — the stream is produced in-process (frame-source.ts) and
 * served straight from the latest-frame buffer:
 *
 * - `GET  /stream/<token>`     — live `multipart/x-mixed-replace` PNG stream
 *   of the streamed device, written from the in-process frame loop.
 * - `GET  /screenshot/<token>` — one PNG from the plugin's screenshot cache
 *   (absolute paths outside it are refused).
 * - `POST /grant`              — loopback/trusted-only endpoint the client
 *   card calls at render time to re-mint fresh capabilities from stable
 *   presentationMeta. Never boots an emulator; it only starts the frame
 *   loop for a device that is already online.
 * - `POST /switch-device`      — the panel picker's explicit user gesture:
 *   switches which ONLINE device streams. Unlike dsh-ios (where a pick may
 *   boot a simulator in seconds), booting an Android emulator takes minutes
 *   and is not tied to a serial until it appears, so AVD boot stays with
 *   the android_boot tool; this route answers 409 for offline targets.
 * - `POST /devices`            — read-only listing: one array of adb devices
 *   (emulators and phones both stream) plus the machine's AVD names.
 * - `POST /capture`            — capture a FRESH PNG into the screenshot
 *   cache and mint a signed URL. Never starts anything.
 * - `POST /status`             — read-only `{ running, serial?, deviceName? }`
 *   for the input-dock capsule; never starts a stream, never mints tokens.
 * - `POST /control`            — one control op `{ serial, action }` where
 *   action is tap/drag (NORMALIZED 0..1 panel coordinates), button (Android
 *   three-button navigation and hardware keys), type, or rotate (advances
 *   the user_rotation cycle). One route for every device kind — adb does
 *   not distinguish emulators from phones and neither do we.
 * - `POST /device-action`      — notification shade, quick settings, lock,
 *   wake, assistant.
 *
 * Tokens, the loopback/trusted fence, and the screenshot containment walk
 * live in stream-access.ts (ported from dsh-ios unchanged in posture).
 * @module @zseven-w/dsh-android/stream-routes
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SERIAL_PATTERN, listAvds } from './adb.js';
import { ANDROID_DEVICE_ACTIONS, ROTATION_CYCLE, AndroidHostRegistry, isAndroidDeviceAction, } from './android-host.js';
import { MultipartFrameWriter } from './frame-source.js';
import { StreamAccessController, classifyScreenshotPath, isTrustedRequest, openVerifiedScreenshot, previewScreenshotDir, screenshotDir, screenshotNamespaceOf, } from './stream-access.js';
/** HTTP prefix owned by the dsh-android web routes. */
export const PLUGIN_ROUTE_PREFIX = '/_dsh/dsh-android';
export const STREAM_ROUTE_PREFIX = `${PLUGIN_ROUTE_PREFIX}/stream`;
export const SCREENSHOT_ROUTE_PREFIX = `${PLUGIN_ROUTE_PREFIX}/screenshot`;
export const GRANT_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/grant`;
export const SWITCH_DEVICE_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/switch-device`;
export const DEVICES_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/devices`;
export const CAPTURE_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/capture`;
export const STATUS_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/status`;
export const CONTROL_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/control`;
export const DEVICE_ACTION_ROUTE_PATH = `${PLUGIN_ROUTE_PREFIX}/device-action`;
const MAX_BODY_BYTES = 16 * 1024;
/** Cap on the pickable-device/AVD listings. */
const MAX_LISTED_DEVICES = 40;
export const ANDROID_STREAM_FRAME_RATE = 2;
export const ANDROID_STREAM_TRANSPORT = 'multipart-latest-frame';
const PREVIEW_CAPTURE_SLOTS = 2;
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
class RouteError extends Error {
    status;
    code;
    constructor(status, message, code = 'unavailable') {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'RouteError';
    }
}
/** The route-level code for one known-but-not-online device state. */
export function deviceStateErrorCode(state) {
    if (state === 'unauthorized')
        return 'device_unauthorized';
    return 'device_offline';
}
function sendJson(res, status, value, headers = {}) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
        'referrer-policy': 'no-referrer',
        ...headers,
    });
    res.end(body);
}
async function readBody(req, maxBytes) {
    const contentLength = req.headers['content-length'];
    if (typeof contentLength === 'string') {
        const declared = Number(contentLength);
        if (!Number.isSafeInteger(declared) || declared < 0)
            throw new RouteError(400, 'invalid content-length', 'bad_request');
        if (declared > maxBytes)
            throw new RouteError(413, 'request body is too large');
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > maxBytes)
            throw new RouteError(413, 'request body is too large');
        chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
}
function isJsonRequest(req) {
    const contentType = req.headers['content-type'];
    return typeof contentType === 'string' && /^application\/json(?:\s*;|$)/i.test(contentType);
}
function prefixToken(rawUrl, prefix) {
    let pathname;
    try {
        pathname = new URL(rawUrl ?? '/', 'http://dsh.local').pathname;
    }
    catch {
        return undefined;
    }
    const marker = `${prefix}/`;
    if (!pathname.startsWith(marker))
        return undefined;
    const rest = pathname.slice(marker.length);
    if (rest === '' || rest.includes('/'))
        return undefined;
    try {
        return decodeURIComponent(rest);
    }
    catch {
        return undefined;
    }
}
// ── explicit evidence vs compatibility-preview capture paths ───────────────
const captureNextIndex = new Map();
/** The next capture path for `serial`. Evidence is immutable while its signed
 * URL lives; compatibility preview is a two-slot bounded rolling cache.
 */
export async function nextCapturePath(serial, namespace = 'evidence') {
    if (namespace !== 'evidence' && namespace !== 'preview')
        throw new TypeError('capture namespace must be evidence or preview');
    const root = namespace === 'preview' ? previewScreenshotDir() : screenshotDir();
    await mkdir(root, { recursive: true, mode: 0o700 });
    const safe = serial.replace(/[^A-Za-z0-9_-]/g, '_');
    const counterKey = `${namespace}:${safe}`;
    let next = captureNextIndex.get(counterKey);
    if (namespace === 'preview') {
        next ??= 0;
        captureNextIndex.set(counterKey, next + 1);
        return join(root, `preview-${safe}-${next % PREVIEW_CAPTURE_SLOTS}.png`);
    }
    if (next === undefined) {
        next = 0;
        const prefix = `screenshot-${safe}-`;
        for (const entry of readdirSync(root)) {
            if (!entry.startsWith(prefix) || !entry.endsWith('.png'))
                continue;
            const index = Number(entry.slice(prefix.length, -4));
            if (Number.isInteger(index) && index >= next)
                next = index + 1;
        }
    }
    // Other evidence counters share this directory; never overwrite a live
    // signed URL or mutate history.
    let path = join(root, `screenshot-${safe}-${next}.png`);
    while (existsSync(path)) {
        next += 1;
        path = join(root, `screenshot-${safe}-${next}.png`);
    }
    captureNextIndex.set(counterKey, next + 1);
    return path;
}
/**
 * Owns the plugin's signed routes: verifies capabilities, serves the live
 * frame stream from the in-process loop, and tracks every open response so
 * disposal can destroy them all.
 */
export class StreamRoutes {
    host;
    access;
    #disposed = false;
    #streamTeardowns = new Set();
    constructor(host, access) {
        this.host = host;
        this.access = access;
    }
    get routeAvailable() {
        return this.access.routeAvailable;
    }
    #hostForSession(sessionId) {
        if (!(this.host instanceof AndroidHostRegistry))
            return this.host;
        return this.host.hostFor(typeof sessionId === 'string' ? sessionId : undefined);
    }
    #hostForStream(serial) {
        if (!(this.host instanceof AndroidHostRegistry)) {
            return this.host.streamedSerial === serial ? this.host : undefined;
        }
        return this.host.streamingHostForSerial(serial);
    }
    #toolchain() {
        return this.host.toolchain;
    }
    /** `GET /_dsh/dsh-android/stream/<token>` — live multipart PNG stream. */
    async handleStream(req, res) {
        try {
            this.#requireTrusted(req);
            if (req.method !== 'GET') {
                sendJson(res, 405, { ok: false, error: 'the stream route only accepts GET' }, { allow: 'GET' });
                return;
            }
            const token = prefixToken(req.url, STREAM_ROUTE_PREFIX);
            if (token === undefined) {
                sendJson(res, 404, { ok: false, error: 'stream route not found' });
                return;
            }
            const payload = await this.access.verifyStreamToken(token);
            if (payload === undefined)
                throw new RouteError(403, 'the stream token is invalid or expired', 'forbidden');
            const host = this.#hostForStream(payload.serial);
            if (host === undefined) {
                throw new RouteError(503, 'the device stream is not running; request a fresh grant', 'stream_not_running');
            }
            const release = host.acquire();
            try {
                await host.ensureStreaming({ serial: payload.serial });
            }
            catch (error) {
                release();
                throw new RouteError(502, `the device stream failed to start: ${errorMessage(error)}`, 'stream_failed');
            }
            if (this.#disposed) {
                release();
                res.destroy();
                return;
            }
            const writer = new MultipartFrameWriter(res);
            let finished = false;
            const teardown = () => {
                if (finished)
                    return;
                finished = true;
                this.#streamTeardowns.delete(teardown);
                unsubscribe();
                writer.close();
                release();
            };
            const unsubscribe = host.subscribeFrames(frame => {
                // Frames for a different serial (after a device switch) must not
                // leak into a capability minted for the old device.
                if (host.streamedSerial === payload.serial)
                    writer.writeFrame(frame);
                else
                    teardown();
            });
            this.#streamTeardowns.add(teardown);
            res.on('error', teardown);
            res.on('close', teardown);
            const latest = host.latestFrame;
            if (latest !== undefined)
                writer.writeFrame(latest);
        }
        catch (error) {
            this.#answerError(res, error);
        }
    }
    /** `GET /_dsh/dsh-android/screenshot/<token>` — serve one cached PNG. */
    async handleScreenshot(req, res) {
        try {
            this.#requireTrusted(req);
            if (req.method !== 'GET') {
                sendJson(res, 405, { ok: false, error: 'the screenshot route only accepts GET' }, { allow: 'GET' });
                return;
            }
            const token = prefixToken(req.url, SCREENSHOT_ROUTE_PREFIX);
            if (token === undefined) {
                sendJson(res, 404, { ok: false, error: 'screenshot route not found' });
                return;
            }
            const payload = await this.access.verifyScreenshotToken(token);
            if (payload === undefined)
                throw new RouteError(403, 'the screenshot token is invalid or expired', 'forbidden');
            const verdict = await classifyScreenshotPath(payload.path);
            if (verdict === 'outside')
                throw new RouteError(403, 'screenshot path escaped the plugin cache directory', 'forbidden');
            const opened = verdict === 'ok' ? await openVerifiedScreenshot(payload.path) : undefined;
            if (opened === undefined)
                throw new RouteError(404, 'screenshot not found', 'screenshot_missing');
            res.writeHead(200, {
                'content-type': 'image/png',
                'content-length': String(opened.bytes.length),
                'cache-control': 'no-store',
                'x-content-type-options': 'nosniff',
                'cross-origin-resource-policy': 'same-origin',
                'referrer-policy': 'no-referrer',
                'content-security-policy': "sandbox; default-src 'none'",
            });
            res.end(opened.bytes);
        }
        catch (error) {
            this.#answerError(res, error);
        }
    }
    /**
     * `POST /_dsh/dsh-android/grant` — mint fresh relative-URL capabilities
     * from stable presentationMeta. Never boots an emulator: a stream is only
     * started for a device that is already ONLINE, and minting never yanks the
     * stream away from a different streaming device (device switches belong
     * exclusively to the explicit gesture behind /switch-device).
     */
    async handleGrant(req, res) {
        try {
            const value = await this.#readJson(req, res);
            if (value === undefined)
                return;
            const kind = value.kind;
            if (kind === 'stream') {
                const host = this.#hostForSession(value.sessionId);
                const serial = await this.#resolveGrantSerial(host, value.device);
                const status = host.status();
                if (status.running && status.serial !== serial) {
                    throw new RouteError(409, `another device is streaming (${status.serial}); switch devices instead of re-granting`, 'device_busy');
                }
                if (!status.running) {
                    await this.#requireOnline(serial);
                }
                try {
                    await host.ensureStreaming({ serial });
                }
                catch (error) {
                    throw new RouteError(502, `the device stream failed to start: ${errorMessage(error)}`, 'stream_failed');
                }
                const signed = await this.access.signStreamToken(serial);
                sendJson(res, 200, {
                    ok: true,
                    streamUrl: `${STREAM_ROUTE_PREFIX}/${signed.token}`,
                    expiresAt: signed.expiresAt,
                    device: serial,
                    stream: { transport: ANDROID_STREAM_TRANSPORT, frameRate: ANDROID_STREAM_FRAME_RATE, persistent: true },
                });
                return;
            }
            if (kind === 'screenshot') {
                const path = value.path;
                if (typeof path !== 'string' || path === '') {
                    throw new RouteError(400, 'path must be an absolute screenshot path inside the plugin cache', 'bad_request');
                }
                const verdict = await classifyScreenshotPath(path);
                if (verdict === 'outside')
                    throw new RouteError(403, 'screenshot path escaped the plugin cache directory', 'forbidden');
                if (verdict !== 'ok')
                    throw new RouteError(404, 'screenshot file not found', 'screenshot_missing');
                const signed = await this.access.signScreenshotToken(path);
                sendJson(res, 200, {
                    ok: true,
                    screenshotUrl: `${SCREENSHOT_ROUTE_PREFIX}/${signed.token}`,
                    expiresAt: signed.expiresAt,
                });
                return;
            }
            throw new RouteError(400, `unknown grant kind ${JSON.stringify(kind)}; expected 'stream' or 'screenshot'`, 'bad_request');
        }
        catch (error) {
            this.#answerError(res, error);
        }
    }
    /**
     * `POST /_dsh/dsh-android/switch-device` — switch which device the panel
     * streams. The explicit user gesture authorizes taking over the stream
     * slot; the target must be ONLINE (this route never boots an emulator —
     * an AVD boot takes minutes and belongs to the android_boot tool).
     */
    async handleSwitchDevice(req, res) {
        try {
            const value = await this.#readJson(req, res);
            if (value === undefined)
                return;
            const host = this.#hostForSession(value.sessionId);
            const serial = value.device;
            if (typeof serial !== 'string' || !SERIAL_PATTERN.test(serial)) {
                throw new RouteError(400, 'device must be an adb device serial', 'bad_request');
            }
            const device = await this.#requireOnline(serial);
            try {
                await host.ensureStreaming({ serial });
            }
            catch (error) {
                throw new RouteError(502, `the device stream failed to start: ${errorMessage(error)}`, 'stream_failed');
            }
            const signed = await this.access.signStreamToken(serial);
            sendJson(res, 200, {
                ok: true,
                streamUrl: `${STREAM_ROUTE_PREFIX}/${signed.token}`,
                expiresAt: signed.expiresAt,
                device: serial,
                deviceName: device.model ?? serial,
                stream: { transport: ANDROID_STREAM_TRANSPORT, frameRate: ANDROID_STREAM_FRAME_RATE, persistent: true },
            });
        }
        catch (error) {
            this.#answerError(res, error);
        }
    }
    /**
     * `POST /_dsh/dsh-android/devices` — read-only listing for the picker:
     * one array of adb devices (every online one can stream — emulators and
     * phones alike) plus the machine's AVD names for context. Never boots,
     * never starts a stream, never mints tokens.
     */
    async handleDevices(req, res) {
        try {
            const value = await this.#readJson(req, res);
            if (value === undefined)
                return;
            const host = this.#hostForSession(value.sessionId);
            let devices;
            try {
                devices = await host.toolchain.listDevices();
            }
            catch (error) {
                throw new RouteError(503, `the device list cannot be read: ${errorMessage(error)}`, 'adb_unavailable');
            }
            const streamed = host.streamedSerial;
            devices.sort((left, right) => {
                const leftOnline = left.state === 'device' ? 0 : 1;
                const rightOnline = right.state === 'device' ? 0 : 1;
                if (leftOnline !== rightOnline)
                    return leftOnline - rightOnline;
                return left.serial.localeCompare(right.serial);
            });
            const listed = devices.slice(0, MAX_LISTED_DEVICES).map(device => ({
                serial: device.serial,
                state: device.state,
                kind: device.emulator ? 'emulator' : 'physical',
                ...(device.model === undefined ? {} : { model: device.model }),
                ...(device.serial === streamed ? { streaming: true } : {}),
            }));
            // AVD names are context for "what could be booted" — the picker links
            // them to the android_boot tool instead of a boot-on-click.
            const avds = (await listAvds().catch(() => [])).slice(0, MAX_LISTED_DEVICES);
            sendJson(res, 200, { ok: true, devices: listed, avds });
        }
        catch (error) {
            this.#answerError(res, error);
        }
    }
    /**
     * `POST /_dsh/dsh-android/capture` — capture a FRESH PNG of the streamed
     * (or explicitly named, online) device. Explicit captures enter evidence;
     * the opt-in legacy panel fallback uses the isolated bounded preview cache.
     * Never boots or starts a stream.
     */
    async handleCapture(req, res) {
        try {
            const value = await this.#readJson(req, res);
            if (value === undefined)
                return;
            const host = this.#hostForSession(value.sessionId);
            const serial = await this.#resolveGrantSerial(host, value.device);
            const namespace = value.purpose === undefined || value.purpose === 'evidence' ? 'evidence' : value.purpose;
            if (namespace !== 'evidence' && namespace !== 'preview') {
                throw new RouteError(400, 'capture purpose must be evidence or preview', 'bad_request');
            }
            if (host.streamedSerial !== serial) {
                await this.#requireOnline(serial);
            }
            const path = await nextCapturePath(serial, namespace);
            try {
                const shot = await host.screenshot(serial);
                await writeFile(path, shot.png);
            }
            catch (error) {
                throw new RouteError(502, `the device screenshot failed: ${errorMessage(error)}`);
            }
            const bytes = statSync(path).size;
            const signed = await this.access.signScreenshotToken(path);
            sendJson(res, 200, {
                ok: true,
                screenshotUrl: `${SCREENSHOT_ROUTE_PREFIX}/${signed.token}`,
                path,
                bytes,
                namespace: screenshotNamespaceOf(path),
                expiresAt: signed.expiresAt,
            });
        }
        catch (error) {
            this.#answerError(res, error);
        }
    }
    /**
     * `POST /_dsh/dsh-android/status` — read-only stream snapshot for the
     * input dock's capsule. NEVER starts a stream and never mints tokens.
     */
    async handleStatus(req, res) {
        try {
            const value = await this.#readJson(req, res);
            if (value === undefined)
                return;
            const host = this.#hostForSession(value.sessionId);
            const filter = value.device;
            if (filter !== undefined && typeof filter !== 'string') {
                throw new RouteError(400, 'device must be an adb device serial', 'bad_request');
            }
            const status = host.status();
            const running = status.running
                && status.serial !== undefined
                && (filter === undefined || filter === '' || status.serial === filter);
            if (!running) {
                sendJson(res, 200, { ok: true, running: false });
                return;
            }
            let deviceName;
            try {
                deviceName = (await host.toolchain.onlineDevices()).find(device => device.serial === status.serial)?.model;
            }
            catch {
                deviceName = undefined;
            }
            sendJson(res, 200, {
                ok: true,
                running: true,
                ...(status.serial === undefined ? {} : { serial: status.serial }),
                ...(deviceName === undefined ? {} : { deviceName }),
            });
        }
        catch (error) {
            this.#answerError(res, error);
        }
    }
    /**
     * `POST /_dsh/dsh-android/control` — one control op against the streamed
     * device. Body `{ device, action }` with `{kind:'tap'|'drag'|'button'|
     * 'type'|'rotate'}`; tap/drag coordinates are NORMALIZED 0..1 of the
     * streamed frame. `rotate` advances the user_rotation cycle and reports
     * the new rotation (0..3). The device must be streaming or at least
     * online; nothing is booted here.
     */
    async handleControl(req, res) {
        try {
            const value = await this.#readJson(req, res);
            if (value === undefined)
                return;
            const host = this.#hostForSession(value.sessionId);
            const serial = value.device;
            if (typeof serial !== 'string' || !SERIAL_PATTERN.test(serial)) {
                throw new RouteError(400, 'device must be an adb device serial', 'bad_request');
            }
            const action = value.action;
            if (!isRecord(action) || typeof action.kind !== 'string' || action.kind === '') {
                throw new RouteError(400, 'action must be an object with a kind', 'bad_request');
            }
            const normalizedPoint = (x, y) => {
                if (typeof x !== 'number' || typeof y !== 'number'
                    || !Number.isFinite(x) || !Number.isFinite(y)
                    || x < 0 || x > 1 || y < 0 || y > 1) {
                    throw new RouteError(400, 'tap/drag coordinates must be normalized 0..1 numbers', 'bad_request');
                }
                return { x, y };
            };
            let parsed;
            switch (action.kind) {
                case 'tap': {
                    const point = normalizedPoint(action.x, action.y);
                    parsed = { kind: 'tap', x: point.x, y: point.y };
                    break;
                }
                case 'drag': {
                    const from = normalizedPoint(action.fromX, action.fromY);
                    const to = normalizedPoint(action.toX, action.toY);
                    const durationMs = action.durationMs;
                    if (durationMs !== undefined && (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0)) {
                        throw new RouteError(400, 'durationMs must be a non-negative number', 'bad_request');
                    }
                    parsed = { kind: 'drag', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, ...(durationMs === undefined ? {} : { durationMs }) };
                    break;
                }
                case 'button': {
                    if (typeof action.name !== 'string' || action.name === '') {
                        throw new RouteError(400, 'button requires a non-empty name', 'bad_request');
                    }
                    parsed = { kind: 'button', name: action.name };
                    break;
                }
                case 'type': {
                    if (typeof action.text !== 'string' || action.text === '') {
                        throw new RouteError(400, 'type requires a non-empty text', 'bad_request');
                    }
                    parsed = { kind: 'type', text: action.text };
                    break;
                }
                case 'rotate':
                    parsed = { kind: 'rotate' };
                    break;
                default:
                    throw new RouteError(400, `unknown control action ${JSON.stringify(action.kind)}`, 'bad_request');
            }
            if (host.streamedSerial !== serial) {
                await this.#requireOnline(serial);
            }
            const release = host.acquire();
            try {
                switch (parsed.kind) {
                    case 'tap':
                        await host.tap(serial, parsed.x, parsed.y);
                        break;
                    case 'drag':
                        await host.drag(serial, {
                            fromX: parsed.fromX,
                            fromY: parsed.fromY,
                            toX: parsed.toX,
                            toY: parsed.toY,
                            ...(parsed.durationMs === undefined ? {} : { duration: Math.min(5, parsed.durationMs / 1000) }),
                        });
                        break;
                    case 'button':
                        await host.button(serial, parsed.name);
                        break;
                    case 'type':
                        await host.type(serial, parsed.text);
                        break;
                    case 'rotate': {
                        const current = await host.getRotation(serial);
                        const next = ROTATION_CYCLE[(ROTATION_CYCLE.indexOf(current) + 1) % ROTATION_CYCLE.length];
                        await host.rotate(serial, next);
                        sendJson(res, 200, { ok: true, rotation: next });
                        return;
                    }
                }
                sendJson(res, 200, { ok: true });
            }
            catch (error) {
                if (error instanceof RouteError)
                    throw error;
                throw new RouteError(502, `the device control failed: ${errorMessage(error)}`, 'unavailable');
            }
            finally {
                release();
            }
        }
        catch (error) {
            this.#answerError(res, error);
        }
    }
    /** `POST /_dsh/dsh-android/device-action` — run one device-level action. */
    async handleDeviceAction(req, res) {
        try {
            const value = await this.#readJson(req, res);
            if (value === undefined)
                return;
            const host = this.#hostForSession(value.sessionId);
            const serial = await this.#resolveGrantSerial(host, value.device);
            const action = value.action;
            if (!isAndroidDeviceAction(action)) {
                throw new RouteError(400, `action must be one of ${ANDROID_DEVICE_ACTIONS.join(', ')}`, 'bad_request');
            }
            if (host.streamedSerial !== serial) {
                await this.#requireOnline(serial);
            }
            try {
                await host.deviceAction(serial, action);
            }
            catch (error) {
                throw new RouteError(502, `the ${action} action failed: ${errorMessage(error)}`, 'unavailable');
            }
            sendJson(res, 200, { ok: true, action });
        }
        catch (error) {
            this.#answerError(res, error);
        }
    }
    /** Destroy every open stream response. */
    dispose() {
        this.#disposed = true;
        for (const teardown of [...this.#streamTeardowns])
            teardown();
    }
    /** Trusted-fence + method + JSON envelope shared by every POST route. */
    async #readJson(req, res) {
        this.#requireTrusted(req, true);
        if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'this route only accepts POST' }, { allow: 'POST' });
            return undefined;
        }
        if (!isJsonRequest(req))
            throw new RouteError(415, 'this endpoint requires application/json', 'bad_content_type');
        const body = await readBody(req, MAX_BODY_BYTES);
        let value;
        try {
            value = JSON.parse(body);
        }
        catch {
            throw new RouteError(400, 'the request is not valid JSON', 'bad_request');
        }
        if (!isRecord(value))
            throw new RouteError(400, 'the request must be a JSON object', 'bad_request');
        return value;
    }
    /** Resolve an optional `device` body field: explicit serial or session stream. */
    async #resolveGrantSerial(host, device) {
        if (device !== undefined && typeof device !== 'string') {
            throw new RouteError(400, 'device must be an adb device serial', 'bad_request');
        }
        let serial = device;
        if (serial === undefined || serial === '') {
            const streamed = host.streamedSerial;
            if (streamed === undefined) {
                throw new RouteError(409, 'no device stream is running; include the device serial', 'stream_not_running');
            }
            serial = streamed;
        }
        if (!SERIAL_PATTERN.test(serial))
            throw new RouteError(400, 'device must be an adb device serial', 'bad_request');
        return serial;
    }
    /** The device must exist in `adb devices` and be fully online. */
    async #requireOnline(serial) {
        let devices;
        try {
            devices = await this.#toolchain().listDevices();
        }
        catch (error) {
            throw new RouteError(503, `the device list cannot be read: ${errorMessage(error)}`, 'adb_unavailable');
        }
        const device = devices.find(candidate => candidate.serial === serial);
        if (device === undefined) {
            throw new RouteError(409, 'the device is not connected (run android_devices, or boot an emulator with android_boot)', 'device_unknown');
        }
        if (device.state !== 'device') {
            throw new RouteError(409, device.state === 'unauthorized'
                ? 'the device has not authorized this computer — accept the USB debugging prompt on the device'
                : `the device is ${device.state}, not ready`, deviceStateErrorCode(device.state));
        }
        return device;
    }
    #requireTrusted(req, requireOrigin = false) {
        if (!isTrustedRequest(req, requireOrigin)) {
            throw new RouteError(403, 'the dsh-android route requires a loopback trusted browser request', 'forbidden');
        }
    }
    #answerError(res, error) {
        const status = error instanceof RouteError ? error.status : 500;
        const code = error instanceof RouteError ? error.code : 'unavailable';
        const message = errorMessage(error);
        if (res.headersSent) {
            res.destroy();
            return;
        }
        sendJson(res, status, { ok: false, code, error: message });
    }
}
/**
 * Register the plugin routes on any webserver-shaped carrier. Exported
 * separately from installStreamRoutes so smoke scripts can mount the same
 * handlers on a plain node:http server without mocking a cordis Context.
 */
export function mountStreamRoutes(webServer, routes) {
    const disposers = [
        webServer.register({ kind: 'prefix', path: STREAM_ROUTE_PREFIX, handler: (req, res) => routes.handleStream(req, res) }),
        webServer.register({ kind: 'prefix', path: SCREENSHOT_ROUTE_PREFIX, handler: (req, res) => routes.handleScreenshot(req, res) }),
        webServer.register({ kind: 'exact', path: GRANT_ROUTE_PATH, handler: (req, res) => routes.handleGrant(req, res) }),
        webServer.register({ kind: 'exact', path: SWITCH_DEVICE_ROUTE_PATH, handler: (req, res) => routes.handleSwitchDevice(req, res) }),
        webServer.register({ kind: 'exact', path: DEVICES_ROUTE_PATH, handler: (req, res) => routes.handleDevices(req, res) }),
        webServer.register({ kind: 'exact', path: CAPTURE_ROUTE_PATH, handler: (req, res) => routes.handleCapture(req, res) }),
        webServer.register({ kind: 'exact', path: STATUS_ROUTE_PATH, handler: (req, res) => routes.handleStatus(req, res) }),
        webServer.register({ kind: 'exact', path: CONTROL_ROUTE_PATH, handler: (req, res) => routes.handleControl(req, res) }),
        webServer.register({ kind: 'exact', path: DEVICE_ACTION_ROUTE_PATH, handler: (req, res) => routes.handleDeviceAction(req, res) }),
    ];
    return () => {
        for (const dispose of disposers.reverse())
            dispose();
        routes.dispose();
    };
}
/**
 * Mount the stream routes on the optional `webServer` service. Uses
 * `ctx.inject` + `ctx.effect` so headless profiles (no webServer) still
 * load, the routes are registered exactly once, and disposal unregisters
 * them and destroys every open stream.
 */
export function installStreamRoutes(ctx, host) {
    ctx.inject(['webServer'], webCtx => webCtx.effect(() => {
        const webServer = webCtx.webServer;
        const access = new StreamAccessController();
        const routes = new StreamRoutes(host, access);
        const detach = access.attachRoute();
        const dispose = mountStreamRoutes(webServer, routes);
        return () => {
            dispose();
            detach();
        };
    }, 'dsh-android: stream routes'));
}
