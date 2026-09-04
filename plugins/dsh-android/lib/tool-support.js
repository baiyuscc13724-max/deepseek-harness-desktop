/**
 * Shared runtime for the model-facing Android tools: device resolution, the
 * screenshot store, the interaction router, and the schemas every result
 * shape reuses.
 *
 * This is the layer dsh-ios kept inline in its (1742-line) tools.ts. Here it
 * is its own module so the tool DEFINITIONS stay readable and so the UI/OCR/
 * row tool families can share exactly one screenshot layout and one device
 * summary — three independent capture paths writing into one directory is a
 * real overwrite hazard (see `ScreenshotStore`), and it only stays safe while
 * they all go through this code.
 *
 * Everything here is re-exported from `./tools.js`, which is the import path
 * the sibling tool modules use.
 * @module @zseven-w/dsh-android/tool-support
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ANDROID_BUTTONS } from './android-host.js';
import { screenshotDir } from './stream-access.js';
import { imageInputActive, saveScreenshotAttachment, } from './vision.js';
/**
 * Resolve the optional image attachment for one captured PNG: only on an
 * image-capable route with a mounted store, and NEVER an error — any failure
 * keeps the text-only result (degrade, don't refuse).
 */
export async function screenshotImageRef(vision, png, name) {
    if (vision === undefined)
        return undefined;
    if (!await imageInputActive(vision.services, vision.exec))
        return undefined;
    return saveScreenshotAttachment(vision.services, png, name);
}
/** Settle delay after an interaction, before the effect screenshot. */
export const INTERACT_SETTLE_MS = 300;
/**
 * The band every scroll stays inside, as a fraction of the travelling axis.
 * Android's gesture navigation owns the bottom strip (back/home/recents swipe)
 * and both side edges (back gesture), and a swipe that starts inside one of
 * those is eaten by the system before the app ever sees it. dsh-ios clamps to
 * the same 8%..92% for the home-indicator strip.
 */
export const SCROLL_BAND_MIN = 0.08;
export const SCROLL_BAND_MAX = 0.92;
/** Seconds one scroll's `input swipe` takes — fast enough to read as a flick. */
export const SCROLL_DURATION_S = 0.3;
export const SCROLL_DIRECTIONS = ['up', 'down', 'left', 'right'];
export const INTERACT_ACTIONS = ['tap', 'type', 'button', 'gesture', 'scroll'];
export function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export function renderJson(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
/**
 * Shared device object schema used by every tool result. Kept `as const` so
 * `defineTool` can infer the concrete output value type (an interface-typed
 * schema would widen to an empty object under the DSL's inference).
 */
export const deviceSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        serial: { type: 'string', required: true },
        name: { type: 'string', required: true },
        androidVersion: { type: 'string', required: true },
        state: { type: 'string', required: true },
    },
};
/** One installed package, as `android_list_apps` reports it. */
export const appSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        packageName: { type: 'string', required: true },
        label: { type: 'string', required: true },
        version: { type: 'string' },
        versionCode: { type: 'integer' },
        system: { type: 'boolean', required: true },
        apkPath: { type: 'string' },
    },
};
/** Degradation guard: throws the explanatory error when adb is unresolvable. */
export function assertAdbAvailable(host, tool) {
    if (host.available)
        return;
    const reason = host.toolchain.binary.reason ?? 'adb was not found';
    throw new Error(`${tool}: adb is unavailable — ${reason}. Install the Android SDK platform-tools, put adb on PATH, or `
        + 'set the ADB environment variable to the executable, then retry.');
}
/** The device summary a tool result carries, from a listing row + getprop. */
export function deviceSummary(device, details) {
    return {
        serial: device.serial,
        name: details?.model ?? device.model ?? device.serial,
        androidVersion: details?.androidVersion ?? '',
        state: device.state,
    };
}
/**
 * Resolve the device a tool operates on and enrich it for the result. The
 * resolution itself lives in the host (explicit serial → streamed → the only
 * online device → an explanatory throw); this only adds the getprop details
 * every result shape wants, and re-prefixes the error with the calling tool.
 */
