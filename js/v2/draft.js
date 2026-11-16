/* ============================================================
   自動の下書き（ルール）

   これまでの週の表だけを材料に、新しい週の下書きを作る。
   過去の Excel を調べると「同じ人が同じ曜日にいつも同じ車」とは限らず、
   毎週「先週の表を写して、ちがう所だけ直す」やり方だった。それをそのまま手順にした。

   1. いちばん新しい週の表を、そのまま写す（車・運転手・順番・時刻）
   2. 先週はお休みだった「いつもの人」を、前に乗っていた車へ戻す（青いしるし）
   3. 先週だけ乗っていた人（いつもは乗らない）は、残したうえで黄色いしるしを付ける
   4. 毎週書いてある連絡（「○○様送迎なし」など）だけ引きつぐ
   その週だけの事情は、このあと声や文字で AI に伝えて直す。
   ============================================================ */

import { createEmptyWeek, DAY_NUMBERS, LEGS, personKey, normText, clone, vanByName, isFull } from './model.js';

const LOOK_BACK = 5;      /* いつもの人かどうかを、直近なん週で見るか */
const REGULAR_MIN = 2;    /* 先週を除く直近の週のうち、なん回乗っていたら「いつもの人」か */

function ridersOfDay(week, day, leg) {
  const map = new Map();
  week.vans.forEach(v => {
    const trip = week.days[day].trips[v.id][leg];
    trip.rows.forEach((row, index) => map.set(personKey(row.name), { vanName: v.name, row, index }));
  });
  return map;
}

function dayHasRiders(week, day) {
  return week.vans.some(v => LEGS.some(leg => week.days[day].trips[v.id][leg].rows.length));
}

/*
  history … これまでの週（新しい順）。空なら、空の表を返す。
*/
export function buildDraft({ facilityId, weekStart, history }) {
  const past = (history || []).slice(0, LOOK_BACK + 1);
  if (!past.length) return { week: createEmptyWeek({ facilityId, weekStart }), summary: { copiedFrom: null, restored: [], onlyLast: [] } };

  const base = past[0];
  const week = createEmptyWeek({ facilityId, weekStart, vans: base.vans });
  const restored = [], onlyLast = [];

  DAY_NUMBERS.forEach(day => {
    /* 先週その曜日が休み（祝日など）なら、その曜日に走っていた一番新しい週を写す */
    const src = past.find(w => dayHasRiders(w, day)) || base;
    const older = past.filter(w => w !== src && dayHasRiders(w, day)).slice(0, LOOK_BACK);

    LEGS.forEach(leg => {
      src.vans.forEach(sv => {
        const van = vanByName(week, sv.name);
        if (!van) return;
        const from = src.days[day].trips[sv.id][leg];
        week.days[day].trips[van.id][leg] = { driver: from.driver, rows: clone(from.rows).map(r => { delete r.flag; return r; }) };
      });

      const now = ridersOfDay(week, day, leg);
      const seenBefore = new Map();          /* 人 → 乗っていた週の数と、いちばん新しい乗りかた */
      older.forEach(w => ridersOfDay(w, day, leg).forEach((hit, key) => {
        const e = seenBefore.get(key) || { count: 0, latest: hit };
        e.count++;
        seenBefore.set(key, e);
      }));

      /* 2. いつもの人が抜けていたら戻す */
      seenBefore.forEach((e, key) => {
        if (now.has(key) || e.count < Math.min(REGULAR_MIN, older.length)) return;
        if (older.length && e.count / older.length < 0.5) return;
        const van = vanByName(week, e.latest.vanName);
        if (!van || isFull(week, van.id, day, leg)) return;      /* 満席の車へは戻さない */
        const rows = week.days[day].trips[van.id][leg].rows;
        const row = { ...clone(e.latest.row), flag: 'restored' };
        const at = row.time ? rows.findIndex(r => r.time && r.time > row.time) : -1;
        rows.splice(at >= 0 ? at : rows.length, 0, row);
        restored.push({ day, leg, name: key, van: van.name });
      });

      /* 3. 先週だけの人にしるし */
      if (older.length >= 2) {
        now.forEach((hit, key) => {
          if (!seenBefore.has(key)) {
            const van = vanByName(week, hit.vanName);
            const row = van && week.days[day].trips[van.id][leg].rows.find(r => personKey(r.name) === key);
            if (row) { row.flag = 'onlyLast'; onlyLast.push({ day, leg, name: key, van: hit.vanName }); }
          }
        });
      }
    });

    /* 4. 毎週書いてある連絡だけ引きつぐ */
    const counts = new Map();
    past.slice(0, 4).forEach(w => new Set(w.days[day].notes.map(normText)).forEach(n => counts.set(n, (counts.get(n) || 0) + 1)));
    const need = Math.min(3, past.slice(0, 4).length);
    src.days[day].notes.forEach(n => {
      if (need >= 2 && counts.get(normText(n)) >= need && !week.days[day].notes.includes(n)) week.days[day].notes.push(n);
    });
  });

  return { week, summary: { copiedFrom: base.weekStart, restored, onlyLast } };
}

/* 下書き（または先週の表）と、実際の表が、どれだけ同じかを数える。たしかめ用 */
export function compareWeeks(guess, actual) {
  let same = 0, moved = 0, missing = 0, extra = 0;
  DAY_NUMBERS.forEach(day => LEGS.forEach(leg => {
    const g = ridersOfDay(guess, day, leg), a = ridersOfDay(actual, day, leg);
    a.forEach((hit, key) => {
      if (!g.has(key)) missing++;
      else if (normText(g.get(key).vanName) === normText(hit.vanName)) same++;
      else moved++;
    });
    g.forEach((hit, key) => { if (!a.has(key)) extra++; });
  }));
  return { same, moved, missing, extra, total: same + moved + missing };
}
