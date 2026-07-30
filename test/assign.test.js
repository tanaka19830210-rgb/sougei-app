/* 自動割り当て・NGペア・車椅子わく・時刻・往路→復路コピーのテスト */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/core/assign.js';
import { vansForDay } from '../js/core/schema.js';
import { makeFixture, makeVans, makeUsers } from './fixture.js';
import { createContext } from '../js/core/assign.js';
import { makeFacility, makeNgPairs } from './fixture.js';
import { normalizeUsers } from '../js/core/schema.js';

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

test('usualVanId：曜日×迎え/送り。未設定は null', () => {
  const users = makeUsers();
  const u1 = users.find(u => u.id === 'u1');
  assert.equal(A.usualVanId(u1, 1, 'out'), 'v1');
  assert.equal(A.usualVanId(u1, 1, 'ret'), 'v1');
  const u3 = users.find(u => u.id === 'u3');
  assert.equal(A.usualVanId(u3, 1, 'out'), 'v2');
  assert.equal(A.usualVanId(u3, 1, 'ret'), null, '送りは未設定');
  const bare = { id: 'x', usualVans: undefined };
  assert.equal(A.usualVanId(bare, 1, 'out'), null);
});

/* ---------- ルールどおりの自動割り当て ---------- */
test('自動割り当て：空席だけ埋め、いつもの車どおりに乗る', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  const { placed, skippedNoRule } = A.autoAssignDir(ctx, { day: 1, dir: 'out', dirState });
  assert.ok(placed.map(u => u.id).includes('u1'));
  assert.ok(placed.map(u => u.id).includes('u2'));
  assert.equal(A.findRow(ctx, dirState, 'u1', 1).vanId, 'v1');
  assert.equal(A.findRow(ctx, dirState, 'u2', 1).vanId, 'v2');
  assert.ok(skippedNoRule.map(u => u.id).includes('u6'), 'usualVans 未設定は乗せない');
  assert.equal(A.findRow(ctx, dirState, 'u6', 1), null);
});

test('自動割り当て：すでに乗っている人・席はそのまま', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  dirState.vans.v1.rows[0].userId = 'u3';   /* ルール上は v2 だが、すでに乗っている */
  dirState.vans.v1.rows[0].time = '08:20';
  dirState.vans.v1.memo = '残してね';
  dirState.vans.v1.driver = '佐々木';

  A.autoAssignDir(ctx, { day: 1, dir: 'out', dirState });

  assert.equal(dirState.vans.v1.rows[0].userId, 'u3', '既存の配置を動かさない');
  assert.equal(dirState.vans.v1.memo, '残してね');
  assert.equal(dirState.vans.v1.driver, '佐々木');
  assert.equal(A.findRow(ctx, dirState, 'u1', 1).vanId, 'v1', '空席に新規が入る');
  assert.notEqual(A.findRow(ctx, dirState, 'u1', 1).index, 0, '先頭の既存席は触らない');
});

test('自動割り当て：曜日×迎え/送りで車がかわる', () => {
  const users = normalizeUsers({
    users: [
      {
        id: 'u1', name: '一郎', area: 'あ', days: [1, 2],
        usualVans: {
          '1': { out: 'v1', ret: 'v2' },
          '2': { out: 'v2', ret: 'v1' }
        }
      }
    ]
  });
  const vans = makeVans();
  const ctx = createContext({ facility: makeFacility(), users, vans, ngPairs: [] });
  const { plan } = makeFixture({ users });

  A.autoAssignDir(ctx, { day: 1, dir: 'out', dirState: plan.days['1'].out });
  A.autoAssignDir(ctx, { day: 1, dir: 'ret', dirState: plan.days['1'].ret });
  A.autoAssignDir(ctx, { day: 2, dir: 'out', dirState: plan.days['2'].out });

  assert.equal(A.findRow(ctx, plan.days['1'].out, 'u1', 1).vanId, 'v1');
  assert.equal(A.findRow(ctx, plan.days['1'].ret, 'u1', 1).vanId, 'v2');
  assert.equal(A.findRow(ctx, plan.days['2'].out, 'u1', 2).vanId, 'v2');
});

