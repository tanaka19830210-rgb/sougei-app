/* ============================================================
   テスト用の小さなダミーデータ
   ============================================================ */

import { normalizeFacility, normalizeUsers, normalizeVans, normalizeNgPairs, createEmptyPlan } from '../js/core/schema.js';
import { createContext } from '../js/core/assign.js';

export function makeFacility(extra = {}) {
  return normalizeFacility({
    id: 'test',
    name: 'テスト事業所',
    shortName: 'テスト',
    company: '株式会社障がい者ライフサポート',
    address: '広島市佐伯区',
    printTitle: 'テスト送迎表',
    days: [1, 2, 3, 4, 5, 6],
    startTimes: { out: '08:20', ret: '15:30' },
    stepMinutes: 7,
    areas: { 'あエリア': '#111111', 'いエリア': '#222222' },
    ...extra
  });
}

export function makeUsers() {
  return normalizeUsers({
    users: [
      { id: 'u1', name: '一郎', area: 'あエリア', wheelchair: false, days: [1, 2, 3, 4, 5, 6] },
      { id: 'u2', name: '二郎', area: 'あエリア', wheelchair: false, days: [1, 2, 3, 4, 5, 6] },
      { id: 'u3', name: '三郎', area: 'いエリア', wheelchair: false, days: [1, 2, 3, 4, 5, 6] },
      { id: 'u4', name: '四郎', area: 'あエリア', wheelchair: true, days: [1, 2, 3, 4, 5, 6] },
      { id: 'u5', name: '五郎', area: 'いエリア', wheelchair: true, days: [1, 2, 3, 4, 5, 6] },
      { id: 'u6', name: '六郎', area: 'あエリア', wheelchair: false, days: [1, 2, 3, 4, 5, 6], noReturn: true },
      { id: 'u7', name: '七郎', area: 'いエリア', wheelchair: false, days: [6] }
    ]
  });
}

export function makeVans(extra) {
  return normalizeVans({
    vans: extra || [
      { id: 'v1', name: 'ハイエース', seats: 3, wheelchairSeats: 1, driver: '山田', days: [1, 2, 3, 4, 5, 6] },
      { id: 'v2', name: 'タント', seats: 1, wheelchairSeats: 1, driver: '佐々木', days: [1, 2, 3, 4, 5] }
    ]
  });
}

export function makeNgPairs() {
  return normalizeNgPairs({ pairs: [{ a: 'u1', b: 'u2', reason: 'テスト' }] });
}

export function makeFixture(options = {}) {
  const facility = makeFacility(options.facility);
  const users = options.users || makeUsers();
  const vans = makeVans(options.vans);
  const ngPairs = options.ngPairs || makeNgPairs();
  const ctx = createContext({ facility, users, vans, ngPairs });
  const plan = createEmptyPlan({
    facilityId: facility.id,
    weekStart: '2026-08-03',
    vans,
    days: facility.days
  });
  return { facility, users, vans, ngPairs, ctx, plan };
}
