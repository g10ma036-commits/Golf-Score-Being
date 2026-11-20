// スマホ単独版の補助：オフライン対応（Service Worker）・更新のお知らせ・ホーム画面への追加・
// データ保護（永続化）・バックアップの作成と共有
import { html, mount, $, openModal, toast, errorToast } from './util.js';
import { createBackup, localMeta, markBackedUp } from './api.js';

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const isIos = () => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/.test(ua);
export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- 画面上部のお知らせバー ----------
export function showBanner({ id, text, actions = [], dismissible = true }) {
  const el = document.getElementById('app-banner');
  if (!el) return;
  if (id && sessionStorage.getItem('golf-banner-' + id)) return;
  mount(el, html`<span class="app-banner-text">${text}</span>
    ${actions.map((a, i) => html`<button type="button" class="btn ${a.primary ? 'btn-primary' : ''}" data-act="${i}">${a.label}</button>`)}
    ${dismissible ? html`<button type="button" class="btn-icon app-banner-close" data-close aria-label="閉じる">✕</button>` : ''}`);
  el.hidden = false;
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[Number(b.dataset.act)].onClick()));
  el.querySelector('[data-close]')?.addEventListener('click', () => {
    el.hidden = true;
    if (id) sessionStorage.setItem('golf-banner-' + id, '1');
  });
}

// ---------- ホーム画面に追加 ----------
let installPrompt = null;
export const INSTALL_STEPS = () => html`<ol class="steps">
  ${isIos() ? html`<li><strong>Safari</strong> で開いていることを確認（ほかのブラウザでは追加できない場合があります）</li>
    <li>画面下（iPad は上）の <strong>共有ボタン</strong>（□に↑のマーク）をタップ</li>
    <li>「<strong>ホーム画面に追加</strong>」→「追加」</li>
    <li>ホーム画面の <strong>Golf</strong> アイコンから開いて使う</li>`
  : html`<li>Chrome の右上の <strong>︙</strong> をタップ</li>
    <li>「<strong>ホーム画面に追加</strong>」または「<strong>アプリをインストール</strong>」</li>
    <li>ホーム画面の <strong>Golf</strong> アイコンから開いて使う</li>`}
</ol>`;
export function openInstallHelp() {
  const m = openModal({
    title: 'ホーム画面に追加する',
    body: html`${INSTALL_STEPS()}
      ${isIos() ? html`<p class="small warn-text" style="margin-top:12px">⚠ iPhone では、Safari で入力したデータはホーム画面のアプリに引き継がれません。<strong>先にホーム画面に追加してから</strong>、そちらで記録してください。</p>` : ''}
      <p class="small muted" style="margin-top:8px">追加すると、電波のないゴルフ場でもアプリのように使えます。</p>`,
    footer: html`${installPrompt ? html`<button class="btn btn-primary" data-install>今すぐ追加</button>` : ''}<button class="btn" data-close-help>閉じる</button>`,
  });
  $('[data-close-help]', m.el).addEventListener('click', () => m.close());
  $('[data-install]', m.el)?.addEventListener('click', async () => { m.close(); await promptInstall(); });
}
export async function promptInstall() {
  if (!installPrompt) { openInstallHelp(); return; }
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
}
export const canPromptInstall = () => Boolean(installPrompt);

// ---------- データ保護（ブラウザに自動削除しないよう依頼） ----------
export async function storageStatus() {
  const s = navigator.storage;
  const persisted = s?.persisted ? await s.persisted().catch(() => null) : null;
  const est = s?.estimate ? await s.estimate().catch(() => null) : null;
  return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
}
export async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) return await navigator.storage.persist();
  } catch { /* 非対応 */ }
  return null;
}

