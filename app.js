import { deriveKey, decryptBundle } from './crypto.js';
import { FIELDS, buildQueue, fieldStats, isOldYear, recordAnswer, yearLabel } from './stats.js';
import { resolvePage } from './route.js';
import { LoadError, errorMessage, isStaleKey } from './messages.js';

const RECORDS_KEY = 'study1k.v1';
const DB_NAME = 'study1k';
const DB_STORE = 'keys';
const TAP_GUARD_MS = 400; // 問題が切り替わった直後のタップは受け付けない
const app = document.getElementById('app');

const state = {
  meta: null,
  key: null,
  records: {},
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

function loadRecords() {
  try {
    state.records = JSON.parse(localStorage.getItem(RECORDS_KEY)) ?? {};
    localStorage.setItem(RECORDS_KEY, JSON.stringify(state.records));
  } catch {
    state.records = {};
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
  app.innerHTML = `<div class="card narrow">
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
  app.innerHTML = `<form class="card narrow" id="lock">
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
  const value = stat.rate === null ? '—' : Math.round(stat.rate * 100);
  const unit = stat.rate === null ? '' : '<span class="unit">%</span>';
  const note = stat.rate === null ? 'まだ解いていません'
    : stat.belowCutoff ? `足切りの40%を下回っています（${stat.attempts}回）` : `${stat.attempts}回解答`;
  return `<button class="card tile ${stat.belowCutoff ? 'warn' : ''}" data-field="${esc(field)}">
    <div class="label">${esc(field)}</div>
    <div class="value">${value}${unit}</div>
    <div class="state">${esc(note)}</div>
  </button>`;
}

function renderHome() {
  const stats = fieldStats(state.records);
  app.innerHTML = `${storageNotice()}
    <h1>Study 1K</h1>
    <p class="sub">分野を選ぶと、その分野の問題に進みます</p>
    <div class="bento">
      ${FIELDS.map((f) => statTile(f, stats[f])).join('')}
      <button class="card tile" id="all"><div class="label">全部の分野</div><div class="state">分野や年度を選んで解く</div></button>
    </div>`;
  app.querySelectorAll('[data-field]').forEach((el) => {
    el.onclick = () => openSetup([el.dataset.field]);
  });
  document.getElementById('all').onclick = () => openSetup(FIELDS);
}

function openSetup(fields) {
  state.setup = { fields, years: [...state.meta.years], order: 'year', wrongOnly: false };
  location.hash = '#setup';
  render();
}

function chips(name, type, items, isChecked, label = (x) => x) {
  return items.map((item) => `<label class="chip"><input type="${type}" name="${name}" value="${esc(item)}" ${isChecked(item) ? 'checked' : ''}>${esc(label(item))}</label>`).join('');
}

function renderSetup(message = '') {
  const s = state.setup;
  app.innerHTML = `<form class="card" id="setup">
    <h1>出題の設定</h1>
    <fieldset><legend>分野</legend><div class="chips">${chips('fields', 'checkbox', FIELDS, (f) => s.fields.includes(f))}</div></fieldset>
    <fieldset><legend>年度</legend><div class="chips">${chips('years', 'checkbox', state.meta.years, (y) => s.years.includes(y), yearLabel)}</div></fieldset>
    <fieldset><legend>順番</legend><div class="chips">${chips('order', 'radio', ['year', 'random'], (o) => s.order === o, (o) => (o === 'year' ? '年度順' : 'ランダム'))}</div></fieldset>
    <fieldset><legend>絞り込み</legend><div class="chips">${chips('wrongOnly', 'checkbox', ['yes'], () => s.wrongOnly, () => '間違えた問題だけ')}</div></fieldset>
    <p class="error" id="msg" role="alert">${esc(message)}</p>
    <div class="row">
      <button class="primary" id="start">始める</button>
      <button class="secondary" type="button" id="back">戻る</button>
    </div>
  </form>`;
  document.getElementById('back').onclick = () => { location.hash = '#home'; render(); };
  document.getElementById('setup').onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    startQuiz({
      fields: form.getAll('fields'),
      years: form.getAll('years'),
      order: form.get('order'),
      wrongOnly: form.has('wrongOnly'),
    });
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
}

function renderQuiz() {
  const q = state.queue[state.index];
  app.innerHTML = `<div class="qhead">
      <span class="sub">${state.index + 1} / ${state.queue.length}・${esc(q.field)}・${esc(yearLabel(q.year))} No.${q.no}</span>
      <button class="secondary" id="quit">終わる</button>
    </div>
    ${storageNotice()}
    ${isOldYear(q.year) ? '<p class="notice">古い年度の問題です。法改正や技術の変化で、今の正解と違う場合があります。</p>' : ''}
    <div class="paper" id="paper"><img alt="${esc(yearLabel(q.year))} No.${q.no} の問題" src="data:image/webp;base64,${q.image}"></div>
    <p class="sub">画像をタップすると拡大します</p>
    <div class="choices">${[1, 2, 3, 4].map((n) => `<button class="choice" data-choice="${n}">${n}</button>`).join('')}</div>
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
  document.getElementById('after').innerHTML = `<p class="feedback ${correct ? '' : 'ng'}" role="status">${esc(text)}</p>
    <button class="primary full" id="next">${last ? '結果を見る' : '次へ'}</button>`;
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
  app.innerHTML = `<div class="bento">
      <div class="card tile span-2"><div class="label">正答率</div><div class="value">${rate ?? '—'}<span class="unit">${rate === null ? '' : '%'}</span></div></div>
      <div class="card tile span-2"><div class="label">正解数</div><div class="value">${correct}<span class="unit"> / ${scored.length}問</span></div></div>
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
