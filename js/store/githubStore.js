/* ============================================================
   githubStore：データ用リポジトリに直接よみ書きする（本番）

   GitHub REST API の Contents API を使う。
   保存のときは、読んだときの sha をいっしょに送る（＝楽観ロック）。
   だれかが先に保存していれば GitHub が 409/422 を返すので、
   「他の人が先に保存しました」と伝えて上書きを防ぐ。
   ============================================================ */

import { encodeBase64Utf8, decodeBase64Utf8 } from './base64.js';
import { ConflictError, AuthError, NetworkError, StoreError } from './errors.js';

const API_BASE = 'https://api.github.com';

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

export function createGithubStore(options = {}) {
  const owner = options.owner;
  const repo = options.repo;
  const branch = options.branch || 'main';
  const token = options.token;
  const apiBase = options.apiBase || API_BASE;
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const committer = options.committer || null;

  if (!owner || !repo) throw new StoreError('データ用リポジトリ（owner/repo）が設定されていません');
  if (!token) throw new StoreError('GitHub のトークンが設定されていません');
  if (!fetchImpl) throw new StoreError('この環境では通信できません');

  function headers() {
    return {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  async function request(url, init) {
    try {
      return await fetchImpl(url, init);
    } catch (e) {
      throw new NetworkError(String(e));
    }
  }

  async function bodyText(res) {
    try {
      return await res.text();
    } catch (e) {
      return '';
    }
  }

  return {
    mode: 'github',
    label: `GitHub に保存（${owner}/${repo} / ${branch}）`,
    owner, repo, branch,

    async readJson(path) {
      const url = `${apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;
      const res = await request(url, { method: 'GET', headers: headers(), cache: 'no-store' });
      if (res.status === 404) return null;                 /* まだ作られていないファイル */
      if (res.status === 401 || res.status === 403) throw new AuthError(await bodyText(res));
      if (!res.ok) throw new StoreError(`${path} を読めませんでした（${res.status}）`, await bodyText(res));

      const json = await res.json();
      if (json.encoding && json.encoding !== 'base64') {
        throw new StoreError(`${path} の形式が想定と違います（${json.encoding}）`);
      }
      const text = decodeBase64Utf8(json.content || '');
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new StoreError(`${path} の中身が JSON として読めませんでした`, String(e));
      }
      return { data, sha: json.sha, path };
    },

    async writeJson(path, data, { sha, message } = {}) {
      const url = `${apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`;
      const body = {
        message: message || `${path} を更新`,
        content: encodeBase64Utf8(JSON.stringify(data, null, 2) + '\n'),
        branch
      };
      if (sha) body.sha = sha;
      if (committer) body.committer = committer;

      const res = await request(url, { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
      if (res.status === 409 || res.status === 422) throw new ConflictError(await bodyText(res));
      if (res.status === 401 || res.status === 403) throw new AuthError(await bodyText(res));
      if (!res.ok) throw new StoreError(`${path} を保存できませんでした（${res.status}）`, await bodyText(res));

      const json = await res.json();
      return { sha: json.content && json.content.sha, path };
    },

    /* 設定画面の「つながるか試す」用 */
    async checkAccess() {
      const url = `${apiBase}/repos/${owner}/${repo}`;
      const res = await request(url, { method: 'GET', headers: headers(), cache: 'no-store' });
      if (res.status === 401 || res.status === 403) throw new AuthError(await bodyText(res));
      if (res.status === 404) {
        throw new StoreError(`${owner}/${repo} が見つかりません。名前とトークンの権限を確認してください`);
      }
      if (!res.ok) throw new StoreError(`つながりませんでした（${res.status}）`, await bodyText(res));
      const json = await res.json();
      return { name: json.full_name, private: json.private };
    }
  };
}
