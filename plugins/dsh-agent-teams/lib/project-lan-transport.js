import { createHash } from "node:crypto";
import { isIP } from "node:net";
import * as nodeTls from "node:tls";

const LAN_PROTOCOL = "dsh-project/1";
const DEFAULT_MAX_FRAME_BYTES = 512 * 1024;
const DEFAULT_MAX_CONNECTIONS = 32;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const ENDPOINT_REF = /^endpoint_[A-Za-z0-9_-]{20,64}$/u;
const DEVICE_REF = /^device_[A-Za-z0-9_-]{20,64}$/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
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
function rejectFrame(socket) {
  if (!socket.destroyed && socket.writable !== false) socket.write(`${JSON.stringify({ ok: false, code: "REJECTED" })}\n`);
}

export class LanProjectTransport {
  constructor({ enabled = false, endpointRef, host = "127.0.0.1", port = 0, cert, key, ca, resolveChannel, onDelivery, tlsModule = nodeTls, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES, maxConnections = DEFAULT_MAX_CONNECTIONS, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = {}) {
    this.enabled = enabled === true;
    this.endpointRef = nonEmptyString(endpointRef, "endpointRef", 128);
    if (!ENDPOINT_REF.test(this.endpointRef)) throw new TypeError("endpointRef must be an opaque endpoint reference");
    this.host = assertPrivateBindHost(host);
    this.port = portNumber(port);
    this.cert = credential(cert, "cert");
    this.key = credential(key, "key");
    this.ca = credential(ca, "ca");
    if (typeof resolveChannel !== "function") throw new TypeError("resolveChannel must be a function");
    if (typeof onDelivery !== "function") throw new TypeError("onDelivery must be a function");
    if (!isRecord(tlsModule) || typeof tlsModule.createServer !== "function") throw new TypeError("tlsModule must provide createServer");
    this.resolveChannel = resolveChannel;
    this.onDelivery = onDelivery;
    this.tlsModule = tlsModule;
    this.maxFrameBytes = positiveInteger(maxFrameBytes, "maxFrameBytes", 4 * 1024 * 1024);
    this.maxConnections = positiveInteger(maxConnections, "maxConnections", 1_000);
    this.idleTimeoutMs = positiveInteger(idleTimeoutMs, "idleTimeoutMs", 10 * 60 * 1_000);
    this.server = undefined;
    this.sockets = new Set();
    this.boundPort = undefined;
  }

  toJSON() {
    return { endpointRef: this.endpointRef, enabled: this.enabled, listening: this.server !== undefined, connectionCount: this.sockets.size };
  }

  async start() {
    if (!this.enabled) throw new Error("LAN project transport requires an explicit enabled policy");
    if (this.server !== undefined) return this.toJSON();
    const server = this.tlsModule.createServer({
      cert: this.cert,
      key: this.key,
      ca: this.ca,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      ALPNProtocols: [LAN_PROTOCOL],
      honorCipherOrder: true,
    }, (socket) => this.#accept(socket));
    this.server = server;
    server.on?.("tlsClientError", () => undefined);
    server.on?.("error", () => undefined);
    await new Promise((resolve, reject) => {
      const onError = (error) => { cleanup(); reject(error); };
      const onListening = () => { cleanup(); resolve(); };
      const cleanup = () => {
        server.off?.("error", onError);
        server.off?.("listening", onListening);
      };
      server.once?.("error", onError);
      server.once?.("listening", onListening);
      try { server.listen({ host: this.host, port: this.port, exclusive: true }); }
      catch (error) { cleanup(); reject(error); }
    }).catch((error) => {
      this.server = undefined;
      try { server.close?.(); } catch {}
      throw error;
    });
    const address = server.address?.();
    this.boundPort = isRecord(address) && Number.isSafeInteger(address.port) ? address.port : this.port;
    return this.toJSON();
  }

  async stop() {
    const server = this.server;
    this.server = undefined;
    this.boundPort = undefined;
    for (const socket of this.sockets) socket.destroy?.();
    this.sockets.clear();
    if (server === undefined) return;
    await new Promise((resolve) => {
      try { server.close?.(() => resolve()); }
      catch { resolve(); }
    });
  }

  #accept(socket) {
    if (this.server === undefined || this.sockets.size >= this.maxConnections || socket?.authorized !== true || socket.alpnProtocol !== LAN_PROTOCOL) {
      socket?.destroy?.();
      return;
    }
    let certificateRef;
    try { certificateRef = safeCertificateRef(socket.getPeerCertificate?.(true)); }
    catch { socket.destroy?.(); return; }
    const tlsPeer = Object.freeze({ certificateRef, authorized: true, protocol: LAN_PROTOCOL });
    this.sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let tail = Promise.resolve();
    const close = () => this.sockets.delete(socket);
    socket.once?.("close", close);
    socket.once?.("error", close);
    socket.setTimeout?.(this.idleTimeoutMs, () => socket.destroy?.());
    socket.on?.("data", (chunk) => {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffer = Buffer.concat([buffer, incoming]);
      if (buffer.length > this.maxFrameBytes) { rejectFrame(socket); socket.destroy?.(); return; }
      for (;;) {
        const newline = buffer.indexOf(0x0a);
        if (newline < 0) break;
        const frame = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);
        if (frame.length === 0) continue;
        if (frame.length > this.maxFrameBytes) { rejectFrame(socket); socket.destroy?.(); return; }
        tail = tail.then(() => this.#deliverFrame(socket, frame, tlsPeer), () => this.#deliverFrame(socket, frame, tlsPeer));
      }
    });
  }

  async #deliverFrame(socket, frame, tlsPeer) {
    if (socket.destroyed) return;
    try {
      const packet = JSON.parse(frame.toString("utf8"));
      if (!isRecord(packet)) throw new TypeError("packet frame must be an object");
      const targetDeviceRef = nonEmptyString(packet.targetDeviceRef, "packet.targetDeviceRef", 128);
      if (!DEVICE_REF.test(targetDeviceRef)) throw new TypeError("packet target is not opaque");
      const channel = this.resolveChannel(targetDeviceRef);
      if (!isRecord(channel) || typeof channel.open !== "function") throw new Error("target secure channel is unavailable");
      const opened = channel.open(packet, { tlsPeer });
      await this.onDelivery(opened);
      if (!socket.destroyed && socket.writable !== false) socket.write(`${JSON.stringify({ ok: true, packetRef: opened.packetRef, status: "delivered" })}\n`);
    } catch {
      rejectFrame(socket);
    }
  }
}

export {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_MAX_FRAME_BYTES,
  LAN_PROTOCOL,
};
