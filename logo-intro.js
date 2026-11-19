// ロゴ起動演出: 白い画面の真ん中でKWNロゴが組み上がり、ヘッダーのロゴの位置へ飛んで着地する。
// ロゴの絵は変えていない（logo.png を12個のパーツに切り分けて動かす。logo-sprites.js）。
// excel-intro.js の最初に呼ばれる（Excel演出のAIカーソルは、着地のあとに動き始める）。
import SPR from './logo-sprites.js';

const SC_T = 0.55;            // 動きを縮める倍率（単体版の約4.4秒 → 約1.7秒）
const PLAY_END = 1.6;         // ロゴが完成するまで（秒）
const FLY_START = 1.65, FLY_END = 2.3;  // ヘッダーへ飛ぶ時間
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const outBack = (t, k = 1.5) => 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
const sine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

function loadSprites() {
  return Promise.all(SPR.map((s) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ ...s, img });
    img.onerror = rej;
    img.src = s.src;
  })));
}

// target: ヘッダーの .site-logo（着地する場所）。isSkipped: スキップされたかを返す関数
export async function playLogoIntro({ target, isSkipped = () => false }) {
  if (!target || isSkipped()) return;
  let sprites;
  try { sprites = await loadSprites(); } catch (e) { return; }
  if (isSkipped()) return;

  const byId = (id) => sprites.find((s) => s.id === id);
  const CAR = byId(2);
  const LET = [byId(10), byId(11), byId(12)];
  const CIRC = sprites.filter((s) => ![2, 10, 11, 12].includes(s.id)).sort((a, b) => a.cx - b.cx);
  CIRC.forEach((s, i) => { s.rank = i; s.jit = ((i * 37) % 7) / 7 * 0.12; });

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  const cv = document.createElement('canvas');
  cv.id = 'logo-intro';
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const off = document.createElement('canvas'); off.width = 1024; off.height = 1024;
  const o = off.getContext('2d');

  // 真ん中の大きさと、着地する場所（ヘッダーのロゴの中身。余白ぶんを引く）
  const bigSize = Math.min(560, Math.min(W, H) * 0.78);
  const s0 = bigSize / 512;
  const c0 = { x: W / 2, y: H / 2 };
  const r = target.getBoundingClientRect();
  const cs = getComputedStyle(target);
  const padL = parseFloat(cs.paddingLeft) || 0, padT = parseFloat(cs.paddingTop) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const inner = r.width - padL - padR;
  const s1 = inner / 512;
  const c1 = { x: r.left + padL + inner / 2, y: r.top + padT + inner / 2 };

  const drawParts = (t, fade) => {
    const T = t / SC_T;                 // 単体版の時間に直す
    const pulse = 1 + 0.018 * Math.sin(Math.PI * prog(T, 2.4, 3.2));
    ctx.save();
    ctx.translate(c0x, c0y); ctx.scale(sc * pulse, sc * pulse); ctx.translate(-256, -256);

    const pc = prog(T, 0.1, 1.6);
    if (pc > 0) {
      const e = sine(pc), slide = (1 - outCubic(pc)) * -26;
      o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, 1024, 1024);
      o.drawImage(CAR.img, CAR.x * 2, CAR.y * 2, CAR.w * 2, CAR.h * 2);
      o.globalCompositeOperation = 'destination-in';
      const edge = (CAR.x - 30 + (CAR.w + 120) * e) * 2, soft = 120;
      const g = o.createLinearGradient(edge - soft, 0, edge, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      o.fillStyle = g; o.fillRect(0, 0, 1024, 1024);
      o.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = fade; ctx.drawImage(off, slide, 0, 512, 512); ctx.globalAlpha = 1;
    }
    LET.forEach((s, i) => {
      const p = prog(T, 0.75 + i * 0.2, 1.5 + i * 0.2); if (p <= 0) return;
      const e = outBack(p, 1.3), a = clamp(p * 2.5);
      ctx.save(); ctx.globalAlpha = fade * a;
      ctx.translate(s.cx, s.cy + s.h / 2);
      ctx.translate(-(1 - e) * 14, (1 - e) * 34);
      ctx.scale(1, 0.88 + 0.12 * e);
      ctx.translate(-s.cx, -(s.cy + s.h / 2));
      ctx.drawImage(s.img, s.x, s.y, s.w, s.h); ctx.restore();
    });
    CIRC.forEach((s) => {
      const st = 1.75 + s.rank * 0.075 + s.jit, p = prog(T, st, st + 0.5); if (p <= 0) return;
      const e = Math.max(outBack(p, 1.6), 0), a = clamp(p * 3);
      const big = s.w > 30, ox = big ? s.x : s.cx, oy = s.cy;
      ctx.save(); ctx.globalAlpha = fade * a;
      ctx.translate(ox, oy); ctx.scale(e, e); ctx.translate(-ox, -oy);
      ctx.drawImage(s.img, s.x, s.y, s.w, s.h); ctx.restore();
    });
    ctx.restore();
  };

  // いまの中心と大きさ（飛んでいる間に変わる）
  let c0x = c0.x, c0y = c0.y, sc = s0;
  const render = (t) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const fp = sine(prog(t, FLY_START, FLY_END));
    ctx.fillStyle = 'rgba(255,255,255,' + (1 - sine(prog(t, FLY_START, FLY_START + 0.55))) + ')';
    ctx.fillRect(0, 0, W, H);
    c0x = c0.x + (c1.x - c0.x) * fp; c0y = c0.y + (c1.y - c0.y) * fp;
    sc = s0 + (s1 - s0) * fp;
    drawParts(t, 1);
  };

  let aborted = false;
  await new Promise((resolve) => {
    let done = false, rafId = 0, last = performance.now();
    const t0 = performance.now();
    const finish = (byUser) => {
      if (done) return; done = true;
      if (byUser === true) aborted = true;
      cancelAnimationFrame(rafId); clearInterval(watch);
      removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') finish(true); };
    addEventListener('keydown', onKey);
    cv.addEventListener('click', () => finish(true));
    const step = () => {
      if (done) return;
      const t = (performance.now() - t0) / 1000;
      last = performance.now();
      render(t);
      if (isSkipped()) { finish(true); return; }
      if (t >= FLY_END) { finish(); return; }
    };
    const loop = () => { step(); if (!done) rafId = requestAnimationFrame(loop); };
    rafId = requestAnimationFrame(loop);
    // 裏のタブなどで描画が止まっても、演出が終わらないままにならないように
    const watch = setInterval(() => { if (performance.now() - last > 120) step(); }, 60);
  });

  // 着地: 本物のヘッダーのロゴを出して、飛んできたロゴと入れ替える
  try { target.classList.add('bp-in'); } catch (e) { /* 次へ */ }
  if (!aborted) await new Promise((r) => setTimeout(r, 250));
  cv.remove();
}