test('自動割り当て：定員が足りないとスキップしてプールに残る', () => {
  const vans = makeVans([
    { id: 'v1', name: '小さい車', seats: 1, wheelchairSeats: 0, driver: '', days: [1] }
  ]);
  const users = normalizeUsers({
    users: [
      { id: 'a', name: 'あ', area: 'X', days: [1], usualVans: { '1': { out: 'v1', ret: null } } },
      { id: 'b', name: 'い', area: 'X', days: [1], usualVans: { '1': { out: 'v1', ret: null } } }
    ]
  });
  const ctx = createContext({ facility: makeFacility(), users, vans, ngPairs: [] });
  const { plan } = makeFixture({ users, vans: [
    { id: 'v1', name: '小さい車', seats: 1, wheelchairSeats: 0, driver: '', days: [1] }
  ] });
  /* makeFixture の makeVans(options.vans) は extra 配列をそのまま使う */
  const dirState = plan.days['1'].out;
  const { placed, skippedBlocked } = A.autoAssignDir(ctx, { day: 1, dir: 'out', dirState });
  assert.equal(placed.length, 1);
  assert.equal(skippedBlocked.length, 1);
  assert.equal(A.ridersIn(dirState, 'v1').length, 1);
});

test('自動割り当て：車椅子わくが足りないとスキップ', () => {
  const vans = makeVans([
    { id: 'v1', name: '軽', seats: 3, wheelchairSeats: 0, driver: '', days: [1] }
  ]);
  const users = normalizeUsers({
    users: [
      { id: 'w', name: '車椅子', area: 'X', wheelchair: true, days: [1],
        usualVans: { '1': { out: 'v1', ret: null } } }
    ]
  });
  const ctx = createContext({ facility: makeFacility(), users, vans, ngPairs: [] });
  const plan = makeFixture({
    users,
    vans: [{ id: 'v1', name: '軽', seats: 3, wheelchairSeats: 0, driver: '', days: [1] }]
  }).plan;
  const { placed, skippedBlocked } = A.autoAssignDir(ctx, {
    day: 1, dir: 'out', dirState: plan.days['1'].out
  });
  assert.equal(placed.length, 0);
  assert.equal(skippedBlocked.map(u => u.id).join(), 'w');
});

test('自動割り当て：同乗NGがいる車には乗せない（プールに残す）', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  dirState.vans.v1.rows[0].userId = 'u2';   /* u1 と NG。u1 のいつもの車は v1 */
  const { placed, skippedBlocked } = A.autoAssignDir(ctx, { day: 1, dir: 'out', dirState });
  assert.ok(skippedBlocked.map(u => u.id).includes('u1'));
  assert.equal(A.findRow(ctx, dirState, 'u1', 1), null);
  assert.ok(placed.map(u => u.id).includes('u4') || placed.map(u => u.id).includes('u2') === false);
});

test('自動割り当て：時刻が先頭から7分きざみで入る', () => {
  const { ctx, plan } = makeFixture();
  const dirState = plan.days['1'].out;
  A.autoAssignDir(ctx, { day: 1, dir: 'out', dirState });
  vansForDay(ctx.vans, 1).forEach(van => {
    const times = dirState.vans[van.id].rows.filter(r => r.userId).map(r => r.time);
    times.forEach((t, i) => {
      assert.equal(A.toMinutes(t), A.toMinutes('08:20') + i * 7, `${van.name} の${i + 1}人目`);
    });
  });
});

test('自動割り当て：週全体（月〜土×迎え送り）を一度に埋める', () => {
  const { ctx, plan, facility } = makeFixture();
  const summary = A.autoAssignWeek(ctx, { plan, days: facility.days });
  assert.ok(summary.placed > 0);
  assert.ok(summary.skippedNoRule > 0, '未設定の人が残る');

  /* 月曜の迎えに u1 がいる */
  assert.equal(A.findRow(ctx, plan.days['1'].out, 'u1', 1).vanId, 'v1');
  /* 火曜の送りにも（ルールあり） */
  assert.equal(A.findRow(ctx, plan.days['2'].ret, 'u1', 2).vanId, 'v1');
  /* 土曜は v2 が走らないので、v2 指定の人は乗れない */
  const satOut = plan.days['6'].out;
  assert.equal(A.findRow(ctx, satOut, 'u2', 6), null, '土曜に走らない車の指定はスキップ');
});

