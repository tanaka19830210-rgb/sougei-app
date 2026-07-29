/* 自動割り当て・NGペア・車椅子わく・時刻・往路→復路コピーのテスト */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/core/assign.js';
import { capacity, vansForDay } from '../js/core/schema.js';
import { makeFixture, makeVans, makeUsers } from './fixture.js';
import { createContext } from '../js/core/assign.js';
import { makeFacility, makeNgPairs } from './fixture.js';

/* ---------- 時刻 ---------- */
test('時刻の計算：文字と分の行き来', () => {
  assert.equal(A.toMinutes('08:20'), 500);
  assert.equal(A.toMinutes('8:20'), 500);
  assert.equal(A.toMinutes(''), 0);
  assert.equal(A.toHHMM(500), '08:20');
  assert.equal(A.toHHMM(500 + 7), '08:27');
  assert.equal(A.toHHMM(1440), '00:00');
});

test('7分きざみで時刻をふりなおす。空席は空になる', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  dirState.vans.v1.rows[0].userId = 'u1';
  dirState.vans.v1.rows[2].userId = 'u3';
  dirState.vans.v1.rows[3].userId = 'u4';
  A.retimeVan(ctx, dirState, 'v1', 'out');
  assert.deepEqual(dirState.vans.v1.rows.map(r => r.time), ['08:20', '', '08:27', '08:34']);
});

test('送りの時刻は 15:30 から始まる', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].ret;
  dirState.vans.v1.rows[0].userId = 'u1';
  dirState.vans.v1.rows[1].userId = 'u3';
  A.retimeVan(ctx, dirState, 'v1', 'ret');
  assert.deepEqual(dirState.vans.v1.rows.slice(0, 2).map(r => r.time), ['15:30', '15:37']);
});

test('刻みの分数は事業所ごとに変えられる', () => {
  const facility = makeFacility({ stepMinutes: 10, startTimes: { out: '09:00', ret: '16:00' } });
  const ctx = createContext({ facility, users: makeUsers(), vans: makeVans(), ngPairs: [] });
  const dirState = { vans: { v1: { driver: null, memo: '', rows: [
    { userId: 'u1', time: '', changed: false },
    { userId: 'u2', time: '', changed: false }
  ] } } };
  A.retimeVan(ctx, dirState, 'v1', 'out');
  assert.deepEqual(dirState.vans.v1.rows.map(r => r.time), ['09:00', '09:10']);
});

