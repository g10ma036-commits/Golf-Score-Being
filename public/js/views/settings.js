// 設定・データ管理
import { html, mount, $, openModal, confirmDialog, toast, errorToast, fmtDate, localDateTime } from '../util.js';
import { api, getSettings, saveSettings, STANDALONE, inspectBackup, restoreBackup, localMeta } from '../api.js';
import { applyTheme } from '../main.js';
import { PHONE_APP_URL } from '../config.js';

export async function render(root) {
  const [s, rounds, clubs, courses] = await Promise.all([getSettings(true), api.get('/api/rounds'), api.get('/api/clubs'), api.get('/api/courses')]);
  const isEmpty = !rounds.length && !clubs.length && !courses.length;

  mount(root, html`
    <div class="page-header"><div><h1>設定</h1></div></div>
    ${STANDALONE ? html`
      <div class="card" style="margin-bottom:16px">
        <h2 style="margin-bottom:12px">📱 この端末に保存（スマホ単独版）</h2>
        <div id="device-body"><div class="loading">読み込み中…</div></div>
      </div>` : html`
      <div class="card" id="mobile" style="margin-bottom:16px">
        <h2 style="margin-bottom:12px">📱 スマホで見る（iPhone / Android）</h2>
        <div id="mobile-body"><div class="loading">読み込み中…</div></div>
      </div>`}
    <div class="grid grid-2">
      <div class="card" id="backup">
        <h2 style="margin-bottom:12px">${STANDALONE ? 'バックアップ・データの引っ越し' : 'データのバックアップ'}</h2>
        ${STANDALONE ? html`
          <p class="secondary">記録と写真はこの端末の中だけにあります。<strong>機種変更や故障に備えて、ときどきバックアップ</strong>を作り、クラウドや PC に保管してください。</p>
          <dl class="kv" style="margin-top:8px"><dt>最後のバックアップ</dt><dd id="last-backup">—</dd></dl>
          <div class="actions" style="margin-top:12px">
            <button class="btn btn-primary" id="make-backup">バックアップを作成（写真込み）</button>
            <label class="btn">バックアップから復元<input type="file" id="import" accept=".zip,.json,application/zip,application/json" hidden></label>
          </div>
          <p class="small muted" style="margin-top:8px">PC版で作ったバックアップ（ZIP / JSON）も復元できます。復元すると、この端末のデータはすべて置き換わります。</p>`
        : html`
          <p class="secondary">すべての記録はこのPCの <code>data</code> フォルダに保存されています。</p>
          <div class="actions" style="margin-top:12px">
            <a class="btn btn-primary" href="/api/export?format=zip" download>写真込みでバックアップ（ZIP）</a>
            <a class="btn" href="/api/export" download>データのみ（JSON）</a>
            <label class="btn">バックアップから復元<input type="file" id="import" accept=".zip,.json,application/zip,application/json" hidden></label>
          </div>
          <p class="small muted" style="margin-top:8px">ZIP はスマホ単独版との間でデータを移すのにも使えます。JSON には写真ファイル本体は含まれません。復元すると現在のデータはすべて置き換わります。</p>`}
      </div>

      <div class="card">
        <h2 style="margin-bottom:12px">プロフィール・表示</h2>
        <form id="settings-form" autocomplete="off"><div class="form-grid">
          <label class="field wide"><span>プレーヤー名</span><input name="player_name" maxlength="100" value="${s.player_name || ''}" placeholder="ホーム画面に表示されます"></label>
          <label class="field"><span>距離の単位</span><select name="unit"><option value="yd" ${s.unit !== 'm' ? 'selected' : ''}>ヤード（yd）</option><option value="m" ${s.unit === 'm' ? 'selected' : ''}>メートル（m）</option></select></label>
          <label class="field"><span>テーマ</span><select name="theme">
            <option value="auto" ${!s.theme || s.theme === 'auto' ? 'selected' : ''}>自動（OSの設定に合わせる）</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>ライト</option>
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>ダーク</option></select></label>
        </div>
        <p class="small muted" style="margin-top:8px">距離の単位は表示ラベルのみ変わります（記録済みの数値は換算されません）。</p>
        <div class="form-actions"><button class="btn btn-primary" type="submit">保存</button></div></form>
      </div>

      <div class="card">
        <h2 style="margin-bottom:12px">サンプルデータ</h2>
        <p class="secondary">架空のコース2つ・24ラウンド・クラブ15本・飛距離記録を読み込んで、各機能を試せます。</p>
        ${isEmpty ? html`<button class="btn" id="sample">サンプルデータを読み込む</button>`
          : html`<p class="small muted">データが空のときだけ読み込めます。</p>`}
      </div>

      <div class="card">
        <h2 style="margin-bottom:12px">すべてのデータを削除</h2>
        <p class="secondary">ラウンド・コース・クラブ・飛距離・アルバム・写真をすべて削除します（設定は残ります）。元に戻せないので、先にバックアップを取ってください。</p>
        <button class="btn btn-danger" id="delete-all" ${isEmpty ? 'disabled' : ''}>すべて削除…</button>
      </div>
    </div>
    ${!STANDALONE && PHONE_APP_URL ? html`<div class="card section" id="phone-app">
      <h2 style="margin-bottom:12px">📲 スマホ単独版（PC なしで使う）</h2>
      <div id="phone-app-body"></div></div>` : ''}
    <div class="card section">
      <h2 style="margin-bottom:8px">このアプリについて</h2>
      <dl class="kv">
        <dt>アプリ</dt><dd>Golf Enjoy Manager 1.1${STANDALONE ? '（スマホ単独版）' : ''}</dd>
        <dt>保存件数</dt><dd>ラウンド ${rounds.length} ・ コース ${courses.length} ・ クラブ ${clubs.length}</dd>
        ${STANDALONE
          ? html`<dt>データの保存先</dt><dd>この端末のブラウザ内（外部には送信されません）。PC版とは別のデータなので、行き来するときはバックアップ ZIP を使います。</dd>`
          : html`<dt>スマホから使う</dt><dd>上の「スマホで見る」で、PC が起動中に同じ Wi-Fi のスマホから使えます。PC なしで使うにはスマホ単独版を使います（README 参照）。</dd>`}
      </dl>
    </div>
  `);

  if (STANDALONE) renderDevice(root);
  else import('./mobileConnect.js').then((m) => m.renderMobileConnect($('#mobile-body', root)));
  if (!STANDALONE && PHONE_APP_URL) {
    import('../qr.js').then(({ qrSvg }) => mount($('#phone-app-body', root), html`
      <div class="connect">
        <div class="qr-box">${qrSvg(PHONE_APP_URL, { px: 200 })}</div>
        <div class="connect-info">
          <p>スマホのカメラで読み取ると、PC がなくても使えるスマホ単独版が開きます。開いたら<strong>ホーム画面に追加</strong>してください（電波のない場所でも使えます）。</p>
          <p class="small" style="margin-top:6px"><code>${PHONE_APP_URL}</code></p>
          <p class="small muted" style="margin-top:6px">スマホ単独版のデータはスマホの中に保存されます。PC のデータを移すには、上の「写真込みでバックアップ（ZIP）」で作ったファイルをスマホに送り、スマホ側の「設定 → バックアップから復元」で読み込みます。</p>
        </div>
      </div>`));
  }

  const form = $('#settings-form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const saved = await saveSettings({ player_name: form.player_name.value, unit: form.unit.value, theme: form.theme.value });
      applyTheme(saved.theme);
      toast('設定を保存しました');
    } catch (err) { errorToast(err); }
  });
  form.theme.addEventListener('change', () => applyTheme(form.theme.value));

  $('#make-backup', root)?.addEventListener('click', async () => {
    const m = await import('../standalone.js');
    m.runBackupFlow(() => renderDevice(root));
  });

  $('#import', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let info;
    try { info = await inspectBackup(file); } catch (err) { errorToast(err); return; }
    const photoLine = info.kind === 'zip' ? `写真 ${info.photoFiles} 枚` : `写真情報 ${info.photos}（JSON には写真ファイルは含まれません）`;
    const target = STANDALONE ? 'この端末のデータ' : '現在のデータ';
    const ok = await confirmDialog(`バックアップ（${info.date ? fmtDate(info.date) : '日付不明'}）を復元します。\nラウンド ${info.rounds}・コース ${info.courses}・クラブ ${info.clubs}・飛距離 ${info.distances}・${photoLine}\n\n${target}はすべて置き換わります。よろしいですか？`, { danger: true, okText: '復元する' });
    if (!ok) return;
    const busy = openModal({ title: '復元中', body: html`<div class="loading">バックアップを読み込んでいます…</div>` });
    try {
      await restoreBackup(file, info.kind);
      busy.close();
      const s2 = await getSettings(true);
      applyTheme(s2.theme);
      toast('バックアップから復元しました');
      render(root);
    } catch (err) { busy.close(); errorToast(err); }
  });

  $('#sample', root)?.addEventListener('click', async () => {
    try { await api.post('/api/sample'); toast('サンプルデータを読み込みました'); location.hash = '#/'; } catch (e) { errorToast(e); }
  });

  $('#delete-all', root).addEventListener('click', () => {
    const m = openModal({
      title: 'すべてのデータを削除',
      body: html`<p>この操作は元に戻せません。続けるには <strong>DELETE</strong> と入力してください。</p><input id="confirm-text" autocomplete="off" autocapitalize="characters" aria-label="確認文字列">`,
      footer: html`<button class="btn" data-cancel>キャンセル</button><button class="btn btn-danger" data-ok disabled>削除する</button>`,
    });
    const input = $('#confirm-text', m.el);
    const okBtn = $('[data-ok]', m.el);
    input.addEventListener('input', () => { okBtn.disabled = input.value !== 'DELETE'; });
    $('[data-cancel]', m.el).addEventListener('click', () => m.close());
    okBtn.addEventListener('click', async () => {
      try { await api.post('/api/delete-all', { confirm: 'DELETE' }); m.close(); toast('すべてのデータを削除しました'); render(root); } catch (e) { errorToast(e); }
    });
  });
}

