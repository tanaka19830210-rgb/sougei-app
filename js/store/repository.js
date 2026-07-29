/* ============================================================
   リポジトリ層：ファイルの読み書きと、データの整えなおしをまとめる

   画面はここだけを呼ぶ。GitHub か お試しモードかは気にしない。
   コミットメッセージ（GitHub の履歴に残る文）も、ここで日本語にする。
   ============================================================ */

import * as paths from './paths.js';
import * as schema from '../core/schema.js';

export function createRepository(store) {
  /* 読んだときの sha をおぼえておく。保存のときに「上書き事故」を防ぐために使う */
  const shas = new Map();

  async function read(path) {
    const result = await store.readJson(path);
    if (result) shas.set(path, result.sha);
    return result;
  }

  async function write(path, data, message) {
    const result = await store.writeJson(path, data, { sha: shas.get(path), message });
    shas.set(path, result.sha);
    return result;
  }

  function shortName(facility) {
    return (facility && (facility.shortName || facility.name)) || '';
  }

  return {
    mode: store.mode,
    label: store.label,
    store,

    shaOf(path) { return shas.get(path); },
    forgetSha(path) { shas.delete(path); },

    /* ---------- 事業所一覧 ---------- */
    async loadFacilities() {
      const result = await read(paths.facilitiesPath());
      return schema.normalizeFacilities(result ? result.data : null);
    },

    /* ---------- マスタ（利用者・車両・NGペア・運転手） ---------- */
    async loadMasters(facilityId, { includeInactive = false } = {}) {
      const [usersFile, vansFile, ngFile, driverFile] = await Promise.all([
        read(paths.usersPath(facilityId)),
        read(paths.vansPath(facilityId)),
        read(paths.ngPairsPath(facilityId)),
        read(paths.driversPath(facilityId))
      ]);
      return {
        users: schema.normalizeUsers(usersFile ? usersFile.data : null, { includeInactive }),
        vans: schema.normalizeVans(vansFile ? vansFile.data : null, { includeInactive }),
        ngPairs: schema.normalizeNgPairs(ngFile ? ngFile.data : null),
        drivers: schema.normalizeDrivers(driverFile ? driverFile.data : null),
        missing: {
          users: !usersFile,
          vans: !vansFile,
          ngPairs: !ngFile,
          drivers: !driverFile
        }
      };
    },

    /*
      マスタを1種類だけ保存する。
      list は画面で編集した配列（利用者なら利用者の配列）。
    */
    async saveMaster({ kind, facility, list }) {
      const spec = paths.MASTER_KINDS[kind];
      if (!spec) throw new Error('知らないマスタです: ' + kind);
      const path = spec.path(facility.id);
      const data = {
        schemaVersion: schema.SCHEMA_VERSION,
        facilityId: facility.id,
        updatedAt: new Date().toISOString(),
        [spec.listKey]: list
      };
      const message = `${spec.label} ${shortName(facility)} を更新`;
      return write(path, data, message);
    },

    /* ---------- 週次プラン ---------- */
    async loadPlan({ facility, vans, weekStart }) {
      const path = paths.planPath(facility.id, weekStart);
      const result = await read(path);
      const plan = schema.normalizePlan(result ? result.data : null, {
        facilityId: facility.id,
        weekStart,
        vans,
        days: facility.days
      });
      return { plan, path, exists: !!result, sha: result ? result.sha : null };
    },

    async savePlan({ facility, weekStart, plan, editorName }) {
      const path = paths.planPath(facility.id, weekStart);
      const data = {
        ...plan,
        schemaVersion: schema.SCHEMA_VERSION,
        facilityId: facility.id,
        weekStart,
        updatedAt: new Date().toISOString(),
        updatedBy: editorName || ''
      };
      const message = `送迎表 ${shortName(facility)} ${weekStart}週 を更新`;
      const result = await write(path, data, message);
      return { ...result, plan: data };
    }
  };
}
