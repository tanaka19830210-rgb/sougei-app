#!/usr/bin/env python3
"""
これまでの Excel の送迎表（1シート＝1週）を、アプリの週ファイル（JSON）に直す道具。

  python3 tools/import_excel.py 送迎表.xlsx 出力フォルダ --facility funny --last 12 --seats "セレナ=7,ハイエース=9"

--seats には、車ごとの最大の乗車人数を書きます。書かないと定員が入りません
（取りこみ直すと、前に入れた定員は消えます）。
--until を付けると、その日付より後の週（先の週の下書きシート）は入れません。

表の形は事業所でちがいます（どれも読めます）：
  ファニー … 日付は2行目、車の見出しは「≪ハイエース≫」
  ひといき … 日付は3行目、車の見出しは「≪ハイエース≫」。同じ週のシートが2枚あることがある（中身の多いほうを使う）
  ふぃっと … 日付は1行目、車の見出しはかこみ無しの「ハイエース」（--seats に書いた名前で見つける）。
             見出しのすぐ下が迎えの運転手。「朝　残り」「帰り　残り」から下は車の表ではない

出力フォルダ/data/<事業所>/weeks/<月曜の日付>.json ができます。
本物のお名前が入るので、出力先は「非公開のデータ用リポジトリ」にしてください。
（このアプリのリポジトリは公開です。ここの data/ には絶対に出さないこと）
"""
import argparse, datetime, json, os, re, sys, unicodedata
import openpyxl

DAY_COLS = [2, 4, 6, 8, 10, 12]          # 月〜土の「お名前」の列（時刻はその右どなり）
NOTE_WORDS = ('様', 'さん', '休', 'なし', '無', '利用', '車椅子', '迎', '送', '受診')


def norm(v):
    return unicodedata.normalize('NFKC', str(v)).replace('\n', ' ').strip()


def to_hhmm(t):
    if t is None:
        return None
    if isinstance(t, datetime.datetime):
        t = t.time()
    if isinstance(t, datetime.time):
        return '%02d:%02d' % (t.hour, t.minute)
    if isinstance(t, (int, float)) and 0 <= t < 1:
        m = round(t * 1440)
        return '%02d:%02d' % (m // 60, m % 60)
    m = re.match(r'^(\d{1,2})[:：](\d{2})', norm(t))
    return '%02d:%s' % (int(m.group(1)), m.group(2)) if m else None


def split_label(s):
    """「井上様（ホームA）」→ ('井上', 'ホームA')"""
    s = norm(s)
    m = re.match(r'^([^\s(（様]+?)(?:様|さん)?\s*(?:[(（]\s*(.*?)\s*[)）]?)?$', s)
    if not m:
        return s, ''
    return m.group(1), (m.group(2) or '')


def week_start_of(ws):
    """日付の行を見つけて、その週の月曜を返す。日付の行は事業所でちがう
    （ファニー＝2行目、ひといき＝3行目、ふぃっと＝1行目、八幡が丘＝4行目）。"""
    for r in (2, 3, 1, 4):
        for c in DAY_COLS:
            v = ws.cell(r, c).value
            d = None
            if isinstance(v, datetime.datetime):
                d = v.date()
            elif isinstance(v, (int, float)) and 30000 < v < 60000:
                d = datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))
            if d:
                d = d - datetime.timedelta(days=DAY_COLS.index(c))
                return d - datetime.timedelta(days=d.weekday())
    return None


def is_end_mark(text):
    """「連絡担当」「朝 残り」「帰り 残り」から下は車の表ではない"""
    t = re.sub(r'\s+', '', text)
    return t == '連絡担当' or t.endswith('残り')


STAY_DAY_COLS = DAY_COLS + [14]           # ショートステイは月〜日
STAY_SECTIONS = {'送り出し': 'out', '迎え': 'ret', '他事業所対応': None}


def is_stay_sheet(ws):
    """ショートステイ（八幡が丘）の形か：B列に「送り出し」の見出しがある"""
    return any(norm(ws.cell(r, 2).value or '') == '送り出し' for r in range(1, min(ws.max_row, 40) + 1))


