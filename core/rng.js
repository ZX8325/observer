/* ═══════════════════════════════════════════════════════════════════
   ① RNG —— 随机数模块
   ═══════════════════════════════════════════════════════════════════
   职责：整个游戏所有随机都从这里出。
        带种子 → 同一个种子必然生成同一个世界（可复现、可分享）。

   铁律 B：本文件不许出现 document / window / canvas —— 一个字都不能有。
           这样它才能原样搬进小红书小组件，不用改。

   怎么用：
     var rng = RNG.makeRng(12345);          // 用种子号建一个随机发生器
     rng()                                   // → 0~1 之间的小数
     RNG.range(rng, 35, 75)                  // → 35~75 之间的小数
     RNG.int(rng, 1, 6)                      // → 1~6 之间的整数（掷骰子）
     RNG.pick(rng, ['甲','乙','丙'])          // → 等概率挑一个
     RNG.chance(rng, 15)                     // → 15% 概率返回 true
     RNG.weighted(rng, {甲:70, 乙:20, 丙:10}) // → 按权重挑一个
   ═══════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  // 这段"壳"让同一个文件在网页和小组件里都能用：
  //   网页   → <script src> 加载后得到全局变量 RNG
  //   小组件 → require('./rng.js') 得到模块导出
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.RNG = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     种子空间：总共能有多少个不同的世界
     ───────────────────────────────────────────────────────────── */

  // 用来拼种子字符串的 31 个字符。
  // 故意去掉了容易看错的 I、L、O、0、1 —— 方便手抄和口头分享。
  var SEED_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var SEED_LEN = 6;                                        // 种子字符串 6 位
  var SEED_SPACE = Math.pow(SEED_CHARS.length, SEED_LEN);  // 31^6 ≈ 8.87 亿个世界

  /* ─────────────────────────────────────────────────────────────
     核心：mulberry32 算法
     ───────────────────────────────────────────────────────────── */

  /**
   * 建一个「带种子的随机发生器」。
   *
   * 普通随机的毛病是每次结果都不一样，没法复现。
   * 带种子的随机是：**同样的种子 → 永远吐出同样的数列**。
   * 所以只要记住种子号，就能把同一个世界重新生成出来。
   *
   * @param {number} seedNum 种子号（整数）
   * @returns {function} 调用一次就吐一个 0~1 之间的小数
   */
  function makeRng(seedNum) {
    var a = seedNum >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ─────────────────────────────────────────────────────────────
     种子的生成与转换
     ───────────────────────────────────────────────────────────── */

  /**
   * 生成一个全新的种子号。
   *
   * ⚠️ 这是整个项目里**唯一允许使用 Math.random() 的地方**。
   * 原因：需要一个真正随机的起点，不然每次打开游戏都是同一个世界。
   * 一旦种子号定下来，世界内部的一切随机都必须走 makeRng()。
   *
   * ── 为什么要"打散"两次 ──
   * 时间戳和 Math.random() 都是 32 位整数。如果直接拿它们异或再取模
   * （`(时间戳 ^ 随机数) % 种子空间`），会出问题：
   * 异或的结果值域比种子空间**大**，取模时一部分值被折叠回来算两次、
   * 另一部分永远取不到 —— 实测会出现"某一段种子一次都生成不出来"。
   *
   * 正确做法：把熵先揉成一个 32 位整数，再喂给 mulberry32 打散一次，
   * 最后用 `floor(随机数 × 空间大小)` 映射到整数区间。
   * 这是标准的"均匀取整数"写法，分布是平的。
   */
  function freshSeedNum() {
    // 两个熵源揉在一起：时间戳（每次不同）+ Math.random（每次都新）
    var entropy = (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;

    // 再过一遍 mulberry32 打散，把规律彻底搅没
    var r = makeRng(entropy)();

    // floor(r × SEED_SPACE) 均匀地落在 [0, SEED_SPACE) 上
    return Math.floor(r * SEED_SPACE);
  }

  /**
   * 种子号 → 种子字符串（显示给玩家看、方便分享）
   * 例：173829104 → "K7X-2FQ1"
   */
  function seedToString(num) {
    var n = ((num % SEED_SPACE) + SEED_SPACE) % SEED_SPACE;  // 保证是正数
    var s = '';
    for (var i = 0; i < SEED_LEN; i++) {
      s += SEED_CHARS.charAt(n % SEED_CHARS.length);
      n = Math.floor(n / SEED_CHARS.length);
    }
    return s.slice(0, 3) + '-' + s.slice(3);
  }

  /**
   * 种子字符串 → 种子号
   * 用途：别人分享了一个种子给你，你输进去就能复现他那颗世界。
   * 大小写、连字符、空格都会自动忽略，抄错一两个符号也不至于崩。
   */
  function seedFromString(str) {
    var clean = String(str).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    var n = 0;
    // ⚠️ 必须从后往前读。
    // 因为 seedToString() 写的时候是"最低位排在最前面"，
    // 这里如果从前往后读，等于把数字读反了，还原出来的种子号是错的。
    for (var i = clean.length - 1; i >= 0; i--) {
      var idx = SEED_CHARS.indexOf(clean.charAt(i));
      if (idx < 0) continue;                 // 不认识的字符直接跳过
      n = n * SEED_CHARS.length + idx;
    }
    return n % SEED_SPACE;
  }

  /* ─────────────────────────────────────────────────────────────
     常用随机工具 —— 让业务代码读起来更像人话
     ───────────────────────────────────────────────────────────── */

  /** 取 [min, max] 之间的小数 */
  function range(rng, min, max) {
    return min + rng() * (max - min);
  }

  /** 取 [min, max] 之间的整数（含两端）—— 相当于掷骰子 */
  function int(rng, min, max) {
    return Math.floor(min + rng() * (max - min + 1));
  }

  /** 从数组里等概率挑一个 */
  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  /** 百分比概率判断。chance(rng, 15) → 15% 的概率返回 true */
  function chance(rng, percent) {
    return rng() * 100 < percent;
  }

  /**
   * 按权重挑一个。
   * 权重不需要加起来等于 100，内部会自动归一化。
   * 例：weighted(rng, { 温和:70, 极端:20, 特殊:10 })
   */
  function weighted(rng, table) {
    var keys = Object.keys(table);
    var total = 0;
    var i;
    for (i = 0; i < keys.length; i++) total += table[keys[i]];

    var roll = rng() * total;
    for (i = 0; i < keys.length; i++) {
      roll -= table[keys[i]];
      if (roll <= 0) return keys[i];
    }
    return keys[keys.length - 1];   // 浮点数误差的兜底
  }

  /**
   * 洗牌：把数组顺序打乱，返回一个新数组（不改原来的）。
   * 用途：从四个本源里"随机挑 1-2 项走极端"。
   */
  function shuffle(rng, arr) {
    var out = arr.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /* ─────────────────────────────────────────────────────────────
     导出
     ───────────────────────────────────────────────────────────── */
  return {
    SEED_SPACE: SEED_SPACE,
    makeRng: makeRng,
    freshSeedNum: freshSeedNum,
    seedToString: seedToString,
    seedFromString: seedFromString,
    range: range,
    int: int,
    pick: pick,
    chance: chance,
    weighted: weighted,
    shuffle: shuffle
  };
});
