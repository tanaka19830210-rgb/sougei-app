/* ============================================================
   指でひっぱって座席へ入れる（ドラッグ＆ドロップ）
   プロトv3 の動きをそのまま移したもの。
   ============================================================ */

import { toast, showDialog, escapeHtml } from './dom.js';
import * as A from '../core/assign.js';

let app = null;
let drag = null;
let scroller = null;

export function bindDrag(currentApp) {
  app = currentApp;
  document.querySelectorAll('.tile').forEach(tile => {
    tile.addEventListener('pointerdown', onDown);
  });
}

/*
  指が触れてすぐ持ち上げると、タイルの上から始めた「画面のスクロール」が
  できなくなる（タイルは touch-action:none のため）。
  利用者が多いと、リストの下のほうの人に指で届かなくなる。

  そこで、この距離だけ動いてから初めて持ち上げる。
  それまではブラウザにスクロールさせる。
  マウスは取りこぼしがないので、しきい値なしで持ち上げる。
*/
const DRAG_START_PX = 8;

function onDown(e) {
  if (drag) return;
  const tile = e.currentTarget;
  const byFinger = e.pointerType === 'touch' || e.pointerType === 'pen';

  drag = {
    uid: tile.dataset.uid, tile, fly: null,
    startX: e.clientX, startY: e.clientY,
    dx: 0, dy: 0,
    lifted: false,
    target: null, reason: null, y: e.clientY
  };

  tile.addEventListener('pointermove', onMove);
  tile.addEventListener('pointerup', onUp);
  tile.addEventListener('pointercancel', onUp);

  if (byFinger) return;          /* 指のときは、動きはじめるまで待つ */
  lift(e);
  e.preventDefault();
}

/* ここで初めてタイルを持ち上げる */
function lift(e) {
  if (!drag || drag.lifted) return;
  const { tile } = drag;
  const rect = tile.getBoundingClientRect();
  const fly = tile.cloneNode(true);
  fly.classList.add('flying');
  fly.style.left = rect.left + 'px';
  fly.style.top = rect.top + 'px';
  fly.style.width = rect.width + 'px';
  document.body.appendChild(fly);
  tile.classList.add('ghost');

  drag.fly = fly;
  drag.dx = drag.startX - rect.left;
  drag.dy = drag.startY - rect.top;
  drag.lifted = true;

  try { tile.setPointerCapture(e.pointerId); } catch (err) { /* 取れなくても続けられる */ }

  /* 画面のはしに寄せたときは自動でスクロール。
     はしの幅は、ヘッダーの実際の高さに合わせる（iPad はヘッダーが厚い） */
  clearInterval(scroller);
  scroller = setInterval(() => {
    if (!drag || !drag.lifted) return;
    const headerH = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--header-h')
    ) || 140;
    if (drag.y < headerH + 20) window.scrollBy(0, -14);
    else if (drag.y > window.innerHeight - 90) window.scrollBy(0, 14);
  }, 16);
}

function onMove(e) {
  if (!drag) return;

  /* まだ持ち上げていない（指）。少し動いたら持ち上げる */
  if (!drag.lifted) {
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (moved < DRAG_START_PX) return;   /* ここまではブラウザにスクロールさせる */
    lift(e);
    e.preventDefault();
  }

  drag.y = e.clientY;
  drag.fly.style.left = (e.clientX - drag.dx) + 'px';
  drag.fly.style.top = (e.clientY - drag.dy) + 'px';
  document.querySelectorAll('.valid').forEach(node => node.classList.remove('valid'));
  drag.target = null;
  drag.reason = null;

  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (!under) return;
  const slot = under.closest('.slot');
  const pool = under.closest('.pool');
  if (slot) {
    const ok = A.canDrop(app.state.ctx, app.dirState(), drag.uid, slot.dataset.van, app.state.day);
    if (ok === true) {
      slot.classList.add('valid');
      drag.target = { type: 'slot', el: slot };
    } else {
      drag.reason = ok.reason;
    }
  } else if (pool) {
    pool.classList.add('valid');
    drag.target = { type: 'pool' };
  }
}

function onUp() {
  if (!drag) return;
  const { uid, tile, fly, target, reason, lifted } = drag;
  tile.removeEventListener('pointermove', onMove);
  tile.removeEventListener('pointerup', onUp);
  tile.removeEventListener('pointercancel', onUp);
  if (fly) fly.remove();
  tile.classList.remove('ghost');
  document.querySelectorAll('.valid').forEach(node => node.classList.remove('valid'));
  clearInterval(scroller);
  drag = null;

  /* 持ち上がる前に指をはなした＝ただのタップ。なにもしない */
  if (!lifted) return;

  if (!target) {
    if (reason) toast(reason, 'warn');
    return;
  }
  if (target.type === 'pool') {
    app.toPool(uid);
    return;
  }
  const vanId = target.el.dataset.van;
  const index = Number(target.el.dataset.idx);
  const partner = A.ngPartnerIn(app.state.ctx, app.dirState(), vanId, uid);
  if (partner) {
    askNg(uid, partner, vanId).then(ok => {
      if (!ok) return;
      app.place(uid, vanId, index);
      toast('いっしょに乗せました。記録にのこります', 'warn');
    });
    return;
  }
  app.place(uid, vanId, index);
}

/* 同乗NGペアのときの確認（禁止はしない。最後は職員の判断） */
async function askNg(uid, partnerId, vanId) {
  const ctx = app.state.ctx;
  const me = ctx.usersById[uid];
  const partner = ctx.usersById[partnerId];
  const van = ctx.vansById[vanId];
  const answer = await showDialog({
    title: 'いっしょに乗れない組み合わせです',
    bodyHtml: `<b>${escapeHtml(me ? me.name : '')}</b>さんと<b>${escapeHtml(partner ? partner.name : '')}</b>さんは、` +
      'いっしょに乗れない組み合わせとして登録されています。<br>' +
      `それでも <b>${escapeHtml(van ? van.name : '')}</b> に乗せますか？` +
      '（職員の配置によっては大丈夫な場合もあるため、判断はおまかせします）',
    buttons: [
      { label: 'やめる', value: false },
      { label: 'それでも乗せる', value: true, kind: 'go' }
    ]
  });
  return answer === true;
}
