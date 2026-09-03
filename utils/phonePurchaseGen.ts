// ============================================================
// phonePurchaseGen: CheckPhone purchase-record simulation engine.
// No real ordering UI here. LLM generates time/content/reason for
// char-driven purchases (keyword-driven + impulse flashes).
// ============================================================
export interface PurchaseGenCharInput {
  id: string;
  name: string;
  personality?: string;
  interestKeywords: string[];
  spendingLevel?: string;
  schedule?: string;
  impulseAnchor: string[];
}

export interface PurchaseGenParams {
  currentDate: string; // YYYY-MM-DD
  count: number;
  impulseProbability: number; // 0.15-0.3
  platformPool: string[];
  priceRange: [number, number];
}

export interface SimulatedPurchase {
  transaction_id: string;
  platform: string;
  merchant: string;
  source: 'active' | 'impulse';
  is_proactive: boolean;
  is_impulse: boolean;
  item: string;
  category: string;
  amount: number;
  currency: string;
  time: { timestamp: string; description: string };
  reason: string;
  interest_keyword_hit?: string;
  linked: { bank_card_id: string; bank_txn_id: string };
}

export function buildPurchaseGenPrompt(char: PurchaseGenCharInput, params: PurchaseGenParams): string {
  const rate = Math.round((1 - params.impulseProbability) * 100);
  return [
    'You are a persona-driven shopping behavior simulator. Output a JSON array only.',
    `Character: ${char.name}. Profile: ${char.personality || ''}.`,
    `Interest keywords: ${(char.interestKeywords || []).join(', ') || 'none'}.`,
    `Spending: ${char.spendingLevel || 'unknown'}. Schedule: ${char.schedule || 'unknown'}.`,
    `Impulse anchor (weakly-related everyday categories): ${(char.impulseAnchor || []).join(', ')}.`,
    `Rules: 1) ~${rate}% records come from interest keywords, char picks 1-3 keywords autonomously with concrete human reasons.`,
    `2) The rest are impulse flashes inside impulse_anchor, unrelated to core interests but plausible in daily life.`,
    `3) Each record has time (fits current date ${params.currentDate} + schedule), content (concrete item + platform from ${(params.platformPool || []).join('/')}, price within [${params.priceRange[0]}, ${params.priceRange[1]}]), reason (one concrete sentence).`,
    '4) Amount is a positive number. is_proactive/is_impulse are mutually exclusive.',
    `5) Generate exactly ${params.count} records.`,
  ].join('\n');
}

export function parsePurchaseGenJson(raw: string, fallbackDate: string): SimulatedPurchase[] {
  const clean = (raw || '').replace(/```/g, '').trim();
  const arrMatch = clean.match(/[\[][\s\S]*[\]]/);
  const src = arrMatch ? arrMatch[0] : clean;
  let arr: any[] = [];
  try { arr = JSON.parse(src); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 20).map((r, i) => ({
    transaction_id: String(r.transaction_id || `txn_${fallbackDate.replace(/-/g, '')}_${String(i + 1).padStart(3, '0')}`),
    platform: String(r.platform || ''),
    merchant: String(r.merchant || ''),
    source: r.is_impulse ? 'impulse' : 'active',
    is_proactive: !!r.is_proactive && !r.is_impulse,
    is_impulse: !!r.is_impulse,
    item: String(r.item || ''),
    category: String(r.category || ''),
    amount: Math.max(0, Number(r.amount) || 0),
    currency: String(r.currency || 'CNY'),
    time: { timestamp: String(r.time?.timestamp || ''), description: String(r.time?.description || '') },
    reason: String(r.reason || ''),
    interest_keyword_hit: r.interest_keyword_hit ? String(r.interest_keyword_hit) : undefined,
    linked: { bank_card_id: String(r.linked?.bank_card_id || ''), bank_txn_id: String(r.linked?.bank_txn_id || '') },
  }));
}

export function extractInterestKeywords(char: { personality?: string; background?: string; description?: string; systemPrompt?: string; worldview?: string; bio?: string; hobbies?: string[]; habits?: string[] }): string[] {
  const bag: string[] = [];
  const push = (s?: string) => {
    if (!s) return;
    s.split(/[,\uff0c;\u3001\/\s]+/).map(t => t.trim()).filter(t => t.length >= 2 && t.length <= 8).slice(0, 8).forEach(t => bag.push(t));
  };
  const head = (t?: string) => (t || '').slice(0, 600);
  push(char.personality); push(char.background);
  push(head((char as any).description)); push(head((char as any).systemPrompt));
  push(head((char as any).worldview)); push((char as any).bio);
  (char.hobbies || []).forEach(push); (char.habits || []).forEach(push);
  return [...new Set(bag)].slice(0, 12);
}
