// 機能をさがす：言葉を入れると、その機能がある場所へ移動できる（何も入れないときは、すべての機能の一覧）
import { html, mount, $, icon } from '../util.js';
import { STANDALONE } from '../api.js';

// [名前, 場所, リンク, さがすときの言葉（読みがなや言い換え）]
// リンクの go= はその画面の中の場所（要素の id）。そこまでスクロールする
export const FEATURES = [
  ['スコアを入力', 'スコア › ＋入力', '#/rounds/new', 'ラウンド 記録 きろく 新しい 入力 にゅうりょく スコアカード 1ホールずつ 同伴者 下書き'],
  ['ラウンドの一覧・検索', 'スコア', '#/rounds', '過去 履歴 一覧 いちらん 検索 メモ 月ごと 編集 削除'],
  ['ラウンドを比べる', 'スコア › ラウンドを開いて「ほかのラウンドと比べる」', '#/rounds', '比較 ひかく くらべる 前回 同じコース'],
  ['スコアを画像で共有', 'スコア › ラウンドを開いて「画像で共有」', '#/rounds', 'シェア LINE ライン 送る 画像 共有 きょうゆう'],
  ['分析のまとめ（平均・ベスト・ハンディキャップ）', '分析 › まとめ', '#/stats?tab=summary', '平均 へいきん ベスト ハンディキャップ ハンデ パット パーオン 数字 統計 とうけい ぶんせき'],
  ['すべての数字（FWキープ率・3パット率・OB など）', '分析 › まとめ', '#/stats?tab=summary&go=st-all-tiles', 'FW フェアウェイ 3パット OB ボギーオン 1パット リカバリー サンドセーブ バーディ 率'],
  ['スコアの推移', '分析 › まとめ', '#/stats?tab=summary', '推移 すいい グラフ 移動平均'],
  ['直近の傾向', '分析 › まとめ', '#/stats?tab=summary&go=st-insights', '最近 さいきん 傾向 けいこう 直近'],
  ['ベストスコア TOP5', '分析 › まとめ', '#/stats?tab=summary&go=st-top5', 'ベスト 記録 ランキング'],
  ['ミスの影響（何打損しているか）', '分析 › ミスと練習', '#/stats?tab=practice&go=st-impact', 'ミス OB 3パット バンカー フェアウェイ 損 何打 影響 えいきょう'],
  ['今やるべき練習', '分析 › ミスと練習', '#/stats?tab=practice&go=st-practice', '練習 れんしゅう ドリル 弱点 じゃくてん'],
  ['スコアのシミュレーター（試算）', '分析 › ミスと練習', '#/stats?tab=practice&go=simulator', '試算 しさん 予想 よそう 目標 もくひょう 何切り シミュレーション 届く'],
  ['コース別の成績', '分析 › コース・条件', '#/stats?tab=course&go=st-courses', 'コース ゴルフ場 相性 あいしょう 成績'],
  ['条件別のスコア（天気・季節・曜日・同伴者）', '分析 › コース・条件', '#/stats?tab=course&go=st-cond', '天気 てんき 雨 季節 きせつ 夏 冬 平日 土日 曜日 ティー 同伴者 条件'],
  ['距離別の成績（苦手な距離）', '分析 › コース・条件', '#/stats?tab=course&go=st-distance', 'ヤード 距離 きょり 苦手 にがて'],
  ['ティーショットのクラブ別', '分析 › コース・条件', '#/stats?tab=course&go=st-tee', 'ドライバー ウッド UT ユーティリティ 刻む ティーショット'],
  ['スコアの流れ（出だし・上がり・大叩き）', '分析 › コース・条件', '#/stats?tab=course&go=st-flow', '出だし 上がり 大叩き おおたたき 連続 立て直し 流れ'],
  ['前半・後半の平均', '分析 › コース・条件', '#/stats?tab=course&go=st-halves', 'OUT IN アウト イン 前半 後半'],
  ['グラフ（パット数・パーオン率・スコアの分布など）', '分析 › グラフ', '#/stats?tab=charts', 'グラフ パット 推移 月別 分布 ハンディキャップ ティーショットの方向 左 右 スコア内訳'],
  ['上達の履歴', '振り返る', '#/progress', '上達 じょうたつ 推移 年ごと ベスト更新 初めて 100切り 90切り 履歴 りれき'],
  ['年間のまとめ', '振り返る', '#/review', '1年 今年 ことし 前年 まとめ 年間 ねんかん 共有'],
  ['実績', '振り返る', '#/achievements', '実績 じっせき バッジ 初バーディ 100切り 達成'],
  ['AI分析（ChatGPT・Claude・Gemini に相談）', '振り返る', '#/ai', 'AI エーアイ チャットGPT ジェミニ プロンプト 質問 相談 そうだん 総合分析'],
  ['AIに練習メニューを相談', '振り返る › AI分析', '#/ai?purpose=practice', '練習 れんしゅう メニュー AI'],
  ['AIに目標達成プランを相談', '振り返る › AI分析', '#/ai?purpose=goal', '目標 もくひょう プラン AI'],
  ['AIにコース攻略を聞く', '振り返る › AI分析', '#/ai?purpose=course', 'コース 攻略 こうりゃく AI'],
  ['AIにクラブ・飛距離を相談', '振り返る › AI分析', '#/ai?purpose=clubs', 'クラブ 飛距離 番手 AI'],
  ['飛距離を記録', '記録', '#/distances', '飛距離 ひきょり キャリー 練習場 番手 記録'],
  ['アルバム・写真', '記録', '#/album', '写真 しゃしん フォト 思い出 スライドショー アルバム'],
  ['コースを登録（コースガイドの貼り付け）', '準備・道具 › コース', '#/courses', 'ゴルフ場 パー ヤード HDCP 貼り付け 登録 とうろく 追加 27ホール'],
  ['コースを友達に渡す・読み込む', '準備・道具 › コース', '#/courses', '共有 送る 受け取る ファイル 友達 ともだち'],
  ['攻略シート', '準備・道具 › コース › コースを開いて「攻略シート」', '#/courses', '攻略 こうりゃく メモ 印刷 PDF 目標打数 番手の目安'],
  ['クラブセッティング（14本）', '準備・道具 › クラブ', '#/clubs', 'クラブ 14本 バッグ ロフト シャフト メーカー セッティング'],
  ['目標スコア', '設定 › プロフィール・表示（ホームの目標カードからも）', '#/settings?go=s-profile', '目標 もくひょう 何切り 100切り 90切り'],
  ['次のラウンドの予定', 'ホーム', '#/', '予定 よてい 次 あと何日'],
  ['ホームを編集（カードの表示・並び順）', 'ホーム（いちばん下）', '#/?go=home-edit', 'ホーム カード 並び順 非表示 カスタマイズ 編集'],
  ['バックアップ・復元', '設定', '#/settings?go=backup', 'バックアップ 復元 ふくげん 機種変更 きしゅへんこう 引っ越し 保存 ZIP'],
  ['スコアを CSV で書き出す', '設定 › バックアップ', '#/settings?go=backup', 'CSV エクセル Excel スプレッドシート 書き出し エクスポート'],
  ['ほかのアプリから取り込む（IKScoreCard・Garmin）', '設定', '#/settings?go=s-import', '取り込み とりこみ インポート IKScoreCard Garmin ガーミン 乗り換え'],
  ['名前・距離の単位・テーマ（ダークモード）', '設定 › プロフィール・表示', '#/settings?go=s-profile', '名前 なまえ ヤード メートル ダーク ライト テーマ 黒'],
  ['テーマカラー・背景のデザイン', '設定 › プロフィール・表示', '#/settings?go=s-profile', '色 いろ カラー 背景 はいけい デザイン'],
  ['文字の大きさ', '設定 › プロフィール・表示', '#/settings?go=s-profile', '文字 もじ 大きく 小さく フォント サイズ 見やすく'],
  ['サンプルデータ', '設定', '#/settings?go=sample-card', 'サンプル 試す ためす'],
  ['すべてのデータを削除', '設定', '#/settings?go=s-danger', '削除 さくじょ 消す けす リセット 初期化'],
  ['ホーム画面に追加する', '使い方 › はじめに', '#/help?go=help-start', 'ホーム画面 インストール アイコン オフライン 電波'],
  ['新しくなったこと', '使い方', '#/help?go=help-news', 'バージョン 更新 新機能 アップデート'],
  ['よくある質問', '使い方', '#/help?go=help-faq', '料金 無料 質問 しつもん 困った こまった'],
  ...(STANDALONE ? [] : [['スマホで見る（iPhone / Android）', '設定', '#/settings?go=mobile', 'スマホ iPhone Android QR 同じWi-Fi']]),
];

