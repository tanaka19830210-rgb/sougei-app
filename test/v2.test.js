/* 週の表（v2）：命令の当てかた・自動の下書き・AI の答えの読みかた */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/v2/model.js';
import { buildDraft, compareWeeks } from '../js/v2/draft.js';
import { buildRequest, readResponse, TOOL } from '../js/v2/ai.js';

const VANS = [{ id: 'v1', name: 'ハイエース' }, { id: 'v2', name: 'セレナ' }];

function week(key, fill) {
  const w = M.createEmptyWeek({ facilityId: 'funny', weekStart: key, vans: VANS });
  fill(w);
  return w;
}
const put = (w, day, van, leg, name, time, place = '') => w.days[day].trips[van][leg].rows.push({ name, place, time });
const names = (w, day, van, leg) => w.days[day].trips[van][leg].rows.map(r => r.name).join(',');

function usual(w) {
  for (let d = 1; d <= 6; d++) {
    put(w, d, 'v1', 'out', '井上', '08:30', 'ホームA'); put(w, d, 'v1', 'out', '岡田', '08:40');
    put(w, d, 'v2', 'out', '小林', '08:35');
    put(w, d, 'v1', 'ret', '井上', '15:30', 'ホームA'); put(w, d, 'v2', 'ret', '小林', '15:40');
    w.days[d].trips.v1.out.driver = '山田';
  }
}

test('お名前のゆれ：「様」「さん」や全角半角がちがっても同じ人', () => {
  assert.equal(M.personKey('井上様'), '井上');
  assert.equal(M.personKey(' 井上 さん'), '井上');
  assert.equal(M.normTime('８：５'.replace('５', '05')), '08:05');
  assert.equal(M.normTime('8:50:00'), '08:50');
});

test('remove：その日のその便だけはずす。見つからなければ理由を返す', () => {
  const w = week('2026-11-09', usual);
  const r = M.applyOps(w, [{ type: 'remove', name: '井上さん', days: [2], leg: 'ret' }, { type: 'remove', name: '藤本', days: [2] }]);
  assert.equal(names(r.week, 2, 'v1', 'ret'), '');
  assert.equal(names(r.week, 2, 'v1', 'out'), '井上,岡田');
  assert.equal(names(r.week, 3, 'v1', 'ret'), '井上');
  assert.equal(r.problems.length, 1);
  assert.equal(names(w, 2, 'v1', 'ret'), '井上', 'もとの表は書きかえない');
});

test('place：別の車へ移すと、もとの車からは消える。時刻の順に入る', () => {
  const w = week('2026-11-09', usual);
  const r = M.applyOps(w, [{ type: 'place', name: '岡田', days: [1], leg: 'out', van: 'セレナ' }]);
  assert.equal(names(r.week, 1, 'v1', 'out'), '井上');
  assert.equal(names(r.week, 1, 'v2', 'out'), '小林,岡田');
  const r2 = M.applyOps(w, [{ type: 'place', name: '藤本', days: [1], leg: 'out', van: 'ハイエース', time: '8:20', place: 'ホームB' }]);
  assert.equal(names(r2.week, 1, 'v1', 'out'), '藤本,井上,岡田');
  assert.equal(r2.week.days[1].trips.v1.out.rows[0].place, 'ホームB');
});

test('place：無い車を言われたら、乗せずに理由を返す', () => {
  const r = M.applyOps(week('2026-11-09', usual), [{ type: 'place', name: '岡田', days: [1], van: 'バス' }]);
  assert.equal(r.problems.length, 1);
  assert.equal(names(r.week, 1, 'v1', 'out'), '井上,岡田');
});

