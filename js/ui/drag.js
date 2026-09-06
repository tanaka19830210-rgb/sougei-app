/* ============================================================
   指でひっぱって座席へ入れる（ドラッグ＆ドロップ）
   プロトv3 の動きをそのまま移したもの。
   ============================================================ */

import { toast, showDialog, escapeHtml } from './dom.js';
import * as A from '../core/assign.js';

let app = null;
let drag = null;
let scroller = null;
let windowBound = false;

export function bindDrag(currentApp) {
  app = currentApp;
  document.querySelectorAll('.tile').forEach(tile => {
    tile.addEventListener('pointerdown', onDown);
  });

  /*
    指をはなした合図（pointerup / pointercancel）がタイルに届かないことがある。
    通知をさわった・ほかのアプリに切りかえた・2本目の指が触れた、など。
    そのまま drag が残ると、以後どのタイルを押しても何も起きなくなる
    （onDown の先頭で「ひっぱり中なら無視」しているため）。
    window でも受けて、必ず片づける。
  */
  if (!windowBound) {
    windowBound = true;
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onUp();
    });
  }
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
  /* 前のひっぱりが片づいていない（タイルが画面から消えている）なら捨てる */
  if (drag && !drag.tile.isConnected) onUp();
  if (drag) return;
  const tile = e.currentTarget;
  const byFinger = e.pointerType === 'touch' || e.pointerType === 'pen';

  drag = {
    uid: tile.dataset.uid, tile, fly: null,
    pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    dx: 0, dy: 0,
    lifted: false,
    target: null, reason: null,
    x: e.clientX, y: e.clientY
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
    let moved = false;
    if (drag.y < headerH + 20) { window.scrollBy(0, -14); moved = true; }
    else if (drag.y > window.innerHeight - 90) { window.scrollBy(0, 14); moved = true; }
    /*
      指を止めたままスクロールしているあいだは pointermove が来ない。
      置き先の緑わくを更新しないと、指をはなしたとき「さっき光っていた席」に
      入ってしまうので、スクロールのたびに指の下を見なおす。
    */
    if (moved) updateTarget(drag.x, drag.y);
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

  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.fly.style.left = (e.clientX - drag.dx) + 'px';
  drag.fly.style.top = (e.clientY - drag.dy) + 'px';
  updateTarget(e.clientX, e.clientY);
}

/* 指の下にある席（またはプール）を調べて、置けるなら緑にする */
function updateTarget(x, y) {
  if (!drag || !drag.lifted) return;
  document.querySelectorAll('.valid').forEach(node => node.classList.remove('valid'));
  drag.target = null;
  drag.reason = null;

  const under = document.elementFromPoint(x, y);
  if (!under) return;
  const slot = under.closest('.slot');
  const pool = under.closest('.pool');
  if (slot) {
    const ok = A.canDrop(
      app.state.ctx, app.dirState(), drag.uid, slot.dataset.van, app.state.day,
      Number(slot.dataset.idx)
    );
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

function onUp(e) {
  if (!drag) return;
  /* 2本目の指の pointerup で、1本目のひっぱりを終わらせない */
  if (e && e.pointerId !== undefined && e.pointerId !== drag.pointerId && e.type !== 'blur') return;

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

  /* 途中で途切れた（アプリ切替など）ときは、置かずにもどす */
  if (!e || e.type === 'pointercancel' || e.type === 'blur' || e.type === 'visibilitychange') {
    if (e && e.type === 'pointercancel' && reason) toast(reason, 'warn');
    return;
  }

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
  const ctx = app.state.ctx;
  const dirState = app.dirState();

  /* その席にいた人はどうなるか。もといた席があれば取りかえっこ、プールから来たなら降りる */
  const row = dirState.vans[vanId] ? dirState.vans[vanId].rows[index] : null;
  const displacedId = row && row.userId ? row.userId : null;
  const fromSeat = !!A.findRow(ctx, dirState, uid, app.state.day);
  const nameOf = id => (ctx.usersById[id] ? ctx.usersById[id].name : '（マスタに無い方）');
  const finish = () => {
    app.place(uid, vanId, index);
    if (!displacedId) return;
    if (fromSeat) toast(`${nameOf(displacedId)}さんと席を取りかえました`);
    else toast(`${nameOf(displacedId)}さんを降ろしました。「まだ乗っていない人」にもどっています`, 'warn');
  };

  const partner = A.ngPartnerIn(ctx, dirState, vanId, uid, displacedId);
  if (partner) {
    askNg(uid, partner, vanId).then(ok => {
      if (!ok) return;
      finish();
      toast('いっしょに乗せました。記録にのこります', 'warn');
    });
    return;
  }
  finish();
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
