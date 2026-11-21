// コース情報だけを友達に渡すためのファイル（JSON）の作成と読み取り。
// スコア・メモ・写真は含めない（コース名・所在地・レート/スロープ・9 ホールのまとまり・各ホールのパー/ヤード/HDCP だけ）
import { normalizeCourse, parseNines } from './model.js';

export const COURSE_FILE_KIND = 'golf-enjoy-courses';

export function buildCourseFile(courses, now = new Date()) {
  return {
    kind: COURSE_FILE_KIND,
    version: 1,
    exported_at: now.toISOString(),
    courses: courses.map((c) => ({
      name: c.name,
      location: c.location ?? null,
      rating: c.rating ?? null,
      slope: c.slope ?? null,
      nines: parseNines(c.nines),
      holes: (c.holes || []).map((h) => ({ hole_no: h.hole_no, par: h.par, yards: h.yards ?? null, hdcp: h.hdcp ?? null })),
    })),
  };
}

// 読み取ったコースごとに { course（登録に使う形）, error（読めない理由）} を返す
export function parseCourseFile(text) {
  let data;
  try {
    data = JSON.parse(String(text).trim().replace(/^﻿/, ''));
  } catch {
    throw new Error('コースのファイルとして読み取れませんでした');
  }
  if (!data || data.kind !== COURSE_FILE_KIND || !Array.isArray(data.courses)) {
    throw new Error('このアプリで作ったコースのファイルではありません');
  }
  if (!data.courses.length) throw new Error('ファイルにコースが入っていません');
  if (data.courses.length > 500) throw new Error('コースが多すぎます（500 件まで）');
  return data.courses.map((raw) => {
    const src = raw && typeof raw === 'object' ? raw : {};
    try {
      const { row, holes } = normalizeCourse({ ...src, memo: null });
      return { course: { name: row.name, location: row.location, rating: row.rating, slope: row.slope, nines: JSON.parse(row.nines), holes }, error: null };
    } catch (e) {
      return { course: { name: typeof src.name === 'string' ? src.name.slice(0, 200) : '（名前なし）', holes: [] }, error: e.message };
    }
  });
}