test('driver・note・add_van・remember', () => {
  const r = M.applyOps(week('2026-11-09', usual), [
    { type: 'driver', van: 'セレナ', days: [3], leg: 'out', driver: '佐々木' },
    { type: 'note', days: [3], text: '井上様休み' }, { type: 'note', days: [3], text: '井上様休み' },
    { type: 'add_van', van: 'レンタカー' },
    { type: 'place', name: '岡田', days: [3], leg: 'out', van: 'レンタカー' },
    { type: 'remember', text: '岡田様はセレナに乗せない' }
  ]);
  assert.equal(r.week.days[3].trips.v2.out.driver, '佐々木');
  assert.deepEqual(r.week.days[3].notes, ['井上様休み']);
  assert.equal(r.week.vans.length, 3);
  assert.equal(names(r.week, 3, 'v3', 'out'), '岡田');
  assert.deepEqual(r.rules, ['岡田様はセレナに乗せない']);
});

test('checkWeek：同じ人が同じ便に2回・時刻の逆もどりを知らせる', () => {
  const w = week('2026-11-09', usual);
  put(w, 1, 'v2', 'out', '岡田', '08:10');
  put(w, 1, 'v2', 'out', '井上', '09:00', '自宅');       /* 場所がちがっても、同じ便に2回は入れまちがい */
  const texts = M.checkWeek(w, { capacity: {} }).filter(x => !x.quiet).map(x => x.text);
  assert.equal(texts.filter(t => t.includes('2回')).length, 2);
  assert.ok(texts.some(t => t.includes('井上様が2回') && t.includes('ハイエース・ホームA') && t.includes('セレナ・自宅')));
  assert.ok(texts.some(t => t.includes('早くなって')));
});

test('dayCounts：Excel と同じ「全体（迎え・送り）」', () => {
  assert.deepEqual(M.dayCounts(week('2026-11-09', usual), 1), { all: 3, out: 3, ret: 2 });
});

test('下書き：先週を写し、先週だけ休んだいつもの人を戻し、先週だけの人にしるしを付ける', () => {
  const older = ['2026-10-19', '2026-10-26', '2026-11-02'].map(k => week(k, usual));
  const last = week('2026-11-09', w => {
    usual(w);
    w.days[2].trips.v1.out.rows = w.days[2].trips.v1.out.rows.filter(r => r.name !== '岡田');   /* 火曜だけお休み */
    w.days[2].notes.push('岡田様休み');
    put(w, 4, 'v2', 'out', '藤本', '09:00');                                                     /* 木曜だけ乗った */
    w.days[1].trips.v1.out.driver = '佐々木';
  });
  const { week: d, summary } = buildDraft({ facilityId: 'funny', weekStart: '2026-11-16', history: [last, ...older.reverse()] });
  assert.equal(d.weekStart, '2026-11-16');
  assert.equal(d.days[1].trips.v1.out.driver, '佐々木', '運転手は先週のまま');
  assert.equal(names(d, 2, 'v1', 'out'), '井上,岡田', '休んでいた人が、時刻の順で戻る');
  assert.equal(d.days[2].trips.v1.out.rows[1].flag, 'restored');
  assert.equal(d.days[4].trips.v2.out.rows.find(r => r.name === '藤本').flag, 'onlyLast');
  assert.deepEqual(d.days[2].notes, [], 'その週だけの連絡は引きつがない');
  assert.equal(summary.restored.length, 1);
  assert.equal(compareWeeks(d, older[0]).missing, 0);
});

test('下書き：これまでの表が無ければ、空の表', () => {
  const { week: d, summary } = buildDraft({ facilityId: 'funny', weekStart: '2026-11-16', history: [] });
  assert.equal(d.vans.length, 0);
  assert.equal(summary.copiedFrom, null);
});

test('normalizeWeek：欠けのあるファイルでも壊れない', () => {
  const w = M.normalizeWeek({ vans: [{ id: 'v1', name: 'ハイエース' }], days: { 1: { trips: { v1: { out: { rows: [{ name: '井上', time: '8:5' }, {}] } } } } } }, { facilityId: 'funny', weekStart: '2026-11-16' });
  assert.equal(w.days[1].trips.v1.out.rows.length, 1);
  assert.deepEqual(w.days[6].trips.v1.ret, { driver: '', rows: [] });
});

