// ほかのアプリのバックアップから取り込む（いまは IKScoreCard）。いまの記録は消さず、まだ無いラウンドだけを追加する
import { html, mount, $, openModal, toast, errorToast, fmtDate } from '../util.js';
import { api } from '../api.js';
import { navigate } from '../main.js';
import { isZip, readZip } from '../shared/zip.js';
import { isSqlite } from '../shared/sqlite.js';
import { parseIkScoreCard, isIkScoreCardFiles } from '../shared/ikscorecard.js';
import { courseHoleNo } from '../stats.js';

const norm = (s) => String(s || '').replace(/[\s　]+/g, '').toLowerCase();
const totalOf = (holes) => (holes || []).reduce((a, h) => a + (Number.isFinite(h.strokes) && h.strokes > 0 ? h.strokes : 0), 0);

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
function makePlan(parsed, rounds, courses) {
  const courseByName = new Map(courses.map((c) => [norm(c.name), c]));
  const have = new Set(rounds.map((r) => `${r.date}|${norm(r.course_name)}|${totalOf(r.holes)}`));
  const nameOf = new Map(parsed.places.map((p) => [p.place, p.name]));
  const add = [];
  let dup = 0;
  let unknown = 0;
  for (const r of parsed.rounds) {
    const name = nameOf.get(r.place);
    if (!name) { unknown++; continue; }
    const key = `${r.date}|${norm(name)}|${totalOf(r.holes)}`;
    if (have.has(key)) { dup++; continue; }
    have.add(key); // バックアップの中の重複も 1 つに
    add.push(r);
  }
  const places = [...new Set(add.map((r) => r.place))];
  const reuse = places.filter((p) => courseByName.has(norm(nameOf.get(p))));
  return { add, dup, unknown, places, reuse, newPlaces: places.filter((p) => !reuse.includes(p)), courseByName, nameOf };
}

export async function openIkImport(files, onDone) {
  let parsed;
  let plan;
  try {
    const dbs = await collect(files);
    if (!isIkScoreCardFiles(dbs)) throw new Error('IKScoreCard のバックアップが見つかりませんでした。バックアップの ZIP（または IKScoreCard_sc.sqlite3 などのファイル）を選んでください。');
    if (!dbs.some((f) => /IKScoreCard_g2\.sqlite3$/i.test(f.name))) throw new Error('コースのデータ（IKScoreCard_g2.sqlite3）が見つかりません。バックアップの ZIP をそのまま選ぶか、すべての .sqlite3 ファイルを選んでください。');
    parsed = parseIkScoreCard(dbs);
    const [rounds, courses] = await Promise.all([api.get('/api/rounds'), api.get('/api/courses')]);
    plan = makePlan(parsed, rounds, courses);
  } catch (err) { errorToast(err); return; }

  const tees = parsed.tees;
  const defTee = (tees.find((t) => t.tee === 2) || tees[0])?.tee ?? 2;
  const withParty = parsed.rounds.some((r) => r.party.length);
  const m = openModal({
    title: 'IKScoreCard から取り込む',
    body: html`<div class="ik-summary">
        <div><strong>${parsed.rounds.length}</strong> ラウンド<span class="small muted">（${parsed.from ? `${fmtDate(parsed.from)}〜${fmtDate(parsed.to)}` : '—'}）</span></div>
        <ul class="small">
          <li>追加するラウンド：<strong>${plan.add.length}</strong></li>
          ${plan.dup ? html`<li>すでにあるので飛ばす：${plan.dup}（同じ日・同じコース・同じスコア）</li>` : ''}
          ${plan.unknown ? html`<li>コースが分からないので飛ばす：${plan.unknown}</li>` : ''}
          <li>コース：新しく登録 ${plan.newPlaces.length}${plan.reuse.length ? `・登録済みのコースを使う ${plan.reuse.length}` : ''}</li>
        </ul></div>
      ${plan.add.length ? html`
        ${tees.length && plan.newPlaces.length ? html`<label class="field" style="margin-top:12px"><span>コースの距離に使うティー</span><select id="ik-tee">${tees.map((t) => html`<option value="${t.tee}" ${t.tee === defTee ? 'selected' : ''}>${t.label || `ティー${t.tee}`}${t.total ? `（よく行くコースで ${t.total.toLocaleString()}y）` : ''}</option>`)}</select></label>` : ''}
        ${withParty ? html`<label class="check" style="margin-top:10px"><input type="checkbox" id="ik-party" checked> 同伴者のスコアと名前も取り込む</label>` : ''}
        <p class="small muted" style="margin-top:10px">天気は取り込みません。27・36ホールのゴルフ場で別の 9 ホールを回ったラウンドは、取り込んだあとにラウンドの編集で「回ったコース」を直せます。</p>`
        : html`<p class="small muted" style="margin-top:10px">追加するラウンドはありません。</p>`}
      <div class="ik-progress small" aria-live="polite"></div>`,
    footer: html`<button class="btn" data-ik-cancel>${plan.add.length ? 'キャンセル' : '閉じる'}</button>${plan.add.length ? html`<button class="btn btn-primary" data-ik-go>${plan.add.length} ラウンドを取り込む</button>` : ''}`,
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
      m.close();
      toast(`${done} ラウンドを取り込みました`);
      onDone?.();
      navigate('/rounds');
    } catch (err) {
      busy = false;
      $('[data-ik-cancel]', m.el).disabled = false;
      say(`途中で止まりました（${done} ラウンドは取り込み済み）。もう一度取り込むと、残りだけが追加されます。`);
      errorToast(err);
    }
  });
}
