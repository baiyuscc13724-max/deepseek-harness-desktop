/**
 * In-process MJPEG-style frame pipeline for one Android device.
 *
 * dsh-ios leans on an external stream helper (serve-sim); Android needs none:
 * ONE persistent `adb exec-out` child runs a `screencap -p` loop on the
 * device, this module splits the concatenated PNG output into frames, and the
 * web routes serve the latest frame straight from memory as a
 * `multipart/x-mixed-replace` body (PNG parts — Chromium and Firefox render
 * those exactly like JPEG parts). No inner loopback port exists at all, so
 * there is nothing to proxy and nothing to fence beyond the DSH webserver
 * routes themselves.
 *
 * The persistent child is the measured heart of the design: spawning adb per
 * frame costs ~200 ms per screenshot (~5 fps ceiling at 100% churn), while a
 * single `while :; do screencap -p; done` child streams ~8 fps on an
 * emulator with zero per-frame process cost. Frame pacing is pull-less:
 * whatever cadence the device sustains is what consumers see.
 *
 * The child is intentionally dumb — it exits, this module reports it, and the
 * host controller (android-host.ts) owns restart/keep-alive policy, exactly
 * like the sim-host/serve-sim split in dsh-ios.
 * @module @zseven-w/dsh-android/frame-source
 */
import type { ServerResponse } from 'node:http';
import type { AdbToolchain } from './adb.js';
export declare const STREAM_BOUNDARY = "dsh-android-frame";
/** One decoded frame: the full PNG plus its IHDR pixel size. */
export interface DeviceFrame {
    png: Buffer;
    width: number;
    height: number;
    /** Monotonic frame index since the loop started. */
    sequence: number;
    at: number;
}
/** Pixel size of a PNG from its IHDR chunk, without decoding the image. */
export declare function pngDimensions(buffer: Buffer): {
    width: number;
    height: number;
} | undefined;
/**
 * Incremental splitter over a byte stream of back-to-back PNG images.
 *
 * PNG framing is self-describing (8-byte signature, then length-prefixed
 * chunks until IEND), so frames are cut by walking chunk headers — no
 * scanning of image data for markers, no false positives. When the stream
 * derails (device hiccup, interleaved noise) the splitter drops bytes until
 * the next signature instead of stalling.
 */
export declare class PngFrameSplitter {
    #private;
    /** Feed bytes; returns every complete PNG that ended inside them. */
    push(chunk: Buffer): Buffer[];
}
export interface FrameLoopEvents {
    onFrame?: (frame: DeviceFrame) => void;
    /** The child exited (code/signal) — restart policy belongs to the caller. */
    onExit?: (detail: string) => void;
}
/**
 * Owns the one persistent screencap child for one device serial and the
 * latest-frame buffer every consumer reads from.
 */
export declare class AdbFrameLoop {
    #private;
    readonly serial: string;
    private readonly toolchain;
    private readonly events;
    constructor(serial: string, toolchain: AdbToolchain, events?: FrameLoopEvents);
    get running(): boolean;
    get latestFrame(): DeviceFrame | undefined;
    get stderrLines(): string[];
    /** Spawn the screencap loop child (idempotent while running). */
    start(): void;
    /** Kill the child; the loop object can be started again later. */
    stop(): void;
    /** Allow a stopped loop to be started again (host restart path). */
    reset(): void;
    /** The next frame (or the latest one already buffered), bounded in time. */
    waitForFrame(timeoutMs: number): Promise<DeviceFrame | undefined>;
}
/**
 * Write one live multipart/x-mixed-replace response from a frame feed.
 * Backpressure is latest-wins: when the client socket is saturated the
 * writer skips frames instead of queueing them, so a slow tab never builds
 * an unbounded buffer or watches a growing delay.
 *
 * Returns an `attach` pair the caller wires to its frame events, and relies
 * on the caller to invoke `close()` on client disconnect/disposal.
 */
export declare class MultipartFrameWriter {
    #private;
    private readonly res;
    constructor(res: ServerResponse);
    get closed(): boolean;
    /** Write one frame part; silently skipped while the socket is congested. */
    writeFrame(frame: DeviceFrame): void;
    close(): void;
}
