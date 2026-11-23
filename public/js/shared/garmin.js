// Garmin Connect の「データのエクスポート」に入っているゴルフのデータ（DI_CONNECT/DI-GOLF/Golf-*.json）を読み、
// このアプリのラウンドとコースの形に直す。
//  - Golf-SCORECARD.json … ラウンド（打数・パット・ペナルティ・フェアウェイ・ピンの位置・ティー・コースレート）
//  - Golf-COURSE.json    … コースの名前（courseSnapshotId → 「ゴルフ場名 ~ コース名」）
//  - Golf-SHOT.json      … ショット（1 打目の種類・クラブ・打った位置）
//  - Golf-CLUB.json / Golf-CLUB_TYPES.json … クラブ（ティーショットのクラブ名に使う）
// ホールごとのパーはファイルに無いので、1 打目の種類（パー3 は「アプローチ」）・ティーからピンまでの距離・
// ラウンドの合計パー（ハンデ後の打数 − スコア）から推定する。アカウント名などの個人情報は読まない。
import { MAX_NINES } from './model.js';

export const norm = (s) => String(s || '').replace(/[\s　]+/g, '').toLowerCase();
export const isGarminJsonName = (name) => /(^|[/\\])[^/\\]*golf-[^/\\]*\.json$/i.test(String(name || ''));
const TYPES = ['SCORECARD', 'COURSE', 'SHOT', 'CLUB', 'CLUB_TYPES'];

// files: [{ name, text }] → { SCORECARD: [...], COURSE: [...], ... }（種類はファイルの中の type で判断する）
export function readGarminFiles(files) {
  const out = Object.fromEntries(TYPES.map((t) => [t, []]));
  for (const f of files) {
    let j;
    try { j = JSON.parse(f.text); } catch { continue; }
    if (j && typeof j === 'object' && TYPES.includes(j.type) && Array.isArray(j.data)) out[j.type].push(...j.data);
  }
  return out;
}

// ---------- 英語のゴルフ場名・コース名 → 日本語 ----------
// Garmin のファイルの名前は英語。分かるものは日本語にして、取り込む画面の初めの名前にする（無いものは英語のまま）
const JA_COURSES = {
  'noshiro country club': '能代カントリークラブ',
  'rainbow hills country club': 'レインボーヒルズカントリークラブ',
  'minami akita country club': '南秋田カントリークラブ',
  'akita moritake onsen 36 golf course': '秋田森岳温泉36ゴルフ場',
  'chonan public course': '長南パブリックコース',
  'higashi tsukuba country club': '東筑波カントリークラブ',
  'ichihara keikyu country club': '市原京急カントリークラブ',
  'abc golf isumi course': 'ABCいすみゴルフコース',
  'kannami golf club': '函南ゴルフ倶楽部',
  'fujihakone country club': '富士箱根カントリークラブ',
  'shizukuishi golf course': '雫石ゴルフ場',
  'kasumidai country club': '霞台カントリークラブ',
  'manna country club': '真名カントリークラブ',
  'koumi re-ex country club': '小海リエックス・カントリークラブ',
  'okadaira golf links': 'おかだいらゴルフリンクス',
  'shiroi golf rinkan course': '白井ゴルフ林間ショートコース',
  'narashino country club kuko course': '習志野カントリークラブ 空港コース',
  'accordia golf narashino country club': 'アコーディア・ゴルフ習志野カントリークラブ',
  'great sendai country club': 'グレート仙台カントリークラブ',
  'jgm kasama golf club': 'JGM笠間ゴルフクラブ',
  'jgm seve ballesteros golf club': 'JGMセベ・バレステロスゴルフクラブ',
  'jgm yasato ishioka golf club': 'JGMやさと石岡ゴルフクラブ',
  'shimodate golf club': '下館ゴルフ倶楽部',
  'sakura golf club': '桜ゴルフ倶楽部',
  'edosaki country club': '江戸崎カントリー倶楽部',
  'itako country club': '潮来カントリー倶楽部',
  'katori country club': '香取カントリークラブ',
  'chiba shinnihon golf club': '千葉新日本ゴルフ倶楽部',
  'chiba international country club': '千葉国際カントリークラブ',
  'chiba sakuranosato golf club': '千葉さくらの里ゴルフクラブ',
  'moonlake golf club tsurumai course': 'ムーンレイクゴルフクラブ 鶴舞コース',
  'golden cross country club': 'ゴールデンクロスカントリークラブ',
  'aoshima golf club': '青島ゴルフ倶楽部',
  'murasaki country club ayame course': '紫カントリークラブ あやめコース',
  'tsukuba tokyu golf club': '筑波東急ゴルフクラブ',
  'oak hills country club': 'オークヒルズカントリークラブ',
  'president country club karuizawa': 'プレジデントカントリー倶楽部軽井沢',
  'fuji ogm golf club dejima course': '富士OGMゴルフクラブ出島コース',
};
const keyOf = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const jaCourseName = (name) => JA_COURSES[keyOf(name)] || null;

