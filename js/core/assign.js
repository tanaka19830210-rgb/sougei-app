/* ============================================================
   割り当てのロジック（画面に関係しない計算だけ）

   ここは test/ からそのまま呼べるように、DOM をいっさい触らない。
   ============================================================ */

import { capacity, vansForDay, blankRow } from './schema.js';

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

/*
  その車に置けるか。置けないときは理由（日本語）を返す。

  index（席の番号）を渡すと、その席にいる人との「取りかえっこ」まで見る。
  - 車椅子どうしの取りかえは、相手が出ていくので わくが空く
  - 押し出された人が車椅子なら、もといた車に わくがあるかも見る。
    見ないと、車椅子の方が わくの無い車へ黙って移り、当日乗れない事故になる
*/
export function canDrop(ctx, dirState, userId, vanId, day, index) {
  const van = ctx.vansById[vanId];
  const user = ctx.usersById[userId];
  if (!van || !user) return { reason: 'この車には置けません' };
  const from = findRow(ctx, dirState, userId, day);
  if (from && from.vanId === vanId) return true;

  const target = dirState && dirState.vans ? dirState.vans[vanId] : null;
  const targetRow = target && Number.isInteger(index) ? target.rows[index] : null;
  const displaced = targetRow && targetRow.userId ? ctx.usersById[targetRow.userId] : null;
  const displacedWc = !!(displaced && displaced.wheelchair);

  if (user.wheelchair) {
    const used = wheelchairCount(ctx, dirState, vanId) - (displacedWc ? 1 : 0);
    if (used >= van.wheelchairSeats) {
      /*
        「わくが0」と「わくはあるが埋まっている」は、直しかたが違う。
        0 のときに「いっぱいです」と言うと、座席は空いて見えるので現場が詰まる。
        直す先（車両マスタ）まで言う。
      */
      if (!van.wheelchairSeats) {
        return { reason: `${van.name}には車椅子のわくがありません。マスタ編集の「車」で「車椅子わく」を1以上にしてください` };
      }
      return { reason: `${van.name}の車椅子スペースは いっぱいです（わくは ${van.wheelchairSeats}）` };
    }
  }

  /* 押し出された人は、動かした人のもとの席に入る。そこが車椅子で乗れる席か */
  if (displacedWc && from) {
    const fromVan = ctx.vansById[from.vanId];
    const seats = fromVan ? fromVan.wheelchairSeats : 0;
    const used = wheelchairCount(ctx, dirState, from.vanId) - (user.wheelchair ? 1 : 0);
    if (used >= seats) {
      const fromName = fromVan ? fromVan.name : 'もとの車';
      return {
        reason: `取りかえると ${displaced.name}さん（車椅子）が ${fromName} に移りますが、` +
          `${fromName} には車椅子のわくが足りません`
      };
    }
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
   いつもの車（マスタの usualVans）
   曜日 × 迎え/送り。未設定・null・欠落は null を返す。
   ------------------------------------------------------------ */
export function usualVanId(user, day, dir) {
  if (!user || !user.usualVans || typeof user.usualVans !== 'object') return null;
  const entry = user.usualVans[String(day)];
  if (!entry || typeof entry !== 'object') return null;
  const vanId = entry[dir];
  return vanId ? String(vanId) : null;
}

function putInEmptySeat(dirState, vanId, userId) {
  const van = dirState && dirState.vans ? dirState.vans[vanId] : null;
  if (!van || !Array.isArray(van.rows)) return false;
  const row = van.rows.find(r => !r.userId);
  if (!row) return false;
  row.userId = userId;
  row.time = '';
  row.changed = false;
  return true;
}

/*
  1日・1便ぶん：空いている席だけを、マスタの「いつもの車」どおりに埋める。
  - すでに乗っている人・席は動かさない
  - いつもの車が未設定の人は乗せない（プールに残す）
  - 定員・車椅子わく・同乗NGを守れないときはスキップ
  dirState をその場で書きかえる。
*/
export function autoAssignDir(ctx, { day, dir, dirState }) {
  const placed = [];
  const skippedNoRule = [];
  const skippedBlocked = [];
  if (!dirState || !dirState.vans) {
    return { placed, skippedNoRule, skippedBlocked };
  }

  const dayVanIds = new Set(vansForDay(ctx.vans, day).map(v => v.id));
  const candidates = unassignedUsers(ctx, dirState, day, dir).map(user => ({
    user,
    vanId: usualVanId(user, day, dir)
  }));

  const withRule = [];
  candidates.forEach(c => {
    if (!c.vanId) skippedNoRule.push(c.user);
    else withRule.push(c);
  });

  /* 車椅子の方を先に（わくが少ないので） */
  withRule.sort((a, b) => Number(!!b.user.wheelchair) - Number(!!a.user.wheelchair));

  const touched = new Set();
  withRule.forEach(({ user, vanId }) => {
    const van = ctx.vansById[vanId];
    if (!van || !dayVanIds.has(vanId) || !dirState.vans[vanId]) {
      skippedBlocked.push(user);
      return;
    }
    if (user.wheelchair && wheelchairCount(ctx, dirState, vanId) >= van.wheelchairSeats) {
      skippedBlocked.push(user);
      return;
    }
    if (freeSeats(dirState, vanId) <= 0) {
      skippedBlocked.push(user);
      return;
    }
    if (ngPartnerIn(ctx, dirState, vanId, user.id)) {
      skippedBlocked.push(user);
      return;
    }
    if (!putInEmptySeat(dirState, vanId, user.id)) {
      skippedBlocked.push(user);
      return;
    }
    placed.push(user);
    touched.add(vanId);
  });

  touched.forEach(vanId => retimeVan(ctx, dirState, vanId, dir));
  return { placed, skippedNoRule, skippedBlocked };
}

/*
  週全体（月〜土 × 迎えと送り）を、ルールどおりに空席だけ埋める。
  plan.days をその場で書きかえる。すでに乗っている配置は壊さない。
*/
export function autoAssignWeek(ctx, { plan, days } = {}) {
  const useDays = Array.isArray(days) && days.length
    ? days.map(Number).filter(n => n >= 1 && n <= 6)
    : [1, 2, 3, 4, 5, 6];
  const summary = {
    placed: 0,
    skippedNoRule: 0,
    skippedBlocked: 0,
    placedUsers: [],
    skippedNoRuleUsers: [],
    skippedBlockedUsers: []
  };
  if (!plan || !plan.days) return summary;

  useDays.forEach(day => {
    const dayState = plan.days[String(day)];
    if (!dayState) return;
    ['out', 'ret'].forEach(dir => {
      if (!dayState[dir]) return;
      const result = autoAssignDir(ctx, { day, dir, dirState: dayState[dir] });
      summary.placed += result.placed.length;
      summary.skippedNoRule += result.skippedNoRule.length;
      summary.skippedBlocked += result.skippedBlocked.length;
      summary.placedUsers.push(...result.placed);
      summary.skippedNoRuleUsers.push(...result.skippedNoRule);
      summary.skippedBlockedUsers.push(...result.skippedBlocked);
    });
  });
  return summary;
}

/*
  週全体（月〜土 × 迎えと送り）から、乗っている人をすべて降ろす。
  - 座席の userId / time / changed だけ空にする
  - 車両のメモ・運転手・日ごとのメモ（notes）はそのまま
  plan.days をその場で書きかえる。
*/
export function clearWeekAssignments(ctx, { plan, days } = {}) {
  const useDays = Array.isArray(days) && days.length
    ? days.map(Number).filter(n => n >= 1 && n <= 6)
    : [1, 2, 3, 4, 5, 6];
  let removed = 0;
  if (!plan || !plan.days) return { removed };

  useDays.forEach(day => {
    const dayState = plan.days[String(day)];
    if (!dayState) return;
    ['out', 'ret'].forEach(dir => {
      const dirState = dayState[dir];
      if (!dirState || !dirState.vans) return;
      vansForDay(ctx.vans, day).forEach(v => {
        const van = dirState.vans[v.id];
        if (!van || !Array.isArray(van.rows)) return;
        van.rows.forEach(row => {
          if (!row.userId) return;
          row.userId = null;
          row.time = '';
          row.changed = false;
          removed += 1;
        });
      });
    });
  });
  return { removed };
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
