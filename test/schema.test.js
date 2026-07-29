/* データのかたちと、古い形の読みこみのテスト */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/core/schema.js';
import { makeFixture, makeVans } from './fixture.js';

test('createEmptyPlan：曜日・迎え送り・車のわく箱ができる', () => {
  const { facility, vans } = makeFixture();
  const plan = S.createEmptyPlan({ facilityId: facility.id, weekStart: '2026-08-03', vans, days: facility.days });
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.weekStart, '2026-08-03');
  assert.deepEqual(Object.keys(plan.days), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(Object.keys(plan.days['1'].out.vans), ['v1', 'v2']);
  /* 土曜は v2 が走らない設定なので、わく箱も作られない */
  assert.deepEqual(Object.keys(plan.days['6'].out.vans), ['v1']);
  assert.equal(plan.days['1'].out.vans.v1.rows.length, 4);   /* 座席3＋車椅子1 */
  assert.deepEqual(plan.days['1'].notes, []);
});

test('capacity / vansForDay', () => {
  const vans = makeVans();
  assert.equal(S.capacity(vans[0]), 4);
  assert.equal(S.capacity(vans[1]), 2);
  assert.deepEqual(S.vansForDay(vans, 1).map(v => v.id), ['v1', 'v2']);
  assert.deepEqual(S.vansForDay(vans, 6).map(v => v.id), ['v1']);
});

test('normalizeUser：プロトタイプの wc も読める。使わない方は既定でのぞく', () => {
  const users = S.normalizeUsers({ users: [
    { id: 'a', name: 'あ', area: 'X', wc: true, days: [1, 2] },
    { id: 'b', name: 'い', area: 'X', wheelchair: false, days: [1], active: false }
  ] });
  assert.equal(users.length, 1);
  assert.equal(users[0].wheelchair, true);
  const all = S.normalizeUsers({ users: [
    { id: 'b', name: 'い', area: 'X', days: [1], active: false }
  ] }, { includeInactive: true });
  assert.equal(all.length, 1);
});

test('normalizeNgPairs：配列の形（プロトタイプ）も読める', () => {
  const pairs = S.normalizeNgPairs([['u01', 'u03'], { a: 'u08', b: 'u11' }, ['x', 'x']]);
  assert.deepEqual(pairs.map(p => [p.a, p.b]), [['u01', 'u03'], ['u08', 'u11']]);
});

test('normalizeNotes：文字列と印刷プロトの chip 形式を1つの形にそろえる', () => {
  const notes = S.normalizeNotes([
    '丸本様 迎え無し',
    { chip: '谷口様 車椅子 引き渡し', kind: 'hand' },
    { chip: '健康クリーニング', kind: 'ext' },
    { kind: 'hand', text: '' }
  ]);
  assert.deepEqual(notes, [
    { kind: 'plain', text: '丸本様 迎え無し' },
    { chip: '谷口様 車椅子 引き渡し', kind: 'hand', text: '谷口様 車椅子 引き渡し' },
    { chip: '健康クリーニング', kind: 'ext', text: '健康クリーニング' }
  ]);
});

test('normalizePlan：uid など古い項目名を読み、足りないわくを作る', () => {
  const { facility, vans } = makeFixture();
  const raw = {
    days: {
      '1': {
        out: { vans: { v1: { memo: 'テスト', rows: [{ uid: 'u1', time: '08:20' }] } } },
        notes: ['メモ1']
      }
    }
  };
  const plan = S.normalizePlan(raw, { facilityId: 'test', weekStart: '2026-08-03', vans, days: facility.days });
  assert.equal(plan.days['1'].out.vans.v1.rows.length, 4);
  assert.equal(plan.days['1'].out.vans.v1.rows[0].userId, 'u1');
  assert.equal(plan.days['1'].out.vans.v1.rows[0].changed, false);
  assert.equal(plan.days['1'].out.vans.v1.memo, 'テスト');
  assert.equal(plan.days['1'].out.vans.v2.rows.length, 2);   /* 無かった車のわくを作る */
  assert.equal(plan.days['1'].ret.vans.v1.rows.length, 4);   /* 無かった送りも作る */
  assert.deepEqual(plan.days['1'].notes, [{ kind: 'plain', text: 'メモ1' }]);
  assert.ok(plan.days['2'].out.vans.v1);                     /* 無かった曜日も作る */
});

test('normalizePlan：車の定員がへったら前へ詰めて、あふれた人は乗っていない状態にもどる', () => {
  const smallVans = makeVans([
    { id: 'v1', name: 'ハイエース', seats: 2, wheelchairSeats: 0, driver: '山田', days: [1, 2, 3, 4, 5, 6] }
  ]);
  const raw = {
    days: {
      '1': {
        out: { vans: { v1: { rows: [
          { userId: null, time: '' },
          { userId: 'u1', time: '08:27' },
          { userId: 'u2', time: '08:34' },
          { userId: 'u3', time: '08:41' }
        ] } } }
      }
    }
  };
  const plan = S.normalizePlan(raw, { facilityId: 'test', weekStart: '2026-08-03', vans: smallVans, days: [1] });
  const rows = plan.days['1'].out.vans.v1.rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.userId), ['u1', 'u2']);   /* u3 はあふれる＝また割り当て直す */
});

test('normalizePlan：同じ人が2か所にいたら最初の1か所だけ残す', () => {
  const { facility, vans } = makeFixture();
  const raw = {
    days: {
      '1': {
        out: { vans: {
          v1: { rows: [{ userId: 'u1', time: '08:20' }] },
          v2: { rows: [{ userId: 'u1', time: '08:20' }] }
        } }
      }
    }
  };
  const plan = S.normalizePlan(raw, { facilityId: 'test', weekStart: '2026-08-03', vans, days: facility.days });
  assert.equal(plan.days['1'].out.vans.v1.rows[0].userId, 'u1');
  assert.equal(plan.days['1'].out.vans.v2.rows[0].userId, null);
});

test('normalizePlan：知らない車のデータは消さずに残す', () => {
  const { facility, vans } = makeFixture();
  const raw = { days: { '1': { out: { vans: { vX: { rows: [{ userId: 'u9' }] } } } } } };
  const plan = S.normalizePlan(raw, { facilityId: 'test', weekStart: '2026-08-03', vans, days: facility.days });
  assert.ok(plan.days['1'].out.vans.vX);
});

test('運転手の指定：null はマスタのまま、空文字は「未定」として残す', () => {
  const { facility, vans } = makeFixture();
  const raw = { days: { '1': { out: { vans: { v1: { driver: '', rows: [] }, v2: { rows: [] } } } } } };
  const plan = S.normalizePlan(raw, { facilityId: 'test', weekStart: '2026-08-03', vans, days: facility.days });
  assert.equal(plan.days['1'].out.vans.v1.driver, '');
  assert.equal(plan.days['1'].out.vans.v2.driver, null);
});

test('normalizeDrivers：色を決めていなければ順に色をふる', () => {
  const drivers = S.normalizeDrivers({ drivers: [{ name: '田中父' }, { name: '池田', color: 'blue' }, '未記入'] });
  assert.equal(drivers[0].initial, '田');
  assert.equal(drivers[0].color, 'green');
  assert.equal(drivers[1].color, 'blue');
  assert.equal(drivers[2].name, '未記入');
});
