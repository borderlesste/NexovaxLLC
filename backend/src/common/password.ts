import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { badRequest } from './errors';

const logger = new Logger('PasswordPolicy');
const RANGE_API = 'https://api.pwnedpasswords.com/range/';

/** Minimum shape: 8+ characters with letters and digits. */
export function assertPasswordShape(password: string) {
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password))
    throw badRequest('WEAK_PASSWORD', 'La contraseña debe tener al menos 8 caracteres, con letras y números.');
}

/**
 * Rejects passwords found in known data breaches (Have I Been Pwned, k-anonymity:
 * only the first 5 hex characters of the SHA-1 leave the server, never the password).
 * Mirrors Supabase's "Prevent use of leaked passwords", which the admin API we use for
 * sign-up and password change does not apply. If the service can't be reached the
 * password is accepted (logged), so an outage never blocks sign-ups.
 * Disable with PASSWORD_LEAK_CHECK=false.
 */
export async function assertPasswordNotLeaked(password: string) {
  if (process.env.PASSWORD_LEAK_CHECK === 'false') return;
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  let body: string;
  try {
    const res = await fetch(RANGE_API + prefix, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'nexovax-api' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.text();
  } catch (e: any) {
    logger.warn(`Leaked-password check unavailable, password accepted: ${e?.message ?? e}`);
    return;
  }
  for (const line of body.split('\n')) {
    const [hash, count] = line.trim().split(':');
    if (hash === suffix && Number(count) > 0)
      throw badRequest('PASSWORD_LEAKED', 'Esta contraseña apareció en filtraciones de datos y es fácil de adivinar. Elige una diferente.');
  }
}

/** Full policy for a new password (sign-up and password change). */
export async function assertPasswordAcceptable(password: string) {
  assertPasswordShape(password);
  await assertPasswordNotLeaked(password);
}
