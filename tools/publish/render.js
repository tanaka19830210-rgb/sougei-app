/* ============================================================
   送迎表を PNG の画像にする（ヘッドレスブラウザ Playwright を使う）

   ここは GitHub Actions の中だけで動きます。
   アプリ本体（js/ 配下）は、これまでどおり何も追加で入れずに動きます。

   やりかた
   - このマシンの中だけに小さな置き場を作る。アプリはこのリポジトリから、
     /data/ だけはデータ用リポジトリ（DATA_DIR）から出す。
   - アプリを index.html?render=1&f=<事業所>&w=<週> で開くと、保存した表を
     印刷と同じ大きさ（A4よこ）にして、body に data-render="ready" を付ける。
   - 印刷用の見た目（上の帯などを消す）にして、表のところだけを撮る。
   ============================================================ */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pngSize } from './png.js';

export { pngSize };

/* A4よこ（297mm×210mm）を画面のものさしにした大きさ。2倍で撮るとスマホでも字が読める */
export const PAPER = { width: 1123, height: 794 };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

/* 置き場を作る。port 0 で、あいている番号を使う */
export function startServer({ appDir, dataDir }) {
  const appRoot = resolve(appDir);
  const dataRoot = resolve(dataDir);
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const root = path.startsWith('/data/') ? dataRoot : appRoot;
      const target = normalize(join(root, path));
      if (!target.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
      const info = await stat(target).catch(() => null);
      if (!info || !info.isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(target));
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

export async function renderWeekPng({ appDir, dataDir, facilityId, weekStart, deviceScaleFactor = 2, timeoutMs = 60000, log = () => {} }) {
  const { chromium } = await import('playwright');
  const { server, port } = await startServer({ appDir, dataDir });
  const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
  try {
    const page = await browser.newPage({ viewport: PAPER, deviceScaleFactor });
    const problems = [];
    page.on('pageerror', e => problems.push(String(e && e.message || e)));
    await page.emulateMedia({ media: 'print' });
    const url = `http://127.0.0.1:${port}/index.html?render=1&f=${encodeURIComponent(facilityId)}&w=${encodeURIComponent(weekStart)}`;
    await page.goto(url, { waitUntil: 'load' });
    try {
      await page.waitForFunction(() => document.body.dataset.render, null, { timeout: timeoutMs });
    } catch (e) {
      throw new Error('表を開けませんでした' + (problems.length ? '：' + problems[0] : '（時間切れ）'));
    }
    const state = await page.evaluate(() => document.body.dataset.render);
    if (state !== 'ready') throw new Error(state.replace(/^error:/, ''));
    /* 日本語のフォントが読み込まれてから撮る（読み込み前だと □ になる） */
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(300);

    const target = await page.$('#stage');
    const buffer = await target.screenshot({ type: 'png' });
    const size = pngSize(buffer);
    log(`画像を作りました：${size ? `${size.width}×${size.height}px` : '大きさ不明'}　${buffer.length.toLocaleString('ja-JP')}バイト`);

    /* 文字が □ になっていないかの目安：真っ白すぎる画像は失敗とみなす */
    if (buffer.length < 20000) {
      throw new Error('画像がほとんど空です。日本語フォントが入っていないか、データが空の可能性があります');
    }
    return { buffer, size };
  } finally {
    await browser.close();
    server.close();
  }
}
