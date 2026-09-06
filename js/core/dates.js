/* ============================================================
   日付・週の計算
   週は「月曜はじまり・月〜土」で数える。曜日番号は 1=月 … 6=土。
   ============================================================ */

export const DAYS = [
  { n: 1, label: '月' },
  { n: 2, label: '火' },
  { n: 3, label: '水' },
  { n: 4, label: '木' },
  { n: 5, label: '金' },
  { n: 6, label: '土' }
];

export function dayLabel(n) {
  const d = DAYS.find(x => x.n === n);
  return d ? d.label : String(n);
}

/* その日をふくむ週の月曜日を返す（日曜日は前の週あつかい） */
export function mondayOf(date) {
  const x = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const w = x.getDay();                  /* 0=日 */
  x.setDate(x.getDate() - ((w + 6) % 7));
  return x;
}

export function addDays(date, n) {
  const x = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/* 2026-08-03 の形の文字列にする（ファイル名・週キーに使う） */
export function dateKey(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

/* '2026-08-03' から Date を作る（時差でずれないように数値で組む） */
export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    return null;
  }
  return d;
}

/* 週キー＝その週の月曜日の日付キー */
export function weekKeyOf(date) {
  return dateKey(mondayOf(date));
}

/*
  画面をひらいたときに出す週。
  日曜日は mondayOf だと「もう終わった先週」になり、週ラベルしか出ないので
  気づかずに先週の表を配信してしまう。日曜にひらくのは翌週の準備なので、次の週を出す。
*/
export function currentWeekKey(now = new Date()) {
  return weekKeyOf(now.getDay() === 0 ? addDays(now, 1) : now);
}

/* 週キーから曜日番号の日付を出す */
export function dateOfDay(weekStartKey, dayNumber) {
  const start = parseDateKey(weekStartKey);
  if (!start) return null;
  return addDays(start, dayNumber - 1);
}

export function shiftWeekKey(weekStartKey, weeks) {
  const start = parseDateKey(weekStartKey);
  if (!start) return weekStartKey;
  return dateKey(addDays(start, weeks * 7));
}

/* 8/3 の形 */
export function mdLabel(date) {
  return (date.getMonth() + 1) + '/' + date.getDate();
}

/* 画面の週ラベル用：8/3 〜 8/8 */
export function weekShortLabel(weekStartKey) {
  const start = parseDateKey(weekStartKey);
  if (!start) return '';
  return mdLabel(start) + ' 〜 ' + mdLabel(addDays(start, 5));
}

/* 紙面の週ラベル用：2026年8月3日（月）〜 8日（土） */
export function weekLongLabel(weekStartKey) {
  const start = parseDateKey(weekStartKey);
  if (!start) return '';
  const end = addDays(start, 5);
  const head = `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日（月）`;
  const tail = start.getMonth() === end.getMonth()
    ? `${end.getDate()}日（土）`
    : `${end.getMonth() + 1}月${end.getDate()}日（土）`;
  return `${head}〜 ${tail}`;
}

/* 2026年8月3日（月） */
export function fullDateLabel(weekStartKey, dayNumber) {
  const d = dateOfDay(weekStartKey, dayNumber);
  if (!d) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${dayLabel(dayNumber)}）`;
}

/* 「2026年7月29日 14:05 作成」のような作成時刻 */
export function stampLabel(now = new Date()) {
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ` +
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} 作成`;
}

export function clockLabel(now = new Date()) {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
