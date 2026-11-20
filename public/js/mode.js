// 動作モード。スマホ単独版（npm run build:phone で作る版）は index.html に
// <meta name="golf-mode" content="standalone"> が入り、データをこの端末の中に保存する
export const STANDALONE = typeof document !== 'undefined'
  && document.querySelector('meta[name="golf-mode"]')?.getAttribute('content') === 'standalone';
