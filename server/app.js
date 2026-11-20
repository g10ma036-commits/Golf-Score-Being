'use strict';
// リクエスト処理（静的ファイル・写真・API・スマホ接続の認証）
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');
const { createApi } = require('./api');
const { createLan, isLoopback, pairPage, PUBLIC_PATHS } = require('./lan');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
// LAN からのアクセスで許可する Host（IP アドレスか、ドットなし/.local のPC名）。DNS リバインディング対策
const LAN_HOST_RE = /^((\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:.]+\]|[a-z0-9-]+(\.local)?)(:\d+)?$/i;

function sendText(res, status, msg, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(msg);
}
function sendHtml(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function readSmallBody(req, limit = 2048) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function createApp({
  dataDir,
  port,
  forceLan = false,
  isLocal = (req) => isLoopback(req.socket.remoteAddress),
  onLanChange = () => {},
}) {
  const publicDir = path.join(__dirname, '..', 'public');
  const photoDir = path.join(dataDir, 'photos');
  fs.mkdirSync(photoDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'golf.db'));
  const lan = createLan(db, { port, forceEnabled: forceLan });
  const api = createApi(db, { photoDir, lan, onLanChange });

  // root 配下のファイルだけを返す（パストラバーサル対策）
  function serveFile(res, root, relPath, cacheControl) {
    const file = path.resolve(root, '.' + path.posix.normalize('/' + relPath));
    if (file !== root && !file.startsWith(root + path.sep)) return sendText(res, 403, 'Forbidden');
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return sendText(res, 404, 'Not Found');
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': cacheControl,
        'X-Content-Type-Options': 'nosniff',
      });
      fs.createReadStream(file).pipe(res);
    });
  }

  async function handlePair(req, res, url) {
    if (req.method === 'GET') {
      if (url.searchParams.get('key') && url.searchParams.get('key') === lan.key()) {
        res.writeHead(302, { 'Set-Cookie': lan.cookieHeader(), Location: '/', 'Cache-Control': 'no-store' });
        return res.end();
      }
      return sendHtml(res, 401, pairPage(url.searchParams.get('key') ? 'QR コードが古いか正しくありません。接続コードを入力してください。' : ''));
    }
    if (req.method === 'POST') {
      let body = '';
      try { body = await readSmallBody(req); } catch { return sendText(res, 413, 'Too Large'); }
      const r = lan.checkPin(new URLSearchParams(body).get('pin'));
      if (r.ok) {
        res.writeHead(303, { 'Set-Cookie': lan.cookieHeader(), Location: '/', 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (r.locked) return sendHtml(res, 429, pairPage('失敗が続いたため一時的にロックしています。5分ほど待ってから、もう一度お試しください。'));
      return sendHtml(res, 401, pairPage('接続コードが違います。PC の画面に表示されている6桁の数字を入力してください。'));
    }
    return sendText(res, 405, 'Method Not Allowed');
  }

  async function handler(req, res) {
    try {
      const local = isLocal(req);
      const host = String(req.headers.host || '');
      if (local) {
        if (!LOCAL_HOST_RE.test(host)) return sendText(res, 403, 'Forbidden host');
      } else {
        if (!lan.enabled()) return sendText(res, 403, 'スマホからのアクセスは許可されていません。PC のアプリの「スマホで見る」で許可してください。');
        if (!LAN_HOST_RE.test(host)) return sendText(res, 403, 'Forbidden host');
      }

      const url = new URL(req.url, 'http://localhost');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return sendText(res, 400, 'Bad Request'); }

      if (pathname === '/pair') {
        if (local) { res.writeHead(302, { Location: '/' }); return res.end(); }
        return await handlePair(req, res, url);
      }
      if (!local && !PUBLIC_PATHS.has(pathname) && !lan.isAuthorized(req)) {
        if (pathname.startsWith('/api/')) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'このスマホはまだ接続登録されていません。ページを再読み込みしてください。' }));
        }
        return sendHtml(res, 401, pairPage());
      }

      if (pathname.startsWith('/api/')) return await api.handle(req, res, url, { local });
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method Not Allowed');

      if (pathname.startsWith('/photos/')) {
        // 写真ファイル名はサーバーが付けた UUID のみ
        const rel = pathname.slice('/photos/'.length);
        if (!/^(thumbs\/)?[0-9a-f-]{36}\.[a-z]{3,4}$/.test(rel)) return sendText(res, 404, 'Not Found');
        return serveFile(res, photoDir, rel, 'private, max-age=31536000, immutable');
      }
      const rel = pathname === '/' ? '/index.html' : pathname;
      return serveFile(res, publicDir, rel, 'no-cache');
    } catch (e) {
      console.error(e);
      if (!res.headersSent) sendText(res, 500, 'Internal Server Error');
    }
  }

  return { handler, lan, db, close: () => db.close() };
}

module.exports = { createApp };
