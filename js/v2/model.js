/* ============================================================
   週の送迎表（v2）の形と、それをさわる計算

   考えかた：
   - 「表そのものがマスタ」。利用者・車・運転手の名簿は別に持たず、
     これまでの週の表から読みとる。登録の手間をなくすため。
   - 1週 = 1ファイル。 days[曜日].trips[車ID].out / .ret に
     運転手と、乗る順の行（お名前・乗る場所・時刻）が入る。
   - ここは画面をさわらない（test/ からそのまま呼べる）。
   ============================================================ */

export const SCHEMA_VERSION = 2;
export const DAY_NUMBERS = [1, 2, 3, 4, 5, 6];
export const DAY_NAMES = { 1: '月', 2: '火', 3: '水', 4: '木', 5: '金', 6: '土' };
export const LEGS = ['out', 'ret'];
export const LEG_NAMES = { out: '迎え', ret: '送り' };

export function emptyTrip() {
  return { out: { driver: '', rows: [] }, ret: { driver: '', rows: [] } };
}

export function createEmptyWeek({ facilityId, weekStart, vans = [] }) {
  const week = { schemaVersion: SCHEMA_VERSION, facilityId, weekStart, vans: vans.map(cleanVan), days: {}, log: [] };
  DAY_NUMBERS.forEach(d => {
    week.days[d] = { notes: [], trips: {} };
    week.vans.forEach(v => { week.days[d].trips[v.id] = emptyTrip(); });
  });
  return week;
}

/* 読んだファイルを、欠けがあっても動く形に整える */
export function normalizeWeek(raw, { facilityId, weekStart } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const vans = (Array.isArray(src.vans) ? src.vans : [])
    .filter(v => v && v.id && v.name)
    .map(cleanVan);
  const week = createEmptyWeek({ facilityId: src.facilityId || facilityId, weekStart: src.weekStart || weekStart, vans });
  DAY_NUMBERS.forEach(d => {
    const day = (src.days && src.days[d]) || {};
    week.days[d].notes = (Array.isArray(day.notes) ? day.notes : []).map(String).filter(Boolean);
    vans.forEach(v => {
      const trip = (day.trips && day.trips[v.id]) || {};
      LEGS.forEach(leg => {
        const t = trip[leg] || {};
        week.days[d].trips[v.id][leg] = {
          driver: String(t.driver || ''),
          rows: (Array.isArray(t.rows) ? t.rows : []).filter(r => r && r.name).map(cleanRow)
        };
      });
    });
  });
  week.log = Array.isArray(src.log) ? src.log : [];
  if (src.updatedAt) week.updatedAt = src.updatedAt;
  if (src.updatedBy) week.updatedBy = src.updatedBy;
  return week;
}

/* seats＝その車に乗れる利用者の最大人数（0 は「まだ決めていない」） */
function cleanVan(v) {
  const seats = Math.floor(Number(v.seats));
  return { id: String(v.id), name: String(v.name), seats: seats > 0 ? seats : 0 };
}

/* 車の最大人数。決めてあればその数、まだなら「これまでの表でいちばん多かった人数」を仮に使う */
export function seatsOf(van, roster) {
  if (van.seats > 0) return { seats: van.seats, fixed: true };
  const learned = roster && roster.capacity ? roster.capacity[normText(van.name)] || 0 : 0;
  return { seats: learned, fixed: false };
}

/*
  その便が満席か（最大人数を決めてある車だけ。決めていない車は止めない）。
  枠の数＝最大人数なので、満席の便には人を足せない。
*/
export function isFull(week, vanId, day, leg) {
  const van = week.vans.find(v => v.id === vanId);
  return !!van && van.seats > 0 && week.days[day].trips[vanId][leg].rows.length >= van.seats;
}

function cleanRow(r) {
  const row = { name: String(r.name).trim(), place: String(r.place || '').trim(), time: normTime(r.time) };
  if (r.flag) row.flag = r.flag;
  return row;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* ---------- 文字のゆれをならす ---------- */
export function normText(s) {
  return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, '').trim();
}

