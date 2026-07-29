/* ============================================================
   localStore：ブラウザの中だけに保存する「お試しモード」

   GitHub のトークンを入れていないときに使う。
   - はじめは アプリに同梱した data/*.json（ダミー）を読む
   - 保存すると localStorage に入る（その端末のブラウザの中だけ）
   - sha による競合チェックも GitHub と同じように動かして、
     画面側のコードを1本にできるようにしている
   ============================================================ */

import { ConflictError, StoreError } from './errors.js';

const KEY_PREFIX = 'soutai:file:';
const SEED_SHA = 'seed';

export function createLocalStore(options = {}) {
  const storage = options.storage;
  const fetchImpl = options.fetchImpl;
  const basePath = options.basePath || '';
  const prefix = options.keyPrefix || KEY_PREFIX;

  function entryOf(path) {
    if (!storage) return null;
    const raw = storage.getItem(prefix + path);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  async function fetchSeed(path) {
    if (!fetchImpl) return null;
    let res;
    try {
      res = await fetchImpl(basePath + path, { cache: 'no-store' });
    } catch (e) {
      return null;                      /* 同梱ファイルが無いだけ。空あつかいにする */
    }
    if (!res || !res.ok) return null;
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new StoreError(`${path} の中身が JSON として読めませんでした`, String(e));
    }
  }

  return {
    mode: 'local',
    label: 'お試しモード（保存されません）',

    async readJson(path) {
      const entry = entryOf(path);
      if (entry) {
        return { data: JSON.parse(entry.text), sha: entry.sha, path };
      }
      const seed = await fetchSeed(path);
      if (seed === null) return null;
      return { data: seed, sha: SEED_SHA, path };
    },

    async writeJson(path, data, { sha } = {}) {
      const entry = entryOf(path);
      if (entry && sha !== entry.sha) {
        throw new ConflictError(`localStorage: ${path}`);
      }
      const next = {
        sha: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        text: JSON.stringify(data, null, 2)
      };
      if (!storage) throw new StoreError('この端末では保存できません（localStorage が使えません）');
      storage.setItem(prefix + path, JSON.stringify(next));
      return { sha: next.sha, path };
    },

    /* お試しモードで入れたものを消す（設定画面から使う） */
    clear() {
      if (!storage) return 0;
      const keys = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      keys.forEach(k => storage.removeItem(k));
      return keys.length;
    }
  };
}
