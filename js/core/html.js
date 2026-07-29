/* ============================================================
   HTML を組み立てるときの安全装置

   お名前やメモに < > & が入っていても、画面や紙が崩れないようにする。
   画面（ブラウザ）でも、GitHub Actions（Node）でも同じものを使う。
   ============================================================ */

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
