// AI（ChatGPT・Claude・Gemini など）にスコアを分析してもらうための質問文（プロンプト）を作る。
// ここでは文章を作るだけで、どこにも送信しない（利用者が自分でコピーして貼り付ける）。
// 名前・同伴者は含めない。メモは利用者が選んだときだけ含める。
import { summarize, aggregate, holeAnalysis, onCourseHoles, courseHoleNo, filterRounds, played, trendInsights, shotImpact, goalPlan } from './stats.js';

export const AI_PURPOSES = [
  { key: 'overall', label: '総合分析', desc: '強み・弱みと、スコアに一番影響していること', period: 'last20' },
  { key: 'practice', label: '練習メニュー', desc: '次の4週間の練習計画を作ってもらう', period: 'last10' },
  { key: 'goal', label: '目標達成プラン', desc: '目標スコアに届くための作戦と優先順位', period: 'last10' },
  { key: 'round', label: 'ラウンドの振り返り', desc: '1つのラウンドを詳しく振り返る' },
  { key: 'course', label: 'コース攻略', desc: '次に回るコースのホールごとの作戦' },
  { key: 'clubs', label: 'クラブ・飛距離', desc: '14本の構成と番手選びの相談', period: 'last10' },
  { key: 'free', label: '自由に質問', desc: '聞きたいことを自分で書く', period: 'last20' },
];
export const AI_LENGTHS = [['short', '短め'], ['normal', 'ふつう'], ['long', '詳しく']];

// 答えを読んだあとに続けて聞くと良い質問の例（目的ごと）
export const AI_FOLLOWUPS = {
  overall: ['いちばん効果が大きい改善点を、練習方法とあわせてもう少し詳しく教えてください。', '次のラウンドで、スコアを守るために避けるべきことを教えてください。'],
  practice: ['この練習メニューを、時間がない週向けに半分の量にしてください。', 'パター練習だけを、自宅でできるメニューにしてください。'],
  goal: ['目標を達成するための、ラウンド前日・当日の準備を教えてください。', 'ダブルボギー以上を減らすための考え方を、場面別に教えてください。'],
  round: ['崩れたホールで、どう判断すればよかったかを具体的に教えてください。', '次に同じコースを回るときの作戦を、ホールごとに短くまとめてください。'],
  course: ['この作戦を、スマホで見やすいようにホールごとに1行でまとめてください。', '雨や風が強い日に変えたほうがいいところを教えてください。'],
  clubs: ['次に買い替えるなら、どの番手を優先すべきですか？', '練習場で飛距離の階段を確かめる方法を教えてください。'],
  free: ['今の答えを、優先度の高い順に3つにまとめてください。', 'もう少し初心者にも分かる言葉で説明してください。'],
};
export const AI_PERIODS = [['last10', '直近10ラウンド'], ['last20', '直近20ラウンド'], ['12m', '直近12か月'], ['year', '今年'], ['all', '全期間']];

const MAX_LIST = 30; // ラウンド一覧に載せる最大数
const MAX_HOLE_ROUNDS = 10; // ホールごとの記録を載せる最大ラウンド数
const WEEK = '日月火水木金土';

const f1 = (v) => (v == null || !Number.isFinite(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const f2 = (v) => (v == null || !Number.isFinite(v) ? '—' : (Math.round(v * 100) / 100).toFixed(2));
const pc = (v) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`);
const sign = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`);
const signInt = (v) => (v == null ? '—' : v === 0 ? 'E' : v > 0 ? `+${v}` : `−${-v}`);
function jdate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}/${m}/${d}（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
}
const sdate = (iso) => iso.split('-').map(Number).join('/');
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || b.id - a.id;

