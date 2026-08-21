const RELAY_PROTOCOL_VERSION = 1;
const RELAY_AUTHORITY_PEER = Buffer.alloc(8);
const MAX_RELAY_PACKET_BYTES = 64 * 1024;
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const PROJECT_REF = /^project_[A-Za-z0-9_-]{20,64}$/u;
const DEVICE_REF = /^device_[A-Za-z0-9_-]{20,64}$/u;
const ROOM_REF = /^[A-Za-z0-9_-]{43}$/u;
const ROLES = new Set(["authority", "collaborator"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function safeRelayUrl(value) {
  const url = new URL(nonEmptyString(value, "relayUrl", 2_048));
  if (url.protocol !== "wss:" || (url.port && url.port !== "443") || url.username || url.password || url.hash) throw new Error("project relay URL must use credential-free wss:// on port 443");
  return url.toString();
}
function relayPeer(value) {
  const peer = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(nonEmptyString(value, "relay peer", 32), "hex");
  if (peer.length !== 8 || peer.equals(RELAY_AUTHORITY_PEER)) throw new Error("project relay peer is invalid");
  return peer;
}
function packetTarget(packet) {
  if (!isRecord(packet) || packet.transport !== "remote_wss") throw new TypeError("project relay accepts remote_wss secure packets only");
  const target = nonEmptyString(packet.targetDeviceRef, "packet.targetDeviceRef", 128);
  if (!DEVICE_REF.test(target)) throw new TypeError("project relay packet target is invalid");
  return target;
}

export class ProjectWssRelayTransport {
  constructor({ enabled = false, projectRef, role, roomRef, relayUrl, WebSocketImpl, resolveChannel, onDelivery, readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS } = {}) {
    this.enabled = enabled === true;
    this.projectRef = nonEmptyString(projectRef, "projectRef", 128);
    if (!PROJECT_REF.test(this.projectRef)) throw new TypeError("projectRef must be opaque");
    this.role = nonEmptyString(role, "role", 32);
    if (!ROLES.has(this.role)) throw new TypeError("role must be authority or collaborator");
    this.roomRef = nonEmptyString(roomRef, "roomRef", 128);
    if (!ROOM_REF.test(this.roomRef)) throw new TypeError("roomRef must be a 32-byte opaque reference");
    this.relayUrl = safeRelayUrl(relayUrl);
    if (typeof WebSocketImpl !== "function") throw new TypeError("WebSocketImpl must be a constructor");
    if (typeof resolveChannel !== "function") throw new TypeError("resolveChannel must be a function");
    if (typeof onDelivery !== "function") throw new TypeError("onDelivery must be a function");
    if (!Number.isSafeInteger(readyTimeoutMs) || readyTimeoutMs < 1 || readyTimeoutMs > 120_000) throw new TypeError("readyTimeoutMs is invalid");
    this.WebSocketImpl = WebSocketImpl;
    this.resolveChannel = resolveChannel;
    this.onDelivery = onDelivery;
    this.readyTimeoutMs = readyTimeoutMs;
    this.socket = undefined;
    this.status = "stopped";
    this.peerByDevice = new Map();
    this.deviceByPeer = new Map();
    this.deliveryTail = Promise.resolve();
  }

  toJSON() {
    return { version: RELAY_PROTOCOL_VERSION, projectRef: this.projectRef, role: this.role, enabled: this.enabled, status: this.status, connectedPeerCount: this.peerByDevice.size };
  }

  async start() {
    if (!this.enabled) throw new Error("project WSS relay requires an explicit enabled policy");
    if (this.status === "connected") return this.toJSON();
    await this.stop();
    this.status = "connecting";
    const socket = new this.WebSocketImpl(this.relayUrl, { perMessageDeflate: false, handshakeTimeout: this.readyTimeoutMs });
    this.socket = socket;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("project WSS relay connection timed out")), this.readyTimeoutMs);
      timer.unref?.();
      const finish = (error) => {
        clearTimeout(timer);
        socket.off?.("message", onMessage);
        socket.off?.("error", onError);
        socket.off?.("close", onClose);
        if (error) reject(error); else resolve();
      };
      const onError = (error) => finish(error);
      const onClose = () => finish(new Error("project WSS relay closed before welcome"));
      const onMessage = (data, binary) => {
        if (binary) return;
        let message;
        try { message = JSON.parse(String(data)); } catch { return; }
        const expectedRole = this.role === "authority" ? "desktop" : "mobile";
        if (message.type === "welcome" && message.version === RELAY_PROTOCOL_VERSION && message.role === expectedRole) finish();
      };
      socket.once?.("open", () => socket.send(JSON.stringify({ type: "hello", version: RELAY_PROTOCOL_VERSION, role: this.role === "authority" ? "desktop" : "mobile", roomId: this.roomRef })));
      socket.on?.("message", onMessage);
      socket.once?.("error", onError);
      socket.once?.("close", onClose);
    }).catch(async (error) => {
      await this.stop();
      throw error;
    });
    if (this.socket !== socket) throw new Error("project WSS relay start was superseded");
    this.status = "connected";
    socket.on?.("message", (data, binary) => {
      if (binary) this.#handleBinary(Buffer.from(data));
      else this.#handleControl(data);
    });
    socket.once?.("close", () => this.#disconnect());
    socket.once?.("error", () => this.#disconnect());
    return this.toJSON();
  }

  send(packet) {
    if (this.status !== "connected" || this.socket === undefined || this.socket.readyState !== this.WebSocketImpl.OPEN) throw new Error("project WSS relay is not connected");
    const targetDeviceRef = packetTarget(packet);
    const encoded = Buffer.from(JSON.stringify(packet));
    if (encoded.length > MAX_RELAY_PACKET_BYTES) throw new RangeError("project WSS relay packet exceeds the limit");
    let peer;
    if (this.role === "authority") {
      peer = this.peerByDevice.get(targetDeviceRef);
      if (peer === undefined) throw new Error("target project device is not present on the relay");
    } else peer = RELAY_AUTHORITY_PEER;
    const frame = Buffer.concat([peer, encoded]);
    if (this.socket.bufferedAmount > MAX_RELAY_PACKET_BYTES * 16) throw new Error("project WSS relay backpressure limit exceeded");
    this.socket.send(frame, { binary: true });
    return Object.freeze({ queued: true, packetRef: packet.packetRef, targetDeviceRef });
  }

  async stop() {
    const socket = this.socket;
    this.socket = undefined;
    this.status = "stopped";
    this.peerByDevice.clear();
    this.deviceByPeer.clear();
    if (socket !== undefined && socket.readyState < this.WebSocketImpl.CLOSING) socket.close(1000, "project relay stopping");
  }

  #handleBinary(frame) {
    this.deliveryTail = this.deliveryTail.then(() => this.#deliver(frame), () => this.#deliver(frame));
  }

  async #deliver(frame) {
    if (this.status !== "connected" || frame.length <= 8 || frame.length > 8 + MAX_RELAY_PACKET_BYTES) return;
    let sourcePeer;
    try {
      sourcePeer = frame.subarray(0, 8);
      if (this.role === "authority") relayPeer(sourcePeer);
      else if (!sourcePeer.equals(RELAY_AUTHORITY_PEER)) throw new Error("collaborator received a non-authority relay source");
      const packet = JSON.parse(frame.subarray(8).toString("utf8"));
      packetTarget(packet);
      if (packet.projectRef !== this.projectRef) throw new Error("relay packet belongs to another project");
      const channel = this.resolveChannel(packet.targetDeviceRef);
      if (!isRecord(channel) || typeof channel.open !== "function") throw new Error("target project channel is unavailable");
      const opened = channel.open(packet);
      if (this.role === "authority") {
        const peerHex = sourcePeer.toString("hex");
        const priorDevice = this.deviceByPeer.get(peerHex);
        const priorPeer = this.peerByDevice.get(opened.senderDeviceRef);
        if ((priorDevice !== undefined && priorDevice !== opened.senderDeviceRef) || (priorPeer !== undefined && !priorPeer.equals(sourcePeer))) throw new Error("authenticated device changed relay peer binding");
        this.deviceByPeer.set(peerHex, opened.senderDeviceRef);
        this.peerByDevice.set(opened.senderDeviceRef, Buffer.from(sourcePeer));
      }
      await this.onDelivery(opened);
    } catch {
      // The blind relay receives no decryption or admission oracle.
    }
  }

  #handleControl(raw) {
    if (this.role !== "authority") return;
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message.type !== "peer-left") return;
    let peer;
    try { peer = relayPeer(message.peerId); } catch { return; }
    const peerHex = peer.toString("hex");
    const deviceRef = this.deviceByPeer.get(peerHex);
    if (deviceRef !== undefined) this.peerByDevice.delete(deviceRef);
    this.deviceByPeer.delete(peerHex);
  }

  #disconnect() {
    if (this.status === "stopped") return;
    this.socket = undefined;
    this.status = "disconnected";
    this.peerByDevice.clear();
    this.deviceByPeer.clear();
  }
}

export {
  DEFAULT_READY_TIMEOUT_MS,
  MAX_RELAY_PACKET_BYTES,
  RELAY_AUTHORITY_PEER,
  RELAY_PROTOCOL_VERSION,
  safeRelayUrl,
};
