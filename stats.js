export const FIELDS = ['エンジン', 'シャシ', '故障診断', '環境・安全', '法規'];
export const CUTOFF = 0.4;

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
