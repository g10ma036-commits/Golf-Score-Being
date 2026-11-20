'use strict';
// スマホ（同じ Wi-Fi 内の端末）からのアクセス管理
//   - PC 自身（ループバック）からのアクセスは常に許可
//   - それ以外は「スマホからのアクセスを許可」が ON のときだけ、かつ
//     QR コード（秘密キー）または 6 桁の接続コードで登録した端末のみ許可（Cookie で記憶）
const os = require('node:os');
const crypto = require('node:crypto');

const COOKIE = 'golf_key';
const PUBLIC_PATHS = new Set(['/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']);

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// このPCの LAN 内 IPv4 アドレス（Wi-Fi/有線を優先、仮想アダプタは後ろ）
function lanAddresses() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Docker|Loopback|Tailscale|ZeroTier/i.test(name);
      const privateRange = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      list.push({ name, address: a.address, score: (virtual ? 0 : 2) + (privateRange ? 1 : 0) + (a.address.startsWith('192.168.') ? 1 : 0) });
    }
  }
  return list.sort((a, b) => b.score - a.score).map(({ name, address }) => ({ name, address }));
}

function createLan(db, { port, forceEnabled = false }) {
  const getSetting = (k) => db.get('SELECT value FROM settings WHERE key = ?', k)?.value ?? null;
  const setSetting = (k, v) => db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
  const newKey = () => crypto.randomBytes(16).toString('hex');
  const newPin = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  if (!getSetting('lan_key')) setSetting('lan_key', newKey());
  if (!getSetting('lan_pin')) setSetting('lan_pin', newPin());

  // 接続コードの総当たり対策：5 分間に 5 回失敗したらロック
  let failures = [];
  const locked = () => {
    const now = Date.now();
    failures = failures.filter((t) => now - t < 5 * 60 * 1000);
    return failures.length >= 5;
  };

  const lan = {
    enabled: () => forceEnabled || getSetting('lan_enabled') === '1',
    forced: forceEnabled,
    setEnabled(on) { setSetting('lan_enabled', on ? '1' : '0'); },
    reset() { setSetting('lan_key', newKey()); setSetting('lan_pin', newPin()); failures = []; },
    key: () => getSetting('lan_key'),
    pin: () => getSetting('lan_pin'),
    // 状態（秘密情報は PC 自身からの問い合わせにだけ返す）
    state(local) {
      const base = { enabled: lan.enabled(), forced: forceEnabled, port, local };
      if (!local) return base;
      const addrs = lanAddresses();
      return {
        ...base,
        pin: lan.pin(),
        addresses: addrs.map((a) => ({ ...a, url: `http://${a.address}:${port}`, pairUrl: `http://${a.address}:${port}/pair?key=${lan.key()}` })),
      };
    },
    isAuthorized: (req) => safeEqual(parseCookies(req.headers.cookie)[COOKIE], lan.key()),
    cookieHeader: () => `${COOKIE}=${lan.key()}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
    checkPin(pin) {
      if (locked()) return { ok: false, locked: true };
      if (safeEqual(String(pin || '').replace(/\D/g, ''), lan.pin())) { failures = []; return { ok: true }; }
      failures.push(Date.now());
      return { ok: false, locked: locked() };
    },
  };
  return lan;
}

// 未登録の端末に表示するページ（接続コード入力フォーム）
function pairPage(message = '') {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#17663f"><title>Golf Enjoy Manager に接続</title>
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">
<style>
  body{margin:0;font-family:system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;background:#f6f6f3;color:#0b0b0b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
  .box{background:#fcfcfb;border:1px solid rgba(11,11,11,.1);border-radius:14px;padding:28px 24px;max-width:380px;width:100%;text-align:center}
  h1{font-size:20px;margin:12px 0 8px} p{color:#52514e;font-size:14px;line-height:1.7;margin:0 0 16px}
  input{font-size:28px;letter-spacing:.3em;text-align:center;width:100%;box-sizing:border-box;padding:10px;border:1px solid rgba(11,11,11,.2);border-radius:10px}
  button{margin-top:14px;width:100%;font-size:17px;font-weight:600;padding:12px;border:0;border-radius:10px;background:#17663f;color:#fff}
  .err{color:#b3261e;font-weight:600} small{color:#898781;display:block;margin-top:16px;line-height:1.6}
  @media (prefers-color-scheme: dark){body{background:#0d0d0d;color:#f0efec}.box{background:#1a1a19;border-color:rgba(255,255,255,.1)}p{color:#c3c2b7}input{background:#232321;color:#f0efec;border-color:rgba(255,255,255,.2)}button{background:#3fae74;color:#0b0b0b}}
</style></head><body><form class="box" method="post" action="/pair">
<img src="/favicon.svg" width="56" height="56" alt="">
<h1>Golf Enjoy Manager に接続</h1>
<p>PC のアプリで「スマホで見る」を開き、<br>表示されている <strong>6桁の接続コード</strong> を入力してください。<br>（QR コードをカメラで読み取ってもOK）</p>
${message ? `<p class="err">${esc(message)}</p>` : ''}
<input name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="000000" required autofocus>
<button type="submit">接続する</button>
<small>一度接続すると、このブラウザでは次回から自動で開きます。</small>
</form></body></html>`;
}

module.exports = { createLan, isLoopback, parseCookies, pairPage, PUBLIC_PATHS, lanAddresses };
