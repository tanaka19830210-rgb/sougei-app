/* ============================================================
   「確定して配信」のテスト

   ・配信依頼のファイル（どこに、どんな中身で置くか）
   ・GitHub の履歴に残る日本語のコミットメッセージ
   ・配信の結果の書き足し
   ・配信用の1枚ものHTML（PNGを撮るときに使うもの）
   ・Actions と同じやりかたで、本物のデータから紙面が作れること
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPublishRequest, normalizePublishRequest, withResult,
  publishMessageText, publishImageName, PUBLISH_SCHEMA_VERSION
} from '../js/core/publishRequest.js';
import { publishRequestPath, publishDonePath, PUBLISH_ROOT } from '../js/store/paths.js';
import { createRepository } from '../js/store/repository.js';
import { ConflictError } from '../js/store/errors.js';
import { buildPageHtml, buildStandaloneHtml } from '../js/core/printLayout.js';
import { createContext } from '../js/core/assign.js';
import { createFsStore } from '../tools/publish/fsStore.js';
import { makeFixture } from './fixture.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function memoryStore() {
  const files = new Map();
  const log = [];
  return {
    mode: 'test', label: 'テスト', files, log,
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

const YAHATA = { id: 'yahata', name: '生活介護 八幡', shortName: '八幡' };

/* ============================================================
   置き場所
   ============================================================ */
test('配信依頼：置き場所は publish-requests/事業所-週.json', () => {
  assert.equal(publishRequestPath('yahata', '2026-08-03'), 'publish-requests/yahata-2026-08-03.json');
  assert.equal(PUBLISH_ROOT, 'publish-requests');
});

test('配信依頼：終わったものは done/ に移す（同じ依頼で何度も動かないように）', () => {
  const done = publishDonePath('yahata', '2026-08-03', '20260729T093000');
  assert.equal(done, 'publish-requests/done/yahata-2026-08-03-20260729T093000.json');
  /* done/ の中は publish-requests/*.json に当たらないので、Actions が再び動かない */
  assert.ok(done.startsWith('publish-requests/done/'));
});

/* ============================================================
   中身
   ============================================================ */
test('配信依頼：だれが・いつ・どこの・どの週かが入る', () => {
  const request = createPublishRequest({
    facility: YAHATA,
    weekStart: '2026-08-03',
    requestedBy: '田中',
    now: new Date('2026-07-29T09:30:00Z')
  });
  assert.equal(request.schemaVersion, PUBLISH_SCHEMA_VERSION);
  assert.equal(request.facilityId, 'yahata');
  assert.equal(request.facilityName, '生活介護 八幡');
  assert.equal(request.weekStart, '2026-08-03');
  assert.equal(request.requestedBy, '田中');
  assert.equal(request.requestedAt, '2026-07-29T09:30:00.000Z');
  assert.equal(request.status, 'pending');
  assert.deepEqual(request.results, []);
});

test('トークに出る本文：やさしい日本語で、事業所と日付の範囲が分かる', () => {
  const text = publishMessageText({ facility: YAHATA, weekStart: '2026-08-03', requestedBy: '田中' });
  assert.equal(text,
    '送迎表ができました\n' +
    '生活介護 八幡　8/3(月)〜8/8(土)\n' +
    '（田中 が確定しました）\n' +
    '当日の変更は、必ず事務所へご連絡ください。');
});

test('トークに出る本文：名前の設定がなくても出せる', () => {
  const text = publishMessageText({ facility: YAHATA, weekStart: '2026-08-03', requestedBy: '' });
  assert.ok(!text.includes('（'));
  assert.match(text, /8\/3\(月\)〜8\/8\(土\)/);
});

test('画像のファイル名は、事業所と週が分かる形（日本語は使わない）', () => {
  assert.equal(publishImageName({ facilityId: 'yahata', weekStart: '2026-08-03' }), 'soutai-yahata-2026-08-03.png');
});

test('配信の結果：うまくいった記録を書き足せる', () => {
  const request = createPublishRequest({ facility: YAHATA, weekStart: '2026-08-03', requestedBy: '田中' });
  const done = withResult(request, { ok: true, detail: '送信しました', imageBytes: 240000, at: new Date('2026-07-29T09:31:00Z') });
  assert.equal(done.status, 'done');
  assert.equal(done.requestedBy, '田中', '依頼のときの内容は残る');
  assert.equal(done.results.length, 1);
  assert.deepEqual(done.results[0], {
    at: '2026-07-29T09:31:00.000Z', ok: true, detail: '送信しました', imageBytes: 240000
  });
});

