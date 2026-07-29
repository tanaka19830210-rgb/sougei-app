/* ============================================================
   書きまちがい探し（ブラウザを開かずに確かめる）

     node tools/check.js

   1. すべての .js に文法のまちがいがないか（node --check）
   2. HTML の中の <script> にまちがいがないか
   3. HTML から呼んでいる css/js/画像のファイルが本当にあるか
   4. data/ の JSON が読める形になっているか
   5. JS がさわろうとしている id が、その画面の HTML にあるか
      （ここが食い違うと、ブラウザで開いたときだけ動かなくなる）
   ============================================================ */

import { readdirSync, readFileSync, statSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', 'node_modules']);
const problems = [];
let checked = 0;

function walk(dir) {
  const files = [];
  readdirSync(dir).forEach(name => {
    if (SKIP.has(name)) return;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  });
  return files;
}

function nodeCheck(file, label) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  checked++;
  if (result.status !== 0) {
    problems.push(`${label}\n${(result.stderr || '').trim()}`);
  }
}

const files = walk(ROOT);
const temp = mkdtempSync(join(tmpdir(), 'soutai-check-'));

/* 1. JavaScript */
files.filter(f => extname(f) === '.js').forEach(file => {
  nodeCheck(file, `文法エラー: ${relative(ROOT, file)}`);
});

/* 2 と 3. HTML */
files.filter(f => extname(f) === '.html').forEach(file => {
  const rel = relative(ROOT, file);
  const html = readFileSync(file, 'utf8');

  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  scripts.forEach((m, i) => {
    const code = m[1].trim();
    if (!code) return;
    const tempFile = join(temp, `${rel.replace(/[\\/]/g, '_')}.${i}.mjs`);
    writeFileSync(tempFile, code, 'utf8');
    nodeCheck(tempFile, `文法エラー: ${rel} の ${i + 1}番目の <script>`);
  });

  [...html.matchAll(/(?:href|src)="([^"]+)"/g)].forEach(m => {
    const target = m[1];
    if (/^(https?:)?\/\//.test(target) || target.startsWith('#') || target.startsWith('data:')) return;
    const path = target.split('?')[0].split('#')[0];
    try {
      statSync(join(dirname(file), path));
    } catch (e) {
      problems.push(`ファイルがありません: ${rel} から呼んでいる ${path}`);
    }
    checked++;
  });
});

/* 4. JSON */
files.filter(f => extname(f) === '.json').forEach(file => {
  checked++;
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    problems.push(`JSONが読めません: ${relative(ROOT, file)}\n${e.message}`);
  }
});

/* 5. 画面ごとに、JS がさわる id が HTML にあるか */
const SCREENS = [
  { html: 'index.html', js: ['js/ui/assignScreen.js', 'js/ui/assignRender.js', 'js/ui/drag.js'] },
  { html: 'print.html', js: ['js/ui/printScreen.js'] },
  { html: 'settings.html', js: ['js/ui/settingsScreen.js'] },
  { html: 'masters.html', js: ['js/ui/mastersScreen.js'] }
];
/* dom.js が自分で作る（HTMLに無くてもよい）もの */
const MADE_BY_JS = new Set(['toast', 'veil']);

SCREENS.forEach(screen => {
  const html = readFileSync(join(ROOT, screen.html), 'utf8');
  const ids = new Set();
  screen.js.forEach(file => {
    const code = readFileSync(join(ROOT, file), 'utf8');
    [...code.matchAll(/getElementById\('([^']+)'\)/g)].forEach(m => ids.add(m[1]));
    [...code.matchAll(/querySelector(?:All)?\('#([\w-]+)/g)].forEach(m => ids.add(m[1]));
  });
  ids.forEach(id => {
    checked++;
    if (MADE_BY_JS.has(id)) return;
    if (!new RegExp(`id="${id}"`).test(html)) {
      problems.push(`id がありません: ${screen.html} に id="${id}"（JS がさわろうとしています）`);
    }
  });
});

rmSync(temp, { recursive: true, force: true });

console.log(`${checked}か所を調べました。`);
if (problems.length) {
  console.log('');
  problems.forEach(p => console.log('× ' + p));
  process.exitCode = 1;
} else {
  console.log('まちがいは見つかりませんでした。');
}
