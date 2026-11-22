// ラウンド詳細・ラウンド分析
import { html, mount, $, $$, fmt, pct, toPar, signed, fmtDate, icon, confirmDialog, toast, errorToast } from '../util.js';
import { api, getSettings } from '../api.js';
import {
  summarize, aggregate, roundInsights, roundAchievements, achievements as achievementList, holeAnalysis, onCourseHoles, courseHoleNo, resultKey, played, isGir,
  RESULT_KEYS, RESULT_LABELS, resultColor, resultInk,
} from '../stats.js';
import { barChart, segmentedBar, chartCard, setupChart } from '../charts.js';
import { navigate } from '../main.js';
import { dropzoneHtml, bindDropzone, photoGridHtml, openLightbox } from './photoTools.js';

const FW_MARK = { hit: '○', left: '←', right: '→' };

export async function render(root, [idStr]) {
  const id = Number(idStr);
  const [round, rounds, photos, settings] = await Promise.all([
    api.get(`/api/rounds/${id}`),
    api.get('/api/rounds'),
    api.get(`/api/photos?round_id=${id}`),
    getSettings().catch(() => ({})),
  ]);
  // 保存した直後なら、ベスト更新・目標達成などをお祝いする（1 回だけ。再読み込みでは出さない）
  const justSaved = new URLSearchParams(location.hash.split('?')[1] || '').get('saved') === '1';
  if (justSaved) history.replaceState(null, '', `#/rounds/${id}`);
  const sum = summarize(round);
  const others = rounds.filter((r) => r.id !== id);
  const otherSums = others.map(summarize);
  const base = aggregate(otherSums);
  const otherComplete = otherSums.filter((s) => s.complete);
  const isBest = sum.complete && otherComplete.length > 0 && otherComplete.every((s) => s.strokes > sum.strokes);
  const insights = roundInsights(sum, base, { isBest });
  const goal = Number(settings.goal) || null;
  const achievements = justSaved ? roundAchievements(sum, otherSums, goal) : [];
  // このラウンドで新しく達成した「実績」（スコアの節目・バーディはお祝いと重なるので除く）
  const unlocked = justSaved ? (() => {
    const before = new Map(achievementList(others).map((a) => [a.key, a.achieved]));
    return achievementList(rounds).filter((a) => a.achieved && a.round?.id === id && !before.get(a.key) && !/^(u\d+|birdie|eagle|first)$/.test(a.key));
  })() : [];
  if (unlocked.length) achievements.push({ key: 'ach', icon: '🏅', title: `実績を達成：${unlocked.map((a) => a.title).join('・')}`, text: '', link: '#/achievements' });
  const goalHit = goal && sum.complete && sum.strokes < goal;
  const shareBadge = isBest ? '🏆 ベストスコア' : goalHit ? `🎯 ${goal}切り達成` : '';
  const sameCourse = round.course_id ? others.filter((r) => r.course_id === round.course_id) : [];
  // 同じホールどうしで比べる（27 ホールのゴルフ場では、回った 9 ホールの組み合わせが違っても同じホールを集計）
  const courseAvg = sameCourse.length ? holeAnalysis(sameCourse.map(onCourseHoles), 54) : null;
  const holes = Array.from({ length: 18 }, (_, i) => round.holes.find((h) => h.hole_no === i + 1) || { hole_no: i + 1, par: null });

  const half = (from) => {
    const hs = holes.slice(from, from + 9);
    const p = hs.filter(played);
    const total = (k) => hs.reduce((a, h) => a + (Number(h[k]) || 0), 0);
    const fwT = hs.filter((h) => h.par >= 4 && h.fairway).length;
    return html`<table class="scorecard">
      <thead><tr><th>ホール</th>${hs.map((h) => html`<th>${h.hole_no}</th>`)}<th class="sum">${from ? 'IN' : 'OUT'}</th></tr></thead>
      <tbody>
        <tr><td>パー</td>${hs.map((h) => html`<td>${h.par ?? ''}</td>`)}<td class="sum">${total('par') || ''}</td></tr>
        ${hs.some((h) => h.yards) ? html`<tr><td>ヤード</td>${hs.map((h) => html`<td class="muted small">${h.yards ?? ''}</td>`)}<td class="sum small">${total('yards') || ''}</td></tr>` : ''}
        <tr class="row-score"><td>スコア</td>${hs.map((h) => html`<td>${played(h) ? html`<span class="mark ${resultKey(h.strokes, h.par)}" title="${RESULT_LABELS[resultKey(h.strokes, h.par)]}">${h.strokes}</span>` : ''}</td>`)}
          <td class="sum">${p.length ? total('strokes') : ''}</td></tr>
        <tr><td>パット</td>${hs.map((h) => html`<td class="${h.putts >= 3 ? 'bad' : ''}">${h.putts ?? ''}</td>`)}<td class="sum">${hs.some((h) => Number.isFinite(h.putts)) ? total('putts') : ''}</td></tr>
        <tr><td>FW</td>${hs.map((h) => html`<td class="fw-cell ${h.fairway === 'hit' ? 'good' : ''}">${h.par === 3 ? html`<span class="muted">—</span>` : FW_MARK[h.fairway] || ''}</td>`)}
          <td class="sum">${fwT ? `${hs.filter((h) => h.fairway === 'hit').length}/${fwT}` : ''}</td></tr>
        <tr><td>パーオン</td>${hs.map((h) => html`<td>${played(h) && Number.isFinite(h.putts) ? (isGir(h) ? html`<span class="good">●</span>` : html`<span class="muted">·</span>`) : ''}</td>`)}
          <td class="sum">${hs.filter((h) => played(h) && isGir(h)).length || ''}</td></tr>
        <tr><td>OB・ペナ</td>${hs.map((h) => html`<td class="${h.penalties ? 'bad' : ''}">${h.penalties || ''}</td>`)}<td class="sum">${total('penalties') || ''}</td></tr>
        <tr><td>バンカー</td>${hs.map((h) => html`<td>${h.bunker || ''}</td>`)}<td class="sum">${total('bunker') || ''}</td></tr>
        ${courseAvg ? html`<tr><td title="このコースでの他のラウンドの平均">コース平均</td>${hs.map((h) => {
          const a = courseAvg[courseHoleNo(round, h.hole_no) - 1];
          return html`<td class="muted small">${a.n ? a.avg.toFixed(1) : ''}</td>`;
        })}<td class="sum small"></td></tr>` : ''}
      </tbody>
    </table>`;
  };

  // 同伴者のスコア：ランキング（合計の少ない順）とホールごとの表。自分も含める
  const partyCard = () => {
    if (!round.party?.length) return '';
    const sumOf = (arr, from, to) => arr.slice(from, to).reduce((a, v) => a + (v || 0), 0);
    const me = { name: '自分', me: true, strokes: holes.map((h) => (played(h) ? h.strokes : null)) };
    const players = [me, ...round.party].map((p) => ({ ...p, out: sumOf(p.strokes, 0, 9), in: sumOf(p.strokes, 9, 18), n: p.strokes.filter((v) => v != null).length }))
      .map((p) => ({ ...p, total: p.out + p.in }));
    const ranked = [...players].sort((x, y) => (y.n === 18) - (x.n === 18) || x.total - y.total);
    let rank = 0;
    let prev = null;
    ranked.forEach((p, i) => { if (p.total !== prev) { rank = i + 1; prev = p.total; } p.rank = rank; });
    const row = (p, from) => html`<tr class="${p.me ? 'me' : ''}"><td>${p.name}</td>${p.strokes.slice(from, from + 9).map((v, k) => {
      const h = holes[from + k];
      return html`<td>${v != null && h.par ? html`<span class="mark ${resultKey(v, h.par)}">${v}</span>` : v ?? ''}</td>`;
    })}<td class="sum">${from ? p.in || '' : p.out || ''}</td></tr>`;
    const grid = (from) => html`<table class="scorecard party-score"><thead><tr><th>${from ? 'IN' : 'OUT'}</th>${holes.slice(from, from + 9).map((h) => html`<th>${h.hole_no}</th>`)}<th class="sum">計</th></tr>
      <tr class="par-row"><td>パー</td>${holes.slice(from, from + 9).map((h) => html`<td>${h.par ?? ''}</td>`)}<td class="sum">${holes.slice(from, from + 9).reduce((a, h) => a + (h.par || 0), 0) || ''}</td></tr></thead>
      <tbody>${players.map((p) => row(p, from))}</tbody></table>`;
    return html`<div class="card section">
      <div class="card-header"><div><h2>同伴者のスコア</h2><div class="sub">合計の少ない順（18ホールすべて入力した人が先）</div></div></div>
      <ol class="party-rank">${ranked.map((p) => html`<li class="${p.me ? 'me' : ''}"><span class="pr-rank">${p.rank}</span><span class="pr-name">${p.name}</span>
        <span class="pr-detail small muted">${p.n ? `OUT ${p.out || '—'}・IN ${p.in || '—'}${p.n < 18 ? `（${p.n}H）` : ''}` : '未入力'}</span><strong class="pr-total">${p.total || '—'}</strong></li>`)}</ol>
      <div class="table-wrap" style="margin-top:12px">${grid(0)}</div>
      <div class="table-wrap" style="margin-top:8px">${grid(9)}</div>
    </div>`;
  };

  // 今回 vs いつもの自分
  const n18 = (v, h) => (h ? (v / h) * 18 : null);
  const cmpRows = [
    ['スコア', sum.complete ? sum.strokes : null, base.avgScore, 'lower', (v) => fmt(v, v % 1 ? 1 : 0)],
    ['パット（18H換算）', sum.puttHoles ? n18(sum.putts, sum.puttHoles) : null, base.puttsPerRound, 'lower', (v) => fmt(v, 1)],
    ['FWキープ率', sum.fwTotal ? sum.fwHit / sum.fwTotal : null, base.fwRate, 'higher', (v) => pct(v)],
    ['パーオン率', sum.girKnown ? sum.gir / sum.girKnown : null, base.girRate, 'higher', (v) => pct(v)],
    ['ボギーオン率', sum.girKnown ? sum.bogeyOn / sum.girKnown : null, base.bogeyOnRate, 'higher', (v) => pct(v)],
    ['リカバリー率', sum.scrChances ? sum.scrSaves / sum.scrChances : null, base.scrambleRate, 'higher', (v) => pct(v)],
    ['3パット（18H換算）', sum.puttHoles ? n18(sum.threePutts, sum.puttHoles) : null, base.threePuttsPerRound, 'lower', (v) => fmt(v, 1)],
    ['OB・ペナ（18H換算）', sum.holes ? n18(sum.penalties, sum.holes) : null, base.penaltiesPerRound, 'lower', (v) => fmt(v, 1)],
    ['前半', sum.front.holes === 9 ? sum.front.strokes : null, base.frontAvg, 'lower', (v) => fmt(v, v % 1 ? 1 : 0)],
    ['後半', sum.back.holes === 9 ? sum.back.strokes : null, base.backAvg, 'lower', (v) => fmt(v, v % 1 ? 1 : 0)],
  ];
  const isPct = (label) => label.includes('率');

  // 思い出の写真：写真があるときはページの上のほう、ないときは一番下に追加用の枠を出す
  const photoCard = html`<div class="card ${photos.length ? 'photos-top' : 'section'}" id="round-photos">
      <div class="card-header"><div><h2>思い出の写真</h2>${photos.length ? '' : html`<div class="sub">記念撮影やコースの景色などを、このラウンドと一緒に残せます</div>`}</div>
        ${photos.length ? html`<span class="muted small">${photos.length} 枚</span>` : ''}</div>
      ${photos.length ? photoGridHtml(photos) : ''}
      <div style="margin-top:${photos.length ? '12px' : '0'}">${dropzoneHtml('写真をドラッグ＆ドロップ、またはクリックして追加')}</div>
    </div>`;

  mount(root, html`
    <div class="page-header">
      <div>
        <a class="small" href="#/rounds">← ラウンド一覧</a>
        <h1>${fmtDate(round.date)}　${round.course_id ? html`<a href="#/courses/${round.course_id}" style="color:inherit">${round.course_name}</a>` : round.course_name}</h1>
        <div class="sub">${[round.nines_label, round.tee && `${round.tee}ティー`, round.weather, round.companions && `同伴：${round.companions}`].filter(Boolean).join('　・　')}</div>
      </div>
      <div class="actions act-grid">
        <button class="btn" id="share-card">${icon('share')}画像で共有</button>
        <a class="btn" href="#/ai?purpose=round&amp;round=${id}">${icon('ai')}AIで振り返り</a>
        <button class="btn" id="add-photo">${icon('photo')}写真を追加</button>
        <a class="btn" href="#/rounds/${id}/edit">${icon('edit')}編集</a>
      </div>
    </div>

    ${achievements.length ? html`<div class="celebrate" role="status">
      <div class="cel-items">${achievements.map((a) => html`<div class="cel-item"><span class="cel-ico" aria-hidden="true">${a.icon}</span><div><strong>${a.title}</strong>${a.text ? html`<div class="small">${a.text}</div>` : ''}${a.link ? html`<div class="small"><a href="${a.link}">実績を見る →</a></div>` : ''}</div></div>`)}</div>
      <div class="cel-actions"><button class="btn btn-sm btn-primary" data-cel-share>${icon('share')}画像で共有</button><a class="btn btn-sm" href="#/ai?purpose=round&amp;round=${id}">${icon('ai')}AIで振り返り</a></div>
    </div>` : ''}

    ${photos.length ? photoCard : ''}

    <div class="grid grid-3">
      <div class="card">
        <div class="hero-label">スコア${sum.complete ? '' : `（${sum.holes}ホール）`}</div>
        <div class="hero"><div class="hero-value">${sum.holes ? sum.strokes : '—'}</div>
          <div style="margin-bottom:6px"><div style="font-size:20px;font-weight:650">${sum.holes ? toPar(sum.toPar) : ''}</div><div class="small muted">パー ${sum.par || '—'}</div></div></div>
        ${isBest ? html`<p style="margin-top:8px"><span class="badge accent">🏆 ベストスコア</span></p>` : ''}
        <div class="small secondary" style="margin-top:8px">OUT ${sum.front.holes ? sum.front.strokes : '—'} ／ IN ${sum.back.holes ? sum.back.strokes : '—'}</div>
      </div>
      <div class="tiles span-2" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
        ${tile('パット', sum.puttHoles ? sum.putts : '—', sum.puttHoles ? `1パット ${sum.onePutts}・3パット ${sum.threePutts}` : '')}
        ${tile('FWキープ率', sum.fwTotal ? pct(sum.fwHit / sum.fwTotal) : '—', sum.fwTotal ? `${sum.fwHit}/${sum.fwTotal}（左${sum.fwLeft}・右${sum.fwRight}）` : '')}
        ${tile('パーオン率', sum.girKnown ? pct(sum.gir / sum.girKnown) : '—', sum.girKnown ? `${sum.gir}/${sum.girKnown}` : '')}
        ${tile('リカバリー率', sum.scrChances ? pct(sum.scrSaves / sum.scrChances) : '—', 'パーオンせずパー以上')}
        ${tile('OB・ペナルティ', sum.holes ? sum.penalties : '—')}
        ${tile('バーディ以上', sum.results.eagle + sum.results.birdie, `パー ${sum.results.par}・ボギー ${sum.results.bogey}`)}
      </div>
    </div>

    <div class="card section">
      <div class="card-header"><h2>スコアカード</h2>
        <div class="legend" style="margin:0"><span class="key"><span class="mark birdie" style="width:18px;height:18px;font-size:10px">3</span>バーディ</span>
          <span class="key"><span class="mark bogey" style="width:18px;height:18px;font-size:10px">5</span>ボギー</span>
          <span class="key"><span class="mark double" style="width:18px;height:18px;font-size:10px">6</span>ダブル</span>
          <span class="key"><span class="mark triple" style="width:18px;height:18px;font-size:10px">7</span>トリプル以上</span></div></div>
      <div class="table-wrap">${half(0)}</div>
      <div class="table-wrap" style="margin-top:12px">${half(9)}</div>
    </div>

    ${holes.some((h) => h.note) ? html`<div class="card section"><h2 style="margin-bottom:8px">✏️ ホールの振り返りメモ</h2>
      <ul class="memo-list">${holes.filter((h) => h.note).map((h) => html`<li><span class="memo-no">${h.hole_no}番</span><span class="small muted">Par ${h.par}${played(h) ? `・${h.strokes}（${RESULT_LABELS[resultKey(h.strokes, h.par)]}）` : ''}</span><span>${h.note}</span></li>`)}</ul></div>` : ''}

    ${partyCard()}

    <div class="grid grid-2 section">
      ${chartCard('holes', 'ホール別 パー比', '棒の色はスコア結果（青＝アンダー、赤＝オーバー）')}
      <div class="card" data-chart="dist">
        <div class="card-header"><div><h2>スコア内訳</h2><div class="sub">${sum.holes} ホールの結果</div></div></div>
        <div class="chart"></div>
        <h3 style="margin:20px 0 6px">パー別の平均</h3>
        <div class="table-wrap"><table class="data"><thead><tr><th></th><th class="r">今回</th><th class="r">いつもの平均</th><th class="r">差</th></tr></thead>
          <tbody>${[3, 4, 5].map((p) => {
            const bp = sum.byPar[p];
            const cur = bp.n ? (bp.strokes - bp.par) / bp.n : null;
            const avg = base.byPar[p].toPar;
            const d = cur != null && avg != null ? cur - avg : null;
            return html`<tr><td>パー${p}（${bp.n}H）</td><td class="r">${cur != null ? toPar(Math.round(cur * 100) / 100) : '—'}</td>
              <td class="r">${avg != null ? toPar(Math.round(avg * 100) / 100) : '—'}</td>
              <td class="r ${d == null ? '' : d < -0.05 ? 'good' : d > 0.05 ? 'bad' : ''}">${d != null ? signed(d, 2) : '—'}</td></tr>`;
          })}</tbody></table></div>
      </div>
    </div>

    <div class="grid grid-2 section">
      <div class="card">
        <div class="card-header"><div><h2>今回 vs いつもの自分</h2><div class="sub">他の ${others.length} ラウンドの平均と比較</div></div>
          ${others.length ? html`<a class="btn btn-sm" href="#/compare?a=${id}">ほかのラウンドと比べる</a>` : ''}</div>
        ${others.length ? html`<div class="table-wrap"><table class="data"><thead><tr><th></th><th class="r">今回</th><th class="r">平均</th><th class="r">差</th></tr></thead><tbody>
          ${cmpRows.map(([label, cur, avg, better, f]) => {
            const d = cur != null && avg != null ? cur - avg : null;
            const good = d != null && (better === 'lower' ? d < 0 : d > 0);
            const badv = d != null && (better === 'lower' ? d > 0 : d < 0);
            const ds = d == null ? '—' : isPct(label) ? `${d > 0 ? '+' : ''}${Math.round(d * 100)}pt` : signed(d, 1);
            return html`<tr><td>${label}</td><td class="r"><strong>${cur != null ? f(cur) : '—'}</strong></td><td class="r">${avg != null ? f(avg) : '—'}</td>
              <td class="r ${Math.abs(d ?? 0) < 1e-9 ? '' : good ? 'good' : badv ? 'bad' : ''}">${ds}</td></tr>`;
          })}</tbody></table></div>` : html`<p class="muted small">比較できる他のラウンドがまだありません。</p>`}
      </div>
      <div class="card">
        <h2 style="margin-bottom:12px">振り返りコメント</h2>
        <ul class="insights">${insights.map((it) => html`<li><span class="ico ${it.type}">${it.type === 'good' ? '✓' : it.type === 'bad' ? '!' : 'i'}</span><span>${it.text}</span></li>`)}</ul>
        ${round.memo ? html`<h3 style="margin:16px 0 6px">メモ</h3><p style="white-space:pre-wrap" class="secondary">${round.memo}</p>` : ''}
      </div>
    </div>

    ${photos.length ? '' : photoCard}

    <div class="danger-zone"><button class="btn btn-sm btn-danger" id="del">${icon('trash')}このラウンドを削除</button></div>
  `);

  $('#del', root).addEventListener('click', async () => {
    const ok = await confirmDialog(`${fmtDate(round.date)} ${round.course_name} のラウンドを削除しますか？\n関連付けた写真は削除されず、アルバムに残ります。`, { danger: true, okText: '削除する' });
    if (!ok) return;
    try { await api.del(`/api/rounds/${id}`); toast('ラウンドを削除しました'); navigate('/rounds'); } catch (e) { errorToast(e); }
  });
  bindDropzone($('.dropzone', root), { roundId: id }, () => render(root, [idStr]));
  $('#add-photo', root).addEventListener('click', () => $('#round-photos input[type=file]', root).click());
  $('[data-cel-share]', root)?.addEventListener('click', () => $('#share-card', root).click());
  $('#share-card', root).addEventListener('click', async () => {
    (await import('./shareCard.js')).openShareCard(round, photos, { badge: shareBadge });
  });
  $$('.photo-grid .ph', root).forEach((b) => b.addEventListener('click', () => openLightbox(photos, Number(b.dataset.idx), { onChanged: () => render(root, [idStr]) })));

  const playedHoles = holes.filter(played);
  setupChart(root, 'holes', (el) => barChart(el, {
    bars: holes.map((h) => {
      if (!played(h)) return { label: String(h.hole_no), value: null };
      const k = resultKey(h.strokes, h.par);
      return {
        label: String(h.hole_no),
        value: h.strokes - h.par,
        color: resultColor(k),
        title: `${h.hole_no}番 Par${h.par}`,
        tip: [{ value: `${h.strokes} 打`, label: RESULT_LABELS[k], color: resultColor(k), swatch: true }, ...(Number.isFinite(h.putts) ? [{ value: `${h.putts} パット` }] : [])],
      };
    }),
    yFormat: (v) => (v > 0 ? `+${v}` : String(v)),
    valueLabels: (b) => Math.abs(b.value) >= 2,
    ariaLabel: 'ホール別パー比',
  }), {
    columns: [{ label: 'ホール' }, { label: 'パー', align: 'r' }, { label: 'スコア', align: 'r' }, { label: 'パー比', align: 'r' }, { label: '結果' }],
    rows: playedHoles.map((h) => [String(h.hole_no), String(h.par), String(h.strokes), toPar(h.strokes - h.par), RESULT_LABELS[resultKey(h.strokes, h.par)]]),
  });
  const distEl = $('[data-chart="dist"] .chart', root);
  segmentedBar(distEl, {
    parts: RESULT_KEYS.map((k) => ({ label: RESULT_LABELS[k], value: sum.results[k], color: resultColor(k), ink: resultInk(k) })),
    format: (v) => `${v}H`,
    ariaLabel: 'スコア内訳',
  });
}

function tile(label, value, sub = '') {
  return html`<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${sub}</div></div>`;
}
