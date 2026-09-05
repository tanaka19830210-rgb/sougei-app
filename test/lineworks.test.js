/* ============================================================
   LINE WORKS への送信のテスト

   本物のLINE WORKSには一切つなぎません。
   「偽の応答を返す fetch」を差しこんで、
   ・JWT の中身が公式ドキュメントどおりか
   ・トークン取得 → アップロード先の用意 → 画像アップロード → 送信 の順に、
     正しいURL・ヘッダ・本文で呼んでいるか
   ・失敗したときに、やり直すか／日本語で理由を出すか
   を確かめます。
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import {
  createAssertion, decodeJwt, normalizePrivateKey,
  createLineWorksClient, missingSecrets
} from '../tools/publish/lineworks.js';
import { pngSize } from '../tools/publish/png.js';

/* テスト用の鍵（本物ではありません） */
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
});

const SECRET = 'ひみつのClientSecret';
const BASE = {
  clientId: 'ZbsOq6zjt0IhtZZnrc',
  clientSecret: SECRET,
  serviceAccount: '1wagx.serviceaccount@example.com',
  privateKey,
  botId: '2000001',
  channelId: '12345a12-b12c-12d3-e123fghijkl'
};

/* ---------- 偽の fetch ---------- */
function fakeFetch(handlers) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    const handler = handlers.find(h => String(url).includes(h.match));
    if (!handler) throw new Error('テストで用意していないURLが呼ばれました: ' + url);
    const res = handler.next ? handler.next() : handler;
    if (res.throws) throw new Error(res.throws);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body,
      text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body || ''))
    };
  };
  return { impl, calls };
}

function okHandlers() {
  return [
    { match: '/oauth2/v2.0/token', status: 200, body: { access_token: 'ACCESS-TOKEN-1', token_type: 'Bearer', expires_in: '86400' } },
    { match: '/attachments', status: 200, body: { fileId: 'jp1.file.from.attachments', uploadUrl: 'https://apis-storage.worksmobile.com/k/emsg/r/jp1/abc/soutai.png' } },
    { match: 'apis-storage.worksmobile.com', status: 201, body: { fileId: 'jp1.file.after.upload', fileName: 'soutai.png', fileSize: 1234 } },
    { match: '/messages', status: 201, body: {} }
  ];
}

function client(extra = {}) {
  const fake = extra.fake || fakeFetch(okHandlers());
  const sleeps = [];
  const c = createLineWorksClient({
    ...BASE,
    fetchImpl: fake.impl,
    sleep: ms => { sleeps.push(ms); return Promise.resolve(); },
    now: () => new Date('2026-07-29T05:00:00Z'),
    ...extra.options
  });
  return { c, calls: fake.calls, sleeps };
}

/* ============================================================
   1. JWT
   ============================================================ */
test('JWT：ヘッダは RS256、中身は iss=ClientID / sub=ServiceAccount', () => {
  const token = createAssertion({ ...BASE, now: new Date('2026-07-29T05:00:00Z') });
  const { header, claims } = decodeJwt(token);
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.equal(claims.iss, BASE.clientId);
  assert.equal(claims.sub, BASE.serviceAccount);
});

test('JWT：iat と exp は秒（10桁）で、差は3600秒以内。iat は現在より前', () => {
  const now = new Date('2026-07-29T05:00:00Z');
  const { claims } = decodeJwt(createAssertion({ ...BASE, now }));
  const nowSec = Math.floor(now.getTime() / 1000);
  assert.equal(String(claims.iat).length, 10, 'ミリ秒ではなく秒');
  assert.ok(claims.exp - claims.iat <= 3600, '公式の決まり：exp - iat は3600秒以内');
  assert.ok(claims.iat <= nowSec, '時計のズレで「未来のiat」と断られないように少し前にする');
  assert.ok(claims.exp > nowSec, 'まだ期限内');
});

test('JWT：署名は秘密鍵で検証できる（RS256）', () => {
  const token = createAssertion({ ...BASE, now: new Date() });
  const [h, c, s] = token.split('.');
  const signature = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, signature);
  assert.ok(ok, '署名が検証できること');
});

test('秘密鍵：改行が \\n の2文字になっていても直して使える', () => {
  const oneLine = privateKey.replace(/\n/g, '\\n');
  const fixed = normalizePrivateKey(oneLine);
  assert.ok(fixed.includes('-----BEGIN PRIVATE KEY-----\n'));
  const token = createAssertion({ ...BASE, privateKey: oneLine, now: new Date() });
  assert.equal(decodeJwt(token).header.alg, 'RS256');
});

test('秘密鍵：形が違うときは、何を貼ればよいか日本語で言う', () => {
  assert.throws(() => normalizePrivateKey('abcdefg'), /-----BEGIN PRIVATE KEY-----/);
});

/* ============================================================
   2. トークン取得
   ============================================================ */
