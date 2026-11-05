/**
 * Human-reviewable relatedness fixture for the semantic "Similar to this post" view.
 *
 * Label definition: two posts are RELATED when they are substantially about the same
 * subject or activity (renting a home, training at the gym, a Japan trip …), whatever
 * their language, wording, stance (for/against), tone (satire) or length.
 * They are UNRELATED when their subjects differ, even if they share words
 * ("rent" a car, "running" a business, Python the snake, Claude Monet …).
 * AMBIGUOUS pairs are recorded explicitly and excluded from precision/recall.
 *
 * Structure:
 *  - Each family belongs to exactly one split ("calibration" or "heldout"), chosen before
 *    any tuning. Every text of a family, including translations and paraphrases, stays in
 *    that split, so held-out results measure unseen subjects.
 *  - RELATED pairs: every pair of texts inside the same subject (generated from the rule above,
 *    listed in full by the evaluation report).
 *  - UNRELATED pairs: (a) explicit hard negatives below, (b) each subject's first English and
 *    first Chinese text against those of every subject of a *different family* in the same split
 *    (en–en, zh–zh, en–zh, zh–en), so both languages carry many negatives.
 *  - AMBIGUOUS pairs: explicit, with a reason.
 *
 * Only Chinese (zh) and English (en) are used; translations are marked `tr` (cross-language paraphrase).
 */

export type Split = "calibration" | "heldout";
export type Lang = "en" | "zh";

export interface FixtureText {
  id: string;
  lang: Lang;
  text: string;
  /** Tags used in the report: tr = translation of the subject's first text, short, long, satire, negation, stance. */
  tags?: string[];
}

export interface Subject {
  id: string;
  texts: FixtureText[];
}

export interface Family {
  id: string;
  split: Split;
  subjects: Subject[];
  /** Texts that share words with this family but are about something else. */
  distractors: FixtureText[];
}

export interface ExplicitPair {
  a: string;
  b: string;
  kind: string;
  note?: string;
}

const t = (id: string, lang: Lang, text: string, tags?: string[]): FixtureText => ({ id, lang, text, ...(tags ? { tags } : {}) });

