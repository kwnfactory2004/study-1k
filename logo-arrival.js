// KWNロゴ演出（ページを開いたとき）。ポータルと同じ logo-intro.js を使い、白い画面の上でロゴを組み上げてから、左上へ飛ばして消す。
// 動きを減らす設定のときは流さない。クリック・Enter・Escape でスキップできる。
// style.css の html::before が、ロゴの絵が出るまでページを白で隠している（ページが一瞬見えないように）。
import { playLogoIntro } from './logo-intro.js';

(function () {
  // 白い覆いと #logo-intro の見た目は style.css にある（CSPで直書きの style が止まるため）
  const uncover = () => document.documentElement.classList.add('logo-uncovered');
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { uncover(); return; }

  // 飛んでいく先。各ページのロゴの場所に合わせるため、左上に見えない箱を置く
  const target = document.createElement('div');
  target.style.cssText = 'position:fixed;left:24px;top:24px;width:56px;height:56px;visibility:hidden;pointer-events:none';
  document.body.appendChild(target);

  // キャンバスが出て、白い1コマ目が描かれるころ（0.08秒後）に、白い覆いを外す（同じ白なので切れ目が見えない）
  const mo = new MutationObserver(() => {
    if (document.getElementById('logo-intro')) { mo.disconnect(); setTimeout(uncover, 80); }
  });
  mo.observe(document.body, { childList: true });

  const done = () => { mo.disconnect(); uncover(); target.remove(); };
  playLogoIntro({ target }).then(done, done);
})();
