/**
 * 日程 → prompt 文本的纯渲染层。
 *
 * 零运行时依赖（只 import type），浏览器与 Cloudflare Worker 共用同一份：
 *  - 前台聊天走 ContextBuilder.buildScheduleInjection（转发到这里）；
 *  - 主动消息到点生成走 utils/amsgFireScene.ts，由 worker 在 fire 时刻按角色时区调用。
 *
 * 放在这里而不是 utils/context.ts：那个模块拖着 DB / 记忆宫殿等一堆浏览器依赖，
 * worker 引不动。两边各写一份的话，角色在聊天里和到点生成时会说出不一样的作息。
 */

import type { DailySchedule, ScheduleSlot } from '../types';

/**
 * 渲染真正会读到的那部分日程。
 *
 * 单独立一个类型是给主动消息用的：fire_pack 只带这些字段上云。整份 DailySchedule 里
 * 还挂着每个时段缓存的小剧场（整段演出台词）和 coverImage（可能是 base64 看板图），
 * 那些渲染一个字都用不到，带上去就是白占几十上百 KB 的云端状态。
 */
export type RenderableSchedule = Pick<DailySchedule, 'slots' | 'flowNarrative'>;

export interface ScheduleInjectionOptions {
    /** ChatApp 主请求需要让角色看到今天的整张表；主动消息到点场景仍只看当前与下一条。 */
    includeFullDay?: boolean;
    /**
     * 教不教角色改自己的日程。前台聊天和主动消息到点生成都能落地——后者的标签由
     * worker classifier 摘成 change_schedule directive 随 push 回来，客户端落库
     * （不摘的话会被 sanitize 连 raw 一起剥掉，见 utils/scheduleChangeParse.ts）。
     * 措辞对两边都成立：主动消息里没有「完整日程表」可指，所以只让它抄上面出现过的时段。
     */
    includeChangeInstruction?: boolean;
    /**
     * 能不能报钟点（默认能）。角色关掉「时间感知」时传 false：日程照给——那是这个
     * 功能自己的开关——但 `07:00` 这种精确钟点属于时间感知的范畴，不该从日程块漏出去。
     * 跟天气块的处理对齐（那边天气照给、只抽掉 timeLine）。
     * 关掉钟点时也不教改日程：那条指令拿时段当定位符，角色看不到时刻就写不出来。
     */
    includeClock?: boolean;
    /**
     * 角色所在城市的实时天气（提示词层联动，纯展示不改 busy——与「恶劣天气改日程」划清界线）。
     * 前台由 chatPrompts 用角色级城市现取；主动消息链路由 worker 到点现拉后经 extras 传入。
     * 只在「当前时段」注入：整日表里每条都缀天气就是噪声。
     */
    weather?: {
        city?: string;
        description?: string;
        tempC?: number;
    } | null;
}

/** 意识流独白按一天三档取：早 / 午 / 晚。 */
export function getFlowNarrativeKey(hour: number): 'morning' | 'afternoon' | 'evening' {
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
}

/** 几点之前算「还在前一夜里」。凌晨 0-5 点属于昨晚的尾巴，不是今天的早晨。 */
const PRE_DAWN_END_HOUR = 5;

// ── 地点 × 天气 提示词层联动 ──────────────────────────────────────────
//
// 角色有了自己的城市（CharacterProfile.location），日程槽位又本来就写着小地点
// （「河边」「健身房」），这两样凑在一起正是这段提示词想要的画面感：
// 「河边 · 上海当前小雨 18°C」。同时守一条红线：**只改措辞，不改 busy** ——
// 恶劣天气最多附一句「可能改为室内」，真要改日程让角色用已有的
// CHANGE_SCHEDULE 自己决定（那是它对自己一天的自主权，不是天气的权力）。

/** 户外活动关键词：命中且天气恶劣才附「室内调整」建议。 */
const OUTDOOR_ACTIVITY_RE = /户外|跑步|爬山|登山|骑行|郊游|野餐|露营|散步|慢跑|晨跑|夜跑|逛街|摆摊|篮球|足球|球赛|钓鱼|放风筝|骑车/;

