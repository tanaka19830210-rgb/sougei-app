/* ============================================================
   gateStore：「番人」（Google Apps Script）を通して読み書きする

   端末には GitHub の鍵を置かない。Google ログインでもらった
   「ログインのしるし」を番人に見せて、番人に読み書きしてもらう。
   番人は1回よぶのに時間がかかるので、同じときに頼まれた読みこみは
   1回の通信にまとめる。
   ============================================================ */

import { ConflictError, AuthError, NetworkError, StoreError } from './errors.js';

const BATCH_WAIT_MS = 20;
const BATCH_MAX = 40;

/* 番人に1回たのむ。プリフライト（事前の問い合わせ）を出さないよう、text/plain で送る */
export async function callGate(url, body, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });
  } catch (e) {
    throw new NetworkError(String(e));
  }
  let json;
  try {
    json = JSON.parse(await res.text());
  } catch (e) {
    throw new StoreError('番人から、読めない返事が来ました', String(e));
  }
  if (json && json.ok) return json;
  const message = (json && json.message) || '番人でエラーが起きました';
  if (json && json.error === 'conflict') throw new ConflictError(message);
  if (json && (json.error === 'auth' || json.error === 'forbidden')) {
    const err = new AuthError(message);
    err.message = message;
    err.code = json.error;
    throw err;
  }
  throw new StoreError(message);
}

export function createGateStore(options = {}) {
  const url = options.url;
  const session = options.session;
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!url) throw new StoreError('番人のつなぎ先が設定されていません');
  if (!session) throw new StoreError('ログインしていません');
  if (!fetchImpl) throw new StoreError('この環境では通信できません');

  let waiting = [];          /* まとめて読むのを待っている頼みごと */
  let timer = null;

  async function flush() {
    const batch = waiting.splice(0, BATCH_MAX);
    timer = waiting.length ? setTimeout(flush, 0) : null;
    try {
      const out = await callGate(url, { action: 'read', session, paths: batch.map(b => b.path) }, fetchImpl);
      batch.forEach((b, i) => {
        const f = out.files[i];
        if (!f) { b.resolve(null); return; }
        try {
          b.resolve({ data: JSON.parse(f.text), sha: f.sha, path: b.path });
        } catch (e) {
          b.reject(new StoreError(`${b.path} の中身が JSON として読めませんでした`, String(e)));
        }
      });
    } catch (e) {
      batch.forEach(b => b.reject(e));
    }
  }

  return {
    mode: 'gate',
    label: 'Google ログインで保存',

    readJson(path) {
      return new Promise((resolve, reject) => {
        waiting.push({ path, resolve, reject });
        if (!timer) timer = setTimeout(flush, BATCH_WAIT_MS);
      });
    },

    async writeJson(path, data, { sha, message } = {}) {
      const out = await callGate(url, {
        action: 'write', session, path, sha: sha || '',
        message: message || `${path} を更新`,
        text: JSON.stringify(data, null, 2) + '\n'
      }, fetchImpl);
      return { sha: out.sha, path };
    }
  };
}
