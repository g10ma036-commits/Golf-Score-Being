'use strict';
// スマホ単独版を PC のブラウザで試すための簡易サーバー： npm run preview:phone → http://localhost:4173
// （localhost なのでオフライン機能も動く。スマホへの配布には https のホスティングを使う）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'phone-app'));
const PORT = Number(process.env.PORT) || 4173;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

if (!fs.existsSync(path.join(DIR, 'index.html'))) {
  console.error(`スマホ単独版が見つかりません: ${DIR}\n先に npm run build:phone を実行してください。`);
  process.exit(1);
}

http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(DIR, '.' + path.posix.normalize(rel));
  if (!file.startsWith(DIR + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`スマホ単独版のプレビュー: http://localhost:${PORT}  （Ctrl + C で終了）`);
});
