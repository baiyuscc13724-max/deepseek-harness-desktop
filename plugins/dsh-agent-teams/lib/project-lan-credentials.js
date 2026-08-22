import "reflect-metadata";
import { randomBytes, webcrypto } from "node:crypto";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import * as x509 from "@peculiar/x509";
import { assertPrivateBindHost } from "./project-lan-transport.js";

const CREDENTIAL_VERSION = 1;
const CERTIFICATE_LIFETIME_MS = 2 * 365 * 24 * 60 * 60 * 1_000;
const CLOCK_SKEW_MS = 5 * 60 * 1_000;
const KEY_ALGORITHM = Object.freeze({
  name: "ECDSA",
  namedCurve: "P-256",
  hash: "SHA-256",
});

x509.cryptoProvider.set(webcrypto);

function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

function pemPrivateKey(buffer) {
  const body = Buffer.from(buffer).toString("base64").match(/.{1,64}/gu)?.join("\n") ?? "";
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

function serialNumber() {
  const value = randomBytes(16);
  value[0] &= 0x7f;
  if (value.every((byte) => byte === 0)) value[value.length - 1] = 1;
  return value.toString("hex");
}

function certificateName(kind, reference) {
  const suffix = nonEmptyString(reference, "reference", 256).replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 48) || "device";
  return `CN=Harness ${kind} ${suffix}`;
}

function certificateWindow(now = Date.now()) {
  const value = Number(now);
  if (!Number.isFinite(value) || value < 0) throw new TypeError("now must be a valid timestamp");
  return {
    notBefore: new Date(value - CLOCK_SKEW_MS),
    notAfter: new Date(value + CERTIFICATE_LIFETIME_MS),
  };
}

async function generateKeys() {
  return webcrypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
}

async function exportKey(key) {
  return pemPrivateKey(await webcrypto.subtle.exportKey("pkcs8", key));
}

async function importSigningKey(pem, field) {
  const value = nonEmptyString(pem, field, 64 * 1024);
  const decoded = x509.PemConverter.decode(value);
  if (!Array.isArray(decoded) || decoded.length !== 1) throw new TypeError(`${field} must contain one PKCS#8 private key`);
  return webcrypto.subtle.importKey("pkcs8", decoded[0], KEY_ALGORITHM, false, ["sign"]);
}

function privateLanHosts(interfaces = networkInterfaces()) {
  const hosts = new Set(["127.0.0.1", "::1"]);
  for (const rows of Object.values(interfaces || {})) {
    for (const row of rows || []) {
      if (row?.internal === true || typeof row?.address !== "string" || isIP(row.address) === 0) continue;
      try { hosts.add(assertPrivateBindHost(row.address)); } catch {}
    }
  }
  return [...hosts].sort((left, right) => {
    const score = (host) => host === "127.0.0.1" ? 20 : host === "::1" ? 30 : isIP(host) === 4 ? 0 : 10;
    return score(left) - score(right) || left.localeCompare(right);
  });
}

function preferredLanHost(interfaces) {
  return privateLanHosts(interfaces).find((host) => host !== "127.0.0.1" && host !== "::1") ?? "127.0.0.1";
}

async function createProjectLanAuthorityCredentials({ projectRef, hosts = privateLanHosts(), now = Date.now() } = {}) {
  const normalizedHosts = [...new Set(hosts.map(assertPrivateBindHost))];
  if (normalizedHosts.length === 0) normalizedHosts.push("127.0.0.1");
  const caKeys = await generateKeys();
  const serverKeys = await generateKeys();
  const window = certificateWindow(now);
  const ca = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serialNumber(),
    name: certificateName("Project CA", projectRef),
    ...window,
    signingAlgorithm: KEY_ALGORITHM,
    keys: caKeys,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(caKeys.publicKey, false, webcrypto),
    ],
  }, webcrypto);
  const server = await x509.X509CertificateGenerator.create({
    serialNumber: serialNumber(),
    subject: certificateName("LAN Server", projectRef),
    issuer: ca.subject,
    ...window,
    signingAlgorithm: KEY_ALGORITHM,
    publicKey: serverKeys.publicKey,
    signingKey: caKeys.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth], true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.SubjectAlternativeNameExtension(normalizedHosts.map((value) => ({ type: x509.IP, value })), false),
      await x509.SubjectKeyIdentifierExtension.create(serverKeys.publicKey, false, webcrypto),
    ],
  }, webcrypto);
  return {
    version: CREDENTIAL_VERSION,
    projectRef: nonEmptyString(projectRef, "projectRef", 256),
    hosts: normalizedHosts,
    caCert: ca.toString("pem"),
    caPrivateKey: await exportKey(caKeys.privateKey),
    serverCert: server.toString("pem"),
    serverPrivateKey: await exportKey(serverKeys.privateKey),
    createdAt: new Date(now).toISOString(),
    expiresAt: window.notAfter.toISOString(),
  };
}

