/* ═══════════════════════════════════════════════════════════════════
   ⑪ App —— 外壳：主循环、事件绑定、界面
   ═══════════════════════════════════════════════════════════════════
   职责：把核心逻辑（core/）和绘制（render/）串起来，接上界面。

   ⚠️ 这个文件必须外置，不能写成内联 <script>
      平台的 CSP 策略里 script-src 不含 unsafe-inline，
      内联脚本和 onclick="..." 行内事件都会被拦掉。
      所以事件一律用 addEventListener 绑定。

   本文件是唯一允许碰 DOM 的地方（见 CLAUDE.md 第三节）。
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ═════════════════════════════════════════════════════════════════
     ★ Flex 的 `gap` 探测（2026-09-17 加）

     平台基线是 **Android 8.1 出场 WebView / Chrome 61**
     （官方 css-compatibility.md），而 **flex 的 `gap` 要 Chrome 84+**。
     不支持时给 <html> 挂个 `no-flexgap`，style.css **末尾那一节**接手，
     用子项外边距把间距顶出来；支持的浏览器完全不受影响。

     ⚠️⚠️ 为什么必须**实测布局**、不能查语法：
        `gap` 最早是 **grid** 的属性（Chrome 57+），Chrome 61 **认得这个语法**，
        只是不把它用在 flex 上 —— `CSS.supports('gap', '10px')` 会返回 **true**，
        那样兜底永远不会生效。官方规范也专门点了这个坑，
        要求「用 JS 实际测量 Flex 布局后切换 class」，不要查语法。
        （本项目在 `<script>` / `onclick=` 上栽过"看着像其实不是"的误报，
          这里是同一个道理：**别问语法，去量真东西**。）

     做法：摆两个各 10px 的子项，量它们之间的**实际距离** ——
       支持 → 10px，不支持 → 0px。判在 5px，两头都留足余量。
     ═════════════════════════════════════════════════════════════════ */
  function flexGapOk() {
    var box = document.createElement('div');
    box.style.cssText = 'display:flex;gap:10px;position:absolute;left:-9999px;top:0';
    var a = document.createElement('i'), b = document.createElement('i');
    a.style.cssText = b.style.cssText = 'width:10px;height:1px;flex:0 0 auto';
    box.appendChild(a);
    box.appendChild(b);
    document.body.appendChild(box);
    var gap = b.getBoundingClientRect().left - a.getBoundingClientRect().right;
    document.body.removeChild(box);
    return gap > 5;
  }

  /* ⚠️ 挂在 `<html>` 上而不是 `<body>`：这一节管的是全局样式，
     而且 `html` 上目前没有别的 class，不会被覆盖掉。 */
  if (!flexGapOk()) document.documentElement.className += ' no-flexgap';

  /* ─────────────────────────────────────────────────────────────
     DOM 引用
     ───────────────────────────────────────────────────────────── */
  var canvas    = document.getElementById('world');
  var ctx       = canvas.getContext('2d');
  var stage     = document.getElementById('stage');
  var elName    = document.getElementById('info-name');    // 世界名（玩家自己起的）
  var elSeed    = document.getElementById('info-seed');
  var elTraits  = document.getElementById('info-traits');
  var elToast   = document.getElementById('toast');
  /* 中间那条观察日志（文明前的旁白）★ 2026-09-21。
     ⚠️ 它和 `elToast` 是**两个不同的位置**，别混：
         文明前 → elLog（中间漂浮）
         文明阶段及以后 → elToast（顶栏，原样没动）
        分流在下面的 showToast 里。 */
  var elLog     = document.getElementById('log');
  var elObsDot  = document.getElementById('obs-dot');
  var elObsCode = document.getElementById('obs-code');
  var elStages  = document.getElementById('stages');

  var btnCreate = document.getElementById('btn-create');  // 【换一个星球】—— 只在设置模式显示
  var btnEvolve = document.getElementById('btn-evolve');
  var btnReset  = document.getElementById('btn-reset');

  // 四根本源读数条，每根配一个显示数值的小格子
  // ⚠️ 叫 bar 不叫 slider —— 它们是**读数**，不是旋钮（见 index.html 那段注释）
  var essenceBars = {
    energy: { bar: document.getElementById('bar-energy'), val: document.getElementById('val-energy') },
    water:  { bar: document.getElementById('bar-water'),  val: document.getElementById('val-water')  },
    atmo:   { bar: document.getElementById('bar-atmo'),   val: document.getElementById('val-atmo')   },
    land:   { bar: document.getElementById('bar-land'),   val: document.getElementById('val-land')   }
  };

  var elReadout = document.getElementById('readout');
  var elSpeeds  = document.getElementById('speeds');
  var elPalette = document.getElementById('palette');
  var elPalHint = document.getElementById('palette-hint');

  // 结局面板（在 .app 外面，见 index.html）
  var elEnding    = document.getElementById('ending');
  var elEndRating = document.getElementById('end-rating');
  var elEndRatingLine = document.getElementById('end-rating-line');
  var elEndBranch = document.getElementById('end-branch');
  var elEndFateLine   = document.getElementById('end-fate-line');
  var elEndCivBox = document.getElementById('end-civbox');
  var elEndCivName= document.getElementById('end-civname');
  var elEndCivRows= document.getElementById('end-civrows');
  var elEndStats  = document.getElementById('end-stats');
  var elEndCycles = document.getElementById('end-cycles');
  var elEndFoot   = document.getElementById('end-foot');
  var elEndBio    = document.getElementById('end-bio');
  var btnEndArchive = document.getElementById('btn-ending-archive');
  var btnEndClose = document.getElementById('btn-ending-close');

  // 档案库（入口在底部按钮排，浮层在 .app 外面）
  var btnArchive   = document.getElementById('btn-archive');
  var elArchive    = document.getElementById('archive');
  var elArchCount  = document.getElementById('archive-count');
  var elArchList   = document.getElementById('archive-list');
  var btnArchClear = document.getElementById('btn-archive-clear');
  var btnArchClose = document.getElementById('btn-archive-close');

  // 记录页（在 .app 外面，压在档案库上面 —— 见 index.html 那段）
  var elRecord      = document.getElementById('record');
  var elRecordPlanet= document.getElementById('record-planet');
  var elRecordBody  = document.getElementById('record-body');
  var btnRecordBack = document.getElementById('btn-record-back');
  var btnRecordHome = document.getElementById('btn-record-home');

  // 文明诞生面板（同样在 .app 外面）
  var elCivBirth  = document.getElementById('civbirth');
  var elCivName   = document.getElementById('civ-name');    // ★ 是个 <input>，玩家能改
  var elCivEgg    = document.getElementById('civ-egg');     // ⚡ 观测异常的记号
  var elCivRows   = document.getElementById('civ-rows');
  var btnCivGo    = document.getElementById('btn-civ-go');
  var btnCivRoll  = document.getElementById('civ-reroll');  // 【换一个】

  // 编年史（在 .app 里面，不是浮层 —— 见 index.html 的说明）
  var elChronicle = document.getElementById('chronicle');
  var elChronName = document.getElementById('chron-name');
  var elChronEra  = document.getElementById('chron-era');
  var elChronBody = document.getElementById('chron-body');

  // 命名弹窗（同样在 .app 外面，见 index.html）
  var elNaming   = document.getElementById('naming');
  var elNameIn   = document.getElementById('naming-input');
  var btnNameGo  = document.getElementById('naming-go');
  var btnNameRoll= document.getElementById('naming-reroll');
  var btnNameBack= document.getElementById('naming-back');

  // 观测指南（★ 2026-09-21，接在命名弹窗后面 —— 见 index.html 那一段）
  var elGuide      = document.getElementById('guide');
  var elGuideLead  = document.getElementById('guide-lead');
  var elGuideLines = document.getElementById('guide-lines');
  var btnGuideGo   = document.getElementById('guide-go');
  var btnGuideSkip = document.getElementById('guide-skip');

  // 演化路线选择弹窗（同上，在 .app 外面）
  var elChoice    = document.getElementById('choice');
  var elChTitle   = document.getElementById('choice-title');
  var elChQuestion= document.getElementById('choice-question');
  var elChOptions = document.getElementById('choice-options');
  // 结果视图（和 elChOptions 互斥，答完才显示）
  var elChResult  = document.getElementById('choice-result');
  var elChResGain = document.getElementById('choice-res-gain');
  var elChResCost = document.getElementById('choice-res-cost');
  var elChWhy     = document.getElementById('choice-why');
  var btnChGo     = document.getElementById('btn-choice-go');

  var stageSegs   = [];   // 阶段指示条的六个小格子（在 buildStageBar 里生成）
  var readoutVals = {};   // 观察模式里四个数值的 DOM 引用
  /* ★ 2026-09-15：四属性（军事 / 科技 / 生产 / 文化）的 DOM 引用。
     ⚠️ 和 `readoutVals` **分开存**，虽然它们住在同一个 `.readout` 里 ——
        两批数没有任何重叠，混在一个表里迟早会有人拿本源那套
        去遍历属性（或者反过来），而**遍历到不存在的 key 是静默的**。 */
  var attrVals    = {};
  var speedBtns   = [];   // 倍速按键

  /* ★★ 玩家选的倍速（2026-09-23 加）★★

     ⚠️⚠️ 它必须存在这里，不能只存在 `world.timeScale` 上 ⚠️⚠️

     倍速是**玩家的意图**，不是"这一颗世界的设置"。
     而【换一个星球】会**整个换掉 world**（`createWorld` 里 `world = candidate`），
     新世界带着 `timeScale: 1` 出厂 —— 于是：
       按键上还亮着 3×，世界却按 1× 跑。
     用户报的正是这个：「重置下一局还是三倍速这个按键上，
     但是这个时候并没有用三倍速运行，除非再点一个别的速度再点回来」。

     ⚠️ 这类"UI 和状态各说各话"的 bug 是**静默**的 —— 不报错、不崩溃，
        只是玩家觉得"按钮坏了"。修法就是让两者读**同一个来源**：
        `setSpeed` 写它、`createWorld` 读它。 */
  var curSpeed    = 1;

  var elBtns      = [];   // 元素栏的八个按钮

  /* 编年史已经渲染到第几行、第几纪、名字是谁。
     ⚠️ 和 sync* 那批一样是"值没变就不碰 DOM"的缓存 ——
        但这里更要紧：整块重画会让滚动条每帧跳回顶部，
        玩家正读到一半的历史会被打断。所以只**追加**新的行。 */
  var chronShown = 0;
  var chronEraShown = 0;
  var chronNameShown = null;

  var selectedEl = null;  // 当前选中的元素 key（null = 还没选）
  var worldR = 0;         // 世界当前画多大（像素）—— 点世界时要用它换算坐标

  // 观察模式可选的倍速。做成按键而不是滑杆 ——
  // 观察的时候只想"快一点/慢一点"，不需要精确到 0.1 倍。
  var SPEEDS = [0.5, 1, 2, 3];

  /* ─────────────────────────────────────────────────────────────
     状态
     ───────────────────────────────────────────────────────────── */
  var W = 0, H = 0;          // 画布的 CSS 像素尺寸（= 整个视口）
  var DPR = 1;               // 设备像素比

  // 世界画在哪、能画多大 —— 由 .stage 那块区域决定，不是画布正中
  var worldCx = 0, worldCy = 0, worldMaxR = 0;
  var stageW = 0, stageH = 0;

  var world = null;          // 当前世界档案
  var stars = [];            // 星点
  var time = 0;              // 累计世界时间（秒）
  var lastTs = 0;            // 上一帧的时间戳
  var frameErrored = false;  // 主循环出过错没有（只报一次，见 `frame()`）

  var STAR_SEED = 20260911;  // 星空的种子，固定即可（和世界无关）

  // 世界本体最多占画布短边的比例。
  // 为什么不占满？因为光环会伸到 1.65 倍半径、卫星轨道最远到 2.05 倍，
  // 留出余量它们才不会被画布边缘切掉。
  var WORLD_FIT = 0.44;

  /* 世界在 `.stage` 里的**竖直位置**（0.5 = 正中）★ 2026-09-21
     ⚠️ 文明**之前**往上提一点。理由：中间那条观察日志就贴在 `.stage` 的下沿，
        而世界最大能长到占满 94% 的高度（= `0.5 + WORLD_FIT`）——
        两者会擦上（实测拍出来字贴着星球下缘）。
        提到 0.43 之后，加上日志自己占的那约 6.8u，留出 25px 左右的余量。
     ⚠️⚠️ **文明阶段不提**（仍旧正中 0.5）：那一段有它自己定下来的版面，
        用户明确说过不准动。
     ⚠️ 分档靠 `civUIOn`。它切的时候 `.stage` 会跟着变尺寸，
        而 `ResizeObserver` 正盯着 `.stage`（见文件末尾），所以布局会自己重算 ——
        **不用**在 `setCivUI` 里手动调一次。 */
  var WORLD_Y_WATCH = 0.43;

  /* ─────────────────────────────────────────────────────────────
     画布尺寸
     ───────────────────────────────────────────────────────────── */

  /**
   * 按画布容器的实际大小调整画布。
   *
   * 为什么要乘 DPR？手机是"高清屏"，一个 CSS 像素由 2~3 个物理像素拼成。
   * 不处理的话画面会糊。做法是把画布的真实分辨率放大 DPR 倍，
   * 再把绘图坐标系缩回来，这样写代码时还能按 CSS 像素思考。
   */
  function resize() {
    // ── ① 画布尺寸 = 整个视口 ──
    // 画布是 position:fixed 铺满全屏的，这样星空会一直铺到
    // 标题栏、信息栏、按钮区的底下。如果只铺中间一块，
    // 整个界面看起来就像"相框里的一张图"。
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;

    // 首次布局还没完成时可能是 0，直接跳过，等下一次回调
    if (!vw || !vh) return;

    DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    W = vw;
    H = vh;

    canvas.width  = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);   // 缩放绘图坐标系

    stars = Renderer.makeStars(RNG.makeRng(STAR_SEED), W, H);

    // ── ② 世界画在哪 ──
    // 画布是整屏的，但世界**不能**画在屏幕正中 ——
    // 那样会被上面的标题或下面的信息栏压住。
    // 正确做法是画在"中间那块留白"（.stage）里。
    //
    // ⚠️ ★ 2026-09-21：**不是正中了** —— 文明之前往上提一档（`WORLD_Y_WATCH`），
    //    给下沿那条观察日志让出地方。文明阶段仍旧正中。见那个常量的注释。
    var r = stage.getBoundingClientRect();

    stageW = r.width;
    stageH = r.height;

    worldCx = r.left + r.width / 2;
    worldCy = r.top + r.height * (civUIOn ? 0.5 : WORLD_Y_WATCH);

    // 世界本体最多占这块区域短边的 44%。
    // 为什么不占满？因为光环会伸到 1.65 倍半径、卫星轨道最远到 2.05 倍，
    // 留出余量它们才不会被裁掉。
    worldMaxR = Math.min(r.width, r.height) * WORLD_FIT;
  }

  /* ─────────────────────────────────────────────────────────────
     换一个星球
     ───────────────────────────────────────────────────────────── */

  /* ── 「不撞脸」保险 ──
     为什么需要：种子的空间有 8.87 亿，但世界的"脸"
     （色板 + 纹理 + 大小 + 光环 + 卫星 + 属性）原本只有两千来种 ——
     实测开到第 50 个世界就有 44% 的概率觉得"这颗我见过"。
     本源现在已经连续影响外观，"脸"多了很多，但再加一层保险更稳。

     ⚠️ 这个判断必须放在**外壳**里，不能塞进 worldgen。
        因为 makeWorld(seed) 必须是纯函数 ——
        同一个种子永远要产出同一个世界。
        一旦把"查历史"塞进去，同一个种子在不同时间就会产出不同世界，
        **种子分享就废了**（别人拿到你的种子，复现不出你那个世界）。
        这里重掷的是「选哪个种子」，不是「种子产出什么」，所以不冲突。
  */
  var recentFaces = [];
  var FACE_MEMORY = 100;   // 记住最近开过的多少个世界
  var FACE_RETRY  = 30;    // 最多重掷几次（防止极端情况下死循环）

  /**
   * 取一个世界的「脸」—— 一眼能分辨的那几个特征。
   * 末尾三项是本源带来的连续差异，量化后也算进指纹，
   * 这样"色相差了 20°"会被当成另一张脸。
   */
  function faceOf(w) {
    return [
      w.look.palette,
      w.look.texture,
      w.look.size,
      w.look.hasRing ? 'R' : '-',
      w.look.moons.length,
      w.traits.join('+'),
      Math.round((w.look.hueShift || 0) / 6),      // 色相偏移，每 6° 一档
      Math.round((w.look.bright || 1) * 12),       // 亮度，每 ~0.083 一档
      Math.round((w.look.haze || 0) * 20)          // 雾感
    ].join('|');
  }

  function createWorld() {
    var seedNum, candidate, face;
    var tries = 0;

    // 一直重掷，直到抽到一个最近没出现过的"脸"
    do {
      seedNum   = RNG.freshSeedNum();
      candidate = WorldGen.makeWorld(seedNum);
      face      = faceOf(candidate);
      tries++;
    } while (recentFaces.indexOf(face) >= 0 && tries < FACE_RETRY);

    recentFaces.push(face);
    if (recentFaces.length > FACE_MEMORY) recentFaces.shift();   // 只记最近 100 个

    world = candidate;
    world.name = null;                         // 新世界 —— 名字要重新起（点演化时会问）
    /* ★ 2026-09-23：**把玩家选的倍速带过来**。
       ⚠️⚠️ 少了这一行就是个静默的 bug：新世界按出厂值 1× 跑，
          而倍速按键还亮在玩家上次选的那一档上 —— 见 `curSpeed` 那段。
       ⚠️ 按键不用在这里刷：它本来就亮着玩家选的那一档，现在世界跟上了。 */
    world.timeScale = curSpeed;
    time = 0;
    world.evo.progress = 0;                    // 混沌迷雾从最浓开始
    refreshInfo();
  }

  /** 把世界档案里的信息写进页面上的信息栏 */
  function refreshInfo() {
    if (!world) return;

    // 世界名（还没起名时是空的，但那行高度由 CSS 占着，版式不会跳）
    elName.textContent = world.name || '';

    elSeed.textContent = '种子 ' + world.seed;

    if (world.traits.length) {
      var names = { binary: '双星系统', gravity: '高重力', toxic: '剧毒大气', moon: '有卫星' };
      var label = world.traits.map(function (t) { return names[t] || t; }).join(' · ');
      elTraits.textContent = '【' + label + '】';
    } else {
      elTraits.textContent = '';               // 没有属性就留空（占位高度由 CSS 保证）
    }

    // 换了新世界，本源读数条、只读数值、阶段条都得跟着重来
    for (var k in essenceBars) essenceBars[k]._shown = null;   // 清掉缓存，强制刷新
    for (var r in readoutVals) readoutVals[r]._shown = null;
    for (var av in attrVals) attrVals[av]._shown = null;   // ★ 四属性同理
    shownStage = -1;
    lightShown = null;         // 光暗值也强制重刷
    obsShown = null;           // 观测编号：新世界要换号
    obsOnShown = null;         // 状态点也重刷
    chronShown = 0;            // 编年史从零开始写
    chronEraShown = 0;
    chronNameShown = null;

    /* ⚠️⚠️ 必须**连 DOM 一起清**，不能只清计数 ⚠️⚠️

       踩过的坑（2026-09-12，用户报的）：这里原来只把 chronShown 归零，
       指望 syncChronicle 里那个"收起来时清空"的分支去清 DOM。
       但那个分支的条件是 `chronShown !== 0 || chronNameShown !== null` ——
       而这里刚把它们清干净了，条件**恰好不成立**，于是 DOM 永远留着。

       症状：玩到第二局，文明阶段的编年史面板里挂着上一局的历史，
       新的行追加在它下面。两局的编年史混在同一个面板里。

       教训：**缓存和它对应的 DOM 必须一起重置。** 分开处理迟早对不上。 */
    elChronBody.innerHTML = '';
    syncEssenceUI();
    syncReadout();
    syncStageBar();
    syncObsBar();
    syncButtons();
  }

  /* ─────────────────────────────────────────────────────────────
     顶栏：观测编号 + 状态点（2026-09-15）
     ─────────────────────────────────────────────────────────────
     ⚠️ 编号**从种子推**（OBS-XXXX）—— 同一颗世界永远是同一个号，
        和「同种子 = 同世界」是同一条原则。用随机数的话，
        同一颗世界重开一次编号就变了，那这个号就没有意义了。

     ⚠️ 状态点跟着 `world.running` —— **和暂停按钮同一个源**。
        不另立判据：两个开关管同一件事，迟早不同步
        （这条在 `civUIOn` 上踩过一次，见 CLAUDE.md 第九节）。 */
  var obsShown = null, obsOnShown = null;

  function syncObsBar() {
    if (!world) return;

    if (obsShown !== world.seedNum) {
      obsShown = world.seedNum;
      /* 用种子的低 16 位拼一个四位十六进制号 ——
         和 world.seed 那串字符一样，只是换个更好念的写法 */
      var n = (world.seedNum >>> 0) & 0xFFFF;
      elObsCode.textContent = 'OBS-' + ('0000' + n.toString(16).toUpperCase()).slice(-4);
    }

    var on = !!world.running;
    if (obsOnShown !== on) {
      obsOnShown = on;
      elObsDot.className = on ? 'obs-dot on' : 'obs-dot';
    }
  }

  /* ─────────────────────────────────────────────────────────────
     界面同步
     ───────────────────────────────────────────────────────────── */

  var shownStage = -1;      // 阶段条当前显示到第几格（用来避免每帧重画 DOM）
  var lastStuckText = null; // 上一次"卡住"的提示语（用来避免每帧弹同一条）
  var lightVal = null;      // 光暗值那个 DOM 引用（在 buildReadout 里建）
  var lightShown = null;    // 上一次显示的光暗值

  /** 生成阶段指示条的六个小格子。只需在启动时做一次。 */
  function buildStageBar() {
    elStages.innerHTML = '';
    stageSegs = [];
    for (var i = 0; i < Evolution.STAGES.length; i++) {
      var d = document.createElement('div');
      d.className = 'stage-seg';
      d.textContent = Evolution.STAGES[i].name;
      elStages.appendChild(d);
      stageSegs.push(d);
    }
  }

  /**
   * 生成观察模式的只读数值。
   *
   * **两批数住在同一个 `.readout` 里，靠 CSS 按阶段切换：**
   *
   *   `.pre-civ`  四个本源 + 光暗 —— **文明之前**看的就是这些
   *   `.civ-only` ★ 四个属性    —— **走到文明之后**顶替上去
   *
   * ⚠️ 两批都常驻在 DOM 里，只是 `display` 不同（`body.civ-on` 那条规则）。
   *    不留着的话，每进一次文明都要重建一遍，而 `readoutVals` / `attrVals`
   *    里那些引用会跟着失效 —— 那是"看着还在、其实早就不更新了"的经典坑。
   *
   * 为什么不直接抄一遍 HTML？因为四个本源的 key 和中文名
   * 都在 WorldGen 里定义好了，从这里生成可以保证两边永远一致 ——
   * 将来加第五个本源时只改 WorldGen 一处。
   * 四属性的名字同理，走 `Civ.ATTR_NAMES`（和结局、和 `OPTION_ATTR` 同一份）。
   */
  function buildReadout() {
    elReadout.innerHTML = '';
    readoutVals = {};
    attrVals = {};
    for (var i = 0; i < WorldGen.ESSENCE_KEYS.length; i++) {
      var k = WorldGen.ESSENCE_KEYS[i];

      var item = document.createElement('div');
      item.className = 'readout-item pre-civ';

      var label = document.createElement('span');
      label.className = 'readout-label';

      /* 用**全名**，不截断。
         ⚠️ 这里原来写的是 `.slice(0, 2)` —— 取前两个字。
            对「能量浓度 / 大气密度 / 大地之基」碰巧还行（能量 / 大气 / 大地），
            但「水之本源」截出来是「**水之**」，读着像没显示完
            （2026-09-12 用户报的就是这个）。

         为什么现在敢用全名：算过了 —— 读数栏每格宽 17.6u，
         四个汉字在 2.7u 的字号下只占 10.8u，放得下。
         （当年截断是怕撑不下，其实多虑了。）

         ⚠️ 别再加回截断。名字表在 WorldGen.ESSENCE_NAMES 里只有一份，
            上面那些本源读数用的也是同一份全名 —— 截断等于凭空造出第二套叫法。 */
      label.textContent = WorldGen.ESSENCE_NAMES[k];

      var value = document.createElement('span');
      value.className = 'readout-value';
      value.textContent = '--';

      item.appendChild(label);
      item.appendChild(value);
      elReadout.appendChild(item);

      readoutVals[k] = value;
    }

    // ── 再加一格：光暗值 ──
    // 它不属于四个本源，但**玩家必须看得到** ——
    // 不然没法维持平衡，也不知道自己什么时候会踩到冲突事件的线。
    var item2 = document.createElement('div');
    item2.className = 'readout-item pre-civ';
    var label2 = document.createElement('span');
    label2.className = 'readout-label';
    label2.textContent = '光暗';
    lightVal = document.createElement('span');
    lightVal.className = 'readout-value';
    lightVal.textContent = '0';
    item2.appendChild(label2);
    item2.appendChild(lightVal);
    elReadout.appendChild(item2);

    /* ═══════════════════════════════════════════════════════════════
       ★★ 四属性 —— 走到文明之后**顶替**上面那五格 ★★（2026-09-15）
       ═══════════════════════════════════════════════════════════════

       用户拍板的：「可以取代已经无法变化的能量、大气那四个属性」，
       做法选的是**甲**（只在这一个阶段顶替）。

       ── 为什么文明阶段才出现 ──
       文明之前**这四个数根本还不存在**（`Civ.roll` 在进文明那一刻才写），
       顶上去只会是四个 0。而设置模式里玩家还得靠本源读数一眼看出
       "这颗世界什么命" —— 那个不能动。

       ── 为什么不用 `Civ.ATTR_KEYS` 的字面顺序，而是显式列一个数组 ──
       `ATTR_KEYS` 是**存数据**的顺序（也是结局读的顺序），
       这里要的是**画在屏幕上**的顺序。两个顺序现在一样，但它们是两件事 ——
       哪天结局想换个优先级，不该顺手把界面上的排列也改了。
       ⚠️ 数组里的 key 必须都在 `ATTR_KEYS` 里（测试有一条守着）。 */
    var CIV_ROW = ['mil', 'sci', 'prod', 'cul'];
    for (var j = 0; j < CIV_ROW.length; j++) {
      var ak = CIV_ROW[j];

      var aitem = document.createElement('div');
      aitem.className = 'readout-item civ-only';

      var alabel = document.createElement('span');
      alabel.className = 'readout-label';
      alabel.textContent = Civ.ATTR_NAMES[ak];

      var avalue = document.createElement('span');
      avalue.className = 'readout-value';
      avalue.textContent = '0';

      aitem.appendChild(alabel);
      aitem.appendChild(avalue);
      elReadout.appendChild(aitem);

      attrVals[ak] = avalue;
    }
  }

  /** 生成倍速按键 */
  function buildSpeeds() {
    elSpeeds.innerHTML = '';
    speedBtns = [];
    SPEEDS.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'speed-btn';
      b.textContent = v + '×';
      b.addEventListener('click', function () { setSpeed(v); });
      elSpeeds.appendChild(b);
      speedBtns.push({ v: v, el: b });
    });
  }

  /** 生成基础元素栏的八个按钮（内容来自 Elements.LIST，不手写） */
  function buildPalette() {
    elPalette.innerHTML = '';
    elBtns = [];

    Elements.LIST.forEach(function (def) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'el-btn';

      var dot = document.createElement('span');
      dot.className = 'el-dot';
      dot.style.background = def.color;

      var label = document.createElement('span');
      label.textContent = def.name;

      b.appendChild(dot);
      b.appendChild(label);
      b.addEventListener('click', function () {
        selectElement(selectedEl === def.key ? null : def.key);   // 再点一下取消选中
      });

      elPalette.appendChild(b);
      elBtns.push({ key: def.key, def: def, el: b });
    });
  }

  /**
   * 选中 / 取消选中一个元素。
   * 选中的按钮会亮成元素自己的颜色，下面的小字也跟着变成它的作用说明 ——
   * 不这样的话玩家不知道选中的是什么、能干什么。
   */
  function selectElement(key) {
    selectedEl = key;

    for (var i = 0; i < elBtns.length; i++) {
      var b = elBtns[i];
      var on = (b.key === key);
      b.el.style.borderColor = on ? b.def.color : '';
      b.el.style.color       = on ? b.def.color : '';
      b.el.style.background  = on ? Renderer.rgba(b.def.color, 0.14) : '';
    }

    var cur = key ? Elements.BY_KEY[key] : null;
    elPalHint.textContent = cur
      ? (cur.name + ' · ' + cur.desc)
      : '选一个元素，再点世界表面投放';

    /* ★ 2026-09-21：选了元素之后，这行说明**染成那个元素的颜色**。
       用户的原话：「点击元素，下面会有元素的功能介绍，这个字体也不太明显，
       玩家可能会忽略掉，所以把字体改成跟元素一样的颜色 就是点击哪个元素
       就显示哪个」。

       ⚠️ 为什么用内联样式、而不是在 CSS 里按类写 8 条：
          颜色只有一个来源 —— `core/elements.js` 每个元素定义里的 `color`
          字段。CSS 里再抄一份就成了**两把尺子**，改了元素色这边不会跟着变
          （这个项目在这件事上栽过）。
          `.el-btn` 选中时也是这么染的（看上面那个循环），两处一致。
       ⚠️ 传空串（不是某个默认色）→ 落回 style.css 里 `.palette-hint` 的
          `var(--text-dim)`。"没选元素"那行操作说明不该有颜色。 */
    elPalHint.style.color = cur ? cur.color : '';
  }

  /** 切换倍速 */
  function setSpeed(v) {
    /* ★ 2026-09-23：**先记住玩家的意图，再管世界**。
       ⚠️ 原来是 `if (!world) return;` 一句挡在最前面 ——
          那样在 world 还没建出来时点倍速会**连按键也不亮**，
          而且意图没地方存，换星球时就丢了（见 `curSpeed` 那段）。 */
    curSpeed = v;
    if (world) world.timeScale = v;
    for (var i = 0; i < speedBtns.length; i++) {
      speedBtns[i].el.className = 'speed-btn' +
        (speedBtns[i].v === v ? ' active' : '');
    }
  }

  /* ─────────────────────────────────────────────────────────────
     结局面板
     ─────────────────────────────────────────────────────────────
     世界走到「文明」时弹出，像一份结案报告。

     ⚠️ 报告内容是**算出来**的，不是写死的：
        评定看四个本源的综合分，分支看有没有触发寂灭/破碎/极端，
        传记按数值分档拼句子。
        全部逻辑在 core/ending.js，这里只负责把文字填进 DOM。
     */

  /**
   * 弹出结局卡。
   *
   * ⚠️⚠️ 2026-09-14 晚：这个函数原来带一个 `fromArchive` 参数
   *     （从档案库点开时，底部三颗只留【返回档案库】一颗）。
   *     做成「记录页」之后，**档案库那条路不再走这张卡**了 ——
   *     参数、那颗按钮、`.alone` 版式、以及"切 hidden"那几行一起删掉：
   *     没有第二条来路，就没有要切的东西了。
   *     （判据是 CLAUDE.md 决策 #61：删掉它，行为会不会变？不会。）
   *
   *     ⚠️ 但那条**底线**还在：这张卡片整屏盖住，点外面没反应、
   *        没有 Esc、刷新丢页面 —— **底部那两颗是全屏唯一的出口**。
   *        以后谁要给它们加 `hidden`，先想清楚玩家怎么出去。
   */
  function showEnding() {
    if (!world) return;

    var result = Ending.evaluate(world);
    world.ending = result;        // 存进世界档案 —— 将来做分享卡片要用

    elEndRating.textContent = result.rating.name;
    elEndRatingLine.textContent = result.ratingLine || '';

    elEndBranch.textContent = result.fate.name;
    elEndFateLine.textContent = (result.fate && result.fate.desc) || '';

    if (result.civ) {
      // 文明自己的名字当主角（比如「潮汐议会」）——
      // 1% 的彩蛋加个记号，让人一眼看出"这次不一样"
      elEndCivName.textContent =
        (result.civ.isEgg ? '⚡ ' : '') + result.civ.title;
      buildCivInline(elEndCivRows);
      elEndCivBox.hidden = false;
    } else {
      elEndCivName.textContent = '';
      elEndCivRows.innerHTML = '';
      elEndCivBox.hidden = true;       // 没走到文明就整块藏起来
    }

    /* ── 存续那一段：只有走到过文明的世界才有 ──
       ⚠️ 「存活周期」是"从第一处聚居点算起"的 ——
          没长出文明就没有这个数，硬填一个就是假话。
       ⚠️ 这里本来还有「最终压力」三格，2026-09-13 用户决定整个删掉，
          见 index.html 那段注释。 */
    if (result.civ) {
      elEndStats.hidden = false;
      elEndCycles.textContent = numToCn(CivLore.cyclesOf(world.evo.civ));
      elEndFoot.textContent = '编年史已归档。';
    } else {
      elEndStats.hidden = true;
      elEndFoot.textContent = '';
    }

    elEndBio.textContent = result.bio;

    /* 每弹一次结局卡，都把【存入档案库】复位 ——
       ⚠️ 不复位的话，上一局的「已存入 ✓」会留到这一局，
          玩家会以为这一局也存过了，结果没存。 */
    endArchived = false;
    btnEndArchive.textContent = '存入档案库';

    // 用 class 而不是 hidden —— display:none 的元素做不了淡入动画
    elEnding.className = 'ending show';

    /* ★★ 2026-09-22：结局一弹出来就提示"开始下一轮"，**一直挂到重置** ★★

       ⚠️ 触发点从【存入档案库】挪到这儿了。原来那句话只在"存了档"才出现 ——
          玩家点【继续观察】直接走人，屏幕上什么提示都没有。
          **该提示的是"这一局完了"，和存不存档没有关系。**

       ⚠️⚠️ 这条**必须走 `showToast` 的分流**，不能直接写顶栏 ⚠️⚠️
          顶栏在"观察模式 + 没到文明"时是**收起来**的（`height: 0`，
          见 style.css 那一段），而「未成形」「世界破碎」正是没走到文明的结局 ——
          硬写进去就是"字写进了看不见的地方"（本项目栽过）。
          `showToast` 会把这种局面转给中间那条日志（`showLog` 的 sticky）。

       ⚠️ 第三参 `true` = 常驻：不排定时器。收掉它的只有【重置】/【换一个星球】
          —— 那两个地方会 `clearToast()` + `clearLog()`。 */
    showToast('点击底部重置，开启下一轮游戏', null, true);
  }

  /** 阿拉伯数字 → 汉字
   *  ⚠️ 用 `CivLore.cnNum`，**不要自己再写一个** ——
   *     传记里的「共计二百六十八个周期」用的就是它。
   *     两套实现算出来的字不一样的话，同一张卡片上
   *     「存活周期」和传记末尾的「共计」就会**对不上**，
   *     而这正是「数字要真的算出来、全篇对得上」那条规矩要防的事。 */
  function numToCn(n) {
    return CivLore.cnNum(n);
  }

  function hideEnding() {
    elEnding.className = 'ending';
  }

  /* ─────────────────────────────────────────────────────────────
     文明的信息：名称 / 原型 / 特质 / 倾向
     ─────────────────────────────────────────────────────────────
     四个字段对应：
       名称  文明自己的名字（「潮汐议会」）—— 由 core/civ.js 生成
       原型  物种（兽类 / 虫类 / 石类…）
       特质  形态（大陆文明 / 海洋文明…）
       倾向  性格（和平 / 征战 / 求知…）

     两个渲染函数是因为两个地方版式不同：
       诞生面板 —— 竖排大字，每项还带一句描述
       结局面板 —— 横排小字，只留"标签 值"
     ⚠️ 两边读的是同一份数据，改字段只改一处。
     */

  /** 取出文明三层的定义（可能为空）*/
  /**
   * 读一份世界档案的 原型 / 特质 / 倾向 三层。
   *
   * ⚠️ 收一个**参数**，不再直接读模块级的 `world` ——
   *    记录页要读的是**存档里的那一份**，不是玩家当前正在玩的那个世界。
   *    （只读 `world` 的话，记录页就得先把存档装回 `world` 才能用，
   *      而那正是这次要甩掉的行为。）
   */
  function civPartsOf(w) {
    var c = w && w.civ;
    if (!c || !c.proto) return null;
    return {
      proto:  Civ.byKey(c.proto),
      form:   c.form   ? Civ.formOf(c.form)     : null,
      temper: c.temper ? Civ.temperOf(c.temper) : null
    };
  }

  /** 玩家**当前这个世界**的那三层 —— 调用点最多，包一层省事 */
  function civParts() {
    return civPartsOf(world);
  }

  /** 竖排版：给「文明诞生」面板用，每项带一句描述 */
  function buildCivRows(container) {
    container.innerHTML = '';
    var p = civParts();
    if (!p) return;

    [
      [Civ.ROW_LABELS.proto,  p.proto  ? p.proto.name  : null, p.proto  ? p.proto.desc  : ''],
      [Civ.ROW_LABELS.form,   p.form   ? p.form.name   : null, p.form   ? p.form.desc   : ''],
      [Civ.ROW_LABELS.temper, p.temper ? p.temper.name : null, p.temper ? p.temper.desc : '']
    ].forEach(function (row) {
      if (!row[1]) return;

      var d = document.createElement('div');
      d.className = 'civ-row';

      var k = document.createElement('span');
      k.className = 'civ-row-key';
      k.textContent = row[0];

      var v = document.createElement('span');
      v.className = 'civ-row-val';
      v.textContent = row[1];

      d.appendChild(k);
      d.appendChild(v);

      if (row[2]) {
        var s = document.createElement('span');
        s.className = 'civ-row-desc';
        s.textContent = row[2];
        d.appendChild(s);
      }
      container.appendChild(d);
    });
  }

  /** 横排版：给结局面板用，只留「标签 值」 */
  function buildCivInline(container) {
    container.innerHTML = '';
    var p = civParts();
    if (!p) return;

    [
      [Civ.ROW_LABELS.proto,  p.proto  ? p.proto.name  : null],
      [Civ.ROW_LABELS.form,   p.form   ? p.form.name   : null],
      [Civ.ROW_LABELS.temper, p.temper ? p.temper.name : null]
    ].forEach(function (row) {
      if (!row[1]) return;
      var s = document.createElement('span');
      s.appendChild(document.createTextNode(row[0] + ' '));
      var b = document.createElement('b');
      b.textContent = row[1];
      s.appendChild(b);
      container.appendChild(s);
    });
  }

  /* ─────────────────────────────────────────────────────────────
     文明诞生面板
     ─────────────────────────────────────────────────────────────
     世界刚走到「文明」时弹出，展示长出来的是什么文明。
     关掉之后世界才开始走文明发展期。

     ⚠️ 面板开着的时候世界是冻着的（闸门在 core/evolution.js 的 stepCiv 里），
        所以不点【继续】它就一直在那儿等着 —— 这正是想要的：
        玩家为这一刻等了一分多钟，不该被一秒的弹窗糊弄过去。
     */

  /* ─────────────────────────────────────────────────────────────
     文明命名（★ 2026-09-13 加的）
     ─────────────────────────────────────────────────────────────
     用户的要求：「在走到文明阶段时，让玩家自己给文明起名字」。

     做法是**不新开一屏**，直接让诞生面板上那个大字变成输入框 ——
     因为面板开着的时候世界本来就是冻着的（闸门在 core/evolution.js 的
     stepCiv 里，看到 phase === 0 就返回 null），所以起名不用改 core 一行。

     和世界名的关系（两边规矩一样）：
       · 名字**不参与任何生成逻辑**，只是贴在卡片上的标签
       · 不碰就不改：输入框预填推荐名，直接点【继续观察】= 和以前完全一样
       · 「同种子 = 同文明」不受影响

     和世界名不一样的地方（两条，都是有意的）：
       · 世界名**不自动重问**（重置 = 这颗世界重跑一遍）；
         文明名**每次重跑都会重问** —— 因为 Evolution.reset 里
         `delete world.civ`，文明本身要重新掷，名字跟着一起清掉了。
         换了物种还留着上个文明的名字，那是错的。
       · 这一屏**不自动聚焦**（理由见 index.html 那段注释）
     */

  var CIV_NAME_MAX = 8;    // ⚠️ 必须和 index.html 的 maxlength="8" 一致

  var civNameRoll = 0;     // 点了几次【换一个】

  /** 弹出诞生面板，输入框里预填文明名 */
  function showCivBirth() {
    if (!world || !world.civ) return;

    var c = world.civ;

    // 每开一次都从"第一次推荐"开始 —— 不这么写的话，
    // 上一局点过【换一个】，这一局一进来就是个换过的名字。
    civNameRoll = 0;

    /* ⚠️ 走 displayName，不是 civName ——
       面板有可能在玩家已经起过名之后重新打开（比如世界重跑），
       那时候要显示玩家自己起的那个。 */
    elCivName.value = Civ.displayName(world);

    // ⚡ 记号单独一行，不放进输入框（放进去会跟着世界档案存下来）
    elCivEgg.hidden = !c.isEgg;

    buildCivRows(elCivRows);

    elCivBirth.className = 'civbirth show';
  }

  function hideCivBirth() {
    elCivBirth.className = 'civbirth';
    elCivName.blur();     // 收起手机的软键盘
  }

  /** 【继续观察】—— 把名字记下来，关掉面板，世界开始走发展期 */
  function startCivDevelop() {
    if (!world || !world.civ) return;

    /* 起名就定在这一刻（和世界名在【开始演化】那一刻定下来是同一条规矩）。
       ⚠️ 空名要兜住 —— 玩家可能把输入框清空了。
          退回落**当前推荐值**（不是第 0 个），玩家看着框里是哪个就用哪个。
       ⚠️ 再切一次 CIV_NAME_MAX 是保险：maxlength 只管键盘输入，
          粘贴 / 输入法联想 / 以后改了 HTML 都可能绕过去。 */
    var v = (elCivName.value || '').trim();
    world.civ.title = (v || Civ.civName(world, civNameRoll)).slice(0, CIV_NAME_MAX);

    hideCivBirth();
    Evolution.civBegin(world);   // phase 0 → 1，时间开始走
  }

  /** 【换一个】—— 换一批推荐名（不影响已经定下来的名字） */
  function rerollCivName() {
    if (!world || !world.civ) return;
    civNameRoll++;
    elCivName.value = Civ.civName(world, civNameRoll);
  }

  /* ─────────────────────────────────────────────────────────────
     命名弹窗
     ─────────────────────────────────────────────────────────────
     第一次点【演化】时弹出，让玩家给这颗世界起名字。

     为什么放这一步：世界是自己开出来的，给它起个名字之后，
     它就不再是"一颗星球"，而是"我那一界"。

     ⚠️ 名字**不参与任何生成逻辑** —— 它只是贴在信息栏上的一个标签。
        所以它不影响「同种子 = 同世界」这条铁律：
        别人拿到你的种子，复现出的世界一模一样（只是名字不同）。
     */

  var NAME_MAX = 8;   // 和 index.html 的 maxlength="8" 必须一致

  // 推荐名 = 首字 × 尾字，各抽一个拼起来。
  // 全部取自然意象词（烬、潮、穹、渊…）—— 和「自然史观察日志」的调性一致，
  // 不出现修仙味道的字（具体禁用词见 CLAUDE.md 第十二节）。
  var NAME_HEAD = ['苍', '赤', '墨', '幽', '寒', '暖', '静', '流', '碎', '晨',
                   '暮', '深', '孤', '微', '长', '空', '潮', '星', '尘', '霜',
                   '焰', '雾'];
  var NAME_TAIL = ['烬', '海', '洲', '穹', '壤', '汐', '岩', '尘', '野', '渊',
                   '光', '影', '歌', '界', '屿', '谷', '庭', '源', '岸', '原'];

  var nameRoll = 0;   // 点了几次【换一个】—— 每点一次换一批随机数

  /**
   * 按种子推荐一个名字。
   *
   * ⚠️ 用 world.seedNum 派生随机数，**不用 Math.random()** ——
   *    这样同一个种子推荐的名字永远一样，和"同种子 = 同世界"保持一致。
   *    （全项目只有 RNG.freshSeedNum() 里允许用 Math.random()）
   *
   * @param {number} seedNum 世界的种子数字
   * @param {number} roll    第几次换（0 = 第一次弹窗时给的）
   */
  function suggestName(seedNum, roll) {
    // 每换一次就往后挪一段，抽出来的名字才会变
    var r = RNG.makeRng((seedNum + roll * 7919) >>> 0);
    return NAME_HEAD[Math.floor(r() * NAME_HEAD.length)] +
           NAME_TAIL[Math.floor(r() * NAME_TAIL.length)];
  }

  /* ⚠️ 2026-09-17：`worldName()` **删掉了** —— 全项目零调用（含测试）。
     想要"当前世界的名字"就直读 `world.name`（界面各处的写法）。 */

  /** 弹出命名窗口，输入框里预填一个推荐名 */
  function showNaming() {
    nameRoll = 0;
    elNameIn.value = suggestName(world.seedNum, 0);
    elNaming.className = 'naming show';

    // 自动聚焦 + 全选：想重起就直接打字（会覆盖掉推荐名），
    // 不想改就直接点【开始演化】。
    // ⚠️ 不包 setTimeout —— 这里还在点击事件的处理过程里，
    //    包了会脱离"用户手势"，手机上可能就不弹软键盘了。
    elNameIn.focus();
    elNameIn.select();
  }

  /** 关掉命名窗口 */
  function hideNaming() {
    elNaming.className = 'naming';
    elNameIn.blur();     // 收起手机的软键盘
  }

  /* ─────────────────────────────────────────────────────────────
     观测指南  ★ 2026-09-21
     ─────────────────────────────────────────────────────────────
     接在命名弹窗后面：给世界起完名 → 弹出这个 → 点【确认接入】才开跑。

     ⚠️⚠️ 它**替掉**了原来那条开场提示（`Evolution.INTRO_HINT`）⚠️⚠️
        那条是"开跑之后在观察日志里飘一句"，淡入 .6 + 停留 3.2 秒。
        用户否掉的理由：低头看一眼星球就错过了，而这几句是**规则**。

     ⚠️ 正文住在 `core/evolution.js` 的 `GUIDE` 里（不是 index.html）——
        写在 HTML 里就是**文风盲区**，`_style_test.js` 收不到，
        改成一句口语不会有任何测试红。这个坑本项目踩过四次。
        序号 `1. 2. 3.` 同理，由 style.css 用 CSS 计数器画。 */

  var GUIDE_SKIP_KEY = 'msj.guide.v1';

  /** 玩家点过【略过指南，不再提示】没有。
   *  ⚠️ 读不到（隐私模式 / 存坏了 / 配额满）一律当**没点过** ——
   *     宁可多弹一次，也不要因为读不出来就把指南永久吞掉。 */
  function guideSkipped() {
    var st = storage();
    if (!st) return false;
    try { return st.getItem(GUIDE_SKIP_KEY) === '1'; } catch (e) { return false; }
  }

  /** 永久记住"不再提示"。
   *  ⚠️ 写不进去也**不算失败** —— 这一次照样关掉指南（见 closeGuide），
   *     只是下次开页面还会再弹一遍。平台规范写着"数据不保证永久持久化"，
   *     所以不许把"记住"当成一定能成的事。 */
  function guideSkipForever() {
    var st = storage();
    if (!st) return;
    try { st.setItem(GUIDE_SKIP_KEY, '1'); } catch (e) {}
  }

  /** 把「你已经接入此界」和三行说明填进去。
   *  ⚠️ 填过一次就不再来 —— 内容是固定的，没必要每次弹都重建一遍 DOM。 */
  function fillGuide() {
    if (elGuideLines.childNodes.length) return;
    var i, d;
    elGuideLead.textContent = Evolution.GUIDE.lead;
    for (i = 0; i < Evolution.GUIDE.lines.length; i++) {
      d = document.createElement('div');
      d.className = 'guide-line';
      /* ⚠️ 这里**只放正文**，序号由 CSS 的 `.guide-line::before` 画 ——
         写进字符串的话会撞上"全篇不用阿拉伯数字"那条老规矩。 */
      d.textContent = Evolution.GUIDE.lines[i];
      elGuideLines.appendChild(d);
    }
  }

  function showGuide() {
    fillGuide();
    elGuide.className = 'guide show';
  }

  function hideGuide() {
    elGuide.className = 'guide';
  }

  /** 关掉指南，然后让世界跑起来。
   *  @param {boolean} skipAll  玩家点的是【略过指南，不再提示】吗 */
  function closeGuide(skipAll) {
    if (skipAll) guideSkipForever();
    hideGuide();
    world.running = true;
    lastStuckText = null;   // 和 startEvolution 里那句同一个道理：开跑了，卡住的提示可以再弹
    syncButtons();
  }

  /* ─────────────────────────────────────────────────────────────
     演化路线选择
     ─────────────────────────────────────────────────────────────
     世界走到两条岔路口时弹出，问玩家一句，然后按答案改变世界。

     ⚠️ 弹出时世界已经**屏住呼吸**了 ——
        闸门在 core/evolution.js 的 step 里（看到 route.pending 就冻结）。
        界面这边只负责"把问题问出来"和"把答案递回去"。

     ⚠️ 选项按钮是**动态生成**的，内容全部来自 core/choices.js。
        不写死在 HTML 里，是为了让"文案"和"真正改世界的代码"
        待在同一个文件里 —— 改的时候只改一处，
        不会出现"文案说涨水、代码在涨地"这种对不上的情况。
     */

  /* 当前弹窗是哪一种：
       'route' —— 两道固定的岔路口（core/choices.js）  **观察者替世界做决定**
       'big'   —— 大事件（core/civEvents.js 的 BIG_EVENTS）**观察者出手**

     ⚠️ 两个都是"**玩家选**"，所以长得一样、共用这一个弹窗。
        只有"答完之后交给谁处理"不一样（resolveChoice / resolveBigEvent）。

     ⚠️⚠️ 2026-09-13 之前这里还有一个 'civ'（文明事件，不可点的展示）⚠️⚠️
        改成流式之后**小事件根本不弹窗了** —— 它当场了结、自己流进编年史，
        玩家只是读到它（见 core/evolution.js 的 resolveSmall）。
        所以那个分支连同"不可点的 <div> 选项""他们是「X」型的生灵"那一行
        **整个删掉了**，不是藏起来。

        现在能走到这个弹窗的，**只有玩家自己要做决定的地方**。 */
  var choiceKind = 'route';

  /* 玩家点了、但**还没落地**的那个选项（世界仍冻着）。
     ⚠️ 只有岔路口（route）会用到它 —— 文明事件是答完立刻落地的。
     ⚠️ 由 hideChoice() 统一清掉，所以 confirmChoice 里必须"先读后清"。 */
  var pendingOpt = null;

  /**
   * 弹出选择框，选项按定义现生成。
   *
   * ★ 2026-09-13：**两种模式的选项长得不一样了** ——
   *
   *   route（岔路口）—— **可点的按钮**。那是玩家的手（观察者做决定）。
   *   civ（文明事件）—— **不可点的行，他们选的那个高亮** + 一行"他们是什么性格"。
   *
   *   为什么：玩家扮演的是**观察者**。让观察者替文明做决定是操纵，不是观察。
   *   选择权交还给生灵之后，玩家在这一屏的体验从"我来选"变成
   *   **"看着他们选"** —— 而他们怎么选，取决于玩家前 130 秒塑造出的性格。
   *
   * @param {string} [choice] 文明事件专用：他们挑中的那个选项 key
   */
  function showChoice(def, kind) {
    if (!def) return;
    choiceKind = kind || 'route';
    pendingOpt = null;          // 上一道的答案不许漏到这一道来

    elChTitle.textContent = def.title;
    elChQuestion.textContent = def.question;

    /* ⚠️ 复位视图。不写这几行的话，弹第二道的时候
       选项列表下面**还挂着上一道的结果行**。 */
    elChResult.hidden  = true;
    elChOptions.hidden = false;
    elChOptions.innerHTML = '';
    elChWhy.textContent = '';

    def.options.forEach(function (opt) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'choice-opt';

      /* 选项上**只有名字和一句说明**，一律不预告好处和代价。
         为什么：把得失写在题面上，选择就从"凭对世界的理解做判断"
         变成"算一下哪个划算"了。 */
      [['choice-opt-label', opt.label],
       ['choice-opt-blurb', opt.blurb]].forEach(function (row) {
        var s = document.createElement('span');
        s.className = row[0];
        s.textContent = row[1];
        el.appendChild(s);
      });

      /* ⚠️ 把 opt 本身递出去，不只是 key —— 结果视图要读它的内容。
         直接传对象比"存下 def 再按 key 反查"硬：这个 opt 就是
         core 里 apply(world, ...) 要用的那一个，不会查错。 */
      el.addEventListener('click', function () { answerChoice(opt.key, opt); });
      elChOptions.appendChild(el);
    });

    elChoice.className = 'choice show';
  }

  function hideChoice() {
    pendingOpt = null;      // 收口：没按【继续】就关掉（重置 / 换星球），答案作废
    elChoice.className = 'choice';
  }

  /**
   * 把弹窗**原地换成「结果」视图** —— 玩家已经下过注了，现在告诉他代价。
   *
   * ⚠️ 只填文字、不重建节点。【继续】的监听在启动时绑一次（见文件末尾）——
   *    在渲染函数里绑的话，要么重复绑定，要么绑到被丢弃的节点上。
   * ⚠️ 换屏用 hidden 属性，不用淡出：opacity:0 的按钮**照样能点**。
   */
  function showChoiceResult(opt) {
    elChQuestion.textContent = '你选了：' + opt.label;
    elChOptions.hidden = true;

    if (choiceKind === 'big') {
      /* ★ 大事件**没有 gain / cost** ——
         它的"结果"就是编年史里那一行（金色，`act` 那种）。
         用 #choice-why 那一行来呈现，和岔路口的绿红两行划清界限：

           岔路口（route）："这对**你的世界**意味着什么" —— 得失
           大事件（big）  ："**你亲手写下的历史**"          —— 记录

         ⚠️ 别为了统一就把 gain/cost 加到 BIG_EVENTS 上 ——
            那会让观察者的出手看起来像一笔买卖。 */
      elChResGain.hidden = true;
      elChResCost.hidden = true;
      elChWhy.textContent = opt.chronicle || '';
    } else {
      elChResGain.hidden = false;
      elChResCost.hidden = false;
      elChResGain.textContent = opt.gain;
      elChResCost.textContent = opt.cost;
    }

    elChResult.hidden = false;
  }

  /**
   * 玩家点了**岔路口**的某个选项。
   *
   * ⚠️ 只记住，**不落地**。先把结果摆出来（showChoiceResult），
   *    等玩家按【继续】才由 confirmChoice 落地。
   *    理由见 confirmChoice 上面那段。
   *
   * ⚠️ 2026-09-13：岔路口和**大事件**都走这里（两个都是玩家在选）。
   *    小事件**走不到这里** —— 它根本没有弹窗（见 showChoice 上面那段）。
   */
  function answerChoice(optionKey, opt) {
    if (!world || !opt) return;
    pendingOpt = opt;
    showChoiceResult(opt);
  }

  /**
   * 玩家在**大事件**那一屏按了【继续】：**把观察者这一手落进历史**。
   *
   * ★ 这是整个游戏里玩家唯一能直接"干涉"文明的地方
   *   （另外两个口子是投放元素、两道岔路口 ——
   *     岔路口原来是三道，进文明那道 2026-09-14 删了）。
   *
   * ⚠️⚠️ 它和小事件那条路是**分开的两条**，别合并 ⚠️⚠️
   *
   *     大事件：`resolveBigEvent(world, opt.key)` —— **传玩家的 key**
   *     小事件：`resolveSmall(world, def)`，在 core 里当场了结 ——
   *             玩家碰不到，他们自己按性格挑（core/evolution.js）
   *
   *   分界线是「**谁的世界**」，不是「大 vs 小」：
   *     小事件 = 文明自己的事（瘟疫、分裂、资源）→ 生灵决定
   *     大事件 = 观察者的事，选项全是"你做什么"  → 玩家决定
   *
   *   ⚠️ 这条界线看代码看不出来（两边都是"选一个 option"），
   *      只有看选项文案才分得出。所以 `_wiring_test.js` 里
   *      有一条断言专门钉住"这两个函数各调各的、不互相调用"。
   *
   * ⚠️ 仍然走 handleEvoEvent —— 理由见下面 confirmChoice 那段：
   *    两条路径（每帧的 step 返回值 / 作答的返回值）必须交给
   *    **同一个**处理函数，不许各判各的，否则迟早漏掉某个事件类型。
   */
  function confirmBigEvent() {
    if (!world || !pendingOpt) return;
    var opt = pendingOpt;          // ← 先读
    pendingOpt = null;             // ← 后清（hideChoice 也会清，顺序写反就静默失效）

    /* ★★ 这里**必须**把玩家选的 key 传下去 ★★
       —— 和小事件那条路（core 的 resolveSmall）正好相反：
          小事件玩家碰不到，他们自己定；
          大事件是玩家的事，key 就是玩家的选择。

       ⚠️ 两条路**不要合并**。合并的话只有两种写法，两种都错：
          都传 key  → 小事件也被玩家操纵了（但小事件根本没弹窗，
                      所以实际表现是"传了个 undefined 进去"）
          都不传    → 大事件玩家点了没用，永远是第一个选项 */
    var ev = Evolution.resolveBigEvent(world, opt.key);
    hideChoice();
    handleEvoEvent(ev);

    // 玩家这一手也改了本源和图层上限 —— 界面上的数字得立刻跟上
    syncEssenceUI();
    syncReadout();
    syncButtons();
  }

  /** 【继续】按钮——两种模式共用，按当前是哪种分派 */
  function onChoiceGo() {
    if (choiceKind === 'big') confirmBigEvent();
    else confirmChoice();
  }

  /**
   * 玩家在结果视图里按了【继续】：**现在才真正落地**。
   *
   * ⚠️⚠️ 推迟落地是整个交互的核心 ⚠️⚠️
   *
   *    Choices.resolve 一被调用就做两件事：opt.apply(world) 改世界、
   *    world.route.pending = null **解冻世界**。
   *    如果答完立刻落地再让玩家读结果，世界就会在结果面板背后偷偷跑几秒，
   *    等玩家按【继续】时它已经往前走了一截。
   *
   *    推迟到这一刻 = 读结果期间世界保持冻结，**而且 core 一行都不用改**。
   *
   * ⚠️ 先读后清！hideChoice() 会清 pendingOpt，顺序写反就静默失效。
   */
  function confirmChoice() {
    if (!world || !pendingOpt) return;
    var opt = pendingOpt;          // ← 先读
    pendingOpt = null;             // ← 后清

    var ev = Evolution.resolveChoice(world, opt.key);   // 现在才落地 + 解冻
    hideChoice();
    handleEvoEvent(ev);            // 答【文明】那道的时候，这里会弹出「文明诞生」面板

    syncEssenceUI();
    syncReadout();
    syncButtons();
  }

  /* ─────────────────────────────────────────────────────────────
     模式切换
     ─────────────────────────────────────────────────────────────
     设置模式：调参数 → 点【演化】
     观察模式：本源读数锁死，专心看世界变化

     实现方式只是改 body 上的一个 class，具体哪些控件显示
     由 CSS 的 .setup-only / .watch-only 决定。
     */

  var mode = 'setup';

  /* 文明阶段要不要切换界面形态（收起元素栏、星球缩小）。

     ⚠️ 不能直接写 document.body.className —— setMode 也写它，
        两边会互相覆盖（切模式时把 civ-on 冲掉、或者反过来）。
        统一走 applyBodyClass() 拼。 */
  var civUIOn = false;

  function applyBodyClass() {
    document.body.className = 'mode-' + mode + (civUIOn ? ' civ-on' : '');
  }

  function setCivUI(on) {
    if (civUIOn === on) return;
    civUIOn = on;
    /* 进文明阶段时把选中的元素也清掉 —— 面板已经藏了，选中状态留着
       没有意义，而且 `canvasTap` 现在也认它（见那个函数里的说明）。
       和 `setMode('setup')` 里那一句是同一个道理。 */
    if (on) selectElement(null);

    /* ★ 2026-09-21 修 BUG：**中间那行观察日志也要擦掉**。
       用户报的原话：「点击元素残留的文字会在文明阶段也显示」。

       ⚠️ 根因：`.log` 是**文明前专属**的一条（`showToast` 只在
          `!civUIOn` 时把字送到那儿），可它**没有任何东西在切阶段时收掉它** ——
          和 `btnReset` 那次（决策 #133）是**同一个形状**：
          "这条东西只属于某一个阶段，但没人告诉它在阶段切换时要退场"。
       实测复现过：到文明那一刻 `#log` 里还挂着「世界开始冷却了」，
          `show` 开着、还在视口里，而顶栏早换成文明的征兆了。

       ⚠️⚠️ 这里和 CSS 是**一对，缺一不可，而且分工明确** ⚠️⚠️
           · 这里（JS）清的是**状态** —— 文字、队列、定时器。
             跟旁边那句 `selectElement(null)` 是同一件事。
           · `style.css` 的 `body.civ-on .log { display: none }` 管的是
             **不再显示**。
          两边都做，理由和"元素栏"一模一样：
             `setCivUI` 里清 `selectedEl`（状态）+
             CSS 里 `body.civ-on .palette-panel{display:none}`（显示）。
          ⚠️ 只做 CSS 那条也能"看着对"，但 DOM 里会留着一串假状态
             （下一次 `showLog` 前它一直是"显示中"），那就是隐藏的雷。 */
    if (on) clearLog();

    applyBodyClass();
  }

  function setMode(m) {
    mode = m;
    applyBodyClass();
    // 回到设置模式时清掉选中的元素 —— 那个模式里元素栏本来就是藏起来的
    if (m === 'setup') selectElement(null);
    syncButtons();   // 换了模式，底部按钮的显隐和文字都要跟着变
  }

  /* ─────────────────────────────────────────────────────────────
     点世界投放元素
     ───────────────────────────────────────────────────────────── */

  /**
   * 把屏幕坐标换算成世界坐标，然后投放选中的元素。
   *
   * 换算方法：把世界看成一个「单位圆」——
   *   圆心在 (worldCx, worldCy)，半径 worldR 像素。
   *   点到圆心的像素距离 ÷ worldR = 单位圆里的比例（-1 ~ 1）。
   *   算出来如果 x² + y² > 1，说明点在球外面，忽略这次点击。
   */
  function canvasTap(clientX, clientY) {
    /* 只有「观察模式 + 选了元素 + 有世界 + 还没走到文明」才响应。

       ⚠️⚠️ `civUIOn` 这一条是 2026-09-13 补的 —— 补一个**没做完的改动** ⚠️⚠️

       文明阶段不该再往地表投东西了（见 CLAUDE.md 第九节）。
       但当时只做了**视觉上的"收起来"**：style.css 里
       `body.civ-on .palette-panel { display: none; }` 把面板藏了 ——
       **面板藏了，点星球照样能投。**

       那是一条界面完全不提示、但代码通着的路：玩家看不见自己选的是
       哪个元素，却仍然能一颗接一颗丢下去。而且这条路会**绕过
       `dropCount` 的设计意图** —— 「被观测 / 抵达」判的是"你几乎
       没干预过这个世界"，那说的是**文明诞生之前**的投放。

       ⚠️ 判据用 `civUIOn`（和面板显隐是**同一个开关**），
          不用 `world.evo.stage` —— 一个开关管两件事才不会不同步。
          万一哪天界面形态没切过来，面板还显示着，那时能投也是对的。 */
    if (civUIOn) return;
    if (mode !== 'watch' || !selectedEl || !world || !worldR) return;

    var rect = canvas.getBoundingClientRect();
    var x = (clientX - rect.left - worldCx) / worldR;
    var y = (clientY - rect.top  - worldCy) / worldR;

    if (!Elements.isInsideWorld(x, y)) return;   // 点在球外面

    var ev = Elements.drop(world, selectedEl, x, y);
    /* ★ 2026-09-21：现在**每个**元素都会返回一句投放旁白（`DROP_TEXT`）。
       雷种还多一句 `also`（天象结果）—— 先飘哪句由 showLog 的队列保证。
       ⚠️ 走 `showToast` 而不是直接 `showLog`：分流在 showToast 里
          （文明前 → 中间漂浮；文明阶段 → 顶栏）。投放本来就只发生在文明前，
          但走同一个口子，以后改分流只改一处。 */
    /* ★ 2026-09-21 配色规则（用户定的）：
         · 投放旁白 → **那个元素的颜色**（"你做了什么"）
         · 世界自己的事（阶段推进 / 卡住 / 天象）→ **冷灰白**（"世界在发生什么"）
       ⚠️ `ev.color` 只给 `text` 那句。`also` 是**天象结果** ——
          那是世界在发生什么，所以**不传颜色**、走默认灰白。 */
    if (ev && ev.text) showToast(ev.text, ev.color);
    if (ev && ev.also) showToast(ev.also);
  }

  // 点画布 = 投放元素。
  // 优先用 Pointer Events —— 它把鼠标和触摸统一成一套，不用写两遍
  // （官方规范 cross-platform-h5.md 也是这么建议的）。
  // 老环境没有 PointerEvent 才退回 touchstart + mousedown。
  if (typeof window.PointerEvent !== 'undefined') {
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      canvasTap(e.clientX, e.clientY);
    });
  } else {
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (e.touches.length) canvasTap(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    canvas.addEventListener('mousedown', function (e) {
      canvasTap(e.clientX, e.clientY);
    });
  }

  /**
   * 把本源数值刷到读数条和数字上。
   * ⚠️ 加了个"值没变就不碰 DOM"的判断 —— 这个函数每帧都会跑，
   *    无脑写 DOM 会让手机发热、掉帧。
   */
  function syncEssenceUI() {
    if (!world) return;
    for (var k in essenceBars) {
      var v = Math.round(world.essence[k]);
      if (essenceBars[k]._shown === v) continue;
      essenceBars[k]._shown = v;
      essenceBars[k].val.textContent = v;
      /* ★ 亮条的长度（P0#8「数据条」）。
         ⚠️ 这条不是"滑块位置"，是**读数** —— 玩家靠它一眼看出
            这颗世界什么命（决策 #72）。
         ⚠️ 2026-09-17 之前这里还写了一句 `input.value = v`（喂给那根
            真的 `<input type="range">` 的）。换成 `<span>` 之后没有了 ——
            `<span>` 没有 value 这个属性。
         本源都是 0~100，直接用。 */
      essenceBars[k].bar.style.setProperty('--fill', v + '%');
    }
  }

  /** 刷新阶段指示条：已过的点亮、当前的呼吸、未来的灰暗 */
  function syncStageBar() {
    if (!world) return;
    var cur = world.evo.stage;
    if (shownStage === cur) return;            // 没变就不碰 DOM
    shownStage = cur;
    for (var i = 0; i < stageSegs.length; i++) {
      stageSegs[i].className = 'stage-seg' +
        (i < cur ? ' done' : (i === cur ? ' active' : ''));
    }
  }

  /**
   * 把本源数值刷到观察模式的只读显示上。
   *
   * ⚠️ 显示的是「**有效本源**」= 全局值 + 投放元素的平均影响。
   *    为什么不显示全局值：玩家投一个水珠，就该看到水的数字真的涨了一点。
   *    投了没反应会让人以为没生效。
   *
   * 和别处的读数一样，"值没变就不碰 DOM" —— 这函数每帧都跑。
   */
  function syncReadout() {
    if (!world) return;

    var boost = Elements.averageBoost(world);

    for (var k in readoutVals) {
      var v = Math.round(clamp01to100(world.essence[k] + boost[k]));
      if (readoutVals[k]._shown === v) continue;
      readoutVals[k]._shown = v;
      readoutVals[k].textContent = v;
      /* ★ 2026-09-15：底下那条细线的填充比例。
         CSS 读不到数字，只能由 JS 喂一个自定义属性进去 ——
         见 style.css 的 `.readout-value::after`。本源是 0~100，直接用。 */
      readoutVals[k].style.setProperty('--fill', v + '%');
    }

    // 光暗值：正数偏金、负数偏紫、0 是平衡
    var lv = Math.round(world.light);
    if (lightShown !== lv) {
      lightShown = lv;
      lightVal.textContent = lv > 0 ? ('+' + lv) : String(lv);
      lightVal.style.color = lv > 0 ? '#FFD870'
                           : lv < 0 ? '#8A5AC8'
                           : '';
      /* 光暗值是 **−100 ~ +100**，所以 0 在正中间（50%）——
         不这么换算的话，光暗值 0 会画成一条空槽，看着像坏了。 */
      lightVal.style.setProperty('--fill', (50 + lv / 2) + '%');
    }

    syncAttrs();
  }

  /**
   * ★ 四属性刷到屏幕上（2026-09-15）。
   *
   * ⚠️ **走 `Civ.attrOf`，不许直接读 `world.civ.attr`** ——
   *    那个函数在读的时候会把下限夹住（见它的说明）。
   *    直接读的话，某个选项把文化扣穿的时候屏幕上会出现「−2」。
   *
   * ⚠️⚠️ **这里显示的是原值，不按 10 截顶** ⚠️⚠️
   *    用户的原话：「以默认 10 为满值，但是**超过 10 了还是继续写 11、12**，
   *    多的值不参与结局设定了，只是显示而已」。
   *    截顶只发生在 `ending.js` 的 `attrCapped` 里 —— **别把两个地方弄反**。
   *
   * ⚠️ 显示用 `Math.round` —— 文化是**连续涨**的（`culGain × 进度`），
   *    内部是小数。不取整的话屏幕上会出现「文化 4.783」。
   *    ⚠️ 取整只在这一层，**内部那个小数要留着**：结局比的是"哪个最高"，
   *       四舍五入之后再比，两个差 0.4 的属性会变成"并列"。
   *
   * ⚠️ 没走到文明时 `world.civ.attr` 不存在 —— `attrOf` 会返回全 0，
   *    而那批格子那时本来就是 `display: none`（`.civ-only`）。
   */
  /**
   * 四属性那条数据线的填充比例。
   *
   * ⚠️ **只影响线的长短，不碰显示的数字。**
   *    属性满值按 10 算，超过就画满格 —— 但屏幕上照样写 11、12
   *    （用户定的：「超过 10 了还是继续写 11、12……只是显示而已」，
   *      截顶只发生在 `ending.js` 的 `attrCapped` 里）。
   *
   * ⚠️ **单独拎成函数是有原因的，别合回去**：
   *    `_wiring_test.js` 第 17b 节有一条断言查 `syncAttrs` 里
   *    **不许出现 `Math.min(`** —— 它守的是"显示不截顶"。
   *    封顶留在函数体里的话，那条断言会把"封线长"误判成"封数字"而红。
   */
  function barFill(v) {
    var p = v * 10;
    return (p > 100 ? 100 : p) + '%';
  }

  function syncAttrs() {
    if (!world || !world.civ) return;

    /* ── ★★ 修真彩蛋：这四个数**观测不出来**（2026-09-16，用户拍板）★★

       四个读数一律显示「？？？？」、读数条归零，**标签保留** ——
       军事 / 科技 / 生产 / 文化 是**观察者自己的分类框架**，
       测不出来的不是维度，是**值**。

       ⚠️ 改的只是**显示**。四个数内部照常滚动（起点 + 文化自然增长），
          只是不显示、也不参与运算（`stepCiv` 里对彩蛋把 `relief` 置 0，
          事件那边 `OPTION_ATTR` 全标了 `null`）。
       ⚠️ 判据用 `isEgg` —— 和 `civPhrase` / `civName` / `evaluate` /
          界面另外四处**同一个开关**，不用 `proto === 'cultivation'`
          （那样等于把物种名又抄了一遍）。
       ⚠️⚠️ 这段里**不许出现 `Math.min(`** —— `_wiring_test.js` 有一条
          正则守着 `syncAttrs` 的正文（它守的是"显示不截顶"这件事）。
          下面正常分支里的 `Math.round(` 也必须留着（同一条断言）。 */
    if (world.civ.isEgg) {
      for (var ek in attrVals) {
        if (attrVals[ek]._shown === '？？？？') continue;
        attrVals[ek]._shown = '？？？？';
        attrVals[ek].textContent = '？？？？';
        attrVals[ek].style.setProperty('--fill', '0%');
      }
      return;
    }

    var a = Civ.attrOf(world.civ);
    for (var k in attrVals) {
      var v = Math.round(a[k] || 0);
      if (attrVals[k]._shown === v) continue;
      attrVals[k]._shown = v;
      attrVals[k].textContent = v;
      attrVals[k].style.setProperty('--fill', barFill(v));
    }
  }

  /* ─────────────────────────────────────────────────────────────
     编年史面板
     ─────────────────────────────────────────────────────────────
     文明阶段每帧调一次。数据全部来自 world.evo.civ.rows ——
     那个数组由 core/evolution.js 往里写（历史行 / 征兆 / 玩家的选择），
     这里只负责把它们变成 DOM。

     ⚠️⚠️ 只**追加**新的行，绝不整块重画 ⚠️⚠️
        整块重画（innerHTML = '' 再全塞一遍）有两个后果：
        ① 滚动条每帧跳回顶部，玩家正读的历史被打断
        ② 每帧重建几十个 DOM 节点，手机上直接掉帧
        所以用 chronShown 记住"已经画到第几行了"。

     ⚠️ 三种行的样式不一样（见 style.css 的 .chron-row.*）：
        line  历史行 —— 正常色，点号开头
        omen  征兆   —— 暗红斜体，破折号开头
        deed  玩家的选择 —— 金色
        玩家要能一眼分出这三种，否则"没有压力条、只看征兆"的设计就废了。
     ───────────────────────────────────────────────────────────── */

  /** 第几纪（三档，跟着编年史进度走）
   *
   *  ⚠️ 名字**不要写在这里** —— 这里原来是硬编码的「第一纪 / 第二纪 / 第三纪」，
   *     等于把 CivLore.ERA_NAMES 手抄了一份。
   *     2026-09-12 改纪元名时就撞上了：行内的标题换了，面板顶部还是老的。
   *     现在直接问 CivLore，只有一个真相。 */
  function eraName(progress) {
    return CivLore.eraName(CivLore.eraOf(progress));
  }

  function syncChronicle() {
    if (!world) return;

    var c = world.evo.civ;
    var on = !!(c && c.phase >= 1);      // phase 0 = 诞生面板还开着，先不显示

    if (elChronicle.hidden === on) elChronicle.hidden = !on;
    setCivUI(on);        // 文明阶段：收起元素栏、把地方让给文字

    /* 不在文明阶段（换星球 / 重置 / 还没走到）—— 收起来，缓存和 DOM 一起清。

       ⚠️ 判据看的是 **DOM 里还有没有东西**，不是缓存值。
          原来写的是 `chronShown !== 0 || chronNameShown !== null`，
          那两个值可能已经被 refreshInfo() 清过了 —— 一旦如此，
          这个分支就永远不会触发，上一局的编年史会一直挂在面板里
          （2026-09-12 用户报的 bug）。看 DOM 是幂等的，不受缓存状态影响。 */
    if (!on) {
      if (elChronBody.firstChild) elChronBody.innerHTML = '';
      chronShown = 0;
      chronEraShown = 0;
      chronNameShown = null;
      return;
    }

    /* 文明名（只设一次）
       ⚠️ 走 displayName，不是 civName —— 玩家可能在诞生面板上改了名，
          civName 只是"没起名时的推荐值"。这里是名字出现的三个地方之一
          （另两处：诞生面板、结局卡片），三处必须同一个来源。 */
    var name = (world.civ && world.civ.isEgg ? '⚡ ' : '') + Civ.displayName(world);
    if (chronNameShown !== name) {
      chronNameShown = name;
      elChronName.textContent = name;
    }

    // 追加新写出来的行
    var rows = c.rows || [];
    if (chronShown !== rows.length) {
      for (var i = chronShown; i < rows.length; i++) {
        var r = rows[i];
        var d = document.createElement('div');
        /* kind 有六种（原来这里写的是"四种"，早过时了）：
             line  历史行   / omen 征兆       / era  纪元标题（不占格）
             event 抬头     / deed 他们自己的决定（小事件）
             act   观察者下的那一手（大事件）
           ⚠️ `event` 抬头**小事件和大事件都有**（大事件那条是 2026-09-17 补的，
              在那之前大事件只推 `act`，结果行落进编年史时没有上文）。
              见 core/evolution.js 的 resolveSmall / resolveBigEvent。
           样式表里这六种各有一条规则，见 docs/VISUAL.md 的界面清单。 */
        d.className = 'chron-row ' + r.kind;
        d.textContent = r.text;
        elChronBody.appendChild(d);
      }
      chronShown = rows.length;

      // 滚到底 —— 新写的那行要看得见
      elChronBody.scrollTop = elChronBody.scrollHeight;
    }

    // 纪年
    var era = eraName(c.progress);
    if (chronEraShown !== era) {
      chronEraShown = era;
      elChronEra.textContent = era;
    }
  }

  function clamp01to100(v) {
    return v < 0 ? 0 : (v > 100 ? 100 : v);
  }

  /**
   * 刷新底部按钮组 —— 两个按钮的显隐和文字都在这里统一管。
   *
   * 为什么集中在一个函数：之前散在各处改，改漏一处就会出现
   * "按钮该出来的时候不出来"这种问题，而且很难查。
   *
   * ┌───────────┬────────────┬──────────────────┐
   * │           │ 设置模式    │ 观察模式          │
   * ├───────────┼────────────┼──────────────────┤
   * │ 换一个星球 │ ✅ 显示     │ ❌ 藏起来         │
   * │ 演化       │ ✅ "演化"   │ ✅ "暂停 / 继续"  │
   * │ 重置       │ ❌ 藏起来   │ ✅ 显示（CSS 管） │
   * └───────────┴────────────┴──────────────────┘
   *
   * 按钮显隐**只看模式，不看有没有走完** ——
   * 走到文明之后按钮仍然是【暂停 / 继续】，
   * 玩家可以继续看下去（投放元素、看文明光点铺满），也可以暂停。
   * 想换一颗星球？点【重置】回设置模式，那里有【换一个星球】。
   */
  function syncButtons() {
    // ── 换一个星球：只有设置模式才有 ──
    // 演化一旦开始就藏起来 —— 一局没走完不许中途重开。
    // 想换星球就先【重置】回设置模式。
    btnCreate.hidden = (mode !== 'setup');

    /* ── 开始演化 / 暂停 / 继续：一直在，标签随运行状态变 ──
       ⚠️ 设置模式那句是「**开始**演化」不是「演化」（用户 2026-09-14 定的）。
          观察模式那两句「暂停 / 继续」**不动** —— 那是对同一个动作的切换，
          和"入口的名字"不是一回事。 */
    btnEvolve.hidden = false;
    var label = '开始演化';
    if (mode === 'watch') {
      label = (world && world.running) ? '暂停' : '继续';
    }
    btnEvolve.textContent = label;
  }

  /** 中间那条观察日志 ★ 2026-09-21
      文明**之前**那两分钟（混沌→冷却→海洋→大陆→生态）的旁白飘在这儿 ——
      阶段推进、卡住、投放反馈都走它。

      ⚠️ 节奏：淡入 0.6 秒 / 停留 3.2 秒 / 淡出 0.8 秒。
         三个数字住在**两个地方**，改一个必须改另一个：
           · 淡入 0.6 / 淡出 0.8 → style.css 的 `.log`（`.show` 里覆盖成 0.6）
           · 停留 3.2            → 下面那个 `LOG_HOLD`（= 600 + 3200）
      ⚠️ 为什么停留 3.2 秒（比顶栏那条的 2.6 久）：中文小字一行二十来个字，
         2 秒读不完 —— 低头看一眼星球就错过了。 */
  /* ── 队列：一条一条飘，不是直接替换 ──
     ⚠️ 为什么要队列：雷种一次要飘**两条**（"投了什么" + "降下了什么"）。
        直接替换的话第一条会被第二条当场顶掉，等于没飘。
     ⚠️ 上限 **2** 条待播：玩家连点几下就会堆起来，堆到第五条时
        屏幕上的字早和他刚才做的事对不上了。满了**丢最旧的**、留最新的 ——
        刚发生的事比早先那条值得说。 */
  var logQueue = [];
  var logTimer = null;
  /* ★ 2026-09-22：「开始下一轮」那条提示是**常驻**的（`sticky`）。
     它挂着的时候 `logPinned` 为 true —— 后面的普通日志**一律丢掉**，
     不抢它的位置。谁挂上去、谁收掉，见 `showToast` 第三参和 `clearLog`。 */
  var logPinned = false;
  var LOG_HOLD = 3800;    // 一条飘多久 = 淡入 0.6 秒 + 停留 3.2 秒
  var LOG_FADE = 800;     // 淡出时长，⚠️ 必须和 style.css 里 `.log` 的 transition 对上

  function showLog(text, color, sticky) {
    if (!text) return;

    /* ── ★ 常驻那一条：不走队列、不排定时器，直接把字钉在屏幕上 ──

       ⚠️ 只有「没走到文明」的结局会走到这儿 —— 那时顶栏是收起来的
          （height:0），写进去等于写进看不见的地方。分流在 `showToast`。
       ⚠️ 它要**当场顶掉正在飘的那条**：这是留给玩家的最后一句提示，
          让一条投放旁白排在前头没有意义。
       ⚠️ 收掉它的只有 `clearLog()`（【重置】和【换一个星球】都会调）。 */
    if (sticky) {
      logQueue.length = 0;
      if (logTimer !== null) { clearTimeout(logTimer); logTimer = null; }
      logPinned = true;
      elLog.textContent = text;
      elLog.style.color = color || '';
      elLog.classList.add('show');
      return;
    }
    if (logPinned) return;      // 常驻那条还挂着 —— 不抢（世界已经结束了）

    /* ⚠️ 队列里存的是**对象**不是字符串 —— 因为**颜色是某一条的属性**，
       不是整个容器的。开场那句是冷蓝、投放旁白跟着元素走、自然演化是灰白。 */
    logQueue.push({ t: text, c: color || null });
    while (logQueue.length > 2) logQueue.shift();
    if (logTimer === null) pumpLog();     // 已经有条在飘就让它飘完，别打断
  }

  function pumpLog() {
    if (!logQueue.length) { logTimer = null; return; }
    var item = logQueue.shift();
    elLog.textContent = item.t;
    /* ★ 2026-09-21：颜色按条给。
         不给（`null`）就清成空串 → 落回 style.css 的默认**冷灰白**，
         那是"世界在发生什么"（阶段推进 / 卡住 / 天象）。
         给了就用它 —— 投放旁白传的是**那个元素的颜色**。
       ⚠️ 每条都要**重新设一遍**，不然上一条的颜色会留在下一条身上。 */
    elLog.style.color = item.c || '';
    elLog.classList.add('show');
    logTimer = setTimeout(function () {
      elLog.classList.remove('show');
      /* ⚠️ 等淡出走完再上下一条，不然两条会叠在一起糊成一团 */
      logTimer = setTimeout(pumpLog, LOG_FADE);
    }, LOG_HOLD);
  }

  /** 把正在飘的那条日志**当场清干净**。
   *
   *  ★ 2026-09-21 加，修用户报的 BUG：
   *    「点击元素显示文字在屏幕上，但是这时候点重置回到开始画面，
   *      文字仍在屏幕上」
   *
   *  ⚠️ 根因：`btnReset` 里关了结局面板、岔路口、文明诞生面板，
   *     **唯独漏了这条观察日志** —— 它是 2026-09-21 才加进来的新东西，
   *     而那个"重置时该关哪些"的清单是照着当时已有的面板手写的。
   *     于是重置之后：`.stage` 回到设置模式照样显示着，而 `.log`
   *     还挂着 `show` 类、`textContent` 还是上一条 —— 字就留在屏幕上了。
   *
   *  ⚠️⚠️ 三件事缺一不可 ⚠️⚠️
   *     ① `logQueue` 清空 —— 不清的话队列里排着的那条会接着往上冒
   *     ② `logTimer` 清掉 —— 不清的话**下一次 showLog 会被吞掉**：
   *        `showLog` 里有 `if (logTimer === null) pumpLog()`，
   *        定时器还挂着时新日志只入队不播，得等旧的那个 4.6 秒走完
   *     ③ `show` 类摘掉 + 文字清空 —— 不然屏幕上就留着那一行字
   *     ④ `logPinned` 放掉（★ 2026-09-22 加的）—— 见下面那行
   *
   *  ⚠️ `logTimer` 这一个变量**同时**存着外层和里层两个定时器
   *     （`pumpLog` 里的赋值会覆盖它），所以 `clearTimeout(logTimer)`
   *     一次就把当前挂着的那个清掉了，不用分开存。 */
  function clearLog() {
    logQueue.length = 0;
    logPinned = false;        // ★ ④ 常驻那条也一起摘掉（不清的话新日志全被它吃掉）
    if (logTimer !== null) { clearTimeout(logTimer); logTimer = null; }
    elLog.classList.remove('show');
    elLog.textContent = '';
    elLog.style.color = '';   // 颜色是按条内联设的，上一条的颜色别留给下一条
  }

  /** 把顶栏那条提示清掉。
   *  ⚠️ 和 `clearLog` 是**同一个 BUG 的另外半边**：`showToast` 里那个
   *     2.6 秒的定时器同样没人清，重置后顶栏的字也会留着。
   *     用户只报了观察日志那个，这是顺手把同一类问题一次修干净。 */
  function clearToast() {
    clearTimeout(showToast._t);
    showToast._t = null;
    elToast.classList.remove('show');
    elToast.textContent = '';
  }

  /** 顶栏那条提示。
      ⚠️ 2026-09-21 起它**只管文明阶段及以后**（征兆、卡住、档案库消息…）——
         文明前的字改走中间那条 `showLog`，分流见下。
      ⚠️ 原来这里的注释写着「现在先备好」，那是 2026-09-14 留下的老话；
         它其实早就在用了（征兆 / 卡住 / 雷种 / 档案库）—— 2026-09-21 顺手改掉。 */
  function showToast(text, color, sticky) {
    if (!text) return;

    /* ★★ 分流点 ★★
       ⚠️⚠️ 这个条件必须和 style.css 里 `body.mode-watch:not(.civ-on) .toast`
             那条**逐字对应**：那边是 CSS 在收顶栏的位置，这边是 JS 在选走哪条路。
             两把尺子对不上，就会出现"字写进了看不见的地方"（这个项目栽过）。
       ⚠️ 文明阶段（`civUIOn`）**一个字都不动** —— 征兆照旧从顶上弹。
       ⚠️ `sticky` 要**跟着转给 showLog** —— 不然"没走到文明"的结局上，
          那条常驻提示会变成飘 3.8 秒就没。 */
    if (mode === 'watch' && !civUIOn) { showLog(text, color, sticky); return; }

    elToast.textContent = text;
    elToast.classList.add('show');
    clearTimeout(showToast._t);
    /* ★ 第三参 `sticky` = 常驻：**不排那个 2.6 秒的定时器**，字一直留着。
       收掉它的是 `clearToast()`（【重置】和【换一个星球】都会调）。 */
    showToast._t = sticky ? null : setTimeout(function () {
      elToast.classList.remove('show');
    }, 2600);
  }

  /* ─────────────────────────────────────────────────────────────
     演化事件的分发
     ─────────────────────────────────────────────────────────────
     ⚠️⚠️ 只有这一个地方处理演化状态机返回的事件 ⚠️⚠️

     为什么必须集中：事件有**两个来源** ——
       ① 每帧 `Evolution.step()` 的返回值
       ② 玩家作答之后 `resolveChoice()` / `resolveBigEvent()` 的返回值

     踩过的坑：答【文明】那道岔路口时，返回值是 `{type:'civBirth'}`
     （因为"答完"和"进入文明"是同一件事），而作答那条路我第一版只判了
     `type === 'done'`，把 civBirth 丢掉了 —— 结果**「文明诞生」面板永远弹不出来**。
     玩家会看到世界直接开始跑文明发展期，却不知道长出来的是什么。

     两个来源交给同一个函数，就不会出现"这条路上漏判了一种事件"。
     */
  function handleEvoEvent(ev) {
    if (!ev) return;

    if (ev.type === 'choice') {
      // 世界走到岔路口了（世界已经在 step 里冻住，这里只负责问出来）
      // ⚠️ 只会进一次：下一帧 route.pending 还在，step 会一直返回 null。
      lastStuckText = null;
      showChoice(ev.choice, 'route');

    } else if (ev.type === 'bigEvent') {
      /* ★ 大事件 ——**观察者出手**的时刻。世界已经在 step 里冻住了
         （判据是 civ.bigPending），这里只负责问出来。

         ⚠️ 只会进一次：下一帧 bigPending 还在，step 会一直返回 null。

         ⚠️ 注意到这里**没有 `ev.choice`** —— 和小事件不一样。
            小事件的答案是生灵自己定的，大事件的答案是**玩家**给的，
            现在还不知道，要等玩家点。 */
      lastStuckText = null;
      showChoice(ev.event, 'big');

    } else if (ev.type === 'civBirth') {
      // 文明诞生了 —— 先给玩家看长出来的是什么，
      // 关掉面板才开始走发展期（60~120 秒）。
      lastStuckText = null;
      showCivBirth();

    } else if (ev.type === 'omen') {
      // 命运预兆开始。命运在这一刻已经定下来了（见 evolution.js），
      // 接下来 20~30 秒光点按它分化，走完才出结局面板。
      lastStuckText = null;
      showToast(ev.omen.name + ' · ' + ev.omen.desc);

    } else if (ev.type === 'stuck') {
      // 卡住时状态机**每帧**都会返回同一条提示。
      // 这里做个去重，只在提示语变化时弹一次，否则会疯狂刷屏。
      if (ev.text !== lastStuckText) {
        lastStuckText = ev.text;
        showToast(ev.text);
      }

    } else {
      // advance / done / 冲突事件：提示语每次都弹
      lastStuckText = null;
      if (ev.text) showToast(ev.text);

      if (ev.type === 'done') {
        // ⚠️ 故意**不**把 running 设成 false。
        //    命运预兆演完了，但世界还在转、文明光点还在，
        //    玩家还能继续投放元素。想停的话自己点【暂停】。
        /*    finished 只是打个标记 —— ⚠️ 2026-09-17 修的说法：
              原来这里写"结局面板靠它判断这一局走完了"，**那是错的** ——
              结局面板是被上面那行 `showEnding()` 直接调起来的，
              压根不读这个标记。真正读它的是几个 `_` 探针
              （`_archive-seed.js` / `_record-seed.js` 那些）。
              ⚠️ 另外注意「core 从来不设 world.finished」这句话也**不准确**：
              core 在两处会碰它（判「此界不成」时设 true、重置时设 false）。
              但**"等它不如等 `ev.type === 'done'`"这条结论是对的**，
              别把结论一起删了。 */
        world.finished = true;
        showEnding();
      }
    }

    syncStageBar();
  }

  /* ─────────────────────────────────────────────────────────────
     每帧更新
     ───────────────────────────────────────────────────────────── */
  function update(dSim) {
    if (!world) return;

    // 自转
    world.evo.rotation += world.look.spin * dSim;

    // ── 演化推进 ──
    // ⚠️ 混沌迷雾的散开、六个阶段的推进，全部交给 Evolution 状态机管。
    //    这里**不要**自己改 world.evo.progress —— 会和状态机打架。
    //
    // ⚠️ 这个函数**每帧都要调用**，不能只在 world.running 时调 ——
    //    因为元素系统（光斑老化、光暗值回归）也挂在里面，
    //    那些跟"演化有没有在跑"是两回事。
    //    什么时候该冻结由第三个参数说了算。
    //
    // 什么时候冻结：
    //   · 用户按了暂停  → 冻结（图层不长、阶段不推进）
    //   · 世界走到文明  → **不冻结**（文明光点还要一个一个点亮完）
    // 冻结 = 玩家没让它跑。走到文明之后也一样 ——
    // 想继续看（投放元素、看文明光点铺满）就点【继续】，想停就点【暂停】。
    var frozen = !world.running;
    var ev = Evolution.step(world, dSim, frozen);

    handleEvoEvent(ev);

    // 本源数值每帧都可能被漂移改动，同步到两种模式的显示上
    syncEssenceUI();   // 设置模式的本源读数条
    syncReadout();     // 观察模式的只读数值
    syncChronicle();   // 文明阶段的编年史
  }

  /* ─────────────────────────────────────────────────────────────
     绘制
     ───────────────────────────────────────────────────────────── */
  function draw() {
    if (!W || !H) return;

    // ── 底 + 星空：铺满整个视口 ──
    ctx.fillStyle = '#07070C';
    ctx.fillRect(0, 0, W, H);
    Renderer.drawStars(ctx, stars, time);

    if (!world || !(worldMaxR > 0)) return;

    // ── 世界 ──
    // 大小按"世界所在区域的尺寸"算（不是屏幕尺寸），
    // 再跟 worldMaxR 取一次小的，给光环和卫星留出空间。
    var R = Math.min(Renderer.worldRadius(world, stageW, stageH), worldMaxR);
    worldR = R;   // 记下来 —— 点世界投放元素时要拿它把屏幕坐标换算成世界坐标

    Renderer.drawWorld(ctx, world, worldCx, worldCy, R, time);

    // 投放的元素画在世界**之上** —— 它们是"贴在地表上"的东西
    Renderer.drawDrops(ctx, world, worldCx, worldCy, R, time);
  }

  /* ─────────────────────────────────────────────────────────────
     主循环
     ───────────────────────────────────────────────────────────── */
  function frame(ts) {
    var dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;

    // 切到后台再切回来时 dt 会很大，夹一下防止画面跳变
    if (dt > 0.1) dt = 0.1;

    var dSim = dt * world.timeScale;   // 世界时间 = 真实时间 × 时间流速
    time += dSim;

    /* ⚠️⚠️ 这层 try/catch 是**保命的**，不是拿来掩盖错误的 ⚠️⚠️
       `requestAnimationFrame` 是"回调里排下一帧"。回调里一旦抛异常，
       下一帧就**再也排不上** —— 画面定住不动，而且**一声不响**。
       玩家看到的是"卡死了"，其实是崩了；这是这个游戏最坏的失败模样。

       ⚠️ `catch` 里**必须**再排一次下一帧（就靠下面那句兜着）——
          不排的话这层 try/catch 等于没写，照样死。
       ⚠️ 只 `console.error` **一次**：每帧都抛的话控制台会被刷爆，
          而刷爆本身更卡。第一行足够定位问题。
       ⚠️ 这是**全项目唯一一处 `console`**（平台不禁它，见
          `_check-package.js` 的禁用清单）。加它是因为
          "静默失败"在这个项目里被反复证明是最难查的一类。 */
    try {
      update(dSim);
      draw();
    } catch (err) {
      if (!frameErrored) {
        frameErrored = true;
        console.error('[观测者] 主循环这一帧出错了，画面可能停住：', err);
      }
    }

    requestAnimationFrame(frame);
  }

  /* ─────────────────────────────────────────────────────────────
     事件（全部用 addEventListener —— 行内 onclick 被平台禁止）
     ───────────────────────────────────────────────────────────── */
  // ── 换一个星球 ──
  // 只有设置模式才看得到这个按钮：想换一颗星球就点，随便换多少次。
  // 演化一旦开始它就藏起来 —— 一局没走完不许中途重开。
  // 想换新星球？先点【重置】回设置模式，它就回来了。
  // 显隐由 syncButtons() 统一管，这里只负责动作。
  btnCreate.addEventListener('click', function () {
    createWorld();       // 换一颗全新世界
    setMode('setup');    // 回到设置模式，可以重新调参
    hideEnding();
    hideNaming();        // 双保险：弹窗万一还开着，也一起关掉
    hideChoice();
    hideCivBirth();
    hideGuide();         // ★ 2026-09-21：指南同理
    /* ★ 顺手把字也擦了 —— 换了一颗星球，屏幕上却还飘着**上一颗**的旁白
       （"一团微火落入地表"之类），比留在原地更离谱。
       ⚠️ 这里守着和 btnReset 同一件事，所以 `_wiring_test.js` 里那条断言
          是**两个按钮一起查**的 —— 只修一个的话另一个照样漏。 */
    clearLog();
    clearToast();
    syncButtons();
  });

  // ── 关掉结局面板，继续观察 ──
  // 世界不会因此停下 —— 你还能投放元素、看文明光点铺满。
  btnEndClose.addEventListener('click', hideEnding);

  /* ═══════════════════════════════════════════════════════════════
     档案库  ★ 2026-09-14
     ═══════════════════════════════════════════════════════════════

     它是什么：把走完的世界存下来，以后翻回去看。
     一条 = 一个世界：一颗小星球（存入时截的图）+ 名字 + 评定·命运
     + 文明名·物种。

     ⚠️ 2026-09-14 晚改的：**点开一条不再"装回主界面 + 弹结局卡"了**，
        改成翻出那一界的**记录页**（只读，见下面 showRecord）。
        两条理由：
          ① 用户要的是"读一份记录"，不是"重开那一局"；
          ② 原来那一下会 `world = w`，把玩家主界面正开着的那颗球顶掉。

     ⚠️ **存哪儿是外壳的事，core 一律不管**（这条是用户早就交代过的）。
        core 那边只加了 `WorldGen.stripWorld / restoreWorld` ——
        那是"世界档案长什么样"的知识，本来就归 worldgen 管。

     ⚠️⚠️ 平台规范原文：「localStorage / IndexedDB 均可用，按小工具独立隔离」，
        但**同一段**也写着「数据不保证永久持久化」。所以两条纪律：
          ① 每一处 localStorage 调用都要能失败（隐私模式 / 配额满）
          ② 界面文案上**不许承诺"永久保存"**
     ═══════════════════════════════════════════════════════════════ */

  var ARCHIVE_KEY = 'msj.archive.v1';
  var ARCHIVE_MAX = 100;     // 存到 100 条就不再涨（超了丢最旧的）
  var THUMB_PX    = 96;      // 缩略图边长（实测 JPEG 约 2KB）

  /**
   * 拿 localStorage，拿不到就返回 null。
   * ⚠️ 某些隐私模式下**连读这个属性都会抛异常**，所以必须用 try 包住 ——
   *    不能写成 `window.localStorage || null`。
   */
  function storage() {
    try {
      return (typeof localStorage !== 'undefined') ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  /** 读出整个档案库。读不出来（没存过 / 存坏了 / 不让读）一律当空库。 */
  function archiveLoad() {
    var st = storage();
    if (!st) return [];
    try {
      var list = JSON.parse(st.getItem(ARCHIVE_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  /** 写回档案库。存不下返回 false（配额满了 / 不让写）。 */
  function archiveWrite(list) {
    var st = storage();
    if (!st) return false;
    try {
      st.setItem(ARCHIVE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 把现在这颗球截成一张小图。
   *
   * ⚠️ 为什么要**存图**而不是打开列表时现画：列表里可能有几十条，
   *    每条现画一次 `drawWorld` 是一千多次绘制调用 —— 手机上会卡。
   *    存成图片的话列表就是一堆 `<img>`，秒开。
   *
   * ⚠️ 用 JPEG 不用 PNG：星球是暗底 + 柔和渐变，PNG 压不动
   *    （实测 64×64 就要 9.6KB），JPEG 只要 1.7KB。
   */
  function makeThumb() {
    try {
      var px = THUMB_PX;
      var cv = document.createElement('canvas');
      cv.width = px;
      cv.height = px;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#07070C';
      ctx.fillRect(0, 0, px, px);
      Renderer.drawWorld(ctx, world, px / 2, px / 2, px * 0.44, time);
      return cv.toDataURL('image/jpeg', 0.82);
    } catch (e) {
      return '';     // 截不出来也不能让存档整个失败
    }
  }

  /** 把这一局存进档案库。存不下返回 false。 */
  function archiveCurrent() {
    if (!world || !world.ending) return false;

    var e = world.ending;
    var hasCiv = !!(e.civ && world.evo.civ);

    var entry = {
      v: 1,
      at: Date.now(),

      /* ── 列表要显示的那几项，**摊平存在外面** ──
         ⚠️ 不摊平的话，画一次列表得把每一条的 world 都 JSON.parse 一遍
            （7KB × 100 条），纯属白费。这几项就是给列表用的索引。
            ⚠️ 它们和 world 里的值是同一份数据的两处拷贝 ——
               只在存入那一刻写一次，之后谁都不改，所以不会对不上。 */
      seed: world.seed,
      name: world.name || '',
      rating: e.rating ? e.rating.name : '',
      fate: e.fate ? e.fate.name : '',
      civTitle: e.civ ? e.civ.title : '',
      civProto: e.civ ? e.civ.name : '',
      cycles: hasCiv ? CivLore.cyclesOf(world.evo.civ) : 0,

      thumb: makeThumb(),

      // 真正装回去用的那一份（形状数据已经被 stripWorld 丢掉了）
      world: WorldGen.stripWorld(world)
    };

    var list = archiveLoad();
    list.unshift(entry);                       // 最新的排最前面
    if (list.length > ARCHIVE_MAX) list.length = ARCHIVE_MAX;

    return archiveWrite(list);
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /* ⚠️ 这里原来有一个 `syncArchiveEntry()`（只更新标题右边那个数字）,
     它和 `renderArchive()` 分开，是为了**启动时不去建那个上百张图的列表**。

     2026-09-14 用户把入口挪到按钮下面、名字固定成「观察记录」之后，
     入口上**不再有会变的东西**，这个函数就没有存在的理由了 ——
     整个删掉。列表仍然只在玩家真点开档案库时才建。 */
  function renderArchive() {
    var list = archiveLoad();

    /* ★ 2026-09-16：把上限写出来（用户要的「让用户知道只能存 100 界」）。
       ⚠️ 数字**必须读 ARCHIVE_MAX**，不许写死 100 ——
          写死的话，哪天把上限调到 200，这里会**静默**地说着旧数字
          （本项目在"两把尺子"上栽过好几次）。
       ★ 一条都没存的时候也显示（只显示上限那半句）——
          不然新玩家在存第一个之前，根本不知道有上限这回事。
       ⚠️ **100 是满的、会顶掉最旧的**，这件事界面上仍然不说（用户 2026-09-16 拍板）。
          见 CLAUDE.md 决策 #91。 */
    elArchCount.textContent = list.length
      ? ('已存 ' + list.length + ' 界 · 最高可存 ' + ARCHIVE_MAX + ' 界')
      : ('最高可存 ' + ARCHIVE_MAX + ' 界');

    elArchList.innerHTML = '';

    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'arch-empty';
      empty.textContent = '还没有存过任何世界。走到结局之后，' +
                          '在结局卡片上点【存入档案库】，就会出现在这里。';
      elArchList.appendChild(empty);
      return;
    }

    list.forEach(function (en, idx) {
      /* ⚠️ 坏条目**直接跳过**：localStorage 里万一混进一条 null
         （旧版本存的、被外面改过的），下面 `en.thumb` 就会抛异常 ——
         而这一抛，**整个档案库都打不开**（不是"少一条"，是全没了）。
         概率极低，但兜底只要一行。 */
      if (!en) return;

      var row = document.createElement('div');
      row.className = 'arch-item';

      if (en.thumb) {
        var img = document.createElement('img');
        img.className = 'arch-thumb';
        img.alt = '';
        img.src = en.thumb;
        row.appendChild(img);
      } else {
        // 截图失败过（极少）—— 用一个空圆占位，别留一个破图
        var ph = document.createElement('div');
        ph.className = 'arch-thumb';
        row.appendChild(ph);
      }

      var body = document.createElement('div');
      body.className = 'arch-body';

      var nm = document.createElement('div');
      nm.className = 'arch-name';
      nm.textContent = en.name || en.seed || '未命名';

      var mt = document.createElement('div');
      mt.className = 'arch-meta';
      mt.textContent = [en.rating, en.fate].filter(Boolean).join(' · ');

      var sb = document.createElement('div');
      sb.className = 'arch-sub';
      var sub = [en.civTitle, en.civProto].filter(Boolean).join(' · ');
      sb.textContent = sub ? (sub + ' · ' + fmtDate(en.at)) : fmtDate(en.at);

      body.appendChild(nm);
      body.appendChild(mt);
      body.appendChild(sb);
      row.appendChild(body);

      var del = document.createElement('button');
      del.className = 'arch-del';
      del.type = 'button';
      del.textContent = '✕';
      del.setAttribute('aria-label', '删除这一条');
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();      // ⚠️ 不拦住的话会顺带触发"打开这一条"
        archiveDeleteAt(idx);
      });
      row.appendChild(del);

      row.addEventListener('click', function () { openArchiveAt(idx); });
      elArchList.appendChild(row);
    });
  }

  /**
   * 删掉第 idx 条。
   * ⚠️ 按**下标**删，不按时间戳 —— 同一毫秒存两条的话时间戳会撞。
   *    下标是渲染那一刻记下的；列表只由这个面板改，所以对得上。
   */
  function archiveDeleteAt(idx) {
    var list = archiveLoad();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    archiveWrite(list);
    renderArchive();
  }

  /** 点开一条：把它装回主界面，连结局卡一起重新弹出来 */
  /** 点开一条：翻出那一界的**记录页**（只读，什么都不碰） */
  function openArchiveAt(idx) {
    var list = archiveLoad();
    if (idx < 0 || idx >= list.length) return;
    /* ⚠️ 和 `renderArchive` 里那条同源：坏条目（null）不能喂给 `showRecord` ——
       它里面会直接读 `w.ending`，抛出去的表现是「**点了没反应**」，
       最难查的那种。给一句 toast，至少玩家知道发生了什么。 */
    if (!list[idx]) { showToast('这条档案读不出来了'); return; }
    showRecord(list[idx]);
  }

  /* ═══════════════════════════════════════════════════════════════
     记录页  ★ 2026-09-14 晚
     ═══════════════════════════════════════════════════════════════

     一个文明的完整全史。从档案库点开一条时翻出来，**只读**。

     ⚠️⚠️ 和原来那条路最大的区别：**不装世界、不碰 `world` 变量**。
        原来点开一条是 `world = w`，会把玩家主界面正开着的那颗球顶掉；
        现在这一页什么都不碰，看完收掉就回到原样。

     ⚠️ `WorldGen.restoreWorld` 只在这里**临时**用一下 —— 为了拿到
        "由种子重烘"的斑块数据好画那颗球（存档时那两块被扔掉了，
        见 worldgen.js 的 stripWorld）。用完就扔，不赋给 `world`。

     ⚠️ 排版**全部复用结局面板那一整套类**（.end-sec / .end-sec-title /
        .end-row / .end-k / .end-v / .end-line / .ending-civname /
        .ending-civrows / .ending-bio），编年史那六种行样式（.chron-row）
        也是现成的 —— 新写的只有 style.css 里 `.record` 那层容器。
        **这个文件里不该出现 .record-sec / .record-row 这种重复发明。**
     ═══════════════════════════════════════════════════════════════ */

  function recEl(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }

  /** 一行「标签　值」—— 版式归 .end-row / .end-k / .end-v 管 */
  function recKv(k, v) {
    var d = recEl('div', 'end-row');
    d.appendChild(recEl('span', 'end-k', k));
    d.appendChild(recEl('span', 'end-v', v));
    return d;
  }

  /** 一节「── 标题 ──」 */
  function recSection(title) {
    var s = recEl('div', 'end-sec');
    s.appendChild(recEl('div', 'end-sec-title', title));
    return s;
  }

  /**
   * 把那一界的星球画到记录页的 canvas 上。
   *
   * ⚠️ 这**只是一张图** —— 画完就扔，不是"活的世界"。
   *    用户 2026-09-14 的原话：「星球就单存的留个图片，不是留之前的数据」。
   *
   * ⚠️ `time` 传一个定值，**不用** app.js 那个一直在涨的 `time` ——
   *    不然同一个档案每次打开，星点闪烁的位置都不一样，不像"档案"。
   */
  function drawRecordPlanet(w) {
    var cv = elRecordPlanet;
    var px = cv.width || 420;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#07070C';
    ctx.fillRect(0, 0, px, px);
    try {
      Renderer.drawWorld(ctx, w, px / 2, px / 2, px * 0.44, 1.7);
    } catch (e) {
      /* 画不出来就留一块深色底 —— 不能让整页打不开 */
    }
  }

  /**
   * 把四节内容填进 #record-body。
   *
   * ⚠️⚠️ **哪几节出现是变的** —— 没走到文明的世界只有「星球」和「记录全文」。
   *     没有就是没有，不许编：「存活周期」是"从第一处聚居点算起"的，
   *     没长出文明就没有这个数，硬填一个就是假话。
   *     （和结局面板里 `if (result.civ)` 那两处判断是同一条规矩。）
   */
  function fillRecordBody(w) {
    elRecordBody.innerHTML = '';

    /* ⚠️⚠️ `|| {}` 是**兜底，不是装饰** ⚠️⚠️（2026-09-17 质量体检抓出来的）

       下面好几处**直接就读** `e.rating` / `e.ratingLine` / `e.bio`。
       档案一旦坏掉（旧版本存的、被外面改过的、localStorage 清了一半），
       `w.ending` 就是 undefined —— 读它的属性会**抛异常**，
       而点击那条路（`openArchiveAt` → `showRecord`）**没有 try/catch**，
       于是玩家看到的是「**点了没反应**」—— 最难查的那种表现。

       作者其实想到了坏档案：同一个函数的 `restoreWorld` 返回 null 时
       是有 toast 兜底的，**只漏了 `ending` 这一路**。
       加这一个 `|| {}`，三处读取**全都安全了**（读不到就是空字符串，
       该节不出现 —— 这正是本函数"没有就是没有，不许编"那条规矩要的）。 */
    var e = w.ending || {};
    var hasCiv = !!(e.civ && w.evo && w.evo.civ);
    var c = hasCiv ? w.evo.civ : null;

    /* ── 星球 ── */
    var s1 = recSection('── 星球 ──');
    s1.appendChild(recKv('评定', (e.rating && e.rating.name) || '——'));
    if (e.ratingLine) s1.appendChild(recEl('p', 'end-line', e.ratingLine));
    s1.appendChild(recKv('种子', w.seed || '——'));
    elRecordBody.appendChild(s1);

    if (hasCiv) {
      /* ── 文明 ── */
      var s2 = recSection('── 文明 ──');
      s2.appendChild(recEl('div', 'ending-civname',
        (w.civ && w.civ.isEgg ? '⚡ ' : '') + Civ.displayName(w)));

      /* 原型 / 特质 / 倾向 —— 和「文明诞生」面板、结局卡**同序同源**。
         ⚠️ 观测异常那三种的 form / temper 都是 null，这两项会自动不出现。 */
      var p = civPartsOf(w) || { proto: null, form: null, temper: null };
      var rowsBox = recEl('div', 'ending-civrows');
      [[Civ.ROW_LABELS.proto, p.proto], [Civ.ROW_LABELS.form, p.form],
       [Civ.ROW_LABELS.temper, p.temper]].forEach(function (r) {
        if (!r[1]) return;
        var sp = document.createElement('span');
        sp.appendChild(document.createTextNode(r[0] + ' '));
        var b = document.createElement('b');
        b.textContent = r[1].name;
        sp.appendChild(b);
        rowsBox.appendChild(sp);
      });
      s2.appendChild(rowsBox);

      s2.appendChild(recKv('命运', (e.fate && e.fate.name) || '——'));
      if (e.fate && e.fate.desc) s2.appendChild(recEl('p', 'end-line', e.fate.desc));

      /* ⚠️ 走 `numToCn`（= CivLore.cnNum），**不自己再写一个** ——
          传记末尾那句「共计 N 个周期」用的是同一个函数，
          两套实现算出来的字不一样的话，同一页上就会对不上。 */
      s2.appendChild(recKv('存活周期', numToCn(CivLore.cyclesOf(c))));
      elRecordBody.appendChild(s2);

      /* ── 编年史全文 ──
         ⚠️ 六种行样式**直接复用** .chron-row 那一套，一行 CSS 都不用新写。
            它们必须长得不一样 —— 玩家要能一眼分出
            "发生过的事 / 不好的兆头 / 他们自己的决定 / 你下的手"。 */
      var s3 = recSection('── 编年史 ──');
      var body = recEl('div', 'record-chron');
      (c.rows || []).forEach(function (r) {
        body.appendChild(recEl('div', 'chron-row ' + r.kind, r.text));
      });
      s3.appendChild(body);
      elRecordBody.appendChild(s3);
    }

    /* ── 记录全文（传记）── */
    var s4 = recSection('── 记录全文 ──');
    s4.appendChild(recEl('p', 'ending-bio', e.bio || ''));
    elRecordBody.appendChild(s4);
  }

  /** 翻开记录页。`entry` 是档案库里的那一条。 */
  function showRecord(entry) {
    var w = WorldGen.restoreWorld(entry.world);
    if (!w) {
      showToast('这条档案读不出来了');
      return;
    }

    drawRecordPlanet(w);
    fillRecordBody(w);
    elRecord.className = 'record show';
  }

  function hideRecord() {
    elRecord.className = 'record';
  }

  /* ── 记录页的两个出口 ──
     ⚠️⚠️ 这一层整屏盖住：点外面没反应、没有 Esc、刷新丢页面 ——
        底部这两颗是**全屏唯一的出口**，一颗都不许少。
        `_wiring_test.js` 有一条断言钉着。

     ⚠️ 【返回列表】**不关档案库** —— 它一直开着，收掉上面这一层就露出来了。
        这样玩家可以接着翻下一条，不用重新点【观察记录】。 */
  btnRecordBack.addEventListener('click', function () {
    hideRecord();
  });

  // 【回主界面】才是"整个退出去"
  btnRecordHome.addEventListener('click', function () {
    hideRecord();
    closeArchive();
  });

  /* 【清空】要**点两下**：第一下把按钮变成「确定清空？」，
     第二下才真清。
     ⚠️ 故意不用 `window.confirm` —— 它虽然平台允许，但一屏深色界面里
        弹一个系统白框很出戏。两下确认一样防手滑，还不用管计时器。 */
  var clearArmed = false;

  function resetClearButton() {
    clearArmed = false;
    btnArchClear.textContent = '清空';
    btnArchClear.className = 'btn archive-clear';
  }

  function openArchive() {
    resetClearButton();
    renderArchive();
    elArchive.className = 'archive show';
  }

  function closeArchive() {
    elArchive.className = 'archive';
  }

  btnArchive.addEventListener('click', openArchive);
  btnArchClose.addEventListener('click', closeArchive);

  btnArchClear.addEventListener('click', function () {
    if (!clearArmed) {
      clearArmed = true;
      btnArchClear.textContent = '确定清空？';
      btnArchClear.className = 'btn archive-clear armed';
      return;
    }
    archiveWrite([]);
    resetClearButton();
    renderArchive();
    showToast('档案库已清空');
  });

  /* ── 【存入档案库】──
     ⚠️ 存过一次之后按钮就废掉（`endArchived` 标记）——
        连点两下会存进去**两条一模一样的**，列表里看着像出了 bug。
        这个标记由 showEnding() 每次重置。 */
  var endArchived = false;

  btnEndArchive.addEventListener('click', function () {
    if (!world || !world.ending || endArchived) return;

    if (!archiveCurrent()) {
      showToast('存不进去了 · 浏览器可能不让存');
      return;
    }

    endArchived = true;
    btnEndArchive.textContent = '已存入 ✓';

    /* ⚠️ 这里**不发提示** —— "开始下一轮"那条由 `showEnding()` 在**结局弹出的
       那一刻**就挂上去了，而且常驻。在这儿再发一次只会把它重置一遍。
       这一颗的反馈就是按钮自己变成「已存入 ✓」（见上面那段）。
       ⚠️⚠️ 而且这条提示**不能**指向【观察记录】：那颗按钮带 `setup-only`，
           **观察模式里根本不显示**（用户 2026-09-14 定稿的，见 index.html
           底部按钮排那段）—— 结局这一屏正是观察模式，底部只有【暂停/继续】
           和【重置】。提示只能指向真在屏幕上的那颗，否则玩家照着找，找不到。 */
  });

  // ── 【继续观察】关掉「文明诞生」面板 ──
  // 关了之后世界才开始走文明发展期（60~120 秒）。
  // ⚠️ 顺序要紧：先 hideCivBirth 再 civBegin。
  //    反过来的话，这一帧里世界已经解冻开始跑了，而面板还盖着 ——
  //    虽然只差一帧，但逻辑上"面板关掉"应该先发生。
  btnCivGo.addEventListener('click', function () {
    if (!world) return;
    startCivDevelop();
    syncButtons();
  });

  /* ── 文明命名：改字 / 换一个 / 回车 ──

     ⚠️ 这三条**都没在 input 上** —— 名字是在【继续观察】那一刻才存进
        world.civ.title 的（startCivDevelop 里）。打字的过程中世界档案
        一个字都没动，所以"玩家打了一半又把面板关了"不会留下半个名字。 */

  btnCivRoll.addEventListener('click', rerollCivName);

  // 在输入框里按回车 = 点【继续观察】（和世界名那边的做法一致）
  elCivName.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnCivGo.click();
    }
  });

  // ── 【继续】关掉岔路口的结果视图，这时答案才落地 ──
  // ⚠️ 只在这里绑一次，不在 showChoiceResult 里绑（那里绑会重复绑定）。
  // ⚠️ 这个按钮是玩家在结果视图期间**唯一的出口** ——
  //    .choice 是 z-index 15 的整屏浮层，底下的按钮全被盖住，
  //    没有 Esc、没有点击背景关闭、刷新会丢世界。
  //    所以 _wiring_test.js 里有一条断言专门盯着"它到底绑没绑"。
  btnChGo.addEventListener('click', onChoiceGo);

  /**
   * 真正开始演化：切到观察模式 + 让世界跑起来。
   * 由命名弹窗的【开始演化】调用 —— 名字起好了才走到这里。
   */
  function startEvolution() {
    hideNaming();
    setMode('watch');            // 切过去之后本源那一节就藏起来了 —— 数值看不了也改不了
    lastStuckText = null;        // 重新开始时，卡住的提示可以再弹一次

    /* ★ 2026-09-21：开局先弹**观测指南**，玩家点【确认接入】世界才跑。

       ⚠️⚠️ 顺序：先 `world.running = false`，再决定弹不弹 ⚠️⚠️
          主循环的闸门是 `var frozen = !world.running`（见 frame()）。
          不显式置 false 的话：玩家点过【重置】再点【开始演化】时
          `world.running` 还是上一局的 true —— 指南还开着，世界里已经在涨潮了。

       ⚠️ 点过【略过指南，不再提示】的，直接开跑（`guideSkipped()` 去查 localStorage）。
          所以下面这两行**必须成对**：要么弹指南、要么把 running 打开，
          漏了 else 那半边就是"指南不弹了，世界也永远不动"——
          界面不报错，玩家只看到一颗死掉的星球。 */
    world.running = false;
    if (guideSkipped()) world.running = true;
    else                showGuide();

    syncButtons();
  }

  // ── 演化 / 暂停 / 继续 ──
  // 同一个按钮，标签随状态变（见 syncButtons）。
  //
  // 第一次点：先弹命名窗口，起好名字才开跑。
  // 之后点：暂停 / 继续。
  //
  // ⚠️ 已经有名字的世界（比如点【重置】回到设置模式，又点一次演化）
  //    不再弹窗 —— 重置是"这颗世界重跑一遍"，不是"换一颗"，
  //    名字跟着世界走。
  btnEvolve.addEventListener('click', function () {
    if (!world) return;

    if (mode === 'setup') {
      if (!world.name) showNaming();   // 新世界：先起名
      else startEvolution();           // 已经起过名了：直接开跑
    } else {
      world.running = !world.running;  // 观察模式里就是纯粹的 暂停 / 继续
      lastStuckText = null;
      syncButtons();
    }
  });

  /* ── 命名弹窗的三个按钮 ── */

  // 【开始演化】—— 把输入框里的名字记下来，然后开跑
  btnNameGo.addEventListener('click', function () {
    if (!world) return;

    var v = elNameIn.value.trim();
    // 万一玩家把输入框清空了：退回用推荐名（页面上不出现"未命名"这种出戏的字眼）
    world.name = (v || suggestName(world.seedNum, nameRoll)).slice(0, NAME_MAX);

    refreshInfo();
    startEvolution();
  });

  // 【换一个】—— 换一批推荐名（不影响已经起好的名字）
  btnNameRoll.addEventListener('click', function () {
    if (!world) return;
    nameRoll++;
    elNameIn.value = suggestName(world.seedNum, nameRoll);
    elNameIn.focus();
    elNameIn.select();
  });

  // 【返回】—— 不开始了，退回设置模式继续调参
  btnNameBack.addEventListener('click', hideNaming);

  /* ── 观测指南的两颗按钮（★ 2026-09-21）──
     ⚠️ 两颗都是"关掉指南并开跑"，差别只有一个：右边那颗**顺手把指南永久关掉**。
        所以走同一个 `closeGuide(skipAll)`，不要各写一遍 ——
        各写一遍的话，"开跑要做的那几件事"（running / lastStuckText /
        syncButtons）就有两份，迟早只改一处。 */
  btnGuideGo.addEventListener('click',   function () { closeGuide(false); });
  btnGuideSkip.addEventListener('click', function () { closeGuide(true);  });

  // 在输入框里按回车 = 点【开始演化】
  //（没有 <form>，所以不存在"表单提交跳转"，纯键盘便利）
  elNameIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnNameGo.click();
    }
  });

  // ── 重置 ──
  // 世界退回混沌初始态：外观和本源初始值都保留，不重新随机。
  // 回到设置模式，这样可以重新调参再演化一遍同一颗世界。
  btnReset.addEventListener('click', function () {
    if (!world) return;
    Evolution.reset(world);          // 演化进度归零
    WorldGen.resetEssence(world);    // 本源恢复初始值
    world.evo.rotation = 0;          // 自转角度也归零

    /* ★ 世界名也一起清掉（2026-09-14 用户改的）。

       ⚠️⚠️ 这条**推翻了当初的决定 #8** ——
          原来写的是「重置是"这颗世界重跑一遍"，不是换一颗，名字跟着世界走」。
          用户报的原话：「点击重置后上一个星球的名字会留在页面上」。

       ⚠️ 为什么必须**清掉**而不是"只隐藏显示"：
          不清的话 `world.name` 还有值，再点【开始演化】就**不会再问名字**，
          世界会顶着一个**你在界面上看不到的名字**跑起来 ——
          那就是典型的"看着像功能，其实是摆设"。

       ⚠️ 放在外壳（这里）而不是 `Evolution.reset` 里：
          `world.name` 是外壳的字段（core 从来不读它，见数据结构那节），
          清哪个字段归谁管。和旁边那行 `WorldGen.resetEssence` 是同一个分工。

       ⚠️ 清掉之后，名字槽在设置模式下就**永远是空的**了
          （另一条路 `createWorld` 也会清）。所以 CSS 里
          `body.mode-setup .info-name:empty { display: none }` 把它收掉 ——
          留一个永远空着的 34px 在那儿纯浪费。 */
    world.name = null;

    lastStuckText = null;
    hideEnding();                    // 关掉结局面板（如果还开着）
    hideChoice();                    // 岔路口选择框也一样
    hideCivBirth();                  // 文明诞生面板也一样
    hideGuide();                     // ★ 2026-09-21：指南也一样（它接在命名后面弹）
    /* ★ 2026-09-21 修 BUG：把屏幕上的字也清掉。
       ⚠️⚠️ 上面那三行是"关面板"，这两行是"擦字"—— **两类事，别混**。
          观察日志和顶栏那条提示都不是浮层（一个浮在 .stage 里、
          一个就在顶栏上），`hideXxx()` 那套对它们不适用。
          用户报的就是这个：点完元素屏幕上飘着字，一按【重置】，
          字还留在那儿 —— 因为**从来没人清过它**。 */
    clearLog();
    clearToast();
    setMode('setup');
    refreshInfo();
    syncButtons();
  });

  /* ── 本源**只能看，不能调**（2026-09-13 用户拍的）──

     ⚠️⚠️ 这里原来有一个 input 监听器，拖动滑杆会直接改 world.essence。
         2026-09-13 **整个删掉**；2026-09-17 连那根滑杆本身也删了。

     ── 为什么不能调（用户的原话）──
       「如果杠杆能拖动的话，每个新生成的星球就不存在差异化了」

       拖得动的话，玩家会把每一颗都捏成同一个样子 ——
       水少了拉水、太热了把能量拉低。于是【换一个星球】这个动作
       就失去了意义：开出来的永远是同一颗世界。

       而「每颗世界有自己的命」是这个游戏的地基 ——
       它决定长得出来什么文明、走得到哪个结局、
       甚至能不能撑到文明阶段。**把本源定死 = 把世界还给世界。**

     ── 2026-09-17 为什么连控件本身也换掉 ──
       只删监听器、只关指针事件**不够**。原来那根
       `<input type="range">` 长得和能拖的滑杆一模一样，
       审核员伸手去拖、拖不动，判了个「**小工具功能缺陷**」。
       外观还在骗人，手指就还是会去按。

       所以换成 `<span class="row-bar">`：一条纯图形的读数条，
       没有白色小方块，**没有任何"可以拖"的暗示**。
       它现在是一根**读数**，不是**旋钮**。

     ⚠️ 数值照旧一眼看得出（用亮条长度 + 右边的数字）——
        那才是当初要留着它的目的（决策 #72）。

     ⚠️ **不要再换回 `<input>`**（哪怕加 `disabled` —— 那还是在屏幕上
        摆一个"控件"）。`_wiring_test.js` 有断言守着两件事：
        ① index.html 的本源那一节里不许出现 `<input>`
        ② app.js 里不许给读数条挂监听器

     ⚠️ **时间流速不在这里** —— 它从来就不是滑杆，是按键（见 index.html）。
        玩家仍然能决定"看快看慢"，只是不能决定"世界长什么样"。 */

  // 尺寸变化时重算。
  // ⚠️ 两个都要监听，各管一半 ——
  //   · window resize / orientationchange：盯**视口**。
  //     画布是整屏铺满的，窗口一变画布就得跟着变。
  //     （电脑上把窗口拉宽时，.stage 因为 max-width 没变，
  //       ResizeObserver 不会触发，只有这个能捕获到）
  //   · ResizeObserver 盯 **.stage**：布局变化。
  //     横竖屏切换、软键盘弹出这类情况，它比 window resize 更准。
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(stage);
  }

  /* ─────────────────────────────────────────────────────────────
     启动
     ───────────────────────────────────────────────────────────── */
  // 先把界面骨架建出来 —— createWorld 里的 refreshInfo 要用到它们
  buildStageBar();
  buildReadout();
  buildSpeeds();
  buildPalette();

  setMode('setup');    // 一进来是设置模式：先调参数，再点【演化】
  resize();
  createWorld();       // 先给一颗世界，不用玩家先点
  setSpeed(1);         // 默认 1 倍速

  /* ⚠️ 启动时**不碰档案库**。
     入口（底部的【观察记录】）是写死在 HTML 里的，名字固定、一直显示，
     没有需要初始化的东西；列表等玩家真点开再建 —— 那时才需要把
     上百张缩略图的 `<img>` 塞进 DOM。 */
  requestAnimationFrame(frame);

})();
