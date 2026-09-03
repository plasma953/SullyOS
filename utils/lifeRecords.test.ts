/**
 * 生活记录：生理期状态机 + [[LIFE:...]] 代记指令执行 + 卡片裁决回滚。
 * IndexedDB 由 test-setup 的 fake-indexeddb 提供，走真实 DB 层。
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
    buildLifeRecordInjection, computePeriodStatus, executeLifeDirectives, resolveLifeRecordCard,
    getPeriodIntervals, isMedPlanDueToday, lifeToday,
} from './lifeRecords';
import { DB } from './db';
import { CharacterProfile, LifeRecord, MedPlan, Message } from '../types';

const noToast = () => {};

const mkPeriod = (kind: 'start' | 'end', date: string, extra?: Partial<LifeRecord>): LifeRecord => ({
    id: `t-${kind}-${date}-${Math.random()}`,
    module: 'period', kind, date,
    timestamp: new Date(`${date}T08:00:00Z`).getTime(),
    payload: {}, recordedBy: 'user', reviewStatus: 'confirmed', ...extra,
});

const mkChar = (overrides?: Partial<CharacterProfile>): CharacterProfile => ({
    id: `char-${Math.random().toString(36).slice(2, 8)}`,
    name: '江屿',
    lifeRecordEnabled: true,
    ...overrides,
} as unknown as CharacterProfile);

describe('computePeriodStatus 生理期状态机', () => {
    it('只有 start：在经期中，天数 1-based', () => {
        const st = computePeriodStatus([mkPeriod('start', '2026-07-01')], null, '2026-07-03');
        expect(st.inPeriod).toBe(true);
        expect(st.dayN).toBe(3);
        expect(st.nextPredicted).toBe('2026-07-29'); // 默认 28 天周期
    });

    it('start + 之后的 end：不在经期', () => {
        const st = computePeriodStatus(
            [mkPeriod('start', '2026-07-01'), mkPeriod('end', '2026-07-05')],
            null, '2026-07-06',
        );
        expect(st.inPeriod).toBe(false);
        expect(st.lastEnd).toBe('2026-07-05');
    });

    it('被否决的 start 不算数', () => {
        const st = computePeriodStatus(
            [mkPeriod('start', '2026-07-01', { reviewStatus: 'rejected' })],
            null, '2026-07-03',
        );
        expect(st.inPeriod).toBe(false);
    });

    it('忘记记结束：超过兜底天数后自动视为已结束', () => {
        const st = computePeriodStatus([mkPeriod('start', '2026-06-01')], null, '2026-07-03');
        expect(st.inPeriod).toBe(false);
    });

    it('自定义周期长度影响预测', () => {
        const st = computePeriodStatus(
            [mkPeriod('start', '2026-07-01')],
            { id: 'main', cycleLength: 30 }, '2026-07-02',
        );
        expect(st.nextPredicted).toBe('2026-07-31');
    });

    it('排卵期预测：排卵日 = 下次经期 − 14 天，排卵期窗口 −5 ~ +1', () => {
        const st = computePeriodStatus([mkPeriod('start', '2026-07-01')], null, '2026-07-08');
        expect(st.nextPredicted).toBe('2026-07-29');
        expect(st.ovulationDate).toBe('2026-07-15');
        expect(st.ovulationStart).toBe('2026-07-10');
        expect(st.ovulationEnd).toBe('2026-07-16');
    });
});

describe('getPeriodIntervals 日历区间', () => {
    it('start+end 配对成闭区间；未闭合区间截到今天', () => {
        const ivs = getPeriodIntervals([
            mkPeriod('start', '2026-06-01'), mkPeriod('end', '2026-06-05'),
            mkPeriod('start', '2026-06-29'),
        ], '2026-07-02');
        expect(ivs).toHaveLength(2);
        expect(ivs[0]).toMatchObject({ start: '2026-06-01', end: '2026-06-05' });
        expect(ivs[1]).toMatchObject({ start: '2026-06-29', end: '2026-07-02', open: true });
    });

    it('连续两个 start：上一段在新开始前一天收口', () => {
        const ivs = getPeriodIntervals([
            mkPeriod('start', '2026-06-01'), mkPeriod('start', '2026-06-04'), mkPeriod('end', '2026-06-08'),
        ], '2026-07-02');
        expect(ivs[0]).toMatchObject({ start: '2026-06-01', end: '2026-06-03' });
        expect(ivs[1]).toMatchObject({ start: '2026-06-04', end: '2026-06-08' });
    });
});

describe('isMedPlanDueToday 药盒频率', () => {
    const mkPlan = (overrides?: Partial<MedPlan>): MedPlan => ({
        id: 'p1', name: '维D', time: '08:00', enabled: true,
        createdAt: new Date('2026-07-01T00:00:00Z').getTime(), ...overrides,
    });

    it('默认（无频率字段）= 长期每天，与旧数据兼容', () => {
        expect(isMedPlanDueToday(mkPlan(), '2026-07-06')).toBe(true);
    });

    it('补记日期早于计划创建日时，不把尚未存在的计划算作待服', () => {
        expect(isMedPlanDueToday(mkPlan(), '2026-06-30')).toBe(false);
    });

    it('隔天吃：锚点日起偶数天差才到期', () => {
        const p = mkPlan({ intervalDays: 2, startDate: '2026-07-01' });
        expect(isMedPlanDueToday(p, '2026-07-01')).toBe(true);
        expect(isMedPlanDueToday(p, '2026-07-02')).toBe(false);
        expect(isMedPlanDueToday(p, '2026-07-03')).toBe(true);
    });

    it('短期疗程：日期段外不生效（含结束当天）', () => {
        const p = mkPlan({ planKind: 'course', startDate: '2026-07-01', endDate: '2026-07-05' });
        expect(isMedPlanDueToday(p, '2026-06-30')).toBe(false);
        expect(isMedPlanDueToday(p, '2026-07-05')).toBe(true);
        expect(isMedPlanDueToday(p, '2026-07-06')).toBe(false);
    });

    it('停用的计划永远不到期', () => {
        expect(isMedPlanDueToday(mkPlan({ enabled: false }), '2026-07-06')).toBe(false);
    });
});

describe('executeLifeDirectives 代记指令', () => {
    it('MED 指令：写记录 + 落 life_card + 剥 tag', async () => {
        const char = mkChar();
        const out = await executeLifeDirectives('好，我帮你记下了 [[LIFE:MED|布洛芬]]', char, noToast);
        expect(out).toBe('好，我帮你记下了');

        const records = (await DB.getAllLifeRecords()).filter(r => r.recordedBy === char.id);
        expect(records).toHaveLength(1);
        expect(records[0].module).toBe('med');
        expect(records[0].payload.name).toBe('布洛芬');
        expect(records[0].reviewStatus).toBe('active');

        const msgs = await DB.getMessagesByCharId(char.id, true);
        const card = msgs.find((m: Message) => m.type === 'life_card');
        expect(card).toBeTruthy();
        expect(card!.metadata.recordId).toBe(records[0].id);
    });

    it('同日同药重复代记：不重复写库，卡片标 duplicate', async () => {
        const char = mkChar();
        await executeLifeDirectives('[[LIFE:MED|维生素C]]', char, noToast);
        const char2 = mkChar({ name: '林深' });
        await executeLifeDirectives('[[LIFE:MED|维生素C]]', char2, noToast);

        const records = (await DB.getAllLifeRecords()).filter(r => r.payload.name === '维生素C');
        expect(records).toHaveLength(1); // 只有第一次写进去
        const msgs = await DB.getMessagesByCharId(char2.id, true);
        const card = msgs.find((m: Message) => m.type === 'life_card');
        expect(card!.metadata.duplicate).toBe(true);
    });

    // 主动消息是提前几小时打包的：打包时开着、送达前用户把开关关掉是常态。角色那句
    // 「我帮你记下了」已经说满，记录却静默蒸发，用户只会觉得功能坏了 —— 留一条系统提示。
    it('总开关关闭：不写库，但落一条系统提示说明没记成', async () => {
        const char = mkChar({ lifeRecordEnabled: false });
        const out = await executeLifeDirectives('记好了[[LIFE:MED|阿莫西林]]', char, noToast);
        expect(out).toBe('记好了');
        const records = (await DB.getAllLifeRecords()).filter(r => r.recordedBy === char.id);
        expect(records).toHaveLength(0);

        const msgs = await DB.getMessagesByCharId(char.id, true);
        expect(msgs.some((m: Message) => m.role === 'system' && m.content.includes('没记成')
            && m.content.includes('生活记录功能已关闭'))).toBe(true);
    });

    it('模块小开关关闭：不写库，同样留一条系统提示（带模块名）', async () => {
        const char = mkChar({ lifeRecordExerciseEnabled: false });
        const out = await executeLifeDirectives('[[LIFE:EXERCISE|跑步|30分钟]]', char, noToast);
        expect(out).toBe('');
        const records = (await DB.getAllLifeRecords()).filter(r => r.recordedBy === char.id);
        expect(records).toHaveLength(0);

        const msgs = await DB.getMessagesByCharId(char.id, true);
        const note = msgs.find((m: Message) => m.role === 'system');
        expect(note?.content).toContain('锻炼');
        expect(note?.content).toContain('没记成');
    });

    it('格式非法的指令仍然静默剥掉（模型手滑，没什么可交代的）', async () => {
        const char = mkChar();
        const out = await executeLifeDirectives('[[LIFE:MED|]]好', char, noToast);
        expect(out).toBe('好');
        const msgs = await DB.getMessagesByCharId(char.id, true);
        expect(msgs).toHaveLength(0);
    });

    it('传了 inheritMeta：生活卡和「没记成」提示都带上这条推送的标记', async () => {
        const meta = { source: 'active_msg_2', activeMsg2: { messageId: 'push-life' } };

        const charOn = mkChar({ name: '有开关' });
        await executeLifeDirectives('[[LIFE:EXPENSE|66|奶茶]]', charOn, noToast, undefined, meta);
        const card = (await DB.getMessagesByCharId(charOn.id, true))
            .find((m: Message) => m.type === 'life_card');
        expect(card!.metadata.activeMsg2.messageId).toBe('push-life');
        expect(card!.metadata.recordId).toBeTruthy();   // 卡片自己的字段没被挤掉

        const charOff = mkChar({ name: '没开关', lifeRecordEnabled: false });
        await executeLifeDirectives('[[LIFE:MED|布洛芬]]', charOff, noToast, undefined, meta);
        const note = (await DB.getMessagesByCharId(charOff.id, true))
            .find((m: Message) => m.role === 'system');
        expect(note!.metadata.activeMsg2.messageId).toBe('push-life');
    });

    it('EXPENSE：同步写银行流水，否决时回滚删除', async () => {
        const char = mkChar();
        await executeLifeDirectives('[[LIFE:EXPENSE|38|打车]]', char, noToast);

        const records = (await DB.getAllLifeRecords()).filter(r => r.recordedBy === char.id);
        expect(records).toHaveLength(1);
        const rec = records[0];
        expect(rec.bankTxId).toBeTruthy();
        let txs = await DB.getAllTransactions();
        expect(txs.some(t => t.id === rec.bankTxId && t.amount === -38)).toBe(true);

        // 否决：记录 rejected + 欠反馈 + 银行流水回滚
        const msgs = await DB.getMessagesByCharId(char.id, true);
        const card = msgs.find((m: Message) => m.type === 'life_card')!;
        await resolveLifeRecordCard(card, 'rejected');

        const after = await DB.getLifeRecordById(rec.id);
        expect(after!.reviewStatus).toBe('rejected');
        expect(after!.pendingFeedback).toBe(true);
        txs = await DB.getAllTransactions();
        expect(txs.some(t => t.id === rec.bankTxId)).toBe(false);
    });

    it('不在经期时收到 PERIOD_END：按"无需记录"处理，不写库', async () => {
        const char = mkChar();
        await executeLifeDirectives('[[LIFE:PERIOD_END]]', char, noToast);
        const records = (await DB.getAllLifeRecords()).filter(r => r.recordedBy === char.id);
        expect(records).toHaveLength(0);
        const msgs = await DB.getMessagesByCharId(char.id, true);
        const card = msgs.find((m: Message) => m.type === 'life_card');
        expect(card!.metadata.duplicate).toBe(true);
    });

    it('PERIOD_START 后再次 START：判重；且状态机对今日生效', async () => {
        const charA = mkChar({ name: 'A' });
        await executeLifeDirectives('[[LIFE:PERIOD_START]]', charA, noToast);
        const st = computePeriodStatus(await DB.getAllLifeRecords(), null, lifeToday());
        expect(st.inPeriod).toBe(true);

        const charB = mkChar({ name: 'B' });
        await executeLifeDirectives('[[LIFE:PERIOD_START]]', charB, noToast);
        const starts = (await DB.getAllLifeRecords()).filter(r => r.module === 'period' && r.kind === 'start');
        expect(starts).toHaveLength(1);
    });

    it('start → 同日 end → 模型再发 START：同日兜底判重，不再重复入库（用户实报）', async () => {
        // 沿用上个用例写入的今日 start；补一条今日 end，把状态机推进「已不在经期」的盲区——
        // 旧逻辑此时会放行重复 start，真重复入库。
        const charC = mkChar({ name: 'C' });
        await executeLifeDirectives('[[LIFE:PERIOD_END]]', charC, noToast);
        const st = computePeriodStatus(await DB.getAllLifeRecords(), null, lifeToday());
        expect(st.inPeriod).toBe(false);

        const charD = mkChar({ name: 'D' });
        await executeLifeDirectives('[[LIFE:PERIOD_START]]', charD, noToast);
        const starts = (await DB.getAllLifeRecords()).filter(r => r.module === 'period' && r.kind === 'start');
        expect(starts).toHaveLength(1);
        const msgs = await DB.getMessagesByCharId(charD.id, true);
        expect(msgs.find((m: Message) => m.type === 'life_card')!.metadata.duplicate).toBe(true);
    });

    it('EXERCISE 同日同活动、时长写法不同：判重不重复入库（用户实报）', async () => {
        const charE = mkChar({ name: 'E' });
        await executeLifeDirectives('[[LIFE:EXERCISE|跑步|30分钟]]', charE, noToast);
        // 模型下一轮换个时长写法 / 干脆省略时长 —— 旧判据要求时长逐字一致，全都漏网
        const charF = mkChar({ name: 'F' });
        await executeLifeDirectives('[[LIFE:EXERCISE|跑步|半小时]]', charF, noToast);
        await executeLifeDirectives('[[LIFE:EXERCISE|跑步]]', charF, noToast);
        const runs = (await DB.getAllLifeRecords()).filter(r => r.module === 'exercise' && r.payload.activity === '跑步');
        expect(runs).toHaveLength(1);
        const msgs = await DB.getMessagesByCharId(charF.id, true);
        expect(msgs.filter((m: Message) => m.type === 'life_card' && m.metadata.duplicate)).toHaveLength(2);

        // 不同活动照常入库，不受影响
        await executeLifeDirectives('[[LIFE:EXERCISE|瑜伽]]', charF, noToast);
        const yoga = (await DB.getAllLifeRecords()).filter(r => r.module === 'exercise' && r.payload.activity === '瑜伽');
        expect(yoga).toHaveLength(1);
    });

    it('注入的代记说明包含「一件事只记一次」防重复明示', async () => {
        const char = mkChar();
        const s = await buildLifeRecordInjection(char, '洛洛', { forFirePack: false });
        expect(s).toContain('一件事只记一次');
        expect(s).toContain('已经记过了');
    });
});

describe('全局隐藏模块（长按页签隐藏）', () => {
    afterAll(async () => {
        // 复原，避免污染同文件其他潜在用例
        await DB.saveLifeRecordSettings({ id: 'main', hiddenModules: [] });
    });

    it('隐藏的模块：角色开关全开也不执行代记指令，只留一条系统提示', async () => {
        await DB.saveLifeRecordSettings({ id: 'main', hiddenModules: ['med'] });
        const char = mkChar();
        const out = await executeLifeDirectives('记下了[[LIFE:MED|感冒灵]]', char, noToast);
        expect(out).toBe('记下了');
        const records = (await DB.getAllLifeRecords()).filter(r => r.recordedBy === char.id);
        expect(records).toHaveLength(0);

        const msgs = await DB.getMessagesByCharId(char.id, true);
        expect(msgs.some((m: Message) => m.role === 'system' && m.content.includes('药盒'))).toBe(true);
    });

    it('隐藏的模块：注入里不出现对应数据与指令说明', async () => {
        await DB.saveLifeRecordSettings({ id: 'main', hiddenModules: ['med', 'exercise'] });
        const char = mkChar();
        const text = await buildLifeRecordInjection(char, '小鱼', { forFirePack: false });
        expect(text).toContain('生理期');
        expect(text).not.toContain('今日用药计划');
        expect(text).not.toContain('LIFE:MED');
        expect(text).not.toContain('锻炼');
        expect(text).not.toContain('LIFE:EXERCISE');
    });

    it('全部模块隐藏：整段注入为空', async () => {
        await DB.saveLifeRecordSettings({ id: 'main', hiddenModules: ['period', 'med', 'expense', 'exercise'] });
        const char = mkChar();
        const text = await buildLifeRecordInjection(char, '小鱼', { forFirePack: false });
        expect(text).toBe('');
    });
});

describe('EXPENSE 去重窗口（同金额可以是两笔不同消费）', () => {
    it('15 分钟内复读同金额+同备注 → 判重，不重复入账（防重 roll / 指令回显）', async () => {
        const char = mkChar();
        await executeLifeDirectives('[[LIFE:EXPENSE|25.5|奶茶测试]]', char, noToast);
        await executeLifeDirectives('[[LIFE:EXPENSE|25.5|奶茶测试]]', char, noToast);
        const txs = (await DB.getAllTransactions()).filter(t => t.amount === -25.5);
        expect(txs).toHaveLength(1);
    });

    it('隔了超过 15 分钟的同金额+同备注 → 是新的一笔，正常入账（修"同金额记账停止"）', async () => {
        const char = mkChar();
        await DB.saveTransaction({
            id: `tx-test-${Math.random().toString(36).slice(2, 8)}`,
            amount: -66.6, category: 'general', note: '奶茶隔久了',
            timestamp: Date.now() - 16 * 60 * 1000, dateStr: lifeToday(),
        } as any);
        await executeLifeDirectives('[[LIFE:EXPENSE|66.6|奶茶隔久了]]', char, noToast);
        const txs = (await DB.getAllTransactions()).filter(t => t.amount === -66.6);
        expect(txs).toHaveLength(2);
    });

    it('缺 timestamp 的老流水 → 保守按重复处理（回到旧行为，防脏数据翻倍）', async () => {
        const char = mkChar();
        await DB.saveTransaction({
            id: `tx-test-old-${Math.random().toString(36).slice(2, 8)}`,
            amount: -77.7, category: 'general', note: '老数据',
            dateStr: lifeToday(),
        } as any);
        await executeLifeDirectives('[[LIFE:EXPENSE|77.7|老数据]]', char, noToast);
        const txs = (await DB.getAllTransactions()).filter(t => t.amount === -77.7);
        expect(txs).toHaveLength(1);
    });
});

// 主动消息的提示词是提前打包上云、到点才渲染的，中间可能隔几小时甚至几天。相对说法
// （今日待服 / 生理期第 N 天）在打包那一刻就冻住了，角色到点会照着念成过时的事实：
// 用户早上八点吃过药、晚上还被问「今天的药还没吃吧」。所以 fire_pack 里一律写绝对日期。
describe('buildLifeRecordInjection — fire_pack 写绝对日期', () => {
    afterAll(async () => {
        await DB.saveLifeRecordSettings({ id: 'main', hiddenModules: [] });
    });

    it('经期中：前台写「第 N 天」，fire_pack 写起始日期', async () => {
        await DB.saveLifeRecordSettings({ id: 'main', hiddenModules: [] });
        // 同文件前面的用例往共享库里写过今天的 PERIOD_END，清干净再造一条今天开始的经期，
        // 否则状态机判成「已结束」，前台也不会出现「第 N 天」，这条就验不到东西了。
        const existing = await DB.getAllLifeRecords();
        await Promise.all(existing.filter(r => r.module === 'period').map(r => DB.deleteLifeRecord(r.id)));
        await DB.saveLifeRecord(mkPeriod('start', lifeToday()));
        const char = mkChar();

        const live = await buildLifeRecordInjection(char, '小鱼', { forFirePack: false });
        const packed = await buildLifeRecordInjection(char, '小鱼', { forFirePack: true });

        expect(live).toContain('生理期：**第');
        expect(packed).toContain('本轮于');
        // 注意别用宽泛的 /第 \d+ 天/：开头那段人设说明里有「生理期第 2 天」的举例，
        // 那是固定文案不是数据，两种模式下都在。
        expect(packed).not.toContain('生理期：**第');
        expect(packed).toContain('以上记录截至');
    });

    it('fire_pack 里不出现任何「今日 X」式的断言', async () => {
        await DB.saveLifeRecordSettings({ id: 'main', hiddenModules: [] });
        const packed = await buildLifeRecordInjection(mkChar(), '小鱼', { forFirePack: true });

        for (const stale of ['今日待服', '今日支出', '今日已练', '今日还没练', '今日暂无']) {
            expect(packed, `fire_pack 不该出现会过期的「${stale}」`).not.toContain(stale);
        }
    });
});

// 记账合计以前是 txs.reduce((s, t) => s + t.amount, 0) 直接拼进文本的，几笔小数一加
// 就会变成 49.85999999999999，角色照着念出来很出戏。
describe('注入文本里的金额只到分位', () => {
    it('多笔小数相加不会把 49.85999999999999 念给角色听', async () => {
        const char = mkChar();
        for (const t of await DB.getAllTransactions()) await DB.deleteTransaction(t.id);
        const stamp = Date.now();
        for (const [i, amount] of [7.9, 12.9, 11.36, 11.9, 5.8].entries()) {
            await DB.saveTransaction({
                id: `tx-test-float-${i}-${Math.random().toString(36).slice(2, 8)}`,
                amount, category: 'general', note: `浮点测试${i}`,
                timestamp: stamp + i, dateStr: lifeToday(),
            } as any);
        }
        const text = await buildLifeRecordInjection(char, '小明', { forFirePack: false });
        expect(text).toContain('合计 49.86');
        expect(text).not.toMatch(/\d+\.\d{3,}/);
    });
});

// ═══════════════════════════════════════════════════════════
// ORDER 指令（char 主动点单）：扣 user 默认卡 + 落购物订单 + 出订单卡，双闸门 + 余额不足跳过 + 否决回滚
// ═══════════════════════════════════════════════════════════
describe('ORDER 指令（char 主动点单）', () => {
    afterAll(async () => {
        // 清理本 describe 落的 user 流水，避免污染后续/既有快照类断言
        const txs = await DB.getAllTransactions();
        for (const t of txs) {
            if (t.note?.includes('unique-shop') || t.note?.includes('_unique_')) {
                await DB.deleteTransaction(t.id);
            }
        }
    });

    it('总开关关 → 不记不成（moduleActive=false，走未启用跳过路径）', async () => {
        const char = mkChar({ charOrderEnabled: false });
        const out = await executeLifeDirectives('[[LIFE:ORDER|unique-shop-1|奶茶×2|20|睡前想喝]]', char, noToast);
        expect(out).toBe('');
        const records = (await DB.getAllLifeRecords()).filter(r => r.payload.shop === 'unique-shop-1');
        expect(records).toHaveLength(0);
    });

    it('成功：扣款流水 + 购物订单 + shopping_order 消息卡', async () => {
        const char = mkChar({ charOrderEnabled: true });
        // 预置 user 默认卡（测试库可能还没有 bank 状态）
        {
            const bank = await DB.getBankState();
            const cards = bank?.cards || [];
            if (!cards.some(c => !(c.owner === 'char'))) {
                await DB.saveBankState({ ...(bank || { config: { dailyBudget: 100, currencySymbol: '¥' }, shop: {} as any, goals: [], todaySpent: 0, lastLoginDate: '2026-01-01' }), cards: [...cards, { id: 'card_test_user_default', name: '测试零花钱卡', tailNo: '0001', balance: 1000, isDefault: true, owner: 'user' }] } as any);
            }
        }
        // Phase4 fix: char pays from own card
        {
            const bank2 = await DB.getBankState();
            const cards2 = bank2?.cards || [];
            const mine2 = cards2.find((c: any) => c.owner === 'char' && (c as any).ownerId === char.id);
            if (!mine2) {
                await DB.saveBankState({ ...(bank2 as any), cards: [...cards2, { id: 'card_test_char_' + char.id, name: 'CharTest', tailNo: '1002', balance: 1000, isDefault: true, owner: 'char', ownerId: char.id }] } as any);
            } else {
                await DB.saveBankState({ ...(bank2 as any), cards: cards2.map((c: any) => (c.owner === 'char' && (c as any).ownerId === char.id ? { ...c, balance: Math.max(Number(c.balance || 0), 1000) } : c)) } as any);
            }
        }
        const before = (await DB.getBankState())?.cards?.find((c: any) => c.owner === 'char' && (c as any).ownerId === char.id)?.balance ?? 0;
        const out = await executeLifeDirectives('给你点了宵夜 [[LIFE:ORDER|unique-shop-2|烧烤×2|36|半夜饿了]]', char, noToast);
        expect(out).toBe('给你点了宵夜');

        // 订单落库，扣 user 默认卡
        const orders = await DB.getAllShoppingOrders();
        const order = orders.find(o => o.shopName === 'unique-shop-2');
        expect(order).toBeTruthy();
        expect(order!.total).toBe(36);
        expect(order!.placedBy).toBe('char');
        expect(order!.recipientType).toBe('user');

        const cards = (await DB.getBankState())?.cards || [];
        const after = cards.find((c: any) => c.owner === 'char' && (c as any).ownerId === char.id)?.balance ?? 0;
        expect(Math.round((before - after) * 100) / 100).toBe(36);

        // 流水 + LifeRecord 镜像（否决回滚用）
        const txs = await DB.getAllTransactions();
        const tx = txs.find(t => t.note === 'unique-shop-2（江屿点的）');
        expect(tx).toBeTruthy();
        expect(tx!.amount).toBe(-36);
        const rec = (await DB.getAllLifeRecords()).find(r => r.payload.shop === 'unique-shop-2');
        expect(rec?.bankTxId).toBe(tx!.id);
        expect(rec?.reviewStatus).toBe('active');

        // 订单卡消息（非 life_card）
        const msgs = await DB.getMessagesByCharId(char.id, true);
        const card = msgs.find((m: Message) => m.type === 'shopping_order' && m.metadata?.orderId === order!.id);
        expect(card).toBeTruthy();
        expect(card!.content).toContain('SHOPPING_ORDER');
        expect(card!.metadata.recordId).toBe(rec!.id);

        // 清理本条订单
        await DB.deleteShoppingOrder(order!.id);
    });

    it('同日同店重复 → 卡片标 duplicate，不重复扣款', async () => {
        const char = mkChar({ charOrderEnabled: true, name: '林深_unique_' + Math.random().toString(36).slice(2, 6) });
        {
            const bB = await DB.getBankState();
            const csB = bB?.cards || [];
            if (!csB.some((c: any) => c.owner === 'char' && (c as any).ownerId === char.id)) {
                await DB.saveBankState({ ...(bB as any), cards: [...csB, { id: 'card_test_char_' + char.id, name: 'CharTest', tailNo: '1003', balance: 1000, isDefault: true, owner: 'char', ownerId: char.id }] } as any);
            }
        }
        const out = await executeLifeDirectives('[[LIFE:ORDER|unique-shop-3|小龙虾×1|88|]]', char, noToast);
        expect(out).toBe('');
        const out2 = await executeLifeDirectives('[[LIFE:ORDER|unique-shop-3|小龙虾×1|88|]]', char, noToast);
        expect(out2).toBe('');

        const recs = (await DB.getAllLifeRecords()).filter(r => r.payload.shop === 'unique-shop-3' && r.reviewStatus !== 'rejected');
        expect(recs).toHaveLength(1);
        const msgs = await DB.getMessagesByCharId(char.id, true);
        expect(msgs.some((m: Message) => m.type === 'life_card' && m.metadata?.duplicate === true)).toBe(true);
        // 清理
        const order = (await DB.getAllShoppingOrders()).find(o => o.shopName === 'unique-shop-3');
        if (order) await DB.deleteShoppingOrder(order.id);
        const tx = (await DB.getAllTransactions()).find(t => t.note === 'unique-shop-3（林深点的）' || t.note === 'unique-shop-3（TA点的）');
        if (tx) await DB.deleteTransaction(tx.id);
    });

    it('余额不足 → noteSkipped 系统提示，不落订单不扣款', async () => {
        const char = mkChar({ charOrderEnabled: true });
        // 保证卡余额低于 999999
        const bank = await DB.getBankState();
        const cards = bank?.cards || [];
        for (const c of cards) {
            if (!(c.owner === 'char') && c.balance >= 999999) {
                await DB.saveBankState({ ...bank!, cards: cards.map(x => x.id === c.id ? { ...x, balance: 100 } : x) });
            }
        }
        {
            const bC = await DB.getBankState();
            const csC = bC?.cards || [];
            const exC = csC.find((c: any) => c.owner === 'char' && (c as any).ownerId === char.id);
            if (!exC) {
                await DB.saveBankState({ ...(bC as any), cards: [...csC, { id: 'card_test_char_' + char.id, name: 'CharTest', tailNo: '1004', balance: 50, isDefault: true, owner: 'char', ownerId: char.id }] } as any);
            } else {
                await DB.saveBankState({ ...(bC as any), cards: csC.map((c: any) => (c.owner === 'char' && (c as any).ownerId === char.id ? { ...c, balance: 50 } : c)) } as any);
            }
        }
        const out = await executeLifeDirectives('[[LIFE:ORDER|unique-shop-4|豪宅×1|999999|]]', char, noToast);
        expect(out).toBe('');
        const order = (await DB.getAllShoppingOrders()).find(o => o.shopName === 'unique-shop-4');
        expect(order).toBeFalsy();
        const msgs = await DB.getMessagesByCharId(char.id, true);
        expect(msgs.some((m: Message) => m.role === 'system' && m.content.includes('余额不足'))).toBe(true);
    });

    it('否决 → 流水回滚 + 订单删除 + 卡片确认', async () => {
        const char = mkChar({ charOrderEnabled: true, name: '苏婉_unique_' + Math.random().toString(36).slice(2, 6) });
        {
            const bD = await DB.getBankState();
            const csD = bD?.cards || [];
            if (!csD.some((c: any) => c.owner === 'char' && (c as any).ownerId === char.id)) {
                await DB.saveBankState({ ...(bD as any), cards: [...csD, { id: 'card_test_char_' + char.id, name: 'CharTest', tailNo: '1005', balance: 1000, isDefault: true, owner: 'char', ownerId: char.id }] } as any);
            }
        }
        await executeLifeDirectives('[[LIFE:ORDER|unique-shop-5|蛋糕×1|52|]]', char, noToast);
        const rec = (await DB.getAllLifeRecords()).find(r => r.payload.shop === 'unique-shop-5');
        expect(rec).toBeTruthy();
        const txBefore = (await DB.getAllTransactions()).find(t => t.id === rec!.bankTxId);
        expect(txBefore).toBeTruthy();

        const msgs = await DB.getMessagesByCharId(char.id, true);
        const card = msgs.find((m: Message) => m.type === 'shopping_order' && m.metadata?.recordId === rec!.id);
        expect(card).toBeTruthy();
        await resolveLifeRecordCard(card!, 'rejected');

        expect((await DB.getAllTransactions()).find(t => t.id === rec!.bankTxId)).toBeFalsy();
        expect((await DB.getAllShoppingOrders()).find(o => o.shopName === 'unique-shop-5')).toBeFalsy();
        expect((await DB.getAllLifeRecords()).find(r => r.id === rec!.id)?.reviewStatus).toBe('rejected');
    });
});
