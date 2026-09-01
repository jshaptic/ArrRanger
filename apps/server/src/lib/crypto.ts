import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const ALGORITHM = 'aes-256-gcm';
const KEY_SALT = 'arrranger.v1';
const BLOB_VERSION = 'v1';

/** Stretch the configured secret into a 32-byte AES key. */
export function deriveKey(secret: string): Buffer {
  return scryptSync(secret, KEY_SALT, 32);
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    BLOB_VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptSecret(key: Buffer, blob: string): string {
  const [version, iv, tag, ciphertext] = blob.split(':');
  if (version !== BLOB_VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Malformed secret blob');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Prefer ARRRANGER_SECRET; otherwise persist a generated key next to the database.
 *
 * This protects against a stray `cat arrranger.db` leaking API keys. It is not
 * protection against someone holding both the /config volume and the environment.
 */
export function resolveSecret(envSecret: string | undefined, keyFile: string): string {
  const fromEnv = envSecret?.trim();
  if (fromEnv) return fromEnv;

  if (existsSync(keyFile)) {
    const existing = readFileSync(keyFile, 'utf8').trim();
    if (existing) return existing;
  }

  const generated = randomBytes(48).toString('base64');
  writeFileSync(keyFile, `${generated}\n`, { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  return generated;
}
