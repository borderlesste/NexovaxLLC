import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * Downloads an image from a link a seller typed (product import), without letting that link
 * reach internal services: only public IPs (checked on the address actually connected to, so
 * DNS rebinding and redirects can't sneak past), ports 80/443, at most 4 redirects, 8 MB, 15 s.
 * The format is read from the file's bytes, not from the server's headers.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 127], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

/** True for addresses on the public internet (not loopback, private, link-local, reserved...). */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) is judged by its IPv4 address. Node's BlockList matches IPv4
    // addresses against a ::ffff:0:0/96 rule, so that range can't simply be listed above.
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    if (mapped) return isPublicAddress(mapped);
    if (/^::ffff:/i.test(ip)) return false;
    return !blocked.check(ip, 'ipv6');
  }
  return false;
}

export class ImageFetchError extends Error {}

function safeLookup(hostname: string, options: any, callback: (...args: any[]) => void) {
  dnsLookup(hostname, options, (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => {
    if (err) return callback(err, address, family);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (!list.length || list.some((a) => !isPublicAddress(a.address)))
      return callback(Object.assign(new Error('Blocked address'), { code: 'EBLOCKED' }), address, family);
    callback(null, address, family);
  });
}

/** Image format from the first bytes; null when it is not JPG, PNG, WebP or AVIF. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(buf.toString('ascii', 8, 12))) return 'image/avif';
  return null;
}

function getOnce(url: URL, deadline: number): Promise<{ status: number; location?: string; body?: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      {
        lookup: safeLookup as any,
        headers: { 'User-Agent': 'NexovaxImageImport/1.0', Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' },
        timeout: Math.max(1, deadline - Date.now()),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location });
        }
        if (status !== 200) {
          res.resume();
          return resolve({ status });
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > MAX_BYTES) {
          res.destroy();
          return reject(new ImageFetchError('La imagen supera 8 MB.'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            res.destroy();
            reject(new ImageFetchError('La imagen supera 8 MB.'));
          } else chunks.push(c);
        });
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new ImageFetchError('El servidor de la imagen tardó demasiado en responder.')));
    req.on('error', reject);
  });
}

export async function fetchPublicImage(rawUrl: string): Promise<{ buffer: Buffer; mimetype: string; size: number; originalname: string }> {
  const deadline = Date.now() + TIMEOUT_MS;
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ImageFetchError('El enlace debe empezar por https://.');
    if (url.username || url.password) throw new ImageFetchError('El enlace no puede llevar usuario ni contraseña.');
    if (url.port && !['80', '443'].includes(url.port)) throw new ImageFetchError('El enlace usa un puerto no permitido.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPublicAddress(host)) throw new ImageFetchError('El enlace apunta a una dirección no permitida.');
    let r: Awaited<ReturnType<typeof getOnce>>;
    try {
      r = await getOnce(url, deadline);
    } catch (e: any) {
      if (e instanceof ImageFetchError) throw e;
      if (e?.code === 'EBLOCKED') throw new ImageFetchError('El enlace apunta a una dirección no permitida.');
      if (e?.code === 'ENOTFOUND') throw new ImageFetchError('No existe el sitio del enlace.');
      throw new ImageFetchError('No se pudo descargar la imagen.');
    }
    if (r.location) {
      url = new URL(r.location, url);
      continue;
    }
    if (!r.body) throw new ImageFetchError(r.status === 404 ? 'La imagen no existe (error 404).' : r.status === 403 || r.status === 401 ? 'La imagen no es pública: compártela con acceso para cualquiera con el enlace.' : `El servidor de la imagen respondió con error ${r.status}.`);
    const mimetype = sniffImage(r.body);
    if (!mimetype) {
      const head = r.body.subarray(0, 512).toString('utf8').toLowerCase();
      throw new ImageFetchError(
        head.includes('<html') || head.includes('<!doctype')
          ? 'El enlace abre una página web, no la imagen. Usa el enlace directo a la imagen (y si es de Google Drive, compártela con acceso para cualquiera con el enlace).'
          : 'El archivo no es una imagen JPG, PNG, WebP o AVIF.',
      );
    }
    let name = url.pathname.split('/').pop() || 'imagen';
    try {
      name = decodeURIComponent(name);
    } catch {
      /* keep the raw name */
    }
    name = name.slice(0, 120);
    return { buffer: r.body, mimetype, size: r.body.length, originalname: name };
  }
  throw new ImageFetchError('El enlace redirige demasiadas veces.');
}
