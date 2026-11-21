// ホーム画面のカード：目標スコアの達成状況・はじめての人向けの案内
import { html, $, $$, fmt, fmtDate, shortDate, openModal, toast, errorToast } from '../util.js';
import { saveSettings, STANDALONE, localMeta } from '../api.js';
import { GOAL_CHOICES, suggestGoal, goalProgress } from '../stats.js';

const recentAvg = (sums) => {
  const c = sums.filter((s) => s.complete).sort((a, b) => a.date.localeCompare(b.date)).slice(-5);
  return c.length ? c.reduce((a, s) => a + s.strokes, 0) / c.length : null;
};

// ---------- 目標スコア ----------
export function goalCardHtml(sums, goalSetting) {
  const goal = Number(goalSetting) || null;
  if (!goal) {
    const sug = suggestGoal(recentAvg(sums));
    return html`<div class="card goal-card" id="goal-card">
      <div class="card-header"><div><h2>🎯 目標スコアを決めましょう</h2>
        <div class="sub">決めると、達成した回数と「どこで打数を縮めると近づくか」を表示します</div></div></div>
      <div class="goal-choices">${GOAL_CHOICES.map((g) => html`<button type="button" class="btn btn-sm ${g === sug ? 'btn-primary' : ''}" data-goal="${g}">${g}切り${g === sug ? '（おすすめ）' : ''}</button>`)}</div>
    </div>`;
  }
  const p = goalProgress(sums, goal);
  const t = (label, value, sub) => html`<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${sub}</div></div>`;
  const pace = p.gap == null ? '' : p.gap <= 0 ? '平均で達成ペースです 🎉' : `目標まで平均あと ${fmt(p.gap, 1)} 打`;
  return html`<div class="card goal-card" id="goal-card">
    <div class="card-header"><div><h2>🎯 目標：${goal}切り</h2><div class="sub">18ホールで ${goal - 1} 以下なら達成</div></div>
      <div class="actions"><a class="btn btn-sm" href="#/ai?purpose=goal">AIに相談</a><button type="button" class="btn btn-sm" data-goal-edit>変更</button></div></div>
    <div class="tiles goal-tiles">
      ${t('達成', `${p.achieved} 回`, p.rounds ? `${p.rounds} ラウンド中${p.firstAchieved ? `・初達成 ${shortDate(p.firstAchieved.date)}` : ''}` : 'まだ記録がありません')}
      ${t('直近5ラウンドの平均', fmt(p.recentAvg, 1), pace)}
      ${t('ベスト', p.best ? p.best.strokes : '—', p.best ? `${shortDate(p.best.date)} ${p.best.course || ''}` : '')}
    </div>
    ${p.last10.length ? html`<div class="goal-recent"><span class="small secondary">最近のラウンド（<span class="gd-key"></span>＝達成）</span>
      <div class="goal-dots">${p.last10.map((r) => html`<a class="gd ${r.ok ? 'ok' : ''}" href="#/rounds/${r.id}" title="${fmtDate(r.date)} ${r.course || ''}" aria-label="${fmtDate(r.date)} ${r.strokes}${r.ok ? '（達成）' : ''}">${r.strokes}</a>`)}</div></div>` : ''}
    ${p.tips.length ? html`<h3 style="margin:14px 0 6px">縮めるポイント</h3>
      <ul class="goal-tips">${p.tips.map((x) => html`<li><div>${x.text}</div><div class="small muted">${x.hint}</div></li>`)}</ul>`
      : p.rounds ? html`<p class="small muted" style="margin-top:12px">大きく崩れているところは見当たりません。この調子で続けましょう。</p>` : ''}
  </div>`;
}

async function setGoal(goal, onSaved) {
  try {
    await saveSettings({ goal: goal ? String(goal) : '' });
    toast(goal ? `目標を「${goal}切り」にしました` : '目標をなしにしました');
    onSaved();
  } catch (e) {
    errorToast(e);
  }
}

function openGoalPicker(current, sums, onSaved) {
  const sug = suggestGoal(recentAvg(sums));
  const m = openModal({
    title: '目標スコアを変更',
    body: html`<p class="secondary">18ホールのスコアで目指す目標を選んでください。</p>
      <div class="goal-choices" style="margin-top:12px">${GOAL_CHOICES.map((g) => html`<button type="button" class="btn ${g === current ? 'btn-primary' : ''}" data-pick="${g}">${g}切り${g === sug ? '（おすすめ）' : ''}</button>`)}
        <button type="button" class="btn btn-ghost" data-pick="">目標なし</button></div>`,
  });
  $$('[data-pick]', m.el).forEach((b) => b.addEventListener('click', () => { m.close(); setGoal(Number(b.dataset.pick) || null, onSaved); }));
}

