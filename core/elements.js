/* ═══════════════════════════════════════════════════════════════════
   ② Elements —— 元素系统
   ═══════════════════════════════════════════════════════════════════
   职责：管理"往世界上投放元素"这件事。

   ── 这个模块解决的核心问题 ──
   在这之前，世界只是四个**全局数字**（能量 62、水 71……），
   整个球是均匀的 —— 它不知道"哪里"。
   元素要"提升**局部**能量浓度"，就必须给世界加一层**空间**。

   ── 怎么加空间：影响斑 ──
   不切网格（上千个格子，手机上跑不动），而是记住每次投放：

       world.drops = [
         { type:'fire', x:0.32, y:-0.18, r:0.26, power:1, age:0 },
         ...
       ]

   每个投放点就是一个"影响斑"：有位置、半径、强度、年龄。
   **某处的实际数值 = 全局值 + 附近所有影响斑的叠加**（离得越近越强）。

   好处：扩散、收缩、淡出这些动态效果都是"改一个数"的事，
   而且只有几十个点，算起来很轻。

   铁律 B：本文件不许出现 document / window / canvas。
   ═══════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  var mod = factory(
    (typeof require !== 'undefined') ? require('./rng.js') : root.RNG
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Elements = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (RNG) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     八个元素的定义
     ═══════════════════════════════════════════════════════════════

     local  = 对**局部**的加成（中心处最多加这么多，边缘衰减到 0）
     global = 对**全局**的影响（投放瞬间结算一次）
     vis    = 视觉表现类型，渲染层按这个决定怎么画
     life   = 局部生态加速倍率（0.8 表示"该区域生态快 80%"）
     geo    = 局部地质加速倍率

     ⚠️ 数值都是"中心处的最大值"。实际效果按距离平滑衰减。
     ═══════════════════════════════════════════════════════════════ */

  /* ── 元素对「能量」的影响强度 ──
     ⚠️ 这两个常量**必须定义在 LIST 前面**。
        LIST 是立刻求值的对象字面量，里面直接引用了它们；
        var 只提升声明、不提升赋值，放到后面的话那几行拿到的是 undefined
        （而且不会报错，只会悄悄把 energy 变成 undefined）。

     ⚠️ 数字也不能随便缩小，它决定了"能不能救活一颗冻死的世界"。
        这些是**局部加成**，要经过 averageBoost 按面积摊到整颗星球上 ——
        一个斑只占球面约 7%，再加边缘衰减，
        **实际对全局的贡献只有标称值的 3% 左右**（标称 30 → 全局约 0.7）。

        所以"把能量 15 的冻死星球拉过 20 的门槛"需要投几个：
            标称 +14（第一版）→ 要投 16 个 —— 太磨人，等于救不活
            标称 +30（现在）  → 投 7 个左右，可以接受

        改这两个数之前，先跑 _elements_test.js 的 J 组看实际效果。 */
  var ENERGY_STRONG  = 30;   // 火种 / 光种 / 冰晶 / 暗种
  var ENERGY_THUNDER = 26;   // 雷种（一次性释放，比持续性的略低）

  var LIST = [
    {
      key: 'fire',
      name: '火种',
      color: '#FF8A3C',
      desc: '提升局部能量浓度',
      local: { energy: ENERGY_STRONG },
      vis: 'bloom'          // 向外扩散的暖光
    },
    {
      key: 'water',
      name: '水珠',
      color: '#4FA8E8',
      desc: '提升局部水之本源',
      local: { water: 22 },
      vis: 'ripple'         // 一圈圈荡开的涟漪
    },
    {
      key: 'stone',
      name: '土石',
      color: '#C89A4A',
      desc: '提升局部大地之基',
      local: { land: 22 },
      vis: 'bloom'
    },
    {
      key: 'air',
      name: '气团',
      color: '#D8DCE4',
      desc: '提升局部大气密度',
      local: { atmo: 22 },
      vis: 'drift'          // 柔和飘动的雾
    },
    {
      key: 'ice',
      name: '冰晶',
      color: '#9FD8F0',
      desc: '降低局部能量浓度',
      local: { energy: -ENERGY_STRONG },
      vis: 'shatter'        // 锐利的冷光
    },
    {
      key: 'thunder',
      name: '雷种',
      color: '#FFE86A',
      desc: '触发一次天象',
      local: {},            // 效果来自随机天象，见 WEATHER
      vis: 'flash'          // 短暂过曝
    },
    {
      key: 'light',
      name: '光种',
      color: '#FFD870',
      desc: '光之力上升，该区域生态加速',
      // energy：光本身就带来热。
      // 这是玩家**救活一颗冻住的星球**的主要手段之一。
      local: { light: 30, life: 0.8, energy: ENERGY_STRONG },
      global: { light: 8 },
      vis: 'bloom'
    },
    {
      key: 'dark',
      name: '暗种',
      color: '#8A5AC8',
      desc: '暗之力上升，该区域地质加速',
      // energy：暗带走热。反过来可以用来给"烧着不冷却"的世界降温。
      local: { light: -30, geo: 0.8, energy: -ENERGY_STRONG },
      global: { light: -8 },
      vis: 'shrink'         // 向内收缩的暗紫光
    }
  ];

  // 按 key 建索引，方便查找
  var BY_KEY = {};
  LIST.forEach(function (e) { BY_KEY[e.key] = e; });

  /* ─────────────────────────────────────────────────────────────
     天象：雷种会随机触发其中一个
     ───────────────────────────────────────────────────────────── */
  var WEATHER = [
    { key: 'meteor',    name: '流星雨', color: '#FF7A4A', vis: 'bloom',
      local: { land: 14, energy: 10 }, text: '流星雨掠过此界' },
    { key: 'aurora',    name: '极光',   color: '#6AE8C0', vis: 'drift',
      local: { light: 22 },            text: '极光在天顶展开' },
    { key: 'acidrain',  name: '酸雨',   color: '#A8D84A', vis: 'ripple',
      local: { atmo: 10, life: -0.5 }, text: '酸雨降落，地表受蚀' },
    { key: 'sandstorm', name: '沙暴',   color: '#D8B86A', vis: 'drift',
      local: { atmo: -12, land: 6 },   text: '沙暴席卷地表' }
  ];

  /* ─────────────────────────────────────────────────────────────
     三场冲突事件的提示语（光暗值越线时弹的那一句）

     ⚠️ 单独拎成一张表，是为了让 _style_test.js 能扫到 ——
        内联在判定逻辑里的字符串收集不到，就成了文风的盲区：
        哪天有人把「天火降世」改成一句口语，没有任何测试会红。
     ───────────────────────────────────────────────────────────── */
  var CONFLICT_TEXT = {
    fire:  '天火降世',
    night: '永夜降临',
    rift:  '混沌裂隙'
  };

  /* ═══════════════════════════════════════════════════════════════
     参数
     ═══════════════════════════════════════════════════════════════ */

  var MAX_DROPS   = 24;      // 最多同时存在多少个影响斑（超了淘汰最老的）
  var DROP_RADIUS = 0.26;    // 影响斑的默认半径（世界半径 = 1）

  /* 光斑（视觉）能存在多少世界秒。
     ⚠️ 注意区分两件事：
          · **光斑**会消失（散开、融进星球）
          · **这个元素的数值影响不会消失** —— 它继续留在 drops 里生效
        到时间后光斑"散开融入"而不是"原地变透明"，
        这样用户的感觉是"元素被星球吸收了"，而不是"特效被删了"。

     ⚠️ 这个数字是用户明确要求的：**光斑不留下来，约 5 秒就该没了。**
        之前设成 16 秒，太久了 —— 投十几个元素之后星球会被光斑糊住。 */
  var DROP_LIFE = 5;

  var LIGHT_MAX   = 100;     // 光暗值上下限
  /* ═══════════════════════════════════════════════════════════════
     全局演化节奏（PACE）
     ═══════════════════════════════════════════════════════════════
     ⚠️⚠️ 这是 `core/evolution.js` 里那个 PACE 的**副本** ⚠️⚠️

     为什么复制一份而不是 import：elements.js 排在 evolution.js **前面**加载
     （evolution 依赖 elements），反过来引用就成循环依赖了。
     所以只能复制 —— 但复制会不同步，所以：

       ★ `_wiring_test.js` 会比对两个文件里的 PACE 是否一致，不一致直接报错。
         改阶段时长的时候，evolution 那边的 PACE 是自动算的，
         这里要**手动同步**，然后跑 _wiring_test.js 确认。

     为什么这两个速率也要除 PACE：
       光暗值回归和冲突值衰减都是"每世界秒"的速率，同样按 25 秒一局调的手感。
       不除的话，130 秒的局里光暗值会衰减 65 点 ——
       等于要求玩家在最后半分钟里疯狂投光种才留得住痕迹，
       和"光暗值反映最近有没有干预"这条设计原意就跑偏了。
       除以 PACE 之后，"一局里衰减多少"和以前一样。
     ═══════════════════════════════════════════════════════════════ */
  var PACE = 5.2;   // ← 必须和 evolution.js 的 PACE 一致（_wiring_test.js 会查）

  var LIGHT_DECAY = 0.5 / PACE;     // 光暗值每秒朝 0 回归多少
  var DISCORD_DECAY = 1.0 / PACE;   // 冲突值每秒衰减多少

  var FIRE_THRESHOLD   =  70;   // 光之力超过这个 → 天火降世
  var NIGHT_THRESHOLD  = -70;   // 暗之力低于这个 → 永夜降临
  var RIFT_THRESHOLD   =  60;   // 冲突值超过这个 → 混沌裂隙

  /* ⚠️⚠️ 2026-09-17：这里原来有一份 `FIRE_LIFE_PENALTY = 0.25` —— **删掉了** ⚠️⚠️
     它是**死的第二份**：本文件没人用、也没导出，看着像在用（注释还写着
     "天火降世：生态进度倒退这么多"）。**活的那份在 `core/evolution.js`**
     （那边 `FIRE_LIFE_PENALTY` 真的被天火那一支读）。
     ★ 这正是本项目管它叫「**两把尺子**」的那种形状 —— 同一个值两份，
       改了一份不改另一份，行为静默地不对。栽过好几次，见到就删。 */

  /* 雷种自身释放的能量。
     闪电本来就是巨大的能量释放 —— 所以雷种在触发天象之外，
     还会在落点留下一份能量加成（和天象自己的效果叠加）。
     ⚠️ 做成"局部加成"而不是"直接给全局数值 +15"：
        局部加成会经过 averageBoost 折算，投在球心和投在边缘效果不同，
        而且投多了会互相重叠 —— 这样比一刀切的全局数值更好平衡。 */
  var THUNDER_ENERGY = ENERGY_THUNDER;

  /* ═══════════════════════════════════════════════════════════════
     投放
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 往世界表面投放一个元素。
   *
   * @param {object} world
   * @param {string} key  元素 key（见 LIST）
   * @param {number} x,y  世界坐标，单位圆内（圆心 0,0，边缘距离 1）
   * @returns {object|null} 有事发生就返回 { text: '...' }，用来弹提示
   */
  function drop(world, key, x, y) {
    var def = BY_KEY[key];
    if (!def) return null;

    // ── 记账：投过哪些、一共投了几次 ──
    // 文明形态（山地/极地/森林/地下/天空）和「被观测」命运都靠这个判断。
    // 放在最前面，这样雷种走的分支也会被记上。
    world.dropCount = (world.dropCount || 0) + 1;
    if (!world.dropTally) world.dropTally = {};
    world.dropTally[key] = (world.dropTally[key] || 0) + 1;

    // 雷种特殊：它不留下影响斑，而是立刻触发一次随机天象，
    // 然后把天象自己的影响落在那儿。
    if (key === 'thunder') {
      return dropWeather(world, x, y);
    }

    // 光斑寿命加一点随机浮动 —— 免得同一片区域的光斑同时"融进去"，
    // 整齐划一会显得很假。错开之后像是各自被地表慢慢吸收。
    var lifeJitter = RNG.range(evoRng(world), 0.85, 1.18);

    // 记下这个影响斑。
    // ⚠️ 颜色和视觉类型直接**抄到斑上**，而不是让渲染层去查元素定义表。
    //    这样渲染层就不用依赖 elements.js —— 它只需要认识"一个斑"这个数据结构。
    pushDrop(world, {
      type: key,
      color: def.color,
      vis: def.vis,
      x: x,
      y: y,
      r: DROP_RADIUS,
      power: 1,
      age: 0,
      // visLife 管的是**光斑**什么时候散开融入。
      // 这个影响斑本身不会被删 —— 数值影响一直有效。
      visLife: DROP_LIFE * lifeJitter
    });

    // 全局影响（只有光种/暗种有）
    if (def.global && def.global.light) {
      world.light = clamp(world.light + def.global.light, -LIGHT_MAX, LIGHT_MAX);
    }

    // 光暗打架：如果这个斑和敌对阵营的斑重叠，冲突值上升
    if (key === 'light' || key === 'dark') {
      var foe = (key === 'light') ? 'dark' : 'light';
      var overlap = overlapWith(world, foe, x, y, DROP_RADIUS);
      if (overlap > 0) {
        world.discord = clamp(world.discord + 30 * overlap, 0, 200);
      }
    }

    return null;   // 普通元素不弹提示，视觉反馈就够了
  }

  /** 投放一次随机天象（雷种） */
  function dropWeather(world, x, y) {
    var rng = evoRng(world);
    var w = WEATHER[Math.floor(rng() * WEATHER.length)];

    // 先劈一道闪电 —— 转瞬即逝，只有 0.45 世界秒的寿命。
    // 它不产生任何数值影响，纯粹是视觉上的"过曝一闪"。
    pushDrop(world, {
      type: 'flash',
      color: '#FFF6C8',
      vis: 'flash',
      x: x, y: y,
      r: DROP_RADIUS * 1.5,
      power: 1,
      age: 0,
      life: 0.45,             // ← 有寿命的斑，到时间自动消失
      local: {}               // 不带任何数值影响
    });

    // 雷种自身释放的能量，叠加到天象自己的效果上
    var eff = {};
    for (var k in w.local) eff[k] = w.local[k];
    eff.energy = (eff.energy || 0) + THUNDER_ENERGY;

    pushDrop(world, {
      type: 'weather',
      weather: w.key,
      color: w.color,
      vis: w.vis,
      x: x, y: y,
      r: DROP_RADIUS * 1.25,
      power: 1,
      age: 0,
      visLife: DROP_LIFE,         // 和普通元素一样的寿命
      local: eff                  // 天象的影响 + 雷种自身的能量
    });

    // 天象对光暗值的影响（极光会推高光之力）
    if (w.local.light) {
      world.light = clamp(world.light + w.local.light * 0.4, -LIGHT_MAX, LIGHT_MAX);
    }

    return { text: w.text, weather: w.key };
  }

  /** 加入一个影响斑，超上限就淘汰最老的 */
  function pushDrop(world, d) {
    world.drops.push(d);
    while (world.drops.length > MAX_DROPS) world.drops.shift();
    bumpVersion(world);      // 斑变了 → 让 averageBoost 的缓存失效
  }

  /**
   * 算某个位置被指定类型的斑覆盖了多少（0 = 没覆盖，1 = 完全在中心）。
   * 用来判断光暗有没有打架。
   */
  function overlapWith(world, type, x, y, r) {
    var best = 0;
    for (var i = 0; i < world.drops.length; i++) {
      var d = world.drops[i];
      if (d.type !== type) continue;
      var dist = Math.hypot(x - d.x, y - d.y);
      var reach = Math.min(r, d.r);
      if (dist >= reach) continue;
      var t = 1 - dist / reach;
      if (t > best) best = t;
    }
    return best;
  }

  /* ═══════════════════════════════════════════════════════════════
     每帧推进
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 推进元素系统一帧。
   *
   * @param {object} world
   * @param {number} dSim 这一帧过了多少世界秒
   * @returns {object|null} 触发事件就返回 { type, text }，否则 null
   */
  function step(world, dSim) {
    var i;

    // 影响斑变老（渲染层用它做动画相位），顺便清掉到寿命的
    // （倒着遍历：删除元素时不会打乱还没检查的下标）
    var removed = false;
    for (i = world.drops.length - 1; i >= 0; i--) {
      var d = world.drops[i];
      d.age += dSim;
      if (d.life && d.age >= d.life) { world.drops.splice(i, 1); removed = true; }
    }
    if (removed) bumpVersion(world);   // 斑少了 → 缓存失效

    // 光暗值缓慢回归平衡
    if (world.light > 0) {
      world.light = Math.max(0, world.light - LIGHT_DECAY * dSim);
    } else if (world.light < 0) {
      world.light = Math.min(0, world.light + LIGHT_DECAY * dSim);
    }

    // 冲突值衰减
    if (world.discord > 0) {
      world.discord = Math.max(0, world.discord - DISCORD_DECAY * dSim);
    }

    // ── 冲突事件判定 ──
    // 已经触发过的不再重复触发，除非状态恢复后又越线
    if (world.light >= FIRE_THRESHOLD && world.event !== 'fire') {
      world.event = 'fire';
      world.eventTime = 0;
      return { type: 'fire', text: CONFLICT_TEXT.fire };
    }

    if (world.light <= NIGHT_THRESHOLD && world.event !== 'night') {
      world.event = 'night';
      world.eventTime = 0;
      return { type: 'night', text: CONFLICT_TEXT.night };
    }

    if (world.discord >= RIFT_THRESHOLD && world.event !== 'rift') {
      world.event = 'rift';
      world.eventTime = 0;
      world.fractured = true;      // 结局会因此改成「世界破碎」
      return { type: 'rift', text: CONFLICT_TEXT.rift };
    }

    // 回到安全区间就把事件标记清掉，下次越线还能再触发
    if (world.light < FIRE_THRESHOLD - 15 && world.light > NIGHT_THRESHOLD + 15) {
      if (world.event === 'fire' || world.event === 'night') world.event = null;
    }
    if (world.discord < RIFT_THRESHOLD - 15 && world.event === 'rift') {
      world.event = null;
    }

    if (world.event) world.eventTime += dSim;

    return null;
  }

  /* ═══════════════════════════════════════════════════════════════
     查询：某个位置上的局部加成
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 算某个位置的实际数值。
   *
   * @param {object} world
   * @param {number} x,y 世界坐标（-1 ~ 1）
   * @returns {object} { energy, water, atmo, land, light, life, geo }
   *          —— 前五项是**加成量**（要跟全局值相加），后两项是**倍率**
   */
  function localAt(world, x, y) {
    var out = { energy: 0, water: 0, atmo: 0, land: 0, light: 0, life: 0, geo: 0 };

    for (var i = 0; i < world.drops.length; i++) {
      var d = world.drops[i];

      // 天象的影响挂在斑自己身上；普通元素的影响查定义表
      var eff = d.local || (BY_KEY[d.type] && BY_KEY[d.type].local);
      if (!eff) continue;

      var dx = x - d.x;
      var dy = y - d.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= d.r) continue;                 // 半径之外没有影响

      // 平滑衰减：中心 100%，边缘 0
      // 用 smoothstep 而不是直线，边缘过渡更自然，不会出现"硬边"
      var t = 1 - dist / d.r;
      var w = t * t * (3 - 2 * t) * d.power;

      for (var k in eff) out[k] += eff[k] * w;
    }

    return out;
  }

  /**
   * 全局某个位置的本源数值（全局值 + 局部加成），并夹在 0-100 之间。
   * 演化逻辑要判断"这里够不够热/够不够湿"时用这个。
   */
  function essenceAt(world, x, y) {
    var add = localAt(world, x, y);
    return {
      energy: clamp(world.essence.energy + add.energy, 0, 100),
      water:  clamp(world.essence.water  + add.water,  0, 100),
      atmo:   clamp(world.essence.atmo   + add.atmo,   0, 100),
      land:   clamp(world.essence.land   + add.land,   0, 100)
    };
  }

  /* 黄金角 ≈ 2.39996 弧度。用它给采样点定角度，点会铺得很均匀、不结成一圈一圈的环。 */
  var GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

  // 采样点数。
  // 为什么不能太少：一个影响斑的面积约占球面的 7%，
  // 24 个采样点里平均只有 1.6 个落在斑内 —— 太少，估出来的平均值会抖得厉害，
  // 玩家会觉得"投同一个元素，效果一会儿大一会儿小"。
  // 48 个点能把抖动压到可接受范围。
  var AVG_SAMPLES = 48;

  // averageBoost 的缓存。
  // 为什么需要：这个函数每帧要被调用三四次（判断阶段条件、算图层目标都用到），
  // 加密采样点之后每次要跑几十×二十几次循环，还每次新建一个对象 ——
  // 不缓存的话每秒会产生几十万个临时对象，手机上 GC 会很吃力。
  //
  // 为什么可以缓存：结果只取决于「有哪些斑」——
  // 斑的位置、半径、强度一旦生成就不再变（只有 age 在变，而 age 不参与计算）。
  // 所以只要斑的版本号没变，上次的结果就一直有效。
  var _avgKey = null;
  var _avgVal = null;

  /** 斑增减时调一下，通知缓存失效 */
  function bumpVersion(world) {
    world.dropsVersion = (world.dropsVersion || 0) + 1;
  }

  /**
   * 整颗世界的平均局部影响。
   * 演化状态机用它调整全局数值 —— 到处都投了火种，世界就该整体热起来。
   *
   * ⚠️⚠️ 采样点必须**按面积均匀**铺在圆面上，不能用固定半径的一圈 ⚠️⚠️
   *
   * 我第一版是在半径 0.45 上均分 12 个点，结果非常糟：
   *   · 投在**正中心**的斑够不着那一圈（斑半径只有 0.26 < 0.45）→ 贡献恒为 0
   *   · 投在 0.45 那一圈的斑被百分之百计入 → 贡献被夸大
   * 也就是说"往球心投元素"这个最自然的动作，在全局计算里等于白投。
   *
   * 正确做法：半径按 sqrt 分布 —— 点在圆面上就变成按**面积**均匀了。
   * （圆心附近面积小，本来就该少采几个点；边缘面积大，就该多采。）
   *
   * ⚠️ 返回的对象是**缓存里的那一份，调用方不许改它**。
   */
  function averageBoost(world) {
    var key = world.seedNum + '#' + (world.dropsVersion || 0);
    if (_avgKey === key && _avgVal) return _avgVal;

    var sum = { energy: 0, water: 0, atmo: 0, land: 0, light: 0, life: 0, geo: 0 };

    if (world.drops.length) {
      for (var i = 0; i < AVG_SAMPLES; i++) {
        var r = Math.sqrt((i + 0.5) / AVG_SAMPLES) * 0.94;   // 按面积均匀的半径
        var a = i * GOLDEN_ANGLE;                            // 黄金角 → 铺得均匀
        var add = localAt(world, Math.cos(a) * r, Math.sin(a) * r);
        for (var k in sum) sum[k] += add[k];
      }
      for (var k2 in sum) sum[k2] /= AVG_SAMPLES;
    }

    _avgKey = key;
    _avgVal = sum;
    return sum;
  }

  /* ═══════════════════════════════════════════════════════════════
     光暗值带来的全局影响
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 光暗值对演化的全局修正。
   *   正值（光占优）→ 生态加速、色调偏暖
   *   负值（暗占优）→ 地质加速、色调偏冷
   *   接近 0      → 两者都正常，最稳定
   *
   * @returns {object} { lifeMul, geoMul, hueShift, brightness }
   */
  function lightEffects(world) {
    var v = world.light / LIGHT_MAX;          // -1 ~ 1

    return {
      // 生态速度：光占优时最多快 1.5 倍，暗占优时最多慢到 0.5 倍
      lifeMul: 1 + v * 0.5,
      // 地质速度：反过来
      geoMul: 1 - v * 0.5,
      // 色调：光 → 偏暖（色相往橙黄推），暗 → 偏冷（往蓝紫推）
      hueShift: -v * 22,
      // 亮度：光 → 更亮，暗 → 更暗
      brightness: 1 + v * 0.16
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     工具
     ═══════════════════════════════════════════════════════════════ */

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /**
   * 天象用的随机源。
   * 用种子 + 一个固定偏移重建，这样同一颗世界每次玩，
   * 雷种触发的天象顺序是一样的 —— 不会因为打开时间不同而不同。
   */
  var _rngSeed = null, _rng = null;
  function evoRng(world) {
    if (_rngSeed !== world.seedNum) {
      _rngSeed = world.seedNum;
      _rng = RNG.makeRng((world.seedNum ^ 0x9E3779B9) >>> 0);
    }
    return _rng;
  }

  /** 点 (x,y) 在不在世界表面上（单位圆内） */
  function isInsideWorld(x, y) {
    return (x * x + y * y) <= 1;
  }

  /** 把世界退回初始态时，元素系统也要清空（【重置】按钮用） */
  function reset(world) {
    world.drops = [];
    world.light = 0;
    world.discord = 0;
    world.event = null;
    world.eventTime = 0;
    world.fractured = false;
    bumpVersion(world);   // 斑全清了 → 缓存失效
  }

  return {
    LIST: LIST,
    BY_KEY: BY_KEY,
    WEATHER: WEATHER,
    CONFLICT_TEXT: CONFLICT_TEXT,

    MAX_DROPS: MAX_DROPS,
    DROP_RADIUS: DROP_RADIUS,
    DROP_LIFE: DROP_LIFE,
    PACE: PACE,               // 和 evolution.js 的副本，_wiring_test.js 会比对
    LIGHT_DECAY: LIGHT_DECAY,
    DISCORD_DECAY: DISCORD_DECAY,
    FIRE_THRESHOLD: FIRE_THRESHOLD,
    NIGHT_THRESHOLD: NIGHT_THRESHOLD,
    RIFT_THRESHOLD: RIFT_THRESHOLD,

    drop: drop,
    step: step,
    localAt: localAt,
    essenceAt: essenceAt,
    averageBoost: averageBoost,
    lightEffects: lightEffects,
    isInsideWorld: isInsideWorld,
    reset: reset
  };
});