/* 「井上様」「井上さん」「井上」を同じ人として扱うための鍵 */
export function personKey(name) {
  return normText(name).replace(/(様|さん|くん|君|ちゃん)$/, '');
}

export function normTime(t) {
  const m = /^(\d{1,2})[:：](\d{2})/.exec(normText(t));
  return m ? String(Number(m[1])).padStart(2, '0') + ':' + m[2] : '';
}

export function shortTime(t) {
  return t ? t.replace(/^0/, '') : '';
}

export function rowLabel(row) {
  return row.name + '様' + (row.place ? '（' + row.place + '）' : '');
}

/* ---------- さがす ---------- */
export function vanByName(week, name) {
  const key = normText(name).replace(/[≪≫]/g, '');
  return week.vans.find(v => normText(v.name) === key) || week.vans.find(v => v.id === name) || null;
}

/* その日・その便で、この人が乗っている所をぜんぶ返す */
export function findRider(week, day, leg, name) {
  const key = personKey(name);
  const hits = [];
  week.vans.forEach(v => {
    const rows = week.days[day].trips[v.id][leg].rows;
    rows.forEach((row, index) => { if (personKey(row.name) === key) hits.push({ vanId: v.id, index, row }); });
  });
  return hits;
}

export function eachTrip(week, fn) {
  DAY_NUMBERS.forEach(day => week.vans.forEach(van => LEGS.forEach(leg => {
    fn({ day, van, leg, trip: week.days[day].trips[van.id][leg] });
  })));
}

/* その日の利用人数：全体（迎え・送り） Excel の「16（16・16）」と同じ数えかた */
export function dayCounts(week, day) {
  const out = new Set(), ret = new Set();
  week.vans.forEach(v => {
    week.days[day].trips[v.id].out.rows.forEach(r => out.add(personKey(r.name)));
    week.days[day].trips[v.id].ret.rows.forEach(r => ret.add(personKey(r.name)));
  });
  return { all: new Set([...out, ...ret]).size, out: out.size, ret: ret.size };
}

