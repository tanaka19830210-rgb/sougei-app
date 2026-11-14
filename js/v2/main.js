/* ============================================================
   送迎表の画面（v2）のまとめ役

   流れ：
   1. 週をひらく。まだ作っていない週なら、これまでの表から自動で下書きを作る
   2. 「AIに伝える」で今週の事情を声か文字で伝える → 変更が色つきで出る → 「これでよい」
   3. のこりは名前の札を指で動かして直す
   4. 「保存」
   ============================================================ */

import { loadConfig, saveConfig } from '../config.js';
import { createStore } from '../store/index.js';
import { createRepository } from '../store/repository.js';
import { currentWeekKey, shiftWeekKey, weekLongLabel, weekShortLabel } from '../core/dates.js';
import { escapeHtml } from '../core/html.js';
import * as M from './model.js';
import { buildDraft } from './draft.js';
import { askAi } from './ai.js';
import { voiceSupported, createVoice } from './voice.js';
import { createBoard } from './board.js';

const $ = id => document.getElementById(id);
const weekPath = (fid, key) => `data/${fid}/weeks/${key}.json`;
const rulesPath = fid => `data/${fid}/rules.json`;
const HISTORY_WEEKS = 8;

const app = {
  config: null, store: null, facilities: [], facility: null,
  weekKey: '', week: null, exists: false, dirty: false,
  warnings: [], history: [], roster: { people: [], drivers: [], capacity: {} },
  rules: [], undo: [], preview: null, shas: new Map(), board: null
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
  const warnings = M.checkWeek(showing, app.roster);
  app.board.render({ week: showing, warnings, changes: app.preview ? app.preview.changes : [], locked: !!app.preview });
  $('weeklabel').textContent = weekShortLabel(app.weekKey) + 'の週';
  $('printhead').textContent = `${app.facility.printTitle || app.facility.name}　${weekLongLabel(app.weekKey)}`;
  $('undo').disabled = !app.undo.length || !!app.preview;
  $('save').classList.toggle('dirty', app.dirty);
  $('save').textContent = app.dirty ? '保存する' : '保存ずみ';
  $('save').disabled = !!app.preview;
  ['draft', 'ai', 'rules', 'prev', 'next', 'facility'].forEach(id => { $(id).disabled = !!app.preview; });
  const w = $('warn');
  const shown = warnings.filter(x => !x.quiet);
  app.warnings = shown.map(x => x.text);
  w.hidden = !shown.length;
  w.textContent = `⚠ 矛盾 ${shown.length}`;
  $('rules').textContent = `決まりごと ${app.rules.length}`;
  w.onclick = () => {
    const sheet = openSheet(`<h3>つじつまが合っていない所（${shown.length}）</h3><ul class="warnlist">${shown.map(x => `<li>${escapeHtml(x.text)}</li>`).join('')}</ul><div class="row"><div class="grow"></div><button class="btn2" data-close>とじる</button></div>`, { middle: true });
    sheet.querySelector('[data-close]').onclick = closeSheet;
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

function draftStrip(summary) {
  if (!summary.copiedFrom) return strip('これまでの表がまだ無いので、空の表です。「⋯」から車を足して、人を入れてください。', 'warn');
  const names = list => [...new Set(list.map(x => x.name))].slice(0, 8).map(n => escapeHtml(n) + '様').join('・') + (new Set(list.map(x => x.name)).size > 8 ? ' ほか' : '');
  let html = `<b>${weekLongLabel(summary.copiedFrom)}</b> の表をもとに下書きを作りました。`;
  if (summary.restored.length) html += ` <i class="restored">青わく</i>＝先週お休みだったので戻した人（${names(summary.restored)}）`;
  if (summary.onlyLast.length) html += ` <i class="onlyLast">点線わく</i>＝先週だけ乗っていた人（${names(summary.onlyLast)}）`;
  html += ' 今週の事情は「AIに伝える」でどうぞ。';
  strip(html);
}

async function openWeek(key) {
  app.weekKey = key;
  app.undo = []; app.preview = null; $('confirm').classList.remove('show');
  strip('読みこんでいます…');
  try {
    const [file, history, rules] = await Promise.all([
      readFile(weekPath(app.facility.id, key)),
      loadHistory(),
      readFile(rulesPath(app.facility.id))
    ]);
    app.history = history;
    app.rules = rules && Array.isArray(rules.rules) ? rules.rules.map(String) : [];
    app.exists = !!file;
    if (file) {
      app.week = M.normalizeWeek(file, { facilityId: app.facility.id, weekStart: key });
      app.dirty = false;
      strip('');
    } else {
      const draft = buildDraft({ facilityId: app.facility.id, weekStart: key, history });
      app.week = draft.week;
      app.dirty = !!draft.summary.copiedFrom;
      draftStrip(draft.summary);
    }
    app.roster = M.rosterFrom([app.week, ...history]);
    draw();
    app.board.fit();
  } catch (e) {
    console.error(e);
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
  const data = { ...app.week, schemaVersion: M.SCHEMA_VERSION, facilityId: app.facility.id, weekStart: app.weekKey, updatedAt: new Date().toISOString(), updatedBy: app.config.editorName || '' };
  $('save').disabled = true;
  try {
    await writeFile(weekPath(app.facility.id, app.weekKey), data, `送迎表 ${app.facility.shortName || app.facility.name} ${app.weekKey}週 を更新`);
    app.dirty = false; app.exists = true;
    toast(app.store.mode === 'local' ? 'この端末の中に保存しました（お試しモード）' : '保存しました');
  } catch (e) {
    console.error(e);
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
  const places = [...new Set([...(person ? person.places : []), '自宅', ...app.roster.people.flatMap(p => p.places)])].filter(Boolean).slice(0, 10);
  const sheet = openSheet(`
    <h3>${M.DAY_NAMES[pos.day]}曜・${escapeHtml(van.name)}・${M.LEG_NAMES[pos.leg]}${isNew ? ' に人を足す' : ''}</h3>
    <label>お名前（名字）</label>
    <input type="text" id="f-name" list="dl-people" value="${escapeHtml(row.name)}" autocomplete="off">
    <datalist id="dl-people">${app.roster.people.map(p => `<option value="${escapeHtml(p.name)}">`).join('')}</datalist>
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
  $('f-cancel').onclick = closeSheet;
  if (!isNew) $('f-del').onclick = () => { closeSheet(); removeAt(pos); };
  $('f-ok').onclick = () => {
    const name = M.personKey($('f-name').value);
    if (!name) { toast('お名前を入れてください', 'warn'); return; }
    const next = M.clone(app.week);
    const rows = next.days[pos.day].trips[pos.vanId][pos.leg].rows;
    const value = { name, place: $('f-place').value.trim(), time: M.normTime($('f-time').value) };
    if (isNew) {
      const at = value.time ? rows.findIndex(r => r.time && r.time > value.time) : -1;
      rows.splice(at >= 0 ? at : rows.length, 0, value);
    } else rows[pos.index] = value;
    closeSheet();
    commit(next);
  };
  if (isNew) $('f-name').focus();
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
    <p class="lead">1行に1つ書きます（例：井上様休み（病院受診））。</p>
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
    <h3>${van ? '車の名前を直す' : '車を足す'}</h3>
    <input type="text" id="f-van" value="${van ? escapeHtml(van.name) : ''}" placeholder="例：レンタカー" autocomplete="off">
    <div class="row">${van ? `<button class="btn2 danger" id="f-del" type="button" ${used ? 'disabled' : ''}>${used ? '人が乗っているので消せません' : 'この車を消す'}</button>` : ''}
    <div class="grow"></div><button class="btn2" id="f-cancel" type="button">やめる</button><button class="btn2 go" id="f-ok" type="button">決定</button></div>`, { middle: true });
  $('f-cancel').onclick = closeSheet;
  if (van) $('f-del').onclick = () => {
    const next = M.clone(app.week);
    next.vans = next.vans.filter(v => v.id !== van.id);
    M.DAY_NUMBERS.forEach(d => { delete next.days[d].trips[van.id]; });
    closeSheet(); commit(next);
  };
  $('f-ok').onclick = () => {
    const name = $('f-van').value.trim();
    if (!name) return;
    closeSheet();
    if (van) { const next = M.clone(app.week); next.vans.find(v => v.id === van.id).name = name; commit(next); }
    else applyAndCommit([{ type: 'add_van', van: name }]);
  };
}

/* ---------- AI に伝える ---------- */
let voice = null;
const CHECK_TEXT = 'この週の表ぜんたいを点検してください。表は変えずに、矛盾している所・決まりごとに反している所・気になる所を教えてください。';

function aiSheet(prefill = '') {
  const canHear = voiceSupported();
  openSheet(`
    <h3>今週の事情を伝える</h3>
    <div class="talk">
      ${canHear ? '<button class="mic" id="mic" type="button" aria-label="話す"><svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V21h2v-2.1A7 7 0 0019 12h-2z"/></svg></button>' : ''}
      <div class="hint">下のらんを押して、Typeless などの音声入力でそのまま話してください。${canHear ? '左のマイクでも聞き取れます（もう一度押すと止まります）。' : ''}<br>
      例：「井上さんは木曜お休み。岡田さんは金曜、病院なので送りなし。火曜のセレナの運転は山田さん」</div>
    </div>
    <label>伝える内容（聞きまちがいは、そのままでも AI が名簿を見て直します）</label>
    <textarea id="f-say" placeholder="ここに文字で打ってもかまいません">${escapeHtml(prefill)}</textarea>
    <div class="interim" id="interim"></div>
    <label class="keep"><input type="checkbox" id="f-keep"> <b>これは毎週の決まりごととして覚える</b><span>（今週だけでなく、これからずっと守ること。例：「井上様は車椅子なのでハイエースに乗せる」）</span></label>
    <div class="busy" id="busy">AI が表を見ています…（10〜40秒ほど）</div>
    <div class="row">
      <button class="btn2" id="f-rules" type="button">覚えている決まりごと（${app.rules.length}）</button>
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
    if (text && $('f-keep').checked) text = '【毎週の決まりごと】' + text;
    if (!text) { toast('伝える内容を入れてください', 'warn'); return; }
    if (!app.config.aiKey) { needKey(); return; }
    $('busy').classList.add('show'); $('f-send').disabled = true;
    try {
      const answer = await askAi({
        apiKey: app.config.aiKey, week: app.week, roster: app.roster, rules: app.rules, instruction: text,
        weekLabel: weekLongLabel(app.weekKey), pastInstructions: (app.week.log || []).map(l => l.text), warnings: app.warnings
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
  const rules = result.rules.map(s => `<li class="rule"><b>毎週の決まりごととして覚えます</b>：${escapeHtml(s)}</li>`).join('');
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
    await writeFile(rulesPath(app.facility.id), { schemaVersion: M.SCHEMA_VERSION, facilityId: app.facility.id, updatedAt: new Date().toISOString(), rules: list }, `決まりごと ${app.facility.shortName || app.facility.name} を更新`);
    app.rules = list;
    $('rules').textContent = `決まりごと ${list.length}`;
    toast('決まりごとを覚えました');
  } catch (e) { toast('決まりごとを保存できませんでした：' + (e.message || e), 'error'); }
}

function rulesSheet() {
  openSheet(`<h3>決まりごと（毎週守ること）</h3>
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
    <button type="button" data-a="van">車を足す</button>
    <button type="button" data-a="rules">決まりごとを見る・直す（${app.rules.length}）</button>
    <button type="button" data-a="clear">この週を空にする</button>
    <a href="settings.html">設定（保存先・AI の鍵）</a>
    <a href="v1.html">前の画面（旧アプリ）を開く</a>
    </div><div class="row"><div class="grow"></div><button class="btn2" data-a="close" type="button">とじる</button></div>`, { middle: true });
  sheet.onclick = e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    closeSheet();
    if (a.dataset.a === 'print') printWeek();
    if (a.dataset.a === 'van') vanSheet(null);
    if (a.dataset.a === 'rules') rulesSheet();
    if (a.dataset.a === 'clear' && window.confirm('この週の人・運転手・連絡をぜんぶ消します。よろしいですか？（「戻す」で元にもどせます）')) {
      commit(M.createEmptyWeek({ facilityId: app.facility.id, weekStart: app.weekKey, vans: app.week.vans }));
    }
  };
}

function printWeek() {
  /* A4よこ（余白を引いて およそ 1060×740 の大きさ）に収まる文字の大きさにしてから刷る */
  const s = app.board.measureFit(1060, 700);
  app.board.setFontScale(s);
  const back = () => { app.board.restoreScale(); window.removeEventListener('afterprint', back); };
  window.addEventListener('afterprint', back);
  window.print();
}

/* ---------- はじめに ---------- */
export async function start() {
  app.config = loadConfig();
  app.store = createStore(app.config);
  const badge = $('modebadge');
  badge.textContent = app.store.mode === 'local' ? 'お試し' : 'GitHub';
  badge.className = 'badge' + (app.store.mode === 'local' ? ' local' : '');
  badge.title = app.store.label || '';

  /* ならべ方を見くらべるための入口：アドレスの後ろに ?layout=tall（たて積み）か ?layout=wide（よこ並べ）を付ける */
  const layout = new URLSearchParams(location.search).get('layout') || 'auto';
  app.board = createBoard({
    stage: $('stage'), board: $('board'), layout,
    handlers: {
      onMove: moveRider,
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
    strip(escapeHtml(e.message || String(e)), 'error');
    return;
  }
  if (!app.facilities.length) { strip('事業所の一覧（data/facilities.json）が読めませんでした。設定を確かめてください。', 'error'); return; }
  app.facility = app.facilities.find(f => f.id === app.config.facilityId) || app.facilities[0];
  $('facility').innerHTML = app.facilities.map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.shortName || f.name)}</option>`).join('');
  $('facility').value = app.facility.id;

  $('facility').onchange = async () => {
    if (!(await leaveOk())) { $('facility').value = app.facility.id; return; }
    app.facility = app.facilities.find(f => f.id === $('facility').value);
    try { app.config = saveConfig({ ...app.config, facilityId: app.facility.id }); } catch (e) { /* 覚えられなくても動く */ }
    openWeek(app.weekKey);
  };
  $('prev').onclick = async () => { if (await leaveOk()) openWeek(shiftWeekKey(app.weekKey, -1)); };
  $('next').onclick = async () => { if (await leaveOk()) openWeek(shiftWeekKey(app.weekKey, 1)); };
  $('undo').onclick = () => { if (app.undo.length) { app.week = app.undo.pop(); app.dirty = true; draw(); } };
  $('save').onclick = save;
  $('zin').onclick = () => app.board.zoom(1.25);
  $('zout').onclick = () => app.board.zoom(0.8);
  $('zfit').onclick = () => app.board.fit();
  $('more').onclick = menuSheet;
  $('ai').onclick = () => aiSheet('');
  $('rules').onclick = rulesSheet;
  $('draft').onclick = () => {
    if (!app.history.length) { toast('もとにする、これまでの表がありません', 'warn'); return; }
    if (!window.confirm('これまでの表から、この週を自動で組みなおします。いまの内容は置きかわります（「戻す」で元にもどせます）。')) return;
    const draft = buildDraft({ facilityId: app.facility.id, weekStart: app.weekKey, history: app.history });
    draft.week.log = [];
    commit(draft.week);
    draftStrip(draft.summary);
  };

  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', () => setTimeout(() => app.board.fit(), 250));
  window.addEventListener('beforeunload', e => { if (app.dirty) { e.preventDefault(); e.returnValue = ''; } });

  await openWeek(currentWeekKey());
}