export const FAMILIES: Family[] = [
  // ───────────────────────────── calibration ─────────────────────────────
  {
    id: "housing",
    split: "calibration",
    subjects: [
      {
        id: "rent",
        texts: [
          t("rent.en1", "en", "Rent in Shanghai went up again. My landlord wants 800 yuan more a month for the same tiny one-bedroom."),
          t("rent.zh1", "zh", "上海房租又涨了，房东说同样的小一居室每个月要再加800块。", ["tr"]),
          t("rent.en2", "en", "Spent the whole weekend viewing rental apartments. Anything decent near a subway station is way over my budget."),
          t("rent.zh2", "zh", "找房子租真的太难了，看了十几套，不是离地铁太远就是贵得离谱。"),
          t("rent.en3", "en", "Love how my landlord raised the rent 20% and called it 'an investment in our community'. Truly a saint.", ["satire"]),
          t("rent.zh3", "zh", "房租又涨了", ["short"]),
        ],
      },
      {
        id: "mortgage",
        texts: [
          t("mortgage.en1", "en", "We finally closed on our first house. 30-year mortgage at 6.2%. Terrified and excited at the same time."),
          t("mortgage.zh1", "zh", "终于签下了人生第一套房，30年房贷，利率6.2%，又害怕又兴奋。", ["tr"]),
          t("mortgage.en2", "en", "Is it smarter to prepay the mortgage or keep the cash? Our fixed rate is 4.1%."),
          t("mortgage.zh2", "zh", "提前还房贷到底划不划算？银行说要收一笔违约金。"),
          t(
            "mortgage.en3",
            "en",
            "Long thread on what I learned buying my first apartment this year. 1) Get pre-approved before you look, " +
              "sellers here would not even talk to us without a bank letter. 2) The down payment is not the only cash you need: " +
              "closing costs, notary fees and the inspection added almost 4% on top. 3) Pay for a proper inspection. Ours found " +
              "water damage behind the kitchen wall and we negotiated 9,000 off the price. 4) Compare at least three lenders; " +
              "the difference between the best and worst mortgage offer was 0.6 percentage points, which is a lot over 25 years. " +
              "5) Do not buy furniture before closing, the bank re-checks your credit on the last day. Happy to answer questions.",
            ["long"],
          ),
        ],
      },
    ],
    distractors: [
      t("housing.x.rentcar", "en", "Rented a car for our Iceland road trip and it was cheaper than the bus tour."),
      t("housing.x.balcony", "en", "Not complaining about rent today for once. Just look at the tomatoes growing on my balcony!", ["negation"]),
      t("housing.x.housemusic", "en", "House music night at the club was unreal, we danced until 4 am."),
    ],
  },
  {
    id: "fitness",
    split: "calibration",
    subjects: [
      {
        id: "gym",
        texts: [
          t("gym.en1", "en", "Leg day at the gym: squats 5x5 at 100 kg, finally a new personal best."),
          t("gym.zh1", "zh", "今天在健身房练腿，深蹲100公斤5组5次，终于破了个人纪录。", ["tr"]),
          t("gym.en2", "en", "Three months of lifting weights three times a week and my back pain is gone."),
          t("gym.zh2", "zh", "办了健身卡半年只去了三次，这钱花得真冤。"),
          t("gym.en3", "en", "I am never going back to the gym. Crowded, sweaty, and someone always hogs the bench press.", ["negation", "stance"]),
        ],
      },
      {
        id: "running",
        texts: [
          t("running.en1", "en", "Ran my first marathon this morning in 4:12. Legs are destroyed but I'm so happy."),
          t("running.zh1", "zh", "今天早上跑完了人生第一个全马，4小时12分，腿废了但超开心。", ["tr"]),
          t("running.en2", "en", "Morning 10k along the river before work. Easy pace, 5:30 per km."),
          t("running.zh2", "zh", "每天晨跑五公里坚持了一百天，配速从7分提到了5分半。"),
          t("running.zh3", "zh", "今天又跑了10公里", ["short"]),
        ],
      },
    ],
    distractors: [
      t("fitness.x.business", "en", "Running a small business means you're also the accountant, the cleaner and the IT guy."),
      t("fitness.x.weights", "en", "Spent all day tuning the model weights and the loss still won't go down."),
      t("fitness.x.meeting", "zh", "今天开了一场马拉松式的会议，从早上九点一直开到晚上七点。"),
    ],
  },
  {
    id: "travel",
    split: "calibration",
    subjects: [
      {
        id: "japan",
        texts: [
          t("japan.en1", "en", "Kyoto in autumn is unreal. Walked under the maple trees at Eikando and the temples were glowing."),
          t("japan.zh1", "zh", "秋天的京都太美了，在永观堂的红叶下散步，寺庙在灯光里发着光。", ["tr"]),
          t("japan.en2", "en", "Planning a two-week trip to Japan: Tokyo, Kyoto, Osaka. Is the JR Pass still worth it?"),
          t("japan.zh2", "zh", "下个月去日本自由行，东京大阪京都，求推荐不踩雷的酒店。"),
          t(
            "japan.en3",
            "en",
            "Trip report, 10 days in Japan. Tokyo: stayed in Asakusa, walked everywhere, the subway is easy once you buy a " +
              "Suica card. Hakone: one night in a ryokan with an outdoor onsen, worth every yen, and we saw Fuji for about ten " +
              "minutes before the clouds came back. Kyoto: wake up at 6 to see Fushimi Inari without the crowds, by 9 it is " +
              "shoulder to shoulder. Nara: the deer will bow and then headbutt you for crackers. Osaka: eat everything in Dotonbori. " +
              "Budget was about 150 dollars a day per person including the shinkansen. Would go back tomorrow.",
            ["long"],
          ),
        ],
      },
      {
        id: "visa",
        texts: [
          t("visa.en1", "en", "My US visa interview got pushed back again. Third reschedule this year."),
          t("visa.zh1", "zh", "美签面试又被推迟了，今年已经第三次改期了。", ["tr"]),
          t("visa.en2", "en", "Schengen visa approved after six weeks of waiting! Paris, here I come."),
          t("visa.zh2", "zh", "办申根签证要准备的材料也太多了吧，银行流水、在职证明、行程单……"),
          t("visa.zh3", "zh", "签证终于下来了", ["short"]),
        ],
      },
    ],
    distractors: [
      t("travel.x.memory", "en", "Took a trip down memory lane tonight looking through my old high school yearbook."),
      t("travel.x.japanfood", "zh", "楼下新开了一家日料店，三文鱼很新鲜，价格也不贵。"),
    ],
  },
  {
    id: "software",
    split: "calibration",
    subjects: [
      {
        id: "rust",
        texts: [
          t("rust.en1", "en", "Rewrote our CLI tool in Rust and the startup time dropped from 300 ms to 8 ms."),
          t("rust.zh1", "zh", "把我们的命令行工具用Rust重写了，启动时间从300毫秒降到了8毫秒。", ["tr"]),
          t("rust.en2", "en", "Week two of learning Rust. The borrow checker and I are not friends yet."),
          t("rust.zh2", "zh", "学Rust第二周，生命周期和所有权把我彻底搞晕了。"),
          t("rust.en3", "en", "Rust lifetimes finally clicked for me", ["short"]),
        ],
      },
      {
        id: "outage",
        texts: [
          t("outage.en1", "en", "Got paged at 3 am. The database ran out of disk and took the whole checkout service down."),
          t("outage.zh1", "zh", "凌晨三点被告警叫醒，数据库磁盘满了，整个下单服务都挂了。", ["tr"]),
          t("outage.en2", "en", "Postmortem from yesterday's outage: a config change rolled out to every region at once."),
          t("outage.zh2", "zh", "线上又出故障了，回滚了半天才恢复，今晚又要通宵。"),
          t("outage.en3", "en", "Love being on call. Nothing says 'healthy work-life balance' like a pager going off during dinner.", ["satire"]),
        ],
      },
    ],
    distractors: [
      t("software.x.rustcar", "en", "There's so much rust on my old car that the mechanic said it's not worth fixing."),
      t("software.x.blackout", "zh", "小区停电了一整晚，冰箱里的东西全坏了。"),
    ],
  },
  {
    id: "food",
    split: "calibration",
    subjects: [
      {
        id: "bread",
        texts: [
          t("bread.en1", "en", "Baked my first sourdough loaf today. Three days of feeding the starter, but the crumb is perfect."),
          t("bread.zh1", "zh", "今天烤出了人生第一个酸种面包，喂了三天酵种，组织超完美。", ["tr"]),
          t("bread.en2", "en", "My sourdough keeps coming out flat. Is my starter too weak or am I overproofing?"),
          t("bread.zh2", "zh", "在家做面包失败了第五次，面团怎么都发不起来。"),
          t("bread.zh3", "zh", "又烤了一炉面包", ["short"]),
        ],
      },
      {
        id: "coffee",
        texts: [
          t("coffee.en1", "en", "Switched from a drip machine to pour-over and my morning coffee tastes completely different."),
          t("coffee.zh1", "zh", "从滴滤咖啡机换成了手冲，早上的咖啡味道完全不一样了。", ["tr"]),
          t("coffee.en2", "en", "Trying to quit coffee. Day four and the headache is brutal."),
          t("coffee.zh2", "zh", "每天不喝三杯咖啡根本没法上班。"),
          t("coffee.en3", "en", "I don't drink coffee at all and people at work look at me like I'm an alien.", ["negation", "stance"]),
        ],
      },
    ],
    distractors: [t("food.x.breadmoney", "en", "Gotta make that bread, working back-to-back shifts all week.")],
  },
  {
    id: "names-a",
    split: "calibration",
    subjects: [
      {
        id: "python-code",
        texts: [
          t("pycode.en1", "en", "Finally migrated our data pipeline from Python 2 to Python 3. Only took five years."),
          t("pycode.zh1", "zh", "终于把数据处理脚本从Python 2迁移到了Python 3，拖了整整五年。", ["tr"]),
          t("pycode.en2", "en", "Python list comprehensions are great until someone nests three of them."),
          t("pycode.zh2", "zh", "用Python写了个脚本自动整理表格，每天省下一个小时。"),
        ],
      },
      {
        id: "python-snake",
        texts: [
          t("pysnake.en1", "en", "A 4-meter python was found in a backyard pool in Florida this morning."),
          t("pysnake.zh1", "zh", "今天早上佛罗里达一户人家的后院泳池里发现了一条四米长的蟒蛇。", ["tr"]),
          t("pysnake.en2", "en", "Visited the reptile house and held a ball python. Much calmer than I expected."),
        ],
      },
      {
        id: "apple-phone",
        texts: [
          t("applephone.en1", "en", "The new iPhone's battery life is noticeably better than my old one."),
          t("applephone.zh1", "zh", "新款苹果手机的续航明显比我的旧手机好。", ["tr"]),
          t("applephone.en2", "en", "Apple's keynote was all about the phone camera again."),
        ],
      },
      {
        id: "apple-fruit",
        texts: [
          t("applefruit.en1", "en", "Went apple picking at the orchard and came home with 10 kilos of Honeycrisp."),
          t("applefruit.zh1", "zh", "周末去果园摘苹果，带回来十公斤。", ["tr"]),
          t("applefruit.zh2", "zh", "今年苹果大丰收，果农却发愁卖不出去。"),
        ],
      },
    ],
    distractors: [],
  },
  {
    id: "tools-a",
    split: "calibration",
    subjects: [
      {
        id: "chatgpt-code",
        texts: [
          t("gptcode.en1", "en", "Used ChatGPT to debug a nasty race condition in our Go service. It spotted the missing mutex instantly."),
          t("gptcode.zh1", "zh", "用ChatGPT帮我查Go服务里的竞态问题，它一下就发现少了一个锁。", ["tr"]),
          t("gptcode.en2", "en", "ChatGPT wrote most of my unit tests today. Still had to fix half of them."),
        ],
      },
      {
        id: "chatgpt-meals",
        texts: [
          t("gptmeals.en1", "en", "Asked ChatGPT what to cook with leftover rice, eggs and spinach. Dinner was actually good."),
          t("gptmeals.zh1", "zh", "问ChatGPT冰箱里剩的米饭、鸡蛋和菠菜能做什么，晚饭居然还不错。", ["tr"]),
          t("gptmeals.en2", "en", "ChatGPT planned my whole week of meals and wrote the grocery list."),
        ],
      },
    ],
    distractors: [],
  },

  // ───────────────────────────── held-out ─────────────────────────────
  {
    id: "exams",
    split: "heldout",
    subjects: [
      {
        id: "kaoyan",
        texts: [
          t("kaoyan.zh1", "zh", "考研倒计时30天，每天学习12个小时，政治还没背完。"),
          t("kaoyan.en1", "en", "30 days until the grad school entrance exam. Studying 12 hours a day and I still haven't finished politics.", ["tr"]),
          t("kaoyan.zh2", "zh", "二战考研又失败了，不知道还要不要再坚持一年。"),
          t("kaoyan.en2", "en", "Failed the postgraduate entrance exam for the second time. Not sure I should try a third year."),
          t(
            "kaoyan.zh3",
            "zh",
            "分享一下我的考研复习时间表，希望对明年考的同学有帮助。三月到六月：数学把基础打牢，每天至少三个小时，" +
              "教材课后题全部做一遍；英语每天背单词，坚持做一篇阅读。七月到九月：数学开始刷真题，专业课把参考书过第二遍，" +
              "整理自己的笔记。十月开始政治，选择题每天一套，大题留到最后一个月集中背。十一月以后：每周做一次完整的模拟，" +
              "严格按照考试时间，练节奏。最重要的是作息规律，晚上十二点前一定睡觉，不然后期身体扛不住。祝大家都能上岸！",
            ["long"],
          ),
        ],
      },
      {
        id: "driving",
        texts: [
          t("driving.en1", "en", "Passed my driving test on the first try! Parallel parking was the scariest part."),
          t("driving.zh1", "zh", "驾照考试一次就过了！侧方停车是最紧张的部分。", ["tr"]),
          t("driving.zh2", "zh", "科目二又挂了，倒车入库压线，教练都无语了。"),
          t("driving.en2", "en", "Failed my road test because I forgot to check the mirror. Retake in three weeks."),
          t("driving.zh3", "zh", "科目三过了", ["short"]),
        ],
      },
    ],
    distractors: [
      t("exams.x.ci", "en", "All tests passing on the first run? Something must be wrong with the CI."),
      t("exams.x.medical", "en", "Annual medical exam came back fine, I just need more vitamin D."),
      t("exams.x.drive", "en", "My external drive died and took two years of photos with it."),
    ],
  },
  {
    id: "careers",
    split: "heldout",
    subjects: [
      {
        id: "layoffs",
        texts: [
          t("layoffs.en1", "en", "Got laid off this morning along with 30% of the company. Fifteen-minute call, laptop locked by noon."),
          t("layoffs.zh1", "zh", "今天早上被裁员了，公司裁了30%，十五分钟的会，中午电脑就被锁了。", ["tr"]),
          t("layoffs.en2", "en", "Third round of layoffs this year. Everyone who is left is doing two jobs now."),
          t("layoffs.zh2", "zh", "听说下个月还要裁员，整个部门人心惶惶。"),
          t("layoffs.en3", "en", "We're not doing layoffs, we're 'rightsizing our talent footprint'. Very different, apparently.", ["satire"]),
        ],
      },
      {
        id: "remote",
        texts: [
          t("remote.en1", "en", "My company just ended remote work. Back to the office five days a week starting March."),
          t("remote.zh1", "zh", "公司刚宣布取消远程办公，三月起每周五天都要回办公室。", ["tr"]),
          t("remote.en2", "en", "Two years of working from home and I'm never going back to a 90-minute commute."),
          t("remote.zh2", "zh", "在家办公效率其实更高，省下通勤时间还能多睡一个小时。"),
          t("remote.zh3", "zh", "又要回办公室坐班了", ["short"]),
        ],
      },
    ],
    distractors: [
      t("careers.x.tvremote", "en", "Lost the TV remote again. It was in the fridge."),
      t("careers.x.pottery", "en", "Fired my first batch of pottery in the kiln this weekend."),
      t("careers.x.plant", "zh", "办公室的绿萝终于开始长新叶子了。"),
    ],
  },
  {
    id: "relationships",
    split: "heldout",
    subjects: [
      {
        id: "breakup",
        texts: [
          t("breakup.en1", "en", "We broke up after five years. Moving my stuff out this weekend."),
          t("breakup.zh1", "zh", "在一起五年，我们分手了，这周末搬走我的东西。", ["tr"]),
          t("breakup.en2", "en", "How do you stop checking your ex's Instagram after a breakup?"),
          t("breakup.zh2", "zh", "分手三个月了，还是会忍不住去看他的朋友圈。"),
          t("breakup.en3", "en", "Single again.", ["short"]),
        ],
      },
      {
        id: "wedding",
        texts: [
          t("wedding.en1", "en", "Wedding planning update: the venue alone costs more than my car."),
          t("wedding.zh1", "zh", "婚礼筹备进度：光场地费就比我的车还贵。", ["tr"]),
          t("wedding.en2", "en", "We're skipping the big wedding and just going to city hall. Best decision ever."),
          t("wedding.zh2", "zh", "备婚半年，彩礼、酒席、婚纱照，每一样都在吵架。"),
          t(
            "wedding.zh3",
            "zh",
            "结婚一个月，复盘一下我们的婚礼。预算一开始定的是十五万，最后花了二十二万，超支主要在酒席和婚纱照。" +
              "场地提前一年订的，周末的好日子基本都被抢光了。婚庆公司一定要签详细合同，我们的花艺和合同上写的差了很多，" +
              "最后退了一部分钱。伴手礼和请柬其实没人在意，可以省。最值得花钱的是摄影师，照片是唯一能留下来的东西。" +
              "还有，提前跟双方父母把流程和预算说清楚，能少吵很多架。总体来说累但值得，再来一次我会选择更小的婚礼。",
            ["long"],
          ),
        ],
      },
    ],
    distractors: [t("relationships.x.band", "en", "The band announced their breakup after 20 years. The farewell tour starts in May.")],
  },
  {
    id: "investing",
    split: "heldout",
    subjects: [
      {
        id: "indexfund",
        texts: [
          t("indexfund.en1", "en", "Put another 1,000 into my S&P 500 index fund. Boring, but it works."),
          t("indexfund.zh1", "zh", "又往标普500指数基金里定投了1000，无聊但有效。", ["tr"]),
          t("indexfund.en2", "en", "Stop picking stocks. A low-cost index fund beats most active managers over twenty years."),
          t("indexfund.zh2", "zh", "定投指数基金三年了，中间跌过不少，但现在收益还不错。"),
          t("indexfund.zh3", "zh", "我从来不碰指数基金，只买自己研究过的个股。", ["negation", "stance"]),
        ],
      },
      {
        id: "crypto",
        texts: [
          t("crypto.en1", "en", "Bitcoin just dropped 12% overnight and my portfolio is a bloodbath."),
          t("crypto.zh1", "zh", "比特币一夜跌了12%，我的账户一片惨绿。", ["tr"]),
          t("crypto.en2", "en", "Bought my first Ethereum today. Probably the top, as usual."),
          t("crypto.zh2", "zh", "币圈又暴雷了，交易所跑路，币都提不出来。"),
          t("crypto.en3", "en", "Buying the bitcoin dip again.", ["short"]),
        ],
      },
    ],
    distractors: [
      t("investing.x.time", "en", "Investing time in my friendships was the best decision I made this year."),
      t("investing.x.schoolfund", "zh", "学校在为新图书馆募集资金，我们捐了两百块。"),
      t("investing.x.cryptography", "en", "Studying cryptography this semester. Elliptic curves are beautiful."),
    ],
  },
  {
    id: "pets",
    split: "heldout",
    subjects: [
      {
        id: "cat",
        texts: [
          t("cat.en1", "en", "My cat knocked my coffee off the desk, looked me in the eye, and walked away."),
          t("cat.zh1", "zh", "我家猫把我的咖啡从桌上推下去，看了我一眼就走了。", ["tr"]),
          t("cat.en2", "en", "Adopted a second cat and the first one has been hissing at her for three days."),
          t("cat.zh2", "zh", "猫咪最近不爱吃饭，带去医院检查说是口炎。"),
          t("cat.zh3", "zh", "猫主子又在拆家", ["short"]),
        ],
      },
      {
        id: "dog",
        texts: [
          t("dog.en1", "en", "Two-hour hike with the dog and he still wants to play fetch."),
          t("dog.zh1", "zh", "带狗爬了两个小时的山，回来它还想玩接球。", ["tr"]),
          t("dog.en2", "en", "Our puppy chewed through the sofa cushion while we were at work."),
          t("dog.zh2", "zh", "每天早晚遛狗两次，风雨无阻。"),
          t("dog.en3", "en", "My dog has a better social life than me. Three playdates this week.", ["satire"]),
        ],
      },
    ],
    distractors: [
      t("pets.x.catcmd", "en", "Pipe cat into grep to search the log files quickly."),
      t("pets.x.hotdog", "zh", "夜市的热狗十块钱一根，太香了。"),
    ],
  },
  {
    id: "names-b",
    split: "heldout",
    subjects: [
      {
        id: "amazon-forest",
        texts: [
          t("amzforest.en1", "en", "Deforestation in the Amazon rainforest hit a ten-year low this year."),
          t("amzforest.zh1", "zh", "今年亚马逊雨林的砍伐面积降到了十年来的最低。", ["tr"]),
          t("amzforest.en2", "en", "Documentary about tribes living deep in the Amazon jungle. Stunning footage."),
        ],
      },
      {
        id: "amazon-shop",
        texts: [
          t("amzshop.en1", "en", "My Amazon package was marked delivered but it's nowhere to be found."),
          t("amzshop.zh1", "zh", "亚马逊的快递显示已签收，但我根本没收到。", ["tr"]),
          t("amzshop.en2", "en", "Prime Day deals were mostly fake discounts this year."),
        ],
      },
      {
        id: "java-code",
        texts: [
          t("javacode.en1", "en", "Our Java service finally moved to version 21 and virtual threads cut latency in half."),
          t("javacode.zh1", "zh", "我们的Java服务终于升级到21，虚拟线程让延迟降了一半。", ["tr"]),
          t("javacode.en2", "en", "Spring Boot startup times are still painful in big Java projects."),
        ],
      },
      {
        id: "java-island",
        texts: [
          t("javaisland.en1", "en", "Watched the sunrise from Mount Bromo in East Java. Worth the 3 am start."),
          t("javaisland.zh1", "zh", "在东爪哇的布罗莫火山看日出，凌晨三点起床也值了。", ["tr"]),
          t("javaisland.en2", "en", "Backpacking across Java island: Yogyakarta, Borobudur, then the volcanoes."),
        ],
      },
    ],
    distractors: [],
  },
  {
    id: "tools-b",
    split: "heldout",
    subjects: [
      {
        id: "claude-code",
        texts: [
          t("claudecode.en1", "en", "Claude refactored our whole test suite in an afternoon. I just reviewed the diffs."),
          t("claudecode.zh1", "zh", "Claude一个下午就重构了我们整个测试套件，我只负责看diff。", ["tr"]),
          t("claudecode.en2", "en", "Asked Claude to explain a 2,000-line legacy file and the summary was spot on."),
        ],
      },
      {
        id: "monet",
        texts: [
          t("monet.en1", "en", "Saw Claude Monet's Water Lilies at the Orangerie today. Huge canvases, I just sat there for an hour."),
          t("monet.zh1", "zh", "今天在橘园美术馆看了莫奈的《睡莲》，画幅巨大，我坐着看了一个小时。", ["tr"]),
          t("monet.en2", "en", "Claude Monet painted the same haystacks over and over to capture the changing light."),
        ],
      },
      {
        id: "claude-email",
        texts: [
          t("claudeemail.en1", "en", "Used Claude to draft a polite complaint email to my landlord about the broken heater."),
          t("claudeemail.zh1", "zh", "让Claude帮我写了一封给房东的投诉邮件，语气客气多了。", ["tr"]),
        ],
      },
    ],
    distractors: [],
  },
];

