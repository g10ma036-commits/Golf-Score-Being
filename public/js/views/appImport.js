// ほかのアプリのデータから取り込む
//  - IKScoreCard のバックアップ：いまの記録は消さず、まだ無いラウンドだけを追加する
//  - Garmin Golf（Garmin Connect のデータのエクスポート）：同じ日のラウンドは Garmin のデータを優先する（手入力のものは選べる）
import { html, $, openModal, toast, errorToast, fmtDate } from '../util.js';
import { api } from '../api.js';
import { navigate } from '../main.js';
import { isZip, readZip } from '../shared/zip.js';
import { isSqlite } from '../shared/sqlite.js';
import { parseIkScoreCard, isIkScoreCardFiles, ikFixes, ikFixBody } from '../shared/ikscorecard.js';
import { readGarminFiles, parseGarmin, planGarmin, mapNines, roundBody, mergeBody, changes, isGarminJsonName, norm, totalOf } from '../shared/garmin.js';
import { courseHoleNo } from '../stats.js';

// 選んだファイル（ZIP または .sqlite3）から IKScoreCard の SQLite のファイルを集める
async function collect(files) {
  const out = [];
  for (const f of files) {
    if (await isZip(f)) {
      for (const e of await readZip(f)) if (/(^|\/)IKScoreCard_[^/]*\.sqlite3?$/i.test(e.name)) out.push({ name: e.name, bytes: await e.bytes() });
    } else {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (isSqlite(bytes)) out.push({ name: f.name, bytes });
    }
  }
  return out;
}

// 取り込みの計画：追加するラウンド・飛ばすラウンド・新しく登録するコース
// 同じ日でスコアの差が 1 打以内のラウンドがあれば、すでにあるとみなして飛ばす（Garmin など別のアプリから取り込んだものも含む）
function makePlan(parsed, rounds, courses) {
  const courseByName = new Map(courses.map((c) => [norm(c.name), c]));
  const have = rounds.map((r) => ({ date: r.date, total: totalOf(r.holes) }));
  const nameOf = new Map(parsed.places.map((p) => [p.place, p.name]));
  const add = [];
  let dup = 0;
  let unknown = 0;
  for (const r of parsed.rounds) {
    const name = nameOf.get(r.place);
    if (!name) { unknown++; continue; }
    const total = totalOf(r.holes);
    if (have.some((x) => x.date === r.date && Math.abs(x.total - total) <= 1)) { dup++; continue; }
    have.push({ date: r.date, total }); // バックアップの中の重複も 1 つに
    add.push(r);
  }
  const places = [...new Set(add.map((r) => r.place))];
  const reuse = places.filter((p) => courseByName.has(norm(nameOf.get(p))));
  // 以前の版で取り込んだまま、前半・後半の並び（インスタート）や回ったコースがずれているラウンド
  const fixes = ikFixes(parsed, rounds);
  return { add, dup, unknown, places, reuse, newPlaces: places.filter((p) => !reuse.includes(p)), courseByName, nameOf, fixes };
}

