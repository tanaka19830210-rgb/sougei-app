/* ============================================================
   設定（この端末のブラウザだけに保存する）

   GitHub のトークンは、この端末の localStorage に入る。
   共用のタブレットには入れないこと（設定画面にも注意書きを出している）。
   ============================================================ */

const KEY = 'soutai:config';

export const DEFAULT_CONFIG = {
  token: '',
  owner: '',
  repo: '',
  branch: 'main',
  facilityId: '',
  editorName: ''
};

function storageOf(storage) {
  if (storage) return storage;
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

export function loadConfig(storage) {
  const s = storageOf(storage);
  if (!s) return { ...DEFAULT_CONFIG };
  try {
    const raw = s.getItem(KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const saved = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

/*
  設定をこの端末に覚えさせる。覚えられたかを saved で返す。

  iPad はプライベートブラウズや「Cookie をブロック」の設定だと、
  書きこみで例外を投げる。そのまま抜けると、設定画面が
  なにも言わずに固まって見える（保存も再読み込みもされない）。
*/
export function saveConfig(config, storage) {
  const s = storageOf(storage);
  const next = { ...DEFAULT_CONFIG, ...(config || {}) };
  if (s) {
    try {
      s.setItem(KEY, JSON.stringify(next));
    } catch (e) {
      throw new Error(
        'この端末に設定を覚えさせられませんでした。' +
        'Safari の「プライベートブラウズ」を使っているか、' +
        '設定で Cookie とサイトデータをブロックしていないか確認してください。'
      );
    }
  }
  return next;
}

export function clearToken(storage) {
  const config = loadConfig(storage);
  config.token = '';
  return saveConfig(config, storage);
}

/* GitHub に読み書きできる設定がそろっているか */
export function isGithubReady(config) {
  return !!(config && config.token && config.owner && config.repo);
}
