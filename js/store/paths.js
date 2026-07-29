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

/* ------------------------------------------------------------
   配信依頼の置き場所

   ここにファイルが増えたことを合図に、データ用リポジトリの
   GitHub Actions（.github/workflows/publish.yml）が動きます。
   処理が終わったものは done/ に移すので、同じ依頼が何度も動きません。
   ------------------------------------------------------------ */
export const PUBLISH_ROOT = 'publish-requests';

export function publishRequestPath(facilityId, weekStartKey) {
  return `${PUBLISH_ROOT}/${facilityId}-${weekStartKey}.json`;
}

export function publishDonePath(facilityId, weekStartKey, stamp) {
  return `${PUBLISH_ROOT}/done/${facilityId}-${weekStartKey}-${stamp}.json`;
}

/* マスタの種類 → ファイルの場所と、JSON の中の配列名 */
export const MASTER_KINDS = {
  users: { path: usersPath, listKey: 'users', label: '利用者マスタ' },
  vans: { path: vansPath, listKey: 'vans', label: '車両マスタ' },
  ngPairs: { path: ngPairsPath, listKey: 'pairs', label: '同乗NGペア' },
  drivers: { path: driversPath, listKey: 'drivers', label: '運転手マスタ' }
};
