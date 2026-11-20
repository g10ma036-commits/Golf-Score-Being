// 「スマホで見る」：スマホ（iPhone / Android）からの接続設定
import { html, raw, mount, $, $$, openModal, confirmDialog, toast, errorToast } from '../util.js';
import { api } from '../api.js';
import { qrSvg } from '../qr.js';
import { updatePhoneBadge } from '../main.js';

const HOME_SCREEN_HELP = html`
  <details class="help">
    <summary>ホーム画面に追加してアプリのように使う</summary>
    <ul>
      <li><strong>iPhone（Safari）</strong>：画面下の共有ボタン（□に↑）→「ホーム画面に追加」</li>
      <li><strong>Android（Chrome）</strong>：右上の︙ →「ホーム画面に追加」または「アプリをインストール」</li>
      <li>ホーム画面から初めて開いたときに接続コードを聞かれたら、もう一度入力してください。</li>
    </ul>
  </details>`;

const TROUBLE_HELP = html`
  <details class="help">
    <summary>つながらないときは</summary>
    <ul>
      <li>スマホと PC が<strong>同じ Wi-Fi</strong> につながっているか確認してください（スマホのモバイル通信ではつながりません）。</li>
      <li>初めて許可したとき、PC に「Windows セキュリティの重要な警告」が出ます。<strong>「プライベート ネットワーク」にチェックして「アクセスを許可する」</strong>を押してください。</li>
      <li>うっかり「キャンセル」した場合：Windows セキュリティ →「ファイアウォールとネットワーク保護」→「ファイアウォールによるアプリケーションの許可」で Node.js の「プライベート」にチェック。</li>
      <li>Windows の設定 →「ネットワークとインターネット」→ 接続中の Wi-Fi の「ネットワーク プロファイルの種類」を<strong>「プライベート」</strong>にしてください。</li>
      <li>ゲスト用 Wi-Fi や一部のルーターは端末どうしの通信を禁止しています（AP アイソレーション）。</li>
      <li>PC がスリープすると見られなくなります。使うときはアプリを起動したままにしてください。</li>
    </ul>
  </details>`;

async function waitForServer() {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { return await api.get('/api/lan'); } catch { /* 待ち受け切り替え中 */ }
  }
  throw new Error('サーバーの応答がありません。アプリを再起動してください');
}

export async function renderMobileConnect(el) {
  let st;
  try { st = await api.get('/api/lan'); } catch (e) { mount(el, html`<p class="bad">${e.message}</p>`); return; }

  // スマホから開いている場合
  if (!st.local) {
    mount(el, html`<p>✅ このスマホは接続済みです。PC でアプリが起動していて、同じ Wi-Fi につながっていれば、いつでも見られます。</p>${HOME_SCREEN_HELP}`);
    return;
  }

  const toggle = async (enabled) => {
    try {
      await api.put('/api/lan', { enabled });
      await waitForServer();
      updatePhoneBadge(enabled);
      toast(enabled ? 'スマホからのアクセスを許可しました' : 'スマホからのアクセスをオフにしました');
      renderMobileConnect(el);
    } catch (e) { errorToast(e); }
  };

  if (!st.enabled) {
    mount(el, html`
      <p>PC でこのアプリを起動したまま、<strong>同じ Wi-Fi につながった iPhone / Android</strong> から見たり入力したりできます。</p>
      <ol class="steps">
        <li>下のボタンで「スマホからのアクセス」を許可する</li>
        <li>表示される QR コードを、スマホのカメラで読み取る</li>
      </ol>
      <button class="btn btn-primary" data-enable>スマホからのアクセスを許可する</button>
      <p class="small muted" style="margin-top:10px">初回は PC に Windows ファイアウォールの確認が表示されます。「プライベート ネットワーク」にチェックして「アクセスを許可する」を押してください。<br>
        QR コードか接続コードで登録したスマホだけが見られます。</p>`);
    $('[data-enable]', el).addEventListener('click', () => toggle(true));
    return;
  }

  const addrs = st.addresses || [];
  if (!addrs.length) {
    mount(el, html`<p class="bad">ネットワークのアドレスが見つかりません。PC が Wi-Fi または有線 LAN につながっているか確認してください。</p>
      <button class="btn" data-disable>許可をやめる</button>`);
    $('[data-disable]', el).addEventListener('click', () => toggle(false));
    return;
  }

  let sel = 0;
  const draw = () => {
    const a = addrs[sel];
    mount(el, html`
      <div class="connect">
        <div class="qr-box">${raw(qrSvg(a.pairUrl, { px: 200 }))}</div>
        <div class="connect-info">
          <ol class="steps">
            <li>スマホを <strong>この PC と同じ Wi-Fi</strong> につなぐ</li>
            <li><strong>カメラアプリ</strong>で左の QR コードを読み取り、表示されたリンクを開く（iPhone・Android 共通）</li>
          </ol>
          <dl class="kv" style="margin-top:12px">
            <dt>アドレス</dt><dd><code>${a.url}</code></dd>
            <dt>接続コード</dt><dd><span class="pin">${st.pin}</span></dd>
          </dl>
          <p class="small muted" style="margin-top:8px">QR が読めないときは、スマホのブラウザ（Safari / Chrome）で上のアドレスを開き、接続コードを入力してください。</p>
        </div>
      </div>
      ${addrs.length > 1 ? html`<div class="small" style="margin-top:12px"><span class="muted">別のアドレスで試す：</span>
        ${addrs.map((x, i) => html`<button type="button" class="btn btn-sm ${i === sel ? 'btn-primary' : ''}" data-addr="${i}" title="${x.name}">${x.address}</button> `)}</div>` : ''}
      ${HOME_SCREEN_HELP}
      ${TROUBLE_HELP}
      <div class="actions" style="margin-top:14px">
        <button class="btn" data-reset>接続をリセット</button>
        <button class="btn btn-danger" data-disable ${st.forced ? 'disabled' : ''}>許可をやめる</button>
      </div>
      <p class="small muted" style="margin-top:8px">${st.forced ? '環境変数 GOLF_ALLOW_LAN=1 により常に許可されています。' : ''}
        「接続をリセット」すると QR コードと接続コードが新しくなり、登録済みのスマホはすべて接続し直しになります。</p>`);
    $$('[data-addr]', el).forEach((b) => b.addEventListener('click', () => { sel = Number(b.dataset.addr); draw(); }));
    $('[data-disable]', el).addEventListener('click', () => toggle(false));
    $('[data-reset]', el).addEventListener('click', async () => {
      if (!(await confirmDialog('接続をリセットしますか？\n登録済みのスマホはすべて、QR コードか新しい接続コードで接続し直す必要があります。', { okText: 'リセットする' }))) return;
      try { await api.post('/api/lan/reset'); toast('接続をリセットしました'); renderMobileConnect(el); } catch (e) { errorToast(e); }
    });
  };
  draw();
}

export function openMobileConnect() {
  const m = openModal({ title: '📱 スマホで見る', body: html`<div class="loading">読み込み中…</div>`, wide: true });
  renderMobileConnect(m.body);
}
