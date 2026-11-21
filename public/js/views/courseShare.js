// コース情報を友達に渡す（ファイル・テキスト）／もらったコースを読み込む
import { html, mount, $, $$, openModal, toast, errorToast } from '../util.js';
import { api } from '../api.js';
import { buildCourseFile, parseCourseFile } from '../shared/courseFile.js';
import { canShareFile, shareFile, downloadFile, ymd } from '../share.js';

const holesText = (c) => {
  const n = Math.max(1, (c.nines?.length || 2)) * 9;
  const par = (c.holes || []).reduce((a, h) => a + (h.par || 0), 0);
  return `${n}ホール${par ? `・パー${par}` : ''}`;
};
const key = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// ---------- 渡す ----------
export function openCourseExport(courses) {
  const m = openModal({
    title: 'コースを友達に渡す',
    body: html`
      <p class="secondary">選んだコースのパー・ヤード・HDCP などを1つのファイルにします。<strong>スコア・メモ・写真は含まれません。</strong></p>
      <div class="pick-head"><label class="check"><input type="checkbox" data-all checked> すべて選択</label><span class="small muted" data-count></span></div>
      <div class="pick-list">${courses.map((c) => html`<label class="pick-row"><input type="checkbox" data-id="${c.id}" checked>
        <span class="pick-name">${c.name}</span><span class="small muted">${holesText(c)}</span></label>`)}</div>
      <p class="small muted" style="margin-top:10px">受け取った人は、このアプリの「コース」→「読み込む」でファイルを選ぶか、テキストを貼り付けると登録できます。</p>`,
    footer: html`<button class="btn" data-copy>テキストでコピー</button><button class="btn" data-dl>ファイルを保存</button><button class="btn btn-primary" data-share hidden>共有する…</button>`,
  });
  const boxes = $$('[data-id]', m.el);
  const selected = () => courses.filter((c) => boxes.find((b) => Number(b.dataset.id) === c.id)?.checked);
  const sync = () => {
    const n = selected().length;
    $('[data-count]', m.el).textContent = `${n} / ${courses.length} コース`;
    $('[data-all]', m.el).checked = n === courses.length;
    $$('.modal-foot .btn', m.el).forEach((b) => { b.disabled = !n; });
  };
  boxes.forEach((b) => b.addEventListener('change', sync));
  $('[data-all]', m.el).addEventListener('change', (e) => { boxes.forEach((b) => { b.checked = e.target.checked; }); sync(); });
  const makeFile = () => {
    const list = selected();
    const name = list.length === 1 ? `golf-course-${list[0].name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)}.json` : `golf-courses-${ymd()}.json`;
    return new File([JSON.stringify(buildCourseFile(list), null, 1)], name, { type: 'application/json' });
  };
  const shareBtn = $('[data-share]', m.el);
  shareBtn.hidden = !canShareFile(new File(['{}'], 'a.json', { type: 'application/json' }));
  shareBtn.addEventListener('click', async () => { if (await shareFile(makeFile(), 'ゴルフコースの情報')) m.close(); });
  $('[data-dl]', m.el).addEventListener('click', () => { downloadFile(makeFile()); toast('ファイルを保存しました'); });
  $('[data-copy]', m.el).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildCourseFile(selected())));
      toast('コピーしました。LINE などに貼り付けて送れます');
    } catch {
      errorToast('コピーできませんでした。「ファイルを保存」をお試しください');
    }
  });
  sync();
}

// ---------- 読み込む ----------
export function openCourseImport(existing, onDone = () => {}) {
  const m = openModal({
    title: 'もらったコースを読み込む',
    body: html`<div data-step="pick">
        <p class="secondary">友達から受け取ったコースのファイル（.json）を選ぶか、送られてきたテキストを貼り付けてください。</p>
        <div class="actions" style="margin-top:12px"><label class="btn btn-primary">ファイルを選ぶ<input type="file" accept=".json,application/json,text/plain" hidden data-file></label></div>
        <label class="field" style="margin-top:14px"><span>テキストを貼り付け</span><textarea rows="4" data-text placeholder='{"kind":"golf-enjoy-courses", …'></textarea></label>
        <div class="actions" style="margin-top:8px"><button type="button" class="btn" data-read>貼り付けたテキストを読む</button></div>
        <p class="small muted" style="margin-top:10px">iPhone で LINE から受け取ったファイルは、いったん「共有」→「ファイルに保存」してから選んでください。</p>
      </div>
      <div data-step="list" hidden></div>`,
  });
  const show = (items) => {
    const byName = new Map(existing.map((c) => [key(c.name), c]));
    const rows = items.map((it) => ({ ...it, dup: it.error ? null : byName.get(key(it.course.name)) || null }));
    mount($('[data-step=list]', m.el), html`
      <p class="secondary">${rows.length} コースが見つかりました。読み込むコースを選んでください。</p>
      <div class="pick-list">${rows.map((r, i) => html`<label class="pick-row ${r.error ? 'disabled' : ''}">
        <input type="checkbox" data-i="${i}" ${r.error ? 'disabled' : r.dup ? '' : 'checked'}>
        <span class="pick-name">${r.course.name}</span>
        <span class="small ${r.error ? 'bad' : 'muted'}">${r.error ? `読み込めません：${r.error}` : `${holesText(r.course)}${r.dup ? '・登録済み（チェックすると上書き）' : ''}`}</span></label>`)}</div>
      <p class="small muted" style="margin-top:8px">上書きすると、登録済みのコースのパー・ヤード・HDCP・レートなどが置き換わります（メモはそのまま残ります）。</p>
      <div class="form-actions"><button type="button" class="btn" data-back>戻る</button><button type="button" class="btn btn-primary" data-import>読み込む</button></div>`);
    $('[data-step=pick]', m.el).hidden = true;
    $('[data-step=list]', m.el).hidden = false;
    const boxes = $$('[data-i]', m.el);
    const btn = $('[data-import]', m.el);
    const sync = () => {
      const n = boxes.filter((b) => b.checked).length;
      btn.disabled = !n;
      btn.textContent = n ? `${n} コースを読み込む` : '読み込む';
    };
    boxes.forEach((b) => b.addEventListener('change', sync));
    sync();
    $('[data-back]', m.el).addEventListener('click', () => { $('[data-step=pick]', m.el).hidden = false; $('[data-step=list]', m.el).hidden = true; });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      let added = 0;
      let updated = 0;
      for (const b of boxes.filter((x) => x.checked)) {
        const r = rows[Number(b.dataset.i)];
        try {
          if (r.dup) { await api.put(`/api/courses/${r.dup.id}`, { ...r.course, memo: r.dup.memo ?? null }); updated++; } else { await api.post('/api/courses', r.course); added++; }
        } catch (e) {
          errorToast(`${r.course.name}: ${e.message}`);
        }
      }
      if (added || updated) toast([added && `${added} コースを追加`, updated && `${updated} コースを上書き`].filter(Boolean).join('・') + 'しました');
      m.close();
      if (added || updated) onDone();
    });
  };
  const read = (text) => {
    try { show(parseCourseFile(text)); } catch (e) { errorToast(e); }
  };
  $('[data-file]', m.el).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { errorToast('ファイルが大きすぎます'); return; }
    read(await f.text());
  });
  $('[data-read]', m.el).addEventListener('click', () => {
    const t = $('[data-text]', m.el).value;
    if (!t.trim()) { errorToast('テキストを貼り付けてください'); return; }
    read(t);
  });
}
