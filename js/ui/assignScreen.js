/* ============================================================
   割り当て画面（index.html）の本体

   画面の状態（どの週・どの曜日・迎え／送り）を持ち、
   割り当てロジック（core/assign.js）と保存（store/）をつなぐ。
   ============================================================ */

import { bootstrap, loadFacilityContext, fillFacilitySelect, readParams } from './appShell.js';
import { toast, showDialog, setBanner, renderModeBadge, errorMessage, escapeHtml } from './dom.js';
import { bindDrag } from './drag.js';
import * as R from './assignRender.js';
import * as A from '../core/assign.js';
import { normalizeNote, DIRS } from '../core/schema.js';
import { weekKeyOf, shiftWeekKey, parseDateKey, clockLabel, fullDateLabel, dayLabel, weekShortLabel } from '../core/dates.js';
import { ConflictError } from '../store/errors.js';

const state = {
  config: null, store: null, repo: null,
  facilities: [], facility: null,
  users: [], vans: [], ngPairs: [], drivers: [], ctx: null,
  weekStart: '', day: 1, dir: 'out',
  plan: null, savedJson: '', savedAt: null,
  undoStack: [], busy: false
};

const app = {
  state,

  dayState() {
    return state.plan.days[String(state.day)];
  },
  dirState() {
    return app.dayState()[state.dir];
  },
  unassigned() {
    return A.unassignedUsers(state.ctx, app.dirState(), state.day, state.dir);
  },

  /* ---------- 1手戻すための控え ---------- */
  snapshot() {
    state.undoStack.push(JSON.stringify(app.dirState()));
    if (state.undoStack.length > 50) state.undoStack.shift();
    document.getElementById('undo').disabled = false;
  },

  /* ---------- 座席へ入れる／おろす ---------- */
  place(userId, vanId, index) {
    app.snapshot();
    A.place(state.ctx, app.dirState(), { userId, vanId, index, dir: state.dir, day: state.day });
    app.render();
  },
  toPool(userId) {
    app.snapshot();
    A.removeToPool(state.ctx, app.dirState(), { userId, dir: state.dir, day: state.day });
    app.render();
  },

  setDay(day) {
    state.day = day;
    state.undoStack = [];
    document.getElementById('undo').disabled = true;
    R.renderDayTabs(app);
    app.render();
  },

  markDirty,
  render
};

/* ============================================================
   描画
   ============================================================ */
function render() {
  R.renderVans(app);
  R.renderPool(app);
  R.renderStatus(app);
  R.renderDayNotes(app);
  markDirty();
  bindDrag(app);
}

function markDirty() {
  const node = document.getElementById('savestate');
  if (isDirty()) {
    node.textContent = '● まだ保存していません';
    node.style.color = 'var(--orange)';
  } else {
    node.textContent = state.savedAt ? `${state.savedAt} に保存しました` : '';
    node.style.color = 'var(--green-dark)';
  }
}

function isDirty() {
  return state.plan ? JSON.stringify(state.plan) !== state.savedJson : false;
}

/* ============================================================
   読みこみ
   ============================================================ */
async function loadWeek(weekStart) {
  state.busy = true;
  setBanner('banner', `${escapeHtml(weekStart)} の週を読みこんでいます…`);
  try {
    const result = await state.repo.loadPlan({
      facility: state.facility,
      vans: state.vans,
      weekStart
    });
    state.weekStart = weekStart;
    state.plan = result.plan;
    state.savedJson = JSON.stringify(result.plan);
    state.savedAt = null;
    state.undoStack = [];
    document.getElementById('undo').disabled = true;
    setBanner('banner', '');
    if (!result.exists && state.store.mode === 'github') {
      toast('この週の送迎表はまだありません。「この週をルールどおりに割り当て」から始めてください');
    }
  } catch (e) {
    setBanner('banner', `読みこめませんでした：${escapeHtml(errorMessage(e))}`, 'error');
    throw e;
  } finally {
    state.busy = false;
  }
  R.renderWeekLabel(app);
  R.renderDayTabs(app);
  render();
}

