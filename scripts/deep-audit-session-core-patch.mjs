import { createHash } from 'node:crypto';

export const SESSION_CORE_PACKAGE = '@deepseek-ai/dsh-client-ui-conversation';
export const SESSION_CORE_VERSION = '0.1.2-alpha.5';
// Complete source proofs: official, composer visibility, image/queue, and their composition.
// Behavioral BEFORE/AFTER below are unchanged from the accepted core audit.
export const SESSION_CORE_PROOFS = Object.freeze([
  Object.freeze({ profile: 'official', input: '7EE5792B3F15AC1B691EEE7D373869101F8C7D336FC22B3F66D082612E4B1BAE', output: 'B15A5B70AA45D4CD2B8E6943B491AAD1AC5CA28C1921FABEF97C224304B3F14B' }),
  Object.freeze({ profile: 'visibility', input: '6F797EB8E87C07E33B9EF35EAACC0ECA9BC122E04E14D176EA81354FD53358A2', output: 'AD31C94C8DD1C7ABA3AAB3470DA20837682F714C82A2A15182EFBD8C6CC17E94' }),
  Object.freeze({ profile: 'imageQueue', input: 'F74FE0B737247960AFD92416768A6EADC030259700AE91C0E83966C45BC27DC1', output: '81888F259D71D874A2D5D9DBF0412EE8DFD00797CBE5EA46FB69395116287646' }),
  Object.freeze({ profile: 'visibilityImageQueue', input: 'C1D6C06786CB52B51892A162E72D2F9C011FEB7F751E849306F36E63CE5DBE04', output: '30F413CC27BE08F0B57A472440495B033EA8B708E281D465CD5BBE3E45CD0066' }),
]);
const sha256 = source => createHash('sha256').update(source).digest('hex').toUpperCase();
// Maintained exact-source transform; caller owns package/version verification and atomic installation.
// This module performs no I/O and never imports or starts the official client/server.
const BEFORE = '\t\t\t\tdeps.queue?.subscribe(() => {\n\t\t\t\t\tthis.publish();\n\t\t\t\t});';
const AFTER = '\t\t\t\t// dsh-session-core: dispose the session queue subscription with this editor.\n\t\t\t\tthis.unregister = Eu(this.unregister, deps.queue?.subscribe(() => {\n\t\t\t\t\tthis.publish();\n\t\t\t\t}) ?? (() => {}));';
const count = (source, value) => source.split(value).length - 1;
export function transformSessionCoreClientSource(source) {
  if (typeof source !== 'string') throw new TypeError('session-core transform requires source text');
  if (!source.includes('id: "@deepseek-ai/dsh-client-ui-conversation"')) throw new Error('session-core transform: unexpected package');
  const oldCount = count(source, BEFORE), newCount = count(source, AFTER);
  const alreadyPatched = oldCount === 0 && newCount === 1;
  if (!alreadyPatched && (oldCount !== 1 || newCount !== 0)) throw new Error(`session-core transform: unsupported source shape (${oldCount}/${newCount})`);
  const hash = sha256(source);
  const proof = SESSION_CORE_PROOFS.find(item => item[alreadyPatched ? 'output' : 'input'] === hash);
  if (!proof) throw new Error('session-core transform: complete source hash changed; refusing unsafe patch');
  if (alreadyPatched) return { source, changed: false, fixes: ['composer-queue-subscription-disposal'] };
  const output = source.replace(BEFORE, AFTER);
  if (sha256(output) !== proof.output) throw new Error('session-core transform: complete output hash changed');
  return { source: output, changed: true, fixes: ['composer-queue-subscription-disposal'] };
}

// Restore only an exact complete proof for existing native capability/image-queue guards.
// Unknown or marker-only artifacts must never normalize into a trusted upstream hash.
export function restoreSessionCoreClientSource(source) {
  const checked = transformSessionCoreClientSource(source);
  if (checked.changed) return source;
  const proof = SESSION_CORE_PROOFS.find(item => item.output === sha256(source));
  const original = source.replace(AFTER, BEFORE);
  if (!proof || sha256(original) !== proof.input) throw new Error('session-core restore: complete input hash changed');
  return original;
}