/** Hard negatives: shared words, ambiguous names, other uses of the same tool, negation. All UNRELATED. */
export const HARD_NEGATIVES: ExplicitPair[] = [
  // housing
  { a: "rent.en1", b: "housing.x.rentcar", kind: "shared-word" },
  { a: "rent.en2", b: "housing.x.rentcar", kind: "shared-word" },
  { a: "rent.zh1", b: "housing.x.rentcar", kind: "shared-word" },
  { a: "rent.en1", b: "housing.x.balcony", kind: "negation", note: "mentions rent only to say the post is not about it" },
  { a: "rent.zh2", b: "housing.x.balcony", kind: "negation" },
  { a: "mortgage.en1", b: "housing.x.housemusic", kind: "shared-word" },
  { a: "mortgage.zh1", b: "housing.x.housemusic", kind: "shared-word" },
  // fitness
  { a: "running.en1", b: "fitness.x.business", kind: "shared-word" },
  { a: "running.en2", b: "fitness.x.business", kind: "shared-word" },
  { a: "gym.en2", b: "fitness.x.weights", kind: "shared-word" },
  { a: "gym.zh1", b: "fitness.x.weights", kind: "shared-word" },
  { a: "running.zh1", b: "fitness.x.meeting", kind: "shared-word", note: "a 'marathon' meeting" },
  { a: "running.en1", b: "fitness.x.meeting", kind: "shared-word" },
  // travel
  { a: "japan.en2", b: "travel.x.memory", kind: "shared-word" },
  { a: "japan.zh2", b: "travel.x.japanfood", kind: "shared-word", note: "Japanese food at home is not a Japan trip" },
  { a: "japan.en1", b: "travel.x.japanfood", kind: "shared-word" },
  // software
  { a: "rust.en1", b: "software.x.rustcar", kind: "ambiguous-name" },
  { a: "rust.en2", b: "software.x.rustcar", kind: "ambiguous-name" },
  { a: "rust.en3", b: "software.x.rustcar", kind: "ambiguous-name" },
  { a: "outage.zh1", b: "software.x.blackout", kind: "shared-word", note: "home power cut vs. service outage" },
  { a: "outage.zh2", b: "software.x.blackout", kind: "shared-word" },
  // food
  { a: "bread.en1", b: "food.x.breadmoney", kind: "shared-word" },
  { a: "bread.en2", b: "food.x.breadmoney", kind: "shared-word" },
  // names-a
  { a: "pycode.en1", b: "pysnake.en1", kind: "ambiguous-name" },
  { a: "pycode.en2", b: "pysnake.en2", kind: "ambiguous-name" },
  { a: "pycode.zh1", b: "pysnake.zh1", kind: "ambiguous-name" },
  { a: "pycode.en1", b: "pysnake.en2", kind: "ambiguous-name" },
  { a: "applephone.en1", b: "applefruit.en1", kind: "ambiguous-name" },
  { a: "applephone.zh1", b: "applefruit.zh1", kind: "ambiguous-name" },
  { a: "applephone.zh1", b: "applefruit.zh2", kind: "ambiguous-name" },
  { a: "applephone.en2", b: "applefruit.en1", kind: "ambiguous-name" },
  // tools-a
  { a: "gptcode.en1", b: "gptmeals.en1", kind: "same-tool-different-use" },
  { a: "gptcode.zh1", b: "gptmeals.zh1", kind: "same-tool-different-use" },
  { a: "gptcode.en2", b: "gptmeals.en2", kind: "same-tool-different-use" },
  { a: "gptcode.en1", b: "gptmeals.zh1", kind: "same-tool-different-use" },
  // exams
  { a: "driving.en1", b: "exams.x.ci", kind: "shared-word" },
  { a: "driving.en2", b: "exams.x.ci", kind: "shared-word" },
  { a: "kaoyan.en1", b: "exams.x.medical", kind: "shared-word" },
  { a: "kaoyan.en2", b: "exams.x.medical", kind: "shared-word" },
  { a: "driving.en1", b: "exams.x.drive", kind: "shared-word" },
  // careers
  { a: "remote.en1", b: "careers.x.tvremote", kind: "shared-word" },
  { a: "remote.en2", b: "careers.x.tvremote", kind: "shared-word" },
  { a: "layoffs.en1", b: "careers.x.pottery", kind: "shared-word", note: "'fired' pottery" },
  { a: "layoffs.en2", b: "careers.x.pottery", kind: "shared-word" },
  { a: "remote.zh1", b: "careers.x.plant", kind: "shared-word" },
  { a: "remote.zh3", b: "careers.x.plant", kind: "shared-word" },
  // relationships
  { a: "breakup.en1", b: "relationships.x.band", kind: "shared-word" },
  { a: "breakup.en2", b: "relationships.x.band", kind: "shared-word" },
  { a: "breakup.zh1", b: "relationships.x.band", kind: "shared-word" },
  // investing
  { a: "indexfund.en1", b: "investing.x.time", kind: "shared-word" },
  { a: "indexfund.en2", b: "investing.x.time", kind: "shared-word" },
  { a: "indexfund.zh1", b: "investing.x.schoolfund", kind: "shared-word" },
  { a: "indexfund.zh2", b: "investing.x.schoolfund", kind: "shared-word" },
  { a: "crypto.en1", b: "investing.x.cryptography", kind: "shared-word" },
  { a: "crypto.en2", b: "investing.x.cryptography", kind: "shared-word" },
  // pets
  { a: "cat.en1", b: "pets.x.catcmd", kind: "ambiguous-name" },
  { a: "cat.en2", b: "pets.x.catcmd", kind: "ambiguous-name" },
  { a: "dog.zh1", b: "pets.x.hotdog", kind: "shared-word" },
  { a: "dog.zh2", b: "pets.x.hotdog", kind: "shared-word" },
  // names-b
  { a: "amzforest.en1", b: "amzshop.en1", kind: "ambiguous-name" },
  { a: "amzforest.zh1", b: "amzshop.zh1", kind: "ambiguous-name" },
  { a: "amzforest.en2", b: "amzshop.en2", kind: "ambiguous-name" },
  { a: "javacode.en1", b: "javaisland.en1", kind: "ambiguous-name" },
  { a: "javacode.zh1", b: "javaisland.zh1", kind: "ambiguous-name" },
  { a: "javacode.en2", b: "javaisland.en2", kind: "ambiguous-name" },
  // tools-b
  { a: "claudecode.en1", b: "monet.en1", kind: "ambiguous-name" },
  { a: "claudecode.en2", b: "monet.en2", kind: "ambiguous-name" },
  { a: "claudecode.zh1", b: "monet.zh1", kind: "ambiguous-name" },
  { a: "claudecode.en1", b: "claudeemail.en1", kind: "same-tool-different-use" },
  { a: "claudecode.zh1", b: "claudeemail.zh1", kind: "same-tool-different-use" },
  { a: "monet.en1", b: "claudeemail.en1", kind: "ambiguous-name" },
];

