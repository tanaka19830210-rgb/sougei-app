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

print('だめが %d 件' % fails if fails else 'すべて OK')
sys.exit(1 if fails else 0)