/**
 * 恶劣天气判定。desc 是天气文案（Open-Meteo 的中文描述），cold/hot 走体感常识边界。
 * 返回建议短句（天气不恶劣 / 未知时为空串）。
 */
export const badWeatherAdvice = (desc?: string, tempC?: number): string => {
    const d = (desc || '').trim();
    if (!d) return '';
    if (/雨|雪|雷|冰雹|沙尘|雾霾/.test(d)) return '（天气不佳，可能改为室内活动）';
    const t = typeof tempC === 'number' && Number.isFinite(tempC) ? tempC : null;
    if (t === null) return '';
    if (t >= 35) return '（高温，户外活动注意防暑，可能改到室内）';
    if (t <= -5) return '（严寒，户外活动注意保暖，可能改到室内）';
    return '';
};

/**
 * 当前时段槽位附天气注：有地点才拼「地点 · 城市 · 天气」，否则只说天气本身；
 * 户外活动遇恶劣天气补一句室内建议。weather 为空（取数失败/功能关闭）整段不要，
 * 输出与没有这回事时完全一样。
 */
export const appendWeatherToSlot = (
    slotHeader: string,
    slot: ScheduleSlot | null,
    weather: ScheduleInjectionOptions['weather'],
): string => {
    if (!slotHeader || !weather?.description) return slotHeader;
    const tempPart = typeof weather.tempC === 'number' && Number.isFinite(weather.tempC)
        ? ` ${Math.round(weather.tempC)}°C`
        : '';
    const cityPart = weather.city ? `${weather.city}当前` : '当地当前';
    const seg = `${cityPart}${weather.description}${tempPart}`;
    const locationPart = slot?.location ? `${slot.location} · ` : '';
    let line = `${slotHeader.replace(/\n+$/, '')}\n（${locationPart}${seg}`;
    if (slot && OUTDOOR_ACTIVITY_RE.test(slot.activity)) {
        const advice = badWeatherAdvice(weather.description, weather.tempC);
        if (advice) line += ` · ${advice.replace(/^（/, '').replace(/）$/, '')}`;
    }
    line += '）\n';
    return line;
};

/** 当前时刻落在哪一条日程上，以及紧接着的下一条。都可能为 null（表还没开始 / 表是空的）。 */
export const resolveScheduleSlots = (
    schedule: RenderableSchedule | null,
    now: Date,
): { current: ScheduleSlot | null; next: ScheduleSlot | null } => {
    if (!schedule?.slots?.length) return { current: null, next: null };
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    for (let i = schedule.slots.length - 1; i >= 0; i--) {
        const [h, m] = schedule.slots[i].startTime.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        if (currentMinutes >= h * 60 + m) {
            return {
                current: schedule.slots[i],
                next: i < schedule.slots.length - 1 ? schedule.slots[i + 1] : null,
            };
        }
    }
    // 今天第一条还没到点：没有「当前」，只有「稍后先做什么」。
    return { current: null, next: schedule.slots[0] };
};

/**
 * 构建日程注入文本
 *
 * 两段式，独立叠加：
 * 1) 当前时段硬事实——每轮都注入，不受 evolvedNarrative 影响
 * 2) 意识流独白——evolvedNarrative > flowNarrative > 当前 slot innerThought
 */
