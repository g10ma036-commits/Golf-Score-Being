// スコアを CSV（Excel・Google スプレッドシート用）にする。1 行 = 1 ラウンド
import { summarize, played } from './stats.js';

const cell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function roundsCsv(rounds) {
  const head = ['日付', 'コース', '回ったコース', 'ティー', '天気', '同伴者', 'ホール数', 'スコア', 'パー', 'パー比', 'OUT', 'IN', 'パット', 'FWキープ', 'FW対象', 'パーオン', 'OB・ペナルティ', 'バンカー', 'メモ', 'ホールのメモ'];
  for (let i = 1; i <= 18; i++) head.push(`${i}番`);
  for (let i = 1; i <= 18; i++) head.push(`${i}番パット`);
  const lines = [head.map(cell).join(',')];
  const sorted = [...rounds].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (const r of sorted) {
    const s = summarize(r);
    const hole = (no) => r.holes.find((h) => h.hole_no === no);
    const row = [
      r.date, r.course_name, r.nines_label, r.tee, r.weather, r.companions, s.holes,
      s.holes ? s.strokes : '', s.holes ? s.par : '', s.holes ? s.toPar : '',
      s.front.holes ? s.front.strokes : '', s.back.holes ? s.back.strokes : '',
      s.puttHoles ? s.putts : '', s.fwTotal ? s.fwHit : '', s.fwTotal || '', s.girKnown ? s.gir : '',
      s.holes ? s.penalties : '', r.holes.reduce((a, h) => a + (h.bunker || 0), 0) || '', r.memo,
      r.holes.filter((h) => h.note).sort((a, b) => a.hole_no - b.hole_no).map((h) => `${h.hole_no}番: ${h.note}`).join('／'),
    ];
    for (let i = 1; i <= 18; i++) { const h = hole(i); row.push(h && played(h) ? h.strokes : ''); }
    for (let i = 1; i <= 18; i++) { const h = hole(i); row.push(h && Number.isFinite(h.putts) ? h.putts : ''); }
    lines.push(row.map(cell).join(','));
  }
  // 先頭の BOM で、Excel でも文字化けせずに開ける
  return '﻿' + lines.join('\r\n') + '\r\n';
}