/* 未保存のときに聞く。true なら進んでよい */
async function confirmLeave(actionLabel) {
  if (!isDirty()) return true;
  const answer = await showDialog({
    title: 'まだ保存していません',
    bodyHtml: `保存していない変更があります。<br>保存してから${escapeHtml(actionLabel)}ますか？`,
    buttons: [
      { label: 'やめる', value: 'cancel' },
      { label: '保存しない', value: 'discard' },
      { label: '保存する', value: 'save', kind: 'go' }
    ]
  });
  if (answer === 'cancel') return false;
  if (answer === 'save') return await doSave();
  return true;
}

async function changeWeek(delta) {
  if (state.busy) return;
  if (!await confirmLeave('週をかえ')) return;
  await loadWeek(shiftWeekKey(state.weekStart, delta));
}

/* ============================================================
   保存
   ============================================================ */
async function doSave() {
  if (state.busy) return false;
  state.busy = true;
  const button = document.getElementById('save');
  button.disabled = true;
  try {
    const result = await state.repo.savePlan({
      facility: state.facility,
      weekStart: state.weekStart,
      plan: state.plan,
      editorName: state.config.editorName
    });
    state.plan = result.plan;
    state.savedJson = JSON.stringify(result.plan);
    state.savedAt = clockLabel();
    markDirty();
    toast(state.store.mode === 'github'
      ? '保存しました（GitHubに記録しました）'
      : '（お試しモード）この端末の中だけに控えました');
    return true;
  } catch (e) {
    if (e instanceof ConflictError) {
      const answer = await showDialog({
        title: '他の人が先に保存しました',
        bodyHtml: '他の人が先に保存しました。画面を読み直してください。<br>' +
          '<b>読み直すと、いまの画面の直しは消えます。</b>必要なところは、あとでもう一度直してください。',
        buttons: [
          { label: 'あとで', value: 'later' },
          { label: '読み直す', value: 'reload', kind: 'go' }
        ]
      });
      if (answer === 'reload') {
        state.repo.forgetSha(`data/${state.facility.id}/plans/${state.weekStart}.json`);
        await loadWeek(state.weekStart);
      }
    } else {
      toast(errorMessage(e), 'error');
    }
    return false;
  } finally {
    state.busy = false;
    document.getElementById('save').disabled = false;
  }
}

/* ============================================================
   ボタンの動き
   ============================================================ */
/* 週全体の操作をもどせるように控える（ルール割り当て／みんな降ろす用） */
function pushWeekUndo() {
  state.undoStack.push(JSON.stringify({ __week: true, days: state.plan.days }));
  if (state.undoStack.length > 50) state.undoStack.shift();
  document.getElementById('undo').disabled = false;
}

async function autoAssignWeek() {
  const answer = await showDialog({
    title: 'この週をルールどおりに割り当てます',
    bodyHtml:
      'この週の、まだ空いている席だけを、マスタの「いつもの車」どおりに埋めます。<br>' +
      'すでに乗っている人はそのままです。<br>' +
      'いつもの車が決まっていない人は自動では乗せません。<br>' +
      'よろしいですか？',
    buttons: [
      { label: 'やめる', value: 'cancel' },
      { label: '割り当てる', value: 'ok', kind: 'go' }
    ]
  });
  if (answer !== 'ok') return;

  pushWeekUndo();

  const summary = A.autoAssignWeek(state.ctx, {
    plan: state.plan,
    days: state.facility.days
  });
  render();

  const left = summary.skippedNoRule + summary.skippedBlocked;
  if (summary.placed === 0 && left === 0) {
    toast('乗せる人がいませんでした（もう埋まっているか、対象の方がいません）', 'warn');
  } else if (left === 0) {
    toast(`${summary.placed}名を乗せました`);
  } else {
    const parts = [];
    if (summary.skippedNoRule) parts.push(`ルール未設定 ${summary.skippedNoRule}名`);
    if (summary.skippedBlocked) parts.push(`席不足など ${summary.skippedBlocked}名`);
    toast(
      `${summary.placed}名を乗せました。${parts.join('・')}は手でうごかしてください`,
      'warn'
    );
  }
}

async function clearWeekAssignments() {
  const answer = await showDialog({
    title: 'みんな降ろします',
    bodyHtml:
      'この週に乗っている人を、すべて「まだ乗っていない人」にもどします。<br>' +
      '車両のメモや日ごとのメモ・運転手の指定はそのままです。よろしいですか？',
    buttons: [
      { label: 'やめる', value: 'cancel' },
      { label: 'みんな降ろす', value: 'ok', kind: 'go' }
    ]
  });
  if (answer !== 'ok') return;

  pushWeekUndo();

  const { removed } = A.clearWeekAssignments(state.ctx, {
    plan: state.plan,
    days: state.facility.days
  });
  render();

  if (removed === 0) {
    toast('乗っている人はいませんでした', 'warn');
  } else {
    toast(`${removed}名を降ろしました。「1手戻す」でもどせます`);
  }
}

