/* ============================================================
   書きまちがい探し（ブラウザを開かずに確かめる）

     node tools/check.js

   1. すべての .js に文法のまちがいがないか（node --check）
   2. HTML の中の <script> にまちがいがないか
   3. HTML から呼んでいる css/js/画像のファイルが本当にあるか
   4. data/ の JSON が読める形になっているか
   5. JS がさわろうとしている id が、その画面の HTML にあるか
      （ここが食い違うと、ブラウザで開いたときだけ動かなくなる）
   6. data/ に、本物の利用者のお名前がまぎれこんでいないか
      （このリポジトリは公開です。ここが最後の関所になります）
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

/* ============================================================
   6. data/ に本物のお名前がまぎれこんでいないか

   このリポジトリ（sougei-app）は公開されています。
   本物の利用者データは、非公開の sougei-data にしか置きません。
   うっかり公開側へコピーしてしまう事故を、ここで止めます。
   ============================================================ */
const allowed = new Set(JSON.parse(readFileSync(join(ROOT, 'tools/dummy-names.json'), 'utf8')).names);
/*
  見るのは「お名前」と「いつもの運転手」だけ。
  バッジの1文字（initial）は名字の頭字なので、止めても意味がなく、
  警告が増えるぶん本物の警告が埋もれる。
*/
const nameKeys = ['name', 'driver'];

function realNameCheck(value, where) {
  checked++;
  const name = String(value || '').trim();
  if (!name || allowed.has(name)) return;
  problems.push(
    `見なれないお名前が公開リポジトリにあります: 「${name}」（${where}）\n` +
    '    本物の利用者・職員のお名前なら、ここから消してください。' +
    'このリポジトリは公開されています。本物は非公開の sougei-data に入れます。\n' +
    '    新しいダミーとして足したのなら、tools/dummy-names.json にも書き足してください。'
  );
}

walk(join(ROOT, 'data')).filter(f => f.endsWith('.json')).forEach(file => {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (rel.endsWith('facilities.json')) return;      /* 事業所名は本物でよい */
  let json;
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return; }  /* 4 で報告ずみ */
  ['users', 'vans', 'drivers'].forEach(key => {
    (Array.isArray(json[key]) ? json[key] : []).forEach(item => {
      if (!item || typeof item !== 'object') return;
      nameKeys.forEach(k => { if (item[k]) realNameCheck(item[k], `${rel} の ${key}`); });
    });
  });
});

console.log(`${checked}か所を調べました。`);
if (problems.length) {
  console.log('');
  problems.forEach(p => console.log('× ' + p));
  process.exitCode = 1;
} else {
  console.log('まちがいは見つかりませんでした。');
}