test('自動割り当て：既存の週配置を壊さず空席だけ足す', () => {
  const { ctx, plan, facility } = makeFixture();
  plan.days['1'].out.vans.v1.rows[1].userId = 'u3';
  plan.days['1'].out.vans.v1.rows[1].changed = true;

  A.autoAssignWeek(ctx, { plan, days: [1] });

  const row = plan.days['1'].out.vans.v1.rows[1];
  assert.equal(row.userId, 'u3', '既存の人はその席のまま');
  assert.equal(row.changed, true, '当日変更の印も残る');
  assert.ok(A.findRow(ctx, plan.days['1'].out, 'u1', 1), '空席には新規が入る');
  assert.notEqual(A.findRow(ctx, plan.days['1'].out, 'u1', 1).index, 1, '既存席は触らない');
});

/* ---------- みんな降ろす ---------- */
test('clearWeekAssignments：週全体から降ろし、メモ・運転手・notes は残す', () => {
  const { ctx, plan, facility } = makeFixture();
  A.autoAssignWeek(ctx, { plan, days: facility.days });
  plan.days['1'].out.vans.v1.memo = '雨の日は玄関前まで';
  plan.days['1'].out.vans.v1.driver = '山田';
  plan.days['1'].notes = [{ kind: 'hand', text: '引き継ぎ' }];
  plan.days['2'].ret.vans.v1.memo = '送りメモ';
  plan.days['2'].ret.vans.v1.driver = '';

  const before = A.placedIds(ctx, plan.days['1'].out, 1).length
    + A.placedIds(ctx, plan.days['1'].ret, 1).length;
  assert.ok(before > 0, '前提：誰か乗っている');

  const { removed } = A.clearWeekAssignments(ctx, { plan, days: facility.days });
  assert.ok(removed > 0);

  facility.days.forEach(day => {
    ['out', 'ret'].forEach(dir => {
      assert.equal(A.placedIds(ctx, plan.days[String(day)][dir], day).length, 0,
        `${day}曜の${dir}は全員プールへ`);
      assert.deepEqual(
        A.unassignedUsers(ctx, plan.days[String(day)][dir], day, dir).map(u => u.id),
        A.targetUsers(ctx, day, dir).map(u => u.id)
      );
    });
  });

  assert.equal(plan.days['1'].out.vans.v1.memo, '雨の日は玄関前まで');
  assert.equal(plan.days['1'].out.vans.v1.driver, '山田');
  assert.deepEqual(plan.days['1'].notes, [{ kind: 'hand', text: '引き継ぎ' }]);
  assert.equal(plan.days['2'].ret.vans.v1.memo, '送りメモ');
  assert.equal(plan.days['2'].ret.vans.v1.driver, '');
  assert.deepEqual(plan.days['1'].out.vans.v1.rows[0], { userId: null, time: '', changed: false });
});

test('clearWeekAssignments：降ろしたあとにルール割り当てで埋め直せる', () => {
  const { ctx, plan, facility } = makeFixture();
  A.autoAssignWeek(ctx, { plan, days: [1] });
  A.clearWeekAssignments(ctx, { plan, days: [1] });
  const again = A.autoAssignWeek(ctx, { plan, days: [1] });
  assert.ok(again.placed > 0);
  assert.ok(A.findRow(ctx, plan.days['1'].out, 'u1', 1));
});

test('clearWeekAssignments：週スナップショットからもどせる（undo と同じ考え方）', () => {
  const { ctx, plan, facility } = makeFixture();
  A.autoAssignWeek(ctx, { plan, days: [1, 2] });
  const snapshot = JSON.parse(JSON.stringify({ __week: true, days: plan.days }));
  A.clearWeekAssignments(ctx, { plan, days: [1, 2] });
  assert.equal(A.placedIds(ctx, plan.days['1'].out, 1).length, 0);
  plan.days = snapshot.days;
  assert.ok(A.placedIds(ctx, plan.days['1'].out, 1).length > 0, 'undo で配置が戻る');
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
