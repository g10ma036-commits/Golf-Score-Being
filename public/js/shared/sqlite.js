// SQLite のデータベースファイルを読む（読み取り専用・必要最小限）。他のスコアアプリのバックアップを取り込むために使う。
// 対応：テーブルの B-tree（内部ページ・葉ページ）、オーバーフローページ、UTF-8 / UTF-16 の文字列、
//       INTEGER PRIMARY KEY（rowid）、ALTER TABLE ADD COLUMN で後から足した列（古い行は null）
// 非対応：WITHOUT ROWID のテーブル、WAL ファイルに残った未反映の変更

const MAGIC = 'SQLite format 3\u0000';

export function isSqlite(bytes) {
  if (!bytes || bytes.length < 100) return false;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

// 可変長整数（最大 9 バイト）。[値, 次の位置]
function varint(u8, p) {
  let v = 0;
  for (let i = 0; i < 8; i++) {
    const b = u8[p + i];
    if (b === undefined) throw broken();
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) return [v, p + i + 1];
  }
  return [v * 256 + u8[p + 8], p + 9];
}
const broken = () => new Error('SQLite のファイルが壊れているか、対応していない形式です');

// CREATE TABLE 文から列名と、rowid の別名（INTEGER PRIMARY KEY）の列を取り出す
export function tableColumns(sql) {
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
  const parts = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (const ch of body) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '[') { quote = ']'; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const unquote = (s) => s.replace(/^["`[']|["`\]']$/g, '');
  const cols = [];
  let tablePk = null;
  for (const raw of parts.map((s) => s.trim()).filter(Boolean)) {
    const pk = raw.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i);
    if (pk) { const names = pk[1].split(',').map((s) => unquote(s.trim().split(/\s+/)[0])); if (names.length === 1) tablePk = names[0]; continue; }
    if (/^(CONSTRAINT|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(raw)) continue;
    const m = raw.match(/^("[^"]*"|`[^`]*`|\[[^\]]*\]|'[^']*'|\S+)\s*([\s\S]*)$/);
    const rest = m[2] || '';
    cols.push({ name: unquote(m[1]), type: rest, ipk: /^INTEGER\b/i.test(rest) && /PRIMARY\s+KEY/i.test(rest) && !/\bDESC\b/i.test(rest) });
  }
  if (tablePk) { const c = cols.find((x) => x.name.toLowerCase() === tablePk.toLowerCase()); if (c && /^INTEGER\b/i.test(c.type)) c.ipk = true; }
  return cols.map(({ name, ipk }) => ({ name, ipk }));
}

export function openSqlite(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isSqlite(u8)) throw new Error('SQLite のファイルではありません');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let pageSize = dv.getUint16(16);
  if (pageSize === 1) pageSize = 65536;
  if (pageSize < 512 || (pageSize & (pageSize - 1))) throw broken();
  const usable = pageSize - u8[20];
  const enc = dv.getUint32(56);
  const dec = new TextDecoder(enc === 2 ? 'utf-16le' : enc === 3 ? 'utf-16be' : 'utf-8');
  const pageCount = Math.floor(u8.length / pageSize);
  const pageStart = (n) => {
    if (!Number.isInteger(n) || n < 1 || n > pageCount) throw broken();
    return (n - 1) * pageSize;
  };
  const maxLocal = usable - 35;
  const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;

  // セルの中身（長いものはオーバーフローページから続きを集める）
  const payload = (p, size) => {
    if (size <= maxLocal) return u8.subarray(p, p + size);
    const k = minLocal + ((size - minLocal) % (usable - 4));
    const local = k <= maxLocal ? k : minLocal;
    const out = new Uint8Array(size);
    out.set(u8.subarray(p, p + local), 0);
    let filled = local;
    let next = dv.getUint32(p + local);
    let guard = 0;
    while (filled < size) {
      if (!next || ++guard > pageCount) throw broken();
      const o = pageStart(next);
      next = dv.getUint32(o);
      const n = Math.min(usable - 4, size - filled);
      out.set(u8.subarray(o + 4, o + 4 + n), filled);
      filled += n;
    }
    return out;
  };

  // レコード（列の値の並び）
  const record = (buf) => {
    const bv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const [headerSize, h] = varint(buf, 0);
    const types = [];
    for (let p = h; p < headerSize;) { const [t, q] = varint(buf, p); types.push(t); p = q; }
    let d = headerSize;
    const take = (n) => { const at = d; d += n; if (d > buf.length) throw broken(); return at; };
    return types.map((t) => {
      switch (t) {
        case 0: return null;
        case 1: return bv.getInt8(take(1));
        case 2: return bv.getInt16(take(2));
        case 3: { const at = take(3); return (bv.getInt8(at) << 16) | bv.getUint16(at + 1); }
        case 4: return bv.getInt32(take(4));
        case 5: { const at = take(6); return bv.getInt16(at) * 2 ** 32 + bv.getUint32(at + 2); }
        case 6: return Number(bv.getBigInt64(take(8)));
        case 7: return bv.getFloat64(take(8));
        case 8: return 0;
        case 9: return 1;
        default: {
          if (t < 12) return null;
          const n = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
          const s = buf.subarray(take(n), d);
          return t % 2 === 0 ? s.slice() : dec.decode(s);
        }
      }
    });
  };

  // テーブルの B-tree を rowid の順にたどる
  const scan = (root, cb) => {
    const visit = (n, depth) => {
      if (depth > 40) throw broken();
      const o = pageStart(n);
      const hdr = n === 1 ? o + 100 : o;
      const type = u8[hdr];
      const count = dv.getUint16(hdr + 3);
      if (type === 0x0d) {
        for (let i = 0; i < count; i++) {
          const cp = o + dv.getUint16(hdr + 8 + i * 2);
          const [size, p1] = varint(u8, cp);
          const [rowid, p2] = varint(u8, p1);
          cb(rowid, record(payload(p2, size)));
        }
      } else if (type === 0x05) {
        for (let i = 0; i < count; i++) visit(dv.getUint32(o + dv.getUint16(hdr + 12 + i * 2)), depth + 1);
        visit(dv.getUint32(hdr + 8), depth + 1);
      } else {
        throw broken();
      }
    };
    visit(root, 0);
  };

  const schema = [];
  scan(1, (_, [type, name, tblName, rootpage, sql]) => schema.push({ type, name, tblName, rootpage, sql }));
  const tables = schema.filter((s) => s.type === 'table' && s.rootpage > 0 && typeof s.sql === 'string');
  const find = (name) => tables.find((t) => t.name === name) || tables.find((t) => t.name.toLowerCase() === String(name).toLowerCase());

  return {
    tables: () => tables.map((t) => t.name),
    has: (name) => Boolean(find(name)),
    columns: (name) => { const t = find(name); return t ? tableColumns(t.sql).map((c) => c.name) : []; },
    // 全部の行（{ 列名: 値 }）。テーブルが無ければ空
    rows(name) {
      const t = find(name);
      if (!t) return [];
      if (/WITHOUT\s+ROWID/i.test(t.sql)) throw new Error(`対応していないテーブルの形式です（${t.name}）`);
      const cols = tableColumns(t.sql);
      const out = [];
      scan(t.rootpage, (rowid, values) => {
        const row = {};
        cols.forEach((c, i) => { row[c.name] = c.ipk ? rowid : (values[i] ?? null); });
        out.push(row);
      });
      return out;
    },
  };
}
