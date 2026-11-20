'use strict';
// Golf Enjoy Manager — ローカルサーバー
//   起動: npm start（または start.bat をダブルクリック）
//   ブラウザで http://localhost:3000 を開く
const http = require('node:http');
const path = require('node:path');
const { createApp } = require('./server/app');

const PORT = Number(process.env.PORT) || 3000;
const FORCE_LAN = process.env.GOLF_ALLOW_LAN === '1';
const LAN_HOST = process.env.GOLF_LAN_HOST || '0.0.0.0'; // スマホ許可時に待ち受けるアドレス
const OPEN_BROWSER = process.env.GOLF_OPEN_BROWSER === '1';
const APP_URL = `http://localhost:${PORT}`;
const DATA_DIR = path.resolve(process.env.GOLF_DATA_DIR || path.join(__dirname, 'data'));

let server;
const app = createApp({
  dataDir: DATA_DIR,
  port: PORT,
  forceLan: FORCE_LAN,
  // 「スマホで見る」の ON/OFF が変わったら待ち受けアドレスを切り替える
  onLanChange: () => setTimeout(() => {
    relisten().catch((e) => console.error('待ち受けの切り替えに失敗しました:', e.message));
  }, 150),
});
server = http.createServer(app.handler);

const targetHost = () => (app.lan.enabled() ? LAN_HOST : '127.0.0.1');
let currentHost = null;

function listen(host) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => reject(e);
    server.once('error', onErr);
    server.listen(PORT, host, () => {
      server.off('error', onErr);
      currentHost = host;
      resolve();
    });
  });
}

async function relisten() {
  const host = targetHost();
  if (host === currentHost && server.listening) return;
  await new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
    setTimeout(() => server.closeAllConnections?.(), 300);
  });
  try {
    await listen(host);
  } catch (e) {
    // LAN での待ち受けに失敗したら PC 専用に戻す
    console.error(`${host}:${PORT} で待ち受けできませんでした (${e.code || e.message})`);
    if (host !== '127.0.0.1') { app.lan.setEnabled(false); await listen('127.0.0.1'); }
    return;
  }
  logLan();
}

function logLan() {
  if (currentHost === '127.0.0.1') {
    console.log('  📱 スマホからのアクセス: OFF（このPCからのみ）');
    return;
  }
  const st = app.lan.state(true);
  console.log('  📱 スマホからのアクセス: ON（同じWi-Fiのスマホで次のアドレスを開く）');
  for (const a of st.addresses) console.log(`       ${a.url}   (${a.name})`);
  console.log(`       接続コード: ${st.pin}`);
}

// 既定のブラウザでアプリを開く（URL はポート番号のみから組み立てるので安全）
function openBrowser() {
  const { exec } = require('node:child_process');
  const cmd = process.platform === 'win32' ? `start "" "${APP_URL}"` : process.platform === 'darwin' ? `open "${APP_URL}"` : `xdg-open "${APP_URL}"`;
  exec(cmd, (err) => { if (err) console.warn('ブラウザを自動で開けませんでした:', APP_URL); });
}

listen(targetHost()).then(() => {
  console.log('');
  console.log('  ⛳ Golf Enjoy Manager を起動しました');
  console.log(`     ${APP_URL}`);
  console.log(`     データ保存先: ${DATA_DIR}`);
  logLan();
  console.log('     終了するにはこのウィンドウで Ctrl + C');
  console.log('');
  if (OPEN_BROWSER) openBrowser();
}).catch((e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`ポート ${PORT} は使用中です。すでに起動している可能性があります → ${APP_URL}`);
    console.error('別のポートで起動する場合: set PORT=3001 && npm start');
    if (OPEN_BROWSER) openBrowser();
  } else {
    console.error(e);
  }
  process.exit(1);
});

function shutdown() {
  server.close();
  try { app.close(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
