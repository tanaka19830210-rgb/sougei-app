/* ============================================================
   このパソコンの中だけで動く、かんたんな置き場（静的サーバ）

   使い方：
     node tools/serve.js
   そのあと、ブラウザで  http://localhost:8080  を開く。
   とめるときは、この黒い画面で Ctrl と C を同時におす。

   Node に最初から入っている機能だけで動きます（npm install は不要）。
   ============================================================ */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);

/* ブラウザに「これは何のファイルか」を伝える表。
   .js を text/javascript で返さないと ESモジュールが読みこめない。 */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path.endsWith('/')) path += 'index.html';

    /* フォルダの外へ出られないようにする */
    const target = normalize(join(ROOT, path));
    if (!target.startsWith(ROOT + sep)) {
      res.writeHead(403, { 'Content-Type': TYPES['.txt'] });
      res.end('403 みられません');
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': TYPES['.txt'] });
      res.end('404 ファイルがありません: ' + path);
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': TYPES['.txt'] });
    res.end('500 ' + String(e));
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  送迎表アプリを開けるようにしました。');
  console.log('  ブラウザで  http://localhost:' + PORT + '  を開いてください。');
  console.log('  とめるときは Ctrl と C を同時におします。');
  console.log('');
});
