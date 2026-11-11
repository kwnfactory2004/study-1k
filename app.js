import { deriveKey, decryptBundle } from './crypto.js';
import { FIELDS, buildQueue, fieldStats, isOldYear, questionId, recordAnswer, setupError, toggleFlag, wrongIds, yearLabel, yearLabelWithExam } from './stats.js';
import { MAX_BACKUP_BYTES, backupFileName, buildBackup, parseBackup } from './backup.js';
import { resolvePage } from './route.js';
import { dotText } from './dotfont.js';
import { LoadError, errorMessage, isStaleKey } from './messages.js';

const RECORDS_KEY = 'study1k.v1';
const FLAGS_KEY = 'study1k.flags.v1';
const PREV_KEY = 'study1k.prev.v1'; // 読み込みで上書きする前の記録の控え
const DB_NAME = 'study1k';
const DB_STORE = 'keys';
const TAP_GUARD_MS = 400; // 問題が切り替わった直後のタップは受け付けない
const app = document.getElementById('app');

const state = {
  meta: null,
  key: null,
  records: {},
  flags: [],
  storageOk: true,
  bundles: {},
  setup: null,
  queue: [],
  index: 0,
  results: [],
  answered: false,
  inQuiz: false,
  current: null,
  loading: false,
  readyAt: 0,
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// 深緑の帯。pill は右上の丸い印（HTML）。subText はドット文字の小さい行
function hero(subText, pill = '') {
  return `<header class="hero">
    <div><span class="t">${dotText('STUDY 1K', 28)}</span><span class="s">${dotText(subText, 10)}</span></div>
    ${pill}
  </header>`;
}

function loadRecords() {
  try {
    state.records = JSON.parse(localStorage.getItem(RECORDS_KEY)) ?? {};
    localStorage.setItem(RECORDS_KEY, JSON.stringify(state.records));
    const flags = JSON.parse(localStorage.getItem(FLAGS_KEY));
    state.flags = Array.isArray(flags) ? flags : [];
  } catch {
    state.records = {};
    state.flags = [];
    state.storageOk = false;
  }
}

function saveRecords() {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(state.records));
  } catch {
    state.storageOk = false;
  }
}

function saveFlags() {
  try {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(state.flags));
  } catch {
    state.storageOk = false;
  }
}