// ---------- 目的ごとのお願い ----------
function purposeText(p, ctx) {
  const goal = ctx.goal ? `${ctx.goal}切り（${ctx.goal - 1}以下）` : null;
  switch (p) {
    case 'overall': return [
      '私のゴルフの「強み」と「弱み」を、ティーショット・アプローチ（パーオンまで）・パッティング・トラブル回避（OB・ペナルティ・大叩き）に分けて分析してください。',
      'スコアに最も影響している要因を、根拠となる数字とあわせて上位3つ挙げ、それぞれ改善すると1ラウンドで何打くらい縮まりそうか目安を示してください。',
      '最近良くなっている点・悪くなっている点（傾向）があれば指摘してください。',
      '最後に、次のラウンドで意識すべきことを3つにまとめてください。',
    ];
    case 'practice': return [
      'このデータから、私が優先して練習すべきことを決め、次の4週間の練習メニューを週ごとに作ってください。',
      '練習場・パター練習・自宅でできること（素振り・パター・ストレッチなど）に分け、各ドリルの目的・やり方・回数・時間の目安を書いてください。',
      '練習量は「週に練習場1回（約1時間）＋自宅で毎日10分」程度を想定してください（多すぎる場合は優先度の高いものに絞ってください）。',
      '4週間後に効果を確かめるための指標（例：3パットの回数、FWキープ率）と目標値も示してください。',
    ];
    case 'goal': return [
      goal ? `目標は「${goal}」です。` : '目標スコアはまだ決めていません。今の実力から、3か月で現実的に狙える目標をまず提案してください。',
      '今の実力と目標との差を数字で示し、その差をどこで埋めるのが現実的か（OB・ペナルティ、3パット、ダブルボギー以上、パー3/4/5 など）を優先順位つきで説明してください。',
      'ラウンド中の考え方（例：ボギーペースの組み立て、無理をしない場面、刻む判断）を具体的に教えてください。',
      '目標に向けた練習の重点と、達成までの目安（何ラウンドくらいで届きそうか）も書いてください。',
    ];
    case 'round': return [
      '「対象のラウンド」を振り返ってください。良かった点と、スコアを崩した原因をホール単位で具体的に挙げてください。',
      '「いつもの私」の数字と比べて、このラウンドで特に違った点を説明してください。',
      'このラウンドから分かる課題と、次のラウンド（特に同じコースを回るとき）に気をつけることを3つにまとめてください。',
    ];
    case 'course': return [
      `「${ctx.courseName}」を次に回るときの攻略プランを作ってください。`,
      'ホールごとに、ティーショットのクラブ選び（私の飛距離をもとに）・狙う場所・刻むべきか・注意点を簡潔に書いてください。',
      '私がこのコースで過去に崩しやすかったホールと、その対策を特に詳しく説明してください（データがない場合はホールの長さ・パー・HDCP から推測してください）。',
      goal ? `目標「${goal}」を達成するための、ホールごとの目標打数（パー狙い・ボギーでOK など）の配分も示してください。` : '今の実力に合った、ホールごとの目標打数（パー狙い・ボギーでOK など）の配分も示してください。',
    ];
    case 'free': return [
      ctx.question ? `質問：${ctx.question}` : '質問：（ここに聞きたいことを書いてください）',
      '下の私のデータを参考に、私に合った答えをお願いします。',
    ];
    case 'clubs': return [
      '私のクラブセッティングと飛距離を分析してください。番手間の距離の差（重なっている番手・大きく空いている距離）を指摘してください。',
      '14本の構成について、入れ替えや追加・削除の案があれば理由とともに提案してください（具体的な商品名ではなく、番手やロフトで）。',
      'コースでの番手選びのコツ（キャリーとトータルの使い分け、ばらつきの考え方など）を教えてください。',
      'スコアのデータから、飛距離よりも優先して改善すべきことがあれば指摘してください。',
    ];
    default: return [];
  }
}

