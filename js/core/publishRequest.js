/* ============================================================
   配信依頼（publish request）

   「確定して配信」を押すと、アプリはデータ用リポジトリに
   この形の小さな JSON を1つ置きます（コミットします）。
   それを合図に GitHub Actions が動き、PNGを作って LINE WORKS へ送ります。

   なぜこの形にしたか
   - 設定画面で発行してもらった鍵（Contents の読み書き）だけで発火できます。
     Actions を直接起こす方法（workflow_dispatch など）は、鍵に追加の権限が必要で、
     田中さんに設定をお願いすることが増えるため使いません。
   - 「いつ・だれが・どの週を配信したか」がリポジトリの履歴に残ります。
   ============================================================ */

import { dateOfDay, mdLabel, dayLabel } from './dates.js';

export const PUBLISH_SCHEMA_VERSION = 1;

/* 配信の状態 */
export const PUBLISH_STATUS = {
  pending: '配信をお願いしました',
  done: '配信しました',
  failed: '配信できませんでした'
};

export function createPublishRequest({ facility, weekStart, requestedBy, now = new Date() }) {
  return {
    schemaVersion: PUBLISH_SCHEMA_VERSION,
    facilityId: facility.id,
    facilityName: facility.name,
    weekStart,
    requestedBy: requestedBy || '',
    requestedAt: now.toISOString(),
    status: 'pending',
    message: publishMessageText({ facility, weekStart, requestedBy }),
    results: []
  };
}

export function normalizePublishRequest(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    ...r,
    schemaVersion: Number(r.schemaVersion) || PUBLISH_SCHEMA_VERSION,
    facilityId: String(r.facilityId || ''),
    facilityName: String(r.facilityName || ''),
    weekStart: String(r.weekStart || ''),
    requestedBy: String(r.requestedBy || ''),
    requestedAt: String(r.requestedAt || ''),
    status: PUBLISH_STATUS[r.status] ? r.status : 'pending',
    message: String(r.message || ''),
    results: Array.isArray(r.results) ? r.results : []
  };
}

/* 配信の結果を書き足す（うまくいっても、失敗しても記録に残す） */
export function withResult(request, { ok, detail, imageBytes, at = new Date() }) {
  const next = normalizePublishRequest(request);
  next.status = ok ? 'done' : 'failed';
  next.results = next.results.concat([{
    at: at.toISOString(),
    ok: !!ok,
    detail: String(detail || ''),
    imageBytes: Number(imageBytes) || 0
  }]);
  return next;
}

/* トークに出る本文（画像といっしょに送る文） */
export function publishMessageText({ facility, weekStart, requestedBy }) {
  const start = dateOfDay(weekStart, 1);
  const end = dateOfDay(weekStart, 6);
  const range = start && end
    ? `${mdLabel(start)}(${dayLabel(1)})〜${mdLabel(end)}(${dayLabel(6)})`
    : weekStart;
  const lines = [
    '送迎表ができました',
    `${facility.name}　${range}`
  ];
  if (requestedBy) lines.push(`（${requestedBy} が確定しました）`);
  lines.push('当日の変更は、必ず事務所へご連絡ください。');
  return lines.join('\n');
}

/* PNG のファイル名（トークで見たときに分かるように日本語は使わない） */
export function publishImageName({ facilityId, weekStart }) {
  return `soutai-${facilityId}-${weekStart}.png`;
}
