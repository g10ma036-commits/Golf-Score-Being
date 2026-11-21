// 実績：初めての100切り・初バーディ・ラウンド数など（達成した日とラウンドへのリンク）
import { html, mount, fmtDate } from '../util.js';
import { api } from '../api.js';
import { achievements } from '../stats.js';

export async function render(root) {
  const rounds = await api.get('/api/rounds');
  const list = achievements(rounds);
  const done = list.filter((a) => a.achieved);
  mount(root, html`
    <div class="page-header"><div><h1>実績</h1>
      <div class="sub">${done.length} / ${list.length} 達成。ラウンドを記録すると自動で増えていきます</div></div></div>
    <div class="ach-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${list.length}" aria-valuenow="${done.length}" aria-label="実績の達成数"><div style="width:${Math.round((done.length / list.length) * 100)}%"></div></div>
    <div class="ach-grid">${list.map((a) => html`<${a.round ? 'a' : 'div'} class="ach ${a.achieved ? 'on' : ''}" ${a.round ? html`href="#/rounds/${a.round.id}"` : ''}>
      <span class="ach-ico" aria-hidden="true">${a.icon}</span>
      <span class="ach-body"><strong>${a.title}</strong>
        <span class="small">${a.achieved ? `${fmtDate(a.round.date)}${a.round.course ? ` ${a.round.course}` : ''}` : a.desc}</span></span>
      ${a.achieved ? html`<span class="ach-check" aria-label="達成">✓</span>` : ''}
    </${a.round ? 'a' : 'div'}>`)}</div>
  `);
}
