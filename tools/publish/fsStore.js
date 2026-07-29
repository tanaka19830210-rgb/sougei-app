/* ============================================================
   パソコン（Actions のマシン）の中のファイルを読む保存先

   アプリの githubStore / localStore と同じ形にしてあるので、
   js/store/repository.js をそのまま使えます。
   ＝データの読みかた・整えかたが、アプリと配信でズレません。
   ============================================================ */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export function createFsStore(rootDir) {
  const root = resolve(rootDir);
  return {
    mode: 'fs',
    label: `ファイル（${root}）`,
    root,

    async readJson(path) {
      const file = join(root, path);
      let text;
      try {
        text = await readFile(file, 'utf8');
      } catch (e) {
        if (e && e.code === 'ENOENT') return null;      /* まだ無いファイル */
        throw e;
      }
      try {
        return { data: JSON.parse(text), sha: 'fs', path };
      } catch (e) {
        throw new Error(`${path} の中身が JSON として読めませんでした：${e.message}`);
      }
    },

    async writeJson(path, data) {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
      return { sha: 'fs', path };
    }
  };
}
