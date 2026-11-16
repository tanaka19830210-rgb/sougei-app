/* ============================================================
   「番人」（Google ログインで事業所を分けるしくみ）のつなぎ先

   url            … 番人（Google Apps Script の Web アプリ）の /exec の URL
   googleClientId … Google ログインのクライアント ID
   どちらも秘密ではありません（鍵は番人の中にだけあります）。
   url が空のあいだは、これまでどおり「設定に鍵を入れる」か「お試しモード」で動きます。
   ============================================================ */

export const GATE = {
  url: '',
  googleClientId: ''
};

const KEY = 'soutai:gate';

function storageOf(storage) {
  if (storage) return storage;
  try { return window.localStorage; } catch (e) { return null; }
}

/* ログインのしるしを読む。期限が切れていたら null */
export function loadGateSession(storage, now = Date.now()) {
  const s = storageOf(storage);
  if (!s) return null;
  try {
    const saved = JSON.parse(s.getItem(KEY) || 'null');
    if (!saved || !saved.session || !(Number(saved.exp) > now)) return null;
    return saved;
  } catch (e) {
    return null;
  }
}

export function saveGateSession(session, storage) {
  const s = storageOf(storage);
  if (s) s.setItem(KEY, JSON.stringify(session));
}

export function clearGateSession(storage) {
  const s = storageOf(storage);
  if (s) { try { s.removeItem(KEY); } catch (e) { /* 消せなくても困らない */ } }
}
