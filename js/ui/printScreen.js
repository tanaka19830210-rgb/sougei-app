/* ============================================================
   印刷画面（print.html）

   紙面の組み立てそのものは js/core/printLayout.js にあります
   （配信用のPNG作りと同じものを使うため）。
   ここは「データを読んで、組み立てた紙面を画面に出す」係です。
   ============================================================ */

import { bootstrap, loadFacilityContext, pickFacility, readParams } from './appShell.js';
import { escapeHtml, setBanner, errorMessage } from './dom.js';
import { buildPageHtml } from '../core/printLayout.js';
import { weekLongLabel, weekKeyOf, parseDateKey } from '../core/dates.js';

export { buildPageHtml };

export async function start() {
  try {
    const boot = await bootstrap();
    const params = readParams();
    const facility = params.facilityId
      ? (pickFacility(boot.facilities, params.facilityId) || boot.facility)
      : boot.facility;
    if (!facility) {
      setBanner('banner', '事業所のデータが読めませんでした。設定を確認してください。', 'error');
      return;
    }
    const asked = parseDateKey(params.weekStart);
    const weekStart = asked ? weekKeyOf(asked) : weekKeyOf(new Date());

    const masters = await loadFacilityContext(boot.repo, facility);
    const { plan, exists } = await boot.repo.loadPlan({
      facility,
      vans: masters.vans,
      weekStart
    });

    document.getElementById('page').innerHTML = buildPageHtml({
      facility,
      ctx: masters.ctx,
      drivers: masters.drivers,
      plan,
      weekStart,
      now: new Date()
    });

    document.getElementById('weeklabel').textContent = weekLongLabel(weekStart);
    const back = document.getElementById('back');
    back.href = `index.html?facility=${encodeURIComponent(facility.id)}&week=${encodeURIComponent(weekStart)}`;
    document.getElementById('printbtn').onclick = () => window.print();

    if (!exists) {
      setBanner('banner',
        'この週の送迎表は、まだ保存されていません。' +
        '<a href="' + back.href + '">割り当て画面</a>で作って保存してください。', 'warn');
    }
  } catch (e) {
    setBanner('banner', `うまく開けませんでした：${escapeHtml(errorMessage(e))}`, 'error');
    console.error(e);
  }
}
