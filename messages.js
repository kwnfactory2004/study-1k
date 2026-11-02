// 読み込みの失敗を、利用者に分かる日本語の文にする
export class LoadError extends Error {
  constructor(path, status) {
    super(`${path}: ${status}`);
    this.name = 'LoadError';
    this.status = status;
  }
}

// 解読に失敗した＝覚えている鍵が今のデータと合わない
export const isStaleKey = (e) => e?.name === 'OperationError';

export function errorMessage(e) {
  if (e instanceof LoadError && e.status === 404) {
    return 'データが見つかりませんでした。更新中かもしれないので、少し待ってから読み込み直してください。';
  }
  if (e instanceof LoadError) {
    return `サーバーから正しく読み込めませんでした（エラー ${e.status}）。少し待ってから読み込み直してください。`;
  }
  if (e instanceof TypeError) {
    return '通信できませんでした。電波のよい場所で、もう一度読み込んでください。';
  }
  return 'うまく読み込めませんでした。もう一度読み込んでください。';
}