export async function openIkImport(files, onDone) {
  let parsed;
  let plan;
  let courses;
  try {
    const dbs = await collect(files);
    if (!isIkScoreCardFiles(dbs)) throw new Error('IKScoreCard のバックアップが見つかりませんでした。バックアップの ZIP（または IKScoreCard_sc.sqlite3 などのファイル）を選んでください。');
    if (!dbs.some((f) => /IKScoreCard_g2\.sqlite3$/i.test(f.name))) throw new Error('コースのデータ（IKScoreCard_g2.sqlite3）が見つかりません。バックアップの ZIP をそのまま選ぶか、すべての .sqlite3 ファイルを選んでください。');
    parsed = parseIkScoreCard(dbs);
    let rounds;
    [rounds, courses] = await Promise.all([api.get('/api/rounds'), api.get('/api/courses')]);
    plan = makePlan(parsed, rounds, courses);
  } catch (err) { errorToast(err); return; }

  const tees = parsed.tees;
  const defTee = (tees.find((t) => t.tee === 2) || tees[0])?.tee ?? 2;
  const withParty = parsed.rounds.some((r) => r.party.length);
  const fixN = plan.fixes.length;
  const work = plan.add.length + fixN;
  const goLabel = plan.add.length && fixN ? `取り込む・${fixN} ラウンドを直す` : plan.add.length ? `${plan.add.length} ラウンドを取り込む` : `${fixN} ラウンドを直す`;
  const m = openModal({
    title: 'IKScoreCard から取り込む',
    body: html`<div class="ik-summary">
        <div><strong>${parsed.rounds.length}</strong> ラウンド<span class="small muted">（${parsed.from ? `${fmtDate(parsed.from)}〜${fmtDate(parsed.to)}` : '—'}）</span></div>
        <ul class="small">
          <li>追加するラウンド：<strong>${plan.add.length}</strong></li>
          ${plan.dup ? html`<li>すでにあるので飛ばす：${plan.dup}（同じ日でスコアもほぼ同じ）</li>` : ''}
          ${plan.unknown ? html`<li>コースが分からないので飛ばす：${plan.unknown}</li>` : ''}
          ${plan.add.length ? html`<li>コース：新しく登録 ${plan.newPlaces.length}${plan.reuse.length ? `・登録済みのコースを使う ${plan.reuse.length}` : ''}</li>` : ''}
          ${fixN ? html`<li>前半・後半の並び（インスタート）や回ったコースを直す：<strong>${fixN}</strong>（以前の版で取り込んだラウンド）</li>` : ''}
        </ul></div>
      ${plan.add.length ? html`
        ${tees.length && plan.newPlaces.length ? html`<label class="field" style="margin-top:12px"><span>コースの距離に使うティー</span><select id="ik-tee">${tees.map((t) => html`<option value="${t.tee}" ${t.tee === defTee ? 'selected' : ''}>${t.label || `ティー${t.tee}`}${t.total ? `（よく行くコースで ${t.total.toLocaleString()}y）` : ''}</option>`)}</select></label>` : ''}
        ${withParty ? html`<label class="check" style="margin-top:10px"><input type="checkbox" id="ik-party" checked> 同伴者のスコアと名前も取り込む</label>` : ''}
        <p class="small muted" style="margin-top:10px">天気は取り込みません。インスタート（10 番から回った）や、27・36 ホールのゴルフ場で回ったコースの組み合わせも読み取ります。</p>`
        : html`<p class="small muted" style="margin-top:10px">追加するラウンドはありません。</p>`}
      ${fixN ? html`<p class="small muted" style="margin-top:6px">以前の版では、10 番から回ったラウンドの前半と後半が逆に、27・36 ホールのゴルフ場ではいつも 1 つ目・2 つ目のコースになっていました。直すと、ホールの並び・パー・距離が正しくなります（天気・同伴者・メモ・写真はそのまま）。</p>` : ''}
      <div class="ik-progress small" aria-live="polite"></div>`,
    footer: html`<button class="btn" data-ik-cancel>${work ? 'キャンセル' : '閉じる'}</button>${work ? html`<button class="btn btn-primary" data-ik-go>${goLabel}</button>` : ''}`,
  });
  let busy = false;
  $('[data-ik-cancel]', m.el).addEventListener('click', () => { if (!busy) m.close(); });
  $('[data-ik-go]', m.el)?.addEventListener('click', async (e) => {
    busy = true;
    e.target.disabled = true;
    $('[data-ik-cancel]', m.el).disabled = true;
    const tee = Number($('#ik-tee', m.el)?.value) || defTee;
    const party = $('#ik-party', m.el)?.checked ?? false;
    const progress = $('.ik-progress', m.el);
    const say = (t) => { progress.textContent = t; };
    let done = 0;
    let fixed = 0;
    try {
      // コース（同じ名前の登録済みコースがあれば、それを使う）
      const info = new Map();
      for (const place of plan.places) {
        const existing = plan.courseByName.get(norm(plan.nameOf.get(place)));
        if (existing) { info.set(place, existing); continue; }
        say(`コースを登録しています…（${info.size + 1} / ${plan.places.length}）`);
        const c = parsed.courseFor(place, tee);
        info.set(place, await api.post('/api/courses', { name: c.name, location: c.location, nines: c.nines, holes: c.holes }));
      }
      for (const r of plan.add) {
        say(`ラウンドを取り込んでいます…（${done + 1} / ${plan.add.length}）`);
        const c = info.get(r.place);
        const nineCount = Math.max(1, c.nines?.length || 2);
        const front = Math.min(r.front, nineCount);
        const back = Math.min(r.back, nineCount);
        const ch = (no) => (c.holes || []).find((h) => h.hole_no === courseHoleNo({ front_nine: front, back_nine: back }, no));
        await api.post('/api/rounds', {
          date: r.date, course_id: c.id, front_nine: front, back_nine: back,
          memo: r.memo || null,
          companions: party && r.party.length ? r.party.map((p) => p.name).join('、').slice(0, 300) : null,
          party: party ? r.party : [],
          holes: r.holes.filter((h) => h.strokes != null).map((h) => ({ ...h, par: ch(h.hole_no)?.par ?? null, yards: ch(h.hole_no)?.yards ?? null })),
        });
        done++;
      }
      for (const fx of plan.fixes) {
        say(`前半・後半の並びを直しています…（${fixed + 1} / ${fixN}）`);
        await api.put(`/api/rounds/${fx.a.id}`, ikFixBody(fx, courses.find((c) => c.id === fx.a.course_id)));
        fixed++;
      }
      m.close();
      toast([done ? `${done} ラウンドを取り込みました` : '', fixed ? `${fixed} ラウンドを直しました` : ''].filter(Boolean).join('・'));
      onDone?.();
      navigate('/rounds');
    } catch (err) {
      busy = false;
      $('[data-ik-cancel]', m.el).disabled = false;
      say(`途中で止まりました（取り込み ${done}・直した ${fixed}）。もう一度取り込むと、残りだけが反映されます。`);
      errorToast(err);
    }
  });
}

