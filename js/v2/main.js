/* ============================================================
   送迎表の画面（v2）のまとめ役

   流れ：
   1. 週をひらく。まだ作っていない週なら、これまでの表から自動で下書きを作る
   2. 「AIに伝える」で今週の事情を声か文字で伝える → 変更が色つきで出る → 「これでよい」
   3. のこりは名前の札を指で動かして直す
   4. 「保存」
   ============================================================ */

import { loadConfig, saveConfig, isGithubReady } from '../config.js';
import { GATE, loadGateSession, saveGateSession, clearGateSession } from '../gate-config.js';
import { createStore } from '../store/index.js';
import { callGate } from '../store/gateStore.js';
import { createRepository } from '../store/repository.js';
import { currentWeekKey, shiftWeekKey, weekLongLabel, weekShortLabel } from '../core/dates.js';
import { escapeHtml } from '../core/html.js';
import * as M from './model.js';
import { buildDraft } from './draft.js';
import { applyAttendance, checkAttendance, hasAttendance, expectedOn, attendanceToText } from './attendance.js';
import { askAi } from './ai.js';
import { voiceSupported, createVoice } from './voice.js';
import { createBoard } from './board.js';
import { createPublishRequest } from '../core/publishRequest.js';

const $ = id => document.getElementById(id);
const weekPath = (fid, key) => `data/${fid}/weeks/${key}.json`;
const rulesPath = fid => `data/${fid}/rules.json`;
const attendancePath = (fid, key) => `data/${fid}/attendance/${key}.json`;
const HISTORY_WEEKS = 8;
/* 日曜にひらいたときは、翌日からの週を「今週」とする（currentWeekKey の決まり） */
const thisWeek = () => currentWeekKey();
const nextWeek = () => shiftWeekKey(currentWeekKey(), 1);

const app = {
  config: null, store: null, facilities: [], facility: null,
  weekKey: '', week: null, exists: false, dirty: false,
  warnings: [], attendance: null, history: [], roster: { people: [], drivers: [], capacity: {} },
  rules: [], undo: [], preview: null, shas: new Map(), board: null, gate: null
};

/* ---------- 小さな道具 ---------- */
let toastTimer = null;
function toast(message, kind) {
  const node = $('toast');
  node.textContent = message;
  node.className = 'show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = ''; }, kind === 'error' ? 6500 : 3200);
}

function strip(html, kind) {
  const node = $('strip');
  if (!html) { node.className = 'strip hide'; node.innerHTML = ''; app.board && requestAnimationFrame(refit); return; }
  node.className = 'strip' + (kind ? ' ' + kind : '');
  node.innerHTML = `<span>${html}</span><button class="x" type="button" aria-label="とじる">×</button>`;
  node.querySelector('.x').onclick = () => strip('');
  app.board && requestAnimationFrame(refit);
}

function refit() { if (app.board.isFit) app.board.fit(); }

async function readFile(path) {
  const result = await app.store.readJson(path);
  if (result) app.shas.set(path, result.sha);
  return result ? result.data : null;
}
async function writeFile(path, data, message) {
  const result = await app.store.writeJson(path, data, { sha: app.shas.get(path), message });
  app.shas.set(path, result.sha);
}

/* 下から出る入力らん。閉じるときに resolve する */
function openSheet(html, { middle = false } = {}) {
  $('sheet').innerHTML = html;
  $('shade').className = 'shade show' + (middle ? ' mid' : '');
  return $('sheet');
}
function closeSheet() { $('shade').className = 'shade'; $('sheet').innerHTML = ''; }

/* ---------- 描きなおす ---------- */
function draw() {
  const showing = app.preview ? app.preview.week : app.week;
  const warnings = [...M.checkWeek(showing, app.roster), ...checkAttendance(showing, app.attendance)];
  app.board.render({ week: showing, warnings, changes: app.preview ? app.preview.changes : [], locked: !!app.preview, roster: app.roster });
  $('weeklabel').textContent = weekShortLabel(app.weekKey);
  /* 作るのは今週と来週だけ。どちらを開いているかを、ボタンの色で示す */
  $('prev').classList.toggle('solid', app.weekKey === thisWeek());
  $('next').classList.toggle('solid', app.weekKey === nextWeek());
  $('printhead').textContent = `${app.facility.printTitle || app.facility.name}　${weekLongLabel(app.weekKey)}`;
  $('undo').disabled = !app.undo.length || !!app.preview;
  $('save').classList.toggle('dirty', app.dirty);
  /* 保存するものが無いときは、「保存する」のまま灰色にして押せなくする */
  $('save').disabled = !app.dirty || !!app.preview;
  ['ai','rules', 'prev', 'next', 'facility', 'print', 'send'].forEach(id => { $(id).disabled = !!app.preview; });
  const w = $('warn');
  const shown = warnings.filter(x => !x.quiet);
  app.warnings = shown.map(x => x.text);
  w.hidden = !shown.length;
  w.textContent = `⚠ 矛盾 ${shown.length}`;
  $('rules').textContent = `送迎ルール ${app.rules.length}`;
  w.onclick = () => {
    const sheet = openSheet(`<h3>つじつまが合っていない所（${shown.length}）</h3><ul class="warnlist">${shown.map(x => `<li>${escapeHtml(x.text)}</li>`).join('')}</ul><div class="row">${shown.some(x => x.kind) ? '<button class="btn2" data-fit type="button">利用予定に合わせて直す</button>' : ''}<div class="grow"></div><button class="btn2" data-close>とじる</button></div>`, { middle: true });
    sheet.querySelector('[data-close]').onclick = closeSheet;
    const fitBtn = sheet.querySelector('[data-fit]');
    if (fitBtn) fitBtn.onclick = () => { closeSheet(); fitToAttendance(); };
  };
  if (app.board.isFit) app.board.fit();
}