test('配信の結果：失敗も理由つきで残る（Actions のログだけでなくファイルにも）', () => {
  const request = createPublishRequest({ facility: YAHATA, weekStart: '2026-08-03' });
  const failed = withResult(request, { ok: false, detail: 'GitHub Secrets が足りません：LW_BOT_ID（Bot ID）' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.results[0].ok, false);
  assert.match(failed.results[0].detail, /LW_BOT_ID/);
});

test('配信依頼：こわれた内容でも読み飛ばせる形に整える', () => {
  const r = normalizePublishRequest({ facilityId: 'yahata', status: 'なにか変な値', results: 'ちがう型' });
  assert.equal(r.status, 'pending');
  assert.deepEqual(r.results, []);
  assert.equal(r.weekStart, '');
  assert.equal(normalizePublishRequest(null).facilityId, '');
});

/* ============================================================
   保存（コミット）
   ============================================================ */
test('repository：配信依頼のコミットメッセージは「配信依頼 八幡 2026-08-03週」', async () => {
  const store = memoryStore();
  const repo = createRepository(store);
  const result = await repo.savePublishRequest({
    facility: YAHATA, weekStart: '2026-08-03', requestedBy: '田中'
  });
  assert.equal(store.log[0].path, 'publish-requests/yahata-2026-08-03.json');
  assert.equal(store.log[0].message, '配信依頼 八幡 2026-08-03週');
  const saved = JSON.parse(store.files.get('publish-requests/yahata-2026-08-03.json').text);
  assert.equal(saved.facilityId, 'yahata');
  assert.equal(saved.status, 'pending');
  assert.equal(result.request.weekStart, '2026-08-03');
});

test('repository：同じ週をもう一度配信しても、上書きできる（前の依頼が残っていても）', async () => {
  const store = memoryStore();
  const repo = createRepository(store);
  await repo.savePublishRequest({ facility: YAHATA, weekStart: '2026-08-03', requestedBy: '田中' });
  /* 別の端末で押した想定：sha を知らない状態から、もう一度 */
  const other = createRepository(store);
  await other.savePublishRequest({ facility: YAHATA, weekStart: '2026-08-03', requestedBy: '中村' });
  const saved = JSON.parse(store.files.get('publish-requests/yahata-2026-08-03.json').text);
  assert.equal(saved.requestedBy, '中村');
  assert.equal(store.log.length, 2);
});

/* ============================================================
   配信用の1枚ものHTML
   ============================================================ */
test('配信用HTML：CSSを中に入れた1枚のファイルになる（ネットにつながっていなくても同じ見た目）', () => {
  const { facility, ctx, plan } = makeFixture();
  const pageHtml = buildPageHtml({ facility, ctx, drivers: [], plan, weekStart: '2026-08-03', now: new Date() });
  const html = buildStandaloneHtml({
    facility, weekStart: '2026-08-03', pageHtml,
    cssTexts: ['.page{color:#123456}', '.drv{font-weight:700}']
  });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<meta charset="UTF-8">/);
  assert.match(html, /\.page\{color:#123456\}/);
  assert.match(html, /\.drv\{font-weight:700\}/);
  assert.ok(html.includes(pageHtml), '紙面はそのまま入る');
  assert.match(html, /<div class="page" id="page">/);
  assert.match(html, /\.page\{width:210mm/, '画像は用紙ぴったりにする');
  assert.match(html, /<title>テスト送迎表 2026年8月3日（月）〜 8日（土）<\/title>/);
});

/* ============================================================
   Actions と同じやりかたで、ファイルから紙面を作れるか
   （ここが通れば、配信で使うデータの読み方はアプリと同じ）
   ============================================================ */
test('ファイルから読む：無いファイルは null、書くとフォルダごと作られる', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'soutai-test-'));
  const store = createFsStore(dir);
  assert.equal(await store.readJson('publish-requests/none.json'), null);
  await store.writeJson('publish-requests/done/yahata-2026-08-03-1.json', { status: 'done' });
  const back = await store.readJson('publish-requests/done/yahata-2026-08-03-1.json');
  assert.equal(back.data.status, 'done');
  const text = await readFile(join(dir, 'publish-requests/done/yahata-2026-08-03-1.json'), 'utf8');
  assert.ok(text.endsWith('\n'), '行末で終わる（GitHub で見やすいように）');
});

test('配信の下ごしらえ：本物のデータ（data/）から八幡の紙面が組める', async () => {
  const repo = createRepository(createFsStore(APP_DIR));
  const facilities = await repo.loadFacilities();
  const facility = facilities.find(f => f.id === 'yahata');
  assert.ok(facility, 'data/facilities.json に八幡がある');

  const masters = await repo.loadMasters('yahata');
  assert.ok(masters.users.length > 0);
  assert.ok(masters.vans.length > 0);

  const loaded = await repo.loadPlan({ facility, vans: masters.vans, weekStart: '2026-08-03' });
  assert.equal(loaded.exists, true, 'data/yahata/plans/2026-08-03.json が読める');

  const ctx = createContext({
    facility, users: masters.users, vans: masters.vans, ngPairs: masters.ngPairs
  });
  const pageHtml = buildPageHtml({
    facility, ctx, drivers: masters.drivers, plan: loaded.plan,
    weekStart: '2026-08-03', now: new Date(2026, 6, 29, 14, 5)
  });
  assert.match(pageHtml, /ファニー送迎表/);
  assert.match(pageHtml, /生活介護 八幡/);
  assert.match(pageHtml, /井上 健太/);
  assert.equal((pageHtml.match(/<th class="d">/g) || []).length, 6, '月〜土の6列');

  const html = buildStandaloneHtml({
    facility, weekStart: '2026-08-03', pageHtml,
    cssTexts: [await readFile(join(APP_DIR, 'css/base.css'), 'utf8'), await readFile(join(APP_DIR, 'css/print.css'), 'utf8')]
  });
  assert.ok(html.length > 10000, '中身のあるHTMLになっている');
  assert.match(html, /Noto Sans JP/, '印刷用のフォント指定が入っている');
});
