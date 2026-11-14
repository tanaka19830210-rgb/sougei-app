/* ============================================================
   お試しモード用の、架空の週の表を作る

     node tools/make-sample-weeks.js

   3つの事業所それぞれに、架空のお名前だけで3週ぶん・車6台の表を作ります。
   （このリポジトリは公開なので、本物のお名前は入れません）
   ============================================================ */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const names = JSON.parse(readFileSync(join(ROOT, 'tools/dummy-names.json'), 'utf8')).names;
const family = [...new Set(names.filter(n => n.includes(' ')).map(n => n.split(/\s+/)[0]))];
const drivers = ['山田', '佐々木', '木下', '高橋', '藤井', '村上', '岡'];
const riders = family.filter(n => !drivers.includes(n)).slice(0, 26);
/* 各事業所、車は最大6台。SEATS は車ごとの最大の乗車人数 */
const SEATS = [7, 5, 4, 3, 3, 2];
const vans = ['ハイエース', 'キャラバン', 'セレナ', 'ステップワゴン', 'フリード', 'タント'].map((name, i) => ({ id: 'v' + (i + 1), name, seats: SEATS[i] }));
const places = ['', '', 'ホームA', 'ホームB'];
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

function makeWeek(facilityId, weekStart, skip, shift) {
  const days = {};
  for (let d = 1; d <= 6; d++) {
    const trips = Object.fromEntries(vans.map(v => [v.id, { out: { driver: '', rows: [] }, ret: { driver: '', rows: [] } }]));
    riders.forEach((name, i) => {
      if ((i + d + shift) % 4 === 0 || (skip && i === skip && d <= 3)) return;       /* 来ない曜日・その週だけのお休み */
      const place = places[(i + shift) % 4];
      ['out', 'ret'].forEach((leg, li) => {
        /* 席の少ない車からあふれないよう、空いている車へ順に乗せる */
        let vi = (i + shift + li * (d % 2)) % vans.length;
        while (trips[vans[vi].id][leg].rows.length >= SEATS[vi]) vi = (vi + 1) % vans.length;
        const rows = trips[vans[vi].id][leg].rows;
        rows.push({ name, place, time: hhmm((li ? 15 * 60 + 30 : 8 * 60 + 30) + rows.length * 10) });
      });
    });
    vans.forEach((v, i) => ['out', 'ret'].forEach((leg, li) => {
      if (trips[v.id][leg].rows.length) trips[v.id][leg].driver = drivers[(i + d + li + shift) % drivers.length];
    }));
    days[d] = { notes: skip && d <= 3 ? [`${riders[skip]}様休み`] : [], trips };
  }
  return { schemaVersion: 2, facilityId, weekStart, vans, days, log: [] };
}

['funny', 'hitoiki', 'fit'].forEach((facilityId, shift) => {
  const dir = join(ROOT, 'data', facilityId, 'weeks');
  mkdirSync(dir, { recursive: true });
  [['2026-10-26', 0], ['2026-11-02', 0], ['2026-11-09', 5]].forEach(([key, skip]) => {
    writeFileSync(join(dir, key + '.json'), JSON.stringify(makeWeek(facilityId, key, skip, shift), null, 1) + '\n', 'utf8');
    console.log(`作りました: data/${facilityId}/weeks/${key}.json`);
  });
});
