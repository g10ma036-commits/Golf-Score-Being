// コースの攻略シート：ホールごとの目標打数・パー3 の番手の目安・過去の平均と前回・攻略メモを 1 枚に（印刷もできる）
import { html, mount, $, fmtDate, icon, today } from '../util.js';
import { api, getSettings } from '../api.js';
import { holeAnalysis, onCourseHoles, goalPlan, planLabel, suggestClub, played } from '../stats.js';
import { ninesOf, holeName } from './courses.js';
import { parseNextRound } from '../shared/model.js';

export async function render(root, [idStr]) {
  const id = Number(idStr);
  const [course, allRounds, settings, clubs] = await Promise.all([
    api.get(`/api/courses/${id}`), api.get('/api/rounds'), getSettings().catch(() => ({})), api.get('/api/clubs').catch(() => []),
  ]);
  const names = ninesOf(course);
  const multi = names.length > 2;
  const rounds = allRounds.filter((r) => r.course_id === id);
  const stats = holeAnalysis(rounds.map(onCourseHoles), names.length * 9);
  const latest = [...rounds].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
  const last = new Map((latest ? onCourseHoles(latest).holes : []).filter(played).map((h) => [h.hole_no, h.strokes]));
  const goal = Number(settings.goal) || null;
  const plan = goal && !multi ? goalPlan(course.holes, goal, (no) => {
    const st = stats[no - 1];
    if (st?.n >= 2) return 100 + st.toPar;
    const hd = course.holes.find((x) => x.hole_no === no)?.hdcp;
    return hd ? 50 - hd : 0;
  }) : null;
  const unit = settings.unit === 'm' ? 'm' : 'yd';
  const next = parseNextRound(settings.next_round);
  const nextHere = next && next.course_id === id && next.date >= today() ? next : null;

  const row = (no) => {
    const h = course.holes.find((x) => x.hole_no === no) || { hole_no: no };
    const st = stats[no - 1];
    const target = plan?.get(no);
    const club = h.par === 3 ? suggestClub(clubs, h.yards, settings.unit) : null;
    return html`<tr>
      <td class="sh-no">${multi ? holeName(names, no) : no}</td><td class="c">${h.par ?? '—'}</td><td class="r">${h.yards ?? '—'}</td><td class="c hide-sm">${h.hdcp ?? '—'}</td>
      ${plan ? html`<td class="c sh-target" title="${target && h.par ? planLabel(target, h.par) : ''}">${target ?? '—'}</td>` : ''}
      <td class="c">${st?.n ? st.avg.toFixed(1) : '—'}${last.has(no) ? html`<span class="small muted">／${last.get(no)}</span>` : ''}</td>
      <td class="sh-memo">${club ? html`<span class="sh-club">🏌️ ${club.name}（${club.carry}${unit}）</span>` : ''}${h.memo ? html`<span>${h.memo}</span>` : ''}</td>
    </tr>`;
  };
  const table = (i) => {
    const nos = Array.from({ length: 9 }, (_, k) => i * 9 + k + 1);
    const par = nos.reduce((a, no) => a + (course.holes.find((x) => x.hole_no === no)?.par || 0), 0);
    const tsum = plan ? nos.reduce((a, no) => a + (plan.get(no) || 0), 0) : null;
    return html`<div class="card sheet-card">
      <h3 style="margin-bottom:6px">${multi ? names[i] : i ? 'IN（10〜18番）' : 'OUT（1〜9番）'}<span class="small muted">　パー ${par}${tsum ? `・目標 ${tsum}` : ''}</span></h3>
      <div class="table-wrap"><table class="data sheet"><thead><tr><th>ホール</th><th class="c">パー</th><th class="r">ヤード</th><th class="c hide-sm">HDCP</th>${plan ? html`<th class="c">目標</th>` : ''}<th class="c">平均／前回</th><th>メモ・番手の目安</th></tr></thead>
        <tbody>${nos.map(row)}</tbody></table></div></div>`;
  };

  mount(root, html`
    <div class="page-header">
      <div><a class="small" href="#/courses/${id}">← コース詳細</a><h1>${course.name} 攻略シート</h1>
        <div class="sub">${[nextHere && `次のラウンド：${fmtDate(nextHere.date)}`, goal && `目標：${goal}切り${multi ? '' : `（${goal - 1} 打を配分）`}`, `このコースでの記録 ${rounds.length} ラウンド${latest ? `（前回 ${fmtDate(latest.date)}）` : ''}`].filter(Boolean).join('　・　')}</div></div>
      <div class="actions"><button class="btn" id="print-sheet">${icon('download')}印刷・PDF</button><a class="btn" href="#/ai?purpose=course&amp;course=${id}">${icon('ai')}AIに作戦を聞く</a></div>
    </div>
    ${!goal ? html`<div class="notice"><span>🎯 目標スコアを決めると、ホールごとの目標打数（例：ボギーでOK・パー狙い）も表示されます。</span><a class="btn btn-sm" href="#/settings">目標を決める</a></div>` : ''}
    <div class="sheet-grid">${names.map((_, i) => table(i))}</div>
    <p class="small muted" style="margin-top:10px">「目標」は過去に崩しやすいホールや HDCP の小さいホールに多めに配分しています。番手の目安はパー3 だけ、飛距離の記録（なければ想定飛距離）から出しています。</p>
  `);
  $('#print-sheet', root).addEventListener('click', () => window.print());
}
