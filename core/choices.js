/* ═══════════════════════════════════════════════════════════════════
   ④ Choices —— 演化路线选择
   ═══════════════════════════════════════════════════════════════════
   职责：世界走到岔路口时，停下来问玩家一句，然后按答案改变世界。

   两道岔路口（其余阶段不问，直接过去）：
     进「海洋」  → 海洋更多 / 陆地更多 / 水陆均衡
     进「生态」  → 植被先蔓延 / 动物先出现 / 二者同步

   ⚠️⚠️ 2026-09-14：原来还有第三道「进文明 → 和平 / 征战 / 求知」，
       **整个删掉了** —— 理由见下面「第三道岔路口为什么删掉」那一段。

   ── 效果走三个通道 ──
     ① 直接改本源   world.essence.xxx
     ② 改图层上限   world.route.mul.*       （海洋/大陆/生态最终能盖多广）
     ③ 改权重       world.route.protoBias   （文明长成什么样）

   前两个通道是**确定**的，选了什么一定发生；
   第三个通道只是**推概率**，不保证 —— 世界仍然有自己的脾气。

   ⚠️ 两道岔路口都是**有得有失**的：每个选项都有明确的代价。
      这是重玩欲望的来源 —— 选完会想"要是选另一个会怎样"。
      但**不设暗坑**：任何选项都不会把玩家卡死（见下面的 FLOOR）。

   铁律 B：本文件不许出现 document / window / canvas。
   ═══════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Choices = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     硬保护：本源下限
     ═══════════════════════════════════════════════════════════════
     ⚠️⚠️ 这是**保护**，不是平衡参数，别当成"调平衡的地方"改 ⚠️⚠️

     为什么必须有：玩家的选择如果能把本源压到阶段门槛以下，
     就会**把自己卡死**。最典型的是大地之基：

       · 大陆阶段的条件是 land > 30
       · 而大地之基**不漂移**（见 evolution.js 的 drift 注释）——
         它不像能量和水那样会自己涨回来

     所以"为了多要海洋把大地压到 28"= 这颗世界永远浮不出大陆，
     玩家只能干等或者重开。这个坑必须堵死。

     水也一样危险：水在**进入海洋阶段的那一刻就停止上涨**，
     所以从海洋阶段往后，水被压下去就再也回不来了。

     几个数字都是踩着门槛定的：
       water 42  ← 海洋阶段门槛是 water > 40
       land  33  ← 大陆阶段门槛是 land  > 30
       atmo  20  ← 大气会自己涨，本来卡不死，加个下限只是保险
     ═══════════════════════════════════════════════════════════════ */
  var FLOOR = { water: 42, land: 33, atmo: 20 };

  /* ═══════════════════════════════════════════════════════════════
     两道岔路口
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 每个选项四个字段：
   *   label  选项名（大字）
   *   blurb  一句话说明（小字）
   *   gain   好处 —— ⚠️ **选完之后才显示**（见 app.js 的 showChoiceResult）
   *   cost   代价 —— 同上。
   *          写在题面上的话，选择就从"凭对世界的理解做判断"
   *          变成"算一下哪个划算"了。
   *   apply  真正改世界的函数
   *
   * ⚠️ gain / cost 里**不许出现阿拉伯数字**（×1.18 / +15 / −70 / > 85 这类）。
   *    那些是内部参数，玩家在界面上找不到对应物，读起来像调试输出。
   *    「八成」「七成」这种汉语数字描述的是玩家看得见的结果，可以留。
   *    `_choices_test.js` F 段守着这条。
   */
  var CHOICES = [

    /* ── 岔路口 ①：进入海洋阶段（stage 2）──
       世界刚刚凉下来，水开始凝出来。此刻定下这颗世界"水多还是陆多"的底子。 */
    {
      key: 'ocean',
      stage: 2,
      title: '世界冷却完毕',
      question: '海洋与陆地，此界该偏向哪一边？',
      options: [
        {
          key: 'ocean',
          label: '海洋更多',
          blurb: '水脉更盛，海面铺得更广',
          gain: '生态铺得更开，绿意连得起来',
          cost: '大地被压低，陆地铺不开，能住的地方跟着变少',
          apply: function (w) {
            w.essence.water = add(w.essence.water, 12, 100);
            w.essence.land  = add(w.essence.land, -8, 100, FLOOR.land);
            w.route.mul.ocean     *= 1.18;
            w.route.mul.continent *= 0.85;
          }
        },
        {
          key: 'land',
          label: '陆地更多',
          blurb: '大地抬升，陆块连成整片',
          gain: '陆地铺得开，能住的地方多',
          cost: '海面缩小，水汽减少，水脉和大气也跟着降下去',
          apply: function (w) {
            w.essence.land  = add(w.essence.land, 12, 100);
            w.essence.water = add(w.essence.water, -10, 100, FLOOR.water);
            w.essence.atmo  = add(w.essence.atmo, -6, 100, FLOOR.atmo);
            w.route.mul.continent *= 1.18;
            w.route.mul.ocean     *= 0.85;
          }
        },
        {
          key: 'balance',
          label: '水陆均衡',
          blurb: '两边都涨一点，谁也不压倒谁',
          gain: '水陆同时变多，交界线拉长，大气也跟着厚起来',
          cost: '两边都到不了极限，海洋和大陆都停在中等规模',
          apply: function (w) {
            w.essence.water = add(w.essence.water, 5, 100);
            w.essence.land  = add(w.essence.land, 5, 100);
            w.essence.atmo  = add(w.essence.atmo, 4, 100);
            w.route.mul.ocean     *= 1.05;
            w.route.mul.continent *= 1.05;
          }
        }
      ]
    },

    /* ── 岔路口 ②：进入生态阶段（stage 4）──
       生命要诞生了。此刻定下这颗世界的生态"从哪一头开始长"。 */
    {
      key: 'life',
      stage: 4,
      title: '生态诞生',
      question: '此界的生命，该从哪一头开始？',
      options: [
        {
          key: 'flora',
          label: '植被先蔓延',
          blurb: '绿意先铺开，动物随后而来',
          gain: '绿意能连成整片，生态铺得比平时更广',
          cost: '更容易长出的是植类、虫类；别的几类要难得多',
          apply: function (w) {
            w.route.mul.life *= 1.18;
            w.route.protoBias = { plantae: 45, arthropoda: 15 };
          }
        },
        {
          key: 'fauna',
          label: '动物先出现',
          blurb: '先有动物，植被被啃食着铺开',
          gain: '更容易长出的是兽类、人类、虫类',
          cost: '植被铺得慢，绿意连成整片要更晚',
          apply: function (w) {
            w.route.mul.life *= 0.92;
            w.route.protoBias = { mammalia: 48, humanoid: 32, arthropoda: 20 };
          }
        },
        {
          key: 'together',
          label: '二者同步',
          blurb: '植物和动物一起出现，不分先后',
          gain: '生态平稳铺开，文明长成什么样，全看这颗世界自己',
          cost: '没有哪一类被推高，也就没有哪一类占先',
          apply: function (w) {
            w.route.mul.life *= 1.06;
          }
        }
      ]
    }

    /* ═══════════════════════════════════════════════════════════════
       第三道岔路口为什么删掉（2026-09-14）
       ═══════════════════════════════════════════════════════════════

       删掉的是这一道：

         进「文明」→ 和平（光暗值 +15）/ 征战（−32）/ 求知（+42）
                     ↑ 每个选项还会给对应的性格加 200 的权重推力

       ── 用户的原话 ──
       「在三岔口进入文明的那个地方，选择只有战争和平求知三个倾向
         是不是太少了，我希望这些都是自动演化的不是我帮忙选的」

       ── 先说量出来的证据（2000 局，1891 局走到文明）──

         答「和平」时：  和平 74.6%  商业 8.8%  其余六种各 2~3%
         不问玩家时：    和平 40.9%  商业 19.4%  其余六种各 5~8%

       ★★ 真正的问题不是"三个选项太少"，是**一道题吃掉四分之三** ★★
          性格其实有 8 种，岔路口只让你挑 3 种，而且挑完那一种就占 74.6% ——
          剩下 7 种抢那 25%。不问玩家反而 8 种全都站起来了。

       ── 为什么删掉是对的（不只是"玩家想让它自动"）──

       ① **玩家的影响一点没少，只是换了条路。**
          `world.light`（光暗值）**全项目只有这道岔路口的三行在写**。
          删掉之后它还由谁改？—— **投放元素**（光种 +8 / 暗种 −8）。
          也就是说：性格从「菜单上点一个」变成「**你之前做过什么**」。
          这正是决策 #37「选择权交给生灵」的同一条路子 ——
          观察者不替文明做决定，但观察者做过的事会留在世界里。

       ② **这一道本来就和投放元素重复。** 元素投放（光暗值）已经能一路
          推到 ±70（信仰 / 隐世的门口），岔路口只是同一件事的"直接给答案"版。

       ③ **它让 5 种性格几乎见不到天日。** 信仰要 light > +70、隐世要 < −70，
          而岔路口最多只给到 +42 / −32 —— 剩下那 5 种只能靠"本源凑巧"
          （水<70 且大地 30~55 出游牧、水 > 70 出商业、大地 > 70 出工匠）才露个面。
          ⚠️ 2026-09-17 改：游牧那半句原来是「大地 < 30」**旧判据**，早换掉了。

       ── 删的时候一起删干净的三样 ──

         · 这道岔路口本身
         · `WILL_PUSH = 200`（只有这道岔路口在用）
         · `world.route.temperBias`（只有这道岔路口在写，
            `civ.js` 的 `drawOne` 读）

       ⚠️ 决策 #61 的判据：**玩家拿到它，能不能做点什么？**
          不能的话就是维护成本 —— 删掉之后 temperBias 就是这种东西，
          留着会变成"看着像功能、其实是摆设"（本项目栽过三次）。

       ── ⚠️ 代价：旧种子长出来的文明会变 ──

       性格是按权重抽的，光暗值和权重的来源一变，
       **同一个种子抽到的性格就变了**（和"加物种"是同一类副作用）。
       上线前无所谓；上线之后再动，要掂量「已经分享出去的种子会变」。

       ── 现在性格由什么决定 ──

         · **光暗值**（你投的光种 / 暗种）：−25~25 和平、−70~−25 征战、
           25~70 求知、> 70 信仰、< −70 隐世
         · **本源**：水 < 70 且大地 30~55 游牧、水 > 70 商业、大地 > 70 工匠
           ⚠️ 2026-09-17 改：游牧那半句原来是「大地 < 30」**旧判据**，早换掉了。

       两样都是**世界自己的状态**，不是一张菜单。
       ═══════════════════════════════════════════════════════════════ */
  ];

  /* ═══════════════════════════════════════════════════════════════
     世界档案里的 route 字段
     ═══════════════════════════════════════════════════════════════

     world.route = {
       pending:    'ocean',      // 正在等玩家回答哪个岔路口（null = 没有）
       made:       { ocean:'ocean', life:'flora' },   // 已经答过的
       mul:        { ocean:1, continent:1, life:1 },  // 图层上限倍率（累乘）
       protoBias:  null          // 物种权重偏向
     }

     ⚠️ 原来这里还有一个 `temperBias`（性格权重偏向）——
        2026-09-14 跟着第三道岔路口一起删掉了，全项目没有第二个人写过它。
        详见上面「第三道岔路口为什么删掉」。
     ═══════════════════════════════════════════════════════════════ */

  function freshRoute() {
    return {
      pending: null,
      made: {},
      mul: { ocean: 1, continent: 1, life: 1 },
      protoBias: null
    };
  }

  /**
   * 保证 world.route 存在（幂等）。
   * 为什么要"懒创建"而不是在 worldgen 里建：
   * 世界档案（见 CLAUDE.md 第四节）是**世界本身**的描述，
   * 而 route 是"玩家干预的记录"。让 worldgen 去认一个它不需要知道的东西，
   * 等于把两个模块绑死。这里谁用谁建，worldgen 保持干净。
   */
  function ensureRoute(world) {
    if (!world.route) world.route = freshRoute();
    return world.route;
  }

  /** 清空玩家的抉择（【重置】用）*/
  function reset(world) {
    world.route = freshRoute();
  }

  /* ═══════════════════════════════════════════════════════════════
     查询
     ═══════════════════════════════════════════════════════════════ */

  /** 这个阶段有没有岔路口要问？没有返回 null */
  function forStage(stage) {
    for (var i = 0; i < CHOICES.length; i++) {
      if (CHOICES[i].stage === stage) return CHOICES[i];
    }
    return null;
  }

  function byKey(key) {
    for (var i = 0; i < CHOICES.length; i++) {
      if (CHOICES[i].key === key) return CHOICES[i];
    }
    return null;
  }

  /** 从一条岔路口里按 key 找选项 */
  function optionOf(choice, key) {
    if (!choice) return null;
    for (var i = 0; i < choice.options.length; i++) {
      if (choice.options[i].key === key) return choice.options[i];
    }
    return null;
  }

  /** 正在等玩家回答的那条岔路口（没有就返回 null）*/
  function pendingFor(world) {
    if (!world.route || !world.route.pending) return null;
    return byKey(world.route.pending);
  }

  /**
   * 这个阶段是不是**要问但还没问**。
   * ⚠️ evolution 靠这个决定"能不能往下走" —— 问过了才放行。
   */
  function needsAnswer(world, stage) {
    var c = forStage(stage);
    if (!c) return false;
    ensureRoute(world);
    return !world.route.made[c.key];
  }

  /* ═══════════════════════════════════════════════════════════════
     作答
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 玩家选了某个选项 —— 把效果落到世界上。
   *
   * @param {object} world
   * @param {string} optionKey 选项的 key
   * @returns {object|null} 落地的那个选项定义（界面拿它播提示）
   */
  function resolve(world, optionKey) {
    ensureRoute(world);
    if (!world.route.pending) return null;

    var choice = byKey(world.route.pending);
    var opt = optionOf(choice, optionKey);
    if (!opt) return null;

    opt.apply(world);

    world.route.made[choice.key] = opt.key;
    world.route.pending = null;

    return opt;
  }

  /* ═══════════════════════════════════════════════════════════════
     工具
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 加减一个本源值，并夹在 [floor, max] 之间。
   * floor 不传就是 0（普通夹取）。
   */
  function add(v, delta, max, floor) {
    var lo = (floor === undefined) ? 0 : floor;
    var nv = v + delta;
    if (nv < lo) return lo;
    if (nv > max) return max;
    return nv;
  }

  return {
    CHOICES: CHOICES,
    FLOOR: FLOOR,

    ensureRoute: ensureRoute,
    reset: reset,

    forStage: forStage,
    byKey: byKey,
    optionOf: optionOf,
    pendingFor: pendingFor,
    needsAnswer: needsAnswer,

    resolve: resolve
  };
});
