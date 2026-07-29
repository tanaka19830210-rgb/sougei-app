/* ============================================================
   割り当て画面の描画
   （状態を持たない。app から今の状態をもらって画面を作りなおすだけ）
   ============================================================ */

import { el, escapeHtml } from './dom.js';
import { ICON_PERSON, ICON_WHEELCHAIR, ICON_MEMO } from './icons.js';
import * as A from '../core/assign.js';
import { capacity, vansForDay, NOTE_KINDS } from '../core/schema.js';
import { DAYS, dateOfDay, weekShortLabel, parseDateKey } from '../core/dates.js';

/* ---------- 利用者タイル ---------- */
export function tileEl(app, user) {
  const areas = app.state.facility.areas || {};
  const node = el('div', 'tile');
  node.style.setProperty('--area', areas[user.area] || '#b7bfb7');
  node.dataset.uid = user.id;
  node.innerHTML = `<div class="nm">${escapeHtml(user.name)}</div>
    <div class="meta">${escapeHtml(user.area)}${user.wheelchair ? ICON_WHEELCHAIR.replace('<svg', '<svg class="wc-ico"') : ''}</div>`;
  return node;
}

/* ---------- 車のカード ---------- */
export function renderVans(app) {
  const { ctx, day, dir } = app.state;
  const dirState = app.dirState();
  const box = document.getElementById('vans');
  box.innerHTML = '';

  const dayVans = vansForDay(ctx.vans, day);
  if (!dayVans.length) {
    const empty = el('div', 'van');
    empty.innerHTML = '<div class="van-head"><span class="van-name">この曜日に走る車がありません</span></div>' +
      '<div class="van-sub">車両マスタで「使う曜日」を確認してください。</div>';
    box.appendChild(empty);
    return;
  }

  dayVans.forEach(van => {
    const vanState = dirState.vans[van.id];
    if (!vanState) return;
    const riding = A.ridersIn(dirState, van.id).length;
    const full = riding === capacity(van);
    const card = el('div', 'van');

    card.innerHTML = `
      <div class="van-head">
        <span class="van-name">${escapeHtml(van.name)}</span>
        <span class="van-count ${full ? 'full' : ''}"><b>${riding}</b> / ${capacity(van)}名</span>
      </div>`;

    /* この日の運転手（紙の運転手バッジになる） */
    const sub = el('div', 'van-sub');
    const drvWrap = el('span');
    drvWrap.innerHTML = `${ICON_PERSON}<span>運転</span>`;
    drvWrap.appendChild(driverSelect(app, van, vanState));
    sub.appendChild(drvWrap);
    if (van.wheelchairSeats > 0) {
      const wc = el('span');
      wc.innerHTML = `${ICON_WHEELCHAIR}車椅子 ${A.wheelchairCount(ctx, dirState, van.id)} / ${van.wheelchairSeats}`;
      sub.appendChild(wc);
    }
    card.appendChild(sub);

    vanState.rows.forEach((row, index) => {
      card.appendChild(rowEl(app, van, vanState, row, index));
    });

    card.appendChild(vanMemoEl(app, van, vanState));
    box.appendChild(card);
  });
}

function driverSelect(app, van, vanState) {
  const select = el('select', 'drvpick');
  select.setAttribute('aria-label', `${van.name} の運転手`);
  const current = A.driverOf(app.state.ctx, app.dirState(), van.id);
  const names = [];
  (app.state.drivers || []).forEach(d => { if (!names.includes(d.name)) names.push(d.name); });
  if (van.driver && !names.includes(van.driver)) names.push(van.driver);
  if (current && !names.includes(current)) names.push(current);

  const blank = el('option', null, '未定');
  blank.value = '';
  select.appendChild(blank);
  names.forEach(name => {
    const opt = el('option', null, name);
    opt.value = name;
    select.appendChild(opt);
  });
  select.value = current || '';
  select.onchange = () => {
    vanState.driver = select.value;      /* '' は「未定」として紙に出る */
    app.markDirty();
  };
  return select;
}