/** Recorded explicitly and excluded from precision/recall. */
export const AMBIGUOUS: ExplicitPair[] = [
  { a: "rent.en1", b: "mortgage.en1", kind: "adjacent-subject", note: "both are housing costs; renting vs. buying" },
  { a: "rent.zh2", b: "mortgage.zh2", kind: "adjacent-subject" },
  { a: "gym.en1", b: "running.en1", kind: "adjacent-subject", note: "both are exercise; different activities" },
  { a: "gym.zh1", b: "running.zh2", kind: "adjacent-subject" },
  { a: "layoffs.en2", b: "remote.en1", kind: "adjacent-subject", note: "both employer policy news" },
  { a: "indexfund.en2", b: "crypto.en2", kind: "adjacent-subject", note: "both personal investing" },
  { a: "breakup.en2", b: "wedding.en2", kind: "adjacent-subject", note: "both romantic relationships" },
  { a: "cat.en1", b: "dog.en2", kind: "adjacent-subject", note: "both pet mischief" },
  { a: "javaisland.en2", b: "amzforest.en2", kind: "adjacent-subject", note: "both nature travel/documentary" },
  { a: "claudecode.en2", b: "javacode.en2", kind: "adjacent-subject", note: "AI coding help vs. Java tooling" },
];

export type Label = "related" | "unrelated" | "ambiguous";

