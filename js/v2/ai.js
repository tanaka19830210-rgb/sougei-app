/* ============================================================
   AI に「今週の事情」を伝えて、表の直しかたを返してもらう

   - AI は表を直接書きかえない。「だれを・どの日の・どの車へ」という
     命令（ops）を返すだけ。実際に表へ当てるのは model.js の applyOps で、
     当てたあと人が見て「これでよい」を押すまで確定しない。
   - 声の聞きまちがい（「いのうえ」「井ノ上」→ 井上）は、名簿を AI に
     渡して直してもらう。名簿は、これまでの表から自動で作ったもの。
   - 鍵（APIキー）はこの端末のブラウザにだけ置き、Anthropic へ直接送る。
     npm の部品を使わないアプリなので、SDK ではなく fetch で呼んでいる。
   ============================================================ */

import { weekToText, DAY_NAMES, seatsOf } from './model.js';

export const AI_MODEL = 'claude-opus-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

const DAYS_SCHEMA = { type: 'array', items: { type: 'integer', enum: [1, 2, 3, 4, 5, 6] }, description: '曜日。1=月 2=火 3=水 4=木 5=金 6=土。週ぜんぶなら省く' };
const LEG_SCHEMA = { type: 'string', enum: ['out', 'ret', 'both'], description: 'out=迎え ret=送り both=両方' };

export const TOOL = {
  name: 'change_schedule',
  description: '送迎表への変更をまとめて出す。表を直すときは必ずこの道具を1回だけ使う。',
  input_schema: {
    type: 'object',
    properties: {
      heard: { type: 'string', description: '職員の言葉を、聞きまちがいを直して書きなおしたもの' },
      summary: { type: 'array', items: { type: 'string' }, description: '何をどう変えるかを、職員が読んで確かめられる短い文で。1変更1文' },
      questions: { type: 'array', items: { type: 'string' }, description: 'はっきりしない所（だれのことか分からない、乗せる車が決められない等）。無ければ空' },
      ops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['remove', 'place', 'update', 'driver', 'note', 'add_van', 'remember'] },
            name: { type: 'string', description: '利用者の名字（名簿のとおりの字で。様は付けない）' },
            days: DAYS_SCHEMA,
            leg: LEG_SCHEMA,
            van: { type: 'string', description: '車の名前（表にあるとおり）' },
            place: { type: 'string', description: '乗る／降りる場所。自宅なら「自宅」または空' },
            time: { type: 'string', description: '時刻 HH:MM' },
            before: { type: 'string', description: 'place で、この人の前に入れる（乗る順）。省くと時刻順か最後' },
            driver: { type: 'string', description: '運転手の名前' },
            text: { type: 'string', description: 'note の連絡文、または remember の送迎ルール' },
            remove: { type: 'boolean', description: 'note を消すとき true' }
          },
          required: ['type']
        }
      }
    },
    required: ['heard', 'summary', 'questions', 'ops']
  }
};

const GUIDE = `あなたは障害福祉の生活介護事業所で、週の送迎表づくりを手伝う係です。
職員が声や文字で伝える「今週の事情」を読み、いまの送迎表をどう直すかを change_schedule で返します。

## 命令の種類（ops）
- remove … その人を表からはずす。お休み・送迎なし・迎えだけ無し等。days と leg で範囲をしぼる。
- place … その人を、指定の車に乗せる（すでに別の車に乗っていれば移す。乗っていなければ足す）。van は必須。place・time・before は分かるときだけ。
- update … 乗る車は変えずに、場所や時刻だけ直す。
- driver … その車・その日・その便の運転手を入れかえる。
- note … その日の連絡らんに一文を足す（remove:true で消す）。
- add_van … 表に無い車（レンタカー等）を足す。
- remember … 「これからは毎週こうして」という送迎ルールを覚える。text に一文で。

## 進めかた
- お名前は必ず名簿の字に直す。音が近い人が名簿に1人だけなら、その人と見てよい。2人以上いて決められないときは、勝手に選ばず questions に書く。
- 「休み」は迎えも送りもはずし、連絡らんに「○○様休み」（理由が分かれば「○○様休み（病院受診）」）を足す。
- 「送りなし」「迎えなし」は、その便だけはずし、連絡らんにも同じ言葉を足す。
- 乗る場所が変わる（「今週はホームAから」など）ときは、同じ日にその場所へ行く車があればその車へ移し、時刻はその車で同じ場所の人に合わせる。無ければ場所だけ直して questions に書く。
- 人をはずした結果、1人しか乗らない車や、偏りが気になる所があれば、動かさずに questions で知らせる（勝手に組みかえない）。
- 「つじつまが合っていない所」に書かれた人について頼まれたとき（同じ便に2回入っている人をはずす・移す等）は、どちらの行のことか決めつけず、分かる範囲で直したうえで questions で必ず知らせる。頼まれていなくても、直したほうがよい矛盾に気づいたら questions に書く（勝手には直さない）。
- 言葉の頭に【毎週の送迎ルール】とあるときは、その内容を remember で覚え、今週の表にも当てはまるなら合わせて直す。
- 「点検して」と頼まれたときは ops を空にして、気づいたことを questions に1つずつ書く。見る所：同じ便に同じ人が2回、迎えだけ／送りだけの人（連絡らんに理由が無いもの）、時刻の順がおかしい所、送迎ルールに反する所、連絡らんと表の食いちがい（「休み」と書いてあるのに乗っている等）、1人だけの車や人数の偏り。問題が無ければ「気になる所はありませんでした」と書く。
- 車の最大人数を超える乗せ方はしない。頼まれた変更で超えてしまうときは、頼まれたとおりにしたうえで questions で必ず知らせる。
- 「利用予定」があるときは、それを正とする。予定の無い日に人を足すよう頼まれたら、頼まれたとおりにしたうえで questions で知らせる。
- 言われていないことは変えない。曜日を言われなかったら、文の流れから分かる範囲だけにする。分からなければ questions に。
- 「送迎ルール」に反する変更を頼まれたら、頼まれたとおりにしたうえで questions で知らせる。
- summary は「木曜：井上様をセレナ（送り）へ」のように、職員がそのまま確かめられる言葉で。
- 変える所が何も無いとき（質問だけ・聞き取れない等）は ops を空にして、questions に聞き返しを書く。`;

