#!/usr/bin/env python3
"""
これまでの Excel の送迎表（1シート＝1週）を、アプリの週ファイル（JSON）に直す道具。

  python3 tools/import_excel.py 送迎表.xlsx 出力フォルダ --facility funny --last 12

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
    """「谷口様（セブン）」→ ('谷口', 'セブン')"""
    s = norm(s)
    m = re.match(r'^([^\s(（様]+?)(?:様|さん)?\s*(?:[(（]\s*(.*?)\s*[)）]?)?$', s)
    if not m:
        return s, ''
    return m.group(1), (m.group(2) or '')


def week_start_of(ws):
    for c in DAY_COLS:
        v = ws.cell(2, c).value
        d = None
        if isinstance(v, datetime.datetime):
            d = v.date()
        elif isinstance(v, (int, float)) and 30000 < v < 60000:
            d = datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))
        if d:
            d = d - datetime.timedelta(days=DAY_COLS.index(c))
            return d - datetime.timedelta(days=d.weekday())
    return None


def parse_sheet(ws):
    start = week_start_of(ws)
    if not start:
        return None
    vans, days = [], {str(d): {'notes': [], 'trips': {}} for d in range(1, 7)}
    van_id, last_row = None, {}
    for r in range(4, ws.max_row + 1):
        head = None
        for c in (2, 6, 12, 13):
            v = ws.cell(r, c).value
            if v and '≪' in str(v):
                head = norm(v).strip('≪≫ ')
        if head:
            if head == '連絡担当':
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
    a = ap.parse_args()
    wb = openpyxl.load_workbook(a.xlsx, data_only=True)
    weeks = {}
    for ws in wb.worksheets:
        try:
            w = parse_sheet(ws)
        except Exception as e:                      # 形のちがうシートは読みとばす
            print('読めないシート:', ws.title, e, file=sys.stderr)
            continue
        if w and w['vans']:
            riders = sum(len(t[l]['rows']) for d in w['days'].values() for t in d['trips'].values() for l in ('out', 'ret'))
            if riders:
                weeks[w['weekStart']] = w             # 同じ週のシートが複数あれば、後ろ（新しいほう）を使う
    keys = sorted(weeks)[-a.last:]
    folder = os.path.join(a.out, 'data', a.facility, 'weeks')
    os.makedirs(folder, exist_ok=True)
    for k in keys:
        w = weeks[k]
        w['facilityId'] = a.facility
        with open(os.path.join(folder, k + '.json'), 'w', encoding='utf-8') as f:
            json.dump(w, f, ensure_ascii=False, indent=1)
    print('%d週ぶんを書き出しました: %s 〜 %s' % (len(keys), keys[0], keys[-1]))


if __name__ == '__main__':
    main()