def parse_stay_sheet(ws, van_name='送迎車'):
    """
    ショートステイ（八幡が丘）の送迎表。車の区切りは無く、1台として読む。
      「送り出し」（午前の便＝out）→ 運転手の行 → 利用者（時刻つき）
      「迎え」（午後の便＝ret）    → 同じ
      「他事業所対応」             → 連絡らんへ
    1つの便に運転手の行が2つあれば「A・B」とつなぐ。
    """
    start = week_start_of(ws)
    if not start:
        return None
    van_id = 'v1'
    days = {str(d): {'notes': [], 'trips': {van_id: {'out': {'driver': '', 'rows': []}, 'ret': {'driver': '', 'rows': []}}}} for d in range(1, 8)}
    leg, in_notes, last_row = None, False, {}
    for r in range(5, ws.max_row + 1):
        b = re.sub(r'\s+', '', norm(ws.cell(r, 2).value or ''))
        if b in STAY_SECTIONS and not to_hhmm(ws.cell(r, 3).value):
            leg, in_notes, last_row = STAY_SECTIONS[b], STAY_SECTIONS[b] is None, {}
            continue
        if not leg and not in_notes:
            continue
        for di, c in enumerate(STAY_DAY_COLS):
            v = ws.cell(r, c).value
            if v is None or not norm(v):
                continue
            text = norm(v)
            day = days[str(di + 1)]
            if in_notes:
                day['notes'].append(text)
                continue
            trip = day['trips'][van_id][leg]
            hhmm = to_hhmm(ws.cell(r, c + 1).value)
            if hhmm:
                # 八幡が丘は「名字　行き先」（行き先は事業所名や「自宅」）
                parts = re.split(r'\s+', text, maxsplit=1)
                if len(parts) == 2 and '(' not in text and '（' not in text:
                    name, place = re.sub(r'(様|さん)$', '', parts[0]), parts[1]
                else:
                    name, place = split_label(text)
                row = {'name': name, 'place': '' if place == '自宅' else place, 'time': hhmm}
                trip['rows'].append(row)
                last_row[di] = row
                continue
            if text.startswith('(') and di in last_row and not last_row[di]['place']:
                last_row[di]['place'] = text.strip('() ')
                continue
            if len(text) > 10 or any(w in text for w in NOTE_WORDS) or re.search(r'\s', text):
                day['notes'].append(text)
            elif not trip['driver']:
                trip['driver'] = text
            elif text not in trip['driver'].split('・'):
                trip['driver'] += '・' + text
    return {
        'schemaVersion': 2,
        'weekStart': start.isoformat(),
        'vans': [{'id': van_id, 'name': van_name}],
        'days': days,
        'source': 'excel:' + ws.title.strip(),
    }


