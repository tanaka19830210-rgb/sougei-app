/* ============================================================
   お試しモード用の、架空の週の表を作る

     node tools/make-sample-weeks.js

   data/funny/weeks/ に、架空のお名前だけで3週ぶん作ります。
   （このリポジトリは公開なので、本物のお名前は入れません）
   ============================================================ */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const names = JSON.parse(readFileSync(join(ROOT, 'tools/dummy-names.json'), 'utf8')).names;
const people = [...new Set(names.map(n => n.split(/\s+/)[0]))].slice(0, 16);
const drivers = people.slice(-4);
const riders = people.slice(0, 12);
const vans = [{ id: 'v1', name: 'ハイエース' }, { id: 'v2', name: 'セレナ' }, { id: 'v3', name: 'フリード' }];
const places = ['', '', 'ホームA', 'ホームB'];
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

function makeWeek(weekStart, skip) {
  const days = {};
  for (let d = 1; d <= 6; d++) {
    const trips = Object.fromEntries(vans.map(v => [v.id, { out: { driver: '', rows: [] }, ret: { driver: '', rows: [] } }]));
    riders.forEach((name, i) => {
      if ((i + d) % 4 === 0 || (skip && i === skip && d <= 3)) return;       /* 来ない曜日・その週だけのお休み */
      const van = vans[i % 3];
      const place = places[i % 4];
      trips[van.id].out.rows.push({ name, place, time: hhmm(8 * 60 + 30 + trips[van.id].out.rows.length * 10) });
      trips[van.id].ret.rows.push({ name, place, time: hhmm(15 * 60 + 30 + trips[van.id].ret.rows.length * 10) });
    });
    vans.forEach((v, i) => { trips[v.id].out.driver = drivers[(i + d) % 4]; trips[v.id].ret.driver = drivers[(i + d + 1) % 4]; });
    days[d] = { notes: skip && d <= 3 ? [`${riders[skip]}様休み`] : [], trips };
  }
  return { schemaVersion: 2, facilityId: 'funny', weekStart, vans, days, log: [] };
}

const dir = join(ROOT, 'data/funny/weeks');
mkdirSync(dir, { recursive: true });
[['2026-10-26', 0], ['2026-11-02', 0], ['2026-11-09', 5]].forEach(([key, skip]) => {
  writeFileSync(join(dir, key + '.json'), JSON.stringify(makeWeek(key, skip), null, 1) + '\n', 'utf8');
  console.log('作りました: data/funny/weeks/' + key + '.json');
});
