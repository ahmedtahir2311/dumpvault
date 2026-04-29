import { describe, expect, it } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AUTH_TAG_SIZE,
  Decryptor,
  Encryptor,
  HEADER_SIZE,
  MAGIC,
  generateKeyBase64,
} from '../src/storage/encryption.ts';

function bufferSink(): { sink: Writable; collected: () => Buffer } {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  return { sink, collected: () => Buffer.concat(chunks) };
}

async function encrypt(plaintext: Buffer, key: Buffer): Promise<Buffer> {
  const { sink, collected } = bufferSink();
  await pipeline(Readable.from([plaintext]), new Encryptor(key), sink);
  return collected();
}

async function decrypt(ciphertext: Buffer, key: Buffer): Promise<Buffer> {
  const { sink, collected } = bufferSink();
  await pipeline(Readable.from([ciphertext]), new Decryptor(key), sink);
  return collected();
}

describe('encryption round-trip', () => {
  const key = randomBytes(32);

  it('encrypts then decrypts a small payload', async () => {
    const plaintext = Buffer.from('hello, dumpvault encryption');
    const ciphertext = await encrypt(plaintext, key);
    expect(ciphertext.subarray(0, MAGIC.length).equals(MAGIC)).toBe(true);
    expect(ciphertext.length).toBeGreaterThan(plaintext.length); // header + tag overhead
    const recovered = await decrypt(ciphertext, key);
    expect(recovered.equals(plaintext)).toBe(true);
  });

  it('encrypts then decrypts a larger random payload', async () => {
    const plaintext = randomBytes(64 * 1024); // 64KB
    const ciphertext = await encrypt(plaintext, key);
    const recovered = await decrypt(ciphertext, key);
    expect(recovered.equals(plaintext)).toBe(true);
  });

  it('emits magic + nonce as the file header', async () => {
    const ciphertext = await encrypt(Buffer.from('x'), key);
    expect(ciphertext.length).toBeGreaterThanOrEqual(HEADER_SIZE + AUTH_TAG_SIZE);
    expect(ciphertext.subarray(0, MAGIC.length).toString('utf8')).toBe('DVENC001');
  });

  it('produces a different ciphertext each time (random nonce)', async () => {
    const plaintext = Buffer.from('same input');
    const a = await encrypt(plaintext, key);
    const b = await encrypt(plaintext, key);
    expect(a.equals(b)).toBe(false);
  });

  it('rejects ciphertext encrypted with a different key (auth-tag failure)', async () => {
    const ciphertext = await encrypt(Buffer.from('secret'), key);
    const wrongKey = randomBytes(32);
    await expect(decrypt(ciphertext, wrongKey)).rejects.toThrow();
  });

  it('rejects tampered ciphertext (auth-tag failure)', async () => {
    const ciphertext = await encrypt(Buffer.from('secret data'), key);
    // Flip a byte in the middle of the ciphertext.
    const mid = HEADER_SIZE + Math.floor((ciphertext.length - HEADER_SIZE - AUTH_TAG_SIZE) / 2);
    const tampered = Buffer.from(ciphertext);
    tampered[mid] = ((tampered[mid] ?? 0) ^ 0xff) & 0xff;
    await expect(decrypt(tampered, key)).rejects.toThrow();
  });

  it('rejects a file with bad magic', async () => {
    const bogus = Buffer.alloc(HEADER_SIZE + AUTH_TAG_SIZE);
    bogus.write('NOTDVENC', 0, 'utf8');
    await expect(decrypt(bogus, key)).rejects.toThrow(/not a DumpVault encrypted file/i);
  });
});

describe('generateKeyBase64', () => {
  it('produces a 32-byte key after base64 decode', () => {
    const k = generateKeyBase64();
    const decoded = Buffer.from(k, 'base64');
    expect(decoded.length).toBe(32);
  });

  it('is non-deterministic', () => {
    expect(generateKeyBase64()).not.toBe(generateKeyBase64());
  });
});
