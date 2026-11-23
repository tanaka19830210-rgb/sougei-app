/* 「番人」（Google ログインで事業所を分けるしくみ）のテスト
   番人のコード（gas/gate/Code.js）を、GAS の部品のにせものを付けて Node の中で動かす */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGateStore, callGate } from '../js/store/gateStore.js';
import { createStore } from '../js/store/index.js';
import { loadGateSession, saveGateSession, clearGateSession } from '../js/gate-config.js';
import { ConflictError, AuthError } from '../js/store/errors.js';

const CODE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'gas', 'gate', 'Code.js'), 'utf8');
const CLIENT_ID = 'client-123.apps.googleusercontent.com';

/* にせものの GitHub と Google を付けて、番人を1つ作る */
function makeGate({ access, files = {}, tokens = {} } = {}) {
  const props = {
    GITHUB_TOKEN: 'ghp_dummy', GITHUB_REPO: 'someone/some-data', GITHUB_BRANCH: 'main',
    GOOGLE_CLIENT_ID: CLIENT_ID, SESSION_SECRET: 'x'.repeat(40),
    ACCESS: JSON.stringify(access || { 'funny@example.com': ['funny'], 'boss@example.com': '*' })
  };
  const repo = new Map(Object.entries(files).map(([p, data], i) => [p, { text: JSON.stringify(data), sha: 'sha' + i }]));
  const log = [];
  const cache = new Map();
  const kick = { code: 204 };
  const logged = [];
  const response =(code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });

  function github(req) {
    log.push(req);
    assert.equal(req.headers.Authorization, 'Bearer ghp_dummy');
    const path = decodeURIComponent(req.url.split('/contents/')[1].split('?')[0]);
    if ((req.method || 'get') === 'get') {
      const f = repo.get(path);
      return f ? response(200, { sha: f.sha, content: Buffer.from(f.text, 'utf8').toString('base64'), encoding: 'base64' }) : response(404, {});
    }
    const body = JSON.parse(req.payload);
    const cur = repo.get(path);
    if (cur && cur.sha !== body.sha) return response(409, {});
    const next = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: 'sha-new-' + log.length, message: body.message };
    repo.set(path, next);
    return response(cur ? 200 : 201, { content: { sha: next.sha } });
  }

  const bytes = x => (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x));
  const sandbox = {
    JSON, Date, Object, Array, String, Number, RegExp, Error, encodeURIComponent,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k, v) => { cache.set(k, v); } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: text => ({ text, setMimeType() { return this; } })
    },
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      base64EncodeWebSafe: x => bytes(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => [...Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')],
      base64Decode: s => [...Buffer.from(s, 'base64')],
      base64Encode: x => bytes(x).toString('base64'),
      newBlob: x => ({ getBytes: () => [...bytes(x)], getDataAsString: () => bytes(x).toString('utf8') }),
      computeHmacSha256Signature: (value, key) => [...createHmac('sha256', key).update(value).digest()]
    },
    UrlFetchApp: {
      fetch(url, params) {
        if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
          const info = tokens[decodeURIComponent(url.split('id_token=')[1])];
          return info ? response(200, info) : response(400, {});
        }
        if (url === 'https://api.anthropic.com/v1/messages') {
          log.push({ ...params, url });
          return response(200, { content: [{ type: 'tool_use', name: 'x', input: {} }], stop_reason: 'tool_use' });
        }
        if (url.includes('/actions/workflows/')) {
          log.push({ ...params, url });
          return response(kick.code, kick.code === 204 ? '' : { message: 'x' });
        }
        return github({ ...params, url });
      },
      fetchAll: reqs => reqs.map(github)
    },
    Logger: { log: text => logged.push(String(text)) }
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox);
  const post = body => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  /* アプリから見た「通信」。番人の返事をそのまま返す */
  const fetchImpl = async (url, init) => ({ text: async () => JSON.stringify(post(JSON.parse(init.body))) });
  return { post, fetchImpl, repo, log, props, sandbox, kick, logged };
}

