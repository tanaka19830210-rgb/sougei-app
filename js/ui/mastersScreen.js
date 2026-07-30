/* ============================================================
   マスタ編集画面（masters.html）
   利用者・車両・同乗NGペア・運転手を、アプリの中で直して GitHub に保存する。
   凝ったことはしない。押しやすさ（たて44px以上）だけ守る。
   ============================================================ */

import { bootstrap, fillFacilitySelect } from './appShell.js';
import { toast, showDialog, setBanner, renderModeBadge, errorMessage, escapeHtml, el } from './dom.js';
import { DAYS } from '../core/dates.js';
import { DRIVER_COLORS } from '../core/schema.js';
import { ConflictError } from '../store/errors.js';

const TABS = [
  { key: 'users', label: '利用者', kind: 'users' },
  { key: 'vans', label: '車両', kind: 'vans' },
  { key: 'ngPairs', label: '同乗NGペア', kind: 'ngPairs' },
  { key: 'drivers', label: '運転手', kind: 'drivers' }
];

const state = {
  config: null, store: null, repo: null,
  facilities: [], facility: null,
  data: { users: [], vans: [], ngPairs: [], drivers: [] },
  tab: 'users',
  dirty: {}
};

/* ---------- 新しい番号（id）を作る ---------- */
function nextId(list, prefix) {
  let max = 0;
  list.forEach(item => {
    const m = new RegExp('^' + prefix + '(\\d+)$').exec(item.id || '');
    if (m) max = Math.max(max, Number(m[1]));
  });
  return prefix + String(max + 1).padStart(2, '0');
}

function markDirty(tab) {
  state.dirty[tab] = true;
  renderSaveBar();
}

function renderSaveBar() {
  const node = document.getElementById('savestate');
  const dirty = Object.keys(state.dirty).filter(k => state.dirty[k]);
  if (!dirty.length) {
    node.textContent = '';
    return;
  }
  const labels = dirty.map(k => (TABS.find(t => t.key === k) || {}).label).filter(Boolean);
  node.textContent = `● ${labels.join('・')} がまだ保存されていません`;
}

/* ---------- 曜日のチェックらん ---------- */
function dayBoxes(item, tab) {
  const wrap = el('div', 'dayboxes');
  DAYS.forEach(d => {
    const label = el('label', null, d.label);
    const box = el('input');
    box.type = 'checkbox';
    box.checked = item.days.includes(d.n);
    box.onchange = () => {
      const set = new Set(item.days);
      if (box.checked) set.add(d.n); else set.delete(d.n);
      item.days = [...set].sort((a, b) => a - b);
      markDirty(tab);
    };
    label.appendChild(box);
    wrap.appendChild(label);
  });
  return wrap;
}

function textCell(item, key, tab, options = {}) {
  const input = el('input', options.className || null);
  input.type = options.type || 'text';
  input.value = item[key] == null ? '' : item[key];
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.list) input.setAttribute('list', options.list);
  if (options.type === 'number') {
    input.min = '0';
    input.max = '20';
  }
  input.oninput = () => {
    item[key] = options.type === 'number' ? Math.max(0, Number(input.value) || 0) : input.value;
    markDirty(tab);
  };
  const td = el('td', options.tdClass || null);
  td.appendChild(input);
  return td;
}

function flagCell(item, key, tab, label) {
  const td = el('td', 'mini');
  const wrap = el('label', 'flagbox');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = !!item[key];
  box.onchange = () => { item[key] = box.checked; markDirty(tab); };
  wrap.appendChild(box);
  wrap.appendChild(el('span', null, label));
  td.appendChild(wrap);
  return td;
}