// ---------- データの表 ----------
function summaryLines(a, title) {
  const bp = (p) => (a.byPar[p].n ? `${f2(a.byPar[p].avg)}（パー比 ${sign(a.byPar[p].toPar, 2)}、${a.byPar[p].n}ホール）` : '—');
  const r = a.results;
  const holes = a.holes || 1;
  return [
    `## ${title}`,
    `- ラウンド数：${a.rounds}（うち18ホール ${a.completeRounds}）`,
    `- 平均スコア：${f1(a.avgScore)}（パー比 ${sign(a.avgToPar)}）／ベスト ${a.best ? a.best.strokes : '—'}${a.worst ? `／ワースト ${a.worst.strokes}` : ''}`,
    `- 平均パット（18ホール換算）：${f1(a.puttsPerRound)}（1パット率 ${pc(a.onePuttRate)}、3パット ${f1(a.threePuttsPerRound)} 回/ラウンド）`,
    `- FWキープ率：${pc(a.fwRate)}（左に外す ${pc(a.fwLeftRate)}、右に外す ${pc(a.fwRightRate)}、${a.fwTotal}回中）`,
    `- パーオン率：${pc(a.girRate)}（パーオン時の平均パット ${f2(a.puttsPerGir)}）／ボギーオン率（規定打数−1 までにオン）：${pc(a.bogeyOnRate)}／リカバリー率（パーオンせずパー以内）：${pc(a.scrambleRate)}／サンドセーブ率：${pc(a.sandSaveRate)}（${a.sandChances}回中）`,
    `- OB・ペナルティ：${f1(a.penaltiesPerRound)} 回/ラウンド`,
    `- パー別の平均：パー3 ${bp(3)}、パー4 ${bp(4)}、パー5 ${bp(5)}`,
    `- スコアの内訳（全${a.holes}ホール）：イーグル以上 ${pc(r.eagle / holes)}、バーディ ${pc(r.birdie / holes)}、パー ${pc(r.par / holes)}、ボギー ${pc(r.bogey / holes)}、ダブルボギー ${pc(r.double / holes)}、トリプル以上 ${pc(r.triple / holes)}`,
    `- 前半（1〜9番）平均 ${f1(a.frontAvg)}、後半（10〜18番）平均 ${f1(a.backAvg)}`,
  ];
}

function roundListLines(rounds) {
  const lines = ['日付,コース,ホール数,スコア,パー比,パット,FWキープ,パーオン,OB・ペナ,ダボ以上'];
  for (const r of rounds) {
    const s = summarize(r);
    lines.push([
      sdate(r.date), `${r.course_name || '不明'}${r.nines_label ? `（${r.nines_label}）` : ''}`, s.holes,
      s.holes ? s.strokes : '—', s.holes ? signInt(s.toPar) : '—', s.puttHoles ? s.putts : '—',
      s.fwTotal ? `${s.fwHit}/${s.fwTotal}` : '—', s.girKnown ? `${s.gir}/${s.girKnown}` : '—', s.penalties, s.results.double + s.results.triple,
    ].join(','));
  }
  return lines;
}

const FW = { hit: '○', left: '←', right: '→' };
function holeLines(r, { memo }) {
  const s = summarize(r);
  const hs = Array.from({ length: 18 }, (_, i) => r.holes.find((h) => h.hole_no === i + 1) || null);
  const cell = (fn) => hs.map((h) => (h ? fn(h) : '.')).reduce((acc, v, i) => acc + (i === 9 ? ' | ' : i ? ' ' : '') + v, '');
  const head = [jdate(r.date), r.course_name || '不明', r.nines_label && `回ったコース：${r.nines_label}`, r.tee && `${r.tee}ティー`, r.weather].filter(Boolean).join(' ・ ');
  const lines = [
    `### ${head}`,
    `スコア ${s.holes ? s.strokes : '—'}（パー${s.par || '—'}、${s.holes ? signInt(s.toPar) : '—'}${s.complete ? '' : `、${s.holes}ホールのみ`}）／OUT ${s.front.holes ? s.front.strokes : '—'}・IN ${s.back.holes ? s.back.strokes : '—'}`,
    `ホール: ${hs.map((_, i) => i + 1).reduce((acc, v, i) => acc + (i === 9 ? ' | ' : i ? ' ' : '') + v, '')}`,
    `パー:   ${cell((h) => h.par ?? '.')}`,
  ];
  if (hs.some((h) => h?.yards)) lines.push(`ヤード: ${cell((h) => h.yards ?? '.')}`);
  lines.push(`スコア: ${cell((h) => (played(h) ? h.strokes : '.'))}`);
  if (hs.some((h) => Number.isFinite(h?.putts))) lines.push(`パット: ${cell((h) => (Number.isFinite(h.putts) ? h.putts : '.'))}`);
  if (hs.some((h) => h?.fairway)) lines.push(`FW:     ${cell((h) => (h.par === 3 ? '-' : FW[h.fairway] || '.'))}`);
  if (hs.some((h) => h?.penalties)) lines.push(`OB等:   ${cell((h) => h.penalties || 0)}`);
  if (hs.some((h) => h?.bunker)) lines.push(`バンカー: ${cell((h) => h.bunker || 0)}`);
  if (memo && r.memo) lines.push(`メモ：${r.memo.replace(/\s*\n\s*/g, ' ／ ')}`);
  if (memo && hs.some((h) => h?.note)) lines.push(`ホールのメモ：${hs.filter((h) => h?.note).map((h) => `${h.hole_no}番 ${h.note.replace(/\s*\n\s*/g, ' ')}`).join(' ／ ')}`);
  return lines;
}

