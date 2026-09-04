/**
 * Capability tokens and the transport fence for the dsh-android web routes.
 *
 * Ported from dsh-ios stream-routes.ts with the same security posture:
 * - HMAC-SHA256 capabilities `base64url(payload).base64url(mac)`, signed with
 *   a 32-byte per-DSH-home key (`<DSH_HOME>/cache/dsh-android/
 *   stream-access.key`, 0600, created atomically); tokens expire within 10
 *   minutes.
 * - Every route also applies the loopback/trusted transport fence (peer
 *   address, loopback Host, Fetch-Metadata/Origin) BEFORE any capability is
 *   consulted — Host/Origin are caller-controlled data, so a LAN client
 *   cannot spoof localhost and a DNS-rebinding Host is rejected.
 * - The screenshot route serves exactly one directory, walked with lstat
 *   (no symlinks) and finished with a realpath containment check.
 * @module @zseven-w/dsh-android/stream-access
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { SERIAL_PATTERN } from './adb.js';
/** Hard capability lifetime (tokens expire within 10 minutes). */
export const TOKEN_TTL_MS = 10 * 60 * 1000;
const KEY_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 16 * 1024;
/** Signing may run ahead of verification by this much before the TTL cap trips. */
const CLOCK_SKEW_MS = 60 * 1000;
const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024;
export const SCREENSHOT_GC_FLAG = 'HARNESS_DESKTOP_PREVIEW_SAFE_GC';
export const SCREENSHOT_GC_SAFETY_MS = 10 * 60 * 1000;
export const SCREENSHOT_QUARANTINE_DELAY_MS = 60 * 1000;
const SCREENSHOT_INDEX_MAX_BYTES = 16 * 1024 * 1024;
const PREVIEW_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.png$/;
const QUARANTINE_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,180}\.png)\.(\d{13})\.quarantine$/;
const REFERENCE_KINDS = new Set(['attachment', 'tool-card', 'history', 'token']);
const GC_RUNTIME_ID = randomUUID();
const GC_LOCKS = new Map();
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseStreamPayload(value) {
    if (!isRecord(value))
        return undefined;
    if (value.v !== 1
        || value.kind !== 'android-stream'
        || typeof value.serial !== 'string'
        || !SERIAL_PATTERN.test(value.serial)
        || typeof value.exp !== 'number'
        || !Number.isSafeInteger(value.exp))
        return undefined;
    return { v: 1, kind: 'android-stream', serial: value.serial, exp: value.exp };
}
function parseScreenshotPayload(value) {
    if (!isRecord(value))
        return undefined;
    if (value.v !== 1
        || value.kind !== 'android-screenshot'
        || typeof value.path !== 'string'
        || !isAbsolute(value.path)
        || typeof value.exp !== 'number'
        || !Number.isSafeInteger(value.exp))
        return undefined;
    return { v: 1, kind: 'android-screenshot', path: value.path, exp: value.exp };
}
function dshHome() {
    const env = process.env.DSH_HOME?.trim();
    return env === undefined || env.length === 0 ? join(homedir(), '.dsh') : resolve(env);
}
/** Plugin-managed state root (mirrors the dsh-ios convention). */
export function stateRoot() {
    return join(dshHome(), 'cache', 'dsh-android');
}
/** Durable evidence captures and disposable compatibility previews never share
 * a directory. The former legacy tmp cache stays readable for live history
 * tokens, but new writers never target or clear it.
 */