// コース名（9 ホールのまとまり）：すべての語が分かるときだけ日本語にする（例: East Bent → 東ベント、Sakura West → 桜西）
const JA_WORDS = {
  'moritake onsen': '森岳', east: '東', west: '西', south: '南', north: '北', center: '中', central: '中', middle: '中',
  bent: 'ベント', korai: '高麗', left: '左', right: '右', out: 'OUT', in: 'IN', sakura: '桜', uchibo: '内房', sotobo: '外房',
  akita: '秋田', hakone: '箱根', fuji: '富士', king: 'キング', queen: 'クイーン', karamatsu: 'からまつ',
};
export function jaNineName(name) {
  const words = keyOf(name).split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length;) {
    const two = words.slice(i, i + 2).join(' ');
    if (words[i + 1] && JA_WORDS[two]) { out.push(JA_WORDS[two]); i += 2; continue; }
    if (!JA_WORDS[words[i]]) return name;
    out.push(JA_WORDS[words[i]]);
    i++;
  }
  // 日本語どうしはつなげ、OUT・IN の前は空ける（例: 内房右 OUT）
  return out.reduce((s, w) => (s && (/^[A-Z]+$/.test(w) || /[A-Z]$/.test(s)) ? `${s} ${w}` : s + w), '') || name;
}

const SEMI = 180 / 2 ** 31; // Garmin の位置（semicircle）→ 度
function yardsBetween(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(Number.isFinite)) return null;
  const t = Math.PI / 180;
  const la1 = a.lat * SEMI * t, la2 = b.lat * SEMI * t, dl = (b.lon - a.lon) * SEMI * t;
  const x = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dl / 2) ** 2;
  return (2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(x)))) / 0.9144;
}
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
const sum = (a) => a.reduce((s, x) => s + x, 0);
// ティーからピンまでの直線距離がこれ以上ならパー5 とみなす（実際に打った位置からなので表示の距離より短め。合計パーで調整する）
export const PAR5_YARDS = 415;
const FAIRWAY = { HIT: 'hit', LEFT: 'left', RIGHT: 'right' };

// Garmin のクラブの種類の名前 → 短い名前（このアプリの書き方: 1W・5W・4U・7I・PW）
export function clubShortName(typeName) {
  const s = String(typeName || '').trim();
  let m;
  if (/^driver$/i.test(s)) return '1W';
  if (/^mini driver$/i.test(s)) return 'ミニドライバー';
  if ((m = s.match(/^(\d+) wood$/i))) return `${m[1]}W`;
  if ((m = s.match(/^(\d+) hybrid$/i))) return `${m[1]}U`;
  if ((m = s.match(/^(\d+) iron$/i))) return `${m[1]}I`;
  return { 'pitching wedge': 'PW', 'gap wedge': 'GW', 'approach wedge': 'AW', 'sand wedge': 'SW', 'lob wedge': 'LW', putter: 'PT' }[s.toLowerCase()] || null;
}
const clubCategory = (short) => (short === '1W' ? 'driver' : /^\d+W$/.test(short) ? 'wood' : /^\d+U$/.test(short) ? 'hybrid'
  : /^\d+I$/.test(short) ? 'iron' : /^(PW|GW|AW|SW|LW)$/.test(short) ? 'wedge' : null);