function undo() {
  if (!state.undoStack.length) return;
  const data = JSON.parse(state.undoStack.pop());
  if (data && data.__week && data.days) {
    state.plan.days = data.days;
  } else {
    app.dayState()[state.dir] = data;
  }
  if (!state.undoStack.length) document.getElementById('undo').disabled = true;
  render();
  toast('1つ前にもどしました');
}

function setDir(next) {
  if (next === 'ret') {
    const dayState = app.dayState();
    const retEmpty = A.placedIds(state.ctx, dayState.ret, state.day).length === 0;
    const outHas = A.placedIds(state.ctx, dayState.out, state.day).length > 0;
    if (retEmpty && outHas) {
      dayState.ret = A.copyOutToReturn(state.ctx, { day: state.day, outState: dayState.out });
      toast('送りは迎えのコピーから始めます。ちがう人だけ直してください');
    }
  }
  state.dir = next;
  state.undoStack = [];
  document.getElementById('undo').disabled = true;
  document.querySelectorAll('#dirseg button').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.dir === next));
  });
  render();
}

function addNote() {
  const kindSelect = document.getElementById('notekind');
  const input = document.getElementById('notetext');
  const text = input.value.trim();
  if (!text) {
    toast('メモの文を入れてください', 'warn');
    return;
  }
  app.dayState().notes.push(normalizeNote({ kind: kindSelect.value, text }));
  input.value = '';
  R.renderDayNotes(app);
  markDirty();
}

/* ------------------------------------------------------------
   確定して配信（LINE WORKS へ）

   アプリは「配信してください」という小さな依頼ファイルを
   データ用リポジトリに置くところまでを受けもちます。
   PNGを作って送るのは、そのリポジトリの GitHub Actions です。
   ------------------------------------------------------------ */

/* 週ぜんぶを見て、まだ乗っていない人が残っている曜日・便を集める */
function unfinishedSlots() {
  const list = [];
  state.facility.days.forEach(n => {
    const dayState = state.plan.days[String(n)];
    if (!dayState) return;
    DIRS.forEach(d => {
      const left = A.unassignedUsers(state.ctx, dayState[d.key], n, d.key);
      if (left.length) list.push({ day: n, dirLabel: d.label, count: left.length });
    });
  });
  return list;
}

async function doPublish() {
  if (state.busy) return;

  const unfinished = unfinishedSlots();
  if (unfinished.length) {
    const lines = unfinished
      .slice(0, 8)
      .map(s => `${dayLabel(s.day)}曜の${s.dirLabel}　${s.count}名`);
    if (unfinished.length > 8) lines.push('ほか');
    await showDialog({
      title: 'まだ乗っていない人がいます',
      bodyHtml: 'この週は、つぎのところがまだ空いています。<br>' +
        `<b>${lines.map(escapeHtml).join('<br>')}</b><br>` +
        'ぜんぶ乗せてから、もう一度「確定して配信」をおしてください。',
      buttons: [{ label: 'とじる', value: 'close' }]
    });
    return;
  }

  const answer = await showDialog({
    title: 'この内容で配信します',
    bodyHtml: `<b>${escapeHtml(state.facility.name)}</b> の ` +
      `<b>${escapeHtml(weekShortLabel(state.weekStart))}</b> の送迎表を、<br>` +
      'LINE WORKS の管理グループへ配信します。よろしいですか？<br>' +
      '（トークに、紙と同じ画像が1枚とどきます）',
    buttons: [
      { label: 'やめる', value: 'cancel' },
      { label: '配信する', value: 'go', kind: 'go' }
    ]
  });
  if (answer !== 'go') return;

  /* 配信されるのは「保存したもの」なので、まず保存する */
  if (!await doSave()) return;

  state.busy = true;
  const button = document.getElementById('publish');
  button.disabled = true;
  try {
    await state.repo.savePublishRequest({
      facility: state.facility,
      weekStart: state.weekStart,
      requestedBy: state.config.editorName
    });
    if (state.store.mode === 'github') {
      toast('配信をお願いしました。1〜2分でトークに届きます');
    } else {
      toast('（お試しモード）配信の依頼だけ控えました。実際には送られません', 'warn');
    }
  } catch (e) {
    if (e instanceof ConflictError) {
      toast('前の配信がまだ終わっていないようです。少し待ってからもう一度おしてください', 'warn');
    } else {
      toast(errorMessage(e), 'error');
    }
  } finally {
    state.busy = false;
    button.disabled = false;
  }
}

