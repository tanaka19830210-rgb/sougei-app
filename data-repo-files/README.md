# データ用リポジトリに置くファイル

このフォルダの中身は、**アプリのリポジトリではなく「データ用リポジトリ（private）」の方**に置くものです。

| このフォルダのファイル | データ用リポジトリでの場所 | 何をするもの |
| --- | --- | --- |
| `publish.yml` | `.github/workflows/publish.yml` | 「確定して配信」を押したときに、送迎表を画像にして LINE WORKS へ送るしくみ |
| `attendance.yml` | `.github/workflows/attendance.yml` | 毎週月曜の朝に、Dropbox の「利用記録兼シフト」から今週と来週の利用予定を読みこむしくみ。準備はアプリの「Dropbox とつなぐ」画面（`dropbox-setup.html`）に手順があります |

置きかた（コピー＆貼りつけでできます）と、LINE WORKS の情報の登録手順は、
アプリのリポジトリの `README.md` の「LINE WORKS 配信のしたく」に、順番どおりに書いてあります。

## 大事なところ

- `publish.yml` の中の **`repository: YOUR-ACCOUNT/soutai-app`** の1行だけ、
  ご自分の GitHub アカウント名に書きかえてください。ここが違うと動きません。
- LINE WORKS の Client Secret や秘密鍵は、**このファイルの中に書かないでください**。
  GitHub の「Secrets」に登録します（README.md に手順があります）。
