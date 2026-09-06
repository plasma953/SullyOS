/**
 * 塔罗静态真实数据：78 张韦特塔罗 + 6 个经典牌阵。
 *
 * 这份文件是全 App 唯一的牌义来源（手写整理，体系以 Waite《Pictorial Key
 * to the Tarot》为准；牌阵位置含义来自 Biddy Tarot / tarottechnique 等
 * 真实塔罗资料，见各牌阵 source 字段）。
 *
 * 约定（省 token 的关键）：
 * - UI 展示、牌库浏览都从这里读；
 * - LLM 解读只注入「本次抽到的几张牌」的牌义（见 tarotLlm.ts），绝不整份灌入；
 * - 落库只存牌 id + 正逆，不复制牌义文本。
 */

export type TarotArcana = 'major' | 'wands' | 'cups' | 'swords' | 'pentacles';

export interface TarotCardFace {
  keywords: string[];
  meaning: string;
}

export interface TarotCard {
  id: string;
  /** 引擎 cardIndex 对齐的序号，0..77，由 CARDS 组装时自动赋值 */
  index: number;
  arcana: TarotArcana;
  /** 大牌 0..21；小牌 1..14（11 侍从 / 12 骑士 / 13 王后 / 14 国王） */
  num: number;
  nameCn: string;
  nameEn: string;
  element?: string;
  astrology?: string;
  upright: TarotCardFace;
  reversed: TarotCardFace;
  /** public/ 下的相对路径，如 tarot/rws/major-00-fool.jpg */
  image: string;
}

export type SpreadLayout = 'single' | 'row' | 'cross' | 'relationship' | 'arc' | 'celtic';

export interface SpreadPosition {
  name: string;
  meaning: string;
  /** 占卜桌上的相对坐标（0..1），UI 据此摆牌 */
  x: number;
  y: number;
  /** 凯尔特十字第 2 张等横压的牌 */
  crossed?: boolean;
}

export interface TarotSpread {
  id: string;
  nameCn: string;
  nameEn: string;
  level: '入门' | '进阶' | '深度';
  bestFor: string;
  cardCount: number;
  source: string;
  layout: SpreadLayout;
  positions: SpreadPosition[];
}

interface RawCard {
  id: string;
  arcana: TarotArcana;
  num: number;
  nameCn: string;
  nameEn: string;
  element?: string;
  astrology?: string;
  up: string[];
  upM: string;
  rev: string[];
  revM: string;
}

const toCard = (raw: RawCard, index: number): TarotCard => ({
  id: raw.id,
  index,
  arcana: raw.arcana,
  num: raw.num,
  nameCn: raw.nameCn,
  nameEn: raw.nameEn,
  element: raw.element,
  astrology: raw.astrology,
  upright: { keywords: raw.up, meaning: raw.upM },
  reversed: { keywords: raw.rev, meaning: raw.revM },
  image: `tarot/rws/${raw.id}.jpg`,
});

// ─── 大阿尔卡纳 0..21 ───

