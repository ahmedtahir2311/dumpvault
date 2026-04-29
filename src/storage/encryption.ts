import {
  type CipherGCM,
  type DecipherGCM,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { Transform, type TransformCallback } from 'node:stream';
import { ConfigError } from '../errors.ts';

/**
 * Encrypted dump file format (v1):
 *
 *   [magic: 8 bytes ASCII "DVENC001"]
 *   [nonce: 12 bytes (GCM standard)]
 *   [ciphertext: variable]
 *   [auth tag: 16 bytes (GCM trailer)]
 *
 * The magic is version-stamped — a future v2 algorithm change can use "DVENC002".
 */

export const MAGIC = Buffer.from('DVENC001', 'utf8');
export const MAGIC_SIZE = MAGIC.length; // 8
export const NONCE_SIZE = 12;
export const AUTH_TAG_SIZE = 16;
export const HEADER_SIZE = MAGIC_SIZE + NONCE_SIZE; // 20
export const ENCRYPTED_EXTENSION = '.enc';

export function generateKeyBase64(): string {
  return randomBytes(32).toString('base64');
}

/** Load + validate a base64-encoded 32-byte key. Refuses group/world-readable files. */
export function loadKey(keyFilePath: string): Buffer {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(keyFilePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`could not read key file ${keyFilePath}: ${msg}`);
  }

  // Refuse if anyone other than the owner can read.
  const groupReadable = (stat.mode & 0o040) !== 0;
  const worldReadable = (stat.mode & 0o004) !== 0;
  if (groupReadable || worldReadable) {
    throw new ConfigError(
      `key file ${keyFilePath} is group/world-readable. Run: chmod 600 ${keyFilePath}`,
    );
  }

  let content: string;
  try {
    content = readFileSync(keyFilePath, 'utf8').trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`could not read key file ${keyFilePath}: ${msg}`);
  }
  if (content === '') {
    throw new ConfigError(`key file ${keyFilePath} is empty`);
  }

  let key: Buffer;
  try {
    key = Buffer.from(content, 'base64');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`key file ${keyFilePath} is not valid base64: ${msg}`);
  }
  if (key.length !== 32) {
    throw new ConfigError(
      `key file ${keyFilePath} must decode to exactly 32 bytes (got ${key.length}). ` +
        `Generate a fresh key with: dumpvault keygen --out ${keyFilePath}`,
    );
  }
  return key;
}

/**
 * Streaming AES-256-GCM encryptor. Emits the magic + random nonce as the first
 * chunk, encrypted ciphertext as data flows, and the auth tag as the trailer.
 */
export class Encryptor extends Transform {
  private readonly cipher: CipherGCM;
  private readonly nonce: Buffer;
  private headerWritten = false;

  constructor(key: Buffer) {
    super();
    if (key.length !== 32) {
      throw new ConfigError(`encryption key must be 32 bytes, got ${key.length}`);
    }
    this.nonce = randomBytes(NONCE_SIZE);
    this.cipher = createCipheriv('aes-256-gcm', key, this.nonce);
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    try {
      if (!this.headerWritten) {
        this.push(Buffer.concat([MAGIC, this.nonce]));
        this.headerWritten = true;
      }
      cb(null, this.cipher.update(chunk));
    } catch (err) {
      cb(err as Error);
    }
  }

  override _flush(cb: TransformCallback): void {
    try {
      // Some implementations emit empty headers if no data — make sure we don't write a corrupt file.
      if (!this.headerWritten) {
        this.push(Buffer.concat([MAGIC, this.nonce]));
        this.headerWritten = true;
      }
      const final = this.cipher.final();
      const authTag = this.cipher.getAuthTag();
      cb(null, Buffer.concat([final, authTag]));
    } catch (err) {
      cb(err as Error);
    }
  }
}

/**
 * Streaming decryptor. Holds back the last AUTH_TAG_SIZE bytes as the GCM auth
 * tag and validates it on flush. Throws on tamper / wrong key.
 */
export class Decryptor extends Transform {
  private readonly key: Buffer;
  private decipher: DecipherGCM | null = null;
  private headerBuffer = Buffer.alloc(0);
  private trailingBuffer = Buffer.alloc(0);

  constructor(key: Buffer) {
    super();
    if (key.length !== 32) {
      throw new ConfigError(`decryption key must be 32 bytes, got ${key.length}`);
    }
    this.key = key;
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    try {
      let body = chunk;
      if (!this.decipher) {
        const combined = Buffer.concat([this.headerBuffer, chunk]);
        if (combined.length < HEADER_SIZE) {
          this.headerBuffer = combined;
          cb();
          return;
        }
        const magic = combined.subarray(0, MAGIC_SIZE);
        if (!magic.equals(MAGIC)) {
          cb(
            new Error(
              `not a DumpVault encrypted file (expected magic "${MAGIC.toString('utf8')}", got "${magic.toString('utf8')}")`,
            ),
          );
          return;
        }
        const nonce = combined.subarray(MAGIC_SIZE, HEADER_SIZE);
        this.decipher = createDecipheriv('aes-256-gcm', this.key, nonce) as DecipherGCM;
        body = combined.subarray(HEADER_SIZE);
        this.headerBuffer = Buffer.alloc(0);
      }

      // Always hold back AUTH_TAG_SIZE bytes — they might be the auth tag.
      const combined = Buffer.concat([this.trailingBuffer, body]);
      if (combined.length <= AUTH_TAG_SIZE) {
        this.trailingBuffer = combined;
        cb();
        return;
      }
      const decryptable = combined.subarray(0, combined.length - AUTH_TAG_SIZE);
      this.trailingBuffer = combined.subarray(combined.length - AUTH_TAG_SIZE);
      cb(null, this.decipher.update(decryptable));
    } catch (err) {
      cb(err as Error);
    }
  }

  override _flush(cb: TransformCallback): void {
    try {
      if (!this.decipher) {
        cb(new Error('encrypted file too short — header missing'));
        return;
      }
      if (this.trailingBuffer.length !== AUTH_TAG_SIZE) {
        cb(
          new Error(
            `expected ${AUTH_TAG_SIZE}-byte GCM auth tag at end of file, got ${this.trailingBuffer.length}`,
          ),
        );
        return;
      }
      this.decipher.setAuthTag(this.trailingBuffer);
      cb(null, this.decipher.final());
    } catch (err) {
      // Bad auth tag → tampering, wrong key, or corruption.
      cb(err as Error);
    }
  }
}

/** Quick check — does a path look like an encrypted dump? */
export function isEncryptedPath(path: string): boolean {
  return path.endsWith(ENCRYPTED_EXTENSION);
}