export function screenshotDir() {
    return join(stateRoot(), 'evidence', 'screenshots');
}
export function previewScreenshotDir() {
    return join(stateRoot(), 'preview', 'screenshots');
}
export function legacyScreenshotDir() {
    return join(tmpdir(), 'dsh-android', 'screenshots');
}
export function previewQuarantineDir() {
    return join(stateRoot(), 'preview', 'quarantine');
}
export function screenshotReferenceIndexPath() {
    return join(stateRoot(), 'preview', 'reference-index.json');
}
export function screenshotGcEnabled(environment = process.env) {
    const value = String(environment?.[SCREENSHOT_GC_FLAG] ?? 'true').trim().toLowerCase();
    return value !== '0' && value !== 'false' && value !== 'off';
}
function pathInsideRoot(root, path) {
    if (!isAbsolute(path))
        return false;
    const rel = relative(root, path);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export function screenshotNamespaceOf(path) {
    if (pathInsideRoot(screenshotDir(), path))
        return 'evidence';
    if (pathInsideRoot(previewScreenshotDir(), path))
        return 'preview';
    if (pathInsideRoot(legacyScreenshotDir(), path))
        return 'legacy';
    return undefined;
}
function normalizeGcReference(value) {
    if (!isRecord(value) || !REFERENCE_KINDS.has(value.kind))
        throw new Error('dsh-android: unknown screenshot reference kind');
    const id = String(value.id || '');
    if (id.length === 0 || id.length > 256)
        throw new Error('dsh-android: invalid screenshot reference id');
    if (value.kind !== 'token')
        return { kind: value.kind, id };
    const expiresAt = Math.trunc(Number(value.expiresAt));
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
        throw new Error('dsh-android: invalid screenshot token expiry');
    return { kind: value.kind, id, expiresAt };
}
function gcReferenceHash(rows) {
    const canonical = [...rows].map(normalizeGcReference).sort((left, right) => left.kind.localeCompare(right.kind)
        || left.id.localeCompare(right.id) || (left.expiresAt ?? 0) - (right.expiresAt ?? 0));
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
function gcIdentity(info) {
    return { bytes: info.size, modifiedAt: Math.trunc(info.mtimeMs), ino: String(info.ino ?? 0) };
}
function sameGcIdentity(left, right) {
    return left?.bytes === right?.bytes && left?.modifiedAt === right?.modifiedAt && left?.ino === right?.ino;
}
function blankGcIndex(now, runtimeId) {
    return { version: 2, revision: 0, highWaterMs: now, runtimeId, references: {}, observed: {}, quarantine: {} };
}
function invalidGcIndex(message) {
    return Object.assign(new Error(message), { code: 'android-screenshot-reference-index-invalid' });
}
function validateGcIndex(value) {
    if (!isRecord(value) || value.version !== 2 || !Number.isSafeInteger(value.revision) || value.revision < 0
        || !Number.isSafeInteger(value.highWaterMs) || value.highWaterMs < 0 || typeof value.runtimeId !== 'string'
        || !isRecord(value.references) || !isRecord(value.observed) || !isRecord(value.quarantine))
        throw invalidGcIndex('dsh-android: screenshot reference index is invalid; GC stopped');
    const references = {};
    let referenceCount = 0;
    for (const [name, rows] of Object.entries(value.references)) {
        if (!PREVIEW_FILE.test(name) || !Array.isArray(rows) || rows.length > 10_000)
            throw invalidGcIndex('dsh-android: screenshot reference index contains an unknown reference');
        referenceCount += rows.length;
        if (referenceCount > 10_000)
            throw invalidGcIndex('dsh-android: screenshot reference count exceeded its safety budget');
        try {
            references[name] = rows.map(normalizeGcReference);
        }
        catch {
            throw invalidGcIndex('dsh-android: screenshot reference index contains an unknown reference');
        }
    }
    const observed = {};
    for (const [name, row] of Object.entries(value.observed)) {
        if (!PREVIEW_FILE.test(name) || !isRecord(row) || !Number.isSafeInteger(row.firstSeenAt) || row.firstSeenAt < 0
            || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !Number.isSafeInteger(row.modifiedAt) || row.modifiedAt < 0
            || typeof row.ino !== 'string' || !/^[a-f0-9]{64}$/i.test(row.referenceHash))
            throw invalidGcIndex('dsh-android: screenshot observation index is invalid');
        observed[name] = { firstSeenAt: row.firstSeenAt, bytes: row.bytes, modifiedAt: row.modifiedAt, ino: row.ino, referenceHash: row.referenceHash };
    }
    const quarantine = {};
    for (const [name, row] of Object.entries(value.quarantine)) {
        const match = typeof row?.file === 'string' ? QUARANTINE_FILE.exec(row.file) : undefined;
        if (!PREVIEW_FILE.test(name) || !isRecord(row) || match?.[1] !== name
            || !Number.isSafeInteger(row.quarantinedAt) || row.quarantinedAt < 0
            || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !Number.isSafeInteger(row.modifiedAt) || row.modifiedAt < 0
            || typeof row.ino !== 'string' || typeof row.verifiedRuntimeId !== 'string'
            || !Number.isSafeInteger(row.safeDeleteAfter) || row.safeDeleteAfter < row.quarantinedAt)
            throw invalidGcIndex('dsh-android: screenshot quarantine index is invalid');
        quarantine[name] = { file: row.file, quarantinedAt: row.quarantinedAt, bytes: row.bytes, modifiedAt: row.modifiedAt, ino: row.ino, verifiedRuntimeId: row.verifiedRuntimeId, safeDeleteAfter: row.safeDeleteAfter };
    }
    return { version: 2, revision: value.revision, highWaterMs: value.highWaterMs, runtimeId: value.runtimeId, references, observed, quarantine };
}
function withGcLock(key, operation) {
    const prior = GC_LOCKS.get(key) ?? Promise.resolve();
    const running = prior.catch(() => { }).then(operation);
    GC_LOCKS.set(key, running);
    return running.finally(() => {
        if (GC_LOCKS.get(key) === running)
            GC_LOCKS.delete(key);
    });
}
/**
 * Strict, restart-safe reference index and staged quarantine collector for preview PNGs.
 * Evidence and the legacy mixed cache are deliberately outside this root and
 * therefore cannot be scanned or deleted by this class.
 */
export class AndroidPreviewScreenshotGc {
    root;
    quarantineRoot;
    indexPath;
    runtimeId;
    now;
    enabled;
    tokenTtlMs;
    safetyMs;
    quarantineDelayMs;
    maxFiles;
    maxBytes;
    maxAgeMs;
    scanMaxEntries;
    scanMaxBytes;
    constructor(options = {}) {
        this.root = resolve(options.root ?? previewScreenshotDir());
        if (this.root !== resolve(previewScreenshotDir()))
            throw new Error('dsh-android: preview GC root must be the normalized preview namespace');
        this.quarantineRoot = resolve(options.quarantineRoot ?? previewQuarantineDir());
        this.indexPath = resolve(options.indexPath ?? screenshotReferenceIndexPath());
        if (this.quarantineRoot !== resolve(previewQuarantineDir()) || this.indexPath !== resolve(screenshotReferenceIndexPath()))
            throw new Error('dsh-android: preview GC state must stay inside the normalized preview namespace');
        this.runtimeId = typeof options.runtimeId === 'string' && options.runtimeId !== '' ? options.runtimeId : GC_RUNTIME_ID;
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.enabled = typeof options.enabled === 'function' ? options.enabled : options.enabled === undefined ? () => screenshotGcEnabled() : () => options.enabled === true;
        this.tokenTtlMs = Number.isSafeInteger(options.tokenTtlMs) && options.tokenTtlMs > 0 ? options.tokenTtlMs : TOKEN_TTL_MS;
        this.safetyMs = Number.isSafeInteger(options.safetyMs) && options.safetyMs > 0 ? options.safetyMs : SCREENSHOT_GC_SAFETY_MS;
        this.quarantineDelayMs = Number.isSafeInteger(options.quarantineDelayMs) && options.quarantineDelayMs > 0 ? options.quarantineDelayMs : SCREENSHOT_QUARANTINE_DELAY_MS;
        this.maxFiles = Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : 2;
        this.maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : 64 * 1024 * 1024;
        this.maxAgeMs = Number.isSafeInteger(options.maxAgeMs) && options.maxAgeMs > 0 ? options.maxAgeMs : 30 * 60 * 1000;
        this.scanMaxEntries = Number.isSafeInteger(options.scanMaxEntries) && options.scanMaxEntries > 0 ? options.scanMaxEntries : 10_000;
        this.scanMaxBytes = Number.isSafeInteger(options.scanMaxBytes) && options.scanMaxBytes > 0 ? options.scanMaxBytes : 512 * 1024 * 1024;
    }
    #time(value) {
        const result = Math.trunc(Number(value ?? this.now()));
        if (!Number.isSafeInteger(result) || result < 0)
            throw new Error('dsh-android: invalid screenshot GC time');
        return result;
    }
    #name(path) {
        const absolute = resolve(path);
        const rel = relative(this.root, absolute);
        if (rel === '' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.includes(sep) || !PREVIEW_FILE.test(rel))
            throw new Error('dsh-android: screenshot reference escaped the preview namespace');
        return rel;
    }
    async #namespaceSafe() {
        for (const directory of [stateRoot(), resolve(this.root, '..'), this.root, this.quarantineRoot]) {
            const info = await lstat(directory).catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error));
            if (info && (!info.isDirectory() || info.isSymbolicLink()))
                return false;
        }
        return true;
    }
    async #ensure(directory) {
        const state = resolve(stateRoot());
        const preview = resolve(this.root, '..');
        if (directory !== state && directory !== preview && directory !== this.root && directory !== this.quarantineRoot)
            throw new Error('dsh-android: screenshot GC directory escaped the preview namespace');
        const targets = [...new Set([state, preview, directory])];
        for (let index = 0; index < targets.length; index += 1) {
            const target = targets[index];
            await mkdir(target, { recursive: index === 0, mode: 0o700 }).catch(error => {
                if (error?.code !== 'EEXIST')
                    throw error;
            });
            const info = await lstat(target);
            if (!info.isDirectory() || info.isSymbolicLink())
                throw new Error('dsh-android: screenshot GC directory is not a regular directory');
        }
    }
    async #files() {
        const entries = await readdir(this.root, { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
        const rows = [];
        for (const entry of entries) {
            if (!entry.isFile() || !PREVIEW_FILE.test(entry.name))
                continue;
            const info = await stat(join(this.root, entry.name)).catch(() => undefined);
            if (info?.isFile())
                rows.push({ name: entry.name, path: join(this.root, entry.name), ...gcIdentity(info) });
        }
        return rows;
    }
    async #quarantineFiles() {
        const entries = await readdir(this.quarantineRoot, { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
        const rows = [];
        const names = new Set();
        let unknown = false;
        for (const entry of entries) {
            const match = QUARANTINE_FILE.exec(entry.name);
            if (!entry.isFile() || !match) {
                unknown = true;
                continue;
            }
            if (names.has(match[1]))
                throw invalidGcIndex('dsh-android: duplicate quarantine source path');
            names.add(match[1]);
            const info = await stat(join(this.quarantineRoot, entry.name)).catch(() => undefined);
            if (info?.isFile())
                rows.push({ name: match[1], file: entry.name, quarantinedAt: Number(match[2]), ...gcIdentity(info) });
        }
        return { rows, unknown };
    }
    async #load() {
        let handle;
        try {
            handle = await open(this.indexPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
        }
        catch (error) {
            if (error?.code === 'ENOENT')
                return { missing: true, state: blankGcIndex(0, this.runtimeId) };
            throw invalidGcIndex('dsh-android: screenshot reference index is unreadable');
        }
        try {
            const info = await handle.stat();
            if (!info.isFile() || info.size <= 0 || info.size > SCREENSHOT_INDEX_MAX_BYTES)
                throw invalidGcIndex('dsh-android: screenshot reference index size or type is invalid');
            return { missing: false, state: validateGcIndex(JSON.parse(await handle.readFile({ encoding: 'utf8' }))) };
        }
        catch (error) {
            if (error?.code === 'android-screenshot-reference-index-invalid')
                throw error;
            throw invalidGcIndex('dsh-android: screenshot reference index cannot be parsed');
        }
        finally {
            await handle.close();
        }
    }
    async #save(state) {
        const next = validateGcIndex({ ...state, revision: state.revision + 1 });
        await this.#ensure(resolve(this.indexPath, '..'));
        const temporary = `${this.indexPath}.tmp-${randomUUID()}`;
        try {
            await writeFile(temporary, `${JSON.stringify(next)}\n`, { flag: 'wx', mode: 0o600 });
            await rename(temporary, this.indexPath);
        }
        finally {
            await unlink(temporary).catch(error => {
                if (error?.code !== 'ENOENT')
                    throw error;
            });
        }
        return next;
    }
    #rows(state, name) {
        return state.references[name] ?? [];
    }
    #protectedUntil(state, name) {
        let until = 0;
        for (const reference of this.#rows(state, name)) {
            if (reference.kind !== 'token')
                return Number.POSITIVE_INFINITY;
            until = Math.max(until, reference.expiresAt + this.safetyMs);
        }
        return until;
    }
    #dropExpiredTokens(state, now) {
        for (const [name, rows] of Object.entries(state.references)) {
            const kept = rows.filter(reference => reference.kind !== 'token' || reference.expiresAt + this.safetyMs > now);
            if (kept.length > 0)
                state.references[name] = kept;
            else
                delete state.references[name];
            if (state.observed[name])
                state.observed[name].referenceHash = gcReferenceHash(kept);
        }
    }
    #budget(files, quarantine) {
        const count = files.length + quarantine.rows.length;
        const bytes = [...files, ...quarantine.rows].reduce((sum, row) => sum + row.bytes, 0);
        return count <= this.scanMaxEntries && bytes <= this.scanMaxBytes;
    }
    #reconcile(state, quarantine, restart, now) {
        const next = {};
        for (const row of quarantine.rows) {
            const saved = state.quarantine[row.name];
            const uncertain = restart || !saved || !sameGcIdentity(saved, row);
            next[row.name] = { file: row.file, quarantinedAt: row.quarantinedAt, bytes: row.bytes, modifiedAt: row.modifiedAt, ino: row.ino,
                verifiedRuntimeId: uncertain ? '' : saved.verifiedRuntimeId,
                safeDeleteAfter: uncertain ? Math.max(saved?.safeDeleteAfter ?? 0, row.quarantinedAt, now + Math.max(this.tokenTtlMs + this.safetyMs, this.quarantineDelayMs)) : saved.safeDeleteAfter };
        }
        state.quarantine = next;
    }
    #observe(state, files, now, restart) {
        const seen = new Set();
        for (const file of files) {
            seen.add(file.name);
            const hash = gcReferenceHash(this.#rows(state, file.name));
            const saved = state.observed[file.name];
            if (restart || !saved || !sameGcIdentity(saved, file) || saved.referenceHash !== hash)
                state.observed[file.name] = { firstSeenAt: now, bytes: file.bytes, modifiedAt: file.modifiedAt, ino: file.ino, referenceHash: hash };
        }
        for (const name of Object.keys(state.observed))
            if (!seen.has(name))
                delete state.observed[name];
    }
    async #prevalidate(operations) {
        for (const operation of operations) {
            const info = await stat(operation.path).catch(() => undefined);
            if (!info?.isFile() || !sameGcIdentity(operation.identity, gcIdentity(info)))
                return false;
        }
        return true;
    }
    async collect(options = {}) {
        return withGcLock(this.indexPath, async () => {
            const now = this.#time(options.now);
            const enabled = this.enabled() === true;
            const emptyResult = { gcEnabled: enabled, retainedFiles: 0, quarantinedFiles: 0, restoredFiles: 0, deletedFiles: 0, danglingReferences: 0, danglingTokens: 0 };
            if (!enabled)
                return { ...emptyResult, featureDisabled: true };
            if (!await this.#namespaceSafe())
                return { ...emptyResult, namespaceInvalid: true };
            const files = (await this.#files()).sort((left, right) => right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name));
            const quarantine = await this.#quarantineFiles();
            const result = { ...emptyResult, retainedFiles: files.length };
            if (!this.#budget(files, quarantine) || quarantine.unknown)
                return { ...result, scanBudgetExceeded: !this.#budget(files, quarantine), unknownQuarantineEntry: quarantine.unknown };
            let loaded;
            try {
                loaded = await this.#load();
            }
            catch (error) {
                return { ...result, indexInvalid: true, reason: error instanceof Error ? error.message : String(error) };
            }
            const state = loaded.state;
            if (now < state.highWaterMs)
                return { ...result, clockRollback: true };
            const restart = state.runtimeId !== this.runtimeId;
            state.runtimeId = this.runtimeId;
            state.highWaterMs = now;
            this.#dropExpiredTokens(state, now);
            this.#reconcile(state, quarantine, restart, now);
            this.#observe(state, files, now, restart);
            const available = new Set([...files.map(file => file.name), ...Object.keys(state.quarantine)]);
            const dangling = Object.entries(state.references).filter(([name]) => !available.has(name)).flatMap(([, rows]) => rows);
            if (dangling.length > 0)
                return { ...result, danglingReferences: dangling.length, danglingTokens: dangling.filter(row => row.kind === 'token').length, referenceViewInvalid: true };
            if (loaded.missing || restart) {
                for (const row of Object.values(state.quarantine))
                    row.verifiedRuntimeId = '';
                await this.#save(state);
                return { ...result, shadow: true, shadowReason: loaded.missing ? 'index-rebuilt' : 'restart-revalidation' };
            }
            const restores = [];
            const deletes = [];
            for (const [name, row] of Object.entries(state.quarantine)) {
                if (row.verifiedRuntimeId !== this.runtimeId) {
                    row.verifiedRuntimeId = this.runtimeId;
                    continue;
                }
                if (this.#protectedUntil(state, name) > now)
                    restores.push({ kind: 'restore', name, row, path: join(this.quarantineRoot, row.file), identity: row });
                else if (now >= row.safeDeleteAfter)
                    deletes.push({ kind: 'delete', name, row, path: join(this.quarantineRoot, row.file), identity: row });
            }
            let retained = 0;
            let retainedBytes = 0;
            const quarantines = [];
            for (const file of files) {
                const overCount = retained >= this.maxFiles;
                const overBytes = retainedBytes + file.bytes > this.maxBytes;
                const expired = now - file.modifiedAt > this.maxAgeMs;
                const observed = state.observed[file.name];
                const oldEnough = observed && now - observed.firstSeenAt >= this.tokenTtlMs + this.safetyMs;
                if ((options.removeAll === true || overCount || overBytes || expired) && state.quarantine[file.name] === undefined && oldEnough && this.#protectedUntil(state, file.name) <= now)
                    quarantines.push({ kind: 'quarantine', name: file.name, file, path: file.path, identity: file });
                else {
                    retained += 1;
                    retainedBytes += file.bytes;
                }
            }
            const operations = [...restores, ...quarantines, ...deletes];
            if (!await this.#prevalidate(operations)) {
                await this.#save(state);
                return { ...result, identityChanged: true };
            }
            for (const operation of restores) {
                if (await lstat(join(this.root, operation.name)).catch(() => undefined))
                    return { ...result, quarantineConflict: true };
            }
            for (const operation of restores) {
                await this.#ensure(this.root);
                await rename(operation.path, join(this.root, operation.name));
                delete state.quarantine[operation.name];
                result.restoredFiles += 1;
                retained += 1;
            }
            for (const operation of quarantines) {
                await this.#ensure(this.quarantineRoot);
                const quarantineName = `${operation.name}.${now}.quarantine`;
                await rename(operation.path, join(this.quarantineRoot, quarantineName));
                state.quarantine[operation.name] = { file: quarantineName, quarantinedAt: now, bytes: operation.file.bytes,
                    modifiedAt: operation.file.modifiedAt, ino: operation.file.ino, verifiedRuntimeId: this.runtimeId,
                    safeDeleteAfter: now + this.quarantineDelayMs };
                delete state.observed[operation.name];
                result.quarantinedFiles += 1;
            }
            for (const operation of deletes) {
                await unlink(operation.path);
                delete state.quarantine[operation.name];
                delete state.references[operation.name];
                result.deletedFiles += 1;
            }
            result.retainedFiles = retained;
            await this.#save(state);
            return result;
        });
    }
    async recordReference(path, reference, options = {}) {
        return withGcLock(this.indexPath, async () => {
            const name = this.#name(path);
            const normalized = normalizeGcReference(reference);
            const now = this.#time(options.now);
            if (!await this.#namespaceSafe())
                return { recorded: false, namespaceInvalid: true };
            const files = await this.#files();
            const quarantine = await this.#quarantineFiles();
            if (!this.#budget(files, quarantine) || quarantine.unknown)
                return { recorded: false, scanBudgetExceeded: true };
            let loaded;
            try {
                loaded = await this.#load();
            }
            catch (error) {
                return { recorded: false, indexInvalid: true };
            }
            const state = loaded.state;
            if (now < state.highWaterMs)
                return { recorded: false, clockRollback: true };
            this.#reconcile(state, quarantine, state.runtimeId !== this.runtimeId, now);
            if (!files.some(file => file.name === name) && !state.quarantine[name])
                return { recorded: false, danglingReferences: 1 };
            const rows = this.#rows(state, name);
            const found = rows.find(row => row.kind === normalized.kind && row.id === normalized.id);
            if (found && normalized.kind === 'token')
                found.expiresAt = Math.max(found.expiresAt, normalized.expiresAt);
            else if (!found)
                rows.push(normalized);
            state.references[name] = rows;
            const current = files.find(file => file.name === name);
            const observed = state.observed[name];
            if (current && observed && sameGcIdentity(current, observed))
                observed.referenceHash = gcReferenceHash(rows);
            else if (current)
                state.observed[name] = { firstSeenAt: now, bytes: current.bytes, modifiedAt: current.modifiedAt, ino: current.ino, referenceHash: gcReferenceHash(rows) };
            else
                delete state.observed[name];
            if (state.quarantine[name])
                state.quarantine[name].verifiedRuntimeId = '';
            state.runtimeId = this.runtimeId;
            state.highWaterMs = Math.max(state.highWaterMs, now);
            const saved = await this.#save(state);
            return { recorded: true, revision: saved.revision, danglingReferences: 0 };
        });
    }
    async releaseReference(path, reference) {
        return withGcLock(this.indexPath, async () => {
            const name = this.#name(path);
            const normalized = normalizeGcReference(reference);
            if (!await this.#namespaceSafe())
                return { released: false, namespaceInvalid: true };
            const loaded = await this.#load();
            const state = loaded.state;
            const before = this.#rows(state, name);
            const after = before.filter(row => row.kind !== normalized.kind || row.id !== normalized.id);
            if (after.length > 0)
                state.references[name] = after;
            else
                delete state.references[name];
            if (state.observed[name])
                state.observed[name].referenceHash = gcReferenceHash(after);
            if (state.quarantine[name])
                state.quarantine[name].verifiedRuntimeId = '';
            const saved = await this.#save(state);
            return { released: after.length !== before.length, revision: saved.revision };
        });
    }
    async rebuild(records = [], options = {}) {
        if (!Array.isArray(records))
            throw new Error('dsh-android: screenshot reference snapshot must be an array');
        return withGcLock(this.indexPath, async () => {
            const now = this.#time(options.now);
            if (!await this.#namespaceSafe())
                throw invalidGcIndex('dsh-android: preview namespace structure is invalid');
            const files = await this.#files();
            const quarantine = await this.#quarantineFiles();
            if (!this.#budget(files, quarantine) || quarantine.unknown)
                throw invalidGcIndex('dsh-android: screenshot reference scan exceeded its safety budget');
            const state = blankGcIndex(now, this.runtimeId);
            this.#reconcile(state, quarantine, true, now);
            for (const row of records) {
                if (!isRecord(row))
                    throw new Error('dsh-android: invalid screenshot reference snapshot row');
                const name = this.#name(row.path);
                const reference = normalizeGcReference(row);
                if (!files.some(file => file.name === name) && !state.quarantine[name])
                    throw Object.assign(new Error(`dsh-android: dangling screenshot reference ${name}`), { code: 'android-screenshot-reference-dangling' });
                state.references[name] ??= [];
                const found = state.references[name].find(value => value.kind === reference.kind && value.id === reference.id);
                if (found && reference.kind === 'token')
                    found.expiresAt = Math.max(found.expiresAt, reference.expiresAt);
                else if (!found)
                    state.references[name].push(reference);
            }
            this.#observe(state, files, now, true);
            const saved = await this.#save(state);
            return { rebuilt: true, shadow: true, revision: saved.revision, danglingReferences: 0,
                references: Object.values(saved.references).reduce((sum, rows) => sum + rows.length, 0) };
        });
    }
    async readablePath(path) {
        const name = this.#name(path);
        if (!await this.#namespaceSafe())
            return undefined;
        if (await lstat(path).catch(() => undefined))
            return path;
        let state;
        try {
            state = (await this.#load()).state;
        }
        catch {
            return undefined;
        }
        const row = state.quarantine[name];
        if (!row)
            return undefined;
        const candidate = join(this.quarantineRoot, row.file);
        const info = await lstat(candidate).catch(() => undefined);
        return info?.isFile() && !info.isSymbolicLink() ? candidate : undefined;
    }
}
function mac(key, payload) {
    return createHmac('sha256', key).update(payload).digest();
}
function safeEqual(left, right) {
    return left.length === right.length && timingSafeEqual(left, right);
}
async function readKeyFile(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile())
        throw new Error('dsh-android stream access key is not a regular file');
    const key = await readFile(path);
    if (key.length !== KEY_BYTES)
        throw new Error('dsh-android stream access key has an invalid length');
    return key;
}
/** Load or atomically create the per-DSH-home signing key (0600). */
export async function prepareStreamAccessKey() {
    await mkdir(stateRoot(), { recursive: true, mode: 0o700 });
    const path = join(stateRoot(), 'stream-access.key');
    try {
        return await readKeyFile(path);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    const candidate = randomBytes(KEY_BYTES);
    try {
        await writeFile(path, candidate, { flag: 'wx', mode: 0o600 });
        return candidate;
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
        return readKeyFile(path);
    }
}
/** HMAC capability encoder/verifier for stream and screenshot URLs. */
export class StreamAccessController {
    resolveKey;
    screenshotGc;
    now;
    #routeCount = 0;
    #keyPromise;
    constructor(resolveKey = prepareStreamAccessKey, options = {}) {
        this.resolveKey = resolveKey;
        this.screenshotGc = options.screenshotGc instanceof AndroidPreviewScreenshotGc
            ? options.screenshotGc
            : new AndroidPreviewScreenshotGc(options.screenshotGcOptions ?? {});
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    }
    /** Whether at least one HTTP carrier currently owns the routes. */
    get routeAvailable() {
        return this.#routeCount > 0;
    }
    /** Mark one route attachment; the returned disposer removes it. */
    attachRoute() {
        this.#routeCount += 1;
        let active = true;
        return () => {
            if (!active)
                return;
            active = false;
            this.#routeCount -= 1;
        };
    }
    /** Mint a stream capability for one device serial. */
    async signStreamToken(serial, options = {}) {
        if (!SERIAL_PATTERN.test(serial))
            throw new TypeError('dsh-android: signStreamToken requires a device serial');
        return this.#sign({ v: 1, kind: 'android-stream', serial, exp: this.now() + this.#ttl(options.ttlMs) });
    }
    /** Mint a screenshot capability for one absolute path in the cache dir. */
    async signScreenshotToken(path, options = {}) {
        if (!isAbsolute(path))
            throw new TypeError('dsh-android: signScreenshotToken requires an absolute path');
        const now = this.now();
        const signed = await this.#sign({ v: 1, kind: 'android-screenshot', path, exp: now + this.#ttl(options.ttlMs) });
        if (screenshotNamespaceOf(path) === 'preview') {
            const recorded = await this.screenshotGc.recordReference(path, { kind: 'token', id: 'screenshot-capability', expiresAt: signed.expiresAt }, { now });
            if (recorded.recorded !== true)
                throw new Error('dsh-android: preview screenshot token could not enter the strict reference index');
            await this.screenshotGc.collect({ now });
        }
        return signed;
    }
    verifyStreamToken(token) {
        return this.#verify(token, parseStreamPayload);
    }
    verifyScreenshotToken(token) {
        return this.#verify(token, parseScreenshotPayload);
    }
    #ttl(ttlMs) {
        if (ttlMs === undefined || !Number.isFinite(ttlMs))
            return TOKEN_TTL_MS;
        return Math.min(TOKEN_TTL_MS, Math.max(1, Math.floor(ttlMs)));
    }
    #key() {
        this.#keyPromise ??= this.resolveKey();
        return this.#keyPromise;
    }
    async #sign(payload) {
        const key = await this.#key();
        const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
        return { token: `${encoded}.${mac(key, encoded).toString('base64url')}`, expiresAt: payload.exp };
    }
    async #verify(token, parse) {
        if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token))
            return undefined;
        const [encoded, signature] = token.split('.');
        if (encoded === undefined || signature === undefined)
            return undefined;
        const key = await this.#key().catch(() => undefined);
        if (key === undefined)
            return undefined;
        let supplied;
        try {
            supplied = Buffer.from(signature, 'base64url');
        }
        catch {
            return undefined;
        }
        if (!safeEqual(mac(key, encoded), supplied))
            return undefined;
        try {
            const payload = parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
            if (payload === undefined)
                return undefined;
            const now = this.now();
            const expiresAt = payload.exp;
            if (typeof expiresAt !== 'number' || expiresAt <= now)
                return undefined;
            if (expiresAt - now > TOKEN_TTL_MS + CLOCK_SKEW_MS)
                return undefined;
            return payload;
        }
        catch {
            return undefined;
        }
    }
}
// ── loopback / trusted-browser transport fence ───────────────────────────────
function isIpv4LoopbackAddress(address) {
    const parts = address.split('.');
    return parts.length === 4
        && parts[0] === '127'
        && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/**
 * Trust the transport peer, never forwarded or caller-controlled host data.
 * Node may expose an IPv4 peer directly or as an IPv4-mapped IPv6 address,
 * including the compact hexadecimal form used by some platforms.
 */
export function isLoopbackRemoteAddress(address) {
    if (address === undefined)
        return false;
    const normalized = address.toLowerCase().split('%', 1)[0];
    if (normalized === '::1' || isIpv4LoopbackAddress(normalized))
        return true;
    if (!normalized.startsWith('::ffff:'))
        return false;
    const mapped = normalized.slice('::ffff:'.length);
    if (isIpv4LoopbackAddress(mapped))
        return true;
    const hexadecimal = /^([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(mapped);
    return hexadecimal !== null && (Number.parseInt(hexadecimal[1], 16) >>> 8) === 127;
}
function isLoopbackHostname(hostname) {
    if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1')
        return true;
    return isIpv4LoopbackAddress(hostname);
}
function requestAuthority(req) {
    const host = req.headers.host;
    if (typeof host !== 'string')
        return undefined;
    try {
        const parsed = new URL(`http://${host}`);
        if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '' || parsed.username !== '' || parsed.password !== '') {
            return undefined;
        }
        return parsed;
    }
    catch {
        return undefined;
    }
}
function isLoopbackRequest(req) {
    if (!isLoopbackRemoteAddress(req.socket?.remoteAddress))
        return false;
    const authority = requestAuthority(req);
    return authority !== undefined && isLoopbackHostname(authority.hostname);
}
function isTrustedBrowserRequest(req, requireOrigin) {
    if (req.headers['sec-fetch-site'] === 'cross-site')
        return false;
    const origin = req.headers.origin;
    if (origin === undefined)
        return !requireOrigin;
    if (typeof origin !== 'string')
        return false;
    const authority = requestAuthority(req);
    if (authority === undefined)
        return false;
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
            && parsed.host === authority.host;
    }
    catch {
        return false;
    }
}
/** The transport fence applied to every dsh-android route. */
export function isTrustedRequest(req, requireOrigin) {
    return isLoopbackRequest(req) && isTrustedBrowserRequest(req, requireOrigin);
}
/** Resolve a logical screenshot path without ever migrating or restoring it. */
async function screenshotCandidate(path) {
    const namespace = screenshotNamespaceOf(path);
    if (namespace === undefined)
        return undefined;
    const normalRoot = namespace === 'evidence' ? screenshotDir() : namespace === 'preview' ? previewScreenshotDir() : legacyScreenshotDir();
    if (await lstat(path).catch(() => undefined))
        return { namespace, root: normalRoot, file: path };
    if (namespace !== 'preview')
        return { namespace, root: normalRoot, file: path };
    const quarantined = await new AndroidPreviewScreenshotGc().readablePath(path);
    return quarantined === undefined ? { namespace, root: normalRoot, file: path } : { namespace, root: previewQuarantineDir(), file: quarantined };
}
/** Walk one selected candidate with lstat and a realpath containment check. */
async function classifyScreenshotCandidate(candidate) {
    const rel = relative(candidate.root, candidate.file);
    let rootInfo;
    try {
        rootInfo = await lstat(candidate.root);
    }
    catch {
        return 'missing';
    }
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
        return 'outside';
    let current = candidate.root;
    const parts = rel.split(sep);
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        if (part === undefined || part.length === 0 || part === '.' || part === '..')
            return 'outside';
        current = join(current, part);
        let info;
        try {
            info = await lstat(current);
        }
        catch {
            return 'missing';
        }
        if (info.isSymbolicLink())
            return 'outside';
        const final = index === parts.length - 1;
        if (final ? !info.isFile() : !info.isDirectory())
            return 'missing';
    }
    const [realRoot, realFile] = await Promise.all([realpath(candidate.root), realpath(candidate.file)]);
    const relReal = relative(realRoot, realFile);
    if (relReal === '..' || relReal.startsWith(`..${sep}`) || isAbsolute(relReal))
        return 'outside';
    return 'ok';
}
/**
 * Walk `path` from its authoritative namespace with `lstat`. Quarantine is a
 * read-through location only; this check never restores, deletes, or migrates.
 */
export async function classifyScreenshotPath(path) {
    const candidate = await screenshotCandidate(path);
    return candidate === undefined ? 'outside' : classifyScreenshotCandidate(candidate);
}
/**
 * Open the verified screenshot with `O_NOFOLLOW`, bounded in size, and
 * re-validate the exact selected identity so a concurrent move/swap fails.
 */
export async function openVerifiedScreenshot(path) {
    const candidate = await screenshotCandidate(path);
    if (candidate === undefined || await classifyScreenshotCandidate(candidate) !== 'ok')
        return undefined;
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
    const handle = await open(candidate.file, fsConstants.O_RDONLY | noFollow).catch(() => undefined);
    if (handle === undefined)
        return undefined;
    try {
        const before = await handle.stat();
        if (!before.isFile() || before.size <= 0 || before.size > MAX_SCREENSHOT_BYTES)
            return undefined;
        const bytes = await handle.readFile();
        const selectedAgain = await screenshotCandidate(path);
        if (selectedAgain === undefined || selectedAgain.file !== candidate.file || await classifyScreenshotCandidate(selectedAgain) !== 'ok')
            return undefined;
        const after = await handle.stat();
        if (!sameGcIdentity(gcIdentity(before), gcIdentity(after)))
            return undefined;
        return { bytes };
    }
    finally {
        await handle.close().catch(() => { });
    }
}
