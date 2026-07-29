/* ============================================================
   印刷画面（print.html）
   A4たて1枚に「6台 × 月〜土」の迎え・送りを並べる。
   組版は soutai_print_a4_6vans.html のものをそのまま使い、
   中身だけを実際の週次プランから作る。
   ============================================================ */

import { bootstrap, loadFacilityContext, pickFacility, readParams } from './appShell.js';
import { escapeHtml, setBanner, errorMessage } from './dom.js';
import { ICON_WHEELCHAIR } from './icons.js';
import * as A from '../core/assign.js';
import { capacity } from '../core/schema.js';
import { DAYS, dateOfDay, mdLabel, weekLongLabel, weekKeyOf, parseDateKey, stampLabel } from '../core/dates.js';

const WCICON = ICON_WHEELCHAIR.replace('<svg', '<svg class="wcico"');

/* ---------- 運転手バッジ ---------- */
function driverBadge(drivers, name) {
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
  const driver = vanState ? A.driverOf(ctx, dirState, vanId) : '';
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
   紙面ぜんぶを組み立てる
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
   起動
   ============================================================ */
export async function start() {
  try {
    const boot = await bootstrap();
    const params = readParams();
    const facility = params.facilityId
      ? (pickFacility(boot.facilities, params.facilityId) || boot.facility)
      : boot.facility;
    if (!facility) {
      setBanner('banner', '事業所のデータが読めませんでした。設定を確認してください。', 'error');
      return;
    }
    const asked = parseDateKey(params.weekStart);
    const weekStart = asked ? weekKeyOf(asked) : weekKeyOf(new Date());

    const masters = await loadFacilityContext(boot.repo, facility);
    const { plan, exists } = await boot.repo.loadPlan({
      facility,
      vans: masters.vans,
      weekStart
    });

    document.getElementById('page').innerHTML = buildPageHtml({
      facility,
      ctx: masters.ctx,
      drivers: masters.drivers,
      plan,
      weekStart,
      now: new Date()
    });

    document.getElementById('weeklabel').textContent = weekLongLabel(weekStart);
    const back = document.getElementById('back');
    back.href = `index.html?facility=${encodeURIComponent(facility.id)}&week=${encodeURIComponent(weekStart)}`;
    document.getElementById('printbtn').onclick = () => window.print();

    if (!exists) {
      setBanner('banner',
        'この週の送迎表は、まだ保存されていません。' +
        '<a href="' + back.href + '">割り当て画面</a>で作って保存してください。', 'warn');
    }
  } catch (e) {
    setBanner('banner', `うまく開けませんでした：${escapeHtml(errorMessage(e))}`, 'error');
    console.error(e);
  }
}
