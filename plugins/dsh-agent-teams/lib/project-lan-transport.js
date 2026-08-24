import { createHash } from "node:crypto";
import { isIP } from "node:net";
import * as nodeTls from "node:tls";

const LAN_PROTOCOL = "dsh-project/1";
const DEFAULT_MAX_FRAME_BYTES = 512 * 1024;
const DEFAULT_MAX_CONNECTIONS = 32;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const ENDPOINT_REF = /^endpoint_[A-Za-z0-9_-]{20,64}$/u;
const DEVICE_REF = /^device_[A-Za-z0-9_-]{20,64}$/u;
const CERT_REF = /^cert_[A-Za-z0-9_-]{43}$/u;

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function positiveInteger(value, field, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError(`${field} must be an integer from 1 through ${maximum}`);
  return value;
}
function portNumber(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) throw new TypeError("port must be an integer from 0 through 65535");
  return value;
}
function assertPrivateBindHost(value) {
  const host = nonEmptyString(value, "host", 128).toLowerCase();
  const version = isIP(host);
  if (version === 4) {
    const parts = host.split(".").map(Number);
    const allowed = parts[0] === 127 || parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254);
    if (!allowed) throw new Error("LAN project transport must bind an explicit loopback, private, or link-local address");
  } else if (version === 6) {
    const allowed = host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb");
    if (!allowed) throw new Error("LAN project transport must bind an explicit loopback, private, or link-local address");
  } else throw new Error("LAN project transport host must be an IP literal, not a wildcard or DNS name");
  return host;
}
function credential(value, field) {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (Buffer.isBuffer(value) && value.length > 0) return value;
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" || Buffer.isBuffer(item))) return value;
  throw new TypeError(`${field} is required for mutual TLS`);
}
function safeCertificateRef(certificate) {
  if (!isRecord(certificate)) throw new Error("mTLS peer certificate is unavailable");
  const material = Buffer.isBuffer(certificate.raw) && certificate.raw.length > 0
    ? certificate.raw
    : Buffer.from(nonEmptyString(certificate.fingerprint256, "peer certificate fingerprint", 256));
  return `cert_${createHash("sha256").update(material).digest("base64url")}`;
}
function packetTarget(packet) {
  if (!isRecord(packet) || packet.transport !== "lan_mtls") throw new TypeError("LAN transport accepts lan_mtls secure packets only");
  const target = nonEmptyString(packet.targetDeviceRef, "packet.targetDeviceRef", 128);
  if (!DEVICE_REF.test(target)) throw new TypeError("packet target is not opaque");
  return target;
}
function encodePacket(packet, maxFrameBytes) {
  const targetDeviceRef = packetTarget(packet);
  const encoded = Buffer.from(JSON.stringify(packet));
  if (encoded.length > maxFrameBytes) throw new RangeError("LAN project packet exceeds the frame limit");
  return { targetDeviceRef, frame: Buffer.concat([encoded, Buffer.from("\n")]) };
}
function writeBounded(socket, frame, maxBufferedBytes) {
  if (socket?.destroyed === true || socket?.writable === false) throw new Error("LAN project connection is unavailable");
  if (Number(socket.writableLength ?? 0) + frame.length > maxBufferedBytes) throw new Error("LAN project backpressure limit exceeded");
  socket.write(frame);
}
function safeAck(socket, packetRef, maxBufferedBytes) {
  try { writeBounded(socket, Buffer.from(`${JSON.stringify({ ok: true, packetRef, status: "delivered" })}\n`, "utf8"), maxBufferedBytes); }
  catch { socket.destroy?.(); }
}
function installFrameReader(socket, { maxFrameBytes, onFrame }) {
  let buffer = Buffer.alloc(0);
  let closed = false;
  const clear = () => { closed = true; buffer.fill(0); buffer = Buffer.alloc(0); };
  socket.once?.("close", clear);
  socket.once?.("error", clear);
  socket.on?.("data", (chunk) => {
    if (closed) return;
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < incoming.length) {
      const newline = incoming.indexOf(0x0a, offset);
      const end = newline < 0 ? incoming.length : newline;
      const segmentLength = end - offset;
      if (buffer.length + segmentLength > maxFrameBytes) { clear(); socket.destroy?.(); return; }
      if (segmentLength > 0) {
        const combined = Buffer.concat([buffer, incoming.subarray(offset, end)]);
        buffer.fill(0);
        buffer = combined;
      }
      if (newline < 0) return;
      const frame = buffer;
      buffer = Buffer.alloc(0);
      if (frame.length > 0) {
        try { onFrame(frame); }
        catch { socket.destroy?.(); }
        finally { frame.fill(0); }
        if (socket.destroyed) return;
      }
      offset = newline + 1;
    }
  });
  return clear;
}

