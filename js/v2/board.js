/* ============================================================
   1週間ぶんの送迎表を、1画面に描く（月〜土 × 全車両 × 迎え・送り）

   - 大きさは全部「文字の大きさの何倍か（em）」で決めてある。
     だから文字の大きさを変えるだけで、表ぜんたいが同じ形のまま伸び縮みする。
     「全体」を押すと、画面にちょうど収まる大きさになる。
   - 名前の札は指でひっぱって、どの曜日・どの車・どの便へも動かせる。
     指のときは「少し長く押してから」持ち上がる（そうしないと表を
     指でずらせなくなるため）。マウスはすぐ持ち上がる。
   ============================================================ */

import { DAY_NUMBERS, DAY_NAMES, LEGS, LEG_NAMES, dayCounts, shortTime, personKey, normText, seatsOf } from './model.js';
import { escapeHtml } from '../core/html.js';
import { dateOfDay, mdLabel } from '../core/dates.js';

const BASE_FONT = 13;
const PLACE_COLORS = ['#7faad5', '#e084b3', '#4aa8a0', '#f0a830', '#9b8ac4', '#8cc152', '#e9806e', '#5bc0de'];
const placeColor = new Map();

function colorOf(place) {
  const key = normText(place);
  if (!key || key === '自宅') return 'transparent';
  if (!placeColor.has(key)) placeColor.set(key, PLACE_COLORS[placeColor.size % PLACE_COLORS.length]);
  return placeColor.get(key);
}

