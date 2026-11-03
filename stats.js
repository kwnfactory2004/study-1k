export const FIELDS = ['エンジン', 'シャシ', '故障診断', '環境・安全', '法規'];
export const CUTOFF = 0.4;
const ERAS = { H: '平成', R: '令和' };
const NEWEST_OLD_YEAR = 'R02'; // これより前は法改正などで今の答えと違うことがある

export function yearLabel(year) {
  const n = Number(year.slice(1));
  return `${ERAS[year[0]]}${n === 1 ? '元' : n}年度`;
}

export const isOldYear = (year) => year.localeCompare(NEWEST_OLD_YEAR) <= 0;

export function fieldOf(no) {
  if (no <= 15) return 'エンジン';
  if (no <= 30) return 'シャシ';
  if (no <= 40) return '故障診断';
  if (no <= 45) return '環境・安全';
  return '法規';
}

export function questionId(question) {
  return `${question.year}-${String(question.no).padStart(2, '0')}`;
}

export function setupError({ fields, years }) {
  if (fields.length === 0) return '分野を選んでください';
  if (years.length === 0) return '年度を選んでください';
  return '';
}

// 解説に「要確認」の印をつけた問題の一覧
export function toggleFlag(flags, id) {
  return flags.includes(id) ? flags.filter((f) => f !== id) : [...flags, id].sort();
}

function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildQueue(questions, { fields, years, order, wrongOnly }, records, rng) {
  const picked = questions.filter((q) =>
    fields.includes(q.field) &&
    years.includes(q.year) &&
    (!wrongOnly || records[questionId(q)]?.last === false));
  picked.sort((a, b) => a.year.localeCompare(b.year) || a.no - b.no);
  return order === 'random' ? shuffled(picked, rng) : picked;
}

// 全員正解の問題（answer が null）は記録しない
export function recordAnswer(records, question, choice) {
  if (question.answer === null) return records;
  const id = questionId(question);
  const old = records[id] ?? { a: 0, c: 0 };
  const correct = choice === question.answer;
  return { ...records, [id]: { a: old.a + 1, c: old.c + (correct ? 1 : 0), last: correct } };
}

export function fieldStats(records) {
  const stats = Object.fromEntries(FIELDS.map((f) => [f, { attempts: 0, correct: 0 }]));
  for (const [id, { a, c }] of Object.entries(records)) {
    const stat = stats[fieldOf(Number(id.split('-')[1]))];
    stat.attempts += a;
    stat.correct += c;
  }
  for (const stat of Object.values(stats)) {
    stat.rate = stat.attempts ? stat.correct / stat.attempts : null;
    stat.belowCutoff = stat.rate !== null && stat.rate < CUTOFF;
  }
  return stats;
}

// 復習モード用：いちばん最近の答えが不正解の問題ID（正解すると自然にリストから外れる）
export function wrongIds(records) {
  return Object.entries(records).filter(([, r]) => r?.last === false).map(([id]) => id).sort();
}