const goodToken = email => ({ aud: CLIENT_ID, email, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600) });
const FILES = {
  'data/facilities.json': { schemaVersion: 1, facilities: [{ id: 'funny', name: 'ファニー' }, { id: 'hitoiki', name: 'ひといき' }, { id: 'fit', name: 'ふぃっと' }] },
  'data/funny/weeks/2026-11-09.json': { weekStart: '2026-11-09', vans: [] },
  'data/hitoiki/weeks/2026-11-09.json': { weekStart: '2026-11-09', vans: [] },
  'data/funny/users.json': { users: [] }
};

function loggedIn(email, extra = {}) {
  const gate = makeGate({ files: FILES, tokens: { tok: goodToken(email) }, ...extra });
  const out = gate.post({ action: 'login', idToken: 'tok' });
  return { gate, out };
}

test('番人：登録されたアカウントは、ログインして自分の事業所だけもらえる', () => {
  const { out } = loggedIn('Funny@Example.com');
  assert.equal(out.ok, true);
  assert.equal(out.email, 'funny@example.com');
  assert.deepEqual(out.facilities, ['funny']);
  assert.ok(out.session.includes('.'));
});

test('番人：登録されていないアカウント・別アプリ向けのしるしは、ログインできない', () => {
  const gate = makeGate({
    files: FILES,
    tokens: { stranger: goodToken('stranger@example.com'), other: { ...goodToken('funny@example.com'), aud: 'another-app' }, old: { ...goodToken('funny@example.com'), exp: '100' } }
  });
  assert.equal(gate.post({ action: 'login', idToken: 'stranger' }).error, 'forbidden');
  assert.equal(gate.post({ action: 'login', idToken: 'other' }).error, 'auth');
  assert.equal(gate.post({ action: 'login', idToken: 'old' }).error, 'auth');
  assert.equal(gate.post({ action: 'login', idToken: 'nothing' }).error, 'auth');
});

test('番人：ほかの事業所のファイルは読めない。事業所の一覧も自分のぶんだけ', () => {
  const { gate, out } = loggedIn('funny@example.com');
  const mine = gate.post({ action: 'read', session: out.session, paths: ['data/facilities.json', 'data/funny/weeks/2026-11-09.json', 'data/funny/weeks/2026-11-16.json'] });
  assert.equal(mine.ok, true);
  assert.deepEqual(JSON.parse(mine.files[0].text).facilities.map(f => f.id), ['funny']);
  assert.equal(JSON.parse(mine.files[1].text).weekStart, '2026-11-09');
  assert.equal(mine.files[2], null);                                   /* まだ無いファイルは null */
  const other = gate.post({ action: 'read', session: out.session, paths: ['data/hitoiki/weeks/2026-11-09.json'] });
  assert.equal(other.error, 'forbidden');
  /* 1つでも見てはいけないものがまざっていたら、GitHub へは何も聞きにいかない */
  const before = gate.log.length;
  gate.post({ action: 'read', session: out.session, paths: ['data/funny/weeks/2026-11-09.json', 'data/hitoiki/weeks/2026-11-09.json'] });
  assert.equal(gate.log.length, before);
});

test('番人：決められた形のファイルしか、あつかわない', () => {
  const { gate, out } = loggedIn('boss@example.com');
  for (const path of ['data/funny/users.json', '.github/workflows/publish.yml', 'data/funny/weeks/../../secret.json', 'data/funny/weeks/2026-11-09.json/x', 'README.md']) {
    assert.equal(gate.post({ action: 'read', session: out.session, paths: [path] }).error, 'forbidden', path);
  }
  assert.equal(gate.post({ action: 'write', session: out.session, path: 'data/facilities.json', text: '{}' }).error, 'forbidden');
  assert.equal(gate.post({ action: 'write', session: out.session, path: 'data/funny/attendance/2026-11-09.json', text: '{}' }).error, 'forbidden');
});

test('番人：全事業所を見られるアカウントは、どの事業所も読める', () => {
  const { gate, out } = loggedIn('boss@example.com');
  assert.equal(out.facilities, '*');
  const r = gate.post({ action: 'read', session: out.session, paths: ['data/facilities.json', 'data/hitoiki/weeks/2026-11-09.json'] });
  assert.equal(JSON.parse(r.files[0].text).facilities.length, 3);
  assert.equal(r.files[1].sha.startsWith('sha'), true);
});

