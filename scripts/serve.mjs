import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.pdf': 'application/pdf', '.ico': 'image/x-icon',
};
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY',
};

function inside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** A local preview server; static hosting must enforce the same headers in production. */
export async function createStaticServer({ root = APP_ROOT, port = 4173, host = '127.0.0.1' } = {}) {
  const actualRoot = await realpath(resolve(root));
  const server = createServer(async (request, response) => {
    const finish = (status, message) => {
      response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      finish(405, 'Method not allowed');
      return;
    }
    try {
      const rawPath = request.url.split('?')[0];
      const decoded = decodeURIComponent(rawPath);
      if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((part) => part === '.' || part === '..' || part.startsWith('.'))) {
        finish(400, 'Invalid path');
        return;
      }
      let path = resolve(actualRoot, `.${decoded}`);
      if (!inside(actualRoot, path)) { finish(403, 'Forbidden'); return; }
      let info = await stat(path);
      if (info.isDirectory()) {
        if (!decoded.endsWith('/')) {
          response.writeHead(308, { ...SECURITY_HEADERS, Location: `${decoded}/${request.url.includes('?') ? `?${request.url.split('?').slice(1).join('?')}` : ''}`, 'Cache-Control': 'no-store' });
          response.end();
          return;
        }
        path = resolve(path, 'index.html');
        info = await stat(path);
      }
      path = await realpath(path);
      if (!inside(actualRoot, path) || !info.isFile()) { finish(403, 'Forbidden'); return; }
      const extension = extname(path).toLowerCase();
      if (!MIME_TYPES[extension]) { finish(404, 'Not found'); return; }
      const headers = {
        ...SECURITY_HEADERS,
        'Content-Type': MIME_TYPES[extension],
        'Content-Length': info.size,
        'Cache-Control': path.endsWith(`${sep}sw.js`) ? 'no-store' : 'no-cache',
      };
      response.writeHead(200, headers);
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(path);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      finish(error instanceof URIError ? 400 : error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, 'Resource unavailable');
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolveListen);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const root = process.argv.includes('--dist') ? resolve(APP_ROOT, 'dist') : APP_ROOT;
  const server = await createStaticServer({ root, port });
  console.log(`AI 學習所 preview: http://127.0.0.1:${server.address().port}`);
}