export const buildScheduleInjection = (
    schedule: RenderableSchedule | null,
    evolvedNarrative?: string,
    now: Date = new Date(),
    options: ScheduleInjectionOptions = {},
): string => {
    if (!schedule || !schedule.slots || schedule.slots.length === 0) return '';
    const { current: currentSlot, next: nextSlot } = resolveScheduleSlots(schedule, now);
    const withClock = options.includeClock !== false;
    const weather = options.weather ?? null;
    /** 报钟点时写「活动（07:00）」，不报时只留活动本身。 */
    const withTime = (text: string, startTime: string) => (withClock ? `${text}（${startTime}）` : text);

    // 凌晨还没轮到今天第一条日程时，人其实还在昨晚里没睡。主动消息经常在这个点触发，
    // 按「今天刚要开始」写，半夜一点的角色就会顶着清晨的心境说话。
    const isPreDawnCarryOver = !currentSlot && now.getHours() < PRE_DAWN_END_HOUR;

    // 1. 当前时段硬事实（每轮独立注入）
    let slotHeader = '';
    if (currentSlot) {
        slotHeader = withClock
            ? `当前时段：${currentSlot.startTime} 你正在${currentSlot.activity}`
            : `当前时段：你正在${currentSlot.activity}`;
        if (currentSlot.location) slotHeader += `（${currentSlot.location}）`;
        if (nextSlot) {
            slotHeader += withClock
                ? `\n之后安排：${nextSlot.startTime} ${nextSlot.activity}`
                : `\n之后安排：${nextSlot.activity}`;
        }
        slotHeader += '\n';
    } else if (nextSlot) {
        slotHeader = isPreDawnCarryOver
            ? `夜深了，今天的安排还没开始，最早的一件是${withTime(nextSlot.activity, nextSlot.startTime)}\n`
            : `今天还没开始活动，稍后先${withTime(nextSlot.activity, nextSlot.startTime)}\n`;
    }
    // 天气注：只在「当前时段」有活动时缀上（刚醒来还没有「正在做」就不硬贴天气）。
    slotHeader = appendWeatherToSlot(slotHeader, currentSlot, weather);

    // 2. 意识流独白
    let narrative = '';
    if (evolvedNarrative) {
        narrative = evolvedNarrative;
    } else if (schedule.flowNarrative && Object.keys(schedule.flowNarrative).length > 0) {
        // 前一夜的延续取「晚」档；其余照一天三档走。
        const key = isPreDawnCarryOver ? 'evening' : getFlowNarrativeKey(now.getHours());
        narrative = schedule.flowNarrative[key]
            || schedule.flowNarrative['evening']
            || schedule.flowNarrative['afternoon']
            || schedule.flowNarrative['morning']
            || '';
    } else if (currentSlot?.innerThought) {
        narrative = currentSlot.innerThought;
    }

    // 3. 拼接：硬事实 → 意识流（可选）
    const preamble = `此刻你的心中盘旋着这些想法……\n`;
    const footnote = `\n（不是台词，不用说出口——让它影响你的语气和情绪就好。）`;

    let out = '';
    if (options.includeFullDay) {
        const rows = schedule.slots.map((slot) => {
            let line = withClock ? `- ${slot.startTime} ${slot.activity}` : `- ${slot.activity}`;
            if (slot.location) line += `（${slot.location}）`;
            if (slot.description) line += `：${slot.description}`;
            return line;
        });
        out += `你今天的完整日程：\n${rows.join('\n')}\n`;
    }
    out += slotHeader;
    if (narrative) {
        out += preamble + narrative + footnote;
    }
    // 能改的是「当前这一条和它之后的」，所以两者有一个在就有落点。落点优先取下一条；
    // 一天最后一条日程开始之后没有下一条了，这时用当前这条——那条通常是睡觉，正好是
    // 最需要「我今晚不睡了」这个出口的时候。
    const changeTarget = nextSlot ?? currentSlot;
    if (options.includeChangeInstruction && withClock && changeTarget) {
        out += '\n日程是你早上给自己排的计划，不是必须履行的命令。真实发生的事跟它对不上时'
            + '（比如这会儿表上写着睡觉、你却醒着在跟对方说话），把它改成你实际在做的事就好。\n'
            + '需要时在回复末尾单独输出：'
            + `[[ACTION:CHANGE_SCHEDULE | ${changeTarget.startTime} | 去超市]]`
            + '（时段要原样抄上面出现过的那几个；正在进行的这一条和它之后的都能改，已经过去的不能）。';
    }
    out += '\n';
    return out;
};