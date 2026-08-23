/* ============================================================
   配信の本体（GitHub Actions から呼ばれます）

   やること
   1. データ用リポジトリの publish-requests/*.json（配信依頼）を見つける
   2. その事業所・その週の送迎表を読んで、印刷と同じ紙面のHTMLを組み立てる
      （紙面の組み立ては js/core/printLayout.js。アプリの印刷画面と同じものです）
   3. ヘッドレスブラウザで PNG にする
   4. LINE WORKS のトークルームへ、本文＋画像を送る
   5. 依頼ファイルを publish-requests/done/ へ移す（結果を書き足す）
      → 同じ依頼で何度も動かないようにするため

   ためしに動かす（送信はしない）：
     node tools/publish/run.js --dry-run --facility funny --week 2026-08-03
   ============================================================ */

import { readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { createFsStore } from './fsStore.js';
import { renderPng } from './render.js';
import { clientFromEnv, missingSecrets } from './lineworks.js';
import { createRepository } from '../../js/store/repository.js';
import { buildPageHtml, buildStandaloneHtml } from '../../js/core/printLayout.js';
import { normalizePublishRequest, withResult, publishImageName, publishMessageText, createPublishRequest } from '../../js/core/publishRequest.js';
import { createContext } from '../../js/core/assign.js';
import { parseDateKey, weekKeyOf } from '../../js/core/dates.js';
import * as paths from '../../js/store/paths.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function argOf(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : '';
}

const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');
const DATA_DIR = resolve(process.env.DATA_DIR || argOf('data') || APP_DIR);
const OUT_DIR = resolve(process.env.OUT_DIR || join(APP_DIR, 'tools', 'publish', 'out'));

function log(message) {
  console.log(message);
}

/* 紙面のCSSは、アプリで使っているものをそのまま読む */
function readCss() {
  return ['css/base.css', 'css/print.css'].map(p => readFileSync(join(APP_DIR, p), 'utf8'));
}

/* ------------------------------------------------------------
   配信依頼をさがす
   ------------------------------------------------------------ */
