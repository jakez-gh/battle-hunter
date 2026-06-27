// Zero-dependency static file server for local development.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

// Every non-internal IPv4 address, so a phone on the same Wi-Fi knows where to
// connect (the server already listens on all interfaces — listen(PORT) binds
// 0.0.0.0). Open one of these on your Android browser to play on your phone.
function lanAddresses() {
  const out = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces || []) {
      // Skip link-local APIPA (169.254.x) — never reachable from another device.
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(i.address);
    }
  }
  return out;
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 8377);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let filePath = normalize(join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
    if (!filePath.startsWith(normalize(ROOT))) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => {
  console.log(`battle-hunter dev server:`);
  console.log(`  on this PC:   http://localhost:${PORT}`);
  const lan = lanAddresses();
  if (lan.length) {
    console.log(`  on your phone (same Wi-Fi): ` + lan.map((a) => `http://${a}:${PORT}`).join('  '));
  } else {
    console.log(`  (no LAN address found — connect this PC to Wi-Fi to play on your phone)`);
  }
});
