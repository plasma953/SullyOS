/**
 * 联系人关系网发散生成（查手机 · 通讯录「关系网发散」按钮）。
 *
 * 与 relationshipGen.ts（char 稳定人设的 NPC 群像 → char.relationshipProfiles）互补：
 * 这里站在**机主通讯录视角**，从三层已知候选里挑人写进 phoneState.contacts：
 *  1. neural  ：神经链接里的真实角色（本体 char 除外）
 *  2. rel     ：char.relationshipProfiles 的 NPC 群像（人设 + 与 char 的关系一句话）
 *  3. world   ：char 所在世界（WorldProfile.memberIds 含 char.id）的 NPC + 有向关系条
 *               （world.relationships 里 fromId===char.id 的视角 → identity 更有依据）
 *
 * 候选仍不够 / 允许虚构时，LLM 可按人设补合理的 npc（allowFictionalContacts=false 时禁止）。
 * 复用 relationshipChat.upsertContact 合并（同名不重复，缺字段不覆盖）。
 */
import type { CharacterProfile, PhoneContact, UserProfile } from '../types';
import { DB } from './db';
import { ContextBuilder } from './context';
import { extractContent, extractJson } from './safeApi';
import { upsertContact, normName, clampAffinity } from './relationshipChat';

export interface ContactGenApiConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

export interface ContactGenRequest {
    char: CharacterProfile;
    user: UserProfile;
    api: ContactGenApiConfig;
    /** 本次想新增的联系人数量（默认 3，上限 6） */
    count?: number;
}

export interface ContactGenResult {
    /** 合并后的完整通讯录（调用方直接 updateCharacter 落库） */
    contacts: PhoneContact[];
    /** 本次新增人数 */
    added: number;
    /** 本次更新（已有联系人补身份/好感）人数 */
    updated: number;
    /** 候选来源统计（回显用） */
    sources: { neural: number; rel: number; world: number };
}

interface RosterEntry {
    name: string;
    /** 来源层：neural 真实角色 / rel 关系群像 / world 世界 NPC */
    source: 'neural' | 'rel' | 'world';
    /** 一句话人设/来历 */
    persona: string;
    /** 与 char 的关系（或对 char 的视角称呼） */
    relation?: string;
    /** neural 命中的真实角色 id */
    linkedCharId?: string;
}

/** 收集三层候选（排除已在通讯录里的，按 normName 去重） */
async function collectRoster(char: CharacterProfile): Promise<{ roster: RosterEntry[]; sources: ContactGenResult['sources']; allowFictional: boolean }> {
    const existing = char.phoneState?.contacts || [];
    const existKeys = new Set(existing.map(c => normName(c.name)));
    const roster: RosterEntry[] = [];

    // 1) neural：真实角色
    const linkedIds = new Set((existing.map(c => c.linkedCharId).filter(Boolean)) as string[]);
    const chars = (await DB.getAllCharacters()).filter(c => c.id !== char.id);
    for (const c of chars) {
        if (existKeys.has(normName(c.name)) || linkedIds.has(c.id)) continue;
        roster.push({
            name: c.name,
            source: 'neural',
            persona: (c.socialProfile?.bio || c.description || c.systemPrompt || '').replace(/\s+/g, ' ').trim().slice(0, 90),
            linkedCharId: c.id,
        });
    }

    // 2) rel：char.relationshipProfiles NPC 群像
    for (const r of char.relationshipProfiles || []) {
        if (existKeys.has(normName(r.name))) continue;
        roster.push({ name: r.name, source: 'rel', persona: r.persona.slice(0, 90), relation: r.relation });
    }

    // 3) world：char 所在世界的 NPC + 有向关系
    try {
        const worlds = await DB.getWorlds();
        for (const w of worlds) {
            if (!(w.memberIds || []).includes(char.id)) continue;
            const npcById = new Map((w.npcs || []).map(n => [n.id, n]));
            const seen = new Set<string>();
            // 与 char 有关系的 NPC（含 char 的视角 label）优先
            for (const rel of w.relationships || []) {
                if (rel.fromId !== char.id) continue;
                const npc = npcById.get(rel.toId);
                if (!npc || existKeys.has(normName(npc.name)) || seen.has(npc.id)) continue;
                seen.add(npc.id);
                roster.push({ name: npc.name, source: 'world', persona: npc.persona, relation: rel.label });
            }
            // 其余世界 NPC（同人设）
            for (const npc of w.npcs || []) {
                if (seen.has(npc.id) || existKeys.has(normName(npc.name))) continue;
                roster.push({ name: npc.name, source: 'world', persona: npc.persona });
            }
        }
    } catch { /* 世界系统不可用时静默跳过该层 */ }

    return {
        roster,
        sources: {
            neural: roster.filter(r => r.source === 'neural').length,
            rel: roster.filter(r => r.source === 'rel').length,
            world: roster.filter(r => r.source === 'world').length,
        },
        allowFictional: char.phoneState?.allowFictionalContacts !== false,
    };
}

