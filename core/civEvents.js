/* ═══════════════════════════════════════════════════════════════════
   ⑥ CivEvents —— 文明事件
   ═══════════════════════════════════════════════════════════════════
   职责：文明编年史里随机弹出的事件，每个 2-3 个选项，玩家做选择。

   ⚠️ 2026-09-12 重做后有了第二个来源：**物种专属事件**。
      它们放在 core/civLore.js 里（和那个物种的历史行、征兆待在一起）——
      一个物种的所有内容在一块儿才好维护。
      本文件只负责"把两边的池子合起来抽签"和"把选择落到世界上"。

   和「演化路线选择」（core/choices.js）是**两套不同的东西**：
     · choices.js   —— 三道**固定的**岔路口，一定会在固定阶段弹
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
       它的门槛单独放低到了 1（见 MARK_MIN）。这里再加一条的话，
       「遗落」会从"人类专属的稀有条目"变成烂大街的结局。
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

    /* ── ① 他们开始仰望 ──
       观察者的三种动作：回应 / 沉默 / 抹去。

       ⚠️⚠️ key 是 `lookup` 不是 `skyward` —— 别改回去 ⚠️⚠️
          `skyward` 已经被**通用小事件**占了（「文明仰望星空」）。
          两边的 key 一撞，`byKey` 先搜到小事件那个，
          于是**大事件显示的是小事件的内容** —— 而且不报错，
          只是标题、问题、选项全串了。
          （2026-09-13 实测踩到：演示里大事件弹出来写着「文明仰望星空」，
            选项是「建观测阵列 / 当作神谕 / 不予理会」。）
          `_civEvents_test.js` 现在有一条断言扫两张表的重名。 */
    {
      key: 'lookup',
      era: 4,
      title: '{folk}开始仰望',
      question: '{folk}第一次把观测的对象从地面转向天顶。后来的每一代都有人在做这件事。',
      options: [
        {
          key: 'reveal',
          label: '降下启示',
          blurb: '让{folk}知道有人在看',
          light: +12, marks: { watched: 2 }, pressure: +4,
          chronicle: '{folk}里有一批开始朝同一个方向走。他们说不出来为什么，只是走了。'
        },
        {
          key: 'silence',
          label: '保持沉默',
          blurb: '不回应，让{folk}自己找',
          light: +4, marks: {}, pressure: -8,
          chronicle: '没有回应。{folk}继续追问，一代接一代。'
        },
        {
          key: 'erase',
          label: '抹去这段',
          blurb: '让它没有发生过',
          light: -14, marks: { fall: 1 }, pressure: +10,
          chronicle: '{folk}把这一段抹掉了。从此没有人再记录天上。'
        }
      ]
    },

    /* ── ② 他们要离开 ──
       观察者拦不拦。 */
    {
      key: 'depart',
      era: 4,
      title: '{folk}要离开',
      question: '{folk}造出了能离开地表的东西。第一批上去了，没有回来。',
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
        {
          key: 'mark',
          label: '留下记号',
          blurb: '让后来的人知道发生过',
          light: +8, marks: { watched: 1 }, slow: +8,
          chronicle: '{folk}在出发的地方留下了一个记号。往后经过的人会看到它。'
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
      key: 'stopped', era: 4,
      title: '{folk}停下来了',
      question: '{folk}停止了一切活动。没有消失，只是不再做任何事。',
      options: [
        { key: 'wake', label: '唤醒他们', blurb: '推一把',
          light: +12, marks: { watched: 1 }, pressure: +6,
          chronicle: '有一处动了一下。他们重新开始做事，做的和以前不一样。' },
        { key: 'waitsee', label: '再等等', blurb: '也许他们会自己动',
          light: +4, marks: {}, pressure: -8,
          chronicle: '他们一直没有动。往后的记录越来越慢，越来越短。' },
        { key: 'closebook', label: '合上这一页', blurb: '不再记录',
          light: -14, marks: { fall: 2 }, pressure: +10,
          chronicle: '这一段之后没有内容。观测到此为止。' }
      ]
    },
    {
      key: 'mirror', era: 4,
      title: '{folk}重复了',
      question: '记录里，{folk}做的事和很久以前一模一样。连顺序都一样。',
      options: [
        { key: 'hint', label: '留一样东西', blurb: '让他们见到没见过的',
          light: +10, marks: { watched: 2 }, slow: +8,
          chronicle: '有一批东西出现在了他们没去过的地方。后来的做法和前面接不上了。' },
        { key: 'justwatch', label: '看着', blurb: '不插手',
          light: +2, marks: {}, pressure: -6,
          chronicle: '他们又重复了一遍。同样的这一遍，后来重复了四次。' },
        { key: 'eraseold', label: '删掉旧记录', blurb: '让他们没有可重复的',
          light: -12, marks: { split: 1 }, pressure: +8,
          chronicle: '{folk}把旧的那一段删掉了。此后他们做的事接不上前面。' }
      ]
    },
    {
      key: 'whatare', era: 4,
      title: '{folk}问自己是什么',
      question: '{folk}里第一次有人问：我们是什么。从前没有人问过这句话。',
      options: [
        { key: 'reply', label: '回答他们', blurb: '让他们知道',
          light: +14, marks: { watched: 2 }, pressure: +4,
          chronicle: '有一处给了回应。从那以后，他们的问题变多了。' },
        { key: 'stayquiet', label: '不回答', blurb: '让他们自己找',
          light: +4, marks: {}, pressure: -8,
          chronicle: '没有回答。那个问题一直被问着，问了十几代。' },
        { key: 'unask', label: '让问题消失', blurb: '抹掉它',
          light: -16, marks: { fall: 1 }, pressure: +10,
          chronicle: '那个问题不再出现。再没有人问过同样的话。' }
      ]
    },
    {
      key: 'elsewhere', era: 4,
      title: '{folk}推出了别处',
      question: '{folk}把记录翻了上百遍，算出一件事：别的地方，应该也有和他们一样的。',
      options: [
        { key: 'confirm', label: '确认它', blurb: '让他们算对',
          light: +12, marks: { rise: 1, watched: 1 }, slow: +8,
          chronicle: '那边回了一次。往后每一座城都在朝那个方向建，越建越高。' },
        { key: 'miscalc', label: '让他们算错', blurb: '偷偷改掉一个数',
          light: -10, marks: { fall: 1 }, pressure: +6,
          chronicle: '那一段推算里少了一个数。此后再没有算出同样的结果，翻来覆去总是差一点。' },
        { key: 'leaveit', label: '什么都不做', blurb: '由它去',
          light: +4, marks: {}, pressure: -6,
          chronicle: '那条推算一直停在纸上。没有一件事因为它而改。' }
      ]
    },
    {
      key: 'lastbatch', era: 4,
      title: '只剩最后一批',
      question: '{folk}的数量一直在减少。现在只剩最后一批。',
      options: [
        { key: 'keep', label: '留住这一批', blurb: '不再少下去',
          light: +14, marks: { watched: 1 }, pressure: -10,
          chronicle: '剩下的这一批没有再减少。此后的记录里，数量一直没变。' },
        { key: 'letfinish', label: '让他们走完', blurb: '不拦',
          light: +6, marks: { fall: 2 }, pressure: -4,
          chronicle: '最后一批走完了。后来的记录里，没有他们的内容。' },
        { key: 'remember', label: '把记录留下', blurb: '让记录比他们久',
          light: +10, marks: { watched: 2 }, slow: +10,
          chronicle: '{folk}把记录单独放在了一处。它比他们本身留得久。' }
      ]
    },
    {
      key: 'seent', era: 4,
      title: '{folk}朝一个方向发信号',
      question: '有一处位置，{folk}反复朝那里发出信号。{folk}认定那里有东西。',
      options: [
        { key: 'appear', label: '现身', blurb: '让他们找到',
          light: +18, marks: { watched: 2, rise: 1 }, pressure: +8,
          chronicle: '那边有了回应。从此{folk}做的一切都朝着那一边。' },
        { key: 'hide', label: '藏起来', blurb: '不让找到',
          light: -12, marks: { fall: 1 }, pressure: +6,
          chronicle: '那边一直是空的。他们发了上百次，最后停了下来。' },
        { key: 'moveoff', label: '换个位置', blurb: '看着但不露面',
          light: +6, marks: {}, pressure: -6,
          chronicle: '观察的位置换了。信号的方向跟着偏了一点，他们没有发现。' }
      ]
    },
    {
      key: 'ending', era: 4,
      title: '{folk}算出了终点',
      question: '{folk}从记录里算出了这颗星球还能存在多久。他们把那个数核对了一遍又一遍。',
      options: [
        { key: 'moretime', label: '给他们时间', blurb: '让那个数变大',
          light: +14, marks: { watched: 1 }, slow: +12,
          chronicle: '那个数变大了。往后他们做的事比原来从容。' },
        { key: 'holdline', label: '不改动', blurb: '让数就那么写着',
          light: +4, marks: {}, pressure: -6,
          chronicle: '那个数没有变。它一直写在记录最前面。' },
        { key: 'sooner', label: '把终点提前', blurb: '让那件事先来',
          light: -18, marks: { fall: 2 }, pressure: +12,
          chronicle: '那件事比算出来的早。后面的记录少了一截。' }
      ]
    },

    /* ── ★ 造出了替自己的东西 —— 「遗落」那条结局的**第二个来源** ──
       ⚠️ 第一个来源是人类专属事件的「工具开始造工具 → 让它做」（machine: 1）。
          这一条给 **2** —— 也就是说**它自己就够**（门槛 2），
          而人类那条单独不够。理由：
          这一条写的正是「遗落」本身（他们不再动手了），
          人类那条只是它的前身（会做东西的人一年比一年少）。
       详见 ending.js 的 FATES.machine 和 civEvents.js 的 MARK_MIN。 */
    {
      key: 'handover', era: 4,
      /* ⚠️⚠️ 2026-09-14 改写：**用户说这一屏"太含糊，玩家看不懂"** ⚠️⚠️
         改的三处（都是"读不出画面"的抽象说法）：
           标题  「替自己的东西」→「替自己**动手**的东西」（替什么？动手干活）
           问题  「已经能做完他们所有的活」→「**不用照看**就能自己做出下一批」
                 （把"它自己能造下一代"这件关键的事说出来）
           选项①「不再动手」→「**所有工作都交出去**」（不动手做什么，说清楚）

         ⚠️ 「工作」这个说法是**用户定的**（原本写的是「活」）——
            他觉得「活」太含糊。**四处一起改**：命运 desc / 这一屏 /
            选项下的编年史 / 人类那个种子事件（见 civLore.js 的 selfmake）。
            只改一处的话，同一件事在结局卡上叫「工作」、在弹窗上叫「活」。 */
      title: '{folk}造出了替自己动手的东西',
      question: '{folk}造出的东西，不用照看就能自己做出下一批。{folk}的工作，正在一件件交到它们手上。',
      options: [
        { key: 'letgo', label: '放手', blurb: '所有工作都交给它们',
          light: +10, marks: { machine: 2 }, pressure: -6,
          chronicle: '大部分物品不再出自人手，从事生产的人员，一代比一代少。' },
        { key: 'stopmake', label: '停掉它们', blurb: '让工作回到自己手上',
          light: -12, marks: { fall: 1 }, pressure: +10,
          chronicle: '{folk}把那些东西停掉了。所有的工作又回到了手上。' },
        { key: 'stayhand', label: '继续亲手做', blurb: '关键的仍旧自己来',
          light: +8, marks: {}, slow: +10,
          chronicle: '他们仍旧亲手做。那些东西只在旁边看着。' }
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
    helpPressure: -15
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

    var pool = [], i;
    for (i = 0; i < BIG_EVENTS.length; i++) {
      /* ⚠️ `manual` 的**不进随机池** —— 它只由 beginCiv 手动排进来
         （见上面的 planVisit）。
         ⚠️ 漏了这个判断的后果是**静默**的：界外来访会混进普通池子，
            变成"每局都可能随机遇到"，而它本该只发生在被投放过的世界上 ——
            而且 `fits()` 对它返回 true（它不限定物种、形态、性格），
            所以没有任何别的东西会拦住它。 */
      if (BIG_EVENTS[i].manual) continue;
      if (fits(BIG_EVENTS[i], ctx)) pool.push(BIG_EVENTS[i]);
    }
    if (!pool.length) return [];

    for (i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }

    /* 大事件比小事件稀疏得多 —— **不设"七成池子"那种上限**，
       因为它一局只要 1~3 个，而且每次都要玩家停下手来。
       ⚠️ 但也不超过池子大小（有几个用几个，不重复）。 */
    var want  = Math.max(1, Math.round(duration * 0.7 / BIG_INTERVAL));
    var count = Math.min(want, pool.length);

    return placeByEra(pool.slice(0, count), rng, duration);
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
    // ── 通用事件（20 个）──
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

    // ── 大事件（10 个）—— 选项是"观察者做什么"，标的是**这个干预动了文明的哪一头** ──
    'lookup.reveal': 'rift',      'lookup.silence': 'rift',    'lookup.erase': 'rift',
    'depart.release': 'drain',    'depart.hold': 'rift',       'depart.mark': 'rift',
    'stopped.wake': 'drain',      'stopped.waitsee': 'drain',  'stopped.closebook': 'rift',
    'mirror.hint': 'rift',        'mirror.justwatch': 'rift',  'mirror.eraseold': 'rift',
    'whatare.reply': 'rift',      'whatare.stayquiet': 'rift', 'whatare.unask': 'rift',
    'elsewhere.confirm': 'rift',  'elsewhere.miscalc': 'rift', 'elsewhere.leaveit': 'rift',
    'lastbatch.keep': 'drain',    'lastbatch.letfinish': 'drain', 'lastbatch.remember': 'rift',
    'seent.appear': 'rift',       'seent.hide': 'rift',        'seent.moveoff': 'rift',
    'ending.moretime': 'unbal',   'ending.holdline': 'unbal',  'ending.sooner': 'unbal',
    'handover.letgo': 'drain',    'handover.stopmake': 'drain','handover.stayhand': 'drain',

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

    /* ── 大事件（11 个 · 32 个选项）──
       ⚠️ 2026-09-17 改的数：原来写「12 个 · 35 个选项」，两个都对不上。
          实测 `BIG_EVENTS` 是 **11 个**，选项 10×3 + 界外之物的 2 = **32 个**。

       选项是"**观察者**做什么"，标的是**这一手把文明推成了什么样**。

       ⚠️ 玩家出手**不改变他们自己的选择**，但会改变他们变成什么样 ——
          所以这里有值。而「驱赶 / 无视」那两个（界外入侵）
          **没有值**：来的是外面的人，观察者做什么不改变他们的本事。 */
    'lookup.reveal': { cul: 1 },          // 有一批开始朝同一个方向走
    'lookup.silence': { sci: 1 },         // 继续追问，一代接一代
    'lookup.erase': { sci: -1 },          // 从此没有人再记录天上

    'depart.release': { sci: 1 },
    'depart.hold': null,
    'depart.mark': { cul: 1 },

    'stopped.wake': { prod: 1 },
    'stopped.waitsee': null,
    'stopped.closebook': { cul: -1 },

    'mirror.hint': { sci: 1 },            // 做法和前面接不上了
    'mirror.justwatch': null,
    'mirror.eraseold': { cul: -1 },

    'whatare.reply': { sci: 1 },          // 问题变多了
    'whatare.stayquiet': null,
    'whatare.unask': { sci: -1 },

    'elsewhere.confirm': { sci: 2 },
    'elsewhere.miscalc': { sci: -1 },
    'elsewhere.leaveit': null,

    'lastbatch.keep': { prod: 1 },        // 数量一直没变
    'lastbatch.letfinish': null,
    'lastbatch.remember': { cul: 2 },     // 它比他们本身留得久

    'seent.appear': { cul: 1 },
    'seent.hide': null,
    'seent.moveoff': null,

    'ending.moretime': { prod: 1 },
    'ending.holdline': null,
    'ending.sooner': { cul: -1 },         // 后面的记录少了一截

    'handover.letgo': { prod: 2 },        // 工作全交出去 —— 做东西的不再是人
    'handover.stopmake': { prod: -1 },
    'handover.stayhand': { cul: 1 },      // 仍旧亲手做

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
      var delta = attrDeltaOf(eventKey, opt.key);
      if (delta) {
        var a = world.civ.attr;
        for (var ak in delta) a[ak] = (a[ak] || 0) + delta[ak];
      }
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
    apply: apply,
    resolveXiu: resolveXiu,         // ★ 修真彩蛋那条线自己的结算（二选一 + 骰子）
    markReached: markReached,
    pickOption: pickOption          // ★ 文明自己挑（见上面那段）
  };
});
