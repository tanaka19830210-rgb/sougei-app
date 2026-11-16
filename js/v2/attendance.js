/* ============================================================
   利用予定（「利用記録兼シフト」から読みとったもの）と、送迎表を照らしあわせる

   利用予定のファイルは、毎週月曜の朝にデータ用リポジトリへ自動で入る
   （tools/import_attendance.py）。1週＝1ファイルで、曜日ごとに
   「その日に利用する人」と、送迎のメモ（利松迎え・送り無 など）が入っている。

   ここでは 2つのことをする：
   - 下書きを利用予定に合わせる（予定の無い人をはずし、予定のある人を足す）
   - 表と利用予定の食いちがいを見つけて知らせる
   画面はさわらない（test/ からそのまま呼べる）。
   ============================================================ */

import { DAY_NUMBERS, DAY_NAMES, LEGS, LEG_NAMES, personKey, normText, clone, vanByName } from './model.js';

/* その日に利用する人の一覧：名字 → { out, ret, outPlace, retPlace, memo } */
export function expectedOn(attendance, day) {
  const map = new Map();
  const list = (attendance && attendance.days && attendance.days[day]) || [];
  list.forEach(e => {
    if (!e || e.absent) return;
    map.set(personKey(e.family || String(e.name || '').split(/\s+/)[0]), e);
  });
  return map;
}

export function hasAttendance(attendance) {
  return !!attendance && DAY_NUMBERS.some(d => expectedOn(attendance, d).size > 0);
}

function ridersOn(week, day, leg) {
  const map = new Map();
  week.vans.forEach(v => week.days[day].trips[v.id][leg].rows.forEach(r => map.set(personKey(r.name), { van: v, row: r })));
  return map;
}

/*
  連絡らんに「○○様送迎なし」「○○様送りなし」と書いてあれば、その便は乗らなくてよい。
  （利用はするが送迎はしない方がいる。毎週書いてある連絡は下書きに引きつがれる）
*/
export function excusedByNote(notes, name, leg) {
  const word = leg === 'out' ? '迎え?' : '送り?';
  const re = new RegExp(`${name}(様|さん)?(は)?(送迎|${word})(なし|無し?)`);
  return (notes || []).some(n => re.test(normText(n)));
}

const placeOf = (entry, leg) => (leg === 'out' ? entry.outPlace : entry.retPlace) || null;
const wants = (entry, leg) => (leg === 'out' ? entry.out !== false : entry.ret !== false);

/* これまでの表から、その人がいちばん最近どの車に乗っていたかをさがす。同じ曜日を先に見る */
function lastRide(history, name, day, leg, place) {
  const days = [day, ...DAY_NUMBERS.filter(d => d !== day)];
  let fallback = null;
  for (const d of days) {
    for (const w of history || []) {
      const hit = ridersOn(w, d, leg).get(name);
      if (!hit) continue;
      /* 乗る場所が指定されているときは、同じ場所から乗った回を優先する */
      if (!place || normText(hit.row.place) === normText(place)) return hit;
      fallback = fallback || hit;
    }
  }
  return fallback;
}

