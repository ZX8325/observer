/* ═══════════════════════════════════════════════════════════════════
   启动页 —— 「观测站接入仪式」  ★ 2026-09-21
   ═══════════════════════════════════════════════════════════════════
   每次**刷新页面**都会出现的一道开机屏：左上角一个闪烁的光标，
   逐字打出四行接入日志，然后提示「按任意键，开始观测」。

   ── 它和游戏的边界 ──
   ⚠️ **它和「观测指南」是两回事，互不干扰**（用户明确要求的）：
        · 启动页 —— 每次刷新都出现，**进入游戏前的那道门**
        · 观测指南 —— 点【开始演化】之后才弹，讲**怎么玩**
      两个组件的代码、状态、DOM 全是分开的，谁也不知道对方存在。

   ⚠️⚠️ **`isStarting` 那把锁不能省** ⚠️⚠️
      玩家狂按键盘时 `keydown` 一秒能来十几次，点屏幕还会额外补一个
      `click`。没有锁的话退场动画会被**重入十几次** ——
      白光闪十几次、几个定时器互相打架，最后留在屏幕上的东西完全看运气。

   ── 为什么它是**根目录**的文件、不是 core/ 的 ──
   `core/` 有一条铁律：**不许碰 DOM**（那样才能在 node 里跑测试）。
   启动页几乎全是 DOM，所以它和 `app.js` 一样住在根目录。

   ⚠️ 但它**仍然写成 UMD-lite** —— 这样 `_style_test.js` 能 `require` 它，
      把上面那四行字收进文风体检。
      写在 index.html 里就是**文风盲区**：哪天有人把「信号连接正常」改成
      一句口语，不会有任何测试红。这个坑本项目踩过四次。
   ═══════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Splash = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     文案（★ 用户 2026-09-21 给的原文，一个字没动）
     ⚠️ 每行末尾是 ASCII 的三个点 `...`，不是中文省略号「…」——
        用户就是这么写的，而且这是**终端口吻**的屏幕，三个点更对味。
        （`_es2017_scan.js` 不会把它当成展开语法：那个扫描器会先把
          单引号字符串挖成空格再跑模式，见那个文件的 `skin()`。）
     ⚠️ 第三、四行末尾是**句号** —— 和一二行的 `...` 不是一套标点，
        那是**故意的**：前两行是"正在做"，后两行是"已经好了"。
        改文案时别顺手把标点统一掉。 */
  var LINES = [
    '正在接入观测网络...',
    '正在寻找可观测的星球...',
    '信号连接正常。',
    '欢迎回来，观测者。'
  ];

  /* 提示行。末尾那个 `_` 是**光标**，不是下划线 —— 见 index.html 那段。 */
  var HINT = '按任意键，开始观测_';

  /* ── 节奏（用户定的：每行间隔 500ms、每字 45ms）── */
  var CHAR_MS  = 45;    // 每个字之间
  var LINE_GAP = 500;   // 一行打完之后停多久再打下一行
  /* ★ 2026-09-21 第 3 版：整屏淡出，用户指定 0.8 秒（"像雾气消散"）。
     ⚠️⚠️ 这个数**必须和 style.css 里 `.splash` 的 `transition: opacity 0.8s`
          `0.8s` 一致** ⚠️⚠️ —— 它决定"什么时候才允许把这一层撤掉"：
          短了 → **过渡还没跑完就把启动页隐藏掉**（用户明说"绝对不许"）；
          长了 → 淡完了还白等一段才撤，那段时间点不动游戏。
          ★ 两处隔着一个语言（JS / CSS），是**手抄常数**，所以
            `_wiring_test.js` 有一条断言专门对拍这两个数（见第 25 节）。
          ★ 但它**不是唯一依据** —— 真正撤掉靠 `transitionend`，
            这个数只是"万一那事件不来"的兜底（理由见下面 `begin()` 里那段）。 */
  var FADE_MS  = 800;   // 整屏淡出

  /* ⚠️ 锁必须挂在**模块级**（不是 start() 里的局部变量）——
     它要挡住的是"整个退场流程"，而不是"某一次调用"。 */
  var booted = false;     // start() 只跑一次
  var isStarting = false; // ★ 退场只触发一次

  function el(id) { return document.getElementById(id); }

  /* ─────────────────────────────────────────────────────────────
     退场
     ───────────────────────────────────────────────────────────── */

  /** 玩家按了键 / 点了屏幕 —— **整屏淡出**，然后露出游戏。
   *
   *  ⚠️ 第一件事就是上锁，**在动任何 DOM 之前**。
   *     放到后面的话，两个事件挤在同一个 tick 里进来时，
   *     第二个已经在锁之前把 DOM 改了一半了。 */
  function begin() {
    if (isStarting) return;
    isStarting = true;

    off();

    var splash = el('splash');
    if (!splash) return;

    /* ① 整屏淡出 —— 黑色背景 + 四行字 + 提示行 **一起**淡。
       ★ 2026-09-21 用户第 3 版：把光刃和白球整个撤掉，只留这一层。
         原话「严格执行'全局淡出'」「像雾气消散」。
       ⚠️ 只有**这一层**在淡：`transition` 写在 `.splash` 上，
          里面的字没有各自的过渡，它们跟着父级的不透明度一起走 ——
          所以是"整块平稳地淡下去"，不会出现字先没、背景后没。
       ⚠️ 用的 `classList.add` 而不是 `className = 'splash gone'`：
          这样"退场跑了几次"的计数器能挂在 `classList.add` 上
          （见 `_splashcheck.js` —— 那是证明状态锁有效的唯一手段）。 */
    splash.classList.add('gone');

    /* ② ★★ **等它真的淡完**，再把这一层撤出文档流 ★★
       ⚠️⚠️ 用户点名："绝对不能在过渡中途就隐藏" ⚠️⚠️
       两道路一起走，**谁先到算谁的**：
         · `transitionend` —— 精确。过渡一结束就触发，不多等一毫秒
         · `setTimeout(FADE_MS + 50)` —— **兜底**
       ⚠️⚠️ 兜底那道路**不能省** ⚠️⚠️
          `transitionend` **不保证会来**：过渡被打断、属性值没变化、
          或者环境把它跳过了（`prefers-reduced-motion`；无头浏览器会
          把过渡冻住 —— 这个本项目实测过），它都一声不响地不触发。
          真不来而这里又只靠它 → **启动页永远盖在游戏上面**，
          玩家点什么都没反应，而且**不报错**。
          这比"多等 50 毫秒"坏得多，所以兜底必须有。
       ⚠️ 那 `+50` 是干什么的：两道路都瞄准"大约 800ms"，
          定时器可能**比过渡的最后一帧早那么一点点** —— 留一帧的余量。 */
    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      splash.removeEventListener('transitionend', onFadeEnd);
      /* ⚠️ `display: none`（用户指定）—— 让它**彻底离开文档流**，
         这样它不再拦鼠标。⚠️ 这一步**只能在这儿**做：
         `display` 是**不能过渡**的属性，提前设上，淡出会被直接掐断。 */
      splash.classList.add('off');
    }
    function onFadeEnd(e) {
      /* ⚠️ 两重判断都不能省：`transitionend` 会**冒泡**（子元素身上的过渡
         也会飘上来），而且这一层以后可能加别的过渡属性。 */
      if (e.target === splash && e.propertyName === 'opacity') dismiss();
    }
    splash.addEventListener('transitionend', onFadeEnd);
    setTimeout(dismiss, FADE_MS + 50);
  }

  /* ── 事件绑定 / 解绑 ──
     ⚠️ 用 `pointerdown` 而不是 `click`：按下就有反应，不用等抬手。
        触摸和鼠标都由它一统。老环境（没有 PointerEvent）退回
        touchstart + mousedown —— 和 app.js 里画布那套是同一个写法。
     ⚠️ 捕获阶段（`true`）—— 这样即使哪个子元素 stopPropagation 也拦不住。 */
  var EV_POINTER = (typeof window !== 'undefined' &&
                    typeof window.PointerEvent !== 'undefined')
    ? ['pointerdown'] : ['touchstart', 'mousedown'];

  function on() {
    window.addEventListener('keydown', begin, true);
    for (var i = 0; i < EV_POINTER.length; i++) {
      window.addEventListener(EV_POINTER[i], begin, true);
    }
  }
  function off() {
    window.removeEventListener('keydown', begin, true);
    for (var i = 0; i < EV_POINTER.length; i++) {
      window.removeEventListener(EV_POINTER[i], begin, true);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     打字机
     ───────────────────────────────────────────────────────────── */
  function run() {
    booted = true;

    var box   = el('splash-log');
    var caret = el('splash-caret');
    var hint  = el('splash-hint');
    if (!box || !caret) return;      // 没有启动页的 DOM（测试环境）就安静退出

    var li = 0, ci = 0, lineEl = null;

    /* ⚠️ index.html 里**已经有一个空行**了（光标出生就住在里面），
       第一行直接**用它**，别再造一个 —— 造的话原来那个会空着留在最上面。
       它高度 0、当下看不见，但它实实在在是第 5 个行盒子：
       哪天谁给 `.splash-line` 加个边距，顶上就多空一截。
       （★ 2026-09-21 用 `_splashgeom.js` 量出来的：行数=5，应该是 4。） */
    var firstLine = box.querySelector('.splash-line');

    /** 新起一行，并把光标挪到这一行里。
     *  ⚠️ 光标是 `lineEl` 里**最后一个子节点**，所以打字要用
     *     `insertBefore(文本, caret)` —— 直接写 `lineEl.textContent += ch`
     *     会把整个子节点列表换掉，**光标就被抹掉了**（而且不报错）。 */
    function newLine() {
      if (lineEl && caret.parentNode === lineEl) lineEl.removeChild(caret);
      if (firstLine) {
        lineEl = firstLine;      // 第一次：用 HTML 里那个现成的空行
        firstLine = null;
      } else {
        lineEl = document.createElement('div');
        lineEl.className = 'splash-line';
        box.appendChild(lineEl);
      }
      lineEl.appendChild(caret);
      ci = 0;
    }

    function step() {
      /* 四行打完了 → 光标收掉、提示淡入、开始收玩家的操作 */
      if (li >= LINES.length) {
        caret.style.display = 'none';
        if (hint) hint.className = 'splash-hint show';
        on();
        return;
      }

      if (!lineEl) newLine();

      var t = LINES[li];
      if (ci < t.length) {
        lineEl.insertBefore(document.createTextNode(t.charAt(ci)), caret);
        ci++;
        setTimeout(step, CHAR_MS);
        return;
      }

      /* 这一行打完了：停在原地 LINE_GAP，再打下一行 */
      li++;
      lineEl = null;
      setTimeout(step, LINE_GAP);
    }

    step();
  }

  /* ⚠️ 提示行的那句话**从这儿填进 DOM**（不是写死在 index.html 里）——
     写死在 HTML 里，`_style_test.js` 就收不到它了，那是文风盲区。 */
  function fillHint() {
    var hint = el('splash-hint');
    if (!hint) return;
    var s = document.createElement('span');
    s.textContent = HINT;
    hint.appendChild(s);
  }

  function start() {
    if (booted) return;
    if (typeof document === 'undefined') return;   // node 里 require 时什么都不做
    fillHint();
    run();
  }

  /* ── 自启动 ──
     ⚠️ 脚本挂在 body 末尾，上面那几行 DOM 已经解析完了，所以这里直接跑就行，
        不用等 DOMContentLoaded（等的话会白等一帧，启动页会闪一下）。
     ⚠️ `typeof document` 那道判断是给 node 用的（测试会 require 这个文件）。 */
  if (typeof document !== 'undefined') start();

  return {
    LINES: LINES,
    HINT: HINT,
    CHAR_MS: CHAR_MS,
    LINE_GAP: LINE_GAP,
    FADE_MS: FADE_MS,
    start: start,
    begin: begin
  };
});