/* ---------- これまでの表から「名簿」を読みとる ---------- */
export function rosterFrom(weeks) {
  const people = new Map(), drivers = new Map(), capacity = new Map();
  const count = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const ranked = map => [...map.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  weeks.forEach(week => eachTrip(week, ({ van, leg, trip }) => {
    const vn = normText(van.name);
    capacity.set(vn, Math.max(capacity.get(vn) || 0, trip.rows.length));
    if (trip.driver) drivers.set(trip.driver, (drivers.get(trip.driver) || 0) + 1);
    trip.rows.forEach(row => {
      const key = personKey(row.name);
      if (!people.has(key)) people.set(key, { name: key, places: new Map(), out: new Map(), ret: new Map() });
      const p = people.get(key);
      count(p.places, row.place);
      count(p[leg], row.place);
    });
  }));
  return {
    people: [...people.values()]
      /* 「A→B」「○○様の車いす」のような書きこみは、人の名前ではないので名簿に入れない */
      .filter(p => !/[→⇒＞>\/様]/.test(p.name) && p.name.length <= 6)
      .map(p => ({ name: p.name, places: ranked(p.places), placesByLeg: { out: ranked(p.out), ret: ranked(p.ret) } }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    drivers: [...drivers.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]),
    capacity: Object.fromEntries(capacity)
  };
}

/*
  人を選んだときに「乗る場所」へ最初に入れる言葉。
  その便（迎え・送り）でいちばん多い場所。これまで空（＝家）が多い人や、はじめての人は「自宅」。
*/
export function usualPlace(roster, name, leg) {
  const p = ((roster && roster.people) || []).find(x => x.name === personKey(name));
  if (!p) return '自宅';
  const list = (p.placesByLeg && p.placesByLeg[leg] && p.placesByLeg[leg].length) ? p.placesByLeg[leg] : (p.places || []);
  return list[0] || '自宅';
}

/* ============================================================
   変更の命令（ops）を表に当てる

   画面で指で動かしたときも、AI が返した変更も、同じ命令で表を直す。
   当てられなかった命令は problems に理由を入れて返す（だまって捨てない）。
   ============================================================ */
function daysOf(op) {
  const list = Array.isArray(op.days) && op.days.length ? op.days : (op.day ? [op.day] : DAY_NUMBERS);
  return list.map(Number).filter(d => DAY_NUMBERS.includes(d));
}
function legsOf(op) {
  return op.leg === 'out' || op.leg === 'ret' ? [op.leg] : LEGS;
}
const where = (day, leg) => `${DAY_NAMES[day]}曜の${LEG_NAMES[leg]}`;

export function applyOps(source, ops) {
  const week = clone(source);
  const changes = [], problems = [], rules = [];
  const touch = (day, vanId, leg, name) => changes.push({ day, vanId, leg, name: name ? personKey(name) : '' });

  (ops || []).forEach(op => {
    switch (op.type) {
      case 'remove': {
        let found = 0;
        daysOf(op).forEach(day => legsOf(op).forEach(leg => {
          findRider(week, day, leg, op.name).reverse().forEach(hit => {
            week.days[day].trips[hit.vanId][leg].rows.splice(hit.index, 1);
            touch(day, hit.vanId, leg, '');
            found++;
          });
        }));
        if (!found) problems.push(`${op.name}様は、その日の表に見つかりませんでした（はずす対象なし）`);
        break;
      }
      case 'place': {
        const van = vanByName(week, op.van);
        if (!van) { problems.push(`「${op.van}」という車がありません（${op.name}様を乗せられませんでした）`); break; }
        daysOf(op).forEach(day => legsOf(op).forEach(leg => {
          const old = findRider(week, day, leg, op.name);
          /* 満席の車へは乗せない（すでにその車に乗っている人の、順番や場所の直しは通す） */
          if (isFull(week, van.id, day, leg) && !old.some(hit => hit.vanId === van.id)) {
            problems.push(`${where(day, leg)}の${van.name}は満席（${van.seats}人）なので、${personKey(op.name)}様を乗せられませんでした`);
            return;
          }
          let row = { name: personKey(op.name), place: '', time: '' };
          if (old.length) {
            row = { ...old[0].row };
            old.reverse().forEach(hit => week.days[day].trips[hit.vanId][leg].rows.splice(hit.index, 1));
          }
          delete row.flag;
          if (op.place != null) row.place = String(op.place);
          if (op.time) row.time = normTime(op.time);
          const rows = week.days[day].trips[van.id][leg].rows;
          let at = rows.length;
          if (op.before) {
            const i = rows.findIndex(r => personKey(r.name) === personKey(op.before));
            if (i >= 0) at = i;
          } else if (Number.isInteger(op.index)) {
            at = Math.max(0, Math.min(rows.length, op.index));
          } else if (row.time) {
            const i = rows.findIndex(r => r.time && r.time > row.time);
            if (i >= 0) at = i;
          }
          rows.splice(at, 0, row);
          touch(day, van.id, leg, row.name);
        }));
        break;
      }
      case 'update': {
        let found = 0;
        daysOf(op).forEach(day => legsOf(op).forEach(leg => {
          findRider(week, day, leg, op.name).forEach(hit => {
            if (op.place != null) hit.row.place = String(op.place);
            if (op.time) hit.row.time = normTime(op.time);
            if (op.newName) hit.row.name = personKey(op.newName);
            delete hit.row.flag;
            touch(day, hit.vanId, leg, hit.row.name);
            found++;
          });
        }));
        if (!found) problems.push(`${op.name}様は、その日の表に見つかりませんでした（直す対象なし）`);
        break;
      }
      case 'driver': {
        const van = vanByName(week, op.van);
        if (!van) { problems.push(`「${op.van}」という車がありません（運転手を入れられませんでした）`); break; }
        daysOf(op).forEach(day => legsOf(op).forEach(leg => {
          week.days[day].trips[van.id][leg].driver = String(op.driver || '');
          touch(day, van.id, leg, '');
        }));
        break;
      }
      case 'note': {
        daysOf(op).forEach(day => {
          const notes = week.days[day].notes;
          if (op.remove) {
            const i = notes.findIndex(n => normText(n).includes(normText(op.text)));
            if (i >= 0) notes.splice(i, 1);
          } else if (!notes.some(n => normText(n) === normText(op.text))) {
            notes.push(String(op.text));
          }
          changes.push({ day, note: true });
        });
        break;
      }
      case 'add_van': {
        if (vanByName(week, op.van)) break;
        const id = 'v' + (Math.max(0, ...week.vans.map(v => Number(String(v.id).replace(/\D/g, '')) || 0)) + 1);
        week.vans.push(cleanVan({ id, name: op.van, seats: op.seats }));
        DAY_NUMBERS.forEach(d => { week.days[d].trips[id] = emptyTrip(); });
        break;
      }
      case 'remember': {
        if (op.text) rules.push(String(op.text));
        break;
      }
      default:
        problems.push('知らない命令です: ' + op.type);
    }
  });
  return { week, changes, problems, rules };
}

/* ---------- 気をつける所をさがす（止めはしない。知らせるだけ） ---------- */
export function checkWeek(week, roster) {
  const warnings = [];
  DAY_NUMBERS.forEach(day => LEGS.forEach(leg => {
    const seen = new Map();
    week.vans.forEach(v => {
      const trip = week.days[day].trips[v.id][leg];
      trip.rows.forEach(r => {
        /* 同じ便に同じ人は1回しか乗れない。場所がちがっていても、入れまちがいとして知らせる */
        const k = personKey(r.name);
        const here = v.name + (r.place ? '・' + r.place : '');
        if (seen.has(k)) {
          const first = seen.get(k);
          const text = `${where(day, leg)}に ${k}様が2回入っています（${first.here} と ${here}）`;
          warnings.push({ day, leg, vanId: first.vanId, name: k, text, quiet: true });
          warnings.push({ day, leg, vanId: v.id, name: k, text });
        } else seen.set(k, { here, vanId: v.id });
      });
      const cap = seatsOf(v, roster);
      if (cap.seats && trip.rows.length > cap.seats) {
        warnings.push({ day, leg, vanId: v.id, text: `${where(day, leg)}の${v.name}が${trip.rows.length}人です（${cap.fixed ? '最大' : 'これまでの最大は'}${cap.seats}人）` });
      }
      let prev = '';
      trip.rows.forEach(r => {
        if (r.time && prev && r.time < prev) warnings.push({ day, leg, vanId: v.id, name: personKey(r.name), text: `${where(day, leg)}の${v.name}で、${r.name}様の時刻（${shortTime(r.time)}）が前の人より早くなっています` });
        if (r.time) prev = r.time;
      });
    });
  }));
  return warnings;
}

/* ---------- AI や人が読むための、文字だけの表 ---------- */
export function weekToText(week) {
  const lines = [];
  DAY_NUMBERS.forEach(day => {
    const c = dayCounts(week, day);
    lines.push(`■${DAY_NAMES[day]}曜（利用${c.all}人・迎え${c.out}・送り${c.ret}）`);
    week.vans.forEach(v => LEGS.forEach(leg => {
      const t = week.days[day].trips[v.id][leg];
      if (!t.rows.length && !t.driver) return;
      const riders = t.rows.map(r => `${r.name}${r.place ? '(' + r.place + ')' : ''}${r.time ? ' ' + shortTime(r.time) : ''}`).join('、');
      lines.push(`  ${v.name} ${LEG_NAMES[leg]}［運転:${t.driver || '未定'}］ ${riders || '（だれも乗っていない）'}`);
    }));
    if (week.days[day].notes.length) lines.push('  連絡: ' + week.days[day].notes.join(' / '));
  });
  return lines.join('\n');
}