/*
  下書きを利用予定に合わせる。
  - 予定の無い人は表からはずす
  - 予定があるのに表にいない人は、これまで乗っていた車へ足す（flag: 'planned'）
  - 乗る場所のメモ（利松迎え など）があれば、その場所に直す
  - 「休み」や、読みとれなかったメモは連絡らんへ足す
  乗せる車が分からない人は unplaced に入れて返す（表には足さない）。
*/
export function applyAttendance(source, attendance, history) {
  const week = clone(source);
  const removed = [], added = [], unplaced = [], moved = [];
  if (!hasAttendance(attendance)) return { week, removed, added, unplaced, moved, used: false };

  DAY_NUMBERS.forEach(day => {
    const expected = expectedOn(attendance, day);
    const notes = week.days[day].notes;
    const addNote = text => { if (!notes.some(n => normText(n) === normText(text))) notes.push(text); };

    LEGS.forEach(leg => {
      /* はずす */
      week.vans.forEach(v => {
        const trip = week.days[day].trips[v.id][leg];
        trip.rows = trip.rows.filter(r => {
          const e = expected.get(personKey(r.name));
          if (e && wants(e, leg)) return true;
          removed.push({ day, leg, name: personKey(r.name), van: v.name });
          return false;
        });
      });
      /* 足す・場所を直す */
      const now = ridersOn(week, day, leg);
      expected.forEach((e, name) => {
        if (!wants(e, leg)) return;
        const place = placeOf(e, leg);
        const here = now.get(name);
        if (!here && excusedByNote(notes, name, leg)) return;
        if (here) {
          if (place && normText(here.row.place) !== normText(place)) {
            here.row.place = place;
            here.row.flag = 'planned';
            moved.push({ day, leg, name, place });
          }
          return;
        }
        const hit = lastRide(history, name, day, leg, place);
        const van = hit ? vanByName(week, hit.van.name) : null;
        if (!van) { unplaced.push({ day, leg, name }); return; }
        const row = { name, place: place || hit.row.place || '', time: hit.row.time || '', flag: 'planned' };
        const rows = week.days[day].trips[van.id][leg].rows;
        const at = row.time ? rows.findIndex(r => r.time && r.time > row.time) : -1;
        rows.splice(at >= 0 ? at : rows.length, 0, row);
        added.push({ day, leg, name, van: van.name });
      });
    });

    /* 連絡らん */
    ((attendance.days && attendance.days[day]) || []).forEach(e => {
      const name = personKey(e.family || '');
      if (!name) return;
      if (e.absent) { addNote(`${name}様休み`); return; }
      if (e.out === false && e.ret === false) addNote(`${name}様送迎なし`);
      else if (e.out === false) addNote(`${name}様迎えなし`);
      else if (e.ret === false) addNote(`${name}様送りなし`);
      (e.rest || []).forEach(text => addNote(`${name}様 ${text}`));
    });
  });
  return { week, removed, added, unplaced, moved, used: true };
}

/* 表と利用予定の食いちがい（止めはしない。知らせるだけ） */
export function checkAttendance(week, attendance) {
  const warnings = [];
  if (!hasAttendance(attendance)) return warnings;
  DAY_NUMBERS.forEach(day => {
    const expected = expectedOn(attendance, day);
    LEGS.forEach(leg => {
      const now = ridersOn(week, day, leg);
      const where = `${DAY_NAMES[day]}曜の${LEG_NAMES[leg]}`;
      expected.forEach((e, name) => {
        if (wants(e, leg) && !now.has(name) && !excusedByNote(week.days[day].notes, name, leg)) warnings.push({ day, leg, kind: 'missing', name, text: `${where}：${name}様は利用予定ですが、表にいません` });
      });
      now.forEach((hit, name) => {
        const e = expected.get(name);
        if (!e) warnings.push({ day, leg, vanId: hit.van.id, name, kind: 'extra', text: `${where}：${name}様は利用予定がありませんが、${hit.van.name}に乗っています` });
        else if (!wants(e, leg)) warnings.push({ day, leg, vanId: hit.van.id, name, kind: 'extra', text: `${where}：${name}様は「${LEG_NAMES[leg]}なし」の予定ですが、${hit.van.name}に乗っています` });
      });
    });
  });
  return warnings;
}

/* AI に見せる用の、文字だけの利用予定 */
export function attendanceToText(attendance) {
  if (!hasAttendance(attendance)) return '';
  return DAY_NUMBERS.map(day => {
    const people = [...expectedOn(attendance, day).entries()].map(([name, e]) => {
      const tags = [e.out === false ? '迎えなし' : '', e.ret === false ? '送りなし' : '', e.outPlace ? e.outPlace + '迎え' : '', e.retPlace ? e.retPlace + '送り' : ''].filter(Boolean);
      return name + (tags.length ? `(${tags.join('・')})` : '');
    });
    return `${DAY_NAMES[day]}曜 ${people.length}人: ${people.join('、')}`;
  }).join('\n');
}
