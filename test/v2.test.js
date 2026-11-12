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

test('AI へ送る内容：表・名簿・決まりごと・言葉が入り、鍵は入らない', () => {
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
