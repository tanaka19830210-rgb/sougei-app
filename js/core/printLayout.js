/* ============================================================
   印刷レイアウトの組み立て（A4たて1枚・6台 × 月〜土）

   ここは **アプリの印刷画面と、配信用のPNG作りの両方から使う** 共通の部品です。
   同じ紙面が2か所で作られて、だんだんズレていくのを防ぐためにここへ置いています。
   - 画面（print.html）      → js/ui/printScreen.js が呼ぶ
   - 配信（GitHub Actions） → tools/publish/run.js が呼ぶ
   DOM をいっさい触らないので、ブラウザでも Node でも動きます。
   ============================================================ */

import { escapeHtml } from './html.js';
import { capacity } from './schema.js';
import { driverOf } from './assign.js';
import { DAYS, dateOfDay, mdLabel, weekLongLabel, stampLabel } from './dates.js';
/* 車椅子アイコン。中身は文字（SVG）だけなので Node からも読めます */
import { ICON_WHEELCHAIR } from '../ui/icons.js';

const WCICON = ICON_WHEELCHAIR.replace('<svg', '<svg class="wcico"');

/* ---------- 運転手バッジ ---------- */
export function driverBadge(drivers, name) {
  if (!name) return '<div class="drv c-none"><i>？</i>未定</div>';
  const found = (drivers || []).find(d => d.name === name);
  const color = found ? found.color : 'none';
  const initial = found ? found.initial : name.slice(0, 1);
  return `<div class="drv c-${escapeHtml(color)}"><i>${escapeHtml(initial)}</i>${escapeHtml(name)}</div>`;
}

/* ---------- 1人分 ---------- */
function personLine(ctx, row) {
  const user = ctx.usersById[row.userId];
  const name = user ? user.name : '（マスタに無い方）';
  const wc = user && user.wheelchair ? WCICON : '';
  return `<div class="p${row.changed ? ' chg' : ''}">` +
    `<span class="n">${escapeHtml(name)}${wc}</span>` +
    `<span class="t">${escapeHtml(row.time || '')}</span></div>`;
}

/* ---------- 1マス（車 × 曜日 × 迎えor送り） ---------- */
function cellHtml(ctx, drivers, dirState, vanId) {
  const vanState = dirState && dirState.vans ? dirState.vans[vanId] : null;
  const driver = vanState ? driverOf(ctx, dirState, vanId) : '';
  const rows = vanState ? vanState.rows.filter(r => r.userId) : [];
  const body = rows.length
    ? rows.map(r => personLine(ctx, r)).join('')
    : '<div class="none">なし</div>';
  return driverBadge(drivers, driver) + body;
}

/* ---------- いちばん下のメモ欄 ---------- */
function notesCellHtml(ctx, dayState) {
  if (!dayState) return '';
  const notes = dayState.notes || [];
  const chips = notes
    .filter(n => n.kind === 'hand' || n.kind === 'ext')
    .map(n => `<span class="chip ${n.kind}">${escapeHtml(n.text)}</span>`)
    .join('');
  const texts = notes
    .filter(n => n.kind === 'plain')
    .map(n => `<div class="m">${escapeHtml(n.text)}</div>`)
    .join('');
  /* 車両ごとのメモも、紙では日ごとの欄にまとめて出す */
  const vanMemos = [];
  ['out', 'ret'].forEach(dir => {
    const dirState = dayState[dir];
    if (!dirState || !dirState.vans) return;
    Object.keys(dirState.vans).forEach(vanId => {
      const memo = (dirState.vans[vanId].memo || '').trim();
      if (!memo) return;
      const van = ctx.vansById[vanId];
      const label = van ? van.name : vanId;
      memo.split('\n').map(s => s.trim()).filter(Boolean).forEach(line => {
        vanMemos.push(`<div class="m">${escapeHtml(label)}：${escapeHtml(line)}</div>`);
      });
    });
  });
  return chips + texts + vanMemos.join('');
}

/* ============================================================
   紙面ぜんぶ（用紙の中身）を組み立てる
   ============================================================ */
