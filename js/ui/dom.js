/* ============================================================
   画面まわりの小さな道具（お知らせ・確認ダイアログ・エラー表示）
   ============================================================ */

import { ICON_WARN } from './icons.js';

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* 画面に文字を出すときは必ずここを通す（名前に < が入っていても崩れないように） */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- お知らせ（画面下にすこし出る） ---------- */
let toastTimer = null;
export function toast(message, kind) {
  let node = $('#toast');
  if (!node) {
    node = el('div');
    node.id = 'toast';
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.className = 'show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = ''; }, kind === 'error' ? 6000 : 3400);
}

/* ---------- 確認ダイアログ ----------
   buttons: [{ label, kind:'go'|'plain', value }]
   えらんだボタンの value が返る（背景タップでは閉じない＝押しまちがい防止）
*/
export function showDialog({ title, bodyHtml, buttons }) {
  return new Promise(resolve => {
    let veil = $('#veil');
    if (!veil) {
      veil = el('div', 'veil');
      veil.id = 'veil';
      document.body.appendChild(veil);
    }
    const list = (buttons && buttons.length) ? buttons : [{ label: 'とじる', value: 'close' }];
    veil.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <h3>${ICON_WARN}${escapeHtml(title)}</h3>
        <p>${bodyHtml || ''}</p>
        <div class="dialog-btns"></div>
      </div>`;
    const box = $('.dialog-btns', veil);
    list.forEach(b => {
      const btn = el('button', 'btn' + (b.kind === 'go' ? ' go' : ''), b.label);
      btn.onclick = () => {
        veil.classList.remove('show');
        resolve(b.value);
      };
      box.appendChild(btn);
    });
    veil.classList.add('show');
  });
}

/* ---------- 画面上部の帯（読みこみ中・エラー） ---------- */
export function setBanner(id, message, kind) {
  const node = document.getElementById(id);
  if (!node) return;
  if (!message) {
    node.className = 'banner hide';
    node.innerHTML = '';
    return;
  }
  node.className = 'banner' + (kind ? ' ' + kind : '');
  node.innerHTML = message;
}

/* ---------- 保存先の札（お試しモードかどうか） ---------- */
export function renderModeBadge(node, store) {
  if (!node) return;
  const isLocal = store.mode === 'local';
  node.className = 'modebadge' + (isLocal ? ' local' : '');
  node.textContent = isLocal ? 'お試しモード（保存されません）' : 'GitHubに保存します';
  node.title = store.label || '';
}

/* エラーを画面用の日本語にする */
export function errorMessage(error) {
  if (!error) return '不明なエラーが起きました';
  if (error.message) return error.message;
  return String(error);
}