/* ---------- 乗る人 ---------- */
test('その日に来る人だけを数える。送り不要の方は送りに出ない', () => {
  const { ctx } = makeFixture();
  assert.deepEqual(A.targetUsers(ctx, 1, 'out').map(u => u.id), ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
  assert.deepEqual(A.targetUsers(ctx, 1, 'ret').map(u => u.id), ['u1', 'u2', 'u3', 'u4', 'u5']);
  assert.deepEqual(A.targetUsers(ctx, 6, 'out').map(u => u.id), ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7']);
});

/* ---------- 自動割り当て ---------- */
test('自動割り当て：全員が乗り、車椅子わく・NGペア・定員を守る', () => {
  const { ctx, plan } = makeFixture();
  const { state, leftOut } = A.autoAssign(ctx, { day: 1, dir: 'out', prevState: plan.days['1'].out });
  assert.deepEqual(leftOut, []);

  const placed = A.placedIds(ctx, state, 1);
  assert.equal(placed.length, 6);
  assert.equal(new Set(placed).size, 6, '同じ人が2回乗っていない');

  vansForDay(ctx.vans, 1).forEach(van => {
    const riders = A.ridersIn(state, van.id);
    assert.ok(riders.length <= capacity(van), `${van.name} が定員をこえていない`);
    assert.ok(A.wheelchairCount(ctx, state, van.id) <= van.wheelchairSeats, `${van.name} の車椅子わくを守っている`);
    riders.forEach(id => {
      assert.equal(A.ngPartnerIn(ctx, state, van.id, id), null,
        `${van.name} に同乗NGペアが同じ車になっていない`);
    });
  });
});

test('自動割り当て：時刻が先頭から7分きざみで入る', () => {
  const { ctx, plan } = makeFixture();
  const { state } = A.autoAssign(ctx, { day: 1, dir: 'out', prevState: plan.days['1'].out });
  vansForDay(ctx.vans, 1).forEach(van => {
    const times = state.vans[van.id].rows.filter(r => r.userId).map(r => r.time);
    times.forEach((t, i) => {
      assert.equal(A.toMinutes(t), A.toMinutes('08:20') + i * 7, `${van.name} の${i + 1}人目`);
    });
  });
});

test('自動割り当て：車椅子わくが足りないと、その方は乗れないまま残る', () => {
  const vans = makeVans([
    { id: 'v1', name: '軽', seats: 4, wheelchairSeats: 0, driver: '', days: [1, 2, 3, 4, 5, 6] }
  ]);
  const ctx = createContext({ facility: makeFacility(), users: makeUsers(), vans, ngPairs: [] });
  const { state, leftOut } = A.autoAssign(ctx, { day: 1, dir: 'out' });
  const leftIds = leftOut.map(u => u.id);
  assert.ok(leftIds.includes('u4'), '車椅子の方が残る');
  assert.ok(leftIds.includes('u5'), '車椅子の方が残る');
  assert.equal(A.ridersIn(state, 'v1').length, 4, '歩ける方で4席うまる');
});

test('自動割り当て：定員が足りないと乗れなかった人数がわかる', () => {
  const vans = makeVans([
    { id: 'v1', name: '小さい車', seats: 1, wheelchairSeats: 1, driver: '', days: [1] }
  ]);
  const ctx = createContext({ facility: makeFacility(), users: makeUsers(), vans, ngPairs: [] });
  const { leftOut } = A.autoAssign(ctx, { day: 1, dir: 'out' });
  assert.equal(leftOut.length, 4);   /* 6人のうち2人だけ乗れる */
});

test('自動割り当て：メモと運転手の指定は消さずに残す', () => {
  const { ctx, plan } = makeFixture();
  const prev = plan.days['1'].out;
  prev.vans.v1.memo = '雨の日は玄関前まで';
  prev.vans.v1.driver = '佐々木';
  prev.vans.v2.driver = '';
  const { state } = A.autoAssign(ctx, { day: 1, dir: 'out', prevState: prev });
  assert.equal(state.vans.v1.memo, '雨の日は玄関前まで');
  assert.equal(state.vans.v1.driver, '佐々木');
  assert.equal(state.vans.v2.driver, '', '「未定」の指定も残る');
});

test('自動割り当て：その曜日に走らない車は使わない', () => {
  const { ctx, plan } = makeFixture();
  const { state } = A.autoAssign(ctx, { day: 6, dir: 'out', prevState: plan.days['6'].out });
  assert.deepEqual(Object.keys(state.vans), ['v1']);
});

/* ---------- 同乗NGペア ---------- */
test('NGペア：同じ車にいる相手を見つける', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  dirState.vans.v1.rows[0].userId = 'u2';
  assert.equal(A.ngPartnerIn(ctx, dirState, 'v1', 'u1'), 'u2');
  assert.equal(A.ngPartnerIn(ctx, dirState, 'v1', 'u3'), null);
  assert.equal(A.ngPartnerIn(ctx, dirState, 'v2', 'u1'), null, 'ちがう車ならNGにならない');
});

test('NGペア：登録の順番（a,b が逆）でも見つける', () => {
  const ctx = createContext({
    facility: makeFacility(), users: makeUsers(), vans: makeVans(),
    ngPairs: [{ a: 'u2', b: 'u1', reason: '' }]
  });
  const dirState = { vans: { v1: { driver: null, memo: '', rows: [{ userId: 'u1', time: '', changed: false }] } } };
  assert.equal(A.ngPartnerIn(ctx, dirState, 'v1', 'u2'), 'u1');
});

/* ---------- 車椅子わくの判定 ---------- */
test('canDrop：車椅子わくがいっぱいの車には置けない（理由が日本語で返る）', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  dirState.vans.v1.rows[0].userId = 'u4';                 /* 車椅子1名でわくは満杯 */
  const no = A.canDrop(ctx, dirState, 'u5', 'v1', 1);
  assert.equal(no.reason, 'ハイエースの車椅子スペースは いっぱいです');
  assert.equal(A.canDrop(ctx, dirState, 'u1', 'v1', 1), true, '歩ける方は置ける');
  assert.equal(A.canDrop(ctx, dirState, 'u4', 'v1', 1), true, 'もう乗っている本人は動かせる');
});

/* ---------- 置く・おろす ---------- */
test('place：空席に入れると時刻がふりなおされる', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  A.place(ctx, dirState, { userId: 'u1', vanId: 'v1', index: 2, dir: 'out', day: 1 });
  assert.equal(dirState.vans.v1.rows[2].userId, 'u1');
  assert.equal(dirState.vans.v1.rows[2].time, '08:20');
});