export function buildRequest({ week, roster, rules, instruction, weekLabel, pastInstructions, warnings, attendance }) {
  const people = (roster.people || []).map(p => p.name + (p.places.filter(Boolean).length ? `（${p.places.filter(Boolean).slice(0, 4).join('・')}）` : '')).join('、');
  const context = [
    `## 対象の週\n${weekLabel || week.weekStart}（曜日: ${Object.entries(DAY_NAMES).map(([n, d]) => `${n}=${d}`).join(' ')}）`,
    `## 車（かっこ内は、利用者が乗れる最大人数）\n${week.vans.map(v => { const c = seatsOf(v, roster); return v.name + (c.seats ? `（${c.fixed ? '最大' : 'これまでの最大'}${c.seats}人）` : ''); }).join('、')}`,
    `## 利用者の名簿（かっこ内は、よく乗る場所）\n${people || '（まだ名簿がありません）'}`,
    `## 運転手\n${(roster.drivers || []).slice(0, 30).join('、') || '（不明）'}`,
    `## 送迎ルール（毎週守ること）\n${(rules || []).length ? rules.map(r => '- ' + r).join('\n') : '（まだありません）'}`,
    (pastInstructions || []).length ? `## この週に、すでに伝えられて反映ずみのこと\n${pastInstructions.map(t => '- ' + t).join('\n')}` : '',
    attendance ? `## この週の利用予定（利用記録兼シフトより。ここに無い人は、その日は利用しない）\n${attendance}` : '',
    (warnings || []).length ? `## いまの表で、つじつまが合っていない所（プログラムが見つけたもの）\n${warnings.map(t => '- ' + t).join('\n')}` : '',
    `## いまの送迎表\n${weekToText(week)}`
  ].filter(Boolean).join('\n\n');

  return {
    model: AI_MODEL,
    max_tokens: 16000,
    system: GUIDE,
    tools: [TOOL],
    messages: [{
      role: 'user',
      content: `${context}\n\n## 職員からの言葉（音声入力のため、聞きまちがいを含むことがあります）\n${instruction}`
    }]
  };
}

/* 返ってきた答えから、命令を取りだす */
export function readResponse(json) {
  if (json.stop_reason === 'refusal') {
    return { heard: '', summary: [], questions: ['AI がこの内容には答えられないと返しました。言いかたを変えてもう一度おねがいします。'], ops: [] };
  }
  const blocks = Array.isArray(json.content) ? json.content : [];
  const use = blocks.find(b => b.type === 'tool_use' && b.name === TOOL.name);
  const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!use) {
    return { heard: '', summary: [], questions: [text || 'AI から変更が返ってきませんでした。もう一度おねがいします。'], ops: [] };
  }
  const input = use.input && typeof use.input === 'object' ? use.input : {};
  const list = v => (Array.isArray(v) ? v : []).filter(Boolean);
  const ops = list(input.ops).filter(op => op && typeof op === 'object' && op.type).map(op => {
    const next = { ...op };
    if (next.leg === 'both') delete next.leg;
    return next;
  });
  const questions = list(input.questions).map(String);
  if (json.stop_reason === 'max_tokens') questions.push('答えが途中で切れました。伝える内容を2回に分けてみてください。');
  return { heard: String(input.heard || ''), summary: list(input.summary).map(String), questions, ops, usage: json.usage || null };
}

/*
  AI に頼む。
    apiKey … この端末に鍵があるときは、Anthropic へ直接たのむ
    gate   … Google ログインで使うときは、番人に代わりにたのんでもらう（鍵は番人の中にだけある）
             (request) => Promise<{ status, body }>
*/
export async function askAi({ apiKey, gate, fetchImpl, ...rest }) {
  if (!apiKey && !gate) throw new Error('AI の鍵（APIキー）がまだ入っていません。設定画面で入れてください。');
  const request = buildRequest(rest);
  let status, json;
  if (apiKey) {
    const doFetch = fetchImpl || fetch;
    let res;
    try {
      res = await doFetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(request)
      });
    } catch (e) {
      throw new Error('AI につながりませんでした。ネットの接続を確かめてください。');
    }
    status = res.status;
    try { json = await res.json(); } catch (e) { json = null; }
  } else {
    const out = await gate(request);
    status = Number(out && out.status) || 0;
    json = out ? out.body : null;
  }
  if (status < 200 || status >= 300) {
    const detail = (json && json.error && json.error.message) || '';
    if (status === 401) throw new Error(apiKey ? 'AI の鍵（APIキー）が正しくないようです。設定画面で入れなおしてください。' : 'GAS に入れた AI の鍵（ANTHROPIC_API_KEY）が正しくないようです。');
    if (status === 429) throw new Error('AI がこみあっています。1分ほど待ってからもう一度おねがいします。');
    if (status >= 500) throw new Error('AI の側で不具合が起きています。少し待ってからもう一度おねがいします。');
    throw new Error(`AI に頼めませんでした（${status}）${detail ? '：' + detail : ''}`);
  }
  return readResponse(json || {});
}