test('番人：保存できる。古い内容からの保存は「先に保存した人がいる」と返す', () => {
  const { gate, out } = loggedIn('funny@example.com');
  const path = 'data/funny/weeks/2026-11-09.json';
  const sha = gate.repo.get(path).sha;
  const ok = gate.post({ action: 'write', session: out.session, path, sha, text: '{"a":"あ"}', message: '送迎表を更新' });
  assert.equal(ok.ok, true);
  assert.equal(gate.repo.get(path).text, '{"a":"あ"}');
  assert.ok(gate.repo.get(path).message.includes('funny@example.com'));  /* だれが保存したかが履歴に残る */
  assert.equal(gate.post({ action: 'write', session: out.session, path, sha, text: '{}' }).error, 'conflict');
  assert.equal(gate.post({ action: 'write', session: out.session, path: 'data/hitoiki/rules.json', text: '{}' }).error, 'forbidden');
  assert.equal(gate.post({ action: 'write', session: out.session, path: 'data/funny/rules.json', text: 'こわれた中身' }).error, 'error');
});

test('番人：書きかえたしるし・ログインなしは通さない。一覧から外したら、すぐ使えなくなる', () => {
  const { gate, out } = loggedIn('funny@example.com');
  const paths = ['data/funny/weeks/2026-11-09.json'];
  assert.equal(gate.post({ action: 'read', paths }).error, 'auth');
  assert.equal(gate.post({ action: 'read', session: out.session.slice(0, -2) + 'zz', paths }).error, 'auth');
  /* 中身を「全事業所」に書きかえても、署名が合わないので通らない */
  const forged = Buffer.from(JSON.stringify({ e: 'boss@example.com', x: Date.now() + 1e9 })).toString('base64url') + '.' + out.session.split('.')[1];
  assert.equal(gate.post({ action: 'read', session: forged, paths }).error, 'auth');
  gate.props.ACCESS = JSON.stringify({ 'boss@example.com': '*' });
  assert.equal(gate.post({ action: 'read', session: out.session, paths }).error, 'forbidden');
});

test('gateStore：同じときの読みこみは1回の通信にまとめ、無いファイルは null', async () => {
  const { gate, out } = loggedIn('funny@example.com');
  let calls = 0;
  const store = createGateStore({ url: 'https://gate.example/exec', session: out.session, fetchImpl: (u, i) => { calls++; return gate.fetchImpl(u, i); } });
  const [a, b, c] = await Promise.all([
    store.readJson('data/funny/weeks/2026-11-09.json'),
    store.readJson('data/funny/weeks/2026-11-16.json'),
    store.readJson('data/facilities.json')
  ]);
  assert.equal(calls, 1);
  assert.equal(a.data.weekStart, '2026-11-09');
  assert.ok(a.sha);
  assert.equal(b, null);
  assert.equal(c.data.facilities.length, 1);
});

test('gateStore：保存と、エラーの伝わりかた', async () => {
  const { gate, out } = loggedIn('funny@example.com');
  const store = createGateStore({ url: 'https://gate.example/exec', session: out.session, fetchImpl: gate.fetchImpl });
  const path = 'data/funny/weeks/2026-11-09.json';
  const first = await store.readJson(path);
  const saved = await store.writeJson(path, { weekStart: '2026-11-09', vans: [], note: '直した' }, { sha: first.sha, message: '更新' });
  assert.ok(saved.sha && saved.sha !== first.sha);
  assert.equal(JSON.parse(gate.repo.get(path).text).note, '直した');
  await assert.rejects(store.writeJson(path, {}, { sha: first.sha }), ConflictError);
  await assert.rejects(store.readJson('data/hitoiki/weeks/2026-11-09.json'), AuthError);
  const bad = createGateStore({ url: 'https://gate.example/exec', session: 'こわれた.しるし', fetchImpl: gate.fetchImpl });
  await assert.rejects(bad.readJson(path), e => e instanceof AuthError && e.code === 'auth');
  await assert.rejects(callGate('https://gate.example/exec', { action: 'login', idToken: 'x' }, async () => ({ text: async () => '<html>' })), /読めない返事/);
});