export function buildPageHtml({ facility, ctx, drivers, plan, weekStart, now }) {
  const days = facility.days.length ? facility.days : DAYS.map(d => d.n);
  const dayInfos = days.map(n => {
    const date = dateOfDay(weekStart, n);
    const info = DAYS.find(d => d.n === n) || { n, label: String(n) };
    return { n, label: info.label, md: date ? mdLabel(date) : '' };
  });

  let html = `<div class="ph">
    <div class="brandmark"><div class="mk"></div>
      <div class="tx"><b>${escapeHtml(facility.company)}</b><i>${escapeHtml(facility.address)}</i></div></div>
    <span class="doc">${escapeHtml(facility.printTitle)}</span>
    <span class="wk">${escapeHtml(weekLongLabel(weekStart))}</span>
    <span class="sp"></span>
    <div class="meta">${escapeHtml(facility.name)}<br>${escapeHtml(stampLabel(now))}</div>
  </div>`;

  html += `<table>
    <colgroup><col class="vn"><col class="lg">${dayInfos.map(() => '<col>').join('')}</colgroup>
    <thead><tr><th class="h" colspan="2"></th>` +
    dayInfos.map(d => `<th class="d">${escapeHtml(d.md)}<small>${escapeHtml(d.label)}</small></th>`).join('') +
    '</tr></thead><tbody>';

  ctx.vans.forEach(van => {
    const note = van.note ? van.note : `${capacity(van)}名`;
    html += `<tr class="first">
      <td class="vn" rowspan="2"><b>${escapeHtml(van.name)}</b><small>${escapeHtml(note)}</small></td>
      <td class="lg"><span>迎え</span></td>` +
      dayInfos.map(d => {
        const dayState = plan.days[String(d.n)];
        return `<td class="cell">${cellHtml(ctx, drivers, dayState && dayState.out, van.id)}</td>`;
      }).join('') + '</tr>';
    html += '<tr><td class="lg"><span>送り</span></td>' +
      dayInfos.map(d => {
        const dayState = plan.days[String(d.n)];
        return `<td class="cell">${cellHtml(ctx, drivers, dayState && dayState.ret, van.id)}</td>`;
      }).join('') + '</tr>';
  });

  html += '<tr class="memo"><td class="mlab" colspan="2">メモ</td>' +
    dayInfos.map(d => `<td class="cell">${notesCellHtml(ctx, plan.days[String(d.n)])}</td>`).join('') +
    '</tr>';

  html += `</tbody></table>
    <div class="pfoot">
      <div>${escapeHtml(facility.company)}　この表は予定です。当日の変更は必ず事務所へ連絡してください。</div>
      <span class="sp"></span>
      <div class="sign"><div><span>作成者</span></div><div><span>確認者</span></div></div>
    </div>`;

  return html;
}

/* ============================================================
   1枚だけのHTMLファイルを作る（配信用のPNGを撮るときに使う）

   CSS を <style> の中に入れてしまうので、ネットにつながっていなくても
   同じ見た目になります（日本語のフォントだけは、その環境のものを使います）。
   ============================================================ */
export function buildStandaloneHtml({ facility, weekStart, pageHtml, cssTexts }) {
  const title = `${facility.printTitle} ${weekLongLabel(weekStart)}`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
${(cssTexts || []).join('\n')}
/* 画像にするときは、用紙のまわりの余白・影をなくして紙だけにする */
body{background:#fff;margin:0;
  /* Linux（GitHub Actions）で日本語が □ にならないように、そこにある日本語フォントも並べる */
  font-family:'Noto Sans JP','Noto Sans CJK JP','Hiragino Kaku Gothic ProN','Yu Gothic','IPAGothic',sans-serif;}
.stack{padding:0;}
.page{width:210mm;min-height:297mm;margin:0;box-shadow:none;}
</style>
</head>
<body>
<div class="stack"><div class="page" id="page">${pageHtml}</div></div>
</body>
</html>
`;
}
