// 飛距離の記録・分析
import { html, mount, $, $$, fmt, fmtDate, shortDate, today, icon, openModal, confirmDialog, toast, errorToast, numOrNull, PLACES, placeLabel } from '../util.js';
import { api, getSettings, unit } from '../api.js';
import { rangeChart, lineChart, chartCard, setupChart, clearCharts } from '../charts.js';

const state = { club: '', place: '', period: 'all' };
const PERIOD_OPTS = [['all', '全期間'], ['90', '直近90日'], ['30', '直近30日']];

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
// 「150 148, 152」のような入力を数値の配列に
const parseList = (s) => String(s || '').split(/[\s,、，]+/).filter(Boolean).map(Number);

export async function render(root) {
  await getSettings();
  const u = unit();
  const clubs = (await api.get('/api/clubs')).filter((c) => c.category !== 'putter');
  if (!clubs.length) {
    mount(root, html`<div class="page-header"><h1>飛距離</h1></div>
      <div class="card empty">${icon('club')}<h2>クラブが登録されていません</h2><p>先にクラブセッティングでクラブを登録してください。</p>
      <a class="btn btn-primary" href="#/clubs">クラブセッティングへ</a></div>`);
    return;
  }
  const bag = clubs.filter((c) => c.in_bag);
  const stored = clubs.filter((c) => !c.in_bag);
  const clubOptions = (sel) => html`
    <optgroup label="バッグ内">${bag.map((c) => html`<option value="${c.id}" ${String(c.id) === String(sel) ? 'selected' : ''}>${c.name}</option>`)}</optgroup>
    ${stored.length ? html`<optgroup label="保管中">${stored.map((c) => html`<option value="${c.id}" ${String(c.id) === String(sel) ? 'selected' : ''}>${c.name}</option>`)}</optgroup>` : ''}`;
  const defaultClub = state.club || bag.find((c) => c.name === '7I')?.id || bag[0]?.id || clubs[0].id;

  mount(root, html`
    <div class="page-header"><div><h1>飛距離</h1><div class="sub">練習場・コース・シミュレーターでの飛距離を記録して、番手ごとの実力を把握します</div></div></div>
    <div class="card">
      <h2 style="margin-bottom:12px">飛距離を記録する</h2>
      <form id="dist-form" autocomplete="off"><div class="form-grid">
        <label class="field"><span>日付</span><input type="date" name="date" value="${today()}" required></label>
        <label class="field"><span>クラブ</span><select name="club_id" required>${clubOptions(defaultClub)}</select></label>
        <label class="field"><span>キャリー（${u}）</span><input name="carry" inputmode="decimal" placeholder="例: 150 または 148 152 150"></label>
        <label class="field"><span>トータル（${u}・任意）</span><input name="total" inputmode="decimal" placeholder="キャリーと同じ数だけ"></label>
        <label class="field"><span>場所</span><select name="place">${PLACES.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
        <label class="field"><span>メモ</span><input name="memo" maxlength="500" placeholder="風・ライなど"></label>
      </div>
      <div class="form-actions" style="justify-content:space-between;align-items:center">
        <span class="small muted">複数の球はスペースまたはカンマ区切りでまとめて入力できます</span>
        <button class="btn btn-primary" type="submit">${icon('plus')}記録する</button>
      </div></form>
    </div>
    <div class="toolbar section">
      <select id="f-club" aria-label="クラブで絞り込み"><option value="">すべてのクラブ</option>${clubOptions(state.club)}</select>
      <select id="f-place" aria-label="場所で絞り込み"><option value="">すべての場所</option>${PLACES.map(([k, l]) => html`<option value="${k}" ${state.place === k ? 'selected' : ''}>${l}</option>`)}</select>
      <div class="seg" role="group" aria-label="期間">${PERIOD_OPTS.map(([k, l]) => html`<button data-period="${k}" class="${state.period === k ? 'on' : ''}">${l}</button>`)}</div>
    </div>
    <div id="body"></div>
  `);

  const body = $('#body', root);
  let records = [];
  let limit = window.matchMedia('(max-width: 760px)').matches ? 20 : 50; // スマホは画面が長くなりすぎないように

  const load = async () => {
    records = await api.get('/api/distances');
    draw();
  };

  const draw = () => {
    clearCharts();
    let list = records;
    if (state.club) list = list.filter((r) => String(r.club_id) === state.club);
    if (state.place) list = list.filter((r) => r.place === state.place);
    if (state.period !== 'all') {
      const d = new Date();
      d.setDate(d.getDate() - Number(state.period));
      const iso = d.toISOString().slice(0, 10);
      list = list.filter((r) => r.date >= iso);
    }
    if (!list.length) {
      mount(body, html`<div class="card empty">${icon('distance')}<h2>記録がありません</h2><p>上のフォームから飛距離を記録してください。</p></div>`);
      return;
    }
    const order = clubs.map((c) => c.id);
    const byClub = new Map();
    for (const r of list) {
      if (!byClub.has(r.club_id)) byClub.set(r.club_id, []);
      byClub.get(r.club_id).push(r);
    }
    const stats = [...byClub.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([cid, rs]) => {
      const c = clubs.find((x) => x.id === cid);
      const carries = rs.map((r) => r.carry).filter(Number.isFinite);
      const totals = rs.map((r) => r.total).filter(Number.isFinite);
      return {
        club: c, n: rs.length,
        avg: mean(carries), max: carries.length ? Math.max(...carries) : null, min: carries.length ? Math.min(...carries) : null, sd: sd(carries),
        avgTotal: mean(totals), maxTotal: totals.length ? Math.max(...totals) : null, carryN: carries.length,
      };
    });

    // 選択したクラブの推移（日ごとの平均）
    let trend = null;
    if (state.club) {
      const byDate = new Map();
      for (const r of list) {
        if (!byDate.has(r.date)) byDate.set(r.date, { c: [], t: [] });
        if (Number.isFinite(r.carry)) byDate.get(r.date).c.push(r.carry);
        if (Number.isFinite(r.total)) byDate.get(r.date).t.push(r.total);
      }
      trend = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ d, carry: mean(v.c), total: mean(v.t), n: Math.max(v.c.length, v.t.length) }));
    }

    const f0 = (v) => (v == null ? '—' : `${Math.round(v)}`);
    mount(body, html`
      <div class="grid grid-2">
        ${chartCard('range', '番手別の飛距離（キャリー）', '帯＝最小〜最大、点＝平均')}
        <div class="card">
          <h2 style="margin-bottom:8px">番手別の集計</h2>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>番手</th><th class="r">記録数</th><th class="r">平均キャリー</th><th class="r">平均トータル</th><th class="r">最大</th><th class="r">最小</th><th class="r" title="標準偏差：小さいほど安定">ばらつき</th></tr></thead>
            <tbody>${stats.map((s) => html`<tr><td><strong>${s.club.name}</strong></td><td class="r">${s.n}</td><td class="r"><strong>${f0(s.avg)}</strong></td>
              <td class="r">${f0(s.avgTotal)}</td><td class="r">${f0(s.max)}</td><td class="r">${f0(s.min)}</td><td class="r">${s.sd != null ? `±${s.sd.toFixed(1)}` : '—'}</td></tr>`)}</tbody>
          </table></div>
          <p class="small muted" style="margin-top:8px">単位：${u}。ばらつき（標準偏差）が小さいほど距離が安定しています。</p>
        </div>
      </div>
      ${trend && trend.length >= 2 ? chartCard('trend', `${clubs.find((c) => String(c.id) === state.club).name} の飛距離の推移`, '日ごとの平均', 'section') : ''}
      <div class="card section">
        <div class="card-header"><h2>記録一覧</h2><span class="muted small">${list.length} 件${list.length > limit ? `（最新 ${limit} 件を表示）` : ''}</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>日付</th><th>クラブ</th><th class="r">キャリー</th><th class="r">トータル</th><th>場所</th><th>メモ</th><th></th></tr></thead>
          <tbody>${list.slice(0, limit).map((r) => html`<tr><td>${fmtDate(r.date)}</td><td>${r.club_name}</td><td class="r">${r.carry ?? '—'}</td><td class="r">${r.total ?? '—'}</td>
            <td>${placeLabel(r.place)}</td><td class="secondary">${r.memo || ''}</td>
            <td class="r nowrap"><button class="btn btn-sm" data-edit="${r.id}">編集</button>
            <button class="btn btn-sm btn-ghost btn-icon btn-danger" data-del="${r.id}" aria-label="削除">${icon('trash')}</button></td></tr>`)}</tbody>
        </table></div>
        ${list.length > limit ? html`<div style="text-align:center;margin-top:12px"><button class="btn" id="more">さらに表示（残り ${list.length - limit} 件）</button></div>` : ''}
      </div>
    `);
    $('#more', body)?.addEventListener('click', () => { limit += 100; draw(); });

    setupChart(body, 'range', (el) => rangeChart(el, {
      rows: stats.filter((s) => s.carryN).map((s) => ({ label: s.club.name, min: s.min, max: s.max, avg: s.avg, n: s.carryN })),
      format: (v) => `${Math.round(v)}`,
      ariaLabel: '番手別の飛距離',
    }), {
      columns: [{ label: '番手' }, { label: '平均', align: 'r' }, { label: '最小', align: 'r' }, { label: '最大', align: 'r' }, { label: '記録数', align: 'r' }],
      rows: stats.filter((s) => s.carryN).map((s) => [s.club.name, f0(s.avg), f0(s.min), f0(s.max), String(s.carryN)]),
    });
    if (trend && trend.length >= 2) {
      const hasTotal = trend.some((t) => Number.isFinite(t.total));
      setupChart(body, 'trend', (el) => lineChart(el, {
        labels: trend.map((t) => shortDate(t.d)),
        series: [
          { name: 'キャリー', color: 'var(--series-1)', values: trend.map((t) => t.carry) },
          ...(hasTotal ? [{ name: 'トータル', color: 'var(--series-2)', values: trend.map((t) => t.total) }] : []),
        ],
        yFormat: (v) => `${Math.round(v)}`,
        tooltipTitle: (i) => `${fmtDate(trend[i].d)}（${trend[i].n} 球）`,
        height: 220,
        ariaLabel: '飛距離の推移',
      }), {
        columns: [{ label: '日付' }, { label: 'キャリー', align: 'r' }, { label: 'トータル', align: 'r' }, { label: '球数', align: 'r' }],
        rows: trend.map((t) => [fmtDate(t.d), fmt(t.carry, 1), fmt(t.total, 1), String(t.n)]),
      });
    }

    $$('[data-del]', body).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('この記録を削除しますか？', { danger: true, okText: '削除する' }))) return;
      try { await api.del(`/api/distances/${b.dataset.del}`); load(); } catch (e) { errorToast(e); }
    }));
    $$('[data-edit]', body).forEach((b) => b.addEventListener('click', () => {
      const r = records.find((x) => x.id === Number(b.dataset.edit));
      const m = openModal({
        title: '飛距離の記録を編集',
        body: html`<form id="edit-dist"><div class="form-grid">
          <label class="field"><span>日付</span><input type="date" name="date" value="${r.date}" required></label>
          <label class="field"><span>クラブ</span><select name="club_id">${clubOptions(r.club_id)}</select></label>
          <label class="field"><span>キャリー</span><input type="number" step="0.1" name="carry" value="${r.carry ?? ''}"></label>
          <label class="field"><span>トータル</span><input type="number" step="0.1" name="total" value="${r.total ?? ''}"></label>
          <label class="field"><span>場所</span><select name="place">${PLACES.map(([k, l]) => html`<option value="${k}" ${r.place === k ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label class="field"><span>メモ</span><input name="memo" maxlength="500" value="${r.memo || ''}"></label>
        </div></form>`,
        footer: html`<button class="btn" data-cancel>キャンセル</button><button class="btn btn-primary" data-save>保存</button>`,
      });
      $('[data-cancel]', m.el).addEventListener('click', () => m.close());
      $('[data-save]', m.el).addEventListener('click', async () => {
        const f = $('#edit-dist', m.el);
        try {
          await api.put(`/api/distances/${r.id}`, {
            date: f.date.value, club_id: Number(f.club_id.value), carry: numOrNull(f.carry.value), total: numOrNull(f.total.value), place: f.place.value, memo: f.memo.value,
          });
          m.close();
          toast('記録を更新しました');
          load();
        } catch (e) { errorToast(e); }
      });
    }));
  };

  const form = $('#dist-form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const carries = parseList(form.carry.value);
    const totals = parseList(form.total.value);
    if (!carries.length && !totals.length) { errorToast('キャリーかトータルを入力してください'); form.carry.focus(); return; }
    if ([...carries, ...totals].some((v) => !Number.isFinite(v) || v < 0)) { errorToast('数値で入力してください'); return; }
    if (carries.length && totals.length && carries.length !== totals.length) { errorToast(`キャリー（${carries.length}球）とトータル（${totals.length}球）の数が一致しません`); return; }
    const n = Math.max(carries.length, totals.length);
    const records2 = Array.from({ length: n }, (_, i) => ({
      club_id: Number(form.club_id.value), date: form.date.value, carry: carries[i] ?? null, total: totals[i] ?? null, place: form.place.value, memo: form.memo.value,
    }));
    try {
      const res = await api.post('/api/distances', { records: records2 });
      toast(`${res.inserted} 球を記録しました`);
      form.carry.value = '';
      form.total.value = '';
      form.carry.focus();
      load();
    } catch (err) { errorToast(err); }
  });
  $('#f-club', root).addEventListener('change', (e) => {
    state.club = e.target.value;
    if (state.club) form.club_id.value = state.club;
    draw();
  });
  $('#f-place', root).addEventListener('change', (e) => { state.place = e.target.value; draw(); });
  $$('[data-period]', root).forEach((b) => b.addEventListener('click', () => {
    state.period = b.dataset.period;
    $$('[data-period]', root).forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  await load();
}
