/* 保存まわり（お試しモード・GitHub・コミットメッセージ・競合）のテスト */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore } from '../js/store/localStore.js';
import { createGithubStore } from '../js/store/githubStore.js';
import { createRepository } from '../js/store/repository.js';
import { encodeBase64Utf8, decodeBase64Utf8 } from '../js/store/base64.js';
import { ConflictError, AuthError } from '../js/store/errors.js';
import { makeFixture } from './fixture.js';

/* ---------- テスト用の道具 ---------- */
function fakeStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i]; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  };
}

function seedFetch(files) {
  return async (path) => {
    if (!(path in files)) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => JSON.stringify(files[path]) };
  };
}

function ghResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

/* ============================================================
   Base64（日本語がこわれないか）
   ============================================================ */
test('Base64：日本語をそのまま行き来できる', () => {
  const text = '{"name":"井上 健太","memo":"雨の日は玄関前まで"}';
  assert.equal(decodeBase64Utf8(encodeBase64Utf8(text)), text);
});

/* ============================================================
   お試しモード（localStore）
   ============================================================ */
test('localStore：同梱のダミーを読み、保存すると端末の中に入る', async () => {
  const storage = fakeStorage();
  const store = createLocalStore({
    storage,
    fetchImpl: seedFetch({ 'data/facilities.json': { facilities: [{ id: 'yahata' }] } })
  });
  const first = await store.readJson('data/facilities.json');
  assert.equal(first.sha, 'seed');
  assert.equal(first.data.facilities[0].id, 'yahata');

  const written = await store.writeJson('data/facilities.json', { facilities: [{ id: 'x' }] }, { sha: first.sha });
  const second = await store.readJson('data/facilities.json');
  assert.equal(second.data.facilities[0].id, 'x');
  assert.equal(second.sha, written.sha);
  assert.notEqual(second.sha, 'seed');
});

test('localStore：無いファイルは null（まだ作られていない、として扱う）', async () => {
  const store = createLocalStore({ storage: fakeStorage(), fetchImpl: seedFetch({}) });
  assert.equal(await store.readJson('data/yahata/plans/2026-08-03.json'), null);
});

test('localStore：古い sha で保存しようとすると「先に保存されました」になる', async () => {
  const storage = fakeStorage();
  const store = createLocalStore({ storage, fetchImpl: seedFetch({ 'a.json': { v: 1 } }) });
  const first = await store.readJson('a.json');
  await store.writeJson('a.json', { v: 2 }, { sha: first.sha });
  await assert.rejects(
    () => store.writeJson('a.json', { v: 3 }, { sha: first.sha }),
    err => {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.message, '他の人が先に保存しました。画面を読み直してください');
      return true;
    }
  );
});

test('localStore：clear で控えを消すと、また同梱のダミーにもどる', async () => {
  const storage = fakeStorage();
  const store = createLocalStore({ storage, fetchImpl: seedFetch({ 'a.json': { v: 1 } }) });
  const first = await store.readJson('a.json');
  await store.writeJson('a.json', { v: 2 }, { sha: first.sha });
  assert.equal(store.clear(), 1);
  const back = await store.readJson('a.json');
  assert.deepEqual(back.data, { v: 1 });
});

/* ============================================================
   GitHub（Contents API）
   ============================================================ */
test('githubStore：ファイルを読む（Base64をほどいて JSON にする）', async () => {
  const calls = [];
  const store = createGithubStore({
    owner: 'tanaka', repo: 'soutai-data', branch: 'main', token: 'tok',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return ghResponse(200, { sha: 'abc123', encoding: 'base64', content: encodeBase64Utf8('{"users":[{"name":"井上 健太"}]}') });
    }
  });
  const result = await store.readJson('data/yahata/users.json');
  assert.equal(result.sha, 'abc123');
  assert.equal(result.data.users[0].name, '井上 健太');
  assert.match(calls[0].url, /repos\/tanaka\/soutai-data\/contents\/data\/yahata\/users\.json\?ref=main/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
});

test('githubStore：まだ無いファイル（404）は null', async () => {
  const store = createGithubStore({
    owner: 'o', repo: 'r', token: 't',
    fetchImpl: async () => ghResponse(404, { message: 'Not Found' })
  });
  assert.equal(await store.readJson('data/x.json'), null);
});

test('githubStore：保存すると sha とコミットメッセージを送る', async () => {
  let sent = null;
  const store = createGithubStore({
    owner: 'o', repo: 'r', branch: 'main', token: 't',
    fetchImpl: async (url, init) => {
      sent = { url, method: init.method, body: JSON.parse(init.body) };
      return ghResponse(200, { content: { sha: 'newsha' } });
    }
  });
  const result = await store.writeJson('data/yahata/plans/2026-08-03.json', { weekStart: '2026-08-03' }, {
    sha: 'oldsha',
    message: '送迎表 八幡 2026-08-03週 を更新'
  });
  assert.equal(result.sha, 'newsha');
  assert.equal(sent.method, 'PUT');
  assert.equal(sent.body.sha, 'oldsha');
  assert.equal(sent.body.branch, 'main');
  assert.equal(sent.body.message, '送迎表 八幡 2026-08-03週 を更新');
  assert.equal(decodeBase64Utf8(sent.body.content), JSON.stringify({ weekStart: '2026-08-03' }, null, 2) + '\n');
});

