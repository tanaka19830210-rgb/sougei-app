/* ============================================================
   はりつく位置（sticky）を、実際の高さに合わせる

   ヘッダーと操作バーは、画面の幅で折り返す数が変わる。
   パソコンでは1行でも、iPad では2〜3行になる。
   CSS に固定の px を書いておくと、iPad で操作バーが
   ヘッダーの裏に隠れて、曜日を変えられなくなる。

   そこで実際の高さを測って、CSS 変数に入れる。
   画面の向きを変えたときや、ボタンが増えたときにも測りなおす。
   ============================================================ */

export function followStickyHeights({
  header = 'header',
  toolbar = '.toolbar'
} = {}) {
  const headerEl = document.querySelector(header);
  const toolbarEl = document.querySelector(toolbar);
  if (!headerEl) return () => {};

  let last = '';
  function apply() {
    const h = Math.round(headerEl.getBoundingClientRect().height);
    const t = toolbarEl ? Math.round(toolbarEl.getBoundingClientRect().height) : 0;
    const key = h + ':' + t;
    if (key === last) return;
    last = key;
    const root = document.documentElement.style;
    root.setProperty('--header-h', h + 'px');
    root.setProperty('--toolbar-h', t + 'px');
  }

  apply();

  /*
    ResizeObserver が無い環境（古い iPadOS）でも、
    画面の回転と読み込み直後には測りなおせるようにしておく。
  */
  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(apply);
    observer.observe(headerEl);
    if (toolbarEl) observer.observe(toolbarEl);
  }
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);

  /*
    スクロールのたびにも測りなおす。

    はりつく位置がずれていて困るのは、スクロールしたときだけ。
    resize も ResizeObserver も来ない環境があっても、
    ここで必ず正しい値に戻る。
    高さが変わっていなければ何も書かないので、負担にはならない。
  */
  let timer = null;
  function onScroll() {
    if (timer) return;
    /*
      requestAnimationFrame では間引かない。
      ほかのアプリに切りかえると rAF は止まるので、
      待ちの印が立ったまま戻らず、以後ずっと測りなおされなくなる。
      setTimeout なら、裏に回っても必ず戻ってくる。
    */
    timer = setTimeout(() => { timer = null; apply(); }, 100);
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Webフォントが遅れて届くと高さが変わるので、少しあとにもう一度 */
  setTimeout(apply, 400);
  setTimeout(apply, 1500);

  return function stop() {
    if (observer) observer.disconnect();
    if (timer) { clearTimeout(timer); timer = null; }
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
    window.removeEventListener('scroll', onScroll);
  };
}