const MAJORS: RawCard[] = [
  { id: 'major-00-fool', arcana: 'major', num: 0, nameCn: '愚者', nameEn: 'The Fool', element: '风', astrology: '天王星',
    up: ['新的开始', '自发', '纯真', '冒险'], upM: '放下包袱轻装上阵，带着信任踏入未知；结果未知，但出发本身就是答案。',
    rev: ['鲁莽', '轻率', '停滞', '方向不明'], revM: '要么横冲直撞不顾后果，要么想出发却原地打转；先看清脚下再迈步。' },
  { id: 'major-01-magician', arcana: 'major', num: 1, nameCn: '魔术师', nameEn: 'The Magician', astrology: '水星',
    up: ['意志', '创造', '资源齐备', '行动'], upM: '天时地利人和都在手边，把想法变成现实的工具你都有了，只差动手。',
    rev: ['操纵', '欺骗', '犹豫', '才能错置'], revM: '小心花言巧语（来自别人或自己），也别再以"没准备好"为借口拖延。' },
  { id: 'major-02-priestess', arcana: 'major', num: 2, nameCn: '女祭司', nameEn: 'The High Priestess', astrology: '月亮',
    up: ['直觉', '神秘', '内在智慧', '静观'], upM: '答案不在喧哗处，在安静里；相信你的第一感，暂且按兵不动。',
    rev: ['压抑直觉', '表象迷惑', '情绪淹没'], revM: '你明明感觉到了什么却不愿承认； noisy 的信息越多，越要回到内心。' },
  { id: 'major-03-empress', arcana: 'major', num: 3, nameCn: '女皇', nameEn: 'The Empress', astrology: '金星',
    up: ['丰盛', '母性', '自然', '创造力'], upM: '滋养与被滋养的时节：照顾身体、打理生活，创造力会自然开花结果。',
    rev: ['创造力阻塞', '依赖', '物质焦虑'], revM: '付出过多而枯竭，或对物质安全感抓得太紧；先把自己喂饱。' },
  { id: 'major-04-emperor', arcana: 'major', num: 4, nameCn: '皇帝', nameEn: 'The Emperor', astrology: '白羊座',
    up: ['权威', '结构', '掌控', '稳定'], upM: '建立秩序、定规矩、扛责任；用结构和纪律把局面稳住，你就是定海神针。',
    rev: ['专制', '僵化', '失控'], revM: '控制欲过头变成压迫，或恰恰相反局面失控；检查规则是保护人还是困住人。' },
  { id: 'major-05-hierophant', arcana: 'major', num: 5, nameCn: '教皇', nameEn: 'The Hierophant', astrology: '金牛座',
    up: ['传统', '信念', '指引', '制度'], upM: '向经验、师长与既有体系求助；有些路前人走过，听听过来人的话。',
    rev: ['教条', '束缚', '离经叛道'], revM: '规则正在变成枷锁；要么被教条困住，要么为反而反——找到你自己的信条。' },
  { id: 'major-06-lovers', arcana: 'major', num: 6, nameCn: '恋人', nameEn: 'The Lovers', astrology: '双子座',
    up: ['联结', '选择', '和谐', '价值观一致'], upM: '重要的联结或抉择：跟着心走，选那个与你价值观同频的人和路。',
    rev: ['失衡', '错误选择', '关系紧张'], revM: '关系失衡或选错了方向；别用"都挺好"糊弄，失衡的感觉就是信号。' },
  { id: 'major-07-chariot', arcana: 'major', num: 7, nameCn: '战车', nameEn: 'The Chariot', astrology: '巨蟹座',
    up: ['意志胜利', '方向明确', '自律', '前行'], upM: '收缰、瞄准、冲刺；只要方向不散、意志在线，没有拦得住你的。',
    rev: ['失控', '方向散乱', '空转'], revM: '马车在空转：要么用力过猛翻车，要么东一榔头西一棒；先停下来整队。' },
  { id: 'major-08-strength', arcana: 'major', num: 8, nameCn: '力量', nameEn: 'Strength', astrology: '狮子座',
    up: ['内在力量', '耐心', '温柔制胜', '接纳'], upM: '真正的强大是温柔：用耐心驯服焦虑与狮子，硬碰硬不如以柔克刚。',
    rev: ['自我怀疑', '冲动', '强撑'], revM: '内心的小狮子在闹：要么怀疑自己，要么靠发火硬撑；先安抚，再行动。' },
  { id: 'major-09-hermit', arcana: 'major', num: 9, nameCn: '隐者', nameEn: 'The Hermit', astrology: '处女座',
    up: ['内省', '独处', '寻找', '沉淀'], upM: '提灯独行一段：关掉噪音向内看，你要的答案在安静处等你。',
    rev: ['孤立', '迷失', '拒绝指引'], revM: '独处变成了隔绝，或在迷雾里打转却不肯求助；孤独是修行，孤立是困局。' },
  { id: 'major-10-wheel', arcana: 'major', num: 10, nameCn: '命运之轮', nameEn: 'Wheel of Fortune', astrology: '木星',
    up: ['转机', '周期', '命运流转', '顺势'], upM: '轮子开始转动：顺势而为者昌，好运正在路上，抓住这一阵风。',
    rev: ['厄运', '抗拒变化', '循环卡关'], revM: '轮子卡住了：越是逆势硬扛越惨；先认栽、再复盘，等下一圈转机。' },
  { id: 'major-11-justice', arcana: 'major', num: 11, nameCn: '正义', nameEn: 'Justice', astrology: '天秤座',
    up: ['公正', '因果', '诚实', '权衡'], upM: '种什么得什么：拿出事实与诚实，公平会站在准备好的人这边。',
    rev: ['偏颇', '逃避责任', '不公'], revM: '天平歪了：可能是外界不公，也可能是你在为自己开脱；先把账算清楚。' },
  { id: 'major-12-hanged', arcana: 'major', num: 12, nameCn: '倒吊人', nameEn: 'The Hanged Man', element: '水', astrology: '海王星',
    up: ['换位', '等待', '牺牲小我', '放下'], upM: '倒过来看世界：暂停、换位、自愿的小牺牲会换来大的清明。',
    rev: ['拖延', '白白牺牲', '执念'], revM: '吊着不动既无领悟也无进展，或一直在为不值得的人事买单；该落地了。' },
  { id: 'major-13-death', arcana: 'major', num: 13, nameCn: '死神', nameEn: 'Death', astrology: '天蝎座',
    up: ['结束与新生', '蜕变', '放手', '告别'], upM: '一扇门彻底关上，另一扇才会开；主动告别旧章，新生已经在路上。',
    rev: ['抗拒改变', '停滞', '藕断丝连'], revM: '死死攥着该放的东西不撒手；越不肯结束，腐烂的部分拖得越久。' },
  { id: 'major-14-temperance', arcana: 'major', num: 14, nameCn: '节制', nameEn: 'Temperance', astrology: '射手座',
    up: ['平衡', '调和', '节制', '耐心'], upM: '不疾不徐地调配：水温、节奏、分寸都刚刚好，时间会酿出好结果。',
    rev: ['失衡', '极端', '急躁'], revM: '杯子端歪了：要么透支要么摆烂，忽冷忽热；先把节奏调回中线。' },
  { id: 'major-15-devil', arcana: 'major', num: 15, nameCn: '恶魔', nameEn: 'The Devil', astrology: '摩羯座',
    up: ['执念', '束缚', '欲望', '阴影'], upM: '看清锁链：捆住你的多半是执念与欲望，而锁其实没上锁——你随时能走。',
    rev: ['挣脱', '觉醒', '放下执念'], revM: '正在挣脱：看清了成瘾的关系、物欲或自我设限，重获自由的开端。' },
  { id: 'major-16-tower', arcana: 'major', num: 16, nameCn: '高塔', nameEn: 'The Tower', astrology: '火星',
    up: ['剧变', '崩塌', '真相', '重建'], upM: '雷劈下来了：旧结构注定要塌，早塌比晚塌好；废墟上才能盖新楼。',
    rev: ['勉强维持', '延迟的崩塌', '内在动荡'], revM: '明知要塌还在拿手顶着；拖延只会让代价变大，不如主动引爆重建。' },
  { id: 'major-17-star', arcana: 'major', num: 17, nameCn: '星星', nameEn: 'The Star', astrology: '水瓶座',
    up: ['希望', '疗愈', '灵感', '平静'], upM: '风暴后的星空：伤口在愈合，灵感在回流；安静地相信，一切向好。',
    rev: ['失望', '信心动摇', '迷茫'], revM: '星光暂时被云遮住：疲惫让你看不见希望；先休息，别在深夜做决定。' },
  { id: 'major-18-moon', arcana: 'major', num: 18, nameCn: '月亮', nameEn: 'The Moon', astrology: '双鱼座',
    up: ['不安', '幻象', '潜意识', '迷雾'], upM: '雾夜行路：恐惧多半是影子变的，别被想象吓倒；天亮前最容易疑神疑鬼。',
    rev: ['拨云见日', '释然', '走出迷雾'], revM: '雾在散：误会澄清、焦虑落地，一直担心的事并没有那么糟。' },
  { id: 'major-19-sun', arcana: 'major', num: 19, nameCn: '太阳', nameEn: 'The Sun', astrology: '太阳',
    up: ['喜悦', '成功', '活力', '坦荡'], upM: '大晴天：事情成了、心情亮了；大大方方享受这份好，值得庆祝。',
    rev: ['短暂阴霾', '骄傲', '延迟的好消息'], revM: '云遮了一会儿太阳：好事晚到几天，或成功让你有点飘；稳住别浪。' },
  { id: 'major-20-judgement', arcana: 'major', num: 20, nameCn: '审判', nameEn: 'Judgement', element: '火', astrology: '冥王星',
    up: ['觉醒', '召唤', '宽恕', '新生'], upM: '号角响了：原谅过去、回应内心的召唤，是时候升级成新版本的自己。',
    rev: ['自我怀疑', '逃避召唤', '旧账'], revM: '听见了召唤却装没听见，或被旧账绊住脚；别再审判自己，先往前走。' },
  { id: 'major-21-world', arcana: 'major', num: 21, nameCn: '世界', nameEn: 'The World', astrology: '土星',
    up: ['圆满', '完成', '整合', '庆祝'], upM: '拼图的最后一块归位：阶段圆满、功德圆满，开香槟吧，值得。',
    rev: ['未竟', '缺一角', '延迟收尾'], revM: '临门差一脚：要么收尾潦草，要么迟迟不肯画句号；就差这一步了。' },
];

