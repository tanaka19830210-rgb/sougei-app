/* ============================================================
   送迎表の「番人」（Google Apps Script の Web アプリ）

   やること：
     1. アプリから届いた Google ログインのしるし（ID トークン）を Google に確かめる
     2. そのアカウントが見てよい事業所を決める
     3. データ用リポジトリ（非公開）の読み書きを、代わりに行う
   GitHub の鍵はここ（スクリプト プロパティ）にだけ置き、端末には渡さない。

   スクリプト プロパティ（プロジェクトの設定 → スクリプト プロパティ）：
     GITHUB_TOKEN      … データ用リポジトリを読み書きできる鍵
     GITHUB_REPO       … 「アカウント名/リポジトリ名」
     GITHUB_BRANCH     … ふつうは main（空なら main）
     GOOGLE_CLIENT_ID  … Google ログインのクライアント ID
     SESSION_SECRET    … 長いでたらめな文字（ログインのしるしに署名する）
     ACCESS            … だれがどの事業所を見てよいか。JSON で書く
                         例：{"a@example.com":["funny"],"b@example.com":"*"}
                         "*" は全事業所。メールアドレスは小文字で

   デプロイ：ウェブアプリ／実行するユーザー＝自分／アクセスできるユーザー＝全員
   （ログインの確かめは、この中で行う）
   ============================================================ */

var SESSION_DAYS = 30;
var MAX_READ = 40;
var DATE_FILE = '\\d{4}-\\d{2}-\\d{2}\\.json';

