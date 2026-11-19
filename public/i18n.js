/* ==========================================================================
   乌叶MC · i18n.js — Chinese source, English overlay.
   Pages are authored in Chinese. In English mode every text node and UI
   attribute is looked up in DICT (exact, whitespace-normalised) or PATTERNS
   (strings with numbers); content rendered later is caught by a
   MutationObserver. Fan-written wishes are left in their own language.
   Choose with ?lang=en|zh, the header button, or the browser language.
   ========================================================================== */
(function () {
  'use strict';

  const KEY = 'wy:lang';
  const read = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const write = (v) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  };
  const fromUrl = (location.search.match(/[?&]lang=(en|zh)/) || [])[1];
  if (fromUrl) write(fromUrl);
  const initial = fromUrl || read() || 'zh'; // Chinese unless the visitor picked EN

  const DICT = {
    // ---- chrome / nav ----
    '首页': 'Home', '许愿池': 'Wish Pool', '投票': 'Vote', '擂台': 'Arena', '规则': 'Rules', '下载': 'Downloads', '排行榜': 'Leaderboard', '赞助': 'Sponsor', '赞助榜': 'Sponsors', '星光榜': 'Starlight', '当前身份': 'You are', '匿名': 'Anonymous', '起个名字': 'Pick a name', '我有钥匙': 'I have a key', '确定': 'OK', '找回': 'Restore', '复制': 'Copy', '在这台设备退出': 'Sign out on this device', '微信': 'WeChat', '支付宝': 'Alipay', '已上榜 ✦': 'On the board ✦', '等待乌叶确认': 'Waiting for Wuye', '未通过': 'Not approved', '署名': 'Named',
    '抖音主页': 'Douyin', '我要许愿': 'Make a wish', '主导航': 'Main navigation', '展开导航': 'Open menu',
    '跳到主要内容': 'Skip to content', '公告': 'NEWS', '站点公告': 'Site news', '乌叶MC 模组许愿池首页': 'Wuye MC Mod Wish Pool home',
    '乌叶MC': 'Wuye MC', '乌叶MC · 模组许愿池': 'Wuye MC · Mod Wish Pool',
    '乌叶MC · 模组许愿池 | 下一位星神，由你点名': 'Wuye MC · Mod Wish Pool | You pick the next Aeon',
    '本站是乌叶MC 的粉丝许愿池：写下你想看的模组，投票让它成真。': 'This is Wuye MC’s fan wish pool: write the mod you want, vote it into reality.',
    '逛逛': 'EXPLORE', '找到我': 'FIND ME', '站长入口': 'Admin', '抖音 @乌叶MC': 'Douyin @乌叶MC', '抖音号 27276177171': 'Douyin ID 27276177171',
    '合作 / 问题请走抖音私信': 'Collabs / questions: Douyin DM',
    '粉丝自发许愿与投票站，用爱发电，与官方无关。站内建议会由乌叶MC 本人定期查看。': 'A fan-made wish & voting site, run for love, not affiliated with any official party. Wuye MC reads it regularly.',
    'MADE WITH BLOCKS & STARLIGHT · 非官方粉丝站': 'MADE WITH BLOCKS & STARLIGHT · UNOFFICIAL FAN SITE',
    '这个站点需要 JavaScript 才能加载许愿池和投票，请开启后再访问。': 'This site needs JavaScript to load wishes and polls.',
    '乌叶MC 的黑猫头像': 'Wuye MC’s black-cat avatar',

    // ---- home ----
    '下一位星神，': 'The next Aeon,', '由你点名': 'is your call',
    '天弓、药王、帝弓、琥珀王之后，下一位该是谁？': 'After the Sky Archer, the Medicine King, the Hunt and the Amber Lord, who’s next?',
    '把想看的技能、角色、整活玩法写进许愿池': 'Drop the skill, character or crazy mechanic you want into the wish pool',
    '， 大家投票，票数最高的灵感会被我认真翻牌——说不定就是下一期《技能独特 我来复刻！》。': '. Everyone votes, and the top wishes get my full attention — it might be the next episode of “Unique Skills, Rebuilt!”.',
    '大家投票，票数最高的灵感会被我认真翻牌——说不定就是下一期《技能独特 我来复刻！》。': 'Everyone votes, and the top wishes get my full attention — it might be the next episode of “Unique Skills, Rebuilt!”.',
    '写下我的灵感': 'Write my wish', '进入星神擂台': 'Enter the Aeon Arena', '粉丝': 'fans', '获赞': 'likes', '许愿': 'wishes', '票': 'votes',
    'LATEST · 最新复刻': 'LATEST · NEW BUILD', '一切献给——琥珀王！！': 'All for the Amber Lord!!', '点击在抖音观看': 'Watch on Douyin',
    '最新作品封面': 'Latest video cover', '最新作品': 'Latest works', '评论区在点名': 'The comments are calling for',
    '最新复刻': 'Latest builds', '抖音全部作品 →': 'All videos on Douyin →',
    '“技能独特 我来复刻！”系列。点封面去抖音看原片，觉得好就在这里点一颗星。': 'The “Unique Skills, Rebuilt!” series. Tap a cover to watch on Douyin; give it a star here if you liked it.',
    '制作航线': 'Build roadmap', '被采纳的灵感走到哪一步了，这里实时更新。': 'Where accepted wishes are right now, updated live.',
    '正在被点名': 'Most wanted', '许愿池里票数最高的灵感。看到喜欢的就投一票。': 'The top-voted wishes. See one you like? Vote for it.',
    '进入许愿池 →': 'Open the wish pool →', '星神擂台': 'Aeon Arena', '两两对决，赢家晋级，冠军就是下期主角。': 'Head-to-head duels; winners advance and the champion stars in the next episode.',
    '看完整对阵表 →': 'Full bracket →', '下期复刻投票': 'Next-episode poll', '这一票真的会影响下期视频做什么。': 'This vote really decides what the next video is.',
    '全部投票 →': 'All polls →', '开拓者名录': 'Trailblazer board', '投票、点星、打擂台都会累积星光。': 'Voting, starring videos and arena picks all earn starlight.',
    '留下昵称上榜': 'Your nickname', '上榜': 'Join', '许愿票 1 星 · 官方投票 3 星 · 擂台 1 星 · 作品点星 1 星': 'Wish vote 1★ · Official poll 3★ · Arena pick 1★ · Video star 1★',
    '往期也能看': 'From the archive', '从超兽武装到七宗罪 BGM，再到恐怖模组。': 'From Beast Armor to Seven Deadly Sins BGM to horror mods.',
    '你提灵感，我搓模组': 'You dream it, I mod it', '建议、吐槽、整活都欢迎。被采纳的灵感会出现在视频简介里。': 'Ideas, roasts and wild bits all welcome. Accepted wishes get credited in the video description.',
    '去许愿': 'Make a wish', '还没有人上榜，留下昵称做第一个开拓者': 'No one on the board yet — be the first Trailblazer',
    '已登记，继续投票攒星光吧': 'Saved! Keep voting to earn starlight', '点击支持': 'Tap to back', '待定': 'TBD',
    '下期复刻主角': 'stars in the next episode', '擂台休赛中。': 'The arena is on break.', '擂台休赛中，下一季很快开始。': 'The arena is on break — next season soon.',
    '本轮投票已结束，等待晋级。': 'This round is closed; waiting to advance.', '站长还没有公布制作进度，先去许愿池投票吧。': 'No build progress posted yet — go vote in the wish pool.',
    '暂时没有往期内容。': 'No archive yet.', '还没有作品': 'No videos yet', '去抖音主页看看吧。': 'Check the Douyin page.',
    '最新作品加载失败': 'Couldn’t load latest videos', '请刷新重试，或直接去抖音主页观看。': 'Refresh, or watch on Douyin directly.',
    '许愿池加载失败': 'Couldn’t load the wish pool', '投票加载失败': 'Couldn’t load polls',
    '暂时没有进行中的投票': 'No open polls right now', '等站长发起下一次票选吧。': 'Wait for the next one.',
    '还没有人许愿': 'No wishes yet', '成为第一个写下灵感的人吧。': 'Be the first to write one.',
    '给这期点星': 'Star this episode', '进行中': 'OPEN', '已结束': 'CLOSED', '已封箱': 'Sealed', '单选': 'Single choice', '最多选 3 项': 'Up to 3 choices',
    '一人一票，投了就不能改哦。': 'One vote each — no changes after.', '这次已经结束，去投票页看往期结果。': 'This one’s over — see results on the polls page.',
    '去投票': 'Vote now', '看全部投票': 'See all polls',

    // ---- categories / statuses ----
    '游戏复刻': 'Game rebuild', '动漫联动': 'Anime crossover', '生物 / Boss': 'Mobs / Boss', '恐怖惊悚': 'Horror', '机制玩法': 'Mechanics',
    '音乐音效': 'Music & SFX', '其他灵感': 'Other', '✦ 游戏复刻': '✦ Game rebuild', '⚡ 动漫联动': '⚡ Anime crossover', '☠ 生物 / Boss': '☠ Mobs / Boss',
    '◐ 恐怖惊悚': '◐ Horror', '⚙ 机制玩法': '⚙ Mechanics', '♫ 音乐音效': '♫ Music & SFX', '✧ 其他灵感': '✧ Other',
    '待审核': 'Pending', '已采纳': 'Accepted', '音乐': 'Music', '播放背景音乐': 'Play music', '关闭背景音乐': 'Stop music', '备选区': 'Shortlist', '已采纳，排队等待制作。': 'Accepted — queued up for production.', '★ 已采纳': '★ Accepted', '投票中': 'Voting', '制作中': 'Building', '已发布': 'Released', '暂搁置': 'Shelved',
    'PLANNED · 已采纳': 'PLANNED', 'BUILDING · 制作中': 'BUILDING', 'RELEASED · 已发布': 'RELEASED', '置顶': 'Pinned', '刚刚提交': 'Just sent',

    // ---- ideas page ----
    '许愿池 | 乌叶MC · 模组许愿池': 'Wish Pool | Wuye MC', '我想看乌叶搓……': 'I want Wuye to build…', '许愿入口': 'MAKE A WISH',
    '想看的技能、角色、整活玩法，都写在这里。新灵感会先进入「待审核」， 通过后大家就能投票；票数越高，越可能出现在下一期《技能独特 我来复刻！》。': 'Skills, characters, crazy mechanics — write them here. New wishes go to “Pending” first; once approved everyone can vote, and the more votes, the likelier it shows up in the next “Unique Skills, Rebuilt!”.',
    '先看许愿规则': 'Read the rules', '许愿池统计': 'Wish pool stats', '收到许愿': 'wishes', '累计票数': 'votes',
    '提交后进入审核，通过后大家就能投票。请先搜一搜有没有重复的灵感。': 'Wishes are reviewed first, then open for voting. Search for duplicates before posting.',
    '灵感标题': 'Wish title', '4-40 字': '4–40 chars', '例：繁育 · 虫群天灾': 'e.g. Propagation · Swarm Disaster', '分类': 'Category',
    '灵感描述': 'Description', '10-600 字': '10–600 chars', '触发方式、技能范围、冷却和代价、平衡思路……写得越具体，越容易被做出来。': 'Trigger, range, cooldown and cost, balance ideas… the more specific, the likelier it gets built.',
    '昵称': 'Nickname', '可选，≤16 字': 'Optional, ≤16 chars', '请不要填写这一栏': 'Leave this empty', '提交灵感': 'Submit wish', '提交中…': 'Sending…',
    '昵称可留空，默认显示「匿名玩家」。': 'Leave blank to appear as “Anonymous player”.', '匿名玩家': 'Anonymous player', '许愿小贴士': 'Tips',
    '写具体。': 'Be specific.', '「做一个星神」太宽泛；「繁育星神：虫群越打越多，最后孵出虫母 Boss」就很好。': '“Make an Aeon” is too vague; “Propagation: the swarm grows as you fight, then hatches a queen boss” is great.',
    '先搜再提。': 'Search first.', '提交前用搜索框看看有没有相同点子，重复的会被合并或拒收。': 'Check for the same idea first — duplicates get merged or rejected.',
    '一个人可以许多个愿': 'You can make many wishes', '，但同一内容刷屏会被限流（每小时最多 8 条）。': ', but spamming is rate-limited (8 per hour max).',
    '大家的灵感': 'Everyone’s wishes', '搜索灵感': 'Search wishes', '搜标题 / 描述 / 作者': 'Search title / description / author', '筛选灵感': 'Filter wishes',
    '按分类筛选': 'Filter by category', '按状态筛选': 'Filter by status', '排序方式': 'Sort', '全部': 'All', '全部状态': 'All statuses', '最热': 'Hot', '最新': 'New',
    '重置': 'Reset', '加载更多': 'Load more', '加载中…': 'Loading…', '已经到底啦 · 共': 'That’s everything · ', '条': 'total',
    '条灵感。看到喜欢的就投一票，让它往前排。': 'wishes. Vote for the ones you like to push them up.', '共': '',
    '没有找到匹配的灵感': 'No matching wishes', '换个关键词，或者清空筛选，看看大家的全部许愿。': 'Try another keyword, or clear filters to see everything.',
    '清空筛选': 'Clear filters', '灵感没能加载出来': 'Couldn’t load wishes', '重新加载': 'Reload',
    '成为第一个写下灵感的人吧，回到上面的许愿表单，一句话也行。': 'Be the first — one sentence in the form above is enough.',
    '乌叶回复：': 'Wuye replies: ', '取消投票': 'Remove vote', '给这个灵感投票': 'Vote for this wish', '已取消投票': 'Vote removed',
    '投票成功，谢谢你的支持！': 'Voted — thanks for the support!', '许愿成功！审核通过后大家就能投票啦': 'Wish sent! Everyone can vote once it’s approved',
    '已提交成功！审核通过后就会出现在列表里。': 'Sent! It will appear once approved.',
    '已提交成功！当前筛选条件下列表里暂时看不到它，点上面的「重置」就能找到。': 'Sent! It’s hidden by your filters — press “Reset” to find it.',
    '请先写一个标题（4-40 字）': 'Add a title (4–40 chars)', '请写点描述（10-600 字）': 'Add a description (10–600 chars)', '请选一个分类': 'Pick a category',
    '灵感标题至少 4 个字': 'Title needs at least 4 chars', '灵感标题最多 40 个字': 'Title max 40 chars', '灵感描述至少 10 个字': 'Description needs at least 10 chars',
    '灵感描述最多 600 个字': 'Description max 600 chars', '昵称最多 16 个字': 'Nickname max 16 chars',
    '提交太频繁啦，休息一会儿再试～': 'Too many wishes — take a breather~', '提交失败，请稍后再试': 'Couldn’t send, try again later',
    '提交被拒绝了，请稍后再试': 'Rejected, try again later', '这条灵感不存在或已被隐藏': 'This wish doesn’t exist or was hidden',
    '投票失败，请稍后再试': 'Vote failed, try again', '投票太频繁啦，休息一下再来～': 'Too many votes — take a breather~',
    '你已经投过这一票啦，已为你记上': 'You already voted for this one — counted',

    // ---- polls page ----
    // ---- vote board ----
    '下一个做什么，': 'What should be next?', '每张卡片都是一个候选。投给你最想看的，票数最高的会优先进入制作；开始制作后会移到「制作中」，做完就进「已完成」。': 'Every card is a candidate. Vote for what you most want — the top ones get built first; once work starts they move to “Building”, and when finished to “Done”.',
    '候选': 'candidates', '总票数': 'total votes', '人参与': 'voters', '排序': 'Sort', '游戏筛选': 'Filter by game',
    '票数最高': 'Most votes', '评论区呼声': 'Most requested', '最新加入': 'Newest', '按游戏': 'By game', '全部游戏': 'All games',
    '已经在做了，敬请期待。': 'Already in the works — stay tuned.', '已完成': 'Done', '投票选出来、已经做好的作品。': 'Voted in by you, and finished.',
    '投一票': 'Vote', '已投 ✦': 'Voted ✦', '这个游戏下暂时没有候选。': 'No candidates for this game yet.',
    '没看到想要的？': 'Don’t see yours?', '去许愿池提一个 →': 'Suggest one in the wish pool →', '去投票': 'Go vote', '去投票 →': 'Go vote →',
    '投票、点星都会累积星光。': 'Voting and starring earn starlight.', '投票 1 星 · 作品点星 1 星': 'Vote 1 star · Like 1 star',
    '崩坏：星穹铁道': 'Honkai: Star Rail', '火影忍者': 'Naruto', '超兽武装': 'Chao Shou Wu Zhuang', '我在精神病院学斩神': 'Slay the Gods', '乌叶原创': 'Wuye original', '七宗罪': 'Seven Deadly Sins',
    '投票中心 | 乌叶MC · 模组许愿池': 'Polls | Wuye MC', '投票中心 · VOTE FOR NEXT': 'VOTE FOR NEXT', '下一期做什么，': 'What’s next?', '由你投票': 'You decide',
    '每个设备每场只能投一次，投出后不可修改。单选投票只能选一项；多选投票最多选三项，提交后立即公布结果。': 'One vote per device per poll, final once cast. Single-choice polls take one option; multi-choice up to three. Results show right after.',
    '投票数据概览': 'Poll stats', '进行中投票': 'open polls', '累计投票人次': 'ballots cast', '投票规则': 'Voting rules', '现在可以投': 'Open now',
    '选好你的答案再提交，同一设备每场投票只能参与一次。': 'Pick your answer then submit — one ballot per device per poll.',
    '截止时间以卡片内倒计时为准': 'Deadlines follow each card’s countdown', 'OPEN · 进行中': 'OPEN', 'CLOSED · 已结束': 'CLOSED',
    '往期投票结果': 'Past results', '已经封箱的投票，结果按参与人数计算百分比。': 'Closed polls; percentages are by number of voters.',
    '没有想投的选项？': 'Nothing you want?', '把灵感写进许愿池，下一场投票的选项可能就是它。': 'Put it in the wish pool — it could be an option next time.',
    '去许愿池': 'Go to the wish pool', '确认投票': 'Confirm vote', '已投票': 'Voted', '多选 · 最多 3 项': 'Multi · up to 3', '长期开放': 'No deadline',
    '一人一票，投出后不可修改。': 'One vote each, final once cast.', '最多选 3 项，投出后不可修改。': 'Up to 3 choices, final once cast.',
    '已选择 1 项，提交后不可修改。': '1 selected — final once submitted.', '投票成功，感谢参与！': 'Voted — thanks for joining!',
    '结果已锁定。': 'Result locked.', '这次投票已经结束。': 'This poll has ended.', '这次投票只能选一个选项': 'This poll is single-choice',
    '请选择要投的选项': 'Pick an option', '刷新投票失败，请稍后重试': 'Couldn’t refresh polls', '还没有已结束的投票': 'No closed polls yet',
    '等第一场投票封箱后，结果会显示在这里。': 'Results appear here once the first poll closes.',
    '等站长发起下一场票选吧，先去许愿池留下你的灵感。': 'Wait for the next poll — leave a wish meanwhile.',
    '请检查网络后重试。': 'Check your connection and retry.', '投票结果': 'Poll results',

    // ---- arena ----
    '星神擂台 | 乌叶MC · 模组许愿池': 'Aeon Arena | Wuye MC', '星神两两对决，粉丝投票晋级，冠军就是乌叶MC 下一期复刻主角。': 'Aeons duel head-to-head; fans vote them through and the champion stars in Wuye MC’s next build.',
    '两两对决，每轮由站长封箱晋级。每个设备每场一票，可以随时改投，封箱后锁定。': 'Head-to-head duels; each round is sealed by Wuye. One pick per device per duel — you can switch until it’s sealed.',
    '投票、点星、打擂台都会累积星光，留下昵称就能上榜。': 'Voting, starring and arena picks earn starlight — leave a nickname to show up here.',
    '你的昵称': 'Your nickname', '每场对决选你更想看的一位': 'Pick who you’d rather see in each duel', '站长封箱后票多者晋级': 'The leader advances when the round is sealed',
    '最终冠军进入下期制作航线': 'The champion goes onto the build roadmap', '首轮': 'Round of 8', '次轮': 'Round 2', '半决赛': 'Semifinal', '决赛': 'Final',
    'SEMI · 半决赛': 'SEMIFINAL', 'FINAL · 决赛': 'FINAL',

    // ---- rules ----
    '许愿规则 | 乌叶MC · 模组许愿池': 'Rules | Wuye MC', '许愿规则 & 投票说明': 'Wish & voting rules', '规则很简单': 'The rules are simple',
    '三分钟看完，你就知道怎么让喜欢的点子被看到。本站是粉丝自发做的，不是官方渠道。': 'Three minutes and you’ll know how to get your idea seen. This is a fan site, not an official channel.',
    '本页目录': 'On this page', '怎么玩': 'How it works', '许愿规则': 'Wish rules', '审核与采纳': 'Review & acceptance', '常见问题': 'FAQ', '隐私与安全': 'Privacy & security',
    '写下你的灵感': 'Write your wish', '让同好投票': 'Get votes', '等站长翻牌': 'Wait for the pick',
    '一个技能、一个角色、一种整活机制都行。标题一句话，描述讲清楚你想看的效果。': 'A skill, a character, a crazy mechanic — anything. One-line title, a description of what you want to see.',
    '把链接发到群里、评论区，给喜欢的点子拉票。票数越高，越可能进入制作名单。': 'Share the link in groups and comments to rally votes. More votes, better odds.',
    '我会定期看许愿池和投票结果，结合制作难度与系列规划决定下一期做什么。': 'I check wishes and polls regularly and pick the next build by difficulty and series plans.',
    '技能表现说清楚：触发方式、范围、冷却、连招。': 'Spell out the skill: trigger, range, cooldown, combos.',
    '给个平衡思路：强度、代价、适用场景。': 'Suggest balance: power, cost, when to use it.', '有参考就更好：视频、角色名、招式名都行。': 'References help: videos, character or move names.',
    '标题 4-40 字，描述 10-600 字。': 'Title 4–40 chars, description 10–600 chars.', '；不要贴外部链接或联系方式。': '; no external links or contact info.',
    '禁止广告、引流、人身攻击、违法内容': 'No ads, self-promotion, personal attacks or illegal content',
    '标题一句话说清要什么；描述里写技能表现、平衡思路、参考角色都行。重复的灵感不用重复提，去给它投票更有效。': 'Say what you want in one line; describe the skill, balance and references. Don’t repost duplicates — voting for them helps more.',
    '每个设备都能投票，再点一次就能取消。': 'Every device can vote; tap again to undo.', '一个灵感一票，可以取消后改投；同一设备重复点只算一次。': 'One vote per wish; you can undo and re-vote; repeats count once.',
    '用多个账号刷票没有意义：系统按设备和 IP 限流，异常票会被清理。': 'Vote-stuffing is pointless: limits apply per device and IP, and abnormal votes get removed.',
    '投票结果代表社区偏好，不构成必须制作的承诺；最终排期由站长结合难度决定。': 'Results show community preference, not a promise; Wuye makes the final call.',
    '提交之后': 'After you submit', '新提交的灵感默认不公开显示，站长看到后会判断是否放行。': 'New wishes are hidden until Wuye approves them.',
    '进入备选，会在后续视频或投票里出现。': 'On the shortlist — may appear in videos or polls.', '真的在搓了，偶尔会在动态里透露进度。': 'Actually being built — progress teased now and then.',
    '做完了，视频简介会尽量标注灵感来源。': 'Done — the video description credits the wish when possible.',
    '想法不错但暂时做不了（依赖、工期、技术限制），以后可能重启。': 'Good idea, not doable yet (dependencies, time, tech) — may return later.',
    '官方回复会出现在灵感卡片上；没有回复不代表没看到。': 'Official replies show on the wish card; no reply doesn’t mean unseen.',
    '票数最高就一定会做吗？': 'Will the top wish always get built?', '不一定。还要看技术难度、系列节奏和版权边界。但高票灵感会被优先评估。': 'Not always — difficulty, pacing and copyright matter. But top wishes are evaluated first.',
    '我的许愿为什么没显示？': 'Why isn’t my wish showing?', '新灵感先进入审核队列，站长看过后才会出现在列表里。带广告、重复或表述不清的会被拒。': 'New wishes wait for review. Ads, duplicates or unclear wishes get rejected.',
    '可以指定用哪个模组加载器吗？': 'Can I pick the mod loader?', '可以写在描述里。目前主要面向 NeoForge / Fabric 的现代版本，具体以视频说明为准。': 'Mention it in the description. Mostly modern NeoForge / Fabric; see each video for details.',
    '网站会收集我的抖音账号吗？': 'Does this site collect my Douyin account?', '不会。本站与抖音账号体系完全独立，不需要登录抖音。': 'No. This site is fully separate from Douyin accounts; no Douyin login needed.',
    '能投稿模型、贴图或代码吗？': 'Can I contribute models, textures or code?', '欢迎。请通过抖音私信说明来意，不要直接在许愿里贴网盘或外链。': 'Welcome! DM on Douyin first — don’t paste download links in wishes.',
    '站内不要求手机号、身份证或第三方登录，也没有账号体系。': 'No phone number, ID or third-party login — there are no accounts.',
    '为了防刷票，服务器会记录一个匿名设备标识和必要的请求信息（IP、时间、UA），仅用于限流和安全审计。': 'To stop vote-stuffing the server logs an anonymous device id and basic request info (IP, time, UA), only for rate limiting and security.',
    '昵称与许愿内容会公开展示，请不要在许愿里填写真实姓名、住址等隐私信息。': 'Nicknames and wishes are public — don’t include real names, addresses or private info.',
    '站长后台使用独立管理码登录，不对外注册；管理操作会写审计日志。': 'The admin uses a separate code, no public sign-up; admin actions are audit-logged.',
    '本站使用 HTTPS，通信内容加密；如发现安全漏洞，请通过抖音私信联系。': 'The site uses HTTPS. Found a security issue? DM on Douyin.',
    '许愿是免费的，站内不会以任何理由向你收费。遇到冒充站长收费的，直接举报。': 'Wishing is free and always will be. Anyone charging in Wuye’s name is a scammer — report them.',
    '看完了，去写一个吧': 'Done reading? Write one', '你的一句话，可能就是一整期视频的起点。': 'One sentence from you could start a whole episode.',
    '先投票': 'Vote first', '看投票': 'See polls', '去写许愿': 'Write a wish', '选一个最接近的': 'Pick the closest', '下期投票：': 'Next poll:', '许愿投票：': 'Wish voting:',
    '投票截止后': 'After the deadline', '结果自动封箱，页面上会显示「已结束」。': 'Results seal automatically and show “Closed”.',
    '单选一次，投完不能改；多选投票最多选 3 项。': 'Single choice, final; multi-choice up to 3.', '看下期投票': 'See next poll', '先看规则': 'Read the rules',
    '新灵感会先进入「待审核」，站长看过会标成已采纳 / 制作中。重复的灵感会被合并，去给它投一票同样有效。': 'New wishes start as “Pending”; Wuye marks them Accepted / Building. Duplicates get merged — voting for the original works just as well.',
    '什么样的灵感会被采纳': 'What gets accepted',

    // ---- 404 ----
    '页面不存在 | 乌叶MC · 模组许愿池': 'Page not found | Wuye MC', '这条星轨断在这里了': 'This star-rail ends here',
    '你访问的页面不存在，或者已经被站长收进了虚空。要不要回到有光的地方？': 'This page doesn’t exist, or it fell into the void. Head back to the light?', '回到首页': 'Back home',

    // ---- generic ----
    '关闭': 'Close', '取消': 'Cancel', '确定': 'OK', '确认操作': 'Confirm', '对话框': 'Dialog', '已复制到剪贴板': 'Copied', '复制失败，请手动选中复制': 'Copy failed — select and copy manually',
    '加载失败，请稍后再试': 'Failed to load, try again', '网络好像开小差了，请稍后再试。': 'Network hiccup — try again shortly.',
    '网络好像开小差了，请检查网络后重试': 'Network hiccup — check your connection', '网络好像开小差了，请稍后重试。': 'Network hiccup — try again shortly.',
    '暂无公告，先去看看大家的许愿吧。': 'No news — go browse the wishes.', '刚刚': 'just now', '操作太频繁啦，休息一下再来～': 'Slow down a little~',

    // ---- downloads + fan gate ----
    '下载中心 | 乌叶MC · 模组许愿池': 'Downloads | Wuye MC', '模组下载': 'Mod downloads', '模组': 'Mods', '整合包': 'Modpacks',
    '关注乌叶MC 的粉丝专享。进抖音粉丝群拿粉丝口令，解锁全部模组和整合包下载。': 'For Wuye MC followers. Get the fan code in the Douyin fan group to unlock every mod and modpack.',
    '粉丝验证': 'FOLLOWER CHECK', '输入粉丝口令': 'Enter the fan code', '你的抖音昵称': 'Your Douyin nickname', '粉丝口令': 'Fan code', '解锁下载': 'Unlock downloads',
    '口令在哪？加入乌叶MC 的抖音粉丝群，口令就在群里，会不定期更换。': 'Where’s the code? Join Wuye MC’s Douyin fan group — the code is posted there and changes from time to time.',
    '去抖音关注': 'Follow on Douyin', '已验证粉丝': 'VERIFIED FOLLOWER', '欢迎回来，': 'Welcome back, ',
    '整合包还在打包中': 'Modpacks are still being packed', '第一个整合包很快上线，先去许愿池告诉我你想要哪些模组组合。': 'The first modpack lands soon — tell me which mods to bundle in the wish pool.',
    '模组还在锻造中': 'Mods are still in the forge', '第一个模组很快上线。': 'The first mod is coming soon.',
    '下载': 'Download', '解锁后下载': 'Unlock to download', '次下载': 'downloads', '先输入粉丝口令解锁下载': 'Enter the fan code first',
    '口令不对哦，去乌叶MC 的抖音找找最新口令': 'Wrong code — check Wuye MC’s Douyin for the latest one', '站长还没有设置粉丝口令': 'Wuye hasn’t set a fan code yet',
    '验证成功，欢迎你，开拓者！': 'Verified — welcome aboard, Trailblazer!', '下载链接已过期，请回到下载页重新点击': 'Download link expired — click again on the downloads page',
    '粉丝专享': 'FOLLOWERS ONLY', '下载中心': 'Downloads', 'SHA-256 校验': 'SHA-256',
  };

  const PATTERNS = [
    [/^([\d.]+)万$/, (m, n) => `${Math.round(parseFloat(n) * 10)}K`],
    [/^([\d.,]+[KkMm万]?) 票$/, (m, n) => `${n} votes`],
    [/^([\d.,]+[万]?) 播放$/, (m, n) => `${n.replace(/^([\d.]+)万$/, (x, k) => `${Math.round(parseFloat(k) * 10)}K`)} plays`],
    [/^(\d+) 分钟前$/, (m, n) => `${n} min ago`],
    [/^(\d+) 小时前$/, (m, n) => `${n} h ago`],
    [/^(\d+) 天前$/, (m, n) => `${n} days ago`],
    [/^发起于 (.+)$/, (m, t) => `started ${translateText(t)}`],
    [/^还剩 (\d+) 天 (\d+) 小时$/, (m, d, h) => `${d}d ${h}h left`],
    [/^还剩 (\d+) 小时 (\d+) 分$/, (m, h, mi) => `${h}h ${mi}m left`],
    [/^还剩 (\d+) 分钟$/, (m, mi) => `${mi} min left`],
    [/^人投票$/, () => 'voters'], [/^人参与，合计$/, () => 'voters, '], [/^张选票。?$/, () => 'ballots.'], [/^张选票；多选百分比按参与人数计算。$/, () => 'ballots; multi-choice % is by voters.'],
    [/^第 (\d+) 轮 \/ 共 (\d+) 轮$/, (m, a, b) => `ROUND ${a} OF ${b}`],
    [/^第 (\d+) 轮$/, (m, a) => `Round ${a}`],
    [/^ROUND (\d+) · .+$/, (m, a) => `ROUND ${a}`],
    [/^(\d+)% · (\d+) 票$/, (m, p, v) => `${p}% · ${v} votes`],
    [/^支持 (.+)$/, (m, x) => `Back ${x}`],
    [/^(取消投票|投票|给这个灵感投票)：(.*)$/, (m, a, t) => `${DICT[a] || 'Vote'}: ${t}`],
    [/^(.+)，在抖音观看$/, (m, t) => `${t} — watch on Douyin`],
    [/^(.+) 封面$/, (m, t) => `${t} cover`],
    [/^你投给了：(.+)$/, (m, x) => `You voted: ${x}`],
    [/^已选 (\d+) 项，还可以再选 (\d+) 项。$/, (m, a, b) => `${a} selected, ${b} more allowed.`],
    [/^已选满 (\d+) 项，不能再多选啦。$/, (m, a) => `${a} selected — that’s the max.`],
    [/^最多只能选 ?(\d+) ?(项|个选项)(，请先取消一项再选。)?$/, (m, a) => `Up to ${a} choices.`],
    [/^最多选择 (\d+) 个选项$/, (m, a) => `Up to ${a} choices`],
    [/^加载更多（还有 (\d+) 条）$/, (m, a) => `Load more (${a} left)`],
    [/^已显示 (\d+) \/ (\d+) 条$/, (m, a, b) => `Showing ${a} / ${b}`],
    [/^请求失败（(\d+)）$/, (m, a) => `Request failed (${a})`],
    [/^评论区 (\d+) 次$/, (m, a) => `${a} comment requests`],
    [/^(\d+) 次下载$/, (m, a) => `${a} downloads`],
    [/^(.+) · (\d+) 票$/, (m, a, b) => `${translateText(a) ?? a} · ${b} votes`],
    [/^(.+) ✦$/, (m, a) => `${a} ✦`],
  ];

  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  function translateText(text) {
    const key = norm(text);
    if (!key || !/[一-鿿]/.test(key)) return null;
    if (Object.prototype.hasOwnProperty.call(DICT, key)) return DICT[key];
    for (const [re, fn] of PATTERNS) {
      const m = key.match(re);
      if (m) return fn(...m);
    }
    return null;
  }

  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const SKIP = 'script,style,textarea,[data-raw],#wy-boot,.idea-main h3,.idea-card h3,.official-reply,.cx-voices,.vb-card h3,.vb-mini h3';

  // Originals are remembered so the switch is reversible in place (no reload).
  const textOrig = new WeakMap(); // Text node -> original Chinese
  const attrOrig = new WeakMap(); // Element -> { attr: original }
  let lang = initial;

  function setText(node) {
    const p = node.parentElement;
    if (!p || p.closest(SKIP)) return;
    if (!textOrig.has(node)) textOrig.set(node, node.nodeValue);
    const src = textOrig.get(node);
    if (lang !== 'en') {
      if (node.nodeValue !== src) node.nodeValue = src;
      return;
    }
    const out = translateText(src);
    if (out == null) return;
    const v = src.match(/^\s*/)[0] + out + src.match(/\s*$/)[0];
    if (node.nodeValue !== v) node.nodeValue = v;
  }
  function setAttrs(el) {
    if (el.closest(SKIP)) return;
    const isBtn = el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button');
    const names = isBtn ? [...ATTRS, 'value'] : ATTRS;
    names.forEach((a) => {
      const cur = a === 'value' ? el.value : el.getAttribute(a);
      if (!cur) return;
      let store = attrOrig.get(el);
      if (!store) attrOrig.set(el, (store = {}));
      if (!(a in store)) store[a] = cur;
      const src = store[a];
      const v = lang === 'en' ? translateText(src) ?? src : src;
      if (cur === v) return;
      if (a === 'value') el.value = v;
      else el.setAttribute(a, v);
    });
  }
  function walk(root) {
    if (root.nodeType === 3) return setText(root);
    if (root.nodeType !== 1 || root.closest(SKIP)) return;
    setAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n = w.nextNode();
    while (n) {
      if (n.nodeType === 3) setText(n);
      else setAttrs(n);
      n = w.nextNode();
    }
  }

  let titleOrig = document.title;
  const metaOrig = new Map();
  function applyHead() {
    document.title = lang === 'en' ? translateText(titleOrig) ?? titleOrig : titleOrig;
    document.querySelectorAll('meta[name="description"]').forEach((m) => {
      if (!metaOrig.has(m)) metaOrig.set(m, m.content);
      const o = metaOrig.get(m);
      m.content = lang === 'en' ? translateText(o) ?? o : o;
    });
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  }

  let observer = null;
  function applyAll() {
    applyHead();
    walk(document.body);
    if (observer) observer.takeRecords(); // drop records of our own writes
  }

  function watch() {
    observer = new MutationObserver((muts) => {
      muts.forEach((m) => {
        if (m.type === 'characterData') {
          // app code wrote new (Chinese) text: that becomes the new original
          textOrig.set(m.target, m.target.nodeValue);
          setText(m.target);
        } else if (m.type === 'attributes') {
          const st = attrOrig.get(m.target);
          if (st) delete st[m.attributeName];
          setAttrs(m.target);
        } else m.addedNodes.forEach(walk);
      });
      observer.takeRecords();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  const api = (window.WYI18N = {
    get lang() {
      return lang;
    },
    t(s) {
      return lang === 'en' ? translateText(s) ?? s : s;
    },
    set(next) {
      if (next === lang) return;
      write(next);
      const url = new URL(location.href);
      if (url.searchParams.has('lang')) {
        url.searchParams.delete('lang');
        history.replaceState(history.state, '', url.href);
      }
      const swap = () => {
        lang = next;
        applyAll();
        document.dispatchEvent(new CustomEvent('wy:lang', { detail: lang }));
      };
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!document.startViewTransition || reduce) return swap();
      const html = document.documentElement;
      html.classList.add('wy-lang-swap');
      const vt = document.startViewTransition(swap);
      vt.finished.finally(() => html.classList.remove('wy-lang-swap'));
    },
  });

  // a soft page swap brings a new title/description
  api.refresh = (title, desc) => {
    if (title != null) titleOrig = title;
    if (desc != null) document.querySelectorAll('meta[name="description"]').forEach((m) => metaOrig.set(m, desc));
    applyAll();
  };
  applyHead();
  function run() {
    if (lang === 'en') walk(document.body);
    watch();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
  api.ready = true;
})();
