// クラブセッティング
import { html, mount, $, $$, fmt, icon, openModal, confirmDialog, toast, errorToast, numOrNull, formObject, CLUB_CATEGORIES, clubCategoryLabel } from '../util.js';
import { api, getSettings, unit } from '../api.js';
import { hBarChart, chartCard, setupChart } from '../charts.js';

const CAT_ORDER = CLUB_CATEGORIES.map((c) => c[0]);
const NAME_HINTS = {
  driver: ['1W'], wood: ['3W', '4W', '5W', '7W', '9W'], hybrid: ['2U', '3U', '4U', '5U', '6U'],
  iron: ['3I', '4I', '5I', '6I', '7I', '8I', '9I', 'PW'], wedge: ['AW', 'GW', 'SW', 'LW', '48°', '50°', '52°', '54°', '56°', '58°', '60°'], putter: ['PT'],
};

export const clubDistance = (c) => (c.shot_count ? c.avg_carry : c.target_carry);

export async function render(root) {
  await getSettings();
  const u = unit();
  const clubs = await api.get('/api/clubs');
  const bag = clubs.filter((c) => c.in_bag);
  const stored = clubs.filter((c) => !c.in_bag);
  const gapClubs = bag.filter((c) => c.category !== 'putter');

  // 番手間の飛距離差をチェック
  const gapNotes = [];
  const rows = gapClubs.map((c, i) => {
    const d = clubDistance(c);
    const next = gapClubs[i + 1];
    const nd = next ? clubDistance(next) : null;
    let note = '';
    if (Number.isFinite(d) && Number.isFinite(nd)) {
      const gap = d - nd;
      note = `▼${Math.round(gap)}`;
      const bigLimit = c.category === 'driver' ? 35 : 22;
      if (gap < 5) gapNotes.push({ type: 'bad', text: `${c.name} と ${next.name} の差が ${Math.round(gap)}${u} と小さく、役割が重なっています。` });
      else if (gap > bigLimit) gapNotes.push({ type: 'bad', text: `${c.name} と ${next.name} の間が ${Math.round(gap)}${u} 空いています。間を埋めるクラブを検討しましょう。` });
    }
    return {
      label: c.name,
      value: Number.isFinite(d) ? Math.round(d) : null,
      color: c.shot_count ? 'var(--series-1)' : 'var(--series-1-soft)',
      note,
      empty: '飛距離未設定',
      title: `${c.name}（${clubCategoryLabel(c.category)}）`,
      tip: [
        { value: c.shot_count ? `${Math.round(c.avg_carry)}${u}` : '—', label: `記録の平均キャリー（${c.shot_count}球）`, color: 'var(--series-1)', swatch: true },
        { value: c.target_carry ? `${c.target_carry}${u}` : '—', label: '想定飛距離', color: 'var(--series-1-soft)', swatch: true },
        ...(c.shot_count ? [{ value: `${Math.round(c.max_carry)}${u}`, label: '最大キャリー' }] : []),
      ],
    };
  });

  const clubRow = (c, inBag) => html`<tr data-id="${c.id}" ${inBag ? html`draggable="true"` : ''}>
    ${inBag ? html`<td class="club-row-handle" title="ドラッグで並べ替え" aria-hidden="true">⋮⋮</td>` : ''}
    <td><strong>${c.name}</strong></td>
    <td><span class="club-cat secondary">${clubCategoryLabel(c.category)}</span></td>
    <td>${[c.brand, c.model].filter(Boolean).join(' ') || html`<span class="muted">—</span>`}</td>
    <td class="r">${c.loft != null ? `${c.loft}°` : '—'}</td>
    <td>${[c.shaft, c.flex].filter(Boolean).join(' / ') || html`<span class="muted">—</span>`}</td>
    <td class="r">${c.length != null ? `${c.length}″` : '—'}</td>
    <td class="r">${c.target_carry != null ? `${c.target_carry}${u}` : '—'}</td>
    <td class="r">${c.shot_count ? html`${Math.round(c.avg_carry)}${u} <span class="muted small">(${c.shot_count})</span>` : html`<span class="muted">—</span>`}</td>
    <td class="r nowrap">
      <button class="btn btn-sm" data-edit="${c.id}">編集</button>
      <button class="btn btn-sm" data-toggle="${c.id}">${inBag ? '保管へ' : 'バッグへ'}</button>
      <button class="btn btn-sm btn-ghost btn-icon btn-danger" data-del="${c.id}" aria-label="${c.name} を削除">${icon('trash')}</button>
    </td>
  </tr>`;
  const head = (inBag) => html`<thead><tr>${inBag ? html`<th></th>` : ''}<th>番手</th><th>種類</th><th>メーカー・モデル</th><th class="r">ロフト</th><th>シャフト / フレックス</th><th class="r">長さ</th><th class="r">想定飛距離</th><th class="r">平均キャリー</th><th></th></tr></thead>`;

  mount(root, html`
    <div class="page-header">
      <div><h1>クラブセッティング</h1><div class="sub">バッグの中身と番手ごとの飛距離の階段を管理します</div></div>
      <div class="actions"><a class="btn" href="#/ai?purpose=clubs">${icon('ai')}AIに相談</a><button class="btn btn-primary" id="add">${icon('plus')}クラブを追加</button></div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="label">バッグ内の本数</div><div class="value">${bag.length}<small>/ 14 本</small></div>
        <div class="delta">${bag.length > 14 ? html`<span class="badge warn">⚠ ${bag.length - 14} 本オーバー（ルール上限 14 本）</span>` : bag.length === 14 ? 'フルセット' : `あと ${14 - bag.length} 本入れられます`}</div></div>
      <div class="tile"><div class="label">ドライバー平均キャリー</div><div class="value">${fmtDist(bag.find((c) => c.category === 'driver'), u)}</div><div class="delta">飛距離の記録から</div></div>
      <div class="tile"><div class="label">7番アイアン平均キャリー</div><div class="value">${fmtDist(bag.find((c) => c.name === '7I'), u)}</div><div class="delta">飛距離の記録から</div></div>
      <div class="tile"><div class="label">保管中のクラブ</div><div class="value">${stored.length}<small>本</small></div></div>
    </div>

    <div class="card section">
      <div class="card-header"><div><h2>バッグの中身</h2><div class="sub">行をドラッグして並べ替えできます</div></div>
        ${bag.length > 1 ? html`<button class="btn btn-sm" id="sort-loft">種類・ロフト順に整列</button>` : ''}</div>
      ${bag.length ? html`<div class="table-wrap"><table class="data" id="bag-table">${head(true)}<tbody>${bag.map((c) => clubRow(c, true))}</tbody></table></div>`
        : html`<div class="empty">${icon('club')}<p>クラブが登録されていません。「クラブを追加」から登録しましょう。</p>
          <button class="btn" id="add-std">標準的な14本セットをまとめて追加</button></div>`}
    </div>

    ${gapClubs.length ? html`<div class="grid grid-3 section">
      ${chartCard('gap', '飛距離の階段', `濃い色＝記録の平均キャリー、薄い色＝想定飛距離。▼は次の番手との差（${u}）`, 'span-2')}
      <div class="card"><h2 style="margin-bottom:12px">番手間のチェック</h2>
        ${gapNotes.length ? html`<ul class="insights">${gapNotes.map((n) => html`<li><span class="ico bad">!</span><span>${n.text}</span></li>`)}</ul>`
          : html`<ul class="insights"><li><span class="ico good">✓</span><span>番手間の飛距離差はバランス良く並んでいます。</span></li></ul>`}
        <p class="small muted" style="margin-top:12px">目安：アイアンは番手ごとに 10${u} 前後の差が理想的です。飛距離は「飛距離」ページで記録すると自動で反映されます。</p>
      </div>
    </div>` : ''}

    ${stored.length ? html`<div class="card section"><h2 style="margin-bottom:8px">保管中のクラブ</h2>
      <div class="table-wrap"><table class="data">${head(false)}<tbody>${stored.map((c) => clubRow(c, false))}</tbody></table></div></div>` : ''}
  `);

  const reload = () => render(root);
  $('#add', root).addEventListener('click', async () => { if (await openClubEditor(null)) reload(); });
  $('#add-std', root)?.addEventListener('click', async () => {
    const std = [['driver', '1W', 10.5], ['wood', '3W', 15], ['wood', '5W', 18], ['hybrid', '4U', 22], ['iron', '5I', 24], ['iron', '6I', 27], ['iron', '7I', 31],
      ['iron', '8I', 35], ['iron', '9I', 40], ['iron', 'PW', 45], ['wedge', 'AW', 50], ['wedge', 'SW', 56], ['wedge', 'LW', 58], ['putter', 'PT', 3]];
    try {
      for (const [i, [category, name, loft]] of std.entries()) await api.post('/api/clubs', { category, name, loft, in_bag: true, sort_order: i });
      toast('14本を追加しました。メーカーや飛距離は「編集」から設定できます');
      reload();
    } catch (e) { errorToast(e); }
  });
  $$('[data-edit]', root).forEach((b) => b.addEventListener('click', async () => {
    if (await openClubEditor(clubs.find((c) => c.id === Number(b.dataset.edit)))) reload();
  }));
  $$('[data-toggle]', root).forEach((b) => b.addEventListener('click', async () => {
    const c = clubs.find((x) => x.id === Number(b.dataset.toggle));
    if (!c.in_bag && bag.length >= 14 && !(await confirmDialog('バッグがすでに14本です。15本目として入れますか？（競技では14本まで）'))) return;
    try { await api.put(`/api/clubs/${c.id}`, { ...c, in_bag: !c.in_bag }); reload(); } catch (e) { errorToast(e); }
  }));
  $$('[data-del]', root).forEach((b) => b.addEventListener('click', async () => {
    const c = clubs.find((x) => x.id === Number(b.dataset.del));
    const msg = c.shot_count ? `「${c.name}」を削除しますか？\nこのクラブの飛距離記録 ${c.shot_count} 件も削除されます。使わなくなっただけなら「保管へ」がおすすめです。` : `「${c.name}」を削除しますか？`;
    if (!(await confirmDialog(msg, { danger: true, okText: '削除する' }))) return;
    try { await api.del(`/api/clubs/${c.id}`); toast('削除しました'); reload(); } catch (e) { errorToast(e); }
  }));
  $('#sort-loft', root)?.addEventListener('click', async () => {
    const sorted = [...bag].sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || (a.loft ?? 99) - (b.loft ?? 99));
    try { await api.put('/api/clubs/order', { ids: [...sorted, ...stored].map((c) => c.id) }); reload(); } catch (e) { errorToast(e); }
  });

  // ドラッグで並べ替え
  const tbody = $('#bag-table tbody', root);
  if (tbody) {
    let dragging = null;
    tbody.addEventListener('dragstart', (e) => {
      dragging = e.target.closest('tr');
      dragging.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    tbody.addEventListener('dragover', (e) => {
      e.preventDefault();
      const tr = e.target.closest('tr');
      $$('tr', tbody).forEach((r) => r.classList.toggle('drop-target', r === tr && r !== dragging));
    });
    tbody.addEventListener('dragend', () => { $$('tr', tbody).forEach((r) => r.classList.remove('dragging', 'drop-target')); });
    tbody.addEventListener('drop', async (e) => {
      e.preventDefault();
      const tr = e.target.closest('tr');
      if (!dragging || !tr || tr === dragging) return;
      tbody.insertBefore(dragging, tr);
      const ids = [...$$('tr', tbody).map((r) => Number(r.dataset.id)), ...stored.map((c) => c.id)];
      try { await api.put('/api/clubs/order', { ids }); reload(); } catch (err) { errorToast(err); }
    });
  }

  if (gapClubs.length) {
    setupChart(root, 'gap', (el) => hBarChart(el, {
      rows,
      format: (v) => `${v}${u}`,
      ariaLabel: '番手ごとの飛距離',
      legend: [{ label: '記録の平均キャリー', color: 'var(--series-1)' }, { label: '想定飛距離（記録なし）', color: 'var(--series-1-soft)' }],
    }), {
      columns: [{ label: '番手' }, { label: '平均キャリー', align: 'r' }, { label: '想定飛距離', align: 'r' }, { label: '記録数', align: 'r' }],
      rows: gapClubs.map((c) => [c.name, c.shot_count ? `${Math.round(c.avg_carry)}${u}` : '—', c.target_carry ? `${c.target_carry}${u}` : '—', String(c.shot_count)]),
    });
  }
}

function fmtDist(c, u) {
  if (!c || !c.shot_count) return '—';
  return html`${Math.round(c.avg_carry)}<small>${u}</small>`;
}

export function openClubEditor(club) {
  return new Promise((resolve) => {
    let saved = null;
    const u = unit();
    const m = openModal({
      title: club ? `${club.name} を編集` : 'クラブを追加',
      body: html`<form id="club-form" autocomplete="off"><div class="form-grid">
        <label class="field"><span>種類 *</span><select name="category" required>${CLUB_CATEGORIES.map(([k, l]) => html`<option value="${k}" ${club?.category === k ? 'selected' : ''}>${l}</option>`)}</select></label>
        <label class="field"><span>番手・名前 *</span><input name="name" required maxlength="50" list="club-names" value="${club?.name || ''}" placeholder="例: 7I"><datalist id="club-names"></datalist></label>
        <label class="field"><span>メーカー</span><input name="brand" maxlength="100" value="${club?.brand || ''}"></label>
        <label class="field"><span>モデル</span><input name="model" maxlength="100" value="${club?.model || ''}"></label>
        <label class="field"><span>ロフト（°）</span><input name="loft" type="number" step="0.5" min="0" max="80" value="${club?.loft ?? ''}"></label>
        <label class="field"><span>長さ（インチ）</span><input name="length" type="number" step="0.25" min="20" max="52" value="${club?.length ?? ''}"></label>
        <label class="field"><span>シャフト</span><input name="shaft" maxlength="100" value="${club?.shaft || ''}" placeholder="例: カーボン 60g"></label>
        <label class="field"><span>フレックス</span><input name="flex" maxlength="20" list="flex-list" value="${club?.flex || ''}">
          <datalist id="flex-list"><option value="L"><option value="A"><option value="R"><option value="SR"><option value="S"><option value="X"></datalist></label>
        <label class="field"><span>想定飛距離（キャリー ${u}）</span><input name="target_carry" type="number" min="0" max="450" value="${club?.target_carry ?? ''}"></label>
        <label class="field" style="justify-content:flex-end"><span class="check"><input type="checkbox" name="in_bag" ${!club || club.in_bag ? 'checked' : ''}>バッグに入れる</span></label>
        <label class="field wide"><span>メモ</span><textarea name="memo" rows="2" maxlength="1000">${club?.memo || ''}</textarea></label>
      </div></form>`,
      footer: html`<button class="btn" data-cancel>キャンセル</button><button class="btn btn-primary" data-save>保存</button>`,
      onClose: () => resolve(saved),
    });
    const form = $('#club-form', m.el);
    const fillHints = () => mount($('#club-names', form), (NAME_HINTS[form.category.value] || []).map((n) => html`<option value="${n}">`));
    form.category.addEventListener('change', fillHints);
    fillHints();
    $('[data-cancel]', m.el).addEventListener('click', () => m.close());
    const save = async () => {
      if (!form.reportValidity()) return;
      const o = formObject(form);
      const body = { ...o, loft: numOrNull(o.loft), length: numOrNull(o.length), target_carry: numOrNull(o.target_carry) };
      try {
        saved = club ? await api.put(`/api/clubs/${club.id}`, body) : await api.post('/api/clubs', body);
        toast('クラブを保存しました');
        m.close();
      } catch (e) { errorToast(e); }
    };
    $('[data-save]', m.el).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  });
}