// スマホ単独版：保存状態・ホーム画面への追加・最後のバックアップ
async function renderDevice(root) {
  const el = $('#device-body', root);
  if (!el) return;
  const sa = await import('../standalone.js');
  const [st, meta] = await Promise.all([sa.storageStatus(), localMeta()]);
  const installed = sa.isInstalled();
  const last = meta?.last_backup_at ? new Date(meta.last_backup_at) : null;
  const lb = $('#last-backup', root);
  if (lb) lb.textContent = last ? `${fmtDate(localDateTime(last.getTime()).slice(0, 10))}（${Math.floor((Date.now() - last) / 86400000)}日前）` : 'まだありません';
  mount(el, html`
    ${meta?.storageError ? html`<p class="bad" style="margin-bottom:10px">⚠ この環境ではデータを保存できません（プライベートブラウズなど）。通常のモードで開いてください。</p>` : ''}
    <dl class="kv">
      <dt>保存先</dt><dd>この端末の中（インターネット上には保存・送信されません）</dd>
      <dt>ホーム画面</dt><dd>${installed ? html`<span class="badge accent">追加済み</span> アプリとして起動中` : html`<span class="badge warn">未追加</span> <button class="btn btn-sm" id="install-help">${sa.canPromptInstall() ? '追加する' : '追加の方法'}</button>`}</dd>
      <dt>データ保護</dt><dd>${st.persisted === true ? html`<span class="badge accent">有効</span> ブラウザが自動で消すことはありません`
        : st.persisted === false ? html`<span class="badge warn">未確定</span> ホーム画面に追加して使うと保護されやすくなります`
        : '—'}</dd>
      <dt>使用量</dt><dd>${sa.fmtBytes(st.usage)}${meta ? `（ラウンド ${meta.rounds}・写真 ${meta.photos} 枚）` : ''}</dd>
      <dt>オフライン</dt><dd>${'serviceWorker' in navigator && navigator.serviceWorker.controller ? html`<span class="badge accent">対応</span> 電波がなくても使えます` : html`<span class="badge">準備中</span> 一度読み込み直すと有効になります`}</dd>
    </dl>
    ${!installed && sa.isIos() ? html`<p class="small warn-text" style="margin-top:10px">⚠ iPhone では Safari で入力したデータはホーム画面のアプリに引き継がれません。先にホーム画面に追加してください。</p>` : ''}
    <p class="small muted" style="margin-top:10px">写真は容量節約のため、長辺 2048px に縮小して保存します。アプリ（ホーム画面のアイコン）を削除するとデータも消えるので、その前にバックアップを作ってください。</p>`);
  $('#install-help', el)?.addEventListener('click', () => (sa.canPromptInstall() ? sa.promptInstall() : sa.openInstallHelp()));
}