function explanationHtml(q) {
  if (!q.explanation) return '<p class="sub">この問題の解説はまだありません。</p>';
  const flagged = state.flags.includes(questionId(q));
  return `<div class="card explain">
      <p class="label">解説（AI作成・公式ではありません）</p>
      ${q.explanation.sure ? '' : '<p class="notice">この解説は自信が低めです。教科書で確かめてください。</p>'}
      <p class="explain-text">${esc(q.explanation.text)}</p>
      <button class="secondary" id="flag" aria-pressed="${flagged}">${flagged ? '要確認の印を外す' : '解説がおかしい？ 要確認の印をつける'}</button>
    </div>`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function keyStore(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const saveKey = (key) => keyStore('readwrite', (s) => s.put(key, 'main'));
const loadKey = () => keyStore('readonly', (s) => s.get('main'));
const forgetKey = () => keyStore('readwrite', (s) => s.delete('main'));

async function fetchBytes(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new LoadError(path, res.status);
  return new Uint8Array(await res.arrayBuffer());
}

async function keyWorks(key) {
  const bytes = await fetchBytes('data/check.bin');
  try {
    await decryptBundle(key, bytes);
    return true;
  } catch {
    return false;
  }
}

async function loadYears(years) {
  for (const year of years) {
    if (state.bundles[year]) continue;
    const bundle = await decryptBundle(state.key, await fetchBytes(`data/${year}.bin`));
    state.bundles[year] = bundle.questions.map((q) => ({ ...q, year }));
  }
}

function renderError(error) {
  app.innerHTML = `${hero('ERROR')}<div class="card narrow">
    <h1>読み込めませんでした</h1>
    <p>${esc(errorMessage(error))}</p>
    <button class="primary full" id="reload">再読み込み</button>
  </div>`;
  document.getElementById('reload').onclick = () => location.reload();
}

function storageNotice() {
  return state.storageOk ? '' : '<p class="notice">このブラウザには記録を保存できません。問題は解けますが、成績は残りません。</p>';
}

function renderLock(message = '') {
  app.innerHTML = `${hero('LOCKED')}<form class="card narrow" id="lock">
    <h1>Study 1K</h1>
    <p class="sub">パスワードを入れてください</p>
    <input type="password" id="pw" autocomplete="current-password" aria-label="パスワード" required>
    <label class="check"><input type="checkbox" id="remember" checked> この機器で覚える</label>
    <p class="error" id="msg" role="alert">${esc(message)}</p>
    <button class="primary full" id="go">開く</button>
  </form>`;
  document.getElementById('lock').onsubmit = async (event) => {
    event.preventDefault();
    const go = document.getElementById('go');
    const msg = document.getElementById('msg');
    go.disabled = true;
    msg.textContent = '';
    try {
      const salt = Uint8Array.from(atob(state.meta.salt), (c) => c.charCodeAt(0));
      const key = await deriveKey(document.getElementById('pw').value, salt, state.meta.iterations);
      if (!(await keyWorks(key))) {
        msg.textContent = 'パスワードが違います';
        go.disabled = false;
        return;
      }
      state.key = key;
      if (document.getElementById('remember').checked) await saveKey(key).catch(() => {});
      location.hash = '#home';
      render();
    } catch (e) {
      renderError(e);
    }
  };
}

function statTile(field, stat) {
  const pct = stat.rate === null ? null : Math.round(stat.rate * 100);
  const num = pct === null ? dotText('-', 32, 'まだ記録なし') : dotText(`${pct}%`, 32, `正答率 ${pct}パーセント`);
  const note = stat.rate === null ? 'まだ解いていません'
    : stat.belowCutoff ? `足切りの40%を下回っています（${stat.attempts}回）` : `${stat.attempts}回解答`;
  return `<button class="card tile ${stat.belowCutoff ? 'warn' : ''}" data-field="${esc(field)}">
    <div class="label">${esc(field)}</div>
    <div class="num">${num}</div>
    <progress class="bar" max="100" value="${pct ?? 0}" aria-hidden="true"></progress>
    <div class="state">${esc(note)}</div>
  </button>`;
}

function renderHome() {
  const stats = fieldStats(state.records);
  const wrongCount = wrongIds(state.records).length;
  const solved = Object.keys(state.records).length;
  const total = state.meta.years.length * 50;
  const pill = `<span class="pill">${dotText(`${solved}/${total}`, 12, `解いた問題 ${solved} / ${total}`)}<span class="pill-jp">解いた</span></span>`;
  app.innerHTML = `${hero('PAST EXAMS', pill)}${storageNotice()}
    <p class="sub">分野を選ぶと、その分野の問題に進みます</p>
    <div class="bento">
      <button class="card tile" id="all"><div class="label">全部の分野</div><div class="num">${dotText('ALL >', 32, 'すべて')}</div><div class="state">分野や年度を選んで解く</div></button>
      ${FIELDS.map((f) => statTile(f, stats[f])).join('')}
      <button class="card tile dark span-2" id="review"><div class="label">復習モード</div><div class="num">${dotText(`${wrongCount}`, 32, `${wrongCount}問`)}</div><div class="state">${wrongCount ? '間違えた問題だけを解く（正解すると外れます）' : '間違えた問題はありません'}</div></button>
    </div>
    <p class="error" id="reviewMsg" role="alert"></p>
    ${state.flags.length ? `<div class="card">
      <h2>要確認の印をつけた解説</h2>
      <ul class="wrong-list">${state.flags.map((id) => `<li>${esc(yearLabel(id.slice(0, 3)))} No.${Number(id.slice(4))}</li>`).join('')}</ul>
    </div>` : ''}
    <div class="card">
      <h2>学習記録のバックアップ</h2>
      <p class="sub">間違いと成績だけをファイルに保存できます。問題・解説・パスワードは入りません。</p>
      <div class="row">
        <button class="secondary" id="export">書き出す</button>
        <button class="secondary" id="import">読み込む</button>
        <input type="file" id="importFile" accept=".json,application/json" hidden>
      </div>
      <p class="sub" id="backupMsg" role="status"></p>
    </div>`;
  app.querySelectorAll('[data-field]').forEach((el) => {
    el.onclick = () => openSetup([el.dataset.field]);
  });
  document.getElementById('all').onclick = () => openSetup(FIELDS);
  document.getElementById('review').onclick = startReview;
  setupBackupButtons();
}

function setupBackupButtons() {
  const msg = document.getElementById('backupMsg');
  const file = document.getElementById('importFile');
  document.getElementById('export').onclick = () => {
    const json = JSON.stringify(buildBackup(state.records, state.flags), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    msg.textContent = `${a.download} を書き出しました`;
  };
  document.getElementById('import').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    if (f.size > MAX_BACKUP_BYTES) { msg.textContent = 'ファイルが大きすぎます（1MBまで）'; return; }
    const result = parseBackup(await f.text());
    if (result.error) { msg.textContent = result.error; return; }
    const n = Object.keys(result.records).length;
    if (!window.confirm(`${n}問ぶんの記録を読み込みます。今の記録は置き換わります（直前の記録は控えとして1つ残します）。よろしいですか？`)) {
      msg.textContent = '読み込みをやめました';
      return;
    }
    try {
      localStorage.setItem(PREV_KEY, JSON.stringify({ records: state.records, flags: state.flags }));
    } catch { /* 控えが残せなくても続ける */ }
    state.records = result.records;
    state.flags = result.flags;
    saveRecords();
    saveFlags();
    renderHome();
    document.getElementById('backupMsg').textContent = `${n}問ぶんの記録を読み込みました`;
  };
}

// 復習モード：直近の答えが不正解の問題だけを、年度をまたいでランダムに出す
async function startReview() {
  if (state.loading) return;
  const msg = document.getElementById('reviewMsg');
  const ids = wrongIds(state.records);
  if (ids.length === 0) {
    msg.textContent = '間違えた問題はまだありません。問題を解くと、ここに集まります';
    return;
  }
  const years = [...new Set(ids.map((id) => id.slice(0, 3)))].filter((y) => state.meta.years.includes(y));
  state.loading = true;
  msg.textContent = '読み込み中…';
  try {
    await loadYears(years);
    if (state.current !== 'home') { state.loading = false; return; }
    const all = years.flatMap((y) => state.bundles[y]);
    state.queue = buildQueue(all, { fields: FIELDS, years, order: 'random', wrongOnly: true }, state.records, Math.random);
    state.loading = false;
    if (state.queue.length === 0) {
      msg.textContent = '復習できる問題が見つかりませんでした';
      return;
    }
    state.index = 0;
    state.results = [];
    state.answered = false;
    state.inQuiz = true;
    location.hash = '#quiz';
    render();
  } catch (e) {
    state.loading = false;
    await handleLoadError(e);
  }
}

function openSetup(fields) {
  state.setup = { fields, years: [], order: 'year', wrongOnly: false };
  location.hash = '#setup';
  render();
}

function chips(name, type, items, isChecked, label = (x) => x) {
  return items.map((item) => `<label class="chip"><input type="${type}" name="${name}" value="${esc(item)}" ${isChecked(item) ? 'checked' : ''}>${esc(label(item))}</label>`).join('');
}

function renderSetup(message = '') {
  const s = state.setup;
  app.innerHTML = `${hero('SETUP')}<form class="card" id="setup">
    <h1>出題の設定</h1>
    <p class="sub">上から順に選んで、いちばん下の「始める」を押します。</p>
    <fieldset><legend>${dotText('01', 12, '1')}分野</legend><div class="chips">${chips('fields', 'checkbox', FIELDS, (f) => s.fields.includes(f))}</div></fieldset>
    <fieldset><legend>${dotText('02', 12, '2')}年度</legend>
      <div class="quick">
        <button class="secondary" type="button" id="recent">最近5年</button>
        <button class="secondary" type="button" id="allYears">すべて選ぶ</button>
      </div>
      <div class="chips">${chips('years', 'checkbox', state.meta.years, (y) => s.years.includes(y), yearLabelWithExam)}</div></fieldset>
    <fieldset><legend>${dotText('03', 12, '3')}順番</legend><div class="chips">${chips('order', 'radio', ['year', 'random'], (o) => s.order === o, (o) => (o === 'year' ? '年度順' : 'ランダム'))}</div></fieldset>
    <fieldset><legend>${dotText('04', 12, '4')}絞り込み（なくてもOK）</legend><div class="chips">${chips('wrongOnly', 'checkbox', ['yes'], () => s.wrongOnly, () => '間違えた問題だけ')}</div></fieldset>
    <p class="error" id="msg" role="alert">${esc(message)}</p>
    <div class="actions">
      <p class="summary" id="summary" role="status"></p>
      <div class="row">
        <button class="primary" id="start">始める</button>
        <button class="secondary" type="button" id="back">戻る</button>
      </div>
    </div>
  </form>`;
  document.getElementById('back').onclick = () => { location.hash = '#home'; render(); };
  const yearBoxes = [...app.querySelectorAll('input[name="years"]')];
  const allYears = document.getElementById('allYears');
  const summary = document.getElementById('summary');
  const form = document.getElementById('setup');
  const updateSummary = () => {
    const fd = new FormData(form);
    const nf = fd.getAll('fields').length;
    const ny = fd.getAll('years').length;
    const fieldText = nf === FIELDS.length ? '全分野' : nf === 0 ? '分野が未選択' : fd.getAll('fields').join('・');
    const yearText = ny === 0 ? '年度が未選択' : `${ny}年度`;
    const orderText = fd.get('order') === 'random' ? 'ランダム' : '年度順';
    summary.textContent = `${fieldText} ／ ${yearText} ／ ${orderText}${fd.has('wrongOnly') ? ' ／ 間違いだけ' : ''}`;
  };
  const updateAllYears = () => {
    allYears.textContent = yearBoxes.every((b) => b.checked) ? 'すべて外す' : 'すべて選ぶ';
    updateSummary();
  };
  allYears.onclick = () => {
    const on = !yearBoxes.every((b) => b.checked);
    yearBoxes.forEach((b) => { b.checked = on; });
    updateAllYears();
  };
  document.getElementById('recent').onclick = () => {
    const recent = yearBoxes.slice(-5);
    yearBoxes.forEach((b) => { b.checked = recent.includes(b); });
    updateAllYears();
  };
  form.onchange = updateAllYears;
  updateAllYears();
  document.getElementById('setup').onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const setup = {
      fields: form.getAll('fields'),
      years: form.getAll('years'),
      order: form.get('order'),
      wrongOnly: form.has('wrongOnly'),
    };
    const error = setupError(setup);
    if (error) {
      state.setup = setup;
      renderSetup(error);
      return;
    }
    startQuiz(setup);
  };
}

async function startQuiz(setup) {
  if (state.loading) return;
  state.setup = setup;
  state.loading = true;
  const start = document.getElementById('start');
  start.disabled = true;
  start.textContent = '読み込み中…';
  try {
    await loadYears(setup.years);
    if (state.current !== 'setup') {
      state.loading = false; // 読み込み中に別の画面へ移った
      return;
    }
    const all = setup.years.flatMap((y) => state.bundles[y]);
    state.queue = buildQueue(all, setup, state.records, Math.random);
    state.loading = false;
    if (state.queue.length === 0) {
      renderSetup('該当する問題がありません');
      return;
    }
    state.index = 0;
    state.results = [];
    state.answered = false;
    state.inQuiz = true;
    location.hash = '#quiz';
    render();
  } catch (e) {
    state.loading = false;
    await handleLoadError(e);
  }
}

async function handleLoadError(e) {
  if (isStaleKey(e)) {
    await forgetKey().catch(() => {});
    state.key = null;
    state.bundles = {};
    state.current = 'lock';
    try {
      await loadMeta(); // 新しいデータの鍵づくりの設定に入れ替える
    } catch (err) {
      renderError(err);
      return;
    }
    renderLock('データが更新されました。パスワードをもう一度入れてください。');
    return;
  }
  renderError(e);
}

function renderQuiz() {
  const q = state.queue[state.index];
  const n = state.index + 1;
  const total = state.queue.length;
  app.innerHTML = `<div class="qbar">
      <div class="qhead">
        <span class="qcount">${dotText(`${n}/${total}`, 24, `${total}問中 ${n}問目`)}</span>
        <button class="secondary" id="quit">終わる</button>
      </div>
      <progress class="bar" max="${total}" value="${n}" aria-hidden="true"></progress>
    </div>
    <p class="qmeta">${esc(q.field)}・${esc(yearLabelWithExam(q.year))} No.${q.no}</p>
    ${storageNotice()}
    ${isOldYear(q.year) ? '<p class="notice">古い年度の問題です。法改正や技術の変化で、今の正解と違う場合があります。</p>' : ''}
    <div class="paper" id="paper"><img alt="${esc(yearLabel(q.year))} No.${q.no} の問題" src="data:image/webp;base64,${q.image}"></div>
    <p class="sub">画像をタップすると拡大します</p>
    <div class="choices">${[1, 2, 3, 4].map((n) => `<button class="choice" data-choice="${n}" aria-label="選択肢 ${n}">${dotText(`${n}`, 28, `${n}`)}</button>`).join('')}</div>
    <div id="after"></div>`;
  state.readyAt = performance.now() + TAP_GUARD_MS;
  document.getElementById('paper').onclick = (e) => e.currentTarget.classList.toggle('zoom');
  document.getElementById('quit').onclick = showResult;
  app.querySelectorAll('.choice').forEach((el) => {
    el.onclick = () => answer(Number(el.dataset.choice));
  });
}

function answer(choice) {
  if (state.answered || performance.now() < state.readyAt) return;
  state.answered = true;
  const q = state.queue[state.index];
  const scored = q.answer !== null;
  const correct = !scored || choice === q.answer;
  state.records = recordAnswer(state.records, q, choice);
  saveRecords();
  state.results.push({ q, scored, correct });
  app.querySelectorAll('.choice').forEach((el) => {
    const n = Number(el.dataset.choice);
    el.disabled = true;
    if (scored && n === q.answer) el.classList.add('correct');
    if (scored && n === choice && !correct) el.classList.add('wrong');
  });
  const text = !scored ? 'この問題は公式で全員正解になったため、採点しません'
    : correct ? '正解' : `不正解（正解は ${q.answer}）`;
  const last = state.index + 1 >= state.queue.length;
  const mark = !scored ? '' : correct ? dotText('OK', 24, '') : dotText('NG', 24, '');
  document.getElementById('after').innerHTML = `<p class="feedback ${correct ? '' : 'ng'}" role="status">${mark}<span>${esc(text)}</span></p>
    ${explanationHtml(q)}
    <button class="primary full" id="next">${last ? '結果を見る' : '次へ'}</button>`;
  const flag = document.getElementById('flag');
  if (flag) {
    flag.onclick = () => {
      state.flags = toggleFlag(state.flags, questionId(q));
      saveFlags();
      const on = state.flags.includes(questionId(q));
      flag.setAttribute('aria-pressed', String(on));
      flag.textContent = on ? '要確認の印を外す' : '解説がおかしい？ 要確認の印をつける';
    };
  }
  document.getElementById('next').onclick = () => {
    if (last) { showResult(); return; }
    state.index += 1;
    state.answered = false;
    renderQuiz();
    window.scrollTo(0, 0);
  };
}

function showResult() {
  state.inQuiz = false;
  location.hash = '#result';
  render();
}

function renderResult() {
  const scored = state.results.filter((r) => r.scored);
  const correct = scored.filter((r) => r.correct).length;
  const wrong = scored.filter((r) => !r.correct);
  const rate = scored.length ? Math.round((correct / scored.length) * 100) : null;
  const rateNum = rate === null ? dotText('-', 40, '採点なし') : dotText(`${rate}%`, 40, `正答率 ${rate}パーセント`);
  app.innerHTML = `${hero('RESULT')}<div class="bento">
      <div class="card tile dark span-2"><div class="label">正答率</div><div class="num">${rateNum}</div></div>
      <div class="card tile span-2"><div class="label">正解数</div><div class="num">${dotText(`${correct}/${scored.length}`, 40, `${scored.length}問中 ${correct}問正解`)}</div></div>
    </div>
    <div class="card">
      <h2>間違えた問題</h2>
      ${wrong.length ? `<ul class="wrong-list">${wrong.map(({ q }) => `<li>${esc(yearLabel(q.year))} No.${q.no}（${esc(q.field)}）</li>`).join('')}</ul>` : '<p class="sub">ありません</p>'}
      <div class="row">
        <button class="primary" id="home">ホームへ</button>
        ${wrong.length ? '<button class="secondary" id="retry">間違えた問題を解き直す</button>' : ''}
      </div>
    </div>`;
  document.getElementById('home').onclick = () => { location.hash = '#home'; render(); };
  const retry = document.getElementById('retry');
  if (retry) {
    retry.onclick = () => {
      state.queue = wrong.map((r) => r.q);
      state.index = 0;
      state.results = [];
      state.answered = false;
      state.inQuiz = true;
      location.hash = '#quiz';
      render();
    };
  }
}

function render() {
  const wanted = location.hash.slice(1);
  const page = resolvePage(wanted, {
    hasKey: Boolean(state.key),
    hasSetup: Boolean(state.setup),
    inQuiz: state.inQuiz,
    hasResults: state.results.length > 0,
  });
  if (page !== state.current) window.scrollTo(0, 0);
  state.current = page;
  if (page === 'lock') { renderLock(); return; }
  if (page !== 'quiz') state.inQuiz = false;
  if (page !== wanted) history.replaceState(null, '', `#${page}`);
  if (page === 'setup') renderSetup();
  else if (page === 'quiz') renderQuiz();
  else if (page === 'result') renderResult();
  else renderHome();
}

async function restoreKey() {
  let key;
  try {
    key = await loadKey();
  } catch {
    return;
  }
  if (!key) return;
  if (await keyWorks(key)) {
    state.key = key;
  } else {
    await forgetKey().catch(() => {});
  }
}

async function loadMeta() {
  const res = await fetch('data/meta.json', { cache: 'no-cache' });
  if (!res.ok) throw new LoadError('data/meta.json', res.status);
  state.meta = await res.json();
}

async function main() {
  loadRecords();
  try {
    await loadMeta();
    await restoreKey();
    render();
  } catch (e) {
    renderError(e);
  }
}

window.addEventListener('hashchange', () => {
  if (state.key && location.hash.slice(1) !== state.current) render();
});

main();