export async function resolveTarget(host, tool, serial) {
    assertAdbAvailable(host, tool);
    let device;
    try {
        device = await host.resolveTarget(serial === undefined || serial.trim() === '' ? undefined : serial.trim());
    }
    catch (error) {
        const message = errorMessage(error);
        throw new Error(message.startsWith(`${tool}:`) ? message : `${tool}: ${message.replace(/^dsh-android: /, '')}`);
    }
    const details = await host.toolchain.deviceDetails(device).catch(() => undefined);
    return { device, summary: deviceSummary(device, details) };
}
/**
 * Per-device screenshot paths inside the EVIDENCE cache directory
 * (`<DSH_HOME>/cache/dsh-android/evidence/screenshots/…`, one of the exact
 * roots the signed screenshot route serves). Live preview never writes here.
 *
 * Explicit tool captures and the panel's explicit screenshot action may share
 * this evidence namespace, so each counter scans once and skips existing names.
 * That keeps a later capture from overwriting history whose signed URL is live;
 * the legacy continuous-preview rollback has its own bounded preview namespace.
 */
const EVIDENCE_FILE = /^screenshot-[A-Za-z0-9_-]+-\d+\.png$/;
const EVIDENCE_INDEX_MAX_BYTES = 16 * 1024 * 1024;
const EVIDENCE_REFERENCE_KINDS = new Set(['attachment', 'tool-card', 'history', 'token']);
function normalizeEvidenceReference(value) {
    if (typeof value !== 'object' || value === null || !EVIDENCE_REFERENCE_KINDS.has(value.kind))
        throw new Error('dsh-android: unknown evidence reference kind');
    const id = String(value.id || '');
    if (id.length === 0 || id.length > 256)
        throw new Error('dsh-android: invalid evidence reference id');
    if (value.kind !== 'token')
        return { kind: value.kind, id };
    const expiresAt = Math.trunc(Number(value.expiresAt));
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
        throw new Error('dsh-android: invalid evidence token expiry');
    return { kind: value.kind, id, expiresAt };
}
export class ScreenshotStore {
    #root;
    #next = new Map();
    #indexPath;
    constructor(root) {
        const requested = resolve(root);
        // Older tool factories still pass the former shared tmp root. Redirect
        // only that exact default to the durable evidence namespace; arbitrary
        // caller-provided fixture roots keep working, and legacy stays read-only.
        this.#root = requested === resolve(join(tmpdir(), 'dsh-android')) ? resolve(screenshotDir()) : requested;
        this.#indexPath = join(dirname(this.#root), 'reference-index.json');
    }
    /** The directory captures land in (shared with the screenshot route). */
    get root() {
        return this.#root;
    }
    #assertRoot() {
        if (!existsSync(this.#root))
            return;
        const info = lstatSync(this.#root);
        if (info.isSymbolicLink() || !info.isDirectory())
            throw new Error('dsh-android: evidence screenshot root is not a regular directory');
    }
    nextPath(serial) {
        this.#assertRoot();
        mkdirSync(this.#root, { recursive: true, mode: 0o700 });
        this.#assertRoot();
        const safe = serial.replace(/[^A-Za-z0-9_-]/g, '_');
        let next = this.#next.get(safe);
        if (next === undefined) {
            next = 0;
            const prefix = `screenshot-${safe}-`;
            for (const entry of readdirSync(this.#root)) {
                if (!entry.startsWith(prefix) || !entry.endsWith('.png'))
                    continue;
                const index = Number(entry.slice(prefix.length, -4));
                if (Number.isInteger(index) && index >= next)
                    next = index + 1;
            }
        }
        let path = join(this.#root, `screenshot-${safe}-${next}.png`);
        while (existsSync(path)) {
            next += 1;
            path = join(this.#root, `screenshot-${safe}-${next}.png`);
        }
        this.#next.set(safe, next + 1);
        return path;
    }
    #name(path) {
        const absolute = resolve(path);
        const rel = relative(this.#root, absolute);
        if (rel === '' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.includes(sep) || !EVIDENCE_FILE.test(rel))
            throw new Error('dsh-android: evidence reference escaped the screenshot directory');
        return rel;
    }
    #scan() {
        this.#assertRoot();
        if (!existsSync(this.#root))
            return [];
        const rows = [];
        for (const name of readdirSync(this.#root)) {
            if (!EVIDENCE_FILE.test(name))
                continue;
            const path = join(this.#root, name);
            const info = lstatSync(path);
            if (info.isSymbolicLink() || !info.isFile())
                throw new Error('dsh-android: evidence index found a non-regular screenshot');
            rows.push({ name, bytes: info.size, modifiedAt: Math.trunc(info.mtimeMs), ino: String(info.ino ?? 0) });
        }
        return rows;
    }
    #validate(value) {
        if (typeof value !== 'object' || value === null || value.version !== 1 || !Number.isSafeInteger(value.revision)
            || value.revision < 0 || typeof value.files !== 'object' || value.files === null || Array.isArray(value.files))
            throw new Error('dsh-android: evidence reference index is invalid');
        const files = {};
        let referenceCount = 0;
        for (const [name, row] of Object.entries(value.files)) {
            if (!EVIDENCE_FILE.test(name) || typeof row !== 'object' || row === null || !Number.isSafeInteger(row.bytes) || row.bytes < 0
                || !Number.isSafeInteger(row.modifiedAt) || row.modifiedAt < 0 || typeof row.ino !== 'string' || !Array.isArray(row.references))
                throw new Error('dsh-android: evidence reference index contains an invalid row');
            referenceCount += row.references.length;
            if (referenceCount > 10_000)
                throw new Error('dsh-android: evidence reference count exceeded its safety budget');
            files[name] = { bytes: row.bytes, modifiedAt: row.modifiedAt, ino: row.ino, references: row.references.map(normalizeEvidenceReference) };
        }
        return { version: 1, revision: value.revision, files };
    }
    #load() {
        if (!existsSync(this.#indexPath))
            return { version: 1, revision: 0, files: {} };
        const info = lstatSync(this.#indexPath);
        if (info.isSymbolicLink() || !info.isFile() || info.size <= 0 || info.size > EVIDENCE_INDEX_MAX_BYTES)
            throw new Error('dsh-android: evidence reference index size or type is invalid');
        return this.#validate(JSON.parse(readFileSync(this.#indexPath, 'utf8')));
    }
    #save(state) {
        const next = this.#validate({ ...state, revision: state.revision + 1 });
        const indexRoot = dirname(this.#indexPath);
        mkdirSync(indexRoot, { recursive: true, mode: 0o700 });
        const rootInfo = lstatSync(indexRoot);
        if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
            throw new Error('dsh-android: evidence index root is not a regular directory');
        const temporary = `${this.#indexPath}.tmp-${process.pid}-${Date.now()}`;
        try {
            writeFileSync(temporary, `${JSON.stringify(next)}\n`, { flag: 'wx', mode: 0o600 });
            renameSync(temporary, this.#indexPath);
        }
        finally {
            if (existsSync(temporary))
                unlinkSync(temporary);
        }
        return next;
    }
    /** Recompute the complete authoritative evidence view from isolated inputs. */
    rebuildReferenceIndex(references = []) {
        if (!Array.isArray(references))
            throw new Error('dsh-android: evidence reference snapshot must be an array');
        const state = { version: 1, revision: 0, files: {} };
        for (const file of this.#scan())
            state.files[file.name] = { ...file, references: [] };
        for (const row of references) {
            if (typeof row !== 'object' || row === null)
                throw new Error('dsh-android: invalid evidence reference snapshot row');
            const name = this.#name(row.path);
            if (state.files[name] === undefined)
                throw Object.assign(new Error(`dsh-android: dangling evidence reference ${name}`), { code: 'android-evidence-reference-dangling' });
            const reference = normalizeEvidenceReference(row);
            const existing = state.files[name].references.find(value => value.kind === reference.kind && value.id === reference.id);
            if (existing && reference.kind === 'token')
                existing.expiresAt = Math.max(existing.expiresAt, reference.expiresAt);
            else if (!existing)
                state.files[name].references.push(reference);
        }
        const saved = this.#save(state);
        return { rebuilt: true, authoritative: true, revision: saved.revision, files: Object.keys(saved.files).length,
            references: Object.values(saved.files).reduce((sum, row) => sum + row.references.length, 0), danglingReferences: 0 };
    }
    /** Persist one tool-card/attachment/history/token reference without GC. */
    recordReference(path, reference) {
        const name = this.#name(path);
        const normalized = normalizeEvidenceReference(reference);
        const state = this.#load();
        const disk = this.#scan();
        const diskByName = new Map(disk.map(row => [row.name, row]));
        for (const [savedName, row] of Object.entries(state.files)) {
            const current = diskByName.get(savedName);
            if (!current || current.bytes !== row.bytes || current.modifiedAt !== row.modifiedAt || current.ino !== row.ino)
                throw new Error('dsh-android: evidence identity changed; reference index update stopped');
        }
        for (const file of disk)
            state.files[file.name] ??= { ...file, references: [] };
        if (state.files[name] === undefined)
            throw Object.assign(new Error(`dsh-android: dangling evidence reference ${name}`), { code: 'android-evidence-reference-dangling' });
        const found = state.files[name].references.find(value => value.kind === normalized.kind && value.id === normalized.id);
        if (found && normalized.kind === 'token')
            found.expiresAt = Math.max(found.expiresAt, normalized.expiresAt);
        else if (!found)
            state.files[name].references.push(normalized);
        const saved = this.#save(state);
        return { recorded: true, authoritative: true, revision: saved.revision, danglingReferences: 0 };
    }
    referenceStatus() {
        const state = this.#load();
        const disk = new Set(this.#scan().map(row => row.name));
        const dangling = Object.keys(state.files).filter(name => !disk.has(name));
        return { authoritative: true, files: disk.size, references: Object.values(state.files).reduce((sum, row) => sum + row.references.length, 0),
            danglingReferences: dangling.length, dangling };
    }
}
/** Capture one PNG into the store and summarize it (never image bytes). */
export async function captureScreenshot(host, store, tool, device, summary, vision) {
    let shot;
    try {
        shot = await host.screenshot(device.serial);
    }
    catch (error) {
        throw new Error(`${tool}: the screencap on ${device.serial} failed: ${errorMessage(error)} — the device may have gone `
            + 'offline; run android_devices to check');
    }
    const path = store.nextPath(device.serial);
    try {
        writeFileSync(path, shot.png);
    }
    catch (error) {
        throw new Error(`${tool}: could not write the screenshot to ${path}: ${errorMessage(error)}`);
    }
    const bytes = statSync(path).size;
    const image = await screenshotImageRef(vision, shot.png, basename(path));
    try {
        store.recordReference(path, { kind: 'tool-card', id: `capture:${basename(path)}` });
        if (image !== undefined)
            store.recordReference(path, { kind: 'attachment', id: `attachment:${basename(path)}` });
    }
    catch {
        // Evidence remains authoritative and non-GC even when a damaged index
        // deliberately fails closed; capture must not be turned into data loss.
    }
    return {
        path,
        bytes,
        ...(shot.width === undefined ? {} : { width: shot.width }),
        ...(shot.height === undefined ? {} : { height: shot.height }),
        device: summary,
        ...(image === undefined ? {} : { image }),
    };
}
/** Screenshot presentation envelope — stable, replayable identifiers only. */
export function screenshotMeta(value) {
    const result = value;
    return {
        kind: 'android-screenshot',
        // `path` and `screenshotPath` are deliberately the same value: the client
        // hydrate check reads one, the capture session reads the other, and one
        // renamed field would silently stop a card from re-minting its URL.
        screenshotPath: result.path,
        path: result.path,
        device: { ...result.device },
    };
}
function clampBand(value) {
    return Math.min(SCROLL_BAND_MAX, Math.max(SCROLL_BAND_MIN, value));
}
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/**
 * The finger path of one scroll. The direction names the CONTENT, matching
 * dsh-ios: `down` reveals content further down the page, which is the finger
 * moving UP (a smaller y). Both endpoints are clamped into the
 * system-gesture-free band, so a swipe can never begin (or end) in Android's
 * navigation strip where the shell would swallow it.
 */
export function androidScrollPath(args) {
    const direction = args.direction;
    if (direction === undefined || SCROLL_DIRECTIONS.indexOf(direction) === -1) {
        throw new Error('android_interact: action "scroll" requires direction "up", "down", "left" or "right"'
            + ` (got ${direction === undefined ? 'nothing' : JSON.stringify(direction)})`);
    }
    const amount = args.amount ?? 0.6;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1) {
        throw new Error(`android_interact: scroll amount must be a number within 0..1, got ${String(amount)}`);
    }
    const anchorX = finiteNumber(args.x) ?? 0.5;
    const anchorY = finiteNumber(args.y) ?? 0.5;
    if (anchorX < 0 || anchorX > 1 || anchorY < 0 || anchorY > 1) {
        throw new Error(`android_interact: scroll anchor x/y must be within 0..1, got x=${String(args.x)} y=${String(args.y)}`);
    }
    const vertical = direction === 'up' || direction === 'down';
    const anchor = vertical ? anchorY : anchorX;
    const delta = (direction === 'down' || direction === 'right' ? -1 : 1) * amount;
    const from = clampBand(anchor);
    const to = clampBand(from + delta);
    return vertical
        ? { fromX: anchorX, fromY: from, toX: anchorX, toY: to }
        : { fromX: from, fromY: anchorY, toX: to, toY: anchorY };
}
/**
 * Validate a `gesture` payload into a normalized drag. Android has one gesture
 * primitive (`input swipe`), so a gesture IS a drag — a raw single-frame
 * `{type,x,y}` payload (which serve-sim accepted on iOS) has no meaning here
 * and is refused with the shape that does work.
 */
export function gestureDragOf(json) {
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
        throw new Error('android_interact: action "gesture" requires a json object describing a drag, e.g. '
            + '{"fromX":0.5,"fromY":0.8,"toX":0.5,"toY":0.2,"duration":0.3} with normalized 0..1 coordinates');
    }
    const record = json;
    const fromX = finiteNumber(record.fromX);
    const fromY = finiteNumber(record.fromY);
    const toX = finiteNumber(record.toX);
    const toY = finiteNumber(record.toY);
    if (fromX === undefined || fromY === undefined || toX === undefined || toY === undefined) {
        throw new Error('android_interact: a gesture is a drag on Android (`input swipe`) — pass json '
            + '{"fromX":0.1,"fromY":0.5,"toX":0.9,"toY":0.5,"duration":0.3} with normalized 0..1 coordinates '
            + '(single-frame {"type":"begin",…} payloads are an iOS/serve-sim shape and do nothing here)');
    }
    if (![fromX, fromY, toX, toY].every(value => value >= 0 && value <= 1)) {
        throw new Error('android_interact: gesture from/to coordinates must be normalized 0..1 of the streamed frame');
    }
    const duration = finiteNumber(record.duration) ?? 0.3;
    if (duration <= 0 || duration > 5) {
        throw new Error(`android_interact: gesture duration must be within 0..5 seconds, got ${String(duration)}`);
    }
    return { fromX, fromY, toX, toY, duration };
}
/**
 * Perform one validated interaction against the device. Every branch validates
 * BEFORE touching the device, so an argument mistake never lands a half
 * gesture on a real phone.
 */
export async function performInteract(host, serial, args) {
    switch (args.action) {
        case 'tap': {
            const x = finiteNumber(args.x);
            const y = finiteNumber(args.y);
            if (x === undefined || y === undefined) {
                throw new Error('android_interact: action "tap" requires numeric x and y (normalized 0..1 of the frame)');
            }
            if (x < 0 || x > 1 || y < 0 || y > 1) {
                throw new Error(`android_interact: tap x/y must be within 0..1, got x=${String(args.x)} y=${String(args.y)}`);
            }
            await host.tap(serial, x, y);
            return;
        }
        case 'type': {
            if (typeof args.text !== 'string' || args.text === '') {
                throw new Error('android_interact: action "type" requires a non-empty text');
            }
            await host.type(serial, args.text);
            return;
        }
        case 'button': {
            if (typeof args.name !== 'string' || args.name.trim() === '') {
                throw new Error('android_interact: action "button" requires a button name — one of '
                    + `${Object.keys(ANDROID_BUTTONS).join(', ')}, or a raw KEYCODE_* name`);
            }
            await host.button(serial, args.name.trim());
            return;
        }
        case 'gesture': {
            await host.drag(serial, gestureDragOf(args.json));
            return;
        }
        case 'scroll': {
            await host.drag(serial, { ...androidScrollPath(args), duration: SCROLL_DURATION_S });
            return;
        }
    }
}