/* layout … 'auto'（文字が大きくなるほうを自動でえらぶ）・'wide'（迎えと送りを横に）・'tall'（たてに積む） */
export function createBoard({ stage, board, handlers, layout = 'auto' }) {
  let scale = 1, fitScale = 1, state = null;
  /* wide＝迎えと送りを横にならべる（横長の画面むき）。tall＝たてに積む（たて長の画面むき）。
     端末の向きで自動に切りかわる。 */
  let wide = true;

  /* ---------- 描く ---------- */
  function render(next) {
    state = next;
    const { week, warnings = [], changes = [], locked, roster } = state;
    const warnKey = new Set(warnings.filter(w => w.name).map(w => `${w.day}|${w.leg}|${w.vanId}|${w.name}`));
    const warnCell = new Set(warnings.filter(w => !w.name).map(w => `${w.day}|${w.leg}|${w.vanId}`));
    const changedCell = new Set(changes.filter(c => !c.note).map(c => `${c.day}|${c.leg}|${c.vanId}`));
    const changedName = new Set(changes.filter(c => c.name).map(c => `${c.day}|${c.leg}|${c.vanId}|${c.name}`));
    const changedNote = new Set(changes.filter(c => c.note).map(c => c.day));

    const html = ['<div class="corner"></div>'];
    DAY_NUMBERS.forEach(day => {
      const c = dayCounts(week, day);
      html.push(`<div class="dayhead" style="${wide ? 'grid-column:span 2' : ''}"><b>${DAY_NAMES[day]}</b><span>${mdLabel(dateOfDay(week.weekStart, day))}</span><em title="利用人数（迎え・送り）">${c.all}<small>（${c.out}・${c.ret}）</small></em></div>`);
    });

    week.vans.forEach((van, vi) => {
      const cap = seatsOf(van, roster);
      html.push(`<div class="vanname${vi % 2 ? ' alt' : ''}" data-van="${escapeHtml(van.id)}"><span>${escapeHtml(van.name)}</span><b class="cap${cap.fixed ? '' : ' guess'}" title="${cap.fixed ? '最大の乗車人数' : 'これまでの最大（まだ決めていません）'}">${cap.seats ? cap.seats + '人' : '？人'}</b></div>`);
      const order = [];
      if (wide) DAY_NUMBERS.forEach(day => LEGS.forEach(leg => order.push([day, leg])));
      else LEGS.forEach(leg => DAY_NUMBERS.forEach(day => order.push([day, leg])));
      order.forEach(([day, leg]) => {
        {
          const trip = week.days[day].trips[van.id][leg];
          const key = `${day}|${leg}|${van.id}`;
          const cls = ['cell', leg, vi % 2 ? 'alt' : '', changedCell.has(key) ? 'changed' : '', warnCell.has(key) ? 'warn' : '', trip.rows.length || trip.driver ? '' : 'empty'].filter(Boolean).join(' ');
          html.push(`<div class="${cls}" data-day="${day}" data-van="${escapeHtml(van.id)}" data-leg="${leg}">`);
          html.push(`<div class="drv"><i>${LEG_NAMES[leg][0]}</i><span class="${trip.driver ? '' : 'none'}">${escapeHtml(trip.driver || '運転手')}</span>${trip.rows.length ? `<em class="cnt${cap.seats && trip.rows.length > cap.seats ? ' over' : cap.seats && trip.rows.length === cap.seats ? ' full' : ''}">${trip.rows.length}${cap.seats ? '/' + cap.seats : ''}</em>` : ''}<u class="add" title="人を足す">＋</u></div>`);
          trip.rows.forEach((row, i) => {
            const k = `${key}|${personKey(row.name)}`;
            const c2 = ['chip', row.flag || '', warnKey.has(k) ? 'warn' : '', changedName.has(k) ? 'changed' : ''].filter(Boolean).join(' ');
            html.push(`<div class="${c2}" data-i="${i}" style="--pc:${colorOf(row.place)}"><span class="nm">${escapeHtml(row.name)}<s>様</s>${row.place ? `<small>${escapeHtml(row.place)}</small>` : ''}</span><span class="tm">${shortTime(row.time)}</span></div>`);
          });
          html.push('</div>');
        }
      });
    });

    html.push('<div class="vanname notes"><span>連絡</span></div>');
    DAY_NUMBERS.forEach(day => {
      const notes = week.days[day].notes;
      html.push(`<div class="notecell${changedNote.has(day) ? ' changed' : ''}" data-day="${day}" style="${wide ? 'grid-column:span 2' : ''}">${notes.map(n => `<p>${escapeHtml(n)}</p>`).join('') || '<p class="none">＋ 連絡</p>'}</div>`);
    });

    board.innerHTML = html.join('');
    board.classList.toggle('wide', wide);
    /* たてに積むときは、車の名前を迎えと送りの2段ぶんの高さにする */
    if (!wide) board.querySelectorAll('.vanname:not(.notes)').forEach(n => { n.style.gridRow = 'span 2'; });
    board.classList.toggle('locked', !!locked);
  }

  /* ---------- 大きさ ---------- */
  function setScale(next, focus) {
    const old = scale;
    scale = Math.max(fitScale * 0.9, Math.min(2.4, next));
    const fx = focus ? focus.x : stage.clientWidth / 2, fy = focus ? focus.y : stage.clientHeight / 2;
    const px = (stage.scrollLeft + fx) / old, py = (stage.scrollTop + fy) / old;
    board.style.fontSize = (BASE_FONT * scale) + 'px';
    stage.scrollLeft = px * scale - fx;
    stage.scrollTop = py * scale - fy;
    stage.classList.toggle('zoomed', scale > fitScale * 1.02);
  }

  /* 画面にちょうど収まる大きさを測る。
     線の太さなど伸び縮みしない所があるので、何回か測りなおして合わせる。 */
  function measureFit(width = stage.clientWidth, height = stage.clientHeight) {
    let s = 1;
    for (let i = 0; i < 5; i++) {
      board.style.fontSize = (BASE_FONT * s) + 'px';
      const ratio = Math.min((width - 8) / board.offsetWidth, (height - 8) / board.offsetHeight);
      if (Math.abs(ratio - 1) < 0.004) break;
      s *= ratio;
    }
    return s;
  }

  function fit() {
    if (state) {
      /* 自動のときは、画面が横長なら横ならべ（A）、たて長ならたて積み（C） */
      const best = layout === 'wide' ? true : layout === 'tall' ? false : stage.clientWidth >= stage.clientHeight;
      if (wide !== best) { wide = best; render(state); }
      fitScale = measureFit();
    } else fitScale = measureFit();
    scale = fitScale;
    board.style.fontSize = (BASE_FONT * scale) + 'px';
    stage.scrollLeft = 0; stage.scrollTop = 0;
    stage.classList.remove('zoomed');
  }

  /* ---------- 2本指で大きさを変える ---------- */
  const pointers = new Map();
  let pinch = null;
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      cancelDrag();
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
    }
  });
  stage.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const rect = stage.getBoundingClientRect();
      setScale(pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist, { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top });
    }
  });
  const endPointer = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => stage.addEventListener(n, endPointer));
  /* 2本指のあいだは、ブラウザ自身の拡大やスクロールを止める */
  stage.addEventListener('touchmove', e => { if (e.touches.length >= 2 || drag) e.preventDefault(); }, { passive: false });
  stage.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    setScale(scale * (e.deltaY < 0 ? 1.1 : 0.9), { x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, { passive: false });

  /* ---------- 押す・ひっぱる ---------- */
  const HOLD_MS = 230, MOVE_PX = 8;
  let press = null, drag = null;

  function cellInfo(cell) {
    return { day: Number(cell.dataset.day), vanId: cell.dataset.van, leg: cell.dataset.leg };
  }

  board.addEventListener('pointerdown', e => {
    if (state.locked || e.button > 0 || pointers.size > 1) return;
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const touch = e.pointerType !== 'mouse';
    press = { chip, id: e.pointerId, x: e.clientX, y: e.clientY, touch, timer: null };
    if (touch) press.timer = setTimeout(() => { if (press) lift(press.x, press.y); }, HOLD_MS);
  });

  window.addEventListener('pointermove', e => {
    if (drag && e.pointerId === drag.id) { moveDrag(e.clientX, e.clientY); return; }
    if (!press || e.pointerId !== press.id) return;
    const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_PX;
    if (!far) return;
    if (press.touch) { clearTimeout(press.timer); press = null; }   /* 長押しの前に動いた＝表をずらしている */
    else lift(e.clientX, e.clientY);
  });

  function lift(x, y) {
    const chip = press.chip;
    const rect = chip.getBoundingClientRect();
    const fly = chip.cloneNode(true);
    fly.className = 'chip fly';
    fly.style.cssText += `;width:${rect.width}px;font-size:${getComputedStyle(chip).fontSize};`;
    document.body.appendChild(fly);
    chip.classList.add('lifted');
    document.body.classList.add('dragging');
    drag = { id: press.id, chip, fly, from: { ...cellInfo(chip.closest('.cell')), index: Number(chip.dataset.i) }, target: null, ox: x - rect.left, oy: y - rect.top };
    clearTimeout(press.timer);
    press = null;
    if (navigator.vibrate) navigator.vibrate(8);
    moveDrag(x, y);
  }

  function moveDrag(x, y) {
    drag.fly.style.transform = `translate(${x - drag.ox}px, ${y - drag.oy}px)`;
    const under = document.elementFromPoint(x, y);
    const cell = under && under.closest ? under.closest('.cell') : null;
    const bin = under && under.closest ? under.closest('#bin') : null;
    board.querySelectorAll('.cell.over').forEach(n => n.classList.remove('over'));
    board.querySelectorAll('.chip.gap').forEach(n => n.classList.remove('gap'));
    document.getElementById('bin').classList.toggle('over', !!bin);
    drag.target = null;
    if (bin) { drag.target = { bin: true }; }
    else if (cell) {
      cell.classList.add('over');
      const chips = [...cell.querySelectorAll('.chip:not(.lifted)')];
      let index = chips.length;
      for (let i = 0; i < chips.length; i++) {
        const r = chips[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) { index = i; chips[i].classList.add('gap'); break; }
      }
      drag.target = { ...cellInfo(cell), index };
    }
    /* 画面のはしへ持っていくと、表がそちらへ動く */
    const r = stage.getBoundingClientRect(), edge = 46, step = 14;
    if (y > r.bottom - edge) stage.scrollTop += step; else if (y < r.top + edge) stage.scrollTop -= step;
    if (x > r.right - edge) stage.scrollLeft += step; else if (x < r.left + edge) stage.scrollLeft -= step;
  }

  function cancelDrag() {
    if (press) { clearTimeout(press.timer); press = null; }
    if (!drag) return;
    drag.fly.remove();
    drag.chip.classList.remove('lifted');
    document.body.classList.remove('dragging');
    board.querySelectorAll('.cell.over').forEach(n => n.classList.remove('over'));
    board.querySelectorAll('.chip.gap').forEach(n => n.classList.remove('gap'));
    document.getElementById('bin').classList.remove('over');
    drag = null;
  }

  function onUp(e) {
    if (drag) {
      const { from, target } = drag;
      cancelDrag();
      if (e && e.type === 'pointercancel') return;
      if (target && target.bin) handlers.onRemove(from);
      else if (target) handlers.onMove(from, target);
      return;
    }
    if (press && e && e.type === 'pointerup') {
      const chip = press.chip;
      clearTimeout(press.timer);
      press = null;
      handlers.onTapRider({ ...cellInfo(chip.closest('.cell')), index: Number(chip.dataset.i) });
      return;
    }
    if (press) { clearTimeout(press.timer); press = null; }
  }
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', () => cancelDrag());
  board.addEventListener('contextmenu', e => e.preventDefault());

  /* 札いがいを押したとき */
  board.addEventListener('click', e => {
    if (state.locked || e.target.closest('.chip')) return;
    const cell = e.target.closest('.cell');
    if (cell) {
      if (e.target.closest('.add')) handlers.onAddRider(cellInfo(cell));
      else if (e.target.closest('.drv')) handlers.onTapDriver(cellInfo(cell));
      return;
    }
    const note = e.target.closest('.notecell');
    if (note) { handlers.onTapNotes(Number(note.dataset.day)); return; }
    const van = e.target.closest('.vanname:not(.notes)');
    if (van) handlers.onTapVan(van.dataset.van);
  });

  return {
    render, fit, measureFit,
    zoom(factor) { setScale(scale * factor); },
    setFontScale(s) { board.style.fontSize = (BASE_FONT * s) + 'px'; },
    restoreScale() { board.style.fontSize = (BASE_FONT * scale) + 'px'; },
    get isFit() { return scale <= fitScale * 1.02; }
  };
}