// ─── 权杖（火：行动 / 事业 / 热情）22..35 ───

const WANDS: RawCard[] = [
  { id: 'wands-01-ace', arcana: 'wands', num: 1, nameCn: '权杖一', nameEn: 'Ace of Wands', element: '火',
    up: ['新契机', '灵感', '行动力', '点火'], upM: '一团火被点燃：新想法、新机会，趁热打铁立刻动手就是最好的时机。',
    rev: ['延迟', '方向不明', '热情熄火'], revM: '火柴划了没点着：时机未到或方向不清，先别烧光自己的热情。' },
  { id: 'wands-02-two', arcana: 'wands', num: 2, nameCn: '权杖二', nameEn: 'Two of Wands', element: '火',
    up: ['规划', '远见', '抉择路口', '格局'], upM: '站在高处看版图：计划已经成形，现在要在安稳与远方之间做选择。',
    rev: ['犹豫', '计划受阻', '目光短浅'], revM: '手握地图却不敢出发，或计划卡在细节里；要么走，要么改，别耗着。' },
  { id: 'wands-03-three', arcana: 'wands', num: 3, nameCn: '权杖三', nameEn: 'Three of Wands', element: '火',
    up: ['远景', '拓展', '先见之明', '商船回港'], upM: '船已出海：早先的布局开始有回音，把视线放到更远的海平面上。',
    rev: ['延误', '努力白费', '视野受限'], revM: '船期延误或方向跑偏：检查计划是否脱离实际，别在小池塘里谈远洋。' },
  { id: 'wands-04-four', arcana: 'wands', num: 4, nameCn: '权杖四', nameEn: 'Four of Wands', element: '火',
    up: ['庆祝', '安定', '归属', '里程碑'], upM: '值得摆酒的一站：阶段性成果落地，和身边人一起好好庆祝吧。',
    rev: ['过渡期', '根基不稳', '仓促'], revM: '庆祝早了点：地基还没干透，或搬家过渡中诸事未定；先稳住再开香槟。' },
  { id: 'wands-05-five', arcana: 'wands', num: 5, nameCn: '权杖五', nameEn: 'Five of Wands', element: '火',
    up: ['竞争', '摩擦', '切磋', '各执己见'], upM: '一群人拿着棍子比划：良性竞争能打出火花，但别演变成意气之争。',
    rev: ['内耗', '暗斗', '避战'], revM: '台面下的较劲比明争更耗人，或大家都在回避冲突；把话摊开说。' },
  { id: 'wands-06-six', arcana: 'wands', num: 6, nameCn: '权杖六', nameEn: 'Six of Wands', element: '火',
    up: ['胜利', '认可', '自信', '凯旋'], upM: '骑马进城接受欢呼：努力被看见了，昂首享受这份属于你的认可。',
    rev: ['骄傲', '延迟的认可', '高处跌落'], revM: '掌声来得比预期晚，或胜利冲昏了头；低调做事，口碑自会追上来。' },
  { id: 'wands-07-seven', arcana: 'wands', num: 7, nameCn: '权杖七', nameEn: 'Seven of Wands', element: '火',
    up: ['坚守', '迎战', '以寡敌众', '立场'], upM: '居高守住阵地：你是对的，顶住这一波围攻，守住就有转机。',
    rev: ['寡不敌众', '退守', '压力过大'], revM: '棍子太多守不住了：战略性后撤不丢人，硬扛只会把自己耗空。' },
  { id: 'wands-08-eight', arcana: 'wands', num: 8, nameCn: '权杖八', nameEn: 'Eight of Wands', element: '火',
    up: ['迅速', '消息', '进展', '箭在弦上'], upM: '八支箭齐发：事情突然加速，消息和进展会接二连三地砸过来。',
    rev: ['仓促', '延误', '信息混乱'], revM: '箭飞歪了：要么赶工出乱子，要么消息满天飞却没一件落地；先对齐再加速。' },
  { id: 'wands-09-nine', arcana: 'wands', num: 9, nameCn: '权杖九', nameEn: 'Nine of Wands', element: '火',
    up: ['坚韧', '最后一搏', '防备', '伤痕累累仍站立'], upM: '浑身是伤但还站着：最后一道防线，咬牙守住，翻盘就在眼前。',
    rev: ['疲惫', '固执', '防备过当'], revM: '累到草木皆兵：把谁都当敌人，或固执己见听不进劝；先睡一觉再说。' },
  { id: 'wands-10-ten', arcana: 'wands', num: 10, nameCn: '权杖十', nameEn: 'Ten of Wands', element: '火',
    up: ['重担', '责任', '过劳', '大包大揽'], upM: '十根棍子全扛在肩上：能者多劳正在压垮你，该分出去的就分出去。',
    rev: ['放下', '分担', '卸下重担'], revM: '终于肯松手：分担、授权、扔掉不属于你的担子，肩膀会轻松很多。' },
  { id: 'wands-11-page', arcana: 'wands', num: 11, nameCn: '权杖侍从', nameEn: 'Page of Wands', element: '火',
    up: ['探索', '好消息', '新尝试', '好奇心'], upM: '举着火把出发的少年：大胆试新东西，好消息在路上了。',
    rev: ['三分钟热度', '坏消息', '浮躁'], revM: '火把举了三分钟就放下了：想法多、落地少；选一个，坚持做完。' },
  { id: 'wands-12-knight', arcana: 'wands', num: 12, nameCn: '权杖骑士', nameEn: 'Knight of Wands', element: '火',
    up: ['冲劲', '冒险', '快马加鞭', '魄力'], upM: '快马扬鞭：带着冲劲杀过去，速度就是你此刻最大的优势。',
    rev: ['鲁莽', '虎头蛇尾', '横冲直撞'], revM: '马跑得比脑子快：要么开头猛结尾怂，要么一路得罪人；勒马、看路。' },
  { id: 'wands-13-queen', arcana: 'wands', num: 13, nameCn: '权杖王后', nameEn: 'Queen of Wands', element: '火',
    up: ['热情', '自信', '魅力', '行动力'], upM: '自带光芒的人：热情自信、说做就做，你的能量会点燃周围的人。',
    rev: ['嫉妒', '自我中心', '急躁'], revM: '光芒变成了灼人：急躁、好胜、容不得别人比你亮；把火调小一点。' },
  { id: 'wands-14-king', arcana: 'wands', num: 14, nameCn: '权杖国王', nameEn: 'King of Wands', element: '火',
    up: ['领导', '远见', '魄力', '担当'], upM: '天生的掌舵者：有愿景、有担当，带人带事都让人服气，放手去带队。',
    rev: ['专断', '好大喜功', '失信'], revM: '王座坐歪了：独断、画大饼或承诺落空；少说漂亮话，多兑现一件小事。' },
];