// ---------- バックアップの作成 → 共有（iPhone は「ファイルに保存」/ LINE / AirDrop など）か保存 ----------
export const fmtBytes = (n) => (n == null ? '—' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export async function runBackupFlow(onDone = () => {}) {
  let url = null;
  const m = openModal({
    title: 'バックアップ（写真込み）',
    body: html`<div data-body><div class="loading">バックアップを作成中…</div></div>`,
    footer: html`<button class="btn" data-close-bk>閉じる</button>`,
    onClose: () => { if (url) setTimeout(() => URL.revokeObjectURL(url), 60000); },
  });
  $('[data-close-bk]', m.el).addEventListener('click', () => m.close());
  let file;
  try { file = await createBackup(); } catch (e) { m.close(); errorToast(e); return; }
  const canShare = Boolean(navigator.canShare?.({ files: [file] }));
  url = URL.createObjectURL(file);
  mount($('[data-body]', m.el), html`
    <p>バックアップファイルを作成しました：<br><code>${file.name}</code>（${fmtBytes(file.size)}）</p>
    <div class="actions" style="margin-top:12px">
      ${canShare ? html`<button class="btn btn-primary" data-share>共有・保存する…</button>` : ''}
      <a class="btn ${canShare ? '' : 'btn-primary'}" href="${url}" download="${file.name}" data-dl>ダウンロード</a>
    </div>
    <p class="small muted" style="margin-top:10px">${canShare
      ? '「共有・保存する」から、「ファイルに保存」・Google ドライブ・LINE（自分へのトーク）・AirDrop などを選べます。'
      : 'ダウンロードしたファイルを、クラウドや PC など別の場所にも保管してください。'}<br>
      PC版の「設定 → バックアップから復元」でこのファイルを読み込めば、PC でも同じデータを見られます。</p>`);
  const ok = async () => { await markBackedUp(); onDone(); };
  $('[data-share]', m.el)?.addEventListener('click', async () => {
    try {
      await navigator.share({ files: [file], title: 'Golf Enjoy Manager バックアップ' });
      await ok();
      toast('バックアップを保存しました');
      m.close();
    } catch (e) {
      if (e?.name !== 'AbortError') errorToast('共有できませんでした。「ダウンロード」をお試しください');
    }
  });
  $('[data-dl]', m.el).addEventListener('click', () => { setTimeout(ok, 0); });
}

// 最後のバックアップからの日数（記録が増えていて、14日以上たっていたら注意を出す）
export async function backupReminder() {
  const meta = await localMeta();
  if (!meta || !meta.updated_at || !(meta.rounds || meta.photos)) return null;
  const last = meta.last_backup_at ? Date.parse(meta.last_backup_at) : null;
  if (last && Date.parse(meta.updated_at) <= last) return null;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  if (days !== null && days < 14) return null;
  return { days };
}

// ---------- 起動時の準備 ----------
export async function initStandalone({ getLeaveGuard, clearLeaveGuard }) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    if (!isInstalled()) {
      showBanner({ id: 'install', text: 'ホーム画面に追加すると、電波のない場所でもアプリのように使えます',
        actions: [{ label: '追加する', primary: true, onClick: () => promptInstall() }] });
    }
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; document.getElementById('app-banner').hidden = true; });

  if (isIos() && !isInstalled()) {
    showBanner({ id: 'ios-install', text: '📲 iPhone では「ホーム画面に追加」してから使ってください（Safari で入力したデータは引き継がれません）',
      actions: [{ label: '方法を見る', primary: true, onClick: () => openInstallHelp() }] });
  }

  const meta = await localMeta().catch(() => null);
  if (meta?.storageError) {
    showBanner({ id: 'nostorage', text: '⚠ この環境ではデータを保存できません（プライベートブラウズなど）。閉じると入力内容が消えます', dismissible: true });
  } else if (isInstalled() || meta?.rounds || meta?.photos) {
    requestPersist();
  }

  // オフライン対応：Service Worker（https または localhost のときだけ動く）
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    const offer = (worker) => showBanner({
      text: '新しいバージョンがあります',
      actions: [{ label: '更新する', primary: true, onClick: () => {
        if (getLeaveGuard()?.() && !window.confirm('保存していない入力があります。更新すると入力内容は消えます。更新しますか？')) return;
        clearLeaveGuard();
        worker.postMessage('skipWaiting');
      } }],
    });
    if (reg.waiting && hadController) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    // アプリに戻ってきたときに更新を確認（1時間に1回まで）
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck > 3600000) { lastCheck = Date.now(); reg.update().catch(() => {}); }
    });
  } catch (e) {
    console.warn('Service Worker を登録できませんでした', e);
  }
}