export class LanProjectTransport {
  constructor({ enabled = false, endpointRef, host = "127.0.0.1", port = 0, cert, key, ca, resolveChannel, onDelivery, tlsModule = nodeTls, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES, maxConnections = DEFAULT_MAX_CONNECTIONS, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES } = {}) {
    this.enabled = enabled === true;
    this.endpointRef = nonEmptyString(endpointRef, "endpointRef", 128);
    if (!ENDPOINT_REF.test(this.endpointRef)) throw new TypeError("endpointRef must be an opaque endpoint reference");
    this.host = assertPrivateBindHost(host);
    this.port = portNumber(port);
    this.cert = credential(cert, "cert"); this.key = credential(key, "key"); this.ca = credential(ca, "ca");
    if (typeof resolveChannel !== "function" || typeof onDelivery !== "function") throw new TypeError("resolveChannel and onDelivery must be functions");
    if (!isRecord(tlsModule) || typeof tlsModule.createServer !== "function") throw new TypeError("tlsModule must provide createServer");
    this.resolveChannel = resolveChannel; this.onDelivery = onDelivery; this.tlsModule = tlsModule;
    this.maxFrameBytes = positiveInteger(maxFrameBytes, "maxFrameBytes", 4 * 1024 * 1024);
    this.maxConnections = positiveInteger(maxConnections, "maxConnections", 1_000);
    this.idleTimeoutMs = positiveInteger(idleTimeoutMs, "idleTimeoutMs", 10 * 60 * 1_000);
    this.maxBufferedBytes = positiveInteger(maxBufferedBytes, "maxBufferedBytes", 64 * 1024 * 1024);
    this.server = undefined; this.sockets = new Set(); this.socketByDevice = new Map(); this.deviceBySocket = new Map(); this.certificateByDevice = new Map();
    this.boundPort = undefined; this.stopPromise = undefined;
  }
  toJSON() { return { listening: this.server !== undefined, connectionCount: this.socketByDevice.size }; }
  canSend(targetDeviceRef) { return DEVICE_REF.test(String(targetDeviceRef)) && this.socketByDevice.get(targetDeviceRef)?.destroyed !== true; }
  async start() {
    if (!this.enabled) throw new Error("LAN project transport requires an explicit enabled policy");
    if (this.server !== undefined) return this.toJSON();
    this.stopPromise = undefined;
    const server = this.tlsModule.createServer({ cert: this.cert, key: this.key, ca: this.ca, requestCert: true, rejectUnauthorized: true, minVersion: "TLSv1.3", ALPNProtocols: [LAN_PROTOCOL], honorCipherOrder: true }, (socket) => this.#accept(socket));
    this.server = server; server.on?.("tlsClientError", () => undefined); server.on?.("error", () => undefined);
    await new Promise((resolve, reject) => {
      const cleanup = () => { server.off?.("error", onError); server.off?.("listening", onListening); };
      const onError = (error) => { cleanup(); reject(error); }; const onListening = () => { cleanup(); resolve(); };
      server.once?.("error", onError); server.once?.("listening", onListening);
      try { server.listen({ host: this.host, port: this.port, exclusive: true }); } catch (error) { cleanup(); reject(error); }
    }).catch((error) => { this.server = undefined; try { server.close?.(); } catch {} throw error; });
    const address = server.address?.(); this.boundPort = isRecord(address) && Number.isSafeInteger(address.port) ? address.port : this.port;
    return this.toJSON();
  }
  send(packet) {
    const { targetDeviceRef, frame } = encodePacket(packet, this.maxFrameBytes);
    const socket = this.socketByDevice.get(targetDeviceRef);
    if (socket === undefined) { frame.fill(0); throw new Error("target project device has no authenticated LAN connection"); }
    try { writeBounded(socket, frame, this.maxBufferedBytes); return Object.freeze({ queued: true, packetRef: packet.packetRef, targetDeviceRef }); }
    finally { frame.fill(0); }
  }
  stop() {
    if (this.stopPromise !== undefined) return this.stopPromise;
    const server = this.server; this.server = undefined; this.boundPort = undefined;
    for (const socket of this.sockets) socket.destroy?.();
    this.sockets.clear(); this.socketByDevice.clear(); this.deviceBySocket.clear(); this.certificateByDevice.clear();
    this.stopPromise = new Promise((resolve) => {
      if (server === undefined) return resolve();
      try { server.close?.(() => resolve()); } catch { resolve(); }
    });
    return this.stopPromise;
  }
  #accept(socket) {
    if (this.server === undefined || this.sockets.size >= this.maxConnections || socket?.authorized !== true || socket.alpnProtocol !== LAN_PROTOCOL) { socket?.destroy?.(); return; }
    let certificateRef;
    try { certificateRef = safeCertificateRef(socket.getPeerCertificate?.(true)); } catch { socket.destroy?.(); return; }
    const tlsPeer = Object.freeze({ certificateRef, authorized: true, protocol: LAN_PROTOCOL });
    this.sockets.add(socket);
    const close = () => {
      this.sockets.delete(socket);
      const deviceRef = this.deviceBySocket.get(socket);
      if (deviceRef !== undefined && this.socketByDevice.get(deviceRef) === socket) this.socketByDevice.delete(deviceRef);
      this.deviceBySocket.delete(socket);
    };
    socket.once?.("close", close); socket.once?.("error", close); socket.setTimeout?.(this.idleTimeoutMs, () => socket.destroy?.());
    installFrameReader(socket, { maxFrameBytes: this.maxFrameBytes, onFrame: (frame) => this.#deliverFrame(socket, frame, tlsPeer) });
  }
  #deliverFrame(socket, frame, tlsPeer) {
    const message = JSON.parse(frame.toString("utf8"));
    if (isRecord(message) && message.ok === true && typeof message.packetRef === "string") { this.lastAcknowledgment = Object.freeze({ packetRef: message.packetRef, status: message.status }); return; }
    const targetDeviceRef = packetTarget(message);
    const channel = this.resolveChannel(targetDeviceRef);
    if (!isRecord(channel) || typeof channel.open !== "function") throw new Error("target secure channel is unavailable");
    const opened = channel.open(message, { tlsPeer });
    const priorDevice = this.deviceBySocket.get(socket);
    const priorSocket = this.socketByDevice.get(opened.senderDeviceRef);
    const priorCertificate = this.certificateByDevice.get(opened.senderDeviceRef);
    if ((priorDevice !== undefined && priorDevice !== opened.senderDeviceRef)
      || (priorSocket !== undefined && priorSocket !== socket && priorSocket.destroyed !== true)
      || (priorCertificate !== undefined && priorCertificate !== tlsPeer.certificateRef)) throw new Error("authenticated device changed LAN socket or certificate binding");
    this.deviceBySocket.set(socket, opened.senderDeviceRef); this.socketByDevice.set(opened.senderDeviceRef, socket); this.certificateByDevice.set(opened.senderDeviceRef, tlsPeer.certificateRef);
    try {
      const result = this.onDelivery(opened);
      if (result !== null && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") Promise.resolve(result).catch(() => undefined);
    } catch {}
    safeAck(socket, opened.packetRef, this.maxBufferedBytes);
  }
}

export class PersistentLanProjectClient {
  constructor({ host, port, cert, key, ca, serverCertificateRef, resolveChannel, onDelivery, tlsModule = nodeTls, scheduler = setTimeout, cancelScheduler = clearTimeout, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES, maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES, reconnectBaseMs = 1_000, reconnectMaxMs = 30_000 } = {}) {
    this.host = assertPrivateBindHost(host); this.port = portNumber(port); if (this.port < 1) throw new TypeError("port must be from 1 through 65535");
    this.cert = credential(cert, "cert"); this.key = credential(key, "key"); this.ca = credential(ca, "ca");
    this.serverCertificateRef = nonEmptyString(serverCertificateRef, "serverCertificateRef", 128); if (!CERT_REF.test(this.serverCertificateRef)) throw new TypeError("serverCertificateRef must be opaque");
    if (typeof resolveChannel !== "function" || typeof onDelivery !== "function") throw new TypeError("resolveChannel and onDelivery must be functions");
    if (!isRecord(tlsModule) || typeof tlsModule.connect !== "function") throw new TypeError("tlsModule must provide connect");
    if (typeof scheduler !== "function" || typeof cancelScheduler !== "function") throw new TypeError("scheduler adapters must be functions");
    this.resolveChannel = resolveChannel; this.onDelivery = onDelivery; this.tlsModule = tlsModule; this.scheduler = scheduler; this.cancelScheduler = cancelScheduler;
    this.maxFrameBytes = positiveInteger(maxFrameBytes, "maxFrameBytes", 4 * 1024 * 1024); this.maxBufferedBytes = positiveInteger(maxBufferedBytes, "maxBufferedBytes", 64 * 1024 * 1024);
    this.reconnectBaseMs = positiveInteger(reconnectBaseMs, "reconnectBaseMs", 30_000); this.reconnectMaxMs = positiveInteger(reconnectMaxMs, "reconnectMaxMs", 30_000);
    this.socket = undefined; this.status = "stopped"; this.stopping = false; this.reconnectAttempt = 0; this.reconnectTimer = undefined; this.stopPromise = undefined;
  }
  toJSON() { return { connected: this.status === "connected", reconnecting: this.status === "reconnecting" }; }
  canSend() { return this.status === "connected" && this.socket?.destroyed !== true && this.socket?.writable !== false; }
  async start() {
    if (this.status === "connected") return this.toJSON();
    this.stopping = false; this.stopPromise = undefined;
    await this.#connect(); return this.toJSON();
  }
  send(packet) {
    const { targetDeviceRef, frame } = encodePacket(packet, this.maxFrameBytes);
    if (!this.canSend()) { frame.fill(0); throw new Error("LAN project client is unavailable"); }
    try { writeBounded(this.socket, frame, this.maxBufferedBytes); return Object.freeze({ queued: true, packetRef: packet.packetRef, targetDeviceRef }); }
    finally { frame.fill(0); }
  }
  stop() {
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.stopping = true; this.status = "stopped";
    if (this.reconnectTimer !== undefined) { this.cancelScheduler(this.reconnectTimer); this.reconnectTimer = undefined; }
    const socket = this.socket; this.socket = undefined; this.tlsPeer = undefined;
    this.stopPromise = Promise.resolve().then(() => { socket?.end?.(); socket?.destroy?.(); });
    return this.stopPromise;
  }
  async #connect() {
    this.status = "connecting";
    const socket = this.tlsModule.connect({ host: this.host, port: this.port, cert: this.cert, key: this.key, ca: this.ca, rejectUnauthorized: true, minVersion: "TLSv1.3", ALPNProtocols: [LAN_PROTOCOL] });
    this.socket = socket;
    await new Promise((resolve, reject) => {
      const onSecure = () => {
        let certificateRef;
        try { certificateRef = safeCertificateRef(socket.getPeerCertificate?.(true)); } catch (error) { return finish(error); }
        if (socket.authorized !== true || socket.alpnProtocol !== LAN_PROTOCOL || certificateRef !== this.serverCertificateRef) return finish(new Error("LAN project mTLS server identity or ALPN was rejected"));
        this.tlsPeer = Object.freeze({ certificateRef, authorized: true, protocol: LAN_PROTOCOL });
        finish();
      };
      const onError = (error) => finish(error);
      const finish = (error) => { socket.off?.("secureConnect", onSecure); socket.off?.("error", onError); if (error) reject(error); else resolve(); };
      socket.once?.("secureConnect", onSecure); socket.once?.("error", onError);
    }).catch((error) => { socket.destroy?.(); if (this.socket === socket) this.socket = undefined; this.status = "disconnected"; throw error; });
    if (this.stopping || this.socket !== socket) { socket.destroy?.(); throw new Error("LAN project client start was superseded"); }
    this.status = "connected"; this.reconnectAttempt = 0;
    installFrameReader(socket, { maxFrameBytes: this.maxFrameBytes, onFrame: (frame) => this.#deliverFrame(socket, frame) });
    const disconnected = () => this.#disconnected(socket);
    socket.once?.("close", disconnected); socket.once?.("error", disconnected);
  }
  #deliverFrame(socket, frame) {
    const message = JSON.parse(frame.toString("utf8"));
    if (isRecord(message) && message.ok === true && typeof message.packetRef === "string") { this.lastAcknowledgment = Object.freeze({ packetRef: message.packetRef, status: message.status }); return; }
    const targetDeviceRef = packetTarget(message);
    const channel = this.resolveChannel(targetDeviceRef);
    if (!isRecord(channel) || typeof channel.open !== "function") throw new Error("target secure channel is unavailable");
    const opened = channel.open(message, { tlsPeer: this.tlsPeer });
    try {
      const result = this.onDelivery(opened);
      if (result !== null && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") Promise.resolve(result).catch(() => undefined);
    } catch {}
    safeAck(socket, opened.packetRef, this.maxBufferedBytes);
  }
  #disconnected(socket) {
    if (this.socket !== socket) return;
    const priorStatus = this.status;
    this.socket = undefined; this.tlsPeer = undefined;
    if (this.stopping) { this.status = "stopped"; return; }
    if (priorStatus === "connecting") { this.status = "disconnected"; return; }
    this.status = "reconnecting";
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * (2 ** Math.min(this.reconnectAttempt, 10)));
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.scheduler(() => {
      this.reconnectTimer = undefined;
      if (this.stopping) return;
      this.#connect().catch(() => { if (!this.stopping && this.status !== "reconnecting") this.#disconnected(this.socket); });
    }, delay);
    this.reconnectTimer?.unref?.();
  }
}

export { assertPrivateBindHost, DEFAULT_IDLE_TIMEOUT_MS, DEFAULT_MAX_BUFFERED_BYTES, DEFAULT_MAX_CONNECTIONS, DEFAULT_MAX_FRAME_BYTES, LAN_PROTOCOL, safeCertificateRef };