test('保存先の切りかえ：鍵があれば GitHub、ログインずみなら番人、どちらも無ければお試し', () => {
  const fetchImpl = async () => ({ ok: false });
  const gate = { url: 'https://gate.example/exec', session: 'a.b' };
  assert.equal(createStore({ token: 't', owner: 'o', repo: 'r' }, { storage: null, fetchImpl, gate }).mode, 'github');
  assert.equal(createStore({}, { storage: null, fetchImpl, gate }).mode, 'gate');
  assert.equal(createStore({}, { storage: null, fetchImpl, gate: null }).mode, 'local');
});

test('ログインのしるし：期限が切れたら使わない', () => {
  const map = new Map();
  const storage = { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
  assert.equal(loadGateSession(storage), null);
  saveGateSession({ session: 'a.b', email: 'funny@example.com', facilities: ['funny'], exp: 2000 }, storage);
  assert.equal(loadGateSession(storage, 1000).email, 'funny@example.com');
  assert.equal(loadGateSession(storage, 3000), null);
  clearGateSession(storage);
  assert.equal(loadGateSession(storage, 1000), null);
});

test('番人：LINE WORKS へ送る頼みごとは、自分の事業所のぶんだけ置ける（読めない）', () => {
  const { gate, out } = loggedIn('funny@example.com');
  const path = 'publish-requests/funny-2026-11-16-20261116T120000.json';
  const req = { facilityId: 'funny', weekStart: '2026-11-16', status: 'pending' };
  assert.equal(gate.post({ action: 'write', session: out.session, path, text: JSON.stringify(req) }).ok, true);
  assert.equal(gate.post({ action: 'read', session: out.session, paths: [path] }).error, 'forbidden');
  /* ほかの事業所のファイル名、ファイル名と中身の食いちがい、決まりと違う名前は断る */
  assert.equal(gate.post({ action: 'write', session: out.session, path: 'publish-requests/hitoiki-2026-11-16-20261116T120000.json', text: JSON.stringify({ ...req, facilityId: 'hitoiki' }) }).error, 'forbidden');
  assert.equal(gate.post({ action: 'write', session: out.session, path: 'publish-requests/funny-2026-11-16-20261116T120001.json', text: JSON.stringify({ ...req, facilityId: 'hitoiki' }) }).error, 'forbidden');
  assert.equal(gate.post({ action: 'write', session: out.session, path: 'publish-requests/funny-2026-11-16-20261116T120002.json', text: JSON.stringify({ ...req, weekStart: '2026-11-23' }) }).error, 'forbidden');
  assert.equal(gate.post({ action: 'write', session: out.session, path: 'publish-requests/done/funny-2026-11-16-20261116T120000.json', text: JSON.stringify(req) }).error, 'forbidden');
});

test('番人：AI に代わりにたのむ。鍵が無ければ断る。ログインしていなければ通さない', () => {
  const { gate, out } = loggedIn('funny@example.com');
  const request = { model: 'claude-opus-5-5', max_tokens: 99999, stream: true, messages: [{ role: 'user', content: 'こんにちは' }] };
  assert.equal(gate.post({ action: 'ai', session: out.session, request }).message, 'GAS に AI の鍵（ANTHROPIC_API_KEY）がまだ入っていません');
  gate.props.ANTHROPIC_API_KEY = 'sk-dummy';
  const res = gate.post({ action: 'ai', session: out.session, request });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.body.stop_reason, 'tool_use');
  const sent = gate.log[gate.log.length - 1];
  assert.equal(sent.headers['x-api-key'], 'sk-dummy');
  const body = JSON.parse(sent.payload);
  assert.equal(body.max_tokens, 16000);
  assert.equal(body.stream, undefined);
  assert.equal(gate.post({ action: 'ai', session: 'にせもの', request }).error, 'auth');
  assert.equal(gate.post({ action: 'ai', session: out.session, request: { messages: 'x' } }).error, 'error');
});