function deleteCell(list, item, tab, name) {
  const td = el('td', 'mini');
  const button = el('button', 'btn danger', '消す');
  button.type = 'button';
  button.onclick = async () => {
    const answer = await showDialog({
      title: '消しますか？',
      bodyHtml: `<b>${escapeHtml(name || 'この行')}</b> を消します。<br>「保存」を押すまでは GitHub には反映されません。`,
      buttons: [
        { label: 'やめる', value: 'cancel' },
        { label: '消す', value: 'ok', kind: 'go' }
      ]
    });
    if (answer !== 'ok') return;
    const index = list.indexOf(item);
    if (index >= 0) list.splice(index, 1);
    markDirty(tab);
    renderTab();
  };
  td.appendChild(button);
  return td;
}

function tableEl(headers) {
  const table = el('table', 'master');
  const thead = el('thead');
  const tr = el('tr');
  headers.forEach(h => tr.appendChild(el('th', null, h)));
  thead.appendChild(tr);
  table.appendChild(thead);
  table.appendChild(el('tbody'));
  return table;
}

/* ============================================================
   それぞれのタブ
   ============================================================ */
function renderUsers(box) {
  const list = state.data.users;
  const table = tableEl(['お名前', 'エリア', '車椅子', '利用曜日（月〜土）', '送り不要', 'メモ', '使う', '']);
  const body = table.querySelector('tbody');
  list.forEach(user => {
    const tr = el('tr');
    tr.appendChild(textCell(user, 'name', 'users', {
      placeholder: '例：井上 健太', className: 'cell-name', tdClass: 'col-name'
    }));
    tr.appendChild(textCell(user, 'area', 'users', {
      placeholder: '例：佐伯区', list: 'arealist', className: 'cell-area', tdClass: 'col-area'
    }));
    tr.appendChild(flagCell(user, 'wheelchair', 'users', '車椅子'));
    const days = el('td');
    days.appendChild(dayBoxes(user, 'users'));
    tr.appendChild(days);
    tr.appendChild(flagCell(user, 'noReturn', 'users', '送り不要'));
    tr.appendChild(textCell(user, 'note', 'users', { placeholder: '' }));
    tr.appendChild(flagCell(user, 'active', 'users', '使う'));
    tr.appendChild(deleteCell(list, user, 'users', user.name));
    body.appendChild(tr);
  });
  box.appendChild(wrapTable(table));
  box.appendChild(addButton('利用者を追加', () => {
    list.push({
      id: nextId(list, 'u'), name: '', area: '', wheelchair: false,
      days: [1, 2, 3, 4, 5], noReturn: false, note: '', active: true
    });
    markDirty('users');
    renderTab();
  }));
}

function renderVans(box) {
  const list = state.data.vans;
  const table = tableEl(['車の名前', '座席', '車椅子わく', 'いつもの運転手', '走る曜日（月〜土）', '紙に出す小さい字', '使う', '']);
  const body = table.querySelector('tbody');
  list.forEach(van => {
    const tr = el('tr');
    tr.appendChild(textCell(van, 'name', 'vans', {
      placeholder: '例：ハイエース', className: 'cell-name', tdClass: 'col-name'
    }));
    tr.appendChild(textCell(van, 'seats', 'vans', { type: 'number' }));
    tr.appendChild(textCell(van, 'wheelchairSeats', 'vans', { type: 'number' }));
    tr.appendChild(textCell(van, 'driver', 'vans', { placeholder: '例：山田', list: 'driverlist' }));
    const days = el('td');
    days.appendChild(dayBoxes(van, 'vans'));
    tr.appendChild(days);
    tr.appendChild(textCell(van, 'note', 'vans', { placeholder: '空なら「○名」と出ます' }));
    tr.appendChild(flagCell(van, 'active', 'vans', '使う'));
    tr.appendChild(deleteCell(list, van, 'vans', van.name));
    body.appendChild(tr);
  });
  box.appendChild(wrapTable(table));
  box.appendChild(addButton('車を追加', () => {
    list.push({
      id: nextId(list, 'v'), name: '', seats: 4, wheelchairSeats: 0,
      driver: '', days: [1, 2, 3, 4, 5, 6], note: '', active: true
    });
    markDirty('vans');
    renderTab();
  }));
}