async function refreshProjectLanServerCredentials(authority, { hosts = privateLanHosts(), now = Date.now() } = {}) {
  if (authority?.version !== CREDENTIAL_VERSION || typeof authority?.caCert !== "string" || typeof authority?.caPrivateKey !== "string") throw new TypeError("authority LAN credentials are invalid");
  const projectRef = nonEmptyString(authority.projectRef, "authority.projectRef", 256);
  const normalizedHosts = [...new Set(hosts.map(assertPrivateBindHost))];
  if (normalizedHosts.length === 0) normalizedHosts.push("127.0.0.1");
  const ca = new x509.X509Certificate(authority.caCert);
  const caPrivateKey = await importSigningKey(authority.caPrivateKey, "authority.caPrivateKey");
  const serverKeys = await generateKeys();
  const window = certificateWindow(now);
  const server = await x509.X509CertificateGenerator.create({
    serialNumber: serialNumber(),
    subject: certificateName("LAN Server", projectRef),
    issuer: ca.subject,
    ...window,
    signingAlgorithm: KEY_ALGORITHM,
    publicKey: serverKeys.publicKey,
    signingKey: caPrivateKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth], true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.SubjectAlternativeNameExtension(normalizedHosts.map((value) => ({ type: x509.IP, value })), false),
      await x509.SubjectKeyIdentifierExtension.create(serverKeys.publicKey, false, webcrypto),
    ],
  }, webcrypto);
  return {
    ...authority,
    hosts: normalizedHosts,
    serverCert: server.toString("pem"),
    serverPrivateKey: await exportKey(serverKeys.privateKey),
    serverIssuedAt: new Date(now).toISOString(),
    serverExpiresAt: window.notAfter.toISOString(),
  };
}

async function createProjectLanClientCredentials(authority, { deviceRef, now = Date.now() } = {}) {
  if (authority?.version !== CREDENTIAL_VERSION || typeof authority?.caCert !== "string" || typeof authority?.caPrivateKey !== "string") throw new TypeError("authority LAN credentials are invalid");
  const ca = new x509.X509Certificate(authority.caCert);
  const caPrivateKey = await importSigningKey(authority.caPrivateKey, "authority.caPrivateKey");
  const clientKeys = await generateKeys();
  const window = certificateWindow(now);
  const client = await x509.X509CertificateGenerator.create({
    serialNumber: serialNumber(),
    subject: certificateName("LAN Client", deviceRef),
    issuer: ca.subject,
    ...window,
    signingAlgorithm: KEY_ALGORITHM,
    publicKey: clientKeys.publicKey,
    signingKey: caPrivateKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth], true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      await x509.SubjectKeyIdentifierExtension.create(clientKeys.publicKey, false, webcrypto),
    ],
  }, webcrypto);
  return {
    version: CREDENTIAL_VERSION,
    cert: client.toString("pem"),
    key: await exportKey(clientKeys.privateKey),
    ca: authority.caCert,
    expiresAt: window.notAfter.toISOString(),
  };
}

export {
  CREDENTIAL_VERSION,
  createProjectLanAuthorityCredentials,
  createProjectLanClientCredentials,
  refreshProjectLanServerCredentials,
  preferredLanHost,
  privateLanHosts,
};