/**
 * 发散生成联系人：三层候选喂给 LLM 挑人 + 起身份，合并回通讯录。
 * 抛错由调用方 toast（网络/解析失败不改任何数据）。
 */
export async function generateRelationshipContacts(req: ContactGenRequest): Promise<ContactGenResult> {
    const { char, user, api } = req;
    const count = Math.min(6, Math.max(1, req.count || 3));
    const { roster, sources, allowFictional } = await collectRoster(char);
    const existing = char.phoneState?.contacts || [];

    // 完全没有候选且禁止虚构 → 无事可做（上层 toast 说明）
    if (roster.length === 0 && !allowFictional) {
        return { contacts: existing, added: 0, updated: 0, sources };
    }

    const context = ContextBuilder.buildCoreContext(char, user, false);
    const rosterText = roster.length
        ? roster.map(r => `- ${r.name}【${r.source === 'neural' ? '真实的人' : r.source === 'rel' ? 'TA 生命中的人' : '同世界居民'}】${r.relation ? `，与 TA：${r.relation}` : ''}${r.persona ? `。${r.persona}` : ''}`).join('\n')
        : '（暂无候选）';
    const fictionRule = allowFictional
        ? '候选不够理想时，可以按人设虚构**少量**贴合生活圈的新联系人。'
        : '\n**硬约束**：禁止虚构，只能从候选名单里挑。';

    const prompt = `${context}

### [候选名单（TA 生命中可能出现的人）]
${rosterText}

### [视角锁定]
你在为**你（${char.name}）自己**的手机通讯录挑人——这些是「你认识的、会存进通讯录」的人。用户「${user.name}」只是在偷看，**不要**把用户塞进去。

### [Task]
从候选里挑最多 ${count} 个**你最可能存进通讯录**的人（真实的人优先级高；关系越近越该在通讯录里），给他们写机主视角的备注身份。${fictionRule}

格式 JSON 数组（只输出 JSON）：
[{ "name": "候选原名或虚构名", "identity": "机主对 TA 的称呼/关系备注（如「学长」「发小」「瑜伽课搭子」）", "affinity": 0到100的整数, "note": "一句已确立的事实（可选）" }, ...]`;

    const res = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
        body: JSON.stringify({ model: api.model, messages: [{ role: 'user', content: prompt }], temperature: 0.9 }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const arr = await safeJson(res);

    let contacts = [...existing];
    let added = 0;
    let updated = 0;
    const rosterByName = new Map(roster.map(r => [normName(r.name), r] as const));
    for (const item of arr.slice(0, count + 2)) {
        const name = String(item?.name || '').trim();
        if (!name) continue;
        const hit = rosterByName.get(normName(name));
        const linked = hit?.linkedCharId || undefined;
        const isReal = !!linked;
        // 甄别兜底：命中真实角色时统一用名单原名（防 LLM 改名/错字）
        const finalName = hit ? hit.name : name;
        const before = contacts.length;
        contacts = upsertContact(contacts, {
            name: finalName,
            identity: (String(item?.identity || '').trim() || (hit ? `${hit.source === 'neural' ? '神经链接' : '相识'}：${hit.relation || hit.persona.slice(0, 20)}` : undefined)),
            affinity: clampAffinity(Number.isFinite(Number(item?.affinity)) ? Number(item.affinity) : (isReal ? 40 : 20)),
            note: String(item?.note || '').trim() || undefined,
            kind: isReal ? 'real' : 'npc',
            linkedCharId: linked,
        });
        if (contacts.length > before) added++; else updated++;
    }
    return { contacts, added, updated, sources };
}

async function safeJson(res: Response): Promise<any[]> {
    const data = await res.json();
    const content = extractContent(data);
    const json = extractJson(content || '');
    return Array.isArray(json) ? json : [];
}
