/* ============================================================
   データのかたち（スキーマ）と、読みこんだ JSON の整えなおし

   ここは「JSON を信用しすぎない」ための層。
   手で直したファイル・古い形のファイルを読んでも画面が壊れないように、
   足りない項目をおぎない、余分な項目はそのまま残す。
   くわしい説明は docs/データ構造.md を見てください。
   ============================================================ */

import { DAYS } from './dates.js';

export const SCHEMA_VERSION = 1;

export const DIRS = [
  { key: 'out', label: '迎え' },
  { key: 'ret', label: '送り' }
];

/* メモの種類。印刷では hand=ピンク帯、ext=青帯、plain=・つきの文字 */
export const NOTE_KINDS = [
  { key: 'hand', label: '引き継ぎ事項', color: 'pink' },
  { key: 'ext', label: '外部の予定', color: 'blue' },
  { key: 'plain', label: 'ふつうのメモ', color: 'none' }
];

/* 運転手バッジの色。印刷 CSS の .drv.c-xxx と合わせる */
export const DRIVER_COLORS = ['green', 'blue', 'orange', 'pink', 'purple', 'teal'];

const DEFAULT_DAYS = DAYS.map(d => d.n);

/* ---------- 小さな道具 ---------- */
function str(v, fallback = '') {
  return typeof v === 'string' ? v : (v == null ? fallback : String(v));
}
function bool(v) {
  return v === true;
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function dayList(v, fallback = DEFAULT_DAYS) {
  if (!Array.isArray(v)) return fallback.slice();
  const out = v.map(Number).filter(n => n >= 1 && n <= 6);
  return out.length ? [...new Set(out)].sort((a, b) => a - b) : [];
}

/* ============================================================
   事業所（facility）
   ============================================================ */
export function normalizeFacility(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  return {
    ...f,
    id: str(f.id, 'default'),
    name: str(f.name, '事業所'),
    shortName: str(f.shortName || f.name, '事業所'),
    company: str(f.company, '株式会社障がい者ライフサポート'),
    address: str(f.address),
    printTitle: str(f.printTitle, '送迎表'),
    days: dayList(f.days),
    startTimes: {
      out: str(f.startTimes && f.startTimes.out, '08:20'),
      ret: str(f.startTimes && f.startTimes.ret, '15:30')
    },
    stepMinutes: num(f.stepMinutes, 7) || 7,
    areas: (f.areas && typeof f.areas === 'object') ? { ...f.areas } : {}
  };
}

export function normalizeFacilities(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.facilities) ? raw.facilities : []);
  return list.map(normalizeFacility);
}

/* ============================================================
   利用者（user）
   ============================================================ */
export function normalizeUser(raw) {
  const u = raw && typeof raw === 'object' ? raw : {};
  return {
    ...u,
    id: str(u.id),
    name: str(u.name),
    area: str(u.area),
    /* wc は プロトタイプ時代の項目名。読めるようにしておく */
    wheelchair: bool(u.wheelchair !== undefined ? u.wheelchair : u.wc),
    days: dayList(u.days, []),
    noReturn: bool(u.noReturn),
    note: str(u.note),
    active: u.active === undefined ? true : bool(u.active)
  };
}

/* includeInactive: true にすると「使わない」にした方も返す（マスタ編集画面で使う） */
export function normalizeUsers(raw, { includeInactive = false } = {}) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.users) ? raw.users : []);
  return list.map(normalizeUser).filter(u => u.id && (includeInactive || u.active));
}

/* ============================================================
   車両（van）
   ============================================================ */
export function normalizeVan(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  return {
    ...v,
    id: str(v.id),
    name: str(v.name),
    seats: Math.max(0, num(v.seats, 0)),
    wheelchairSeats: Math.max(0, num(v.wheelchairSeats !== undefined ? v.wheelchairSeats : v.wc, 0)),
    driver: str(v.driver),
    days: dayList(v.days),
    note: str(v.note),
    active: v.active === undefined ? true : bool(v.active)
  };
}

export function normalizeVans(raw, { includeInactive = false } = {}) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.vans) ? raw.vans : []);
  return list.map(normalizeVan).filter(v => v.id && (includeInactive || v.active));
}

/* 乗れる人数＝座席＋車椅子スペース */
export function capacity(van) {
  return Math.max(0, num(van && van.seats, 0)) + Math.max(0, num(van && van.wheelchairSeats, 0));
}

/* その曜日に走る車だけ */
export function vansForDay(vans, day) {
  return (vans || []).filter(v => v.days.includes(Number(day)));
}

/* ============================================================
   同乗NGペア
   ============================================================ */
export function normalizeNgPairs(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.pairs) ? raw.pairs : []);
  return list.map(p => {
    /* ['u01','u03'] という配列の形（プロトタイプ）も受けつける */
    if (Array.isArray(p)) return { a: str(p[0]), b: str(p[1]), reason: '' };
    const o = p && typeof p === 'object' ? p : {};
    return { ...o, a: str(o.a), b: str(o.b), reason: str(o.reason) };
  }).filter(p => p.a && p.b && p.a !== p.b);
}

/* ============================================================
   運転手（印刷の色つきバッジに使う）
   ============================================================ */