// 短い名前 → このアプリに登録してあるクラブの名前（同じ名前・ドライバーが 1 本だけ・番手の数字が合う 1 本）。
// アイアン・ウェッジは記録画面の選択肢に合わせて「アイアン」にまとめる
export function appClubName(short, appClubs) {
  if (!short) return null;
  const bag = (appClubs || []).filter((c) => c && c.in_bag !== 0 && c.name);
  const same = bag.find((c) => norm(c.name) === norm(short));
  if (same) return same.name;
  const cat = clubCategory(short);
  if (cat === 'iron' || cat === 'wedge') return 'アイアン';
  if (short === 'ミニドライバー') return bag.find((c) => /ミニ|mini/i.test(c.name))?.name || short;
  const inCat = cat ? bag.filter((c) => c.category === cat) : [];
  if (cat === 'driver' && inCat.length === 1) return inCat[0].name;
  const n = short.match(/^\d+/)?.[0];
  if (n && inCat.length) {
    const hit = inCat.filter((c) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(c.name));
    if (hit.length === 1) return hit[0].name;
  }
  return short;
}

// ラウンドのパーを合計パーに合わせる（長いパー4 → パー5、短いパー5 → パー4 の順に直す）
function fitPars(holes, total, slotOf) {
  const pars = holes.map((h) => slotOf(h).par);
  if (total == null) return pars;
  const len = (i) => slotOf(holes[i]).len ?? PAR5_YARDS - 1; // 距離が分からないホールは境目あたりとみなす
  const idx = holes.map((_, i) => i);
  let diff = total - sum(pars);
  for (let guard = 0; diff > 0 && guard < 40; guard++) {
    const up = idx.filter((i) => pars[i] === 4).sort((a, b) => len(b) - len(a))[0]
      ?? idx.filter((i) => pars[i] === 3 && !slotOf(holes[i]).sure3)[0];
    if (up == null) break;
    pars[up]++; diff--;
  }
  for (let guard = 0; diff < 0 && guard < 40; guard++) {
    const down = idx.filter((i) => pars[i] === 5).sort((a, b) => len(a) - len(b))[0]
      ?? idx.filter((i) => pars[i] === 4 && !slotOf(holes[i]).sure45).sort((a, b) => len(a) - len(b))[0];
    if (down == null) break;
    pars[down]--; diff++;
  }
  return pars;
}

const newSlot = () => ({ p3: 0, p45: 0, fw: 0, lens: [], votes: [] });
function slotPar(s) {
  const len = median(s.lens);
  if (s.p3 > s.p45) return 3;
  if (s.p45 > 0 || s.fw > 0) return len != null && len >= PAR5_YARDS ? 5 : 4;
  if (len != null) return len < 250 ? 3 : len >= PAR5_YARDS ? 5 : 4;
  return 4;
}