/* 表を変える。変える前の形を「戻す」用に取っておく */
function commit(nextWeek) {
  app.undo.push(M.clone(app.week));
  if (app.undo.length > 40) app.undo.shift();
  app.week = nextWeek;
  app.dirty = true;
  draw();
}

function applyAndCommit(ops) {
  const result = M.applyOps(app.week, ops);
  if (result.problems.length) toast(result.problems[0], 'warn');
  commit(result.week);
}

/* ---------- 週をひらく ---------- */
async function loadHistory() {
  const keys = Array.from({ length: HISTORY_WEEKS }, (_, i) => shiftWeekKey(app.weekKey, -(i + 1)));
  const files = await Promise.all(keys.map(k => app.store.readJson(weekPath(app.facility.id, k)).catch(() => null)));
  return files
    .map((f, i) => f ? M.normalizeWeek(f.data, { facilityId: app.facility.id, weekStart: keys[i] }) : null)
    .filter(w => w && w.vans.length && M.DAY_NUMBERS.some(d => M.dayCounts(w, d).all));
}

/* 利用予定に合わせた結果を、上の帯に出す言葉にする */
function attendanceWords(r) {
  if (!r || !r.used) return '';
  const uniq = list => [...new Set(list.map(x => x.name))];
  const names = list => uniq(list).slice(0, 8).map(n => escapeHtml(n) + '様').join('・') + (uniq(list).length > 8 ? ' ほか' : '');
  /* 読みやすいよう、わくの説明ごとに行を分ける */
  const lines = [`<b>利用予定（${escapeHtml(readAtLabel())}）に合わせました。</b>`];
  if (r.added.length || r.moved.length) lines.push(`<i class="planned">緑わく</i>＝足した人・場所を直した人（${names([...r.added, ...r.moved])}）`);
  if (r.removed.length) lines.push(`はずした人：${names(r.removed)}`);
  if (r.unplaced.length) lines.push(`<b style="color:#a3261b">乗せる車が決まらない人：${names(r.unplaced)}</b>（「⚠ 矛盾」に出ています）`);
  return lines.join('<br>');
}

function readAtLabel() {
  const t = app.attendance && app.attendance.readAt ? new Date(app.attendance.readAt) : null;
  if (!t || isNaN(t)) return '読みこみ日時不明';
  return `${t.getMonth() + 1}/${t.getDate()} ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')} 読みこみ`;
}

/* いまの表を、利用予定に合わせて直す（「戻す」で元にもどせる） */
function fitToAttendance() {
  if (!hasAttendance(app.attendance)) { toast('この週の利用予定は、まだ読みこまれていません', 'warn'); return; }
  const r = applyAttendance(app.week, app.attendance, [app.week, ...app.history]);
  commit(r.week);
  strip(attendanceWords(r) || '利用予定と合っています。');
}

function draftStrip(summary, fitted) {
  if (!summary.copiedFrom) return strip('これまでの表がまだ無いので、空の表です。「⋯」から車を足して、人を入れてください。', 'warn');
  const names = list => [...new Set(list.map(x => x.name))].slice(0, 8).map(n => escapeHtml(n) + '様').join('・') + (new Set(list.map(x => x.name)).size > 8 ? ' ほか' : '');
  const lines = [`<b>${weekLongLabel(summary.copiedFrom)}</b> の表をもとに下書きを作りました。`];
  if (summary.restored.length) lines.push(`<i class="restored">青わく</i>＝先週お休みだったので戻した人（${names(summary.restored)}）`);
  if (summary.onlyLast.length) lines.push(`<i class="onlyLast">点線わく</i>＝先週だけ乗っていた人（${names(summary.onlyLast)}）`);
  const words = attendanceWords(fitted);
  if (words) lines.push(words);
  lines.push('今週の事情は「AIに伝える」でどうぞ。');
  strip(lines.join('<br>'));
}

async function openWeek(key) {
  app.weekKey = key;
  app.undo = []; app.preview = null; $('confirm').classList.remove('show');
  strip('読みこんでいます…');
  try {
    const [file, history, rules, attendance] = await Promise.all([
      readFile(weekPath(app.facility.id, key)),
      loadHistory(),
      readFile(rulesPath(app.facility.id)),
      app.store.readJson(attendancePath(app.facility.id, key)).then(f => (f ? f.data : null)).catch(() => null)
    ]);
    app.attendance = attendance;
    app.history = history;
    app.rules = rules && Array.isArray(rules.rules) ? rules.rules.map(String) : [];
    app.exists = !!file;
    if (file) {
      app.week = M.normalizeWeek(file, { facilityId: app.facility.id, weekStart: key });
      app.dirty = false;
      strip('');
    } else {
      const draft = buildDraft({ facilityId: app.facility.id, weekStart: key, history });
      const fitted = applyAttendance(draft.week, attendance, history);
      app.week = fitted.week;
      app.dirty = !!draft.summary.copiedFrom;
      draftStrip(draft.summary, fitted);
    }
    app.roster = M.rosterFrom([app.week, ...history]);
    draw();
    app.board.fit();
  } catch (e) {
    console.error(e);
    if (loginAgainIfNeeded(e)) return;
    app.week = app.week || M.createEmptyWeek({ facilityId: app.facility.id, weekStart: key });
    draw();
    strip(escapeHtml(e.message || String(e)), 'error');
  }
}