test('place：人がいる席に入れると席を取りかえっこする', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  A.place(ctx, dirState, { userId: 'u1', vanId: 'v1', index: 0, dir: 'out', day: 1 });
  A.place(ctx, dirState, { userId: 'u3', vanId: 'v2', index: 0, dir: 'out', day: 1 });
  A.place(ctx, dirState, { userId: 'u3', vanId: 'v1', index: 0, dir: 'out', day: 1 });
  assert.equal(dirState.vans.v1.rows[0].userId, 'u3');
  assert.equal(dirState.vans.v2.rows[0].userId, 'u1', '押し出された人がもとの席に入る');
});

test('place：ほかの車から動かすと、両方の車の時刻がふりなおされる', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  A.place(ctx, dirState, { userId: 'u1', vanId: 'v1', index: 0, dir: 'out', day: 1 });
  A.place(ctx, dirState, { userId: 'u2', vanId: 'v1', index: 1, dir: 'out', day: 1 });
  A.place(ctx, dirState, { userId: 'u1', vanId: 'v2', index: 0, dir: 'out', day: 1 });
  assert.equal(dirState.vans.v1.rows[0].userId, null);
  assert.equal(dirState.vans.v1.rows[1].time, '08:20', 'あとの人が先頭の時刻になる');
  assert.equal(dirState.vans.v2.rows[0].time, '08:20');
});

test('removeToPool：おろすと空席になり、当日変更の赤も消える', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  A.place(ctx, dirState, { userId: 'u1', vanId: 'v1', index: 0, dir: 'out', day: 1 });
  dirState.vans.v1.rows[0].changed = true;
  A.removeToPool(ctx, dirState, { userId: 'u1', dir: 'out', day: 1 });
  assert.deepEqual(dirState.vans.v1.rows[0], { userId: null, time: '', changed: false });
});

test('unassignedUsers：まだ乗っていない人が出る', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  A.place(ctx, dirState, { userId: 'u1', vanId: 'v1', index: 0, dir: 'out', day: 1 });
  assert.deepEqual(A.unassignedUsers(ctx, dirState, 1, 'out').map(u => u.id), ['u2', 'u3', 'u4', 'u5', 'u6']);
});

/* ---------- 迎え → 送り ---------- */
test('copyOutToReturn：送り不要の方をのぞいてコピーし、時刻は送りの時間で入れなおす', () => {
  const { ctx, plan } = makeFixture();
  const out = plan.days['1'].out;
  A.place(ctx, out, { userId: 'u6', vanId: 'v1', index: 0, dir: 'out', day: 1 });  /* 送り不要 */
  A.place(ctx, out, { userId: 'u1', vanId: 'v1', index: 1, dir: 'out', day: 1 });
  A.place(ctx, out, { userId: 'u3', vanId: 'v1', index: 2, dir: 'out', day: 1 });
  out.vans.v1.memo = 'ヘルパー迎え';
  out.vans.v1.driver = '山田';

  const ret = A.copyOutToReturn(ctx, { day: 1, outState: out });
  assert.deepEqual(A.ridersIn(ret, 'v1'), ['u1', 'u3'], '送り不要の六郎はコピーされない');
  assert.deepEqual(ret.vans.v1.rows.slice(0, 2).map(r => r.time), ['15:30', '15:37']);
  assert.equal(ret.vans.v1.memo, 'ヘルパー迎え');
  assert.equal(ret.vans.v1.driver, '山田');
  assert.equal(ret.vans.v1.rows[0].changed, false);
});

test('copyOutToReturn：前へ詰めるので、迎えの途中が空いていても送りはつまる', () => {
  const { ctx, plan } = makeFixture();
  const out = plan.days['1'].out;
  out.vans.v1.rows[3].userId = 'u1';
  const ret = A.copyOutToReturn(ctx, { day: 1, outState: out });
  assert.equal(ret.vans.v1.rows[0].userId, 'u1');
  assert.equal(ret.vans.v1.rows[0].time, '15:30');
});

/* ---------- 運転手 ---------- */
test('driverOf：その日の指定 → 空文字は未定 → 指定なしはマスタの運転手', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  assert.equal(A.driverOf(ctx, dirState, 'v1'), '山田');
  dirState.vans.v1.driver = '佐々木';
  assert.equal(A.driverOf(ctx, dirState, 'v1'), '佐々木');
  dirState.vans.v1.driver = '';
  assert.equal(A.driverOf(ctx, dirState, 'v1'), '');
});
