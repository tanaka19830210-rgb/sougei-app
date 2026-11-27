/* 失敗の知らせを送る入口（中身は alert.js） */
import { runAlert } from './alert.js';

runAlert(process.argv.slice(2), process.env);