// ─── 圣杯（水：情感 / 关系 / 直觉）36..49 ───

const CUPS: RawCard[] = [
  { id: 'cups-01-ace', arcana: 'cups', num: 1, nameCn: '圣杯一', nameEn: 'Ace of Cups', element: '水',
    up: ['新感情', '心动', '情感满溢', '敞开心'], upM: '心杯被斟满：新的心动、新的情谊，或与自己和解；让情感流动起来。',
    rev: ['情感阻塞', '空杯', '旧伤'], revM: '杯子倒扣着：心门关了、旧伤没好，或付出错了人；先把自己这杯斟满。' },
  { id: 'cups-02-two', arcana: 'cups', num: 2, nameCn: '圣杯二', nameEn: 'Two of Cups', element: '水',
    up: ['相互吸引', '结合', '默契', '平等'], upM: '两杯相碰：势均力敌的吸引与承诺，无论爱情还是合作都是好兆头。',
    rev: ['失衡', '误会', '貌合神离'], revM: '碰杯变成了碰壁：付出不对等或误会横生；把不对等的感觉说出来。' },
  { id: 'cups-03-three', arcana: 'cups', num: 3, nameCn: '圣杯三', nameEn: 'Three of Cups', element: '水',
    up: ['欢聚', '友谊', '庆祝', '同频'], upM: '姐妹举杯：和朋友好好聚一场，被懂得和陪伴包围就是幸福本身。',
    rev: ['流言', '排挤', '狂欢后的空虚'], revM: '热闹是他们的：小心小圈子里的口舌，或狂欢散场后的巨大空虚。' },
  { id: 'cups-04-four', arcana: 'cups', num: 4, nameCn: '圣杯四', nameEn: 'Four of Cups', element: '水',
    up: ['倦怠', '视而不见', '沉思', '提不起劲'], upM: '三杯在前无动于衷：不是没机会，是你累了；允许自己发会儿呆。',
    rev: ['重拾', '新机会', '走出倦怠'], revM: '终于抬头看见第四只杯子：倦怠期过去，新的邀约值得接住。' },
  { id: 'cups-05-five', arcana: 'cups', num: 5, nameCn: '圣杯五', nameEn: 'Five of Cups', element: '水',
    up: ['失落', '哀悼', '聚焦失去', '覆水'], upM: '三杯打翻：为失去的难过是应该的，但身后还有两杯是满的，别忘了回头。',
    rev: ['走出悲伤', '拾起剩余', '释怀'], revM: '眼泪擦干了：开始看见还剩下的部分，失去的课上完了，该往前走了。' },
  { id: 'cups-06-six', arcana: 'cups', num: 6, nameCn: '圣杯六', nameEn: 'Six of Cups', element: '水',
    up: ['怀旧', '旧友', '纯真', '重逢'], upM: '童年的花香：老朋友、旧时光带来慰藉；也可以单纯地对人好一点。',
    rev: ['沉溺过去', '长不大', '旧事重提'], revM: '住在回忆里不肯搬：美化过去、拒绝长大，或旧人旧事反复纠缠。' },
  { id: 'cups-07-seven', arcana: 'cups', num: 7, nameCn: '圣杯七', nameEn: 'Seven of Cups', element: '水',
    up: ['幻想', '选择多', '雾里看花', '白日梦'], upM: '七个杯子七个梦：选项看着都美，实则多是幻影；先验货再动心。',
    rev: ['看清', '聚焦', '梦醒'], revM: '雾散了：看清哪个杯子是真的，砍掉幻想清单，留一个踏实去追。' },
  { id: 'cups-08-eight', arcana: 'cups', num: 8, nameCn: '圣杯八', nameEn: 'Eight of Cups', element: '水',
    up: ['离开', '追寻', '转身', '断舍离'], upM: '月夜转身离席：杯子还在，但心已经走了；去追真正想要的东西吧。',
    rev: ['逃避', '徘徊', '走回头路'], revM: '走了又折返：要么在逃避不敢面对，要么舍不得沉没成本；问心，别问杯。' },
  { id: 'cups-09-nine', arcana: 'cups', num: 9, nameCn: '圣杯九', nameEn: 'Nine of Cups', element: '水',
    up: ['愿望成真', '满足', '犒赏', '心想事成'], upM: '许的愿应验了：好好享受这份满足，你值得为自己摆一桌庆功宴。',
    rev: ['贪多', '愿望落空', '纵欲'], revM: '愿望清单越列越长却越空：小心用物质和口腹填补心里的洞。' },
  { id: 'cups-10-ten', arcana: 'cups', num: 10, nameCn: '圣杯十', nameEn: 'Ten of Cups', element: '水',
    up: ['圆满', '家庭幸福', '长久', '彩虹'], upM: '彩虹下的全家福：长久稳定的幸福，无论亲情爱情友情都开花结果。',
    rev: ['家庭失和', '表象圆满', '期望落差'], revM: '全家福有了裂纹：表面和气、私下较劲，或幸福和你想象的不一样。' },
  { id: 'cups-11-page', arcana: 'cups', num: 11, nameCn: '圣杯侍从', nameEn: 'Page of Cups', element: '水',
    up: ['温柔', '表白', '直觉消息', '心意'], upM: '捧着杯子的少年：有人向你递来心意，或你的直觉正在敲门——听听看。',
    rev: ['情绪化', '玻璃心', '误读信号'], revM: '杯子晃洒了：情绪起伏大、容易想多；先别急着下结论，让子弹飞一会儿。' },
  { id: 'cups-12-knight', arcana: 'cups', num: 12, nameCn: '圣杯骑士', nameEn: 'Knight of Cups', element: '水',
    up: ['浪漫', '求爱', '理想主义', '白马'], upM: '举杯而来的骑士：浪漫的邀约、动人的承诺；可以心动，但别忘了看行动。',
    rev: ['情绪化', '空口承诺', '忽冷忽热'], revM: '骑士的马不走了：甜言蜜语多、兑现少，忽冷忽热耗人心；看行动别听词。' },
  { id: 'cups-13-queen', arcana: 'cups', num: 13, nameCn: '圣杯王后', nameEn: 'Queen of Cups', element: '水',
    up: ['温柔', '包容', '直觉强', '共情'], upM: '端着圣杯的温柔力量：善解人意、直觉精准；你的温柔是铠甲不是软肋。',
    rev: ['敏感多疑', '情绪淹没', '边界模糊'], revM: '共情过载：替所有人难过、唯独忘了自己；先上岸，再救人。' },
  { id: 'cups-14-king', arcana: 'cups', num: 14, nameCn: '圣杯国王', nameEn: 'King of Cups', element: '水',
    up: ['沉稳', '体贴', '情绪成熟', '靠谱'], upM: '惊涛上的稳舵手：情绪稳定、体贴靠谱；做那个让身边人安心的人。',
    rev: ['压抑', '操控', '情绪勒索'], revM: '平静的海面下有暗流：压抑、冷暴力或情绪操控；说出来比憋着强。' },
];

