/* ============================================================
   どの画面でも最初にやること
   設定を読む → 保存先（GitHub / お試し）を決める → 事業所とマスタを読む
   ============================================================ */

import { loadConfig, saveConfig } from '../config.js';
import { createStore } from '../store/index.js';
import { createRepository } from '../store/repository.js';
import { createContext } from '../core/assign.js';

export async function bootstrap() {
  const config = loadConfig();
  const store = createStore(config);
  const repo = createRepository(store);
  const facilities = await repo.loadFacilities();
  const facility = pickFacility(facilities, config.facilityId);
  return { config, store, repo, facilities, facility };
}

export function pickFacility(facilities, facilityId) {
  if (!facilities || !facilities.length) return null;
  return facilities.find(f => f.id === facilityId) || facilities[0];
}

/* マスタを読んで、割り当て計算用の材料（context）まで作る */
export async function loadFacilityContext(repo, facility) {
  const masters = await repo.loadMasters(facility.id);
  const ctx = createContext({
    facility,
    users: masters.users,
    vans: masters.vans,
    ngPairs: masters.ngPairs
  });
  return { ...masters, ctx };
}

/* 事業所のえらびリストを作る。えらんだら設定に覚えて画面を読み直す */
export function fillFacilitySelect(select, facilities, currentId, onChange) {
  if (!select) return;
  select.innerHTML = '';
  facilities.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    if (f.id === currentId) opt.selected = true;
    select.appendChild(opt);
  });
  select.onchange = () => {
    const config = loadConfig();
    config.facilityId = select.value;
    /* 覚えられなくても（プライベートブラウズなど）、画面の切りかえは進める */
    try { saveConfig(config); } catch (e) { /* 次に開いたとき既定の事業所に戻るだけ */ }
    if (onChange) onChange(select.value);
  };
}

/* URL の ?facility=funny&week=2026-08-03 を読む */
export function readParams() {
  const params = new URLSearchParams(location.search);
  return {
    facilityId: params.get('facility') || '',
    weekStart: params.get('week') || ''
  };
}
