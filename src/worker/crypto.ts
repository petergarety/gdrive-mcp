/**
 * Cryptographically-random hex token helpers. Used for user IDs, session
 * tokens, OAuth state nonces, and API keys.
 *
 * Worker runtime uses the Web Crypto `globalThis.crypto`.
 */

function randomHex(byteLength: number): string {
  const array = new Uint8Array(byteLength);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 16-byte (32-char hex) user identifier. */
export function generateUserId(): string {
  return randomHex(16);
}

/** 32-byte (64-char hex) opaque token — sessions, OAuth state, API keys. */
export function generateSecureToken(): string {
  return randomHex(32);
}