// ─── 宝剑（风：思维 / 沟通 / 冲突）50..63 ───

const SWORDS: RawCard[] = [
  { id: 'swords-01-ace', arcana: 'swords', num: 1, nameCn: '宝剑一', nameEn: 'Ace of Swords', element: '风',
    up: ['真相', '突破', '清晰', '一剑'], upM: '利剑出鞘：真相大白、思路贯通；用清晰和果断一剑劈开乱麻。',
    rev: ['混乱', '误判', '言语伤人'], revM: '剑拿反了：信息混乱、判断失准，或话太快伤了人；先核实再开口。' },
  { id: 'swords-02-two', arcana: 'swords', num: 2, nameCn: '宝剑二', nameEn: 'Two of Swords', element: '风',
    up: ['僵局', '回避抉择', '蒙眼', '维持平衡'], upM: '蒙眼抱剑：两边都不想得罪，于是卡在中间；但不选本身也是一种选。',
    rev: ['打破僵局', '被迫选择', '信息过载'], revM: '眼罩掉了：要么终于敢选了，要么被现实推着选；信息太多时抓主干。' },
  { id: 'swords-03-three', arcana: 'swords', num: 3, nameCn: '宝剑三', nameEn: 'Three of Swords', element: '风',
    up: ['心痛', '真相刺痛', '分离', '雨夜'], upM: '三剑穿心：真相很痛，但长痛不如短痛；允许自己难过，雨会停的。',
    rev: ['疗愈', '释怀', '走出心痛'], revM: '剑在拔出：伤口结痂、释怀在即；别再反复撕开看，往前走就是药。' },
  { id: 'swords-04-four', arcana: 'swords', num: 4, nameCn: '宝剑四', nameEn: 'Four of Swords', element: '风',
    up: ['休养', '暂停', '恢复', '充电'], upM: '躺平是战略：关机休养、回血充电，仗要打，但先睡个好觉。',
    rev: ['失眠', '硬撑', '拒绝休息'], revM: '躺下了脑子没躺下：失眠焦虑、硬撑不休；身体在替你喊停，听见没。' },
  { id: 'swords-05-five', arcana: 'swords', num: 5, nameCn: '宝剑五', nameEn: 'Five of Swords', element: '风',
    up: ['惨胜', '争执', '得不偿失', '赢了输了'], upM: '赢了辩论输了人心：想想这场仗值不值得打，有时候认输才是赢。',
    rev: ['和解', '放下争执', '止损'], revM: '剑放下了：愿意和解、止损离场；面子哪有里子重要。' },
  { id: 'swords-06-six', arcana: 'swords', num: 6, nameCn: '宝剑六', nameEn: 'Six of Swords', element: '风',
    up: ['过渡', '离开风暴', '渐稳', '摆渡'], upM: '船正驶离风暴：最难的部分过去了，虽然还没靠岸，但水面在变平。',
    rev: ['困于旧地', '反复', '行李未放'], revM: '船在原地打转：人走了心没走，或旧问题反复回来；放下行李才能走远。' },
  { id: 'swords-07-seven', arcana: 'swords', num: 7, nameCn: '宝剑七', nameEn: 'Seven of Swords', element: '风',
    up: ['策略', '独行', '取巧', '单干'], upM: '抱着剑悄悄走：用智取不用硬拼，适合单干、低调行事、另辟蹊径。',
    rev: ['东窗事发', '弄巧成拙', '良心不安'], revM: '小聪明露馅了：取巧翻车或良心过不去；走正道，睡得着觉。' },
  { id: 'swords-08-eight', arcana: 'swords', num: 8, nameCn: '宝剑八', nameEn: 'Eight of Swords', element: '风',
    up: ['自我设限', '困局', '无力', '作茧'], upM: '绳子是自己系的：困住你的多半是"我不行"的念头；绳结没那么紧，挣一下。',
    rev: ['松绑', '重获力量', '走出困局'], revM: '绳子松了：开始相信自己能行，困局出现出口；往前迈一步试试。' },
  { id: 'swords-09-nine', arcana: 'swords', num: 9, nameCn: '宝剑九', nameEn: 'Nine of Swords', element: '风',
    up: ['焦虑', '失眠', '噩梦', '深夜emo'], upM: '凌晨三点的九把剑：九成烦恼是脑内小剧场；天亮了再看，事没那么大。',
    rev: ['走出阴霾', '面对恐惧', '否极泰来'], revM: '噩梦醒了：最坏的想象没有发生，或你终于敢直视恐惧；会好起来的。' },
  { id: 'swords-10-ten', arcana: 'swords', num: 10, nameCn: '宝剑十', nameEn: 'Ten of Swords', element: '风',
    up: ['触底', '终结', '背叛', '至暗'], upM: '十剑穿背、触底了：坏消息是到底了，好消息也是到底了——只能向上。',
    rev: ['复苏', '触底反弹', '伤口结痂'], revM: '剑在一把把拔出：正在复苏，虽然慢；别急着跑，先学会走。' },
  { id: 'swords-11-page', arcana: 'swords', num: 11, nameCn: '宝剑侍从', nameEn: 'Page of Swords', element: '风',
    up: ['好奇', '敏锐', '新想法', '耳听八方'], upM: '举剑观望的少年：好奇心拉满，适合学习、调研、打探消息。',
    rev: ['多疑', '口舌', '虎视眈眈'], revM: '敏锐变多疑：捕风捉影、口舌是非，或被人盯着挑刺；谨言慎行。' },
  { id: 'swords-12-knight', arcana: 'swords', num: 12, nameCn: '宝剑骑士', nameEn: 'Knight of Swords', element: '风',
    up: ['果决', '快刀', '直言', '闪电战'], upM: '纵马举剑直取中军：快、准、狠；适合快刀斩乱麻，不适合谈感情。',
    rev: ['冲动', '刻薄', '横冲直撞'], revM: '马失前蹄：冲动误事、言语刻薄，或一路横冲直撞树敌；先刹车。' },
  { id: 'swords-13-queen', arcana: 'swords', num: 13, nameCn: '宝剑王后', nameEn: 'Queen of Swords', element: '风',
    up: ['独立', '明辨', '坦率', '清醒'], upM: '历经风霜依然笔直：独立清醒、一针见血；听她的，准没错。',
    rev: ['刻薄', '冷漠', '受害者心态'], revM: '利剑伤人又伤己：刻薄、冷漠，或沉溺于"我好惨"；放下剑，抱抱自己。' },
  { id: 'swords-14-king', arcana: 'swords', num: 14, nameCn: '宝剑国王', nameEn: 'King of Swords', element: '风',
    up: ['理性', '公正', '权威判断', '逻辑'], upM: '王座上的理性之王：用事实和逻辑说话，公正裁决；适合谈判与决策。',
    rev: ['冷酷', '操控舆论', '滥用理性'], revM: '理性变凶器：冷酷无情、玩弄话术，或被"为你好"的逻辑绑架；留点人情味。' },
];

