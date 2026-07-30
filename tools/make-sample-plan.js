/* ============================================================
   見本の週次プランを作るための小道具（ふだんは使いません）

     node tools/make-sample-plan.js 八幡 2026-08-03

   同梱のダミーマスタから「いつもの車」ルールで自動割り当てを回して、
   data/{事業所}/plans/{週}.json を作ります。
   印刷画面の見本を作りたいときだけ使ってください。
   ============================================================ */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../js/core/schema.js';
import * as A from '../js/core/assign.js';
import { weekKeyOf, parseDateKey } from '../js/core/dates.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const facilityId = process.argv[2] || 'yahata';
const asked = parseDateKey(process.argv[3] || '');
const weekStart = asked ? weekKeyOf(asked) : weekKeyOf(new Date());

const readJson = p => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const facility = S.normalizeFacilities(readJson('data/facilities.json')).find(f => f.id === facilityId);
if (!facility) throw new Error('事業所が見つかりません: ' + facilityId);

const users = S.normalizeUsers(readJson(`data/${facilityId}/users.json`));
const vans = S.normalizeVans(readJson(`data/${facilityId}/vans.json`));
const ngPairs = S.normalizeNgPairs(readJson(`data/${facilityId}/ng-pairs.json`));
const ctx = A.createContext({ facility, users, vans, ngPairs });

const plan = S.createEmptyPlan({ facilityId, weekStart, vans, days: facility.days });

/* 空の週に、いつもの車ルールで空席を埋める（迎え・送りとも） */
A.autoAssignWeek(ctx, { plan, days: facility.days });
facility.days.forEach(day => {
  const left = A.unassignedUsers(ctx, plan.days[String(day)].out, day, 'out');
  if (left.length) {
    console.log(`${day}曜の迎え：${left.map(u => u.name).join('・')} がまだ乗っていません`);
  }
});

/* 紙面の見本として、メモと当日変更をすこし入れておく */
const day1 = plan.days['1'];
day1.notes = S.normalizeNotes([
  { kind: 'hand', text: '岡田様 車椅子 引き渡し' },
  { kind: 'ext', text: '健康クリーニング' }
]);
plan.days['2'].notes = S.normalizeNotes(['高木様 迎え無し', '新見様 13:00 迎え']);
plan.days['3'].notes = S.normalizeNotes([{ kind: 'ext', text: '沖本様 送り無し（行動援護）' }]);
if (day1.out.vans.v1) {
  day1.out.vans.v1.memo = '雨の日は玄関前まで';
  const first = day1.out.vans.v1.rows.find(r => r.userId);
  if (first) first.changed = true;
}
if (day1.ret.vans.v3) day1.ret.vans.v3.driver = '';   /* 運転手が未定の見本 */

plan.updatedAt = new Date().toISOString();
plan.updatedBy = '見本';

const dir = join(ROOT, 'data', facilityId, 'plans');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const file = join(dir, `${weekStart}.json`);
writeFileSync(file, JSON.stringify(plan, null, 2) + '\n', 'utf8');
console.log('作りました: ' + file);
