/* 週キー・日付の計算のテスト */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mondayOf, addDays, dateKey, parseDateKey, weekKeyOf, dateOfDay,
  shiftWeekKey, weekShortLabel, weekLongLabel, fullDateLabel, dayLabel, clockLabel
} from '../js/core/dates.js';

test('mondayOf：月曜はその日、火〜土はその週の月曜', () => {
  assert.equal(dateKey(mondayOf(new Date(2026, 7, 3))), '2026-08-03'); /* 月 */
  assert.equal(dateKey(mondayOf(new Date(2026, 7, 4))), '2026-08-03'); /* 火 */
  assert.equal(dateKey(mondayOf(new Date(2026, 7, 8))), '2026-08-03'); /* 土 */
});

test('mondayOf：日曜日は前の週の月曜（送迎は月〜土なので前週あつかい）', () => {
  assert.equal(dateKey(mondayOf(new Date(2026, 7, 9))), '2026-08-03'); /* 日 */
  assert.equal(dateKey(mondayOf(new Date(2026, 7, 2))), '2026-07-27'); /* 日 */
});

test('mondayOf：月をまたぐ週', () => {
  assert.equal(weekKeyOf(new Date(2026, 8, 2)), '2026-08-31');   /* 9/2 水 → 8/31 月 */
  assert.equal(weekKeyOf(new Date(2027, 0, 1)), '2026-12-28');   /* 年をまたぐ */
});

test('parseDateKey：おかしな文字は null', () => {
  assert.equal(parseDateKey('2026-08-03').getDate(), 3);
  assert.equal(parseDateKey('2026-2-3'), null);
  assert.equal(parseDateKey('2026-13-01'), null);
  assert.equal(parseDateKey(''), null);
  assert.equal(parseDateKey('わからない'), null);
});

test('shiftWeekKey：前後の週へ7日ずつ動く', () => {
  assert.equal(shiftWeekKey('2026-08-03', 1), '2026-08-10');
  assert.equal(shiftWeekKey('2026-08-03', -1), '2026-07-27');
  assert.equal(shiftWeekKey('2026-12-28', 1), '2027-01-04');
});

test('dateOfDay：曜日番号（1=月）から日付', () => {
  assert.equal(dateKey(dateOfDay('2026-08-03', 1)), '2026-08-03');
  assert.equal(dateKey(dateOfDay('2026-08-03', 6)), '2026-08-08');
  assert.equal(dateKey(addDays(parseDateKey('2026-08-03'), 5)), '2026-08-08');
});

test('ラベル：画面用と紙用', () => {
  assert.equal(weekShortLabel('2026-08-03'), '8/3 〜 8/8');
  assert.equal(weekLongLabel('2026-08-03'), '2026年8月3日（月）〜 8日（土）');
  assert.equal(weekLongLabel('2026-08-31'), '2026年8月31日（月）〜 9月5日（土）');
  assert.equal(fullDateLabel('2026-08-03', 3), '2026年8月5日（水）');
  assert.equal(dayLabel(6), '土');
});

test('clockLabel：2けたの時刻', () => {
  assert.equal(clockLabel(new Date(2026, 7, 3, 9, 5)), '09:05');
});
