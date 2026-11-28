#!/usr/bin/env python3
"""
「利用記録兼シフト」の Excel から、その週にだれが利用する予定かを読みとる道具。

  # 手もとのファイルから
  python3 tools/import_attendance.py --xlsx 利用記録兼シフト2026.xlsm --out <データ用リポジトリ> --facility funny

  # Dropbox から（毎週月曜の朝に GitHub Actions が動かす）
  DROPBOX_APP_KEY=... DROPBOX_REFRESH_TOKEN=... \\
  python3 tools/import_attendance.py --dropbox "id:xxxx" --out <データ用リポジトリ> --facility funny

出力：<out>/data/<事業所>/attendance/<月曜の日付>.json を、今週と来週の2つ。
--only-next を付けると来週の1つだけ（毎週月曜の自動の取りこみはこちら。今週の表はもう完成しているため）。
本物のお名前が入るので、出力先は「非公開のデータ用リポジトリ」にしてください。

シートの読みかた（月ごとのシート「202611」など）：
  - 「氏　名」の見出し行の下に、利用者が1人2行でならぶ
  - 上の行＝その日の列に「予」（利用予定）「○」（利用した）「欠」（欠席）
  - 下の行＝送迎のメモ（「利松送り」「八幡迎え」「送り無」「休み」など）
  - 日の列は、見出し行の 1, 2, 3 … の数字で決まる
"""
import argparse, datetime, io, json, os, re, sys, unicodedata, urllib.parse, urllib.request

USE_MARKS = ('予', '○', '〇', '◯')


def norm(v):
    return unicodedata.normalize('NFKC', '' if v is None else str(v)).strip()


def compact(v):
    return re.sub(r'\s+', '', norm(v))


# ------------------------------------------------------------
# 送迎メモを読む
# ------------------------------------------------------------
def read_memo(memo):
    """
    メモ1つから、迎え・送りの有無と場所を読みとる。
    返すもの: absent（休み）, out / ret（False＝その便は無し）, outPlace / retPlace, rest（読めなかった言葉）
    """
    r = {'absent': False, 'out': True, 'ret': True, 'outPlace': None, 'retPlace': None, 'rest': []}
    for part in re.split(r'[、,，・/\n]+', norm(memo)):
        p = compact(part)
        if not p:
            continue
        if re.search(r'休み|欠席|お休み', p):
            r['absent'] = True
        elif re.fullmatch(r'送迎(無|な)し?', p):
            r['out'] = r['ret'] = False
        elif re.fullmatch(r'迎え?(無|な)し?', p):
            r['out'] = False
        elif re.fullmatch(r'送り?(無|な)し?', p):
            r['ret'] = False
        elif re.search(r'\d', p):
            r['rest'].append(part.strip())            # 「13:00迎え」など、時刻の入ったものは人が読む
        else:
            m = re.fullmatch(r'(.+?)(送迎|迎え|送り)', p)
            if m and m.group(2) == '送迎':
                r['outPlace'] = r['retPlace'] = m.group(1)
            elif m and m.group(2) == '迎え':
                r['outPlace'] = m.group(1)
            elif m and m.group(2) == '送り':
                r['retPlace'] = m.group(1)
            else:
                r['rest'].append(part.strip())
    return r


# ------------------------------------------------------------
# 月のシートを読む
# ------------------------------------------------------------
def read_month(ws, year, month):
    """{日: [利用者…]} を返す"""
    def day_of(v):
        # 日の見出しは「1, 2, 3 …」の数字（ファニー・ふぃっと）か、日付そのもの（ひといき）
        if isinstance(v, (datetime.datetime, datetime.date)):
            return v.day if (v.year, v.month) == (year, month) else None
        s = compact(v)
        return int(s) if s.isdigit() and 1 <= int(s) <= 31 else None

    head = None
    for r in range(1, ws.max_row + 1):
        b = compact(ws.cell(r, 2).value)
        if b in ('氏名',) and day_of(ws.cell(r, 3).value) == 1:
            head = r                                   # 利用者の表の見出し（職員の表にも「氏名」があれば、後ろのほうを使う）
    if not head:
        return {}
    cols = {}
    for c in range(3, ws.max_column + 1):
        d = day_of(ws.cell(head, c).value)
        if d:
            cols[d] = c
        elif cols:
            break
    days = {}
    r = head + 1
    while r <= ws.max_row:
        name = norm(ws.cell(r, 2).value)
        key = compact(name)
        if key.startswith('デイ利用'):
            break
        if not key or key in ('日', '月', '火', '水', '木', '金', '土'):
            r += 1
            continue
        memo_row = r + 1 if not compact(ws.cell(r + 1, 2).value) else None
        family = re.split(r'\s+', name)[0]
        for d, c in cols.items():
            try:
                date = datetime.date(year, month, d)
            except ValueError:
                continue
            mark = compact(ws.cell(r, c).value)
            memo = norm(ws.cell(memo_row, c).value) if memo_row else ''
            if not any(m in mark for m in USE_MARKS) and '欠' not in mark:
                continue
            info = read_memo(memo)
            entry = {'name': re.sub(r'\s+', ' ', name), 'family': family, 'memo': memo}
            if '欠' in mark or info['absent']:
                entry['absent'] = True
            else:
                entry.update({'out': info['out'], 'ret': info['ret']})
                if info['outPlace']:
                    entry['outPlace'] = info['outPlace']
                if info['retPlace']:
                    entry['retPlace'] = info['retPlace']
            if info['rest']:
                entry['rest'] = info['rest']
            days.setdefault(date, []).append(entry)
        r += 2 if memo_row else 1
    return days