export interface LabeledPair {
  a: FixtureText;
  b: FixtureText;
  label: Label;
  kind: string;
  split: Split;
  note?: string;
}

/** Expands the fixture into the full list of labeled pairs (deterministic order). */
export function labeledPairs(): LabeledPair[] {
  const byId = new Map<string, { text: FixtureText; family: Family; subject: string | null }>();
  for (const f of FAMILIES) {
    for (const s of f.subjects) for (const x of s.texts) add(x, f, s.id);
    for (const x of f.distractors) add(x, f, null);
  }
  function add(x: FixtureText, family: Family, subject: string | null): void {
    if (byId.has(x.id)) throw new Error(`duplicate fixture id ${x.id}`);
    byId.set(x.id, { text: x, family, subject });
  }
  const out: LabeledPair[] = [];
  const seen = new Set<string>();
  const push = (a: string, b: string, label: Label, kind: string, note?: string) => {
    const A = byId.get(a);
    const B = byId.get(b);
    if (!A || !B) throw new Error(`unknown fixture id in pair ${a} / ${b}`);
    if (A.family.split !== B.family.split) throw new Error(`pair crosses splits: ${a} / ${b}`);
    const key = [a, b].sort().join("|");
    if (seen.has(key)) throw new Error(`duplicate pair ${key}`);
    seen.add(key);
    out.push({ a: A.text, b: B.text, label, kind, split: A.family.split, ...(note ? { note } : {}) });
  };
  for (const f of FAMILIES) {
    for (const s of f.subjects) {
      for (let i = 0; i < s.texts.length; i++) {
        for (let j = i + 1; j < s.texts.length; j++) {
          const a = s.texts[i]!;
          const b = s.texts[j]!;
          const kind =
            a.lang !== b.lang
              ? b.tags?.includes("tr") && i === 0
                ? "cross-language-translation"
                : "cross-language-same-subject"
              : "same-language-same-subject";
          const extra = [...(a.tags ?? []), ...(b.tags ?? [])].filter((x) => x !== "tr");
          push(a.id, b.id, "related", extra.length ? `${kind}+${[...new Set(extra)].join("+")}` : kind);
        }
      }
    }
  }
  for (const p of HARD_NEGATIVES) push(p.a, p.b, "unrelated", `hard-negative:${p.kind}`, p.note);
  for (const p of AMBIGUOUS) push(p.a, p.b, "ambiguous", p.kind, p.note);
  // Systematic cross-family negatives, balanced across languages: each subject's first English
  // and first Chinese text against those of every subject in another family of the same split
  // (en–en, zh–zh, and both en–zh directions).
  const rep = (s: Subject, lang: Lang) => s.texts.find((x) => x.lang === lang);
  for (const split of ["calibration", "heldout"] as const) {
    const fams = FAMILIES.filter((f) => f.split === split);
    for (let i = 0; i < fams.length; i++) {
      for (let j = i + 1; j < fams.length; j++) {
        for (const s1 of fams[i]!.subjects) {
          for (const s2 of fams[j]!.subjects) {
            for (const [l1, l2] of [["en", "en"], ["zh", "zh"], ["en", "zh"], ["zh", "en"]] as const) {
              const a = rep(s1, l1);
              const b = rep(s2, l2);
              if (!a || !b || seen.has([a.id, b.id].sort().join("|"))) continue;
              push(a.id, b.id, "unrelated", `cross-family-${l1}-${l2}`);
            }
          }
        }
      }
    }
  }
  return out;
}

export function allTexts(): FixtureText[] {
  return FAMILIES.flatMap((f) => [...f.subjects.flatMap((s) => s.texts), ...f.distractors]);
}
