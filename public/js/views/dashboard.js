// ホーム（ダッシュボード）
import { html, mount, $, $$, fmt, pct, toPar, fmtDate, shortDate, icon, errorToast } from '../util.js';
import { api, getSettings, photoUrl, STANDALONE } from '../api.js';
import { summarize, aggregate, movingAverage, trendInsights } from '../stats.js';
import { lineChart, chartCard, setupChart } from '../charts.js';
import { navigate } from '../main.js';
import { sampleNoticeHtml, loadSample, deleteSampleFlow } from './sampleTools.js';
import { loadDraft, clearDraft, draftText, draftHref } from '../draft.js';
import { goalCardHtml, guideHtml, bindHomeCards } from './homeCards.js';

export async function render(root) {
  const [rounds, clubs, photos, settings, sample, courses] = await Promise.all([
    api.get('/api/rounds'),
    api.get('/api/clubs'),
    api.get('/api/photos?limit=8'),
    getSettings(),
    api.get('/api/sample').catch(() => null),
    api.get('/api/courses'),
  ]);
  // 入力途中のラウンド（編集中のラウンドが削除されていたら下書きも捨てる）
  let draft = loadDraft();
  if (draft?.edit_id && !rounds.some((r) => r.id === draft.edit_id)) { clearDraft(); draft = null; }
  const draftNotice = draft ? html`<div class="notice draft-notice" id="draft-notice">
    <span>📝 入力途中のラウンドがあります：${draftText(draft)}</span>
    <a class="btn btn-sm btn-primary" href="${draftHref(draft)}">続きを入力</a></div>` : '';
  const guide = await guideHtml({ rounds, courses, sample });
  // スマホ単独版：バックアップのお知らせ（サンプルデータしかないときは出さない）
  const onlySample = sample?.present && sample.counts.rounds >= rounds.length && !photos.length;
  const reminder = STANDALONE && !onlySample ? await import('../standalone.js').then((m) => m.backupReminder()).catch(() => null) : null;
  const name = settings.player_name;

  if (!rounds.length) {
    const canSample = !clubs.length;
    mount(root, html`
      <div class="page-header"><div><h1>${name ? `${name} さん、ようこそ` : 'ようこそ'} ⛳</h1>
        <div class="sub">スコア・統計・アルバム・クラブ・飛距離をまとめて管理できます</div></div></div>
      ${draftNotice}
      ${sampleNoticeHtml(sample)}
      ${guide}
      <div class="card empty section">
        ${icon('score')}
        <h2>まだラウンドが記録されていません</h2>
        <p>最初のスコアを入力してみましょう。コースは入力画面から登録できます。</p>
        <div class="actions" style="justify-content:center">
          <a class="btn btn-primary" href="#/rounds/new">${icon('plus')}スコアを入力</a>
          <a class="btn" href="#/clubs">クラブを登録</a>
          ${canSample ? html`<button class="btn" id="sample">サンプルデータで試す</button>` : ''}
        </div>
      </div>`);
    $('#sample', root)?.addEventListener('click', async () => {
      try { await loadSample(); render(root); } catch (e) { errorToast(e); }
    });
    $('[data-delete-sample]', root)?.addEventListener('click', async () => { if (await deleteSampleFlow()) render(root); });
    bindHomeCards(root, { sums: [], settings, rerender: () => render(root) });
    return;
  }

  const sums = rounds.map(summarize);
  const all = aggregate(sums);
  const complete = sums.filter((s) => s.complete).sort((a, b) => a.date.localeCompare(b.date));
  const recent5 = aggregate(complete.slice(-5));
  const thisYear = sums.filter((s) => s.date.startsWith(String(new Date().getFullYear()))).length;
  const inBag = clubs.filter((c) => c.in_bag).length;
  const trend = complete.slice(-20);
  const insights = trendInsights(sums);
  const heroDelta = recent5.avgScore != null && all.avgScore != null ? recent5.avgScore - all.avgScore : null;

  mount(root, html`
    <div class="page-header">
      <div><h1>${name ? `${name} さんのホーム` : 'ホーム'}</h1><div class="sub">最新ラウンド：${fmtDate(rounds[0].date)} ${rounds[0].course_name}</div></div>
      <div class="actions">
        <a class="btn" href="#/distances">${icon('distance')}飛距離を記録</a>
        <a class="btn btn-primary" href="#/rounds/new">${icon('plus')}スコアを入力</a>
      </div>
    </div>
    ${draftNotice}
    ${sampleNoticeHtml(sample)}
    ${guide}
    ${reminder ? html`<div class="notice" id="backup-notice">
      <span>💾 ${reminder.days == null ? 'まだバックアップがありません' : `最後のバックアップから ${reminder.days} 日たっています`}。故障や機種変更に備えて、写真込みのバックアップを作っておきましょう。</span>
      <button class="btn btn-sm btn-primary" id="do-backup">バックアップする</button></div>` : ''}

    <div class="grid grid-3">
      <div class="card">
        <div class="hero-label">直近5ラウンドの平均スコア</div>
        <div class="hero"><div class="hero-value">${fmt(recent5.avgScore, 1)}</div></div>
        <div class="small secondary" style="margin-top:8px">
          ${heroDelta != null ? html`全期間平均 ${fmt(all.avgScore, 1)} より <strong class="${heroDelta <= 0 ? 'good' : 'bad'}">${heroDelta <= 0 ? '▼' : '▲'} ${Math.abs(heroDelta).toFixed(1)}</strong>` : ''}
        </div>
      </div>
      <div class="tiles span-2" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
        ${tile('ベストスコア', all.best ? all.best.strokes : '—', all.best ? `${shortDate(all.best.date)} ${all.best.course}` : '')}
        ${tile('推定ハンディキャップ', all.handicap != null ? all.handicap.toFixed(1) : '—', all.handicap != null ? '簡易計算' : '18Hを3R以上で算出')}
        ${tile('平均パット', fmt(all.puttsPerRound, 1), '18ホール換算')}
        ${tile('FWキープ率', pct(all.fwRate), 'パー4・5のティーショット')}
        ${tile('パーオン率', pct(all.girRate), '規定打数-2 でオン')}
        ${tile('今年のラウンド', thisYear, `通算 ${rounds.length} ラウンド`)}
      </div>
    </div>

    <div class="section">${goalCardHtml(sums, settings.goal)}</div>

    <div class="quick-links section">
      <a class="quick-link" href="#/review"><span class="ql-ico">🗓</span><span><strong>${new Date().getFullYear()}年のまとめ</strong><span class="small muted">ラウンド数・ベスト・前年比・記録</span></span></a>
      <a class="quick-link" href="#/ai"><span class="ql-ico">✨</span><span><strong>AIに分析してもらう</strong><span class="small muted">練習メニュー・コース攻略などを相談</span></span></a>
    </div>

    <div class="grid grid-3 section">
      ${chartCard('trend', 'スコアの推移', `直近 ${trend.length} ラウンド（18ホール）・点をクリックで詳細`, 'span-2')}
      <div class="card">
        <div class="card-header"><h2>直近の傾向</h2><a class="small" href="#/stats">統計分析へ →</a></div>
        ${insights.length ? html`<ul class="insights">${insights.map((i) => html`<li><span class="ico ${i.type}">${i.type === 'good' ? '↑' : '↓'}</span><span>${i.text}</span></li>`)}</ul>`
          : html`<p class="muted small">18ホールのラウンドが6つ以上になると、直近5ラウンドと以前の比較が表示されます。</p>`}
      </div>
    </div>

    <div class="grid grid-3 section">
      <div class="card span-2">
        <div class="card-header"><h2>最近のラウンド</h2><a class="small" href="#/rounds">すべて見る →</a></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>日付</th><th>コース</th><th class="r">スコア</th><th class="r">パー比</th><th class="r">パット</th></tr></thead>
          <tbody>${sums.slice(0, 6).map((s) => html`<tr class="link" data-id="${s.id}">
            <td>${fmtDate(s.date)}</td><td class="wrap">${s.course}</td>
            <td class="r"><strong>${s.holes ? s.strokes : '—'}</strong>${s.holes && !s.complete ? html` <span class="badge">${s.holes}H</span>` : ''}</td>
            <td class="r">${s.holes ? toPar(s.toPar) : '—'}</td>
            <td class="r">${s.puttHoles ? s.putts : '—'}</td></tr>`)}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-header"><h2>クラブセッティング</h2><a class="small" href="#/clubs">編集 →</a></div>
        <div class="count-14">${inBag}<small class="secondary" style="font-size:14px"> / 14 本</small></div>
        ${inBag > 14 ? html`<p><span class="badge warn">⚠ 15本以上（競技では14本まで）</span></p>` : ''}
        <p class="small secondary">${clubs.filter((c) => c.in_bag).map((c) => c.name).join('・') || 'クラブが未登録です'}</p>
      </div>
    </div>

    <div class="card section">
      <div class="card-header"><h2>最近の写真</h2><a class="small" href="#/album">アルバムへ →</a></div>
      ${photos.length ? html`<div class="photo-grid">${photos.map((p) => html`<a class="ph" href="#/album/${p.album_id || 'all'}"><img src="${photoUrl(p)}" alt="${p.caption || '写真'}" loading="lazy"></a>`)}</div>`
        : html`<p class="muted small">写真はまだありません。アルバムやラウンド詳細から追加できます。</p>`}
    </div>
  `);

  $$('tr[data-id]', root).forEach((tr) => tr.addEventListener('click', () => navigate(`/rounds/${tr.dataset.id}`)));
  $('[data-delete-sample]', root)?.addEventListener('click', async () => { if (await deleteSampleFlow()) render(root); });
  bindHomeCards(root, { sums, settings, rerender: () => render(root) });
  $('#do-backup', root)?.addEventListener('click', async () => {
    (await import('../standalone.js')).runBackupFlow(() => $('#backup-notice', root)?.remove());
  });

  const scores = trend.map((s) => s.strokes);
  const ma = movingAverage(complete.map((s) => s.strokes), 5).slice(-trend.length);
  setupChart(root, 'trend', (el) => lineChart(el, {
    labels: trend.map((s) => shortDate(s.date)),
    series: [
      { name: 'スコア', color: 'var(--series-1)', values: scores },
      { name: '5ラウンド移動平均', color: 'var(--series-2)', values: ma, dots: false },
    ],
    tooltipTitle: (i) => `${fmtDate(trend[i].date)} ${trend[i].course}`,
    onClick: (i) => navigate(`/rounds/${trend[i].id}`),
    ariaLabel: 'スコアの推移',
  }), {
    columns: [{ label: '日付' }, { label: 'コース' }, { label: 'スコア', align: 'r' }, { label: '5R平均', align: 'r' }],
    rows: trend.map((s, i) => [fmtDate(s.date), s.course, String(s.strokes), fmt(ma[i], 1)]),
  });
}

function tile(label, value, sub = '') {
  return html`<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${sub}</div></div>`;
}
