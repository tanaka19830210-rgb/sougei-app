/* ============================================================
   LINE WORKS への送信（API 2.0）

   公式ドキュメントで確認した手順のとおりに作っています。
   1. Service Account 認証 (JWT)   https://developers.worksmobile.com/jp/docs/auth-jwt
      - JWT ヘッダ  {"alg":"RS256","typ":"JWT"}
      - JWT 本文    iss=Client ID / sub=Service Account / iat / exp（exp-iat は 3600秒以内）
      - POST https://auth.worksmobile.com/oauth2/v2.0/token
        Content-Type: application/x-www-form-urlencoded
        assertion / grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer /
        client_id / client_secret / scope（複数は半角スペース区切り）
   2. コンテンツアップロード       https://developers.worksmobile.com/jp/docs/bot-attachment-create
      - POST https://www.worksapis.com/v1.0/bots/{botId}/attachments  本文 {"fileName":"..."}
      - 応答 {"fileId":"...","uploadUrl":"..."}（24時間だけ有効・使い回し不可）
   3. ファイルのアップロード       https://developers.worksmobile.com/jp/docs/file-upload
      - POST {uploadUrl}  multipart/form-data（resourceName と FileData）
      - 応答 {"fileId":"...","fileName":"...","fileSize":n}
   4. トークルームへ送信           https://developers.worksmobile.com/jp/docs/bot-channel-message-send
      - POST https://www.worksapis.com/v1.0/bots/{botId}/channels/{channelId}/messages
      - 本文 {"content":{"type":"text","text":"..."}}
             {"content":{"type":"image","fileId":"..."}}   ← ファイルID方式
      - 成功は HTTP 201

   秘密の値（Client Secret・Private Key・Access Token）は、
   ログにもエラーメッセージにも出しません。
   ============================================================ */

import { createSign } from 'node:crypto';

const AUTH_BASE = 'https://auth.worksmobile.com/oauth2/v2.0';
const API_BASE = 'https://www.worksapis.com/v1.0';

/* ------------------------------------------------------------
   秘密鍵の整えなおし
   GitHub Secrets などに貼るとき、改行が \n という2文字になってしまうことがある。
   そのままでは署名に失敗するので直しておく（よくある失敗）。
   ------------------------------------------------------------ */
export function normalizePrivateKey(text) {
  const raw = String(text || '').trim().replace(/^["']|["']$/g, '');
  const fixed = raw.includes('-----BEGIN') && raw.includes('\\n')
    ? raw.replace(/\\r/g, '').replace(/\\n/g, '\n')
    : raw;
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(fixed)) {
    throw new Error('秘密鍵（LW_PRIVATE_KEY）の形が違います。「-----BEGIN PRIVATE KEY-----」から始まる全体を貼ってください');
  }
  return fixed.endsWith('\n') ? fixed : fixed + '\n';
}

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ------------------------------------------------------------
   JWT を作る
   iat を少し前（60秒前）にしておくと、時計のわずかなズレで
   「iat が未来」と断られるのを防げる。exp は 30分後（上限は60分）。
   ------------------------------------------------------------ */
export function createAssertion({ clientId, serviceAccount, privateKey, now = new Date() }) {
  if (!clientId) throw new Error('LW_CLIENT_ID が設定されていません');
  if (!serviceAccount) throw new Error('LW_SERVICE_ACCOUNT が設定されていません');
  const key = normalizePrivateKey(privateKey);
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const exp = iat + 1800;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: clientId, sub: serviceAccount, iat, exp }));
  const signingInput = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(key);
  return `${signingInput}.${base64url(signature)}`;
}

/* テストと調査のために、JWT の中身を読みもどす（署名は見ない） */
export function decodeJwt(token) {
  const [h, c] = String(token).split('.');
  const parse = part => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return { header: parse(h), claims: parse(c) };
}

function shorten(text) {
  const s = String(text || '');
  return s.length > 500 ? s.slice(0, 500) + '…' : s;
}

/* ============================================================
   送信の道具ひとそろい
   fetch と待ち時間を外から差しかえられるようにして、テストできる形にしている。
   ============================================================ */