export function normalizeDrivers(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.drivers) ? raw.drivers : []);
  return list.map((d, i) => {
    const o = d && typeof d === 'object' ? d : { name: str(d) };
    const name = str(o.name);
    return {
      ...o,
      id: str(o.id, 'd' + (i + 1)),
      name,
      initial: str(o.initial, name.slice(0, 1)),
      color: DRIVER_COLORS.includes(o.color) ? o.color : DRIVER_COLORS[i % DRIVER_COLORS.length]
    };
  }).filter(d => d.name);
}

/* ============================================================
   週次プラン（plan）
   ============================================================ */
export function normalizeRow(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  /* uid は プロトタイプ時代の項目名 */
  const userId = str(r.userId !== undefined ? r.userId : r.uid) || null;
  return { userId, time: str(r.time), changed: bool(r.changed) };
}

export function blankRow() {
  return { userId: null, time: '', changed: false };
}

export function blankRows(van) {
  return Array.from({ length: capacity(van) }, blankRow);
}

export function emptyVanState(van) {
  return { driver: null, memo: '', rows: blankRows(van) };
}

export function emptyDirState(vans, day) {
  const state = { vans: {} };
  vansForDay(vans, day).forEach(v => { state.vans[v.id] = emptyVanState(v); });
  return state;
}

export function emptyDayState(vans, day) {
  return { out: emptyDirState(vans, day), ret: emptyDirState(vans, day), notes: [] };
}

export function createEmptyPlan({ facilityId, weekStart, vans, days } = {}) {
  const useDays = dayList(days);
  const plan = {
    schemaVersion: SCHEMA_VERSION,
    facilityId: str(facilityId),
    weekStart: str(weekStart),
    updatedAt: '',
    updatedBy: '',
    days: {}
  };
  useDays.forEach(n => { plan.days[String(n)] = emptyDayState(vans || [], n); });
  return plan;
}

export function normalizeNote(raw) {
  if (typeof raw === 'string') return { kind: 'plain', text: raw };
  const o = raw && typeof raw === 'object' ? raw : {};
  /* 印刷プロトタイプの {chip:'…', kind:'hand'} 形式も受けつける */
  const text = str(o.text !== undefined ? o.text : o.chip);
  const kind = NOTE_KINDS.some(k => k.key === o.kind) ? o.kind : 'plain';
  return { ...o, kind, text };
}

export function normalizeNotes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeNote).filter(n => n.text);
}

/*
  読みこんだプランを整える。
  - 曜日・迎え送り・車両のわく箱が足りなければ作る
  - 車の定員が変わっていたら行数を合わせる（あふれた人は「まだ乗っていない人」にもどる）
  - 同じ人が2か所に入っていたら最初の1か所だけ残す
  もとの JSON にある知らない項目は消さずに残す。
*/
export function normalizePlan(raw, { facilityId, weekStart, vans, days } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const useDays = dayList(days);
  const vanList = vans || [];
  const plan = {
    ...source,
    schemaVersion: num(source.schemaVersion, SCHEMA_VERSION),
    facilityId: str(source.facilityId, str(facilityId)),
    weekStart: str(source.weekStart, str(weekStart)),
    updatedAt: str(source.updatedAt),
    updatedBy: str(source.updatedBy),
    days: {}
  };
  const srcDays = source.days && typeof source.days === 'object' ? source.days : {};

  useDays.forEach(n => {
    const srcDay = srcDays[String(n)] && typeof srcDays[String(n)] === 'object' ? srcDays[String(n)] : {};
    const day = { ...srcDay };
    DIRS.forEach(d => { day[d.key] = normalizeDirState(srcDay[d.key], vanList, n); });
    day.notes = normalizeNotes(srcDay.notes);
    plan.days[String(n)] = day;
  });

  return plan;
}

function normalizeDirState(raw, vans, day) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const srcVans = source.vans && typeof source.vans === 'object' ? source.vans : {};
  const state = { ...source, vans: {} };
  const seen = new Set();

  vansForDay(vans, day).forEach(van => {
    const srcVan = srcVans[van.id] && typeof srcVans[van.id] === 'object' ? srcVans[van.id] : {};
    const srcRows = Array.isArray(srcVan.rows) ? srcVan.rows.map(normalizeRow) : [];
    /* 乗っている人だけを前へ詰めて、定員の数だけ並べなおす */
    const filled = srcRows.filter(r => r.userId && !seen.has(r.userId));
    filled.forEach(r => seen.add(r.userId));
    const rows = Array.from({ length: capacity(van) }, (_, i) => filled[i] ? filled[i] : blankRow());
    state.vans[van.id] = {
      ...srcVan,
      /* null = 車両マスタの運転手のまま。'' = その日は「未定」と紙に出す */
      driver: typeof srcVan.driver === 'string' ? srcVan.driver : null,
      memo: str(srcVan.memo),
      rows
    };
  });

  /* マスタから消えた／その曜日は走らない車のデータは、消さずに残しておく */
  Object.keys(srcVans).forEach(id => {
    if (!state.vans[id]) state.vans[id] = srcVans[id];
  });

  return state;
}

/* プランのファイル名（週はじまりの月曜日） */
export function planFileName(weekStartKey) {
  return `${weekStartKey}.json`;
}
