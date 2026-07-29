/* 同梱データ（data/）が読めて、つじつまが合っているかのテスト */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as S from '../js/core/schema.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

const facilities = S.normalizeFacilities(readJson('data/facilities.json'));

test('facilities.json：事業所が読めて、id が重なっていない', () => {
  assert.ok(facilities.length >= 1);
  const ids = facilities.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length);
  facilities.forEach(f => {
    assert.ok(f.name, 'name がある');
    assert.ok(f.days.length, '使う曜日がある');
    assert.match(f.startTimes.out, /^\d{2}:\d{2}$/);
    assert.match(f.startTimes.ret, /^\d{2}:\d{2}$/);
    assert.ok(f.stepMinutes > 0);
  });
});

test('マスタ：利用者・車両・NGペア・運転手のつじつまが合っている', () => {
  facilities.forEach(facility => {
    const base = `data/${facility.id}`;
    if (!existsSync(join(root, base, 'users.json'))) return;   /* まだ作っていない事業所は飛ばす */

    const users = S.normalizeUsers(readJson(`${base}/users.json`), { includeInactive: true });
    const vans = S.normalizeVans(readJson(`${base}/vans.json`), { includeInactive: true });
    const pairs = S.normalizeNgPairs(readJson(`${base}/ng-pairs.json`));
    const drivers = S.normalizeDrivers(readJson(`${base}/drivers.json`));
    const label = facility.name;

    const userIds = users.map(u => u.id);
    assert.equal(new Set(userIds).size, userIds.length, `${label}：利用者の id が重なっていない`);
    users.forEach(u => {
      assert.ok(u.name, `${label}：お名前がある`);
      assert.ok(u.days.length, `${label}：${u.name} の利用曜日がある`);
      assert.ok(facility.areas[u.area], `${label}：${u.name} のエリア「${u.area}」が facilities.json の色に載っている`);
    });

    const vanIds = vans.map(v => v.id);
    assert.equal(new Set(vanIds).size, vanIds.length, `${label}：車の id が重なっていない`);
    vans.forEach(v => {
      assert.ok(v.name, `${label}：車の名前がある`);
      assert.ok(S.capacity(v) > 0, `${label}：${v.name} の定員が1以上`);
      assert.ok(v.days.length, `${label}：${v.name} の走る曜日がある`);
    });

    pairs.forEach(p => {
      assert.ok(userIds.includes(p.a), `${label}：NGペアの ${p.a} が利用者にいる`);
      assert.ok(userIds.includes(p.b), `${label}：NGペアの ${p.b} が利用者にいる`);
    });

    const driverNames = drivers.map(d => d.name);
    vans.forEach(v => {
      if (!v.driver) return;
      assert.ok(driverNames.includes(v.driver),
        `${label}：${v.name} の運転手「${v.driver}」が drivers.json に載っている（紙のバッジの色に使う）`);
    });
  });
});

test('マスタ：その曜日の定員が、来る人数に足りている（同梱のダミーで確かめる）', () => {
  const facility = facilities.find(f => f.id === 'yahata');
  const users = S.normalizeUsers(readJson('data/yahata/users.json'));
  const vans = S.normalizeVans(readJson('data/yahata/vans.json'));
  facility.days.forEach(day => {
    const coming = users.filter(u => u.days.includes(day));
    const seats = S.vansForDay(vans, day).reduce((sum, v) => sum + S.capacity(v), 0);
    const wcComing = coming.filter(u => u.wheelchair).length;
    const wcSeats = S.vansForDay(vans, day).reduce((sum, v) => sum + v.wheelchairSeats, 0);
    assert.ok(seats >= coming.length, `${day}曜：座席 ${seats} ≧ 来る人 ${coming.length}`);
    assert.ok(wcSeats >= wcComing, `${day}曜：車椅子わく ${wcSeats} ≧ 車椅子の方 ${wcComing}`);
  });
});