test('githubStore：409／422 は「他の人が先に保存しました」', async () => {
  for (const status of [409, 422]) {
    const store = createGithubStore({
      owner: 'o', repo: 'r', token: 't',
      fetchImpl: async () => ghResponse(status, { message: 'conflict' })
    });
    await assert.rejects(
      () => store.writeJson('a.json', { v: 1 }, { sha: 'x' }),
      err => {
        assert.ok(err instanceof ConflictError);
        assert.equal(err.message, '他の人が先に保存しました。画面を読み直してください');
        return true;
      }
    );
  }
});

test('githubStore：401／403 はトークンの案内を出す', async () => {
  const store = createGithubStore({
    owner: 'o', repo: 'r', token: 't',
    fetchImpl: async () => ghResponse(401, { message: 'Bad credentials' })
  });
  await assert.rejects(() => store.readJson('a.json'), err => {
    assert.ok(err instanceof AuthError);
    assert.match(err.message, /トークンを確認/);
    return true;
  });
});

/* ============================================================
   リポジトリ層（コミットメッセージと sha の受けわたし）
   ============================================================ */
function memoryStore() {
  const files = new Map();
  const log = [];
  return {
    mode: 'test',
    label: 'テスト',
    log,
    files,
    async readJson(path) {
      if (!files.has(path)) return null;
      const entry = files.get(path);
      return { data: JSON.parse(entry.text), sha: entry.sha, path };
    },
    async writeJson(path, data, { sha, message } = {}) {
      const entry = files.get(path);
      if (entry && entry.sha !== sha) throw new ConflictError(path);
      const next = { sha: 'sha' + (log.length + 1), text: JSON.stringify(data) };
      files.set(path, next);
      log.push({ path, message, sha });
      return { sha: next.sha, path };
    }
  };
}

test('repository：週次プランのコミットメッセージが日本語になる', async () => {
  const store = memoryStore();
  const repo = createRepository(store);
  const { facility, vans, plan } = makeFixture();
  await repo.savePlan({ facility, weekStart: '2026-08-03', plan, editorName: '田中' });
  assert.equal(store.log[0].path, 'data/test/plans/2026-08-03.json');
  assert.equal(store.log[0].message, '送迎表 テスト 2026-08-03週 を更新');
  const saved = await repo.loadPlan({ facility, vans, weekStart: '2026-08-03' });
  assert.equal(saved.exists, true);
  assert.equal(saved.plan.updatedBy, '田中');
  assert.match(saved.plan.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('repository：読んだ sha を覚えていて、2回目の保存も通る', async () => {
  const store = memoryStore();
  const repo = createRepository(store);
  const { facility, vans, plan } = makeFixture();
  await repo.savePlan({ facility, weekStart: '2026-08-03', plan });
  const again = await repo.loadPlan({ facility, vans, weekStart: '2026-08-03' });
  await repo.savePlan({ facility, weekStart: '2026-08-03', plan: again.plan });
  assert.equal(store.log.length, 2);
});

test('repository：別の人が先に保存していたら競合になる', async () => {
  const store = memoryStore();
  const repo = createRepository(store);
  const other = createRepository(store);
  const { facility, vans, plan } = makeFixture();
  await repo.savePlan({ facility, weekStart: '2026-08-03', plan });
  const mine = await repo.loadPlan({ facility, vans, weekStart: '2026-08-03' });
  await other.loadPlan({ facility, vans, weekStart: '2026-08-03' });
  await other.savePlan({ facility, weekStart: '2026-08-03', plan: mine.plan });   /* 先に保存される */
  await assert.rejects(() => repo.savePlan({ facility, weekStart: '2026-08-03', plan: mine.plan }),
    err => err instanceof ConflictError);
});

test('repository：マスタのコミットメッセージと置き場所', async () => {
  const store = memoryStore();
  const repo = createRepository(store);
  const { facility, users } = makeFixture();
  await repo.saveMaster({ kind: 'users', facility, list: users });
  assert.equal(store.log[0].path, 'data/test/users.json');
  assert.equal(store.log[0].message, '利用者マスタ テスト を更新');
  const file = JSON.parse(store.files.get('data/test/users.json').text);
  assert.equal(file.facilityId, 'test');
  assert.equal(file.users.length, users.length);
});

test('repository：まだファイルが無い事業所も、空のマスタとして読める', async () => {
  const repo = createRepository(memoryStore());
  const masters = await repo.loadMasters('newone');
  assert.deepEqual(masters.users, []);
  assert.deepEqual(masters.vans, []);
  assert.equal(masters.missing.users, true);
});
