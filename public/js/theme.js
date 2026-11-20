// テーマ（自動 / ライト / ダーク）を描画前に反映してチラつきを防ぐ（通常のスクリプトとして先に読み込む）
try {
  const t = localStorage.getItem('golf-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* 保存領域が使えない環境では自動のまま */ }