// ─── 星币（土：物质 / 工作 / 健康）64..77 ───

const PENTACLES: RawCard[] = [
  { id: 'pentacles-01-ace', arcana: 'pentacles', num: 1, nameCn: '星币一', nameEn: 'Ace of Pentacles', element: '土',
    up: ['新财机', '务实开端', '种子', '落地'], upM: '一枚金币从天而降：实实在在的新机会；别空想，接住它、种下去。',
    rev: ['错失', '财务漏损', '计划不实'], revM: '金币从指缝漏走：机会没接住，或计划看着美、账算不过来；先算账。' },
  { id: 'pentacles-02-two', arcana: 'pentacles', num: 2, nameCn: '星币二', nameEn: 'Two of Pentacles', element: '土',
    up: ['平衡', '多线', '灵活', '走钢丝'], upM: '双手抛接两枚金币：多线并行但游刃有余；保持弹性，优先排序别乱。',
    rev: ['失衡', '顾此失彼', '拆东墙'], revM: '球要掉了：接太多、顾不过来，拆东墙补西墙；砍掉一两项，保住核心。' },
  { id: 'pentacles-03-three', arcana: 'pentacles', num: 3, nameCn: '星币三', nameEn: 'Three of Pentacles', element: '土',
    up: ['协作', '匠心', '赏识', '团队'], upM: '工匠被请进教堂：你的手艺被看见了；好好合作，作品会替你说话。',
    rev: ['配合失灵', '粗制滥造', '怀才不遇'], revM: '各干各的、活干糙了，或有本事没人识；先把基本功和沟通补上。' },
  { id: 'pentacles-04-four', arcana: 'pentacles', num: 4, nameCn: '星币四', nameEn: 'Four of Pentacles', element: '土',
    up: ['守成', '稳定', '抓紧', '安全感'], upM: '抱紧金币守城：适合守成、攒钱、稳住基本盘；安全感是攒出来的。',
    rev: ['吝啬', '守财', '错失流动'], revM: '抱太紧了：钱和机会都不流动，一味死守反而错过更大收益；松松手。' },
  { id: 'pentacles-05-five', arcana: 'pentacles', num: 5, nameCn: '星币五', nameEn: 'Five of Pentacles', element: '土',
    up: ['拮据', '寒冬', '求助', '雪夜'], upM: '雪夜里的两个人：手头紧、心里冷；但教堂的灯亮着——开口求助不丢人。',
    rev: ['走出困境', '援助到', '否极泰来'], revM: '雪停了：援助到了、难关见底；熬过来的你，比从前更扛冻。' },
  { id: 'pentacles-06-six', arcana: 'pentacles', num: 6, nameCn: '星币六', nameEn: 'Six of Pentacles', element: '土',
    up: ['给予', '慷慨', '资源流动', '互助'], upM: '天平上的施与受：有能力就帮一把，需要时也敢开口；流动起来才生财。',
    rev: ['不对等', '债务', '有条件的给予'], revM: '天平歪了：单方面付出、欠债，或帮助附带条件；算清账、立边界。' },
  { id: 'pentacles-07-seven', arcana: 'pentacles', num: 7, nameCn: '星币七', nameEn: 'Seven of Pentacles', element: '土',
    up: ['评估', '等待收成', '长线', '复盘'], upM: '农夫看庄稼：停下来评估长势；有些投入要时间，别急着拔苗。',
    rev: ['白费', '收成不佳', '急功近利'], revM: '庄稼长歪了：方向错了越努力越亏，或总想赚快钱；复盘、止损、换种法。' },
  { id: 'pentacles-08-eight', arcana: 'pentacles', num: 8, nameCn: '星币八', nameEn: 'Eight of Pentacles', element: '土',
    up: ['精进', '匠心', '深耕', '练习'], upM: '工坊里的第八枚金币：沉下心打磨手艺；一万小时不骗人，练就是了。',
    rev: ['敷衍', '倦怠', '重复低效'], revM: '锤子抡不动了：敷衍了事、职业倦怠，或瞎忙没长进；换个练法或歇一歇。' },
  { id: 'pentacles-09-nine', arcana: 'pentacles', num: 9, nameCn: '星币九', nameEn: 'Nine of Pentacles', element: '土',
    up: ['丰足', '独立', '优雅', '收获'], upM: '葡萄园里的贵妇：靠自己挣来的丰足与从容；好好享受你的战利品。',
    rev: ['财务缩水', '依赖', '打肿脸'], revM: '园子闹了虫灾：收入缩水、靠人接济，或为了面子硬撑；节流、务实。' },
  { id: 'pentacles-10-ten', arcana: 'pentacles', num: 10, nameCn: '星币十', nameEn: 'Ten of Pentacles', element: '土',
    up: ['传承', '家族兴旺', '长久', '根基'], upM: '老宅门前的三代人：家业、根基、长久的富足；为长远打地基的时候。',
    rev: ['家业纠纷', '根基动摇', '富不过'], revM: '家宅不宁：钱的事掺进亲情，或根基松动；丑话说前头，账目要透明。' },
  { id: 'pentacles-11-page', arcana: 'pentacles', num: 11, nameCn: '星币侍从', nameEn: 'Page of Pentacles', element: '土',
    up: ['学习', '新机会', '务实', '好学生'], upM: '捧着金币用功的少年：适合学习、考证、接新活；踏实就有回报。',
    rev: ['错失', '眼高手低', '财务小漏'], revM: '书翻了两页就玩手机：机会溜走、眼高手低，或小钱漏得不明不白；记账。' },
  { id: 'pentacles-12-knight', arcana: 'pentacles', num: 12, nameCn: '星币骑士', nameEn: 'Knight of Pentacles', element: '土',
    up: ['踏实', '可靠', '稳步', '老黄牛'], upM: '策马缓行的骑士：不快但每一步都算数；靠谱和坚持就是你的超能力。',
    rev: ['固执', '停滞', '钻牛角尖'], revM: '马不走了：固执、停滞，或在小事上较劲；换条路，有时候绕行最快。' },
  { id: 'pentacles-13-queen', arcana: 'pentacles', num: 13, nameCn: '星币王后', nameEn: 'Queen of Pentacles', element: '土',
    up: ['富足', '持家', '滋养', '靠山'], upM: '抱着金币的当家：把日子过得热气腾腾；你是自己和家人的靠山。',
    rev: ['操劳', '忽视自己', '物质焦虑'], revM: '只顾着喂饱所有人、饿着自己：操劳过度、为钱焦虑；先给自己留一口。' },
  { id: 'pentacles-14-king', arcana: 'pentacles', num: 14, nameCn: '星币国王', nameEn: 'King of Pentacles', element: '土',
    up: ['成就', '稳健', '富足', '定盘星'], upM: '葡萄园之王：白手起家的稳健与富足；继续稳扎稳打，你就是定盘星。',
    rev: ['拜金', '守财', '唯利是图'], revM: '王冠变成了枷锁：掉进钱眼、守财如命，或为利失了道义；钱是工具不是主人。' },
];