function renderNgPairs(box) {
  const list = state.data.ngPairs;
  const users = state.data.users;
  const table = tableEl(['いっしょに乗せない方 1', 'いっしょに乗せない方 2', 'そのわけ（メモ）', '']);
  const body = table.querySelector('tbody');

  const userSelect = (pair, key) => {
    const td = el('td', 'col-name');
    const select = el('select', 'cell-name');
    const blank = el('option', null, '（えらぶ）');
    blank.value = '';
    select.appendChild(blank);
    users.forEach(u => {
      // 画面には氏名だけ出す。保存する値は利用者idのまま。
      const opt = el('option', null, u.name || '（名前なし）');
      opt.value = u.id;
      if (u.id === pair[key]) opt.selected = true;
      select.appendChild(opt);
    });
    select.value = pair[key] || '';
    select.onchange = () => { pair[key] = select.value; markDirty('ngPairs'); };
    td.appendChild(select);
    return td;
  };

  list.forEach(pair => {
    const tr = el('tr');
    tr.appendChild(userSelect(pair, 'a'));
    tr.appendChild(userSelect(pair, 'b'));
    tr.appendChild(textCell(pair, 'reason', 'ngPairs', { placeholder: '例：車内で言い合いになる' }));
    const nameOf = id => {
      const u = users.find(x => x.id === id);
      return u ? u.name : id;
    };
    tr.appendChild(deleteCell(list, pair, 'ngPairs', `${nameOf(pair.a)} と ${nameOf(pair.b)}`));
    body.appendChild(tr);
  });
  box.appendChild(wrapTable(table));
  box.appendChild(addButton('ペアを追加', () => {
    list.push({ a: '', b: '', reason: '' });
    markDirty('ngPairs');
    renderTab();
  }));
}

function renderDrivers(box) {
  const list = state.data.drivers;
  const table = tableEl(['お名前', 'バッジの字（1文字）', '紙の色', '']);
  const body = table.querySelector('tbody');
  list.forEach(driver => {
    const tr = el('tr');
    tr.appendChild(textCell(driver, 'name', 'drivers', { placeholder: '例：田中父' }));
    tr.appendChild(textCell(driver, 'initial', 'drivers', { placeholder: '田' }));
    const td = el('td');
    const select = el('select');
    DRIVER_COLORS.forEach(color => {
      const opt = el('option', null, colorLabel(color));
      opt.value = color;
      if (color === driver.color) opt.selected = true;
      select.appendChild(opt);
    });
    select.onchange = () => { driver.color = select.value; markDirty('drivers'); };
    td.appendChild(select);
    tr.appendChild(td);
    tr.appendChild(deleteCell(list, driver, 'drivers', driver.name));
    body.appendChild(tr);
  });
  box.appendChild(wrapTable(table));
  box.appendChild(addButton('運転手を追加', () => {
    list.push({
      id: nextId(list, 'd'), name: '', initial: '',
      color: DRIVER_COLORS[list.length % DRIVER_COLORS.length]
    });
    markDirty('drivers');
    renderTab();
  }));
}

function colorLabel(color) {
  const names = {
    green: '緑', blue: '青', orange: 'オレンジ',
    pink: 'ピンク', purple: 'むらさき', teal: '青緑'
  };
  return names[color] || color;
}

function wrapTable(table) {
  const wrap = el('div', 'tablewrap');
  wrap.appendChild(table);
  return wrap;
}

function addButton(label, onClick) {
  const row = el('div', 'btnrow');
  const button = el('button', 'btn go', '＋ ' + label);
  button.type = 'button';
  button.onclick = onClick;
  row.appendChild(button);
  return row;
}

/* ============================================================
   タブの切りかえと保存
   ============================================================ */
