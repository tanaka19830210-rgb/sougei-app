#!/usr/bin/env python3
"""
取りこみの道具（import_excel.py・import_attendance.py）のたしかめ。
3つの事業所の Excel の形を、架空の名字だけで小さく作って読ませる。

  python tools/test_importers.py

（node test/run.js とは別。openpyxl が要る）
"""
import datetime, os, sys
import openpyxl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_excel as ie
import import_attendance as ia

MON = datetime.date(2026, 11, 23)
T = datetime.time
fails = 0


def check(label, ok):
    global fails
    print(('OK   ' if ok else 'だめ ') + label)
    if not ok:
        fails += 1


def week_sheet(date_row, header):
    """date_row：日付を書く行。header：車の見出しの書き方（'≪ハイエース≫' か 'ハイエース'）"""
    wb = openpyxl.Workbook()
    ws = wb.active
    for i, c in enumerate(ie.DAY_COLS):
        ws.cell(date_row, c, datetime.datetime.combine(MON + datetime.timedelta(days=i), T(0)))
    ws.cell(5, 2, header)
    ws.cell(6, 2, '森本')                 # 迎えの運転手
    ws.cell(7, 2, '井上様'); ws.cell(7, 3, T(8, 30))
    ws.cell(8, 2, '岡田(ホームA)'); ws.cell(8, 3, T(8, 45))
    ws.cell(9, 2, '川口')                 # 送りの運転手
    ws.cell(10, 2, '井上様'); ws.cell(10, 3, T(15, 40))
    return wb, ws


def trip(w):
    return w['days']['1']['trips']['v1']


# ファニー：日付は2行目、見出しは ≪ ≫
wb, ws = week_sheet(2, '≪ハイエース≫')
w = ie.parse_sheet(ws)
check('ファニーの形：週の月曜', w and w['weekStart'] == MON.isoformat())
check('ファニーの形：迎え2人・送り1人・運転手', w and len(trip(w)['out']['rows']) == 2 and len(trip(w)['ret']['rows']) == 1
      and trip(w)['out']['driver'] == '森本' and trip(w)['ret']['driver'] == '川口')
ws.cell(12, 2, 'ハイエース点検')        # ≪ ≫ のある表では、連絡らんの車の名前を見出しにしない
w = ie.parse_sheet(ws, {'ハイエース'})
check('ファニーの形：連絡らんの車の名前は見出しにしない', w and len(w['vans']) == 1)

# ひといき：日付は3行目
wb, ws = week_sheet(3, '≪ハイエース≫')
w = ie.parse_sheet(ws)
check('ひといきの形：日付が3行目でも読める', w and w['weekStart'] == MON.isoformat() and len(trip(w)['out']['rows']) == 2)

# ふぃっと：日付は1行目、見出しはかこみ無し、「朝　残り」から下は車ではない
wb, ws = week_sheet(1, 'ハイエース　運動会')
ws.cell(20, 2, '朝　残り'); ws.cell(21, 2, '小林'); ws.cell(21, 3, T(9, 0))
w = ie.parse_sheet(ws, {'ハイエース'})
check('ふぃっとの形：かこみ無しの見出し（書き足しつき）', w and [v['name'] for v in w['vans']] == ['ハイエース'])
check('ふぃっとの形：「朝　残り」から下は読まない', w and len(trip(w)['out']['rows']) == 2)
check('ふぃっとの形：--seats が無いと車が見つからない', not ie.parse_sheet(ws)['vans'])


# 利用記録兼シフト：日の見出しが数字（ファニー・ふぃっと）でも日付（ひといき）でも読める
def month_sheet(as_date):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.cell(3, 2, '氏　名')
    for d in range(1, 31):
        ws.cell(3, 2 + d, datetime.datetime(2026, 11, d) if as_date else d)
    ws.cell(4, 2, '山田 一郎'); ws.cell(4, 2 + 23, '予'); ws.cell(5, 2 + 23, '西区送り')
    ws.cell(6, 2, '森本 花子'); ws.cell(6, 2 + 24, '欠')
    ws.cell(8, 2, 'デイ利用者数')
    return ws


