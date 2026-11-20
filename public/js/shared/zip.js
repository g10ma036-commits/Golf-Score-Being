// 最小限の ZIP 書き出し・読み込み（外部ライブラリなし。ブラウザと Node.js の両方で動く）
// 書き出しは無圧縮（写真は元々圧縮済みのため）。読み込みは無圧縮と deflate に対応

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0) {
  let c = (crc ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const enc = new TextEncoder();
const isBlob = (x) => typeof Blob !== 'undefined' && x instanceof Blob;
const MAX32 = 0xFFFFFFFF;

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// entries: [{ name, data: Uint8Array | Blob | string }]
// 戻り値は ZIP を構成するパーツの配列（ブラウザでは new Blob(parts)、Node.js では Buffer.concat(parts) で 1 つにする）
export async function zipParts(entries, now = new Date()) {
  const { time, date } = dosTime(now);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    let data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    let crc;
    if (isBlob(data)) {
      crc = 0;
      const CHUNK = 4 * 1024 * 1024;
      for (let p = 0; p < data.size; p += CHUNK) crc = crc32(new Uint8Array(await data.slice(p, p + CHUNK).arrayBuffer()), crc);
    } else {
      if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
      crc = crc32(data);
    }
    const size = isBlob(data) ? data.size : data.length;
    const name = enc.encode(e.name);
    if (size >= MAX32 || offset >= MAX32) throw new Error('バックアップが大きすぎます（4GB まで）');
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // ファイル名は UTF-8
    lv.setUint16(8, 0, true); // 無圧縮
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);

    parts.push(local, data);
    offset += local.length + size;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  if (entries.length > 0xFFFF || offset + cdSize >= MAX32) throw new Error('バックアップが大きすぎます（4GB まで）');
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return [...parts, ...central, end];
}

// 読み込み元：Blob（ブラウザの File など）か Uint8Array（Node.js の Buffer など）
function source(x) {
  if (isBlob(x)) {
    return {
      size: x.size,
      read: async (o, n) => new Uint8Array(await x.slice(o, o + n).arrayBuffer()),
      blob: (o, n, type) => x.slice(o, o + n, type),
    };
  }
  const u8 = x instanceof Uint8Array ? x : new Uint8Array(x);
  return {
    size: u8.length,
    read: async (o, n) => u8.subarray(o, o + n),
    blob: (o, n, type) => new Blob([u8.subarray(o, o + n)], { type }),
  };
}

export async function isZip(x) {
  const s = source(x);
  if (s.size < 4) return false;
  const h = await s.read(0, 4);
  return h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('圧縮された ZIP には対応していません');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ZIP の中身の一覧。各要素の bytes() / blob(type) で中身を取り出す
export async function readZip(x) {
  const s = source(x);
  const tailLen = Math.min(s.size, 22 + 0xFFFF);
  const tail = await s.read(s.size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP ファイルとして読み込めませんでした');
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const count = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOffset = tv.getUint32(eocd + 16, true);
  if (cdOffset + cdSize > s.size) throw new Error('ZIP ファイルが壊れています');
  const cd = await s.read(cdOffset, cdSize);
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const dec = new TextDecoder();
  const list = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP ファイルが壊れています');
    const method = cv.getUint16(p + 10, true);
    const compSize = cv.getUint32(p + 20, true);
    const size = cv.getUint32(p + 24, true);
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    const localOffset = cv.getUint32(p + 42, true);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // フォルダ
    const dataStart = async () => {
      const h = await s.read(localOffset, 30);
      const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
      if (hv.getUint32(0, true) !== 0x04034b50) throw new Error('ZIP ファイルが壊れています');
      const start = localOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
      if (start + compSize > s.size) throw new Error('ZIP ファイルが壊れています');
      return start;
    };
    if (method !== 0 && method !== 8) throw new Error(`対応していない圧縮形式です（${name}）`);
    list.push({
      name, size, method,
      async bytes() {
        const raw = await s.read(await dataStart(), compSize);
        return method === 8 ? inflateRaw(raw) : raw;
      },
      async blob(type = '') {
        if (method === 0) return s.blob(await dataStart(), compSize, type);
        return new Blob([await this.bytes()], { type });
      },
    });
  }
  return list;
}
