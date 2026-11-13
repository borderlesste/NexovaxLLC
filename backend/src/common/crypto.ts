import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config';
import { AppError } from './errors';

/**
 * AES-256-GCM envelope for sensitive identifiers (tax ids, bank accounts).
 * Layout: [12-byte IV | 16-byte auth tag | ciphertext]. Key version "1".
 */
export const KEY_VERSION = 1;

function key(): Buffer {
  if (!config.dataEncryptionKey)
    throw new AppError('ENCRYPTION_NOT_CONFIGURED', 'El cifrado de datos sensibles no está configurado.', 503);
  const k = Buffer.from(config.dataEncryptionKey, 'base64');
  if (k.length !== 32) throw new AppError('ENCRYPTION_KEY_INVALID', 'Clave de cifrado inválida.', 503);
  return k;
}

export function encrypt(plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function decrypt(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8');
}

export const last4 = (v: string) => v.replace(/[^A-Za-z0-9]/g, '').slice(-4);
