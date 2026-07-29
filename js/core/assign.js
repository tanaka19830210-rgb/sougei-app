/* ============================================================
   割り当てのロジック（画面に関係しない計算だけ）

   ここは test/ からそのまま呼べるように、DOM をいっさい触らない。
   ============================================================ */

import { capacity, vansForDay, blankRow, blankRows } from './schema.js';

/* ------------------------------------------------------------
   計算のもとになる材料をひとまとめにする
   ------------------------------------------------------------ */
export function createContext({ facility, users, vans, ngPairs }) {
  const userList = users || [];
  const vanList = vans || [];
  return {
    facility,
    users: userList,
    vans: vanList,
    usersById: Object.fromEntries(userList.map(u => [u.id, u])),
    vansById: Object.fromEntries(vanList.map(v => [v.id, v])),
    ngPairs: ngPairs || [],
    stepMinutes: facility && facility.stepMinutes ? facility.stepMinutes : 7,
    startTimes: (facility && facility.startTimes) || { out: '08:20', ret: '15:30' }
  };
}

/* ------------------------------------------------------------
   時刻
   ------------------------------------------------------------ */
export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function toHHMM(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/* ------------------------------------------------------------
   その日・その便に乗る人
   ------------------------------------------------------------ */
export function targetUsers(ctx, day, dir) {
  return ctx.users.filter(u => {
    if (!u.days.includes(Number(day))) return false;
    if (dir === 'ret' && u.noReturn) return false;
    return true;
  });
}

export function ridersIn(dirState, vanId) {
  const van = dirState && dirState.vans ? dirState.vans[vanId] : null;
  if (!van || !Array.isArray(van.rows)) return [];
  return van.rows.filter(r => r.userId).map(r => r.userId);
}

export function placedIds(ctx, dirState, day) {
  const ids = [];
  vansForDay(ctx.vans, day).forEach(v => ids.push(...ridersIn(dirState, v.id)));
  return ids;
}

export function unassignedUsers(ctx, dirState, day, dir) {
  const placed = new Set(placedIds(ctx, dirState, day));
  return targetUsers(ctx, day, dir).filter(u => !placed.has(u.id));
}

export function wheelchairCount(ctx, dirState, vanId) {
  return ridersIn(dirState, vanId).filter(id => {
    const u = ctx.usersById[id];
    return u && u.wheelchair;
  }).length;
}

export function freeSeats(dirState, vanId) {
  const van = dirState && dirState.vans ? dirState.vans[vanId] : null;
  if (!van || !Array.isArray(van.rows)) return 0;
  return van.rows.filter(r => !r.userId).length;
}

export function findRow(ctx, dirState, userId, day) {
  for (const v of vansForDay(ctx.vans, day)) {
    const van = dirState.vans[v.id];
    if (!van) continue;
    const i = van.rows.findIndex(r => r.userId === userId);
    if (i >= 0) return { vanId: v.id, index: i };
  }
  return null;
}

/* いっしょに乗れない相手が、その車にすでに乗っているか */
export function ngPartnerIn(ctx, dirState, vanId, userId) {
  const riders = ridersIn(dirState, vanId).filter(id => id !== userId);
  for (const p of ctx.ngPairs) {
    if (p.a === userId && riders.includes(p.b)) return p.b;
    if (p.b === userId && riders.includes(p.a)) return p.a;
  }
  return null;
}

/* その車に置けるか。置けないときは理由（日本語）を返す */
export function canDrop(ctx, dirState, userId, vanId, day) {
  const van = ctx.vansById[vanId];
  const user = ctx.usersById[userId];
  if (!van || !user) return { reason: 'この車には置けません' };
  const from = findRow(ctx, dirState, userId, day);
  if (from && from.vanId === vanId) return true;
  if (user.wheelchair && wheelchairCount(ctx, dirState, vanId) >= van.wheelchairSeats) {
    return { reason: `${van.name}の車椅子スペースは いっぱいです` };
  }
  return true;
}

/* ------------------------------------------------------------
   時刻の再計算（先頭から stepMinutes きざみ）
   ------------------------------------------------------------ */
export function retimeVan(ctx, dirState, vanId, dir) {
  const van = dirState.vans[vanId];
  if (!van) return;
  const base = toMinutes(ctx.startTimes[dir]);
  let n = 0;
  van.rows.forEach(r => {
    if (r.userId) {
      r.time = toHHMM(base + n * ctx.stepMinutes);
      n++;
    } else {
      r.time = '';
      r.changed = false;
    }
  });
}

export function retimeAll(ctx, dirState, dir, day) {
  vansForDay(ctx.vans, day).forEach(v => retimeVan(ctx, dirState, v.id, dir));
}

/* ------------------------------------------------------------
   1人を車の座席へ入れる（すでに人がいれば入れかえ）
   dirState を書きかえる
   ------------------------------------------------------------ */
export function place(ctx, dirState, { userId, vanId, index, dir, day }) {
  const target = dirState.vans[vanId];
  if (!target || !target.rows[index]) return dirState;
  const from = findRow(ctx, dirState, userId, day);
  const targetRow = target.rows[index];
  const displaced = targetRow.userId;

  if (from) dirState.vans[from.vanId].rows[from.index] = blankRow();
  target.rows[index] = { userId, time: '', changed: false };
  /* もといた席に、押し出された人を入れる（席の取りかえっこ） */
  if (displaced && from) {
    dirState.vans[from.vanId].rows[from.index] = { userId: displaced, time: '', changed: false };
  }

  retimeVan(ctx, dirState, vanId, dir);
  if (from && from.vanId !== vanId) retimeVan(ctx, dirState, from.vanId, dir);
  return dirState;
}

/* 車から降ろして「まだ乗っていない人」へもどす */
export function removeToPool(ctx, dirState, { userId, dir, day }) {
  const from = findRow(ctx, dirState, userId, day);
  if (!from) return dirState;
  dirState.vans[from.vanId].rows[from.index] = blankRow();
  retimeVan(ctx, dirState, from.vanId, dir);
  return dirState;
}

/* ------------------------------------------------------------
   自動で割り当て
   1. 車椅子の方を、車椅子スペースのある車へ
   2. 歩ける方を、同じエリアの人がいる車へ（エリアでまとめる）
   定員と車椅子わく、同乗NGペアは守る。乗り切らない人は leftOut に入れて
   画面から「手でうごかしてください」と伝える。
   ------------------------------------------------------------ */
export function autoAssign(ctx, { day, dir, prevState }) {
  const dayVans = vansForDay(ctx.vans, day);
  const state = { vans: {} };
  dayVans.forEach(v => {
    const prev = prevState && prevState.vans ? prevState.vans[v.id] : null;
    state.vans[v.id] = {
      /* メモと運転手は消さずに残す */
      driver: prev && typeof prev.driver === 'string' ? prev.driver : null,
      memo: prev && prev.memo ? prev.memo : '',
      rows: blankRows(v)
    };
  });

  const list = targetUsers(ctx, day, dir);
  const wcUsers = list.filter(u => u.wheelchair);
  const walkers = list.filter(u => !u.wheelchair);
  const leftOut = [];

  const putIn = (vanId, userId) => {
    const row = state.vans[vanId].rows.find(r => !r.userId);
    if (!row) return false;
    row.userId = userId;
    return true;
  };

  wcUsers.forEach(u => {
    const van = dayVans
      .filter(v => v.wheelchairSeats > 0
        && wheelchairCount(ctx, state, v.id) < v.wheelchairSeats
        && freeSeats(state, v.id) > 0
        && !ngPartnerIn(ctx, state, v.id, u.id))
      .sort((a, b) => (b.wheelchairSeats - wheelchairCount(ctx, state, b.id))
        - (a.wheelchairSeats - wheelchairCount(ctx, state, a.id)))[0];
    if (van) putIn(van.id, u.id); else leftOut.push(u);
  });

  const byArea = {};
  walkers.forEach(u => { (byArea[u.area] = byArea[u.area] || []).push(u); });
  Object.values(byArea).forEach(group => group.forEach(u => {
    const score = v => ridersIn(state, v.id)
      .filter(id => ctx.usersById[id] && ctx.usersById[id].area === u.area).length * 10
      + freeSeats(state, v.id);
    const van = dayVans
      .filter(v => freeSeats(state, v.id) > 0 && !ngPartnerIn(ctx, state, v.id, u.id))
      .sort((a, b) => score(b) - score(a))[0];
    if (van) putIn(van.id, u.id); else leftOut.push(u);
  }));

  /* 前へ詰めなおして時刻をふりなおす */
  dayVans.forEach(v => {
    const ids = state.vans[v.id].rows.filter(r => r.userId).map(r => r.userId);
    state.vans[v.id].rows = Array.from({ length: capacity(v) }, (_, i) => (
      ids[i] ? { userId: ids[i], time: '', changed: false } : blankRow()
    ));
    retimeVan(ctx, state, v.id, dir);
  });

  return { state, leftOut };
}

/* ------------------------------------------------------------
   迎え → 送り のコピー（送りは迎えのコピーが初期値）
   「送り不要」の方は乗せない。メモと運転手は引きつぐ。
   ------------------------------------------------------------ */
export function copyOutToReturn(ctx, { day, outState }) {
  const dayVans = vansForDay(ctx.vans, day);
  const state = { vans: {} };
  dayVans.forEach(v => {
    const src = outState && outState.vans ? outState.vans[v.id] : null;
    const ids = src && Array.isArray(src.rows)
      ? src.rows
        .filter(r => r.userId)
        .map(r => r.userId)
        .filter(id => {
          const u = ctx.usersById[id];
          return u && !u.noReturn;
        })
      : [];
    state.vans[v.id] = {
      driver: src && typeof src.driver === 'string' ? src.driver : null,
      memo: src && src.memo ? src.memo : '',
      rows: Array.from({ length: capacity(v) }, (_, i) => (
        ids[i] ? { userId: ids[i], time: '', changed: false } : blankRow()
      ))
    };
    retimeVan(ctx, state, v.id, 'ret');
  });
  return state;
}

/*
  その車の運転手。
  その日の指定（文字）があればそれ。'' は「未定」。
  指定なし（null）なら車両マスタの運転手。
*/
export function driverOf(ctx, dirState, vanId) {
  const van = dirState && dirState.vans ? dirState.vans[vanId] : null;
  if (van && typeof van.driver === 'string') return van.driver;
  const master = ctx.vansById[vanId];
  return master && master.driver ? master.driver : '';
}
