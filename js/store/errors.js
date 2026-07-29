/* ============================================================
   保存・読みこみのエラー（画面にそのまま出せる日本語メッセージ）
   ============================================================ */

export class StoreError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'StoreError';
    this.detail = detail || '';
  }
}

/* だれかが先に保存していて、こちらの保存が古くなっていた */
export class ConflictError extends StoreError {
  constructor(detail) {
    super('他の人が先に保存しました。画面を読み直してください', detail);
    this.name = 'ConflictError';
  }
}

/* トークンが違う・期限切れ・権限が足りない */
export class AuthError extends StoreError {
  constructor(detail) {
    super('GitHub につながりませんでした。設定のトークンを確認してください', detail);
    this.name = 'AuthError';
  }
}

/* 通信そのものができなかった（電波・オフラインなど） */
export class NetworkError extends StoreError {
  constructor(detail) {
    super('通信できませんでした。インターネットの接続を確認してください', detail);
    this.name = 'NetworkError';
  }
}