test('トークン取得：公式の URL・形式・パラメータで呼ぶ', async () => {
  const { c, calls } = client();
  const token = await c.getAccessToken();
  assert.equal(token, 'ACCESS-TOKEN-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://auth.worksmobile.com/oauth2/v2.0/token');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');

  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(body.get('client_id'), BASE.clientId);
  assert.equal(body.get('client_secret'), SECRET);
  assert.equal(body.get('scope'), 'bot');
  assert.equal(decodeJwt(body.get('assertion')).claims.iss, BASE.clientId);
});

test('トークン取得：一度取ったら、続けて呼んでも取り直さない', async () => {
  const { c, calls } = client();
  await c.getAccessToken();
  await c.getAccessToken();
  assert.equal(calls.length, 1);
});

/* ============================================================
   3. 画像を送るまでの流れ
   ============================================================ */
test('配信：トークン → アップロード先の用意 → 画像 → 本文 → 画像メッセージ の順に呼ぶ', async () => {
  const { c, calls } = client();
  const bytes = Buffer.from('89504e470d0a1a0a' + '00'.repeat(40), 'hex');
  const result = await c.publishImage({ fileName: 'soutai.png', bytes, text: '送迎表ができました' });

  assert.equal(calls.length, 5);
  assert.match(calls[0].url, /auth\.worksmobile\.com\/oauth2\/v2\.0\/token$/);
  assert.equal(calls[1].url, 'https://www.worksapis.com/v1.0/bots/2000001/attachments');
  assert.equal(calls[2].url, 'https://apis-storage.worksmobile.com/k/emsg/r/jp1/abc/soutai.png');
  assert.equal(calls[3].url, 'https://www.worksapis.com/v1.0/bots/2000001/channels/12345a12-b12c-12d3-e123fghijkl/messages');
  assert.equal(calls[4].url, calls[3].url);

  /* アップロード先の用意：JSON で fileName を渡す */
  assert.equal(calls[1].init.headers.Authorization, 'Bearer ACCESS-TOKEN-1');
  assert.equal(calls[1].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].init.body), { fileName: 'soutai.png' });

  /* 画像の送りかた：multipart/form-data の resourceName と FileData */
  const upload = calls[2].init;
  assert.equal(upload.headers.Authorization, 'Bearer ACCESS-TOKEN-1');
  assert.match(upload.headers['Content-Type'], /^multipart\/form-data; boundary=----soutaiFormBoundary/);
  const boundary = upload.headers['Content-Type'].split('boundary=')[1];
  const raw = upload.body.toString('latin1');
  assert.ok(raw.startsWith(`--${boundary}\r\n`), '境界の文字で始まる');
  assert.match(raw, /Content-Disposition: form-data; name="resourceName"\r\n\r\nsoutai\.png\r\n/);
  assert.match(raw, /Content-Disposition: form-data; name="FileData"; filename="soutai\.png"\r\nContent-Type: image\/png/);
  assert.ok(raw.endsWith(`\r\n--${boundary}--\r\n`), '境界の文字で終わる');
  assert.ok(upload.body.includes(bytes), '画像そのものが入っている');
  assert.equal(upload.headers['Content-Length'], String(upload.body.length));

  /* メッセージ：本文と画像（ファイルID方式） */
  assert.deepEqual(JSON.parse(calls[3].init.body), { content: { type: 'text', text: '送迎表ができました' } });
  assert.deepEqual(JSON.parse(calls[4].init.body), { content: { type: 'image', fileId: 'jp1.file.after.upload' } });
  assert.equal(result.fileId, 'jp1.file.after.upload');
  assert.equal(result.bytes, bytes.length);
});

test('配信：アップロードの応答にファイルIDが無ければ、用意のときのIDを使う', async () => {
  const handlers = okHandlers();
  handlers[2] = { match: 'apis-storage.worksmobile.com', status: 200, body: {} };
  const fake = fakeFetch(handlers);
  const { c, calls } = client({ fake });
  await c.publishImage({ fileName: 'soutai.png', bytes: Buffer.from('abc'), text: '' });
  assert.deepEqual(JSON.parse(calls[3].init.body), { content: { type: 'image', fileId: 'jp1.file.from.attachments' } });
});

test('配信：本文が空なら、画像だけ送る', async () => {
  const { c, calls } = client();
  await c.publishImage({ fileName: 'soutai.png', bytes: Buffer.from('abc'), text: '' });
  assert.equal(calls.length, 4);
  assert.equal(JSON.parse(calls[3].init.body).content.type, 'image');
});

/* ============================================================
   4. 失敗したとき
   ============================================================ */
