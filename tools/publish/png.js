/* ============================================================
   PNG ファイルの大きさを読む

   画像の部品（ライブラリ）を増やさずに確かめられるように、
   PNG の先頭にある IHDR という場所から幅と高さを取り出します。
   ・0〜3バイト  : PNG の合図（0x89 'P' 'N' 'G'）
   ・16〜19バイト: 幅（ピクセル）
   ・20〜23バイト: 高さ（ピクセル）
   ============================================================ */

export function pngSize(buffer) {
  const buf = Buffer.from(buffer);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