// ---------- はじめての人向けの案内 ----------
const GUIDE_KEY = 'golf-guide-closed';
const guideClosed = () => { try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch { return false; } };

export async function guideHtml({ rounds, courses, sample }) {
  if (guideClosed()) return '';
  const sc = sample?.present ? sample.counts : { courses: 0, rounds: 0 };
  const realCourses = Math.max(0, courses.length - (sc.courses || 0));
  const realRounds = Math.max(0, rounds.length - (sc.rounds || 0));
  const sa = STANDALONE ? await import('../standalone.js').catch(() => null) : null;
  const meta = STANDALONE ? await localMeta().catch(() => null) : null;
  const steps = [];
  if (sa) {
    steps.push({
      done: sa.isInstalled(), title: 'ホーム画面に追加する',
      sub: sa.isIos() ? 'iPhone は先に追加してから記録してください（Safari で入力したデータはホーム画面のアプリに引き継がれません）' : '電波のないゴルフ場でもアプリのように使えます',
      action: html`<button type="button" class="btn btn-sm" data-guide="install">追加方法を見る</button>`,
    });
  }
  steps.push({
    done: realCourses > 0, title: 'よく行くコースを登録する',
    sub: 'コースガイドの表を貼り付けると自動で入力できます。友達からもらったコースのファイルも読み込めます',
    action: html`<a class="btn btn-sm" href="#/courses">コースを登録</a>`,
  });
  steps.push({
    done: realRounds > 0, title: 'スコアを記録する',
    sub: '「＋ 入力」から。1ホールずつ大きなボタンで入力でき、途中でアプリを閉じても続きから再開できます',
    action: html`<a class="btn btn-sm btn-primary" href="#/rounds/new">スコアを入力</a>`,
  });
  // 最初の準備（ホーム画面・コース・スコア）が終わっていれば出さない（バックアップは別のお知らせで案内）
  if (steps.every((s) => s.done)) return '';
  if (sa) {
    steps.push({
      done: Boolean(meta?.last_backup_at), title: 'ときどきバックアップする',
      sub: 'データはこのスマホの中だけにあります。機種変更や故障に備えて、写真込みのバックアップを保存しましょう',
      action: html`<button type="button" class="btn btn-sm" data-guide="backup">バックアップ</button>`,
    });
  }
  return html`<div class="card guide-card section" id="guide-card">
    <div class="card-header"><div><h2>はじめに：${steps.length}つのステップで準備</h2><div class="sub">終わったものには ✓ が付きます。詳しくは <a href="#/help">使い方</a> へ</div></div>
      <button type="button" class="btn btn-ghost btn-sm" data-guide="close">閉じる</button></div>
    <ol class="guide-steps">${steps.map((s, i) => html`<li class="${s.done ? 'done' : ''}">
      <span class="gs-no" aria-hidden="true">${s.done ? '✓' : i + 1}</span>
      <div class="gs-body"><div class="gs-title">${s.title}${s.done ? html`<span class="sr-only">（完了）</span>` : ''}</div><div class="small muted">${s.sub}</div></div>
      ${s.done ? '' : html`<div class="gs-act">${s.action}</div>`}</li>`)}</ol>
  </div>`;
}

// カードのボタンの動作。rerender はホーム画面を作り直す関数
export function bindHomeCards(root, { sums, settings, rerender }) {
  $$('[data-goal]', root).forEach((b) => b.addEventListener('click', () => setGoal(Number(b.dataset.goal), rerender)));
  $('[data-goal-edit]', root)?.addEventListener('click', () => openGoalPicker(Number(settings.goal) || null, sums, rerender));
  $('[data-guide=close]', root)?.addEventListener('click', () => {
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* ignore */ }
    $('#guide-card', root)?.remove();
  });
  $('[data-guide=install]', root)?.addEventListener('click', async () => (await import('../standalone.js')).openInstallHelp());
  $('[data-guide=backup]', root)?.addEventListener('click', async () => (await import('../standalone.js')).runBackupFlow(rerender));
}
