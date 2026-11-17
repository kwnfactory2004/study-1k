// KWNロゴ演出（ページを開いたとき）。ポータルと同じ logo-intro.js を使い、白い画面の上でロゴを組み上げてから、左上へ飛ばして消す。
// 動きを減らす設定のときは流さない。クリック・Enter・Escape でスキップできる。
import { playLogoIntro } from './logo-intro.js';

(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // 演出の全画面キャンバス（logo-intro.js が作る #logo-intro）の見た目
  const style = document.createElement('style');
  style.textContent = '#logo-intro { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: 9500; cursor: pointer; }';
  document.head.appendChild(style);

  // 飛んでいく先。各ページのロゴの場所に合わせるため、左上に見えない箱を置く
  const target = document.createElement('div');
  target.style.cssText = 'position:fixed;left:24px;top:24px;width:56px;height:56px;visibility:hidden;pointer-events:none';
  document.body.appendChild(target);

  const done = () => target.remove();
  playLogoIntro({ target }).then(done, done);
})();