def read_weeks(xlsx, week_starts):
    import openpyxl
    import warnings
    warnings.simplefilter('ignore')
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    months = {}
    out = []
    for start in week_starts:
        week = {'weekStart': start.isoformat(), 'days': {}}
        for i in range(6):
            date = start + datetime.timedelta(days=i)
            ym = (date.year, date.month)
            if ym not in months:
                title = '%04d%02d' % ym
                months[ym] = read_month(wb[title], *ym) if title in wb.sheetnames else None
            if months[ym] is None:
                week.setdefault('missing', []).append(date.isoformat())
            week['days'][str(i + 1)] = (months[ym] or {}).get(date, [])
        out.append(week)
    return out


# ------------------------------------------------------------
# Dropbox から取りよせる
# ------------------------------------------------------------
def http(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return res.read()
    except urllib.error.HTTPError as e:
        raise SystemExit('Dropbox から読めませんでした（%s %s）: %s' % (e.code, url.split('/')[-1], e.read().decode('utf-8', 'replace')[:400]))


def dropbox_download(target):
    key = os.environ.get('DROPBOX_APP_KEY', '')
    refresh = os.environ.get('DROPBOX_REFRESH_TOKEN', '')
    if not key or not refresh:
        raise SystemExit('DROPBOX_APP_KEY と DROPBOX_REFRESH_TOKEN がありません（データ用リポジトリの Secrets に入れます）')
    form = {'grant_type': 'refresh_token', 'refresh_token': refresh, 'client_id': key}
    if os.environ.get('DROPBOX_APP_SECRET'):
        form['client_secret'] = os.environ['DROPBOX_APP_SECRET']
    token = json.loads(http('https://api.dropboxapi.com/oauth2/token', urllib.parse.urlencode(form).encode()))['access_token']
    auth = {'Authorization': 'Bearer ' + token}
    # チームのフォルダにあるファイルは、「チーム全体の入口」から数えた場所を言わないと見つからない
    account = json.loads(http('https://api.dropboxapi.com/2/users/get_current_account', b'null', {**auth, 'Content-Type': 'application/json'}))
    root = (account.get('root_info') or {}).get('root_namespace_id')
    headers = {**auth, 'Dropbox-API-Arg': json.dumps({'path': target})}
    if root:
        headers['Dropbox-API-Path-Root'] = json.dumps({'.tag': 'root', 'root': root})
    return io.BytesIO(http('https://content.dropboxapi.com/2/files/download', b'', headers))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--xlsx')
    ap.add_argument('--dropbox', help='Dropbox のファイルの id（id:xxxx）か、場所（/フォルダ/ファイル名）')
    ap.add_argument('--out', required=True)
    ap.add_argument('--facility', required=True)
    ap.add_argument('--only-next', action='store_true', help='来週のぶんだけ読む（今週はさわらない）')
    ap.add_argument('--today', help='たしかめ用：今日の日付（YYYY-MM-DD）。ふつうは付けない')
    a = ap.parse_args()

    jst = datetime.timezone(datetime.timedelta(hours=9))
    now = datetime.datetime.now(jst)
    today = datetime.date.fromisoformat(a.today) if a.today else now.date()
    if today.weekday() == 6:                         # 日曜に動かしたら、翌日からの週を「今週」とする（アプリと同じ決まり）
        today += datetime.timedelta(days=1)
    monday = today - datetime.timedelta(days=today.weekday())
    source = a.xlsx if a.xlsx else dropbox_download(a.dropbox)
    starts = [monday + datetime.timedelta(days=7)] if a.only_next else [monday, monday + datetime.timedelta(days=7)]
    weeks = read_weeks(source, starts)

    folder = os.path.join(a.out, 'data', a.facility, 'attendance')
    os.makedirs(folder, exist_ok=True)
    for w in weeks:
        w.update({'schemaVersion': 1, 'facilityId': a.facility, 'readAt': now.isoformat(timespec='minutes'),
                  'source': '利用記録兼シフト（Dropbox）' if a.dropbox else '利用記録兼シフト（ファイル）'})
        count = sum(1 for d in w['days'].values() for e in d if not e.get('absent'))
        if w.get('missing') and not count:
            print('%s の週：その月のシートがまだ無いので、とばしました' % w['weekStart'])
            continue
        with open(os.path.join(folder, w['weekStart'] + '.json'), 'w', encoding='utf-8') as f:
            json.dump(w, f, ensure_ascii=False, indent=1)
            f.write('\n')
        print('%s の週：のべ %d 人ぶんの利用予定を書き出しました' % (w['weekStart'], count))


if __name__ == '__main__':
    main()