function courseLines(course, rounds, { memo = false, goal = null } = {}) {
  const names = course.nines?.length ? course.nines : ['OUT', 'IN'];
  const multi = names.length > 2;
  const label = (no) => (multi ? `${names[Math.floor((no - 1) / 9)]}${((no - 1) % 9) + 1}` : String(no));
  const stats = holeAnalysis(rounds.map(onCourseHoles), names.length * 9);
  // 目標スコアの配分（18 ホールのコースだけ）。アプリのスコア入力でも同じ配分を表示している
  const plan = goal && !multi ? goalPlan(course.holes, goal, (no) => {
    const st = stats[no - 1];
    if (st?.n >= 2) return 100 + st.toPar;
    const hd = course.holes.find((x) => x.hole_no === no)?.hdcp;
    return hd ? 50 - hd : 0;
  }) : null;
  const lines = [
    `## ${course.name}${course.location ? `（${course.location}）` : ''}`,
    `- ${names.length * 9}ホール${multi ? `（${names.join('・')} の9ホールずつ）` : ''}、コースレート ${course.rating ?? '不明'}、スロープ ${course.slope ?? '不明'}`,
    `- 私のこのコースでのラウンド数：${rounds.length}`,
    '',
  ];
  const withMemo = memo && course.holes.some((h) => h.memo);
  lines.push(`ホール,パー,ヤード,HDCP,${plan ? `目標打数（${goal}切りの配分）,` : ''}私の回数,私の平均,パー比,ベスト,平均パット,パー以内の率,ダボ以上の率${withMemo ? ',私のメモ' : ''}`);
  for (let no = 1; no <= names.length * 9; no++) {
    const h = course.holes.find((x) => x.hole_no === no) || {};
    const st = stats[no - 1];
    const dbl = st.n ? (st.results.double + st.results.triple) / st.n : null;
    lines.push([label(no), h.par ?? '—', h.yards ?? '—', h.hdcp ?? '—', ...(plan ? [plan.get(no) ?? '—'] : []), st.n,
      st.n ? f2(st.avg) : '—', st.n ? sign(st.toPar, 2) : '—', st.n ? st.best : '—', st.n ? f2(st.avgPutts) : '—', st.n ? pc(st.parOrBetter) : '—', st.n ? pc(dbl) : '—', ...(withMemo ? [(h.memo || '').replace(/[,\n]/g, '、')] : [])].join(','));
  }
  return lines;
}

function clubLines(clubs, unit) {
  const bag = clubs.filter((c) => c.in_bag);
  if (!bag.length) return [];
  const lines = [`番手,種類,ロフト,シャフト,平均キャリー(${unit}),平均トータル(${unit}),最大キャリー,最小キャリー,記録数`];
  const kind = { driver: 'ドライバー', wood: 'FW', hybrid: 'UT', iron: 'アイアン', wedge: 'ウェッジ', putter: 'パター' };
  for (const c of bag) {
    const n = (v) => (v == null ? '—' : Math.round(v));
    lines.push([c.name, kind[c.category] || c.category, c.loft != null ? `${c.loft}°` : '—', [c.shaft, c.flex].filter(Boolean).join(' ') || '—',
      n(c.avg_carry ?? c.target_carry), n(c.avg_total), n(c.max_carry), n(c.min_carry), c.shot_count || 0].join(','));
  }
  lines.push(`（バッグの中 ${bag.length} 本。記録数が 0 の番手の平均キャリーは、本人が設定した目標キャリー）`);
  return lines;
}

