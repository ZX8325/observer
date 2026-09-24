/* ═══════════════════════════════════════════════════════════════════
   ⑥ CivEvents —— 文明事件
   ═══════════════════════════════════════════════════════════════════
   职责：文明编年史里随机弹出的事件，每个 2-3 个选项，玩家做选择。

   ⚠️ 2026-09-12 重做后有了第二个来源：**物种专属事件**。
      它们放在 core/civLore.js 里（和那个物种的历史行、征兆待在一起）——
      一个物种的所有内容在一块儿才好维护。
      本文件只负责"把两边的池子合起来抽签"和"把选择落到世界上"。

   和「演化路线选择」（core/choices.js）是**两套不同的东西**：
     · choices.js   —— 两道**固定的**岔路口，一定会在固定阶段弹
     · civEvents.js —— 文明发展期里**随机抽**的插曲，2~4 次

   两者共用同一个弹出界面（#choice 那个），数据结构也一致
   （label / blurb / gain / cost），所以界面代码不用写两遍。

   ── 选项怎么影响世界（四个通道）──
     ① 压力     pressure: -8    —— ★ 新增。负数是"买时间"，正数是"欠债"。
                                   压力涨到 100 文明就被压垮（见 evolution.js）
     ② 光暗值   light: +10      —— 确定生效，直接改 world.light
     ③ 命运倾向 marks: {rise: 2} —— 累积到 world.civMarks，
        在结局判定时兑现（见 ending.js 的 fate）
     ④ 编年史   chronicle: '他们选择了调停' —— ★ 新增。
                                   把玩家的选择**写进历史**（由 evolution.js 落笔）

   为什么要有第 ② 条：
     光暗值只能影响「飞升 / 分裂 / 融合」三种命运（它们本来就是看光暗值的）。
     但「被观测」「寂灭」这些不看光暗值 —— 玩家在发展期做的选择
     就传不到结局里去。所以加了这一层：**玩家在发展期的选择，
     攒够了就在结局里兑现。**

   ⚠️ 所有事件**一局里最多各出现一次**（不重复），所以每个 mark
      一局能拿到的上限是固定的 —— 阈值就是按这个定的。
      改 marks 的数值之前，先跑 _civEvents_test.js 看四种倾向的可达率。

   铁律 B：本文件不许出现 document / window / canvas。
   ═══════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  var mod = factory(
    (typeof require !== 'undefined') ? require('./civLore.js') : root.CivLore,
    /* ⚠️ 2026-09-14 加的第二个依赖 —— 只有一个用途：
       「界外入侵」那个选项的**抵抗判定**（见 apply 的第 ⑤ 段）。
       ⚠️ 2026-09-17 修词：原来是"抵抗**骰**"，2026-09-15 起
          已经改成确定性判定了（军 + 科 + 生 > 门槛），没有随机。
       ⚠️ 加它的时候**必须同步 `_check-package.js` 的 DEPS 表** ——
          那张表是打包自检用来验加载顺序的，漏改的话
          `node _check-package.js` 会红（它就是从那次踩坑里长出来的）。 */
    (typeof require !== 'undefined') ? require('./rng.js') : root.RNG
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.CivEvents = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CivLore, RNG) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     命运倾向的阈值
     ═══════════════════════════════════════════════════════════════
     ⚠️ 四种倾向都定成 2，但**拿到 2 的难度不一样**，这是有意的：

        watched（被观测）—— 一个选项就给 2。这个命运本来就该稀有，
                             但玩家明确选了"建造观测阵列"就该给到。
        rise（飞升）     —— 全力开采给 2；节制使用只给 1。
        fall（寂灭）     —— 听天由命给 2；封锁只给 1。
        split（分裂）    —— 三个事件各给 1~2，攒够 2 需要**连续两次**
                             都往分裂的方向走。

     ⚠️ 这些倾向在结局判定里的位置是**倒数第二档**（见 ending.js）：
        环境灾难和光暗值判定都比它优先。
        也就是说 —— 你没怎么动光暗值的时候，发展期的选择才说了算。
     ═══════════════════════════════════════════════════════════════ */
  var MARK_THRESHOLD = 2;

  /* ⚠️ 单个倾向可以**单独定门槛**，写在 `MARK_MIN` 里
     （`markReached` 读它：有覆盖就用覆盖，没有才用 MARK_THRESHOLD）。

     为什么不干脆改 MARK_THRESHOLD：那四个数是**互相咬着**的 ——
     它们共用一张抽签池，改一个就是改所有。

     ⚠️ 名字叫 MARK_**MIN** 是历史（当初只用来"放低"），
        2026-09-15 起它**两个方向都用** —— 见下面 fall 那条。

     ── machine（遗落）的来龙去脉 ──
     ① 最早它只有**一个**来源（humanoid 的「工具开始造工具 → 让它做」），
        一局最多碰上一次，门槛 2 的话永远走不到 —— 所以放低到 1。
     ② 2026-09-13 扩池时给了它**第二个**来源，而且那个更重：
        大事件的「他们造出了替自己的东西 → 放手」，给 **2**。
     ③ 于是门槛**调回 2**（现在还是默认，`MARK_MIN` 里没有它）。

     现在的效果：
       · 只有人类那条（machine 1）→ **不够**
       · 只有大事件那条（machine 2）→ **够** —— 一条选项就能走到「遗落」
       · 两条都碰上 → 3，当然也够

     ⚠️ 大事件那条写的正是「遗落」本身（他们不再动手了），
        人类那条只是它的前身（会做东西的人一年比一年少）——
        所以让重的那个自己就够，轻的那个单独不够。

     ⚠️ 再给 machine 加来源之前，先回来看看这个门槛。 */
  var MARK_MIN = {
    /* ★★ `fall`（寂灭）**门槛抬到 3** —— 2026-09-15，实测定的 ★★

       ── 为什么要动它 ──
       2026-09-15 命运改版时，「攒够寂灭倾向」从 marks 那一档
       **提到了死活档**（它说的是"文明在灾难中消失"，是**没活下来**，
       不该混进"活成什么样"里 —— 详见 ending.js 的 fate 链）。
       提上来之后它从"几乎轮不到"变成了**最常见的结局**：

           门槛   攒够 fall 的局    寂灭占
            2        34.1%         17.8%   ← 一提上来就这样，太容易攒了
           ★3        12.3%          4.7%
            4         4.4%          1.3%

       ★ 选 3：寂灭变成**要挣来的**（12% 的局够格），
         而不是"随便选几次就掷硬币"（34%）。

       ⚠️⚠️ 这条**不是"放低"，是抬高** —— 名字叫 MARK_MIN 纯属历史。
          它和 machine 那条方向相反，别照着 machine 的注释理解。
       ⚠️ 门槛 2 和 3 之间差得极远（17.8% → 4.7%）——
          因为这些倾向是 +1/+2 累加的，加一格就跨过一大片分布。
          **再动它之前先重量**（改完跑一遍上面那张表）。 */
    fall: 3
  };

  /* ═══════════════════════════════════════════════════════════════
     五个事件
     ═══════════════════════════════════════════════════════════════

     ⚠️⚠️ 这里**没有 gain / cost**，不是漏写 ⚠️⚠️

        岔路口（choices.js）答完会给一张**结果卡**，那是它读 gain/cost 的地方。
        文明事件**不给结果卡** —— 结果由编年史里那行金色记录（chronicle）讲出来。
        所以 gain/cost 在本文件里**永远没有机会显示**（2026-09-12 删掉，
        当时共 66 条，本文件 30 条 + civLore.js 的物种专属事件 36 条）。
        **别照着 choices.js 的格式把它们加回来。**

     每个选项的文案字段：
       label     选项名（大字）
       blurb     一句话说明（小字）
       chronicle ★ 玩家这一答写进历史的那一行（金色，由 evolution.js 落笔）
                  —— 它同时是"结果"和"记录"，所以写得要能单独成立

     外加四个效果字段（都是可选的，不写就是没影响）：
       light     光暗值变化（确定生效，立刻改 world.light）
       marks     命运倾向（累积，见上）
       pressure  压力偏移（负数 = 买时间，正数 = 欠债）
       slow      发展期延长/缩短多少秒（正数 = 慢下来，负数 = 加速）
     ═══════════════════════════════════════════════════════════════ */
  var EVENTS = [

    /* ── ① 两个聚落冲突 ──
       文明早期最常见的事：资源不够分。 */
    {
      key: 'clash',
      title: '两座城争一条河',
      question: '两座城共用一条河。上游把坝筑起来之后，下游的河滩露了出来，水只剩三成。',
      options: [
        {
          key: 'mediate',
          label: '出面调停',
          blurb: '两边坐下来，把用水的次序定下',
          lean: ['peace', 'hermit', 'trade'],
          light: +10, marks: {}, chronicle: '{folk}没有动手。两座城把用水的次序刻在了同一块石头上，刻了很久。那块石头后来一直立着。', pressure: -10
        },
        {
          key: 'letfight',
          label: '放任他们打',
          blurb: '谁也不劝，看着他们打',
          lean: ['war', 'nomad', 'hermit'],   // ★ 2026-09-16 加 hermit：不管别人的事就是隐世
          light: -14, marks: { split: 1 }, chronicle: '{folk}没有再劝。打赢的那座城吞下了另一座。输的那座，后来连名字都没有留下。', pressure: +8
        },
        {
          key: 'reroute',
          label: '把河流改道',
          blurb: '把河挖成两条，各走一条',
          lean: ['craft', 'trade'],
          light: +4, marks: {}, slow: +12, chronicle: '{folk}把河挖成了两条，两座城各走一条。挖这条河用了几代人。', pressure: -6
        }
      ]
    },

    /* ── ② 发现新资源 ──
       给了「飞升」一条技术路线 —— 不靠光之力，靠工具。 */
    {
      key: 'resource',
      title: '发现新资源',
      question: '地下深处有一层一直放热的东西。第一孔钻透之后，热流没有减弱的迹象。',
      options: [
        {
          key: 'exploit',
          label: '全力开采',
          blurb: '把能取的全部取出来',
          lean: ['war', 'craft', 'seek'],
          light: -10, marks: { rise: 2 }, chronicle: '{folk}把那层挖开了。地表换了一个颜色，此后一直是那个颜色。', pressure: +12
        },
        {
          key: 'moderate',
          label: '节制使用',
          blurb: '定下每年可取的量，不越线',
          lean: ['peace', 'trade'],
          light: +6, marks: { rise: 1 }, slow: +8, chronicle: '{folk}定下了每年能取多少。这条线后来一次也没有越过。', pressure: -6
        },
        {
          key: 'seal',
          label: '封存起来',
          blurb: '不碰，留给以后的人决定',
          lean: ['hermit', 'faith'],
          light: +14, marks: {}, chronicle: '{folk}把它封了回去，说留给以后。那个口子后来一直封着。', pressure: -3
        }
      ]
    },

    /* ── ③ 瘟疫爆发 ──
       唯一一个能给出高额 fall（寂灭）倾向的事件。 */
    {
      key: 'plague',
      title: '瘟疫爆发',
      question: '一种病沿着商路传开。先是两座城，后来是沿岸所有的城。',
      options: [
        {
          key: 'quarantine',
          label: '封锁边界',
          blurb: '切断来往，先保住自己',
          lean: ['war', 'hermit', 'peace'],   // ★ 2026-09-16 加 peace：切断来往保全自己，和平型也做
          light: -10, marks: { fall: 1, split: 1 }, chronicle: '{folk}把路封了。病慢了下来，隔在外面的那些也没有再回来。', pressure: +4
        },
        {
          key: 'heal',
          label: '倾力救治',
          blurb: '把所有储备拿出来救人',
          lean: ['peace', 'faith'],
          light: +16, marks: {}, slow: +12, chronicle: '{folk}把储备全拿了出来。病压下去了，可是往后几代都没有再添置新的东西。', pressure: -12
        },
        {
          key: 'fate',
          label: '照常运转',
          blurb: '不封锁，也不停工',
          lean: ['nomad'],
          light: -18, marks: { fall: 2 }, slow: +10, chronicle: '{folk}照常运转。人口跌到三成，用了很久才涨回来。', pressure: +14
        }
      ]
    },

    /* ── ④ 文明仰望星空 ──
       唯一能给出 watched（被观测）倾向的事件。
       设计意图：命运「被观测」原本只有"玩家几乎没干预"这一条路，
       现在玩家可以在发展期主动把文明引向那个方向。 */
    {
      key: 'skyward',
      title: '文明仰望星空',
      question: '某个夜里，有人开始记录天上光点的位置。这件事一直没有停过。',
      options: [
        {
          key: 'array',
          label: '建观测阵列',
          blurb: '系统地、长期地看向世界之外',
          lean: ['seek'],
          light: +10, marks: { watched: 2 }, chronicle: '{folk}造了专门用来看天上的东西。他们看了一代又一代，没有停。', pressure: +6
        },
        {
          key: 'omen',
          label: '当作神谕',
          blurb: '不再追问，只照着做',
          lean: ['faith'],
          light: +18, marks: { watched: 1 }, chronicle: '{folk}不再问那是什么，只问它想要什么。', pressure: -8
        },
        {
          key: 'ignore',
          label: '不予理会',
          blurb: '把资源全投在实处',
          lean: ['craft', 'nomad', 'war'],
          light: -6, marks: {}, chronicle: '{folk}没再看天。力气全用在了地上，天上有什么再没有人记。', pressure: -4
        }
      ]
    },

    /* ── ⑤ 内部分裂 ──
       发展期的收尾事件（如果被抽中的话）。 */
    {
      key: 'schism',
      title: '内部分裂',
      question: '「接下来该怎么走」有了两种答案。两边都拿得出依据，谁也说服不了谁。',
      options: [
        {
          key: 'suppress',
          label: '强力压合',
          blurb: '只允许有一个答案',
          lean: ['war', 'faith'],
          light: -20, marks: { split: 2 }, chronicle: '{folk}把另一种说法压了下去。只剩下那一种，另一种后来没有人再提。', pressure: +10
        },
        {
          key: 'part',
          label: '和平分家',
          blurb: '各走各的，谁也不碍谁',
          lean: ['peace', 'hermit'],
          light: -8, marks: { split: 2 }, chronicle: '{folk}分开了。两套说法各走各的，谁也管不着谁。', pressure: +6
        },
        {
          key: 'thirdway',
          label: '找第三条路',
          blurb: '把分歧本身变成新的方向',
          lean: ['seek', 'trade'],
          light: +12, marks: {}, slow: +10, chronicle: '{folk}谈了很久，最后找到一条谁都没想过的路。那一条两边都认。', pressure: -14
        }
      ]
    },

    /* ═══════════════════════════════════════════════════════════════
       ★★ 2026-09-13 扩池：通用小事件 5 → 20 ══
       ═══════════════════════════════════════════════════════════════

       ── 为什么要扩 ──
       实测 800 局：**每局都正好抽到 4 个小事件**。
       因为上限是"池子的七成"，而通用池只有 5 个 + 物种专属 2 个 = 7，
       七成就是 4 —— 池子先咬住了，玩家每局遇到的是同一批事。
       这正是用户说的「重复」。

       ── ⚠️ 通用事件的主语一律用 `{folk}`，不许写「他们」 ──
       这个池子**七个物种共用**。写死「他们」的话，
       巢群 / 林体 / 岩体（虫类 / 植类 / 石类）的编年史里就会冒出「他们」——
       而那三样不是人。
       （同一个坑 2026-09-12 在历史行上犯过一次，见 CLAUDE.md 第十三节。
         `{folk}` 由 CivLore.fillPlaceholders 在推行那一刻替换成族名。）

       ── 纪元是**软约束** ──
       标了 `era` 的，落在那个纪元的时间窗里（见 placeByEra）。
       不标的就是"什么时候都可能发生"，摊在整段上。
       前三纪按"聚落 → 城邦 → 危机"的弧线排，第四纪元留给大事件。

       ── ⚠️ 别往这里加 `machine` 倾向 ──
       它的门槛是**默认的 2**（`MARK_MIN` 里**没有**它 —— 来龙去脉见上面
       「machine（遗落）的来龙去脉」那一段：只有一个来源的年代它放低到过 1，
       2026-09-13 加了第二个来源之后调回了 2，一直到现在）。
       这里再加一条的话，「遗落」会从"人类专属的稀有条目"变成烂大街的结局。
       要扩那条路，批 26 之后单独做。
       ═══════════════════════════════════════════════════════════════ */

    /* ── 纪元 1 · 点燃：聚落、文字、第一次死亡 ── */

    /* ⑬ 第一个被记住的人 —— 记忆是怎么开始的 */
    {
      key: 'recall', era: 1,
      title: '第一个留下的名字',
      question: '{folk}里死了第一个。他们把那个名字说了出来，一遍一遍，没有停。',
      options: [
        { key: 'keepname', label: '把名字留下', blurb: '一代一代说下去',
          lean: ['faith', 'craft'],
          light: +8, marks: {}, pressure: -6,
          chronicle: '{folk}把那个名字一代代传了下去。传到第十代的时候，已经没有人知道那个名字底下是谁了。名字还在。' },
        { key: 'letgo', label: '不再提起', blurb: '谁也不再去提那个名字',
          lean: ['nomad', 'war'],
          light: -4, marks: {}, pressure: -2,
          chronicle: '{folk}不再提那个名字。他们只记住做过的事，不记住是谁做的。' },
        { key: 'markhim', label: '做个记号', blurb: '在原地堆一堆石头',
          lean: ['craft', 'faith'],
          light: +6, marks: {}, slow: +6,
          chronicle: '{folk}在原地堆了一堆石头。往后路过的人会停下来看一眼，再往上添一块。' }
      ]
    },

    /* ⑭ 有人开始数 —— 数字是怎么开始的 */
    {
      key: 'number', era: 1,
      title: '有人开始数',
      question: '{folk}里有人开始数东西。数到第三十个的时候，前面数过什么已经忘了。',
      options: [
        { key: 'write', label: '记下来', blurb: '在石头上划下来',
          lean: ['seek', 'craft'],
          light: +10, marks: {}, slow: +8,
          chronicle: '{folk}把数出来的划在了石头上。要数多少，看一眼石头就知道。' },
        { key: 'stopcount', label: '不数了', blurb: '够用就行',
          lean: ['hermit', 'nomad'],
          light: -2, marks: {}, pressure: -8,
          chronicle: '{folk}不数了。东西够不够，看一眼就知道，不用数。' },
        { key: 'countall', label: '数下去', blurb: '能数的都数一遍',
          lean: ['seek', 'trade'],
          light: +6, marks: { rise: 1 }, pressure: +6,
          chronicle: '{folk}开始数所有能数清的东西。数到数不完的时候，就在边上画一道。那道后来有了名字。' }
      ]
    },

    /* ⑮ 一个地方被反复使用 —— 圣地 / 纪念是怎么来的 */
    {
      key: 'gatherplace', era: 1,
      title: '{folk}总回到同一个地方',
      question: '有一个地方，{folk}每次都回到那里。它不产出任何东西。',
      options: [
        { key: 'buildthere', label: '建在那里', blurb: '让它变成固定的',
          lean: ['craft', 'faith'],
          light: +8, marks: {},
          chronicle: '{folk}在那里建起了第一处不是用来住的地方。那处建筑后来一直在。' },
        { key: 'leaveit', label: '什么也不建', blurb: '保持原样',
          lean: ['hermit', 'faith'],
          light: +4, marks: {}, pressure: -6,
          chronicle: '那里一直空着。{folk}只是回到那里，什么也不留下。' },
        { key: 'useup', label: '力气集中', blurb: '让它变成最重要的一处',
          lean: ['faith', 'trade'],
          light: +12, marks: {}, slow: +8,
          chronicle: '{folk}把力气集中到了一处。别的地方因此慢了下来。' }
      ]
    },

    /* ⑯ 东西越做越细 —— 手艺的岔路 */
    {
      key: 'sharp', era: 1,
      title: '东西越做越细',
      question: '{folk}做出来的东西，开始比需要的更细。',
      options: [
        { key: 'finer', label: '继续做细', blurb: '细到没有用处',
          lean: ['craft', 'seek'],
          light: +8, marks: { rise: 1 }, slow: +10,
          chronicle: '东西越做越细。有些细到没有用处，{folk}还是接着做。' },
        { key: 'enough', label: '够用就停', blurb: '不往细里走',
          lean: ['nomad', 'peace'],
          light: -2, marks: {}, pressure: -6,
          chronicle: '够用之后就不再往下做了。此后{folk}的东西一直很粗。' },
        { key: 'teachfine', label: '把手艺传开', blurb: '让更多人会',
          lean: ['craft', 'faith'],
          light: +10, marks: {}, pressure: -4,
          chronicle: '{folk}把做法教给了别人。会做的人多了，做得最好的那几个不再特别。' }
      ]
    },

    /* ⑰ 死者放在一起 —— 丧葬的岔路 */
    {
      key: 'putdead', era: 1,
      title: '{folk}把死者放在一起',
      question: '{folk}开始把死者放在同一个地方。从前是就地留下的。',
      options: [
        { key: 'sameplace', label: '固定在一处', blurb: '让后来的人找得到',
          lean: ['faith', 'craft'],
          light: +8, marks: {},
          chronicle: '{folk}把死者放在同一处。许多年后，那个地方比任何住处都用得久。' },
        { key: 'scatter', label: '仍旧就地', blurb: '不聚在一起',
          lean: ['nomad', 'hermit'],
          light: +2, marks: {}, pressure: -4,
          chronicle: '死者仍旧留在倒下的地方。过了很久，也没有一处能说出全部的名字。' },
        { key: 'burn', label: '烧掉', blurb: '不留痕迹',
          lean: ['war', 'nomad'],
          light: -10, marks: { fall: 1 }, pressure: +4,
          chronicle: '{folk}把死者烧掉了。从此以后，没有留下任何一个旧名字。' }
      ]
    },

    /* ── 纪元 2 · 扩散：城邦、贸易、邻族接触 ── */

    /* ⑱ 路被走通 */
    {
      key: 'roadmade', era: 2,
      title: '{folk}走通了一条路',
      question: '{folk}把两处之间走通了。全程要经过三种地形。',
      options: [
        { key: 'widen', label: '拓宽它', blurb: '让更多人能走',
          lean: ['trade', 'craft'],
          light: +8, marks: {}, slow: +8,
          chronicle: '{folk}把路拓宽了。从此从一头到另一头，路上的时间少了一半。' },
        { key: 'keepnarrow', label: '保持原样', blurb: '只有认路的人走得通',
          lean: ['hermit', 'faith'],
          light: +2, marks: {}, pressure: -6,
          chronicle: '路一直很窄。要走通它，得有人带着。' },
        { key: 'blockit', label: '把它断掉', blurb: '不让两边来往',
          lean: ['war', 'hermit'],
          light: -12, marks: { split: 1 }, pressure: +6,
          chronicle: '{folk}把路断掉了。两边从此各走各的，画出来的地图也不一样。' }
      ]
    },

    /* ⑲ 交换变成规矩 */
    {
      key: 'barterlaw', era: 2,
      title: '交换变成了规矩',
      question: '{folk}把交换的规矩定了下来。上面写着什么东西能换什么东西。',
      options: [
        { key: 'written', label: '写成条文', blurb: '谁来都一样',
          lean: ['trade', 'craft'],
          light: +8, marks: {}, pressure: -6,
          chronicle: '{folk}把规矩写了下来。往后再换东西，不必再认识对方。' },
        { key: 'byword', label: '不写，靠说', blurb: '认得的人才作数',
          lean: ['faith', 'hermit'],
          light: +4, marks: {},
          chronicle: '规矩没有写下来。只和认得的人换，范围一直不大。' },
        { key: 'freely', label: '不立规矩', blurb: '谁想怎么换就怎么换',
          lean: ['nomad', 'war', 'trade'],   // ★ 2026-09-16 加 trade：自由交换是商业的本行
          light: -6, marks: { split: 1 }, pressure: +8,
          chronicle: '没有立规矩。后来{folk}为换东西打过不止一次。' }
      ]
    },

    /* ⑳ 遇到另一批 —— 接触外族 */
    {
      key: 'meetother', era: 2,
      title: '{folk}遇到了另一批',
      question: '{folk}遇到了另一批。两边说的话不一样，用的东西也不一样。',
      options: [
        { key: 'learn', label: '学他们的', blurb: '把人家的做法拿过来',
          lean: ['seek', 'trade'],
          light: +10, marks: {}, slow: +8,
          chronicle: '两边的东西开始混在一起。过了几代，分不出哪样原本是谁的。' },
        { key: 'apart', label: '各过各的', blurb: '只换东西，不住一起',
          lean: ['hermit', 'peace'],
          light: +4, marks: {}, pressure: -6,
          chronicle: '两边只换东西。住处一直离得很远，说话的方式也没有混。' },
        { key: 'pushout', label: '赶走他们', blurb: '这里只留自己人',
          lean: ['war', 'faith', 'hermit'],   // ★ 2026-09-16 加 hermit：「只留自己人」
          light: -16, marks: { fall: 1, split: 1 }, pressure: +10,
          chronicle: '{folk}把另一批赶走了。往后他们画出来的地图上只有自己。' }
      ]
    },

    /* ㉑ 边界被划出来 */
    {
      key: 'edge', era: 2,
      title: '{folk}划出了一条边线',
      question: '{folk}开始说哪一片是自己的。从前没有这条线。',
      options: [
        { key: 'drawline', label: '把线画出来', blurb: '落在实地上的线',
          lean: ['craft', 'war', 'trade'],   // ★ 2026-09-16 加 trade：边界是交换的前提
          light: -6, marks: { split: 1 }, pressure: +6,
          chronicle: '线画了出来。过了很久，线两边的说法开始不一样。' },
        { key: 'noline', label: '不画线', blurb: '走到哪里算哪里',
          lean: ['nomad', 'peace'],
          light: +6, marks: {}, pressure: -8,
          chronicle: '没有画线。{folk}走到哪里算哪里。' },
        { key: 'shareline', label: '线共用', blurb: '两边都算自己人',
          lean: ['peace', 'trade'],
          light: +10, marks: {}, slow: +6,
          chronicle: '线画了出来，两边都能用。从此跨过线不需要理由。' }
      ]
    },

    /* ㉒ 有人不再自己生产 —— 分工与阶级 */
    {
      key: 'sparehands', era: 2,
      title: '有人不再自己生产',
      question: '{folk}之中有一部分人不再自己生产。他们吃的来自别人。',
      options: [
        { key: 'feedthem', label: '养着他们', blurb: '让他们做别的事',
          lean: ['craft', 'seek'],
          light: +8, marks: { rise: 1 }, slow: +10,
          chronicle: '不生产的那部分人变多了。往后{folk}的东西多半不是自己做的。' },
        { key: 'sendback', label: '都出力气', blurb: '谁都得出力气',
          lean: ['nomad', 'war'],
          light: -6, marks: {}, pressure: -4,
          chronicle: '所有人都回去生产了。再没有一件事是专门有人做的。' },
        { key: 'lowthem', label: '分出上下', blurb: '分清楚谁在上面',
          lean: ['war', 'faith', 'craft'],   // ★ 2026-09-16 加 craft：手艺人的行当本来就分师傅徒弟
          light: -14, marks: { split: 2 }, pressure: +10,
          chronicle: '{folk}分出了上下。从那以后，两边的住处不再挨在一起。' }
      ]
    },

    /* ── 纪元 3 · 临界：战争、阶级、大工程 ── */

    /* ㉓ 规矩合成一份 */
    {
      key: 'onecode', era: 3,
      title: '规矩多到记不住',
      question: '{folk}的规矩多到记不住了。有人提议：把所有的规矩刻到同一块石头上。',
      options: [
        { key: 'mergeone', label: '合成一份', blurb: '都按那一块石头上的来',
          lean: ['craft', 'faith'],
          light: +8, marks: {}, slow: +10,
          chronicle: '所有的规矩都刻在了同一块石头上。从那以后，{folk}只有这一套说法。' },
        { key: 'keepmany', label: '各留各的', blurb: '各刻各的',
          lean: ['hermit', 'trade'],
          light: +4, marks: { split: 1 }, pressure: -4,
          chronicle: '规矩没有合并。每一座城都按自己那份来，谁也不认别人的。' },
        { key: 'burnold', label: '只留新的', blurb: '旧的全都不要了',
          lean: ['war', 'faith'],
          light: -16, marks: { split: 2 }, pressure: +12,
          chronicle: '{folk}把旧的那块石头砸了。此后只有新刻的这一份，旧的没有人再提。' }
      ]
    },

    /* ㉔ 有人不服从 */
    {
      key: 'refuser', era: 3,
      title: '有人不服从',
      question: '{folk}之中有一批人不再照做。他们说不出更好的办法，只是不肯再照做。',
      options: [
        { key: 'hearit', label: '先听他们说', blurb: '听完再定',
          lean: ['peace', 'seek'],
          light: +10, marks: {}, slow: +8,
          chronicle: '{folk}把那批人的话从头听完了。规矩里因此多了一条，那一条是照他们说的写的。' },
        { key: 'forcethem', label: '强制照做', blurb: '不照做就赶走',
          lean: ['war', 'faith'],
          light: -18, marks: { split: 2 }, pressure: +12,
          chronicle: '{folk}把那批不肯照做的赶走了。再没有第二种做法，也没有人再提过。' },
        { key: 'ignorethem', label: '不管他们', blurb: '随他们去',
          lean: ['hermit', 'nomad'],
          light: +2, marks: {}, pressure: -6,
          chronicle: '{folk}没有管那批人。他们按自己的方式过，两边很少来往。' }
      ]
    },

    /* ㉕ 有一年特别冷 —— 环境压力 */
    {
      key: 'hardyear', era: 3,
      title: '有一段时间特别难',
      question: '有一段时间，{folk}能取到的东西少了一半。这样的年份从前也有过，但没有这次长。',
      options: [
        { key: 'storerest', label: '存起来', blurb: '为下一次准备',
          lean: ['craft', 'trade'],
          light: +8, marks: {}, slow: +8,
          chronicle: '{folk}把剩下的存了起来。从那以后，他们一直留着一份不动的储备，谁都不许碰。' },
        { key: 'moveon', label: '搬走', blurb: '换一个地方',
          lean: ['nomad'],
          light: +2, marks: {}, pressure: -8,
          chronicle: '{folk}搬走了。只要能取到的东西变少，他们就换一个地方。' },
        { key: 'takemore', label: '全取出来', blurb: '先过完这一段',
          lean: ['war', 'seek'],
          light: -12, marks: { fall: 2 }, pressure: +14,
          chronicle: '{folk}把能取的全取了出来。那一段过去了，可是能取的东西一直没有回来。' }
      ]
    },

    /* ㉖ 造一个没用的东西 —— 大工程 */
    {
      key: 'uselesswork', era: 3,
      title: '{folk}要造一个没用的东西',
      question: '{folk}要造一个东西。它没有用处，造它却要花掉大半力气。',
      options: [
        { key: 'buildit', label: '造出来', blurb: '造出来再说',
          lean: ['faith', 'craft'],
          light: +14, marks: { rise: 1 }, slow: +12,
          chronicle: '东西造好了。它一直立在那里，一次也没有用过。' },
        { key: 'stopit', label: '停下来', blurb: '力气用在别处',
          lean: ['trade', 'nomad'],
          light: -4, marks: {}, pressure: -10,
          chronicle: '造到一半停了下来。剩下的那半截一直堆在原地，没有人再动。' },
        { key: 'manyit', label: '不止一个', blurb: '每一处都造',
          lean: ['faith', 'war', 'craft'],   // ★ 2026-09-16 加 craft：每一处都造，这是工匠的活法
          light: +8, marks: {}, pressure: +8,
          chronicle: '每一处都造了一个。一座比一座高，力气全花在往上加。' }
      ]
    },

    /* ㉗ 旧办法不灵了 */
    {
      key: 'oldways', era: 3,
      title: '旧办法不灵了',
      question: '{folk}从前用的办法，现在不怎么管用了。是从哪一年开始不管用的，没有人说得上来。',
      options: [
        { key: 'newway', label: '换一套', blurb: '旧的丢掉',
          lean: ['seek', 'craft'],
          light: +10, marks: { rise: 1 }, slow: +8,
          chronicle: '{folk}换了一套办法。旧的那套，只有少数人还记得。' },
        { key: 'keepold', label: '照旧用', blurb: '不管它管不管用',
          lean: ['faith', 'hermit'],
          light: +2, marks: { fall: 1 }, pressure: +8,
          chronicle: '旧办法一直用着。做同样的事，要花掉更多的力气。' },
        { key: 'bothway', label: '两套都用', blurb: '新的旧的都留着',
          lean: ['trade', 'peace'],
          light: +6, marks: {}, pressure: -6,
          chronicle: '两套办法一起用。做一件事，要走两遍。' }
      ]
    },

    /* ═══════════════════════════════════════════════════════════════
       ★★ 纪元 4 · 顶端：文明长到头之后，**他们自己**做的事 ══
       ═══════════════════════════════════════════════════════════════

       ── 补这一段之前，通用池在纪元 4 是**一格没有**的 ──
       实测（1388 局）：小事件落在各纪元的条数是 **6 / 11 / 14 / 0**。
       第四纪元那点零星几条第小事件，全来自两个零头：5 条**没标纪元**的
       通用事件（摊在整条时间轴上，每纪元分四分之一）+ 极少数标了
       `era: 4` 的物种专属事件。通用池本身是空的。用户 2026-09-23 报的就是这个。

       ── ⚠️ 写的是"顶端"，不是"古老"（用户原话）──
       「第四纪元了是**人类发展的顶端**，不要写太古老的事件」。

       所以这一段里**没有一条**是"第一次做某件事"—— 那是前三纪元的活。
       共同点是**尺度变了**：不再是一条河、一座城，而是**整颗星球、所有人、
       往后每一代**。

       ★★ 2026-09-23 当天写了**两批**，因为第一批不够 ★★

       第一批 5 条（㉘~㉜：寿命 / 全球连成一体 / 地方话消失 / 气候被算住 / 自然退场）
       写完实测：一局**读得到**一条的只有 **48.3%** —— 也就是**过半的局**
       在第四纪元还是什么都没有。用户连玩两局都没遇到，概率 26.7%，不是运气差。
       根因：一局只抽约 6 条、池子 41 条，每条中签率才 ~15%，5 条全不中很常见。

       第二批 5 条（㉝~㊲：知识的边界 / 信息过载 / 个体趋同 / 回头看起点 /
       整颗星球只剩一个说话者）补上之后 → **67.8%**。

       ⚠️ 想再往上只能继续加内容，或者改抽签规则 —— **光加内容到不了 100%**：
          池子是共用的，翻倍（10 条）也只到 67.8%，三倍 77.1%。
          ⚠️ 另一条路是给它们"推两份"（物种专属事件用的办法）——
             同样能到 67.8%、不用写新内容，但**同一批事件会反复出现**，
             那正是本文件开头反复警告的"每局都是同一批"老毛病。**没选它。**

       ── ⚠️ 落点：只落在第四纪元的窗口 [78.75%, 96.25%] ──
       和 `OPTION_AXIS` / `OPTION_ATTR` 两张表里的 30 行一一对应，
       幅度照旧 ±1 / ±2。**没有为了"让大事件门槛好过"去动任何一个数** ——
       用户 2026-09-23 的原话：「按照逻辑加，不要因为概率问题影响属性」。

       ⚠️ 已知后果（量过）：小事件变多 ⇒ `marks` 攒得快 ⇒ 更多局触发
          「锁结局、当场收尾」⇒ 那批局碰不到大事件。详见 docs/SYSTEMS.md。 */

    /* ㉘ 活得比从前久 */
    {
      key: 'longlife', era: 4,
      title: '活得比从前久',
      question: '{folk}能活的年头，比祖辈多了两倍。',
      options: [
        { key: 'keeppush', label: '继续延长', blurb: '还能再久一些',
          lean: ['seek', 'craft'],
          light: -8, marks: { rise: 1 }, pressure: +10,
          chronicle: '{folk}能活的年头又多了。往后每一代，都比上一代看到更远的以后。' },
        { key: 'forall', label: '所有人都能', blurb: '不只给一部分人',
          lean: ['peace', 'faith', 'trade'],
          light: +8, marks: {}, pressure: -8,
          chronicle: '延长用在了所有人身上。多出来的那些年头，多半花在别人身上了。' },
        { key: 'onlysome', label: '只给一部分', blurb: '不是所有人都延长',
          lean: ['war', 'faith'],
          light: -16, marks: { split: 2 }, pressure: +4,
          chronicle: '多出来的年头只给了少数人。剩下的那些，一辈子短了一半。' }
      ]
    },

    /* ㉙ 连成了一整片 */
    {
      key: 'onepiece', era: 4,
      title: '连成了一整片',
      question: '从高处看下去，{folk}的居处连成了一整片，看不出两处之间的界线。',
      options: [
        { key: 'keepgrow', label: '继续连', blurb: '让它们全连起来',
          lean: ['war', 'trade', 'craft'],
          light: -8, marks: {}, pressure: +10, slow: +8,
          chronicle: '整片地都连上了。地上再没有一处是没有人的。' },
        { key: 'breaksome', label: '留出隔断', blurb: '中间留出不盖的地方',
          lean: ['faith', 'peace', 'hermit'],
          light: +8, marks: {}, pressure: -8,
          chronicle: '他们留出了几道隔断。那些地方一直没有盖东西，后来长起了别的。' },
        { key: 'walled', label: '各围各的', blurb: '每一处围起来',
          lean: ['war', 'hermit'],
          light: -10, marks: { split: 1 },
          chronicle: '每一处都围了起来。界线画得比从前清楚，两边很少过去。' }
      ]
    },

    /* ㉚ 只剩一种话 */
    {
      key: 'onelang', era: 4,
      title: '只剩一种话',
      question: '到处都在说同样的话。上一个只会说地方话的人，年纪很大了。',
      options: [
        { key: 'letgo', label: '由它去', blurb: '不做什么',
          lean: ['trade', 'war'],
          light: +2, marks: {}, pressure: -4,
          chronicle: '最后一种地方话没有人再学。会说的那个人死后，就没有了。' },
        { key: 'keepit', label: '记下来', blurb: '把地方话录下来留着',
          lean: ['faith', 'craft', 'seek'],
          light: +8, marks: {}, pressure: -6, slow: +8,
          chronicle: '他们把地方话录了下来。此后没有人说，但一直留着。' },
        { key: 'forceone', label: '不许说别的', blurb: '只准说一种话',
          lean: ['war', 'faith'],
          light: -14, marks: { split: 2 }, pressure: +10,
          chronicle: '别的话不许再说。往后出生的人，只会这一种。' }
      ]
    },

    /* ㉛ 天气按算的走 */
    {
      key: 'bycalc', era: 4,
      title: '天气按算的走',
      question: '{folk}能算出往后一整年的天气。后来，天气开始按算出来的样子走。',
      options: [
        { key: 'control', label: '按算的来', blurb: '让天气照算出来的下',
          lean: ['craft', 'seek'],
          light: -10, marks: { rise: 1 }, pressure: +12,
          chronicle: '天气开始照着算出来的样子走。往后每一年，都和写下来的那份一样。' },
        { key: 'forecastonly', label: '只算不动手', blurb: '算出来，但不改它',
          lean: ['hermit', 'peace', 'trade'],
          light: +8, marks: {}, pressure: -8,
          chronicle: '算出来的东西只写在纸上。天气照旧，算的人一年比一年多。' },
        { key: 'letthem', label: '各处自己定', blurb: '每一处定自己的天气',
          lean: ['nomad', 'hermit', 'trade'],
          light: +4, marks: {}, pressure: -4,
          chronicle: '每一处定了自己的天气。走过去，天就换一个样子。' }
      ]
    },

    /* ㉜ 没有东西自己长了 */
    {
      key: 'nowild', era: 4,
      title: '没有东西自己长了',
      question: '{folk}的居处之外，能自己长起来的东西一年比一年少。',
      options: [
        { key: 'keepclean', label: '清干净', blurb: '外面一点不留',
          lean: ['war', 'craft', 'trade'],
          light: -12, marks: {}, pressure: +10,
          chronicle: '外面清得干干净净。此后长出来的每一样，都是他们种下的。' },
        { key: 'leaveone', label: '留一片', blurb: '留一片不碰',
          lean: ['faith', 'hermit', 'peace'],
          light: +14, marks: {}, pressure: -10,
          chronicle: '他们留了一片不碰。那片地方后来长成什么样，没有人管过。' },
        { key: 'remakeit', label: '自己造一片', blurb: '照原来的样子造一片',
          lean: ['craft', 'seek', 'faith'],
          light: -6, marks: {}, slow: +10,
          chronicle: '他们照着记录造了一片。样子对得上，里面的东西也对得上。' }
      ]
    },

    /* ㉝ 很久没有新东西了 —— 知识的边界 */
    {
      key: 'nonew', era: 4,
      title: '很久没有新东西了',
      question: '{folk}已经很久没有发现过新的东西了。',
      options: [
        { key: 'keepdig', label: '继续往下找', blurb: '再往下试试',
          lean: ['seek', 'craft'],
          light: -8, marks: { rise: 1 }, pressure: +10,
          chronicle: '他们还在往下找。找出来的东西，一年比一年少。' },
        { key: 'teachall', label: '都教出去', blurb: '把会的教给所有人',
          lean: ['faith', 'peace', 'trade'],
          light: +10, marks: {}, pressure: -6, slow: +8,
          chronicle: '他们把会的都教了出去。往后每一代人会的，和上一代一样多。' },
        { key: 'stopsearch', label: '不再找了', blurb: '手上的够用了',
          lean: ['hermit', 'nomad'],
          light: +4, marks: {}, pressure: -8,
          chronicle: '他们不再找了。已经会的东西，够用很久。' }
      ]
    },

    /* ㉞ 记录多到读不完 —— 信息过载 */
    {
      key: 'fullrecord', era: 4,
      title: '记录多到读不完',
      question: '{folk}的记录多到没有一个人读得完。',
      options: [
        { key: 'keepall', label: '全留着', blurb: '一份都不扔',
          lean: ['faith', 'hermit'],
          light: +10, marks: {}, pressure: -6, slow: +8,
          chronicle: '所有的记录都留着。后来没有人再打开过其中的大部分。' },
        { key: 'keepmain', label: '只留主要的', blurb: '挑出要紧的那些',
          lean: ['craft', 'seek', 'trade'],
          light: -4, marks: {}, pressure: +4,
          chronicle: '他们挑出了主要的那些，别的都处理掉了。留下的每一份都有人读过。' },
        { key: 'burnpart', label: '定期烧一批', blurb: '过一些年就清一次',
          lean: ['war', 'nomad'],
          light: -12, marks: { split: 1 }, pressure: +8,
          chronicle: '每隔一些年，旧的记录就烧掉一批。留下的，一直只够装满一处。' }
      ]
    },

    /* ㉟ 生下来都差不多 —— 个体趋同 */
    {
      key: 'sameborn', era: 4,
      title: '生下来都差不多',
      question: '{folk}新出生的那些，长得越来越像。',
      options: [
        { key: 'letitbe', label: '由它去', blurb: '不做什么',
          lean: ['peace', 'hermit'],
          light: +2, marks: {}, pressure: -6,
          chronicle: '新的和旧的越来越像。没有人说得出是从哪一代开始的。' },
        { key: 'keepdiff', label: '留一部分', blurb: '留下一部分不一样的',
          lean: ['faith', 'peace', 'hermit'],
          light: +12, marks: {}, pressure: -4, slow: +8,
          chronicle: '他们留下了一部分和别的不一样的。那些后来一直和别的不一样。' },
        { key: 'makeall', label: '全都一样', blurb: '干脆都一样',
          lean: ['craft', 'war', 'trade'],
          light: -10, marks: {}, pressure: +10,
          chronicle: '全都一样了。做同样的事，用同样的人，花同样的力气。' }
      ]
    },

    /* ㊱ 最早的那一处 —— 回头看起点 */
    {
      key: 'oldplace', era: 4,
      title: '最早的那一处',
      question: '{folk}回到最早的那一处居处。那里现在没有人住。',
      options: [
        { key: 'restore', label: '照原样修好', blurb: '按记录修回来',
          lean: ['faith', 'hermit', 'peace'],
          light: +14, marks: {}, pressure: -6, slow: +8,
          chronicle: '他们照着最早的记录把它修了回来。修好之后，还是没有人住。' },
        { key: 'rebuild', label: '拆了重盖', blurb: '在原地盖新的',
          lean: ['craft', 'trade'],
          light: -8, marks: {}, pressure: +8,
          chronicle: '旧的拆了，在原地盖了新的。新的一处比原来大了四倍。' },
        { key: 'letfall', label: '让它塌', blurb: '不去动它',
          lean: ['nomad', 'war'],
          light: +2, marks: {}, pressure: -4,
          chronicle: '没有人去动它。它一直塌着，也没有人再提过。' }
      ]
    },

    /* ㊲ 再没有别人了 —— 整颗星球只剩一个说话者 */
    {
      key: 'noother', era: 4,
      title: '再没有别人了',
      question: '{folk}之外，这颗星球上再没有第二个说话的。',
      options: [
        { key: 'disarm', label: '把武器收了', blurb: '不再留着那些',
          lean: ['peace', 'faith', 'hermit'],
          light: +14, marks: {}, pressure: -10,
          chronicle: '武器收了起来。此后很久，没有一件是做来对着自己人的。' },
        { key: 'keepguard', label: '一直留着', blurb: '留着，有人看着',
          lean: ['war', 'faith'],
          light: -6, marks: {}, pressure: +8,
          chronicle: '那些东西留着，一直有人看着。看的人换了一代又一代。' },
        { key: 'meltdown', label: '熔了做别的', blurb: '化了做别的用',
          lean: ['craft', 'trade', 'seek'],
          light: +8, marks: {}, pressure: +2,
          chronicle: '那些东西熔了，做成了别的东西。此后遍地都是那些东西。' }
      ]
    },

    /* ═══════════════════════════════════════════════════════════════
       ★★ 形态专属：他们**住在哪** ══
       ═══════════════════════════════════════════════════════════════
       八个形态各一个（`fits` 会按 world.civ.form 硬筛，只在这一种形态下出现）。

       ⚠️ 形态和物种是**两个正交的维度**（见 CLAUDE.md 第七节 3.2）：
          物种 = 长什么样（兽类 / 虫类 / 岩体…），形态 = 住在哪（海洋 / 地下 / 天空…）。
          所以「海类 · 地下文明」这种组合是成立的 ——
          这八个事件写的是**住处带来的处境**，不能写"谁"。
          主语一律 `{folk}`。

       ⚠️ 和物种专属不一样：物种专属可以写它们身体上的事（气味、结晶、根），
          形态专属只能写**环境**的事（潮水、高度、冰盖、光）。
          两边都写"身体"的话，一个物种换个住处就会读到重复的内容。 */
    {
      key: 'tide', form: 'ocean', era: 1,
      title: '潮水的落差',
      question: '潮水每天起落。落下去的那几个时辰，{folk}的住处露在外面。',
      options: [
        { key: 'followtide', label: '跟着潮水搬', blurb: '随涨随落',
          lean: ['nomad', 'peace'],
          light: +4, marks: {}, pressure: -8, slow: +8,
          chronicle: '{folk}跟着潮水搬。他们没有一处固定的住处，东西都是能带走的。' },
        { key: 'buildhigh', label: '往高处建', blurb: '不管潮水',
          lean: ['craft', 'war'],
          light: -6, marks: { split: 1 }, pressure: +6,
          chronicle: '{folk}把住处建到了潮水到不了的地方。后来他们很少再下水。' },
        { key: 'usetide', label: '用潮水做事', blurb: '让它替自己动',
          lean: ['craft', 'trade'],
          light: +10, marks: { rise: 1 }, slow: +10,
          chronicle: '{folk}用上了潮水的起落。一半的工作由潮水来做，不必自己动手。' }
      ]
    },
    {
      key: 'inland', form: 'continent', era: 2,
      title: '腹地太远了',
      question: '从一头走到另一头要很久。中间那一片，去过的很少。',
      options: [
        { key: 'settlemid', label: '在中间住下', blurb: '把两头连起来',
          lean: ['trade', 'craft'],
          light: +8, marks: {}, slow: +8,
          chronicle: '{folk}在中间住了下来。从一头到另一头，不必一次走完。' },
        { key: 'leavemid', label: '不去那里', blurb: '两头各自过',
          lean: ['hermit', 'peace'],
          light: +4, marks: { split: 1 }, pressure: -6,
          chronicle: '中间一直空着。两头来往要绕很远的路。' },
        { key: 'crossit', label: '穿过去', blurb: '开一条直路',
          lean: ['war', 'seek'],
          light: -4, marks: { rise: 1 }, pressure: +6,
          chronicle: '{folk}开出了一条直路。走中间的人多了起来，路上开始有歇脚的地方。' }
      ]
    },
    {
      key: 'height', form: 'mountain', era: 2,
      title: '再往上没有了',
      question: '住处已经建到了能建的最高处。再往上，空气不够。',
      options: [
        { key: 'stopup', label: '停在最高处', blurb: '不再往上',
          lean: ['craft', 'peace'],
          light: +6, marks: {}, pressure: -6,
          chronicle: '住处停在了那一高度。再没有往上建过，那里就是最高的。' },
        { key: 'digdown', label: '往下挖', blurb: '把山掏空',
          lean: ['craft', 'war'],
          light: -8, marks: { rise: 1 }, pressure: +10,
          chronicle: '{folk}把山从里面掏开了。一半的住处挪进了山体，山外看不出动过。' },
        { key: 'moveaway', label: '换一座山', blurb: '找更矮的',
          lean: ['nomad', 'hermit'],
          light: +2, marks: {}, pressure: -8,
          chronicle: '{folk}换到了更矮的地方。他们不再往高处建，山就空在了那里。' }
      ]
    },
    {
      key: 'dryland', form: 'desert', era: 2,
      title: '水不够了',
      question: '取水的地方在变深。每一次都要往下多挖一截。',
      options: [
        { key: 'digdeep', label: '继续往下挖', blurb: '能挖多深挖多深',
          lean: ['craft', 'war'],
          light: -8, marks: { rise: 1 }, pressure: +12,
          chronicle: '取水的地方一年比一年深。一半力气花在往下挖，别的事都慢了下来。' },
        { key: 'moveoasis', label: '搬到有水处', blurb: '不在这里撑',
          lean: ['nomad'],
          light: +4, marks: {}, pressure: -10,
          chronicle: '{folk}搬到了有水的地方。原来那处住处空了下来，沙子慢慢漫了进去。' },
        { key: 'cutuse', label: '把用量压低', blurb: '每个人少用一半',
          lean: ['peace', 'faith'],
          light: +8, marks: {}, pressure: -6, slow: +8,
          chronicle: '{folk}把用量压了下去。那条线一直守着，没有越过一次。' }
      ]
    },
    {
      key: 'ice', form: 'polar', era: 2,
      title: '冰在退',
      question: '冰盖的边缘在往后退。退过的地方露出了地面。',
      options: [
        { key: 'followice', label: '跟着冰走', blurb: '冰退到哪里就住到哪里',
          lean: ['nomad', 'faith'],
          light: +4, marks: {}, pressure: -8, slow: +10,
          chronicle: '{folk}跟着冰走。每隔几代就要搬一次，住处从来不是长久的。' },
        { key: 'holdground', label: '守在原地', blurb: '不退',
          lean: ['war', 'hermit', 'faith'],   // ★ 2026-09-16 加 faith：「不退」是执念
          light: -6, marks: { fall: 1 }, pressure: +8,
          chronicle: '他们守在了原地。住处和冰之间隔出了一段空地，空地在一年年变宽。' },
        { key: 'useground', label: '用露出的地', blurb: '种点别的',
          lean: ['craft', 'trade'],
          light: +10, marks: { rise: 1 }, slow: +8,
          chronicle: '{folk}用上了露出来的地。头一次有了不是从冰里来的东西。' }
      ]
    },
    {
      key: 'undergrowth', form: 'forest', era: 2,
      title: '下面越来越暗',
      question: '树冠连成一片之后，下面几乎照不到光。',
      options: [
        { key: 'thincanopy', label: '打开树冠', blurb: '让光透下去',
          lean: ['peace', 'craft'],
          light: +10, marks: {}, pressure: -8,
          chronicle: '{folk}在树冠上打开几个口子。透下去的光多了一点，下面开始长出新的东西。' },
        { key: 'liveup', label: '搬到上面去', blurb: '住在树冠里',
          lean: ['seek', 'trade'],
          light: +8, marks: { rise: 1 }, slow: +8,
          chronicle: '{folk}搬到了树冠上。住处在半空，和地面隔着几十米，上下要爬很久。' },
        { key: 'liveindark', label: '就住在暗处', blurb: '不用光',
          lean: ['hermit', 'faith'],
          light: +2, marks: {}, pressure: -6,
          chronicle: '他们一直住在暗处。活动大半挪到了夜里，白天用来歇着。' }
      ]
    },
    {
      key: 'depth', form: 'under', era: 3,
      title: '塌了一处',
      question: '有一处塌了。塌下来的部分堵住了往更深处去的路。',
      options: [
        { key: 'cleart', label: '清开它', blurb: '继续往深处',
          lean: ['craft', 'war'],
          light: -8, marks: { rise: 1 }, pressure: +10,
          chronicle: '{folk}把堵住的那一堆清开了。这一处通了，可是塌的地方也跟着多了。' },
        { key: 'sealit', label: '封起来', blurb: '不再往那边去',
          lean: ['hermit', 'faith'],
          light: +6, marks: {}, pressure: -10,
          chronicle: '{folk}把塌下来的地方永久封住了。再没有人往那个方向挖，那里一直是死的。' },
        { key: 'moveelse', label: '换个方向', blurb: '从别处绕',
          lean: ['seek', 'nomad'],
          light: +4, marks: {}, slow: +8,
          chronicle: '他们换了方向。走的路比原来长了一倍，来回一趟要很久。' }
      ]
    },
    {
      key: 'platform', form: 'sky', era: 3,
      title: '下面够不着了',
      question: '住处越建越高。要往下取一件东西，得费掉大半力气。',
      options: [
        { key: 'builddown', label: '往下也建', blurb: '上下连起来',
          lean: ['craft', 'trade'],
          light: +10, marks: {}, slow: +10,
          chronicle: '{folk}把上下的住处连了起来。取东西不必再单独下去一趟，上下成了一条线。' },
        { key: 'stayout', label: '只待在上面', blurb: '不往下走',
          lean: ['hermit', 'peace'],
          light: +6, marks: {}, pressure: -8,
          chronicle: '他们一直待在上面。地面上没有留下任何属于他们的东西，连一点痕迹也没有。' },
        { key: 'abandondown', label: '彻底离地', blurb: '不再回来',
          lean: ['seek', 'war'],
          light: +12, marks: { rise: 2 }, pressure: +8,
          chronicle: '他们不再回到地面。所有的事都在半空里做完，地面成了只用来望的地方。' }
      ]
    },

    /* ═══════════════════════════════════════════════════════════════
       ★★ 性格专属：他们**怎么运转** ══
       ═══════════════════════════════════════════════════════════════
       八个性格各一个（`fits` 按 world.civ.temper 硬筛）。

       ★ 写法上有一条讲究：**这个事件要"顶"着这个性格来**。
         不是让和平型碰上一件和平的事（那没戏看），
         而是让和平型**撞上它最不擅长的那种局面** ——
         「一直用商量办法的，这一次商量不通」。
         这样这一屏才有东西可读，也才看得出性格是怎么起作用的。

       ⚠️ 主语一律 `{folk}`（性格是跨物种的，八个物种都可能有）。 */
    {
      key: 'wantfight', temper: 'peace', era: 3,
      title: '有人主张动手',
      question: '{folk}一直用商量的办法。这一次谈了很久，两边都没有松口。',
      options: [
        { key: 'keepcalm', label: '继续商量', blurb: '再谈一轮',
          lean: ['peace', 'faith'],
          light: +10, marks: {}, slow: +10,
          chronicle: '他们又谈了一轮。这次谈成了，可是花掉的时间是往常的四倍。' },
        { key: 'givin', label: '让步', blurb: '按对方的来',
          lean: ['hermit', 'peace'],
          light: +4, marks: {}, pressure: -8,
          chronicle: '他们让了步。此后同样的事又发生了三次，每一次都是他们让。' },
        { key: 'useforce', label: '动手', blurb: '这一次不商量了',
          lean: ['war', 'craft'],
          light: -16, marks: { fall: 1, split: 1 }, pressure: +8,
          chronicle: '他们动了手。往后商量的办法用得比原来少，动手的时候多了。' }
      ]
    },
    {
      key: 'stalemate', temper: 'war', era: 3,
      title: '一直没打下来',
      question: '{folk}围了一处地方很久。里面的没有出来，外面的没有进去。',
      options: [
        { key: 'keepseige', label: '继续围', blurb: '等里面撑不住',
          lean: ['war', 'faith'],
          light: -10, marks: { fall: 1 }, pressure: +12, slow: +10,
          chronicle: '围着的一直没有撤。里面撑了很久，最后是里面先没有东西了。' },
        { key: 'withdraw', label: '撤回来', blurb: '这次算了',
          lean: ['peace', 'hermit'],
          light: +8, marks: {}, pressure: -10,
          chronicle: '他们撤了回来。此后每一次出动，都比上一次更谨慎。' },
        { key: 'talkit', label: '谈一谈', blurb: '给他们一条路',
          lean: ['trade', 'peace'],
          light: +12, marks: {}, slow: +8,
          chronicle: '两边谈了一次。里面的出来之后，成了{folk}的一部分。' }
      ]
    },
    {
      key: 'unanswerable', temper: 'seek', era: 3,
      title: '答不上来',
      question: '{folk}里有谁问了一个问题。问了很久，谁也答不上来。',
      options: [
        { key: 'keepask', label: '继续问', blurb: '不放下',
          lean: ['seek', 'faith'],
          light: +12, marks: { rise: 1 }, slow: +10,
          chronicle: '{folk}一直在问那个问题。记录里它出现了几百次，一次也没有答案。' },
        { key: 'putaside', label: '先放着', blurb: '做别的去',
          lean: ['craft', 'trade'],
          light: +2, marks: {}, pressure: -8,
          chronicle: '{folk}把问题放到了一边。此后没有人再提起它。' },
        { key: 'forbidask', label: '不许再问', blurb: '到此为止',
          lean: ['war', 'faith'],
          light: -16, marks: { split: 2 }, pressure: +10,
          chronicle: '{folk}禁了那个问题。谁再问起，都有人记下来。' }
      ]
    },
    {
      key: 'noanswer', temper: 'faith', era: 3,
      title: '一直没有回应',
      question: '{folk}照着规矩做完了该做的。回应一直没有来。',
      options: [
        { key: 'keepfaith', label: '继续做', blurb: '来不来不由自己定',
          lean: ['faith'],
          light: +14, marks: {}, pressure: -8,
          chronicle: '规矩一直照着做。回应始终没有来，{folk}也没有停。' },
        { key: 'changeway', label: '换一种做法', blurb: '也许哪里错了',
          lean: ['seek', 'craft'],
          light: +6, marks: {}, slow: +8,
          chronicle: '做法换了几次。后来的规矩和最初那份已经对不上了。' },
        { key: 'dropfaith', label: '不再做', blurb: '不指望了',
          lean: ['hermit', 'trade'],
          light: -10, marks: { fall: 2 }, pressure: -6,
          chronicle: '该做的不再做了。往后记录里和这件事有关的行越来越少。' }
      ]
    },
    {
      key: 'foundus', temper: 'hermit', era: 3,
      title: '有外面的找到了{folk}',
      question: '有外面的找到了{folk}。那些没有恶意，只是一直看着。',
      options: [
        { key: 'hideaway', label: '搬到更里面', blurb: '躲开',
          lean: ['hermit', 'war'],
          light: -6, marks: {}, pressure: -8,
          chronicle: '他们搬到了更深的地方。外面的人又找了几次，都没有找到。' },
        { key: 'tradethem', label: '换完就散', blurb: '只换东西',
          lean: ['trade', 'peace'],
          light: +10, marks: {}, slow: +8,
          chronicle: '两边换了几次东西。{folk}多了一些不是自己做的。' },
        { key: 'jointhem', label: '跟他们走', blurb: '不再躲了',
          lean: ['nomad', 'seek'],
          light: +12, marks: { rise: 1 }, pressure: -4,
          chronicle: '他们跟着走了。原来的住处空了下来，一直没有人回去。' }
      ]
    },
    {
      key: 'stophere', temper: 'nomad', era: 2,
      title: '有一处待久了',
      question: '{folk}在一个地方待的时间比通常长。那里有水，也有能取的东西。',
      options: [
        { key: 'moveon', label: '照常搬走', blurb: '不破例',
          lean: ['nomad', 'faith'],
          light: +6, marks: {}, pressure: -8,
          chronicle: '他们照常搬走了。那个地方，后来一次也没有再提过。' },
        { key: 'stayone', label: '再待一阵', blurb: '就这一次',
          lean: ['peace', 'craft'],
          light: +8, marks: {}, slow: +10,
          chronicle: '他们多待了一阵。此后每到一个地方，待的时间都比原来长。' },
        { key: 'buildhere', label: '在这里建', blurb: '不走了',
          lean: ['craft', 'trade'],
          light: +12, marks: { rise: 1 }, slow: +12,
          chronicle: '他们在这里建了起来。这是{folk}头一回有固定的住处。' }
      ]
    },
    {
      key: 'baddeal', temper: 'trade', era: 3,
      title: '这笔买卖不划算',
      question: '{folk}一直在做的一笔买卖，现在换回来的东西比以前少了。',
      options: [
        { key: 'findother', label: '找个新买主', blurb: '不吊在一处',
          lean: ['trade', 'seek'],
          light: +10, marks: { rise: 1 }, slow: +8,
          chronicle: '他们找了别处。做买卖的对象多了一倍。' },
        { key: 'reprice', label: '重新定价', blurb: '照着现在的来',
          lean: ['trade', 'craft'],
          light: -4, marks: {}, pressure: +6,
          chronicle: '{folk}把价钱重新定了。东西贵了，来买的人也少了。' },
        { key: 'stopdeal', label: '不做了', blurb: '回到自己做的',
          lean: ['hermit', 'faith'],
          light: +6, marks: {}, pressure: -10,
          chronicle: '那笔买卖停了。此后{folk}用的东西多半是自己做的。' }
      ]
    },
    {
      key: 'notgood', temper: 'craft', era: 3,
      title: '做得不够好',
      question: '{folk}做出来的一批东西里，有一部分比其余差。做的人知道差在哪里。',
      options: [
        { key: 'fixall', label: '全部重做', blurb: '不留一件差的',
          lean: ['craft', 'faith'],
          light: +10, marks: { rise: 1 }, slow: +12,
          chronicle: '{folk}把差的那一批全部回炉。往后的东西里没有一件是凑合的。' },
        { key: 'selloff', label: '便宜卖', blurb: '不浪费',
          lean: ['trade', 'peace'],
          light: +4, marks: {}, pressure: -6,
          chronicle: '{folk}把差一点的便宜处理了。东西分成了两种价钱。' },
        { key: 'teachthem', label: '把人教会', blurb: '差是因为不会',
          lean: ['craft', 'peace'],
          light: +12, marks: {}, slow: +10,
          chronicle: '{folk}把做的人教会了。东西的差别越来越小，最后分不出来。' }
      ]
    }
  ];

  /* ═══════════════════════════════════════════════════════════════
     ★★ 2026-09-13：大事件 —— 观察者出手 ══
     ═══════════════════════════════════════════════════════════════

     ── 三种事件的分工（用户定的）──

       微事件   每 3~5 秒滚过   不改任何数值        谁都不决定
       小事件   每 10~15 秒     文明按本性自动反应   ★ **生灵**决定
       大事件   每 30~60 秒     暂停，玩家选         ★ **观察者**决定

     ── 界线不是"大 vs 小"，是**"谁的世界"** ──

       小事件是**文明自己的事**（瘟疫、分裂、资源）——
         那是生灵的决定，玩家只看着（见 2026-09-13 那次改动）。
       大事件是**观察者的事** —— 选项全是"**你**做什么"，
         不是"他们做什么"。

       所以大事件和**两道岔路口**是同一类东西（观察者层面的干预），
       而小事件才是生灵自己的。这个界线不能混。

     ── 为什么单独盖一层，而不是把小事件改大 ──

       因为"谁决定"不一样。混在一起的话，玩家分不清
       "这次是我在出手"还是"这是他们自己的选择" ——
       而那个区分正是这一整套设计的支点。

     ── 数据结构 ──
     和小事件**完全一样**（title / question / options[...]），
     只是选项里写的都是观察者的动作。
     刻意用同一个形状 —— 这样 CivEvents.apply 一行都不用改。

     ⚠️ 大事件**必须标 era: 4**（观测）——
        观察者出手只发生在最后一个纪元。散在前三纪的话，
        "他们刚学会用火，你就降下启示"是说不通的。
     ═══════════════════════════════════════════════════════════════ */
  var BIG_EVENTS = [

    /* ═══════════════════════════════════════════════════════════════
       ★★ ①`lookup`「{folk}开始仰望」—— **2026-09-22 删除**（用户拍板：甲）★★
       ═══════════════════════════════════════════════════════════════

       ── 为什么删：它和 ⑧`seent`「{folk}朝一个方向发信号」是同一个故事拍子 ──
       用户的原话：「1 跟这个是不是完全一样的事件？」

         · 两条都在讲"这个文明察觉到了观察者"
         · 两条的**前两个选项几乎是同一个决定**
             （① 降下启示 / 保持沉默  ↔  ⑧ 现身 / 藏起来）
         · 两条走**同一对结局**（被观测 / 抵达）

       ── 保留 ⑧ 的理由 ──
       ⑧ 的语义更完整：那里他们**已经认定了**"那个方向有东西，
       而且一直在看着他们"，所以「你要不要露面」才立得住。
       ① 只是"第一次抬起头"，玩家还读不出你在那儿。

       ── 一起清掉的孤儿数据（**删了本体就必须删这些，不然会烂在那儿**）──
         · `OPTION_AXIS` 的三行 `lookup.*`
         · `OPTION_ATTR` 的三行 `lookup.*`
       ⚠️ 这两个表的断言都是**正向**的（遍历选项 → 查表），
          所以孤儿条目**不会让测试变红** —— 正因为不报错，才容易漏。

       ── ⚠️ 代价（用户已知道并接受）──
       大事件池从 10 条变 9 条。而"一局一条大事件都没有"的局
       本来就有 **39%**，删一条只会更糟。这件事单独记着 ——
       见 `_civEvents_test.js` 末尾那条防空转断言的逐条计数。

       ── 历史：为什么它当年叫 `lookup` 不叫 `skyward`（留着免得有人改回去）──
       `skyward` 已经被**通用小事件**占了（「文明仰望星空」）。
       两边的 key 一撞，`byKey` 先搜到小事件那个，于是
       **大事件显示的是小事件的内容** —— 而且不报错，只是全串了。
       （2026-09-13 实测踩到。） */

    /* ── ② 他们要离开 ──
       观察者拦不拦。

       ★★ 2026-09-21：加了**属性门槛**（大事件里第二条有门槛的）★★

       ── 门槛为什么是"科学 + 工业"两个 ──
       这一屏断言的是「**造出了能离开地表的东西**」——
       光看科技只说得出"推演得出航天公式"，说不出"**造得出来**"。
       科技够而生产不够的世界，公式写在纸上，东西停在图纸上。

       ⚠️ 所以 `atLeast` 是**一组下限、全部满足**（AND），不是 OR：
              `{ sci: 2, prod: 2 }` = 科技够 **且** 工业够

       ★★ 2026-09-22：科技门槛 **3 → 2**（用户拍板）★★
       原值 sci≥3 实测只让 **32%** 的世界过，② 的出现率掉到 **4.70%** ——
       和 ⑦ 的 4.25% 挤在一起，两条都那么稀，一局碰上哪条都算中奖。

             门槛              过门槛     ②出现    平均大事件
             sci3 prod2        32.2%     4.70%     1.17
           ★ sci2 prod2        50.1%     8.30%     1.20   ← 选的这个
             sci2 prod1        57.2%     9.10%     1.21
             sci1 prod1        76.7%    11.10%     1.23
             （不加门槛）        100%    13.08%     1.42

       ⚠️ 为什么**不跟着把 prod 也降下去**：
          `prod ≥ 1` 是 **95%** 的世界都过的 —— 降了等于**工业那一半没门槛**，
          退回成"只看科技"，正是这一条要避免的。
          `prod ≥ 2` 排掉 17% 的世界，筛选还在起作用。

       ⚠️ 门槛放宽还有**第二个好处**：抽到却过不了、白白空掉的那一格变少
          （平均大事件 1.17 → 1.20；不加门槛是 1.42）。
          所以这是"稀有度"和"名额空掉"两个问题一起改善。

       ⚠️ 只写 `sci` 会犯和 ⑦ 第一版同一个毛病：
          **门槛卡的东西，和这一屏说的东西，不是同一件事。**
          ⑦ 那次的完整教训见 `gateAttrsOK` 的说明。

       ⚠️ 门槛在**触发那一刻**判，不在排期时判 —— 理由同 ⑦
          （出生四属性只由物种+性格决定，拿它判会把大半物种挡死）。 */
    {
      key: 'depart',
      era: 4,
      gate: { atLeast: { sci: 2, prod: 2 } },
      title: '{folk}要离开',
      question: '{folk}造出了能离开地表的东西。第一批上去了，再没有消息。',
      options: [
        {
          key: 'release',
          label: '放行',
          blurb: '不拦，也不送',
          light: +14, marks: { rise: 2 },
          chronicle: '{folk}里有一部分不在地面上了。地面的记录里，从此不再提到他们。'
        },
        {
          key: 'hold',
          label: '拦下',
          blurb: '把这件事停在这里',
          light: -10, marks: {}, pressure: +6,
          chronicle: '上升停止了。后来没有人再提这件事。'
        },
        /* ⚠️ 2026-09-21 修**主语错位**：
           选项是**观察者**的动作（留下记号），原来那行却写成
           「{folk}在出发的地方留下了一个记号」—— 读起来是**他们**留的，
           观察者做的事被记成了他们做的事。
           ⚠️ 全项目铁律：大事件的选项一律是"观察者做什么"
              （见 ⑪ 上面 `manual` 那段）。
           修法和 ⑤`unask` 一致：**只写状态变化，不写谁做的**。 */
        {
          key: 'mark',
          label: '留下记号',
          blurb: '在出发的地方留一个记号',
          light: +8, marks: { watched: 1 }, slow: +8,
          chronicle: '出发的地方多了一个记号。往后经过的人会看到它。'
        }
      ]
    },

    /* ═══════════════════════════════════════════════════════════════
       ★★ 2026-09-13 扩池：大事件 2 → 10 ══
       ═══════════════════════════════════════════════════════════════

       ⚠️ 扩之前**每局固定就是那 2 个**（lookup / depart）——
          一局 1~2 次大事件，玩的第二局就认出是同一件了。

       ★★ 写大事件的三条规矩 ★★

       ① **选项一律是"观察者做什么"**，不是"他们做什么"。
          小事件才是"他们的决定"（生灵自己挑）。
          写成"让他们 X"就破功了 —— 那一屏会变成玩家在指挥文明。
          ✅ 降下启示 / 保持沉默 / 抹去这段 / 放行 / 拦下
          ❌ 让他们打仗 / 教他们用火

       ② **era 一律是 4**（观测）。观察者出手只发生在最后一个纪元 ——
          "他们刚学会用火，你就降下启示"是说不通的。

       ③ **三个选项里至少要有一个"不干预"**。
          玩家扮演的是观察者，出手应该是**有分量的一次**，
          不是每回都被逼着动手。

       ⚠️ key 不许和别处重名（`byKey` 先搜小事件）——
          见 `_civEvents_test.js` 里那条扫重名的断言。 */
    {
      /* ⚠️ 2026-09-21：文案三处修（判据同 ⑦`lastbatch`：**反读测试**）

           ① question 的「停止了一切活动」是抽象陈述，玩家脑补不出来 →
              拆成三个具体动作，并用「不再记录」收尾 ——
              这整个游戏就是一份记录，**一个不再记录的文明**一眼就懂。
           ② blurb 补上"谁在做"：「推一把」「也许他们会自己动」都读不出
              是观察者的动作，玩家会当成"剧情往哪走"。
           ③ ★ chronicle 原来写「观测到此为止」—— **这是假的**。
              选项当时只吃 light / marks / pressure / slow 四个字段，
              **没有任何"结束这一局"的开关**（见 apply 的①~⑤段），
              玩家点完这行字，下一秒编年史**继续往下滚**。
              改写成"状态"（不再被看）而不是"结束"（到此为止）。
              ⚠️ 2026-09-22 晚起多了**第五个**字段 `lockFate`，
                 而它**会**当场结束这一局 —— 上面这段是历史，别当成现状。

         ★★ 【合上这一页】现在**锁死静滞 + 当场收尾**（09-21 / 09-22 拍板）★★

           加 `lockFate: 'stillness'` → `world.lockedFate` → `ending.js` 的 `fate()`
           在 **1.7 档**（仅次于破碎 / 收割）提前 return `FATES.stillness`。
           ⚠️ 2026-09-22 晚之前它在"仰止之后、四属性层之前"，那天提到了 1.7 档 ——
              用户原话：「本来锁结局了，就不应该再进别的结局了」。

           ⚠️ 为什么是静滞：**那个结局的原文就是这一屏的标题。**
              `FATES.stillness.desc` = 「文明在某个水平上停住了。
              再没有新的条目，记录一直写到观测结束」——
              「文明在某个水平上停住了」↔ 标题「{folk}停下来了」，
              「记录一直写到观测结束」↔ 新 chronicle「此界还在」。
              **这条改动不是"配上去的"，是两个本来就是一句话的东西接上了。**

           ⚠️⚠️ 2026-09-22 晚：下面这一段**被推翻了**，留着当墓碑 ⚠️⚠️
              原文：「不新增"立刻跳到结局画面"的机制 —— 静滞的 desc 自己说了
              『记录一直写到观测结束』，所以这一局**照常跑完**，只是结局已经定了。
              跑完的路径是现成的（和 ⑪ 的 `invaded` 同构）。」

              **那条理由现在不成立**：用户要的是"锁了就不该再进别的结局"，
              而"照常跑完"的实际结果是——锁完之后又跳了几个大事件、
              过了一会才跳结局，那正是他报上来的现象。
              ⇒ 现在锁了就**当场收尾**（`evolution.js` 的 `LOCK_OMEN_SEC`，
                 预兆 5 秒，连历史行都不再往下写），路径确实和 `invaded` 同构，
                 只是方向反了过来：从"跑完再报"变成"当场就报"。
              ⚠️ 代价：静滞 desc 那半句「记录一直写到观测结束」和"锁"这一支
                 对不上了 —— **已知待办，还没改**。 */

      /* ── ★★ 2026-09-22：加门槛（用户拍板）—— 全项目唯一"加起来"的一个 ★★ ──

         ── 为什么判的是"三样加起来" ──
         用户原话：「如果在第三纪元之前，文化、科技和工业加起来低于一个数值，
         就出现这个选项」。这一屏说的是一个文明**没发展起来，于是停在原地**——
         判据是「科技 + 工业 + 文化」的**总和**，不是"每一样都低"。
         差别是真的：「科技 6 / 工业 0 / 文化 0」的偏科文明加总才 6，
         但科技那一项很高 —— 用"每样都低"会把它挡在门外，
         而它恰恰正是"停下来了"的那种文明。
         ⇒ 为此给门槛加了第三个形状 `atMostSum`，见 `gateAttrsOK`。

         ── 为什么是 6 ──
         实测（1620 局随机玩法，取**第一次大事件触发那一刻**的值）：
             三样加总：中位数 10.7 · 后 5% 不到 5.7 · 后 10% 不到 6.7
         ⇒ 「不到 6」= **全场后 7% 的落后文明**，是真的没发展起来。
            够格率 6.8%，和 ⑥`elsewhere`（6.53%）、⑩`handover`（7.07%）
            一个水平（加门槛前它的出现率是 18.0%，全项目第一）。

         ⚠️ 用户为什么从 7 收到 6（原话）：「只有属性太低了才会触发
            加属性或者直接不发展的结局」—— 这一条选了【唤醒他们】要
            **白送三样各 +1**，选【合上这一页】直接锁死静滞。
            门槛太松的话，一个明明发展得还可以的文明也会碰上，
            那两手的份量就配不上了。**送东西 / 定生死的那一屏，门槛要紧。**
         ⚠️ 6.8% 是**够格率**，不是最终出现率 —— 够格了还要在抽签里
            被抽中，两个数相乘才是落地率。

         ── ⚠️ 副作用（用户知情）──
         这一条**没有性格开关**，所以 `gateOf` 照样放它进抽签池；
         抽中之后到点才发现属性不够 → **那个位置就空着**。
         也就是说：加这个门槛会让「一局一条大事件都没有」的局**变多**。
         治法是"把抽签挪到触发那一刻"，那是下一步的事。 */
      key: 'stopped', era: 4,
      gate: { atMostSum: { keys: ['sci', 'prod', 'cul'], max: 6 } },
      title: '{folk}停下来了',
      question: '{folk}全部停住了。不再建造，不再迁徙，不再记录。他们没有死，也没有减少，只是所有的事都停在了同一处。',
      options: [
        { key: 'wake', label: '唤醒他们', blurb: '出手推他们一把，让他们重新动起来',
          light: +12, marks: { watched: 1 }, pressure: +6,
          chronicle: '有一处动了一下。接着是第二处。他们重新开始做事，做的和以前不一样。' },
        { key: 'waitsee', label: '再等等', blurb: '不出手，等他们自己动',
          light: +4, marks: {}, pressure: -8,
          chronicle: '他们一直没有动。往后的记录隔得越来越开，一行比一行短。' },
        { key: 'closebook', label: '合上这一页', blurb: '移开视线，不再看此界',
          light: -14, marks: { fall: 2 }, pressure: +10, lockFate: 'stillness',
          chronicle: '这一页合上了。此界还在，只是不再被看。' }
      ]
    },
    {
      /* ── ④ 他们重复了 ──

         ★★ 2026-09-22：加了门槛 —— **而且是全项目唯一的反向门槛** ★★

         ── 为什么是反的 ──
         这一屏断言的是「**做的事和很久以前一模一样**」，那是一种**停滞**。
         一个正在快速变化的繁荣世界说"一模一样"是打架的。
         而"停滞"在四个属性上的表现是**文化低**（没有新想法 → 只能重复），
         所以门槛写成 **`atMost`（至多）**，不是 `atLeast`。

         ⚠️ `atMost: { cul: 2 }` —— 文化排在后三分之一（中位是 2.84）。
            和 ⑧ 的 `cul ≥ 4`（前三分之一）正好是一对**镜像**。

         ⚠️ 定义域的地雷：`atMost` 写错了会把事件卡成**永远出不来**
            （比如误写成 `{ cul: -1 }`）。防空转那条断言就是守这个的 ——
            `_civEvents_test.js` 末尾那条"十条都必须真的出得来"。

         ⚠️ 门槛在**触发那一刻**判，理由同其他几条。 */
      key: 'mirror', era: 4,
      gate: { atMost: { cul: 2 } },
      title: '{folk}重复了',
      /* ⚠️ 2026-09-22 文案修（判据同 ⑦：**反读测试**）

           ① question 的「和**很久以前**一模一样」——
              「很久」是模糊形容词，而这条规范要求**用具体代替模糊**。
              改成「和他们**最早做过**的一模一样」：不用编数字，但有了锚点。
           ② 【看着】的结果行「**同样的这一遍**，后来重复了四次」——
              「这一遍重复了四次」是什么意思？绕。改成"记录"当主语就顺了。
           ③ 【删掉旧记录】的结果行修**主语错位**（观察者删的，
              却写成「{folk}把旧的那一段删掉了」）。修法同 ①`erase`。 */
      question: '记录里，{folk}现在做的事，和他们最早做过的一模一样。连顺序都一样。',
      options: [
        { key: 'hint', label: '留一样东西', blurb: '放一样他们没见过的东西',
          light: +10, marks: { watched: 2 }, slow: +8,
          chronicle: '有一批东西出现在了他们没去过的地方。后来的做法和前面接不上了。' },
        { key: 'justwatch', label: '看着', blurb: '不插手，只看着',
          light: +2, marks: {}, pressure: -6,
          chronicle: '他们又重复了一遍。往后同样的记录，又出现了四次。' },
        { key: 'eraseold', label: '删掉旧记录', blurb: '把旧的那一段删掉',
          light: -12, marks: { split: 1 }, pressure: +8,
          chronicle: '旧的那一段没有了。此后他们做的事接不上前面。' }
      ]
    },
    {
      /* ── ⑤ 他们问自己是什么 ──

         ★★ 2026-09-22：加门槛（用户拍板）—— **一把"区间"门槛** ★★

         ── 为什么是"文化≥2 且 科技≤1" ──
         这一屏说的是「{folk}里**第一次有人问**：我们是什么」——自省的开端。
            · 问得出来  → 得**有想法的人**     = **文化**
            · 答不出来  → 得**没本事往外看**   = **科技**
         所以是一条**区间**：`atLeast` 给下限、`atMost` 给上限，两个一起写
         （`gateAttrsOK` 支持同时写，见那里的说明）。

         ── 为什么它必须卡在"科技低"这一头 ──
         ⚠️ 只写 `文化≥3` 的话够格率 **48.8%**，等于没门槛 ——
            实测它加门槛前的出现率是 19.6%，**全项目第一**。
         而 ⑧`seent`（朝一个方向发信号）要的是 **科技≥2 且 文化≥4**。
         卡住科技这一头之后，两条自己连成一条线：

             文化先长起来  →  ⑤「我们是什么」      （想问，但没能力往外看）
             科技跟上来    →  ⑧「朝一个方向发信号」  （有能力了，开始往外喊）

         ── 为什么界是 2 / 1 ──
         实测（1140 局随机玩法，取**第一次大事件触发那一刻**）：
             文化 中位数 2.81（25% 不到 1.69）
             科技 中位数 3   （25% 只有 2，10% 只有 1）
         ⇒ 「文化≥2 且 科技≤1」够格率 **7.4%**，和 ③（6.8%）、
           ⑥（6.53%）、⑩（7.07%）一个水平。
         ⚠️ 7.4% 是**够格率**，不是最终出现率。 */
      key: 'whatare', era: 4,
      gate: { atLeast: { cul: 2 }, atMost: { sci: 1 } },
      title: '{folk}问自己是什么',
      question: '{folk}里第一次有人问：我们是什么。从前没有人问过这句话。',
      options: [
        /* ⚠️ 2026-09-22 修文案（判据同 ⑦：**反读测试**）
           ① 的 blurb 原来是「让他们知道」—— **知道什么？**
              全 11 条里最含糊的一句。补上"知道什么"。
           ② 另两条补上"谁在做"（原来是「让他们自己找」「抹掉它」，
              读不出是观察者的动作）。 */
        { key: 'reply', label: '回答他们', blurb: '给出回应，告诉他们有人在看',
          light: +14, marks: { watched: 2 }, pressure: +4,
          chronicle: '有一处给了回应。从那以后，他们的问题变多了。' },
        { key: 'stayquiet', label: '不回答', blurb: '不回应，让他们自己找',
          light: +4, marks: {}, pressure: -8,
          chronicle: '没有回答。那个问题一直被问着，问了十几代。' },
        { key: 'unask', label: '让问题消失', blurb: '把这个问题抹掉',
          light: -16, marks: { fall: 1 }, pressure: +10,
          chronicle: '那个问题不再出现。再没有人问过同样的话。' }
      ]
    },
    {
      /* ── ⑥ 他们推出了别处 ──

         ★★ 2026-09-22：加了属性门槛 ★★

         ── 门槛为什么是"文化 + 科技"两个 ──
         这一屏说的是「**把记录翻了上百遍，算出一件事**」——
            · 「把记录翻了上百遍」→ 得有**记录**可翻 = **文化**
            · 「算出一件事」        → 得**推演得出来** = **科技**
         两件事缺一不可：没有记录就无从翻起，没有推演就只是"猜"。

         ⚠️ 门槛在**触发那一刻**判，不在排期时判（理由同 ⑦ / ② / ⑧）。 */
      key: 'elsewhere', era: 4,
      gate: { atLeast: { sci: 2, cul: 3 } },
      /* ⚠️ 2026-09-22 改标题：原来叫「{folk}推出了别处」——
         **「推出」第一眼会读成"推出去"**（把东西推走），不是"推算出"。
         改成「算出了别处有同类」，把动作和结果都写明白。

         ⚠️⚠️ 同日第二次改：**「别处」必须写成「界外」**（用户拍板）⚠️⚠️

            ── 为什么非改不可 ──
            「别的地方」在中文里**默认读成"这颗星球上的另一块地方"**，
            于是整屏被读成"找到了同星球上的另一群同类"。
            但这一条推的倾向是 `rise`，而 `rise` 兑现的是**「飞升」**：
            「文明突破了此界的限制，**离开这颗星球**」——
            同星球上找到同类，推不出"离开这颗星球"。

            ── 改完之后它和 ⑪ 接上了 ──
            ⑪`outsider` 的标题就是**「界外之物」**，而且用户对它的原话是
            「如果**外星人**选择入侵……」。也就是说：
                ⑥ 他们**算出来**界外有同类
                ⑪ 那些同类**真的来了**
            ⚠️ 两条是一条线上的前后两拍，共用「界外」这一个词。
               以后改 ⑥ 要连着 ⑪ 一起想。

         ⚠️ 三个选项里只有【确认它】的结果行跟着改（「那边」→「界外」），
            另外两句不动 —— 它们说的是"推算"本身，本来就不带方向。 */
      title: '{folk}算出了界外有同类',
      question: '{folk}把记录翻了上百遍，算出一件事：这颗星球之外，应该也有和他们一样的。',
      options: [
        { key: 'confirm', label: '确认它', blurb: '让他们算对',
          light: +12, marks: { rise: 1, watched: 1 }, slow: +8,
          chronicle: '界外回了一次。往后每一座城都在朝那个方向建，越建越高。' },
        { key: 'miscalc', label: '让他们算错', blurb: '偷偷改掉一个数',
          light: -10, marks: { fall: 1 }, pressure: +6,
          chronicle: '那一段推算里少了一个数。此后再没有算出同样的结果，翻来覆去总是差一点。' },
        { key: 'leaveit', label: '什么都不做', blurb: '由它去',
          light: +4, marks: {}, pressure: -6,
          chronicle: '那条推算一直停在纸上。没有一件事因为它而改。' }
      ]
    },
    {
      /* ⚠️⚠️ 这一屏改过**两次**，第一次没改对。两次都记着 ⚠️⚠️

         ══ 第一次（2026-09-21）：把"灭绝"写成了"飞走" ══
         用户把【让他们走完】读成了「不拦他们飞走了一批」——
         他读出来的是 ②`depart`（{folk}要离开）那一屏。
         两条会串，根子是**两个词撞了**：
           · blurb 写「不拦」—— 而"拦"的对象正是"走"；
           · 「走完」**没说走完什么**。

         当时的修法（三处）：question 补「不会再有下一代」、
         blurb 的「不拦」→「不出手」、「走完了」→「不在了」。
         ⚠️ 但 blurb 里把「走完」换成了「**走到终点**」，
            理由是"终点只有生命终点一种读法"—— **这个理由错了。**

         ══ 第二次（2026-09-22，用户在原话里骂的就是这次）══
         用户指着改完之后的文案说：

           > 「就是这个让他们走完，你是**物种灭绝**啊怎么能写让他们走完呢？？？
           >   玩家选了让他们走完肯定不明白这是**死完了**的意思」

         ── 为什么上次那招没用 ──
         「**走完**」和「**终点**」是同一个比喻的两半 ——
         走到终点 = 走完一段路。两个词互相加固，
         读出来还是"走"，方向照旧不明。
         ⇒ 「终点」并不是"只有生命终点一种读法"，它和路、旅程
           绑得比和死亡紧得多。

         ── 这次的修法：**连标签一起换，不修比喻、改用结果** ──
           标签：【让他们走完】→【**任其消失**】
                 不带任何动作方向，说的是"没了"这个结果
           说明：「不出手，让这最后一批走到终点」
                 → 「**不出手，让他们就这么没了**」
                 （「没了」是游戏里现成的词，寂灭那条写的就是
                   「文明在灾难中消失」）
         ⚠️ 用「消失」而不是「灭绝」：**「灭绝」这个词全项目
            只在注释里出现过，从没进过给玩家看的文字** ——
            既然玩家读的一直是「消失 / 不在了」，就别在这里换新词。

         ⚠️ 起因是本项目的老毛病：**文案自认为写清楚了，玩家读成另一个意思。**
            判据是下面这条 —— 改完每句都要过一遍：
            **把这句话读成它最容易被误读的那个意思，还读得通吗？**
         ⚠️ 补一条从这次学到的：**比喻要么整套换掉，要么别用。**
            只修比喻的一半（「走完」→「终点」），读者拿到的是
            一个更顺的比喻，不是一个更清楚的事实。 */
      key: 'lastbatch', era: 4,
      title: '{folk}只剩最后一批',
      question: '{folk}造出了一种武器，用过的地方几代都不能住人。现在只剩最后一批，往后不会再有下一代。',

      /* ═══════════════════════════════════════════════════════════════
         ★★ 2026-09-21：门槛 + 性格开关（用户拍板）★★
         ═══════════════════════════════════════════════════════════════

         ── 为什么加 ──
         原来 11 条大事件**一条前置条件都没有**（只有 era: 4），
         ⑦ 会和别的九条一模一样地随机落到任何一个世界上 ——
         包括一个军事垫底、正繁荣的和平世界。
         而它现在锁寂灭（`fall: 3`），一个**随机世界可能被判死**。

         ── 逻辑链（用户的原话）──
             「四个属性值军事高概率触发…先定一个军事值，
               让这个事件只有过了这个门槛才能触发，
               然后好战这个性格超过这个值就必定会触发这个事件，
               和平因为性格原因即使过了这个值也不会触发，
               其他的都是概率触发」

         ★★ 2026-09-22：用户改了后半截，**其他几个性格的加权值整个取消** ★★
             「保持越过门槛好战必须触发，和平不触发的设定，
               其他几个性格取消加权值，门槛设置成军事3 工业1 科技2」

             三条下限有一条不够            → **永不触发**
             三条都够 且 征战             → **必定触发**（直接排进这一局）
             三条都够 且 和平             → **永不触发**（性格原因）
             三条都够 且 其余六种          → **够格**（不再过骰子）

         ⚠️ 为什么把 `odds` 拿掉：那套 0.6 / 0.5 / 0.15 / 0.1 / 0.1 / 0.05 是
            **拍出来的斜坡**，不是量出来的。玩家也推不出"凭什么游牧只有 5%、
            工匠有 50%" —— 而实测里游牧恰恰是**最常够着军事门槛**的那种文明
            （16.6% 的局是游牧，军事起点还是 +2），却给了最低的一档。
            改成"够门槛就够格"之后，规则玩家自己就能推出来。

         ── 门槛 3 是量出来的，不是拍的 ──
         仪器：`node _attr_dist_probe.js 800`（736 局走到文明）。军事终值：

               军事   占比     ≥该值
                 0   16.0%   100.0%      中位 2 · p75 3 · p90 5
                 1   28.8%    84.0%      ← **一半的文明到死都没超过 2**
                 2   19.7%    55.2%
               ★ 3   16.6%    35.5%      ← 定这里：前四分之一
                 4    8.2%    18.9%
                 5    5.2%    10.7%      定 4 太严（把工匠/求知也砍光）
               ≥6    5.6%     5.6%      定 2 等于没门槛（55% 都过）

         叙事上也对得上：**能造出那种武器的，一定是先把自己武装到牙齿的那一类。**

         ⚠️ `生产 ≥ 1` / `科技 ≥ 2` 这两条是用户 2026-09-22 定的，**没有量过**：
            意思是"已经有个工业底子了才谈得上'只剩最后一批'"——
            还在聚落阶段的文明不该碰上这条。
            下面那两个挡掉的格数是事后补量的，留着给下次调门槛当参照。

         ── 换门槛的实际效果（2026-09-22 量，同一批种子各跑 2000 局）──
            口径：1854 局走到文明，2689 / 2692 格；和 `_fate_probe.js` 同一把尺子。

                         够格率     实出率
              旧（军事3 + 骰子）    9.74%     6.85%
              新（三条下限）       10.74%     5.56%

             ⚠️ 两件事方向相反，两个都得知道：
                · **够格**变多了 —— 取消骰子放出 442 格，比新加的两条门槛
                  净挡掉的多 27 格。这是这次改动的本意（规则可预期）。
                · **实出**反而变少了 —— 够格的文明更"发达"（科技 ≥ 2 是硬条件），
                  别的够格事件也跟着变多，而**一格只抽一次签**，⑦ 赢面就小了。
             ⚠️ 所以它仍是 9 条大事件里**最稀**的那条（别的 8.2%~29.0%）。
                真想让它更容易出现，光放门槛没用 —— 得动"抢格子"那一环。
             ⚠️ 门槛的归因（带重叠，一格可能同时差几条）：
                科技不够   848 格 · 和平 791 格 · 军事不够 … · 生产不够 144 格
                旧口径里被性格骰子挡掉的：442 格
         ═══════════════════════════════════════════════════════════════ */
      gate: {
        /* ⚠️ 门槛是**一组下限，全部满足才算过**（AND，不是 OR）——
           2026-09-21 从"单属性"扩成这样，起因是 ②`depart`：
           光看科技只说得出"推演得出航天公式"，说不出"造得出火箭"，
           所以它要 `sci ≥ 3` **且** `prod ≥ 2` 两个一起。 */
        atLeast: { mil: 3, prod: 1, sci: 2 },  // 三条下限，一条不够就进不了候选池
        force: ['war'],      // 过了门槛就**直接排进这一局**，不抽签
        never: ['peace']     // 过了门槛也不触发（性格原因）
        /* ⚠️ 这里**原来有 `odds`**（六种性格各一个概率），2026-09-22 用户
           拍板整个取消 —— 来龙去脉见上面「逻辑链」那一段。
           ⚠️ 别再加回来。`gateOf` 里 `force` / `never` 照旧先判，
              没有 `odds` 时其余性格走 `if (!g.odds) return 'pool'`。 */
      },
      options: [
        { key: 'keep', label: '留住这一批', blurb: '出手，让这最后一批不再减少',
          light: +14, marks: { watched: 1 }, pressure: -10,
          chronicle: '剩下的这一批没有再减少，文明回到了几代前的样子。' },
        /* ★ `fall: 2` → `3`（2026-09-21）——「这一手自己就够」
           「寂灭」的门槛是 3（见 `MARK_MIN` 上面那段），原来给 2 差一张。

           ⚠️ 这不是"调高难度"，是**让这一手兑现它自己的语义** ——
              它写的就是「他们没了」本身，那它就该直接报寂灭。
              和 ⑩`handover` 的 `machine: 2`（门槛也是 2）是同一条成例，
              那边的注释写着：「让重的那个自己就够」。

           ⚠️ 「世界破碎 / 未成形 / 溃散 / 收割」仍然优先 —— `fate()` 里
              这四条排在 `marks.fall` **前面**，这是对的：
              一个被压垮或被从外面取走的世界，报「寂灭」是报错了。 */
        { key: 'letfinish', label: '任其消失', blurb: '不出手，让他们就这么没了',
          light: +6, marks: { fall: 3 }, pressure: -4,
          chronicle: '{folk}的最后一批不在了。他们用过的东西还留在原处。' },
        { key: 'remember', label: '抹除文明', blurb: '把这个文明留下的东西全抹掉',
          light: -16, marks: {}, pressure: +10, lockFate: 'cycle',
          chronicle: '他们留下的东西一处没剩。往后再起来的，又从头开始。' }
      ]
    },
    /* ── ⑧ 他们朝一个方向发信号 ──

       ★★ 2026-09-22：加了门槛 + **定了这一条的语义**（用户拍板）★★

       ── 这一屏到底在讲什么（用户定）──
       **他们发现的是「造物主」** —— 就是正在看他们的你。
       原来这一点**文案里一个字都没说**，只能从四处证据拼出来：
         · 【现身】的结果行「那边有了回应」+【藏起来】的「那边一直是空的」
         · 【换个位置】的结果行「**观察的位置换了**」← 决定性的一句
         · 下游两个结局的原文（被观测「向世界之外发信号」/ 抵达「回应来自记录之外的某处」）
       ⚠️ 拼得出来，但**玩家拼不出来** —— 这是和 ⑦「走完读成飞走」同一族的毛病，
          文案部分待改（见下面的待办）。

       ── 门槛（这一条的语义决定的）──
       既然讲的是"发现造物主"，那门槛就该问"**这个文明想不想得到这件事**"：

         · **信仰**的生灵本来就信 —— **不需要"文化够"**，只要科技够（发得出信号）
         · 其他性格得先有足够的精神底子，才**想得到**"世界之外另有存在"

       所以：
             默认   `sci ≥ 2` **且** `cul ≥ 4`
             信仰   `sci ≥ 2`（`atLeastFor` 豁免文化那一项）
             信仰 + 科技够 → **必定排进这一局**（`force`）

       ── 文化门槛 4 是量出来的（1500 局）──
             门槛   信仰路(必定)  其他七种   合计⑧出现   信仰占比
              ≥2      4.40%      5.41%      9.81%      45%
              ≥3      4.40%      3.93%      8.33%      53%
            ★ ≥4      4.40%      2.57%      6.97%      63%   ← 选的这个
              ≥5      4.40%      1.34%      5.74%      77%
              ≥6      4.40%      0.61%      5.01%      88%

         定 4 的三个理由：
           ① 三条事件拉开距离：⑦武器 3.8% / ⑧信号 6.97% / ②航天 8.3%
           ② 「信仰必触发」有分量：拿到这条的世界里 **63% 是信仰**
              （定 2 的话只占 45%，信仰和其他性格五五开，"必触发"就没意义了）
           ③ 含义正好：文化中位 2.84、p75 4.55（**它会自动增长，天生比其他属性高**）
              → `≥4` = 排在前三分之一 = 「有余力想抽象的问题」

       ⚠️ 门槛在**触发那一刻**判，不在排期时判（理由同 ⑦ / ②）。 */
    {
      key: 'seent', era: 4,
      gate: {
        atLeast:    { sci: 2, cul: 4 },
        atLeastFor: { faith: { sci: 2 } },
        force:      ['faith']
      },
      /* ⚠️⚠️ 2026-09-22 文案修 —— **这条的问题最严重** ⚠️⚠️

         ── 原来为什么读不懂 ──
         question 写的是「有**一处位置**，{folk}反复朝那里发出信号。
         {folk}认定**那里有东西**」—— 「一处位置」是哪？「有东西」是什么？
         玩家**完全不知道这条在讲什么**，也就不知道三个选项在选什么。

         ── 这条真正的意思 ──
           · 【现身】「那边有了回应」+【藏起来】「那边一直是空的」
           · 下游两个结局的原文（被观测「向**世界之外**发信号」/
             抵达「回应来自**记录之外**的某处」）
         ⇒ **那个方向上站着的，就是你。他们不知道。**

         ★★ 用户 2026-09-22 拍板，这一条讲的是「**他们发现了造物主**」★★
            所以 question 必须把这件事说出来 —— 否则三个选项
            （现身 / 藏起来 / 挪个位置）玩家读不出是"你要不要露面"。

         ⚠️ 但**不能写成"他们知道那是造物主"** —— 他们只知道
            "那个方向有东西，而且一直在看着我们"。是**玩家**知道那是谁。 */
      title: '{folk}朝一个方向发信号',
      question: '{folk}反复朝天上同一个方向发出信号。他们认定那个方向有东西，而且一直在看着他们。',
      options: [
        /* ⚠️⚠️ 2026-09-22 改 marks：`watched: 2` → `contact: 2` ⚠️⚠️

           ── 原来错在哪 ──
           这个选项的结果行写的是「那边**有了回应**」= **你回应了他们**。
           但它给的是 `watched: 2`，攒够 2 张 → 结局报「**被观测**」——
           而被观测的原文是「信号**至今没有得到回应**」。

           ⇒ **你回应了他们，结局说你没回应。** 正好反了。

           ── 两个结局本来是一对（`ending.js` 的注释原话）──
               被观测 = 他们朝外面发信号，**没人理**
               抵达   = 同样发了信号，**你回了**
           所以：
               【现身】  （你露面了）    → **抵达**  ⇒ 给 `contact`
               【藏起来】（你躲着）      → 被观测  ⇒ 不给 contact 就行

           ── 为什么新加一个 mark，而不是改判定顺序 ──
           改顺序会让**所有投过光种的世界**都优先走「抵达」——
           那是另一条通路（①`lookup` 的「降下启示」也走它），
           影响面比这一条事件大得多。新 mark 只认"**你在这一屏露过面**"。
           ⚠️ 门槛走默认的 `MARK_THRESHOLD = 2`，和别的倾向一样。
           ⚠️ `rise: 1` 保留不动 —— 门槛是 2，它单独不够用，
              但和 ②`depart`【放行】的 `rise: 2` 叠起来会让那一局走「飞升」，
              那也说得通（和你建立了联系的世界，要么被你接走，要么自己走出去）。 */
        { key: 'appear', label: '现身', blurb: '露面，让他们找到',
          light: +18, marks: { contact: 2, rise: 1 }, pressure: +8,
          chronicle: '那边有了回应。从此{folk}做的一切都朝着那一边。' },
        { key: 'hide', label: '藏起来', blurb: '留在暗处，不让他们找到',
          light: -12, marks: { fall: 1 }, pressure: +6,
          chronicle: '那边一直是空的。他们发了上百次，最后停了下来。' }

        /* ⚠️ 2026-09-22 用户拍板：**删掉原来的第三个选项【换个位置】** ——
           原话「这个选项删掉，跟藏起来重复了，保持这题就二选一」。

           ── 为什么是它 ──
           【藏起来】和【换个位置】的结果行说的是同一件事
           （都没有回应、他们都没找到），只是换了种说法。
           三条里有一条是重复的，等于把玩家的三选一变成二选一**还多给一个干扰项**。

           ⚠️ 它是**唯一**动过 `light` 却不进 marks 的那条（`marks: {}`），
              删掉之后这一屏的两个选项都带着 mark ——
              【现身】contact:2（一手锁「抵达」，所以按规矩不给属性）、
              【藏起来】fall:1。
           ⚠️ 顺带作废了上面那段注释里的「四处证据」——
              原来【换个位置】的「观察的位置换了」是拼出"那个人就是你"的
              决定性一句，现在 question 里已经把话说明白了，不需要它了。 */
      ]
    },
    {
      /* ── ⑨ 他们算出了终点 ──

         ★★ 2026-09-22：加了属性门槛 ★★

         ── 门槛为什么是"科技 + 文化" ──
         这一屏说的是「**从记录里算出了这颗星球还能存在多久**」：
            · 「算出了」   → 天文 + 推演 = **科技**（而且是这几条里最高的那档）
            · 「从记录里」 → 得有**长期记录**可算 = **文化**
         ⚠️ 它是十条里**要求最高**的一条 —— 别的几条只要"造得出 / 想得到"，
            这一条要"**算得准**"（还要把那个数核对一遍又一遍）。

         ⚠️ 门槛在**触发那一刻**判，理由同其他几条。 */
      key: 'ending', era: 4,
      gate: { atLeast: { sci: 3, cul: 3 } },
      /* ⚠️ 2026-09-22 文案修（判据同 ⑦：**反读测试**）

         问题只出在第三个选项：它从头到尾用「**那件事**」指代"星球的终结"，
         而「那件事」在 question 里**根本没有这个名字** ——
         玩家读到「让那件事先来」得回头猜"哪件事"。

         改法：**统一叫「终点」**（标题里就有这个词，一眼对得上）。

         ⚠️ 这一条的 question **一个字没动** ——
            它是全 11 条里写得最好的之一（有数字、有画面、
            「把那个数核对了一遍又一遍」这句把他们的不安全写出来了）。 */
      title: '{folk}算出了终点',
      question: '{folk}从记录里算出了这颗星球还能存在多久。他们把那个数核对了一遍又一遍。',
      options: [
        { key: 'moretime', label: '给他们时间', blurb: '让那个数变大',
          light: +14, marks: { watched: 1 }, slow: +12,
          chronicle: '那个数变大了。往后他们做的事比原来从容。' },
        { key: 'holdline', label: '不改动', blurb: '让那个数就那么写着',
          light: +4, marks: {}, pressure: -6,
          chronicle: '那个数没有变。它一直写在记录最前面。' },
        { key: 'sooner', label: '让终点先来', blurb: '让终点比算出来的早',
          light: -18, marks: { fall: 2 }, pressure: +12,
          chronicle: '终点比他们算出来的早。后面的记录少了一截。' }
      ]
    },

    /* ── ★ 造出了具备判断能力的工具 —— 「遗落」那条结局的**第二个来源** ──
       ⚠️ 第一个来源是人类专属事件的「工具开始造工具 → 让它做」（machine: 1）。
          这一条给 **2** —— 也就是说**它自己就够**（门槛 2），
          而人类那条单独不够。理由：
          这一条写的正是「遗落」本身（他们不再动手了），
          人类那条只是它的前身（会做东西的人一年比一年少）。
       详见 ending.js 的 FATES.machine 和 civEvents.js 的 MARK_MIN。 */
    {
      /* ★★ 2026-09-22：加了属性门槛 ★★

         ── 门槛为什么是"工业 + 科技" ──
         这一屏说的是「**造出了具备判断能力的工具**」——
         「不用照看就能自己做出下一批」这是**自动化**，两件事缺一不可：
            · 得有**工业底子**才造得出那个东西（`prod`）
            · 得有**科学底子**才让它"自己会做下一批"（`sci`）
         ⚠️ 只写 `prod` 会犯 ② 那个毛病：门槛卡的东西和这一屏说的不是一件事。

         ⚠️ 它和 ②`depart` 都是"造出某个大东西"，但**着重的数不一样**：
            ② 是**航天**（科学 + 工业，`sci` 在前），
            ⑩ 是**自动化**（工业在前）——
            所以两条的门槛不同，不会整片世界里只出其中一条。

         ⚠️ 门槛在**触发那一刻**判，理由同 ⑦ / ② / ⑥ / ⑧。 */

      /* ⚠️⚠️ 这一屏的文案改过**两轮**，两轮都是用户点的 ⚠️⚠️

         ── 第一轮（2026-09-14）：太含糊，玩家看不懂 ──
           标题 「替自己的东西」→「替自己**动手**的东西」
           问题 「已经能做完他们所有的活」→「**不用照看**就能自己做出下一批」
           ①   「不再动手」→「**所有工作都交出去**」
         ⚠️ 「工作」这个说法是**用户定的**（原本写的是「活」，他觉得太含糊）。
            当时**四处一起改**：命运 desc / 这一屏 / 选项下的编年史 /
            人类那个种子事件（见 civLore.js 的 selfmake）。

         ── 第二轮（2026-09-22 用户把整屏重抄了一遍）──
           标题 「替自己动手的东西」→「**造出了一些具备判断能力的工具**」
           问题 「造出的**东西**」→「造出的**工具**」
           ⚠️ 根子是同一个：**「东西」太泛** —— 造出来的到底是什么，
              玩家得从"不用照看就能自己做出下一批"倒推。
              直接写「工具」+「具备判断能力」，第一眼就知道在说机器。

           【停掉它们】的 blurb「让工作回到**自己**手上」→「…回到 **{folk}** 手上」
           ⚠️ 「自己」是**代词悬空**：谁的自已？观察者的？工具的？
              chronicle 那句同理（「又回到了手上」→「又回到了 {folk} 手上」）。
           ⚠️ 这是**全项目第一次在 blurb 里用 `{folk}`**（别的 blurb 一个都没用）。
              能用 —— `fillDeep` 是**逐层**替换的，blurb 照样会被填上。

           ⚠️⚠️ 第三项**整条换掉了**：
              旧：继续亲手做 / 关键的仍旧自己来 / 他们仍旧亲手做，那些东西只在旁边看着
              新：给工具加上限制 / 它们造出来的还是工具，不是别的 /
                  文明世界仍旧掌握在{folk}手中，工具只是辅助
              ⚠️ key 跟着从 `stayhand` 改成 `setlimit` —— 这一手不再是
                 "亲手做"，是"给工具划一条线"。键名不改的话，
                 `OPTION_AXIS` / `OPTION_ATTR` 里那个名字会一直指着
                 一个不存在的动作。
              ⚠️ 旧版那句「那些东西只在旁边看着」是上一轮**特意保下来的好句子**，
                 这一轮被整条替换掉了 —— 用户要整条换，好句子也不留。
              ⚠️ 用户给的名字是「给工具加上限制」（**7 个字**），
                 超了选项名 5 字的上限，这里收成【**限制工具**】。 */
      key: 'handover', era: 4,
      gate: { atLeast: { prod: 4, sci: 2 } },
      title: '{folk}造出了一些具备判断能力的工具',
      question: '{folk}造出的工具，不用照看就能自己做出下一批。{folk}的工作，正在一件件交到它们手上。',
      options: [
        { key: 'letgo', label: '放手', blurb: '所有工作都交给它们',
          light: +10, marks: { machine: 2 }, pressure: -6,
          chronicle: '大部分物品不再出自人手，从事生产的人员，一代比一代少。' },
        { key: 'stopmake', label: '停掉它们', blurb: '让工作回到{folk}手上',
          light: -12, marks: { fall: 1 }, pressure: +10,
          chronicle: '那些工具停了下来，所有的工作又回到了{folk}手上。' },
        { key: 'setlimit', label: '限制工具', blurb: '它们造出来的还是工具，不是别的。',
          light: +8, marks: {}, slow: +10,
          chronicle: '文明世界仍旧掌握在{folk}手中，工具只是辅助。' }
      ]
    },

    /* ═══════════════════════════════════════════════════════════════
       ★★ 2026-09-14：界外来访 —— 界外之物那条线的**批 2** ══
       ═══════════════════════════════════════════════════════════════

       用户的原话（那条线的起点）：
         「有一定几率是在文明阶段来会变成入侵或者帮助，
           如果外星人选择入侵可以让观察者选择是否出手帮助驱赶外星人，
           如果观察者选择无视外星人入侵就可以直接导致毁灭结局，
           极小概率抵抗成功」

       ── 它和别的大事件**有三处不一样**，一处都不能漏 ──

       ① **`manual: true` —— 它不进随机池。**
          别的大事件是"每局抽几个"；这一个只在**被界外投放过的世界**
          上才会出现（`world.outsiderSeeded`），由 `beginCiv` 手动排进来。
          ⚠️ 漏了这个标记的话，界外来访会变成"每局都可能随机遇到"——
             而「他们是回来找自己种下的那一支的」这个因果就断了。

       ② **它有一个选项会直接终结这一局**（`invaded`）——
          其余十一个大事件最多改改数值、挪挪命运倾向。

       ③ ~~**它有一个选项的结果不是一定的**（`resist`）~~ ★ **2026-09-15 改了**：
          「无视」之后不再掷骰子，改成看 **军事 + 科技 + 生产** 够不够
          （门槛 `RESIST_NEED`）。~~所以那条"骰子必须在玩家按下的那一刻掷"
          的约束**也随之作废**~~ —— 现在这个判定完全可以重放。

       ⚠️ 「无视」的说明**要把分量讲明，但不剧透概率**（项目原则：不设暗坑）。
          「此界只能靠自己了」说清楚了"你不管了"，没说"它会死"。 */
    {
      key: 'outsider', era: 4, manual: true,
      title: '界外之物',
      question: '有东西从记录之外进来，停在半空。它们没有停下来的意思。',
      options: [
        {
          key: 'driveoff',
          label: '出手驱赶',
          blurb: '把它们挡回去',
          /* ⚠️ 光暗值给正的 —— 这是观察者**出手**了，
             和「降下启示」同一类（见那个选项）。 */
          light: +8, marks: {}, pressure: -8,
          chronicle: '天空里的东西停住，然后退了出去。从此它们没有再来。'
        },
        {
          key: 'ignore',
          label: '无视',
          blurb: '不做任何事。此界只能靠自己了',
          light: -6, pressure: +12,
          /* ★★ 这两个字段只有这一个选项有 ★★
             invaded  —— 没扛过去的话，落下的**世界级标记**
                         （ending.js 的 fate() 读它，见那边的 FATES.harvest）
             ⚠️ 2026-09-15：原来还有一个 `resist: 3`（3% 的抵抗骰），
                **删掉了** —— 现在由 `RESIST_NEED` 和四属性确定性判定，
                一点随机都没有。判据是决策 #61（删掉它行为不变 = 维护成本）。 */
          invaded: true,
          chronicle: '没有回应。天空里的东西开始往下落。',
          /* ⚠️ 扛住了就换这一句 —— 不能写"但"，
             那还是同一件事；这是**另一件事**：它们没得手。 */
          chronicleResist: '没有回应。天空里的东西停了很久，然后离开。此界自己扛了下来。'
        }
      ]
    }
  ];

  /* ═══════════════════════════════════════════════════════════════
     抽签
     ═══════════════════════════════════════════════════════════════ */

  /**
   * 按 key 找事件。
   *
   * ⚠️ 签名改成 (world, key) —— 因为物种专属事件不在这个文件里，
   *    要先从 world.civ.proto 知道是哪个物种，再去 civLore 里找。
   *    （测试里可以不传 world，只查通用池。）
   */
  function byKey(world, key) {
    for (var i = 0; i < EVENTS.length; i++) {
      if (EVENTS[i].key === key) return EVENTS[i];
    }
    // ★ 大事件也在这张表里找 —— apply 要能落到它上面
    for (i = 0; i < BIG_EVENTS.length; i++) {
      if (BIG_EVENTS[i].key === key) return BIG_EVENTS[i];
    }
    var proto = (world && world.civ) ? world.civ.proto : null;
    if (proto) return CivLore.findEvent(proto, key);
    return null;
  }

  function optionOf(event, key) {
    if (!event) return null;
    for (var i = 0; i < event.options.length; i++) {
      if (event.options[i].key === key) return event.options[i];
    }
    return null;
  }

  /**
   * 抽这一局要发生哪几个事件、分别在什么时候。
   *
   * ⚠️ 只依赖传入的 rng —— 由调用方用**世界种子**派生。
   *    所以同一颗世界重玩一遍，遇到的事件和顺序是一样的。
   *
   * @param {function} rng   随机源
   * @param {number} duration 发展期总时长（世界秒）
   * @returns {Array} [{ key, at }]，按时间排好序
   */
  /* ── 节奏（用户给的区间）──
     小事件每 10~15 秒，取中；大事件每 30~60 秒，取中。 */
  var SMALL_INTERVAL = 12;
  var BIG_INTERVAL   = 45;

  /* 一个小事件在编年史上占**几格**（一格 = LINE_DWELL 秒）。
     ⚠️⚠️ 2026-09-17：`var SMALL_SLOTS = 2` 和它的导出**删掉了** ⚠️⚠️
     它是**真死代码** —— 全项目（含测试）零读者，而它注释里说要传给的那个接口
     `CivLore.schedule` / `realCount` **早就不存在了**（质量体检抓出来的）。
     "小事件占几格"这件事现在**只有一个地方说**：
     `core/evolution.js` 的「格子预算」那一段（写着 2 格 = 事件行 + 他们的决定）。
     ⚠️ 删掉它**行为一个字没变** —— 没有任何人在读它。 */

  /**
   * 这件事适不适合这颗世界的文明。
   *
   * ⚠️ 三个字段都是**可选**的：不写 = 谁都可能遇到。
   *    写了的必须**完全相等**才放行（不是加权，是硬筛）。
   *    加权会变成"海类偶尔遇到沙漠的事"，那正是要避免的。
   *
   * @param {object} ctx { proto, form, temper }
   */
  function fits(def, ctx) {
    if (!def) return false;
    if (def.species && def.species !== ctx.proto)  return false;
    if (def.form    && def.form    !== ctx.form)   return false;
    if (def.temper  && def.temper  !== ctx.temper) return false;
    return true;
  }

  /**
   * ★ 门槛里的**属性那一半** —— 在**触发那一刻**判，不在排期时判。
   *
   * ── 为什么必须分成两半判 ──
   *   性格是天生的（从生到死不变）→ 排期时判就够了（见 `gateOf`）。
   *   四个属性都是**会长的发展值** → 出生时判会判错。
   *
   * ⚠️⚠️ 出生四属性只由物种 + 性格决定，而事件推拉一局约只有 1 次，
   *   所以出生值和终值差得很远（军事：出生均值 0.95 → 终值均值 2.17）。
   *
   *   实测（736 局）第一版就是这么错的：门槛在排期时判，
   *   而出生军事最高只有 4、`工匠/求知/商业` 出生最高只有 2、
   *   `信仰/隐世` 最高只有 1 —— 门槛 3 把后五种**永久挡死**，
   *   ⑦ 只落在征战身上，其余七种一次都没碰到。
   *
   * ★ 调用方是 `evolution.js` 的 `stepCiv` 第 ④ 段（大事件到点那一刻）。
   *   ⚠️ 本文件**不依赖 civ.js**（见 `apply` 里 `invaded` 那段的理由），
   *      所以这里收的是**一个属性对象**（`{mil, sci, prod, cul}`），
   *      不是一个 world —— 由调用方走 `Civ.attrOf` 取好传进来。
   *
   * ⚠️ 属性只增不减（所有推它们的选项都是正数），所以
   *    "排期时够、触发时不够"不会发生；反过来会发生 —— 那正是我们要的：
   *    **一个能力一直没长起来的文明，不该造出那种东西。**
   *
   * ★★ 2026-09-22：加了 **`atLeastFor`（性格专属覆盖）** ★★
   *
   *   起因是 ⑧`seent`：它讲的是「他们发现了**造物主**」——
   *      · **信仰**的生灵本来就信，**不需要"文化够"**；
   *      · 其他性格得先有足够的精神底子才**想得到**这件事。
   *   于是"属性门槛按性格分"成了硬需求：
   *
   *        atLeast:    { sci: 2, cul: 4 }     ← 默认（大多数性格）
   *        atLeastFor: { faith: { sci: 2 } }  ← 信仰改用这一组，豁免文化
   *
   *   ⚠️ `atLeastFor` 里**没列到的性格走 `atLeast`**。
   *
   * ★★ 2026-09-22（同日第二次扩充）：加了 **`atMost`（至多）** ★★
   *
   *   起因是 ④`mirror`：「记录里，{folk}做的事和很久以前一模一样」——
   *   它断言的是一种**停滞**，所以门槛是**反的**：文化**低**。
   *   `atLeast` 只表达得出"至少"，表达不出"至多"，所以补了这一个。
   *
   *        atLeast: { sci: 2 }      // 至少（默认门槛）
   *        atMost:  { cul: 3 }      // 至多 —— ④ 用它卡"文化低"
   *
   *   ⚠️ 两者**可以同时写**（= 区间），也可以只写一个。
   *
   * ★★ 2026-09-22（同日第三次扩充）：加了 **`atMostSum`（加起来至多）** ★★
   *
   *   起因是 ③`stopped`（用户拍板）：「文化 + 科技 + 工业 **加起来**低于 7」。
   *
   *   ── 为什么上面那两个表达不出来 ──
   *   两个老形状判的都是「**每一样**够不够」：
   *       atLeast: { sci: 2, prod: 2 }  =  科技≥2 **且** 工业≥2
   *       atMost:  { cul: 2 }           =  文化≤2
   *   而 ③ 要的是「三样**加起来**低」：一个「科技 6 / 工业 0 / 文化 0」的
   *   偏科文明，加总才 6 —— 够低了吧？但用 `atMost` 那种"每样都低"的写法，
   *   科技那一项是 6，直接就被挡在门外了。**两件事不一样，所以单开一种。**
   *
   *       atMostSum: { keys: ['sci','prod','cul'], max: 7 }
   *       // keys 这几样**加起来小于** max 才过 —— 是「低于」，不是「不高于」
   *
   *   ⚠️ 界是**严格小于**（`sum < max`），和用户说的「低于」一致。
   *   ⚠️ `keys` 是数组，不是对象 —— 这个形状只关心"哪几样、上限多少"，
   *      不需要每样一个界。写错了有断言兜（见 `_civEvents_test.js`）。
   *   ⚠️ `keys` 没写 / 是空数组时**放行** —— 和 `odds` 那条规矩同源：
   *      「没写就是不管」。但那是兜底，不是可以偷懒的地方。
   *
   * @param {object} def    事件定义
   * @param {object} attr   当前四属性 `{mil, sci, prod, cul}`
   * @param {string} temper 当前性格（可省 —— 省了就一律走 `atLeast`）
   */
  function gateAttrsOK(def, attr, temper) {
    var g = def && def.gate;
    if (!g) return true;                                       // 没写门槛 = 不设限
    var k;

    var need = (g.atLeastFor && temper && g.atLeastFor[temper]) || g.atLeast;
    if (need) {
      for (k in need) {
        if (((attr && attr[k]) || 0) < need[k]) return false;
      }
    }
    if (g.atMost) {
      for (k in g.atMost) {
        if (((attr && attr[k]) || 0) > g.atMost[k]) return false;
      }
    }
    if (g.atMostSum) {
      var keys = g.atMostSum.keys || [], sum = 0;
      for (var i = 0; i < keys.length; i++) {
        sum += ((attr && attr[keys[i]]) || 0);
      }
      if (!(sum < g.atMostSum.max)) return false;
    }
    return true;
  }

  /**
   * 把抽中的事件排到时间轴上。
   *
   * ── 两条规则 ──
   * ① **每个纪元的窗口里再留一点边** ——
   *    开局立刻弹太突兀（玩家还没看清文明长什么样），
   *    正卡在纪元边界上又和分隔标题挤在一起。
   * ② **标了 era 的，必须落在那个纪元的窗口里** ——
   *    第四纪元（观测）才该出"他们开始仰望"，
   *    前三纪出这个就说不通了。
   *
   * ⚠️⚠️ 2026-09-13：窗口的切法改了 ⚠️⚠️
   *
   * 原来是「切那 70% 的可用区间的四等分」，而**纪元标题**是切整条时间轴。
   * 两把尺子不一样，于是标题和它底下的内容对不上：
   *   旧窗口：纪元 4 = [67.5%, 85%]
   *   标题：  纪元 4 = [75%, 100%]
   *   → 67.5%~75% 之间的事件，印在「第三纪元」标题下面，内容是第四纪元的。
   *
   * 现在两边**都切整条时间轴的四等分**，而且**共用同一个函数**
   * （`CivLore.eraOf`）—— 一把尺子，不存在对不上的可能。
   *
   * ⚠️ 所以下面用 `eraOf` 反推窗口边界，不要在这里重写一份除法。
   */
  function placeByEra(picked, rng, duration) {
    var ERAS  = CivLore.ERA_COUNT || 4;
    var slots = [], i, k;

    /* ⚠️ 每个纪元窗口里再内缩一点（各留 15%）——
       不缩的话事件会正好压在纪元分隔标题上，读起来像"标题下面第一句
       就是那件事"，其实它属于上一纪的尾巴。 */
    var INSET = 0.15;
    function winOf(era) {
      var w0 = (era - 1) / ERAS;
      var w1 = era / ERAS;
      var pad = (w1 - w0) * INSET;
      return [w0 + pad, w1 - pad];
    }

    // 不标纪元的：摊在整条时间轴上（首尾各让出 5%，别贴着开头和结尾）
    var free = [];
    var byEra = {};
    for (i = 0; i < picked.length; i++) {
      var e = picked[i].era;
      if (e >= 1 && e <= ERAS) (byEra[e] = byEra[e] || []).push(picked[i]);
      else free.push(picked[i]);
    }

    var FSTART = 0.05, FSPAN = 0.90;
    for (i = 0; i < free.length; i++) {
      var seg = FSPAN / free.length;
      slots.push({
        key: free[i].key,
        at: duration * (FSTART + seg * (i + 0.5) + (rng() - 0.5) * seg * 0.6)
      });
    }

    for (var era = 1; era <= ERAS; era++) {
      var list = byEra[era] || [];
      if (!list.length) continue;
      var w = winOf(era);
      var step = (w[1] - w[0]) / list.length;
      for (k = 0; k < list.length; k++) {
        slots.push({
          key: list[k].key,
          at: duration * (w[0] + step * (k + 0.5) + (rng() - 0.5) * step * 0.6)
        });
      }
    }

    slots.sort(function (a, b) { return a.at - b.at; });
    return slots;
  }

  /**
   * 到点了：**现场挑一条大事件**。挑不出来就返回 `null`（这一格空着）。
   *
   * ★★ 2026-09-22 新增（用户拍板：**不要抽签，按属性触发**）★★
   *
   * ── 它和 `scheduleBig` 的分工 ──
   *   `scheduleBig` 只管**时间和格数**（排期时属性还是出生值，判不了）
   *   `pickBig`     判**资格**（此刻的属性已经长起来了）
   *
   * ── 资格 = 三件事全过 ──
   *   ① 这一局没出过（`c.bigFired`）
   *   ② 性格那一半过（`gateOf !== 'never'`）
   *   ③ 属性那一半过（`gateAttrsOK`）
   *
   * ── 好几条同时够格怎么办 ──
   *   **掷骰子**。用户原话：「两件事件同时触发，随机骰子决定谁先谁后」。
   *   实测每一格 25% 只有 1 条够格、64% 有 2~4 条够格 ——
   *   所以这一步不是边角情况，是常态。
   *
   *   ⚠️ 骰子**每格一颗、由（种子 + 格号）独立派生**：不消耗 `bigRng`
   *      （那是排期在用的），也不在 world 上挂游标 ——
   *      所以**同种子重玩，每一格挑到谁完全一样**。
   *   ⚠️ 魔数 `0x9E3D71` / `0x27D4EB2D` 别和**别的随机源**撞。
   *
   *      ⚠️⚠️ 这里原来手抄了一张"现有随机源"的单子，**2026-09-22 质检发现它烂了**：
   *          单子里的 `0x5C31A7` 和 `0x7EAD1E` **全项目根本不存在**（只活在注释里），
   *          而真正在跑的好几个又一个都没列。
   *      ⇒ **别再手抄单子** —— 手抄的清单迟早会和代码对不上，而且不报错。
   *         要挑新号，跑这一行，以它为准：
   *
   *             grep -rnoE "0x[0-9A-Fa-f]{5,}" core/ render/ app.js splash.js
   *
   *      ⚠️ 那份输出里混着两个**不是种子**的常数，别被绕进去：
   *          · `0x9E3779B9` —— `elements.js` 的天象随机源（**是种子，照样占号**）
   *          · `0x6D2B79F5` —— `rng.js` 哈希里的加数（**不是种子**，撞了也无所谓）
   *      ⚠️ 撞了**不会报错** —— 只会让两条本来无关的随机流悄悄连在一起，
   *         现象是"某两条序列看起来同步了"，极难查。本项目在随机源上栽过。
   *
   * ── `force` 为什么插队 ──
   *   ⑦`lastbatch` 对**征战**性格、⑧`seent` 对**信仰**性格是"必定触发"
   *   （用户 2026-09-21 定的）。掷骰子会把"必定"掷没，所以让它们插队。
   *   ⚠️ 但它们**照样要过属性门槛** —— 用户原话「好战这个性格**超过这个值**
   *      就必定会触发」里那个"超过这个值"说的就是属性门槛，不是性格。
   *
   * @param {object} c       `world.evo.civ`
   * @param {object} attr    当前四属性（调用方给 —— 这个文件不认识 `Civ`）
   * @param {object} civ     `world.civ`（只取 `temper`）
   * @param {number} seedNum 世界种子号
   * @param {number} slotIdx 第几格（只喂骰子）
   * @returns {object|null}  事件定义，或者 null
   */
  function pickBig(c, attr, civ, seedNum, slotIdx) {
    if (!c.bigFired) c.bigFired = {};
    var temper = (civ && civ.temper) || null;
    var roll   = RNG.makeRng(((seedNum || 0) ^ 0x3E7A11) >>> 0)();   // 和排期同一颗

    var cands = [], forced = [], i, e, v;
    for (i = 0; i < BIG_EVENTS.length; i++) {
      e = BIG_EVENTS[i];
      if (e.manual) continue;                 // 界外之物只由 planVisit 排进来
      if (c.bigFired[e.key]) continue;
      v = gateOf(e, temper, roll);
      if (v === 'never') continue;
      if (!gateAttrsOK(e, attr, temper)) continue;
      cands.push(e);
      if (v === 'force') forced.push(e);
    }
    if (!cands.length) return null;           // 这一格空着，下一格再试
    if (forced.length) return forced[0];      // "必定触发"的插队

    var slotSeed = (((seedNum || 0) ^ 0x9E3D71) + (slotIdx || 0) * 0x27D4EB2D) >>> 0;
    var d = RNG.makeRng(slotSeed)();
    return cands[Math.floor(d * cands.length) % cands.length];
  }


  /**
   * 抽这一局的小事件。
   *
   * ⚠️ 只依赖传入的 rng —— 由调用方用**世界种子**派生。
   *    所以同一颗世界重玩一遍，遇到的事件和顺序是一样的。
   *
   * @param {function} rng
   * @param {number} duration   编年史总时长（世界秒）
   * @param {string} protoKey   物种
   * @param {object} [ctx]      { form, temper } —— 用来筛形态/性格专属事件
   * @returns {Array} [{ key, at }]，按时间排好序
   */
  function schedule(rng, duration, protoKey, ctx) {
    ctx = ctx || {};
    ctx.proto = protoKey;

    /* 把通用池和这个物种的专属池合起来抽。

       ⚠️⚠️ 专属事件**推两遍**（在池子里放两份）⚠️⚠️
           ——这是学历史行的做法（见 civLore.js 的 schedule）。

       为什么：通用 20 + 专属 5 = 25，专属自然中签率只有 20%。
       实测一局 6.1 个小事件里才 1.2 个是自己的事 ——
       读起来还是"换哪个物种都行"，看不出是潮民的历史。
       推两遍之后升到 5×2/30 = **33%**，一局约两个。

       ⚠️ **只推两遍，不是推三遍** —— 推太多的话通用池就没机会了，
          而通用池里那些（瘟疫、分裂、资源）才是所有文明共有的骨架。
           历史行那边的经验值也是 21~30% 这个区间。 */
    /* ⚠️⚠️ 池子里**每种事件放几份**是不一样的，这是有意的 ⚠️⚠️

       通用      1 份   —— 所有文明共有的骨架
       形态专属  3 份   —— ↓
       性格专属  3 份   —— ↑ 见下面
       物种专属  2 份   —— 见上面那段

       为什么形态/性格要放**三**份：
         每个文明**只会有一个形态、一个性格**（`fits` 是硬筛），
         所以池子里它们**各只有一条**。放一份的话中签率是
         `1 / (20+10+1+1) ≈ 3%` —— 一局 6 个事件里折算 0.2 个，
         **等于白写**（实测 1200 局：形态 3%、性格 3%）。
         放三份之后各约 8%，加起来 16%，一局约一个。

       放三份**不会**让同一个事件出现两次 ——
       下面抽签时按 key 去重（那个坑见下面）。 */
    var pool = [], i, r;

    /* ── ★★ 独占池（2026-09-16）★★
       修真彩蛋**只抽自己的事件** —— 用户的原话：
       「其他种族通用事件不进这个事件库」。

       ⚠️ 后面洗牌 / want / cap / count / 去重 / 摆时间点**一个字都没动** ——
          改的只有"池子是怎么建起来的"这一段。

       ⚠️⚠️ 独占池**不推两份** ⚠️⚠️
          推两份是"专属和通用抢份额"的手段（见上面那段），独占池里
          没有对手要抢。推了的话 `cap` 会从 `floor(池子×0.7)` 抬高一倍，
          把"最多用掉池子七成"这条保护架空 —— 那正是"每局都是同一批事件"
          的老毛病回来的路。

       ⚠️ 判据走 `CivLore.isExclusive`，不写死 'cultivation'（见那个函数）。 */
    if (CivLore.isExclusive(protoKey)) {
      var only = CivLore.eventsOf(protoKey) || [];
      for (i = 0; i < only.length; i++) pool.push(only[i]);
    } else {
      for (i = 0; i < EVENTS.length; i++) {
        if (!fits(EVENTS[i], ctx)) continue;
        var reps = (EVENTS[i].form || EVENTS[i].temper) ? 3 : 1;
        for (r = 0; r < reps; r++) pool.push(EVENTS[i]);
      }
      var own = CivLore.eventsOf(protoKey) || [];
      for (i = 0; i < own.length; i++) {
        pool.push(own[i]);
        pool.push(own[i]);      // ← 第二份，提高中签率（不是让它被抽中两次）
      }
    }

    /* ⚠️⚠️ 池子空了就**直接返回空表**，别掉进通用池 ⚠️⚠️
       这一行是给独占池兜底的：`SPECIES.cultivation.events` 万一没写
       （或者哪天被误删），这条线会安安静静地抽到「两座城争一条河」——
       **不报错**，只是那个修仙世界里写着别人的历史。
       宁可那一局只有微事件，也不要串味。

       ⚠️ 对另外八个物种**不可能触发**（通用池最少也有 20 条），
          所以行为一个字不变。 */
    if (!pool.length) return [];

    for (i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }

    /* ── 一局发生几个 ──
       ⚠️ 上限是"**最多用掉池子的七成**" ——
          抽干了的话每局都是同一批事件，那正是用户说的"重复"。
          池子小的时候先咬住的是这个上限，池子一大就由间隔说了算。
          （通用池扩到 20 之后，咬住它的已经换成间隔了，
            见 `_civEvents_test.js` 里那条会翻面的断言。） */
    var want  = Math.max(2, Math.round(duration * 0.7 / SMALL_INTERVAL));
    var cap   = Math.max(2, Math.floor(pool.length * 0.7));
    var count = Math.min(want, cap, pool.length);

    /* ── ⚠️ 抽的时候**要跳过重复的 key** ⚠️ ──
       专属事件在池子里放了**两份**（提高中签率，见上面）。
       直接 `slice(0, count)` 的话，两份副本可能一起落进前 count 个 ——
       **同一个事件就在一局里出现两次**，玩家读起来像 bug。

       这和历史行那边踩过的是同一个坑（见 civLore.js 的 schedule：
       "只标一份的话，同一句话会在编年史里出现两遍，约 6% 的局会撞上"）。
       `_civEvents_test.js` 有一条断言守着"一局里同一事件不出现两次"。 */
    var picked = [], seenKey = {};
    for (i = 0; i < pool.length && picked.length < count; i++) {
      if (seenKey[pool[i].key]) continue;
      seenKey[pool[i].key] = 1;
      picked.push(pool[i]);
    }

    return placeByEra(picked, rng, duration);
  }

  /* ═══════════════════════════════════════════════════════════════
     ★★ 界外来访 —— 排期 + 「帮助」那一支的文案（2026-09-14）★★
     ═══════════════════════════════════════════════════════════════

     这条线的前半段在批 1（见 evolution.js 的 OUTSIDER_STAGE）：
     文明诞生之前有 5% 的几率，有东西从记录之外投下种子 ——
     那颗星球长出来的文明**一定是外来者**。

     这里是后半段：**它们会再回来一次**。

     ── 为什么是"回来"（判据是 `world.outsiderSeeded`）──
       不回访的话，投放那条线就只是一次性的设定：玩家看见一句话，
       然后这一局和别的局没什么两样。回访让它在文明阶段**再响一次**，
       而且因果是现成的 —— 「他们是回来找自己种下的那一支的」。

     ── 两种走向，走**两条完全不同的路** ──
       入侵 → 走大事件：**冻结世界、弹窗、玩家选**（观察者的事）
       帮助 → **不弹窗、不冻世界**：直接推两行编年史 + 给世界减压

       ⚠️ 为什么帮助不弹窗：它不是观察者的事。那颗星球上发生的事
          大多不经过玩家，这一条也一样（和"小事件归生灵"是同一条界线）。
     ═══════════════════════════════════════════════════════════════ */
  /* ═══════════════════════════════════════════════════════════════
     ★★ 抵抗门槛 —— 「无视」之后，此界自己扛不扛得住 ★★（2026-09-15）
     ═══════════════════════════════════════════════════════════════

     用户的原话：「外星人入侵事件在文明阶段如果造物主无视了毁灭请求，
     但是该文明**军事 + 科技 + 生产的和大于 20** 就可以抵抗成功，
     **现在抵抗成功再不是随机事件了**，加上这一条」

     ── 它改掉了什么 ──
     原来掷一次 **3%** 的骰子（`opt.resist`，随机源 `seedNum ^ 0x1A7AD5`）。
     现在改成**看这四个数**，一点随机都没有。
     ⚠️ 顺手把那条随机源**整个删了** —— 全项目只有这一处用它
        （grep 过 core/ 和所有 `_` 文件），所以**不会让任何旧种子错位**。
        这在"拆随机源"的历史里很少见（前三次拆分都让种子集体错位）。

     ── ★★ 文化**不算在内**，这是有意的，不是漏写 ★★ ──
     用户只写了三项。而和文化"**不管死活、只管活成什么样**"的定位
     正好对上 —— 它是四个数里唯一不减缓任何压力线的那个。

     ── 门槛是**量的**，不是拍的（决策 #94）──
     用户原话写的是 20。**实测 20 是一局都过不了的**（0.00%）——
     那正好踩中立项时立的那条红线：
     ⚠️⚠️ **不许让"抵抗"永远失败** —— 那样【无视】就成了"**没有选择的选择**"，
     和决策 #69 那个坑同类（**玩家被锁死**）。

     ⚠️⚠️ **量的时候踩了两个坑，记在这儿** ⚠️⚠️

     坑一：**拿"终值"量，量出来是假的。**
       第一版按**一局打完的终值**量，得出"门槛 14 → 2.28%"。
       可**入侵发生在第四纪元（约编年史 84% 处），不是终局** ——
       那时属性还没推满。按正确的口径重量，门槛 14 是 **0.00%**。
       ★ 同一个门槛，两把尺子量出来一个 2.28% 一个 0% ——
         差的只是"什么时候量"。这正是本项目反复栽的「尺子」问题。

     坑二：**样本量。** 头一版只收到 61 局，p97 和最大值都是噪声。
       加到 223 局之后才看清分布的形状（见下）。

     ── ★ 定案（223 局，自然触发，物种没被污染）──

          入侵那一刻的 军+科+生：
            最低 1   p25 5   中位 7   p90 9   p95 10   p97 11   最高 12

             门槛  9 →  9.87%
             门槛 10 → ★ **4.04%**   ← 最接近用户定的「极小概率 = 3%」
             门槛 11 →  0.90%          （太稀）
             门槛 12 →  0.00%          （又踩红线）

     ★ **定 10**。离可达上限（12）还有 2 点余量 —— 这一点很重要：
       11 就已经只剩 0.9% 了，**余量再薄一点就会变成"永远失败"**。

     ⚠️⚠️ 以后改了 `OPTION_ATTR` / `ATTR_TEMPER` / `ATTR_SPECIES` 任何一个，
        **都要重量这个门槛**，而且：
         · 按「**入侵那一刻**」量，不是按终值（坑一）
         · 样本 **≥200 局**（坑二）
         · 量之前先确认**物种没被污染** —— 探针里如果为了强制触发回访
           而提前置 `outsiderSeeded`，`Civ.roll` 会把物种全变成「外来者」
           （那会顺手改掉属性的起点）。
     ═══════════════════════════════════════════════════════════════ */
  var RESIST_NEED = 10;

  var VISIT = {
    /* 被投放过的世界里，等得到这次回访的占几成。
       ⚠️ 这个数是**在投放之上的第二道门** —— 连乘之后才是玩家看到的总概率：
             5%（投放）× 60%（回访）× 2/3（入侵）≈ 2% 的局会撞上入侵
          实测数字见 CLAUDE.md 第七节 3.6，改之前跑 `_visit_probe.js` 量。 */
    chance: 60,
    /* 回访里是入侵的占几成（其余是帮助）—— 用户定的 2/3 : 1/3 */
    invadeShare: 67,

    /* ── 「帮助」那一支的两行 ──
       ⚠️ 形状照着 resolveSmall 推小事件的样子来：
            ▸ 第{t}个周期 · 界外之物 · 他们停下来了
            · <正文>
          这样它在编年史上就是"发生了一件事"，而不是"观察者出手了"
          （那是 `act`，冷白色，整份记录里只该有观察者下笔的那几行）。 */
    helpTitle: '界外之物',
    helpLabel: '他们停下来了',
    helpText: '落点周围的取样又对不上了。此后{folk}手里的东西，有一部分不是自己造的',

    /* 帮助给多少减压，压在哪条线上。
       ⚠️ 走**消耗**那条：他们带来的东西是"省下来的力气"，
          和「倾力救治」掏储备是同一个方向，只是符号相反。 */
    helpAxis: 'drain',
    helpPressure: -15,

    /* ★★ 帮助给的四属性（2026-09-23 用户拍板加的）★★

       **起因**：用户问「之前设定会有一部分概率是帮忙文明的吧，
       那个事件有没有真实写出来并给科技生产 +2 啊」——
       查下来：文案写了、机制只减压力、**属性从来没动过**。

       ⚠️ 而 `helpText` 写的正是「此后{folk}手里的东西，
          **有一部分不是自己造的**」—— 那是"本事变大了"，
          不是"处境变松了"。加了这一行，**机制才追上文案**。

       ★ 值就是用户记的那个：科技 +2 / 生产 +2。
         ⚠️ **+2 是单项上限** —— `_civEvents_test.js` 有一条断言卡着
            「幅度必须是 ±1 或 ±2 的整数」。再大就得先改那条。
       ⚠️ 走 `CivEvents.applyAttr`，**不在 `resolveVisitHelp` 里手写** ——
          理由见 `applyAttr` 那段（写入点必须数得清）。

       ⚠️ 影响面：这一支只有 **0.78%** 的局碰得上
          （投放 4.95% × 回访 60% × 三分之一），对整体平衡几乎为零。 */
    helpAttr: { sci: 2, prod: 2 }
  };

  /**
   * 这一局要不要排一次界外来访。
   *
   * ⚠️ 只对**被投放过的世界**返回东西（见上面那段）。
   *
   * @returns {object|null} { key, at, mode } —— mode 是 'invade' 或 'help'
   */
  function planVisit(rng, world, duration) {
    if (!world || !world.outsiderSeeded) return null;
    if (!RNG.chance(rng, VISIT.chance)) return null;

    /* ⚠️ 时间点**先抽**，模式**后抽** —— 让「什么时候来」和
       「来干什么」**在结构上**互不依赖，不是靠"量出来没差别"。

       ⚠️⚠️ 这里要如实记一笔：**没有实测到的 bug** ⚠️⚠️

          第一版是反着写的（先抽模式、再抽时间点）。跑探针时看到
          "排上期的入侵有 18% 没等到、帮助只有 2%"，像是真 bug。

          于是专门去量：20 万颗种子，两种顺序各跑一遍，比较
          **入侵和帮助的平均到来时刻** ——

              旧顺序   入侵 0.85992   帮助 0.85994
              新顺序   入侵 0.85987   帮助 0.85995

          差别在十万分之二，**连噪声都算不上**。探针上那个
          18% vs 2% 是 n=72 / n=42 的抽样噪声（两个标准差上下）。

          所以这是一次**结构性收紧**，不是修 bug。
          改它的理由只有一个：反着写的话，"两者无关"是靠 PRNG
          相邻输出的独立性**碰巧成立**的 —— 那是个没人守着的假设。
          调过来之后它是**构造上成立**的，不需要谁来保证。

          （教训也记在这儿：探针跑出来的差要先算样本量够不够。
            这个项目在"尺子歪了"上栽过，在"样本太小"上也栽过 ——
            见 _style_test.js 里那段阈值为什么是 10%。） */
    var when = rng();
    var mode = RNG.chance(rng, VISIT.invadeShare) ? 'invade' : 'help';

    /* 时间点落在**第四纪元**（观测）的窗口里 ——
       ⚠️ 和别的大事件同一个窗口，`_civEvents_test.js` 有一条断言
          按 `eraWindow(4)` 验它（见那条"标了纪元的事件都落在窗口里"）。
       为什么是最后那一段：前三个纪元是立城、冶炼、战争，
       第四纪元才是"他们开始朝外面看"—— 有东西从外面进来属于这一段。 */
    return {
      key: 'outsider',
      at: duration * (0.80 + when * 0.12),
      mode: mode
    };
  }

  /**
   * 抽这一局的大事件。
   *
   * ⚠️ **和上面的随机源要分开**（见 evolution.js 的 beginCiv）——
   *    大事件一改就会挪动小事件的位置，那是两个无关的系统。
   */
  /**
   * 一个事件能不能进**这一局**（**只看性格**）。
   *
   * @param {object} def    事件定义
   * @param {string} temper 这一局的性格（没有 = 修真彩蛋）
   * @param {number} roll   一颗**每世界一次**的骰子（由种子派生，见 `scheduleBig`）
   * @returns {'pool'|'force'|'never'}
   *   pool  —— 性格上够格，能不能上还要看属性（`gateAttrsOK`）
   *   force —— 性格上**必定够格**（⑦ 对征战、⑧ 对信仰），挑的时候直接插队
   *   never —— 这一局碰不到
   *
   * ⚠️⚠️ **属性门槛故意不在这里判** ⚠️⚠️
   *   这里只吃性格和一颗种子骰子，**不吃属性** —— 所以排期
   *   （`scheduleBig`）和到点（`pickBig`）两处算出来**完全一样**。
   *   这正是它今天能被调用两次的原因。
   *
   *   属性门槛归 `gateAttrsOK`，它必须等到**触发那一刻**才判：
   *   排期发生在文明刚诞生时，那一刻军事还是**出生值**，而出生值
   *   只由物种 + 性格决定：
   *
   *       征战 / 游牧     物种 + 2  →  2~4
   *       工匠/求知/商业  物种 + 0  →  0~2   ← 最高只有 2
   *       信仰 / 隐世     物种 − 1  → −1~1   ← 最高只有 1
   *
   *   ⑦ 的门槛是军事 ≥3，在出生值上判会把**工匠/求知/商业/信仰/隐世
   *   全部永久挡死**。2026-09-21 实测 736 局：⑦ 只落在征战身上，
   *   其余七种一次都没碰到 —— **概率表等于没写**。
   *
   * ★ 2026-09-22 从 `scheduleBig` 里**搬出来**（`pickBig` 也要用它）。
   *   搬的时候把 `ctx.temper` 和闭包里的 `gateRoll` 改成了**参数** ——
   *   搬之前靠闭包读，搬之后两个调用方各自把值传进来。 */
  function gateOf(def, temper, roll) {
    if (!def.gate) return 'pool';            // 没写门槛 = 老规矩，谁都可能碰
    var g = def.gate, k;

    /* ★★ 只写了属性门槛（`atLeast`）、没写性格开关的 —— 谁都能碰 ★★

       ⚠️⚠️ 这一行是 2026-09-21 补的，**补之前是个静默的坑**：
          ②`depart` 只有 `atLeast`，没有 `force` / `never` / `odds`，
          于是走到最下面那行时 `g.odds` 是 `undefined`，
          `(undefined && …) || 0` 算出来是 **0**，
          `roll < 0` **永远为假** → 返回 `'never'`。

          后果：② **连候选池都进不去**，根本走不到属性门槛那一步。
          ⚠️ 不报错、不警告 —— 只是这一条事件从此再也不出现。
          实测 1200 局：② 的出现率 **0.00%**（对照：关掉门槛是 13%）。

       ★ 判据：**只要没写任何性格开关，就不该拿骰子去卡它。**
          属性门槛归 `gateAttrsOK`（在触发那一刻判），不归这里。 */
    var hasTemperRules = (g.force && g.force.length) ||
                         (g.never && g.never.length) ||
                         (g.odds  && Object.keys(g.odds).length);
    if (!hasTemperRules) return 'pool';

    /* 性格开关 —— 没有性格（修真彩蛋）就没有开关可拨 */
    var t = temper;
    if (!t) return 'never';
    for (k = 0; k < (g.force || []).length; k++) {
      if (g.force[k] === t) return 'force';
    }
    for (k = 0; k < (g.never || []).length; k++) {
      if (g.never[k] === t) return 'never';
    }

    /* ── 其余按概率 —— 用的是上面那颗**每世界一次**的骰子 ──

       ⚠️⚠️ `odds` 里**没列到的性格一律放行**（不是"一律毙掉"）⚠️⚠️
          和 `OPTION_ATTR` 里"显式写 null / 不许漏标"是同一条规矩：
          **要排除就写出来，没写就是不管。**

       ⚠️ 反过来写（没列到就毙）会**静默地把整条事件吃掉** ——
          2026-09-21 就这么错过一次：②`depart` 只有 `atLeast`、
          没有 `odds`，`(undefined && …) || 0` 算出 0，
          `roll < 0` 永远为假 ⇒ ② 出现率 **0.00%**，
          而且**不报错、不警告**。见上面 `hasTemperRules` 那段。 */
    if (!g.odds) return 'pool';
    var p = (g.odds[t] !== undefined) ? g.odds[t] : 1;   // 没列到 = 不用骰子卡
    return (roll < p) ? 'pool' : 'never';
  }

  function scheduleBig(rng, duration, protoKey, ctx) {
    ctx = ctx || {};
    ctx.proto = protoKey;

    /* ── ★★ 独占池没有大事件（2026-09-16）★★
       用户的原话：「独立修仙世界的事件库**并不给大事件选项**」。

       返回空表就够了 —— `c.bigs = []` ⇒ `stepCiv` 那段（第 ④ 段）
       永不进入 ⇒ **世界永远不会因为大事件冻住**（那一屏根本不出现）。
       这就是"不写大事件"在代码里的全部落点。

       ⚠️ 早退**不消耗**任何随机数（`rng` 一次都没抽），
          所以它独享的那条 `bigRng` 序列不会被这条线搅乱。
       ⚠️ `planVisit`（界外回访）不用管：它要求 `world.outsiderSeeded`，
          而彩蛋骰要求 `!world.outsiderSeeded` —— 两者**构造上互斥**。 */
    if (CivLore.isExclusive(protoKey)) return [];

    /* ── 性格门槛用的那颗骰子（2026-09-21 加的）──

       ★★ 从**世界种子派生**，**不消耗传进来的 `rng`** ★★

       ⚠️⚠️ 这是最容易做错的一处：如果在循环里直接调 `rng()`，
          **每颗世界的抽签序列都会整体错位**（多抽一个数 = 后面全变），
          于是**所有旧种子的剧情都会换一遍**，而且不报错。
          派生一颗专用骰子就绕开了 —— 它和 `bigRng` 是两条独立的流。

       ⚠️ 骰子**每颗世界只掷一次**，⑦ 和 ⑧ 现在共用同一颗。
          将来第三条要用性格赔率的时候，**要么共用这颗（两条完全相关），
          要么换一个魔数** —— 别默默共用。

       ⚠️ `ctx.seedNum` 缺席时（单元测试直接调这个函数、不传世界）
          `(undefined || 0) ^ 魔数` = 魔数本身 ⇒ 退化成"固定种子"，
          仍然**确定性**，不会报错。

       ★ 2026-09-22：判性格门槛的活整个搬进了模块级的 `gateOf`
          （`pickBig` 也要用它），这里只负责**把骰子摇出来喂给它**。
          —— ⚠️ 这一段原来还挂着一份 `gateOf` 的 JSDoc，搬走之后
             成了孤儿，还引用着一个**从来不存在**的 `gateMilOK`。
             已删。注释指向不存在的函数，比没有注释更坏。 */
    var gateRng  = RNG.makeRng(((ctx.seedNum || 0) ^ 0x3E7A11) >>> 0);
    var gateRoll = gateRng();
    /* ═══════════════════════════════════════════════════════════════
       ★★ 2026-09-22：**排期不再抽签** —— 只排"空位"（用户拍板）★★
       ═══════════════════════════════════════════════════════════════

       ── 改之前是什么样 ──
       排期这一刻（文明刚诞生）就把 1~3 条大事件**抽好**、排到时间轴上；
       到点再判属性门槛，判不过就**静默空掉那一格，不补**。
       实测（1500 局随机玩法）：**53.3% 的局一条大事件都没有**，
       其中 98.6% 都是"排了签、到点全被属性门槛毙掉"。
       ⇒ **抽签对属性完全瞎，而属性门槛是抽完之后才判的。**

       ── 改之后 ──
       排期只做一件事：**排 N 个空位**（时间点和格数照旧）。
       到点的时候现场扫一遍事件表（见 `pickBig`），谁够格谁上；
       好几条同时够格就**掷骰子**定先后（用户原话）。
       实测同一批世界：空局率 **53.3% → 5.7%**，平均 0.57 → 约 2 条/局。

       ── 性格门槛为什么还在这里算一遍 ──
       `gateOf` 只看性格 + 一颗**由种子派生**的骰子，不吃属性，
       所以排期和到点两处算出来完全一样。这里算它只为一件小事：
       数出有几条 `force`（"必定触发"），好给它们**额外留格** ——
       用户要的是"必定触发这个事件"，不是"用它换掉别的事件"。
       ⚠️ 真正的资格判定在 `pickBig`，那里两半都判。

       ⚠️ 空位**只落在 era 4** —— 因为现在 9 条大事件**全是** `era: 4`。
          `_civEvents_test.js` 有一条断言钉着这件事：哪天有人加了别的
          纪元的大事件，那条会红，提示这里要跟着改。 */
    var forcedCount = 0, i, e;
    for (i = 0; i < BIG_EVENTS.length; i++) {
      e = BIG_EVENTS[i];
      /* ⚠️ `manual` 的**不进池子** —— 它只由 `planVisit` 手动排进来。
         漏掉这个判断的后果是**静默**的：界外来访会变成"每局都可能遇到"，
         而它本该只发生在被界外投放过的世界上。 */
      if (e.manual) continue;
      if (!fits(e, ctx)) continue;
      if (gateOf(e, ctx.temper, gateRoll) === 'force') forcedCount++;
    }

    var want = Math.max(1, Math.round(duration * 0.7 / BIG_INTERVAL)) + forcedCount;
    var stubs = [];
    for (i = 0; i < want; i++) stubs.push({ era: 4 });   // 空位：只有纪元，没有 key

    /* ⚠️ 喂给 `placeByEra` 的是**没有 key 的空位**，它返回的每一项 `key`
       都是 `undefined`，只有 `at` 有用。
       **外面任何地方都不许再读 `slot.key`** —— 读到的永远是 undefined。 */
    var placed = placeByEra(stubs, rng, duration);
    var slots = [];
    for (i = 0; i < placed.length; i++) slots.push({ at: placed[i].at });
    return slots;
  }

  /**
   * 把玩家选的结果落到世界上。
   *
   * @returns {object|null} 落地的选项定义
   */
  /* ═══════════════════════════════════════════════════════════════
     ★★ 每个选项压的是哪条线（2026-09-13 加）★★
     ═══════════════════════════════════════════════════════════════
     三条线见 `civLore.js` 的 `ENDURE`：
       drain 消耗 —— 吃得快不快（人口、开采、储备）
       unbal 失衡 —— 改造地表之后扛不扛得住（污染、气候、动土）
       rift  离心 —— 内部会不会散（矛盾、冲突、秩序）

     ★ 为什么标在**选项**上而不是事件上：
       同一个事件的不同做法，压的常常不是同一条线 ——
       瘟疫爆发（plague）里「封锁边界」断的是**往来**（离心），
       「倾力救治」掏的是**储备**（消耗）；封锁和救治显然不该
       记到同一本账上。标在事件上的话，玩家就失去了
       "用不同的做法把压力引到不同线上"这个选择。

     ★ 为什么集中成一张表、而不是写进 130 个选项里：
       ① 整张表一眼看得完，好平衡（"离心是不是标太多了"能直接数）
       ② `_civEvents_test.js` 能遍历它做检查
       ③ 加新选项时忘了标，有兜底 + 断言会提醒

     ⚠️ 键是 `事件key.选项key` —— 单用选项 key 会撞
        （`buildit` / `moveon` / `letgo` 这些在不同事件里都出现过）。

     ⚠️ **表里没有的一律兜底到 'rift'**，而且有一条断言
        要求"所有选项都必须在这张表里" —— 兜底只是保险，
        不是可以偷懒的地方。 */
  var OPTION_AXIS = {
    // ── 通用事件（30 个：前三纪元 15 + 纪元 4 的 10 + 没标纪元的 5）──
    'clash.mediate': 'rift',      'clash.letfight': 'rift',    'clash.reroute': 'drain',
    'resource.exploit': 'drain',  'resource.moderate': 'drain','resource.seal': 'drain',
    'plague.quarantine': 'rift',  'plague.heal': 'drain',      'plague.fate': 'drain',
    'skyward.array': 'drain',     'skyward.omen': 'rift',      'skyward.ignore': 'drain',
    'schism.suppress': 'rift',    'schism.part': 'rift',       'schism.thirdway': 'rift',
    'recall.keepname': 'rift',    'recall.letgo': 'rift',      'recall.markhim': 'rift',
    'number.write': 'rift',       'number.stopcount': 'drain', 'number.countall': 'drain',
    'gatherplace.buildthere': 'unbal', 'gatherplace.leaveit': 'unbal', 'gatherplace.useup': 'drain',
    'sharp.finer': 'drain',       'sharp.enough': 'drain',     'sharp.teachfine': 'rift',
    'putdead.sameplace': 'unbal', 'putdead.scatter': 'unbal',  'putdead.burn': 'unbal',
    'roadmade.widen': 'unbal',    'roadmade.keepnarrow': 'unbal', 'roadmade.blockit': 'rift',
    'barterlaw.written': 'rift',  'barterlaw.byword': 'rift',  'barterlaw.freely': 'rift',
    'meetother.learn': 'rift',    'meetother.apart': 'rift',   'meetother.pushout': 'rift',
    'edge.drawline': 'rift',      'edge.noline': 'rift',       'edge.shareline': 'rift',
    'sparehands.feedthem': 'drain','sparehands.sendback': 'drain', 'sparehands.lowthem': 'rift',
    'onecode.mergeone': 'rift',   'onecode.keepmany': 'rift',  'onecode.burnold': 'rift',
    'refuser.hearit': 'rift',     'refuser.forcethem': 'rift', 'refuser.ignorethem': 'rift',
    'hardyear.storerest': 'drain', 'hardyear.moveon': 'drain', 'hardyear.takemore': 'drain',
    'uselesswork.buildit': 'drain','uselesswork.stopit': 'drain','uselesswork.manyit': 'drain',
    'oldways.newway': 'rift',     'oldways.keepold': 'rift',   'oldways.bothway': 'drain',
    'tide.followtide': 'unbal',   'tide.buildhigh': 'unbal',   'tide.usetide': 'drain',
    'inland.settlemid': 'unbal',  'inland.leavemid': 'unbal',  'inland.crossit': 'unbal',
    'height.stopup': 'unbal',     'height.digdown': 'unbal',   'height.moveaway': 'unbal',
    'dryland.digdeep': 'drain',   'dryland.moveoasis': 'drain','dryland.cutuse': 'drain',
    'ice.followice': 'unbal',     'ice.holdground': 'unbal',   'ice.useground': 'drain',
    'undergrowth.thincanopy': 'unbal', 'undergrowth.liveup': 'unbal', 'undergrowth.liveindark': 'unbal',
    'depth.cleart': 'unbal',      'depth.sealit': 'unbal',     'depth.moveelse': 'unbal',
    'platform.builddown': 'unbal','platform.stayout': 'unbal', 'platform.abandondown': 'unbal',
    'wantfight.keepcalm': 'rift', 'wantfight.givin': 'rift',   'wantfight.useforce': 'rift',
    'stalemate.keepseige': 'drain','stalemate.withdraw': 'drain', 'stalemate.talkit': 'rift',
    'unanswerable.keepask': 'rift','unanswerable.putaside': 'rift', 'unanswerable.forbidask': 'rift',
    'noanswer.keepfaith': 'rift', 'noanswer.changeway': 'rift', 'noanswer.dropfaith': 'rift',
    'foundus.hideaway': 'unbal',  'foundus.tradethem': 'drain', 'foundus.jointhem': 'rift',
    'stophere.moveon': 'drain',   'stophere.stayone': 'drain',  'stophere.buildhere': 'unbal',
    'baddeal.findother': 'drain', 'baddeal.reprice': 'drain',   'baddeal.stopdeal': 'drain',
    'notgood.fixall': 'drain',    'notgood.selloff': 'drain',   'notgood.teachthem': 'rift',

    /* ── 纪元 4 通用（10 个 · 30 个选项）2026-09-23 ──
       ⚠️ 这些几乎全是"整颗星球"尺度的事 ⇒ 压在**失衡**（改造地表）上 ——
          失衡原来是三条线里最少的（71），正好补它。 */
    'longlife.keeppush': 'drain',   'longlife.forall': 'drain',    'longlife.onlysome': 'rift',
    'onepiece.keepgrow': 'unbal',   'onepiece.breaksome': 'unbal', 'onepiece.walled': 'rift',
    'onelang.letgo': 'rift',        'onelang.keepit': 'drain',     'onelang.forceone': 'rift',
    'bycalc.control': 'unbal',      'bycalc.forecastonly': 'unbal','bycalc.letthem': 'rift',
    'nowild.keepclean': 'unbal',    'nowild.leaveone': 'unbal',    'nowild.remakeit': 'unbal',

    'nonew.keepdig': 'drain',       'nonew.teachall': 'drain',     'nonew.stopsearch': 'drain',
    'fullrecord.keepall': 'drain',  'fullrecord.keepmain': 'drain','fullrecord.burnpart': 'rift',
    'sameborn.letitbe': 'unbal',    'sameborn.keepdiff': 'unbal',  'sameborn.makeall': 'unbal',
    'oldplace.restore': 'drain',      'oldplace.rebuild': 'unbal',     'oldplace.letfall': 'drain',
    'noother.disarm': 'drain',      'noother.keepguard': 'rift',   'noother.meltdown': 'unbal',

    // ── 大事件（9 个）—— 选项是"观察者做什么"，标的是**这个干预动了文明的哪一头** ──
    // ⚠️ 2026-09-22：①`lookup` 删掉了（和 ⑧`seent` 是同一个拍子，见 BIG_EVENTS 那里的说明）。
    //    它的三行（reveal / silence / erase）**跟着一起删** —— 孤儿条目不会让测试变红。
    'depart.release': 'drain',    'depart.hold': 'rift',       'depart.mark': 'rift',
    'stopped.wake': 'drain',      'stopped.waitsee': 'drain',  'stopped.closebook': 'rift',
    'mirror.hint': 'rift',        'mirror.justwatch': 'rift',  'mirror.eraseold': 'rift',
    'whatare.reply': 'rift',      'whatare.stayquiet': 'rift', 'whatare.unask': 'rift',
    'elsewhere.confirm': 'rift',  'elsewhere.miscalc': 'rift', 'elsewhere.leaveit': 'rift',
    'lastbatch.keep': 'drain',    'lastbatch.letfinish': 'drain', 'lastbatch.remember': 'rift',
    'seent.appear': 'rift',       'seent.hide': 'rift',
    // ⚠️ 2026-09-22：【换个位置】那个选项删掉了（和【藏起来】重复），
    //    它的 OPTION_AXIS / OPTION_ATTR 两行**跟着一起删** ——
    //    孤儿条目不会让测试变红，只会烂在表里。
    'ending.moretime': 'unbal',   'ending.holdline': 'unbal',  'ending.sooner': 'unbal',
    'handover.letgo': 'drain',    'handover.stopmake': 'drain','handover.setlimit': 'drain',

    /* ── ★ 外来者的 5 个专属事件（15 个选项）2026-09-14 ──
       他们的母题是"和这颗世界对不上"，所以压的绝大多数是**失衡** ——
       他们在一条本来就不为自己准备的环境里过日子。
       例外是两次"内外分裂"（立界 / 禁止学着变），那压的是**离心**。 */
    'sample.again': 'unbal',      'sample.writeit': 'rift',    'sample.stopsample': 'unbal',
    'bound.buildbound': 'rift',   'bound.nobound': 'unbal',    'bound.unbound': 'rift',
    'mimic.letmimic': 'unbal',    'mimic.forbid': 'rift',      'mimic.bothlife': 'unbal',
    'ledger.openit': 'rift',      'ledger.keepit': 'unbal',    'ledger.burnit': 'unbal',
    'goback.letgo': 'rift',       'goback.holdback': 'rift',   'goback.allgo': 'rift',

    /* ═══════════════════════════════════════════════════════════════
       ★★ 七个物种的专属事件（105 个选项）2026-09-14 一次补齐 ★★
       ═══════════════════════════════════════════════════════════════

       ⚠️⚠️ 这一批**原来一个都没标**（41% 的选项），全都在静默兜底到「离心」——
          加了外来者事件、把检查范围补全之后才暴露出来。
          现在逐个读完事件内容再标的。

       标尺（三选一，看**这个选项实际动了什么**）：
         消耗 drain —— 资源 / 储备 / 人口（吃得多不多、扛不扛得住）
         失衡 unbal —— 环境 / 地表 / 生态（对这颗星球做了什么）
         离心 rift  —— 内部关系 / 往来 / 秩序（人和人之间）

       ⚠️ 有争议的几处，记下判断理由，免得以后有人当错的改：
         · 兽类「一场大迁徙」三条都是 drain —— 猎场空了是**资源**驱动，
           走 / 留 / 派人探路都只是不同的资源策略，不是内部矛盾
         · 海类「壳连成一片」三条都是 unbal —— 那是他们**造出来的结构**，
           属于地表那一头（虽然「断开 / 放弃」听着像关系，其实是处置建筑物）
         · 植类「新的长法」三条都是 unbal —— 形态问题，不是新旧两派之争
         · 灵能类整体偏 rift —— 他们的"事"几乎都在意识内部
           （念头传遍 / 感知分两股 / 忘了怎么回来），不涉及地表 */
    // ── 兽类：内部规矩那一头最重 ──
    'kin.law': 'rift',            'kin.kin': 'rift',           'kin.both': 'rift',
    'migration.go': 'drain',      'migration.stay': 'drain',   'migration.half': 'drain',
    'hunt.rotate': 'drain',       'hunt.claimit': 'rift',      'hunt.fewer': 'drain',
    'leader.strongest': 'rift',   'leader.bybirth': 'rift',    'leader.byall': 'rift',
    'settle.letthem': 'rift',     'settle.bringback': 'rift',  'settle.jointhem': 'unbal',
    // ── 虫类：数量 → 资源；组织 → 内部；扩张 → 地表 ──
    'swarm.cull': 'drain',        'swarm.expand': 'unbal',     'swarm.restrain': 'drain',
    'onesmell.accept': 'rift',    'onesmell.diverge': 'rift',  'onesmell.dormant': 'drain',
    'center.newworker': 'rift',   'center.slowstop': 'drain',  'center.scatterit': 'rift',
    'winged.sendout': 'unbal',    'winged.holdback': 'rift',   'winged.breedmore': 'drain',
    'outside.absorb': 'rift',     'outside.driveoff': 'rift',  'outside.ignoreout': 'unbal',
    // ── 海类：热源和水是资源，洋流和构造是环境，节奏是内部 ──
    'deepvent.warmthere': 'drain','deepvent.stayaway': 'drain','deepvent.mapping': 'drain',
    'current.followit': 'unbal',  'current.stayput': 'unbal',  'current.digwarm': 'unbal',
    'song.oldsongs': 'rift',      'song.newonly': 'rift',      'song.manya': 'rift',
    'shelllink.keeplink': 'unbal','shelllink.cutpart': 'unbal','shelllink.abandonit': 'unbal',
    'above.encourage': 'unbal',   'above.forbid': 'unbal',     'above.tradeup': 'drain',
    // ── 植类：几乎全在地表那一头（他们的"内部"就是地表）──
    'canopy.growup': 'unbal',     'canopy.thinout': 'unbal',   'canopy.twolayers': 'unbal',
    'root.pushthrough': 'unbal',  'root.stopdepth': 'unbal',   'root.around': 'unbal',
    'burn.reseal': 'unbal',       'burn.seedfirst': 'unbal',   'burn.leaveburn': 'unbal',
    'newkind.spreadnew': 'unbal', 'newkind.keepboth': 'unbal', 'newkind.cutit': 'unbal',
    'bottom.feeddown': 'drain',   'bottom.letdie': 'drain',    'bottom.reuse': 'drain',
    // ── 石类：矿脉和水是资源，地质构造是环境 ──
    'vein.move': 'drain',         'vein.deep': 'drain',        'vein.wait': 'drain',
    'crystal.let': 'unbal',       'crystal.stop': 'unbal',     'crystal.scatter': 'unbal',
    'fracture.closeit': 'unbal',  'fracture.letopen': 'unbal', 'fracture.wident': 'rift',
    'seep.drinkit': 'drain',      'seep.sealoff': 'unbal',     'seep.letin': 'unbal',
    'slowdown.waitit': 'drain',   'slowdown.pushhard': 'drain','slowdown.changeform': 'unbal',
    // ── 灵能类：他们的"事"几乎都在意识内部 ──
    'onethought.keepdoing': 'rift','onethought.breakit': 'rift','onethought.spreadit': 'rift',
    'leavebody.letthemgo': 'rift','leavebody.callback': 'rift','leavebody.keepbody': 'drain',
    'twostreams.rejoin': 'rift',  'twostreams.keeptwo': 'rift','twostreams.onewins': 'rift',
    'echo.answer': 'rift',        'echo.recordit': 'rift',     'echo.shield': 'unbal',
    'forgetbody.findthem': 'rift','forgetbody.letgo': 'rift',  'forgetbody.followthem': 'rift',
    // ── 人类：记录 / 货币 / 教育是内部，工具和聚居是资源 ──
    'archive.rewrite': 'rift',    'archive.blank': 'rift',     'archive.erase': 'rift',
    'selfmake.let': 'drain',      'selfmake.keep': 'drain',    'selfmake.stop': 'drain',
    'bigcity.letgrow': 'drain',   'bigcity.evenout': 'drain',  'bigcity.moveit': 'drain',
    'coin.acceptit': 'rift',      'coin.barterstill': 'rift',  'coin.stopit': 'rift',
    'school.fundit': 'drain',     'school.fewteach': 'rift',   'school.familyteach': 'rift',

    /* ── 大事件：界外来访（2026-09-14）──
       两个选项压的是**两条不同的线**，这是有意的：
         driveoff 出手驱赶 —— 压力**减轻**，减在离心上
                    （外面的威胁把他们拧成了一股，所以是"减"）
         ignore   无视     —— 压力加在消耗上，因为它的后果是「收割」：
                    这颗星球**被取走的是资源**，不是别的。
       ⚠️ 轴只决定"万一它也崩了、崩在哪条线上"，不决定"会不会崩"——
          「无视」那条根本走不到崩（它直接进收割），
          只有约 4%（实测 4.04%）扛过去的世界才轮得到这个轴起作用。 */
    'outsider.driveoff': 'rift',  'outsider.ignore': 'drain',

    /* ── ★ 修真彩蛋（12 个事件 · 24 个选项）2026-09-16 ──
       ⚠️⚠️ 全部标 `drain`，这是**有意的、而且只有这一种** ⚠️⚠️
          这条线**只用一条压力线**（用户拍板）。`resolveXiu` 把数
          直接写进 `c.shift.drain`，所以这张表在彩蛋里
          **根本读不到** —— 标上是为了满足 D 段那条"每个选项都必须
          在表里"的断言，同时**如实记下"这条线压的是消耗"**。
       ⚠️ 别给它们标别的线：标了也不会生效（`resolveXiu` 不调 `axisOf`），
          只会让这张表和实际行为对不上。 */
    'xiuSit.dengTa': 'drain',        'xiuSit.beiXiaLai': 'drain',
    'xiuMark.moDiao': 'drain',       'xiuMark.liuZhe': 'drain',
    'xiuFast.guanZhe': 'drain',      'xiuFast.weiTaMen': 'drain',
    'xiuRule.dingGuiJu': 'drain',    'xiuRule.shuiDouJiao': 'drain',
    'xiuFurnace.mieHuo': 'drain',    'xiuFurnace.kaiLu': 'drain',
    'xiuSail.songTaMen': 'drain',    'xiuSail.lanZhu': 'drain',
    'xiuThunder.biKai': 'drain',     'xiuThunder.yingShang': 'drain',
    'xiuStill.shouZhe': 'drain',     'xiuStill.jiaoTa': 'drain',
    'xiuSplit.fenKai': 'drain',      'xiuSplit.bingCheng': 'drain',
    'xiuAscend.songTa': 'drain',     'xiuAscend.lanTa': 'drain',
    'xiuSpring.jieShang': 'drain',   'xiuSpring.banZou': 'drain',
    'xiuRift.zhaoJiu': 'drain',      'xiuRift.shangQu': 'drain'
  };

  /** 这个选项压哪条线（没标就兜底到离心 —— 见上面那段说明） */
  function axisOf(eventKey, optionKey) {
    var k = eventKey + '.' + optionKey;
    return OPTION_AXIS[k] !== undefined ? OPTION_AXIS[k] : 'rift';
  }

  /* ═══════════════════════════════════════════════════════════════════
     ★★ 四属性：这个选项**把文明推成什么样**（2026-09-15）★★
     ═══════════════════════════════════════════════════════════════════

     四个数（见 `civ.js` 的 ATTR_NAMES）：

       mil 军事 —— 武力、防御、扩张、压得住
       sci 科技 —— 知识、工具、观测、方法
       prod 生产 —— 开采、建造、储备、家底
       cul 文化 —— 记录、信仰、传统、认同

     生灵按自己的性格挑了一个选项（见 `pickOption` / `lean`），
     挑中的这条就把文明往某个方向推一点。**一局大概被推七八次**
     （小事件 3~7 个 + 大事件 1~2 个），所以单个选项的幅度很小：
     **绝大多数是 ±1，加倍的只有少数几个**。

     ── ★★ 三条写这张表的规矩 ★★ ──

     ① **跟叙事走，不跟压力走。**
        这张表**不是**从 `OPTION_AXIS` 推出来的，也不该推得出来 ——
        如果一个选项"压哪条线"和"推哪个属性"永远一一对应，
        那同一个选择就会被**记账两次**（属性高 → 又减那条线的压力），
        四个数就变成了压力的复读机、一点新信息都没有。
        ⚠️ 写新选项时先问：**这件事让他们的"本事"变了吗？**
           不是"他们为此付出了什么"。付出多少是 `pressure` 的事。

     ② **推的是"能力"，不是"处境"。**
        「搬走了」「再等等」「不回答」这类是处境反应，本事没变 → 写 `null`。
        「发明了记数的办法」「把工具交出去」这类是能力变了 → 推。
        ⚠️ 所以表里**有相当一部分是 `null`，那是刻意的，不是漏标**。

     ③ **文化只认"他们认得出自己是谁"这类事** ——
        记录、信仰、手艺、共用的规矩、留给以后的东西。
        打仗和生产**不给文化**（那是另外三个数的事）。

     ⚠️⚠️ 值全是**未调**的（见 CLAUDE.md 第十节「待改的数值账」）。
         先把框架跑通，调数值统一留到最后。

     ⚠️ 键是 `事件key.选项key`，和 `OPTION_AXIS` 同一套写法。
     ⚠️ **每一个选项都必须在这张表里**，不需要推的写 `null` ——
        有一条断言守着。`null` 和"忘了标"必须分得开，
        否则"有意为之"和 bug 长得一模一样。 */
  var OPTION_ATTR = {
    /* ── 通用事件（20 个 · 60 个选项）── */
    'clash.mediate': { cul: 1 },          // 把用水的次序刻在石头上 —— 制度
    'clash.letfight': { mil: 2 },         // 打赢的吞下了另一座
    'clash.reroute': { prod: 1 },         // 挖一条河，用了几代人

    'resource.exploit': { prod: 2 },
    'resource.moderate': { prod: 1 },
    'resource.seal': { cul: 1 },          // 说留给以后 —— 克制本身成了规矩

    'plague.quarantine': { mil: 1 },
    'plague.heal': { cul: 1 },
    'plague.fate': { prod: -1 },          // 人口跌到三成，很久没涨回来

    'skyward.array': { sci: 2 },
    'skyward.omen': { cul: 2 },
    'skyward.ignore': { prod: 1 },        // 力气全用在了地上

    'schism.suppress': { mil: 2, cul: -1 },
    'schism.part': { cul: 1 },            // 两套说法各走各的，都活下来了
    'schism.thirdway': { sci: 1, cul: 1 },

    'recall.keepname': { cul: 2 },
    'recall.letgo': { cul: -1 },          // 不记住是谁做的
    'recall.markhim': { cul: 1 },

    'number.write': { sci: 1 },           // 划在石头上 —— 记录的办法
    'number.stopcount': { sci: -1 },
    'number.countall': { sci: 2 },

    'gatherplace.buildthere': { cul: 2 }, // 第一处不是用来住的地方
    'gatherplace.leaveit': null,          // 什么也不留下
    'gatherplace.useup': { prod: 1 },     // 力气集中到一处

    'sharp.finer': { sci: 1 },
    'sharp.enough': { sci: -1 },
    'sharp.teachfine': { cul: 1 },        // 把手艺传开

    'putdead.sameplace': { cul: 1 },
    'putdead.scatter': null,
    'putdead.burn': { cul: -2 },          // 没有留下任何一个旧名字

    'roadmade.widen': { prod: 1 },
    'roadmade.keepnarrow': null,
    'roadmade.blockit': { prod: -1 },     // 两边的地图从此不一样

    'barterlaw.written': { cul: 1 },      // 不必再认识对方 —— 制度
    'barterlaw.byword': null,
    'barterlaw.freely': { mil: 1 },       // 后来为换东西打过不止一次

    'meetother.learn': { sci: 2 },
    'meetother.apart': null,
    'meetother.pushout': { mil: 2, cul: -1 },

    'edge.drawline': { mil: 1 },
    'edge.noline': null,
    'edge.shareline': { cul: 1 },

    'sparehands.feedthem': { sci: 2 },    // 不生产的人做别的事 —— 分工
    'sparehands.sendback': { prod: 1 },
    'sparehands.lowthem': { mil: 1, cul: -1 },

    'onecode.mergeone': { cul: 2 },
    'onecode.keepmany': null,
    'onecode.burnold': { mil: 1, cul: -1 },

    'refuser.hearit': { cul: 1 },         // 规矩里多了一条是照他们说的写的
    'refuser.forcethem': { mil: 2 },
    'refuser.ignorethem': null,

    'hardyear.storerest': { prod: 2 },
    'hardyear.moveon': null,
    'hardyear.takemore': { prod: -1 },    // 能取的东西一直没有回来

    'uselesswork.buildit': { cul: 2 },    // 没有用处的东西 —— 文化
    'uselesswork.stopit': { prod: 1 },
    'uselesswork.manyit': { mil: 1 },     // 一座比一座高

    'oldways.newway': { sci: 2 },
    'oldways.keepold': { cul: 1 },
    'oldways.bothway': { sci: 1 },

    /* ── 纪元 4 通用（5 个 · 15 个选项）2026-09-23 ──
       ⚠️ 照规矩①「跟叙事走，不跟压力走」：判据是**这件事让他们的本事变了吗**。
          所以「由它去」「各围各的」这类**处境反应**写 `null` 或只给一点点，
          而"发明了办法""造出来了"才推。
       军事给得比别的属性多一点 —— 它原来只有 25，是四个数里的短板。 */
    'longlife.keeppush': { sci: 2 },              // 把寿命一年年往上推，这是本事
    'longlife.forall': { cul: 1, prod: 1 },       // 摊给所有人 —— 制度 + 家底
    'longlife.onlysome': { mil: 1, cul: -1 },     // 分出上下，两边不再是一回事

    'onepiece.keepgrow': { prod: 2 },             // 整片地盖起来
    'onepiece.breaksome': { cul: 1 },             // 留白成了规矩
    'onepiece.walled': { mil: 1 },                // 划线

    'onelang.letgo': null,                        // 什么也没做，本事没变
    'onelang.keepit': { sci: 1, cul: 1 },         // 录下来 —— 工具 + 认同
    'onelang.forceone': { mil: 2 },               // 不许说别的

    'bycalc.control': { prod: 1, sci: 1 },        // 让天气照算的走
    'bycalc.forecastonly': { sci: 1 },            // 只算：方法本身是本事
    'bycalc.letthem': { cul: 1 },                 // 各处自己定

    'nowild.keepclean': { mil: 1, prod: 1 },      // 清干净 + 全部自己种
    'nowild.leaveone': { cul: 2 },                // 留一片不碰 —— 克制成了认同
    'nowild.remakeit': { sci: 1, prod: 1 },       // 照着记录造回来

    /* ── 纪元 4 通用 · 第二批（5 个 · 15 个选项）2026-09-23 ── */
    'nonew.keepdig': { sci: 2 },                  // 还在往下找
    'nonew.teachall': { cul: 2 },                 // 把会的教出去 —— 传下去
    'nonew.stopsearch': null,                     // 不找了，本事没变

    'fullrecord.keepall': { cul: 2 },             // 一份都不扔
    'fullrecord.keepmain': { sci: 1, cul: -1 },   // 挑出主要的：方法变精，旧的不留
    'fullrecord.burnpart': { mil: 1, cul: -1 },   // 定期清一批

    'sameborn.letitbe': null,                     // 什么也没做
    'sameborn.keepdiff': { cul: 1 },              // 故意留下一批不一样的
    'sameborn.makeall': { mil: 1, prod: 1 },      // 全都一样 —— 统一 + 标准化

    'oldplace.restore': { cul: 2 },                 // 照记录修回来
    'oldplace.rebuild': { prod: 2 },                // 拆了重盖
    'oldplace.letfall': null,                       // 不去动它

    'noother.disarm': { cul: 1 },                 // 收起来成了规矩
    'noother.keepguard': { mil: 2 },              // 一直留着，一直有人看着
    'noother.meltdown': { prod: 2, sci: 1 },      // 熔了做别的



    /* ── 形态专属（8 个 · 24 个选项）—— 写的是"住处带来的处境" ── */
    'tide.followtide': null,
    'tide.buildhigh': { prod: 1 },
    'tide.usetide': { sci: 1 },           // 一半的工作由潮水来做

    'inland.settlemid': { prod: 1 },
    'inland.leavemid': null,
    'inland.crossit': { sci: 1 },         // 开出一条直路

    'height.stopup': null,
    'height.digdown': { prod: 2 },
    'height.moveaway': null,

    'dryland.digdeep': { prod: 2 },
    'dryland.moveoasis': null,
    'dryland.cutuse': { cul: 1 },         // 那条线一直守着，没越过一次

    'ice.followice': null,
    'ice.holdground': { mil: 1 },
    'ice.useground': { prod: 1 },

    'undergrowth.thincanopy': { prod: 1 },
    'undergrowth.liveup': { sci: 1 },
    'undergrowth.liveindark': null,

    'depth.cleart': { prod: 1 },
    'depth.sealit': { cul: 1 },           // 永久封住 —— 从此那是一处禁忌
    'depth.moveelse': null,

    'platform.builddown': { prod: 1 },
    'platform.stayout': null,
    'platform.abandondown': { sci: 1 },

    /* ── 性格专属（8 个 · 24 个选项）—— 让这个性格撞上它不擅长的局面 ── */
    'wantfight.keepcalm': { cul: 1 },     // 又谈成了
    'wantfight.givin': null,
    'wantfight.useforce': { mil: 2 },

    'stalemate.keepseige': { mil: 1 },
    'stalemate.withdraw': { prod: 1 },    // 把人收回来
    'stalemate.talkit': { cul: 1 },       // 里面的出来之后成了自己的一部分

    'unanswerable.keepask': { sci: 2 },
    'unanswerable.putaside': { prod: 1 },
    'unanswerable.forbidask': { mil: 1, sci: -1 },

    'noanswer.keepfaith': { cul: 2 },
    'noanswer.changeway': { sci: 1 },
    'noanswer.dropfaith': { cul: -2 },

    'foundus.hideaway': null,
    'foundus.tradethem': { prod: 1 },
    'foundus.jointhem': { sci: 1 },

    'stophere.moveon': null,
    'stophere.stayone': { prod: 1 },
    'stophere.buildhere': { prod: 2 },    // 头一回有固定的住处

    'baddeal.findother': { prod: 1 },
    'baddeal.reprice': null,
    'baddeal.stopdeal': null,

    'notgood.fixall': { prod: 1 },
    'notgood.selloff': null,
    'notgood.teachthem': { sci: 1 },      // 把人教会

    /* ── 大事件（10 条：9 条随机 + 界外之物 · **28 个选项**）──

       ⚠️ 这个数**改过三次，每次都是手抄抄错的**，所以连算式一起记下来：

          2026-09-17 原来写「12 个 · 35 个选项」→ 两个都对不上，
                     实测是 11 条 · 10×3 + 2 = 32 个（①`lookup` 还没删）
          2026-09-22 ①`lookup` 删掉 → 10 条 · 9×3 + 2 = 29 个
          ★ 2026-09-22 ⑧【换个位置】删掉（和【藏起来】重复）→
                     **10 条 · 28 个**（9 条随机里 ⑧ 只有 2 个：8×3 + 2 = 26，
                     再加界外之物那 2 个）。
       ⚠️ 别再手抄这个数了 —— `node -e` 遍历 `BIG_EVENTS` 数一遍就有。

       选项是"**观察者**做什么"，标的是**这一手把文明推成了什么样**。

       ⚠️ 玩家出手**不改变他们自己的选择**，但会改变他们变成什么样 ——
          所以这里有值。而「驱赶 / 无视」那两个（界外入侵）
          **没有值**：来的是外面的人，观察者做什么不改变他们的本事。 */
    // ⚠️ 2026-09-22：①`lookup` 删掉了，它这三行跟着删（见 BIG_EVENTS 那里的说明）。
    //    留着的话它们**永远不会被读到** —— 而且不报错，只是烂在表里。

    /* ⚠️⚠️ 规矩（2026-09-22 用户拍板）：**一手就能锁定结局的选项，不加属性** ⚠️⚠️

       判据是代码算得出来的，不是靠眼看：
           这一手自己的 marks 就够 `markReached` 的门槛
           （rise/split/watched/machine/contact 是 2，fall 是 3），
           或者带 `lockFate`（直接锁某个结局）。

       现在一共 **8 个**（每一行后面标了「锁 X」）：

         depart.release       rise:2     → 飞升
         stopped.closebook    lockFate   → 静滞
         mirror.hint          watched:2  → 被观测
         whatare.reply        watched:2  → 被观测
         lastbatch.letfinish  fall:3     → 寂灭
         lastbatch.remember   lockFate   → 轮回
         seent.appear         contact:2  → 抵达（信仰的话是仰止）
         handover.letgo       machine:2  → 飞升

       理由（用户原话）：「必定触发结局的不加属性」——
       结局已经被这一手定死了，属性推的那点分没有落点。

       ⚠️ 这 8 个里有 7 个本来是"有属性"的，2026-09-22 一次清掉了：
           depart.release 科技+1 · stopped.closebook 文化−1 · mirror.hint 科技+1
           whatare.reply 科技+1 · lastbatch.remember 文化+2
           seent.appear 文化+1 · handover.letgo 工业+2
           （lastbatch.letfinish 本来就是"不加"。）

       ⚠️ 要说清代价：属性不只管结局，它还**每帧减压力**（`Civ.reliefFor`）。
          清掉之后，"你推了他们一把"在数值上完全不落地了 ——
          只剩 marks、光暗值、压力三项。
       ⚠️ 以后**再加来源**时回来对一遍这张单子：一条 marks 到 2 的选项，
          按这条规矩就不该同时给属性。 */

    'depart.release': null,
    /* ★ 2026-09-22 用户拍板：人都留下来了，力气还在。 */
    'depart.hold': { prod: 1 },
    'depart.mark': { cul: 1 },

    /* ★ 2026-09-22 用户拍板：唤醒他们 = **科技 +1、工业 +1、文化 +1**。
       "推他们一把"就该看得出来，所以三样一起长。
       ⚠️ 它现在是单笔最大的一手（原来最大的两笔是 `elsewhere.confirm`
          科技+2 和 `handover.letgo` 工业+2）—— 但**这不是失控，是开始**：
          用户明确说了后面还要给别的事件加属性。
       ★ 顺带会**连锁**：这三样各加 1 之后，② 要的（科技≥2 且工业≥2）、
          ⑥ 要的（科技≥2 且文化≥3）、⑨ 要的（科技≥3 且文化≥3）
          都可能就够了 —— 「你推了他们一把，他们够得着更大的事了」。
       ⚠️⚠️ **实测副作用**：加上这一笔之后，「岔路口随机答」的真实崩溃率
          从 **26.3% 掉到 25.0%**（240 局，其余代码一字未动）——
          属性一高，`Civ.reliefFor` 减的压力就多，文明更不容易崩。
          这一笔是唯一的变量。**"给属性"和"调难度"是同一件事的两面**，
          以后每加一笔都要重新量一次崩溃率（`_civEvents_test.js` 的 K 段）。 */
    'stopped.wake': { sci: 1, prod: 1, cul: 1 },
    'stopped.waitsee': null,
    'stopped.closebook': null,

    'mirror.hint': null,
    'mirror.justwatch': null,
    'mirror.eraseold': { cul: -1 },

    'whatare.reply': null,
    'whatare.stayquiet': null,
    'whatare.unask': { sci: -1 },

    'elsewhere.confirm': { sci: 2 },
    'elsewhere.miscalc': { sci: -1 },
    'elsewhere.leaveit': null,

    /* ★★ 2026-09-22 用户拍板：**四个属性各 −2** ★★

       用户原话：「四个属性都减 2。人留下来了，但是自己把自己快打没了，
       所以社会倒退了」。

       ⚠️ 这一笔和别的"给属性"是反的 —— 它现在是**全项目最大的一次减值**
          （原来是 `whatare.unask` 和 `elsewhere.miscalc` 那种单项 −1）。
          四样一起塌，`Civ.reliefFor` 减掉的压力跟着掉，
          所以它**不锁结局，但把这一局往坏处推** —— 这正是用户要的
          「怎么样也不会有好结局」。
       ⚠️ 这一屏是"他们造出了能毁灭自己的武器"，**触发本身就是越线**。
          所以这里的"救"不是白救的：人保住了，文明退回去了。

       ⚠️ 结果行写过三版，最后是用户定的：
            ① 「此后的记录里，数量一直没变」      ← 只说人留下了，不提代价
            ② 「会做的东西忘掉了大半，城缩回了几代前的样子…」
               ← 按四样属性各写一个画面，45 字，**被否是因为太长**
            ③ ★「剩下的这一批没有再减少，**文明回到了几代前的样子**」
               （用户原话：「文明大幅度倒退意思到位就行」）
          ⚠️ 这一屏要的不是细节，是"倒退了很多"这一个判断。
             ③ 把"很多"落在一个具体的时间尺度上（几代前），
             比"大幅度"这种副词硬。
          ⚠️ 落脚点是「**文明**」不是「他们」：掉的是整个文明的水平，
             不是这一批人自己。 */
    'lastbatch.keep': { mil: -2, sci: -2, prod: -2, cul: -2 },
    'lastbatch.letfinish': null,
    'lastbatch.remember': null,

    'seent.appear': null,
    'seent.hide': null,

    'ending.moretime': { prod: 1 },
    'ending.holdline': null,
    'ending.sooner': { cul: -1 },         // 后面的记录少了一截

    'handover.letgo': null,
    'handover.stopmake': { prod: -1 },
    'handover.setlimit': { cul: 1 },      // 工具只是辅助，文明还握在自己手里

    'outsider.driveoff': null,            // 观察者的事，不改变他们的本事
    'outsider.ignore': null,

    /* ═══════════════════════════════════════════════════════════════
       ★ 物种专属（8 个物种 · 每个 5 个事件 · 共 120 个选项）
       ⚠️ 2026-09-17 改的数：原来写「8 个物种 · 5 个事件 · 105 个选项」——
          "8 个"和"105"凑不上（8×5×3 = 120）。真实情况是**分两处排的**：
          下面兽类到人族 7 组连排（7×15 = 105），外来者那 15 条在更下面。
       ═══════════════════════════════════════════════════════════════

       ⚠️ 这几个事件的**定义在 `civLore.js`**（`SPECIES[].events`），
          不在这个文件里 —— 但表还是集中在这一张，
          和 `OPTION_AXIS` 一样（一张表一眼看得完，好平衡、好加断言）。 */

    /* ── 兽类 · 兽群 ── */
    'kin.law': { cul: 2 },                // 规矩算数了
    'kin.kin': { mil: 1 },                // 规矩只对弱的那些支有效
    'kin.both': { cul: 1 },               // 别的支把这套办法记了下来

    'migration.go': { prod: 1 },          // 整群动了
    'migration.stay': { mil: 1 },
    'migration.half': { sci: 1 },         // 先派几支探路

    'hunt.rotate': { cul: 1 },            // 按季节换 —— 守住的规矩
    'hunt.claimit': { mil: 2 },
    'hunt.fewer': { prod: -1 },           // 把出生的数量压下来

    'leader.strongest': { mil: 2 },
    'leader.bybirth': { cul: 1 },
    'leader.byall': { cul: 2 },           // 由大家推 —— 认同更强

    'settle.letthem': null,
    'settle.bringback': { mil: 1 },
    'settle.jointhem': { prod: 1 },

    /* ── 虫类 · 巢群 ── */
    'swarm.cull': { prod: -1 },
    'swarm.expand': { prod: 2 },
    'swarm.restrain': { sci: 1 },         // 让一部分巢停止繁殖 —— 控制得了自己

    'onesmell.accept': { cul: 1 },
    'onesmell.diverge': { sci: 1 },       // 强行造出新气味
    'onesmell.dormant': null,

    'center.newworker': { sci: 1 },       // 让一批自己变个样子
    'center.slowstop': null,
    'center.scatterit': { cul: 1 },       // 每个巢自己管自己

    'winged.sendout': { sci: 1 },
    'winged.holdback': null,
    'winged.breedmore': { prod: 2 },

    'outside.absorb': { cul: 1 },
    'outside.driveoff': { mil: 2 },
    'outside.ignoreout': null,

    /* ── 石类 · 岩体 ── */
    'vein.move': { prod: 1 },
    'vein.deep': { prod: 2 },
    'vein.wait': { cul: 1 },              // 什么都不做，原地等着

    'crystal.let': { sci: 1 },
    'crystal.stop': null,
    'crystal.scatter': null,

    'fracture.closeit': null,
    'fracture.letopen': { sci: 1 },
    'fracture.wident': { prod: 1 },

    'seep.drinkit': { prod: 2 },
    'seep.sealoff': { mil: 1 },
    'seep.letin': { sci: 1 },

    'slowdown.waitit': null,
    'slowdown.pushhard': { prod: 2 },
    'slowdown.changeform': { sci: 1 },

    /* ── 海类 · 潮民 ── */
    'deepvent.warmthere': { prod: 1 },
    'deepvent.stayaway': null,
    'deepvent.mapping': { sci: 1 },       // 先记下位置

    'current.followit': null,
    'current.stayput': null,
    'current.digwarm': { prod: 1 },

    'song.oldsongs': { cul: 2 },
    'song.newonly': { cul: -1 },
    'song.manya': { cul: 1 },

    'shelllink.keeplink': { cul: 1 },
    'shelllink.cutpart': null,
    'shelllink.abandonit': null,

    'above.encourage': { sci: 1 },
    'above.forbid': null,
    'above.tradeup': { prod: 1 },

    /* ── 植类 · 林体 ── */
    'canopy.growup': { prod: 1 },
    'canopy.thinout': null,
    'canopy.twolayers': { sci: 1 },

    'root.pushthrough': { prod: 1 },
    'root.stopdepth': null,
    'root.around': { sci: 1 },            // 从旁边绕过去

    'burn.reseal': { prod: 1 },
    'burn.seedfirst': { prod: 1 },
    'burn.leaveburn': null,

    'newkind.spreadnew': { prod: 1 },
    'newkind.keepboth': { cul: 1 },
    'newkind.cutit': null,

    'bottom.feeddown': { cul: 1 },        // 送养分下去，维持着它们
    'bottom.letdie': null,
    'bottom.reuse': { prod: 1 },

    /* ── 灵能类 · 意群 ── */
    'onethought.keepdoing': { cul: 1 },
    'onethought.breakit': null,
    'onethought.spreadit': { sci: 1 },

    'leavebody.letthemgo': { sci: 1 },
    'leavebody.callback': null,
    'leavebody.keepbody': { sci: 1 },

    'twostreams.rejoin': { cul: 1 },
    'twostreams.keeptwo': null,
    'twostreams.onewins': { mil: 1 },

    'echo.answer': { sci: 1 },
    'echo.recordit': { cul: 1 },
    'echo.shield': null,

    'forgetbody.findthem': { sci: 1 },
    'forgetbody.letgo': null,
    'forgetbody.followthem': { sci: 1 },

    /* ── 人类 · 人族 ── */
    'archive.rewrite': { cul: 1 },        // 让还活着的人把记得的说出来
    'archive.blank': null,
    'archive.erase': { cul: -1 },

    /* ⚠️ `selfmake.let` 是「遗落」那条命运的第一个来源
       （`marks: { machine: 1 }`）—— 这里的 `prod: 2` 是有意的：
       工作全交出去之后，**做出来的东西反而更多了**，
       而人不再动手。能力涨了，人没了 —— 这正是那条命运要说的。 */
    'selfmake.let': { prod: 2 },
    'selfmake.keep': { prod: 1 },
    'selfmake.stop': { cul: 1 },          // 造工具的事留给人

    /* ── 商业（贸易型）── 定义在 civLore.js 的 humanoid 之外，见 trade 组 */
    'bigcity.letgrow': { prod: 1 },
    'bigcity.evenout': { prod: 1 },
    'bigcity.moveit': null,

    'coin.acceptit': { prod: 1 },         // 有一种东西当钱用 —— 流通
    'coin.barterstill': null,
    'coin.stopit': { cul: 1 },            // 回到原来的换法

    'school.fundit': { sci: 2 },          // 养着这些人，让他们一直教
    'school.fewteach': { sci: 1 },
    'school.familyteach': { cul: 1 },

    /* ── 外来者 · 录外（他们的母题是"和这颗世界对不上"）── */
    'sample.again': { sci: 2 },           // 再取一次，看是不是取错了
    'sample.writeit': { cul: 1 },         // 不追究原因，把差值记进档
    'sample.stopsample': null,

    'bound.buildbound': { mil: 1 },       // 把本地的东西挡在外面
    'bound.nobound': null,
    'bound.unbound': { cul: -1 },         // 连已经有的也拆了

    'mimic.letmimic': { sci: 1 },
    'mimic.forbid': null,
    'mimic.bothlife': { cul: 1 },

    'ledger.openit': { sci: 1 },
    'ledger.keepit': null,
    'ledger.burnit': { cul: -1 },         // 留下的东西越少越好

    'goback.letgo': null,
    'goback.holdback': { mil: 1 },
    'goback.allgo': { sci: 1 },

    /* ── ★ 修真彩蛋（12 个事件 · 24 个选项）2026-09-16 ──
       ⚠️⚠️ **全部显式写 `null`**，一个都不推 ⚠️⚠️
          用户拍板："事件不跟四属性挂钩，只跟生存压力挂钩"。
          写 `null` 不是偷懒 —— 它和"忘了标"必须分得开，那正是
          这张表存在的意义（见上面规矩②）。
       ⚠️ 四属性在这条线上**照常滚动**（起点 + 文化自然增长），
          只是不显示（界面写「？？？？」）、不减缓压力
          （`stepCiv` 里对彩蛋把 `c.relief` 显式置 0）。 */
    'xiuSit.dengTa': null,        'xiuSit.beiXiaLai': null,
    'xiuMark.moDiao': null,       'xiuMark.liuZhe': null,
    'xiuFast.guanZhe': null,      'xiuFast.weiTaMen': null,
    'xiuRule.dingGuiJu': null,    'xiuRule.shuiDouJiao': null,
    'xiuFurnace.mieHuo': null,    'xiuFurnace.kaiLu': null,
    'xiuSail.songTaMen': null,    'xiuSail.lanZhu': null,
    'xiuThunder.biKai': null,     'xiuThunder.yingShang': null,
    'xiuStill.shouZhe': null,     'xiuStill.jiaoTa': null,
    'xiuSplit.fenKai': null,      'xiuSplit.bingCheng': null,
    'xiuAscend.songTa': null,     'xiuAscend.lanTa': null,
    'xiuSpring.jieShang': null,   'xiuSpring.banZou': null,
    'xiuRift.zhaoJiu': null,      'xiuRift.shangQu': null
  };

  /**
   * 这个选项把四属性推成什么样。返回 `{mil?…}`，不需要推的返回 `null`。
   *
   * ⚠️ 表里没有的返回 `null`（兜底），但**有一条断言要求每个选项都在表里** ——
   *    兜底只是保险，不是可以偷懒的地方。
   * ⚠️ 它返回的是**表里那一项本身**，调用方**不许就地改**它 ——
   *    那是模块级常量，改了会串到后面每一局（和 `fillDeep` 是同一个坑）。
   */
  function attrDeltaOf(eventKey, optionKey) {
    var k = eventKey + '.' + optionKey;
    return (OPTION_ATTR[k] !== undefined) ? OPTION_ATTR[k] : null;
  }

  /**
   * 把一组属性增减落到文明身上。**四属性的唯一写入点**。
   *
   * ★ 2026-09-23 抽出来的。起因：「界外之物 · 帮助」那一支要给
   *   科技 +2 / 生产 +2（用户拍板），而它**不是选项**（不挂在任何事件上），
   *   所以 `apply` 那条路走不到它。
   *
   * ⚠️⚠️ 当时的另一个做法是在 `resolveVisitHelp` 里直接改 `civ.attr` ——
   *    **没选它**：那样全项目就有**四个**写属性的地方（起点 / 事件推拉 /
   *    文化自然增长 / 界外来访），以后"哪些地方会改这四个数"就再也数不清了。
   *    收进这里之后，**写入点还是三处**，第四处只是调用。
   *
   * ⚠️ 直接读写 `world.civ.attr` 是**安全的**：`beginCiv` 已经调过
   *    `Civ.attrOf` 兜过底，走到这里它一定存在。
   *    下限由 `Civ.attrOf` 在读的时候统一夹住（不在这里夹 ——
   *    免得几个写入点各夹一遍、漏一处）。
   *
   * @param {object} world
   * @param {object|null} delta 形如 `{ sci: 2, prod: 2 }`；null / 空 → 什么都不做
   * @returns {boolean} 真的写进去了没有（调用方拿它做断言）
   */
  function applyAttr(world, delta) {
    if (!world || !delta || !world.civ || !world.civ.attr) return false;
    var a = world.civ.attr, wrote = false;
    for (var k in delta) {
      if (typeof delta[k] !== 'number') continue;
      a[k] = (a[k] || 0) + delta[k];
      wrote = true;
    }
    return wrote;
  }

  function apply(world, eventKey, optionKey) {
    // ⚠️ byKey 的签名是 (world, key) —— 必须传 world，
    //    否则找不到物种专属事件，apply 返回 null，
    //    于是 pending 永远清不掉、世界永远冻在那个面板上。
    var opt = optionOf(byKey(world, eventKey), optionKey);
    if (!opt) return null;

    // ① 光暗值
    if (opt.light) {
      world.light = Math.max(-100, Math.min(100, world.light + opt.light));
    }

    // ② 命运倾向
    if (opt.marks && !world.civMarks) {
      world.civMarks = { rise: 0, fall: 0, split: 0, watched: 0, machine: 0 };
    }
    if (opt.marks) {
      for (var m in opt.marks) {
        world.civMarks[m] = (world.civMarks[m] || 0) + opt.marks[m];
      }
    }

    /* ③ 压力（来古士的「黑潮」）—— 负数是买时间，正数是欠债
       ⚠️ 改的是**偏移量**，不是压力本身 ——
          压力每帧由"进度 + 偏移"重算（见 evolution.js 的 stepCiv）。
          直接改压力的话，下一帧就被重算覆盖掉了。

       ★★ 2026-09-13：偏移现在记到**这个选项自己那条线**上 ★★
          （三条线见 civLore.js 的 ENDURE，对照表见上面的 OPTION_AXIS）

          ⚠️⚠️ 这个功能 2026-09-13 早些时候**被整个删掉过一次**，
             是用户后来指出删错了 —— 当时要把结局面板上那三个数
             （资源/环境/分歧）去掉，**显示该删，但机制不该跟着删**。
             当时的删除理由（"31% 的局三个数都在 ±10 内"、"哪科最大
             被事件数量扭曲"）**全都是关于显示的**，没有一条反对机制。
             教训：**"删显示"和"删机制"是两件事，别打包成一个选项**，
             否则用户选的是前者，删掉的是后者。

          ⚠️ 当时我在注释里写过一句"想加回来的话 git 里有"—— 那是**错的**，
             加和删在同一批工作里做完、中间没提交，git 里根本没有。
             现在这张 OPTION_AXIS 表是**重新标**的。 */
    var c = world.evo && world.evo.civ;
    if (opt.pressure && c) {
      var ax = axisOf(eventKey, opt.key);
      c.shift[ax] = (c.shift[ax] || 0) + opt.pressure;
    }

    /* ③.5 ★ 四属性（2026-09-15）——
       生灵挑中的这一条把文明往某个方向推一点（对照表见 OPTION_ATTR）。

       ⚠️⚠️ 这里**改的是属性本身**，不是偏移 —— 和上面 ③ 是两码事：
           · `c.shift` 是"这一局累计欠了多少压力"，直接进压力公式
           · 属性是**长期资产**，它减缓压力的那部分由 `Civ.reliefFor`
             每帧从属性**现算**（见 stepCiv），不在这里落地
       两笔账分开记，是因为它们的"半衰期"完全不同：
       偏移跟着这一局走，属性跟着这个文明走（终结时还要用）。

       ⚠️ 直接读写 `world.civ.attr` 是**安全的**：
          `beginCiv` 已经调过 `Civ.attrOf` 兜过底，走到这里它一定存在。
          下限由 `Civ.attrOf` 在读的时候统一夹住（不在这里夹，
          免得四个写入点各夹一遍、漏一处）。 */
    if (world.civ && world.civ.attr) {
      /* ★ 2026-09-23：改成走 `applyAttr` —— 写属性这件事只有那一个地方。
         ⚠️ 行为一个字没变（原来那三行就是它现在做的事）。 */
      applyAttr(world, attrDeltaOf(eventKey, opt.key));
    }

    // ④ 编年史的长短（文案里承诺的"慢了一截"/"技术进步一大截"）
    // ⚠️ 下限写成 time + 5 而不是 5：
    //    事件表的触发时刻是按**原来的**总时长排的，
    //    如果一次 -12 把总时长砍到比当前进度还短，
    //    后面还没触发的事件就全被跳过了。留 5 秒缓冲。
    if (opt.slow && c) {
      c.duration = Math.max(c.time + 5, c.duration + opt.slow);
    }

    /* ═══════════════════════════════════════════════════════════════
       ★★ `lockFate` —— 观察者**一手把结局定死** ★★
       ═══════════════════════════════════════════════════════════════

       `lockFate` 的值是**一个 `FATES` 的 key**，现在有两个用户：

         stopped.closebook   lockFate: 'stillness'  → 静滞（2026-09-21）
         lastbatch.remember  lockFate: 'cycle'      → 轮回（2026-09-22）

       ⚠️ 2026-09-22 之前它叫 `halt: true`（布尔），只锁得死静滞。
          加「抹除文明 → 轮回」的时候**直接把它改成"填结局 key"**——
          再挂一个平行的布尔戳就是**两把尺子**，迟早分叉。
          ⚠️ 所以 `world.halted` 这个字段**没有了**，现在是
             `world.lockedFate`（存 key 的字符串）。

       ── 它和 `invaded` 是同一个形状 ──
       在世界上盖一个戳，结局判定（`ending.js` 的 `fate`）读到它就提前 return。
       ⚠️ 2026-09-22 晚起**连"提前收尾"也是**：`evolution.js` 的 `stepCiv`
          一读到它就当场切进预兆期（预兆只放 `LOCK_OMEN_SEC`，5 秒），
          和 `invaded` 那一段是照抄的关系。

       ⚠️⚠️ 2026-09-22 晚：下面两条**当天都被推翻了**，留着当墓碑 ⚠️⚠️

          · 原来写：「不新增"立刻跳到结局画面"的机制 —— 两个结局的 desc 都说了
            『记录一直写到观测结束』，所以这一局**照常跑完**，只是结局已经定了。」
            **这条理由不成立**：用户要的是"锁了就不该再进别的结局"，
            而"照常跑完"的实际结果是——锁完又跳几个大事件、过了一会才跳结局，
            那正是他报上来的现象。
            ⚠️ 「记录一直写到观测结束」是**静滞的 desc**，现在它和"锁"这一支
               对不上了 —— 那是**已知待办**，还没改（改了要通知用户）。

          · 原来写：「它**排在四属性层之前、死活档之后**」。
            现在是 **1.7 档**（仅次于破碎 / 收割），理由见 `ending.js` 那一段：
            "锁"是**玩家亲手点的判决**，不是"世界后来出了什么事"。
            ⚠️ 后果：这两条锁**现在盖得过寂灭和光暗极端**（旧顺序下盖不过）——
               这是那次改动量出来的账，写在 `docs/SYSTEMS.md` 的 2.7 节末尾。

       ⚠️⚠️ **一局里两条锁同时碰上时，后面那条覆盖前面那条** ——
          `world.lockedFate` 只有一个字段。这也是**确定性**的
          （事件顺序确定），但不是谁"优先"，是"谁最后写"。
          真要定优先级，得像「仰止」那样单独立一条判定，别指望这里。
       ⚠️ 值写错（拼错的 key）在 `ending.js` 里**会被跳过**、静默落回
          四属性层 —— 所以 `_civEvents_test.js` 有一条断言逐个查
          `lockFate` 的值是不是真的 `FATES` key。 */
    if (opt.lockFate) world.lockedFate = opt.lockFate;

    /* ═══════════════════════════════════════════════════════════════
       ⑤ ★★ 界外入侵：结果不是一定的，但**判定是确定性的**
          （2026-09-14 加，2026-09-15 从掷骰改成判定）★★
       ═══════════════════════════════════════════════════════════════

       只有界外来访的「无视」带 `invaded: true` 这个字段：
       落下这个世界级标记，再由下面那一支判"扛没扛住"。

       ⚠️⚠️ 判定必须在**这一刻**做，不能挪进 ending.js 的 fate() ⚠️⚠️

          `fate()` 会被调用**多次** —— 预兆期开始算一次（evolution.js
          stepCiv），结局面板又读一次（`evaluate` 优先用存下来的那个，
          但 `fate` 本身是公开的，测试也在调）。判定里只要混进任何
          "会变的东西"（随机数，或者哪天改成读一个中途会改的数值），
          同一局就会算出不同结果。

          **在写入标记的这一刻判一次**，之后就只是一个布尔值了：
          读多少次都是同一个答案。和「命运只在进预兆期那一刻定下来」
          是同一条纪律（见 evolution.js 里那段说明）。

       ⚠️⚠️ 2026-09-17 修的：这一整段原来讲的是「**掷一次 3% 的骰子**」
           （`opt.resist`），而且用现在时写着"带这两个字段"——
           可那个字段 2026-09-15 就删了，**紧跟在下面的新注释自己写着
           "从掷骰改成确定性判定"**。一块注释前后打架，
           谁照前半段改就会把抵抗改回随机、推进随机序列、
           让测试 L8 的"确定性"断言当场红。
           **现在只有一件事要记住：判定规则见下面 `opt.invaded` 那一支
           和 `RESIST_NEED`，一点随机都没有。**

       ⚠️ 扛住了**要换一句编年史**，不能只加个"但是" ——
          "没扛过去"和"扛过去了"是两件事，不是同一件事的两种语气。
          ⚠️ 必须返回**副本**：`opt` 是模块级常量表里那一项，
             就地改会把这一局的族名填进表里，之后每一局都读到它
             （和 fillDeep 那段是同一个坑）。 */
    if (opt.invaded) {
      /* ★★ 2026-09-15：从**掷骰**改成**确定性判定** ★★
         —— 军事 + 科技 + 生产 > `RESIST_NEED` 就扛住了（门槛的来由见它那儿）。

         ⚠️ `opt.resist` 那个字段**整个删掉了**（决策 #61：删掉它行为不变
            就是维护成本）。`chronicleResist` **留着** —— 它就是这一分支
            换上去的那句话，还得用。

         ⚠️ 直接读 `world.civ.attr` 是安全的：`beginCiv` 已经调过
            `Civ.attrOf` 兜过底，走到这里它一定存在。
            （civEvents 不依赖 civ.js —— 少一次 DEPS 表的同步风险。）

         ⚠️⚠️ **文化不算在内**，这是用户定的、有意的 —— 见 RESIST_NEED 那段。
         ⚠️ 幂等：这一支只写一次 `world.invaded`，之后 fate() 读多少次
            都是同一个答案（原来掷骰就必须挤在"写入标记的那一刻"，
             现在**连那个约束都不需要了** —— 判定完全可以重放）。 */
      var ra = world.civ && world.civ.attr;
      var power = ra ? (ra.mil || 0) + (ra.sci || 0) + (ra.prod || 0) : 0;

      if (power > RESIST_NEED) {
        var copy = {};
        for (var kk in opt) copy[kk] = opt[kk];
        copy.chronicle = opt.chronicleResist;
        return copy;
      }
      world.invaded = true;
    }

    return opt;
  }

  /**
   * ★★ 修真彩蛋的一次对抗（2026-09-16）★★
   * ─────────────────────────────────────────────
   * 独占池那条线的小事件走这里，**不走 `apply`**。规则是用户定的：
   *
   *   · 小事件一律**二选一**；
   *   · **骰子**决定这一手成没成（`chance` = 成功率，百分数）；
   *   · 成了 → 压力减一点；**没成 → 压力加一截**；
   *   · 压力**只走一条线**（全部记在 `shift.drain` 上）。
   *
   * ⚠️ 契约和 `apply` 的第⑤段一样：**返回选项的副本**，
   *    结果那一行放在副本的 `chronicle` 里。
   *    编年史**不在这里推** —— `pushRow` 在 evolution.js，
   *    civEvents 不许依赖它（依赖方向是单向的）。
   *
   * ⚠️⚠️ 必须返回**副本** ⚠️⚠️
   *    `opt` 是模块级常量表（`CivLore.SPECIES`）里那一项。就地改
   *    `opt.chronicle` 会把这一局的结果**写回表里**，之后每一局都读到它 ——
   *    和 `fillDeep`、`apply` 第⑤段是同一个坑。
   *
   * ⚠️ 幂等：掷骰只在这里发生一次，而每个事件在时间轴上**只到点一次**
   *    （由 `c.smalls` 的顺序决定，和帧率无关）——
   *    同一颗世界重玩一遍，成没成是一样的。
   *    ⚠️ **别把它挪进 `Ending.fate()`**，那里会被调用多次。
   *
   * @param {object}   world
   * @param {object}   def       事件定义（`{key,title,options:[…]}`）
   * @param {string}   optionKey 他们挑中的那一手
   * @param {function} rng       彩蛋自己那条随机源（`c.xiuRng`）
   * @returns {object|null} 选项副本（`chronicle` 已换成成 / 败那一句，
   *                        外加 `ok: true/false`，给测试和探针读）
   */
  function resolveXiu(world, def, optionKey, rng) {
    var c = world && world.evo && world.evo.civ;
    if (!c || !def || !rng) return null;

    var opt = optionOf(def, optionKey);
    if (!opt) return null;

    /* ── ① 掷骰 ──
       `chance` 是 0~100 的整数。写 100 就是"必定成"、0 就是"必定不成"——
       两端都合法（`_civEvents_test.js` 拿它们验两头）。 */
    var ok = (rng() * 100) < (opt.chance || 0);

    /* ── ② 压力**只走一条线** ──
       全部记在 `shift.drain` 上。三条线的字典形状照用 ——
       `sumShift` / `worstLine` / `pressureOf` / `willCollapse` 一行都不用改，
       也就不会出现"两把尺子"。
       （这条线的 `burstLine` 因此恒为 `drain`，而它在彩蛋里没人读：
         结局判定在 `civCollapsed` 那一段之前就被 `isEgg` 拦掉了。） */
    var dp = ok ? (opt.pressureWin || 0) : (opt.pressureLose || 0);
    if (dp) c.shift.drain = (c.shift.drain || 0) + dp;

    /* ── ③ 换掉编年史那一行（返回副本，见上面那条红线） ── */
    var copy = {};
    for (var k in opt) copy[k] = opt[k];
    copy.ok = ok;
    copy.chronicle = ok ? opt.chronicleWin : opt.chronicleLose;
    return copy;
  }

  /* 倾向是否攒够了 —— 结局判定用（见 ending.js） */
  function markReached(world, mark) {
    var need = (MARK_MIN[mark] !== undefined) ? MARK_MIN[mark] : MARK_THRESHOLD;
    return !!(world.civMarks && world.civMarks[mark] >= need);
  }

  /* ═══════════════════════════════════════════════════════════════
     ★ 2026-09-13：选择权从「观察者」交还给「生灵」
     ═══════════════════════════════════════════════════════════════
     用户的原话：

     > 「文明阶段选择权应该交给生灵选择而不是观察者」

     **为什么必须改**：玩家扮演的是**观察者**（见 CLAUDE.md 第一节），
     而"观察者替文明做决定"是**操纵**，不是观察 —— 机制和设定打架。
     这和「机械类不能自己长出来」是同一类问题：
     **机制违反了游戏自己的因果律。**

     ── 改法 ──
     事件弹出时，**由文明按自己的性格挑**，观察者只是看着。

     **但观察者的手没有变少，是变深了**：
       ① 投放元素（光种 / 暗种 → 光暗值）
       ② 两道岔路口（海洋 / 生态 —— ⚠️ 原来还有第三道
          「文明崛起 → 和平/征战/求知」，2026-09-14 删掉了，现在是两道）
     这两只手塑造的正是「**他们会怎么选**」——
     你不决定这一次，你决定他们是什么样的人。

     ── 怎么挑 ──
     每个选项可以标一个 `lean`（哪个性格的生灵更可能这么选）。
     没标 = 谁都可能选。标了 = 按性格加权。
     目标是**大约四分之三**的时候能猜中他们的选择 ——
     太准没惊喜，太随机就看不出性格。
     ═══════════════════════════════════════════════════════════════ */

  /* 性格对选项的加权。
     ⚠️ 这个数调的是**"看得出性格"和"有意外"之间的平衡**：
        太大 → 选了征战就必然打仗，性格把结果锁死（踩过这个坑，
               见 civLore 的 ENDURE 那段）
        太小 → 看不出来他们是征战型的
        4 是手感的起点，实测见 _civEvents_test.js 的分布。 */
  var LEAN_PUSH = 4;

  /* ═══════════════════════════════════════════════════════════════
     ★★ 2026-09-16：军事这一路「被锁在征战型后面」的修正 ★★

     起因是用户的一句「军事涨的好慢，是不是事件链断了」。量完（`_attr_probe.js`
     736 局）发现：**链子没断，是偏科** ——
       · 军事每局只被推 0.92 次（生产 1.39 / 文化 1.53）
       · ★ **52% 的局，军事从头到尾一次都没被推过**（生产 25%、文化 16%）
       · 结局方向：生产 32% / 文化 32% / 科技 13% / **军事 12%**

     根因不在推拉表（`OPTION_ATTR`）本身，在 **`lean`**：
     24 个推军事的选项里，**20 个都标着 `war`** —— 而征战型只占 5% 的局。
     换句话说，**军事的推力全押在了最稀有的那种性格身上**。

     ★ 改法是**只加不减**（底下 14 处）：给那些选项补上"其实也会这么做"的
       另外几种性格。**`war` 一个都没摘** —— 摘了没依据，而且征战型本来就该
       最常做这些事；加的每一处都能从选项文案里指出来（见各自的注释）。

     ⚠️ `lean` 是**强承诺**，不是"也有可能"：同一道题里只有一个选项偏向某个
        性格时，那个性格约 **70%** 会选它（实测见 `_civEvents_test.js`）。
        所以每一处都按「这个性格的人就是这么做的」的标准来加，
        不是为了凑数字军事实在太低 —— 那等于拿标签骗概率。

     ⚠️ 这一改**会让旧种子的编年史变样**：抽签用的随机序列一位没动
        （`pickOption` 永远先抽一次），但"抽到之后挑哪个"变了，
        于是同一颗世界会长出不同的历史行和不同的压力偏移。
        和"加物种"是同一类副作用，上线前无所谓。 */


  /**
   * 这个文明自己会选哪一个。
   *
   * @param {object} world
   * @param {object} event  事件定义
   * @param {function} rng  ★ 必须是**世界种子派生**的随机源，
   *                        而且**只能是 `evo.civ.pickRng`**。
   *
   * ⚠️⚠️ 2026-09-17 修的：这里原来写的是「用 evo.civ.omenRng」——
   *     **那是错的，照它改会改坏。** 实际调用点传的是 `pickRng`
   *     （见 `core/evolution.js` 的 `resolveSmall`），而 `beginCiv` 那段
   *     专门警告过「pickRng 和 omenRng **不能共用**」：
   *     征兆多弹一条就会把整条序列推后一格，于是"他们下一次会怎么选"
   *     跟着变 —— **同一个种子重玩，历史会长得不一样**。
   *     一句话：两个随机源各管各的事，混用 = 红线「同种子 = 同世界」当场废掉。
   *     （`docs/SYSTEMS.md` 里写的是对的，只有这处注释是错的。）
   * @returns {string} 选项的 key
   */
  function pickOption(world, event, rng) {
    var temper = (world && world.civ) ? world.civ.temper : null;
    var opts = (event && event.options) || [];
    if (!opts.length) return null;

    var weights = [], total = 0, i;
    for (i = 0; i < opts.length; i++) {
      var w = 1;
      var lean = opts[i].lean;
      if (temper && lean) {
        var likes = (lean instanceof Array) ? lean : [lean];
        for (var j = 0; j < likes.length; j++) {
          if (likes[j] === temper) { w += LEAN_PUSH; break; }
        }
      }
      weights.push(w);
      total += w;
    }

    var r = rng() * total;
    for (i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return opts[i].key;
    }
    return opts[opts.length - 1].key;   // 浮点兜底
  }

  return {
    EVENTS: EVENTS,
    BIG_EVENTS: BIG_EVENTS,         // ★ 大事件（观察者出手，见上面那一大段）
    /* ★ 2026-09-13：选项 → 压力线 的对照表。
       导出来是给 `_civEvents_test.js` 遍历用的 ——
       它要验"每个选项都标了轴""三条线的题量别差太远"。 */
    OPTION_AXIS: OPTION_AXIS,
    axisOf: axisOf,

    /* ★ 2026-09-15：选项 → 四属性 的对照表。
       同样是导出来给 `_civEvents_test.js` 遍历的 ——
       它要验"**每个选项都在表里**"（写 `null` 和"忘了标"必须分得开）。 */
    OPTION_ATTR: OPTION_ATTR,
    attrDeltaOf: attrDeltaOf,
    /* ★ 2026-09-23：四属性的**唯一写入点**。抽出来是给「界外之物 · 帮助」
       那一支用的 —— 它不是选项，`apply` 那条路走不到它。
       见 `applyAttr` 上面的说明。 */
    applyAttr: applyAttr,

    /* ★ 2026-09-15：抵抗门槛。导出来是给 `_civEvents_test.js` 用的 ——
       它要验"不到门槛一定扛不住、过了门槛一定扛得住"（不再有随机）。 */
    RESIST_NEED: RESIST_NEED,
    MARK_THRESHOLD: MARK_THRESHOLD,
    MARK_MIN: MARK_MIN,             // 单个倾向放低门槛用的（见上面）
    LEAN_PUSH: LEAN_PUSH,
    SMALL_INTERVAL: SMALL_INTERVAL,
    BIG_INTERVAL: BIG_INTERVAL,
    /* ⚠️ 2026-09-17：`SMALL_SLOTS` 那个导出删了 —— 真死代码，
       见它原来那一行的说明。 */

    /* ★ 2026-09-14：界外来访（那条线的批 2）。
       `VISIT` 里是概率和「帮助」那两行文案 —— 导出来是因为
       `_style_test.js` 只收得到表里的字符串（写在逻辑里的收不到），
       而 `_civEvents_test.js` 要按它验概率和"只对投放过的世界生效"。 */
    VISIT: VISIT,
    planVisit: planVisit,

    byKey: byKey,
    optionOf: optionOf,
    fits: fits,
    placeByEra: placeByEra,
    schedule: schedule,
    scheduleBig: scheduleBig,
    pickBig: pickBig,       // ★ 到点现场挑（取代了排期抽签）
    /* ★ 2026-09-21：门槛里的**属性那一半** —— 由 `evolution.js` 在
       **大事件到点那一刻**调用（排期时判会判错，见它的说明）。 */
    gateAttrsOK: gateAttrsOK,
    apply: apply,
    resolveXiu: resolveXiu,         // ★ 修真彩蛋那条线自己的结算（二选一 + 骰子）
    markReached: markReached,
    pickOption: pickOption          // ★ 文明自己挑（见上面那段）
  };
});
