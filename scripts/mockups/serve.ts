// Static server for mockups with HTTP Range support (video seeking). Local only.
// Usage: npx tsx scripts/mockups/serve.ts <port> <mockups dir> <proxies dir>   → /proxies/* maps to the proxies dir.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

const [port = '4318', root = 'mockups', proxies = ''] = process.argv.slice(2);
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mp4': 'video/mp4', '.css': 'text/css' };

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const base = url.startsWith('/proxies/') && proxies ? proxies : root;
  const rel = url.startsWith('/proxies/') && proxies ? url.slice('/proxies/'.length) : url.slice(1) || 'index.html';
  const file = path.resolve(base, rel);
  if (!file.startsWith(path.resolve(base))) { res.writeHead(403).end(); return; }
  let size: number;
  try { size = statSync(file).size; } catch { res.writeHead(404).end('not found'); return; }
  const type = types[path.extname(file)] ?? 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (m) {
    const start = m[1] ? +m[1] : size - +m[2];
    const end = m[1] && m[2] ? +m[2] : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
    createReadStream(file).pipe(res);
  }
}).listen(+port, '127.0.0.1', () => console.log(`mockups on http://localhost:${port}`));
