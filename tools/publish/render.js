/* ============================================================
   HTML を PNG の画像にする（ヘッドレスブラウザ Playwright を使う）

   ここは GitHub Actions の中だけで動きます。
   アプリ本体（js/ 配下）は、これまでどおり何も追加で入れずに動きます。

   大きさの考えかた
   - A4たての横幅 210mm は、ふつうの画面のものさしで 794px。
   - そのままだと文字が小さいので deviceScaleFactor（拡大率）を上げて撮る。
     2倍で 1588px 幅になり、スマホのトークで開いても字が読めます。
   ============================================================ */

import { chromium } from 'playwright';
import { pngSize } from './png.js';

export const A4_WIDTH_PX = 794;          /* 210mm ÷ 25.4 × 96dpi ≒ 794 */
export const A4_HEIGHT_PX = 1123;        /* 297mm ぶん */

export { pngSize };

export async function renderPng({ html, deviceScaleFactor = 2, log = () => {} }) {
  const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
  try {
    const page = await browser.newPage({
      viewport: { width: A4_WIDTH_PX, height: A4_HEIGHT_PX },
      deviceScaleFactor
    });
    await page.setContent(html, { waitUntil: 'load' });
    /* 日本語のフォントが読み込まれてから撮る（読み込み前だと □ になる） */
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(300);

    const target = await page.$('.page');
    const buffer = target
      ? await target.screenshot({ type: 'png' })
      : await page.screenshot({ type: 'png', fullPage: true });

    const size = pngSize(buffer);
    log(`画像を作りました：${size ? `${size.width}×${size.height}px` : '大きさ不明'}　${buffer.length.toLocaleString('ja-JP')}バイト`);

    /* 文字が □ になっていないかの目安：真っ白すぎる画像は失敗とみなす */
    if (buffer.length < 20000) {
      throw new Error('画像がほとんど空です。日本語フォントが入っていないか、データが空の可能性があります');
    }
    return { buffer, size };
  } finally {
    await browser.close();
  }
}
