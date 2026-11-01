// 今の状態で開ける画面を決める。戻るボタンで途中の画面に戻らないようにする
export function resolvePage(page, { hasKey, hasSetup, inQuiz, hasResults }) {
  const resultOrHome = hasResults ? 'result' : 'home';
  if (!hasKey) return 'lock';
  if (inQuiz) return page === 'quiz' ? 'quiz' : resultOrHome;
  if (page === 'quiz' || page === 'result') return resultOrHome;
  if (page === 'setup') return hasSetup ? 'setup' : 'home';
  return 'home';
}
