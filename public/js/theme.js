// テーマ（自動 / ライト / ダーク）とテーマカラーを描画前に反映してチラつきを防ぐ（通常のスクリプトとして先に読み込む）
try {
  const t = localStorage.getItem('golf-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  const a = localStorage.getItem('golf-accent');
  if (a && a !== 'green') document.documentElement.dataset.accent = a;
} catch (e) { /* 保存領域が使えない環境では自動のまま */ }