async function leaveOk() {
  if (!app.dirty) return true;
  return window.confirm('まだ保存していない変更があります。保存せずに移りますか？');
}

/* ---------- 保存 ---------- */
async function save() {
  const data = { ...app.week, schemaVersion: M.SCHEMA_VERSION, facilityId: app.facility.id, weekStart: app.weekKey, updatedAt: new Date().toISOString(), updatedBy: app.config.editorName || (app.gate ? app.gate.email : '') };
  $('save').disabled = true;
  try {
    await writeFile(weekPath(app.facility.id, app.weekKey), data, `送迎表 ${app.facility.shortName || app.facility.name} ${app.weekKey}週 を更新`);
    app.dirty = false; app.exists = true;
    toast(app.store.mode === 'local' ? 'この端末の中に保存しました（お試しモード）' : '保存しました');
  } catch (e) {
    console.error(e);
    if (e.name === 'AuthError' && app.store.mode === 'gate') { toast('ログインの期限が切れました。この画面のまま、別のタブでログインしなおしてから、もう一度「保存する」を押してください', 'error'); draw(); return; }
    toast(e.name === 'ConflictError' ? 'ほかの人が先に保存しています。開きなおしてから直してください。' : '保存できませんでした：' + (e.message || e), 'error');
  }
  draw();
}

