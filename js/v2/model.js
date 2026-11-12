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
  const week = { schemaVersion: SCHEMA_VERSION, facilityId, weekStart, vans: vans.map(v => ({ id: v.id, name: v.name })), days: {}, log: [] };
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
    .map(v => ({ id: String(v.id), name: String(v.name) }));
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

/* 「谷口様」「谷口さん」「谷口」を同じ人として扱うための鍵 */
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
  weeks.forEach(week => eachTrip(week, ({ van, trip }) => {
    const vn = normText(van.name);
    capacity.set(vn, Math.max(capacity.get(vn) || 0, trip.rows.length));
    if (trip.driver) drivers.set(trip.driver, (drivers.get(trip.driver) || 0) + 1);
    trip.rows.forEach(row => {
      const key = personKey(row.name);
      if (!people.has(key)) people.set(key, { name: key, places: new Map() });
      const places = people.get(key).places;
      places.set(row.place, (places.get(row.place) || 0) + 1);
    });
  }));
  return {
    people: [...people.values()]
      .map(p => ({ name: p.name, places: [...p.places.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    drivers: [...drivers.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]),
    capacity: Object.fromEntries(capacity)
  };
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
        week.vans.push({ id, name: String(op.van) });
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
        /* 同じ名字でも乗る場所がちがえば別の人（ごきょうだい等）と見て、知らせない */
        const k = personKey(r.name) + '|' + normText(r.place);
        if (seen.has(k)) warnings.push({ day, leg, vanId: v.id, name: personKey(r.name), text: `${where(day, leg)}に ${personKey(r.name)}様が2回入っています（${seen.get(k)} と ${v.name}）` });
        else seen.set(k, v.name);
      });
      const cap = roster && roster.capacity ? roster.capacity[normText(v.name)] : 0;
      if (cap && trip.rows.length > cap) {
        warnings.push({ day, leg, vanId: v.id, text: `${where(day, leg)}の${v.name}が${trip.rows.length}人です（これまでの最大は${cap}人）` });
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