// 全角・半角、カタカナ・ひらがな、大文字・小文字の違いを無視して比べる
export const normalize = (s) => String(s).normalize('NFKC').toLowerCase()
  .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, ' ').trim();

export function searchFeatures(query, list = FEATURES) {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (!terms.length) return list;
  return list.map((f) => {
    const title = normalize(f[0]);
    const all = `${title} ${normalize(f[1])} ${normalize(f[3])}`;
    if (!terms.every((t) => all.includes(t))) return null;
    return { f, score: terms.filter((t) => title.includes(t)).length * 2 + (title.startsWith(terms[0]) ? 1 : 0) };
  }).filter(Boolean).sort((a, b) => b.score - a.score).map((x) => x.f);
}

const area = (where) => where.split(' › ')[0].replace(/（.*$/, '');

export async function render(root) {
  const initial = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  mount(root, html`
    <div class="page-header"><div><h1>機能をさがす</h1><div class="sub">言葉を入れると、その機能の場所へ移動できます</div></div></div>
    <div class="search-field">${icon('search')}<input type="search" id="feature-q" value="${initial}" placeholder="例：バックアップ、試算、取り込み" aria-label="さがす言葉" aria-describedby="feature-count" enterkeyhint="search" autocomplete="off"></div>
    <p class="small muted" id="feature-count" aria-live="polite"></p>
    <div id="feature-list"></div>
  `);
  const input = $('#feature-q', root);
  const out = $('#feature-list', root);
  const count = $('#feature-count', root);
  const item = (f) => html`<a class="feat" href="${f[2]}"><strong>${f[0]}</strong><span class="small muted">${f[1]}</span></a>`;
  const draw = () => {
    const q = input.value;
    const hits = searchFeatures(q);
    if (!q.trim()) {
      // 何も入れていないときは、場所ごとにすべての機能を並べる
      const groups = new Map();
      for (const f of FEATURES) { const k = area(f[1]); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
      count.textContent = `すべての機能（${FEATURES.length}）`;
      mount(out, html`${[...groups].map(([k, list]) => html`<section class="feat-group"><h2>${k}</h2><div class="feat-list">${list.map(item)}</div></section>`)}`);
      return;
    }
    count.textContent = hits.length ? `${hits.length} 件見つかりました` : '';
    mount(out, hits.length ? html`<div class="feat-list">${hits.map(item)}</div>`
      : html`<div class="card empty"><h2>見つかりませんでした</h2><p>別の言葉（例：「写真」「天気」「練習」）でさがすか、<a href="#/help">使い方</a>を見てください。</p></div>`);
  };
  input.addEventListener('input', () => {
    draw();
    // 戻ってきたときに同じ言葉の結果を出す
    history.replaceState(null, '', input.value.trim() ? `#/search?q=${encodeURIComponent(input.value.trim())}` : '#/search');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const first = $('.feat', out);
    if (first && input.value.trim()) { e.preventDefault(); location.hash = first.getAttribute('href'); }
  });
  draw();
  setTimeout(() => input.focus({ preventScroll: true }), 0);
}
