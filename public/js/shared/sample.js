// 動作確認用のサンプルデータ（架空のコース・クラブ）を生成する。
// insert(table, row) は行を保存して新しい ID を返す関数（PC版は SQLite、スマホ単独版はブラウザ内の保存先）

function rng(seed) {
  // mulberry32: 毎回同じサンプルになる決定的な乱数
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function generateSample(insert, now = new Date()) {
  const rand = rng(20261115);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const normal = (mean, sd) => {
    const u = 1 - rand();
    const v = rand();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // ---- コース ----
  const courses = [
    {
      name: 'サンプル高原カントリー倶楽部', location: '架空県 みどり市', rating: 70.8, slope: 128,
      pars: [4, 5, 4, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5],
      hdcp: [7, 3, 11, 15, 1, 9, 17, 5, 13, 8, 2, 16, 4, 12, 6, 18, 10, 14],
    },
    {
      name: 'サンプルリバーサイドGC', location: '架空県 かわべ町', rating: 69.4, slope: 121,
      pars: [4, 4, 3, 5, 4, 4, 5, 3, 4, 5, 4, 4, 3, 4, 4, 5, 3, 4],
      hdcp: [5, 9, 17, 1, 13, 7, 3, 15, 11, 2, 10, 6, 18, 14, 8, 4, 16, 12],
    },
  ];
  const yardsFor = (par) => (par === 3 ? 140 + Math.round(rand() * 50) : par === 4 ? 320 + Math.round(rand() * 100) : 470 + Math.round(rand() * 70));
  for (const c of courses) {
    c.id = insert('courses', { name: c.name, location: c.location, rating: c.rating, slope: c.slope, memo: 'サンプルデータ（架空のコース）' });
    c.yards = c.pars.map(yardsFor);
    c.pars.forEach((par, i) => insert('course_holes', { course_id: c.id, hole_no: i + 1, par, yards: c.yards[i], hdcp: c.hdcp[i] }));
  }

  // ---- ラウンド（約14か月で少しずつ上達していく想定） ----
  const N = 24;
  const start = new Date(now.getTime());
  start.setMonth(start.getMonth() - 14);
  const weathers = ['晴れ', '晴れ', '晴れ', '曇り', '曇り', '雨', '強風'];
  const tees = ['レギュラー', 'レギュラー', 'バック'];
  const friends = ['田中さん、佐藤さん', '会社コンペ', '鈴木さん', '家族', '山本さん、高橋さん、伊藤さん'];

  for (let i = 0; i < N; i++) {
    const progress = i / (N - 1); // 0 → 1
    const d = new Date(start.getTime() + progress * 410 * 86400000 + Math.round(rand() * 5) * 86400000);
    const course = rand() < 0.6 ? courses[0] : courses[1];
    const weather = pick(weathers);
    const roundId = insert('rounds', {
      date: localDate(d), course_id: course.id, course_name: course.name, tee: pick(tees), weather, companions: pick(friends),
      memo: i % 5 === 0 ? 'サンプルデータ' : null, rating: course.rating, slope: course.slope,
    });

    const fwP = 0.40 + 0.18 * progress;
    const girP = 0.10 + 0.22 * progress;
    const extraP = 0.62 - 0.32 * progress; // グリーンまでの余分な打数が出る確率
    const windy = weather === '強風' || weather === '雨';

    course.pars.forEach((par, h) => {
      let fairway = null;
      if (par >= 4) {
        const r = rand();
        fairway = r < fwP - (windy ? 0.1 : 0) ? 'hit' : r < fwP + (1 - fwP) * 0.45 ? 'left' : 'right';
      }
      const gir = rand() < girP - (fairway && fairway !== 'hit' ? 0.08 : 0);
      let putts;
      let strokes;
      let penalties = 0;
      let bunker = 0;
      if (gir) {
        const r = rand();
        putts = r < 0.1 ? 1 : r < 0.86 ? 2 : 3;
        strokes = par - 2 + putts;
      } else {
        let extra = 0;
        while (rand() < extraP && extra < 3) extra++;
        if (rand() < 0.13) bunker = 1;
        if (rand() < (fairway && fairway !== 'hit' ? 0.12 : 0.04) * (1 - 0.5 * progress)) { penalties = 1; extra += 1; }
        const r = rand();
        putts = r < 0.3 ? 1 : r < 0.88 ? 2 : 3;
        strokes = par - 1 + extra + bunker * (rand() < 0.4 ? 1 : 0) + putts;
      }
      insert('round_holes', { round_id: roundId, hole_no: h + 1, par, yards: course.yards[h], strokes, putts, fairway, penalties, bunker });
    });
  }

  // ---- クラブ（14本） ----
  const clubs = [
    ['driver', '1W', 10.5, 45.5, 'S', 228], ['wood', '3W', 15, 43, 'S', 208], ['wood', '5W', 18, 42.25, 'S', 195],
    ['hybrid', '4U', 22, 40, 'S', 182], ['iron', '5I', 24, 38.25, 'S', 170], ['iron', '6I', 27, 37.75, 'S', 160],
    ['iron', '7I', 31, 37.25, 'S', 150], ['iron', '8I', 35, 36.75, 'S', 140], ['iron', '9I', 40, 36.25, 'S', 129],
    ['iron', 'PW', 45, 35.75, 'S', 117], ['wedge', '50°', 50, 35.5, 'WEDGE', 104], ['wedge', '56°', 56, 35.25, 'WEDGE', 88],
    ['wedge', '58°', 58, 35, 'WEDGE', 74], ['putter', 'PT', 3, 34, null, null],
  ];
  const roll = { driver: 22, wood: 14, hybrid: 10, iron: 7, wedge: 3 };
  clubs.forEach(([category, name, loft, length, flex, target], i) => {
    const brand = category === 'putter' ? 'サンプルパター工房' : 'サンプルゴルフ';
    const model = category === 'putter' ? 'SP-01 マレット' : category === 'iron' ? 'SG-IRON 7' : `SG-${category.toUpperCase()}`;
    const shaft = category === 'putter' ? null : category === 'iron' || category === 'wedge' ? 'スチール 105g' : 'カーボン 60g';
    const cid = insert('clubs', { category, name, brand, model, loft, shaft, flex, length, target_carry: target, in_bag: 1, sort_order: i, memo: null });
    if (category === 'putter') return;
    for (let k = 0; k < 12; k++) {
      const dd = new Date(now.getTime() - Math.floor(rand() * 120) * 86400000);
      const sd = category === 'driver' ? 10 : category === 'wood' ? 8 : 5.5;
      const carry = Math.max(20, Math.round(normal(target - 3, sd)));
      const total = carry + Math.max(0, Math.round(normal(roll[category], roll[category] * 0.3)));
      const place = k % 4 === 0 ? 'course' : k % 3 === 0 ? 'simulator' : 'range';
      insert('distances', { club_id: cid, date: localDate(dd), carry, total, place, memo: null });
    }
  });
  // 予備（バッグに入っていない）クラブ
  insert('clubs', {
    category: 'hybrid', name: '3U', brand: 'サンプルゴルフ', model: 'SG-HYBRID', loft: 19, shaft: 'カーボン 70g', flex: 'S',
    length: 40.5, target_carry: 190, in_bag: 0, sort_order: 99, memo: '夏場の長いコース用',
  });
}
