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

function onDown(e) {
  if (drag) return;
  const tile = e.currentTarget;
  const uid = tile.dataset.uid;
  const rect = tile.getBoundingClientRect();
  const fly = tile.cloneNode(true);
  fly.classList.add('flying');
  fly.style.left = rect.left + 'px';
  fly.style.top = rect.top + 'px';
  fly.style.width = rect.width + 'px';
  document.body.appendChild(fly);
  tile.classList.add('ghost');
  drag = {
    uid, tile, fly,
    dx: e.clientX - rect.left,
    dy: e.clientY - rect.top,
    target: null, reason: null, y: e.clientY
  };
  tile.setPointerCapture(e.pointerId);
  tile.addEventListener('pointermove', onMove);
  tile.addEventListener('pointerup', onUp);
  tile.addEventListener('pointercancel', onUp);
  /* 画面のはしに寄せたときは自動でスクロール */
  scroller = setInterval(() => {
    if (!drag) return;
    if (drag.y < 140) window.scrollBy(0, -14);
    else if (drag.y > window.innerHeight - 90) window.scrollBy(0, 14);
  }, 16);
  e.preventDefault();
}

function onMove(e) {
  if (!drag) return;
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
  const { uid, tile, fly, target, reason } = drag;
  tile.removeEventListener('pointermove', onMove);
  tile.removeEventListener('pointerup', onUp);
  tile.removeEventListener('pointercancel', onUp);
  fly.remove();
  tile.classList.remove('ghost');
  document.querySelectorAll('.valid').forEach(node => node.classList.remove('valid'));
  clearInterval(scroller);
  drag = null;

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