/* ---------- 人・運転手・連絡・車を直す入力らん ---------- */
function riderSheet(pos, isNew) {
  const trip = app.week.days[pos.day].trips[pos.vanId][pos.leg];
  const row = isNew ? { name: '', place: '', time: '' } : trip.rows[pos.index];
  const van = app.week.vans.find(v => v.id === pos.vanId);
  const person = app.roster.people.find(p => p.name === M.personKey(row.name));
  /* 名簿の人を、押すだけで入れられるボタンにする。この便にまだ乗っていない人を先にならべる */
  const ridingNow = new Set();
  app.week.vans.forEach(v => app.week.days[pos.day].trips[v.id][pos.leg].rows.forEach(r => ridingNow.add(M.personKey(r.name))));
  /* 利用予定があるのに、この便にまだ乗っていない人をいちばん先に（色つきで）出す */
  const planned = expectedOn(app.attendance, pos.day);
  const wantsLeg = e => e && (pos.leg === 'out' ? e.out !== false : e.ret !== false);
  const known = new Set(app.roster.people.map(p => p.name));
  const extra = [...planned.keys()].filter(n => !known.has(n)).map(n => ({ name: n, places: [] }));
  const people = [...app.roster.people, ...extra].map(p => ({ ...p,
    riding: ridingNow.has(p.name) && p.name !== M.personKey(row.name),
    planned: wantsLeg(planned.get(p.name)) && !ridingNow.has(p.name) }))
    .sort((a, b) => (b.planned - a.planned) || (a.riding - b.riding));
  const places = [...new Set([...(person ? person.places : []), '自宅', ...app.roster.people.flatMap(p => p.places)])].filter(Boolean).slice(0, 10);
  const sheet = openSheet(`
    <h3>${M.DAY_NAMES[pos.day]}曜・${escapeHtml(van.name)}・${M.LEG_NAMES[pos.leg]}${isNew ? ' に人を足す' : ''}</h3>
    <label>利用者名</label>
    <input type="text" id="f-name" value="${escapeHtml(row.name)}" autocomplete="off">
    <div class="quick people">${people.map(p => `<button type="button" data-person="${escapeHtml(p.name)}" class="${p.riding ? 'riding' : p.planned ? 'planned' : ''}">${escapeHtml(p.name)}</button>`).join('')}</div>
    ${people.some(p => p.planned) ? '<p class="mini">緑の方は、利用予定があるのに この便にまだ乗っていません。</p>' : ''}
    ${people.some(p => p.riding) ? '<p class="mini">うすい色の方は、この便ですでにどこかの車に乗っています。</p>' : ''}
    <label>乗る場所（自宅なら空でよい）</label>
    <input type="text" id="f-place" value="${escapeHtml(row.place)}" autocomplete="off">
    <div class="quick">${places.map(p => `<button type="button" data-place="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}</div>
    <label>時刻</label>
    <input type="time" id="f-time" value="${row.time}" step="300">
    <div class="row">
      ${isNew ? '' : '<button class="btn2 danger" id="f-del" type="button">はずす</button>'}
      <div class="grow"></div>
      <button class="btn2" id="f-cancel" type="button">やめる</button>
      <button class="btn2 go" id="f-ok" type="button">決定</button>
    </div>`, { middle: true });
  sheet.querySelectorAll('[data-place]').forEach(b => { b.onclick = () => { $('f-place').value = b.dataset.place === '自宅' && !row.place ? '自宅' : b.dataset.place; }; });
  sheet.querySelectorAll('[data-person]').forEach(b => { b.onclick = () => {
    $('f-name').value = b.dataset.person;
    /* 乗る場所がまだ空なら、その人がいちばんよく乗る場所を入れておく（あとで直せる） */
    const p = app.roster.people.find(x => x.name === b.dataset.person);
    if (isNew && p && !$('f-place').value) $('f-place').value = p.places[0] || '';
    sheet.querySelectorAll('[data-person]').forEach(x => x.classList.toggle('on', x === b));
  }; });
  $('f-cancel').onclick = closeSheet;
  if (!isNew) $('f-del').onclick = () => { closeSheet(); removeAt(pos); };
  $('f-ok').onclick = () => {
    const name = M.personKey($('f-name').value);
    if (!name) { toast('利用者名を入れてください', 'warn'); return; }
    const next = M.clone(app.week);
    const rows = next.days[pos.day].trips[pos.vanId][pos.leg].rows;
    const value = { name, place: $('f-place').value.trim(), time: M.normTime($('f-time').value) };
    if (isNew && M.isFull(next, pos.vanId, pos.day, pos.leg)) { toast('その便は満席です', 'warn'); return; }
    if (isNew) {
      const at = value.time ? rows.findIndex(r => r.time && r.time > value.time) : -1;
      rows.splice(at >= 0 ? at : rows.length, 0, value);
    } else rows[pos.index] = value;
    closeSheet();
    commit(next);
  };

}

function removeAt(pos) {
  const next = M.clone(app.week);
  next.days[pos.day].trips[pos.vanId][pos.leg].rows.splice(pos.index, 1);
  commit(next);
}

function moveRider(from, to) {
  const next = M.clone(app.week);
  const src = next.days[from.day].trips[from.vanId][from.leg].rows;
  const [row] = src.splice(from.index, 1);
  if (!row) return;
  const sameCell = from.day === to.day && from.vanId === to.vanId && from.leg === to.leg;
  if (!sameCell && M.isFull(next, to.vanId, to.day, to.leg)) { toast('その便は満席です', 'warn'); return; }
  delete row.flag;
  if (from.leg !== to.leg) row.time = '';
  next.days[to.day].trips[to.vanId][to.leg].rows.splice(to.index, 0, row);
  commit(next);
}

function driverSheet(pos) {
  const trip = app.week.days[pos.day].trips[pos.vanId][pos.leg];
  const van = app.week.vans.find(v => v.id === pos.vanId);
  const sheet = openSheet(`
    <h3>${M.DAY_NAMES[pos.day]}曜・${escapeHtml(van.name)}・${M.LEG_NAMES[pos.leg]}の運転手</h3>
    <input type="text" id="f-driver" value="${escapeHtml(trip.driver)}" autocomplete="off">
    <div class="quick">${app.roster.drivers.slice(0, 14).map(d => `<button type="button" data-d="${escapeHtml(d)}">${escapeHtml(d)}</button>`).join('')}</div>
    <div class="row"><button class="btn2" id="f-week" type="button">この車の今週ぜんぶに入れる</button><div class="grow"></div>
    <button class="btn2" id="f-cancel" type="button">やめる</button><button class="btn2 go" id="f-ok" type="button">決定</button></div>`, { middle: true });
  sheet.querySelectorAll('[data-d]').forEach(b => { b.onclick = () => { $('f-driver').value = b.dataset.d; }; });
  $('f-cancel').onclick = closeSheet;
  const done = days => { const driver = $('f-driver').value.trim(); closeSheet(); applyAndCommit([{ type: 'driver', van: van.name, days, leg: days.length > 1 ? undefined : pos.leg, driver }]); };
  $('f-ok').onclick = () => done([pos.day]);
  $('f-week').onclick = () => done(M.DAY_NUMBERS);
}

function notesSheet(day) {
  openSheet(`
    <h3>${M.DAY_NAMES[day]}曜の連絡</h3>
    <textarea id="f-notes">${escapeHtml(app.week.days[day].notes.join('\n'))}</textarea>
    <div class="row"><div class="grow"></div><button class="btn2" id="f-cancel" type="button">やめる</button><button class="btn2 go" id="f-ok" type="button">決定</button></div>`, { middle: true });
  $('f-cancel').onclick = closeSheet;
  $('f-ok').onclick = () => {
    const next = M.clone(app.week);
    next.days[day].notes = $('f-notes').value.split('\n').map(s => s.trim()).filter(Boolean);
    closeSheet();
    commit(next);
  };
}

function vanSheet(vanId) {
  const van = vanId ? app.week.vans.find(v => v.id === vanId) : null;
  const used = van && M.DAY_NUMBERS.some(d => M.LEGS.some(l => app.week.days[d].trips[van.id][l].rows.length));
  openSheet(`
    <h3>${van ? '車の名前・最大人数を直す' : '車を足す'}</h3>
    <label>車の名前</label>
    <input type="text" id="f-van" value="${van ? escapeHtml(van.name) : ''}" placeholder="例：レンタカー" autocomplete="off">
    <label>最大の乗車人数（利用者が何人まで乗れるか）</label>
    <input type="text" inputmode="numeric" id="f-seats" value="${van && van.seats ? van.seats : ''}" placeholder="${van && M.seatsOf(van, app.roster).seats ? 'まだ決めていません（これまでの最大は ' + M.seatsOf(van, app.roster).seats + '人）' : '例：6'}" autocomplete="off">
    <div class="quick">${[2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-seats="${n}">${n}人</button>`).join('')}</div>
    <p class="lead" style="margin-top:8px;">決めた人数は、次の週の下書きにも引きつがれます。超えると「⚠ 矛盾」で知らせます。</p>
    <div class="row">${van ? `<button class="btn2 danger" id="f-del" type="button" ${used ? 'disabled title="人が乗っているので消せません"' : ''}>この車を消す</button>` : ''}
    <div class="grow"></div><button class="btn2" id="f-cancel" type="button">やめる</button><button class="btn2 go" id="f-ok" type="button">決定</button></div>`, { middle: true });
  $('f-cancel').onclick = closeSheet;
  $('sheet').querySelectorAll('[data-seats]').forEach(b => { b.onclick = () => { $('f-seats').value = b.dataset.seats; }; });
  if (van) $('f-del').onclick = () => {
    const next = M.clone(app.week);
    next.vans = next.vans.filter(v => v.id !== van.id);
    M.DAY_NUMBERS.forEach(d => { delete next.days[d].trips[van.id]; });
    closeSheet(); commit(next);
  };
  $('f-ok').onclick = () => {
    const name = $('f-van').value.trim();
    if (!name) return;
    const seats = Math.max(0, Math.floor(Number($('f-seats').value.normalize('NFKC'))) || 0);
    closeSheet();
    if (van) { const next = M.clone(app.week); Object.assign(next.vans.find(v => v.id === van.id), { name, seats }); commit(next); }
    else applyAndCommit([{ type: 'add_van', van: name, seats }]);
  };
}

/* ---------- AI に伝える ---------- */
let voice = null;
const CHECK_TEXT = 'この週の表ぜんたいを点検してください。表は変えずに、矛盾している所・送迎ルールに反している所・気になる所を教えてください。';

function aiSheet(prefill = '') {
  const canHear = voiceSupported();
  openSheet(`
    <h3>今週の事情を伝える</h3>
    ${canHear ? `<div class="talk">
      <button class="mic" id="mic" type="button" aria-label="話す"><svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V21h2v-2.1A7 7 0 0019 12h-2z"/></svg></button>
    </div>` : ''}
    <textarea id="f-say" placeholder="ここに文字で打ってもかまいません">${escapeHtml(prefill)}</textarea>
    <div class="interim" id="interim"></div>
    <label class="keep"><input type="checkbox" id="f-keep"> <b>これは毎週の送迎ルールとして覚える</b><span>（今週だけでなく、これからずっと守ること。例：「井上様は車椅子なのでハイエースに乗せる」）</span></label>
    <div class="busy" id="busy">AI が表を見ています…（10〜40秒ほど）</div>
    <div class="row">
      <button class="btn2" id="f-rules" type="button">覚えている送迎ルール（${app.rules.length}）</button>
      <button class="btn2" id="f-check" type="button">AIに表を点検してもらう</button>
      <div class="grow"></div>
      <button class="btn2" id="f-cancel" type="button">とじる</button>
      <button class="btn2 go" id="f-send" type="button">伝える</button>
    </div>`);
  const stopVoice = () => { if (voice) { voice.stop(); voice = null; } };
  if (canHear) {
    $('mic').onclick = () => {
      if (voice && voice.listening) { stopVoice(); return; }
      const before = $('f-say').value ? $('f-say').value.replace(/\s*$/, '') + '\n' : '';
      voice = createVoice({
        onText: (finalText, interim) => { if ($('f-say')) { $('f-say').value = finalText; $('interim').textContent = interim; } },
        onState: (s, err) => { const mic = $('mic'); if (mic) mic.classList.toggle('on', s === 'listening'); if ($('interim') && s === 'idle') $('interim').textContent = ''; if (err) toast(err, 'warn'); }
      });
      voice.start(before);
    };
  }
  $('f-cancel').onclick = () => { stopVoice(); closeSheet(); };
  $('f-rules').onclick = () => { stopVoice(); rulesSheet(); };
  $('f-check').onclick = () => { $('f-say').value = CHECK_TEXT; $('f-keep').checked = false; $('f-send').click(); };
  $('f-send').onclick = async () => {
    stopVoice();
    let text = $('f-say').value.trim();
    if (text && $('f-keep').checked) text = '【毎週の送迎ルール】' + text;
    if (!text) { toast('伝える内容を入れてください', 'warn'); return; }
    if (!app.config.aiKey && !app.gate) { needKey(); return; }
    $('busy').classList.add('show'); $('f-send').disabled = true;
    try {
      const answer = await askAi({
        apiKey: app.config.aiKey, gate: app.gate && !app.config.aiKey ? askGateAi : null, week: app.week, roster: app.roster, rules: app.rules, instruction: text,
        weekLabel: weekLongLabel(app.weekKey), pastInstructions: (app.week.log || []).map(l => l.text), warnings: app.warnings, attendance: attendanceToText(app.attendance)
      });
      closeSheet();
      showAnswer(text, answer);
    } catch (e) {
      console.error(e);
      $('busy').classList.remove('show'); $('f-send').disabled = false;
      toast(e.message || String(e), 'error');
    }
  };
}

/* 番人に AI を頼む（鍵は番人の中にだけある） */
async function askGateAi(request) {
  try {
    return await callGate(GATE.url, { action: 'ai', session: app.gate.session, request }, fetch.bind(globalThis));
  } catch (e) {
    if (e && e.name === 'NetworkError') throw new Error('AI につながりませんでした。ネットの接続を確かめてください。');
    throw e;
  }
}

function needKey() {
  const sheet = openSheet(`<h3>AI の鍵がまだ入っていません</h3>
    <p class="lead">「AIに伝える」を使うには、設定画面で Anthropic の APIキーを入れます。入れるまでは、名前の札を指で動かして直せます。</p>
    <div class="row"><div class="grow"></div><button class="btn2" data-close type="button">とじる</button><a class="btn2 go" href="settings.html" style="display:inline-flex;align-items:center;text-decoration:none;">設定へ</a></div>`, { middle: true });
  sheet.querySelector('[data-close]').onclick = closeSheet;
}

/* AI の答えを、表に色つきで仮に当てて見せる。人が「これでよい」を押すまで確定しない */
function showAnswer(said, answer) {
  const result = M.applyOps(app.week, answer.ops);
  const nothing = !result.changes.length && !result.rules.length;
  app.preview = nothing ? null : { week: result.week, changes: result.changes, rules: result.rules, said };
  const items = answer.summary.map(s => `<li>${escapeHtml(s)}</li>`).join('');
  const qs = [...answer.questions, ...result.problems].map(s => `<li class="q">${escapeHtml(s)}</li>`).join('');
  const rules = result.rules.map(s => `<li class="rule"><b>毎週の送迎ルールとして覚えます</b>：${escapeHtml(s)}</li>`).join('');
  $('confirmbody').innerHTML = `
    ${answer.heard ? `<div class="heard">聞き取った内容：${escapeHtml(answer.heard)}</div>` : ''}
    ${items || rules ? `<ul>${items}${rules}</ul>` : ''}
    ${qs ? `<div class="q" style="margin-top:4px;"><b>${said === CHECK_TEXT ? 'AI が気づいたこと' : 'たしかめたいこと'}</b><ul>${qs}</ul></div>` : ''}
    ${nothing && !qs ? '変える所はありませんでした。' : ''}`;
  $('accept').hidden = nothing;
  $('reject').textContent = nothing ? 'とじる' : 'やめる';
  $('confirm').classList.add('show');
  $('accept').onclick = async () => {
    const p = app.preview;
    app.preview = null;
    $('confirm').classList.remove('show');
    p.week.log = [...(app.week.log || []), { text: said, at: new Date().toISOString() }];
    commit(p.week);
    if (p.rules.length) await saveRules([...app.rules, ...p.rules]);
    if (qs) aiSheet('');
  };
  $('reject').onclick = () => {
    app.preview = null;
    $('confirm').classList.remove('show');
    draw();
    if (said !== CHECK_TEXT && (!nothing || qs)) aiSheet(said);
  };
  draw();
  app.board.fit();
}

async function saveRules(list) {
  try {
    await writeFile(rulesPath(app.facility.id), { schemaVersion: M.SCHEMA_VERSION, facilityId: app.facility.id, updatedAt: new Date().toISOString(), rules: list }, `送迎ルール ${app.facility.shortName || app.facility.name} を更新`);
    app.rules = list;
    $('rules').textContent = `送迎ルール ${list.length}`;
    toast('送迎ルールを覚えました');
  } catch (e) { toast('送迎ルールを保存できませんでした：' + (e.message || e), 'error'); }
}

function rulesSheet() {
  openSheet(`<h3>送迎ルール（毎週守ること）</h3>
    <p class="lead">ここに書いたことは、AI が毎回かならず読んで守ります。1行に1つ。例：「井上様は車椅子なのでハイエースかセレナに乗せる」「藤本様と小林様は同じ車にしない」。<br>
    「AIに伝える」で「これからは毎週〜して」と話しても、ここに足されます。</p>
    <textarea id="f-rules-text">${escapeHtml(app.rules.join('\n'))}</textarea>
    <div class="row"><div class="grow"></div><button class="btn2" id="f-cancel" type="button">やめる</button><button class="btn2 go" id="f-ok" type="button">覚える</button></div>`);
  $('f-cancel').onclick = closeSheet;
  $('f-ok').onclick = async () => {
    const list = $('f-rules-text').value.split('\n').map(s => s.trim()).filter(Boolean);
    closeSheet();
    await saveRules(list);
  };
}

/* ---------- その他のメニュー ---------- */
function menuSheet() {
  const sheet = openSheet(`<h3>その他</h3><div class="menu">
    <button type="button" data-a="print">印刷する（A4よこ1枚）</button>
    <button type="button" data-a="fit">利用予定に合わせて直す${hasAttendance(app.attendance) ? `（${escapeHtml(readAtLabel())}）` : '（まだ読みこまれていません）'}</button>
    <button type="button" data-a="redraft">下書きを作りなおす（これまでの表から組みなおす）</button>
    <button type="button" data-a="van">車を足す</button>
    <button type="button" data-a="rules">送迎ルールを見る・直す（${app.rules.length}）</button>
    <button type="button" data-a="clear">この週を空にする</button>
    <a href="settings.html">設定（保存先・AI の鍵）</a>
    <a href="v1.html">前の画面（旧アプリ）を開く</a>
    ${app.gate ? `<button type="button" data-a="logout">ログアウト（${escapeHtml(app.gate.email || '')}）</button>` : ''}
    </div><div class="row"><div class="grow"></div><button class="btn2" data-a="close" type="button">とじる</button></div>`, { middle: true });
  sheet.onclick = e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    closeSheet();
    if (a.dataset.a === 'print') printWeek();
    if (a.dataset.a === 'fit') fitToAttendance();
    if (a.dataset.a === 'redraft') redraft();
    if (a.dataset.a === 'logout' && (!app.dirty || window.confirm('まだ保存していない変更があります。保存せずにログアウトしますか？'))) {
      app.dirty = false;
      clearGateSession();
      location.reload();
    }
    if (a.dataset.a === 'van') vanSheet(null);
    if (a.dataset.a === 'rules') rulesSheet();
    if (a.dataset.a === 'clear' && window.confirm('この週の人・運転手・連絡をぜんぶ消します。よろしいですか？（「戻す」で元にもどせます）')) {
      commit(M.createEmptyWeek({ facilityId: app.facility.id, weekStart: app.weekKey, vans: app.week.vans }));
    }
  };
}

/* 下書きを作りなおす。まだ無い週をひらいたときは自動で作るので、やり直したいときだけ「⋯」から使う */
function redraft() {
  if (!app.history.length) { toast('もとにする、これまでの表がありません', 'warn'); return; }
  if (!window.confirm('これまでの表から、この週を自動で組みなおします。いまの内容は置きかわります（「戻す」で元にもどせます）。')) return;
  const draft = buildDraft({ facilityId: app.facility.id, weekStart: app.weekKey, history: app.history });
  const fitted = applyAttendance(draft.week, app.attendance, app.history);
  fitted.week.log = [];
  commit(fitted.week);
  draftStrip(draft.summary, fitted);
}

/* A4よこ（余白を引いて およそ 1060×740 の大きさ）に収まる文字の大きさにする。
   印刷と、LINE WORKS へ送る画像づくり（?render=1）で同じものを使う */
function fitForPaper() {
  app.board.setFontScale(app.board.measureFit(1060, 700));
}

/* ---------- LINE WORKS へ送る ---------- */
/* データ側に「送ってほしい」という小さなファイルを置く。それを合図に GitHub Actions が画像を作って送る */
async function sendToLineWorks() {
  if (app.store.mode === 'local') { toast('お試しモードでは送れません', 'warn'); return; }
  if (app.dirty) {
    if (!window.confirm('まだ保存していない変更があります。保存してから送りますか？')) return;
    await save();
    if (app.dirty) return;
  }
  if (!app.exists) { toast('この週は、まだ保存されていません。保存してから送ってください', 'warn'); return; }
  const name = app.facility.shortName || app.facility.name;
  if (!window.confirm(`${name}の ${weekLongLabel(app.weekKey)} の送迎表を、画像にして LINE WORKS へ送ります。よろしいですか？`)) return;
  const request = createPublishRequest({ facility: app.facility, weekStart: app.weekKey, requestedBy: app.config.editorName || '' });
  const stamp = request.requestedAt.replace(/[-:]/g, '').replace(/\..+$/, '');
  const path = `publish-requests/${app.facility.id}-${app.weekKey}-${stamp}.json`;
  try {
    await app.store.writeJson(path, request, { message: `送迎表 ${name} ${app.weekKey}週 を LINE WORKS へ送る` });
    toast('送る手配をしました。2〜3分で LINE WORKS に届きます');
  } catch (e) {
    console.error(e);
    if (loginAgainIfNeeded(e)) return;
    toast('送れませんでした：' + (e.message || e), 'error');
  }
}

/* LINE WORKS へ送る画像を作るときの開き方（GitHub Actions の中から使う）
   ?render=1&f=<事業所>&w=<月曜の日付> … 保存した表を紙面の大きさにして、body に data-render を付ける */
function finishRender() {
  if (!app.exists) { document.body.dataset.render = 'error:この週の送迎表は保存されていません'; return; }
  fitForPaper();
  document.body.dataset.render = 'ready';
}

function printWeek() {
  fitForPaper();
  const back = () => { app.board.restoreScale(); window.removeEventListener('afterprint', back); };
  window.addEventListener('afterprint', back);
  window.print();
}

/* ---------- Google ログイン（番人を使うとき） ---------- */
/* ログインの画面を出す。ログインできたら、しるしを覚えて開きなおす */
function showLogin(message) {
  $('login').hidden = false;
  $('loginerr').textContent = message || '';
  const onCredential = async response => {
    $('loginerr').textContent = 'ログインを確かめています…';
    try {
      const out = await callGate(GATE.url, { action: 'login', idToken: response.credential }, fetch.bind(globalThis));
      saveGateSession({ session: out.session, email: out.email, facilities: out.facilities, exp: out.exp });
      location.reload();
    } catch (e) {
      console.error(e);
      $('loginerr').textContent = e.message || String(e);
    }
  };
  const ready = () => {
    window.google.accounts.id.initialize({ client_id: GATE.googleClientId, callback: onCredential, auto_select: true, ux_mode: 'popup' });
    window.google.accounts.id.renderButton($('gbutton'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ja', width: 280 });
  };
  if (window.google && window.google.accounts) { ready(); return; }
  const tag = document.createElement('script');
  tag.src = 'https://accounts.google.com/gsi/client';
  tag.async = true;
  tag.onload = ready;
  tag.onerror = () => { $('loginerr').textContent = 'Google のログイン画面を読みこめませんでした。インターネットの接続を確かめてください。'; };
  document.head.appendChild(tag);
}

/* 番人に「ログインしなおして」と言われたら、ログインの画面へもどす */
function loginAgainIfNeeded(e) {
  if (!(e && e.name === 'AuthError' && app.store && app.store.mode === 'gate')) return false;
  clearGateSession();
  showLogin(e.message || 'もう一度ログインしてください');
  return true;
}

/* ---------- はじめに ---------- */
export async function start() {
  app.config = loadConfig();
  /* 番人のつなぎ先があり、この端末に GitHub の鍵が無ければ、Google ログインで開く。
     アドレスの後ろに ?otameshi=1 を付けると、ログインせずに見本のデータで試せる */
  const params = new URLSearchParams(location.search);
  /* 画像づくり（?render=1）は、同じ置き場の data/ をそのまま読む（お試しモードと同じ読み方） */
  const render = params.get('render') === '1';
  const trial = params.get('otameshi') === '1' || render;
  const useGate = !!GATE.url && !isGithubReady(app.config) && !trial;
  if (useGate) {
    app.gate = loadGateSession();
    if (!app.gate) { showLogin(''); return; }
  }
  app.store = createStore(app.config, { gate: useGate ? { url: GATE.url, session: app.gate.session } : null });
  const badge = $('modebadge');
  /* 本番のときは何も出さない。お試しモードのときだけ、見本のデータだと分かるよう札を出す */
  badge.textContent = app.store.mode === 'local' ? 'お試し' : '';
  badge.hidden = app.store.mode !== 'local';
  badge.className = 'badge' + (app.store.mode === 'local' ? ' local' : '');
  badge.title = app.store.label || '';

  /* ならべ方を見くらべるための入口：アドレスの後ろに ?layout=tall（たて積み）か ?layout=wide（よこ並べ）を付ける */
  const layout = new URLSearchParams(location.search).get('layout') || 'auto';
  app.board = createBoard({
    stage: $('stage'), board: $('board'), layout,
    handlers: {
      onMove: moveRider,
      onFull: () => toast('その便は満席です。先にだれかを別の車へ動かしてください', 'warn'),
      onRemove: removeAt,
      onTapRider: pos => riderSheet(pos, false),
      onAddRider: pos => riderSheet(pos, true),
      onTapDriver: driverSheet,
      onTapNotes: notesSheet,
      onTapVan: vanSheet
    }
  });

  try {
    app.facilities = await createRepository(app.store).loadFacilities();
  } catch (e) {
    if (loginAgainIfNeeded(e)) return;
    strip(escapeHtml(e.message || String(e)), 'error');
    return;
  }
  if (!app.facilities.length) { strip('事業所の一覧（data/facilities.json）が読めませんでした。設定を確かめてください。', 'error'); return; }
  app.facility = app.facilities.find(f => f.id === (render ? params.get('f') : app.config.facilityId)) || (render ? null : app.facilities[0]);
  if (!app.facility) { document.body.dataset.render = 'error:事業所が見つかりません'; return; }
  $('facility').innerHTML = app.facilities.map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.shortName || f.name)}</option>`).join('');
  $('facility').value = app.facility.id;
  /* 見られる事業所が1つだけなら、切りかえを出さずに名前だけにする */
  $('facility').classList.toggle('fixed', app.facilities.length === 1);
  $('facility').tabIndex = app.facilities.length === 1 ? -1 : 0;

  $('facility').onchange = async () => {
    if (!(await leaveOk())) { $('facility').value = app.facility.id; return; }
    app.facility = app.facilities.find(f => f.id === $('facility').value);
    try { app.config = saveConfig({ ...app.config, facilityId: app.facility.id }); } catch (e) { /* 覚えられなくても動く */ }
    openWeek(app.weekKey);
  };
  $('prev').onclick = async () => { if (app.weekKey !== thisWeek() && await leaveOk()) openWeek(thisWeek()); };
  $('next').onclick = async () => { if (app.weekKey !== nextWeek() && await leaveOk()) openWeek(nextWeek()); };
  $('undo').onclick = () => { if (app.undo.length) { app.week = app.undo.pop(); app.dirty = true; draw(); } };
  $('save').onclick = save;
  $('zin').onclick = () => app.board.zoom(1.25);
  $('zout').onclick = () => app.board.zoom(0.8);
  $('zfit').onclick = () => app.board.fit();
  $('more').onclick = menuSheet;
  $('print').onclick = printWeek;
  $('send').onclick = sendToLineWorks;
  $('ai').onclick = () => aiSheet('');
  $('rules').onclick = rulesSheet;

  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', () => setTimeout(() => app.board.fit(), 250));
  window.addEventListener('beforeunload', e => { if (app.dirty) { e.preventDefault(); e.returnValue = ''; } });

  if (render) {
    await openWeek(params.get('w') || thisWeek());
    finishRender();
    return;
  }
  await openWeek(thisWeek());
}
