// 学習記録（間違い・統計・要確認の印）だけを書き出す／読み込む。
// 問題文・解答・解説・パスワード・鍵は一切入れない（問題IDと回数だけ）。
export const MAX_BACKUP_BYTES = 1024 * 1024; // 1MB
const APP_NAME = 'study-1k';
const VERSION = 1;
const ID_PATTERN = /^[HR]\d{2}-\d{2}$/;
const MAX_ITEMS = 5000;
const MAX_COUNT = 100000;
const TOP_KEYS = ['app', 'version', 'exportedAt', 'records', 'flags'];

export function backupFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `study-1k-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.json`;
}

export function buildBackup(records, flags, now = new Date()) {
  const cleanRecords = {};
  for (const [id, r] of Object.entries(records)) {
    if (!ID_PATTERN.test(id) || !r) continue;
    cleanRecords[id] = { a: r.a, c: r.c, ...(typeof r.last === 'boolean' ? { last: r.last } : {}) };
  }
  return {
    app: APP_NAME,
    version: VERSION,
    exportedAt: now.toISOString(),
    records: cleanRecords,
    flags: flags.filter((id) => ID_PATTERN.test(id)),
  };
}

const isCount = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_COUNT;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 文字列を検査して、安全な { records, flags } だけを返す。だめなら { error } を返す。
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES) return { error: 'ファイルが大きすぎます（1MBまで）' };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'このファイルは読めませんでした（JSONではありません）' };
  }
  const bad = { error: 'Study 1K のバックアップファイルではないようです' };
  if (!isPlainObject(data) || data.app !== APP_NAME || data.version !== VERSION) return bad;
  if (Object.keys(data).some((k) => !TOP_KEYS.includes(k))) return bad;
  if (!isPlainObject(data.records) || !Array.isArray(data.flags)) return bad;
  const ids = Object.keys(data.records);
  if (ids.length > MAX_ITEMS || data.flags.length > MAX_ITEMS) return bad;
  const records = {};
  for (const id of ids) {
    const r = data.records[id];
    if (!ID_PATTERN.test(id) || !isPlainObject(r)) return bad;
    if (Object.keys(r).some((k) => !['a', 'c', 'last'].includes(k))) return bad;
    if (!isCount(r.a) || !isCount(r.c) || r.c > r.a) return bad;
    if ('last' in r && typeof r.last !== 'boolean') return bad;
    records[id] = { a: r.a, c: r.c, ...('last' in r ? { last: r.last } : {}) };
  }
  if (!data.flags.every((f) => typeof f === 'string' && ID_PATTERN.test(f))) return bad;
  const flags = [...new Set(data.flags)].sort();
  return { records, flags };
}
