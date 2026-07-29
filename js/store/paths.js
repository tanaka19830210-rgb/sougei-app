/* ============================================================
   データファイルの置き場所

   アプリ用リポジトリの data/ をまるごとコピーすれば
   データ用リポジトリになる、という形にそろえてある。
   ============================================================ */

export const DATA_ROOT = 'data';

export function facilitiesPath() {
  return `${DATA_ROOT}/facilities.json`;
}

export function usersPath(facilityId) {
  return `${DATA_ROOT}/${facilityId}/users.json`;
}

export function vansPath(facilityId) {
  return `${DATA_ROOT}/${facilityId}/vans.json`;
}

export function ngPairsPath(facilityId) {
  return `${DATA_ROOT}/${facilityId}/ng-pairs.json`;
}

export function driversPath(facilityId) {
  return `${DATA_ROOT}/${facilityId}/drivers.json`;
}

export function planPath(facilityId, weekStartKey) {
  return `${DATA_ROOT}/${facilityId}/plans/${weekStartKey}.json`;
}

/* マスタの種類 → ファイルの場所と、JSON の中の配列名 */
export const MASTER_KINDS = {
  users: { path: usersPath, listKey: 'users', label: '利用者マスタ' },
  vans: { path: vansPath, listKey: 'vans', label: '車両マスタ' },
  ngPairs: { path: ngPairsPath, listKey: 'pairs', label: '同乗NGペア' },
  drivers: { path: driversPath, listKey: 'drivers', label: '運転手マスタ' }
};
