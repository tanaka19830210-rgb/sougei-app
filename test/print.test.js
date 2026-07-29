/* 印刷レイアウトが週次プランから正しく作られるかのテスト（文字列として確認する） */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageHtml } from '../js/ui/printScreen.js';
import * as A from '../js/core/assign.js';
import { normalizeDrivers, normalizeNotes } from '../js/core/schema.js';
import { makeFixture } from './fixture.js';

function build() {
  const { facility, ctx, plan } = makeFixture();
  const drivers = normalizeDrivers({ drivers: [
    { name: '山田', initial: '山', color: 'green' },
    { name: '佐々木', initial: '佐', color: 'blue' }
  ] });

  /* 月曜だけ埋める */
  const out = A.autoAssign(ctx, { day: 1, dir: 'out', prevState: plan.days['1'].out }).state;
  plan.days['1'].out = out;
  plan.days['1'].ret = A.copyOutToReturn(ctx, { day: 1, outState: out });
  plan.days['1'].out.vans.v1.rows[0].changed = true;
  plan.days['1'].out.vans.v1.memo = 'ヘルパー迎え';
  plan.days['1'].out.vans.v2.driver = '';               /* その日は未定 */
  plan.days['1'].notes = normalizeNotes([
    { kind: 'hand', text: '四郎様 車椅子 引き渡し' },
    { kind: 'ext', text: '健康クリーニング' },
    '五郎様 迎え無し'
  ]);

  const html = buildPageHtml({
    facility, ctx, drivers, plan,
    weekStart: '2026-08-03',
    now: new Date(2026, 6, 29, 14, 5)
  });
  return { html, ctx, plan };
}

test('紙面：見出しと週、事業所名が入る', () => {
  const { html } = build();
  assert.match(html, /テスト送迎表/);
  assert.match(html, /2026年8月3日（月）〜 8日（土）/);
  assert.match(html, /株式会社障がい者ライフサポート/);
  assert.match(html, /2026年7月29日 14:05 作成/);
});

test('紙面：月〜土の6列と、車ごとの「迎え」「送り」2段になる', () => {
  const { html } = build();
  assert.equal((html.match(/<th class="d">/g) || []).length, 6);
  assert.equal((html.match(/<span>迎え<\/span>/g) || []).length, 2, '車2台ぶん');
  assert.equal((html.match(/<span>送り<\/span>/g) || []).length, 2);
  assert.match(html, /<td class="vn" rowspan="2"><b>ハイエース<\/b><small>4名<\/small>/);
});

test('紙面：お名前と時刻が入り、乗っていない日は「なし」になる', () => {
  const { html } = build();
  assert.match(html, /一郎/);
  assert.match(html, /08:20/);
  assert.match(html, /15:30/);
  assert.match(html, /<div class="none">なし<\/div>/);
});

test('紙面：車椅子の方にはアイコン、当日変更は赤（chg）になる', () => {
  const { html } = build();
  assert.match(html, /class="wcico"/);
  assert.match(html, /<div class="p chg">/);
});

test('紙面：運転手バッジは色つき。指定なしは「未定」', () => {
  const { html } = build();
  assert.match(html, /<div class="drv c-green"><i>山<\/i>山田<\/div>/);
  assert.match(html, /<div class="drv c-none"><i>？<\/i>未定<\/div>/);
});

test('紙面：いちばん下のメモは、ピンク／青のチップと「・」の行に分かれる', () => {
  const { html } = build();
  assert.match(html, /<span class="chip hand">四郎様 車椅子 引き渡し<\/span>/);
  assert.match(html, /<span class="chip ext">健康クリーニング<\/span>/);
  assert.match(html, /<div class="m">五郎様 迎え無し<\/div>/);
});

test('紙面：車両ごとのメモも、日ごとのメモ欄に車の名前つきで出る', () => {
  const { html } = build();
  assert.match(html, /<div class="m">ハイエース：ヘルパー迎え<\/div>/);
});

test('紙面：まだ何も入っていない週でも、こわれずに「なし」で組める', () => {
  const { facility, ctx, plan } = makeFixture();
  const html = buildPageHtml({ facility, ctx, drivers: [], plan, weekStart: '2026-08-03', now: new Date() });
  assert.match(html, /なし/);
  assert.equal((html.match(/<th class="d">/g) || []).length, 6);
});

test('紙面：お名前に < が入っていても崩れない（エスケープ）', () => {
  const { facility, ctx, plan } = makeFixture();
  ctx.usersById.u1.name = '<script>';
  plan.days['1'].out.vans.v1.rows[0].userId = 'u1';
  const html = buildPageHtml({ facility, ctx, drivers: [], plan, weekStart: '2026-08-03', now: new Date() });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});