for as_date in (False, True):
    days = ia.read_month(month_sheet(as_date), 2026, 11)
    label = '日付の見出し' if as_date else '数字の見出し'
    d23 = days.get(datetime.date(2026, 11, 23), [])
    d24 = days.get(datetime.date(2026, 11, 24), [])
    check('利用予定（%s）：予定と送り場所' % label, len(d23) == 1 and d23[0].get('retPlace') == '西区')
    check('利用予定（%s）：欠席' % label, len(d24) == 1 and d24[0].get('absent'))

# ショートステイ（八幡が丘）の送迎表：日付は4行目、月〜日、「送り出し」「迎え」「他事業所対応」
wb = openpyxl.Workbook()
ws = wb.active
for i, c in enumerate(ie.STAY_DAY_COLS):
    ws.cell(4, c, datetime.datetime.combine(MON + datetime.timedelta(days=i), T(0)))
ws.cell(7, 2, '送り出し')
ws.cell(8, 14, '森本')
ws.cell(9, 14, '井上　ホームA'); ws.cell(9, 15, T(9, 30))
ws.cell(10, 14, '岡田　自宅'); ws.cell(10, 15, T(10, 0))
ws.cell(20, 2, '他事業所対応')
ws.cell(21, 14, '小林様　ほかの事業所が送る')
ws.cell(31, 2, '迎え')
ws.cell(32, 8, '川口')
ws.cell(33, 8, '山田　ホームB'); ws.cell(33, 9, T(15, 30))
check('八幡が丘の形：見分けられる', ie.is_stay_sheet(ws) and not ie.is_stay_sheet(week_sheet(2, '≪ハイエース≫')[1]))
w = ie.parse_stay_sheet(ws)
sun, thu = w['days']['7']['trips']['v1'], w['days']['4']['trips']['v1']
check('八幡が丘の形：週の月曜', w['weekStart'] == MON.isoformat())
check('八幡が丘の形：日曜の送り出し（名字と行き先、自宅は空）', [(r['name'], r['place']) for r in sun['out']['rows']] == [('井上', 'ホームA'), ('岡田', '')] and sun['out']['driver'] == '森本')
check('八幡が丘の形：木曜の迎え', [r['name'] for r in thu['ret']['rows']] == ['山田'] and thu['ret']['driver'] == '川口')
check('八幡が丘の形：他事業所対応は連絡らんへ', w['days']['7']['notes'] == ['小林様 ほかの事業所が送る'])   # 全角のすき間は半角になる

# ショートステイの泊まりの表：部屋ごとに 氏名／短期入所サービス／送迎／食事
wb = openpyxl.Workbook()
ws = wb.active
for d in range(1, 31):
    ws.cell(3, 2 + d, d)
ws.cell(10, 1, '1号室')
ws.cell(10, 2 + 26, '井上太郎'); ws.cell(10, 2 + 27, '井上太郎'); ws.cell(10, 2 + 28, '山田花子')
ws.cell(11, 2, '短期入所サービス')
ws.cell(12, 2, '送迎加算'); ws.cell(12, 2 + 26, '迎'); ws.cell(12, 2 + 27, '送'); ws.cell(12, 2 + 28, 'なし')
ws.cell(13, 2, '食事')
check('泊まりの表：見分けられる', ia.is_stay_month(ws))
days = ia.read_stay_month(ws, 2026, 11, known={'井上'})
d26, d27, d28 = (days.get(datetime.date(2026, 11, n), []) for n in (26, 27, 28))
check('泊まりの表：「迎」は午後の便（ret）、名字は送迎表から', len(d26) == 1 and d26[0]['family'] == '井上' and d26[0]['ret'] and not d26[0]['out'])
check('泊まりの表：「送」は午前の便（out）', len(d27) == 1 and d27[0]['out'] and not d27[0]['ret'])
check('泊まりの表：「なし」は送迎しない・名字が分からなければフルネーム', len(d28) == 1 and not d28[0]['out'] and not d28[0]['ret'] and d28[0]['family'] == '山田花子')

print('だめが %d 件' % fails if fails else 'すべて OK')
sys.exit(1 if fails else 0)
