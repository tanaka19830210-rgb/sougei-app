/* ============================================================
   Base64（GitHub の Contents API は中身を Base64 でやりとりする）
   日本語がまじっても崩れないように UTF-8 を通す。
   ============================================================ */

export function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(String(text));
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeBase64Utf8(base64) {
  const binary = atob(String(base64 || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