function rowEl(app, van, vanState, row, index) {
  const node = el('div', 'row ' + (row.userId ? 'filled' : 'empty'));
  const no = el('div', 'no', String(index + 1));
  node.appendChild(no);

  if (row.userId) {
    const time = el('input', 'time');
    time.type = 'time';
    time.value = row.time || '';
    time.oninput = e => { row.time = e.target.value; app.markDirty(); };
    node.appendChild(time);
  }

  const slot = el('div', 'slot' + (row.userId ? ' filled' : ''));
  slot.dataset.van = van.id;
  slot.dataset.idx = String(index);
  if (row.userId) {
    const user = app.state.ctx.usersById[row.userId];
    slot.appendChild(user ? tileEl(app, user) : el('div', 'nm', '（マスタに無い方）'));
  } else {
    slot.textContent = '空席';
  }
  node.appendChild(slot);

  if (row.userId) {
    const chg = el('button', 'chg', '当日変更');
    chg.type = 'button';
    chg.title = '当日の変更。おすと紙では赤い文字になります';
    chg.setAttribute('aria-pressed', row.changed ? 'true' : 'false');
    chg.onclick = () => {
      row.changed = !row.changed;
      chg.setAttribute('aria-pressed', row.changed ? 'true' : 'false');
      app.markDirty();
    };
    node.appendChild(chg);
  }
  return node;
}

function vanMemoEl(app, van, vanState) {
  const wrap = el('div', 'vanmemo');
  wrap.innerHTML = `<label>${ICON_MEMO}${escapeHtml(van.name)} のメモ</label>`;
  const area = el('textarea');
  area.placeholder = '例：山根様 ヘルパー迎え／雨の日は玄関前まで';
  area.value = vanState.memo || '';
  area.oninput = e => { vanState.memo = e.target.value; app.markDirty(); };
  wrap.appendChild(area);
  return wrap;
}

/* ---------- まだ乗っていない人 ---------- */
export function renderPool(app) {
  const pool = document.getElementById('pool');
  pool.innerHTML = '';
  app.unassigned().forEach(user => pool.appendChild(tileEl(app, user)));
}

export function renderStatus(app) {
  const { ctx, day, dir } = app.state;
  const total = A.targetUsers(ctx, day, dir).length;
  const left = app.unassigned().length;
  const node = document.getElementById('status');
  node.textContent = left === 0
    ? `${total}名 ぜんぶ乗りました`
    : `${total}名のうち ${left}名 がまだ乗っていません`;
  node.style.color = left === 0 ? 'var(--green-dark)' : 'var(--sub)';
}

/* ---------- この日のメモ（紙のいちばん下） ---------- */
export function renderDayNotes(app) {
  const dayState = app.dayState();
  const list = document.getElementById('notelist');
  list.innerHTML = '';

  if (!dayState.notes.length) {
    list.appendChild(el('p', 'note', 'まだありません。下から追加できます。'));
  }
  dayState.notes.forEach((note, index) => {
    const item = el('div', 'noteitem');
    const chip = el('span', 'chip ' + note.kind, note.text);
    const kind = NOTE_KINDS.find(k => k.key === note.kind);
    chip.title = kind ? kind.label : '';
    item.appendChild(chip);
    const del = el('button', 'btn plain', '消す');
    del.type = 'button';
    del.onclick = () => {
      dayState.notes.splice(index, 1);
      renderDayNotes(app);
      app.markDirty();
    };
    item.appendChild(del);
    list.appendChild(item);
  });
}

/* ---------- 週ラベルと曜日タブ ---------- */
export function renderWeekLabel(app) {
  const start = parseDateKey(app.state.weekStart);
  document.getElementById('weeklabel').innerHTML =
    `${escapeHtml(weekShortLabel(app.state.weekStart))}<small>${start ? start.getFullYear() : ''}年</small>`;
}

export function renderDayTabs(app) {
  const seg = document.getElementById('dayseg');
  seg.innerHTML = '';
  const days = app.state.facility.days.length ? app.state.facility.days : DAYS.map(d => d.n);
  days.forEach(n => {
    const info = DAYS.find(d => d.n === n) || { n, label: String(n) };
    const date = dateOfDay(app.state.weekStart, n);
    const button = el('button');
    button.innerHTML = `<b>${info.label}</b><i>${date ? date.getDate() : ''}日</i>`;
    button.setAttribute('aria-pressed', String(n === app.state.day));
    button.onclick = () => app.setDay(n);
    seg.appendChild(button);
  });
}