function doGet() {
  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  var out;
  try {
    out = handle_(JSON.parse(e.postData.contents));
  } catch (err) {
    out = { ok: false, error: err.code || 'error', message: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

function prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function handle_(req) {
  if (!req || typeof req !== 'object') throw fail_('error', '中身が読めません');
  if (req.action === 'login') return login_(req);
  var who = whoIs_(req.session);
  if (req.action === 'whoami') return { ok: true, email: who.email, facilities: who.facilities };
  if (req.action === 'read') return read_(who, req.paths);
  if (req.action === 'write') return write_(who, req);
  throw fail_('error', '知らない頼みごとです');
}

/* ---------- だれが、どの事業所を見てよいか ---------- */
function accessOf_(email) {
  var table = {};
  try { table = JSON.parse(prop_('ACCESS') || '{}'); } catch (e) { throw fail_('error', 'ACCESS の書きかたが JSON になっていません'); }
  var hit = null;
  Object.keys(table).forEach(function (k) {
    if (String(k).trim().toLowerCase() === email) hit = table[k];
  });
  if (hit === '*') return '*';
  if (Array.isArray(hit) && hit.length) return hit.map(String);
  return null;
}

function mayUse_(facilities, fid) {
  return facilities === '*' || facilities.indexOf(fid) >= 0;
}

/* ---------- ログイン ---------- */
function login_(req) {
  var email = verifyIdToken_(String(req.idToken || ''));
  var facilities = accessOf_(email);
  if (!facilities) throw fail_('forbidden', 'この Google アカウント（' + email + '）は登録されていません');
  var exp = Date.now() + SESSION_DAYS * 86400000;
  return { ok: true, session: sign_({ e: email, x: exp }), email: email, facilities: facilities, exp: exp };
}

function verifyIdToken_(idToken) {
  if (!idToken) throw fail_('auth', 'ログインのしるしがありません');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw fail_('auth', 'Google でログインを確かめられませんでした');
  var info = JSON.parse(res.getContentText());
  var clientId = prop_('GOOGLE_CLIENT_ID');
  if (!clientId || info.aud !== clientId) throw fail_('auth', 'このアプリ向けのログインではありません');
  if (String(info.email_verified) !== 'true' || !info.email) throw fail_('auth', 'メールアドレスが確かめられていないアカウントです');
  if (Number(info.exp) * 1000 < Date.now()) throw fail_('auth', 'ログインの期限が切れています');
  return String(info.email).toLowerCase();
}

/* ---------- ログインのしるし（署名つき） ---------- */
function b64_(bytesOrText) {
  return Utilities.base64EncodeWebSafe(bytesOrText).replace(/=+$/, '');
}

function sign_(payload) {
  var secret = prop_('SESSION_SECRET');
  if (secret.length < 20) throw fail_('error', 'SESSION_SECRET が設定されていません');
  var body = b64_(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  return body + '.' + b64_(Utilities.computeHmacSha256Signature(body, secret));
}

function whoIs_(session) {
  var parts = String(session || '').split('.');
  if (parts.length !== 2) throw fail_('auth', 'ログインしてください');
  var secret = prop_('SESSION_SECRET');
  if (secret.length < 20) throw fail_('error', 'SESSION_SECRET が設定されていません');
  if (b64_(Utilities.computeHmacSha256Signature(parts[0], secret)) !== parts[1]) throw fail_('auth', 'ログインしてください');
  var payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  } catch (e) { throw fail_('auth', 'ログインしてください'); }
  if (!payload || !payload.e || Number(payload.x) < Date.now()) throw fail_('auth', 'ログインの期限が切れました。もう一度ログインしてください');
  /* 毎回、登録を見なおす（一覧から外したら、すぐ使えなくなるように） */
  var facilities = accessOf_(String(payload.e));
  if (!facilities) throw fail_('forbidden', 'この Google アカウントは登録されていません');
  return { email: String(payload.e), facilities: facilities };
}

/* ---------- 読んでよい・書いてよいファイルか ---------- */
function ruleOf_(path) {
  path = String(path || '');
  if (path === 'data/facilities.json') return { kind: 'facilities', write: false };
  var m = path.match(new RegExp('^data/([a-z0-9_-]+)/(weeks|attendance)/' + DATE_FILE + '$'));
  if (m) return { kind: m[2], fid: m[1], write: m[2] === 'weeks' };
  m = path.match(/^data\/([a-z0-9_-]+)\/rules\.json$/);
  if (m) return { kind: 'rules', fid: m[1], write: true };
  return null;
}

function checkPath_(who, path, writing) {
  var rule = ruleOf_(path);
  if (!rule) throw fail_('forbidden', 'このファイルは、あつかえません');
  if (rule.fid && !mayUse_(who.facilities, rule.fid)) throw fail_('forbidden', 'この事業所は、見られない設定です');
  if (writing && !rule.write) throw fail_('forbidden', 'このファイルは、書きかえられません');
  return rule;
}

/* ---------- GitHub ---------- */
function github_(path, extra) {
  var repo = prop_('GITHUB_REPO');
  var token = prop_('GITHUB_TOKEN');
  if (!repo || !token) throw fail_('error', 'GITHUB_REPO と GITHUB_TOKEN が設定されていません');
  var req = {
    url: 'https://api.github.com/repos/' + repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/'),
    method: 'get',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  };
  Object.keys(extra || {}).forEach(function (k) { req[k] = extra[k]; });
  return req;
}

function branch_() {
  return prop_('GITHUB_BRANCH') || 'main';
}

function read_(who, paths) {
  if (!Array.isArray(paths) || !paths.length) throw fail_('error', '読むファイルがありません');
  if (paths.length > MAX_READ) throw fail_('error', '一度に読むファイルが多すぎます');
  var rules = paths.map(function (p) { return checkPath_(who, p, false); });
  var ref = '?ref=' + encodeURIComponent(branch_());
  var reqs = paths.map(function (p) { var r = github_(p); r.url += ref; return r; });
  var results = UrlFetchApp.fetchAll(reqs);
  var files = results.map(function (res, i) {
    var code = res.getResponseCode();
    if (code === 404) return null;
    if (code !== 200) throw fail_('error', paths[i] + ' を読めませんでした（' + code + '）');
    var json = JSON.parse(res.getContentText());
    var text = Utilities.newBlob(Utilities.base64Decode(String(json.content || '').replace(/\s/g, ''))).getDataAsString('UTF-8');
    if (rules[i].kind === 'facilities') text = onlyMine_(who, text);
    return { path: paths[i], sha: json.sha, text: text };
  });
  return { ok: true, files: files };
}

/* 事業所の一覧は、見てよい事業所だけにしぼって渡す */
function onlyMine_(who, text) {
  var data = JSON.parse(text);
  var list = Array.isArray(data) ? data : (data && data.facilities) || [];
  list = list.filter(function (f) { return f && mayUse_(who.facilities, String(f.id)); });
  if (Array.isArray(data)) return JSON.stringify(list);
  data.facilities = list;
  return JSON.stringify(data);
}

function write_(who, req) {
  checkPath_(who, req.path, true);
  var text = String(req.text || '');
  try { JSON.parse(text); } catch (e) { throw fail_('error', '保存する中身が JSON になっていません'); }
  var body = {
    message: String(req.message || (req.path + ' を更新')).slice(0, 200) + '（' + who.email + '）',
    content: Utilities.base64Encode(text, Utilities.Charset.UTF_8),
    branch: branch_()
  };
  if (req.sha) body.sha = String(req.sha);
  var put = github_(req.path, { method: 'put', contentType: 'application/json', payload: JSON.stringify(body) });
  var url = put.url;
  delete put.url;
  var res = UrlFetchApp.fetch(url, put);
  var code = res.getResponseCode();
  if (code === 409 || code === 422) throw fail_('conflict', '他の人が先に保存しました');
  if (code !== 200 && code !== 201) throw fail_('error', req.path + ' を保存できませんでした（' + code + '）');
  var json = JSON.parse(res.getContentText());
  return { ok: true, path: req.path, sha: json.content && json.content.sha };
}
