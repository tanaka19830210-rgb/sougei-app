/* ============================================================
   保存先の切りかえ

   設定にトークンとリポジトリ名がそろっていれば GitHub、
   Google ログインずみなら「番人」経由、
   どちらでもなければ「お試しモード」（ブラウザの中だけ）に自動で切りかわる。
   画面側は store.readJson / store.writeJson だけを使う。
   ============================================================ */

import { isGithubReady } from '../config.js';
import { createGithubStore } from './githubStore.js';
import { createLocalStore } from './localStore.js';
import { createGateStore } from './gateStore.js';

export { createGithubStore, createLocalStore, createGateStore };

export function createStore(config, options = {}) {
  const storage = options.storage !== undefined ? options.storage : safeLocalStorage();
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);

  if (isGithubReady(config)) {
    try {
      return createGithubStore({
        owner: config.owner,
        repo: config.repo,
        branch: config.branch || 'main',
        token: config.token,
        fetchImpl
      });
    } catch (e) {
      /* 設定が中途半端なときは、こわさずお試しモードへ落とす */
      console.warn('GitHub の設定を読めませんでした。お試しモードで開きます', e);
    }
  }
  if (options.gate && options.gate.url && options.gate.session) {
    return createGateStore({ url: options.gate.url, session: options.gate.session, fetchImpl });
  }
  return createLocalStore({ storage, fetchImpl, basePath: options.basePath || '' });
}

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
}