// src: readGarminFiles の結果 →
// { rounds: [{ ids, date, start, facility, nines: [nineKey], holes: [{ hole_no, par, strokes, putts, penalties, fairway, club }],
//              total, holesPlayed, parTotal, tee, rating, slope, memo }],
//   facilities: [{ key, name, nines: [{ key, name, pars }], dates }], from, to, count }
export function parseGarmin(src) {
  const courseName = new Map();
  for (const o of src.COURSE || []) {
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (typeof v === 'string') courseName.set(String(k), v.trim());
  }
  const clubs = new Map((src.CLUB || []).filter((c) => c && c.id != null).map((c) => [c.id, c]));
  const types = new Map((src.CLUB_TYPES || []).filter((t) => t && t.value != null).map((t) => [t.value, t.name]));
  const firstShot = new Map(); // `${scorecardId}:${hole}` → いちばん最初のショット
  for (const s of src.SHOT || []) {
    if (!s || s.scorecardId == null || !Number.isInteger(s.holeNumber)) continue;
    const k = `${s.scorecardId}:${s.holeNumber}`;
    const cur = firstShot.get(k);
    if (!cur || (s.shotOrder ?? 99) < (cur.shotOrder ?? 99)) firstShot.set(k, s);
  }
  const holesOf = (c) => (Array.isArray(c.holes) ? c.holes : [])
    .filter((h) => h && Number.isInteger(h.number) && h.number >= 1 && h.number <= 18 && int(h.strokes, 1, 20) != null);
  const cards = (src.SCORECARD || []).filter((c) => c && typeof c === 'object' && !c.inProgress && holesOf(c).length)
    .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')));
  // 18 ホールのコースの番号（前半・後半の番号が別に無く、10 番以降があるラウンド）
  const eighteen = new Set(cards.filter((c) => !c.backNineGlobalCourseId && holesOf(c).some((h) => h.number > 9)).map((c) => c.courseGlobalId));

  const nines = new Map(); // nineKey → { key, label, kind, slots }
  const nineOf = (key, label, kind) => {
    if (!nines.has(key)) nines.set(key, { key, label: label || '', kind, slots: Array.from({ length: 9 }, newSlot) });
    const n = nines.get(key);
    if (!n.label && label) n.label = label;
    return n;
  };
  const raw = [];
  for (const c of cards) {
    const full = courseName.get(String(c.courseSnapshotId)) || '';
    const cut = full.indexOf('~');
    const base = (cut >= 0 ? full.slice(0, cut) : full).trim();
    const sub = cut >= 0 ? full.slice(cut + 1).trim() : '';
    const id = c.courseGlobalId;
    let segs;
    if (c.backNineGlobalCourseId) {
      const [a, b] = sub.split('/').map((s) => s.trim());
      segs = [nineOf(`n:${id}`, a, 'n'), nineOf(`n:${c.backNineGlobalCourseId}`, b, 'n')];
    } else if (eighteen.has(id)) {
      segs = [nineOf(`c:${id}:1`, sub, 'out'), nineOf(`c:${id}:2`, sub, 'in')];
    } else {
      segs = [nineOf(`n:${id}`, sub, 'n')];
    }
    const hs = holesOf(c);
    const used = segs.filter((s, i) => hs.some((h) => (segs.length > 1 ? (h.number <= 9 ? 0 : 1) : 0) === i));
    const holes = [];
    for (const h of hs) {
      const seg = segs.length > 1 ? segs[h.number <= 9 ? 0 : 1] : segs[0];
      const pos = (h.number - 1) % 9;
      const slot = seg.slots[pos];
      const f = firstShot.get(`${c.id}:${h.number}`);
      const fromTee = f && f.shotOrder === 1;
      if (fromTee && f.shotType === 'TEE') slot.p45++;
      if (fromTee && f.shotType === 'APPROACH' && f.startLoc?.lie === 'TeeBox') slot.p3++;
      if (FAIRWAY[h.fairwayShotOutcome]) slot.fw++;
      const len = fromTee && f.startLoc?.lie === 'TeeBox' ? yardsBetween(f.startLoc, { lat: h.pinPositionLat, lon: h.pinPositionLon }) : null;
      if (len != null && len > 30 && len < 800) slot.lens.push(len);
      const club = fromTee && f.clubId != null ? clubShortName(types.get(clubs.get(f.clubId)?.clubTypeId)) : null;
      const strokes = int(h.strokes, 1, 20);
      const putts = int(h.putts, 0, 10);
      holes.push({
        hole_no: used.indexOf(seg) * 9 + pos + 1, seg: seg.key, pos, strokes,
        putts: putts != null && putts < strokes ? putts : null,
        penalties: int(h.penalties, 0, 10), fairway: FAIRWAY[h.fairwayShotOutcome] || null, club,
      });
    }
    holes.sort((a, b) => a.hole_no - b.hole_no);
    const net = Number.isFinite(c.handicappedStrokes) ? c.handicappedStrokes : c.strokes;
    let parTotal = Number.isFinite(c.score) && Number.isFinite(net) ? net - c.score : null;
    if (parTotal != null && (parTotal < 3 * holes.length || parTotal > 6 * holes.length)) parTotal = null;
    const date = String(c.formattedStartTime || c.startTime || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const eighteenHoles = used.length === 2;
    raw.push({
      ids: [c.id], date, start: String(c.formattedStartTime || c.startTime || ''),
      base: jaCourseName(base) || base || `Garmin のコース ${id}`, garminName: base || null, baseKey: base ? `n:${norm(base)}` : `g:${id}`,
      nines: used.map((s) => s.key), holes, parTotal,
      tee: typeof c.teeBox === 'string' && c.teeBox.trim() ? c.teeBox.trim().slice(0, 50) : null,
      rating: eighteenHoles && Number.isFinite(c.teeBoxRating) && c.teeBoxRating >= 50 && c.teeBoxRating <= 90 ? c.teeBoxRating : null,
      slope: eighteenHoles && int(c.teeBoxSlope, 55, 155) != null ? c.teeBoxSlope : null,
      rating9: !eighteenHoles && Number.isFinite(c.teeBoxRating) ? c.teeBoxRating : null,
      slope9: !eighteenHoles && Number.isFinite(c.teeBoxSlope) ? c.teeBoxSlope : null,
      steps: int(c.stepsTaken, 1, 200000) ?? 0, walked: Number.isFinite(c.distanceWalked) && c.distanceWalked > 0 ? c.distanceWalked : 0,
    });
  }

  // ---- パーの推定：まとまり（9 ホール）ごとに記録を集め、ラウンドの合計パーで調整。2 回くり返して落ち着かせる ----
  const slotInfo = (h) => {
    const s = nines.get(h.seg).slots[h.pos];
    return s.info ??= { par: slotPar(s), len: median(s.lens), sure3: s.p3 > s.p45, sure45: s.p45 > s.p3 || (s.p3 === 0 && s.fw > 0) };
  };
  for (let pass = 0; pass < 2; pass++) {
    for (const n of nines.values()) for (const s of n.slots) s.votes = [];
    for (const r of raw) {
      const pars = fitPars(r.holes, r.parTotal, slotInfo);
      r.holes.forEach((h, i) => { h.par = pars[i]; nines.get(h.seg).slots[h.pos].votes.push(pars[i]); });
    }
    for (const n of nines.values()) {
      for (const s of n.slots) {
        if (!s.votes.length) continue;
        const cnt = new Map();
        for (const v of s.votes) cnt.set(v, (cnt.get(v) || 0) + 1);
        const top = [...cnt].sort((a, b) => b[1] - a[1] || (a[0] === s.info.par ? -1 : b[0] === s.info.par ? 1 : 0))[0][0];
        s.info.par = top;
      }
    }
  }
  for (const r of raw) {
    for (const h of r.holes) {
      if (h.par === 3) { h.fairway = null; h.club = null; }
    }
  }

  // ---- 同じ日・同じゴルフ場で 9 ホールずつ 2 回に分かれたラウンドを 18 ホールにまとめる ----
  const rounds = [];
  const byDay = new Map();
  for (const r of raw) {
    const k = `${r.date}|${r.baseKey}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(r);
  }
  for (const list of byDay.values()) {
    const rest = [...list];
    while (rest.length) {
      const a = rest.shift();
      const j = a.nines.length === 1 ? rest.findIndex((b) => b.nines.length === 1 && b.nines[0] !== a.nines[0]) : -1;
      if (j < 0) { rounds.push(a); continue; }
      const b = rest.splice(j, 1)[0];
      const rating = a.rating9 != null && b.rating9 != null ? Math.round((a.rating9 + b.rating9) * 10) / 10 : null;
      const slope = a.slope9 != null && b.slope9 != null ? Math.round((a.slope9 + b.slope9) / 2) : null;
      rounds.push({
        ...a, ids: [...a.ids, ...b.ids], nines: [a.nines[0], b.nines[0]],
        holes: [...a.holes, ...b.holes.map((h) => ({ ...h, hole_no: h.hole_no + 9 }))],
        parTotal: a.parTotal != null && b.parTotal != null ? a.parTotal + b.parTotal : null,
        tee: a.tee || b.tee,
        rating: rating != null && rating >= 50 && rating <= 90 ? rating : null,
        slope: slope != null && slope >= 55 && slope <= 155 ? slope : null,
        steps: a.steps + b.steps, walked: a.walked + b.walked,
      });
    }
  }
  rounds.sort((a, b) => a.start.localeCompare(b.start));

  // ---- ゴルフ場（まとまりが多すぎるときは、回った組み合わせごとに分ける） ----
  const facMap = new Map();
  const addFac = (key, name, r) => {
    if (!facMap.has(key)) facMap.set(key, { key, name, garminName: r.garminName, nineKeys: [], rounds: [] });
    const f = facMap.get(key);
    for (const nk of r.nines) if (!f.nineKeys.includes(nk)) f.nineKeys.push(nk);
    f.rounds.push(r);
  };
  for (const r of rounds) addFac(r.baseKey, r.base, r);
  for (const f of [...facMap.values()]) {
    if (f.nineKeys.length <= MAX_NINES) continue;
    facMap.delete(f.key);
    for (const r of f.rounds) addFac(`${f.key}|${r.nines.join('+')}`, `${f.name}（${r.nines.map((k) => jaNineName(nines.get(k).label) || '?').join('・')}）`, r);
  }
  const facilities = [...facMap.values()].map((f) => {
    const kinds = f.nineKeys.map((k) => nines.get(k));
    const list = kinds.map((n, i) => {
      let name = n.label;
      if (n.kind === 'out' || n.kind === 'in') {
        const half = n.kind === 'out' ? 'OUT' : 'IN';
        name = kinds.length === 2 || !n.label ? half : `${jaNineName(n.label)} ${half}`;
      } else name = jaNineName(name);
      return { key: n.key, name: (name || `${i + 1}つ目`).slice(0, 30), pars: n.slots.map((s) => s.info?.par ?? 4) };
    });
    for (const r of f.rounds) r.facility = f.key;
    return { key: f.key, name: f.name.slice(0, 200), garminName: f.garminName && f.garminName !== f.name ? f.garminName : null, nines: list, dates: f.rounds.map((r) => r.date) };
  });

  for (const r of rounds) {
    r.total = sum(r.holes.map((h) => h.strokes));
    r.holesPlayed = r.holes.length;
    r.memo = r.steps > 0 && r.walked >= 500 ? `歩数 ${r.steps.toLocaleString('ja-JP')} 歩・歩いた距離 ${(r.walked / 1000).toFixed(1)} km（Garmin）` : null;
    r.holes = r.holes.map(({ seg, pos, ...h }) => h);
    delete r.base; delete r.garminName; delete r.baseKey; delete r.rating9; delete r.slope9; delete r.steps; delete r.walked;
  }
  return { rounds, facilities, from: rounds[0]?.date ?? null, to: rounds[rounds.length - 1]?.date ?? null, count: cards.length };
}

// ---------- 取り込みの計画 ----------
const played = (holes) => (holes || []).filter((h) => Number.isFinite(h.strokes) && h.strokes > 0);
export const totalOf = (holes) => sum(played(holes).map((h) => h.strokes));

// まとめて取り込んだラウンド（同じ分に 5 件以上作られたもの）。それ以外は手入力とみなす
export function bulkImportedIds(appRounds, min = 5) {
  const minute = (r) => String(r.created_at || '').slice(0, 16);
  const n = new Map();
  for (const r of appRounds) if (r.created_at) n.set(minute(r), (n.get(minute(r)) || 0) + 1);
  return new Set(appRounds.filter((r) => r.created_at && n.get(minute(r)) >= min).map((r) => r.id));
}

// 同じ日のアプリのラウンドと組み合わせる。組み合わせが無いものは追加
export function planGarmin(parsed, appRounds, appCourses) {
  const bulk = bulkImportedIds(appRounds);
  const byDate = new Map();
  for (const a of appRounds) {
    if (!byDate.has(a.date)) byDate.set(a.date, []);
    byDate.get(a.date).push(a);
  }
  const used = new Set();
  const add = [];
  const pairs = [];
  for (const g of parsed.rounds) {
    const cands = (byDate.get(g.date) || []).filter((a) => !used.has(a.id) && (!played(a.holes).length || Math.abs(played(a.holes).length - g.holesPlayed) <= 2))
      .sort((x, y) => Math.abs(totalOf(x.holes) - g.total) - Math.abs(totalOf(y.holes) - g.total));
    if (!cands.length) { add.push(g); continue; }
    used.add(cands[0].id);
    pairs.push({ g, a: cands[0], origin: bulk.has(cands[0].id) ? 'import' : 'manual' });
  }
  const facilities = parsed.facilities.map((f) => {
    const votes = new Map();
    for (const p of pairs) if (p.g.facility === f.key && p.a.course_id) votes.set(p.a.course_id, (votes.get(p.a.course_id) || 0) + 1);
    let target = null;
    let auto = null;
    if (votes.size) { target = [...votes].sort((x, y) => y[1] - x[1])[0][0]; auto = 'pair'; }
    else {
      const c = appCourses.find((x) => norm(x.name) === norm(f.name));
      if (c) { target = c.id; auto = 'name'; }
    }
    if (target != null && !appCourses.some((c) => c.id === target)) { target = null; auto = null; }
    return { ...f, target, auto };
  });
  return { add, pairs, facilities };
}

// Garmin のまとまり → 登録済みコースのまとまり（1 から）。パーの並びが 7 ホール以上合うものを選び、
// 合うものが無ければコースに新しいまとまりとして加える（added）
export function mapNines(facility, course) {
  const names = Array.isArray(course.nines) && course.nines.length ? course.nines : ['OUT', 'IN'];
  const parAt = (no) => (course.holes || []).find((h) => h.hole_no === no)?.par ?? null;
  const coursePars = names.map((_, i) => Array.from({ length: 9 }, (__, j) => parAt(i * 9 + j + 1)));
  const hasPars = coursePars.some((ps) => ps.some((p) => p != null));
  const map = new Map();
  const added = [];
  const usedIdx = new Set();
  facility.nines.forEach((n, k) => {
    if (!hasPars) {
      if (k < names.length) { map.set(n.key, k + 1); return; }
    } else {
      let best = null;
      coursePars.forEach((ps, i) => {
        const score = ps.reduce((s, p, j) => s + (p != null && p === n.pars[j] ? 1 : 0), 0);
        if (!best || score > best.score || (score === best.score && usedIdx.has(best.i) && !usedIdx.has(i))) best = { i, score };
      });
      if (best && best.score >= 7) { map.set(n.key, best.i + 1); usedIdx.add(best.i); return; }
    }
    if (names.length + added.length < MAX_NINES) { added.push(n); map.set(n.key, names.length + added.length); return; }
    map.set(n.key, 1);
  });
  return { map, added };
}

// コースのホール番号（まとまりをまたいだ通し番号）
const courseNo = (front, back, no) => ((no <= 9 ? front : back) - 1) * 9 + ((no - 1) % 9) + 1;

// Garmin のラウンド → POST /api/rounds の中身
export function roundBody(g, course, map, appClubs) {
  const nineCount = Math.max(1, course.nines?.length || 2);
  const front = Math.min(map.get(g.nines[0]) ?? 1, nineCount);
  const back = g.nines[1] ? Math.min(map.get(g.nines[1]) ?? Math.min(2, nineCount), nineCount) : null;
  const ch = (no) => (course.holes || []).find((h) => h.hole_no === courseNo(front, back ?? Math.min(2, nineCount), no));
  // コースに登録してあるパーの合計がこのラウンドの合計パーと同じなら、それを使う（推定より確か）
  const cpars = g.holes.map((h) => ch(h.hole_no)?.par ?? null);
  const useCourse = g.parTotal != null && cpars.every((p) => p != null) && sum(cpars) === g.parTotal;
  return {
    date: g.date, course_id: course.id, front_nine: front, ...(back != null ? { back_nine: back } : {}),
    tee: g.tee, rating: g.rating, slope: g.slope, memo: g.memo,
    holes: g.holes.map((h, i) => {
      const par = useCourse ? cpars[i] : h.par;
      return {
        hole_no: h.hole_no, par, yards: ch(h.hole_no)?.yards ?? null, strokes: h.strokes, putts: h.putts, penalties: h.penalties,
        fairway: par === 3 ? null : h.fairway, tee_club: par === 3 ? null : appClubName(h.club, appClubs),
      };
    }),
  };
}

// 重なったラウンドを Garmin のデータで置き換える中身。天気・同伴者・メモ・写真・ホールのメモ・バンカーは残す。
// アウトとインが入れ替わって記録されていたら（インスタートなど）、ホールのメモと同伴者のスコアも入れ替える
export function mergeBody(g, a, course, map, appClubs) {
  const body = roundBody(g, course, map, appClubs);
  const old = new Map((a.holes || []).map((h) => [h.hole_no, h]));
  const rot = (no) => ((no + 8) % 18) + 1;
  let same = 0;
  let turned = 0;
  for (const h of body.holes) {
    if (old.get(h.hole_no)?.strokes === h.strokes) same++;
    if (old.get(rot(h.hole_no))?.strokes === h.strokes) turned++;
  }
  const swapped = body.holes.length === 18 && old.size >= 18 && turned > same && turned >= 12;
  const from = (no) => old.get(swapped ? rot(no) : no);
  body.holes = body.holes.map((h) => {
    const o = from(h.hole_no);
    const keep = o && o.strokes === h.strokes; // 打数が同じホールだけ、Garmin に無い値を元の記録で補う
    return {
      ...h,
      yards: h.yards ?? o?.yards ?? null,
      putts: h.putts ?? (keep && o.putts != null && o.putts < h.strokes ? o.putts : null),
      penalties: h.penalties ?? (keep ? o.penalties ?? null : null),
      fairway: h.par === 3 ? null : h.fairway ?? (keep ? o.fairway ?? null : null),
      tee_club: h.par === 3 ? null : h.tee_club ?? o?.tee_club ?? null,
      bunker: o?.bunker ?? null, note: o?.note ?? null,
    };
  });
  const party = (Array.isArray(a.party) ? a.party : []).map((p) => ({
    name: p.name,
    strokes: swapped ? Array.from({ length: 18 }, (_, i) => p.strokes?.[(i + 9) % 18] ?? null) : p.strokes,
  }));
  return {
    ...body,
    date: a.date, weather: a.weather ?? null, companions: a.companions ?? null, memo: a.memo ?? null, party,
    tee: body.tee ?? a.tee ?? null, rating: body.rating ?? a.rating ?? null, slope: body.slope ?? a.slope ?? null,
    swapped,
  };
}

// 置き換えで何か変わるか（同じなら書き込まない）
export function changes(body, a) {
  const key = (h) => [h.hole_no, h.par, h.strokes, h.putts ?? '', h.penalties ?? '', h.fairway ?? '', h.tee_club ?? '', h.yards ?? ''].join(',');
  const x = body.holes.map(key).join('|');
  const y = played(a.holes).sort((p, q) => p.hole_no - q.hole_no).map(key).join('|');
  return x !== y || body.course_id !== a.course_id || (body.front_nine ?? 1) !== (a.front_nine ?? 1)
    || (body.back_nine ?? a.back_nine ?? 2) !== (a.back_nine ?? 2) || (body.tee ?? null) !== (a.tee ?? null)
    || (body.rating ?? null) !== (a.rating ?? null) || (body.slope ?? null) !== (a.slope ?? null);
}