async function listRequestFiles() {
  const dir = join(DATA_DIR, paths.PUBLISH_ROOT);
  let names;
  try {
    names = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  return names
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => ({ name: entry.name, path: `${paths.PUBLISH_ROOT}/${entry.name}`, full: join(dir, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------
   1件の依頼を配信する
   ------------------------------------------------------------ */
async function handleRequest(repo, store, request) {
  const facilities = await repo.loadFacilities();
  const facility = facilities.find(f => f.id === request.facilityId);
  if (!facility) {
    throw new Error(`事業所「${request.facilityId}」が data/facilities.json にありません`);
  }
  const parsed = parseDateKey(request.weekStart);
  if (!parsed) {
    throw new Error(`週の指定「${request.weekStart}」が読めません（2026-08-03 のような形にしてください）`);
  }
  const weekStart = weekKeyOf(parsed);

  const masters = await repo.loadMasters(facility.id);
  if (!masters.users.length || !masters.vans.length) {
    throw new Error(`${facility.name} の利用者または車両のマスタが空です`);
  }
  const ctx = createContext({
    facility,
    users: masters.users,
    vans: masters.vans,
    ngPairs: masters.ngPairs
  });

  const loaded = await repo.loadPlan({ facility, vans: masters.vans, weekStart });
  if (!loaded.exists) {
    throw new Error(`${facility.name} の ${weekStart} 週の送迎表（${paths.planPath(facility.id, weekStart)}）が見つかりません`);
  }
  log(`${facility.name}　${weekStart} 週の送迎表を読みました`);

  const pageHtml = buildPageHtml({
    facility,
    ctx,
    drivers: masters.drivers,
    plan: loaded.plan,
    weekStart,
    now: new Date()
  });
  const html = buildStandaloneHtml({ facility, weekStart, pageHtml, cssTexts: readCss() });

  const { buffer, size } = await renderPng({ html, log });
  const fileName = publishImageName({ facilityId: facility.id, weekStart });
  await mkdir(OUT_DIR, { recursive: true });
  const outFile = join(OUT_DIR, fileName);
  await writeFile(outFile, buffer);
  log(`画像を置きました：${outFile}`);

  const text = request.message || publishMessageText({
    facility,
    weekStart,
    requestedBy: request.requestedBy
  });

  if (DRY_RUN) {
    log('お試し（--dry-run）なので、LINE WORKS には送りません。送る本文はこちらです：');
    log('---');
    log(text);
    log('---');
    return { imageBytes: buffer.length, detail: `お試し（送信なし）／画像 ${size ? size.width + '×' + size.height : '?'}px` };
  }

  const missing = missingSecrets(process.env);
  if (missing.length) {
    throw new Error('GitHub Secrets が足りません：' + missing.join('、'));
  }
  const client = clientFromEnv(process.env, { log });
  const sent = await client.publishImage({ fileName, bytes: buffer, text });
  return {
    imageBytes: buffer.length,
    detail: `送信しました／画像 ${size ? size.width + '×' + size.height : '?'}px／fileId ${String(sent.fileId).slice(0, 12)}…`
  };
}

/* 依頼ファイルを done/ に移す（結果つき） */
async function moveToDone(store, file, request, result) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const donePath = paths.publishDonePath(request.facilityId || 'unknown', request.weekStart || 'unknown', stamp);
  await store.writeJson(donePath, withResult(request, result));
  await rm(file.full, { force: true });
  log(`依頼ファイルを ${donePath} へ移しました`);
}

/* ------------------------------------------------------------
   入口
   ------------------------------------------------------------ */
async function main() {
  const store = createFsStore(DATA_DIR);
  const repo = createRepository(store);

  log(`データの場所：${DATA_DIR}`);
  if (DRY_RUN) log('お試しモード（--dry-run）：画像だけ作って、送信はしません');

  let files = await listRequestFiles();

  /* ためし用：依頼ファイルが無くても、事業所と週を指定すれば動かせる */
  if (!files.length && argOf('facility') && argOf('week')) {
    const facilities = await repo.loadFacilities();
    const facility = facilities.find(f => f.id === argOf('facility'));
    if (!facility) throw new Error(`事業所「${argOf('facility')}」が見つかりません`);
    const request = createPublishRequest({
      facility,
      weekStart: argOf('week'),
      requestedBy: '手動テスト'
    });
    log('（依頼ファイルは使わず、指定された事業所と週で作ります）');
    const result = await handleRequest(repo, store, request);
    log('できました：' + result.detail);
    return;
  }

  if (!files.length) {
    log('配信の依頼はありませんでした。何もしません。');
    return;
  }

  let failed = 0;
  for (const file of files) {
    log('');
    log(`=== ${file.path} ===`);
    /* 依頼ファイルそのものが読めないときも、1件の失敗としてあつかう
       （ここで全体を止めると、その依頼がずっと残ってしまうため） */
    let request = normalizePublishRequest(null);
    try {
      const read = await store.readJson(file.path);
      request = normalizePublishRequest(read ? read.data : null);
      const result = await handleRequest(repo, store, request);
      log('配信しました：' + result.detail);
      await moveToDone(store, file, request, { ok: true, ...result });
    } catch (e) {
      failed++;
      const message = e && e.message ? e.message : String(e);
      console.error(`配信できませんでした：${message}`);
      await moveToDone(store, file, request, { ok: false, detail: `${file.name}：${message}` });
    }
  }

  if (failed) {
    console.error('');
    console.error(`${failed}件の配信が失敗しました。上の理由を見てください。`);
    console.error('（依頼ファイルは done/ に移してあります。直したら、アプリで もう一度「確定して配信」をおしてください）');
    process.exitCode = 1;
  }
}

main().catch(e => {
  console.error('配信の処理が途中で止まりました：' + (e && e.message ? e.message : e));
  process.exitCode = 1;
});
