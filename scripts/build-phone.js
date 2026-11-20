'use strict';
// スマホ単独版（PC なしで動く版）を作る： npm run build:phone
// public/ をコピーして「スマホ単独モード」の印と、オフライン用の Service Worker を加える。
// できた dist/phone-app フォルダを https の静的ホスティング（GitHub Pages / Netlify / Cloudflare Pages など）に置くと、
// スマホのブラウザで開いてホーム画面に追加できる。データはスマホの中（IndexedDB）に保存される。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'phone-app'));

// スマホ単独版では使わないファイル（PC版の LAN 接続用など）
const EXCLUDE = new Set(['js/package.json', 'js/views/mobileConnect.js']);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

function build() {
  // 出力先は作り直すので、別のフォルダを誤って消さないよう確認する（空か、以前に作ったスマホ単独版のみ）
  if (ROOT.startsWith(OUT) || OUT.startsWith(SRC)) throw new Error(`出力先が不正です: ${OUT}`);
  if (fs.existsSync(OUT) && fs.readdirSync(OUT).length && !fs.existsSync(path.join(OUT, 'sw.js'))) {
    throw new Error(`出力先に別のファイルがあります。空のフォルダを指定してください: ${OUT}`);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  const files = walk(SRC).filter((f) => !EXCLUDE.has(f)).sort();
  const hash = crypto.createHash('sha256');
  let total = 0;
  for (const rel of files) {
    let buf = fs.readFileSync(path.join(SRC, rel));
    if (rel === 'index.html') {
      const html = buf.toString('utf8');
      if (!html.includes('<meta charset="utf-8">')) throw new Error('index.html に <meta charset="utf-8"> が見つかりません');
      buf = Buffer.from(html.replace('<meta charset="utf-8">',
        `<meta charset="utf-8">\n  <meta name="golf-mode" content="standalone">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`));
    }
    const dest = path.join(OUT, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    hash.update(rel).update(buf);
    total += buf.length;
  }
  const version = hash.digest('hex').slice(0, 12);
  const sw = fs.readFileSync(path.join(__dirname, 'sw.template.js'), 'utf8')
    .replace('__VERSION__', version)
    .replace('__ASSETS__', JSON.stringify(files, null, 2));
  fs.writeFileSync(path.join(OUT, 'sw.js'), sw);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), ''); // GitHub Pages 用（_ で始まるファイルもそのまま公開）
  return { files: files.length + 1, total, version };
}

const r = build();
console.log(`スマホ単独版を作成しました（${r.files} ファイル・${(r.total / 1024).toFixed(0)} KB・バージョン ${r.version}）`);
console.log(`  出力先: ${OUT}`);
console.log('  このフォルダの中身を https の静的ホスティングに置き、スマホで開いて「ホーム画面に追加」してください。');
console.log('  PC で試す: npm run preview:phone → http://localhost:4173');
