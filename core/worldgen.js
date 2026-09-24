/* ═══════════════════════════════════════════════════════════════════
   ⑦ WorldGen —— 世界生成
   ═══════════════════════════════════════════════════════════════════
   职责：点【换一个星球】时跑一次，产出一份完整的世界档案。

   三层随机（权重表在本文件顶部，想调概率只改那一处）：
     第一层 本源   —— 四个 0-100 的数值，决定这世界的"命"
     第二层 外观   —— 大小 / 色板 / 纹理 / 自转 / 光环 / 卫星
     第三层 特殊属性 —— 10% 概率触发一个，会反过来修改前两层

   铁律 B：本文件不许出现 document / window / canvas。
   ═══════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  var mod = factory(
    (typeof require !== 'undefined') ? require('./rng.js') : root.RNG
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.WorldGen = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (RNG) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     权重表 —— 所有概率集中在这里，方便调
     ═══════════════════════════════════════════════════════════════ */
  var WEIGHTS = {
    tierNormal:  70,   // 70% 温和区间 —— 能正常演化出生态
    tierExtreme: 20,   // 20% 极端区间 —— 有特色，但可能演化失败
    tierSpecial: 10,   // 10% 触发特殊属性

    ringChance:  15,   // 光环 15%
    moon1Chance: 20,   // 1 颗卫星 20%
    moon2Chance:  5,   // 2 颗卫星 5%

    // 特殊属性池。抽到哪一项是等概率的（各 25%）
    traits: ['binary', 'gravity', 'toxic', 'moon']
  };

  /* ───────────────────────────────────────────────────────────────
     第一层：四个本源的取值区间
     温和区间 → 能演化出生态
     极端区间 → 世界有特色，但可能卡住演化不出来
     ─────────────────────────────────────────────────────────────── */
  var RANGES = {
    energy: { normal: [35, 75], low: [5, 20],  high: [80, 100] },
    water:  { normal: [40, 80], low: [5, 25],  high: [85, 100] },
    atmo:   { normal: [35, 80], low: [5, 20],  high: [85, 100] },
    land:   { normal: [35, 75], low: [5, 20],  high: [80, 100] }
  };

  // 四个本源的 key 和中文名（到处都要用，统一放这）
  var ESSENCE_KEYS = ['energy', 'water', 'atmo', 'land'];
  var ESSENCE_NAMES = {
    energy: '能量浓度',
    water:  '水之本源',
    atmo:   '大气密度',
    land:   '大地之基'
  };

  /* ───────────────────────────────────────────────────────────────
     第二层：外观
     ─────────────────────────────────────────────────────────────── */

  // 8 色板。hue 是色相（0-360），真正的颜色由渲染层按明暗层次算出来。
  var PALETTES = [
    { key: 'darkred', hue:   0, name: '暗红' },
    { key: 'slate',   hue: 210, name: '灰蓝' },
    { key: 'ochre',   hue:  40, name: '土黄' },
    { key: 'violet',  hue: 270, name: '深紫' },
    { key: 'teal',    hue: 165, name: '青绿' },
    { key: 'sienna',  hue:  20, name: '赭石' },
    { key: 'moss',    hue: 130, name: '墨绿' },
    { key: 'ash',     hue: 220, name: '雾灰' }
  ];

  // 色板怎么被本源影响 —— 让每个球第一眼就能看出它的"命"
  var PALETTE_GROUPS = {
    warm: ['darkred', 'sienna', 'ochre'],   // 能量高 → 暖色
    cool: ['slate', 'teal'],                // 水多   → 冷色
    deep: ['violet', 'moss'],               // 能量水都高 → 深邃
    dry:  ['ochre', 'ash']                  // 能量水都低 → 干枯
  };

  // 世界半径占画布短边的比例
  var SIZES = { small: 0.36, mid: 0.42, large: 0.47 };

  // 四种地表纹理
  var TEXTURES = ['crack', 'patch', 'stripe', 'noise'];

  // 自转角速度（弧度/秒）：慢 / 中 / 快
  var SPINS = [0.08, 0.20, 0.45];

  /* ═══════════════════════════════════════════════════════════════
     主入口
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 开辟一个新世界。
   *
   * @param {number} seedNum 种子号。同一个种子号 → 必然产出同一个世界
   * @returns {object} 世界档案
   */
  function makeWorld(seedNum) {
    var rng = RNG.makeRng(seedNum);

    var world = {
      seedNum: seedNum,
      seed: RNG.seedToString(seedNum),

      tier: 'normal',      // normal | extreme | special
      round: 1,            // 第几轮演化（1 = 第一轮；「继续演化」会 +1，见 CLAUDE.md 第七节）
      essence: {},         // 第一层：四个本源（会被滑杆和漂移改动）
      essence0: {},        // 本源初始值，【重置】时恢复用
      look: {},            // 第二层：外观
      traits: [],          // 第三层：特殊属性标签
                           // （不需要备份：它从生成到结束都不会变）

      // 文明（进入文明阶段时才填，见 civ.js）
      civ: { proto: null, form: null, temper: null, isEgg: false },

      // 演化状态
      evo: {
        stage: 0,          // 0-5，当前阶段
        progress: 0,       // 当前阶段进度 0→1
        stageTime: 0,      // 当前阶段持续了多少世界秒
        layers: { ocean: 0, continent: 0, life: 0, civ: 0 },
        rotation: 0        // 累计自转角度（弧度）
      },

      // ── 元素系统（详见 elements.js）──
      // 在"往世界上投放元素"这个玩法出现之前，世界只是四个全局数字，
      // **它不知道"哪里"** —— 整个球是均匀的。
      // 下面这几个字段就是给它加上那层"空间"。
      drops: [],          // 投放的影响斑：每个有自己的位置、半径、强度
      dropsVersion: 0,    // 斑每增减一次就 +1（给 elements.js 的缓存当失效标记用）
      dropCount: 0,       // 玩家一共投放了几次（文明形态 / 「被观测」命运要用）
      dropTally: null,    // 各元素分别投了几次，如 {fire:3, ice:1}（elements.js 里建）
      light: 0,           // 光暗值 -100 ~ +100（正=光占优，负=暗占优）
      discord: 0,         // 光暗冲突值，超过阈值会撕出「混沌裂隙」
      event: null,        // 当前正在发生的冲突事件（fire / night / rift）
      fractured: false,   // 出现过混沌裂隙 → 结局会改成「世界破碎」

      // 运行状态
      running: false,
      timeScale: 1,
      finished: false,
      ending: null
    };

    rollEssence(rng, world);    // 第一层
    rollLook(rng, world);       // 第二层
    rollTraits(rng, world);     // 第三层
    applyTraits(rng, world);    // 特殊属性回写前两层
    bakeTexture(rng, world);    // 把纹理形状算好存起来（渲染层直接画）
    bakeLayers(rng, world);     // 把海洋/大陆/生态/文明的形状也算好

    // 记录本源初始值 —— 【重置】按钮要用它把世界退回初始态
    world.essence0 = cloneEssence(world.essence);

    return world;
  }

  /* ═══════════════════════════════════════════════════════════════
     第一层：世界本源
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 掷第一层的骰子。
   *
   * 关键设计：**整颗星球统一掷一次档位骰**，不是每项各掷一次。
   * 为什么不每项各掷？因为那样很容易掷出「能量 90 的炼狱 + 水 90 的汪洋」
   * 这种自相矛盾的组合，世界会变成四不像。
   * 统一掷一次，世界就有统一的"性格"。
   */
  function rollEssence(rng, world) {
    // 掷档位骰：70% 温和 / 20% 极端 / 10% 特殊属性
    var tier = RNG.weighted(rng, {
      normal:  WEIGHTS.tierNormal,
      extreme: WEIGHTS.tierExtreme,
      special: WEIGHTS.tierSpecial
    });
    world.tier = tier;

    // 默认四项都走温和区间
    var band = {};
    var i;
    for (i = 0; i < ESSENCE_KEYS.length; i++) band[ESSENCE_KEYS[i]] = 'normal';

    // 极端档：随机挑 1-2 项走极端，每项再随机挑是偏高还是偏低
    if (tier === 'extreme') {
      var count = RNG.int(rng, 1, 2);
      var pool = RNG.shuffle(rng, ESSENCE_KEYS);
      for (i = 0; i < count; i++) {
        band[pool[i]] = rng() < 0.5 ? 'low' : 'high';
      }
    }
    // 特殊档：本源照常随机（四项都走温和区间），特殊属性在第三层处理

    // 按各自的区间取值
    for (i = 0; i < ESSENCE_KEYS.length; i++) {
      var k = ESSENCE_KEYS[i];
      var r = RANGES[k][band[k]];
      world.essence[k] = Math.round(RNG.range(rng, r[0], r[1]));
    }
  }

  function cloneEssence(e) {
    var out = {};
    for (var i = 0; i < ESSENCE_KEYS.length; i++) out[ESSENCE_KEYS[i]] = e[ESSENCE_KEYS[i]];
    return out;
  }

  /* ═══════════════════════════════════════════════════════════════
     第二层：世界外观
     ═══════════════════════════════════════════════════════════════ */

  function rollLook(rng, world) {
    // ── 大小：小 / 中 / 大，各 1/3 ──
    var sizeKey = RNG.pick(rng, ['small', 'mid', 'large']);

    // ── 地表纹理：裂纹 / 斑块 / 条纹 / 噪点，各 25% ──
    var texture = RNG.pick(rng, TEXTURES);

    // ── 自转速度：慢 / 中 / 快，各 1/3 ──
    var spin = RNG.pick(rng, SPINS);

    // ── 光环：15% ──
    var hasRing = RNG.chance(rng, WEIGHTS.ringChance);

    // ── 卫星：0 颗 75% / 1 颗 20% / 2 颗 5% ──
    // 用一次骰子同时决定，避免"先判 20% 再判 5%"造成的概率叠加错误
    var moons = [];
    var mRoll = rng() * 100;
    if (mRoll < WEIGHTS.moon2Chance) {
      moons.push(makeMoon(rng));
      moons.push(makeMoon(rng));
    } else if (mRoll < WEIGHTS.moon2Chance + WEIGHTS.moon1Chance) {
      moons.push(makeMoon(rng));
    }

    // ── 主色调：由本源决定从哪一组里挑 ──
    var palette = pickPalette(rng, world.essence);

    // ── 本源对外观的「连续」影响 ──
    //
    // 为什么非要加这一段：
    //   本源是 0-100 的连续值，四个组合起来是天文数字。
    //   但它们原本**只用来"选哪组色板"**，选完就没用了 ——
    //   于是外观被压扁成 8 色板 × 4 纹理 × 3 大小 …… 一共才两千来种"脸"。
    //   实测：玩家开到第 50 个世界，就有 44% 的概率觉得"这颗我见过"。
    //
    //   让本源连续地影响外观之后，每个世界都会长得不一样，
    //   而且**一眼就能看出这个世界的"命"** ——
    //   不用看数字，光看球是"发亮的暖色"还是"灰暗的冷色"就知道它缺不缺水。
    var e = world.essence;

    // 水少 → 色相往土黄那侧偏（+）；水多 → 往青蓝那侧偏（−）
    var hueShift = (55 - e.water) * 0.42;                      // 约 −19° ~ +23°

    // 能量高 → 地表更亮更"烫"
    var bright = 0.82 + (e.energy / 100) * 0.38;               // 0.82 ~ 1.20

    // 大气厚 → 表面蒙一层雾，看起来更朦胧
    var haze = Math.max(0, (e.atmo - 40) / 60) * 0.34;         // 0 ~ 0.34

    // 大地多 → 纹理更明显；大地少 → 纹理很淡（像被海洋/大气盖住）
    // 上限取 1.0：渲染时用 globalAlpha 乘，超过 1 是没用的
    var texStrength = 0.45 + (e.land / 100) * 0.55;            // 0.45 ~ 1.0

    world.look = {
      size: sizeKey,
      radiusRatio: SIZES[sizeKey],
      texture: texture,
      spin: spin,
      hasRing: hasRing,
      moons: moons,

      palette: palette.key,
      paletteName: palette.name,
      hue: palette.hue,

      // 上面那四项 —— 本源带来的连续差异，让每个世界长得都不一样
      hueShift: hueShift,
      bright: bright,
      haze: haze,
      texStrength: texStrength,

      // 下面几项会被「特殊属性」修改
      squash: 1.0,        // 高重力 → 0.88（球体压扁）
      texDensity: 1.0,    // 高重力 → 1.5（纹理更密）
      atmoHue: null,      // 剧毒大气 → 填一个色相（紫 280 / 绿 120）
      companion: false,   // 双星系统 → true，世界背后多一圈伴星光晕

      texMarks: null      // 纹理形状，由 bakeTexture() 填
    };
  }

  /**
   * 挑主色调。
   * 规则见 CLAUDE.md 第五节：能量高推暖色、水多推冷色、都高推深邃、都低推干枯。
   * 都不满足时从 8 色板纯随机。
   */
  function pickPalette(rng, e) {
    var group = null;

    if (e.energy > 70 && e.water > 70)      group = 'deep';
    else if (e.energy > 75)                 group = 'warm';
    else if (e.water > 75)                  group = 'cool';
    else if (e.energy < 30 && e.water < 30) group = 'dry';

    if (group) return findPalette(RNG.pick(rng, PALETTE_GROUPS[group]));
    return RNG.pick(rng, PALETTES);
  }

  function findPalette(key) {
    for (var i = 0; i < PALETTES.length; i++) {
      if (PALETTES[i].key === key) return PALETTES[i];
    }
    return PALETTES[0];
  }

  /**
   * 造一颗卫星。
   * 所有数值都以「世界半径为 1」为单位，这样世界大小变了卫星也跟着缩。
   */
  function makeMoon(rng) {
    return {
      dist:  RNG.range(rng, 1.45, 2.05),   // 轨道半径
      size:  RNG.range(rng, 0.055, 0.105), // 卫星半径
      speed: RNG.range(rng, 0.22, 0.55) * (rng() < 0.5 ? 1 : -1),  // 可正可负，转的方向不同
      angle: RNG.range(rng, 0, Math.PI * 2),
      tilt:  RNG.range(rng, -0.45, 0.45),  // 轨道压扁程度，看起来更立体
      tone:  RNG.range(rng, 0, 360)        // 卫星自己的色调（饱和度很低，偏灰）
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     第三层：特殊属性（10% 触发一个）
     ═══════════════════════════════════════════════════════════════ */

  function rollTraits(rng, world) {
    world.traits = [];

    // 注意：这里用的就是第一层掷出来的档位，不是重新掷一次。
    // 否则概率会变成两次独立判定，实际触发率会偏高。
    if (world.tier === 'special') {
      world.traits.push(RNG.pick(rng, WEIGHTS.traits));
    }
  }

  /**
   * 特殊属性回写前两层 —— 让世界自洽。
   * 比如抽到「高重力」，就得真的把球压扁、把纹理加密，不能只是挂个标签。
   */
  function applyTraits(rng, world) {
    for (var i = 0; i < world.traits.length; i++) {
      var t = world.traits[i];
      var look = world.look;

      if (t === 'binary') {
        // 双星系统：色相整体偏暖，背后多一圈伴星光晕
        look.hue = (look.hue + 18) % 360;
        look.companion = true;

      } else if (t === 'gravity') {
        // 高重力：球体压扁、纹理加密
        look.squash = 0.88;
        look.texDensity = 1.5;

      } else if (t === 'toxic') {
        // 剧毒大气：大气圈层变成紫色或绿色
        look.atmoHue = rng() < 0.5 ? 280 : 120;

      } else if (t === 'moon') {
        // 有卫星：保证至少有一颗。
        // 如果第二层本来就有卫星，这里不动它 —— 不会变成三颗。
        if (look.moons.length === 0) look.moons.push(makeMoon(rng));
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     纹理烘焙
     建世界时一次性把纹理形状算好存起来，渲染层每帧直接画。
     为什么不每帧现算？因为每帧重算会让纹理"抖动"，而且浪费性能。
     ═══════════════════════════════════════════════════════════════ */

  /* ═══════════════════════════════════════════════════════════════
     球面几何  ★ 2026-09-13 新增
     ═══════════════════════════════════════════════════════════════

     ★★ 地表特征的坐标从「平面圆盘」改成了「球面经纬度」★★

     **改之前**：纹理和斑块都烘在一张平面圆盘上（x, y ∈ -1~1），
     渲染时整块圆盘 `ctx.rotate()` 转起来。那在几何上等于
     **从北极正上方往下看** —— 每个点永远在同一个半径上打圈，
     **没有任何东西会转到背面去**。
     看着像一张贴在转盘上的贴纸，不像一颗在自转的星球。
     （原话是：「你现在这样转永远都只能看到一个面」）

     **改之后**：特征是球面上的经纬度，渲染时做**正射投影**
     （观察者在 +X 方向无穷远处，北极朝上）——
     特征会从一边转进来、在边缘压扁、横穿、从另一边转出去。

     ⚠️ 这几个函数是**公开的**（见下面 return）——
        render/renderer.js 也要用（搬斑块轮廓、做投影）。
        依赖方向 ⑩ → ⑦ 是允许的，见 CLAUDE.md 第三节的依赖图。

     ⚠️ `lon` 是**不绕回**的普通数字：裂谷一路走可能超过 2π，
        sin/cos 照样对，不用取模。
     ═══════════════════════════════════════════════════════════════ */

  var TAU = Math.PI * 2;

  /* 纬度上限 ±74.5°（弧度 1.30）。
     为什么不让特征上两极：正射投影下两极附近的经线会挤在一起，
     纹理堆在那儿会糊成一坨。留出这一圈空白，看着也更像"极冠"。 */
  var LAT_CAP = 1.30;
  var SIN_CAP = Math.sin(LAT_CAP);

  /**
   * 在球面上**等面积**地取一点。
   * ⚠️ 纬度必须用 asin 取 —— 直接均匀取 lat 的话两极会挤成一坨。
   */
  function spherePoint(rng) {
    return {
      lon: RNG.range(rng, 0, TAU),
      lat: Math.asin(RNG.range(rng, -SIN_CAP, SIN_CAP))
    };
  }

  /**
   * 从球面上一点出发，朝方位角 az 走 dist 弧度。
   *
   * 用三维旋转算（Rodrigues 公式的简化版），**大角度也准** ——
   * 斑块半径能到 45°，用"经度纬度各加一点"那种线性近似会歪得厉害。
   *
   * ⚠️ 这是整套改造的地基：裂谷怎么走、斑块轮廓怎么摆，全靠它。
   *    以前是 `x += cos(dir) * len`，现在是同样的意思，但在球面上。
   *
   * @param {number} az   0 = 朝东（经度增大的方向），π/2 = 朝北
   * @param {number} dist 走多远（弧度）
   */
  function sphereStep(lon, lat, az, dist) {
    var cl = Math.cos(lat), sl = Math.sin(lat);
    var co = Math.cos(lon), so = Math.sin(lon);

    // 该点的三维单位向量，以及它的「朝东 / 朝北」两条切向量
    var px = cl * co, py = cl * so, pz = sl;
    var ex = -so, ey = co, ez = 0;
    var nx = -sl * co, ny = -sl * so, nz = cl;

    var ca = Math.cos(az), sa = Math.sin(az);
    var dx = ex * ca + nx * sa, dy = ey * ca + ny * sa, dz = ez * ca + nz * sa;

    // 沿切线走 dist，再拉回球面
    var c = Math.cos(dist), s = Math.sin(dist);
    return {
      lon: Math.atan2(py * c + dy * s, px * c + dx * s),
      lat: Math.asin(Math.max(-1, Math.min(1, pz * c + dz * s)))
    };
  }

  /**
   * 球面上两点之间的夹角（弧度）—— 判断"在不在里面"用。
   * （以前是平面上的勾股距离，现在得用球面距离。）
   */
  function sphereDist(a, b) {
    var d = Math.sin(a.lat) * Math.sin(b.lat) +
            Math.cos(a.lat) * Math.cos(b.lat) * Math.cos(a.lon - b.lon);
    return Math.acos(Math.max(-1, Math.min(1, d)));
  }

  /**
   * 成团分布：生成一组"聚成几块"的点，而不是均匀撒满。
   *
   * 做法：先随机几个"团心"，再让大部分点落在团心附近。
   * Math.pow(rng(), 1.8) 会把随机数往 0 压，所以点会挤在团心周围。
   *
   * 为什么要这样？均匀撒开的点在视觉上等于"电视雪花"，
   * 只有聚集成块才像自然形成的地貌。
   *
   * @param {number} spread 团散多开（**弧度**，不是以前的圆盘单位）
   */
  function clusteredPoints(rng, count, clusterCount, spread) {
    var centers = [];
    var i;
    for (i = 0; i < clusterCount; i++) centers.push(spherePoint(rng));

    var pts = [];
    for (i = 0; i < count; i++) {
      var c = centers[RNG.int(rng, 0, centers.length - 1)];
      var az = RNG.range(rng, 0, TAU);
      var dist = Math.pow(rng(), 1.8) * spread;
      pts.push(sphereStep(c.lon, c.lat, az, dist));
    }
    return pts;
  }

  /**
   * 让纹理"像真实世界"的三条原则（踩过坑之后总结的）：
   *   ① 多尺度 —— 地形必须有大小层次：大陆 → 区域 → 碎石。
   *                所有特征一样大，一眼就假。
   *   ② 成团   —— 真实地形是聚集成块的，不是均匀撒开的。
   *   ③ 几何对 —— 俯视一个球，纹理得符合球面几何。
   *                笔直的横条纹一转起来像风车，不像星球。
   */
  function bakeTexture(rng, world) {
    var type = world.look.texture;
    var marks = [];

    if (type === 'crack')       bakeCrack(rng, marks);
    else if (type === 'patch')  bakePatch(rng, marks);
    else if (type === 'stripe') bakeStripe(rng, marks);
    else if (type === 'noise')  bakeNoise(rng, marks);

    world.look.texMarks = marks;
  }

  /* ─────────────────────────────────────────────────────────────
     裂纹 —— 做成「裂谷网络」
     不是几根孤立的涂鸦，而是有主干、有分叉、越走越细的裂缝系统
     ───────────────────────────────────────────────────────────── */

  function bakeCrack(rng, marks) {
    /* ⚠️ 主裂谷从 3-4 条加到 5-7 条：
       以前整个圆盘 = 可见的那一个半球，现在摊到**整颗球**上（面积翻倍），
       条数不跟着翻的话，每次只能看到一半的裂缝，星球显得空。 */
    var mains = RNG.int(rng, 5, 7);

    for (var i = 0; i < mains; i++) {
      var p0 = spherePoint(rng);
      var rift = walkRift(rng, p0.lon, p0.lat, RNG.range(rng, 0, TAU), 0.030);
      marks.push(rift);

      // 从主裂谷的半路上分叉出去 2-3 条更细的支裂谷。
      // 有分叉才像地壳真的裂开了 —— 孤立的几根线看起来就是随手画的。
      var branches = RNG.int(rng, 2, 3);
      for (var b = 0; b < branches; b++) {
        var at = RNG.int(rng, 1, Math.max(1, rift.pts.length - 3));
        var p = rift.pts[at];
        var prev = rift.pts[at - 1] || p;

        /* ⚠️ 分叉方向必须在**球面**上算：
           经度差要先乘 cos(lat) 才是真实的东向距离。
           不乘的话，靠近两极时算出来的方向会歪掉，分叉会长得莫名其妙。 */
        var cl = Math.cos(p.lat) || 0.001;
        var baseAz = Math.atan2(p.lat - prev.lat, (p.lon - prev.lon) * cl);

        marks.push(walkRift(rng, p.lon, p.lat,
                            baseAz + RNG.range(rng, -1.2, 1.2), 0.016));
      }
    }
  }

  /**
   * 走出一条裂谷：从球面上一点出发，朝方位角 az 蜿蜒前进。
   *
   * 步数多、步子小、方向抖得轻 —— 这样走出来的是"缓慢蜿蜒的曲线"。
   * 如果步数少、步子大、抖得狠，走出来就是"几段折线"，
   * 看着就像用尺子比着画的。
   *
   * ★ 和改之前唯一的结构差别：`dir` 现在叫 `az` 且是**球面方位角**，
   *   点从 {x, y} 变成 {lon, lat}。
   *   步长单位也从"圆盘半径的几分之一"变成了**弧度** ——
   *   1 弧度 ≈ 球半径那么长，所以 0.04~0.08 等于原来那种小碎步。
   *
   * @param {number} width 起始半宽（**弧度**，不是像素也不是圆盘单位）
   */
  function walkRift(rng, lon, lat, az, width) {
    var pts = [{ lon: lon, lat: lat }];
    var jit = [RNG.range(rng, 0.78, 1.12)];   // 每个点的宽度倍率
    var segs = RNG.int(rng, 14, 22);

    for (var i = 0; i < segs; i++) {
      az += RNG.range(rng, -0.26, 0.26);
      var len = RNG.range(rng, 0.040, 0.080);
      var np = sphereStep(lon, lat, az, len);
      lon = np.lon; lat = np.lat;
      pts.push({ lon: lon, lat: lat });

      // 宽度倍率做「平滑随机游走」：在上一个值附近小幅浮动。
      // 为什么不每点独立随机？那样相邻点宽度会剧烈跳变，
      // 带子边缘变成锯齿状，很难看。缓慢变化才像自然裂开的口子。
      var j = jit[i] * RNG.range(rng, 0.88, 1.14);
      if (j < 0.58) j = 0.58;
      if (j > 1.42) j = 1.42;
      jit.push(j);
    }

    // w0 → w1：宽度一路收窄，画出"越走越细"
    // jit   ：每个点的宽度倍率，画出"忽宽忽窄"的不规则边缘
    return { type: 'crack', pts: pts, jit: jit, w0: width, w1: width * 0.35 };
  }

  /* ─────────────────────────────────────────────────────────────
     斑块 —— 做成「大陆」
     几个核心，每个核心周围长一圈明显小一档的附属斑块
     ───────────────────────────────────────────────────────────── */

  function bakePatch(rng, marks) {
    // ⚠️ 4-6 个核心 → 7-10 个：摊到整颗球上（面积翻倍），不翻倍会显得空
    var cores = RNG.int(rng, 7, 10);

    for (var i = 0; i < cores; i++) {
      var c = spherePoint(rng);

      /* 核心：一块大的。
         ⚠️ rx / ry 现在是**弧度**（角半径），不是圆盘上的比例。
            改之前 0.15~0.29 是"世界半径的几分之几"，
            换算成角度大约就是 0.24~0.46 弧度（0.29 × 90°）。 */
      marks.push({
        type: 'patch',
        lon: c.lon, lat: c.lat,
        rx: RNG.range(rng, 0.24, 0.44),
        ry: RNG.range(rng, 0.19, 0.38),
        rot: RNG.range(rng, 0, Math.PI),
        light: RNG.range(rng, -0.12, 0.12)
      });

      // 附属：贴着核心长，尺寸明显小一档 —— 这就是"多尺度"
      var kids = RNG.int(rng, 5, 9);
      for (var k = 0; k < kids; k++) {
        var kp = sphereStep(c.lon, c.lat,
                            RNG.range(rng, 0, TAU),
                            RNG.range(rng, 0.16, 0.42));
        marks.push({
          type: 'patch',
          lon: kp.lon, lat: kp.lat,
          rx: RNG.range(rng, 0.07, 0.21),
          ry: RNG.range(rng, 0.055, 0.18),
          rot: RNG.range(rng, 0, Math.PI),
          light: RNG.range(rng, -0.14, 0.14)
        });
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────
     条纹 —— 球面上的「小圆带」
     ⚠️ 这条历史最长，两次栽在同一个坑上：
        · 最早是水平的波浪线 —— 世界一自转它们跟着转，像个**大风车**
        · 改成斜着的弧带（治标）—— 好了一点，但仍在平面里刚性旋转
        · ★ 现在改成**球面上的小圆带**（治本）：
          带子是真的一圈圈绕在球上的，转起来会从边缘弯出去
     ───────────────────────────────────────────────────────────── */

  function bakeStripe(rng, marks) {
    // 7-11 → 12-18：摊到整颗球上（面积翻倍）
    var n = RNG.int(rng, 12, 18);

    /* ★ 整颗球**共用一条带轴**，每条带子都是"离这条轴固定角度的一圈"。
       这样所有条纹大致平行，像木星那种条带。

       ⚠️ 不能每条自己随机一根轴 —— 那样带子会朝各个方向乱穿，
          看着像包扎的绷带，不像一颗有气候带的星球。 */
    var axis = spherePoint(rng);

    for (var i = 0; i < n; i++) {
      // 每条在自己的轴上稍微偏一点，别整齐得像印刷出来的
      var ax = sphereStep(axis.lon, axis.lat,
                          RNG.range(rng, 0, TAU),
                          RNG.range(rng, 0, 0.22));

      var dist = RNG.range(rng, 0.25, 1.30);   // 带子中心线离轴多远（弧度）
      var h = RNG.range(rng, 0.035, 0.115);    // 带子半厚（弧度）

      /* ★ 两条边**在这里就采样好**，不留给渲染层算。
         理由：渲染层（⑩）是**零依赖**的（UMD 工厂都不接参数，
         见 renderer.js 顶上的铁律 B），它够不着 sphereStep。
         把球面几何全留在 worldgen，渲染层就只剩"投影 + 画"这一件事。

         ⚠️ 采样数不能少：带子沿球面绕一整圈，点太少会变成多边形棱角。 */
      var STEPS = 48;
      var outer = [], inner = [];
      for (var s = 0; s <= STEPS; s++) {
        var t = (s / STEPS) * TAU;
        outer.push(sphereStep(ax.lon, ax.lat, t, dist + h));
        inner.push(sphereStep(ax.lon, ax.lat, t, dist - h));
      }

      marks.push({
        type: 'stripe',
        outer: outer, inner: inner,          // 带子的两条边（球面经纬度）
        light: RNG.range(rng, -0.14, 0.14),
        alpha: RNG.range(rng, 0.20, 0.40)
      });
    }
  }

  /* ─────────────────────────────────────────────────────────────
     噪点 —— 三个尺度叠起来，才像粗糙的地表
     只有一个小尺度的点 = 电视雪花
     ───────────────────────────────────────────────────────────── */

  function bakeNoise(rng, marks) {
    var i;

    // ① 大尺度：几片淡色斑块，当作地形起伏
    var big = RNG.int(rng, 9, 14);
    for (i = 0; i < big; i++) {
      var bp = spherePoint(rng);
      marks.push({
        type: 'patch',
        lon: bp.lon, lat: bp.lat,
        rx: RNG.range(rng, 0.20, 0.42),
        ry: RNG.range(rng, 0.17, 0.36),
        rot: RNG.range(rng, 0, Math.PI),
        light: RNG.range(rng, -0.09, 0.09)
      });
    }

    /* ② 中尺度 + ③ 小尺度：两批成团分布的点，尺寸和透明度都不同
       ⚠️ 点数翻倍（38-55 → 76-110，110-150 → 220-300），
          理由是摊到整颗球上面积翻倍了。
          **不会因此变慢** —— 转了半圈的球有一半点在背面，
          渲染时直接跳过，实际画的还是原来那么多。 */
    var pts = [];

    var mid = clusteredPoints(rng, RNG.int(rng, 76, 110), 9, 0.36);
    for (i = 0; i < mid.length; i++) {
      pts.push({
        lon: mid[i].lon, lat: mid[i].lat,
        r: RNG.range(rng, 0.014, 0.034),      // 弧度
        light: RNG.range(rng, -0.16, 0.16),
        alpha: RNG.range(rng, 0.35, 0.55)
      });
    }

    var fine = clusteredPoints(rng, RNG.int(rng, 220, 300), 14, 0.26);
    for (i = 0; i < fine.length; i++) {
      pts.push({
        lon: fine[i].lon, lat: fine[i].lat,
        r: RNG.range(rng, 0.005, 0.014),
        light: RNG.range(rng, -0.20, 0.20),
        alpha: RNG.range(rng, 0.18, 0.34)
      });
    }

    marks.push({ type: 'noise', pts: pts });
  }

  /* ═══════════════════════════════════════════════════════════════
     图层烘焙 —— 海洋 / 大陆 / 生态 / 文明
     ═══════════════════════════════════════════════════════════════
     为什么不每帧现算：因为每帧重算形状会让斑块"抖动"，
     而且这些形状跟种子有关、跟时间无关 —— 算一次就够了。

     存下来的形状长这样（每个图层是一组"岛"）：
       { lon, lat, 中心点（**球面经纬度**，弧度）
         r,        角半径（弧度）—— 不是像素，也不是以前的圆盘比例
         wob,      边缘不规则程度
         rot,      轮廓起点方位角
         verts[],  每个顶点的半径扰动（做出歪歪扭扭的边）
         delay,    出场延迟（让斑块错开冒出来，不要一起蹦出来）
         boost }   局部增速（由演化系统每帧更新，见 evolution.js）
     ═══════════════════════════════════════════════════════════════ */

  /* ── 每个图层撒几个岛、多大 ──
     ⚠️ 这几个数字是**性能红线**，不是随便定的。
        实测：图层绘制占了整帧绘制调用的**一半以上**（约 694 次）。
        岛越多、顶点越多，手机上越容易掉帧。
        调整前先用 _render_test.js 量一下单帧成本。

        参考值：19 个岛的路径 + 47 个文明光点 ≈ 整帧 1500 次调用，
        已经踩到手机 Canvas 2D 的上限了。

     ★ 2026-09-13 坐标改成球面时，**数量大概翻了一倍**（面积翻倍），
        但**单帧成本没涨** —— 转过半圈的球有一半点在背面，
        渲染时直接跳过。实测见 _render_test.js 的单帧统计。 */
  var LAYER_SHAPES = {
    ocean:     { count: [9, 13],  rMin: 0.50, rMax: 0.86 },
    continent: { count: [9, 12],  rMin: 0.38, rMax: 0.66 },
    life:      { count: [16, 24], rMin: 0.10, rMax: 0.24 },   // 撒在大陆里
    civ:       { count: [40, 60], rMin: 0.014, rMax: 0.038 }  // 金点
  };

  var VERT_COUNT = 14;   // 每个岛用几个顶点画轮廓（越多越圆润，越少越棱角）

  function bakeLayers(rng, world) {
    var out = { ocean: [], continent: [], life: [], civ: [] };

    // ── 海洋和大陆：铺满整个球面，各自随机撒 ──
    // 大陆画在海洋之上，所以两者重叠的部分自然被大陆盖住 ——
    // 这就形成了"海陆交错"的效果，不用特意去算互补。
    out.ocean     = makeBlobSet(rng, LAYER_SHAPES.ocean);
    out.continent = makeBlobSet(rng, LAYER_SHAPES.continent);

    // ── 生态和文明：只长在大陆上 ──
    // 做法是"在大陆斑块的内部随机取点"。
    // ⚠️ 取点范围只取大陆半径的一半 ——
    //    因为大陆是慢慢长大的，早期只有中心那一块。
    //    如果按满半径撒，早期植被会飘在海面上。
    out.life = makeBlobSet(rng, LAYER_SHAPES.life, out.continent, 0.5);
    out.civ  = makeBlobSet(rng, LAYER_SHAPES.civ,  out.continent, 0.55);

    world.blobs = out;
  }

  /**
   * 造一组岛。
   * @param {Array} [hosts]    如果给了，岛就撒在这些"宿主"斑块内部（生态/文明用）
   * @param {number} [hostFrac] 撒在宿主半径的百分之多少以内
   */
  function makeBlobSet(rng, shape, hosts, hostFrac) {
    var n = RNG.int(rng, shape.count[0], shape.count[1]);
    var list = [];

    for (var i = 0; i < n; i++) {
      var p, r;

      if (hosts && hosts.length) {
        /* 在某个宿主（大陆）内部取一点。
           ⚠️ 搬点用 sphereStep（球面），不是平面上的 x/y 加法 ——
              宿主跨过半球的边时，平面加法会把它算到球外面去。
           ⚠️ 用 sqrt(rng) 而不是 rng：圆面积正比于半径平方，
              不 sqrt 的话点会往圆心挤。 */
        var h = hosts[RNG.int(rng, 0, hosts.length - 1)];
        p = sphereStep(h.lon, h.lat,
                       RNG.range(rng, 0, TAU),
                       Math.sqrt(rng()) * h.r * hostFrac);
        r = RNG.range(rng, shape.rMin, shape.rMax);
      } else {
        // 直接在整个球面上等面积取一点（海洋 / 大陆用这条）
        p = spherePoint(rng);
        r = RNG.range(rng, shape.rMin, shape.rMax);
      }

      // 每个顶点的半径扰动 —— 边缘歪歪扭扭靠它
      var verts = [];
      for (var v = 0; v < VERT_COUNT; v++) verts.push(RNG.range(rng, -1, 1));

      list.push({
        lon: p.lon, lat: p.lat, r: r,
        wob: RNG.range(rng, 0.14, 0.40),
        rot: RNG.range(rng, 0, TAU),
        delay: RNG.range(rng, 0, 0.35),   // 出场延迟，错开冒出来
        verts: verts,
        boost: 0                          // 局部增速，演化时填
      });
    }

    return list;
  }

  /* ═══════════════════════════════════════════════════════════════
     档案库：世界档案的「存」和「取」   ★ 2026-09-14 新增
     ═══════════════════════════════════════════════════════════════

     为什么这两个函数在这儿：**worldgen 拥有"世界档案长什么样"这件事**
     （`makeWorld` 就是造它的）。存档只是把同一份档案换个地方放，
     格式当然该由它说了算 —— 放别处就成了"第二个知道档案长什么样的人"。

     ★★ 省掉九成体积的关键：**形状数据不用存** ★★

     实测一份完整世界档案约 **6 万字符**，其中九成是
     `blobs`（海洋/大陆/生态/文明的斑块）和 `look.texMarks`（纹理）。

     而这两样**完全由种子决定** —— `makeWorld(seedNum)` 是纯函数，
     同一个种子烘出来的形状**一模一样**。所以：

         存的时候丢掉它们，取的时候用种子重新烘一遍。
         一条从 6 万字符降到约 4 千。

     换算成能存几条：5MB 的 localStorage 从"只能存 85 条"
     变成"能存一千多条"。
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 把一份世界档案变成"可以存起来"的样子。
   *
   * 分两刀：
   *   ① **能重烘的形状数据** —— blobs / look.texMarks（见上面那段）
   *   ② **打完就没用的运行期数据** —— 见 stripFinishedCiv
   *
   * ⚠️ 用 JSON 深拷贝，**不就地删** —— 就地删的话，玩家存完档案回到游戏，
   *    屏幕上那颗球当场变成一颗没有纹理的秃球。
   */
  function stripWorld(world) {
    var s = JSON.parse(JSON.stringify(world));
    delete s.blobs;
    if (s.look) delete s.look.texMarks;
    stripFinishedCiv(s);
    return s;
  }

  /**
   * 第二刀：把**这一局已经用不上的**两块丢掉。★ 2026-09-14
   *
   * 实测（800 局）：world 部分 7,964 字符 → 5,240，**省三分之一**。
   * 两块各是什么：
   *
   *   · `pool` —— 抽签用的**候选句池**（整个物种的文案副本，一条 1,651 字符）
   *   · 每行的 `src` —— 写历史时用来查重的**替换前原文**（约 1,285 字符）
   *
   * 为什么不心疼：
   *
   *   `pool` 唯一的读者是 `CivLore.takeLine(c.pool, …)` —— 它只在
   *   **写编年史的过程中**被调（evolution.js 的 stepCiv 里）。
   *   而 `rows[].src` 唯一的读者是 `CivLore.omenText` 里那段"征兆不许重复"
   *   —— 同样只在写的过程中。
   *
   * ⚠️⚠️ **所以必须有 `phase === 3` 这道闸门** ⚠️⚠️
   *     一局打完时 `phase` 是 3（收尾了），`stepCiv` 对它直接 return null，
   *     上面两条路**再也不会走到**，扔掉是安全的。
   *     但要是哪天有个"还没打完的局"也被存进来（现在没有这条路 ——
   *     只有结局面板上的【存入档案库】会存，而它只在 done 之后出现），
   *     池子被扔掉的局一恢复就会**崩在 takeLine 里**。
   *     带上这道闸门，那种情况自动退回"全量存"，只是多占点地方。
   *
   * ★ 实测 800 局：出现结局的 760 个有文明的世界，phase **全是 3**，无一例外。
   *
   * ⚠️ 显示路径一律只读 `rows[].kind` / `rows[].text`（app.js 的编年史面板、
   *    ending.js 的溃散传记），**没有一处读 `src`** —— 删掉它不影响任何画面。
   */
  function stripFinishedCiv(s) {
    var c = s.evo && s.evo.civ;
    if (!c || c.phase !== 3) return;

    delete c.pool;

    if (c.rows) {
      for (var i = 0; i < c.rows.length; i++) delete c.rows[i].src;
    }
  }

  /**
   * 把存下来的档案装回成一份完整的世界档案。
   *
   * ⚠️ 不能只 re-bake 就完事 —— 得拿**存下来的那份**当底子。
   *    因为演化过程中世界已经变了：本源漂移过、玩家投过元素、
   *    文明是掷出来的。re-bake 只补 `blobs` 和 `look.texMarks`
   *    这两个"由种子决定、和过程无关"的字段。
   *
   * @param {object} saved stripWorld 的产物
   * @returns {object|null} 装好的世界；档案坏了返回 null（别让整局游戏起不来）
   */
  function restoreWorld(saved) {
    if (!saved || typeof saved.seedNum !== 'number' || !saved.look) return null;

    /* ⚠️⚠️ 外面还要裹一层 try ⚠️⚠️
       档案是从 localStorage 读出来的 —— 那可能是**任何东西**：
       上一次版本留下的旧格式、被别的代码写坏的、玩家手动改过的。
       不裹的话一个坏条目会**抛异常**，而调用方（app.js 的 openArchiveAt）
       没有 try —— 表现是"点了没反应"，玩家只会觉得按钮坏了。

       ⚠️ **这一层和上面那句显式检查是重叠的，不是互补的** ——
          任意一层单独都够用（显式检查挡掉常见的坏形状；try 挡掉
          "看着像对的、一用就炸"的那些）。
          所以负向测试**必须两层一起退掉**才验得出来；
          只退一层的话另一层会兜住，测试还是绿的 —— 那**不是**测试失效，
          是这两层本来就互为兜底。 */
    try {
      // ⚠️ 再拷一份：装好的世界会被游戏接着改动（球继续转、玩家可能继续投元素），
      //    不拷的话那些改动会**写回档案里的那份**，下次打开就不是原来的样子了。
      var w = JSON.parse(JSON.stringify(saved));
      if (!w.look) return null;

      // 形状用种子重新烘 —— 这就是"不用存形状"的底气
      var fresh = makeWorld(w.seedNum);
      w.blobs = fresh.blobs;
      w.look.texMarks = fresh.look.texMarks;

      return w;
    } catch (e) {
      return null;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     工具：给别的模块用
     ═══════════════════════════════════════════════════════════════ */

  /** 把世界退回本源初始值（【重置】按钮用） */
  function resetEssence(world) {
    world.essence = cloneEssence(world.essence0);
  }

  /* ⚠️⚠️ 2026-09-17：`essenceAverage` / `essenceStdDev` **删掉了** ⚠️⚠️
     质量体检抓出来的真死代码：全项目零调用（游戏不用，除了 `_smoke_test.js`
     那两条"自己测自己"的断言 —— 那两条也一起删了，**那不叫覆盖，叫自我循环**）。

     ⚠️ 它们的注释原来写着「结局评定时用」/「判断平衡世界结局时用」——
        **那是早就不成立的假话**：`ending.js` 的 `rate()` 是**自己一趟循环
        同时算 avg 和 min** 的（还要判"有没有哪一项低到致命"）。
        换成调 `essenceAverage` 反而**要多跑一趟循环** ——
        所以 `rate()` 不是"第二把尺子"，这两个函数才是多余的那一份。

     ★ 删掉它们**行为一个字没变** —— 没有任何人在读。 */

  return {
    WEIGHTS: WEIGHTS,
    RANGES: RANGES,
    PALETTES: PALETTES,
    ESSENCE_KEYS: ESSENCE_KEYS,
    ESSENCE_NAMES: ESSENCE_NAMES,

    makeWorld: makeWorld,
    stripWorld: stripWorld,        // ★ 档案库存档用（去掉能重烘的形状）
    restoreWorld: restoreWorld,    // ★ 档案库读档用（形状用种子重烘）
    resetEssence: resetEssence,
    /* ⚠️ 2026-09-17：`essenceAverage` / `essenceStdDev` 两个导出删了 ——
       真死代码，见上面那段说明。 */

    /* ★ 球面几何（2026-09-13 加的）。
       ⚠️ 主要给**测试**用（`_render_test.js` 要拿 sphereDist 验
          「生态斑落在大陆里」），以及将来别的地方要算球面距离时。

       ⚠️⚠️ render/renderer.js **故意不用这几个函数** ——
          它是零依赖的（UMD 工厂连参数都不接，见那个文件顶上的铁律 B），
          拿不到 WorldGen。所以：**球面几何一律在烘焙时算完**，
          渲染层只做"投影 + 画"。
          要加新的地表特征时记住这一条，别顺手在渲染层调 sphereStep。 */
    TAU: TAU,
    spherePoint: spherePoint,
    sphereStep: sphereStep,
    sphereDist: sphereDist
  };
});
