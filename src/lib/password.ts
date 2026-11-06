import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const N = 32768,
  R = 8,
  P = 1,
  KEY = 64,
  MAXMEM = 64 * 1024 * 1024;
// Formato: scrypt$N$r$p$salt$hash (base64url). Parâmetros gravados permitem endurecer o custo no futuro.
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}
export async function verifyPassword(password: string, stored: string | null | undefined) {
  const parts = (stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    await hashPassword(password);
    return false;
  }
  const [, n, r, p, salt, expected] = parts;
  const target = Buffer.from(expected, 'base64url');
  const key = await scrypt(
    password.normalize('NFKC'),
    Buffer.from(salt, 'base64url'),
    target.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM },
  );
  return key.length === target.length && timingSafeEqual(key, target);
}
export const passwordRule = 'Use ao menos 10 caracteres, com letras e números.';
export function strongEnough(password: string) {
  return (
    password.length >= 10 &&
    password.length <= 200 &&
    /[a-zA-Z]/.test(password) &&
    /\d/.test(password)
  );
}
