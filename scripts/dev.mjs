import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import createPix from '../api/create-pix.js';
import paymentStatus from '../api/payment-status.js';
const root = resolve('public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) {
    const handler = { '/api/create-pix': createPix, '/api/payment-status': paymentStatus }[path];
    if (!handler) { res.writeHead(404).end(); return; }
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 12000) { res.writeHead(413).end(); return; } }
    req.body = body || '{}';
    res.status = code => { res.statusCode = code; return res; };
    res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    return handler(req, res);
  }
  try {
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error('invalid');
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); res.end(content);
  } catch { res.writeHead(404).end('Not found'); }
});
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => console.log('Checkout server ready on port ' + port));