test('失敗：混み合っている（500）ときは、少し待ってやり直す', async () => {
  const responses = [
    { status: 500, body: 'server error' },
    { status: 500, body: 'server error' },
    { status: 200, body: { access_token: 'ACCESS-TOKEN-2' } }
  ];
  const fake = fakeFetch([{ match: '/oauth2/v2.0/token', next: () => responses.shift() }]);
  const { c, calls, sleeps } = client({ fake });
  assert.equal(await c.getAccessToken(), 'ACCESS-TOKEN-2');
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [500, 1000]);
});

test('失敗：回線が切れているときも、やり直してから日本語で伝える', async () => {
  const fake = fakeFetch([{ match: '/oauth2/v2.0/token', next: () => ({ throws: 'ECONNRESET' }) }]);
  const { c, calls } = client({ fake });
  await assert.rejects(() => c.getAccessToken(), /通信できませんでした/);
  assert.equal(calls.length, 3, '3回試してあきらめる');
});

test('失敗：鍵が違う（401）ときは、やり直さずに理由を出す。ひみつの値は出さない', async () => {
  const fake = fakeFetch([{ match: '/oauth2/v2.0/token', status: 401, body: '{"code":"invalid_grant"}' }]);
  const { c, calls } = client({ fake });
  await assert.rejects(() => c.getAccessToken(), e => {
    assert.match(e.message, /アクセストークンの取得/);
    assert.match(e.message, /HTTP 401/);
    assert.match(e.message, /invalid_grant/);
    assert.ok(!e.message.includes(SECRET), 'Client Secret はエラー文に出さない');
    assert.ok(!e.message.includes('BEGIN PRIVATE KEY'), '秘密鍵はエラー文に出さない');
    return true;
  });
  assert.equal(calls.length, 1);
});

test('失敗：応答にトークンが入っていないときも分かるようにする', async () => {
  const fake = fakeFetch([{ match: '/oauth2/v2.0/token', status: 200, body: {} }]);
  const { c } = client({ fake });
  await assert.rejects(() => c.getAccessToken(), /トークンが入っていません/);
});

test('設定もれ：足りないものを日本語の名前つきで教える', () => {
  assert.deepEqual(missingSecrets({}), [
    'LW_CLIENT_ID（Client ID）',
    'LW_CLIENT_SECRET（Client Secret）',
    'LW_SERVICE_ACCOUNT（Service Account）',
    'LW_PRIVATE_KEY（Private Key（秘密鍵））',
    'LW_BOT_ID（Bot ID）',
    'LW_CHANNEL_ID（トークルームのチャンネルID）'
  ]);
  assert.deepEqual(missingSecrets({
    LW_CLIENT_ID: 'a', LW_CLIENT_SECRET: 'b', LW_SERVICE_ACCOUNT: 'c',
    LW_PRIVATE_KEY: 'd', LW_BOT_ID: 'e', LW_CHANNEL_ID: 'f'
  }), []);
});

test('設定もれ：事業所ごとのトークを使うときは、LW_CHANNEL_ID が無くてもよい', () => {
  const env = {
    LW_CLIENT_ID: 'a', LW_CLIENT_SECRET: 'b', LW_SERVICE_ACCOUNT: 'c',
    LW_PRIVATE_KEY: 'd', LW_BOT_ID: 'e'
  };
  /* 共通のトークに送るつもりなら、LW_CHANNEL_ID が無いのは「足りない」 */
  assert.deepEqual(missingSecrets(env), ['LW_CHANNEL_ID（トークルームのチャンネルID）']);
  /* 事業所ごとのトーク（facilities.json の lwChannelId）を使うなら、要らない */
  assert.deepEqual(missingSecrets(env, { hasFacilityChannel: true }), []);
  /* ほかに足りないものは、事業所ごとでも変わらず出る */
  assert.deepEqual(missingSecrets({}, { hasFacilityChannel: true }), [
    'LW_CLIENT_ID（Client ID）',
    'LW_CLIENT_SECRET（Client Secret）',
    'LW_SERVICE_ACCOUNT（Service Account）',
    'LW_PRIVATE_KEY（Private Key（秘密鍵））',
    'LW_BOT_ID（Bot ID）'
  ]);
});

test('設定もれ：Bot ID が無いときは、送る前に日本語で止まる', async () => {
  const { c } = client({ options: { botId: '' } });
  await assert.rejects(() => c.createAttachment('a.png'), /LW_BOT_ID/);
});

/* ============================================================
   5. PNG の大きさ読み取り（画像が作れたかの確認に使う）
   ============================================================ */
test('PNG：幅と高さを読み取れる。PNGでなければ null', () => {
  const head = Buffer.alloc(24);
  head.writeUInt32BE(0x89504e47, 0);
  head.writeUInt32BE(1588, 16);
  head.writeUInt32BE(2246, 20);
  assert.deepEqual(pngSize(head), { width: 1588, height: 2246 });
  assert.equal(pngSize(Buffer.from('これは画像ではありません')), null);
});