async function goPrint() {
  if (isDirty()) {
    const answer = await showDialog({
      title: 'まだ保存していません',
      bodyHtml: '印刷の画面は、保存したものを読んで作ります。<br>先に保存しますか？',
      buttons: [
        { label: 'やめる', value: 'cancel' },
        { label: 'そのまま印刷へ', value: 'go' },
        { label: '保存して印刷', value: 'save', kind: 'go' }
      ]
    });
    if (answer === 'cancel') return;
    if (answer === 'save' && !await doSave()) return;
  }
  const url = `print.html?facility=${encodeURIComponent(state.facility.id)}&week=${encodeURIComponent(state.weekStart)}`;
  location.href = url;
}

/* ============================================================
   起動
   ============================================================ */
export async function start() {
  document.getElementById('guide-close').onclick = () =>
    document.getElementById('guide').classList.add('hide');

  try {
    const boot = await bootstrap();
    state.config = boot.config;
    state.store = boot.store;
    state.repo = boot.repo;
    state.facilities = boot.facilities;
    state.facility = boot.facility;
    renderModeBadge(document.getElementById('modebadge'), boot.store);

    if (!state.facility) {
      setBanner('banner',
        '事業所のデータ（data/facilities.json）が読めませんでした。' +
        '<a href="settings.html">設定</a>でデータ用リポジトリを確認してください。', 'error');
      return;
    }
    document.getElementById('facilityname').textContent = state.facility.name;
    fillFacilitySelect(
      document.getElementById('facilitypick'),
      state.facilities,
      state.facility.id,
      () => location.reload()
    );

    const masters = await loadFacilityContext(state.repo, state.facility);
    state.users = masters.users;
    state.vans = masters.vans;
    state.ngPairs = masters.ngPairs;
    state.drivers = masters.drivers;
    state.ctx = masters.ctx;

    const params = readParams();
    const asked = parseDateKey(params.weekStart);
    const week = asked ? weekKeyOf(asked) : weekKeyOf(new Date());
    state.day = firstDay();
    await loadWeek(week);

    /* 読みこみの帯を出しおわったあとに、足りないマスタの案内を出す */
    if (!state.users.length || !state.vans.length) {
      setBanner('banner',
        `<b>${escapeHtml(state.facility.name)}</b> の利用者または車両がまだ登録されていません。` +
        '<a href="masters.html">マスタ編集</a>から登録してください。', 'warn');
    }

    document.getElementById('auto').onclick = autoAssignWeek;
    document.getElementById('clearweek').onclick = clearWeekAssignments;
    document.getElementById('undo').onclick = undo;
    document.getElementById('save').onclick = () => { doSave(); };
    document.getElementById('print').onclick = goPrint;
    document.getElementById('publish').onclick = doPublish;
    document.getElementById('prevweek').onclick = () => changeWeek(-1);
    document.getElementById('nextweek').onclick = () => changeWeek(1);
    document.getElementById('noteadd').onclick = addNote;
    document.getElementById('notetext').onkeydown = e => { if (e.key === 'Enter') addNote(); };
    document.querySelectorAll('#dirseg button').forEach(b => {
      b.onclick = () => setDir(b.dataset.dir);
    });

    window.addEventListener('beforeunload', e => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  } catch (e) {
    setBanner('banner', `うまく開けませんでした：${escapeHtml(errorMessage(e))}`, 'error');
    console.error(e);
  }
}

function firstDay() {
  const days = state.facility.days;
  const today = new Date().getDay();          /* 0=日 */
  const n = today === 0 ? 1 : today;          /* 日曜なら月曜を出す */
  return days.includes(n) ? n : (days[0] || 1);
}

/* ちょっとした補助：今日の日付を画面のどこかに出したいとき用 */
export function todayLabel() {
  return fullDateLabel(state.weekStart, state.day);
}