// ---------- Garmin Golf ----------
// 選んだファイル（エクスポートの ZIP、または Golf-*.json）からゴルフのデータを集める
async function collectGarmin(files) {
  const out = [];
  const dec = new TextDecoder();
  for (const f of files) {
    if (await isZip(f)) {
      let entries;
      try { entries = await readZip(f); } catch {
        throw new Error('この ZIP は読み込めませんでした（とても大きい ZIP など）。ZIP を展開して、DI_CONNECT/DI-GOLF フォルダの Golf-*.json をまとめて選んでください。');
      }
      for (const e of entries) if (isGarminJsonName(e.name)) out.push({ name: e.name, text: dec.decode(await e.bytes()) });
    } else if (/\.json$/i.test(f.name)) {
      out.push({ name: f.name, text: await f.text() });
    }
  }
  return out;
}

export async function openGarminImport(files, onDone) {
  let parsed;
  let plan;
  let courses;
  let clubs;
  try {
    const src = readGarminFiles(await collectGarmin(files));
    if (!src.SCORECARD.length) throw new Error('Garmin のスコアのデータ（Golf-SCORECARD.json）が見つかりませんでした。Garmin Connect の「データのエクスポート」の ZIP、または DI_CONNECT/DI-GOLF フォルダの Golf-*.json をまとめて選んでください。');
    parsed = parseGarmin(src);
    if (!parsed.rounds.length) throw new Error('取り込めるラウンドがありませんでした');
    let rounds;
    [rounds, courses, clubs] = await Promise.all([api.get('/api/rounds'), api.get('/api/courses'), api.get('/api/clubs').catch(() => [])]);
    plan = planGarmin(parsed, rounds, courses);
  } catch (err) { errorToast(err); return; }

  // 手入力と重なるものを先に（選ぶ必要があるので）
  plan.pairs.sort((a, b) => (a.origin === 'manual' ? 0 : 1) - (b.origin === 'manual' ? 0 : 1) || a.g.date.localeCompare(b.g.date));
  const imp = plan.pairs.filter((p) => p.origin === 'import');
  const man = plan.pairs.filter((p) => p.origin === 'manual');
  const facs = plan.facilities;
  const noNames = !facs.some((f) => !/^Garmin のコース /.test(f.name));
  const m = openModal({
    title: 'Garmin Golf から取り込む',
    body: html`<div class="ik-summary">
        <div><strong>${parsed.rounds.length}</strong> ラウンド<span class="small muted">（${fmtDate(parsed.from)}〜${fmtDate(parsed.to)}）</span></div>
        <ul class="small">
          <li>新しく追加：<strong>${plan.add.length}</strong></li>
          ${plan.pairs.length ? html`<li>アプリに同じ日のラウンドがある：${plan.pairs.length}（取り込んだデータ ${imp.length}・手入力 ${man.length}）</li>` : ''}
          <li>ゴルフ場：${facs.length} か所</li>
        </ul></div>
      ${plan.pairs.length ? html`<h3 class="gi-h">同じ日のラウンド</h3>
        ${imp.length ? html`<p class="small">IKScoreCard などから取り込んだラウンドと重なる ${imp.length} 件は、Garmin のデータで置き換えます。</p>` : ''}
        ${man.length ? html`<div class="field gi-man"><span>手入力したラウンドと重なる ${man.length} 件は、どちらを優先しますか</span>
          <div class="gi-radio">
            <label class="check"><input type="radio" name="gi-man" value="garmin" checked> Garmin を優先</label>
            <label class="check"><input type="radio" name="gi-man" value="app"> 手入力を優先</label>
          </div></div>` : ''}
        <details class="gi-pairs"><summary class="small">1 件ずつ確認する・選ぶ</summary>
          <div class="gi-rows">${plan.pairs.map((p, i) => html`<div class="gi-row ${p.origin === 'manual' ? 'manual' : ''}">
            <div class="gi-row-main"><div>${fmtDate(p.g.date)} <span class="small muted">${p.a.course_name || ''}</span></div>
              <div class="small muted">アプリ ${totalOf(p.a.holes) || '—'} → Garmin ${p.g.total}・${p.origin === 'manual' ? html`<strong>手入力</strong>` : '取り込み'}</div></div>
            <select data-pair="${i}" data-origin="${p.origin}" aria-label="${fmtDate(p.g.date)} のラウンド"><option value="garmin">Garmin を優先</option><option value="app">アプリのまま</option></select>
          </div>`)}</div>
        </details>
        <p class="small muted">置き換えても、天気・同伴者・メモ・写真・ホールのメモはそのまま残ります。</p>` : ''}
      <h3 class="gi-h">ゴルフ場</h3>
      <p class="small muted">${noNames ? 'Golf-COURSE.json が無いので、ゴルフ場の名前が分かりません。' : 'Garmin のファイルの名前は英語です。分かるゴルフ場は日本語の名前にしてあります。'}新しく登録するゴルフ場は名前を直せます（あとからでも直せます）。登録済みのゴルフ場と同じなら選んでください。</p>
      <div class="gi-facs">${facs.map((f, i) => html`<div class="gi-fac">
        <div class="gi-fac-head"><strong>${f.name}</strong> <span class="small muted">${f.dates.length} ラウンド（${fmtDate(f.dates[0])}${f.dates.length > 1 ? ' ほか' : ''}）</span>${f.garminName ? html`<div class="small muted">Garmin：${f.garminName}</div>` : ''}</div>
        <select data-fac="${i}" aria-label="${f.name} の登録先"><option value="">新しく登録する</option>${courses.map((c) => html`<option value="${c.id}" ${c.id === f.target ? 'selected' : ''}>${c.name}</option>`)}</select>
        <input data-fac-name="${i}" maxlength="200" value="${f.name}" aria-label="${f.name} の新しい名前" ${f.target ? 'hidden' : ''}>
        ${f.auto === 'pair' ? html`<div class="small muted">同じ日のラウンドから選びました</div>` : ''}
      </div>`)}</div>
      <p class="small muted" style="margin-top:10px">ホールごとのパーは Garmin のファイルに無いため、ショットの記録と合計パーから推定します（登録済みのゴルフ場で合計が合うときはそのパーを使います）。距離は取り込みません。ティーショットのクラブと歩数も取り込みます。</p>
      <div class="ik-progress small" aria-live="polite"></div>`,
    footer: html`<button class="btn" data-gi-cancel>キャンセル</button><button class="btn btn-primary" data-gi-go>取り込む</button>`,
  });
  const el = m.el;
  const all = (sel) => [...el.querySelectorAll(sel)];
  // 手入力のまとめての選択 → 1 件ずつの選択に反映
  for (const r of all('[name=gi-man]')) {
    r.addEventListener('change', () => { for (const s of all('[data-pair][data-origin=manual]')) s.value = r.value; });
  }
  for (const s of all('[data-fac]')) {
    s.addEventListener('change', () => { $(`[data-fac-name="${s.dataset.fac}"]`, el).hidden = Boolean(s.value); });
  }
  let busy = false;
  $('[data-gi-cancel]', el).addEventListener('click', () => { if (!busy) m.close(); });
  $('[data-gi-go]', el).addEventListener('click', async (e) => {
    busy = true;
    e.target.disabled = true;
    $('[data-gi-cancel]', el).disabled = true;
    const progress = $('.ik-progress', el);
    const say = (t) => { progress.textContent = t; };
    const choice = (i) => $(`[data-pair="${i}"]`, el)?.value || 'garmin';
    const facIndex = new Map(facs.map((f, i) => [f.key, i]));
    const ready = new Map(); // ゴルフ場 → { course, map }
    const courseFor = async (key) => {
      if (ready.has(key)) return ready.get(key);
      const i = facIndex.get(key);
      const f = facs[i];
      const sel = Number($(`[data-fac="${i}"]`, el).value) || null;
      let res;
      if (sel) {
        let c = courses.find((x) => x.id === sel);
        const { map, added } = mapNines(f, c);
        if (added.length) {
          say(`「${c.name}」にコースを加えています…`);
          const names = c.nines?.length ? c.nines : ['OUT', 'IN'];
          c = await api.put(`/api/courses/${c.id}`, {
            name: c.name, location: c.location, rating: c.rating, slope: c.slope, memo: c.memo,
            nines: [...names, ...added.map((n) => n.name)],
            holes: [...(c.holes || []), ...added.flatMap((n, k) => n.pars.map((p, j) => ({ hole_no: (names.length + k) * 9 + j + 1, par: p })))],
          });
          courses = courses.map((x) => (x.id === c.id ? c : x));
        }
        res = { course: c, map };
      } else {
        say(`ゴルフ場を登録しています…（${f.name}）`);
        const name = ($(`[data-fac-name="${i}"]`, el).value.trim() || f.name).slice(0, 200);
        const c = await api.post('/api/courses', {
          name, nines: f.nines.map((n) => n.name),
          holes: f.nines.flatMap((n, k) => n.pars.map((p, j) => ({ hole_no: k * 9 + j + 1, par: p }))),
        });
        courses = [...courses, c];
        res = { course: c, map: new Map(f.nines.map((n, k) => [n.key, k + 1])) };
      }
      ready.set(key, res);
      return res;
    };
    let added = 0;
    let updated = 0;
    let same = 0;
    let kept = 0;
    try {
      for (const g of plan.add) {
        say(`ラウンドを追加しています…（${added + 1} / ${plan.add.length}）`);
        const { course, map } = await courseFor(g.facility);
        await api.post('/api/rounds', roundBody(g, course, map, clubs));
        added++;
      }
      for (const [i, p] of plan.pairs.entries()) {
        if (choice(i) !== 'garmin') { kept++; continue; }
        say(`同じ日のラウンドを置き換えています…（${i + 1} / ${plan.pairs.length}）`);
        const { course, map } = await courseFor(p.g.facility);
        const { swapped, ...body } = mergeBody(p.g, p.a, course, map, clubs);
        if (!changes(body, p.a)) { same++; continue; }
        await api.put(`/api/rounds/${p.a.id}`, body);
        updated++;
      }
      m.close();
      toast([`追加 ${added}`, updated ? `置き換え ${updated}` : '', same ? `変更なし ${same}` : '', kept ? `アプリのまま ${kept}` : ''].filter(Boolean).join('・'));
      onDone?.();
      navigate('/rounds');
    } catch (err) {
      busy = false;
      $('[data-gi-cancel]', el).disabled = false;
      say(`途中で止まりました（追加 ${added}・置き換え ${updated}）。もう一度取り込むと、残りだけが反映されます。`);
      errorToast(err);
    }
  });
}
