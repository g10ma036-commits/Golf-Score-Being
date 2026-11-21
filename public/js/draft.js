// スコア入力の下書き（入力途中のラウンド）。
// プレー中にカメラや LINE を開いてアプリが閉じられても、続きから入力できるように端末に保存しておく
import { fmtDate } from './util.js';

const KEY = 'golf-round-draft';

export function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    return d && d.v === 1 && d.meta && Array.isArray(d.holes) ? d : null;
  } catch {
    return null;
  }
}

// 保存できたら true（プライベートブラウズなどで保存できない環境では false）
export function saveDraft({ edit_id = null, meta, holes }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, edit_id, meta, holes, saved_at: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export const draftHref = (d) => (d.edit_id ? `#/rounds/${d.edit_id}/edit` : '#/rounds/new');
export const draftHoles = (d) => d.holes.filter((h) => Number.isFinite(h?.strokes) && h.strokes > 0).length;

// 保存した時刻（今日なら「10:32」、それ以外は「11/21 10:32」）
export function draftTime(d) {
  const t = new Date(d.saved_at);
  if (Number.isNaN(t.getTime())) return '';
  const hm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  return t.toDateString() === new Date().toDateString() ? hm : `${t.getMonth() + 1}/${t.getDate()} ${hm}`;
}

// 例:「2026/11/22(日) ○○ゴルフクラブ・9ホール入力済み（10:32 に自動保存）」
export function draftText(d) {
  const n = draftHoles(d);
  const parts = [d.meta.date ? fmtDate(d.meta.date) : '', d.meta.course_name || 'コース未選択'].filter(Boolean).join(' ');
  return `${d.edit_id ? '（編集中）' : ''}${parts}・${n ? `${n}ホール入力済み` : 'スコア未入力'}（${draftTime(d)} に自動保存）`;
}
