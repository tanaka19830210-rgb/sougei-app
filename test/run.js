/* ============================================================
   テストをまとめて実行する

   使い方（プロジェクトのフォルダで）：
     node test/run.js

   テスト用の道具（フレームワーク）は入れていません。
   Node に最初から入っている node:test と node:assert だけを使います。
   ぜんぶ通れば最後に「# fail 0」と出ます。
   ============================================================ */

import './dates.test.js';
import './schema.test.js';
import './assign.test.js';
import './store.test.js';
import './print.test.js';
import './data.test.js';
