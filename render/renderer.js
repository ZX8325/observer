/* ═══════════════════════════════════════════════════════════════════
   ⑩ Renderer —— 绘制模块
   ═══════════════════════════════════════════════════════════════════
   职责：把世界档案画到 canvas 上。只管画画，不管游戏逻辑。

   铁律 A：零资源依赖 —— 不加载任何图片/字体/音频，一切靠代码画。
   铁律 B：只依赖传进来的那个 canvas 对象，不碰 document / window。
           这样同一份文件在网页和小组件里都能跑。

   ⚠️ 更正：早期版本的注释里写着
      「小红书禁用 CSS 的 shadow / gradient / blur / glow，
        所以光晕渐变必须用 Canvas 画」——
      那是**「小组件」的限制，不是「小工具」的**（小工具的 CSS 是完整的）。

      本模块仍然只用 Canvas API 画光晕和渐变，但理由变成了：
        ① 本模块拿不到 DOM，只依赖传进来的那个 canvas 对象；
        ② Canvas 渐变比 CSS 更可控 —— 能跟着世界一起转、一起缩放。
   ═══════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Renderer = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     颜色工具
     ═══════════════════════════════════════════════════════════════ */

  /**
   * HSL → CSS 颜色字符串。
   *
   * 为什么不直接用 canvas 支持的 'hsl(200,30%,40%)' 字符串？
   * 因为小程序端的颜色解析偶尔有差异，自己算成 rgb() 最保险，跨平台零风险。
   *
   * @param {number} h 色相 0-360
   * @param {number} s 饱和度 0-100
   * @param {number} l 亮度 0-100
   * @param {number} [a] 透明度 0-1，不填就是不透明
   */
  function hsl(h, s, l, a) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;

    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;

    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    if (a === undefined || a >= 1) return 'rgb(' + r + ',' + g + ',' + b + ')';
    return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.max(0, a) + ')';
  }

  /* ⚠️ 这里原来有一个 `LIGHT_ANGLE = -Math.PI * 0.75`（太阳在左上角，
     用 canvas 的二维坐标表示），用途是决定裂谷哪一面崖壁被照亮。

     ★ 2026-09-13 改成球面投影之后**删掉了** —— 二维角度表达不了
       "光照方向 vs 球面上某一点的法线"，换成了三维的 `LIGHT_DIR`
       （见下面「球面投影」那一节，它是相机空间里的一个单位向量）。
       两套并存会让人不知道该看哪一个，所以旧的直接删，不留着。 */

  /* ═══════════════════════════════════════════════════════════════
     十六进制颜色的处理
     ═══════════════════════════════════════════════════════════════
     元素的颜色是用 '#E86A58' 这种写的（跟 CSS 一致，方便调），
     但要往渐变里塞透明度就得拆成 rgb 分量。
     ═══════════════════════════════════════════════════════════════ */

  /** '#RRGGBB' → [r, g, b] */
  function hex2rgb(hex) {
    var h = String(hex).replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ];
  }

  /** '#RRGGBB' + 透明度 → 'rgba(...)' */
  function rgba(hex, a) {
    var c = hex2rgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' +
           Math.max(0, Math.min(1, a)) + ')';
  }

  /* ═══════════════════════════════════════════════════════════════
     投放的影响斑
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 画所有投放过的元素影响斑。
   *
   * ⚠️ 影响斑**不跟着世界自转**。
   *    物理上它应该跟着转（毕竟是投在地表上的），
   *    但那样玩家投下去之后光斑会满屏幕跑，根本没法用。
   *    所以固定在"以世界圆心为原点"的坐标系里。
   */
  /* 光斑寿命走到百分之多少时，开始"散开融入"。
     前面的时间正常发光（让人看清投了什么），
     后面的时间一边往外胀、一边变淡，直到被星球"吸"进去。

     0.45 → 配合 DROP_LIFE = 5 秒：
            前 2.25 秒清晰发光，后 2.75 秒散开融入，总共 5 秒。
     如果调小（比如 0.3），散开的过程会更长、更慢；
     调大（比如 0.7）就是"亮一下就迅速融进去"。 */
  var DISSOLVE_FROM = 0.45;

  function drawDrops(ctx, world, cx, cy, R, time) {
    var drops = world.drops;
    if (!drops || !drops.length) return;

    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      if (!d.color) continue;

      // ── 算"融入进度"：0 = 正常发光，1 = 已经完全融进星球 ──
      var dissolve = 0;
      if (d.visLife) {
        if (d.age >= d.visLife) continue;        // 已经融进去了，不再画
        var start = d.visLife * DISSOLVE_FROM;
        if (d.age > start) dissolve = (d.age - start) / (d.visLife - start);
      }
      // 注意：这里只是"不再画光斑"。
      // 影响斑本身还在 world.drops 里，**数值影响一直有效** ——
      // 元素是真的融进星球了，不是被删掉了。

      var px = cx + d.x * R;
      var py = cy + d.y * R;

      // 刚投放时"炸开"：0.5 世界秒内从 0.35 倍涨到 1 倍
      var grow = Math.min(1, d.age / 0.5);
      var ease = 1 - Math.pow(1 - grow, 3);      // 先快后慢，像真的炸开

      // ── 散开融入 ──
      // ⚠️ 关键在**半径往外胀**，不能只降透明度。
      //    只降透明度 = "原地变透明" = 看起来像被删掉了；
      //    胀开之后再消失，才像被地表吸收进去。
      //    透明度用平方衰减，最后一刻消失得更干脆
      //    （用一次方会拖一条很淡的尾巴，看着脏）。
      var spread = 1 + dissolve * 1.9;           // 半径最多胀到 2.9 倍
      var fade   = 1 - dissolve * dissolve;

      var pr = d.r * R * (0.35 + 0.65 * ease) * spread;

      // 呼吸：让光斑一直是"活的"，不是死贴在那儿
      var breathe = (0.86 + 0.14 * Math.sin(time * 1.6 + i * 1.7)) * fade;

      drawOneDrop(ctx, d, px, py, pr, breathe);
    }
  }

  function drawOneDrop(ctx, d, px, py, pr, breathe) {
    var vis = d.vis || 'bloom';
    if (vis === 'ripple')       drawRipple(ctx, d, px, py, pr, breathe);
    else if (vis === 'shatter') drawShatter(ctx, d, px, py, pr, breathe);
    else if (vis === 'shrink')  drawShrink(ctx, d, px, py, pr, breathe);
    else if (vis === 'flash')   drawFlash(ctx, d, px, py, pr);
    else                        drawBloom(ctx, d, px, py, pr, breathe);
  }

  /** 向外扩散的柔光（火种 / 土石 / 光种 / 流星雨） */
  function drawBloom(ctx, d, px, py, pr, breathe) {
    var g = ctx.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0,    rgba(d.color, 0.16 * breathe));
    g.addColorStop(0.35, rgba(d.color, 0.30 * breathe));
    g.addColorStop(0.75, rgba(d.color, 0.12 * breathe));
    g.addColorStop(1,    rgba(d.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();

    // 一圈一圈往外推 —— 让它读起来是"在扩散"而不是静止的一团光
    var pulse = (d.age * 0.42 + d.x * 0.3) % 1;      // 0→1 循环
    var rr = pr * (0.45 + pulse * 0.65);
    ctx.strokeStyle = rgba(d.color, (1 - pulse) * 0.30 * breathe);
    ctx.lineWidth = Math.max(1, pr * 0.045);
    ctx.beginPath();
    ctx.arc(px, py, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 一圈圈荡开的涟漪（水珠 / 酸雨） */
  function drawRipple(ctx, d, px, py, pr, breathe) {
    // 三圈错开的涟漪
    for (var k = 0; k < 3; k++) {
      var t = (d.age * 0.5 + k / 3) % 1;
      var rr = pr * (0.18 + t * 0.85);
      ctx.strokeStyle = rgba(d.color, (1 - t) * 0.45 * breathe);
      ctx.lineWidth = Math.max(1, pr * 0.055);
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 中心一团冷光
    var g = ctx.createRadialGradient(px, py, 0, px, py, pr * 0.55);
    g.addColorStop(0, rgba(d.color, 0.42 * breathe));
    g.addColorStop(1, rgba(d.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, pr * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 锐利的放射冷光（冰晶） */
  function drawShatter(ctx, d, px, py, pr, breathe) {
    var N = 7;
    ctx.strokeStyle = rgba(d.color, 0.40 * breathe);
    ctx.lineWidth = Math.max(1, pr * 0.04);
    ctx.lineCap = 'round';

    for (var k = 0; k < N; k++) {
      var a = (k / N) * Math.PI * 2 + d.age * 0.45;
      var r0 = pr * 0.22;
      // 长短参差，看起来才"锐利"而不是整齐的一圈
      var r1 = pr * (0.55 + 0.35 * Math.sin(d.age * 2.2 + k * 1.3));
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(a) * r0, py + Math.sin(a) * r0);
      ctx.lineTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1);
      ctx.stroke();
    }

    var g = ctx.createRadialGradient(px, py, 0, px, py, pr * 0.4);
    g.addColorStop(0, rgba(d.color, 0.50 * breathe));
    g.addColorStop(1, rgba(d.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, pr * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 向内收缩的暗紫光（暗种） */
  function drawShrink(ctx, d, px, py, pr, breathe) {
    // 一团沉在底下的暗色
    var g = ctx.createRadialGradient(px, py, 0, px, py, pr * 0.8);
    g.addColorStop(0, rgba(d.color, 0.34 * breathe));
    g.addColorStop(0.6, rgba(d.color, 0.16 * breathe));
    g.addColorStop(1, rgba(d.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, pr * 0.8, 0, Math.PI * 2);
    ctx.fill();

    // 一圈从外往里收的光环 —— 和"扩散"正好相反
    var t = (d.age * 0.55 + d.y * 0.3) % 1;
    var rr = pr * (1.0 - t * 0.72);
    ctx.strokeStyle = rgba(d.color, t * 0.42 * breathe);
    ctx.lineWidth = Math.max(1, pr * 0.065);
    ctx.beginPath();
    ctx.arc(px, py, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 闪电：一下闪爆，然后迅速消失（雷种） */
  function drawFlash(ctx, d, px, py, pr) {
    // 越接近寿命终点越暗 —— 所以看起来是"啪"一下就没
    var k = 1 - Math.min(1, d.age / (d.life || 0.45));
    k = k * k;                                   // 平方衰减，灭得更干脆

    var g = ctx.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0,    'rgba(255,255,255,' + (0.85 * k) + ')');
    g.addColorStop(0.25, rgba(d.color, 0.55 * k));
    g.addColorStop(1,    rgba(d.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ═══════════════════════════════════════════════════════════════
     星空背景
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 造一片星空。
   * 星点数量跟着画布大小走，屏幕越大星星越多。
   */
  function makeStars(rng, w, h) {
    var count = Math.round((w * h) / 5200);
    count = Math.max(70, Math.min(240, count));   // 夹在 70~240 之间，防止极端屏幕

    var stars = [];
    for (var i = 0; i < count; i++) {
      // 少量星星带一点暖色或冷色（全是纯白会显得很假）。
      // ⚠️ 不带颜色的星星必须把**饱和度设成 0**，
      //    否则 hue 默认值 0 会让所有星星泛红。
      var tinted = rng() < 0.20;
      stars.push({
        x: rng() * w,
        y: rng() * h,
        r: 0.4 + rng() * 1.4,
        base: 0.22 + rng() * 0.58,          // 基础亮度
        amp: 0.10 + rng() * 0.26,           // 闪烁幅度
        speed: 0.4 + rng() * 1.6,           // 闪烁快慢
        phase: rng() * Math.PI * 2,
        big: rng() < 0.12,                  // 大星星才画光晕
        hue: tinted ? (rng() < 0.5 ? 32 : 208) : 0,
        sat: tinted ? 45 : 0
      });
    }
    return stars;
  }

  /**
   * 画星空。
   * @param {number} time 世界时间（秒），用来算闪烁
   */
  function drawStars(ctx, stars, time) {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = s.base + Math.sin(time * s.speed + s.phase) * s.amp;
      if (a < 0.03) a = 0.03;

      // 大星星：外圈一圈淡淡的光晕（用 Canvas 渐变画，不是 CSS）
      if (s.big) {
        var gr = s.r * 4.5;
        var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, gr);
        g.addColorStop(0, hsl(s.hue, s.sat + 10, 92, a * 0.55));
        g.addColorStop(1, hsl(s.hue, s.sat + 10, 92, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, gr, 0, Math.PI * 2);
        ctx.fill();
      }

      // 星点本体：用 fillRect 画小方块，比 arc 快很多，这么小看不出来
      ctx.fillStyle = hsl(s.hue, s.sat, 95, a);
      ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     世界
     ═══════════════════════════════════════════════════════════════ */

  /** 根据画布大小和世界大小，算出这个世界该画多大 */
  function worldRadius(world, w, h) {
    var shortSide = Math.min(w, h);
    return shortSide * world.look.radiusRatio;
  }

  /**
   * 画一整颗世界：光晕 → 光环后半圈 → 球体 → 光环前半圈 → 卫星。
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} world 世界档案
   * @param {number} cx 圆心 x
   * @param {number} cy 圆心 y
   * @param {number} R  世界半径（像素）
   * @param {number} time 世界时间（秒）
   */
  function drawWorld(ctx, world, cx, cy, R, time) {
    var look = world.look;
    // 光晕和光环也用「加上本源偏移后」的色相，
    // 否则它们会和球体本色对不上，看起来像两套东西。
    var hue = look.hue + (look.hueShift || 0);

    ctx.save();

    // ── 1. 伴星光晕（只有「双星系统」才有）──
    if (look.companion) {
      var bx = cx + R * 0.62;
      var by = cy - R * 0.58;
      var cg = ctx.createRadialGradient(bx, by, 0, bx, by, R * 1.6);
      cg.addColorStop(0, hsl(36, 85, 72, 0.20));
      cg.addColorStop(0.5, hsl(36, 85, 68, 0.07));
      cg.addColorStop(1, hsl(36, 85, 68, 0));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(bx, by, R * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 2. 世界边缘的光晕 ──
    drawHalo(ctx, cx, cy, R, hue);

    // ── 3. 光环的后半圈（在世界背后）──
    if (look.hasRing) drawRing(ctx, cx, cy, R, hue, 'back');

    // ── 4. 轨道在背后的卫星 ──
    drawMoons(ctx, world, cx, cy, R, time, 'back');

    // ── 5. 球体本体 ──
    ctx.save();
    ctx.translate(cx, cy);
    if (look.squash && look.squash !== 1) ctx.scale(1, look.squash);  // 高重力 → 压扁

    // 先把球面裁出来，纹理就不会画出界
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.clip();
    drawSurface(ctx, world, R);
    ctx.restore();

    // 大气层（剧毒大气才有）画在裁剪之外，这样能往外扩一圈
    if (look.atmoHue !== null && look.atmoHue !== undefined) {
      drawAtmosphere(ctx, R, look.atmoHue);
    }

    ctx.restore();

    // ── 6. 光环的前半圈（挡住世界）──
    if (look.hasRing) drawRing(ctx, cx, cy, R, hue, 'front');

    // ── 7. 轨道在面前的卫星 ──
    drawMoons(ctx, world, cx, cy, R, time, 'front');

    ctx.restore();
  }

  /** 世界边缘那圈淡淡的光晕 —— 用径向渐变画，不是 CSS 的 glow
   *
   *  ⚠️⚠️ 2026-09-15 改过一次（报「那圈绿和 UI 打架」）⚠️⚠️
   *
   *  ── 病根不在"绿色"，在**光晕和球体的饱和/亮度差了三四倍** ──
   *     球体   hsl(hue, 30, 34·lum)   饱和 30、亮度 5~34   （暗、闷）
   *     光晕   hsl(hue, 50, 55)       饱和 50、亮度 55     （亮、艳）
   *  同一个色相，在球体上是"闷褐"，在光晕里就成了"鲜绿"。
   *
   *  上面 `drawWorld` 那句注释写着两者**必须看起来是一套东西** ——
   *  但只对齐色相**没做到这件事**。所以：
   *    · 饱和 50 → **30**（和球体一致）
   *    · 亮度 55 → **44**（向球体靠，但仍然比球体亮，才像"光"）
   *    · 透明度 0.26 → **0.12**（它只是掠过球体边缘的一层，不该抢戏）
   *
   *  ⚠️ **不是**把光晕改成固定的冷蓝 ——
   *     那会让光晕和球体**真的**变成两套东西，是盖症状不是修根因。
   *     光晕反映的仍然是这颗世界自己的颜色。 */
  function drawHalo(ctx, cx, cy, R, hue) {
    var outer = R * 1.45;
    var g = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, outer);
    g.addColorStop(0, hsl(hue, 30, 44, 0.12));
    g.addColorStop(0.4, hsl(hue, 28, 40, 0.045));
    g.addColorStop(1, hsl(hue, 28, 40, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 剧毒大气：世界外面多罩一层紫/绿的圈 */
  function drawAtmosphere(ctx, R, atmoHue) {
    var outer = R * 1.14;
    var g = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, outer);
    g.addColorStop(0, hsl(atmoHue, 70, 52, 0));
    g.addColorStop(0.45, hsl(atmoHue, 72, 54, 0.22));
    g.addColorStop(1, hsl(atmoHue, 75, 56, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, outer, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ═══════════════════════════════════════════════════════════════
     球面投影  ★ 2026-09-13 新增
     ═══════════════════════════════════════════════════════════════

     ★★ 自转的表现方式整个换了 ★★

     **改之前**：整张地表是一块平面圆盘，渲染时 `ctx.rotate(自转角度)`。
     那在几何上等于**从北极正上方往下看** —— 每个点永远在同一个半径上打圈，
     **没有任何东西会转到背面去**。
     （原话是：「你现在这样转永远都只能看到一个面」）

     **改之后**：**正射投影**（orthographic）—— 观察者在 +X 方向无穷远处，
     北极朝上，也就是"站在旁边看一颗地球仪"。特征会从一边转进来、
     在边缘压扁、横穿、从另一边转出去。

     相机空间：x 朝观察者、y 朝屏幕右、z 朝屏幕上。
     屏幕：x = 相机 y（乘 R），y = −相机 z（乘 R，因为屏幕 y 向下）。

     ⚠️ 自转就是**经度加一个角**（`lon + rot`）—— 这是整个改造最省事的地方：
        球面坐标下自转天然就是经度平移，不用碰任何形状数据。
     ═══════════════════════════════════════════════════════════════ */

  var TAU = Math.PI * 2;

  /** 球面经纬度 → 相机空间的三维单位向量。
      返回的 x 是**深度**：> 0 才是朝着观察者的那半边。 */
  function toCam(lon, lat, rot) {
    var l = lon + rot;
    var cl = Math.cos(lat);
    return { x: cl * Math.cos(l), y: cl * Math.sin(l), z: Math.sin(lat) };
  }

  /** 相机空间 → 屏幕像素。z 是深度，原样带出去给调用方判断。 */
  function camToScreen(c, R) {
    return { x: c.y * R, y: -c.z * R, z: c.x };
  }

  /** 一步到位：球面点 → 屏幕点（`z > 0` 才是正面） */
  function project(lon, lat, rot, R) {
    return camToScreen(toCam(lon, lat, rot), R);
  }

  /**
   * 屏幕上的「朝东 / 朝北」方向 —— 数值微分，单位是"每弧度弧长对应多少像素"。
   *
   * 拿它干什么：把一个**贴在地表上的椭圆**送到屏幕上。
   * 球面投影会把它压扁（越靠边缘压得越狠），而这正是"看着像球"的关键。
   */
  function screenBasis(lon, lat, rot, R) {
    var eps = 0.012;
    var p0 = project(lon, lat, rot, R);
    // 经度方向的步长要除以 cos(lat)，这样走得才是**等弧长**
    var co = Math.cos(lat);
    if (co < 0.12) co = 0.12;
    var pe = project(lon + eps / co, lat, rot, R);
    var pn = project(lon, lat + eps, rot, R);
    return {
      p0: p0,
      // 每弧度弧长 → 多少像素
      ex: (pe.x - p0.x) / eps, ey: (pe.y - p0.y) / eps,
      nx: (pn.x - p0.x) / eps, ny: (pn.y - p0.y) / eps
    };
  }

  /* 光从**屏幕左上角**来（和改造之前一致，见 drawMoons 那边的光晕也是这个方向）。
     相机空间里：屏幕右 = +y、屏幕上 = +z，所以左上 = y 负、z 正；
     再加一点朝观察者的分量（x 正），受光的那一面才朝着我们。 */
  var LIGHT_DIR = (function () {
    var v = { x: 0.58, y: -0.55, z: 0.60 };
    var m = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { x: v.x / m, y: v.y / m, z: v.z / m };
  })();

  /* ───────────────────────────────────────────────────────────────
     球面：底色 + 纹理 + 光照
     ─────────────────────────────────────────────────────────────── */

  function drawSurface(ctx, world, R) {
    var look = world.look;

    // ── 本源的连续影响在这里生效 ──
    // 这两个值由 worldgen 按四个本源算好（见 rollLook）：
    //   hueShift —— 水少偏土黄、水多偏青蓝
    //   bright   —— 能量高 → 地表更亮
    // 有了它们，本源不同的世界才会长得不一样，
    // 而不是被压扁成两千来种"脸"。
    var hue = look.hue + (look.hueShift || 0);
    var lum = look.bright === undefined ? 1 : look.bright;

    // ── 底色：左上到右下的渐变，让球有体积感 ──
    var base = ctx.createLinearGradient(-R * 0.7, -R * 0.8, R * 0.7, R * 0.9);
    base.addColorStop(0, hsl(hue, 30, 34 * lum));
    base.addColorStop(0.55, hsl(hue, 28, 24 * lum));
    base.addColorStop(1, hsl(hue, 26, 15 * lum));
    ctx.fillStyle = base;
    ctx.fillRect(-R, -R, R * 2, R * 2);

    /* ── 地表：纹理 + 图层 ──
       ★★ 2026-09-13：这里原来是一层 `ctx.rotate(自转角度)` ★★
          整张地表被当成一块平面圆盘刚性旋转 —— 那在几何上等于
          「从北极正上方往下看」，没有任何东西会转到背面去。

          现在改成**把自转角度一路传给绘制函数**，由它们做球面投影。
          ⚠️ 所以 `rot` 必须传到每一个画地表东西的地方。
             漏传的话地表会**静止不动**，而测试不一定红 ——
             画面照样画得出来，只是不转了。 */
    var rot = world.evo.rotation;

    // 大地之基影响纹理浓淡：大地多 → 纹理清晰；大地少 → 纹理很淡。
    // 用 globalAlpha 统一乘，一笔搞定所有纹理类型，
    // 不用给每种纹理单独加参数。
    ctx.globalAlpha = Math.max(0.1, Math.min(1, look.texStrength === undefined ? 1 : look.texStrength));
    drawTexture(ctx, look, R, rot);

    // ── 生长中的图层（海洋/大陆/生态/文明）──
    // 和纹理同一套投影：它们也是"地表上的东西"，
    // 世界转的时候海洋和大陆当然要跟着转。
    ctx.globalAlpha = 1;
    drawLayers(ctx, world, R, rot);

    // ── 大气厚 → 表面蒙一层雾 ──
    // 大气越厚越朦胧；大气薄的世界轮廓干脆利落。
    if (look.haze > 0) {
      ctx.fillStyle = hsl(hue + 10, 16, 62 * lum, look.haze);
      ctx.fillRect(-R, -R, R * 2, R * 2);
    }

    // ── 混沌期：两层叠加 ──
    // 第一层是灰雾（"看不清"），第二层是炽热的橙红光（"能量极高"）。
    // 橙光用 chaos² 衰减 —— 平方会让它比灰雾**褪得更快**，
    // 于是整个过程读起来是：炽热 → 温和 → 冷灰 → 清净。
    // 如果用一次方，两层同时消失，看起来就只是"变淡"，没有"冷却"的感觉。
    var chaos = chaosAmount(world);
    if (chaos > 0) {
      ctx.fillStyle = 'rgba(96, 94, 100, ' + (chaos * 0.50).toFixed(3) + ')';
      ctx.fillRect(-R, -R, R * 2, R * 2);

      ctx.fillStyle = hsl(18, 75, 46, chaos * chaos * 0.55);
      ctx.fillRect(-R, -R, R * 2, R * 2);
    }

    // ── 光照：左上角来光，右下角压暗 ──
    var lg = ctx.createRadialGradient(
      -R * 0.38, -R * 0.42, R * 0.05,
      -R * 0.38, -R * 0.42, R * 1.65
    );
    lg.addColorStop(0, hsl(hue, 45, 80, 0.20));
    lg.addColorStop(0.32, hsl(hue, 40, 62, 0.04));
    lg.addColorStop(0.72, 'rgba(0,0,0,0.26)');
    lg.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = lg;
    ctx.fillRect(-R, -R, R * 2, R * 2);
  }

  /**
   * 混沌程度：1 = 完全是混沌的一团火球，0 = 已经成形。
   * 只有第 0 阶段（混沌）会大于 0，之后一路是 0。
   */
  function chaosAmount(world) {
    if (world.evo.stage > 0) return 0;
    return Math.max(0, 1 - world.evo.progress);
  }

  /* ───────────────────────────────────────────────────────────────
     四种地表纹理
     形状在建世界时就算好了（见 worldgen 的 bakeTexture），
     这里只负责画。坐标都是 -1~1 的归一化坐标，乘 R 就变成像素。
     ─────────────────────────────────────────────────────────────── */

  /** 把三维向量归一化 —— 球面偏移算出来的点要拉回球面上 */
  function norm3(x, y, z) {
    var m = Math.sqrt(x * x + y * y + z * z) || 1;
    return { x: x / m, y: y / m, z: z / m };
  }

  function drawTexture(ctx, look, R, rot) {
    var marks = look.texMarks;
    if (!marks) return;

    var hue = look.hue;
    var dens = look.texDensity || 1;   // 高重力 → 1.5，纹理更密

    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (m.type === 'crack')       drawCrack(ctx, m, R, hue, dens, rot);
      else if (m.type === 'patch')  drawPatch(ctx, m, R, hue, rot);
      else if (m.type === 'stripe') drawStripe(ctx, m, R, hue, rot);
      else if (m.type === 'noise')  drawNoise(ctx, m, R, hue, dens, rot);
    }
  }

  /**
   * 画一条裂谷。
   *
   * ⚠️ 这一版和上一版的根本区别：
   *    上一版是「一根等宽的深色描边」—— 那在视觉上就是铅笔画的一道杠。
   *
   *    这一版把裂谷画成一条有宽度的**凹陷带**，带三样东西：
   *      ① 不规则宽度 —— 沿程忽宽忽窄，边缘天然不整齐
   *      ② 柔化的边   —— 外圈又宽又淡、内圈又窄又深，像光慢慢陷进去
   *      ③ 受光崖壁   —— 朝光源那一侧描一道亮边
   *
   *    第 ③ 点是"质感"的来源：**暗色带子没有亮边，就永远像贴上去的**；
   *    有了亮边，它才像"凹进去"。
   *
   * ⚠️ 2026-09-17 删了一个**签名里根本没有的参数**说明：
   *    原来这里写着 `@param {number} lightAngle`（"光在纹理坐标系里的方向，
   *    因为纹理被 ctx.rotate 转过，所以传进来的是屏幕方向 − 自转角度"）——
   *    可 `drawCrack` 的签名里**没有这个参数**，"ctx.rotate 那一套"
   *    2026-09-13 就删掉了。照着找会找半天不存在的参数。
   *    真正和自转有关的是下面那个 `rot`，说明在正文里。
   */
  function drawCrack(ctx, m, R, hue, dens, rot) {
    var pts = m.pts;
    var n = pts.length;
    if (n < 2) return;

    /* ── ① 把折线搬到球面上，并算出每个点的「侧向」 ──

       ⚠️⚠️ 宽度**必须在球面上量**，不能像以前那样"屏幕上左右各偏几像素"。
          屏幕上偏的话，靠近边缘时宽度不会跟着透视压扁，
          裂缝就成了一根宽度不变的带子贴在上面 —— 一眼假。

       做法：位置 P（相机空间单位向量），切线方向 D（前后两点的方向），
             侧向 = P × D（自然就落在切平面里，且垂直于裂缝走向）。 */
    var P = [], N = [], HW = [];
    var i, t;

    for (i = 0; i < n; i++) {
      t = i / (n - 1);
      // 半宽 = 沿程收窄（主干粗、末端细）× 随机波动（边缘不整齐）
      HW[i] = (m.w0 * (1 - t) + m.w1 * t) * m.jit[i] * dens;

      var c = toCam(pts[i].lon, pts[i].lat, rot);
      P[i] = c;

      var a = pts[i - 1] || pts[i];
      var b = pts[i + 1] || pts[i];
      var ca = toCam(a.lon, a.lat, rot);
      var cb = toCam(b.lon, b.lat, rot);
      var dx = cb.x - ca.x, dy = cb.y - ca.y, dz = cb.z - ca.z;
      var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;

      // P × D —— 落在切平面内、且垂直于裂缝走向的那个方向
      N[i] = { x: c.y * dz - c.z * dy,
               y: c.z * dx - c.x * dz,
               z: c.x * dy - c.y * dx };
    }

    /* ── ② 凹陷带本体：两遍叠加做出柔边 ──
       外圈宽而淡（边缘柔和地陷下去），内圈窄而深（最深的那道缝）。
       只画一遍硬边的话，就又回到"铅笔杠"了。 */
    var passes = [
      { scale: 2.10, alpha: 0.13, light: 13 },   // 外圈：宽、淡
      { scale: 1.00, alpha: 0.55, light: 6 }     // 内圈：窄、深
    ];

    for (var p = 0; p < passes.length; p++) {
      var ps = passes[p];
      ctx.fillStyle = hsl(hue, 30, ps.light, ps.alpha);
      ribbon(ctx, P, N, HW, ps.scale, R, true);
    }

    /* ── ③ 受光崖壁：朝光源的那一侧描一道亮边 ──
       「暗色带子没有亮边，就永远像贴上去的」—— 这条在球面上一样成立。

       ⚠️ 和改造之前的算法差别：以前是在平面上把「所有法线加起来」
          和光源方向比一下。球面上不能这么干 —— 光在每个点的
          切向分量都不一样，得**逐点**把光投到切平面上再和侧向比。 */
    var sum = 0;
    for (i = 0; i < n; i++) {
      var d = LIGHT_DIR.x * P[i].x + LIGHT_DIR.y * P[i].y + LIGHT_DIR.z * P[i].z;
      // 光在该点切平面上的分量
      var tx = LIGHT_DIR.x - d * P[i].x;
      var ty = LIGHT_DIR.y - d * P[i].y;
      var tz = LIGHT_DIR.z - d * P[i].z;
      sum += tx * N[i].x + ty * N[i].y + tz * N[i].z;
    }
    var side = sum > 0 ? 1 : -1;

    ctx.strokeStyle = hsl(hue + 14, 34, 58, 0.24);
    ctx.lineWidth = Math.max(0.5, R * 0.005);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ribbon(ctx, P, N, HW, side, R, false);
  }

  /**
   * 沿着一条「带宽度的折线」画出一根带子（填充或描边）。
   *
   * ★ 这里处理了一件以前根本不用管的事：**断开在背面的那几段**。
   *   球转起来之后，一条裂谷常常一半在正面、一半在背面。
   *   背面的点投影出来是**镜像**的（会翻到另一边去），
   *   所以要按可见性切成若干段，一段一段画。
   *
   * @param {number} scale 半宽的倍率（外圈 2.1、内圈 1、亮边 ±1）
   * @param {boolean} fill  true = 闭合填充成带子，false = 沿一侧描边
   */
  function ribbon(ctx, P, N, HW, scale, R, fill) {
    var run = [];
    var i;

    /* ⚠️⚠️ `flush` 里的循环变量**必须是自己新声明的 k**，不能借用外层的 i ⚠️⚠️
       借用的后果是**死循环**：倒着扫的那个循环跑完之后 i 停在 −1，
       回到外层 `for (i...)` 一 i++ 又变成 0，永远出不去。
       （2026-09-13 写这一版时踩到了，表现是整帧卡死、测试跑不完。） */
    function flush() {
      if (run.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(run[0].ax, run[0].ay);
        for (var k = 1; k < run.length; k++) ctx.lineTo(run[k].ax, run[k].ay);
        if (fill) {
          for (k = run.length - 1; k >= 0; k--) ctx.lineTo(run[k].bx, run[k].by);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.stroke();
        }
      }
      run = [];
    }

    for (i = 0; i < P.length; i++) {
      var c = P[i];
      // ⚠️ 0.02 而不是 0：正好在边缘上的点会算出极长的宽度，抖得很厉害
      if (c.x <= 0.02) { flush(); continue; }

      var w = HW[i] * scale;
      var a = norm3(c.x + N[i].x * w, c.y + N[i].y * w, c.z + N[i].z * w);
      var b = norm3(c.x - N[i].x * w, c.y - N[i].y * w, c.z - N[i].z * w);
      run.push({ ax: a.y * R, ay: -a.z * R, bx: b.y * R, by: -b.z * R });
    }
    flush();
  }

  /**
   * 斑块：一个柔边的椭圆。
   * 用「把坐标系拉扁 + 画正圆 + 径向渐变」实现，
   * 这样只用 arc / scale 这些最核心的 API，跨平台最保险。
   */
  function drawPatch(ctx, m, R, hue, rot) {
    var c = toCam(m.lon, m.lat, rot);
    if (c.x <= 0) return;                 // 转到背面了，不画

    /* ★ 画法：把「切平面上的椭圆」用一次**仿射变换**送到屏幕上。
       ⚠️ 妙处在于**边缘压扁是白送的** —— screenBasis 算出来的
          「朝东」方向在靠近边缘时会自然缩到 0，椭圆就自动压成一条缝。
          以前在平面圆盘上画的时候，这一步得手写，而且写不对。 */
    var B = screenBasis(m.lon, m.lat, rot, R);
    var ca = Math.cos(m.rot), sa = Math.sin(m.rot);

    var ux = (B.ex * ca + B.nx * sa) * m.rx;
    var uy = (B.ey * ca + B.ny * sa) * m.rx;
    var vx = (-B.ex * sa + B.nx * ca) * m.ry;
    var vy = (-B.ey * sa + B.ny * ca) * m.ry;

    // 太小了根本看不见（也是性能闸：一整片噪点斑块全是这种小东西）
    if (Math.abs(ux) + Math.abs(uy) + Math.abs(vx) + Math.abs(vy) < 1.2) return;

    var light = m.light;
    var col = light >= 0
      ? hsl(hue + 10, 30, 30 + light * 130, 0.45)
      : hsl(hue - 10, 26, 30 + light * 105, 0.50);

    ctx.save();
    // 单位圆 → 屏幕上的椭圆。渐变也跟着一起被拉成椭圆（这正是想要的）
    ctx.transform(ux, uy, vx, vy, B.p0.x, B.p0.y);

    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, col);
    g.addColorStop(1, hsl(hue, 26, 26, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * 条纹：一条「斜着的、缓缓弯过去」的带子。
   *
   * ⚠️ 之前是水平的波浪线 —— 问题是世界一自转，这些横线就跟着转，
   *    看起来像个大风车，完全不像星球。
   *    改成斜向的弧带之后，转起来才像球面在转。
   */
  function drawStripe(ctx, m, R, hue, rot) {
    var col = m.light >= 0
      ? hsl(hue + 10, 28, 30 + m.light * 130, m.alpha)
      : hsl(hue - 10, 26, 30 + m.light * 105, m.alpha);
    ctx.fillStyle = col;

    /* 带子的两条边**在烘焙时就算好了**（见 worldgen 的 bakeStripe）——
       渲染层只负责投影 + 画，不碰球面几何。
       这么分是因为渲染层零依赖，够不着 sphereStep。 */
    var outer = m.outer, inner = m.inner, n = outer.length;
    var ov = [], iv = [], i;

    for (i = 0; i < n; i++) {
      ov.push(project(outer[i].lon, outer[i].lat, rot, R));
      iv.push(project(inner[i].lon, inner[i].lat, rot, R));
    }

    /* ★ 按可见性切段。整条带子常常一大半绕到背面去了，
       而背面的点投影出来是**镜像**的 —— 不切开就会画出一个翻折的怪东西。

       ⚠️ 阈值取 0.02 而不是 0：正好在边缘上的点投影位置会剧烈抖动。 */
    var run = [];
    for (i = 0; i < n; i++) {
      if (ov[i].z > 0.02 && iv[i].z > 0.02) { run.push(i); continue; }
      stripeRun(ctx, run, ov, iv);
      run = [];
    }
    stripeRun(ctx, run, ov, iv);
  }

  /** 填出一段连续可见的带子（外边缘顺着走，内边缘倒着回来闭合） */
  function stripeRun(ctx, run, ov, iv) {
    if (run.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(ov[run[0]].x, ov[run[0]].y);
    for (var i = 1; i < run.length; i++) ctx.lineTo(ov[run[i]].x, ov[run[i]].y);
    for (i = run.length - 1; i >= 0; i--) ctx.lineTo(iv[run[i]].x, iv[run[i]].y);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * 噪点：一大把小点。
   * 用 fillRect 而不是 arc —— 这么小的点看不出方圆，但快好几倍。
   */
  function drawNoise(ctx, m, R, hue, dens, rot) {
    var pts = m.pts;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var c = toCam(p.lon, p.lat, rot);

      /* ★ 背面的点直接跳过。
         这一跳同时干了两件事：① 画出来才对（背面的东西不该看见）
         ② **性能没变差** —— 烘焙时点数翻了一倍，但同一时刻
            总有大约一半在背面，实际画的还是原来那么多。 */
      if (c.x <= 0) continue;

      var light = p.light;
      // 每个点有自己的透明度 —— 中尺度的点浓、小尺度的点淡，
      // 这样才有"层次"，而不是一片均匀的雪花。
      ctx.fillStyle = light >= 0
        ? hsl(hue + 8, 24, 32 + light * 120, p.alpha)
        : hsl(hue - 8, 22, 30 + light * 100, p.alpha);

      // 边缘压扁：越靠边越小。径向其实不变、切向趋零，
      // 但噪点太小了，用一个系数近似就够。
      var r = p.r * R * dens * (0.40 + 0.60 * c.x);
      if (r < 0.35) r = 0.35;    // 太小会完全看不见，兜个底
      ctx.fillRect(c.y * R - r, -c.z * R - r, r * 2, r * 2);
    }
  }

  /* ───────────────────────────────────────────────────────────────
     生长中的图层：海洋 / 大陆 / 生态 / 文明
     ───────────────────────────────────────────────────────────────
     形状在建世界时就算好存起来了（见 worldgen 的 bakeLayers），
     这里只负责画。每个岛按图层进度从 0 长到满 ——
     所以画面是"慢慢长出来"，不是"啪地跳出来"。
     ─────────────────────────────────────────────────────────────── */

  // 四个图层的颜色。
  // ⚠️ 故意用"一眼能认出来"的固定色（海是蓝的、植被是绿的），
  //    而不是跟着世界主色走 —— 这样扫一眼就知道演化到哪一步了。
  //    一个暗红色的星球长出蓝色海洋，反而更有"世界在变化"的冲击力。
  var LAYER_STYLE = {
    ocean:     { hue: 205, sat: 52, light: 30, alpha: 0.90 },
    continent: { hue:  86, sat: 20, light: 27, alpha: 0.94 },
    life:      { hue: 116, sat: 44, light: 33, alpha: 0.88 }
  };

  function drawLayers(ctx, world, R, rot) {
    var blobs = world.blobs;
    if (!blobs) return;

    var L = world.evo.layers;

    // 顺序很重要：海洋在最下 → 大陆盖上去 → 生态再盖上去 → 文明金点在最上
    drawBlobSet(ctx, blobs.ocean,     R, L.ocean,     LAYER_STYLE.ocean,     rot);
    drawBlobSet(ctx, blobs.continent, R, L.continent, LAYER_STYLE.continent, rot);
    drawBlobSet(ctx, blobs.life,      R, L.life,      LAYER_STYLE.life,      rot);

    // 文明光点用**这个文明自己的颜色**（兽类暖金、海类青蓝、灵能类紫白……）。
    // 走到文明那一帧才会掷出来，之前 world.civ 是空的，用默认金色兜底。
    var civColor = (world.civ && world.civ.color) || '#F0C060';
    // world.evo.civ 是文明自己的子时间线（诞生/发展/命运预兆），
    // 渲染层靠它决定"现在该画到第几个小阶段"（见 drawCivDots 上面那张表）
    drawCivDots(ctx, blobs.civ, R, L.civ, civColor, world.evo.civ, rot);
  }

  /**
   * 画一组岛。
   *
   * @param {Array}  list     岛数组
   * @param {number} progress 整个图层的进度 0→1
   * @param {object} style    { hue, sat, light, alpha }
   */
  function drawBlobSet(ctx, list, R, progress, style, rot) {
    if (!list || !list.length || progress <= 0) return;

    var p = Math.min(1, progress);
    ctx.fillStyle = hsl(style.hue, style.sat, style.light, style.alpha);

    for (var i = 0; i < list.length; i++) {
      var b = list[i];

      // 每个岛按自己的 delay 错开出场 —— 不要整批一起蹦出来，
      // 那样看起来像"整张图淡入"，而不是"一块一块长出来"。
      var t = (p - b.delay) / (1 - b.delay);
      if (t <= 0) continue;
      if (t > 1) t = 1;

      // 局部增速：光种旁边的植被长得快，所以那片会更早长满。
      // （boost 由演化系统每帧算好，见 evolution.js 的 updateBlobBoosts）
      if (b.boost) t = Math.min(1, t * (1 + b.boost));

      // 缓出：先快后慢，像真的在铺开
      t = 1 - Math.pow(1 - t, 2);

      /* ★ 转到背面的岛直接跳过 —— 两个理由：
         ① 看不见的东西不该画
         ② **性能靠这一跳守住**：烘焙时岛的数量比改造前翻了一倍
            （球面面积翻倍），但同一时刻总有大约一半在背面，
            实际画的还是原来那么多。 */
      if (toCam(b.lon, b.lat, rot).x <= 0) continue;

      var r = b.r * t;                          // 角半径（弧度）
      if (r * R < 0.8) continue;                // 太小了画出来也看不见，省一次绘制

      blobPath(ctx, b, R, r, rot);
      ctx.fill();
    }
  }

  /**
   * 把一个岛描成一条歪歪扭扭的闭合路径。
   * 半径按 verts 里的扰动值逐顶点变化 —— 边缘的"歪"就靠它。
   *
   * ★ 和改造之前的唯一差别：顶点的位置不再直接算成屏幕坐标，
   *   而是先算成**切平面上的偏移**，再用 screenBasis 送到屏幕上 ——
   *   于是整块大陆会自动跟着球面透视压扁、靠近边缘时缩成一条缝。
   *
   * @param {number} r 角半径（弧度，不是像素）
   */
  function blobPath(ctx, b, R, r, rot) {
    var B = screenBasis(b.lon, b.lat, rot, R);
    var N = b.verts.length;

    ctx.beginPath();
    for (var i = 0; i <= N; i++) {
      var k = i % N;                                   // 最后一个点回到起点，闭合
      var a = b.rot + (i / N) * TAU;
      var rr = r * (1 + b.wob * b.verts[k]);
      // 切平面上的「东」「北」两个分量
      var ea = Math.cos(a) * rr;
      var na = Math.sin(a) * rr;
      var px = B.p0.x + B.ex * ea + B.nx * na;
      var py = B.p0.y + B.ey * ea + B.ny * na;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /**
   * 文明：金色小光点，按进度逐个点亮。
   *
   * 不用 createRadialGradient 做光晕 —— 几十个点每帧各建一次渐变太贵了。
   * 改成"两个同心圆"近似：外圈大而淡、内圈小而亮，肉眼几乎看不出区别，
   * 但开销只有零头。
   */
  /* ═══════════════════════════════════════════════════════════════
     文明光点：五个小阶段
     ═══════════════════════════════════════════════════════════════
     文明阶段不是一个"点亮就完了"的图层 —— 它自己分五段：

       萌芽 (0.00~0.15)  几个点，小、暗
       扩张 (0.15~0.45)  点变多，这是原本就有的效果
       繁荣 (0.45~0.75)  ★ 点之间出现连线（聚落之间的路）
       巅峰 (0.75~1.00)  ★ 出现建筑轮廓
       命运 (预兆期)     ★ 按文明命运分化（见 drawCivOmen）

     ⚠️ 连线是 O(n²) 的（每个点找附近的点连），
        所以加了 CIV_LINK_MAX 上限。不加的话 30 个点会画出上百条线，
        手机上直接掉帧。
     ═══════════════════════════════════════════════════════════════ */
  var CIV_LINK_AT   = 0.45;   // 到多少进度开始画连线
  var CIV_BUILD_AT  = 0.75;   // 到多少进度开始画建筑
  var CIV_LINK_MAX  = 70;     // 最多画多少条线（性能闸）
  var CIV_LINK_DIST = 0.17;   // 多近的两个点才连线（世界半径的比例）

  function drawCivDots(ctx, list, R, progress, color, civ, rot) {
    if (!list || !list.length) return;

    var p = Math.min(1, progress);
    if (p <= 0) return;

    // 走到「命运预兆」就换一整套画法
    if (civ && civ.phase >= 2) {
      drawCivOmen(ctx, list, R, color, civ, rot);
      return;
    }

    // 按进度决定亮多少个（不是让所有点一起变亮）
    var lit = Math.floor(list.length * p);

    // ── 繁荣：聚落之间的连线 ──
    if (p >= CIV_LINK_AT) {
      // 渐渐显出来，不是"啪"地全出现
      var linkA = Math.min(1, (p - CIV_LINK_AT) / 0.12) * 0.45;
      drawCivLinks(ctx, list, lit, R, color, linkA, rot);
    }

    // ── 巅峰：建筑轮廓 ──
    var buildP = p >= CIV_BUILD_AT ? Math.min(1, (p - CIV_BUILD_AT) / 0.15) : 0;

    for (var i = 0; i < lit; i++) {
      var b = list[i];
      var cam = toCam(b.lon, b.lat, rot);
      if (cam.x <= 0) continue;                  // 转到背面了
      var px = cam.y * R;
      var py = -cam.z * R;
      // 边缘压扁：越靠边越小
      var pr = b.r * R * (0.45 + 0.55 * cam.x);
      if (pr < 0.35) continue;

      // 点随进度稍微长大一点，让"文明在长大"看得出来
      var grow = 1 + p * 0.45;

      // 外圈柔光：用文明自己的颜色，但很淡
      ctx.fillStyle = rgba(color, 0.15);
      ctx.beginPath();
      ctx.arc(px, py, pr * 3.6 * grow, 0, Math.PI * 2);
      ctx.fill();

      // 芯：比文明色更亮一档，让它在暗背景上跳出来。
      // 用 fillRect 而不是 arc —— 这么小的点看不出方圆，
      // 但少一次路径构建 + 光栅化，几十个点加起来省不少。
      ctx.fillStyle = rgba(color, 0.95);
      ctx.fillRect(px - pr * grow, py - pr * grow, pr * 2 * grow, pr * 2 * grow);

      if (buildP > 0) drawCivBuildings(ctx, px, py, pr, color, buildP, i);
    }
  }

  /**
   * 聚落之间的连线 —— 文明"连成一张网"的样子。
   *
   * 只连距离够近的点，超过 CIV_LINK_DIST 就不连（不然整片糊成一坨）。
   * 而且只用 j > i 的顺序遍历，每条边只画一次，不会画两遍。
   */
  function drawCivLinks(ctx, list, lit, R, color, alpha, rot) {
    if (alpha <= 0 || lit < 2) return;

    var maxD2 = CIV_LINK_DIST * CIV_LINK_DIST;

    /* ★ 先把每个点算一次相机空间位置，后面反复用。

       ⚠️⚠️ 距离判定必须用**球面上的弦长**（相机空间里两点的直线距离），
          不能用屏幕距离 —— 靠近边缘的点会被透压扁，
          明明挨在一起的两个聚落，在屏幕上看着离得很远，连线就断了。
          CIV_LINK_DIST 的数值含义没变（都是"世界半径的几分之几"），
          球是单位球，所以直接比就行。 */
    var cam = [];
    for (var k = 0; k < lit; k++) cam.push(toCam(list[k].lon, list[k].lat, rot));

    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = Math.max(0.6, R * 0.0035);

    var drawn = 0;
    for (var i = 0; i < lit && drawn < CIV_LINK_MAX; i++) {
      var a = cam[i];
      if (a.x <= 0) continue;                    // 背面，跳过
      for (var j = i + 1; j < lit && drawn < CIV_LINK_MAX; j++) {
        var b = cam[j];
        if (b.x <= 0) continue;
        var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        if (dx * dx + dy * dy + dz * dz > maxD2) continue;

        ctx.beginPath();
        ctx.moveTo(a.y * R, -a.z * R);
        ctx.lineTo(b.y * R, -b.z * R);
        ctx.stroke();
        drawn++;
      }
    }
  }

  /**
   * 建筑轮廓 —— 巅峰期的标志。
   *
   * 每个聚落旁边长出几个小方块。
   * ⚠️ 布局用**点的下标**当种子，不用随机数 ——
   *    否则每一帧位置都在变，看着像一堆乱抖的噪点。
   */
  function drawCivBuildings(ctx, px, py, pr, color, p, seed) {
    var n = 2 + (seed % 3);           // 每个聚落 2~4 栋

    ctx.fillStyle = rgba(color, 0.55 * p);

    for (var k = 0; k < n; k++) {
      var ang  = seed * 1.7 + k * 2.1;          // 固定的角度，不随帧变
      var dist = pr * (2.4 + (k % 2) * 1.2);
      var w    = pr * 1.7 * p;                  // 随时间从小长到大

      ctx.fillRect(px + Math.cos(ang) * dist - w * 0.5,
                   py + Math.sin(ang) * dist - w * 0.5,
                   w, w);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     命运预兆 —— 文明怎么收场
     ═══════════════════════════════════════════════════════════════
     ⚠️ 2026-09-17 改：原来写「七种命运，七种画法」—— **早就不止了**，
        现在 `OMENS` 里是 **20 条**（ascend / doom / split / watched /
        merge / cycle / rift / collapse / machine / blaze / recede /
        disperse / arrive / stillness / symbiose / cultivate / harvest /
        **revere** / xiuDoom / xiuFlourish）。
        **要加一条，去 `core/evolution.js` 的 `OMENS` 加，再回这里加一个分支。**

        ⚠️⚠️ 忘了回这里加分支**不会报错** —— 它会掉进最后那个 `else`
            （轮回的画法），于是那条命运在预兆期演的是"暗下去又亮回来"。
            实测抓不到：`_render_test.js` 只查几条已知命运的点数形状。
            加预兆时**两边一起改**，这是唯一的防线。

     全都基于**同一个循环**：对每个光点算出一个位移和透明度，再画。
     这样加命运只要加一个分支。

       飞升 ascend   光点离开地面（往外飘、变细、变淡）
       寂灭 doom     一个接一个熄灭
       分裂 split    分成三团，各自远离
       被观测 watched 整体朝镜头转过来、变大变亮，并且向外发信号
       融合 merge    所有点往中心聚拢，合到一处
       轮回 cycle    整体暗下去，最后几点又亮回来
       破碎 rift     光点沿径向炸开、迅速熄灭
     ═══════════════════════════════════════════════════════════════ */
  function drawCivOmen(ctx, list, R, color, civ, rot) {
    var omen = civ.omen;
    if (!omen) return;

    var p = Math.min(1, Math.max(0, civ.progress));
    var key = omen.key;
    var i, b, x, y, sc, alpha;

    /* ★ 球面坐标 → 屏幕（单位还是"世界半径 R"）。
       妙处：下面那一大段是在 x/y ∈ [-1,1] 的坐标系里写的，
       **一行都不用改** —— 只要喂给它的 x/y 换成投影后的屏幕位置。

       ⚠️ 背面的光点直接跳过。预兆演 18 秒，星球还在转，
          所以边缘附近的光点会随转随没 —— 和真实的地球仪一样。
          （如果实测发现这样闪得难看，就改成"预兆开始时把自转定住"。） */
    var dots = [];
    for (var q = 0; q < list.length; q++) {
      var cq = toCam(list[q].lon, list[q].lat, rot);
      dots.push({ x: cq.y, y: -cq.z, r: list[q].r, vis: cq.x > 0 });
    }

    /* ── ★★ 劫灭 / 长存：那一道**横扫过去的光带**（2026-09-16）★★

       它是这两条预兆在画面上**唯一的身份证**：
         · 劫灭和「溃散」都是"扫过去一片片暗" —— 区别只有方向
           （溃散是**波前从左往右推**，劫灭是**从上往下压**）
         · 长存和「静滞」都是"亮着不动" —— 区别是亮度走向
           （静滞越来越淡，长存由淡转浓）

       ⚠️⚠️ 所以那道带子**必须画出来**。只让光点暗下去的话，
          劫灭和溃散在屏幕上几乎一模一样（`_render_test.js`
          那条"点数的形状"断言也抓不到这种撞脸）。
       ⚠️ 屏幕 y 向上为负，所以画的时候直接用 `sweep * R`
          （y = −1 在顶部、+1 在底部，和 canvas 的 y 轴一致）。 */
    if (key === 'xiuDoom' || key === 'xiuFlourish') {
      var bandY = (key === 'xiuFlourish') ? (1.2 - p * 2.4) : (-1.2 + p * 2.4);
      if (bandY > -1.35 && bandY < 1.35) {
        ctx.strokeStyle = rgba(color, (key === 'xiuFlourish') ? 0.40 : 0.60);
        ctx.lineWidth = Math.max(1, R * 0.018);
        ctx.beginPath();
        ctx.moveTo(-R * 1.1, bandY * R);
        ctx.lineTo(R * 1.1, bandY * R);
        ctx.stroke();
      }
    }

    // ── 「被观测」额外画几圈向外发的信号 ──
    // 命运的原文是"向那个方向反复发出信号"，光靠点动看不出来，
    // 得有个从世界中心一圈圈荡出去的东西才读得懂。
    if (key === 'watched') {
      for (var g = 0; g < 3; g++) {
        var gp = (p * 1.6 + g / 3) % 1;          // 三圈错开
        if (gp <= 0) continue;
        ctx.strokeStyle = rgba(color, 0.30 * (1 - gp));
        ctx.lineWidth = Math.max(0.8, R * 0.005 * (1 - gp));
        ctx.beginPath();
        ctx.arc(0, 0, R * (0.25 + gp * 1.05), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    /* ── 「抵达」= 被观测 + 一件**从外面回来**的东西 ──
       ★ 这两条是**一对**（判定条件只差 `dropTally.light`）：
           被观测 = 信号往外走，**没人理** → 只有上面那三圈出去的
           抵达   = 同样发信号，**有回应**   → 前半段往外，后半段**往里收**
       ⚠️ "反过来"这一下就是两条命运在画面上**唯一**的差别，
          所以它必须读得出来：出去的圈比回来的暗、比回来的慢。 */
    if (key === 'arrive') {
      var going = p < 0.5;                       // 前半段：还在往外发
      var tp = going ? p * 2 : (p - 0.5) * 2;
      for (var g2 = 0; g2 < 3; g2++) {
        var gp2 = (tp + g2 / 3) % 1;
        var rad = going ? (0.25 + gp2 * 1.05)     // 往外扩
                        : (1.30 - gp2 * 1.05);    // 往回收 ★
        ctx.strokeStyle = rgba(color, (going ? 0.26 : 0.45) * (1 - gp2));
        ctx.lineWidth = Math.max(0.8, R * 0.005 * (1 - gp2) * (going ? 1 : 1.8));
        ctx.beginPath();
        ctx.arc(0, 0, R * rad, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    /* ── ★「收割」= 一道**由外向内**扫进来的东西 ──
       ★ 2026-09-14 加（界外之物那条线的批 2）。

       ⚠️⚠️ 方向必须是反的 ⚠️⚠️
          上面那两圈（被观测 / 抵达）都是**从中心往外发**的信号。
          这一条是从**记录之外**进来的，所以圈要往里收 ——
          玩家看一眼就知道这次是外面来人了，不是里面在喊。

       ⚠️ 它同时是"什么时候全灭"的指针：圈扫到中心那一刻，
          光点一起没了（见下面那个分支）。有了这个因果，
          画面才不是"莫名其妙全黑了"。 */
    if (key === 'harvest') {
      var reach = 1.45 * (1 - p);            // 从界外一路收到中心
      ctx.strokeStyle = rgba(color, 0.55 * (1 - p * 0.45));
      ctx.lineWidth = Math.max(1.0, R * 0.014 * (1 - p * 0.55));
      ctx.beginPath();
      ctx.arc(0, 0, R * reach, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (i = 0; i < list.length; i++) {
      b = dots[i];                            // ← 投影后的屏幕坐标
      if (!b.vis) continue;                   // 背面的不画
      x = b.x; y = b.y;
      sc = 1;
      alpha = 0.95;

      if (key === 'ascend') {
        // 离开地面：沿径向往外飘，同时变小变淡（飞远了）
        var k1 = 1 + p * 0.55;
        x = b.x * k1; y = b.y * k1;
        sc = 1 - p * 0.4;
        alpha = 0.95 - p * 0.2;

      } else if (key === 'doom') {
        // 熄灭：按下标错开，一个接一个灭
        var each = i / Math.max(1, list.length - 1);
        alpha = (p > each) ? Math.max(0, 0.95 * (1 - (p - each) * 2.6)) : 0.95;
        sc = 0.6 + alpha * 0.4;

      } else if (key === 'collapse') {
        /* 溃散：压力越过极限时是**整个结构同时失稳**，
           不是逐点失效 —— 所以不像寂灭那样一个个灭，
           而是一道波前从左往右推过去，推到哪片就暗到哪片。 */
        var wave  = (b.x + 1) / 2;        // 光点的横向位置当波前（0 左 1 右）
        var front = p * 1.35;             // 波前沿进度推进
        alpha = (wave < front) ? Math.max(0, 0.95 * (1 - (front - wave) * 2.2)) : 0.95;
        sc = 0.7 + alpha * 0.3;

      } else if (key === 'split') {
        // 分成三团：每团一个方向，各自往外挪
        var dir = (i % 3) * (Math.PI * 2 / 3) - Math.PI / 2;
        x = b.x + Math.cos(dir) * p * 0.34;
        y = b.y + Math.sin(dir) * p * 0.34;

      } else if (key === 'watched') {
        // 转向镜头：整体往圆盘中心挪（那是"正对着你"的方向），变大变亮
        x = b.x * (1 - p * 0.28);
        y = b.y * (1 - p * 0.28);
        sc = 1 + p * 0.75;

      } else if (key === 'merge') {
        // 融合：全部往中心靠，最后合成一团
        x = b.x * (1 - p * 0.72);
        y = b.y * (1 - p * 0.72);
        sc = 1 + p * 0.5;

      } else if (key === 'rift') {
        // 破碎：沿径向炸开，迅速熄灭
        var ang = Math.atan2(b.y, b.x);
        x = b.x + Math.cos(ang) * p * 0.6;
        y = b.y + Math.sin(ang) * p * 0.6;
        alpha = 0.95 * (1 - p * 0.75);

      /* ═══ ★ 2026-09-13 加的七条 ═══
         ⚠️⚠️ 这里最要紧的是**和已有的分得开**。三对最容易撞的：
              blaze × merge    都往中间聚 —— blaze 聚到一处后**一起暗掉**
              disperse × rift  都往外散 —— rift 是径向**炸开**且立刻熄，
                                               disperse 是各朝各的方向**漂走**
              recede × merge   都往一处收 —— recede 越收越小、**几乎看不见**
              symbiose × cultivate 都变大 —— symbiose **变淡**（沉进地表），
                                              cultivate **变亮**（盖住地表） */
      } else if (key === 'blaze') {
        // 燎原：先互相靠拢，聚到近处后**一同暗下**（不是一个个灭）
        x = b.x * (1 - p * 0.5);
        y = b.y * (1 - p * 0.5);
        sc = 1 + p * 0.35;
        alpha = (p < 0.62) ? 0.95 : Math.max(0, 0.95 * (1 - (p - 0.62) * 2.8));

      } else if (key === 'recede') {
        // 退潮：整体缩回中心，越缩越小 —— 最后几乎看不见（还在，只是很小）
        x = b.x * (1 - p * 0.8);
        y = b.y * (1 - p * 0.8);
        sc = 1 - p * 0.8;
        alpha = 0.95 - p * 0.5;

      } else if (key === 'disperse') {
        /* 星散：每个点朝**自己的方向**漂走。
           ⚠️ 方向 = 它自己的方位角 + 一个逐点不同的偏角 ——
              不能是同一个角度（那就成了 rift 的径向炸开），
              也不能只分三团（那是 split）。 */
        var da = Math.atan2(b.y, b.x) + (i % 7) * 0.17 - 0.51;
        x = b.x + Math.cos(da) * p * 0.55;
        y = b.y + Math.sin(da) * p * 0.55;
        alpha = 0.95 - p * 0.45;

      } else if (key === 'arrive') {
        // 抵达：前半段光点不动（信号还在路上），后半段**回应到达**时整体亮起来
        var lit = p < 0.5 ? 0 : (p - 0.5) * 2;
        sc = 1 + lit * 0.55;

      } else if (key === 'stillness') {
        /* 静滞：位置**一动不动**、一个都不灭 —— 这就是它的意思。
           ⚠️ 画面上必须有点东西在动，否则玩家会以为卡住了 ——
              所以让每个点独立地极慢脉动（相位错开），整体随进度略微变淡。 */
        sc = 1;
        alpha = (0.95 - p * 0.3) *
                (0.94 + Math.sin(p * Math.PI * 6 + i * 0.7) * 0.06);

      } else if (key === 'symbiose') {
        // 共生：沉下去、摊开、**变淡** —— 最后和地表分不出彼此
        x = b.x * (1 + p * 0.22);
        y = b.y * (1 + p * 0.22);
        sc = 1 + p * 2.2;
        alpha = 0.95 - p * 0.75;

      } else if (key === 'cultivate') {
        // 培育：**变大变亮**并向外铺开 —— 光晕互相重叠，连成盖住地表的一整片
        x = b.x * (1 + p * 0.45);
        y = b.y * (1 + p * 0.45);
        sc = 1 + p * 1.8;

      } else if (key === 'harvest') {
        /* ★ 收割：**不是熄灭，是被取走** —— 没有过程。
           ⚠️⚠️ 这一条的死因是"和上面四条分得开"，不是"好看" ⚠️⚠️
               寂灭  按下标错开，一个接一个灭（有节奏）
               溃散  一道波前从左往右推（有方向）
               遗落  灭掉的还在，造的东西还在动（灭与不灭同时存在）
               静滞  一个都不灭，只是停住
               收割  ★ 九成时间里**全都没事**，最后一下一起没了 ——
                     一个缓动的过程都没有，这就是它和那四条的差别。

           ⚠️ 用 0.88 而不是 0.9：上面那道圈走到中心附近要一点余量，
              让"圈到了"和"点没了"看起来是同一件事。 */
        alpha = (p < 0.88) ? 0.95 : 0;

      } else if (key === 'machine') {
        /* ★ 遗落 —— 2026-09-16 补的分支（★ 这个分支**一直是漏的**）。

           ⚠️⚠️ 漏了会怎样：`OMENS` 里有 `machine`，但这里没有它的分支，
              于是掉进最后那个 `else`（轮回）—— **遗落的预兆演的是轮回的画面**，
              而 `_render_test.js` 只验"不崩"，所以测试一直是绿的。

           ⚠️⚠️ 「灭掉的和还在动的**同时存在**」是这条画面的全部 ⚠️⚠️
              设计要求见 `core/evolution.js` 的 OMENS：
              另外三条（寂灭 / 溃散 / 收割）都是"整体灭下去"，
              只有这一条要**一半在灭、一半照旧**。写成"光点熄灭"就分不出来了。

           做法：按下标一分为二 ——
             偶数位 = **代表他们的光点** → 逐个熄灭，越靠后的走得越晚
             奇数位 = **他们造出来的东西** → 一个都不灭，而且还在动
           两组必须**同时看得见**，这才是"他们不见了，东西还在转"。 */
        if (i % 2 === 0) {
          // 他们：从前往后一个个灭
          var own = (i / Math.max(1, list.length)) * 1.1;
          alpha = Math.min(0.95, Math.max(0, 0.95 * (1 - (p - own) * 6)));
        } else {
          /* 他们造的东西：不灭，而且**还在动**。
             ⚠️ 动的样子要**不像活着** —— 慢慢绕小圈、不朝任何方向去。
                往外扩散会变成星散，上下浮动会变成呼吸 ——
                绕小圈才像"按既定轨迹一直跑下去"。 */
          var orbit = p * Math.PI * 4 + i * 1.3;
          x = b.x + Math.cos(orbit) * 0.035;
          y = b.y + Math.sin(orbit) * 0.035;
          alpha = 0.9;
        }

      } else if (key === 'coexist') {
        /* ★ 同行 —— **两拨先分开、最后合到一处**（2026-09-22 已拍板）。

           设计要求见 `core/evolution.js` 的 OMENS / `ending.js` 的 `FATES.coexist`：
           结局那句写的是「他们造出的东西有一天说了「我」，**冲突持续了几代人**，
           此后，两边渐渐理解了彼此，文明走向繁荣」。
           ⇒ 所以这一条的画面是**一段弧线**，不是两个静态的动法：

               前半段（p 0→0.45）  两拨**越离越远**   ← 冲突
               后半段（p 0.45→1）  两拨**重新合到一处** ← 走到一起

           ⚠️⚠️ 起点和终点**都在原位** —— 演到最后所有点回到 `b.x/b.y`，
              这正是「两边还是走到了一处」。写成"一直分开"就读不出和解了。
           ⚠️⚠️ 「一个也不灭」是它和「遗落」的唯一区别 ⚠️⚠️
              两组都灭 = 寂灭；一组灭一组动 = 遗落；都不灭 = 同行。
              `alpha` 全程 0.9，**不许有渐隐**。
           ⚠️ 和「遗落」一样，漏了这个分支**不会报错** ——
              会掉进最后那个 `else`（轮回的画法），而 `_render_test.js`
              只验"不崩"，抓不到。加预兆时两边一起改。 */
        /* 分离度：0 → 1 → 0，顶点在 45% 处。
           ⚠️ 用 `p < 0.45` 分段而不是正弦 —— 正弦的峰值位置不直观，
              调"冲突什么时候最烈"的时候得反推相位。 */
        var sepC = (p < 0.45) ? (p / 0.45) : (1 - (p - 0.45) / 0.55);
        var angC = (i / Math.max(1, list.length)) * Math.PI * 2;
        /* 两拨沿各自的方位往**相反**方向拉开 —— 一组向外、一组向内。
           ⚠️ 用 `i % 2` 分边（和「遗落」同一套索引），不分边就只是"整体放大"。 */
        var sideC = (i % 2 === 0) ? 1 : -1;
        x = b.x + Math.cos(angC) * sepC * 0.07 * sideC;
        y = b.y + Math.sin(angC) * sepC * 0.07 * sideC;
        alpha = 0.9;

      } else if (key === 'xiuDoom') {
        /* ═══ ★★ 劫灭 —— 修真彩蛋的两个专属结局之一（2026-09-16）★★ ═══

           设计要求见 `core/evolution.js` 的 OMENS：这一对预兆**占竖直方向** ——
           已有的十七条把"径向 / 横向 / 绕圈 / 原地 / 由外向内的圈"全用掉了，
           只有**从上往下**是空的。所以：

             劫灭 = 一道**光带从上往下压**，扫到的光点**被压扁、熄灭**
             长存 = 同一道光带**从下往上**升，而光点**一个都不灭**

           ⚠️ 必须和「溃散」分得开：溃散是**波前从左往右推**（横着扫），
              这一条是**竖着压**。两条都是"扫过去一片片暗"，方向是唯一的差别，
              所以下面那道带子**一定要画出来** —— 只让点暗下去就撞车了。 */
        /* ⚠️ 坐标系：屏幕 y **向上为负**（`y = -z_cam`）——
              y = −1 是世界顶部，+1 是底部。光带**从上往下**扫。 */
        var sweepD = -1.2 + p * 2.4;
        // 已经**被扫过**的点：位置在光带上方（y < sweepD）
        var gone = Math.min(1, Math.max(0, (sweepD - y) * 4.5));
        alpha = Math.min(0.95, 0.95 * (1 - gone));
        // 被压过的光点**被压扁**（纵向收）——和"熄灭"是两件事
        sc = 1 - 0.75 * Math.min(1, Math.max(0, (sweepD - y) * 3));

      } else if (key === 'xiuFlourish') {
        /* ═══ ★★ 长存 —— 同一道光带，**反着走**（2026-09-16）★★ ═══

           ⚠️ 和容易撞的两条的分界：
             · 静滞  亮着不动，但**整体越来越淡**（0.95 → 0.65）——
                     这一条是反的：**由淡转浓**，而且一个都不灭
             · 培育  变大变亮**还往外铺开** —— 这一条**不铺开、不位移** */
        var sweepU = 1.2 - p * 2.4;           // 从下往上升
        // 已经**被升过**的点：位置在光带下方（y > sweepU）
        var lit = Math.min(1, Math.max(0, (y - sweepU) * 3));
        alpha = 0.45 + 0.5 * lit;             // 0.45 → 0.95，只升不降
        sc = 1 + 0.15 * lit;                  // 稍微长大一点，但不铺开

      } else if (key === 'revere') {
        /* ═══ ★★ 仰止 —— 信仰专属结局（2026-09-22）★★ ═══

           ★ 画面：**所有光点排成一个间距完全相等的环，圈心空着，
             然后谁都不动。**

           为什么是这个画面（三个理由，都不是随手挑的）：
             ① **「不再有区别」是字面意思** —— 信仰统一、一切只剩一种解释。
                环上每一点的间距、大小、亮度**完全一样**，这是全部预兆里
                唯一一条"点与点之间没有差别"的。
             ② **圈心空着** —— 他们在围着看的东西**看不见**。
                那正是观测者（它从来不出现在画面里）。
             ③ **不动** —— 「仰止」的「止」。找是找过了（`watched` 那条
                在往外发信号），这一条是**找到了，然后停在那里**。

           ⚠️⚠️ 和两条最容易撞的分界（`_render_test.js` 抓不到这种撞脸，
              只能靠这里写清楚）：
             · 被观测（watched）也是"转过去"，但它**转完还在发信号**
               （三圈往外扩的圈）—— 那是"还没找到"。
             · 静滞（stillness）也是"停住"，但它**各点保持原样、
               整体越来越淡**；这一条是**收成同一个值**，而且不淡。
             · 融合（merge）也在中心附近动，但它是**往中心收成一点**；
               这一条是**围成一个环**，中间是空的 —— 方向正好相反。 */
        var rvA = (i / list.length) * Math.PI * 2;
        x = Math.cos(rvA) * 0.58;
        y = Math.sin(rvA) * 0.58;
        sc = 1;
        alpha = 0.95;          // ⚠️ 不随 p 变 —— 这一条**不淡、不动、不变**

      } else {
        // cycle 轮回：整体暗下去，最后几点又亮回来
        alpha = (p < 0.7) ? 0.95 * (1 - p / 0.7)
                          : (i < 5 ? 0.9 * ((p - 0.7) / 0.3) : 0);
      }

      if (alpha <= 0.01) continue;

      var px = x * R, py = y * R, pr = b.r * R * sc;
      if (pr < 0.35) continue;

      ctx.fillStyle = rgba(color, 0.18 * alpha);
      ctx.beginPath();
      ctx.arc(px, py, pr * 3.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = rgba(color, 0.95 * alpha);
      ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
  }

  /* ───────────────────────────────────────────────────────────────
     光环
     ─────────────────────────────────────────────────────────────── */

  /**
   * 画光环。
   *
   * 关键：光环要**一半在世界背后、一半在世界前面**，才有"环穿过球体"的立体感。
   * 所以这个函数分两次调用：先画 back（后），世界画完再画 front（前）。
   *
   * @param {string} half 'back' 或 'front'
   */
  function drawRing(ctx, cx, cy, R, hue, half) {
    // 四条不同半径、不同亮度的带子叠起来，看起来才有厚度
    var bands = [
      { r: 1.28, w: 0.085, alpha: 0.09, light: 62 },
      { r: 1.40, w: 0.150, alpha: 0.17, light: 74 },
      { r: 1.55, w: 0.075, alpha: 0.12, light: 58 },
      { r: 1.65, w: 0.045, alpha: 0.07, light: 52 }
    ];
    var TILT = 0.30;      // 轨道压扁程度，看起来像斜着绕

    // 屏幕坐标里，角度 π/2（屏幕下方）离观众最近，是"前面"。
    // 所以前半圈 = 0 ~ π，后半圈 = π ~ 2π —— 各只要一条弧线就够，
    // 不用切成很多小段（省下 30 倍的绘制调用，手机上才跑得动）。
    var a0 = (half === 'front') ? 0 : Math.PI;
    var a1 = (half === 'front') ? Math.PI : Math.PI * 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.20);
    ctx.scale(1, TILT);

    for (var b = 0; b < bands.length; b++) {
      var band = bands[b];
      ctx.lineWidth = band.w * R;
      ctx.strokeStyle = hsl(hue + 15, 30, band.light, band.alpha);
      ctx.beginPath();
      ctx.arc(0, 0, band.r * R, a0, a1);
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ───────────────────────────────────────────────────────────────
     卫星
     ─────────────────────────────────────────────────────────────── */

  /**
   * 画卫星。和光环一样分 back / front 两次调用，
   * 这样卫星转到世界背后时会被挡住。
   */
  function drawMoons(ctx, world, cx, cy, R, time, half) {
    var moons = world.look.moons;
    if (!moons || !moons.length) return;

    for (var i = 0; i < moons.length; i++) {
      var m = moons[i];
      var a = m.angle + m.speed * time;

      var mx = cx + Math.cos(a) * m.dist * R;
      var my = cy + Math.sin(a) * m.dist * R * (1 - Math.abs(m.tilt) * 0.55);

      var isFront = my >= cy;
      if (half === 'front' ? !isFront : isFront) continue;

      var mr = m.size * R;
      if (mr < 0.8) continue;

      // ── 向光面亮、背光面暗，和世界的光照方向保持一致 ──
      var g = ctx.createRadialGradient(
        mx - mr * 0.38, my - mr * 0.38, mr * 0.08,
        mx, my, mr * 1.05
      );
      g.addColorStop(0, hsl(m.tone, 10, 76));
      g.addColorStop(0.6, hsl(m.tone, 12, 52));
      g.addColorStop(1, hsl(m.tone, 14, 30));

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();

      // ── 卫星外面也来一小圈光晕，太小的球不画会被背景吃掉 ──
      var hg = ctx.createRadialGradient(mx, my, mr * 0.9, mx, my, mr * 2.6);
      hg.addColorStop(0, hsl(m.tone, 20, 70, 0.16));
      hg.addColorStop(1, hsl(m.tone, 20, 70, 0));
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(mx, my, mr * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     导出
     ═══════════════════════════════════════════════════════════════ */
  return {
    hsl: hsl,
    rgba: rgba,
    makeStars: makeStars,
    drawStars: drawStars,
    worldRadius: worldRadius,
    drawWorld: drawWorld,
    drawDrops: drawDrops
  };
});