// ─── 组装：大牌 0..21 → 权杖 22..35 → 圣杯 36..49 → 宝剑 50..63 → 星币 64..77 ───

const RAW_ALL: RawCard[] = [...MAJORS, ...WANDS, ...CUPS, ...SWORDS, ...PENTACLES];

export const CARDS: TarotCard[] = RAW_ALL.map(toCard);

const CARD_MAP = new Map<string, TarotCard>(CARDS.map((c) => [c.id, c]));

export const cardById = (id: string): TarotCard | undefined => CARD_MAP.get(id);

// ─── 六个经典牌阵（位置名与含义整理自真实塔罗资料，见 source）───

export const SPREADS: TarotSpread[] = [
  {
    id: 'daily', nameCn: '每日一抽', nameEn: 'Daily Draw', level: '入门',
    bestFor: '每天的指引、一句话的提醒', cardCount: 1, source: '通用每日牌阵',
    layout: 'single',
    positions: [
      { name: '今日运势', meaning: '今天的能量主题：顺着它走，逆着它避。', x: 0.5, y: 0.35 },
    ],
  },
  {
    id: 'three', nameCn: '时间之流', nameEn: 'Past · Present · Future', level: '入门',
    bestFor: '事情的来龙去脉、短期走向速览', cardCount: 3, source: '经典三张牌阵（时间之流）',
    layout: 'row',
    positions: [
      { name: '过去', meaning: '走到今天的来路：哪些事把你推到了这里。', x: 0.2, y: 0.35 },
      { name: '现在', meaning: '当下的处境与你的状态：正在发生什么。', x: 0.5, y: 0.35 },
      { name: '未来', meaning: '按现状延续，最近会迎来的下一步。', x: 0.8, y: 0.35 },
    ],
  },
  {
    id: 'five-cross', nameCn: '五张十字', nameEn: 'Five-Card Cross', level: '进阶',
    bestFor: '看清阻碍、权衡两条路、要一句建议', cardCount: 5, source: 'Five-Card Cross（mysticpull 牌阵指南）',
    layout: 'cross',
    positions: [
      { name: '现状', meaning: '事情的核心，现在卡在哪里。', x: 0.4, y: 0.38 },
      { name: '挑战', meaning: '横在中间的阻碍；解开它局面会轻松许多。', x: 0.4, y: 0.38, crossed: true },
      { name: '过去', meaning: '造成现状的来路与已经被验证的经验。', x: 0.12, y: 0.38 },
      { name: '未来', meaning: '不改变的话，事情会滑向哪里。', x: 0.68, y: 0.38 },
      { name: '指引', meaning: '综合全局，给你的一句行动建议。', x: 0.4, y: 0.19 },
    ],
  },
  {
    id: 'relationship', nameCn: '关系牌阵', nameEn: 'Relationship Spread', level: '进阶',
    bestFor: '你和 TA（恋人朋友搭档都可）的关系走向', cardCount: 6, source: '经典六位关系牌阵',
    layout: 'relationship',
    positions: [
      { name: '你的心境', meaning: '你在这段关系里的真实感受与期待。', x: 0.2, y: 0.25 },
      { name: '对方的心境', meaning: 'TA 在这段关系里的真实感受与期待。', x: 0.8, y: 0.25 },
      { name: '关系现状', meaning: '你们之间现在真实的样子。', x: 0.5, y: 0.45 },
      { name: '你的课题', meaning: '你需要面对和调整的部分。', x: 0.2, y: 0.68 },
      { name: '对方的课题', meaning: 'TA 需要面对和调整的部分。', x: 0.8, y: 0.68 },
      { name: '关系走向', meaning: '照这样下去，你们会走到哪里。', x: 0.5, y: 0.86 },
    ],
  },
  {
    id: 'horseshoe', nameCn: '马蹄牌阵', nameEn: 'Horseshoe Spread', level: '进阶',
    bestFor: '全面快查：局面、环境、阻碍、结果一次看清', cardCount: 7, source: 'Horseshoe Spread（tarottechnique 详解）',
    layout: 'arc',
    positions: [
      { name: '过去的影响', meaning: '把你推到今天的往事：教训藏在这里。', x: 0.1, y: 0.62 },
      { name: '现在的处境', meaning: '当下真实的局面（放宽到近几周看）。', x: 0.23, y: 0.42 },
      { name: '地平线上的影响', meaning: '正在靠近的近期影响，顺势可借力。', x: 0.37, y: 0.28 },
      { name: '如何前行', meaning: '最好的走法：你真正想要的答案常藏在这里。', x: 0.5, y: 0.22 },
      { name: '周围环境', meaning: '身边人的态度与整体氛围对你的影响。', x: 0.63, y: 0.28 },
      { name: '潜在阻碍', meaning: '拖住进展的东西：认出它才能绕开它。', x: 0.77, y: 0.42 },
      { name: '最终结果', meaning: '什么都不改的话，最可能抵达的结局。', x: 0.9, y: 0.62 },
    ],
  },
  {
    id: 'celtic-cross', nameCn: '凯尔特十字', nameEn: 'Celtic Cross', level: '深度',
    bestFor: '重大抉择、复杂局面的深度剖析', cardCount: 10, source: 'Celtic Cross（Biddy Tarot 十位置全解）',
    layout: 'celtic',
    positions: [
      { name: '现状', meaning: '问卜者当下的处境，也映照其心境与看待事情的角度。', x: 0.34, y: 0.32 },
      { name: '挑战', meaning: '眼前最直接的阻碍；解开它局面会轻松许多。即使抽到好牌，它依然代表一种挑战。', x: 0.34, y: 0.32, crossed: true },
      { name: '过去', meaning: '走到今天的来龙去脉，挑战从何而来。', x: 0.1, y: 0.32 },
      { name: '未来', meaning: '按现状延续，未来几周到几个月最可能发生的下一步——是过程，不是终局。', x: 0.58, y: 0.32 },
      { name: '上方', meaning: '问卜者有意识的目标与渴望：正在为什么而努力。', x: 0.34, y: 0.12 },
      { name: '下方', meaning: '潜意识与深层根基：真正驱动局面的东西。逆位常提示这是问卜者尚未察觉的。', x: 0.34, y: 0.58 },
      { name: '建议', meaning: '综合全局，给出的行动建议。', x: 0.86, y: 0.72 },
      { name: '外部影响', meaning: '问卜者控制之外的人、能量与事件。', x: 0.86, y: 0.54 },
      { name: '希望与恐惧', meaning: '两者常常交织：渴望的东西，也可能正是害怕的东西。', x: 0.86, y: 0.36 },
      { name: '结果', meaning: '按当前路线走下去的结局；若不喜欢，仍可用自由意志去改变。', x: 0.86, y: 0.18 },
    ],
  },
];

const SPREAD_MAP = new Map<string, TarotSpread>(SPREADS.map((s) => [s.id, s]));

export const spreadById = (id: string): TarotSpread | undefined => SPREAD_MAP.get(id);