function renderTabs() {
  const box = document.getElementById('tabs');
  box.innerHTML = '';
  TABS.forEach(tab => {
    const button = el('button', null, tab.label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(tab.key === state.tab));
    button.onclick = () => { state.tab = tab.key; renderTabs(); renderTab(); };
    box.appendChild(button);
  });
}

function renderTab() {
  const box = document.getElementById('tabbody');
  box.innerHTML = '';
  if (state.tab === 'users') renderUsers(box);
  else if (state.tab === 'vans') renderVans(box);
  else if (state.tab === 'ngPairs') renderNgPairs(box);
  else renderDrivers(box);
  fillLists();
  renderSaveBar();
}

/* エリア名・運転手名の入力候補 */
function fillLists() {
  const areas = new Set(Object.keys(state.facility.areas || {}));
  state.data.users.forEach(u => { if (u.area) areas.add(u.area); });
  document.getElementById('arealist').innerHTML =
    [...areas].map(a => `<option value="${escapeHtml(a)}"></option>`).join('');
  const drivers = new Set(state.data.drivers.map(d => d.name).filter(Boolean));
  state.data.vans.forEach(v => { if (v.driver) drivers.add(v.driver); });
  document.getElementById('driverlist').innerHTML =
    [...drivers].map(d => `<option value="${escapeHtml(d)}"></option>`).join('');
}

async function saveCurrent() {
  const tab = TABS.find(t => t.key === state.tab);
  const list = state.data[state.tab];
  const button = document.getElementById('save');
  button.disabled = true;
  try {
    await state.repo.saveMaster({ kind: tab.kind, facility: state.facility, list });
    state.dirty[state.tab] = false;
    renderSaveBar();
    toast(state.store.mode === 'github'
      ? `${tab.label}を保存しました（GitHubに記録しました）`
      : `（お試しモード）${tab.label}をこの端末の中だけに控えました`);
  } catch (e) {
    if (e instanceof ConflictError) {
      await showDialog({
        title: '他の人が先に保存しました',
        bodyHtml: '他の人が先に保存しました。画面を読み直してください。<br>読み直すと、いまの画面の直しは消えます。',
        buttons: [{ label: 'とじる', value: 'close' }]
      });
    } else {
      toast(errorMessage(e), 'error');
    }
  } finally {
    button.disabled = false;
  }
}

/* ============================================================
   起動
   ============================================================ */
export async function start() {
  try {
    const boot = await bootstrap();
    state.config = boot.config;
    state.store = boot.store;
    state.repo = boot.repo;
    state.facilities = boot.facilities;
    state.facility = boot.facility;
    renderModeBadge(document.getElementById('modebadge'), boot.store);

    if (!state.facility) {
      setBanner('banner', '事業所のデータが読めませんでした。設定を確認してください。', 'error');
      return;
    }
    document.getElementById('facilityname').textContent = state.facility.name;
    fillFacilitySelect(
      document.getElementById('facilitypick'),
      state.facilities,
      state.facility.id,
      () => location.reload()
    );

    const masters = await state.repo.loadMasters(state.facility.id, { includeInactive: true });
    state.data = {
      users: masters.users,
      vans: masters.vans,
      ngPairs: masters.ngPairs,
      drivers: masters.drivers
    };
    if (masters.missing.users || masters.missing.vans) {
      setBanner('banner',
        'この事業所のマスタはまだ作られていません。追加して「保存」を押すと、新しくファイルが作られます。', 'warn');
    }

    document.getElementById('save').onclick = saveCurrent;
    renderTabs();
    renderTab();

    window.addEventListener('beforeunload', e => {
      if (!Object.keys(state.dirty).some(k => state.dirty[k])) return;
      e.preventDefault();
      e.returnValue = '';
    });
  } catch (e) {
    setBanner('banner', `うまく開けませんでした：${escapeHtml(errorMessage(e))}`, 'error');
    console.error(e);
  }
}