def parse_sheet(ws, van_names=()):
    """van_names：「≪ ≫」でかこまれていなくても車の見出しとみなす名前（ふぃっとの表はかこみが無い）"""
    start = week_start_of(ws)
    if not start:
        return None
    vans, days = [], {str(d): {'notes': [], 'trips': {}} for d in range(1, 7)}
    van_id, last_row = None, {}
    # 「≪車名≫」の見出しがある表（ファニー・ひといき）では、かこみの無い車の名前は見出しにしない
    # （連絡らんの「ハイエース点検」などを車とまちがえないため）
    if any(v and '≪' in str(v) for row in ws.iter_rows(min_col=2, max_col=13, values_only=True) for v in row):
        van_names = ()
    for r in range(2, ws.max_row + 1):
        head = None
        for c in (2, 6, 12, 13):
            v = ws.cell(r, c).value
            if v and '≪' in str(v):
                head = norm(v).strip('≪≫ ')
        b = norm(ws.cell(r, 2).value or '')
        first = re.split(r'\s+', b)[0] if b else ''
        if not head and b and (first in van_names or (van_names and van_id and is_end_mark(b))):
            head = first if first in van_names else b   # 「ノア　運動会」のような書き足しは車の名前だけにする
        if head:
            if is_end_mark(head):
                van_id = None
                continue
            van_id = 'v%d' % (len(vans) + 1)
            vans.append({'id': van_id, 'name': head})
            for d in days.values():
                d['trips'][van_id] = {'out': {'driver': '', 'rows': []}, 'ret': {'driver': '', 'rows': []}}
            last_row = {}
            # 見出しと同じ行に、その日の運転手が書いてあることは無い（人数らんなので読まない）
            continue
        if not van_id:
            continue
        for di, c in enumerate(DAY_COLS):
            v = ws.cell(r, c).value
            if v is None or not norm(v):
                continue
            text = norm(v)
            day = days[str(di + 1)]
            trip = day['trips'][van_id]
            hhmm = to_hhmm(ws.cell(r, c + 1).value)
            if hhmm:
                leg = 'out' if int(hhmm[:2]) < 12 else 'ret'
                name, place = split_label(text)
                row = {'name': name, 'place': place, 'time': hhmm}
                trip[leg]['rows'].append(row)
                last_row[di] = row
                continue
            # 時刻が無いもの：場所の書き足し・運転手・連絡のどれか
            if text.startswith('(') and di in last_row and not last_row[di]['place']:
                last_row[di]['place'] = text.strip('() ')
                continue
            is_note = len(text) > 10 or any(w in text for w in NOTE_WORDS)
            if is_note:
                day['notes'].append(text)
                continue
            leg = 'ret' if trip['out']['rows'] else 'out'
            if trip['ret']['rows']:
                day['notes'].append(text)
            elif trip[leg]['driver']:
                trip[leg]['driver'] += ' ' + text
            else:
                trip[leg]['driver'] = text
    return {
        'schemaVersion': 2,
        'weekStart': start.isoformat(),
        'vans': vans,
        'days': days,
        'source': 'excel:' + ws.title.strip(),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx')
    ap.add_argument('out')
    ap.add_argument('--facility', default='funny')
    ap.add_argument('--last', type=int, default=12, help='新しいほうから何週ぶん取りこむか')
    ap.add_argument('--seats', default='', help='車ごとの最大の乗車人数。例: "セレナ=7,ハイエース=9"（取りこみ直しても定員が消えないように）。ここに書いた名前は「≪ ≫」が無くても車の見出しとして読む')
    ap.add_argument('--until', default='', help='この日付（YYYY-MM-DD）より後の週は取りこまない。先の週の下書きシートを入れないため')
    a = ap.parse_args()
    seats = {}
    for part in re.split(r'[,、，]+', a.seats):
        if not part.strip():
            continue
        m = re.match(r'^(.+?)\s*[=＝:：]\s*(\d+)$', norm(part))
        if not m:
            raise SystemExit('--seats の書きかたが読めません: %s（例: "セレナ=7,ハイエース=9"）' % part)
        seats[m.group(1)] = int(m.group(2))
    wb = openpyxl.load_workbook(a.xlsx, data_only=True)
    weeks, dup = {}, {}
    for ws in wb.worksheets:
        try:
            if is_stay_sheet(ws):
                w = parse_stay_sheet(ws, next(iter(seats), '送迎車'))
            else:
                w = parse_sheet(ws, set(seats))
        except Exception as e:                      # 形のちがうシートは読みとばす
            print('読めないシート:', ws.title, e, file=sys.stderr)
            continue
        if w and w['vans']:
            riders = sum(len(t[l]['rows']) for d in w['days'].values() for t in d['trips'].values() for l in ('out', 'ret'))
            if riders:
                k = w['weekStart']
                w['_score'] = riders + sum(bool(t[l]['driver']) for d in w['days'].values() for t in d['trips'].values() for l in ('out', 'ret'))
                if k in weeks:
                    dup.setdefault(k, [weeks[k]['source']]).append(w['source'])
                    if w['_score'] < weeks[k]['_score']:
                        continue                      # 同じ週のシートが複数あれば、中身（利用者＋運転手）の多いほう。同じなら後ろのほう
                weeks[k] = w
    if a.until:
        weeks = {k: w for k, w in weeks.items() if k <= a.until}
    keys = sorted(weeks)[-a.last:]
    if not keys:
        raise SystemExit('取りこめる週が見つかりませんでした（日付の行や「≪車名≫」の見出しが読めていません。ふぃっとのように見出しがかこまれていない表は --seats に車の名前を書いてください）')
    for k in keys:
        if k in dup:
            print('注意：%s の週はシートが%d枚あります（%s）。中身の多い「%s」を使いました' % (k, len(dup[k]), '・'.join(dup[k]), weeks[k]['source']), file=sys.stderr)
    for w in weeks.values():
        w.pop('_score', None)
    folder = os.path.join(a.out, 'data', a.facility, 'weeks')
    os.makedirs(folder, exist_ok=True)
    no_seats = set()
    for k in keys:
        w = weeks[k]
        for v in w['vans']:
            if v['name'] in seats:
                v['seats'] = seats[v['name']]
            elif seats:
                no_seats.add(v['name'])
        w['facilityId'] = a.facility
        with open(os.path.join(folder, k + '.json'), 'w', encoding='utf-8') as f:
            json.dump(w, f, ensure_ascii=False, indent=1)
    print('%d週ぶんを書き出しました: %s 〜 %s' % (len(keys), keys[0], keys[-1]))
    if not seats:
        print('注意：--seats が無いので、車の定員は入っていません', file=sys.stderr)
    elif no_seats:
        print('注意：定員の指定が無い車があります: %s' % '、'.join(sorted(no_seats)), file=sys.stderr)


if __name__ == '__main__':
    main()