test('番人：AI は送迎表の使い方だけ通す（モデル・道具・項目をしぼる）', async () => {
  const { buildRequest } = await import('../js/v2/ai.js');
  const { gate, out } = loggedIn('funny@example.com');
  gate.props.ANTHROPIC_API_KEY = 'sk-dummy';
  const ask = request => gate.post({ action: 'ai', session: out.session, request });
  const base = { model: 'claude-opus-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'x' }] };

  /* アプリが本当に作る頼みごとは通る */
  const real = buildRequest({ week: { vans: [], days: { 1: { notes: [], trips: {} }, 2: { notes: [], trips: {} }, 3: { notes: [], trips: {} }, 4: { notes: [], trips: {} }, 5: { notes: [], trips: {} }, 6: { notes: [], trips: {} } } }, roster: { people: [], drivers: [], capacity: {} }, rules: [], instruction: 'x' });
  assert.equal(ask(real).ok, true);

  /* ほかのモデル・ネット検索などの道具・知らない道具は断る（ログインは切らない＝ error） */
  assert.equal(ask({ ...base, model: 'claude-other' }).error, 'error');
  assert.equal(ask({ ...base, tools: [{ type: 'web_search_20250305', name: 'web_search' }] }).error, 'error');
  assert.equal(ask({ ...base, tools: [{ name: 'other', input_schema: { type: 'object' } }] }).error, 'error');

  /* 決まった項目のほかは捨てる */
  assert.equal(ask({ ...base, metadata: { user_id: 'x' }, mcp_servers: [{}], container: 'x' }).ok, true);
  const sent = JSON.parse(gate.log[gate.log.length - 1].payload);
  assert.deepEqual(Object.keys(sent).sort(), ['max_tokens', 'messages', 'model']);

  /* 大きすぎるものは断る */
  assert.equal(ask({ ...base, messages: [{ role: 'user', content: 'あ'.repeat(210000) }] }).error, 'error');
});

test('番人：AI は1人あたりの回数に上限がある', () => {
  const { gate, out } = loggedIn('funny@example.com');
  gate.props.ANTHROPIC_API_KEY = 'sk-dummy';
  const request = { model: 'claude-opus-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'x' }] };
  let last;
  for (let i = 0; i < 61; i++) last = gate.post({ action: 'ai', session: out.session, request });
  assert.equal(last.error, 'error');
  assert.match(last.message, /回数が多すぎます/);
});

test('アプリ：ログインしなおしたら、同じ画面のまま新しいしるしで保存できる', async () => {
  const { gate, out } = loggedIn('funny@example.com');
  let current = 'こわれた古いしるし';
  const store = createGateStore({ url: 'https://gate.example', session: () => current, fetchImpl: gate.fetchImpl });
  await assert.rejects(store.writeJson('data/funny/weeks/2026-11-23.json', { a: 1 }), e => e.name === 'AuthError');
  current = out.session;   /* 別のタブでログインしなおした */
  const saved = await store.writeJson('data/funny/weeks/2026-11-23.json', { a: 1 });
  assert.ok(saved.sha);
});

test('GAS：月曜の朝に、利用予定の取りこみ（attendance.yml）を起こす', () => {
  const gate = makeGate();
  gate.sandbox.okosu_torikomi();
  const sent = gate.log[gate.log.length - 1];
  assert.equal(sent.url, 'https://api.github.com/repos/someone/some-data/actions/workflows/attendance.yml/dispatches');
  assert.equal(sent.method, 'post');
  assert.equal(sent.headers.Authorization, 'Bearer ghp_dummy');
  assert.deepEqual(JSON.parse(sent.payload), { ref: 'main' });
  assert.match(gate.logged.join('\n'), /起こしました/);

  /* 起こす専用の鍵があれば、そちらを使う */
  gate.props.GITHUB_ACTIONS_TOKEN = 'ghp_actions';
  gate.sandbox.okosu_torikomi();
  assert.equal(gate.log[gate.log.length - 1].headers.Authorization, 'Bearer ghp_actions');

  /* 鍵に Actions の許可が無いときは、何が要るかを言って止まる（トリガーの失敗メールで気づける） */
  gate.kick.code = 403;
  assert.throws(() => gate.sandbox.okosu_torikomi(), /Actions を「Read and write」/);
});
