import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_HEX_LENGTH = 64;

export class TokenEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenEncryptionError";
  }
}

function getEncryptionKey(): Buffer {
  const keyHex = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new TokenEncryptionError(
      "SPOTIFY_TOKEN_ENCRYPTION_KEY is not set. Add it to your environment variables.",
    );
  }
  if (keyHex.length !== KEY_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new TokenEncryptionError(
      `SPOTIFY_TOKEN_ENCRYPTION_KEY must be exactly ${KEY_HEX_LENGTH} hex characters (32 bytes).`,
    );
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns format: base64(iv):base64(authTag):base64(ciphertext)
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a string produced by encryptToken.
 * Expected format: base64(iv):base64(authTag):base64(ciphertext)
 */
export function decryptToken(encryptedString: string): string {
  const key = getEncryptionKey();

  const parts = encryptedString.split(":");
  if (parts.length !== 3) {
    throw new TokenEncryptionError(
      "Malformed encrypted string: expected format base64(iv):base64(authTag):base64(ciphertext).",
    );
  }

  const [ivB64, authTagB64, ciphertextB64] = parts;

  let iv: Buffer;
  let authTag: Buffer;
  let ciphertext: Buffer;
  try {
    iv = Buffer.from(ivB64, "base64");
    authTag = Buffer.from(authTagB64, "base64");
    ciphertext = Buffer.from(ciphertextB64, "base64");
  } catch {
    throw new TokenEncryptionError(
      "Malformed encrypted string: invalid base64 encoding.",
    );
  }

  if (iv.length !== IV_LENGTH) {
    throw new TokenEncryptionError(
      `Malformed encrypted string: IV must be ${IV_LENGTH} bytes.`,
    );
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new TokenEncryptionError(
      `Malformed encrypted string: auth tag must be ${AUTH_TAG_LENGTH} bytes.`,
    );
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    throw new TokenEncryptionError(
      `Decryption failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