// ---------- 組み立て ----------
// rounds / courses / clubs は API の値。opts: { purpose, period, roundId, courseId, holes, memo, clubs }
export function buildAiPrompt({ rounds, courses, clubs = [], settings = {} }, opts) {
  const purpose = AI_PURPOSES.find((p) => p.key === opts.purpose) || AI_PURPOSES[0];
  const unit = settings.unit === 'm' ? 'm' : 'ヤード';
  const goal = Number(settings.goal) || null;
  const all = [...rounds].sort(byDateDesc);
  const allSums = all.map(summarize);
  const handicap = aggregate(allSums).handicap;
  const course = purpose.key === 'course' ? courses.find((c) => c.id === Number(opts.courseId)) || null : null;
  const target = purpose.key === 'round' ? all.find((r) => r.id === Number(opts.roundId)) || all[0] || null : null;
  const ctx = { goal, courseName: course?.name || '', question: String(opts.question || '').trim().slice(0, 2000) };

  const out = [];
  const add = (...lines) => out.push(...lines);
  add('あなたは経験豊富なゴルフのコーチであり、データ分析が得意なアナリストです。',
    '以下は、私（アマチュアゴルファー）がスマホアプリに記録したスコアのデータです。データをよく読み、「お願い」に沿って日本語で答えてください。', '');
  add(`# お願い（${purpose.label}）`, ...purposeText(purpose.key, ctx).map((t) => `- ${t}`), '');
  const length = { short: '- 全体で 400 字くらいに短くまとめてください。', long: '- 根拠や具体例を交えて、詳しく説明してください。' }[opts.length] || '';
  add('# 答え方',
    '- 最初に、結論を3行以内でまとめてください。',
    '- 見出しと箇条書きを使い、判断の根拠になった数字を添えてください。',
    '- 提案は具体的に、優先度の高い順に。専門用語には短い説明をつけてください。',
    ...(length ? [length] : []),
    '- データから分からないことは推測で断定せず、必要なら最後に私への質問を書いてください。', '');

  const first = all.length ? sdate(all[all.length - 1].date) : null;
  const last = all.length ? sdate(all[0].date) : null;
  add('# 私について',
    `- 目標スコア：${goal ? `${goal}切り（18ホールで ${goal - 1} 以下）` : '未設定'}`,
    `- 推定ハンディキャップ：${handicap != null ? `${handicap.toFixed(1)}（アプリによる簡易計算）` : '不明（18ホールのラウンドが3つ未満）'}`,
    `- 記録しているラウンド：${all.length}${first ? `（${first} 〜 ${last}）` : ''}`,
    `- 距離の単位：${unit}`, '');

  if (!all.length && purpose.key !== 'clubs' && purpose.key !== 'course') {
    add('# データ', '（まだラウンドの記録がありません。一般的なアドバイスをお願いします）', '');
  }

  if (purpose.key === 'round' && target) {
    const others = all.filter((r) => r.id !== target.id).slice(0, 20);
    add('# 対象のラウンド', ...holeLines(target, { memo: opts.memo }), '');
    const s = summarize(target);
    add('## このラウンドの数字',
      `- パット ${s.puttHoles ? s.putts : '—'}（3パット ${s.threePutts} 回）、FWキープ ${s.fwTotal ? `${s.fwHit}/${s.fwTotal}（左 ${s.fwLeft}・右 ${s.fwRight}）` : '—'}、パーオン ${s.girKnown ? `${s.gir}/${s.girKnown}` : '—'}`,
      `- OB・ペナルティ ${s.penalties}、バーディ以上 ${s.results.eagle + s.results.birdie}、パー ${s.results.par}、ボギー ${s.results.bogey}、ダブルボギー ${s.results.double}、トリプル以上 ${s.results.triple}`, '');
    if (others.length) add(...summaryLines(aggregate(others.map(summarize)), `いつもの私（このラウンド以外の直近 ${others.length} ラウンド）`), '');
    const sameCourse = target.course_id ? all.filter((r) => r.course_id === target.course_id && r.id !== target.id) : [];
    if (sameCourse.length) {
      const st = holeAnalysis(sameCourse.map(onCourseHoles), 54);
      add(`## 同じコースでの過去のホール別平均（${sameCourse.length} ラウンド）`,
        `平均: ${Array.from({ length: 18 }, (_, i) => { const a = st[courseHoleNo(target, i + 1) - 1]; return a?.n ? f1(a.avg) : '.'; }).reduce((acc, v, i) => acc + (i === 9 ? ' | ' : i ? ' ' : '') + v, '')}`, '');
    }
  } else if (purpose.key === 'course') {
    if (course) {
      const atCourse = all.filter((r) => r.course_id === course.id);
      add('# コースの情報と、このコースでの私の成績', ...courseLines(course, atCourse, { memo: opts.memo, goal }), '');
      if (opts.holes && atCourse.length) {
        add(`# このコースでのホールごとの記録（新しい順・最大 ${MAX_HOLE_ROUNDS} ラウンド）`);
        atCourse.slice(0, MAX_HOLE_ROUNDS).forEach((r) => add(...holeLines(r, { memo: opts.memo }), ''));
      }
    } else {
      add('# コースの情報', '（コースが選ばれていません）', '');
    }
    const recent = all.slice(0, 10);
    if (recent.length) add(...summaryLines(aggregate(recent.map(summarize)), `最近の私の実力（直近 ${recent.length} ラウンド・全コース）`), '');
  } else {
    const scope = filterRounds(all, { period: opts.period || purpose.period || 'last20' });
    const label = (AI_PERIODS.find(([k]) => k === (opts.period || purpose.period)) || [, '直近'])[1];
    if (scope.length) {
      add('# 成績のまとめ', ...summaryLines(aggregate(scope.map(summarize)), `対象：${label}（${scope.length} ラウンド）`), '');
      const trend = trendInsights(allSums);
      if (trend.length) add('## 最近の傾向（直近5ラウンドとそれ以前の比較）', ...trend.map((t) => `- ${t.text}`), '');
      const impact = shotImpact(scope);
      if (impact.length) add('## ミスの影響（ホールあたりのパー比の平均）', ...impact.map((it) => `- ${it.title}：${[it.good, ...it.bads].map((g) => `${g.label} ${sign(g.avg, 2)}（${g.n}ホール）`).join('、')}${it.perRound != null ? `。1ラウンドあたり約 ${f1(it.perRound)} 打の差` : ''}`), '');
      const byCourse = new Map();
      for (const s of scope.map(summarize)) { const k = s.courseId ? `c${s.courseId}` : `n${s.course}`; if (!byCourse.has(k)) byCourse.set(k, { name: s.course || '不明', list: [] }); byCourse.get(k).list.push(s); }
      if (byCourse.size >= 2) add('## コース別の成績', 'コース,ラウンド数,平均スコア,ベスト,ホールあたりのパー比', ...[...byCourse.values()].map((c) => { const a = aggregate(c.list); return [c.name, c.list.length, f1(a.avgScore), a.best?.strokes ?? '—', a.holes ? sign(c.list.reduce((t, s) => t + s.toPar, 0) / a.holes, 2) : '—'].join(','); }), '');
      add(`# ラウンド一覧（新しい順${scope.length > MAX_LIST ? `・最新 ${MAX_LIST} 件` : ''}）`, ...roundListLines(scope.slice(0, MAX_LIST)), '');
      if (opts.holes) {
        add(`# ホールごとの記録（新しい順・最大 ${MAX_HOLE_ROUNDS} ラウンド）`);
        scope.slice(0, MAX_HOLE_ROUNDS).forEach((r) => add(...holeLines(r, { memo: opts.memo }), ''));
      } else if (opts.memo) {
        const memos = scope.slice(0, MAX_LIST).filter((r) => r.memo);
        if (memos.length) add('# ラウンドのメモ', ...memos.map((r) => `- ${sdate(r.date)}：${r.memo.replace(/\s*\n\s*/g, ' ／ ')}`), '');
      }
    }
  }

  if (opts.clubs) {
    const cl = clubLines(clubs, unit);
    add('# クラブと飛距離', ...(cl.length ? cl : ['（クラブが登録されていません）']), '');
  }

  add('# データの見方',
    '- スコア・パットなどの「.」は未記録、「—」はデータなしです。',
    '- FW は パー4・5 のティーショットの結果（○＝フェアウェイキープ、←＝左に外した、→＝右に外した、-＝パー3）。',
    '- パーオン：「スコア − パット ≦ パー − 2」のホール（パットを記録したホールのみで判定）。',
    '- OB等：OB・ペナルティの打数。ダボ以上：ダブルボギー以上のホール数。',
    '- 推定ハンディキャップは、直近20ラウンドのうち良い8つを使う簡易計算です。');
  return out.join('\n');
}
