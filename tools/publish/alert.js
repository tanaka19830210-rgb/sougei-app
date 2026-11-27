/* ============================================================
   自動の処理が失敗したことを、LINE WORKS で知らせる

   データ用リポジトリの Actions（publish.yml・attendance.yml）が失敗したときに、
   最後のステップから呼ぶ。

     node app/tools/publish/send-alert.js --title "利用予定の取りこみ" --url "<実行のURL>" [--detail-file <ファイル>] [--test]

   送り先（上から順に、最初にあるもの）：
     1. データ用リポジトリの data/alerts.json の lwUserId（その人へ1対1）
     2. data/alerts.json の lwChannelId（そのトークルーム）
     3. Secrets の LW_CHANNEL_ID（共通のトーク）
   送り先の ID は公開リポジトリには書かない（データ用リポジトリにだけ置く）。

   知らせるのに失敗しても、終了コードは 0 にする（もとの失敗が分かりにくくならないように）。
   ============================================================ */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clientFromEnv } from './lineworks.js';

export function argOf(argv, name) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
}

/* 知らせる文。長すぎる詳しい理由は切る（LINE WORKS の1通に収める） */
export function alertText({ title, detail = '', url = '', now = new Date(), test = false }) {
  const when = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(now);
  if (test) return `【送迎表】これは失敗の知らせの試しです（${when}）
自動の処理（${title}）が失敗したときは、ここに届きます。`;
  const lines = [`【送迎表】${title}が失敗しました（${when}）`];
  const d = String(detail || '').trim();
  if (d) lines.push('', d.length > 600 ? d.slice(0, 600) + '…' : d);
  if (url) lines.push('', '詳しくは：' + url);
  return lines.join('\n');
}

/*
  送り先を決める（送り先の一覧を返す。無ければ空）。
  data/alerts.json の書き方：
    { "lwUserIds": ["a@works-…"],                       … ふだんの送り先（1対1。何人でも）
      "attendance": { "lwUserIds": ["b@…", "a@…"] } }   … 種類ごとに変えたいときだけ（--kind attendance）
  lwUserId（1人だけの古い書き方）・lwChannelId（トークルーム）も使える。
  どれも無ければ Secrets の LW_CHANNEL_ID（共通のトーク）。
*/
function targetsOf(a) {
  if (!a || typeof a !== 'object') return [];
  const ids = [...(Array.isArray(a.lwUserIds) ? a.lwUserIds : []), a.lwUserId]
    .map(x => String(x || '').trim()).filter(Boolean);
  const users = [...new Set(ids)].map(userId => ({ userId, channelId: '' }));
  if (users.length) return users;
  if (String(a.lwChannelId || '').trim()) return [{ channelId: String(a.lwChannelId).trim() }];
  return [];
}
export function alertTargets(alerts, env = {}, kind = '') {
  const a = alerts && typeof alerts === 'object' ? alerts : {};
  const byKind = kind ? targetsOf(a[kind]) : [];
  if (byKind.length) return byKind;
  const base = targetsOf(a);
  if (base.length) return base;
  if (env.LW_CHANNEL_ID) return [{ channelId: env.LW_CHANNEL_ID }];
  return [];
}

export async function runAlert(argv, env = process.env) {
  const dataDir = env.DATA_DIR || process.cwd();
  const title = argOf(argv, 'title') || '自動の処理';
  const url = argOf(argv, 'url');
  const detailFile = argOf(argv, 'detail-file');
  let detail = '';
  if (detailFile) detail = await readFile(detailFile, 'utf8').catch(() => '');
  let alerts = null;
  try { alerts = JSON.parse(await readFile(join(dataDir, 'data', 'alerts.json'), 'utf8')); } catch (e) { alerts = null; }

  const targets = alertTargets(alerts, env, argOf(argv, 'kind'));
  if (!targets.length) { console.log('知らせる先がありません（data/alerts.json も LW_CHANNEL_ID もない）'); return; }
  const text = alertText({ title, detail, url, test: argv.includes('--test') });
  console.log(text);
  /* 1人に送れなくても、ほかの人には送る */
  for (const [i, target] of targets.entries()) {
    const who = target.userId ? `送り先の人${targets.length > 1 ? `（${i + 1}人目）` : ''}（1対1）` : 'トーク';
    try {
      const client = clientFromEnv(env, { log: () => {}, ...target });
      await client.sendText(text);
      console.log(`失敗の知らせを、${who}へ送りました`);
    } catch (e) {
      console.error(`失敗の知らせを${who}へ送れませんでした：` + (e && e.message ? e.message : e));
    }
  }
}

