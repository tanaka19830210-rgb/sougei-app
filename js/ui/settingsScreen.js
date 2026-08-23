/* ============================================================
   設定画面（settings.html）
   GitHub のトークン・データ用リポジトリ・事業所を、この端末に覚えさせる。
   ============================================================ */

import { loadConfig, saveConfig, isGithubReady } from '../config.js';
import { createStore, createGithubStore, createLocalStore } from '../store/index.js';
import { createRepository } from '../store/repository.js';
import { toast, setBanner, renderModeBadge, errorMessage, escapeHtml, showDialog } from './dom.js';
import * as paths from '../store/paths.js';

function parseRepo(text) {
  const value = String(text || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  const parts = value.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

export async function start() {
  const config = loadConfig();
  const form = {
    repo: document.getElementById('repo'),
    branch: document.getElementById('branch'),
    token: document.getElementById('token'),
    editor: document.getElementById('editor'),
    facility: document.getElementById('facility')
  };

  form.repo.value = config.owner && config.repo ? `${config.owner}/${config.repo}` : '';
  form.branch.value = config.branch || 'main';
  form.token.value = config.token || '';
  form.editor.value = config.editorName || '';

  const store = createStore(config);
  renderModeBadge(document.getElementById('modebadge'), store);
  document.getElementById('mode').textContent = store.mode === 'github'
    ? `いまは GitHub に保存します（${store.label}）`
    : 'いまは「お試しモード」です。保存はこの端末のブラウザの中だけで、GitHub には残りません。';

  /* 事業所の一覧は、いまの保存先から読む */
  try {
    const repo = createRepository(store);
    const facilities = await repo.loadFacilities();
    form.facility.innerHTML = '';
    if (!facilities.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（読めませんでした）';
      form.facility.appendChild(opt);
    }
    facilities.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = `${f.name}（${f.id}）`;
      if (f.id === config.facilityId) opt.selected = true;
      form.facility.appendChild(opt);
    });
  } catch (e) {
    setBanner('banner', `事業所の一覧を読めませんでした：${escapeHtml(errorMessage(e))}`, 'error');
  }

  /* 読み書きするファイルの場所を見せる（あとで手で直すときの手がかり） */
  const fid = config.facilityId || (form.facility.value || 'funny');
  document.getElementById('pathlist').innerHTML = [
    paths.facilitiesPath(),
    paths.usersPath(fid),
    paths.vansPath(fid),
    paths.ngPairsPath(fid),
    paths.driversPath(fid),
    paths.planPath(fid, '2026-08-03')
  ].map(p => `<li><code>${escapeHtml(p)}</code></li>`).join('');

  /* ---------- 保存 ---------- */
  document.getElementById('save').onclick = () => {
    const next = { ...loadConfig() };
    const parsed = parseRepo(form.repo.value);
    if (form.repo.value.trim() && !parsed) {
      toast('リポジトリは「owner/repo」の形で入れてください', 'warn');
      return;
    }
    next.owner = parsed ? parsed.owner : '';
    next.repo = parsed ? parsed.repo : '';
    next.branch = form.branch.value.trim() || 'main';
    next.token = form.token.value.trim();
    next.editorName = form.editor.value.trim();
    next.facilityId = form.facility.value;
    saveConfig(next);
    toast(isGithubReady(next)
      ? '設定を保存しました。GitHub に読み書きします'
      : '設定を保存しました。トークンが空なので「お試しモード」です');
    setTimeout(() => location.reload(), 900);
  };

  /* ---------- つながるか試す ---------- */
  document.getElementById('check').onclick = async () => {
    const parsed = parseRepo(form.repo.value);
    const token = form.token.value.trim();
    if (!parsed || !token) {
      toast('リポジトリ名とトークンの両方を入れてください', 'warn');
      return;
    }
    setBanner('banner', 'GitHub につないでいます…');
    try {
      const test = createGithubStore({
        owner: parsed.owner,
        repo: parsed.repo,
        branch: form.branch.value.trim() || 'main',
        token
      });
      const info = await test.checkAccess();
      const found = await test.readJson(paths.facilitiesPath());
      const lines = [`<b>${escapeHtml(info.name)}</b> につながりました。`];
      if (!info.private) {
        lines.push('<b>ただし、このリポジトリは公開（public）です。</b>' +
          '利用者のお名前を入れてはいけません。private のリポジトリに変えてください。');
      }
      lines.push(found
        ? `${escapeHtml(paths.facilitiesPath())} が見つかりました。`
        : `${escapeHtml(paths.facilitiesPath())} がまだありません。README の手順でファイルを置いてください。`);
      setBanner('banner', lines.join('<br>'), info.private ? undefined : 'warn');
    } catch (e) {
      setBanner('banner', `つながりませんでした：${escapeHtml(errorMessage(e))}`, 'error');
    }
  };

  /* ---------- トークンを消す ---------- */
  document.getElementById('forget').onclick = async () => {
    const answer = await showDialog({
      title: 'トークンを消しますか？',
      bodyHtml: 'この端末からトークンを消します。<br>消したあとは「お試しモード」になり、GitHub には保存できません。',
      buttons: [
        { label: 'やめる', value: 'cancel' },
        { label: '消す', value: 'ok', kind: 'go' }
      ]
    });
    if (answer !== 'ok') return;
    const next = { ...loadConfig(), token: '' };
    saveConfig(next);
    form.token.value = '';
    toast('トークンを消しました');
    setTimeout(() => location.reload(), 900);
  };

  /* ---------- お試しモードの控えを消す ---------- */
  document.getElementById('clearlocal').onclick = async () => {
    const answer = await showDialog({
      title: 'お試しモードの控えを消しますか？',
      bodyHtml: 'この端末のブラウザに入っている「お試しモード」の送迎表を消して、' +
        '同梱のダミーデータの状態にもどします。<br>GitHub のデータには何もしません。',
      buttons: [
        { label: 'やめる', value: 'cancel' },
        { label: '消す', value: 'ok', kind: 'go' }
      ]
    });
    if (answer !== 'ok') return;
    const local = createLocalStore({ storage: window.localStorage, fetchImpl: fetch.bind(window) });
    const count = local.clear();
    toast(`${count}件 消しました`);
  };

  /* トークンを見せる／隠す */
  const reveal = document.getElementById('reveal');
  reveal.onclick = () => {
    const hidden = form.token.type === 'password';
    form.token.type = hidden ? 'text' : 'password';
    reveal.textContent = hidden ? 'かくす' : '見る';
  };
}