test('AI へ送る内容：表・名簿・送迎ルール・言葉が入り、鍵は入らない', () => {
  const w = week('2026-11-09', usual);
  const req = buildRequest({ week: w, roster: M.rosterFrom([w]), rules: ['井上様はハイエース'], instruction: 'いのうえさんは木曜休み', weekLabel: '11月9日の週' });
  const body = JSON.stringify(req);
  assert.equal(req.tools[0].name, TOOL.name);
  ['いのうえさんは木曜休み', '井上様はハイエース', '井上（ホームA）', 'セレナ 迎え'].forEach(t => assert.ok(body.includes(t), t));
  assert.ok(!('temperature' in req) && !('thinking' in req));
});

test('AI の答え：命令を取りだす。道具を使わなかった・断られた・途中で切れたときも止まらない', () => {
  const ok = readResponse({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'はい' }, { type: 'tool_use', name: TOOL.name, input: { heard: 'x', summary: ['a'], questions: [], ops: [{ type: 'remove', name: '井上', leg: 'both' }, null, { name: '型なし' }] } }] });
  assert.equal(ok.ops.length, 1);
  assert.equal(ok.ops[0].leg, undefined, 'both は「両方」＝指定なしに直す');
  assert.equal(readResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'どなたのことですか？' }] }).questions[0], 'どなたのことですか？');
  assert.equal(readResponse({ stop_reason: 'refusal', content: [] }).ops.length, 0);
  assert.ok(readResponse({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', name: TOOL.name, input: { ops: [] } }] }).questions.length);
});

test('車の最大人数：決めてあればその数、まだなら これまでの最大。超えたら知らせ、下書きにも引きつぐ', () => {
  const w = week('2026-11-09', usual);
  const roster = M.rosterFrom([w]);
  assert.deepEqual(M.seatsOf(w.vans[0], roster), { seats: 2, fixed: false });
  w.vans[1].seats = 1;
  put(w, 1, 'v2', 'out', '藤本', '09:00');
  const texts = M.checkWeek(w, roster).map(x => x.text);
  assert.ok(texts.some(t => t.includes('セレナが2人です（最大1人）')));
  const again = M.normalizeWeek(JSON.parse(JSON.stringify(w)));
  assert.equal(again.vans[1].seats, 1);
  assert.equal(buildDraft({ facilityId: 'funny', weekStart: '2026-11-16', history: [w] }).week.vans[1].seats, 1);
  assert.ok(JSON.stringify(buildRequest({ week: w, roster, rules: [], instruction: 'x' })).includes('セレナ（最大1人）'));
});

/* ---------- 利用予定との照らしあわせ ---------- */
import { applyAttendance, checkAttendance, attendanceToText } from '../js/v2/attendance.js';

function att(days) {
  return { weekStart: '2026-11-16', days: Object.fromEntries([1, 2, 3, 4, 5, 6].map(d => [d, days[d] || []])) };
}
const P = (family, extra = {}) => ({ name: family + ' 太郎', family, out: true, ret: true, memo: '', ...extra });

test('利用予定：予定の無い人をはずし、予定のある人をこれまでの車へ足し、場所とメモを反映する', () => {
  const last = week('2026-11-09', usual);
  put(last, 1, 'v2', 'out', '藤本', '08:50'); put(last, 1, 'v2', 'ret', '藤本', '15:50');
  const draft = week('2026-11-16', w => { usual(w); });                       /* 藤本は下書きにいない */
  const a = att({ 1: [
    P('井上', { outPlace: 'ホームB' }),                                      /* 乗る場所が変わる */
    P('小林', { ret: false }),                                               /* 送りなし */
    P('藤本'),                                                               /* 予定あり・表にいない → 足す */
    P('中村'),                                                               /* これまで乗ったことがない → 車が決まらない */
    P('重松', { absent: true }),
    P('上田', { rest: ['13:00迎え'] })
  ] });
  const r = applyAttendance(draft, a, [last]);
  assert.equal(names(r.week, 1, 'v1', 'out'), '井上', '予定の無い岡田はずれる');
  assert.equal(r.week.days[1].trips.v1.out.rows[0].place, 'ホームB');
  assert.equal(names(r.week, 1, 'v2', 'out'), '小林,藤本');
  assert.equal(r.week.days[1].trips.v2.out.rows[1].flag, 'planned');
  assert.equal(names(r.week, 1, 'v2', 'ret'), '藤本', '小林は送りなし');
  assert.deepEqual(r.unplaced.map(u => u.name + u.leg), ['中村out', '上田out', '中村ret', '上田ret']);
  assert.deepEqual(r.week.days[1].notes, ['小林様送りなし', '重松様休み', '上田様 13:00迎え']);
  assert.equal(names(r.week, 2, 'v1', 'out'), '', '火曜はだれも予定が無いので空');
  assert.equal(names(draft, 1, 'v1', 'out'), '井上,岡田', 'もとの表は書きかえない');
});

test('利用予定：ファイルが無い週は、何も変えない・何も知らせない', () => {
  const w = week('2026-11-16', usual);
  const r = applyAttendance(w, null, []);
  assert.equal(r.used, false);
  assert.equal(names(r.week, 1, 'v1', 'out'), '井上,岡田');
  assert.deepEqual(checkAttendance(w, att({})), []);
});

test('利用予定：来月のシートが無い日（missing）は「分からない」として、はずさない・知らせない', () => {
  const w = week('2026-11-16', usual);
  /* 月曜は予定あり（井上だけ）。火〜土はシートが無い想定 */
  const a = { ...att({ 1: [P('井上')] }), missing: ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'] };
  const r = applyAttendance(w, a, []);
  assert.equal(names(r.week, 1, 'v1', 'out'), '井上', '月曜は予定どおり岡田がはずれる');
  assert.equal(names(r.week, 2, 'v1', 'out'), names(w, 2, 'v1', 'out'), '火曜はさわらない');
  assert.ok(checkAttendance(w, a).every(x => x.day === '1' || x.day === 1), '火〜土は知らせない');
  assert.match(attendanceToText(a), /火曜 利用予定はまだ分かりません/);
});

test('利用予定：表との食いちがいを知らせる', () => {
  const w = week('2026-11-16', usual);
  const texts = checkAttendance(w, att({ 1: [P('井上'), P('小林', { out: false }), P('藤本')] })).filter(x => x.day === 1).map(x => x.text);
  assert.ok(texts.includes('月曜の迎え：藤本様は利用予定ですが、表にいません'));
  assert.ok(texts.includes('月曜の迎え：岡田様は利用予定がありませんが、ハイエースに乗っています'));
  assert.ok(texts.includes('月曜の迎え：小林様は「迎えなし」の予定ですが、セレナに乗っています'));
  assert.ok(attendanceToText(att({ 1: [P('小林', { out: false, retPlace: 'ホームA' })] })).includes('月曜 1人: 小林(迎えなし・ホームA送り)'));
});

test('利用予定：連絡らんに「送迎なし」とある人は、表にいなくても知らせない・足さない', () => {
  const last = week('2026-11-09', usual);
  const w = week('2026-11-16', usual);
  w.days[1].notes.push('藤本様送迎なし', '中村様送りなし');
  const a = att({ 1: [P('井上'), P('岡田', { ret: false }), P('小林'), P('藤本'), P('中村')] });
  const texts = checkAttendance(w, a).filter(x => x.day === 1).map(x => x.text);
  assert.deepEqual(texts, ['月曜の迎え：中村様は利用予定ですが、表にいません']);
  assert.deepEqual(applyAttendance(w, a, [last]).unplaced.map(u => u.name + u.leg), ['中村out']);
});

test('満席：枠の数＝最大人数。満席の車へは、命令でも利用予定でも下書きでも足さない', () => {
  const w = week('2026-11-16', usual);
  w.vans[0].seats = 2;                                       /* ハイエースは 井上・岡田 で満席 */
  assert.equal(M.isFull(w, 'v1', 1, 'out'), true);
  assert.equal(M.isFull(w, 'v2', 1, 'out'), false, '最大人数を決めていない車は止めない');
  const r = M.applyOps(w, [{ type: 'place', name: '小林', days: [1], leg: 'out', van: 'ハイエース' }, { type: 'place', name: '岡田', days: [1], leg: 'out', van: 'ハイエース', time: '08:20' }]);
  assert.equal(names(r.week, 1, 'v1', 'out'), '岡田,井上', '乗っている人の順番の直しは通す');
  assert.equal(names(r.week, 1, 'v2', 'out'), '小林', '移せなかった人は元の車のまま');
  assert.ok(r.problems[0].includes('満席（2人）'));

  const last = week('2026-11-09', x => { usual(x); put(x, 1, 'v1', 'out', '藤本', '08:50'); });
  const fitted = applyAttendance(w, att({ 1: [P('井上'), P('岡田', { ret: false }), P('小林'), P('藤本', { ret: false })] }), [last]);
  assert.deepEqual(fitted.unplaced.map(u => u.name + u.leg), ['藤本out']);
  assert.equal(names(fitted.week, 1, 'v1', 'out'), '井上,岡田');
});

test('乗る場所の初期値：その便でいちばん多い場所。家（空）が多い人・はじめての人は「自宅」', () => {
  const w = week('2026-11-16', x => {
    put(x, 1, 'v1', 'out', '森本', '08:30', 'ホームA'); put(x, 2, 'v1', 'out', '森本', '08:30', 'ホームA');
    put(x, 1, 'v1', 'ret', '森本', '15:30', '');         /* 送りは家 */
    put(x, 1, 'v2', 'out', '川口', '08:40', '');         /* いつも家 */
    put(x, 2, 'v2', 'out', '川口', '08:40', '');
    put(x, 3, 'v2', 'out', '川口', '08:40', 'ホームB');
  });
  const roster = M.rosterFrom([w]);
  assert.equal(M.usualPlace(roster, '森本', 'out'), 'ホームA');
  assert.equal(M.usualPlace(roster, '森本', 'ret'), '自宅', '送りは家なので「自宅」');
  assert.equal(M.usualPlace(roster, '川口', 'out'), '自宅', 'いちばん多いのが家なら「自宅」');
  assert.equal(M.usualPlace(roster, '川口', 'ret'), '自宅', '送りに乗ったことが無ければ、ほかの便の場所（家）');
  assert.equal(M.usualPlace(roster, 'はじめて', 'out'), '自宅');
});

test('事業所ごとの曜日と便の呼び名（ショートステイは月〜日・送り出し／迎え）', () => {
  try {
    M.useFacility({ id: 'yahatagaoka', days: [1, 2, 3, 4, 5, 6, 7], legNames: { out: '送り出し', ret: '迎え' } });
    assert.deepEqual(M.DAY_NUMBERS, [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(M.LEG_NAMES.out, '送り出し');
    /* 6日ぶんしか無いファイルを読んでも、日曜の欄ができる */
    const w = M.normalizeWeek({ weekStart: '2026-11-23', vans: [{ id: 'v1', name: '送迎車', seats: 4 }], days: { 7: { notes: [], trips: { v1: { out: { driver: '森本', rows: [{ name: '井上', time: '09:00' }] } } } } } });
    assert.equal(w.days[7].trips.v1.out.rows[0].name, '井上');
    assert.ok(M.weekToText(w).includes('■日曜'));
    assert.ok(M.weekToText(w).includes('送り出し'));
    const r = M.applyOps(w, [{ type: 'remove', name: '井上', days: [7] }]);
    assert.equal(r.week.days[7].trips.v1.out.rows.length, 0);
  } finally {
    M.useFacility(null);
  }
  assert.deepEqual(M.DAY_NUMBERS, [1, 2, 3, 4, 5, 6], 'もどすと生活介護の形');
  assert.equal(M.LEG_NAMES.out, '迎え');
  assert.equal(M.createEmptyWeek({ facilityId: 'funny', weekStart: '2026-11-23' }).days[7], undefined);
});