export function createLineWorksClient(options = {}) {
  const {
    clientId, clientSecret, serviceAccount, privateKey, botId, channelId,
    scope = 'bot',
    authBase = AUTH_BASE,
    apiBase = API_BASE,
    maxAttempts = 3,
    fetchImpl = (typeof fetch === 'function' ? fetch : null),
    sleep = ms => new Promise(r => setTimeout(r, ms)),
    now = () => new Date(),
    log = () => {}
  } = options;

  if (!fetchImpl) throw new Error('この環境では通信できません（fetch がありません）');

  let token = null;

  /* 通信の失敗（回線・429・500番台）だけ、少し待ってやり直す */
  async function request(label, url, init) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, init);
      } catch (e) {
        lastError = new Error(`${label}：通信できませんでした（${e && e.message ? e.message : e}）`);
        log(`${label}：通信に失敗しました。${attempt}回目。少し待ってやり直します`);
        if (attempt < maxAttempts) { await sleep(500 * attempt); continue; }
        throw lastError;
      }
      if (res.ok) return res;

      const body = shorten(await res.text().catch(() => ''));
      const retriable = res.status === 429 || res.status >= 500;
      lastError = new Error(`${label}：LINE WORKS が受け付けませんでした（HTTP ${res.status}）${body ? ' ' + body : ''}`);
      if (retriable && attempt < maxAttempts) {
        log(`${label}：HTTP ${res.status} でした。${attempt}回目。少し待ってやり直します`);
        await sleep(500 * attempt);
        continue;
      }
      throw lastError;
    }
    throw lastError;
  }

  async function getAccessToken() {
    if (token) return token;
    if (!clientSecret) throw new Error('LW_CLIENT_SECRET が設定されていません');
    const assertion = createAssertion({ clientId, serviceAccount, privateKey, now: now() });
    const body = new URLSearchParams({
      assertion,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: clientId,
      client_secret: clientSecret,
      scope
    });
    const res = await request('アクセストークンの取得', `${authBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const json = await res.json();
    if (!json || !json.access_token) {
      throw new Error('アクセストークンの取得：応答にトークンが入っていませんでした');
    }
    token = json.access_token;
    log('アクセストークンを取得しました');
    return token;
  }

  function authHeaders(accessToken, extra) {
    return { Authorization: `Bearer ${accessToken}`, ...(extra || {}) };
  }

  /* 2. アップロード先のURLとファイルIDをもらう */
  async function createAttachment(fileName) {
    if (!botId) throw new Error('LW_BOT_ID が設定されていません');
    const accessToken = await getAccessToken();
    const res = await request('アップロード先の用意', `${apiBase}/bots/${encodeURIComponent(botId)}/attachments`, {
      method: 'POST',
      headers: authHeaders(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ fileName })
    });
    const json = await res.json();
    if (!json || !json.uploadUrl) throw new Error('アップロード先の用意：uploadUrl が返ってきませんでした');
    return { fileId: json.fileId, uploadUrl: json.uploadUrl };
  }

  /* 3. 画像そのものを送る（multipart/form-data） */
  async function uploadFile({ uploadUrl, fileName, bytes, contentType = 'image/png' }) {
    const accessToken = await getAccessToken();
    const boundary = '----soutaiFormBoundary' + Math.random().toString(36).slice(2);
    const head = Buffer.from(
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="resourceName"\r\n\r\n' +
      `${fileName}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="FileData"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
      'utf8'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([head, Buffer.from(bytes), tail]);

    const res = await request('画像のアップロード', uploadUrl, {
      method: 'POST',
      headers: authHeaders(accessToken, {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length)
      }),
      body
    });
    const json = await res.json().catch(() => ({}));
    return { fileId: json.fileId || null, fileSize: json.fileSize || bytes.length };
  }

  /* 4. トークルームへ送る */
  async function sendContent(content) {
    if (!channelId) throw new Error('LW_CHANNEL_ID が設定されていません');
    const accessToken = await getAccessToken();
    const url = `${apiBase}/bots/${encodeURIComponent(botId)}/channels/${encodeURIComponent(channelId)}/messages`;
    await request('メッセージの送信', url, {
      method: 'POST',
      headers: authHeaders(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ content })
    });
  }

  const sendText = text => sendContent({ type: 'text', text });
  const sendImage = fileId => sendContent({ type: 'image', fileId });

  return {
    getAccessToken,
    createAttachment,
    uploadFile,
    sendText,
    sendImage,

    /* まとめて実行：本文 → 画像 の順で1回ずつ送る */
    async publishImage({ fileName, bytes, text }) {
      const attachment = await createAttachment(fileName);
      const uploaded = await uploadFile({ uploadUrl: attachment.uploadUrl, fileName, bytes });
      const fileId = uploaded.fileId || attachment.fileId;
      if (!fileId) throw new Error('画像のアップロード：ファイルIDが分かりませんでした');
      if (text) await sendText(text);
      await sendImage(fileId);
      log(`送信しました（${bytes.length.toLocaleString('ja-JP')}バイトの画像）`);
      return { fileId, bytes: bytes.length };
    }
  };
}

/* 設定（環境変数）から作る。GitHub Actions から使う入口 */
export function clientFromEnv(env = process.env, extra = {}) {
  return createLineWorksClient({
    clientId: env.LW_CLIENT_ID,
    clientSecret: env.LW_CLIENT_SECRET,
    serviceAccount: env.LW_SERVICE_ACCOUNT,
    privateKey: env.LW_PRIVATE_KEY,
    botId: env.LW_BOT_ID,
    channelId: env.LW_CHANNEL_ID,
    scope: env.LW_SCOPE || 'bot',
    ...extra
  });
}

/*
  足りない設定を、日本語の名前で教える。

  hasFacilityChannel を true にすると、LW_CHANNEL_ID は要らないものとして数えます。
  事業所ごとのトークルーム（facilities.json の lwChannelId）を使う場合です。
*/
export function missingSecrets(env = process.env, { hasFacilityChannel = false } = {}) {
  const need = {
    LW_CLIENT_ID: 'Client ID',
    LW_CLIENT_SECRET: 'Client Secret',
    LW_SERVICE_ACCOUNT: 'Service Account',
    LW_PRIVATE_KEY: 'Private Key（秘密鍵）',
    LW_BOT_ID: 'Bot ID',
    LW_CHANNEL_ID: 'トークルームのチャンネルID'
  };
  if (hasFacilityChannel) delete need.LW_CHANNEL_ID;
  return Object.keys(need).filter(k => !env[k]).map(k => `${k}（${need[k]}）`);
}
